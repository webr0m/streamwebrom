package studio

import (
	"encoding/json"
	"errors"
	"math"
	"time"
)

// Only bounded numeric measurements are shared, never candidate addresses.
type NetworkInfo struct {
	BatteryPercent *float64 `json:"batteryPercent"`
	Charging       *bool    `json:"charging"`
	RTT            *float64 `json:"rtt"`
	Jitter         *float64 `json:"jitter"`
	RoomPing       *float64 `json:"roomPing"`
	Updated        int64    `json:"updated"`
}

func (h *Hub) latency(p *Peer, value json.RawMessage) error {
	if p.role() != RoleHost && p.role() != RoleGuest {
		return errors.New("only participants report latency")
	}
	if len(value) > 256 {
		return errors.New("latency report too large")
	}
	var metrics NetworkInfo
	if err := json.Unmarshal(value, &metrics); err != nil {
		return errors.New("invalid latency report")
	}
	for _, v := range []*float64{metrics.RTT, metrics.Jitter, metrics.RoomPing} {
		if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0) || *v < 0 || *v > 60000) {
			return errors.New("invalid latency measurement")
		}
	}
	if metrics.BatteryPercent != nil && (*metrics.BatteryPercent < 0 || *metrics.BatteryPercent > 100) {
		return errors.New("invalid battery level")
	}
	metrics.Updated = time.Now().UnixMilli()
	p.mu.Lock()
	if p.network != nil && metrics.Updated-p.network.Updated < 2000 {
		p.mu.Unlock()
		return nil
	}
	p.network = &metrics
	p.mu.Unlock()
	data, _ := json.Marshal(metrics)
	p.room.broadcast(Msg{Type: "latency", PeerID: p.ID, Value: data}, "")
	return nil
}
