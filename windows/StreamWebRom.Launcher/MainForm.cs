using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace StreamWebRom.Launcher;

public sealed class MainForm : Form
{
    private readonly ServerProcess _server = new();
    private readonly Tunnel _tunnel = new();
    private readonly TextBox _publicUrl = Ro();
    private readonly CheckBox _tunnelOn = new() { Text = "Publicar en internet con Cloudflare Tunnel", AutoSize = true, ForeColor = Color.Gainsboro, Margin = new Padding(3, 7, 12, 3) };
    private readonly TextBox _host = new() { Width = 200, PlaceholderText = "stream.tudominio.com" };
    private readonly TextBox _token = new() { Width = 260, UseSystemPasswordChar = true, PlaceholderText = "pega el token del túnel" };
    private readonly Settings _settings = Settings.Load();
    private readonly NotifyIcon _tray;
    private readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold) };
    private readonly TextBox _log = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BackColor = Color.FromArgb(13, 14, 16), ForeColor = Color.FromArgb(200, 204, 212), BorderStyle = BorderStyle.None, Font = new Font("Consolas", 9) };
    private readonly TextBox _localUrl = Ro(), _lanUrl = Ro();
    private readonly Button _startStop = Btn("Detener");
    private readonly NumericUpDown _port = new() { Minimum = 1024, Maximum = 65535, Width = 90 };
    private readonly NumericUpDown _udp = new() { Minimum = 0, Maximum = 65535, Width = 90 };
    private readonly CheckBox _https = new() { Text = "HTTPS (necesario para cámaras de otros equipos/teléfonos)", AutoSize = true, ForeColor = Color.Gainsboro, Margin = new Padding(3, 7, 12, 3) };
    private readonly TextBox _pubIp = new() { Width = 160, PlaceholderText = "opcional" };
    private readonly TextBox _turnUrls = new() { Width = 330, PlaceholderText = "turn:relay.ejemplo.com:3478,turns:relay.ejemplo.com:443?transport=tcp" };
    private readonly TextBox _turnUser = new() { Width = 140, PlaceholderText = "usuario TURN" };
    private readonly TextBox _turnPassword = new() { Width = 180, UseSystemPasswordChar = true, PlaceholderText = "contraseña TURN" };
    private bool _quitting;

    // v1.3 look (StreamYard-style): near-black surfaces, cards, blue primary.
    private static readonly Color Bg = Color.FromArgb(17, 18, 20), Panel = Color.FromArgb(28, 29, 33), Panel2 = Color.FromArgb(36, 38, 43),
        Line = Color.FromArgb(46, 48, 54), Muted = Color.FromArgb(160, 164, 173), Accent = Color.FromArgb(47, 107, 255);

    public MainForm(string[] args)
    {
        Text = "StreamWebRom";
        Width = 880; Height = 720; MinimumSize = new Size(700, 540);
        BackColor = Bg; ForeColor = Color.White; Font = new Font("Segoe UI", 9.5f);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        _tunnelOn.Checked = _settings.TunnelEnabled; _host.Text = _settings.PublicHost;
        if (!string.IsNullOrEmpty(_settings.TunnelTokenProtected)) _token.PlaceholderText = "token guardado (cifrado) · pega otro para cambiarlo";
        _port.Value = _settings.Port; _udp.Value = _settings.UdpPort; _https.Checked = _settings.Https; _pubIp.Text = _settings.PublicIp;
        _turnUrls.Text = _settings.TurnUrls; _turnUser.Text = _settings.TurnUser;
        if (!string.IsNullOrEmpty(_settings.TurnPasswordProtected)) _turnPassword.PlaceholderText = "contraseña guardada (cifrada)";
        foreach (var c in new Control[] { _host, _token, _pubIp, _port, _udp, _turnUrls, _turnUser, _turnPassword }) StyleInput(c);

        // Top bar: app name + status pill on the left, primary action on the right.
        var top = new TableLayoutPanel { Dock = DockStyle.Top, Height = 64, ColumnCount = 3, BackColor = Color.FromArgb(23, 24, 27), Padding = new Padding(18, 0, 18, 0) };
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var titleBox = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Anchor = AnchorStyles.Left, Margin = new Padding(0) };
        titleBox.Controls.Add(new Label { Text = "StreamWebRom", AutoSize = true, Font = new Font("Segoe UI Semibold", 15f), Margin = new Padding(0, 4, 14, 0) });
        _status.Font = new Font("Segoe UI Semibold", 9.5f);
        _status.Margin = new Padding(0, 11, 0, 0);
        titleBox.Controls.Add(_status);
        top.Controls.Add(titleBox, 0, 0);
        var open = Btn("Abrir estudio", true);
        open.Font = new Font("Segoe UI Semibold", 10.5f);
        open.Padding = new Padding(14, 6, 14, 6);
        open.Anchor = AnchorStyles.Right;
        open.Click += (_, _) => OpenUrl(_settings.TunnelActive ? _publicUrl.Text : _localUrl.Text);
        top.Controls.Add(open, 2, 0);
        var topLine = new Panel { Dock = DockStyle.Top, Height = 1, BackColor = Line };

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18, 16, 18, 18), RowCount = 5, ColumnCount = 1, BackColor = Bg, AutoScroll = true };
        for (var i = 0; i < 4; i++) root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var urls = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, ColumnCount = 3, BackColor = Panel, Padding = new Padding(6), Margin = new Padding(0) };
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        urls.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        AddUrlRow(urls, "Este equipo", _localUrl);
        AddUrlRow(urls, "Tu red (teléfonos, otros PCs)", _lanUrl);
        AddUrlRow(urls, "Internet (invitados y OBS remotos)", _publicUrl);
        root.Controls.Add(Card("Enlaces del estudio", urls));

        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(6), Margin = new Padding(0) };
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
        actions.Controls.AddRange(new Control[] { _startStop, folder, obsHelp });
        root.Controls.Add(Card("Servidor", actions));

        var opts = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(6), Margin = new Padding(0) };
        opts.Controls.Add(Lbl("Puerto web")); opts.Controls.Add(_port);
        opts.Controls.Add(Lbl("Puerto UDP media")); opts.Controls.Add(_udp);
        opts.Controls.Add(Lbl("IP pública")); opts.Controls.Add(_pubIp);
        opts.Controls.Add(_https);
        opts.Controls.Add(Lbl("Relé TURN (redes móviles)")); opts.Controls.Add(_turnUrls);
        opts.Controls.Add(Lbl("Usuario")); opts.Controls.Add(_turnUser);
        opts.Controls.Add(Lbl("Contraseña")); opts.Controls.Add(_turnPassword);
        var diagnose = Btn("Probar conexión");
        diagnose.Click += (_, _) => OpenUrl((_settings.TunnelActive ? _publicUrl.Text : _localUrl.Text) + "/diagnostics");
        opts.Controls.Add(diagnose);
        var relays = Btn("TURN local / Cloudflare");
        relays.Click += (_, _) => { try { using var form = new RelayForm(); if (form.ShowDialog(this) == DialogResult.OK) { SaveSettings(); StopServer(); StartServer(); } } catch (Exception ex) { MessageBox.Show(this, ex.Message, "TURN"); } };
        opts.Controls.Add(relays);
        var apply = Btn("Aplicar y reiniciar", true);
        apply.Click += (_, _) => { SaveSettings(); StopServer(); StartServer(); };
        opts.Controls.Add(apply);
        root.Controls.Add(Card("Red", opts));

        var tun = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(6), Margin = new Padding(0) };
        tun.Controls.Add(_tunnelOn);
        tun.Controls.Add(Lbl("Dominio")); tun.Controls.Add(_host);
        tun.Controls.Add(Lbl("Token")); tun.Controls.Add(_token);
        var tunHelp = Btn("¿Dónde está el token?");
        tunHelp.Click += (_, _) => MessageBox.Show(
            "Cloudflare → Zero Trust → Networks → Tunnels → streamwebrom → Configure → copia el token de “Install and run a connector” (la parte larga después de --token).\n\n" +
            "Se guarda cifrado con tu usuario de Windows y nunca sale de este PC.\n\n" +
            "El túnel publica la web; el audio y video necesitan además UDP accesible o un servidor TURN. Para redes móviles con CGNAT o UDP bloqueado, configura un relé TURN con TCP/TLS en la tarjeta Red y compruébalo en Diagnóstico.",
            "Cloudflare Tunnel", MessageBoxButtons.OK, MessageBoxIcon.Information);
        tun.Controls.Add(tunHelp);
        root.Controls.Add(Card("Publicar en internet", tun));

        var logBox = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10), BackColor = Color.FromArgb(13, 14, 16), Margin = new Padding(0) };
        _log.BackColor = Color.FromArgb(13, 14, 16);
        logBox.Controls.Add(_log);
        var logCard = Card("Registro", logBox);
        logCard.Dock = DockStyle.Fill;
        root.Controls.Add(logCard);
        Controls.Add(root);
        Controls.Add(topLine);
        Controls.Add(top);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir estudio", null, (_, _) => OpenUrl(_localUrl.Text));
        menu.Items.Add("Mostrar ventana", null, (_, _) => ShowWindow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Salir", null, (_, _) => Quit());
        _tray = new NotifyIcon { Icon = Icon, Text = "StreamWebRom", Visible = true, ContextMenuStrip = menu };
        _tray.DoubleClick += (_, _) => ShowWindow();

        _tunnel.Output += line => OnUI(() => AppendLog(line));
        _server.Output += line => OnUI(() => AppendLog(line));
        _server.Exited += code => OnUI(() => { if (!_quitting) SetStatus($"detenido (código {code})", Color.FromArgb(255, 107, 110)); _startStop.Text = "Iniciar"; });

        UpdateUrls();
        // Server output may arrive immediately. Wait until WinForms has created
        // the window handle before starting background processes or BeginInvoke
        // would terminate the launcher and leave an orphaned server.
        Shown += (_, _) =>
        {
            if (_settings.AutoStart) StartServer();
            if (args.Contains("--minimized")) { WindowState = FormWindowState.Minimized; ShowInTaskbar = false; }
        };
    }

    private void OnUI(Action action)
    {
        if (IsDisposed || Disposing || !IsHandleCreated) return;
        try { BeginInvoke(new Action(() => { if (!IsDisposed && !Disposing) action(); })); }
        catch (InvalidOperationException) { } // handle can disappear during shutdown
    }

    private void StartServer()
    {
        try
        {
            SaveSettings();
            _server.Start(_settings);
            SetStatus("● en línea", Color.FromArgb(74, 222, 128));
            if (_settings.TunnelActive) _ = StartTunnelAsync();
            else if (_settings.TunnelEnabled) AppendLog("Túnel: pega el token de Cloudflare y pulsa “Aplicar y reiniciar” para publicar en " + _settings.PublicHost);
            _startStop.Text = "Detener";
            UpdateUrls();
            if (ServerProcess.FindFfmpeg() == null)
                AppendLog("Aviso: ffmpeg no encontrado. El multistream RTMP quedará deshabilitado; OBS, invitados y grabación funcionan igual.");
        }
        catch (Exception ex)
        {
            SetStatus("error", Color.FromArgb(255, 107, 110));
            AppendLog("Error: " + ex.Message);
        }
    }

    private async Task StartTunnelAsync()
    {
        try
        {
            await _tunnel.StartAsync(_settings.TunnelToken);
            AppendLog("Túnel Cloudflare activo → https://" + _settings.PublicHost);
            SetStatus("● en línea · " + _settings.PublicHost, Color.FromArgb(74, 222, 128));
        }
        catch (Exception ex) { AppendLog("Túnel: " + ex.Message); }
    }

    private void StopServer() { _tunnel.Stop(); _server.Stop(); SetStatus("detenido", Color.FromArgb(245, 158, 11)); _startStop.Text = "Iniciar"; }

    private void SaveSettings()
    {
        _settings.Port = (int)_port.Value; _settings.UdpPort = (int)_udp.Value;
        _settings.Https = _https.Checked; _settings.PublicIp = _pubIp.Text;
        _settings.TurnUrls = _turnUrls.Text.Trim(); _settings.TurnUser = _turnUser.Text.Trim();
        if (_turnPassword.Text.Length > 0) { _settings.TurnPassword = _turnPassword.Text; _turnPassword.Clear(); _turnPassword.PlaceholderText = "contraseña guardada (cifrada)"; }
        _settings.TunnelEnabled = _tunnelOn.Checked; _settings.PublicHost = _host.Text.Trim();
        if (!string.IsNullOrWhiteSpace(_token.Text)) { _settings.TunnelToken = _token.Text; _token.Clear(); _token.PlaceholderText = "token guardado (cifrado) · pega otro para cambiarlo"; }
        _settings.Save();
    }

    private void UpdateUrls()
    {
        var scheme = _settings.ServeHttps ? "https" : "http";
        _publicUrl.Text = _settings.TunnelActive ? "https://" + _settings.PublicHost : "(túnel desactivado)";
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

    private void Quit() { _quitting = true; _tunnel.Stop(); _server.Stop(); _tray.Visible = false; Application.Exit(); }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_quitting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true; Hide();
            _tray.ShowBalloonTip(2000, "StreamWebRom", "Sigue funcionando en la bandeja. Clic derecho → Salir para cerrarlo.", ToolTipIcon.Info);
            return;
        }
        _tunnel.Stop();
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

    /// <summary>A titled section: small uppercase heading over a bordered panel.</summary>
    private static Panel Card(string title, Control body)
    {
        var card = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 1, RowCount = 2, BackColor = Panel, Padding = new Padding(12, 10, 12, 12), Margin = new Padding(0, 0, 0, 12) };
        card.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        card.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        card.Controls.Add(new Label { Text = title.ToUpperInvariant(), AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI Semibold", 8.25f), Margin = new Padding(3, 0, 0, 6) }, 0, 0);
        body.Dock = DockStyle.Fill;
        card.Controls.Add(body, 0, 1);
        card.Paint += (_, e) =>
        {
            using var pen = new Pen(Line);
            e.Graphics.DrawRectangle(pen, 0, 0, card.Width - 1, card.Height - 1);
        };
        return card;
    }

    private static void StyleInput(Control c)
    {
        c.BackColor = Color.FromArgb(23, 24, 27);
        c.ForeColor = Color.White;
        if (c is TextBox tb) tb.BorderStyle = BorderStyle.FixedSingle;
        if (c is NumericUpDown nu) nu.BorderStyle = BorderStyle.FixedSingle;
        c.Margin = new Padding(0, 4, 12, 4);
    }

    private static TextBox Ro() => new() { ReadOnly = true, Dock = DockStyle.Fill, BackColor = Color.FromArgb(23, 24, 27), ForeColor = Color.White, BorderStyle = BorderStyle.FixedSingle, Font = new Font("Consolas", 10), Margin = new Padding(3, 5, 6, 5) };
    private static Label Lbl(string t) => new() { Text = t, AutoSize = true, ForeColor = Muted, Margin = new Padding(3, 9, 8, 3) };
    private static Button Btn(string t, bool primary = false)
    {
        var b = new Button
        {
            Text = t, AutoSize = true, FlatStyle = FlatStyle.Flat, ForeColor = Color.White, Padding = new Padding(10, 4, 10, 4), Cursor = Cursors.Hand,
            BackColor = primary ? Accent : Panel2, Margin = new Padding(0, 2, 8, 2), Font = new Font("Segoe UI Semibold", 9.5f),
        };
        b.FlatAppearance.BorderColor = primary ? Accent : Color.FromArgb(58, 61, 68);
        b.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(74, 127, 255) : Color.FromArgb(44, 47, 53);
        b.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(37, 90, 230) : Color.FromArgb(52, 55, 62);
        return b;
    }
}
