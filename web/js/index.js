import { $, el, api, toast } from "./rtc.js";

const saved = () => JSON.parse(localStorage.getItem("swr.rooms") || "{}");

$("#create").addEventListener("click", async () => {
  const btn = $("#create");
  btn.disabled = true;
  try {
    const keys = await api("/api/rooms", {
      room: $("#room").value.trim().toLowerCase(),
      title: $("#title").value.trim(),
      password: $("#pw").value,
      lobby: $("#lobby").checked,
    });
    const all = saved();
    all[keys.room] = { ...keys, title: $("#title").value.trim(), created: Date.now() };
    localStorage.setItem("swr.rooms", JSON.stringify(all));
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

const rooms = Object.values(saved()).sort((a, b) => b.created - a.created).slice(0, 5);
if (rooms.length) {
  $("#recent").append(el("label", { text: "Tus estudios recientes" }));
  for (const r of rooms) {
    $("#recent").append(el("div", { class: "item" },
      el("span", { class: "grow", text: r.title || r.room }),
      el("a", { class: "btn small", href: `/studio?room=${encodeURIComponent(r.room)}#key=${encodeURIComponent(r.hostKey)}`, text: "Abrir" })));
  }
}
