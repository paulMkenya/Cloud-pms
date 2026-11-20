import { useCallback, useEffect, useMemo, useState } from "react"
import { MousePointerClick } from "lucide-react"

import { call, serverError } from "../lib/api"
import { useT, t as translate } from "../lib/i18n"

/** Campaign click tracking: every guest-side moment - property views,
 *  bookings, offer/payment/review/check-in link opens, loyalty actions -
 *  per property, with the funnel from view to paid booking. */

interface Stats {
  days: number
  totals: Record<string, number>
  funnel: { views: number; bookings: number; payments: number; offers_accepted: number; reviews: number; loyalty: number }
  per_property: {
    property: string
    label: string
    counts: Record<string, number>
    funnel: Stats["funnel"]
  }[]
  recent: {
    when: string
    property: string
    property_label: string
    event: string
    channel: string
    reference: string
    reservation: string
    guest: string
  }[]
  events: string[]
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

export default function Campaigns() {
  const { t } = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [prop, setProp] = useState("")

  const load = useCallback(() => {
    call<Stats>("kamra.track.campaign_stats", {
      days, property: prop || undefined,
    })
      .then(setStats)
      .catch((e) => setError(serverError(e)))
  }, [days, prop])
  useEffect(load, [load])

  const funnelCards = useMemo(() => {
    const f = stats?.funnel
    if (!f) return []
    return [
      { label: t("Page views"), value: f.views },
      { label: t("Bookings"), value: f.bookings },
      { label: t("Payments"), value: f.payments },
      { label: t("Offers accepted"), value: f.offers_accepted },
      { label: t("Reviews"), value: f.reviews },
      { label: t("Loyalty actions"), value: f.loyalty },
    ]
  }, [stats, t])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900">
            <MousePointerClick className="size-5 text-brand-700" aria-hidden />
            {t("Campaign tracking")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {t("Every guest click that matters: property views, bookings, offer and payment link opens, check-ins, reviews and loyalty - per property, with what each click led to.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={prop}
            onChange={(e) => setProp(e.target.value)}
          >
            <option value="">{t("All properties")}</option>
            {(stats?.per_property ?? []).map((p) => (
              <option key={p.property} value={p.property}>{p.label}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90, 180].map((d) => (
              <option key={d} value={d}>{t("Last {n} days", { n: d })}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {translate(error)}
        </p>
      )}
      {!stats ? (
        <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      ) : (
        <>
          {/* funnel */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {funnelCards.map((c) => (
              <div key={c.label} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                <p className="text-2xl font-semibold tabular-nums text-zinc-900">{c.value}</p>
                <p className="text-xs text-zinc-500">{c.label}</p>
              </div>
            ))}
          </div>

          {/* per property */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-start text-xs uppercase tracking-wider text-zinc-400">
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
                    {t("No tracked activity in this window yet.")}
                  </td></tr>
                )}
                {stats.per_property.map((p) => (
                  <tr key={p.property} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-2.5 font-medium text-zinc-800">{p.label}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.views}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.bookings}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.payments}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.offers_accepted}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.reviews}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{p.funnel.loyalty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* recent clicks */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <p className="border-b border-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-800">
              {t("Recent activity")}
            </p>
            <div className="max-h-96 divide-y divide-zinc-50 overflow-y-auto">
              {stats.recent.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-zinc-400">
                  {t("Nothing tracked yet - clicks appear here as guests browse and book.")}
                </p>
              )}
              {stats.recent.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="w-36 shrink-0 text-xs text-zinc-400">
                    {r.when.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                    {translate(EVENT_LABELS[r.event] ?? r.event)}
                  </span>
                  <span className="text-xs text-zinc-500">{r.property_label}</span>
                  {r.channel === "link" && (
                    <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">link</span>
                  )}
                  <span className="ms-auto truncate text-xs text-zinc-400">
                    {r.reservation || r.reference || r.guest}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
