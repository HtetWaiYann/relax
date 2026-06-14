package server

import (
	"errors"
	"testing"

	"connectrpc.com/connect"
)

func TestRequireNonEmpty(t *testing.T) {
	if err := requireNonEmpty("field", ""); err == nil {
		t.Fatal("want error for empty value")
	}
	if err := requireNonEmpty("field", "   "); err == nil {
		t.Fatal("want error for whitespace-only value")
	}
	if err := requireNonEmpty("field", "ok"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRequireMagnet(t *testing.T) {
	cases := []struct {
		name    string
		uri     string
		wantErr bool
	}{
		{"empty", "", true},
		{"http", "http://example.com/file.torrent", true},
		{"valid", "magnet:?xt=urn:btih:abc", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := requireMagnet(tc.uri)
			if (err != nil) != tc.wantErr {
				t.Fatalf("wantErr=%v, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestInvalidArgErrorCode(t *testing.T) {
	err := invalidArg("boom")
	var connErr *connect.Error
	if !errors.As(err, &connErr) {
		t.Fatalf("expected *connect.Error, got %T", err)
	}
	if connErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("want CodeInvalidArgument, got %v", connErr.Code())
	}
}
