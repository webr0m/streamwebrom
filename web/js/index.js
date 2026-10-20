import { $, el, api, toast } from "./rtc.js";

const saved = () => {
  try {
    const rooms = JSON.parse(localStorage.getItem("swr.rooms") || "{}");
    return rooms && typeof rooms === "object" && !Array.isArray(rooms) ? rooms : {};
  } catch { return {}; }
};

$("#create").addEventListener("click", async () => {
  const btn = $("#create");
  btn.disabled = true;
  try {
    if (new TextEncoder().encode($("#pw").value).length > 72) throw new Error("La contraseña admite hasta 72 bytes (los acentos y emojis ocupan más de uno).");
    const keys = await api("/api/rooms", {
      room: $("#room").value.trim().toLowerCase(),
      title: $("#title").value.trim(),
      password: $("#pw").value,
      lobby: $("#lobby").checked,
    });
    const all = saved();
    all[keys.room] = { ...keys, title: $("#title").value.trim(), created: Date.now() };
    try { localStorage.setItem("swr.rooms", JSON.stringify(all)); }
    catch { toast("No se pudo guardar el estudio en este navegador. Guarda el enlace del anfitrión."); }
    // The host key travels in the fragment: never sent to servers or logged.
    location.href = `/studio?room=${encodeURIComponent(keys.room)}#key=${encodeURIComponent(keys.hostKey)}`;
  } catch (e) {
    toast(e.message, "err");
    btn.disabled = false;
  }
});

const join = () => {
  const r = $("#joinRoom").value.trim().toLowerCase();
  if (r) location.href = `/guest?room=${encodeURIComponent(r)}`;
};
$("#join").addEventListener("click", join);
$("#joinRoom").addEventListener("keydown", (e) => e.key === "Enter" && join());

const rooms = Object.values(saved()).filter((r) => r && typeof r.room === "string" && typeof r.hostKey === "string").sort((a, b) => Number(!!b.persistent)-Number(!!a.persistent) || b.created-a.created).filter((r,i,all)=>r.persistent || all.slice(0,i).filter(x=>!x.persistent).length<5);
if (rooms.length) {
  $("#recent").append(el("label", { text: "Tus estudios recientes" }));
  for (const r of rooms) {
    $("#recent").append(el("div", { class: "item" },
      el("span", { class: "grow", text: (r.title || r.room) + (r.persistent ? (r.expires && r.expires < Date.now() ? " · caducada" : " · guardada") : "") }),
      el("a", { class: "btn small", href: `/studio?room=${encodeURIComponent(r.room)}#key=${encodeURIComponent(r.hostKey)}`, text: "Abrir" })));
  }
}
