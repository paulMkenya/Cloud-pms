/** Reviews: every review per property (publish or hide), reviews copied from
 *  Airbnb / Booking.com / Google with a link to the original, the property's
 *  rating badges, and two switches for what the booking pages show. */
import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Plus, Star, Trash2 } from "lucide-react"
import { Button } from "../components/ui/button"
import { Sheet } from "../components/ui/sheet"
import { call, getCurrentProperty, myProperties, serverError, type PropertyRow } from "../lib/api"
import { useT } from "../lib/i18n"
import { Switch } from "./settings/ModulePage"

interface Review {
  name: string
  status: string
  source: string | null
  rating: number | null
  headline: string | null
  comment: string | null
  display_name: string | null
  external_url: string | null
  submitted_on: string | null
  reservation: string | null
}
interface Badge { source: string; score: number; out_of?: number; count: number; url: string }
interface Overview {
  reviews: Review[]
  badges: Badge[]
  display: { outside_reviews: number; badges: number; min_stars: number }
  listings: { site: string; name: string; url: string }[]
  can_admin: boolean
}

const SOURCES = ["Airbnb", "Booking.com", "Google", "Other"]
const SCALE: Record<string, number> = { Airbnb: 5, "Booking.com": 10, Google: 5, Other: 5 }
const inputCls =
  "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={"size-3.5 " + (i <= n ? "fill-amber-400 text-amber-400" : "fill-zinc-200 text-zinc-200")} />
      ))}
    </span>
  )
}

export default function Reviews() {
  const { t } = useT()
  const [props, setProps] = useState<PropertyRow[]>([])
  const [prop, setProp] = useState(getCurrentProperty())
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editBadges, setEditBadges] = useState(false)

  useEffect(() => {
    myProperties().then((rows) => {
      setProps(rows)
      if (rows.length && !rows.some((r) => r.name === prop)) setProp(rows[0].name)
    }).catch(() => undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!prop) return
    setErr(null)
    call<Overview>("cloudtrade_hospitality.reviews_admin.overview", { property: prop })
      .then(setData).catch((e) => setErr(serverError(e)))
  }, [prop])
  useEffect(load, [load])

  async function act(method: string, args: Record<string, unknown>) {
    setErr(null)
    try {
      setData(await call<Overview>(`cloudtrade_hospitality.reviews_admin.${method}`, args))
    } catch (e) {
      setErr(serverError(e))
    }
  }

  async function toggle(key: "outside_reviews" | "badges" | "min_stars") {
    if (!data) return
    const next = { ...data.display, [key]: key === "min_stars" ? (data.display.min_stars ? 0 : 4) : (data.display[key] ? 0 : 1) }
    try {
      const d = await call<Overview["display"]>("cloudtrade_hospitality.reviews_admin.save_display", next)
      setData({ ...data, display: d })
    } catch (e) {
      setErr(serverError(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t("Reviews")}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t("What guests read on your booking pages: their own reviews, reviews you copy from Airbnb or Booking.com with a link to the original, and your rating on those sites.")}
          </p>
        </div>
        {props.length > 1 && (
          <select className={inputCls + " sm:w-64"} value={prop} onChange={(e) => setProp(e.target.value)}
            aria-label={t("Property")}>
            {props.map((p) => <option key={p.name} value={p.name}>{p.property_name}</option>)}
          </select>
        )}
      </div>

      {err && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {!data ? (
        <p className="py-8 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      ) : (
        <>
          {/* what the booking pages show - for every property */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <h2 className="font-semibold text-zinc-900">{t("Show on the booking pages")}</h2>
            <div className="mt-3 divide-y divide-zinc-100">
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{t("Reviews copied from other sites")}</p>
                  <p className="text-xs text-zinc-500">{t("Airbnb, Booking.com and Google reviews you add below, each with a link to the original.")}</p>
                </div>
                <Switch on={!!data.display.outside_reviews} disabled={!data.can_admin}
                  label={t("Reviews copied from other sites")} onToggle={() => toggle("outside_reviews")} />
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{t("Rating badges")}</p>
                  <p className="text-xs text-zinc-500">{t("\"4.9 on Airbnb · 37 reviews\" under the property name, linking to the listing.")}</p>
                </div>
                <Switch on={!!data.display.badges} disabled={!data.can_admin}
                  label={t("Rating badges")} onToggle={() => toggle("badges")} />
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{t("Only 4 and 5-star reviews")}</p>
                  <p className="text-xs text-zinc-500">{t("Lower-rated reviews stay saved here but are not shown. Reviews are always shown word for word.")}</p>
                </div>
                <Switch on={!!data.display.min_stars} disabled={!data.can_admin}
                  label={t("Only 4 and 5-star reviews")} onToggle={() => toggle("min_stars")} />
              </div>
            </div>
            {!data.can_admin && <p className="mt-2 text-xs text-zinc-500">{t("Only a Hotel Admin can change these.")}</p>}
          </section>

          {/* the property's listings: where to copy reviews from */}
          {data.listings.length > 0 && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
              <h2 className="font-semibold text-zinc-900">{t("Your Airbnb listings")}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t("From the calendars you connected. Open a listing to see its reviews and rating, then add the ones you want here.")}</p>
              <ul className="mt-3 divide-y divide-zinc-100">
                {data.listings.map((l) => (
                  <li key={l.url} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm text-zinc-800">{l.name}</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">
                      {t("Open on Airbnb")} <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* rating badges for this property */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-zinc-900">{t("Rating badges")}</h2>
              <Button variant="outline" onClick={() => setEditBadges(true)}>{t("Edit")}</Button>
            </div>
            {data.badges.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {data.badges.map((b) => (
                  <li key={b.source} className="flex flex-wrap items-center gap-x-2">
                    <span className="font-semibold text-zinc-900">{b.score}{SCALE[b.source] === 10 ? "/10" : " ★"}</span>
                    <span className="text-zinc-600">{t("on {site}", { site: b.source })}</span>
                    {b.count > 0 && <span className="text-zinc-400">· {b.count}</span>}
                    {b.url && <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">{t("link")} <ExternalLink className="size-3" /></a>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">{t("No badges yet. Add this property's rating from Airbnb or Booking.com.")}</p>
            )}
          </section>

          {/* every review */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-zinc-900">{t("Reviews")} ({data.reviews.length})</h2>
              <Button onClick={() => setAdding(true)} className="justify-center">
                <Plus className="size-4" aria-hidden /> {t("Add a review from Airbnb / Booking.com")}
              </Button>
            </div>
            {data.reviews.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">{t("No reviews yet for this property.")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100">
                {data.reviews.map((r) => {
                  const outside = !!r.source && r.source !== "Stay"
                  return (
                    <li key={r.name} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.rating ? <Stars n={r.rating} /> : null}
                        <span className="text-sm font-medium text-zinc-900">{r.display_name || t("Guest")}</span>
                        <span className="text-xs text-zinc-400">{(r.submitted_on || "").slice(0, 10)}</span>
                        <span className={"rounded-full px-2 py-0.5 text-xs " + (outside ? "bg-brand-50 text-brand-700" : "bg-zinc-100 text-zinc-600")}>
                          {outside ? r.source : t("Our guest")}
                        </span>
                        <span className={"rounded-full px-2 py-0.5 text-xs " +
                          (r.status === "Approved" ? "bg-emerald-50 text-emerald-700" : r.status === "Rejected" ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-800")}>
                          {r.status === "Approved" ? t("Shown") : r.status === "Rejected" ? t("Hidden") : r.status === "Invited" ? t("Invited") : t("Waiting")}
                        </span>
                      </div>
                      {r.headline && <p className="mt-1 text-sm font-medium text-zinc-800">{r.headline}</p>}
                      {r.comment && <p className="mt-1 text-sm text-zinc-600">{r.comment}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {r.external_url && (
                          <a href={r.external_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                            {t("Original")} <ExternalLink className="size-3" />
                          </a>
                        )}
                        {r.status !== "Approved" && r.status !== "Invited" && (
                          <Button variant="outline" onClick={() => act("set_status", { review: r.name, status: "Approved" })}>{t("Show")}</Button>
                        )}
                        {r.status === "Approved" && (
                          <Button variant="outline" onClick={() => act("set_status", { review: r.name, status: "Rejected" })}>{t("Hide")}</Button>
                        )}
                        {outside && !r.reservation && (
                          <Button variant="ghost" aria-label={t("Delete")}
                            onClick={() => { if (window.confirm(t("Delete this copied review?"))) void act("delete_outside_review", { review: r.name }) }}>
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {adding && (
        <AddReview property={prop} onClose={() => setAdding(false)}
          onSaved={(d) => { setData(d); setAdding(false) }} />
      )}
      {editBadges && data && (
        <EditBadges property={prop} badges={data.badges} listings={data.listings} onClose={() => setEditBadges(false)}
          onSaved={(d) => { setData(d); setEditBadges(false) }} />
      )}
    </div>
  )
}

function AddReview({ property, onClose, onSaved }: {
  property: string
  onClose: () => void
  onSaved: (d: Overview) => void
}) {
  const { t } = useT()
  const [f, setF] = useState({ source: "Airbnb", display_name: "", rating: 5, comment: "", url: "", review_date: "", publish: 1 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      onSaved(await call<Overview>("cloudtrade_hospitality.reviews_admin.add_outside_review", { property, ...f }))
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t("Add a review from another site")}
      description={t("Copy a review a guest left for this property, and the link to it.")} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Where it came from")}</span>
          <select className={inputCls} value={f.source} onChange={(e) => set("source", e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {f.source === "Booking.com" && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {t("Booking.com asks that its review texts stay on Booking.com. A rating badge with a link is the safer way to show your Booking.com score.")}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Guest's first name")}</span>
          <input className={inputCls} value={f.display_name} maxLength={60} placeholder="Mary"
            onChange={(e) => set("display_name", e.target.value)} />
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Stars")}</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => set("rating", n)} aria-label={`${n}`}
                className="rounded p-1 focus-visible:outline-2 focus-visible:outline-brand-600">
                <Star className={"size-7 " + (n <= f.rating ? "fill-amber-400 text-amber-400" : "fill-zinc-200 text-zinc-200")} />
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("The review")}</span>
          <textarea className={inputCls + " h-32 py-2"} value={f.comment} maxLength={2000}
            onChange={(e) => set("comment", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Link to the review or listing")}</span>
          <input className={inputCls} value={f.url} inputMode="url" placeholder="https://www.airbnb.com/rooms/…"
            onChange={(e) => set("url", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Date of the review")}</span>
          <input className={inputCls} type="date" value={f.review_date} onChange={(e) => set("review_date", e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={!!f.publish} onChange={(e) => set("publish", e.target.checked ? 1 : 0)} />
          {t("Show it on the booking page now")}
        </label>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <Button className="w-full justify-center" disabled={busy} onClick={() => void save()}>
          {busy ? t("Saving…") : t("Save review")}
        </Button>
      </div>
    </Sheet>
  )
}

function EditBadges({ property, badges, listings, onClose, onSaved }: {
  property: string
  badges: Badge[]
  listings: Overview["listings"]
  onClose: () => void
  onSaved: (d: Overview) => void
}) {
  const { t } = useT()
  const start = (s: string) => {
    const b = badges.find((x) => x.source === s)
    // the Airbnb badge links to the property's own listing unless set otherwise
    const fallback = s === "Airbnb" ? listings[0]?.url || "" : ""
    return { source: s, score: b ? String(b.score) : "", count: b ? String(b.count) : "", url: b?.url || fallback }
  }
  const [rows, setRows] = useState(["Airbnb", "Booking.com", "Google"].map(start))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      onSaved(await call<Overview>("cloudtrade_hospitality.reviews_admin.save_badges", {
        property, badges: JSON.stringify(rows.filter((r) => r.score.trim())),
      }))
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t("Rating badges")} description={t("This property's rating on each site, as the site shows it. Leave a site empty to hide its badge.")} onClose={onClose}>
      <div className="space-y-4">
        {rows.map((r, i) => (
          <fieldset key={r.source} className="rounded-xl border border-zinc-200 p-3">
            <legend className="px-1 text-sm font-semibold text-zinc-900">{r.source}</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">{t("Score (out of {n})", { n: SCALE[r.source] })}</span>
                <input className={inputCls} inputMode="decimal" value={r.score} placeholder={SCALE[r.source] === 10 ? "8.9" : "4.9"}
                  onChange={(e) => set(i, "score", e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">{t("Number of reviews")}</span>
                <input className={inputCls} inputMode="numeric" value={r.count} placeholder="37"
                  onChange={(e) => set(i, "count", e.target.value)} />
              </label>
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-zinc-500">{t("Link to the listing")}</span>
              <input className={inputCls} inputMode="url" value={r.url} placeholder="https://…"
                onChange={(e) => set(i, "url", e.target.value)} />
            </label>
          </fieldset>
        ))}
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <Button className="w-full justify-center" disabled={busy} onClick={() => void save()}>
          {busy ? t("Saving…") : t("Save badges")}
        </Button>
      </div>
    </Sheet>
  )
}
