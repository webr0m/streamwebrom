using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StreamWebRom.Launcher;

public sealed class Settings
{
    public int Port { get; set; } = 8443;
    public bool Https { get; set; } = true;
    public int UdpPort { get; set; } = 50000;
    public string PublicIp { get; set; } = "";
    public bool AutoStart { get; set; } = true;

    /// <summary>Publish through a Cloudflare Tunnel (Cloudflare provides HTTPS).</summary>
    public bool TunnelEnabled { get; set; } = false;
    public string PublicHost { get; set; } = "";
    /// <summary>Tunnel token encrypted with Windows DPAPI (current user only).</summary>
    public string TunnelTokenProtected { get; set; } = "";

    [JsonIgnore]
    public string TunnelToken
    {
        get
        {
            if (string.IsNullOrEmpty(TunnelTokenProtected)) return "";
            try
            {
                var raw = ProtectedData.Unprotect(Convert.FromBase64String(TunnelTokenProtected), Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(raw);
            }
            catch { return ""; }
        }
        set
        {
            TunnelTokenProtected = string.IsNullOrWhiteSpace(value) ? "" :
                Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value.Trim()), Entropy, DataProtectionScope.CurrentUser));
        }
    }

    /// <summary>The server speaks plain HTTP behind the tunnel; HTTPS only when serving the LAN directly.</summary>
    [JsonIgnore]
    public bool ServeHttps => Https && !TunnelActive;

    [JsonIgnore]
    public bool TunnelActive => TunnelEnabled && !string.IsNullOrWhiteSpace(TunnelToken);

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("StreamWebRom.Tunnel.v1");
    private static string File => Path.Combine(ServerProcess.DataDir, "launcher.json");

    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(System.IO.File.ReadAllText(File)) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(ServerProcess.DataDir);
        System.IO.File.WriteAllText(File, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
