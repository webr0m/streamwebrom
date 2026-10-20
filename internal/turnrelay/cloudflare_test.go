package turnrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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
	fail = false
	c.Check(ctx, next.Add(2*time.Second))
	c.RecordMedia(40)
	if !c.Check(ctx, next.Add(3*time.Second)) || c.Status().Provider != "local" || revoked != 3 {
		t.Fatal("lagging analytics bypassed the local media guard")
	}
	estimate := c.state.EstimatedUsage
	c.RecordMedia(5000)
	c.Check(ctx, next.Add(4*time.Second))
	if c.state.EstimatedUsage != estimate {
		t.Fatal("local fallback traffic consumed the Cloudflare estimate")
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
	c.state.Month = time.Now().UTC().Format("2006-01")
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

func TestCloudflareInvalidQuotaKeepsStudioAvailableWithoutReset(t *testing.T) {
	for name, content := range map[string]string{
		"zeroed-after-restart": strings.Repeat("\x00", 568),
		"truncated":            `{"Month":"2026-10","Blocked":true`,
		"null":                 `null`,
		"empty-object":         `{}`,
		"invalid-month":        `{"Month":"2026-99"}`,
		"lost-estimate":        `{"Month":"2026-10","HighWater":100,"EstimatedUsage":0}`,
	} {
		t.Run(name, func(t *testing.T) {
			requests := 0
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				t.Error("invalid quota must not issue credentials or query/reset usage")
				w.WriteHeader(500)
			}))
			defer api.Close()
			path := filepath.Join(t.TempDir(), "quota.json")
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			o := CloudflareOptions{AccountID: strings.Repeat("a", 32), KeyID: strings.Repeat("b", 32), KeyToken: "private", AnalyticsToken: "read", BudgetBytes: 100, StateFile: path, rtcURL: api.URL, graphURL: api.URL}
			for restart := 0; restart < 2; restart++ {
				c, err := NewCloudflare(o)
				if err != nil {
					t.Fatal("quota corruption must not stop the server", err)
				}
				now := time.Now().UTC()
				c.Check(context.Background(), now)
				c.RecordMedia(500)
				c.Check(context.Background(), now.AddDate(0, 1, 0))
				if c.save() == nil {
					t.Fatal("corrupt state must not be overwritten")
				}
				if c.Status().Provider != "local" || c.Status().Reason != "state-unavailable" || len(c.ICE()) != 0 || c.active.Load() {
					t.Fatal("corrupt quota reenabled Cloudflare", c.Status())
				}
				got, err := os.ReadFile(path)
				if err != nil || string(got) != content || requests != 0 {
					t.Fatal("original quota was changed or Cloudflare contacted", err, requests)
				}
			}
		})
	}
}

func TestCloudflareUnreadableQuotaFallsBack(t *testing.T) {
	o := CloudflareOptions{AccountID: strings.Repeat("a", 32), KeyID: strings.Repeat("b", 32), KeyToken: "private", AnalyticsToken: "read", BudgetBytes: 100, StateFile: t.TempDir()}
	c, err := NewCloudflare(o)
	if err != nil {
		t.Fatal("unreadable quota must not stop the server", err)
	}
	c.Check(context.Background(), time.Now().UTC())
	if c.Status().Provider != "local" || c.Status().Reason != "state-unavailable" {
		t.Fatal(c.Status())
	}
}
