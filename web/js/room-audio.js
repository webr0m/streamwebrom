// Keep audible media independent of video visibility. No silent keepalive or
// background timer can override an operating system's suspension policy.
export class RoomAudio {
  constructor(onBlocked = () => {}) {
    this.entries = new Map(); this.onBlocked = onBlocked;
    this.resume = () => { for (const e of this.entries.values()) this.play(e); };
    this.visible = () => { if (document.visibilityState === "visible") this.resume(); };
    this.previousSession = navigator.audioSession?.type;
    try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
    document.addEventListener("pointerdown", this.resume, true);
    document.addEventListener("keydown", this.resume, true);
    document.addEventListener("visibilitychange", this.visible);
    window.addEventListener("pageshow", this.visible);
  }
  add(id, stream) {
    this.remove(id);
    const audio = document.createElement("audio"); audio.autoplay = true;
    audio.dataset.roomAudio = id; document.body.append(audio);
    const e = { audio, stream, blocked: false };
    e.changed = () => { audio.srcObject = new MediaStream(stream.getAudioTracks()); this.play(e); };
    this.entries.set(id, e);
    stream.addEventListener("addtrack", e.changed); stream.addEventListener("removetrack", e.changed);
    e.changed(); return audio;
  }
  play(e) {
    if (!e.audio.srcObject?.getAudioTracks().length || !e.audio.paused) return;
    e.audio.play().then(() => {
      if (!this.entries.has(e.audio.dataset.roomAudio)) return;
      e.blocked = false; this.notify();
    }).catch(() => { if (this.entries.get(e.audio.dataset.roomAudio) === e) { e.blocked = true; this.notify(); } });
  }
  notify() { this.onBlocked([...this.entries.values()].some(e => e.blocked)); }
  get(id) { return this.entries.get(id)?.audio; }
  remove(id) {
    const e = this.entries.get(id); if (!e) return;
    this.entries.delete(id);
    e.stream.removeEventListener("addtrack", e.changed); e.stream.removeEventListener("removetrack", e.changed);
    e.audio.pause(); e.audio.srcObject = null; e.audio.remove(); this.notify();
  }
  close() {
    for (const id of [...this.entries.keys()]) this.remove(id);
    document.removeEventListener("pointerdown", this.resume, true); document.removeEventListener("keydown", this.resume, true);
    document.removeEventListener("visibilitychange", this.visible); window.removeEventListener("pageshow", this.visible);
    try { if (navigator.audioSession?.type === "play-and-record") navigator.audioSession.type = this.previousSession || "auto"; } catch {}
  }
}

export function pictureInPicture(button, chooseVideo, report) {
  if (!button) return () => {};
  const supported = document.pictureInPictureEnabled || !!HTMLVideoElement.prototype.webkitSetPresentationMode;
  button.classList.toggle("hidden", !supported);
  button.onclick = async () => {
    try {
      if (document.pictureInPictureElement) return await document.exitPictureInPicture();
      const video = chooseVideo();
      if (!video || video.readyState < 2 || !video.srcObject?.getVideoTracks().length) return report("Espera a recibir vídeo para abrir la ventana flotante.");
      if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else video.webkitSetPresentationMode("picture-in-picture");
    } catch { report("Chrome no permitió la ventana flotante. Puedes mantener el audio al cambiar de pestaña; Android puede suspender la cámara."); }
  };
  return () => { button.onclick = null; };
}
