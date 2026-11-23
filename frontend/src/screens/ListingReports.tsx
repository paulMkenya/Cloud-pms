import { useCallback, useEffect, useState } from "react"
import { Download } from "lucide-react"

import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { call, serverError } from "../lib/api"
import { downloadCsv } from "../lib/csv"
import { fmtAmount } from "../lib/money"
import { useT } from "../lib/i18n"
import { useRealtime } from "../lib/realtime"

/** Per-listing trading report: every bookable unit's room nights, bookings,
 *  revenue, ADR, occupancy and RevPAR over a date span - portfolio-wide or
 *  one property at a time (kamra.reports.listing_report). */

interface Listing {
  room: string
  room_number: string
  room_type: string
  property: string
  property_name: string
  nights_sold: number
  bookings: number
  room_revenue: number
  adr: number
  occupancy_pct: number
  revpar: number
}
interface PropRow {
  property: string
  property_name: string
  units: number
  nights_sold: number
  bookings: number
  room_revenue: number
  adr: number
  occupancy_pct: number
}
interface Report {
  from_date: string
  to_date: string
  days: number
  properties: PropRow[]
  listings: Listing[]
  totals: { properties: number; units: number; nights_sold: number; bookings: number; room_revenue: number }
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ListingReports() {
  const { t } = useT()
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(todayStr())
  const [prop, setProp] = useState("")
  const [props, setProps] = useState<PropRow[]>([])
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    call<Report>("kamra.reports.listing_report", {
      property: prop || null, from_date: from, to_date: to,
    }).then((r) => { setData(r); setProps(r.properties) })
      .catch((e) => setError(serverError(e)))
  }, [from, to, prop])
  useEffect(load, [load])
  useRealtime(load)

  const exportCsv = () => {
    if (!data) return
    downloadCsv("listing-report.csv",
      ["Property", "Unit", "Room type", "Nights sold", "Bookings",
       "Room revenue", "ADR", "Occupancy %", "RevPAR"],
      data.listings.map((l) => [
        l.property_name, l.room_number, l.room_type, l.nights_sold,
        l.bookings, l.room_revenue, l.adr, l.occupancy_pct, l.revpar,
      ]))
  }

  const byProp = new Map<string, Listing[]>()
  for (const l of data?.listings ?? []) {
    const k = l.property
    if (!byProp.has(k)) byProp.set(k, [])
    byProp.get(k)!.push(l)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">{t("Per-listing report")}</h1>
        <input type="date" className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-zinc-400">→</span>
        <input type="date" className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={prop} onChange={(e) => setProp(e.target.value)}>
          <option value="">{t("All properties")}</option>
          {(props.length ? props : data?.properties ?? []).map((p) => (
            <option key={p.property} value={p.property}>{p.property_name}</option>
          ))}
        </select>
        <Button variant="outline" className="ms-auto" onClick={exportCsv} disabled={!data}>
          <Download className="size-4" aria-hidden />{t("Export CSV")}
        </Button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              [t("Properties"), data.totals.properties],
              [t("Units"), data.totals.units],
              [t("Nights sold"), data.totals.nights_sold],
              [t("Bookings"), data.totals.bookings],
              [t("Room revenue"), fmtAmount(data.totals.room_revenue)],
            ].map(([label, v]) => (
              <Card key={String(label)}><CardContent className="p-3">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="mt-1 text-lg font-semibold">{v}</p>
              </CardContent></Card>
            ))}
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="m-cards w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2">{t("Listing")}</th>
                    <th className="px-4 py-2 text-right">{t("Nights")}</th>
                    <th className="px-4 py-2 text-right">{t("Bookings")}</th>
                    <th className="px-4 py-2 text-right">{t("Revenue")}</th>
                    <th className="px-4 py-2 text-right">{t("ADR")}</th>
                    <th className="px-4 py-2 text-right">{t("Occupancy")}</th>
                    <th className="px-4 py-2 text-right">{t("RevPAR")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byProp.entries()].map(([pk, rows]) => {
                    const sub = data.properties.find((p) => p.property === pk)
                    return (
                      <PropertyGroup key={pk} name={sub?.property_name ?? pk}
                        rows={rows} subtotal={sub} />
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <p className="text-xs text-zinc-400">
            {t("Room revenue is posted folio room charges for {from} to {to} - the same basis as the invoices, never estimates.", { from: data.from_date, to: data.to_date })}
          </p>
        </>
      )}
    </div>
  )
}

function PropertyGroup({ name, rows, subtotal }: {
  name: string
  rows: Listing[]
  subtotal?: PropRow
}) {
  const { t } = useT()
  return (
    <>
      <tr className="bg-zinc-50">
        <td className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600" colSpan={7}>
          {name}
          {subtotal && (
            <span className="ms-2 font-normal normal-case text-zinc-400">
              {t("{n} units · occ {occ}% · ADR {adr}", {
                n: subtotal.units, occ: subtotal.occupancy_pct, adr: fmtAmount(subtotal.adr) })}
            </span>
          )}
        </td>
      </tr>
      {rows.map((l) => (
        <tr key={l.room} className="border-b border-zinc-100">
          <td className="px-4 py-1.5 ps-8">
            <span className="font-medium">{l.room_number}</span>
            {l.room_type && <span className="ms-2 text-xs text-zinc-400">{l.room_type}</span>}
          </td>
          <td className="px-4 py-1.5 text-right">{l.nights_sold}</td>
          <td className="px-4 py-1.5 text-right">{l.bookings}</td>
          <td className="px-4 py-1.5 text-right font-medium">{fmtAmount(l.room_revenue)}</td>
          <td className="px-4 py-1.5 text-right">{l.adr ? fmtAmount(l.adr) : "-"}</td>
          <td className="px-4 py-1.5 text-right">
            <Badge tone={l.occupancy_pct >= 70 ? "green" : l.occupancy_pct >= 40 ? "amber" : "zinc"}>
              {l.occupancy_pct}%
            </Badge>
          </td>
          <td className="px-4 py-1.5 text-right">{l.revpar ? fmtAmount(l.revpar) : "-"}</td>
        </tr>
      ))}
    </>
  )
}
