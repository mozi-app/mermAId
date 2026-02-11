package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewDiagramState(t *testing.T) {
	ds := NewDiagramState("sequenceDiagram\n  Alice->>Bob: Hi")
	content, version := ds.Get()
	if content != "sequenceDiagram\n  Alice->>Bob: Hi" {
		t.Errorf("expected initial content, got %q", content)
	}
	if version != 1 {
		t.Errorf("expected version 1, got %d", version)
	}
}

func TestDiagramStateSet(t *testing.T) {
	ds := NewDiagramState("initial")

	v := ds.Set("updated", "browser")
	if v != 2 {
		t.Errorf("expected version 2, got %d", v)
	}

	content, version := ds.Get()
	if content != "updated" {
		t.Errorf("expected 'updated', got %q", content)
	}
	if version != 2 {
		t.Errorf("expected version 2, got %d", version)
	}
}

func TestDiagramStateSetBroadcasts(t *testing.T) {
	ds := NewDiagramState("initial")

	ch := ds.Subscribe()
	defer ds.Unsubscribe(ch)

	ds.Set("new content", "mcp")

	select {
	case event := <-ch:
		if event.Content != "new content" {
			t.Errorf("expected 'new content', got %q", event.Content)
		}
		if event.Source != "mcp" {
			t.Errorf("expected source 'mcp', got %q", event.Source)
		}
		if event.Version != 2 {
			t.Errorf("expected version 2, got %d", event.Version)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestDiagramStateMultipleSubscribers(t *testing.T) {
	ds := NewDiagramState("initial")

	ch1 := ds.Subscribe()
	defer ds.Unsubscribe(ch1)
	ch2 := ds.Subscribe()
	defer ds.Unsubscribe(ch2)

	ds.Set("broadcast", "api")

	for _, ch := range []chan DiagramEvent{ch1, ch2} {
		select {
		case event := <-ch:
			if event.Content != "broadcast" {
				t.Errorf("expected 'broadcast', got %q", event.Content)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for event")
		}
	}
}

func TestDiagramStateUnsubscribe(t *testing.T) {
	ds := NewDiagramState("initial")

	ch := ds.Subscribe()
	ds.Unsubscribe(ch)

	ds.Set("after unsub", "browser")

	select {
	case <-ch:
		t.Fatal("should not receive event after unsubscribe")
	case <-time.After(50 * time.Millisecond):
		// expected
	}
}

func TestHandleGetDiagram(t *testing.T) {
	ds := NewDiagramState("test diagram")

	req := httptest.NewRequest("GET", "/api/diagram", nil)
	w := httptest.NewRecorder()

	ds.handleGetDiagram(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)

	if resp["content"] != "test diagram" {
		t.Errorf("expected 'test diagram', got %v", resp["content"])
	}
	if resp["version"].(float64) != 1 {
		t.Errorf("expected version 1, got %v", resp["version"])
	}
}

func TestHandleSetDiagram(t *testing.T) {
	ds := NewDiagramState("old")

	body := `{"content": "new diagram", "source": "mcp"}`
	req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader(body))
	w := httptest.NewRecorder()

	ds.handleSetDiagram(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)

	if resp["version"].(float64) != 2 {
		t.Errorf("expected version 2, got %v", resp["version"])
	}

	content, _ := ds.Get()
	if content != "new diagram" {
		t.Errorf("expected 'new diagram', got %q", content)
	}
}

func TestHandleSetDiagramInvalidJSON(t *testing.T) {
	ds := NewDiagramState("old")

	req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader("not json"))
	w := httptest.NewRecorder()

	ds.handleSetDiagram(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandleSetDiagramDefaultSource(t *testing.T) {
	ds := NewDiagramState("old")

	ch := ds.Subscribe()
	defer ds.Unsubscribe(ch)

	body := `{"content": "updated"}`
	req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader(body))
	w := httptest.NewRecorder()

	ds.handleSetDiagram(w, req)

	select {
	case event := <-ch:
		if event.Source != "api" {
			t.Errorf("expected default source 'api', got %q", event.Source)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestDiagramSSEWithRealServer(t *testing.T) {
	ds := NewDiagramState("initial")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/events", ds.handleDiagramSSE)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// Connect to SSE — no Client.Timeout so the long-lived connection works
	resp, err := http.Get(ts.URL + "/api/events")
	if err != nil {
		t.Fatalf("failed to connect to SSE: %v", err)
	}
	defer resp.Body.Close()

	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Errorf("expected text/event-stream, got %q", resp.Header.Get("Content-Type"))
	}

	// Push a change so data is available to read
	ds.Set("live update", "mcp")

	// Read via goroutine with timeout
	type readResult struct {
		data string
		err  error
	}
	ch := make(chan readResult, 1)
	go func() {
		buf := make([]byte, 4096)
		n, err := resp.Body.Read(buf)
		ch <- readResult{string(buf[:n]), err}
	}()

	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatalf("failed to read SSE event: %v", r.err)
		}
		if !strings.Contains(r.data, "live update") {
			t.Errorf("expected SSE event with 'live update', got %q", r.data)
		}
		if !strings.Contains(r.data, `"source":"mcp"`) {
			t.Errorf("expected source 'mcp' in SSE event, got %q", r.data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for SSE event")
	}
}
