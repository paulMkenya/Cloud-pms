import { useCallback, useEffect, useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import type { ShellContext } from "../AppShell"
import { call, setCurrentProperty } from "../lib/api"
import { serverError } from "../lib/resource"
import { Button } from "../components/ui/button"
import { cn } from "../lib/utils"
import { cur, moneyLocale } from "../lib/money"
import { useT, uiDateLocale } from "../lib/i18n"

/** Portfolio dashboard: one KPI strip per property plus portfolio totals -
 *  occupancy, today's movement, unpaid holds, open housekeeping tasks,
 *  month-to-date collections and guest balances. Numbers come from
 *  kamra.api.portfolio_summary, the same rules as the per-property
 *  screens. */

interface PropertyKPI {
  name: string
  property_name: string
  rooms: number
  in_house: number
  arrivals: number
  departures: number
  pending_payment: number
  hk_open: number
  mtd_collections: number
  guest_balance: number
}

interface Totals {
  properties: number
  rooms: number
  in_house: number
  arrivals: number
  departures: number
  pending_payment: number
  hk_open: number
  mtd_collections: number
  guest_balance: number
}

interface Summary {
  date: string
  month_start: string
  properties: PropertyKPI[]
  totals: Totals
}

const kes = (n: number) =>
  `${cur()}${n.toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })}`

function Kpi({ label, value, hint, tone }: {
  label: string; value: string | number; hint?: string
  tone?: "warn" | "bad" | "good"
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums",
        tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600"
          : tone === "good" ? "text-emerald-700" : "text-zinc-900")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </div>
  )
}

export default function PortfolioDashboard() {
  const { t, tn } = useT()
  const navigate = useNavigate()
  const { refreshKey } = useOutletContext<ShellContext>()
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // agent commission (cloudtrade_hospitality): admin/finance only; the
  // call fails or reports enabled=false everywhere else -> no cards
  const [commission, setCommission] = useState<{
    enabled: boolean
    commission_mtd?: number
    commission_earned?: number
    host_balances_outstanding?: number
  } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    call<Summary>("kamra.api.portfolio_summary")
      .then(setData)
      .catch((e) => setError(serverError(e)))
      .finally(() => setLoading(false))
    call<{ enabled: boolean }>("cloudtrade_hospitality.agent_commission.commission_summary")
      .then(setCommission)
      .catch(() => setCommission(null))
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const open = (name: string, path: string) => {
    setCurrentProperty(name)
    navigate(path)
  }

  const dateLabel = data?.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString(
        uiDateLocale(moneyLocale()),
        { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : ""

  const tot = data?.totals

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-zinc-900">{t("Portfolio")}</h1>
        {dateLabel && <span className="text-sm text-zinc-500">{dateLabel}</span>}
        <Button variant="outline" className="ms-auto" onClick={load} disabled={loading}>
          {loading ? t("Loading…") : t("Refresh")}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!data && !error && (
        <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      )}

      {data && tot && (
        <>
          {/* portfolio totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label={t("Properties")} value={tot.properties} />
            <Kpi label={t("Rooms")} value={tot.rooms}
              hint={tot.in_house > 0 ? tn(tot.in_house, "{n} occupied", "{n} occupied") : undefined} />
            <Kpi label={t("In house")} value={tot.in_house} />
            <Kpi label={t("Arrivals today")} value={tot.arrivals} />
            <Kpi label={t("Departures today")} value={tot.departures} />
            <Kpi label={t("Awaiting payment")} value={tot.pending_payment}
              tone={tot.pending_payment > 0 ? "warn" : undefined}
              hint={tot.pending_payment > 0 ? t("unpaid holds") : undefined} />
            <Kpi label={t("Open HK tasks")} value={tot.hk_open}
              tone={tot.hk_open > 0 ? "warn" : undefined} />
            <Kpi label={t("Collected MTD")} value={kes(tot.mtd_collections)} />
            <Kpi label={t("Guest balances")} value={kes(tot.guest_balance)}
              tone={tot.guest_balance > 0 ? "bad" : undefined} />
            {commission?.enabled && (
              <>
                <Kpi label={t("Commission MTD")} value={kes(commission.commission_mtd ?? 0)}
                  hint={t("Earned {amt}", { amt: kes(commission.commission_earned ?? 0) })} />
                <Kpi label={t("Owed to hosts")} value={kes(commission.host_balances_outstanding ?? 0)}
                  tone={(commission.host_balances_outstanding ?? 0) > 0 ? "warn" : undefined} />
              </>
            )}
          </div>

          {/* per-property table */}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-start text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2.5 text-start font-medium">{t("Property")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Rooms")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("In house")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Arrivals")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Departures")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Awaiting payment")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("HK tasks")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Collected MTD")}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t("Balances")}</th>
                </tr>
              </thead>
              <tbody>
                {data.properties.map((p) => (
                  <tr key={p.name}
                    className="cursor-pointer border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50"
                    onClick={() => open(p.name, "/tape")}>
                    <td className="px-4 py-2.5 font-medium text-zinc-800">
                      {p.property_name}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-zinc-600">{p.rooms}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-zinc-600">{p.in_house}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-zinc-600">{p.arrivals}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-zinc-600">{p.departures}</td>
                    <td className={cn("px-3 py-2.5 text-end tabular-nums font-medium",
                      p.pending_payment > 0 ? "text-amber-600" : "text-zinc-600")}>
                      {p.pending_payment}
                    </td>
                    <td className={cn("px-3 py-2.5 text-end tabular-nums",
                      p.hk_open > 0 ? "font-medium text-amber-600" : "text-zinc-600")}>
                      {p.hk_open}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-zinc-700">{kes(p.mtd_collections)}</td>
                    <td className={cn("px-4 py-2.5 text-end tabular-nums",
                      p.guest_balance > 0 ? "font-medium text-rose-600" : "text-zinc-600")}>
                      {kes(p.guest_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                  <td className="px-4 py-2.5">{t("Total")}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{tot.rooms}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{tot.in_house}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{tot.arrivals}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{tot.departures}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-amber-600">{tot.pending_payment}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{tot.hk_open}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{kes(tot.mtd_collections)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-rose-600">{kes(tot.guest_balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-zinc-400">
            {t("Click a property to open its Tape Chart. Figures use the same rules as each property's own dashboard.")}
          </p>
        </>
      )}
    </div>
  )
}
