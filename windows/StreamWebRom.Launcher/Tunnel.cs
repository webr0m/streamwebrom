using System.Diagnostics;

namespace StreamWebRom.Launcher;

/// <summary>
/// Publishes the local server on a public hostname (e.g. https://stream.webrom.cc)
/// through a Cloudflare Tunnel. Cloudflare terminates TLS and proxies HTTP and
/// WebSockets to http://localhost:PORT; WebRTC media still flows over UDP straight
/// to this PC (forward the UDP media port on your router for best results).
/// </summary>
public sealed class Tunnel : IDisposable
{
    private const string DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    private Process? _proc;
    public event Action<string>? Output;
    public bool Running => _proc is { HasExited: false };

    public static string Exe => Path.Combine(ServerProcess.DataDir, "cloudflared.exe");

    public async Task EnsureCloudflaredAsync()
    {
        if (File.Exists(Exe)) return;
        foreach (var dir in new[] { AppContext.BaseDirectory })
        {
            var side = Path.Combine(dir, "cloudflared.exe");
            if (File.Exists(side)) { File.Copy(side, Exe, true); return; }
        }
        Output?.Invoke("Descargando cloudflared (una sola vez)…");
        Directory.CreateDirectory(ServerProcess.DataDir);
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("StreamWebRom-Launcher");
        var tmp = Exe + ".download";
        await using (var src = await http.GetStreamAsync(DownloadUrl))
        await using (var dst = File.Create(tmp))
            await src.CopyToAsync(dst);
        File.Move(tmp, Exe, true);
        Output?.Invoke("cloudflared listo.");
    }

    public async Task StartAsync(string token)
    {
        if (Running) return;
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("Falta el token del túnel de Cloudflare.");
        await EnsureCloudflaredAsync();
        var psi = new ProcessStartInfo(Exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = ServerProcess.DataDir,
        };
        foreach (var a in new[] { "tunnel", "--no-autoupdate", "run" }) psi.ArgumentList.Add(a);
        // Passed by environment, not argv, so it never shows up in process listings.
        psi.Environment["TUNNEL_TOKEN"] = token.Trim();
        _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _proc.OutputDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke("[túnel] " + e.Data); };
        _proc.ErrorDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke("[túnel] " + e.Data); };
        _proc.Start();
        _proc.BeginOutputReadLine();
        _proc.BeginErrorReadLine();
    }

    public void Stop()
    {
        var p = _proc;
        _proc = null;
        try { if (p is { HasExited: false }) { p.Kill(true); p.WaitForExit(3000); } } catch { }
        p?.Dispose();
    }

    public void Dispose() => Stop();
}
