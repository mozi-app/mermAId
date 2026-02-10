//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit

#include <stdlib.h>

void runApp(const char *url);
*/
import "C"

import (
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

func main() {
	if !startServer() {
		return
	}
	curl := C.CString(serverURL)
	defer C.free(unsafe.Pointer(curl))
	C.runApp(curl)
}
