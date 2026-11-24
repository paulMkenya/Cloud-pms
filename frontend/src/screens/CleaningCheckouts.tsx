/** Housekeeping > Checkouts: every checkout in the coming days (desk
 *  bookings and Airbnb / Booking.com guests) and the cleaner each one is
 *  given to. The cleaner gets a heads-up when given the checkout and the
 *  job ("ready for cleaning") when the guest has left.
 *  Server: cloudtrade_hospitality.allocations. */
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, Clock } from "lucide-react"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"

interface Row {
  property: string
  label: string
  date: string
  source: string
  guest?: string | null
  checkout_time: string
  next_guest?: string | null
  cleaner?: string | null
  cleaner_phone?: string | null
  heads_up?: string | null
  job?: string | null
  job_status?: string | null
  checked_out?: boolean
  gone?: boolean
}
interface Cleaner { name: string; phone: string; properties: string[]; test: boolean }
interface Board { rows: Row[]; cleaners: Cleaner[] }

const M = "cloudtrade_hospitality.allocations."
const dayLabel = (d: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const x = new Date(`${d}T00:00:00`)
  const n = Math.round((x.getTime() - today.getTime()) / 86_400_000)
  const nice = x.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
  return n === 0 ? `Today · ${nice}` : n === 1 ? `Tomorrow · ${nice}` : nice
}

export default function CleaningCheckouts() {
  const { t } = useT()
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const load = useCallback(() => {
    call<Board>(M + "board", { days }).then((d) => { setData(d); setErr(null) }).catch((e) => setErr(serverError(e)))
  }, [days])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const g: Record<string, Row[]> = {}
    for (const r of data?.rows || []) (g[r.date] ||= []).push(r)
    return Object.entries(g)
  }, [data])

  async function assign(r: Row, phone: string) {
    const key = `${r.property}|${r.date}`
    setSaving(key)
    setErr(null)
    try {
      setData(await call<Board>(M + "set_cleaner", { property: r.property, date: r.date, phone }))
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setSaving(null)
    }
  }

  const unassigned = (data?.rows || []).filter((r) => !r.cleaner && !r.gone && !r.job).length

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-zinc-900">{t("Checkouts")}</h1>
          <p className="text-sm text-zinc-500">{t("Give each checkout to a cleaner ahead of time. She gets a heads-up now and the job when the guest has checked out.")}</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
          {[3, 7, 14].map((d) => <option key={d} value={d}>{t("Next {n} days", { n: d })}</option>)}
        </select>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      {data && unassigned > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="size-4" /> {t("{n} checkout(s) have no cleaner yet.", { n: unassigned })}
        </p>
      )}
      {data && data.cleaners.length === 0 && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">{t("No cleaners yet. On WhatsApp: cleaner add Mary 0712345678 Milimani")}</p>
      )}
      {!data ? <p className="text-sm text-zinc-500">{t("Loading…")}</p>
        : groups.length === 0 ? <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">{t("No checkouts in these days.")}</p>
        : groups.map(([date, rows]) => (
          <section key={date} className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-700">{dayLabel(date)}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {rows.map((r) => {
                const key = `${r.property}|${r.date}`
                // the house's own cleaners first, then everyone else
                const own = data.cleaners.filter((c) => c.properties.includes(r.property))
                const others = data.cleaners.filter((c) => !c.properties.includes(r.property))
                const done = r.job_status === "Done" || r.job_status === "Verified"
                return (
                  <li key={key} className="flex flex-wrap items-center gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900">
                        {r.label} <span className="ms-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600">{r.source}</span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        <Clock className="me-1 inline size-3" />{t("Out by {time}", { time: r.checkout_time })}
                        {r.guest && r.source === "Direct" ? ` · ${r.guest}` : ""}
                        {r.next_guest ? ` · ${t("next guest {when}", { when: r.next_guest })}` : ` · ${t("no guest booked next")}`}
                      </p>
                      <p className="text-xs">
                        {r.gone ? <span className="text-rose-700">{t("This stay changed - the checkout is no longer on this day.")}</span>
                          : done ? <span className="text-emerald-700"><Check className="me-1 inline size-3" />{t("Cleaned")}</span>
                          : r.job ? <span className="text-brand-700">{t("Guest left - job sent ({status})", { status: r.job_status || "" })}</span>
                          : r.cleaner ? <span className="text-zinc-600">{r.heads_up ? t("Heads-up sent") : ""}</span>
                          : <span className="text-amber-700">{t("No cleaner - the house's cleaners get it at checkout")}</span>}
                      </p>
                    </div>
                    <select value={r.cleaner_phone || ""} disabled={saving === key || done || !!r.gone}
                      onChange={(e) => void assign(r, e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 px-2 py-2 text-sm sm:w-56">
                      <option value="">{t("- No cleaner -")}</option>
                      {own.length > 0 && <optgroup label={t("Cleans this house")}>
                        {own.map((c) => <option key={c.phone} value={c.phone}>{c.name}{c.test ? " (test)" : ""}</option>)}
                      </optgroup>}
                      {others.length > 0 && <optgroup label={t("Other cleaners")}>
                        {others.map((c) => <option key={c.phone} value={c.phone}>{c.name}{c.test ? " (test)" : ""}</option>)}
                      </optgroup>}
                    </select>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </div>
  )
}
