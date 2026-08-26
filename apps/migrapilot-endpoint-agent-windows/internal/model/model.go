package model

type Event struct {
	EventID        string `json:"eventId"`
	AgentID        string `json:"agentId,omitempty"`
	Timestamp      string `json:"ts"`
	Host           string `json:"host"`
	Severity       string `json:"severity"`
	Indicator      string `json:"indicator"`
	Details        string `json:"details"`
	Classification string `json:"classification,omitempty"`
	TenantID       string `json:"tenantId,omitempty"`
}

type Identity struct {
	AgentID    string `json:"agentId"`
	Token      string `json:"token"`
	PrivateKey string `json:"privateKey"`
}
