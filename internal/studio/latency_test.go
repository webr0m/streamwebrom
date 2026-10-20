package studio

import (
	"context"
	"encoding/json"
	"testing"
)

func TestLatencyAndBatteryAreBoundedAndNeverTrustClientTimestamp(t *testing.T) {
	h, r, g, host := screenFixture(t)
	if err := h.latency(g, json.RawMessage(`{"rtt":84,"roomPing":100,"jitter":12,"batteryPercent":63,"charging":true,"updated":1}`)); err != nil {
		t.Fatal(err)
	}
	n := g.Info(nil).Network
	if n == nil || n.Updated == 1 || *n.RTT != 84 || *n.BatteryPercent != 63 || !*n.Charging {
		t.Fatalf("bad telemetry: %+v", n)
	}
	for _, value := range []string{`{"rtt":-1}`, `{"rtt":60001}`, `{"batteryPercent":101}`, `{"batteryPercent":-1}`, `{"charging":"yes"}`, `{"rtt":1e999}`, `[]`} {
		if h.latency(g, json.RawMessage(value)) == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	viewer := newPeer(nil, nil)
	viewer.Role = RoleViewer
	viewer.room = r
	if h.latency(viewer, json.RawMessage(`{}`)) == nil {
		t.Fatal("viewer could inject participant telemetry")
	}
	if err := h.handle(context.Background(), host, Msg{Type: "ping", ReqID: "latency-ping"}); err != nil {
		t.Fatal(err)
	}
	found := false
	for len(host.out) > 0 {
		var m Msg
		json.Unmarshal(<-host.out, &m)
		if m.Type == "pong" && m.ReqID == "latency-ping" {
			found = true
		}
	}
	if !found {
		t.Fatal("ping request was not correlated")
	}
}
