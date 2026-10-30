// Shared chat for the studio and the guest page: messages with time, host
// badge, links and @mentions, big emoji-only messages, an emoji picker (with
// recents) and stickers.
import { el } from "./rtc.js";
import { t } from "./i18n.js";
import { STICKERS, stickerById } from "./stickers.js";

// Category names are i18n keys, resolved when the picker renders so a language
// switch relabels the groups without touching the emoji lists.
export const EMOJIS = [
  ["😀", "misc.emojiFaces", "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 🤐 🤨 😐 😏 😒 🙄 😬 😌 😴 🤤 😷 🤒 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😲 😳 🥺 😢 😭 😱 😤 😡 🤬 💀 🤡 👻 👽 🤖 😺 🙈 🙉 🙊"],
  ["👍", "misc.emojiGestures", "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 💪 🫶 ✍️ 👀 🧠 🗣️ 🙋 🙆 🙅 🤷 🤦 💃 🕺"],
  ["❤️", "misc.emojiHearts", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭"],
  ["🎉", "misc.emojiParty", "🎉 🎊 🎈 🎁 🎂 🍾 🥂 🍻 🏆 🥇 🏅 🎖️ ⭐ 🌟 ✨ 🔥 ⚡ 🌈 ☀️ 🎶 🎵 🎤 🎧 🎸 🥁 🎮 🎬 📸 🎯"],
  ["⚽", "misc.emojiMisc", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🚀 ✈️ 🚗 🏠 💻 📱 ⌚ 💡 📌 📣 🔔 ⏰ ⏳ ✅ ❌ ❓ ❗ ⚠️ 🆗 🆕 🔴 🟢 🔵 ☕ 🍕 🍔 🌮 🍿 🍩 🍓 🥑 🐶 🐱 🦄 🐔 🇨🇱"],
].map(([icon, name, list]) => ({ icon, name, list: list.split(" ") }));

const RECENT_KEY = "swr.emoji.recent";
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 24); } catch { return []; } };
const pushRecent = (e) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recents().filter((x) => x !== e)].slice(0, 24))); } catch {} };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
// Built from a string: the repo's JS linter can't parse \p{…} regex literals.
const EMOJI_ONLY_RE = new RegExp("^(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\\u200d|\\ufe0f|\\p{Emoji_Modifier}|\\s)+$", "u");

/** A sticker drawn as an HTML element. */
export function stickerEl(st, big = false) {
  return el("div", { class: "sticker" + (big ? " big" : ""), title: st.text, style: `background:linear-gradient(135deg,${st.c[0]},${st.c[1]})` },
    el("span", { class: "se", text: st.emoji }), el("span", { class: "st", text: st.text }));
}

function richText(text, myName) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[).,;:!?]+$/, "");
    if (m.index > last) out.push(...mentions(text.slice(last, m.index), myName));
    out.push(el("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow", text: url }));
    last = m.index + url.length;
  }
  if (last < text.length) out.push(...mentions(text.slice(last), myName));
  return out;
}
function mentions(s, myName) {
  if (!myName) return [s];
  const at = "@" + myName.toLowerCase();
  const i = s.toLowerCase().indexOf(at);
  if (i < 0) return [s];
  return [s.slice(0, i), el("mark", { text: s.slice(i, i + at.length) }), ...mentions(s.slice(i + at.length), myName)];
}

const hhmm = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Render one chat message. opts: { myId, myName, actions: [elements] }.
 * Returns the element (it also tells whether it mentions me in .dataset.mention).
 */
export function chatMessage(c, opts = {}) {
  const mine = opts.myId && c.peerId === opts.myId;
  const st = c.sticker ? stickerById(c.sticker) : null;
  const text = c.text || "";
  const body = st ? stickerEl(st) : el("div", { class: "body" + (EMOJI_ONLY_RE.test(text) && [...text.replace(/\s/g, "")].length <= 8 ? " bigemoji" : "") }, ...richText(text, opts.myName));
  const mention = !!(opts.myName && !mine && text.toLowerCase().includes("@" + opts.myName.toLowerCase()));
  const msg = el("div", { class: "msg" + (mine ? " mine" : "") + (mention ? " mention" : "") + (st ? " hassticker" : "") },
    ...(opts.actions || []),
    el("div", { class: "meta" },
      el("b", { text: c.from }),
      c.role === "host" ? el("span", { class: "badge", text: t("misc.chatHostBadge") }) : null,
      c.source && c.source !== "chat" ? el("span", { class: "badge src", text: c.source }) : null,
      el("span", { class: "time", text: hhmm(c.ts) })),
    body);
  msg.dataset.mention = mention ? "1" : "";
  return msg;
}

/** Append to a chat log, keeping the view pinned to the bottom only if it was. */
export function appendChat(box, msg) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.append(msg);
  while (box.children.length > 300) box.firstChild.remove();
  if (atBottom || msg.classList.contains("mine")) box.scrollTop = box.scrollHeight;
}

/**
 * Add emoji and sticker buttons to a composer row (input + send button).
 * send(payload) is called with { text } or { sticker }.
 */
export function mountComposer(row, input, send) {
  const picker = el("div", { class: "chatpicker hidden", role: "dialog", "aria-label": t("misc.chatPickerAria") });
  let tab = "emoji";
  const insert = (e) => {
    const s = input.selectionStart ?? input.value.length, t = input.selectionEnd ?? s;
    input.value = (input.value.slice(0, s) + e + input.value.slice(t)).slice(0, Number(input.maxLength) > 0 ? input.maxLength : 500);
    input.focus();
    const p = s + e.length; input.setSelectionRange(p, p);
    pushRecent(e);
  };
  const render = () => {
    const tabs = el("div", { class: "pickertabs" },
      el("button", { type: "button", class: tab === "emoji" ? "on" : "", onclick: () => { tab = "emoji"; render(); }, text: t("misc.chatTabEmojis") }),
      el("button", { type: "button", class: tab === "stickers" ? "on" : "", onclick: () => { tab = "stickers"; render(); }, text: t("misc.chatTabStickers") }));
    let content;
    if (tab === "emoji") {
      const groups = [];
      const rec = recents();
      if (rec.length) groups.push({ name: "misc.emojiRecent", list: rec });
      groups.push(...EMOJIS);
      content = el("div", { class: "emojigrid" }, ...groups.flatMap((g) => [
        el("div", { class: "grouptitle", text: t(g.name) }),
        ...g.list.map((e) => el("button", { type: "button", class: "emo", title: e, onclick: () => insert(e), text: e })),
      ]));
    } else {
      content = el("div", { class: "stickergrid" }, ...STICKERS.map((st) => {
        const b = el("button", { type: "button", class: "stk", title: st.text, onclick: () => { send({ sticker: st.id }); close(); } });
        b.append(stickerEl(st));
        return b;
      }));
    }
    picker.replaceChildren(tabs, content);
  };
  const open = (which) => { tab = which; render(); picker.classList.remove("hidden"); };
  const close = () => picker.classList.add("hidden");
  const toggle = (which) => (!picker.classList.contains("hidden") && tab === which ? close() : open(which));
  const emojiBtn = el("button", { type: "button", class: "small chattool", title: t("misc.chatEmojis"), "aria-label": t("misc.chatEmojis"), onclick: () => toggle("emoji"), text: "😊" });
  const stickBtn = el("button", { type: "button", class: "small chattool", title: t("misc.chatStickers"), "aria-label": t("misc.chatStickers"), onclick: () => toggle("stickers"), text: "🏷️" });
  row.classList.add("chatcomposer");
  row.prepend(emojiBtn, stickBtn);
  row.after(picker);
  document.addEventListener("pointerdown", (e) => { if (!picker.contains(e.target) && e.target !== emojiBtn && e.target !== stickBtn) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // :) style shortcuts become emoji when sent
  const SHORT = { ":)": "🙂", ":D": "😄", ";)": "😉", ":(": "🙁", "<3": "❤️", ":P": "😛", ":o": "😮", "xD": "😆" };
  const doSend = () => {
    let v = input.value.trim();
    if (!v) return;
    v = v.replace(/(^|\s)(:\)|:D|;\)|:\(|<3|:P|:o|xD)(?=\s|$)/g, (_, sp, k) => sp + SHORT[k]);
    send({ text: v });
    input.value = "";
    close();
  };
  return { send: doSend, close };
}
