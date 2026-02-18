package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"
)

func TestDiagramState(t *testing.T) {
	Convey("Given a new DiagramState", t, func() {
		ds := NewDiagramState("sequenceDiagram\n  Alice->>Bob: Hi")

		Convey("It has the initial content", func() {
			content, _ := ds.Get()
			So(content, ShouldEqual, "sequenceDiagram\n  Alice->>Bob: Hi")
		})

		Convey("It starts at version 1", func() {
			_, version := ds.Get()
			So(version, ShouldEqual, int64(1))
		})

		Convey("When Set is called", func() {
			v := ds.Set("updated", "browser")

			Convey("The version increments to 2", func() {
				So(v, ShouldEqual, int64(2))
			})

			Convey("Get returns the updated content", func() {
				content, _ := ds.Get()
				So(content, ShouldEqual, "updated")
			})

			Convey("Get returns the updated version", func() {
				_, version := ds.Get()
				So(version, ShouldEqual, int64(2))
			})
		})

		Convey("When Set is called with empty content", func() {
			v := ds.Set("", "api")

			Convey("The version still increments", func() {
				So(v, ShouldEqual, int64(2))
			})

			Convey("Get returns an empty string", func() {
				content, _ := ds.Get()
				So(content, ShouldEqual, "")
			})
		})

		Convey("Rapid sequential sets produce monotonic versions", func() {
			const n = 100
			for i := 1; i <= n; i++ {
				v := ds.Set(fmt.Sprintf("content-%d", i), "api")
				So(v, ShouldEqual, int64(i+1))
			}
			_, version := ds.Get()
			So(version, ShouldEqual, int64(n+1))
		})
	})
}

func TestDiagramStateBroadcasting(t *testing.T) {
	Convey("Given a DiagramState with a subscriber", t, func() {
		ds := NewDiagramState("initial")
		ch := ds.Subscribe()
		defer ds.Unsubscribe(ch)

		Convey("Set broadcasts the event to the subscriber", func() {
			ds.Set("new content", "mcp")

			select {
			case event := <-ch:
				So(event.Content, ShouldEqual, "new content")
				So(event.Source, ShouldEqual, "mcp")
				So(event.Version, ShouldEqual, int64(2))
			case <-time.After(time.Second):
				So("timeout", ShouldEqual, "event received")
			}
		})

		Convey("Set broadcasts to multiple subscribers", func() {
			ch2 := ds.Subscribe()
			defer ds.Unsubscribe(ch2)

			ds.Set("broadcast", "api")

			for _, c := range []chan DiagramEvent{ch, ch2} {
				select {
				case event := <-c:
					So(event.Content, ShouldEqual, "broadcast")
				case <-time.After(time.Second):
					So("timeout", ShouldEqual, "event received")
				}
			}
		})

		Convey("Setting identical content still increments version and broadcasts", func() {
			ds2 := NewDiagramState("same")
			ch2 := ds2.Subscribe()
			defer ds2.Unsubscribe(ch2)

			v := ds2.Set("same", "browser")
			So(v, ShouldEqual, int64(2))

			select {
			case event := <-ch2:
				So(event.Content, ShouldEqual, "same")
				So(event.Version, ShouldEqual, int64(2))
			case <-time.After(time.Second):
				So("timeout", ShouldEqual, "event received")
			}
		})

		Convey("When source is omitted from HTTP Set, it defaults to 'api'", func() {
			body := `{"content": "updated"}`
			req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader(body))
			w := httptest.NewRecorder()
			ds.handleSetDiagram(w, req)

			select {
			case event := <-ch:
				So(event.Source, ShouldEqual, "api")
			case <-time.After(time.Second):
				So("timeout", ShouldEqual, "event received")
			}
		})
	})

	Convey("Given an unsubscribed channel", t, func() {
		ds := NewDiagramState("initial")
		ch := ds.Subscribe()
		ds.Unsubscribe(ch)

		Convey("No events are received after unsubscribe", func() {
			ds.Set("after unsub", "browser")

			select {
			case <-ch:
				So("received event", ShouldEqual, "no event expected")
			case <-time.After(50 * time.Millisecond):
				So(true, ShouldBeTrue)
			}
		})
	})

	Convey("Given a slow subscriber whose buffer fills up", t, func() {
		ds := NewDiagramState("initial")
		ch := ds.Subscribe()
		defer ds.Unsubscribe(ch)

		Convey("Excess events are dropped without deadlocking", func() {
			for i := 0; i < 20; i++ {
				ds.Set(fmt.Sprintf("event-%d", i), "api")
			}

			drained := 0
			for {
				select {
				case <-ch:
					drained++
				default:
					goto done
				}
			}
		done:
			So(drained, ShouldBeGreaterThan, 0)
			So(drained, ShouldBeLessThanOrEqualTo, 16)
		})
	})
}

func TestDiagramStateConcurrency(t *testing.T) {
	Convey("Concurrent Sets produce the correct final version", t, func() {
		ds := NewDiagramState("initial")
		const goroutines = 50
		var wg sync.WaitGroup
		var maxVersion atomic.Int64

		wg.Add(goroutines)
		for i := 0; i < goroutines; i++ {
			go func(i int) {
				defer wg.Done()
				v := ds.Set(fmt.Sprintf("goroutine-%d", i), "api")
				for {
					cur := maxVersion.Load()
					if v <= cur || maxVersion.CompareAndSwap(cur, v) {
						break
					}
				}
			}(i)
		}
		wg.Wait()

		_, finalVersion := ds.Get()
		So(finalVersion, ShouldEqual, int64(goroutines+1))
	})

	Convey("Concurrent subscribe/unsubscribe during Set does not deadlock", t, func() {
		ds := NewDiagramState("initial")
		const goroutines = 50
		var wg sync.WaitGroup

		wg.Add(goroutines)
		for i := 0; i < goroutines/2; i++ {
			go func() {
				defer wg.Done()
				ch := ds.Subscribe()
				ds.Unsubscribe(ch)
			}()
		}
		for i := 0; i < goroutines/2; i++ {
			go func(i int) {
				defer wg.Done()
				ds.Set(fmt.Sprintf("concurrent-%d", i), "api")
			}(i)
		}

		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()

		select {
		case <-done:
			So(true, ShouldBeTrue)
		case <-time.After(5 * time.Second):
			So("deadlock", ShouldEqual, "completion")
		}
	})
}

func TestDiagramHTTPHandlers(t *testing.T) {
	Convey("Given a DiagramState", t, func() {
		ds := NewDiagramState("test diagram")

		Convey("GET /api/diagram returns the content and version as JSON", func() {
			req := httptest.NewRequest("GET", "/api/diagram", nil)
			w := httptest.NewRecorder()
			ds.handleGetDiagram(w, req)

			So(w.Code, ShouldEqual, http.StatusOK)

			var resp map[string]any
			err := json.NewDecoder(w.Body).Decode(&resp)
			So(err, ShouldBeNil)
			So(resp["content"], ShouldEqual, "test diagram")
			So(resp["version"], ShouldEqual, 1.0)
		})

		Convey("PUT /api/diagram updates the content", func() {
			body := `{"content": "new diagram", "source": "mcp"}`
			req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader(body))
			w := httptest.NewRecorder()
			ds.handleSetDiagram(w, req)

			So(w.Code, ShouldEqual, http.StatusOK)

			var resp map[string]any
			err := json.NewDecoder(w.Body).Decode(&resp)
			So(err, ShouldBeNil)
			So(resp["version"], ShouldEqual, 2.0)

			content, _ := ds.Get()
			So(content, ShouldEqual, "new diagram")
		})

		Convey("PUT /api/diagram with invalid JSON returns 400", func() {
			req := httptest.NewRequest("PUT", "/api/diagram", strings.NewReader("not json"))
			w := httptest.NewRecorder()
			ds.handleSetDiagram(w, req)

			So(w.Code, ShouldEqual, http.StatusBadRequest)
		})
	})
}

func TestDiagramSSE(t *testing.T) {
	Convey("Given an SSE endpoint backed by a DiagramState", t, func() {
		ds := NewDiagramState("initial")
		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/events", ds.handleDiagramSSE)
		ts := httptest.NewServer(mux)
		defer ts.Close()

		Convey("It streams events with the correct content type", func() {
			resp, err := http.Get(ts.URL + "/api/events")
			So(err, ShouldBeNil)
			defer resp.Body.Close()

			So(resp.Header.Get("Content-Type"), ShouldEqual, "text/event-stream")

			ds.Set("live update", "mcp")

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
				So(r.err, ShouldBeNil)
				So(r.data, ShouldContainSubstring, "live update")
				So(r.data, ShouldContainSubstring, `"source":"mcp"`)
			case <-time.After(2 * time.Second):
				So("timeout", ShouldEqual, "event received")
			}
		})

		Convey("Multiple clients each receive the event", func() {
			resp1, err := http.Get(ts.URL + "/api/events")
			So(err, ShouldBeNil)
			defer resp1.Body.Close()

			resp2, err := http.Get(ts.URL + "/api/events")
			So(err, ShouldBeNil)
			defer resp2.Body.Close()

			ds.Set("multi-client update", "mcp")

			for i, resp := range []*http.Response{resp1, resp2} {
				ch := make(chan string, 1)
				go func() {
					buf := make([]byte, 4096)
					n, _ := resp.Body.Read(buf)
					ch <- string(buf[:n])
				}()

				select {
				case data := <-ch:
					So(data, ShouldContainSubstring, "multi-client update")
				case <-time.After(2 * time.Second):
					So(fmt.Sprintf("client %d timeout", i+1), ShouldEqual, "event received")
				}
			}
		})

		Convey("Client disconnect does not cause a panic on subsequent Set", func() {
			ctx, cancel := context.WithCancel(context.Background())
			req, _ := http.NewRequestWithContext(ctx, "GET", ts.URL+"/api/events", nil)
			resp, err := http.DefaultClient.Do(req)
			So(err, ShouldBeNil)
			resp.Body.Close()
			cancel()

			// Setting after disconnect should not panic
			So(func() { ds.Set("after disconnect", "api") }, ShouldNotPanic)
		})
	})
}
