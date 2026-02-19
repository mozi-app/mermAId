//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit

#include <stdlib.h>

void runApp(const char *url);
void terminateApp(void);
void focusApp(void);
*/
import "C"

import (
	"net/http"
	"runtime"
	"unsafe"
)

func init() {
	runtime.LockOSThread()
}

//export goShutdown
func goShutdown() {
	shutdown()
}

//export goOpenBrowser
func goOpenBrowser() {
	go openBrowser(serverURL)
}

func handleFocus(w http.ResponseWriter, r *http.Request) {
	C.focusApp()
	w.WriteHeader(http.StatusNoContent)
}

func handleQuit(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
	C.terminateApp()
}

func main() {
	if isMCPMode() {
		runMCP()
		return
	}
	if !startServer() {
		return
	}
	curl := C.CString(serverURL)
	defer C.free(unsafe.Pointer(curl))
	C.runApp(curl)
}
