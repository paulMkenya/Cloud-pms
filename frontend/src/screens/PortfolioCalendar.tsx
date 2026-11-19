import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useOutletContext } from "react-router-dom"
import type { ShellContext } from "../AppShell"
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react"
import { call } from "../lib/api"
import { Button } from "../components/ui/button"
import { cn } from "../lib/utils"
import { cur, moneyLocale } from "../lib/money"
import { useT, uiDateLocale } from "../lib/i18n"

/** Portfolio calendar: every property the user can see on one rooms ×
 *  dates grid - the multi-property answer to "what's booked where".
 *  Read-only aggregate of kamra.api.tape_chart_portfolio; working a stay
 *  still happens on that property's own Tape Chart. */

interface TapeBooking {
  name: string
  room: string
  guest_name: string
  status: "Confirmed" | "Checked In"
  check_in_date: string
  check_out_date: string
  is_day_use: 0 | 1
  vip?: 0 | 1
  source?: string
  planned_check_in_time?: string | null
  planned_check_out_time?: string | null
}

interface TapeBlock {
  name: string
  reason: string
  from_date: string
  to_date: string
  note?: string | null
}

interface TapeRoom {
  name: string
  room_number: string
  room_type: string
  room_type_name?: string
  housekeeping_status: string
  bookings: TapeBooking[]
  blocks?: TapeBlock[]
}

interface PositionCell {
  date: string
  sold: number
  capacity: number
  occupancy: number
  limit: number
  overbooked: boolean
  premium_pct: number
}

interface PortfolioProperty {
  name: string
  property_name: string
  start: string
  days: number
  dates: string[]
  rooms: TapeRoom[]
  position: PositionCell[]
  conflicts: { room: string; date: string; in_res: string; out_res: string }[]
}

const LABEL_W = 200
const CELL_W = 56
const DAY_MS = 86_400_000

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Local-day index of `date` relative to `start` (both YYYY-MM-DD). */
function dayIndex(date: string, start: string) {
  const a = new Date(start + "T00:00:00").getTime()
  const b = new Date(date + "T00:00:00").getTime()
  return Math.round((b - a) / DAY_MS)
}

export default function PortfolioCalendar() {
  const { t, tn } = useT()
  const { refreshKey } = useOutletContext<ShellContext>()
  const [start, setStart] = useState(() => iso(new Date()))
  const [days, setDays] = useState(14)
  const [data, setData] = useState<PortfolioProperty[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    call<PortfolioProperty[]>("kamra.api.tape_chart_portfolio", {
      start_date: start,
      days,
    })
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [start, days])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const shift = (byDays: number) => {
    const d = new Date(start + "T00:00:00")
    d.setDate(d.getDate() + byDays)
    setStart(iso(d))
  }

  const todayIso = iso(new Date())
  const dates = useMemo(
    () => data?.[0]?.dates ?? [],
    [data],
  )

  const rangeLabel = useMemo(() => {
    if (!dates.length) return ""
    const f = new Date(dates[0] + "T00:00:00")
    const l = new Date(dates[dates.length - 1] + "T00:00:00")
    const fmt = (d: Date, withYear: boolean) =>
      d.toLocaleDateString(uiDateLocale(moneyLocale()), {
        day: "numeric",
        month: "short",
        ...(withYear ? { year: "numeric" } : {}),
      })
    return `${fmt(f, f.getFullYear() !== l.getFullYear())} – ${fmt(l, true)}`
  }, [dates])

  /** Clip a [from,to) stay onto the visible window; null when outside. */
  const span = (from: string, to: string) => {
    const s = Math.max(0, dayIndex(from, dates[0] ?? start))
    const e = Math.min(days, dayIndex(to, dates[0] ?? start))
    if (e <= s || e <= 0 || s >= days) return null
    return { s, e }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-zinc-900">{t("Portfolio calendar")}</h1>
        {rangeLabel && <span className="text-sm text-zinc-500">{rangeLabel}</span>}
        <div className="ms-auto flex items-center gap-1.5">
          <Button variant="outline" onClick={() => shift(-7)} aria-label={t("Previous week")}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setStart(todayIso)}>
            {t("Today")}
          </Button>
          <Button variant="outline" onClick={() => shift(7)} aria-label={t("Next week")}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <select
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t("Days shown")}
          >
            <option value={7}>{t("7 days")}</option>
            <option value={14}>{t("14 days")}</option>
            <option value={21}>{t("3 weeks")}</option>
            <option value={31}>{t("31 days")}</option>
          </select>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? t("Loading…") : t("Refresh")}
          </Button>
        </div>
      </div>

      {failed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {t("Could not load the portfolio calendar. Try again.")}
        </div>
      )}

      {!failed && !data && (
        <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      )}

      {data && data.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-400">
          {t("No properties available for your account.")}
        </p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div style={{ minWidth: LABEL_W + days * CELL_W }}>
            {/* date header - shared by every property below */}
            <div className="flex border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
              <div className="shrink-0 px-3 py-2" style={{ width: LABEL_W }}>{t("Property / room")}</div>
              {dates.map((d) => {
                const day = new Date(d + "T00:00:00")
                const weekend = day.getDay() === 0 || day.getDay() === 6
                const isToday = d === todayIso
                return (
                  <div key={d} style={{ width: CELL_W }}
                    className={cn("shrink-0 border-l border-zinc-100 px-0.5 py-2 text-center",
                      weekend && "bg-brand-50 text-brand-700",
                      isToday && "font-bold text-brand-700")}>
                    {day.toLocaleDateString(uiDateLocale(moneyLocale()), { weekday: "short" })}{" "}
                    <span className="font-semibold">{day.getDate()}</span>
                  </div>
                )
              })}
            </div>

            {data.map((p) => {
              const conflictRooms = new Set(p.conflicts.map((c) => c.room))
              const conflictRes = new Set(p.conflicts.flatMap((c) => [c.in_res, c.out_res]))
              const soldToday = p.position.find((x) => x.date === dates[0])
              const arrivals = p.rooms.reduce(
                (n, r) => n + r.bookings.filter((b) => b.check_in_date === dates[0]).length, 0)
              const departures = p.rooms.reduce(
                (n, r) => n + r.bookings.filter((b) => b.check_out_date === dates[0]).length, 0)

              return (
                <div key={p.name} className="border-b border-zinc-200 last:border-b-0">
                  {/* property header */}
                  <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-100/70 px-3 py-2">
                    <div className="shrink-0 truncate text-sm font-semibold text-zinc-800" style={{ width: LABEL_W }}>
                      {p.property_name}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{tn(p.rooms.length, "{n} room", "{n} rooms")}</span>
                      {soldToday && (
                        <span className={cn(
                          soldToday.overbooked ? "font-semibold text-rose-600"
                            : soldToday.occupancy >= 80 ? "font-semibold text-emerald-700"
                              : "text-zinc-600")}>
                          {soldToday.sold}/{soldToday.capacity} {t("sold")}
                          {soldToday.occupancy ? ` (${soldToday.occupancy}%)` : ""}
                        </span>
                      )}
                      {arrivals > 0 && <span>{tn(arrivals, "{n} arrival", "{n} arrivals")}</span>}
                      {departures > 0 && <span>{tn(departures, "{n} departure", "{n} departures")}</span>}
                    </div>
                  </div>

                  {/* sold/capacity strip */}
                  {p.position.length > 0 && (
                    <div className="flex border-b border-zinc-100 bg-white">
                      <div className="shrink-0 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400"
                        style={{ width: LABEL_W }}>{t("Position")}</div>
                      {p.position.map((pos) => (
                        <div key={pos.date} style={{ width: CELL_W }}
                          title={t("{sold}/{capacity} sold ({occupancy}%)", {
                            sold: pos.sold, capacity: pos.capacity, occupancy: pos.occupancy })}
                          className={cn("shrink-0 border-l border-zinc-100 px-0.5 py-1 text-center text-[10px] tabular-nums",
                            pos.overbooked ? "bg-rose-50 font-bold text-rose-600"
                              : pos.occupancy >= 80 ? "bg-emerald-50 font-semibold text-emerald-700"
                                : pos.occupancy >= 50 ? "text-amber-600" : "text-zinc-400")}>
                          {pos.sold}/{pos.capacity}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* rooms */}
                  {p.rooms.length === 0 && (
                    <div className="px-3 py-3 text-sm text-zinc-400" style={{ paddingInlineStart: LABEL_W + 12 }}>
                      {t("No rooms")}
                    </div>
                  )}
                  {p.rooms.map((room) => {
                    const hasConflict = conflictRooms.has(room.name)
                    return (
                      <div key={room.name} className="flex border-b border-zinc-50 last:border-b-0">
                        <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
                          style={{ width: LABEL_W }}>
                          <span className={cn("size-1.5 shrink-0 rounded-full",
                            room.housekeeping_status === "Clean" ? "bg-emerald-500"
                              : room.housekeeping_status === "Dirty" ? "bg-amber-500"
                                : "bg-zinc-300")} />
                          <span className="truncate text-xs text-zinc-700">
                            {room.room_type_name || room.room_type} · {room.room_number}
                          </span>
                          {hasConflict && (
                            <AlertTriangle className="size-3.5 shrink-0 text-rose-500" aria-label={t("Changeover conflict")} />
                          )}
                        </div>
                        <div className="relative shrink-0" style={{ width: days * CELL_W, height: 42 }}>
                          {/* day grid + weekend/today tint */}
                          {dates.map((d, i) => {
                            const day = new Date(d + "T00:00:00")
                            const weekend = day.getDay() === 0 || day.getDay() === 6
                            return (
                              <div key={d} className={cn("absolute top-0 h-full border-l border-zinc-100",
                                weekend && "bg-brand-50/50", d === todayIso && "bg-brand-100/40")}
                                style={{ insetInlineStart: i * CELL_W, width: CELL_W }} />
                            )
                          })}
                          {/* room blocks (house use, maintenance) */}
                          {(room.blocks || []).map((b) => {
                            const sp = span(b.from_date, b.to_date)
                            if (!sp) return null
                            return (
                              <div key={b.name}
                                className="absolute top-1 flex h-4 items-center truncate rounded-sm border border-zinc-300 bg-[repeating-linear-gradient(45deg,#e4e4e7_0_4px,#f4f4f5_4px_8px)] px-1 text-[9px] font-medium uppercase tracking-wide text-zinc-500"
                                style={{ insetInlineStart: sp.s * CELL_W + 2, width: Math.max(8, (sp.e - sp.s) * CELL_W - 4) }}
                                title={`${b.reason}${b.note ? ` - ${b.note}` : ""}`}>
                                {b.reason}
                              </div>
                            )
                          })}
                          {/* booking bars */}
                          {room.bookings.map((b) => {
                            const sp = span(b.check_in_date, b.check_out_date)
                            if (!sp) return null
                            const eta = b.planned_check_in_time ? String(b.planned_check_in_time).slice(0, 5) : ""
                            const etd = b.planned_check_out_time ? String(b.planned_check_out_time).slice(0, 5) : ""
                            const inConflict = conflictRes.has(b.name)
                            return (
                              <Link key={b.name} to={`/reservations?open=${b.name}`}
                                className={cn(
                                  "absolute top-2 flex h-8 items-center gap-1 truncate rounded-md px-1.5 text-[11px] font-medium text-white hover:opacity-90",
                                  b.status === "Checked In" ? "bg-brand-600" : "bg-sky-500",
                                  inConflict && "ring-2 ring-rose-500 ring-offset-1",
                                )}
                                style={{
                                  insetInlineStart: sp.s * CELL_W + 2,
                                  width: Math.max(8, (sp.e - sp.s) * CELL_W - 4),
                                }}
                                title={`${b.guest_name} · ${b.check_in_date}${eta ? ` ${eta}` : ""} → ${b.check_out_date}${etd ? ` ${etd}` : ""}${b.is_day_use ? ` · ${t("Day use")}` : ""}${inConflict ? ` · ${t("CHANGEOVER CONFLICT")}` : ""}`}>
                                {b.vip ? <span className="text-amber-300">★</span> : null}
                                <span className="truncate">{b.guest_name}</span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-6 rounded-sm bg-brand-600" /> {t("Checked in")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-6 rounded-sm bg-sky-500" /> {t("Confirmed")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-6 rounded-sm border border-zinc-300 bg-[repeating-linear-gradient(45deg,#e4e4e7_0_4px,#f4f4f5_4px_8px)]" /> {t("Blocked")}
          </span>
          <span className="ms-auto">{cur()}{" "}{t("rates and availability stay per-property on each Tape Chart")}</span>
        </div>
      )}
    </div>
  )
}
