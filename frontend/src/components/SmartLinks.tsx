import { useEffect, useMemo, useState } from "react"
import { Check, Copy, ExternalLink, Link2 } from "lucide-react"

import { frappeFetch } from "../lib/api"
import { t as translate } from "../lib/i18n"

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

type RoomTypeLink = {
  name: string
  room_type_name: string
  listing_slug: string | null
  location_slug: string | null
  location_name: string | null
}

function slugify(text: string) {
  return (text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {copied ? translate("Copied") : label || translate("Copy")}
    </button>
  )
}

function LinkRow({ label, hint, url }: { label: string; hint?: string; url: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-zinc-400">{hint}</p>}
        <p className="mt-1 break-all font-mono text-xs text-zinc-500">{url}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <CopyBtn text={url} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          <ExternalLink className="size-3.5" />{translate("Open")}
        </a>
      </div>
    </div>
  )
}

export default function SmartLinks({
  property,
  pageSlug,
  propertyName,
}: {
  property: string
  pageSlug?: string | null
  propertyName?: string | null
}) {
  const slug = (pageSlug || "").trim() || slugify(propertyName || property)
  const origin = window.location.origin
  const [roomTypes, setRoomTypes] = useState<RoomTypeLink[]>([])
  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)

  useEffect(() => {
    const filters = encodeURIComponent(JSON.stringify([["property", "=", property], ["disabled", "=", 0]]))
    const fields = encodeURIComponent(
      JSON.stringify(["name", "room_type_name", "listing_slug", "location_slug", "location_name"]),
    )
    frappeFetch<{ data: RoomTypeLink[] }>(
      `/api/resource/Room Type?filters=${filters}&fields=${fields}&limit_page_length=0`,
    )
      .then((r) => setRoomTypes(r.data || []))
      .catch(() => setRoomTypes([]))
  }, [property])

  const staySuffix = useMemo(() => {
    if (!checkIn || !checkOut) return ""
    return `/${checkIn}/${checkOut}/${adults}/${children}`
  }, [checkIn, checkOut, adults, children])
  const qs = `?property=${encodeURIComponent(slug)}`

  const links = [
    {
      label: translate("Property booking page"),
      hint: translate("Opens the booking flow for this property."),
      url: `${origin}/book${qs}`,
    },
    {
      label: translate("Property showcase page"),
      hint: translate("Photo-led page guests can browse before booking."),
      url: `${origin}/stay/${encodeURIComponent(slug)}`,
    },
    ...(staySuffix
      ? [
          {
            label: translate("Stay link (dates + guests)"),
            hint: translate("Booking page pre-filled with the stay below."),
            url: `${origin}/book${staySuffix}${qs}`,
          },
        ]
      : []),
  ]

  const locations = useMemo(() => {
    const seen = new Map<string, string>()
    for (const rt of roomTypes) {
      if (rt.location_slug && !seen.has(rt.location_slug))
        seen.set(rt.location_slug, rt.location_name || rt.location_slug)
    }
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }))
  }, [roomTypes])

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        {translate("Generate and share deep links for this property - guests land directly on the booking or listing page.")}
      </p>

      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">{translate("Check-in")}</span>
          <input type="date" className={inputCls} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">{translate("Check-out")}</span>
          <input type="date" className={inputCls} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">{translate("Adults")}</span>
          <input type="number" min={1} className={inputCls} value={adults}
            onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">{translate("Children")}</span>
          <input type="number" min={0} className={inputCls} value={children}
            onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
      <p className="text-xs text-zinc-400">
        {translate("Optional - set dates and party size to generate pre-filled stay links.")}
      </p>

      <div className="space-y-2">
        {links.filter((l) => l.url).map((l) => (
          <LinkRow key={l.label} label={l.label} hint={l.hint} url={l.url} />
        ))}
      </div>

      {locations.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-700">{translate("Location pages")}</h3>
          <div className="flex flex-wrap gap-2">
            {locations.map((l) => (
              <span key={l.slug} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white py-1 ps-3 pe-1 text-sm text-zinc-700">
                {l.name}
                <CopyBtn text={`${origin}/stay/${encodeURIComponent(l.slug)}${staySuffix}`} />
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-700">
          <Link2 className="size-4" />{translate("Room type links")}
        </h3>
        {roomTypes.length === 0 ? (
          <p className="text-sm text-zinc-400">{translate("No room types found for this property.")}</p>
        ) : (
          <div className="space-y-2">
            {roomTypes.map((rt) => (
              <div key={rt.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800">{rt.room_type_name}</p>
                  <p className="truncate font-mono text-xs text-zinc-400">
                    {origin}/stay/{rt.listing_slug || slugify(rt.room_type_name)}{staySuffix}
                  </p>
                </div>
                <CopyBtn text={`${origin}/stay/${encodeURIComponent(rt.listing_slug || slugify(rt.room_type_name))}${staySuffix}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
