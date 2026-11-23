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
}

const EMPTY: PublicReviews = { reviews: [], average: 0, count: 0, badges: [] }
const cache = new Map<string, Promise<PublicReviews>>()

export function loadPublicReviews(property: string): Promise<PublicReviews> {
  if (!property) return Promise.resolve(EMPTY)
  let p = cache.get(property)
  if (!p) {
    p = callGuest<PublicReviews>("cloudtrade_hospitality.reviews.public_reviews", { property })
      .then((d) => ({ ...EMPTY, ...d, badges: d?.badges || [] }))
      .catch(() => EMPTY)
    cache.set(property, p)
  }
  return p
}

export const reviewSourceLabel = (s: string) =>
  s === "Booking.com" || s === "Airbnb" || s === "Google" ? s : ""
