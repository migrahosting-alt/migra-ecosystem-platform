package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type EnrollmentRequest struct {
	Name      string `json:"name"`
	Host      string `json:"host"`
	OS        string `json:"os"`
	PublicKey string `json:"publicKey,omitempty"`
	EnrollKey string `json:"enrollKey,omitempty"`
}

type enrollmentResponse struct {
	OK   bool `json:"ok"`
	Data struct {
		AgentID string `json:"agentId"`
		Token   string `json:"token"`
	} `json:"data"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

type IngestRequest struct {
	AgentID     string        `json:"agentId"`
	Nonce       string        `json:"nonce"`
	TimestampMS int64         `json:"timestampMs"`
	Events      []model.Event `json:"events"`
}

type ingestResponse struct {
	OK   bool `json:"ok"`
	Data struct {
		Accepted int `json:"accepted"`
	} `json:"data"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

type HeartbeatRequest struct {
	AgentID     string `json:"agentId"`
	Nonce       string `json:"nonce"`
	TimestampMS int64  `json:"timestampMs"`
	Status      string `json:"status"`
}

type ActionRecord struct {
	ActionID   string `json:"actionId"`
	Action     string `json:"action"`
	Objective  string `json:"objective"`
	Status     string `json:"status"`
	ApprovedAt string `json:"approvedAt,omitempty"`
}

func New(baseURL string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		http: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) Enroll(ctx context.Context, request EnrollmentRequest) (agentID, token string, err error) {
	var response enrollmentResponse
	if err := c.postJSON(ctx, "/api/autonomy/hids-edr/enroll", request, "", &response); err != nil {
		return "", "", err
	}
	if !response.OK || response.Data.AgentID == "" || response.Data.Token == "" {
		return "", "", fmt.Errorf("enroll failed: %s", response.Error.Message)
	}
	return response.Data.AgentID, response.Data.Token, nil
}

func (c *Client) Ingest(ctx context.Context, token string, request IngestRequest) (int, error) {
	var response ingestResponse
	if err := c.postJSON(ctx, "/api/autonomy/hids-edr", request, token, &response); err != nil {
		return 0, err
	}
	if !response.OK {
		return 0, fmt.Errorf("ingest failed: %s", response.Error.Message)
	}
	return response.Data.Accepted, nil
}

func (c *Client) Heartbeat(ctx context.Context, token string, request HeartbeatRequest) error {
	var response map[string]any
	if err := c.postJSON(ctx, "/api/autonomy/hids-edr/heartbeat", request, token, &response); err != nil {
		return err
	}
	ok, _ := response["ok"].(bool)
	if !ok {
		if errObj, cast := response["error"].(map[string]any); cast {
			if message, cast := errObj["message"].(string); cast {
				return fmt.Errorf("heartbeat failed: %s", message)
			}
		}
		return fmt.Errorf("heartbeat failed")
	}
	return nil
}

func (c *Client) ListApprovedActions(ctx context.Context, token, agentID string) ([]ActionRecord, error) {
	url := fmt.Sprintf("%s/api/autonomy/hids-edr/actions?agentId=%s&status=approved&limit=50", c.baseURL, agentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Bearer "+token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("http %d from actions list", resp.StatusCode)
	}

	var payload struct {
		OK   bool `json:"ok"`
		Data struct {
			Actions []ActionRecord `json:"actions"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if !payload.OK {
		return nil, fmt.Errorf("actions list failed")
	}
	return payload.Data.Actions, nil
}

func (c *Client) AckAction(ctx context.Context, token, actionID, notes string) error {
	body := map[string]any{
		"mode":           "ack",
		"actionId":       actionID,
		"executionNotes": notes,
	}
	var response map[string]any
	if err := c.postJSON(ctx, "/api/autonomy/hids-edr/actions", body, token, &response); err != nil {
		return err
	}
	if ok, _ := response["ok"].(bool); !ok {
		return fmt.Errorf("action ack failed")
	}
	return nil
}

func (c *Client) postJSON(ctx context.Context, path string, payload any, token string, into any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if token != "" {
		req.Header.Set("authorization", "Bearer "+token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var serverErr map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&serverErr)
		return fmt.Errorf("http %d from %s", resp.StatusCode, path)
	}
	return json.NewDecoder(resp.Body).Decode(into)
}
