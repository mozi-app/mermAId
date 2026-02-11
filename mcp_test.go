package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestIsMCPMode(t *testing.T) {
	origArgs := os.Args
	defer func() { os.Args = origArgs }()

	os.Args = []string{"mermaid-editor"}
	if isMCPMode() {
		t.Error("expected false without --mcp flag")
	}

	os.Args = []string{"mermaid-editor", "--mcp"}
	if !isMCPMode() {
		t.Error("expected true with --mcp flag")
	}

	os.Args = []string{"mermaid-editor", "--other", "--mcp", "--flag"}
	if !isMCPMode() {
		t.Error("expected true with --mcp among other flags")
	}
}

func TestMCPGetDiagramViaHTTP(t *testing.T) {
	ds := NewDiagramState("sequenceDiagram\n  Alice->>Bob: Hi")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/diagram", ds.handleGetDiagram)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/diagram")
	if err != nil {
		t.Fatalf("failed to GET /api/diagram: %v", err)
	}
	defer resp.Body.Close()

	var out GetDiagramOutput
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if out.Content != "sequenceDiagram\n  Alice->>Bob: Hi" {
		t.Errorf("expected diagram content, got %q", out.Content)
	}
	if out.Version != 1 {
		t.Errorf("expected version 1, got %d", out.Version)
	}
}

func TestMCPSetDiagramViaHTTP(t *testing.T) {
	ds := NewDiagramState("old diagram")

	mux := http.NewServeMux()
	mux.HandleFunc("PUT /api/diagram", ds.handleSetDiagram)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	payload := `{"content": "sequenceDiagram\n  Bob->>Alice: Hello", "source": "mcp"}`
	req, _ := http.NewRequest("PUT", ts.URL+"/api/diagram", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("failed to PUT /api/diagram: %v", err)
	}
	defer resp.Body.Close()

	var result struct {
		Version int64 `json:"version"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if result.Version != 2 {
		t.Errorf("expected version 2, got %d", result.Version)
	}

	content, _ := ds.Get()
	if content != "sequenceDiagram\n  Bob->>Alice: Hello" {
		t.Errorf("expected updated content, got %q", content)
	}
}

func TestMCPSetDiagramBroadcastsSSE(t *testing.T) {
	ds := NewDiagramState("old")

	ch := ds.Subscribe()
	defer ds.Unsubscribe(ch)

	mux := http.NewServeMux()
	mux.HandleFunc("PUT /api/diagram", ds.handleSetDiagram)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	payload := `{"content": "new diagram", "source": "mcp"}`
	req, _ := http.NewRequest("PUT", ts.URL+"/api/diagram", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)

	event := <-ch
	if event.Source != "mcp" {
		t.Errorf("expected source 'mcp', got %q", event.Source)
	}
	if event.Content != "new diagram" {
		t.Errorf("expected 'new diagram', got %q", event.Content)
	}
}

func TestMCPDirectDiagramAccess(t *testing.T) {
	// Test the pattern used by MCP tool handlers: direct DiagramState access
	ds := NewDiagramState("initial diagram")

	// Simulate get_diagram tool
	content, version := ds.Get()
	if content != "initial diagram" {
		t.Errorf("expected 'initial diagram', got %q", content)
	}
	if version != 1 {
		t.Errorf("expected version 1, got %d", version)
	}

	// Simulate set_diagram tool
	newVersion := ds.Set("sequenceDiagram\n  A->>B: updated", "mcp")
	if newVersion != 2 {
		t.Errorf("expected version 2, got %d", newVersion)
	}

	content, version = ds.Get()
	if content != "sequenceDiagram\n  A->>B: updated" {
		t.Errorf("expected updated content, got %q", content)
	}
	if version != 2 {
		t.Errorf("expected version 2, got %d", version)
	}
}
