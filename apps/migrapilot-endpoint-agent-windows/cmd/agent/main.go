package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/agent"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load failed: %v", err)
	}

	runner, err := agent.NewRunner(cfg)
	if err != nil {
		log.Fatalf("agent init failed: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := runner.Run(ctx); err != nil {
		log.Fatalf("agent run failed: %v", err)
	}
}
