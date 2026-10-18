package config

import "testing"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDefaultsValid(t *testing.T) {
	c, err := Load(nil, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8443" || len(c.STUN) == 0 || c.TLSEnabled() {
		t.Fatalf("unexpected defaults %+v", c)
	}
}

func TestEnvAndFlags(t *testing.T) {
	c, err := Load([]string{"-addr", ":9000", "-turn", "turn:t.example:3478"}, env(map[string]string{"SWR_ADDR": ":7000", "SWR_MAX_PEERS": "12", "SWR_SELF_SIGNED": "true"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":9000" {
		t.Error("flag must override env")
	}
	if c.MaxPeers != 12 || !c.SelfSigned || !c.TLSEnabled() {
		t.Error("env not applied")
	}
	if len(c.TURN) != 1 {
		t.Error("turn list")
	}
}

func TestValidation(t *testing.T) {
	cases := [][]string{
		{"-tls-cert", "a.pem"},
		{"-self-signed", "-autocert", "x.com"},
		{"-udp-port", "70000"},
		{"-udp-min", "10"},
		{"-max-peers", "1"},
		{"-turn", "stun:x"},
		{"-max-msg", "10"},
		{"-udp-min", "-1", "-udp-max", "10"},
		{"-udp-min", "65536", "-udp-max", "65537"},
		{"-udp-port", "50000", "-udp-min", "50001", "-udp-max", "50002"},
		{"-room-ttl", "0"},
		{"-msg-rate", "NaN"},
		{"-msg-rate", "+Inf"},
		{"-public-ip", "example.com"},
		{"-public-url", "https://example.com/path"},
	}
	for _, args := range cases {
		if _, err := Load(args, env(nil)); err == nil {
			t.Errorf("%v should fail validation", args)
		}
	}
}

func TestMalformedEnvironmentFails(t *testing.T) {
	if _, err := Load(nil, env(map[string]string{"SWR_MAX_PEERS": "oops"})); err == nil {
		t.Fatal("invalid environment silently accepted")
	}
}
