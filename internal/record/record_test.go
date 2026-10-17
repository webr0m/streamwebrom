package record

import "testing"

func TestSafeName(t *testing.T) {
	for in, want := range map[string]string{"../../etc/passwd": "_etc_passwd", "cam-1": "cam-1", "": "x", "a b/c": "a_b_c"} {
		if got := SafeName(in); got != want {
			t.Errorf("SafeName(%q)=%q want %q", in, got, want)
		}
	}
}
