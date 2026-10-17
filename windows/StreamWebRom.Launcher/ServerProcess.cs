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
        if (!File.Exists(target) || new FileInfo(target).Length != res.Length)
        {
            var tmp = target + ".new";
            using (var f = File.Create(tmp)) res.CopyTo(f);
            File.Move(tmp, target, true);
        }
        return target;
    }

    public void Start(Settings s)
    {
        if (Running) return;
        var exe = ExtractServer();
        var args = new List<string> { "-addr", $":{s.Port}", "-data", Path.Combine(DataDir, "data") };
        if (s.Https) args.Add("-self-signed");
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
        _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _proc.OutputDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke(e.Data); };
        _proc.ErrorDataReceived += (_, e) => { if (e.Data != null) Output?.Invoke(e.Data); };
        _proc.Exited += (_, _) => Exited?.Invoke(_proc?.ExitCode ?? -1);
        _proc.Start();
        _proc.BeginOutputReadLine();
        _proc.BeginErrorReadLine();
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
        try { if (Running) { _proc!.Kill(true); _proc.WaitForExit(3000); } } catch { }
        _proc = null;
    }

    public void Dispose() => Stop();
}
