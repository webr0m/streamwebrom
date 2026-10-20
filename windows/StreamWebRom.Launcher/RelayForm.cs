namespace StreamWebRom.Launcher;

public sealed class RelayForm : Form
{
    public RelayForm()
    {
        var s = RelaySettings.Load();
        Text = "TURN local y Cloudflare"; Width = 700; Height = 600; MinimumSize = new Size(620, 500);
        StartPosition = FormStartPosition.CenterParent;
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), AutoScroll = true, ColumnCount = 2 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        void Row(string label, Control control) { var n = grid.RowCount++; grid.RowStyles.Add(new RowStyle(SizeType.AutoSize)); grid.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(3, 7, 3, 7) }, 0, n); control.Dock = DockStyle.Top; grid.Controls.Add(control, 1, n); }
        TextBox Field(string value, bool secret = false) => new() { Text = value, UseSystemPasswordChar = secret, PlaceholderText = secret ? "vacío conserva el secreto cifrado" : "" };
        var enabled = new CheckBox { Text = "Activar relé local", Checked = s.Enabled, AutoSize = true };
        var cloud = new CheckBox { Text = "Cloudflare con respaldo local por cuota", Checked = s.CloudflareEnabled, AutoSize = true };
        var ip = Field(s.PublicIp); var listen = Field(s.Listen); var alternate = Field(s.TcpAlternate);
        var advertised = Field(s.AdvertisedUrls);
        var account = Field(s.CloudflareAccount); var keyId = Field(s.CloudflareTurnKeyId);
        var key = Field("", true); var analytics = Field("", true);
        var budget = new NumericUpDown { Minimum = 1, Maximum = 900, Value = Math.Clamp((decimal)s.BudgetBytes / 1000000000m, 1, 900) };
        Row("TURN del equipo", enabled); Row("IP pública IPv4", ip); Row("Escucha UDP y TCP", listen); Row("TCP adicional (opcional)", alternate);
        Row("URLs del proxy TLS (opcional)", advertised);
        Row("Puertos UDP del relé", new Label { Text = $"{s.MinPort}–{s.MaxPort} · abrir en router", AutoSize = true });
        Row("Proveedor externo", cloud); Row("ID de cuenta Cloudflare", account); Row("ID de clave TURN", keyId);
        Row("Token de clave TURN", key); Row("Token Account Analytics Read", analytics); Row("Corte preventivo TURN (GB/mes)", budget);
        Row("", new Label { Text = "El consumo se estima para toda la cuenta TURN. La cuota gratuita se comparte con Realtime SFU. Las estadísticas tienen retraso: este corte no garantiza una factura de cero. El equipo debe permanecer encendido y accesible desde internet.", AutoSize = true, MaximumSize = new Size(400, 0) });
        var save = new Button { Text = "Guardar", AutoSize = true };
        save.Click += (_, _) => {
            if (enabled.Checked && (!System.Net.IPAddress.TryParse(ip.Text.Trim(), out var parsed) || parsed.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)) { MessageBox.Show(this, "Indica una IP pública IPv4 válida."); return; }
            if (cloud.Checked && !enabled.Checked) { MessageBox.Show(this, "Cloudflare con control de cuota requiere activar el respaldo local."); return; }
            s.Enabled = enabled.Checked; s.CloudflareEnabled = cloud.Checked; s.PublicIp = ip.Text.Trim(); s.Listen = listen.Text.Trim(); s.TcpAlternate = alternate.Text.Trim();
            s.AdvertisedUrls = advertised.Text.Trim();
            s.CloudflareAccount = account.Text.Trim(); s.CloudflareTurnKeyId = keyId.Text.Trim(); s.BudgetBytes = (ulong)(budget.Value * 1000000000m);
            if (key.Text.Length > 0) s.CloudflareTurnKeyProtected = RelaySettings.Encrypt(key.Text.Trim());
            if (analytics.Text.Length > 0) s.CloudflareAnalyticsTokenProtected = RelaySettings.Encrypt(analytics.Text.Trim());
            try { s.Save(); DialogResult = DialogResult.OK; Close(); } catch (Exception ex) { MessageBox.Show(this, ex.Message); }
        };
        Row("", save); Controls.Add(grid); AcceptButton = save;
    }
}
