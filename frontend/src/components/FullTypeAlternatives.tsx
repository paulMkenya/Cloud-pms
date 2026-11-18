import { useEffect, useState } from "react"
import { ArrowRight, Building2, Loader2 } from "lucide-react"
import { call } from "../lib/api"
import { cur, moneyLocale } from "../lib/money"
import { useT } from "../lib/i18n"

interface AltType {
  room_type: string
  room_type_name: string
  available: number
  per_night: number
  total: number
}
interface AltProperty {
  property: string
  property_name: string
  city: string | null
  room_types: AltType[]
}

const money = (n: number) =>
  `${cur()}${n.toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })}`

/** When the chosen room type has nothing free for the dates, offer what is
 *  free instead - another type here, or a room at another property the
 *  user can book - so the desk picks one and carries on instead of hitting
 *  a dead end. Renders nothing while the chosen type still has rooms. */
export default function FullTypeAlternatives(props: {
  property: string
  roomType: string
  roomTypeName?: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  walkIn?: boolean
  onPickType: (roomType: string) => void
  onPickProperty: (property: string, roomType: string) => void
}) {
  const { t, tn } = useT()
  const [full, setFull] = useState(false)
  const [alts, setAlts] = useState<AltProperty[] | null>(null)

  useEffect(() => {
    setFull(false)
    setAlts(null)
    if (!props.roomType || !props.checkIn || !props.checkOut) return
    let live = true
    const timer = setTimeout(async () => {
      try {
        const free = await call<unknown[]>("kamra.api.available_rooms", {
          property: props.property,
          room_type: props.roomType,
          check_in_date: props.checkIn,
          check_out_date: props.checkOut,
          ...(props.walkIn ? { ready_now: 1 } : {}),
        })
        if (!live || free.length) return
        setFull(true)
        const r = await call<{ properties: AltProperty[] }>("kamra.crs.crs_search", {
          check_in_date: props.checkIn,
          check_out_date: props.checkOut,
          adults: props.adults,
          children: props.children,
        })
        if (!live) return
        // this property first, then the rest cheapest-first (server order)
        const rows = r.properties
          .map((p) => ({
            ...p,
            room_types: p.room_types.filter(
              (rt) => !(p.property === props.property && rt.room_type === props.roomType),
            ),
          }))
          .filter((p) => p.room_types.length)
        rows.sort((a, b) => Number(b.property === props.property) - Number(a.property === props.property))
        setAlts(rows)
      } catch {
        if (live) setAlts((a) => a ?? [])
      }
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [props.property, props.roomType, props.checkIn, props.checkOut, props.adults, props.children, props.walkIn])

  if (!full) return null
  const here = alts?.find((p) => p.property === props.property)
  const elsewhere = alts?.filter((p) => p.property !== props.property) ?? []

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm">
      <p className="font-medium text-amber-900">
        {t("{type} is full for these dates.", { type: props.roomTypeName || t("This room type") })}{" "}
        <span className="font-normal text-amber-800">{t("Pick one of these to keep booking:")}</span>
      </p>

      {alts === null ? (
        <p className="mt-3 flex items-center gap-2 text-amber-800">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("Finding free rooms…")}
        </p>
      ) : !alts.length ? (
        <p className="mt-3 text-amber-800">
          {t("Nothing is free anywhere for these dates. Change the dates, or waitlist the stay.")}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {here && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                {t("Other rooms here")}
              </p>
              <div className="flex flex-wrap gap-2">
                {here.room_types.map((rt) => (
                  <button
                    key={rt.room_type}
                    type="button"
                    onClick={() => props.onPickType(rt.room_type)}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-left transition hover:border-brand-500 hover:shadow-sm"
                  >
                    <span className="block font-medium text-zinc-800">{rt.room_type_name}</span>
                    <span className="block text-xs text-zinc-500">
                      {tn(rt.available, "{n} free", "{n} free")} · {money(rt.per_night)}/{t("night")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {elsewhere.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                {t("Other properties")}
              </p>
              <ul className="space-y-2">
                {elsewhere.slice(0, 6).map((p) => {
                  const best = p.room_types[0]
                  return (
                    <li
                      key={p.property}
                      className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
                    >
                      <Building2 className="size-4 shrink-0 text-zinc-400" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-zinc-800">
                          {p.property_name}
                          {p.city ? <span className="font-normal text-zinc-500"> · {p.city}</span> : null}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {best.room_type_name} · {tn(best.available, "{n} free", "{n} free")} ·{" "}
                          {money(best.per_night)}/{t("night")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onPickProperty(p.property, best.room_type)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        {t("Book here")} <ArrowRight className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
