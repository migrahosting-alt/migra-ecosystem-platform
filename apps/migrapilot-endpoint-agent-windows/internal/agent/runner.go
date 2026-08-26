package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"log"
	"time"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/buffer"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/collector"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/config"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/executor"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/identity"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/transport"
)

type Runner struct {
	cfg       config.Config
	identity  identity.Store
	buffer    buffer.Store
	collector *collector.Collector
	client    *transport.Client
	executor  *executor.Executor
}

func NewRunner(cfg config.Config) (*Runner, error) {
	return &Runner{
		cfg:       cfg,
		identity:  identity.NewStore(cfg.DataDir),
		buffer:    buffer.New(cfg.DataDir),
		collector: collector.New(cfg.AgentHost),
		client:    transport.New(cfg.BaseURL, cfg.HTTPTimeout),
		executor:  executor.New(cfg.DataDir),
	}, nil
}

func (r *Runner) Run(ctx context.Context) error {
	id, err := r.identity.LoadOrCreate()
	if err != nil {
		return err
	}

	if id.AgentID == "" || id.Token == "" {
		agentID, token, err := r.client.Enroll(ctx, transport.EnrollmentRequest{
			Name:      r.cfg.AgentName,
			Host:      r.cfg.AgentHost,
			OS:        r.cfg.AgentOS,
			PublicKey: id.PrivateKey,
			EnrollKey: r.cfg.EnrollKey,
		})
		if err != nil {
			return err
		}
		id.AgentID = agentID
		id.Token = token
		if err := r.identity.Save(id); err != nil {
			return err
		}
		log.Printf("enrolled agent %s", id.AgentID)
	}

	collectTicker := time.NewTicker(r.cfg.CollectInterval)
	heartbeatTicker := time.NewTicker(r.cfg.HeartbeatEvery)
	defer collectTicker.Stop()
	defer heartbeatTicker.Stop()

	if err := r.collectAndShip(ctx, id); err != nil {
		log.Printf("initial collect/ship failed: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-collectTicker.C:
			if err := r.collectAndShip(ctx, id); err != nil {
				log.Printf("collect/ship failed: %v", err)
			}
		case <-heartbeatTicker.C:
			if err := r.heartbeat(ctx, id); err != nil {
				log.Printf("heartbeat failed: %v", err)
			}
			if err := r.processApprovedActions(ctx, id); err != nil {
				log.Printf("approved action processing failed: %v", err)
			}
		}
	}
}

func (r *Runner) collectAndShip(ctx context.Context, id model.Identity) error {
	events, err := r.collector.Collect(ctx)
	if err != nil {
		return err
	}

	for i := range events {
		events[i].AgentID = id.AgentID
		events[i].EventID = eventID(events[i])
	}

	if err := r.buffer.Append(events); err != nil {
		return err
	}

	queued, err := r.buffer.Read(r.cfg.MaxBatch)
	if err != nil {
		return err
	}
	if len(queued) == 0 {
		return nil
	}

	accepted, err := r.client.Ingest(ctx, id.Token, transport.IngestRequest{
		AgentID:     id.AgentID,
		Nonce:       nonce(),
		TimestampMS: time.Now().UnixMilli(),
		Events:      queued,
	})
	if err != nil {
		return err
	}

	if accepted < 0 {
		accepted = 0
	}
	if accepted > len(queued) {
		accepted = len(queued)
	}
	remaining := queued[accepted:]
	return r.buffer.TruncateRemaining(remaining)
}

func (r *Runner) heartbeat(ctx context.Context, id model.Identity) error {
	return r.client.Heartbeat(ctx, id.Token, transport.HeartbeatRequest{
		AgentID:     id.AgentID,
		Nonce:       nonce(),
		TimestampMS: time.Now().UnixMilli(),
		Status:      "healthy",
	})
}

func (r *Runner) processApprovedActions(ctx context.Context, id model.Identity) error {
	actions, err := r.client.ListApprovedActions(ctx, id.Token, id.AgentID)
	if err != nil {
		return err
	}
	for _, action := range actions {
		notes, execErr := r.executor.Execute(executor.Action{
			ActionID:   action.ActionID,
			Action:     action.Action,
			Objective:  action.Objective,
			Status:     action.Status,
			ApprovedAt: action.ApprovedAt,
		})
		if execErr != nil {
			notes = "execution error: " + execErr.Error()
		}
		if ackErr := r.client.AckAction(ctx, id.Token, action.ActionID, notes); ackErr != nil {
			log.Printf("ack action %s failed: %v", action.ActionID, ackErr)
		}
	}
	return nil
}

func nonce() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func eventID(event model.Event) string {
	return "evt_" + base64.RawURLEncoding.EncodeToString([]byte(event.Timestamp+"|"+event.Host+"|"+event.Indicator+"|"+event.Details))
}
