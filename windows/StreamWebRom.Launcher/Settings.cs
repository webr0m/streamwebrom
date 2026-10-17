using System.Text.Json;

namespace StreamWebRom.Launcher;

public sealed class Settings
{
    public int Port { get; set; } = 8443;
    public bool Https { get; set; } = true;
    public int UdpPort { get; set; } = 50000;
    public string PublicIp { get; set; } = "";
    public bool AutoStart { get; set; } = true;

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
