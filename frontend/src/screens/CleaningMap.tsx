/** /map: where cleaners were when they clocked in / out, checked in to and
 *  finished each apartment, against the properties' own map pins. */
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"

interface Pt {
  kind: "clock_in" | "clock_out" | "start" | "finish"
  lat: number
  lng: number
  accuracy?: number | null
  cleaner: string
  label: string
  distance?: number | null
  visit?: string
}
interface Data { points: Pt[]; properties: { name: string; label: string; lat: number; lng: number }[] }

const COLOR: Record<Pt["kind"], string> = { clock_in: "#16a34a", clock_out: "#18181b", start: "#2563eb", finish: "#059669" }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dist = (m?: number | null) => (m == null ? "" : m <= 150 ? ` · at the property (${m} m)` : m >= 1000 ? ` · ${(m / 1000).toFixed(1)} km from the property` : ` · ${m} m from the property`)

export default function CleaningMap() {
  const { t } = useT()
  const [params] = useSearchParams()
  const focus = params.get("visit")
  const [from, setFrom] = useState(() => iso(new Date()))
  const [to, setTo] = useState(() => iso(new Date()))
  const [who, setWho] = useState("")
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    // a visit link from the log: show its day
    const range = focus ? { date_from: "2000-01-01", date_to: iso(new Date()) } : { date_from: from, date_to: to }
    call<Data>("cloudtrade_hospitality.cleaner_app.map_points", range)
      .then((d) => { setData(d); setErr(null) })
      .catch((e) => setErr(serverError(e)))
  }, [from, to, focus])

  useEffect(() => {
    if (!box.current || map.current) return
    map.current = L.map(box.current, { zoomControl: true }).setView([-1.2864, 36.8172], 11)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = null }
  }, [])

  const cleaners = useMemo(() => [...new Set((data?.points || []).map((p) => p.cleaner))].sort(), [data])
  const pts = useMemo(
    () => (data?.points || []).filter((p) => (!who || p.cleaner === who) && (!focus || p.visit === focus)),
    [data, who, focus],
  )

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g || !data) return
    g.clearLayers()
    const bounds: L.LatLngExpression[] = []
    for (const p of data.properties) {
      L.circleMarker([p.lat, p.lng], { radius: 9, color: "#a1a1aa", fillColor: "#f4f4f5", fillOpacity: 1, weight: 2 })
        .bindTooltip(p.label, { direction: "top" }).addTo(g)
    }
    for (const p of pts) {
      if (p.accuracy && p.accuracy < 2000) {
        L.circle([p.lat, p.lng], { radius: p.accuracy, color: COLOR[p.kind], weight: 1, fillOpacity: 0.06 }).addTo(g)
      }
      L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: COLOR[p.kind], fillOpacity: 1 })
        .bindPopup(`<b>${p.cleaner}</b><br>${p.label}${dist(p.distance)}${p.accuracy ? `<br>GPS ±${p.accuracy} m` : ""}`)
        .addTo(g)
      bounds.push([p.lat, p.lng])
    }
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds).pad(0.3), { maxZoom: 16 })
    else if (data.properties.length) m.fitBounds(L.latLngBounds(data.properties.map((p) => [p.lat, p.lng] as L.LatLngExpression)).pad(0.2))
  }, [data, pts])

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-zinc-900">{t("Cleaners map")}</h1>
          <p className="text-sm text-zinc-500">
            {focus ? <>{t("One apartment visit.")} <Link to="/cleaning-map" className="font-medium text-brand-700">{t("Show all")}</Link></>
              : t("Where each cleaner clocked in, checked in, finished and clocked out. Grey circles are the properties.")}
          </p>
        </div>
        {!focus && (
          <>
            <label className="text-xs text-zinc-500">{t("From")}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-zinc-500">{t("To")}
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-zinc-500">{t("Cleaner")}
              <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
                <option value="">{t("Everyone")}</option>
                {cleaners.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-zinc-600">
        {([["clock_in", "Clocked in"], ["start", "Checked in"], ["finish", "Finished"], ["clock_out", "Clocked out"]] as const).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1"><span className="size-3 rounded-full" style={{ background: COLOR[k] }} />{t(l)}</span>
        ))}
        <span className="text-zinc-400">{pts.length} {t("points")}</span>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      <div ref={box} className="min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-zinc-200" />
    </div>
  )
}
