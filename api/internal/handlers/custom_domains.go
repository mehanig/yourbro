package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mehanig/yourbro/api/internal/auth"
	"github.com/mehanig/yourbro/api/internal/cloudflare"
	"github.com/mehanig/yourbro/api/internal/middleware"
	"github.com/mehanig/yourbro/api/internal/models"
	"github.com/mehanig/yourbro/api/internal/storage"
)

type CustomDomainsHandler struct {
	DB *storage.DB
	CF *cloudflare.Client
}

func (h *CustomDomainsHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain is required"})
		return
	}

	// Limit to one custom domain per user
	existing, err := h.DB.ListCustomDomains(r.Context(), userID)
	if err == nil && len(existing) > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "only one custom domain is allowed per account"})
		return
	}

	// Global limit to stay within Cloudflare free tier
	var totalDomains int64
	_ = h.DB.Pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM custom_domains`).Scan(&totalDomains)
	if totalDomains >= 95 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "custom domain limit reached, please contact support"})
		return
	}

	// Basic domain validation
	if strings.Contains(domain, " ") || !strings.Contains(domain, ".") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid domain format"})
		return
	}

	// Reject yourbro.ai subdomains
	if domain == "yourbro.ai" || strings.HasSuffix(domain, ".yourbro.ai") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot use yourbro.ai domains"})
		return
	}

	token, err := auth.GenerateRandomHex(16)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate verification token"})
		return
	}

	cd, err := h.DB.CreateCustomDomain(r.Context(), userID, domain, token)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "domain already registered"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to add domain"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"domain": cd,
		"instructions": map[string]string{
			"cname":  fmt.Sprintf("CNAME %s → custom.yourbro.ai", domain),
			"txt":    fmt.Sprintf("TXT _yourbro.%s → yb-verify=%s", domain, cd.VerificationToken),
			"detail": "Add both DNS records, then click Verify.",
		},
	})
}

func (h *CustomDomainsHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	domains, err := h.DB.ListCustomDomains(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list domains"})
		return
	}
	if domains == nil {
		domains = []models.CustomDomain{}
	}

	writeJSON(w, http.StatusOK, domains)
}

func (h *CustomDomainsHandler) Verify(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid domain id"})
		return
	}

	cd, err := h.DB.GetCustomDomainByID(r.Context(), id, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "domain not found"})
		return
	}

	if cd.Verified {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already verified"})
		return
	}

	// Check TXT record: _yourbro.{domain} should contain yb-verify={token}
	expectedTXT := "yb-verify=" + cd.VerificationToken
	txtRecords, err := net.LookupTXT("_yourbro." + cd.Domain)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"error":    "DNS TXT record not found",
			"expected": fmt.Sprintf("TXT _yourbro.%s → %s", cd.Domain, expectedTXT),
		})
		return
	}

	found := false
	for _, txt := range txtRecords {
		if strings.TrimSpace(txt) == expectedTXT {
			found = true
			break
		}
	}
	if !found {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"error":    "TXT record value mismatch",
			"expected": expectedTXT,
		})
		return
	}

	// Check CNAME resolves (best-effort — CNAME lookup can be flaky).
	// LookupCNAME returns the domain itself when there's no CNAME (A record only), which is fine.
	cname, err := net.LookupCNAME(cd.Domain)
	if err == nil && cname != "" {
		cname = strings.TrimSuffix(cname, ".")
		if cname != "custom.yourbro.ai" && cname != cd.Domain {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
				"error":    fmt.Sprintf("CNAME points to %s, expected custom.yourbro.ai", cname),
				"expected": "CNAME → custom.yourbro.ai (or A record to VPS IP)",
			})
			return
		}
	}

	// Register with Cloudflare Custom Hostnames
	cfHostnameID := ""
	if h.CF != nil {
		cfID, err := h.CF.CreateCustomHostname(cd.Domain)
		if err != nil {
			log.Printf("Cloudflare CreateCustomHostname failed for %s: %v", cd.Domain, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "failed to register domain with CDN: " + err.Error(),
			})
			return
		}
		cfHostnameID = cfID
	}

	if err := h.DB.VerifyCustomDomain(r.Context(), id, userID, cfHostnameID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to verify domain"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

func (h *CustomDomainsHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid domain id"})
		return
	}

	var req struct {
		DefaultSlug string `json:"default_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if err := h.DB.UpdateCustomDomainDefaultSlug(r.Context(), id, userID, req.DefaultSlug); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update domain"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *CustomDomainsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid domain id"})
		return
	}

	// Look up the domain to get the Cloudflare hostname ID before deleting
	cd, err := h.DB.GetCustomDomainByID(r.Context(), id, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "domain not found"})
		return
	}

	// Remove from Cloudflare if registered
	if h.CF != nil && cd.CFHostnameID != "" {
		if err := h.CF.DeleteCustomHostname(cd.CFHostnameID); err != nil {
			log.Printf("Cloudflare DeleteCustomHostname failed for %s (cf_id=%s): %v", cd.Domain, cd.CFHostnameID, err)
			// Continue with DB deletion even if Cloudflare fails
		}
	}

	if err := h.DB.DeleteCustomDomain(r.Context(), id, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete domain"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
