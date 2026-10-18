// Chat stickers: drawn (emoji + text on a gradient), so there is nothing to
// download and they look the same in the chat and on the program output.
// Keep the ids in sync with internal/studio/chat.go (stickerIDs).
export const STICKERS = [
  { id: "hola", emoji: "👋", text: "¡Hola!", c: ["#2f6bff", "#7c5cff"] },
  { id: "bienvenidos", emoji: "🤗", text: "¡Bienvenidos!", c: ["#00b894", "#2f6bff"] },
  { id: "gracias", emoji: "🙏", text: "¡Gracias!", c: ["#ff7a59", "#ff3d77"] },
  { id: "aplausos", emoji: "👏", text: "¡Aplausos!", c: ["#f7b500", "#ff6a3d"] },
  { id: "jaja", emoji: "😂", text: "¡Jajaja!", c: ["#ffcf3d", "#ff8a00"] },
  { id: "fuego", emoji: "🔥", text: "¡Fuego!", c: ["#ff3d3d", "#ff9a00"] },
  { id: "wow", emoji: "😮", text: "¡Wow!", c: ["#00c6ff", "#0072ff"] },
  { id: "encanta", emoji: "❤️", text: "¡Me encanta!", c: ["#ff4d8d", "#c2185b"] },
  { id: "gg", emoji: "🏆", text: "GG", c: ["#ffd200", "#f7971e"] },
  { id: "like", emoji: "👍", text: "¡Like!", c: ["#36d1dc", "#5b86e5"] },
  { id: "pregunta", emoji: "🙋", text: "Tengo una pregunta", c: ["#8e2de2", "#4a00e0"] },
  { id: "felicidades", emoji: "🎉", text: "¡Felicidades!", c: ["#f953c6", "#b91d73"] },
  { id: "envivo", emoji: "🔴", text: "EN VIVO", c: ["#e52d27", "#b31217"] },
  { id: "saludos", emoji: "🇨🇱", text: "¡Saludos!", c: ["#0039a6", "#d52b1e"] },
  { id: "cafe", emoji: "☕", text: "Pausa café", c: ["#8d6e63", "#4e342e"] },
  { id: "yavuelvo", emoji: "⏳", text: "Ya vuelvo", c: ["#606c88", "#3f4c6b"] },
];
export const stickerById = (id) => STICKERS.find((s) => s.id === id) || null;
