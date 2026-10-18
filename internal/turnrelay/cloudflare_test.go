package turnrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCloudflareQuotaFailoverRevokesAndSurvivesRestart(t *testing.T) {
	used := uint64(25)
	fail := false
	issued, revoked := 0, 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/graphql" {
			if r.Header.Get("Authorization") != "Bearer analytics-read" {
				t.Error("wrong analytics token")
			}
			if fail {
				w.WriteHeader(503)
				return
			}
			fmt.Fprintf(w, `{"data":{"viewer":{"accounts":[{"callsTurnUsageAdaptiveGroups":[{"sum":{"egressBytes":%d}}]}]}},"errors":null}`, used)
			return
		}
		if r.Header.Get("Authorization") != "Bearer turn-private" {
			t.Error("wrong TURN token")
		}
		if strings.HasSuffix(r.URL.Path, "/revoke") {
			revoked++
			w.WriteHeader(204)
			return
		}
		issued++
		_ = json.NewEncoder(w).Encode(map[string]any{"iceServers": []any{map[string]any{"urls": []string{"turn:turn.cloudflare.com:3478?transport=tcp"}, "username": fmt.Sprint("user-", issued), "credential": "temporary"}}})
	}))
	defer api.Close()
	o := CloudflareOptions{AccountID: strings.Repeat("a", 32), KeyID: strings.Repeat("b", 32), KeyToken: "turn-private", AnalyticsToken: "analytics-read", BudgetBytes: 100, StateFile: filepath.Join(t.TempDir(), "quota.json"), rtcURL: api.URL, graphURL: api.URL + "/graphql"}
	c, err := NewCloudflare(o)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	ctx := context.Background()
	c.Check(ctx, now)
	if c.Status().Provider != "cloudflare" || len(c.ICE()) != 1 {
		t.Fatal(c.Status())
	}
	copy := c.ICE()
	copy[0].URLs[0] = "modified"
	if c.ICE()[0].URLs[0] == "modified" {
		t.Fatal("mutable credential cache")
	}
	used = 100
	if !c.Check(ctx, now.Add(time.Second)) || c.Status().Provider != "local" || len(c.ICE()) != 0 || revoked != 1 {
		t.Fatal(c.Status(), revoked)
	}
	// Reduced/sampled usage and a process restart may not undo a monthly cutoff.
	used = 0
	c, err = NewCloudflare(o)
	if err != nil {
		t.Fatal(err)
	}
	c.Check(ctx, now.Add(2*time.Second))
	if c.Status().Provider != "local" || issued != 1 {
		t.Fatal("monthly cutoff reset", c.Status())
	}
	next := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	c.Check(ctx, next)
	if c.Status().Provider != "cloudflare" || issued != 2 {
		t.Fatal("rollover did not resume", c.Status())
	}
	fail = true
	if !c.Check(ctx, next.Add(time.Second)) || c.Status().Reason != "analytics-unavailable" || revoked != 2 {
		t.Fatal("unknown usage did not fail closed", c.Status(), revoked)
	}
}

func TestCloudflareRestoredLeaseRevokedWhenAnalyticsFails(t *testing.T) {
	revoked := false
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/revoke") {
			revoked = true
			w.WriteHeader(204)
		} else {
			w.WriteHeader(503)
		}
	}))
	defer api.Close()
	o := CloudflareOptions{AccountID: strings.Repeat("a", 32), KeyID: strings.Repeat("b", 32), KeyToken: "private", AnalyticsToken: "read", BudgetBytes: 100, StateFile: filepath.Join(t.TempDir(), "quota.json"), rtcURL: api.URL, graphURL: api.URL}
	c, _ := NewCloudflare(o)
	c.state.Leases = []lease{{"issued-before-restart", time.Now().Add(time.Hour)}}
	if err := c.save(); err != nil {
		t.Fatal(err)
	}
	c, _ = NewCloudflare(o)
	c.Check(context.Background(), time.Now())
	if !revoked || c.Status().Provider != "local" {
		t.Fatal("restored credential not revoked")
	}
}
