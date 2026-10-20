import { $, el, api, iceConfiguration, networkMode, params } from "./rtc.js";
import { checkVideoRoute } from "./network.js";

$("#networkMode").value = networkMode(params.get("network"));
$("#networkMode").onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set("network", $("#networkMode").value);
  history.replaceState(null, "", url);
};

function row(label, ok, detail) {
  return el("p", {}, el("strong", { text: `${ok ? "✓" : "⚠"} ${label}: ` }), detail);
}
async function check() {
  const box = $("#checks");
  box.replaceChildren(
    row("Contexto seguro", window.isSecureContext, window.isSecureContext ? "Disponible" : "Usa HTTPS o localhost para acceder a cámara y micrófono"),
    row("WebRTC", typeof RTCPeerConnection !== "undefined", typeof RTCPeerConnection !== "undefined" ? "Compatible" : "Navegador incompatible"),
    row("Dispositivos", !!navigator.mediaDevices?.getUserMedia, navigator.mediaDevices?.getUserMedia ? "API disponible; requiere tu permiso" : "No disponible en este navegador o conexión"),
  );
  try {
    const cfg = await api("/api/config");
    box.append(row("Servidor", true, `Conectado · ${cfg.version || "desarrollo"}`));
    box.append(row("Multistream", cfg.capabilities?.multistream, cfg.capabilities?.multistream ? "ffmpeg disponible en el servidor" : "Instala ffmpeg en el servidor para enviar a RTMP/SRT"));
    const turn = (cfg.ice || []).some((server) => [server.urls].flat().some((url) => /^turns?:/.test(url)));
    box.append(row("Relé TURN", turn, turn ? "Configurado" : "Sin TURN; algunas redes restrictivas pueden impedir el video"));
    if (cfg.relay?.provider) box.append(row("Proveedor TURN", turn, cfg.relay.provider === "cloudflare" ? "Cloudflare · consumo bajo el corte preventivo" : `Equipo local · ${cfg.relay.reason === "quota" ? "corte preventivo mensual alcanzado" : cfg.relay.reason === "configured" ? "configurado" : cfg.relay.reason === "state-unavailable" ? "registro de consumo no disponible; Cloudflare en pausa" : "Cloudflare no disponible o consumo sin verificar"}`));
  } catch (e) { box.append(row("Servidor", false, e.message)); }
}
$("#refresh").onclick = check;
$("#media").onclick = async () => {
  const button = $("#media"); button.disabled = true;
  let stream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara necesita HTTPS y un navegador compatible");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    $("#mediaResult").textContent = "✓ Cámara y micrófono disponibles. La prueba ha finalizado y los dispositivos se han liberado.";
  } catch (e) { $("#mediaResult").textContent = `No se pudo completar la prueba: ${e.message}`; }
  finally { stream?.getTracks().forEach((track) => track.stop()); button.disabled = false; }
};
check();

$("#relay").onclick = async () => {
  const button = $("#relay"), result = $("#relayResult");
  button.disabled = true; result.textContent = "Comprobando acceso al relé TURN…";
  let pc;
  try {
    const cfg = await api("/api/config");
    const mode = $("#networkMode").value;
    const configured = mode === "local" ? cfg.localIce || [] : cfg.ice || [];
    const servers = configured.map(s => ({ ...s, urls: [s.urls].flat().filter(url => /^turns?:/i.test(url)) })).filter(s => s.urls.length);
    if (!servers.length) throw new Error("El servidor no tiene TURN configurado. El administrador debe añadir un relé para las redes móviles que no permiten conexión directa.");
    pc = new RTCPeerConnection({ ...iceConfiguration(servers, mode), iceTransportPolicy: "relay" });
    pc.createDataChannel("relay-check");
    await new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TURN no respondió en 15 segundos. Revisa la dirección, las credenciales y el firewall del relé.")), 15000);
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) { clearTimeout(timer); reject(new Error("No se obtuvo una ruta TURN. Comprueba las credenciales y prueba TURN con TCP/TLS.")); }
        else if (candidate.type === "relay") { clearTimeout(timer); resolve(); }
      };
      try { await pc.setLocalDescription(await pc.createOffer()); }
      catch (e) { clearTimeout(timer); reject(e); }
    });
    result.textContent = "✓ Se obtuvo una ruta TURN desde esta red. Entra en la sala para comprobar audio y video.";
  } catch (e) { result.textContent = e.message; }
  finally { if (pc) { pc.onicecandidate = null; pc.close(); } button.disabled = false; }
};

$("#videoRoute").onclick = async () => {
  const button = $("#videoRoute"), result = $("#videoRouteResult"), selector = $("#networkMode");
  button.disabled = selector.disabled = true;
  result.textContent = "Comprobando envío y recepción de video…";
  try {
    const mode = selector.value;
    // Validate the selected route before creating a disposable test room.
    const cfg = await api("/api/config");
    iceConfiguration(mode === "local" ? cfg.localIce || [] : cfg.ice || [], mode);
    await checkVideoRoute(mode);
    result.textContent = `✓ Video enviado al servidor y recibido correctamente · ${selector.selectedOptions[0].textContent}.`;
  } catch (e) { result.textContent = `No se completó la prueba de video: ${e.message}`; }
  finally {
    button.disabled = selector.disabled = false;
  }
};
