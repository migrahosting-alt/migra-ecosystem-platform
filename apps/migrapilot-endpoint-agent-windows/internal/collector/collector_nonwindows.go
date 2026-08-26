//go:build !windows

package collector

import (
	"context"
	"fmt"
	"time"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
)

type Collector struct {
	host string
}

func New(host string) *Collector {
	return &Collector{host: host}
}

func (c *Collector) Collect(_ context.Context) ([]model.Event, error) {
	now := time.Now().UTC()
	event := model.Event{
		Timestamp:      now.Format(time.RFC3339Nano),
		Host:           c.host,
		Severity:       "warn",
		Indicator:      "simulated_nonwindows_event",
		Details:        fmt.Sprintf("simulated event generated at %s", now.Format(time.RFC3339)),
		Classification: "internal",
	}
	return []model.Event{event}, nil
}
