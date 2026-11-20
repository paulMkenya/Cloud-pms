import { useCallback, useEffect, useMemo, useState } from "react"
import { useRealtime } from "../lib/realtime"
import { CalendarDays, TrendingUp, Wallet } from "lucide-react"

import { Badge } from "../components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { call, serverError } from "../lib/api"
import { fmtAmount } from "../lib/money"
import { useT } from "../lib/i18n"

/** Property owner portal: read-only calendar, earnings and monthly
 *  statement for the units this login owns (kamra.owner_portal). */

interface PortalProp {
  name: string
  property_name: string
  owner_name: string | null
  commission_pct: number
  units: number
}
interface MonthLine {
  reservation: string
  guest_name: string | null
  room: string | null
  check_in: string
  check_out: string
  nights: number
  revenue: number
  ota_commission: number
  status: string
}
interface MonthStmt {
  property: string
  month: string
  commission_pct: number
  bookings: number
  room_revenue: number
  ota_commission: number
  management_fee: number
  owner_share: number
  lines: MonthLine[]
}
interface CalRoom {
  name: string
  number: string
  floor: string | null
  busy: [string, string, string, string][]
}
interface CalData {
  property: string
  start: string
  days: number
  rooms: CalRoom[]
}

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export default function OwnerPortal() {
  const { t } = useT()
  const [props, setProps] = useState<PortalProp[]>([])
  const [prop, setProp] = useState("")
  const [month, setMonth] = useState(thisMonth())
  const [stmt, setStmt] = useState<MonthStmt | null>(null)
  const [cal, setCal] = useState<CalData | null>(null)
  const [tab, setTab] = useState<"statement" | "calendar">("statement")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call<{ properties: PortalProp[] }>("kamra.owner_portal.owner_properties", {})
      .then((r) => {
        setProps(r.properties)
        if (r.properties.length === 1) setProp(r.properties[0].name)
      })
      .catch((e) => setError(serverError(e)))
  }, [])

  const load = useCallback(() => {
    if (!prop) return
    setError(null)
    call<MonthStmt>("kamra.owner_portal.owner_month", { property: prop, month })
      .then(setStmt)
      .catch((e) => setError(serverError(e)))
    call<CalData>("kamra.owner_portal.owner_calendar",
      { property: prop, start_date: `${month}-01`, days: 42 })
      .then(setCal)
      .catch(() => setCal(null))
  }, [prop, month])
  useEffect(load, [load])
  useRealtime(load)

  const dayCells = useMemo(() => {
    if (!cal) return [] as string[]
    const out: string[] = []
    const d = new Date(`${cal.start}T00:00:00`)
    for (let i = 0; i < cal.days; i++) {
      out.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [cal])

  const busyOn = useCallback((room: CalRoom, date: string) =>
    room.busy.find(([s, e]) => date >= s && date < e), [cal])

  if (error) {
    return <div className="mx-auto max-w-lg p-6">
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    </div>
  }
  if (!props.length) {
    return <div className="mx-auto max-w-lg p-6 text-sm text-zinc-500">
      {t("No properties are linked to your account yet - ask the property manager to add your email under the property's Owner settings.")}
    </div>
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">{t("My Property")}</h1>
        {props.length > 1 && (
          <select className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
            value={prop} onChange={(e) => setProp(e.target.value)}>
            {props.map((p) => <option key={p.name} value={p.name}>{p.property_name}</option>)}
          </select>
        )}
        <input type="month" className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="ms-auto flex rounded-lg border border-zinc-200 p-0.5 text-sm">
          {(["statement", "calendar"] as const).map((v) => (
            <button key={v} type="button"
              className={`rounded-md px-3 py-1 ${tab === v ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
              onClick={() => setTab(v)}>
              {v === "statement" ? t("Statement") : t("Calendar")}
            </button>
          ))}
        </div>
      </div>

      {stmt && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardContent className="p-3">
            <p className="flex items-center gap-1 text-xs text-zinc-500"><Wallet className="size-3.5" />{t("Owner share")}</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{fmtAmount(stmt.owner_share)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-xs text-zinc-500">{t("Room revenue")}</p>
            <p className="mt-1 text-lg font-semibold">{fmtAmount(stmt.room_revenue)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-xs text-zinc-500">{t("Management fee ({pct}%)", { pct: stmt.commission_pct })}</p>
            <p className="mt-1 text-lg font-semibold">{fmtAmount(stmt.management_fee)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="flex items-center gap-1 text-xs text-zinc-500"><TrendingUp className="size-3.5" />{t("Bookings")}</p>
            <p className="mt-1 text-lg font-semibold">{stmt.bookings}</p>
          </CardContent></Card>
        </div>
      )}

      {tab === "statement" && stmt && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("Statement - {month}", { month: stmt.month })}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2">{t("Stay")}</th>
                  <th className="px-4 py-2">{t("Guest")}</th>
                  <th className="px-4 py-2">{t("Dates")}</th>
                  <th className="px-4 py-2 text-right">{t("Revenue")}</th>
                  <th className="px-4 py-2 text-right">{t("OTA comm.")}</th>
                  <th className="px-4 py-2">{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {stmt.lines.map((l) => (
                  <tr key={l.reservation} className="border-b border-zinc-100">
                    <td className="px-4 py-2 font-mono text-xs">{l.reservation}</td>
                    <td className="px-4 py-2">{l.guest_name || "-"}</td>
                    <td className="px-4 py-2 text-zinc-600">{l.check_in} → {l.check_out} ({l.nights}n)</td>
                    <td className="px-4 py-2 text-right">{fmtAmount(l.revenue)}</td>
                    <td className="px-4 py-2 text-right text-zinc-500">{l.ota_commission ? fmtAmount(l.ota_commission) : "-"}</td>
                    <td className="px-4 py-2"><Badge tone={l.status === "Checked Out" ? "green" : "sky"}>{l.status}</Badge></td>
                  </tr>
                ))}
                {stmt.lines.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-400">{t("No earning stays this month.")}</td></tr>
                )}
              </tbody>
            </table>
            {stmt.lines.length > 0 && (
              <div className="space-y-1 border-t border-zinc-200 px-4 py-3 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">{t("Room revenue")}</span><span>{fmtAmount(stmt.room_revenue)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t("OTA commissions")}</span><span>-{fmtAmount(stmt.ota_commission)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t("Management fee ({pct}%)", { pct: stmt.commission_pct })}</span><span>-{fmtAmount(stmt.management_fee)}</span></div>
                <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold text-emerald-700">
                  <span>{t("Owner share")}</span><span>{fmtAmount(stmt.owner_share)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "calendar" && cal && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" />{t("Booked nights")}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-3">
            <div className="min-w-[640px]">
              <div className="grid gap-px" style={{ gridTemplateColumns: `7rem repeat(${dayCells.length}, minmax(0,1fr))` }}>
                <div />
                {dayCells.map((d, i) => (
                  <div key={d} className={`pb-1 text-center text-[9px] ${i % 7 === 5 || i % 7 === 6 ? "text-rose-400" : "text-zinc-400"}`}>
                    {new Date(`${d}T00:00:00`).getDate()}
                  </div>
                ))}
                {cal.rooms.map((r) => (
                  <div key={r.name} className="contents">
                    <div className="flex items-center pe-2 text-xs text-zinc-600">{r.number}</div>
                    {dayCells.map((d) => {
                      const b = busyOn(r, d)
                      return (
                        <div key={d} title={b ? `${b[2]}: ${b[3] || b[1]}` : ""}
                          className={`h-6 rounded-sm ${b
                            ? b[2] === "Checked In" ? "bg-emerald-400"
                            : b[2] === "Block" ? "bg-zinc-300"
                            : "bg-sky-400"
                            : "bg-zinc-100"}`} />
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-sky-400" />{t("Booked")}</span>
                <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-emerald-400" />{t("In house")}</span>
                <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-zinc-300" />{t("Blocked")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
