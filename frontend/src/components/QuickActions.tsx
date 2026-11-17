import type { ComponentType } from "react"
import { Link } from "react-router-dom"
import {
  BarChart3,
  BedDouble,
  CalendarDays,
  LogIn,
  LogOut,
  Plus,
  Sparkles,
  UtensilsCrossed,
  Users,
} from "lucide-react"
import { useAuth } from "../lib/auth"
import { useT } from "../lib/i18n"
import { cn } from "../lib/utils"

type Action = {
  label: string
  icon: ComponentType<{ className?: string }>
  to?: string
  onClick?: () => void
  roles: string[]
  tone: string
  badge?: number
}

const DESK = ["Front Desk", "Hotel Admin", "System Manager", "Administrator", "Kamra Agent"]
const MGMT = ["Hotel Admin", "Finance", "Revenue Manager", "System Manager", "Administrator"]
const FNB = ["F&B Manager", "Hotel Admin", "System Manager", "Administrator", "Front Desk"]
const HK = ["Housekeeping", "Housekeeping Supervisor", "Hotel Admin", "Front Desk", "System Manager", "Administrator"]

/** The day's main jobs as big, thumb-sized tiles: one tap from Today to
 *  the screen, four across on a phone, one row on a wide screen. */
export default function QuickActions(props: {
  onNewBooking?: () => void
  arrivals?: number
  departures?: number
}) {
  const { t } = useT()
  const { roles } = useAuth()
  const actions: Action[] = [
    { label: t("New booking"), icon: Plus, onClick: props.onNewBooking, roles: DESK,
      tone: "bg-brand-600 text-white" },
    { label: t("Check in"), icon: LogIn, to: "/in-house?tab=arrivals", roles: DESK,
      tone: "bg-emerald-50 text-emerald-700", badge: props.arrivals },
    { label: t("Check out"), icon: LogOut, to: "/in-house?tab=departures", roles: DESK,
      tone: "bg-amber-50 text-amber-700", badge: props.departures },
    { label: t("Room board"), icon: BedDouble, to: "/room-board", roles: DESK,
      tone: "bg-sky-50 text-sky-700" },
    { label: t("Calendar"), icon: CalendarDays, to: "/calendar", roles: DESK,
      tone: "bg-violet-50 text-violet-700" },
    { label: t("Guests"), icon: Users, to: "/guests", roles: DESK,
      tone: "bg-zinc-100 text-zinc-700" },
    { label: t("Restaurant"), icon: UtensilsCrossed, to: "/pos", roles: FNB,
      tone: "bg-orange-50 text-orange-700" },
    { label: t("Housekeeping"), icon: Sparkles, to: "/housekeeping-board", roles: HK,
      tone: "bg-teal-50 text-teal-700" },
    { label: t("Reports"), icon: BarChart3, to: "/dashboard", roles: MGMT,
      tone: "bg-indigo-50 text-indigo-700" },
  ]
  const shown = actions.filter(
    (a) => a.roles.some((r) => roles.includes(r)) && (a.to || a.onClick),
  )
  if (!shown.length) return null
  return (
    <nav
      aria-label={t("Quick actions")}
      className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9 2xl:flex 2xl:flex-wrap"
    >
      {shown.map((a) => {
        const body = (
          <>
            <span className={cn("relative grid size-10 shrink-0 place-items-center rounded-lg lg:size-9", a.tone)}>
              <a.icon className="size-5" aria-hidden />
              {!!a.badge && (
                <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full bg-rose-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white tabular-nums">
                  {a.badge}
                </span>
              )}
            </span>
            <span className="text-center text-xs font-medium leading-tight text-zinc-700 2xl:whitespace-nowrap 2xl:text-start 2xl:text-[13px]">
              {a.label}
            </span>
          </>
        )
        const cls =
          "flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-1.5 py-3 transition hover:border-brand-300 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-brand-600 active:scale-[0.98] lg:min-h-[4.75rem] lg:gap-1.5 lg:py-2.5 2xl:min-h-0 2xl:flex-row 2xl:justify-start 2xl:gap-2.5 2xl:py-2 2xl:pe-4 2xl:ps-2"
        return a.to ? (
          <Link key={a.label} to={a.to} className={cls}>
            {body}
          </Link>
        ) : (
          <button key={a.label} type="button" onClick={a.onClick} className={cls}>
            {body}
          </button>
        )
      })}
    </nav>
  )
}
