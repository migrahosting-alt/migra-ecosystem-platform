package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
)

type Store struct {
	path string
}

func NewStore(dataDir string) Store {
	return Store{path: filepath.Join(dataDir, "identity.json")}
}

func (s Store) LoadOrCreate() (model.Identity, error) {
	if _, err := os.Stat(s.path); err == nil {
		raw, readErr := os.ReadFile(s.path)
		if readErr != nil {
			return model.Identity{}, readErr
		}
		var id model.Identity
		if unmarshalErr := json.Unmarshal(raw, &id); unmarshalErr != nil {
			return model.Identity{}, unmarshalErr
		}
		return id, nil
	}

	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return model.Identity{}, fmt.Errorf("generate key: %w", err)
	}

	id := model.Identity{
		PrivateKey: base64.StdEncoding.EncodeToString(private),
	}

	if err := s.save(id); err != nil {
		return model.Identity{}, err
	}
	return id, nil
}

func (s Store) Save(identity model.Identity) error {
	return s.save(identity)
}

func (s Store) save(identity model.Identity) error {
	raw, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0o600)
}
