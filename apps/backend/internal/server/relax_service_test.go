package server

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"connectrpc.com/connect"

	relaxv1 "relax/gen/relax/v1"
	"relax/internal/metadata"
	"relax/internal/streams"
)

type nopStreams struct{}

func (nopStreams) GetStreams(_ context.Context, _ string, _ relaxv1.MediaType, _, _ *int32) ([]*relaxv1.StreamSource, error) {
	return nil, nil
}

var _ streams.Provider = nopStreams{}

func newTestServer() *RelaxServer {
	return NewRelaxServer(slog.New(slog.NewTextHandler(io.Discard, nil)), metadata.New(""), nopStreams{})
}

func TestSearchReturnsStubResults(t *testing.T) {
	srv := newTestServer()
	resp, err := srv.Search(context.Background(), connect.NewRequest(&relaxv1.SearchRequest{
		Query: "inception",
	}))
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if got := len(resp.Msg.GetResults()); got != 2 {
		t.Fatalf("want 2 results, got %d", got)
	}
	titles := []string{
		resp.Msg.GetResults()[0].GetMetadata().GetTitle(),
		resp.Msg.GetResults()[1].GetMetadata().GetTitle(),
	}
	if titles[0] != "Inception" || titles[1] != "The Matrix" {
		t.Errorf("unexpected titles: %v", titles)
	}
}

func TestSearchRejectsEmptyQuery(t *testing.T) {
	srv := newTestServer()
	_, err := srv.Search(context.Background(), connect.NewRequest(&relaxv1.SearchRequest{
		Query: "",
	}))
	if err == nil {
		t.Fatal("want error for empty query")
	}
	var connErr *connect.Error
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Fatalf("want CodeInvalidArgument, got %v (err type %T, connErr %v)", got, err, connErr)
	}
}

func TestAddTorrentRejectsBadMagnet(t *testing.T) {
	srv := newTestServer()
	_, err := srv.AddTorrent(context.Background(), connect.NewRequest(&relaxv1.AddTorrentRequest{
		MagnetUri: "http://nope",
	}))
	if err == nil {
		t.Fatal("want error for bad magnet")
	}
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Fatalf("want CodeInvalidArgument, got %v", got)
	}
}
