package studio

import "slices"

// stickerIDs are the built-in chat stickers; keep in sync with web/js/stickers.js.
var stickerIDs = []string{
	"hola", "bienvenidos", "gracias", "aplausos", "jaja", "fuego", "wow", "encanta",
	"gg", "like", "pregunta", "felicidades", "envivo", "saludos", "cafe", "yavuelvo",
}

func validSticker(id string) bool { return slices.Contains(stickerIDs, id) }
