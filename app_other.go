//go:build !darwin

package main

import (
	"context"
	"os/signal"
	"syscall"
)

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
