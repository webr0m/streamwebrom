// Package tlsutil creates a persistent self-signed certificate so phones and
// other computers on the LAN can use the camera (browsers require HTTPS for
// getUserMedia everywhere except localhost).
package tlsutil

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// SelfSigned loads (or creates) dir/selfsigned.{crt,key} valid for localhost
// and every local interface address.
func SelfSigned(dir string) (tls.Certificate, error) {
	crt := filepath.Join(dir, "selfsigned.crt")
	key := filepath.Join(dir, "selfsigned.key")
	if c, err := tls.LoadX509KeyPair(crt, key); err == nil {
		if leaf, err := x509.ParseCertificate(c.Certificate[0]); err == nil && time.Until(leaf.NotAfter) > 7*24*time.Hour && coversLocal(leaf) {
			return c, nil
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return tls.Certificate{}, err
	}
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	tpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "StreamWebRom local", Organization: []string{"StreamWebRom"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(1, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  LocalIPs(),
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	kb, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(crt, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(key, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600); err != nil {
		return tls.Certificate{}, err
	}
	return tls.LoadX509KeyPair(crt, key)
}

func coversLocal(c *x509.Certificate) bool {
	for _, ip := range LocalIPs() {
		found := false
		for _, cip := range c.IPAddresses {
			if cip.Equal(ip) {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// LocalIPs returns loopback plus every up, non-link-local unicast address.
func LocalIPs() []net.IP {
	ips := []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && !n.IP.IsLinkLocalUnicast() {
				ips = append(ips, n.IP)
			}
		}
	}
	return ips
}

// LANURL guesses the best URL for other devices on the network.
func LANURL(scheme, port string) string {
	for _, ip := range LocalIPs() {
		if v4 := ip.To4(); v4 != nil && !v4.IsLoopback() && v4.IsPrivate() {
			return scheme + "://" + v4.String() + ":" + port
		}
	}
	return scheme + "://localhost:" + port
}
