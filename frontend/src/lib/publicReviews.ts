/** The public reviews feed for one property, loaded once per page for both
 *  the rating badges under the title and the reviews section. */
import { callGuest } from "./api"

export interface PublicReview {
  display_name: string
  rating: number
  headline: string | null
  comment: string | null
  source: string
  external_url: string | null
  submitted_on: string | null
}

export interface RatingBadge {
  source: string
  score: number
  out_of: number
  count: number
  url: string
}

export interface PublicReviews {
  reviews: PublicReview[]
  average: number
  count: number
  badges: RatingBadge[]
  /** only some reviews are shown (e.g. 4 and 5 stars): no average then */
  filtered?: boolean
}

const EMPTY: PublicReviews = { reviews: [], average: 0, count: 0, badges: [] }
const cache = new Map<string, Promise<PublicReviews>>()

export function loadPublicReviews(property: string): Promise<PublicReviews> {
  if (!property) return Promise.resolve(EMPTY)
  let p = cache.get(property)
  if (!p) {
    p = callGuest<PublicReviews>("cloudtrade_hospitality.reviews.public_reviews", { property, limit: 60 })
      .then((d) => ({ ...EMPTY, ...d, badges: d?.badges || [] }))
      .catch(() => EMPTY)
    cache.set(property, p)
  }
  return p
}

export const reviewSourceLabel = (s: string) =>
  s === "Booking.com" || s === "Airbnb" || s === "Google" ? s : ""

let catalog: Promise<Record<string, RatingBadge[]>> | null = null

/** Rating badges for every property on the booking homepage, in one call. */
export function loadCatalogBadges(): Promise<Record<string, RatingBadge[]>> {
  catalog ??= callGuest<Record<string, RatingBadge[]>>("cloudtrade_hospitality.reviews.catalog_badges")
    .then((d) => d || {})
    .catch(() => ({}))
  return catalog
}

/** A 5-star score as sites show it: "4.73", "4.9", "5.0" (never "5"). */
export const fiveScale = (n: number) => {
  const t = String(Number(n.toFixed(2)))
  return t.includes(".") ? t : `${t}.0`
}

/** "4.73" for Airbnb / Google, "8.9/10" for Booking.com. */
export const badgeScore = (b: RatingBadge) =>
  b.out_of === 10 ? `${b.score.toFixed(1)}/10` : fiveScale(b.score)
