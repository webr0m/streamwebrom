using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace StreamWebRom.Launcher;

public sealed class MainForm : Form
{
    private readonly ServerProcess _server = new();
    private readonly Settings _settings = Settings.Load();
    private readonly NotifyIcon _tray;
    private readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold) };
    private readonly TextBox _log = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BackColor = Color.FromArgb(15, 15, 24), ForeColor = Color.Gainsboro, BorderStyle = BorderStyle.None, Font = new Font("Consolas", 9) };
    private readonly TextBox _localUrl = Ro(), _lanUrl = Ro();
    private readonly Button _startStop = Btn("Detener");
    private readonly NumericUpDown _port = new() { Minimum = 1024, Maximum = 65535, Width = 90 };
    private readonly NumericUpDown _udp = new() { Minimum = 0, Maximum = 65535, Width = 90 };
    private readonly CheckBox _https = new() { Text = "HTTPS (necesario para cámaras de otros equipos/teléfonos)", AutoSize = true, ForeColor = Color.Gainsboro };
    private readonly TextBox _pubIp = new() { Width = 160, PlaceholderText = "opcional" };
    private bool _quitting;

    private static readonly Color Bg = Color.FromArgb(11, 11, 18), Panel = Color.FromArgb(19, 19, 29), Accent = Color.FromArgb(124, 92, 255);

    public MainForm(string[] args)
    {
        Text = "StreamWebRom";
        Width = 760; Height = 600; MinimumSize = new Size(640, 480);
        BackColor = Bg; ForeColor = Color.White; Font = new Font("Segoe UI", 9.5f);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        _port.Value = _settings.Port; _udp.Value = _settings.UdpPort; _https.Checked = _settings.Https; _pubIp.Text = _settings.PublicIp;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), RowCount = 5, ColumnCount = 1, BackColor = Bg };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var header = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, WrapContents = false };
        header.Controls.Add(new Label { Text = "StreamWebRom", AutoSize = true, Font = new Font("Segoe UI", 18, FontStyle.Bold), Margin = new Padding(0, 0, 16, 0) });
        header.Controls.Add(_status);
        root.Controls.Add(header);

        var urls = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 3, BackColor = Panel, Padding = new Padding(10) };
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        AddUrlRow(urls, "Este equipo", _localUrl);
        AddUrlRow(urls, "Tu red (teléfonos, otros PCs)", _lanUrl);
        root.Controls.Add(urls);

        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(0, 10, 0, 10) };
        var open = Btn("Abrir estudio", true);
        open.Click += (_, _) => OpenUrl(_localUrl.Text);
        var folder = Btn("Grabaciones");
        folder.Click += (_, _) => { var d = Path.Combine(ServerProcess.DataDir, "data", "recordings"); Directory.CreateDirectory(d); Process.Start("explorer.exe", d); };
        var obsHelp = Btn("Cómo usar con OBS");
        obsHelp.Click += (_, _) => MessageBox.Show(
            "1. Abre el estudio y crea tu programa.\n" +
            "2. Pestaña OBS → copia “Programa completo”.\n" +
            "3. En OBS: Fuentes → + → Navegador → pega la URL, 1920×1080, marca “Controlar audio vía OBS”.\n\n" +
            "Para enviar OBS al estudio: Ajustes → Emisión → Servicio WHIP, con el servidor y el Bearer Token de la pestaña OBS.\n\n" +
            "Multistream a YouTube/Twitch: instala ffmpeg (winget install ffmpeg) o copia ffmpeg.exe junto a StreamWebRom.exe.",
            "StreamWebRom + OBS", MessageBoxButtons.OK, MessageBoxIcon.Information);
        _startStop.Click += (_, _) => { if (_server.Running) StopServer(); else StartServer(); };
        actions.Controls.AddRange(new Control[] { open, _startStop, folder, obsHelp });
        root.Controls.Add(actions);

        var opts = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, BackColor = Panel, Padding = new Padding(10) };
        opts.Controls.Add(Lbl("Puerto web")); opts.Controls.Add(_port);
        opts.Controls.Add(Lbl("Puerto UDP media")); opts.Controls.Add(_udp);
        opts.Controls.Add(Lbl("IP pública")); opts.Controls.Add(_pubIp);
        opts.Controls.Add(_https);
        var apply = Btn("Aplicar y reiniciar");
        apply.Click += (_, _) => { SaveSettings(); StopServer(); StartServer(); };
        opts.Controls.Add(apply);
        root.Controls.Add(opts);

        var logBox = new Panel { Dock = DockStyle.Fill, Padding = new Padding(8), BackColor = Color.FromArgb(15, 15, 24), Margin = new Padding(0, 10, 0, 0) };
        logBox.Controls.Add(_log);
        root.Controls.Add(logBox);
        Controls.Add(root);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir estudio", null, (_, _) => OpenUrl(_localUrl.Text));
        menu.Items.Add("Mostrar ventana", null, (_, _) => ShowWindow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, (_, _) => Quit());
        _tray = new NotifyIcon { Icon = Icon, Text = "StreamWebRom", Visible = true, ContextMenuStrip = menu };
        _tray.DoubleClick += (_, _) => ShowWindow();

        _server.Output += line => BeginInvoke(() => AppendLog(line));
        _server.Exited += code => BeginInvoke(() => { if (!_quitting) SetStatus($"detenido (código {code})", Color.OrangeRed); _startStop.Text = "Iniciar"; });

        UpdateUrls();
        if (_settings.AutoStart) StartServer();
        if (args.Contains("--minimized")) { WindowState = FormWindowState.Minimized; ShowInTaskbar = false; }
    }

    private void StartServer()
    {
        try
        {
            SaveSettings();
            _server.Start(_settings);
            SetStatus("● en línea", Color.LimeGreen);
            _startStop.Text = "Detener";
            UpdateUrls();
            if (ServerProcess.FindFfmpeg() == null)
                AppendLog("Aviso: ffmpeg no encontrado. El multistream RTMP quedará deshabilitado; OBS, invitados y grabación funcionan igual.");
        }
        catch (Exception ex)
        {
            SetStatus("error", Color.OrangeRed);
            AppendLog("Error: " + ex.Message);
        }
    }

    private void StopServer() { _server.Stop(); SetStatus("detenido", Color.Orange); _startStop.Text = "Iniciar"; }

    private void SaveSettings()
    {
        _settings.Port = (int)_port.Value; _settings.UdpPort = (int)_udp.Value;
        _settings.Https = _https.Checked; _settings.PublicIp = _pubIp.Text;
        _settings.Save();
    }

    private void UpdateUrls()
    {
        var scheme = _settings.Https ? "https" : "http";
        _localUrl.Text = $"{scheme}://localhost:{_settings.Port}";
        _lanUrl.Text = $"{scheme}://{LanIp()}:{_settings.Port}";
    }

    private static string LanIp()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            foreach (var a in ni.GetIPProperties().UnicastAddresses)
                if (a.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a.Address)) return a.Address.ToString();
        }
        return "localhost";
    }

    private void SetStatus(string text, Color c) { _status.Text = text; _status.ForeColor = c; _tray.Text = "StreamWebRom – " + text; }

    private void AppendLog(string line)
    {
        if (_log.TextLength > 200_000) _log.Clear();
        _log.AppendText(line + Environment.NewLine);
    }

    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    private void ShowWindow() { Show(); ShowInTaskbar = true; WindowState = FormWindowState.Normal; Activate(); }

    private void Quit() { _quitting = true; _server.Stop(); _tray.Visible = false; Application.Exit(); }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_quitting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true; Hide();
            _tray.ShowBalloonTip(2000, "StreamWebRom", "Sigue funcionando en la bandeja. Clic derecho → Salir para cerrarlo.", ToolTipIcon.Info);
            return;
        }
        _server.Stop();
        base.OnFormClosing(e);
    }

    private void AddUrlRow(TableLayoutPanel t, string label, TextBox box)
    {
        var copy = Btn("Copiar");
        copy.Click += (_, _) => Clipboard.SetText(box.Text);
        t.Controls.Add(Lbl(label));
        t.Controls.Add(box);
        t.Controls.Add(copy);
    }

    private static TextBox Ro() => new() { ReadOnly = true, Dock = DockStyle.Fill, BackColor = Color.FromArgb(15, 15, 24), ForeColor = Color.White, BorderStyle = BorderStyle.FixedSingle, Font = new Font("Consolas", 10) };
    private static Label Lbl(string t) => new() { Text = t, AutoSize = true, ForeColor = Color.Silver, Margin = new Padding(3, 8, 6, 3) };
    private static Button Btn(string t, bool primary = false) => new()
    {
        Text = t, AutoSize = true, FlatStyle = FlatStyle.Flat, ForeColor = Color.White, Padding = new Padding(8, 4, 8, 4),
        BackColor = primary ? Accent : Color.FromArgb(34, 34, 52), FlatAppearance = { BorderColor = Color.FromArgb(58, 58, 82) }, Margin = new Padding(0, 0, 8, 0),
    };
}
