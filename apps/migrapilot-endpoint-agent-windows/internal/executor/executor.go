package executor

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type Action struct {
	ActionID   string `json:"actionId"`
	Action     string `json:"action"`
	Objective  string `json:"objective"`
	Status     string `json:"status"`
	ApprovedAt string `json:"approvedAt,omitempty"`
}

type Executor struct {
	dataDir string
}

func New(dataDir string) *Executor {
	return &Executor{dataDir: dataDir}
}

func (e *Executor) Execute(action Action) (string, error) {
	if action.Status != "approved" {
		return "skipped: action not approved", nil
	}

	switch action.Action {
	case "Collect forensic snapshot", "collect-forensics":
		return e.collectForensics(action.ActionID)
	case "Isolate impacted host", "isolate-host":
		return "gated: isolate-host requires manual security operator execution", nil
	case "Block active indicators", "block-ioc":
		return "gated: block-ioc requires manual firewall approval", nil
	case "Rotate high-risk credentials", "rotate-credentials":
		return "gated: credential rotation requires identity owner approval", nil
	case "Escalate to incident command", "open-incident":
		return "ack: incident escalation flagged for SOC workflow", nil
	default:
		return "skipped: unsupported action", nil
	}
}

func (e *Executor) collectForensics(actionID string) (string, error) {
	evidenceDir := filepath.Join(e.dataDir, "evidence", time.Now().UTC().Format("20060102T150405Z"), actionID)
	if err := os.MkdirAll(evidenceDir, 0o755); err != nil {
		return "", err
	}

	if runtime.GOOS == "windows" {
		commands := [][]string{
			{"cmd", "/c", "tasklist > tasklist.txt"},
			{"cmd", "/c", "netstat -ano > netstat.txt"},
			{"cmd", "/c", "whoami /all > identity.txt"},
		}
		for _, args := range commands {
			cmd := exec.Command(args[0], args[1:]...)
			cmd.Dir = evidenceDir
			_ = cmd.Run()
		}
	} else {
		commands := [][]string{
			{"sh", "-lc", "ps aux > process.txt"},
			{"sh", "-lc", "netstat -tulpn > netstat.txt || ss -tulpn > netstat.txt"},
			{"sh", "-lc", "id > identity.txt"},
		}
		for _, args := range commands {
			cmd := exec.Command(args[0], args[1:]...)
			cmd.Dir = evidenceDir
			_ = cmd.Run()
		}
	}

	return fmt.Sprintf("forensics captured at %s", evidenceDir), nil
}
