package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestMCPMode(t *testing.T) {
	Convey("Given the --mcp flag parser", t, func() {
		origArgs := os.Args
		defer func() { os.Args = origArgs }()

		Convey("It returns false without --mcp", func() {
			os.Args = []string{"mermaid-editor"}
			So(isMCPMode(), ShouldBeFalse)
		})

		Convey("It returns true with --mcp", func() {
			os.Args = []string{"mermaid-editor", "--mcp"}
			So(isMCPMode(), ShouldBeTrue)
		})

		Convey("It returns true with --mcp among other flags", func() {
			os.Args = []string{"mermaid-editor", "--other", "--mcp", "--flag"}
			So(isMCPMode(), ShouldBeTrue)
		})
	})
}

func TestMCPDiagramAccess(t *testing.T) {
	Convey("Given a DiagramState served over HTTP", t, func() {
		ds := NewDiagramState("sequenceDiagram\n  Alice->>Bob: Hi")

		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/diagram", ds.handleGetDiagram)
		mux.HandleFunc("PUT /api/diagram", ds.handleSetDiagram)
		ts := httptest.NewServer(mux)
		defer ts.Close()

		Convey("GET /api/diagram returns the content and version", func() {
			resp, err := http.Get(ts.URL + "/api/diagram")
			So(err, ShouldBeNil)
			defer resp.Body.Close()

			var out GetDiagramOutput
			err = json.NewDecoder(resp.Body).Decode(&out)
			So(err, ShouldBeNil)
			So(out.Content, ShouldEqual, "sequenceDiagram\n  Alice->>Bob: Hi")
			So(out.Version, ShouldEqual, int64(1))
		})

		Convey("PUT /api/diagram updates the content", func() {
			payload := `{"content": "sequenceDiagram\n  Bob->>Alice: Hello", "source": "mcp"}`
			req, _ := http.NewRequest("PUT", ts.URL+"/api/diagram", strings.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			So(err, ShouldBeNil)
			defer resp.Body.Close()

			var result struct {
				Version int64 `json:"version"`
			}
			json.NewDecoder(resp.Body).Decode(&result)
			So(result.Version, ShouldEqual, int64(2))

			content, _ := ds.Get()
			So(content, ShouldEqual, "sequenceDiagram\n  Bob->>Alice: Hello")
		})

		Convey("PUT /api/diagram triggers SSE broadcast", func() {
			ch := ds.Subscribe()
			defer ds.Unsubscribe(ch)

			payload := `{"content": "new diagram", "source": "mcp"}`
			req, _ := http.NewRequest("PUT", ts.URL+"/api/diagram", strings.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			http.DefaultClient.Do(req)

			event := <-ch
			So(event.Source, ShouldEqual, "mcp")
			So(event.Content, ShouldEqual, "new diagram")
		})
	})

	Convey("MCP tools access DiagramState directly", t, func() {
		ds := NewDiagramState("initial diagram")

		Convey("get_diagram reads the current state", func() {
			content, version := ds.Get()
			So(content, ShouldEqual, "initial diagram")
			So(version, ShouldEqual, int64(1))
		})

		Convey("set_diagram updates the state", func() {
			newVersion := ds.Set("sequenceDiagram\n  A->>B: updated", "mcp")
			So(newVersion, ShouldEqual, int64(2))

			content, version := ds.Get()
			So(content, ShouldEqual, "sequenceDiagram\n  A->>B: updated")
			So(version, ShouldEqual, int64(2))
		})
	})
}
