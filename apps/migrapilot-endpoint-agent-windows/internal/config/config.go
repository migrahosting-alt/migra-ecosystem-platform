package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

type Config struct {
	BaseURL         string
	AgentName       string
	AgentHost       string
	AgentOS         string
	DataDir         string
	EnrollKey       string
	CollectInterval time.Duration
	HeartbeatEvery  time.Duration
	MaxBatch        int
	HTTPTimeout     time.Duration
}

func Load() (Config, error) {
	baseURL := envOr("MIGRAPILOT_BASE_URL", "http://127.0.0.1:3401")
	agentName := envOr("MIGRAPILOT_AGENT_NAME", "windows-endpoint-agent")
	agentHost := envOr("MIGRAPILOT_AGENT_HOST", "localhost")
	agentOS := envOr("MIGRAPILOT_AGENT_OS", runtime.GOOS)
	dataDir := envOr("MIGRAPILOT_AGENT_DATA_DIR", "./data")
	enrollKey := envOr("MIGRAPILOT_ENROLL_KEY", "")

	collectSecs := intEnvOr("MIGRAPILOT_COLLECT_SECS", 30)
	heartbeatSecs := intEnvOr("MIGRAPILOT_HEARTBEAT_SECS", 20)
	maxBatch := intEnvOr("MIGRAPILOT_MAX_BATCH", 100)
	httpTimeoutSecs := intEnvOr("MIGRAPILOT_HTTP_TIMEOUT_SECS", 15)

	if maxBatch <= 0 {
		return Config{}, fmt.Errorf("MIGRAPILOT_MAX_BATCH must be > 0")
	}

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("create data dir: %w", err)
	}

	absDir, err := filepath.Abs(dataDir)
	if err != nil {
		return Config{}, fmt.Errorf("resolve data dir: %w", err)
	}

	return Config{
		BaseURL:         baseURL,
		AgentName:       agentName,
		AgentHost:       agentHost,
		AgentOS:         agentOS,
		DataDir:         absDir,
		EnrollKey:       enrollKey,
		CollectInterval: time.Duration(collectSecs) * time.Second,
		HeartbeatEvery:  time.Duration(heartbeatSecs) * time.Second,
		MaxBatch:        maxBatch,
		HTTPTimeout:     time.Duration(httpTimeoutSecs) * time.Second,
	}, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func intEnvOr(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return parsed
}
