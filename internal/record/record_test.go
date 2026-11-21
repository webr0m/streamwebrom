package record

import "testing"

func TestSafeName(t *testing.T) {
	for in, want := range map[string]string{"../../etc/passwd": "_etc_passwd", "cam-1": "cam-1", "": "x", "a b/c": "a_b_c"} {
		if got := SafeName(in); got != want {
			t.Errorf("SafeName(%q)=%q want %q", in, got, want)
		}
	}
}

func TestOldStreamCloseLeavesReplacementRecordingActive(t *testing.T) {
	r := New(t.TempDir(), "")
	const key = "room/cam"
	old := &Recording{Stream: "cam"}
	current := &Recording{Stream: "cam"}
	r.active[key] = current
	if rec, err := r.stop(key, old); rec != nil || err == nil {
		t.Fatalf("stale callback returned (%p, %v)", rec, err)
	}
	if rec, err := r.stop(key, current); rec != current || err != nil {
		t.Fatalf("current stream close returned (%p, %v)", rec, err)
	}
	if _, err := r.Stop("room", "cam"); err == nil {
		t.Fatal("recording remained active after its stream closed")
	}
}
