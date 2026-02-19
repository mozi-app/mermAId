package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

//go:embed static
var staticFiles embed.FS

var server *http.Server
var serverURL string
var diagram *DiagramState

// stateDirOverride allows tests to redirect state files to a temp directory.
var stateDirOverride string

func stateDir() string {
	if stateDirOverride != "" {
		return stateDirOverride
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "mermaid-editor")
}

func pidFile() string   { return filepath.Join(stateDir(), "pid") }
func portFile() string  { return filepath.Join(stateDir(), "port") }
func prefsFile() string { return filepath.Join(stateDir(), "preferences.json") }

// checkExisting returns the URL of a running instance, or "" if none.
func checkExisting() string {
	pidBytes, err := os.ReadFile(pidFile())
	if err != nil {
		return ""
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil {
		return ""
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return ""
	}
	// Signal 0 checks if the process exists without killing it.
	if proc.Signal(syscall.Signal(0)) != nil {
		return ""
	}
	portBytes, err := os.ReadFile(portFile())
	if err != nil {
		return ""
	}
	port := strings.TrimSpace(string(portBytes))
	return fmt.Sprintf("http://127.0.0.1:%s", port)
}

func writeState(port int) {
	dir := stateDir()
	os.MkdirAll(dir, 0755)
	os.WriteFile(pidFile(), []byte(strconv.Itoa(os.Getpid())), 0644)
	os.WriteFile(portFile(), []byte(strconv.Itoa(port)), 0644)
}

func clearState() {
	os.Remove(pidFile())
	os.Remove(portFile())
}

// fileArg returns the first non-flag argument from the command line, or "".
func fileArg() string {
	for _, arg := range os.Args[1:] {
		if !strings.HasPrefix(arg, "-") {
			return arg
		}
	}
	return ""
}

// activateExisting brings a running instance to the foreground. It tries the
// /api/focus endpoint first (which activates the native macOS window) and falls
// back to opening the URL in the default browser.
func activateExisting(baseURL string) {
	resp, err := http.Post(baseURL+"/api/focus", "", nil)
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode == http.StatusNoContent {
			return
		}
	}
	openBrowser(baseURL)
}

// pushDiagram sends diagram content to a running editor instance via HTTP PUT.
func pushDiagram(baseURL, content string) {
	body, _ := json.Marshal(map[string]string{
		"content": content,
		"source":  "cli",
	})
	req, err := http.NewRequest("PUT", baseURL+"/api/diagram", bytes.NewReader(body))
	if err != nil {
		log.Printf("Failed to push diagram: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Failed to push diagram: %v", err)
		return
	}
	resp.Body.Close()
}

// startServer checks for an existing instance, starts the HTTP server in a
// background goroutine, and opens the browser. Returns false if an existing
// instance was found (browser opened to it, nothing more to do).
func startServer() bool {
	var initialContent string
	if f := fileArg(); f != "" {
		data, err := os.ReadFile(f)
		if err != nil {
			log.Fatalf("Cannot read %s: %v", f, err)
		}
		initialContent = string(data)
	}

	if url := checkExisting(); url != "" {
		fmt.Printf("Already running at %s\n", url)
		if initialContent != "" {
			pushDiagram(url, initialContent)
		}
		activateExisting(url)
		return false
	}

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

	diagram = NewDiagramState(initialContent)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/diagram", diagram.handleGetDiagram)
	mux.HandleFunc("PUT /api/diagram", diagram.handleSetDiagram)
	mux.HandleFunc("GET /api/events", diagram.handleDiagramSSE)
	mux.HandleFunc("POST /api/download", handleDownload)
	mux.HandleFunc("GET /api/preferences", handleGetPreferences)
	mux.HandleFunc("PUT /api/preferences", handleSetPreferences)
	mux.HandleFunc("POST /api/focus", handleFocus)
	mux.HandleFunc("POST /api/quit", handleQuit)
	mux.Handle("/", http.FileServer(http.FS(staticFS)))

	server = &http.Server{Handler: mux}

	fmt.Printf("MermAId Editor running at %s\n", url)

	go func() {
		if err := server.Serve(listener); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	return true
}

func handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(prefsFile())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func handleSetPreferences(w http.ResponseWriter, r *http.Request) {
	var prefs map[string]any
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	data, _ := json.Marshal(prefs)
	os.MkdirAll(stateDir(), 0755)
	if err := os.WriteFile(prefsFile(), data, 0644); err != nil {
		http.Error(w, "failed to save preferences", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	filename := r.FormValue("filename")
	contentType := r.FormValue("content_type")
	data := r.FormValue("data")
	encoding := r.FormValue("encoding")

	if filename == "" || data == "" {
		http.Error(w, "missing filename or data", http.StatusBadRequest)
		return
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	var body []byte
	if encoding == "base64" {
		var err error
		body, err = base64.StdEncoding.DecodeString(data)
		if err != nil {
			http.Error(w, "invalid base64 data", http.StatusBadRequest)
			return
		}
	} else {
		body = []byte(data)
	}

	log.Printf("download: filename=%s size=%d bytes", filename, len(body))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Write(body)
}

func shutdown() {
	if server != nil {
		server.Close()
	}
	clearState()
	fmt.Println("Stopped.")
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	}
	if cmd != nil {
		_ = cmd.Start()
	}
}
