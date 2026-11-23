/** "4.9 on Airbnb · 37 reviews" pills under a property's title, each linking
 *  to the listing it came from. Hidden when the owner switches badges off. */
import { useEffect, useState } from "react"
import { ExternalLink, Star } from "lucide-react"
import { useT } from "../lib/i18n"
import { fiveScale, loadPublicReviews, type RatingBadge } from "../lib/publicReviews"

export function ReviewBadges({ property, className = "" }: { property: string; className?: string }) {
  const { t, tn } = useT()
  const [badges, setBadges] = useState<RatingBadge[]>([])
  useEffect(() => {
    let live = true
    loadPublicReviews(property).then((d) => live && setBadges(d.badges))
    return () => {
      live = false
    }
  }, [property])
  if (!badges.length) return null
  return (
    <div className={"flex flex-wrap gap-2 " + className}>
      {badges.map((b) => {
        const score = b.out_of === 10 ? b.score.toFixed(1) : fiveScale(b.score)
        const body = (
          <>
            {b.out_of === 5 && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />}
            <span className="font-semibold text-zinc-900">{score}</span>
            {b.out_of === 10 && <span className="text-zinc-500">/10</span>}
            <span className="text-zinc-600">{t("on {site}", { site: b.source })}</span>
            {b.count > 0 && <span className="text-zinc-400">· {tn(b.count, "{n} review", "{n} reviews")}</span>}
            {b.url && <ExternalLink className="size-3 text-zinc-400" aria-hidden />}
          </>
        )
        const cls = "inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm"
        return b.url ? (
          <a key={b.source} href={b.url} target="_blank" rel="noopener noreferrer"
            className={cls + " transition hover:border-brand-100 hover:bg-brand-50"}
            aria-label={t("{score} on {site}, see the reviews there", { score, site: b.source })}>
            {body}
          </a>
        ) : (
          <span key={b.source} className={cls}>{body}</span>
        )
      })}
    </div>
  )
}
