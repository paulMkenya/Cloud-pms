import { useState } from "react"
import { LayoutDashboard } from "lucide-react"
import { cn } from "../lib/utils"
import { useT } from "../lib/i18n"
import PortfolioDashboard from "./PortfolioDashboard"
import PortfolioCalendar from "./PortfolioCalendar"

/** Portfolio hub: the cross-property dashboard and the all-properties
 *  calendar behind one nav item. */
export default function Portfolio() {
  const { t } = useT()
  const [tab, setTab] = useState<"dashboard" | "calendar">("dashboard")
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("dashboard")}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            tab === "dashboard" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
        >
          <LayoutDashboard className="size-4" aria-hidden />
          {t("Dashboard")}
        </button>
        <button
          type="button"
          onClick={() => setTab("calendar")}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            tab === "calendar" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
        >
          {t("Calendar")}
        </button>
      </div>
      {tab === "dashboard" ? <PortfolioDashboard /> : <PortfolioCalendar />}
    </div>
  )
}
