package server

import (
	"net/http"
	"strings"
)

// connectAllowedHeaders lists the headers the Connect protocol uses.
// Mirrors the documented Connect-Web headers so the Electron renderer can talk to us.
var connectAllowedHeaders = strings.Join([]string{
	"Content-Type",
	"Connect-Protocol-Version",
	"Connect-Timeout-Ms",
	"X-User-Agent",
	"Authorization",
}, ", ")

// NewCORSMiddleware returns a middleware that enforces a single-origin allowlist
// for Connect-RPC traffic and handles CORS preflight.
func NewCORSMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			wildcard := allowedOrigin == "*"

			if origin != "" && !wildcard && origin != allowedOrigin {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}

			if origin != "" {
				// ponytail: echo origin instead of literal "*" so credentialed
				// requests still work; upgrade to a real allowlist if needed.
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", connectAllowedHeaders)
				w.Header().Set("Access-Control-Max-Age", "7200")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
