using System.Diagnostics;
using System.Reflection;

namespace StreamWebRom.Launcher;

/// <summary>Extracts the embedded Go server and supervises it.</summary>
public sealed class ServerProcess : IDisposable
{
    private Process? _proc;
    public event Action<string>? Output;
    public event Action<int>? Exited;

    public static string DataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamWebRom");

    public bool Running => _proc is { HasExited: false };

    public static string ExtractServer()
    {
        Directory.CreateDirectory(DataDir);
        var target = Path.Combine(DataDir, "streamwebrom.exe");
        using var res = Assembly.GetExecutingAssembly().GetManifestResourceStream("streamwebrom.exe");
        if (res is null)
        {
            // Development build: look next to the launcher.
            var side = Path.Combine(AppContext.BaseDirectory, "streamwebrom.exe");
            if (File.Exists(side)) return side;
            throw new FileNotFoundException("streamwebrom.exe no está incluido en este build.");
        }
        // Only rewrite when the embedded binary changed (keeps Windows Firewall rule valid).
        // Compare content, not just size: two builds can have the same length.
        if (!File.Exists(target) || new FileInfo(target).Length != res.Length || !SameHash(res, target))
        {
            res.Position = 0;
            var tmp = target + ".new";
            using (var f = File.Create(tmp)) res.CopyTo(f);
            File.Move(tmp, target, true);
        }
        return target;
    }

    private static bool SameHash(Stream res, string file)
    {
        try
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            res.Position = 0;
            var h1 = sha.ComputeHash(res);
            using var f = File.OpenRead(file);
            return h1.AsSpan().SequenceEqual(sha.ComputeHash(f));
        }
        catch { return false; }
    }

    public void Start(Settings s)
    {
        if (Running) return;
        var exe = ExtractServer();
        var args = new List<string> { "-addr", $":{s.Port}", "-data", Path.Combine(DataDir, "data") };
        if (s.ServeHttps) args.Add("-self-signed");
        if (s.TunnelActive && !string.IsNullOrWhiteSpace(s.PublicHost)) { args.Add("-public-url"); args.Add("https://" + s.PublicHost.Trim()); }
        if (s.UdpPort > 0) { args.Add("-udp-port"); args.Add(s.UdpPort.ToString()); }
        if (!string.IsNullOrWhiteSpace(s.PublicIp)) { args.Add("-public-ip"); args.Add(s.PublicIp.Trim()); }
        var ffmpeg = FindFfmpeg();
        if (ffmpeg != null) { args.Add("-ffmpeg"); args.Add(ffmpeg); }

        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = DataDir,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // Keep TURN credentials out of the process command line and logs.
        // Blank launcher fields retain explicitly configured SWR_TURN env vars.
        if (!string.IsNullOrWhiteSpace(s.TurnUrls))
        {
            psi.Environment["SWR_TURN"] = s.TurnUrls.Trim();
            psi.Environment["SWR_TURN_USER"] = s.TurnUser;
            psi.Environment["SWR_TURN_PASS"] = s.TurnPassword;
        }
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke(e.Data); };
        // Report only unexpected exits of the *current* process. Before, killing the
        // old server in "Aplicar y reiniciar" fired Exited after the new one had
        // started, so the window showed "detenido" while the server was running.
        proc.Exited += (_, _) =>
        {
            if (!ReferenceEquals(_proc, proc)) return;
            int code; try { code = proc.ExitCode; } catch { code = -1; }
            Exited?.Invoke(code);
        };
        _proc = proc;
        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
    }

    public static string? FindFfmpeg()
    {
        foreach (var dir in new[] { AppContext.BaseDirectory, DataDir })
        {
            var p = Path.Combine(dir, "ffmpeg.exe");
            if (File.Exists(p)) return p;
        }
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var d in path.Split(Path.PathSeparator))
        {
            try { var p = Path.Combine(d.Trim(), "ffmpeg.exe"); if (File.Exists(p)) return p; } catch { }
        }
        return null;
    }

    public void Stop()
    {
        var p = _proc;
        _proc = null; // first, so its Exited event is recognised as intentional
        try { if (p is { HasExited: false }) { p.Kill(true); p.WaitForExit(3000); } } catch { }
        p?.Dispose();
    }

    public void Dispose() => Stop();
}
