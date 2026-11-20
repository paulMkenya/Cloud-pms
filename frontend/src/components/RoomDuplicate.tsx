import { useState } from "react"
import { Copy } from "lucide-react"

import { Button } from "./ui/button"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"
import type { Row } from "../lib/resource"

/** Room edit drawer extra: clone this unit's setup under a new number. */
export default function RoomDuplicate({ row, reload }: { row: Row; reload: () => void }) {
  const { t } = useT()
  const [num, setNum] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  async function run() {
    setBusy(true)
    setMsg("")
    try {
      await call("kamra.floors.duplicate_unit", {
        room: String(row.name),
        new_room_number: num,
      })
      setMsg(t("Unit {n} created", { n: num }))
      setNum("")
      reload()
    } catch (e) {
      setMsg(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-800">
        <Copy className="size-4" aria-hidden />
        {t("Duplicate unit")}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        {t("Copy the type, floor and guest access details to a new unit number. Status starts Vacant / Clean.")}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className="w-32 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          placeholder={t("New number")}
          value={num}
          onChange={(e) => setNum(e.target.value)}
        />
        <Button variant="outline" disabled={busy || !num.trim()} onClick={run}>
          {t("Duplicate")}
        </Button>
      </div>
      {msg && <p className="mt-1.5 text-xs text-zinc-500">{msg}</p>}
    </div>
  )
}
