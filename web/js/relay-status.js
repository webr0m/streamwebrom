export const gigabytes = n => `${(Math.max(0, Number(n) || 0) / 1e9).toLocaleString("es-CL", { maximumFractionDigits: 1 })} GB`;

export function relayMessage(status, now = Date.now()) {
  if (!status) return { label: "Relé local activo", text: "Esta sala utiliza el relé local. El anfitrión puede habilitar Cloudflare en salas con contraseña desde Conexión y ahorro.", warning: false };
  if (status.switchAt) return { label: "Cambio al relé local", text: `Se alcanzó el corte preventivo. Cambiaremos automáticamente al relé local en ${Math.max(0, Math.ceil((status.switchAt - now) / 1000))} s para proteger la cuota gratuita.`, warning: true };
  if (status.provider === "local") return { label: "Relé local activo", text: status.reason === "quota" ? "Se aplicó el corte preventivo de Cloudflare. El relé local está activo; Cloudflare volverá a comprobarse el próximo mes." : "Cloudflare no está disponible o su consumo no se pudo verificar. Se utiliza el relé local.", warning: status.reason !== "configured" };
  if (status.warning) return { label: "Cuota cerca del corte", text: `El control estimado llegó a ${gigabytes(status.estimatedBytes)}. El cambio automático al relé local se hará a ${gigabytes(status.budgetBytes)}, antes de agotar la cuota gratuita compartida.`, warning: true };
  return { label: "Cloudflare activo", text: `${gigabytes(status.usageBytes)} verificados este mes · respaldo local preparado`, warning: false };
}

export function relayMonitor(sig, { banner, label, text, details }, notify) {
  let status = null, warned = "";
  const paint = () => {
    const m = relayMessage(status);
    label.textContent = m.label; text.textContent = m.text;
    banner.classList.toggle("quota-warning", m.warning);
    if (status) {
      details.textContent = `Consumo verificado TURN + SFU: ${gigabytes(status.usageBytes)}. Control conservador: ${gigabytes(status.estimatedBytes)} / ${gigabytes(status.budgetBytes)}. Aviso desde ${gigabytes(status.warningBytes)}. Cuota gratuita compartida: ${gigabytes(status.freeBytes)}.${status.recoveryReserve ? ` Reserva adicional tras recuperar el registro: ${gigabytes(status.recoveryReserve)}.` : ""} Las estadísticas pueden demorarse; este control no es un límite de facturación del proveedor.`;
    } else details.textContent = m.text;
  };
  const receive = e => {
    status = e.detail.relay || null; paint();
    const key = status ? `${status.month}:${status.provider}:${status.reason}:${status.warning}` : "";
    if (relayMessage(status).warning && key !== warned) { warned = key; notify(relayMessage(status).text); }
  };
  sig.addEventListener("welcome", receive); sig.addEventListener("relay-status", receive);
  const timer = setInterval(() => { if (status?.switchAt) paint(); }, 500);
  paint();
  return { destroy() { clearInterval(timer); sig.removeEventListener("welcome", receive); sig.removeEventListener("relay-status", receive); } };
}
