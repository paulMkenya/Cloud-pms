/** A wrapped list of short items (amenity tags) that shows the first
 *  `limit`, then "Show all N" - so a long list doesn't fill a phone screen. */
import { useState, type ReactNode } from "react"
import { useT } from "../lib/i18n"

export function ShowMoreTags<T>({ items, limit = 12, render, className = "", ariaLabel }: {
  items: T[]
  limit?: number
  render: (item: T) => ReactNode
  className?: string
  ariaLabel?: string
}) {
  const { tn } = useT()
  const [all, setAll] = useState(false)
  const shown = all || items.length <= limit + 2 ? items : items.slice(0, limit)
  return (
    <div className={className}>
      <ul className="flex flex-wrap gap-2" aria-label={ariaLabel}>
        {shown.map(render)}
      </ul>
      {shown.length < items.length && (
        <button type="button" onClick={() => setAll(true)}
          className="mt-3 text-sm font-medium text-brand-700 hover:underline">
          {tn(items.length, "Show all {n} amenity", "Show all {n} amenities")}
        </button>
      )}
    </div>
  )
}
