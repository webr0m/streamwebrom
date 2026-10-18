import { $, el, api } from "./rtc.js";

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
    const turn = (cfg.ice || []).some((server) => server.urls.some((url) => /^turns?:/.test(url)));
    box.append(row("Relé TURN", turn, turn ? "Configurado" : "Sin TURN; algunas redes restrictivas pueden impedir el video"));
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
