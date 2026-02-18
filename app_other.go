//go:build !darwin

package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func handleQuit(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
	go func() {
		shutdown()
		os.Exit(0)
	}()
}

func main() {
	if isMCPMode() {
		runMCP()
		return
	}
	if !startServer() {
		return
	}
	go openBrowser(serverURL)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	<-ctx.Done()

	shutdown()
}
