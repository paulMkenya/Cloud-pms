export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

/** Plain text of a server message that may carry HTML. A single
 *  /<[^>]+>/ pass can leave a tag behind from nested input ("<scr<b>ipt"),
 *  so strip until nothing changes, then drop any stray angle bracket - the
 *  result can never contain markup. It is only ever rendered as text. */
export function htmlToText(s: string): string {
  let out = s
  let prev: string
  do {
    prev = out
    out = out.replace(/<[^<>]*>/g, "")
  } while (out !== prev)
  return out.replace(/[<>]/g, "")
}

/** Keyless Google Maps embed URL. Prefers real coordinates; falls back to a
 *  saved Google Maps link (place query or short link resolved to a long
 *  maps.google.com URL). Returns null when neither can produce an embed -
 *  maps.app.goo.gl short links can't be iframed directly. */
export function googleMapsEmbed(
  mapsUrl: string | null | undefined,
  lat?: number | null,
  lng?: number | null,
): string | null {
  if (lat && lng) {
    return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`
  }
  if (!mapsUrl) return null
  try {
    const u = new URL(mapsUrl)
    if (u.hostname === "maps.app.goo.gl" || u.hostname === "goo.gl") return null
    u.searchParams.set("output", "embed")
    return u.toString()
  } catch {
    return null
  }
}
