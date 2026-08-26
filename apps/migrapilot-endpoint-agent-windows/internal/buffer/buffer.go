package buffer

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
)

type Store struct {
	path string
}

func New(dataDir string) Store {
	return Store{path: filepath.Join(dataDir, "events-buffer.jsonl")}
}

func (s Store) Append(events []model.Event) error {
	if len(events) == 0 {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(s.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	for _, event := range events {
		raw, marshalErr := json.Marshal(event)
		if marshalErr != nil {
			return marshalErr
		}
		if _, writeErr := w.Write(raw); writeErr != nil {
			return writeErr
		}
		if writeErr := w.WriteByte('\n'); writeErr != nil {
			return writeErr
		}
	}
	return w.Flush()
}

func (s Store) Read(limit int) ([]model.Event, error) {
	if limit <= 0 {
		limit = 100
	}
	f, err := os.Open(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var events []model.Event
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var event model.Event
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		events = append(events, event)
		if len(events) >= limit {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s Store) TruncateRemaining(remaining []model.Event) error {
	if len(remaining) == 0 {
		if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, event := range remaining {
		raw, marshalErr := json.Marshal(event)
		if marshalErr != nil {
			f.Close()
			return marshalErr
		}
		if _, writeErr := w.Write(raw); writeErr != nil {
			f.Close()
			return writeErr
		}
		if writeErr := w.WriteByte('\n'); writeErr != nil {
			f.Close()
			return writeErr
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
