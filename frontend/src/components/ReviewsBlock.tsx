/** Guest reviews for a property's booking pages: approved reviews, newest
 *  first, each credited (and linked) to where it came from. Shows the first
 *  few, then "Show all". Renders nothing until there is a review to show. */
import { useEffect, useState } from "react"
import { ExternalLink, Star } from "lucide-react"
import { useT } from "../lib/i18n"
import { loadPublicReviews, reviewSourceLabel, type PublicReviews } from "../lib/publicReviews"

const SHOWN = 6

/** Approved guest reviews for this property - renders nothing until the
 *  owner has approved at least one (cloudtrade_hospitality.reviews). */
export function ReviewsBlock({ property, className = "" }: { property: string; className?: string }) {
  const { t, tn } = useT()
  const [data, setData] = useState<PublicReviews | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    if (!property) return
    let live = true
    loadPublicReviews(property).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [property])

  if (!data || data.count === 0) return null

  const sourceLabel = reviewSourceLabel

  return (
    <section className={"rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm " + className}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">{t("Guest reviews")}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-800">
          <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
          {data.average.toFixed(1)}
        </span>
        <span className="text-sm text-zinc-500">
          {tn(data.count, "{n} review", "{n} reviews")}
        </span>
      </div>
      <ul className="mt-4 space-y-4">
        {(all ? data.reviews : data.reviews.slice(0, SHOWN)).map((r, i) => (
          <li key={i} className="border-t border-zinc-100 pt-4 first:border-0 first:pt-0">
            <div className="flex items-center gap-2">
              <span className="flex gap-0.5" aria-label={t("{n} out of 5 stars", { n: r.rating })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n}
                    className={"size-3.5 " + (n <= r.rating ? "fill-amber-400 text-amber-400" : "fill-zinc-200 text-zinc-200")} />
                ))}
              </span>
              {r.headline && <span className="text-sm font-medium text-zinc-800">{r.headline}</span>}
            </div>
            {r.comment && <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{r.comment}</p>}
            <p className="mt-2 text-xs text-zinc-400">
              {r.display_name || t("Verified guest")}
              {r.submitted_on ? ` · ${String(r.submitted_on).slice(0, 10)}` : ""}
              {sourceLabel(r.source) && !r.external_url ? ` · ${sourceLabel(r.source)}` : ""}
              {r.external_url && " · "}
              {r.external_url && (
                <a href={r.external_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">
                  {sourceLabel(r.source) || t("Source")} <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </p>
          </li>
        ))}
      </ul>
      {!all && data.reviews.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)}
          className="mt-4 w-full rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          {tn(data.reviews.length, "Show all {n} review", "Show all {n} reviews")}
        </button>
      )}
    </section>
  )
}
