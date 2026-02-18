package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

// useTestStateDir sets stateDirOverride to a temp directory for the duration
// of the test and returns the path.
func useTestStateDir(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
	stateDirOverride = tmp
	t.Cleanup(func() { stateDirOverride = "" })
	return tmp
}

func postDownload(form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/download", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	handleDownload(w, req)
	return w
}

func TestHandleDownload(t *testing.T) {
	Convey("Given the download handler", t, func() {
		Convey("Text data returns the correct headers and body", func() {
			svgData := `<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>`

			form := url.Values{}
			form.Set("filename", "diagram.svg")
			form.Set("content_type", "image/svg+xml")
			form.Set("data", svgData)

			w := postDownload(form)

			So(w.Code, ShouldEqual, http.StatusOK)
			So(w.Header().Get("Content-Disposition"), ShouldEqual, `attachment; filename="diagram.svg"`)
			So(w.Header().Get("Content-Length"), ShouldEqual, strconv.Itoa(len(svgData)))
			So(w.Body.String(), ShouldEqual, svgData)
		})

		Convey("Base64 data is decoded correctly", func() {
			raw := []byte{0x89, 0x50, 0x4E, 0x47}
			encoded := base64.StdEncoding.EncodeToString(raw)

			form := url.Values{}
			form.Set("filename", "diagram.png")
			form.Set("content_type", "image/png")
			form.Set("data", encoded)
			form.Set("encoding", "base64")

			w := postDownload(form)

			So(w.Code, ShouldEqual, http.StatusOK)
			So(w.Body.Bytes(), ShouldResemble, raw)
		})

		Convey("Missing filename returns 400", func() {
			form := url.Values{}
			form.Set("data", "some data")

			w := postDownload(form)
			So(w.Code, ShouldEqual, http.StatusBadRequest)
		})

		Convey("Missing data returns 400", func() {
			form := url.Values{}
			form.Set("filename", "diagram.svg")

			w := postDownload(form)
			So(w.Code, ShouldEqual, http.StatusBadRequest)
		})

		Convey("Invalid base64 returns 400", func() {
			form := url.Values{}
			form.Set("filename", "diagram.png")
			form.Set("data", "not-valid-base64!!!")
			form.Set("encoding", "base64")

			w := postDownload(form)
			So(w.Code, ShouldEqual, http.StatusBadRequest)
		})

		Convey("Omitting content_type uses application/octet-stream", func() {
			form := url.Values{}
			form.Set("filename", "data.bin")
			form.Set("data", "binary content")

			w := postDownload(form)

			So(w.Code, ShouldEqual, http.StatusOK)
			So(w.Header().Get("Content-Type"), ShouldEqual, "application/octet-stream")
		})
	})
}

func TestPreferences(t *testing.T) {
	Convey("Given the preferences handlers", t, func() {
		Convey("GET returns {} when no preferences file exists", func() {
			useTestStateDir(t)

			req := httptest.NewRequest("GET", "/api/preferences", nil)
			w := httptest.NewRecorder()
			handleGetPreferences(w, req)

			So(w.Code, ShouldEqual, http.StatusOK)
			So(w.Header().Get("Content-Type"), ShouldEqual, "application/json")
			So(strings.TrimSpace(w.Body.String()), ShouldEqual, "{}")
		})

		Convey("GET returns saved preferences", func() {
			tmp := useTestStateDir(t)
			os.MkdirAll(tmp, 0755)

			prefs := `{"vimMode":false,"editorWidth":400}`
			os.WriteFile(filepath.Join(tmp, "preferences.json"), []byte(prefs), 0644)

			req := httptest.NewRequest("GET", "/api/preferences", nil)
			w := httptest.NewRecorder()
			handleGetPreferences(w, req)

			So(w.Code, ShouldEqual, http.StatusOK)
			So(strings.TrimSpace(w.Body.String()), ShouldEqual, prefs)
		})

		Convey("PUT saves valid JSON and returns 204", func() {
			useTestStateDir(t)

			body := `{"vimMode":true,"theme":"dark"}`
			req := httptest.NewRequest("PUT", "/api/preferences", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			handleSetPreferences(w, req)

			So(w.Code, ShouldEqual, http.StatusNoContent)

			data, err := os.ReadFile(prefsFile())
			So(err, ShouldBeNil)

			var saved map[string]any
			json.Unmarshal(data, &saved)
			So(saved["vimMode"], ShouldEqual, true)
			So(saved["theme"], ShouldEqual, "dark")
		})

		Convey("PUT with invalid JSON returns 400", func() {
			useTestStateDir(t)

			req := httptest.NewRequest("PUT", "/api/preferences", strings.NewReader("not json"))
			w := httptest.NewRecorder()
			handleSetPreferences(w, req)

			So(w.Code, ShouldEqual, http.StatusBadRequest)
		})

		Convey("PUT creates the state directory if it doesn't exist", func() {
			tmp := t.TempDir()
			stateDirOverride = filepath.Join(tmp, "nested", "state")
			t.Cleanup(func() { stateDirOverride = "" })

			body := `{"key":"value"}`
			req := httptest.NewRequest("PUT", "/api/preferences", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			handleSetPreferences(w, req)

			So(w.Code, ShouldEqual, http.StatusNoContent)

			_, err := os.Stat(prefsFile())
			So(os.IsNotExist(err), ShouldBeFalse)
		})
	})
}

func TestStateFiles(t *testing.T) {
	Convey("Given a test state directory", t, func() {
		tmp := useTestStateDir(t)

		Convey("writeState creates pid and port files with correct content", func() {
			writeState(9876)

			pidData, err := os.ReadFile(filepath.Join(tmp, "pid"))
			So(err, ShouldBeNil)
			So(strings.TrimSpace(string(pidData)), ShouldEqual, strconv.Itoa(os.Getpid()))

			portData, err := os.ReadFile(filepath.Join(tmp, "port"))
			So(err, ShouldBeNil)
			So(strings.TrimSpace(string(portData)), ShouldEqual, "9876")
		})

		Convey("clearState removes pid and port files", func() {
			writeState(1234)
			clearState()

			_, err := os.Stat(pidFile())
			So(os.IsNotExist(err), ShouldBeTrue)

			_, err = os.Stat(portFile())
			So(os.IsNotExist(err), ShouldBeTrue)
		})

		Convey("checkExisting returns empty string when no state files exist", func() {
			So(checkExisting(), ShouldEqual, "")
		})

		Convey("checkExisting returns empty string for a stale PID", func() {
			os.MkdirAll(tmp, 0755)
			os.WriteFile(pidFile(), []byte("99999999"), 0644)
			os.WriteFile(portFile(), []byte("8080"), 0644)

			So(checkExisting(), ShouldEqual, "")
		})

		Convey("checkExisting returns the URL for an active process", func() {
			os.MkdirAll(tmp, 0755)
			os.WriteFile(pidFile(), []byte(strconv.Itoa(os.Getpid())), 0644)
			os.WriteFile(portFile(), []byte("4567"), 0644)

			So(checkExisting(), ShouldEqual, "http://127.0.0.1:4567")
		})
	})
}
