//go:build windows

package collector

import (
	"context"
	"encoding/xml"
	"os/exec"
	"strings"
	"time"

	"github.com/migrateck/migrapilot-endpoint-agent-windows/internal/model"
)

type Collector struct {
	host string
}

func New(host string) *Collector {
	return &Collector{host: host}
}

type eventRecord struct {
	System struct {
		EventID     int `xml:"EventID"`
		TimeCreated struct {
			SystemTime string `xml:"SystemTime,attr"`
		} `xml:"TimeCreated"`
		Channel string `xml:"Channel"`
	} `xml:"System"`
	EventData struct {
		Data []struct {
			Name  string `xml:"Name,attr"`
			Value string `xml:",chardata"`
		} `xml:"Data"`
	} `xml:"EventData"`
}

func (c *Collector) Collect(_ context.Context) ([]model.Event, error) {
	events := make([]model.Event, 0, 100)
	security, _ := readChannel("Security", 40)
	sysmon, _ := readChannel("Microsoft-Windows-Sysmon/Operational", 40)
	events = append(events, security...)
	events = append(events, sysmon...)

	for i := range events {
		events[i].Host = c.host
		if events[i].Classification == "" {
			events[i].Classification = "internal"
		}
	}
	return events, nil
}

func readChannel(channel string, count int) ([]model.Event, error) {
	query := "*[System[(Level=1 or Level=2 or Level=3)]]"
	cmd := exec.Command("wevtutil", "qe", channel, "/f:xml", "/q:"+query, "/c:"+itoa(count), "/rd:true")
	raw, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	wrapped := "<Events>" + string(raw) + "</Events>"
	var parsed struct {
		Events []eventRecord `xml:"Event"`
	}
	if err := xml.Unmarshal([]byte(wrapped), &parsed); err != nil {
		return nil, err
	}

	out := make([]model.Event, 0, len(parsed.Events))
	for _, row := range parsed.Events {
		indicator := "eventlog_" + channel + "_" + itoa(row.System.EventID)
		details := make([]string, 0, len(row.EventData.Data))
		for _, d := range row.EventData.Data {
			if strings.TrimSpace(d.Value) == "" {
				continue
			}
			details = append(details, d.Name+"="+strings.TrimSpace(d.Value))
		}

		severity := "info"
		if row.System.Channel == "Security" {
			severity = "warn"
		}
		if row.System.EventID == 4625 || row.System.EventID == 4672 || row.System.EventID == 4698 {
			severity = "critical"
		}

		ts := row.System.TimeCreated.SystemTime
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339Nano)
		}

		out = append(out, model.Event{
			Timestamp:      ts,
			Severity:       severity,
			Indicator:      indicator,
			Details:        strings.Join(details, " | "),
			Classification: "internal",
		})
	}
	return out, nil
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var digits [20]byte
	i := len(digits)
	for value > 0 {
		i--
		digits[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		digits[i] = '-'
	}
	return string(digits[i:])
}
