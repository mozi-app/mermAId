package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// DiagramEvent is sent to SSE subscribers when the diagram changes.
type DiagramEvent struct {
	Content string `json:"content"`
	Source  string `json:"source"`
	Version int64  `json:"version"`
}

// DiagramState holds the current diagram text and broadcasts changes via SSE.
type DiagramState struct {
	mu      sync.RWMutex
	content string
	version int64

	subMu       sync.Mutex
	subscribers map[chan DiagramEvent]struct{}
}

// NewDiagramState creates a DiagramState with initial content.
func NewDiagramState(initial string) *DiagramState {
	return &DiagramState{
		content:     initial,
		version:     1,
		subscribers: make(map[chan DiagramEvent]struct{}),
	}
}

// Get returns the current diagram content and version.
func (d *DiagramState) Get() (string, int64) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.content, d.version
}

// Set updates the diagram content, bumps the version, and broadcasts to SSE subscribers.
func (d *DiagramState) Set(content, source string) int64 {
	d.mu.Lock()
	d.version++
	d.content = content
	v := d.version
	d.mu.Unlock()

	event := DiagramEvent{Content: content, Source: source, Version: v}

	d.subMu.Lock()
	for ch := range d.subscribers {
		select {
		case ch <- event:
		default:
			// Drop if subscriber is slow
		}
	}
	d.subMu.Unlock()

	return v
}

// Subscribe returns a channel that receives diagram change events.
func (d *DiagramState) Subscribe() chan DiagramEvent {
	ch := make(chan DiagramEvent, 16)
	d.subMu.Lock()
	d.subscribers[ch] = struct{}{}
	d.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel.
func (d *DiagramState) Unsubscribe(ch chan DiagramEvent) {
	d.subMu.Lock()
	delete(d.subscribers, ch)
	d.subMu.Unlock()
}

// handleGetDiagram returns the current diagram as JSON.
func (d *DiagramState) handleGetDiagram(w http.ResponseWriter, r *http.Request) {
	content, version := d.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"content": content,
		"version": version,
	})
}

// handleSetDiagram updates the diagram from a JSON body.
func (d *DiagramState) handleSetDiagram(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
		Source  string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Source == "" {
		req.Source = "api"
	}

	version := d.Set(req.Content, req.Source)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"version": version,
	})
}

// handleDiagramSSE streams diagram change events to the client.
func (d *DiagramState) handleDiagramSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush() // Send headers immediately

	ch := d.Subscribe()
	defer d.Unsubscribe(ch)

	for {
		select {
		case event := <-ch:
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
