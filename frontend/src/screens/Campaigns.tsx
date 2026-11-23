import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Download, MousePointerClick, X } from "lucide-react"

import { call, serverError } from "../lib/api"
import { useT, t as translate } from "../lib/i18n"

/** Campaign click tracking: every guest-side moment - property views,
 *  bookings, offer/payment/review/check-in link opens, loyalty actions -
 *  per property, for any period, with a drill-down behind every number:
 *  who viewed (device, source, region), which bookings, which payments. */

type Drill = "views" | "bookings" | "payments" | "offers" | "reviews" | "loyalty" | "visitor"

interface Funnel { views: number; bookings: number; payments: number; offers_accepted: number; reviews: number; loyalty: number }
interface Stats {
  from_date: string
  to_date: string
  days: number
  totals: Record<string, number>
  funnel: Funnel
  unique_visitors: number
  breakdown: { sources: Bucket[]; devices: Bucket[]; regions: Bucket[] }
  per_property: { property: string; label: string; counts: Record<string, number>; funnel: Funnel }[]
  recent: {
    when: string
    property: string
    property_label: string
    event: string
    channel: string
    reference: string
    visitor: string
    reservation: string
    guest: string
    device: string
    source: string
    where: string
  }[]
}
interface Bucket { label: string; count: number }
interface DrillRow {
  when: string
  event?: string
  property_label?: string
  reservation?: string
  guest?: string
  reference?: string
  visitor?: string
  visits?: number
  device?: string
  os?: string
  browser?: string
  source?: string
  campaign?: string
  where?: string
  lang?: string
  page?: string
  amount?: number
  paid?: number
  status?: string
  check_in?: string
  check_out?: string
}

const EVENT_LABELS: Record<string, string> = {
  catalog_view: "Browse /book",
  listing_view: "Property page view",
  booking_created: "Booking created",
  inquiry_sent: "Inquiry sent",
  offer_view: "Offer link opened",
  offer_accepted: "Offer accepted",
  offer_declined: "Offer declined",
  payment_click: "Payment link opened",
  payment_received: "Payment received",
  checkin_view: "Pre-check-in opened",
  review_view: "Review link opened",
  review_submitted: "Review submitted",
  loyalty_view: "Loyalty page viewed",
  loyalty_enrolled: "Loyalty enrolment",
  loyalty_redeemed: "Loyalty voucher redeemed",
}

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "180", label: "Last 180 days" },
  { id: "custom", label: "Custom dates" },
]

const kes = (n?: number) =>
  n || n === 0 ? `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""
const shortWhen = (w: string) => w.slice(0, 16).replace("T", " ")
const visitorLabel = (v?: string) => (v ? `#${v.slice(2, 8)}` : "")

export default function Campaigns() {
  const { t } = useT()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState("today")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [prop, setProp] = useState("")
  const [drill, setDrill] = useState<{ kind: Drill; property?: string; visitor?: string; title: string } | null>(null)

  const period = useMemo(() => {
    if (preset === "today" || preset === "yesterday") return { preset }
    if (preset === "custom") return from || to ? { from_date: from || to, to_date: to || from } : { days: 30 }
    return { days: Number(preset) }
  }, [preset, from, to])

  const load = useCallback(() => {
    setError(null)
    call<Stats>("kamra.track.campaign_stats", { ...period, property: prop || undefined })
      .then(setStats)
      .catch((e) => setError(serverError(e)))
  }, [period, prop])
  useEffect(load, [load])

  const open = (kind: Drill, title: string, property?: string, visitor?: string) =>
    setDrill({ kind, title, property: property ?? (prop || undefined), visitor })

  const funnelCards = useMemo(() => {
    const f = stats?.funnel
    if (!f) return []
    return [
      { kind: "views" as Drill, label: t("Page views"), value: f.views,
        sub: stats ? t("{n} visitors", { n: stats.unique_visitors }) : "" },
      { kind: "bookings" as Drill, label: t("Bookings"), value: f.bookings, sub: t("all channels") },
      { kind: "payments" as Drill, label: t("Payments"), value: f.payments, sub: "" },
      { kind: "offers" as Drill, label: t("Offers accepted"), value: f.offers_accepted, sub: "" },
      { kind: "reviews" as Drill, label: t("Reviews"), value: f.reviews, sub: "" },
      { kind: "loyalty" as Drill, label: t("Loyalty actions"), value: f.loyalty, sub: "" },
    ]
  }, [stats, t])

  const periodLabel = stats
    ? stats.from_date === stats.to_date ? stats.from_date : `${stats.from_date} → ${stats.to_date}`
    : ""

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900">
            <MousePointerClick className="size-5 text-brand-700" aria-hidden />
            {t("Campaign tracking")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {t("Every guest click that matters, per property. Click any number to see the visits, bookings or payments behind it.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("Property")}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={prop} onChange={(e) => setProp(e.target.value)}>
            <option value="">{t("All properties")}</option>
            {(stats?.per_property ?? []).filter((p) => p.property !== "(all)").map((p) => (
              <option key={p.property} value={p.property}>{p.label}</option>
            ))}
          </select>
          <select aria-label={t("Period")}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" aria-label={t("From")} value={from} onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm" />
              <span className="text-xs text-zinc-400">→</span>
              <input type="date" aria-label={t("To")} value={to} onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm" />
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{translate(error)}</p>
      )}
      {!stats ? (
        <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">{t("Period")}: {periodLabel}</p>

          {/* funnel - every card drills down */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {funnelCards.map((c) => (
              <button key={c.label} type="button" onClick={() => open(c.kind, c.label)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-start transition hover:border-brand-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand-600">
                <p className="text-2xl font-semibold tabular-nums text-zinc-900">{c.value}</p>
                <p className="text-xs text-zinc-500">{c.label}</p>
                {c.sub && <p className="mt-0.5 text-[11px] text-zinc-400">{c.sub}</p>}
              </button>
            ))}
          </div>

          {/* where the views come from */}
          <div className="grid gap-3 md:grid-cols-3">
            {([
              [t("Where visitors come from"), stats.breakdown.sources],
              [t("Devices"), stats.breakdown.devices],
              [t("Visitor location (time zone)"), stats.breakdown.regions],
            ] as [string, Bucket[]][]).map(([title, rows]) => {
              const max = Math.max(1, ...rows.map((r) => r.count))
              return (
                <div key={title} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <p className="text-sm font-medium text-zinc-800">{title}</p>
                  {rows.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-400">{t("Collected for visits from now on.")}</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {rows.map((r) => (
                        <li key={r.label} className="text-xs">
                          <div className="flex justify-between gap-2 text-zinc-600">
                            <span className="truncate">{r.label}</span>
                            <span className="tabular-nums text-zinc-500">{r.count}</span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-zinc-100">
                            <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>

          {/* per property - every number drills down */}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="m-cards w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-2.5 text-start font-medium">{t("Property")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Views")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Bookings")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Paid")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Offers ✓")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Reviews")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Loyalty")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {stats.per_property.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-400">
                    {t("No tracked activity in this period.")}
                  </td></tr>
                )}
                {stats.per_property.map((p) => {
                  const pp = p.property === "(all)" ? undefined : p.property
                  const cell = (kind: Drill, v: number, title: string) => (
                    <td className="px-3 py-2.5 text-end tabular-nums">
                      {v > 0 ? (
                        <button type="button" onClick={() => open(kind, `${title} · ${p.label}`, pp ?? "")}
                          className="rounded px-1 text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600">
                          {v}
                        </button>
                      ) : <span className="text-zinc-300">0</span>}
                    </td>
                  )
                  return (
                    <tr key={p.property} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-2.5 font-medium text-zinc-800">
                        {p.property === "(all)" ? t("Site-wide (browse page, loyalty)") : p.label}
                      </td>
                      {cell("views", p.funnel.views, t("Page views"))}
                      {cell("bookings", p.funnel.bookings, t("Bookings"))}
                      {cell("payments", p.funnel.payments, t("Payments"))}
                      {cell("offers", p.funnel.offers_accepted, t("Offers"))}
                      {cell("reviews", p.funnel.reviews, t("Reviews"))}
                      {cell("loyalty", p.funnel.loyalty, t("Loyalty"))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* recent clicks - references open what they point at */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <p className="border-b border-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-800">
              {t("Recent activity")}
            </p>
            <div className="max-h-[28rem] divide-y divide-zinc-50 overflow-y-auto">
              {stats.recent.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-zinc-400">
                  {t("Nothing tracked in this period.")}
                </p>
              )}
              {stats.recent.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="w-32 shrink-0 text-xs text-zinc-400">{shortWhen(r.when)}</span>
                  <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                    {translate(EVENT_LABELS[r.event] ?? r.event)}
                  </span>
                  <span className="text-xs text-zinc-500">{r.property_label}</span>
                  {(r.source || r.device || r.where) && (
                    <span className="text-[11px] text-zinc-400">
                      {[r.source, r.device, r.where].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span className="ms-auto flex items-center gap-2 text-xs">
                    <RefLink row={r} navigate={navigate}
                      onVisitor={(v) => open("visitor", t("Visitor {v}", { v: visitorLabel(v) }), undefined, v)} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {drill && (
        <DrillPanel drill={drill} period={period} onClose={() => setDrill(null)} navigate={navigate}
          onVisitor={(v) => setDrill({ kind: "visitor", title: t("Visitor {v}", { v: visitorLabel(v) }), visitor: v })} />
      )}
    </div>
  )
}

function RefLink({ row, navigate, onVisitor }: {
  row: { reservation?: string; guest?: string; reference?: string; visitor?: string }
  navigate: (to: string) => void
  onVisitor: (v: string) => void
}) {
  const { t } = useT()
  const cls = "rounded text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
  if (row.reservation)
    return <button type="button" className={cls} onClick={() => navigate(`/reservations/${row.reservation}`)}>{row.reservation}</button>
  if (row.guest)
    return <button type="button" className={cls} onClick={() => navigate(`/guests/${row.guest}`)}>{t("Guest")} {row.guest}</button>
  if (row.visitor)
    return <button type="button" className={cls} onClick={() => onVisitor(row.visitor!)}>{t("Visitor")} {visitorLabel(row.visitor)}</button>
  return <span className="text-zinc-400">{row.reference || ""}</span>
}

function DrillPanel({ drill, period, onClose, navigate, onVisitor }: {
  drill: { kind: Drill; property?: string; visitor?: string; title: string }
  period: Record<string, unknown>
  onClose: () => void
  navigate: (to: string) => void
  onVisitor: (v: string) => void
}) {
  const { t } = useT()
  const [rows, setRows] = useState<DrillRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    call<{ rows: DrillRow[] }>("kamra.track.campaign_drilldown", {
      ...period, kind: drill.kind, property: drill.property || undefined, visitor: drill.visitor,
    })
      .then((d) => setRows(d.rows))
      .catch((e) => setError(serverError(e)))
  }, [drill, period])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const isBookings = drill.kind === "bookings"
  const isViews = drill.kind === "views" || drill.kind === "visitor"

  const csv = () => {
    if (!rows?.length) return
    const cols = Object.keys(rows[0]) as (keyof DrillRow)[]
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }))
    a.download = `campaign-${drill.kind}.csv`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={drill.title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 right-0 flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-900">{drill.title}</h2>
            <p className="text-xs text-zinc-500">{rows ? t("{n} rows", { n: rows.length }) : t("Loading…")}</p>
          </div>
          <button type="button" onClick={csv} disabled={!rows?.length}
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
            <Download className="size-3.5" aria-hidden /> CSV
          </button>
          <button type="button" onClick={onClose} aria-label={t("Close")}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100">
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="m-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{translate(error)}</p>}
          {rows && rows.length === 0 && <p className="p-8 text-center text-sm text-zinc-400">{t("Nothing in this period.")}</p>}
          {rows && rows.length > 0 && (
            <table className="m-cards w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-zinc-100 text-xs uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-2 text-start font-medium">{t("When")}</th>
                  {isBookings ? (
                    <>
                      <th className="px-3 py-2 text-start font-medium">{t("Booking")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Guest")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Property")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Stay")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Status")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Source")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("Total / paid")}</th>
                    </>
                  ) : isViews ? (
                    <>
                      <th className="px-3 py-2 text-start font-medium">{t("Page")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Device")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Came from")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Location")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Visitor")}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-start font-medium">{t("What")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Property")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("Booking / guest")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("Amount")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {rows.map((r, i) => (
                  <tr key={i} className="align-top hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">{shortWhen(r.when)}</td>
                    {isBookings ? (
                      <>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => navigate(`/reservations/${r.reservation}`)}
                            className="text-brand-700 hover:underline">{r.reservation}</button>
                        </td>
                        <td className="px-3 py-2">{r.guest}</td>
                        <td className="px-3 py-2 text-zinc-600">{r.property_label}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">{r.check_in} → {r.check_out}</td>
                        <td className="px-3 py-2 text-xs">{r.status}</td>
                        <td className="px-3 py-2 text-xs text-zinc-600">{r.source}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-end text-xs tabular-nums">{kes(r.amount)} / {kes(r.paid)}</td>
                      </>
                    ) : isViews ? (
                      <>
                        <td className="px-3 py-2">
                          <span className="block text-zinc-800">{r.property_label}</span>
                          <span className="text-[11px] text-zinc-400">{translate(EVENT_LABELS[r.event ?? ""] ?? r.event ?? "")}{r.page ? ` · ${r.page}` : ""}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">{[r.device, r.os, r.browser].filter(Boolean).join(" · ") || "-"}</td>
                        <td className="px-3 py-2 text-xs text-zinc-600">{r.source || "-"}{r.campaign ? ` · ${r.campaign}` : ""}</td>
                        <td className="px-3 py-2 text-xs text-zinc-600">{r.where || "-"}{r.lang ? ` (${r.lang})` : ""}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.visitor ? (
                            <button type="button" onClick={() => onVisitor(r.visitor!)} className="text-brand-700 hover:underline">
                              {visitorLabel(r.visitor)}{r.visits && r.visits > 1 ? ` · ${t("{n} visits", { n: r.visits })}` : ""}
                            </button>
                          ) : <RefLink row={r} navigate={navigate} onVisitor={onVisitor} />}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-xs">{translate(EVENT_LABELS[r.event ?? ""] ?? r.event ?? "")}</td>
                        <td className="px-3 py-2 text-zinc-600">{r.property_label}</td>
                        <td className="px-3 py-2 text-xs"><RefLink row={r} navigate={navigate} onVisitor={onVisitor} /></td>
                        <td className="px-3 py-2 text-end text-xs tabular-nums">{r.amount ? kes(Number(r.amount)) : ""}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
