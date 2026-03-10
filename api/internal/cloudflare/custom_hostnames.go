package cloudflare

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Client wraps the Cloudflare API for Custom Hostnames (Cloudflare for SaaS).
type Client struct {
	ZoneID   string
	APIToken string
}

type createRequest struct {
	Hostname string    `json:"hostname"`
	SSL      sslConfig `json:"ssl"`
}

type sslConfig struct {
	Method string `json:"method"`
	Type   string `json:"type"`
}

type apiResponse struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result"`
	Errors  []apiError      `json:"errors"`
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type hostnameResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// CreateCustomHostname registers a custom hostname with Cloudflare.
// Returns the Cloudflare hostname ID.
func (c *Client) CreateCustomHostname(hostname string) (string, error) {
	body, err := json.Marshal(createRequest{
		Hostname: hostname,
		SSL:      sslConfig{Method: "http", Type: "dv"},
	})
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/custom_hostnames", c.ZoneID)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("cloudflare API request failed: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading cloudflare response: %w", err)
	}

	var apiResp apiResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		return "", fmt.Errorf("parsing cloudflare response: %w", err)
	}

	if !apiResp.Success {
		if len(apiResp.Errors) > 0 {
			return "", fmt.Errorf("cloudflare: %s", apiResp.Errors[0].Message)
		}
		return "", fmt.Errorf("cloudflare API returned failure: %s", string(data))
	}

	var result hostnameResult
	if err := json.Unmarshal(apiResp.Result, &result); err != nil {
		return "", fmt.Errorf("parsing cloudflare result: %w", err)
	}

	return result.ID, nil
}

// DeleteCustomHostname removes a custom hostname from Cloudflare.
func (c *Client) DeleteCustomHostname(cfHostnameID string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/custom_hostnames/%s", c.ZoneID, cfHostnameID)
	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("cloudflare API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cloudflare delete failed (%d): %s", resp.StatusCode, string(data))
	}

	return nil
}
