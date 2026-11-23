/** Home with "All properties" picked: today across every property - who
 *  arrives, leaves and is in house, each line labelled with its property -
 *  and one row per property (in the owner's homepage order). Tapping a line
 *  or a property opens that property's own Today screen. */
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useOutletContext } from "react-router-dom"
import { ChevronRight, LogIn, LogOut, BedDouble } from "lucide-react"
import { call, myProperties, serverError, type PropertyRow, type ReservationRow, type Snapshot } from "../lib/api"
import { useT } from "../lib/i18n"
import type { ShellContext } from "../AppShell"

type Line = ReservationRow & { property: string; property_name: string }

const fmtMoney = (n: number) => `KES ${Math.round(n).toLocaleString()}`

export default function AllPropertiesToday({ onOpen }: { onOpen: (property: string) => void }) {
  const { t } = useT()
  const { refreshKey } = useOutletContext<ShellContext>()
  const [props, setProps] = useState<PropertyRow[] | null>(null)
  const [snaps, setSnaps] = useState<Record<string, Snapshot | null>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const mine = await myProperties()
      // the owner's order (Settings > Order of properties), then the rest
      let order: string[] = []
      try {
        const r = await call<{ properties: { name: string }[] }>("cloudtrade_hospitality.property_order.get_order")
        order = r.properties.map((p) => p.name)
      } catch {
        /* alphabetical */
      }
      const rank = (n: string) => (order.indexOf(n) < 0 ? 999 : order.indexOf(n))
      const sorted = [...mine].sort((a, b) => rank(a.name) - rank(b.name) || a.property_name.localeCompare(b.property_name))
      setProps(sorted)
      const results = await Promise.all(
        sorted.map((p) =>
          call<Snapshot>("kamra.api.front_desk_snapshot", { property: p.name }).catch(() => null),
        ),
      )
      setSnaps(Object.fromEntries(sorted.map((p, i) => [p.name, results[i]])))
      setError(null)
    } catch (e) {
      setError(serverError(e))
    }
  }, [])
  useEffect(() => {
    void load()
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 120_000)
    return () => clearInterval(id)
  }, [load, refreshKey])

  const lines = (key: "arrivals" | "departures" | "in_house"): Line[] =>
    (props || []).flatMap((p) =>
      (snaps[p.name]?.[key] || []).map((r) => ({ ...r, property: p.name, property_name: p.property_name })),
    )
  const arrivals = lines("arrivals")
  const departures = lines("departures")
  const inHouse = lines("in_house")
  const dueOnArrival = arrivals.reduce((s, r) => s + (Number(r.balance_due) || 0), 0)
  const loading = props === null || Object.keys(snaps).length === 0

  const section = (title: string, icon: ReactNode, rows: Line[], empty: string, showBalance = false) => (
    <section className="rounded-2xl border border-zinc-200 bg-white">
      <h2 className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-800">
        {icon} {title} <span className="font-normal text-zinc-400">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <li key={`${r.property}-${r.name}`}>
              <button type="button" onClick={() => onOpen(r.property)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-zinc-50 max-sm:min-h-12">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{r.guest_name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {r.property_name}
                    {r.room ? ` · ${r.room.replace(`${r.property}-`, "")}` : ""} · {r.nights} {r.nights === 1 ? t("night") : t("nights")}
                    {r.channel ? ` · ${r.channel}` : ""}
                  </span>
                </span>
                {showBalance && (Number(r.balance_due) || 0) > 0 && (
                  <span className="shrink-0 text-xs font-medium text-amber-700">{t("due")} {fmtMoney(r.balance_due)}</span>
                )}
                <ChevronRight className="size-4 shrink-0 text-zinc-300 rtl:rotate-180" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">{t("All properties - today")}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {t("Every property at a glance. Tap a guest or a property to open it; pick a property at the top to work in it.")}
        </p>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t("Arriving today"), arrivals.length],
          [t("Leaving today"), departures.length],
          [t("In house"), inHouse.length],
          [t("Due from arrivals"), loading ? "…" : fmtMoney(dueOnArrival)],
        ].map(([label, v]) => (
          <div key={String(label)} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">{loading ? "…" : v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {section(t("Arriving today"), <LogIn className="size-4 text-emerald-600" aria-hidden />, arrivals, t("No arrivals today."), true)}
        {section(t("Leaving today"), <LogOut className="size-4 text-sky-600" aria-hidden />, departures, t("No departures today."), true)}
      </div>
      {section(t("In house"), <BedDouble className="size-4 text-zinc-500" aria-hidden />, inHouse, t("Nobody in house."))}
      <section className="rounded-2xl border border-zinc-200 bg-white">
        <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-800">{t("Properties")}</h2>
        <ul className="divide-y divide-zinc-100">
          {(props || []).map((p) => {
            const s = snaps[p.name]
            return (
              <li key={p.name}>
                <button type="button" onClick={() => onOpen(p.name)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-zinc-50 max-sm:min-h-12">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-900">{p.property_name}</span>
                    <span className="block text-xs text-zinc-500">
                      {s
                        ? `${s.arrivals.length} ${t("arriving")} · ${s.departures.length} ${t("leaving")} · ${s.in_house.length} ${t("in house")}`
                        : loading ? "…" : t("Could not load")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand-700">{t("Open")}</span>
                  <ChevronRight className="size-4 shrink-0 text-zinc-300 rtl:rotate-180" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
