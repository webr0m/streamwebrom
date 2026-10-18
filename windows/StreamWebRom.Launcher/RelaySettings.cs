using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StreamWebRom.Launcher;

// Separate from launcher.json so applying ordinary network settings never
// overwrites provisioned relay credentials. Secrets use current-user DPAPI.
public sealed class RelaySettings
{
    public bool Enabled { get; set; }
    public bool CloudflareEnabled { get; set; }
    public string Listen { get; set; } = "0.0.0.0:3478";
    public string TcpAlternate { get; set; } = "";
    public string AdvertisedUrls { get; set; } = "";
    public string PublicIp { get; set; } = "";
    public int MinPort { get; set; } = 49160;
    public int MaxPort { get; set; } = 49223;
    public string LocalSecretProtected { get; set; } = "";
    public string CloudflareAccount { get; set; } = "";
    public string CloudflareTurnKeyId { get; set; } = "";
    public string CloudflareTurnKeyProtected { get; set; } = "";
    public string CloudflareAnalyticsTokenProtected { get; set; } = "";
    public ulong BudgetBytes { get; set; } = 900000000000;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("StreamWebRom.Tunnel.v1");
    private static string FileName => Path.Combine(ServerProcess.DataDir, "relay-credentials.json");
    public static RelaySettings Load()
    {
        if (!File.Exists(FileName)) return new();
        return JsonSerializer.Deserialize<RelaySettings>(File.ReadAllText(FileName)) ?? throw new InvalidDataException("Configuración TURN inválida");
    }
    public void Save()
    {
        Directory.CreateDirectory(ServerProcess.DataDir);
        var temp = FileName + ".new";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temp, FileName, true);
    }
    public static string Encrypt(string value) => Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value), Entropy, DataProtectionScope.CurrentUser));
    private static string Decrypt(string value) => string.IsNullOrEmpty(value) ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(value), Entropy, DataProtectionScope.CurrentUser));
    public void Apply(System.Diagnostics.ProcessStartInfo psi, int udpPort)
    {
        if (!Enabled) return;
        if (!System.Net.IPAddress.TryParse(PublicIp, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork || udpPort < 1)
            throw new InvalidDataException("TURN local requiere IP pública IPv4 y puerto UDP de medios fijo.");
        if (string.IsNullOrEmpty(LocalSecretProtected)) { LocalSecretProtected = Encrypt(Convert.ToHexString(RandomNumberGenerator.GetBytes(32))); Save(); }
        psi.Environment["SWR_RELAY_LISTEN"] = Listen;
        psi.Environment["SWR_RELAY_TCP_ALTERNATE"] = TcpAlternate;
        psi.Environment["SWR_RELAY_URLS"] = AdvertisedUrls;
        psi.Environment["SWR_RELAY_PUBLIC_IP"] = PublicIp;
        psi.Environment["SWR_RELAY_MIN"] = MinPort.ToString();
        psi.Environment["SWR_RELAY_MAX"] = MaxPort.ToString();
        psi.Environment["SWR_RELAY_SECRET"] = Decrypt(LocalSecretProtected);
        if (!CloudflareEnabled) return;
        if (string.IsNullOrWhiteSpace(CloudflareAccount) || string.IsNullOrWhiteSpace(CloudflareTurnKeyId) || string.IsNullOrWhiteSpace(CloudflareTurnKeyProtected) || string.IsNullOrWhiteSpace(CloudflareAnalyticsTokenProtected))
            throw new InvalidDataException("Completa los identificadores y ambos tokens de Cloudflare.");
        psi.Environment["SWR_CF_ACCOUNT"] = CloudflareAccount;
        psi.Environment["SWR_CF_TURN_KEY_ID"] = CloudflareTurnKeyId;
        psi.Environment["SWR_CF_TURN_KEY_TOKEN"] = Decrypt(CloudflareTurnKeyProtected);
        psi.Environment["SWR_CF_ANALYTICS_TOKEN"] = Decrypt(CloudflareAnalyticsTokenProtected);
        psi.Environment["SWR_CF_TURN_BUDGET"] = BudgetBytes.ToString();
    }
}
