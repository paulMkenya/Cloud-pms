/** Housekeeping > Cleaning log: every cleaner's shifts (clock in / out,
 *  hours) and apartment visits (times, checklist, damages, items left,
 *  photos, distance from the property) from the cleaner phone app. */
import { useCallback, useEffect, useState } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { AlertTriangle, Camera, Check, MapPin, Package, X } from "lucide-react"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"

interface VisitRow {
  name: string
  unit: string
  task_type: string
  status: string
  started_on: string
  finished_on?: string | null
  minutes?: number | null
  damage_note?: string | null
  left_note?: string | null
  problems?: string | null
  token_units?: number | null
  start_distance?: number | null
  finish_distance?: number | null
  photos: number
}
interface Shift {
  name: string
  cleaner_name: string
  status: string
  clock_in: string
  clock_out?: string | null
  minutes?: number | null
  in_distance?: number | null
  out_distance?: number | null
  visits_list: VisitRow[]
}
interface Log {
  from: string
  to: string
  shifts: Shift[]
  totals: { cleaner: string; shifts: number; minutes: number; apartments: number }[]
}
interface Detail {
  name: string
  unit: string
  cleaner_name: string
  task_type: string
  status: string
  started_on: string
  finished_on?: string | null
  minutes?: number | null
  no_damage: number
  damage_note?: string | null
  maintenance_task?: string | null
  no_left_items: number
  left_note?: string | null
  lost_found_item?: string | null
  token_units?: number | null
  checks: { item: string; kind: string; ok: number; value?: string; note?: string }[]
  photos: { name: string; stage: string; image: string; note?: string }[]
  start_lat?: number | null
  start_lng?: number | null
  start_distance?: number | null
  finish_distance?: number | null
}

const day = (s: string) => new Date(s.replace(" ", "T")).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
const hm = (s?: string | null) => (s ? s.slice(11, 16) : "")
const dur = (m?: number | null) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`)
const dist = (m?: number | null) => (m == null ? "no location" : m <= 150 ? `at the property (${m} m)` : m >= 1000 ? `${(m / 1000).toFixed(1)} km away` : `${m} m away`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function CleaningLog() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(() => iso(new Date()))
  const [log, setLog] = useState<Log | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const open = params.get("visit")

  const load = useCallback(() => {
    call<Log>("cloudtrade_hospitality.cleaner_app.cleaning_log", { date_from: from, date_to: to })
      .then((r) => { setLog(r); setErr(null) })
      .catch((e) => setErr(serverError(e)))
  }, [from, to])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!open) { setDetail(null); return }
    call<Detail>("cloudtrade_hospitality.cleaner_app.visit_detail", { name: open })
      .then(setDetail)
      .catch((e) => setErr(serverError(e)))
  }, [open])

  const show = (v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set("visit", v); else p.delete("visit")
    setParams(p)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">{t("Cleaning log")}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {t("Clock in and out, every apartment cleaned, checklists and photos from the cleaner app.")}{" "}
            <Link to="/cleaning-map" className="font-medium text-brand-700">{t("Map")}</Link>
          </p>
        </div>
        <label className="text-xs text-zinc-500">{t("From")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-zinc-500">{t("To")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {log && log.totals.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white">
          <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-800">{t("Hours per cleaner")}</h2>
          <table className="m-cards w-full text-sm">
            <thead><tr className="text-left text-xs text-zinc-500">
              <th className="px-4 py-2 font-medium">{t("Cleaner")}</th><th className="px-4 py-2 font-medium">{t("Days")}</th>
              <th className="px-4 py-2 font-medium">{t("Hours")}</th><th className="px-4 py-2 font-medium">{t("Apartments")}</th>
            </tr></thead>
            <tbody>{log.totals.map((r) => (
              <tr key={r.cleaner} className="border-t border-zinc-100">
                <td className="px-4 py-2 font-medium text-zinc-900">{r.cleaner}</td><td className="px-4 py-2">{r.shifts}</td>
                <td className="px-4 py-2 tabular-nums">{dur(r.minutes)}</td><td className="px-4 py-2">{r.apartments}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {!log ? <p className="text-sm text-zinc-500">{t("Loading…")}</p> : log.shifts.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
          {t("No cleaner has clocked in on these dates. Cleaners sign in at /clean with their phone number.")}
        </p>
      ) : (
        <div className="space-y-3">
          {log.shifts.map((s) => (
            <section key={s.name} className="rounded-2xl border border-zinc-200 bg-white">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 px-4 py-3">
                <span className="text-sm font-semibold text-zinc-900">{s.cleaner_name}</span>
                <span className="text-sm text-zinc-600">{day(s.clock_in)} · {hm(s.clock_in)}–{s.clock_out ? hm(s.clock_out) : t("still in")}</span>
                {s.minutes ? <span className="text-sm text-zinc-500">{dur(s.minutes)}</span> : null}
                <span className="text-xs text-zinc-400">{t("in")}: {dist(s.in_distance)}{s.clock_out ? ` · ${t("out")}: ${dist(s.out_distance)}` : ""}</span>
              </div>
              {s.visits_list.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-400">{t("No apartments yet.")}</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {s.visits_list.map((v) => (
                    <li key={v.name}>
                      <button type="button" onClick={() => show(v.name)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-start hover:bg-zinc-50 max-sm:min-h-12">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-zinc-900">{v.unit}</span>
                          <span className="block text-xs text-zinc-500">
                            {hm(v.started_on)}–{v.finished_on ? hm(v.finished_on) : t("in progress")} {v.minutes ? `· ${dur(v.minutes)}` : ""} · {dist(v.start_distance)}
                            {v.token_units != null ? ` · ${t("tokens")} ${v.token_units}` : ""}
                          </span>
                        </span>
                        {v.damage_note && <span className="flex items-center gap-1 text-xs font-medium text-rose-700"><AlertTriangle className="size-3.5" />{t("Damage")}</span>}
                        {v.left_note && <span className="flex items-center gap-1 text-xs font-medium text-amber-700"><Package className="size-3.5" />{t("Left item")}</span>}
                        {v.problems && <span className="text-xs font-medium text-amber-700">{t("Checklist")} ⚠</span>}
                        {v.photos > 0 && <span className="flex items-center gap-1 text-xs text-zinc-500"><Camera className="size-3.5" />{v.photos}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => show(null)}>
          <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-zinc-900">{detail.unit}</h2>
                <p className="text-sm text-zinc-500">{detail.cleaner_name} · {day(detail.started_on)} · {hm(detail.started_on)}–{hm(detail.finished_on)} {detail.minutes ? `(${dur(detail.minutes)})` : ""}</p>
                <p className="text-xs text-zinc-400">{t("Check-in")}: {dist(detail.start_distance)} · {t("Finish")}: {dist(detail.finish_distance)}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => show(null)} className="grid size-10 place-items-center rounded-full hover:bg-zinc-100"><X className="size-5" /></button>
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <h3 className="font-semibold text-zinc-800">{t("Damage")}</h3>
                <p className={detail.damage_note ? "text-rose-700" : "text-zinc-500"}>{detail.damage_note || t("None")}{detail.maintenance_task ? ` · ${detail.maintenance_task}` : ""}</p>
              </div>
              <div>
                <h3 className="font-semibold text-zinc-800">{t("Left by the guest")}</h3>
                <p className={detail.left_note ? "text-amber-700" : "text-zinc-500"}>{detail.left_note || t("Nothing")}{detail.lost_found_item ? ` · ${t("Lost & Found")} ${detail.lost_found_item}` : ""}</p>
              </div>
              <div>
                <h3 className="font-semibold text-zinc-800">{t("Checklist")}</h3>
                {detail.checks.length === 0 ? <p className="text-zinc-500">{t("Not finished yet.")}</p> : (
                  <ul className="mt-1 space-y-1">
                    {detail.checks.map((c) => (
                      <li key={c.item} className="flex gap-2">
                        {c.kind === "number" ? <span className="w-5 text-center text-zinc-400">#</span> : c.ok ? <Check className="size-5 text-emerald-600" /> : <X className="size-5 text-rose-600" />}
                        <span className="flex-1">{c.item}{c.value ? `: ${c.value}` : ""}{c.note ? <span className="text-rose-700"> - {c.note}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-zinc-800">{t("Photos")} ({detail.photos.length})</h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {detail.photos.map((p) => (
                    <a key={p.name} href={p.image} target="_blank" rel="noreferrer" className="block">
                      <img src={p.image} alt={p.stage} className="aspect-square w-full rounded-xl object-cover" />
                      <span className="text-xs text-zinc-500">{p.stage}{p.note ? ` · ${p.note}` : ""}</span>
                    </a>
                  ))}
                </div>
              </div>
              {detail.start_lat != null && (
                <Link to={`/cleaning-map?visit=${detail.name}`} className="inline-flex items-center gap-1 font-medium text-brand-700">
                  <MapPin className="size-4" /> {t("See on the map")}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
