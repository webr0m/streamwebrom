// StreamWebRom for Windows: a native tray app that runs the Go server,
// shows the links you need for OBS and opens the studio. No console window,
// no installer, one .exe.
namespace StreamWebRom.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, "StreamWebRom.Launcher.SingleInstance", out var first);
        if (!first)
        {
            MessageBox.Show("StreamWebRom ya está abierto (revisa la bandeja del sistema).", "StreamWebRom",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(args));
    }
}
