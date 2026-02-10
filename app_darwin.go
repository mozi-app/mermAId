//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

void runApp(void);
*/
import "C"

import "runtime"

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
	C.runApp()
}
