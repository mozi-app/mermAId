package main

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// isMCPMode checks if --mcp was passed on the command line.
func isMCPMode() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--mcp" {
			return true
		}
	}
	return false
}

// MCP tool input/output types

type GetDiagramInput struct{}

type GetDiagramOutput struct {
	Content string `json:"content" jsonschema:"the current Mermaid diagram text"`
	Version int64  `json:"version" jsonschema:"the current version number"`
}

type SetDiagramInput struct {
	Content string `json:"content" jsonschema:"the complete Mermaid diagram text"`
}

type SetDiagramOutput struct {
	Success bool  `json:"success" jsonschema:"whether the update succeeded"`
	Version int64 `json:"version" jsonschema:"the new version number"`
}

// runMCP starts the HTTP server and the MCP stdio server.
// The HTTP server serves the editor UI and diagram API.
// The MCP server exposes tools for reading/writing the diagram via stdio.
func runMCP() {
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d", port)

	serverURL = url
	writeState(port)
	defer clearState()

	diagram = NewDiagramState("")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/diagram", diagram.handleGetDiagram)
	mux.HandleFunc("PUT /api/diagram", diagram.handleSetDiagram)
	mux.HandleFunc("GET /api/events", diagram.handleDiagramSSE)
	mux.HandleFunc("POST /api/download", handleDownload)
	mux.Handle("/", http.FileServer(http.FS(staticFS)))

	server = &http.Server{Handler: mux}

	fmt.Fprintf(os.Stderr, "MermAId Editor running at %s\n", url)

	go func() {
		if err := server.Serve(listener); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	defer func() {
		server.Close()
		fmt.Fprintln(os.Stderr, "Stopped.")
	}()

	// Create MCP server with tools that directly access diagram state
	s := mcp.NewServer(
		&mcp.Implementation{
			Name:    "mermaid-editor",
			Version: "1.0.0",
		},
		nil,
	)

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_diagram",
		Description: "Get the current Mermaid diagram text from the editor",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input GetDiagramInput) (*mcp.CallToolResult, GetDiagramOutput, error) {
		content, version := diagram.Get()
		return nil, GetDiagramOutput{Content: content, Version: version}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "set_diagram",
		Description: "Replace the entire Mermaid diagram in the editor. The change appears live in the browser.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input SetDiagramInput) (*mcp.CallToolResult, SetDiagramOutput, error) {
		version := diagram.Set(input.Content, "mcp")
		return nil, SetDiagramOutput{Success: true, Version: version}, nil
	})

	if err := s.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP server error: %v\n", err)
		os.Exit(1)
	}
}
