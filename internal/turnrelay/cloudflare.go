package turnrelay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
)

// CloudflareOptions keeps long-lived API tokens exclusively in the backend.
// BudgetBytes is a preventive TURN cutoff, not a Cloudflare billing cap.
type CloudflareOptions struct {
	AccountID      string
	KeyID          string
	KeyToken       string
	AnalyticsToken string
	StateFile      string
	BudgetBytes    uint64
	Client         *http.Client
	// Endpoints are injectable for deterministic API tests, never user input.
	rtcURL, graphURL string
}

type lease struct {
	User    string
	Expires time.Time
}
type quotaState struct {
	Month          string
	HighWater      uint64
	EstimatedUsage uint64
	Blocked        bool
	Leases         []lease
}
type RelayStatus struct {
	Provider    string    `json:"provider"`
	Reason      string    `json:"reason"`
	Month       string    `json:"month"`
	UsageBytes  uint64    `json:"usageBytes"`
	BudgetBytes uint64    `json:"budgetBytes"`
	CheckedAt   time.Time `json:"checkedAt"`
}
type Cloudflare struct {
	o         CloudflareOptions
	poll      sync.Mutex
	mu        sync.RWMutex
	state     quotaState
	status    RelayStatus
	ice       []webrtc.ICEServer
	refreshAt time.Time
	active    atomic.Bool
	traffic   atomic.Uint64
	// An unreadable quota must not reset a cutoff or take the studio offline.
	// Keep the original file untouched and use local TURN until it is repaired.
	stateUnavailable bool
}

// RecordMedia provides a conservative local guard while account analytics lag.
// Count both SFU directions with a 2x margin and 64 bytes per RTP packet for
// transport overhead. This is an estimate, never an authoritative bill.
func (c *Cloudflare) RecordMedia(n int) {
	if n > 0 && c.active.Load() {
		c.traffic.Add(2 * (uint64(n) + 64))
	}
}

var identifier = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)

func NewCloudflare(o CloudflareOptions) (*Cloudflare, error) {
	if !identifier.MatchString(o.AccountID) || !identifier.MatchString(o.KeyID) || o.KeyToken == "" || o.AnalyticsToken == "" || o.BudgetBytes == 0 {
		return nil, errors.New("Cloudflare TURN requires account/key IDs, both API tokens, and a positive budget")
	}
	if o.Client == nil {
		o.Client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	if o.rtcURL == "" {
		o.rtcURL = "https://rtc.live.cloudflare.com/v1/turn/keys/" + o.KeyID
	}
	if o.graphURL == "" {
		o.graphURL = "https://api.cloudflare.com/client/v4/graphql"
	}
	c := &Cloudflare{o: o, status: RelayStatus{Provider: "local", Reason: "checking", BudgetBytes: o.BudgetBytes}}
	if o.StateFile != "" {
		b, err := os.ReadFile(o.StateFile)
		if err == nil {
			var restored quotaState
			if err = json.Unmarshal(b, &restored); err != nil || !validQuotaState(restored) {
				c.stateUnavailable = true
			} else {
				c.state = restored
			}
		} else if !os.IsNotExist(err) {
			c.stateUnavailable = true
		}
	}
	if c.stateUnavailable {
		c.disable("state-unavailable")
		slog.Warn("TURN quota state unreadable or invalid; Cloudflare disabled, using local relay; original state preserved")
	}
	return c, nil
}

func validQuotaState(s quotaState) bool {
	month, err := time.Parse("2006-01", s.Month)
	return err == nil && month.Format("2006-01") == s.Month && s.EstimatedUsage >= s.HighWater
}

func (c *Cloudflare) Status() RelayStatus { c.mu.RLock(); defer c.mu.RUnlock(); return c.status }
func (c *Cloudflare) ICE() []webrtc.ICEServer {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.status.Provider != "cloudflare" || time.Since(c.status.CheckedAt) > 90*time.Second || c.state.Month != time.Now().UTC().Format("2006-01") {
		return nil
	}
	return cloneICE(c.ice)
}
func cloneICE(in []webrtc.ICEServer) []webrtc.ICEServer {
	out := append([]webrtc.ICEServer(nil), in...)
	for i := range out {
		out[i].URLs = append([]string(nil), out[i].URLs...)
	}
	return out
}

// Run is the sole writer. Readers never wait for an external API request.
// The caller performs one synchronous Check before accepting connections.
func (c *Cloudflare) Run(ctx context.Context, changed func()) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if c.Check(ctx, time.Now().UTC()) && changed != nil {
				changed()
			}
		}
	}
}

// Check switches to local on unknown usage or any API/persistence failure.
// Known credentials are revoked on fallback, including after process restart.
func (c *Cloudflare) Check(ctx context.Context, now time.Time) bool {
	c.poll.Lock()
	defer c.poll.Unlock()
	c.mu.RLock()
	w := &Cloudflare{o: c.o, state: c.state, status: c.status, ice: cloneICE(c.ice), refreshAt: c.refreshAt, stateUnavailable: c.stateUnavailable}
	w.state.Leases = append([]lease(nil), c.state.Leases...)
	c.mu.RUnlock()
	changed := w.check(ctx, now, c.traffic.Swap(0))
	c.mu.Lock()
	c.state = w.state
	c.status = w.status
	c.ice = w.ice
	c.refreshAt = w.refreshAt
	c.active.Store(c.status.Provider == "cloudflare")
	c.mu.Unlock()
	return changed
}
func (c *Cloudflare) check(ctx context.Context, now time.Time, traffic uint64) bool {
	previous := c.status.Provider
	month := now.UTC().Format("2006-01")
	if c.stateUnavailable {
		c.status.Month = month
		c.disable("state-unavailable")
		return previous == "cloudflare"
	}
	if c.state.Month != month {
		c.state.Month = month
		c.state.HighWater = 0
		c.state.EstimatedUsage = 0
		c.state.Blocked = false
	}
	c.status.Month = month
	used, err := c.usage(ctx, now)
	reason := "quota"
	if err != nil {
		reason = "analytics-unavailable"
	} else {
		if used > c.state.HighWater {
			c.state.HighWater = used
		}
		c.status.UsageBytes = c.state.HighWater
		c.status.CheckedAt = now
	}
	if c.state.EstimatedUsage < c.state.HighWater {
		c.state.EstimatedUsage = c.state.HighWater
	}
	if ^uint64(0)-c.state.EstimatedUsage < traffic {
		c.state.EstimatedUsage = ^uint64(0)
	} else {
		c.state.EstimatedUsage += traffic
	}
	if c.state.EstimatedUsage >= c.o.BudgetBytes {
		c.state.Blocked = true
	}
	if err != nil || c.state.Blocked {
		c.disable(reason)
		c.revoke(ctx, now)
		_ = c.save()
		return previous == "cloudflare"
	}
	rotated := false
	if len(c.ice) == 0 || !now.Before(c.refreshAt) {
		ice, e := c.credentials(ctx)
		if e != nil {
			c.disable("credentials-unavailable")
			c.revoke(ctx, now)
			_ = c.save()
			return previous == "cloudflare"
		}
		c.ice = ice
		c.refreshAt = now.Add(12 * time.Hour)
		rotated = true
		for _, s := range ice {
			if s.Username != "" {
				c.state.Leases = append(c.state.Leases, lease{s.Username, now.Add(24 * time.Hour)})
			}
		}
	}
	// Persist issued usernames before exposing credentials, so a restart can
	// still revoke allocations issued by the preceding process.
	active := c.state.Leases[:0]
	for _, l := range c.state.Leases {
		if l.Expires.After(now) {
			active = append(active, l)
		}
	}
	c.state.Leases = active
	if c.save() != nil {
		c.disable("state-unavailable")
		c.revoke(ctx, now)
		return previous == "cloudflare"
	}
	c.status.Provider = "cloudflare"
	c.status.Reason = "within-budget"
	return previous != "cloudflare" || rotated
}

func (c *Cloudflare) disable(reason string) {
	c.status.Provider = "local"
	c.status.Reason = reason
	c.ice = nil
	c.refreshAt = time.Time{}
}
func (c *Cloudflare) save() error {
	if c.stateUnavailable {
		return errors.New("TURN quota state unavailable; original file preserved")
	}
	if c.o.StateFile == "" {
		return nil
	}
	b, err := json.Marshal(c.state)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(c.o.StateFile), 0700); err != nil {
		return err
	}
	tmp := c.o.StateFile + ".new"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	if _, err = f.Write(b); err == nil {
		err = f.Sync() // flush contents before replacing the last valid state
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, c.o.StateFile)
}

func (c *Cloudflare) post(ctx context.Context, endpoint, token string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.o.Client.Do(req)
	if err != nil {
		return errors.New("Cloudflare request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Cloudflare HTTP %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
func (c *Cloudflare) usage(ctx context.Context, now time.Time) (uint64, error) {
	// Aggregate the entire account's TURN traffic, not just this app's key.
	query := fmt.Sprintf(`{viewer{accounts(filter:{accountTag:%q}){callsTurnUsageAdaptiveGroups(limit:1,filter:{date_geq:%q,date_leq:%q}){sum{egressBytes}}}}}`, c.o.AccountID, now.UTC().Format("2006-01")+"-01", now.UTC().Format("2006-01-02"))
	var response struct {
		Data struct {
			Viewer struct {
				Accounts []struct {
					Usage *[]struct {
						Sum struct {
							Egress *uint64 `json:"egressBytes"`
						}
					} `json:"callsTurnUsageAdaptiveGroups"`
				}
			}
		}
		Errors []json.RawMessage
	}
	if err := c.post(ctx, c.o.graphURL, c.o.AnalyticsToken, map[string]string{"query": query}, &response); err != nil {
		return 0, err
	}
	if len(response.Errors) > 0 || len(response.Data.Viewer.Accounts) != 1 {
		return 0, errors.New("Cloudflare analytics unavailable")
	}
	var total uint64
	usage := response.Data.Viewer.Accounts[0].Usage
	if usage == nil {
		return 0, errors.New("missing usage dataset")
	}
	for _, r := range *usage {
		if r.Sum.Egress == nil {
			return 0, errors.New("missing usage metric")
		}
		total += *r.Sum.Egress
	}
	return total, nil
}
func (c *Cloudflare) credentials(ctx context.Context) ([]webrtc.ICEServer, error) {
	var response struct {
		ICE []webrtc.ICEServer `json:"iceServers"`
	}
	if err := c.post(ctx, c.o.rtcURL+"/credentials/generate-ice-servers", c.o.KeyToken, map[string]int{"ttl": 86400}, &response); err != nil {
		return nil, err
	}
	var out []webrtc.ICEServer
	for _, s := range response.ICE {
		var urls []string
		for _, u := range s.URLs {
			if len(u) >= 5 && (u[:5] == "turn:" || (len(u) >= 6 && u[:6] == "turns:")) {
				urls = append(urls, u)
			}
		}
		if len(urls) > 0 && s.Username != "" && s.Credential != "" {
			s.URLs = urls
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("Cloudflare returned no TURN credentials")
	}
	return out, nil
}
func (c *Cloudflare) revoke(ctx context.Context, now time.Time) {
	pending := c.state.Leases[:0]
	for _, l := range c.state.Leases {
		if !l.Expires.After(now) {
			continue
		}
		if c.post(ctx, c.o.rtcURL+"/credentials/"+url.PathEscape(l.User)+"/revoke", c.o.KeyToken, map[string]any{}, nil) != nil {
			pending = append(pending, l)
		}
	}
	c.state.Leases = pending
}
