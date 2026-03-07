package analytics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/mehanig/yourbro/api/internal/storage"
)

// PageView represents a single public page view event.
type PageView struct {
	UserID   int64
	Slug     string
	IP       string // raw IP — hashed before storage
	Referrer string
	UserAgent string
}

// Recorder asynchronously writes page view events to the database.
type Recorder struct {
	ch chan PageView
	db *storage.DB
	wg sync.WaitGroup
}

// New creates a Recorder with a buffered channel and fixed worker pool.
func New(db *storage.DB, bufSize, workers int) *Recorder {
	r := &Recorder{
		ch: make(chan PageView, bufSize),
		db: db,
	}
	for i := 0; i < workers; i++ {
		r.wg.Add(1)
		go r.worker()
	}
	return r
}

// Record enqueues a page view. Non-blocking; drops the event if the buffer is full.
func (r *Recorder) Record(v PageView) {
	select {
	case r.ch <- v:
	default:
		log.Println("analytics: buffer full, dropping page view event")
	}
}

// Shutdown closes the channel and waits for workers to drain.
func (r *Recorder) Shutdown() {
	close(r.ch)
	r.wg.Wait()
}

func (r *Recorder) worker() {
	defer r.wg.Done()
	for v := range r.ch {
		ipHash := hashIP(v.IP)
		isBot := isBotUA(v.UserAgent)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := r.db.InsertPageView(ctx, v.UserID, v.Slug, ipHash, v.Referrer, isBot)
		cancel()
		if err != nil {
			log.Printf("analytics: failed to insert page view: %v", err)
		}
	}
}

func hashIP(ip string) string {
	h := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(h[:])
}

func isBotUA(ua string) bool {
	lower := strings.ToLower(ua)
	bots := []string{"bot", "crawler", "spider", "curl", "wget", "python-requests", "go-http-client", "headlesschrome", "phantomjs"}
	for _, b := range bots {
		if strings.Contains(lower, b) {
			return true
		}
	}
	return false
}
