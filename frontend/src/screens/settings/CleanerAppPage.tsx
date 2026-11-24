import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { call, serverError } from "../../lib/api"
import { useT } from "../../lib/i18n"

interface Item { label: string; kind: "check" | "number"; required: number }
interface S {
  checklist: Item[]
  photo_damage: number
  photo_left: number
  photo_final: number
  notify_checkin: number
  notify_finish: number
  notify_damage: number
  notify_clock: number
  gps: number
}

const TOGGLES: [keyof S, string, string][] = [
  ["photo_damage", "Photo required for a damage", "A cleaner cannot save a damage without a photo."],
  ["photo_left", "Photo required for an item left", "A cleaner cannot save an item left without a photo."],
  ["photo_final", "Final photo required", "A cleaner cannot finish an apartment without a photo of the clean room."],
  ["gps", "Record location (GPS)", "The phone's location at clock in / out, check-in and finish - shown on the map."],
  ["notify_checkin", "WhatsApp me when a cleaner checks in to an apartment", ""],
  ["notify_finish", "WhatsApp me when an apartment is finished", "With the checklist result and the final photo."],
  ["notify_damage", "WhatsApp me when damage is found", "With the photos."],
  ["notify_clock", "WhatsApp me when a cleaner clocks in and out", ""],
]

/** Settings > Cleaner app: the checklist, photo rules, GPS and the
 *  WhatsApp messages the manager gets. */
export function CleanerAppPage() {
  const { t } = useT()
  const [s, setS] = useState<S | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    call<S>("cloudtrade_hospitality.cleaner_app.get_settings").then(setS).catch((e) => setMsg({ ok: false, text: serverError(e) }))
  }, [])
  if (!s) return <p className="text-sm text-zinc-500">{msg?.text || t("Loading…")}</p>

  const items = s.checklist
  const setItems = (n: Item[]) => setS({ ...s, checklist: n })
  const move = (i: number, by: number) => {
    const j = i + by
    if (j < 0 || j >= items.length) return
    const n = [...items]
    ;[n[i], n[j]] = [n[j], n[i]]
    setItems(n)
  }
  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      setS(await call<S>("cloudtrade_hospitality.cleaner_app.save_settings", {
        data: JSON.stringify({ ...s, checklist: items.filter((i) => i.label.trim()) }),
      }))
      setMsg({ ok: true, text: t("Saved.") })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }
  const link = `${window.location.origin}/clean`

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{t("The cleaner app")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-600">
          <p>{t("Cleaners open this link on their phone and sign in with the number you added (cleaner add … on WhatsApp). The code comes on WhatsApp - no password.")}</p>
          <p className="break-all font-mono text-zinc-900">{link}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("Checklist after cleaning")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2">
              <input value={it.label} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                className="w-full min-w-0 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm sm:w-auto sm:flex-1" />
              <select value={it.kind} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, kind: e.target.value as Item["kind"] } : x)))}
                className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
                <option value="check">{t("Tick")}</option>
                <option value="number">{t("Number")}</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-zinc-600">
                <input type="checkbox" checked={!!it.required} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, required: e.target.checked ? 1 : 0 } : x)))} />
                {t("Required")}
              </label>
              <button type="button" aria-label="Up" onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100"><ArrowUp className="size-4" /></button>
              <button type="button" aria-label="Down" onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100"><ArrowDown className="size-4" /></button>
              <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((_, k) => k !== i))} className="grid size-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button variant="outline" onClick={() => setItems([...items, { label: "", kind: "check", required: 1 }])}>
            <Plus className="size-4" /> {t("Add an item")}
          </Button>
          <p className="text-xs text-zinc-500">{t("A required tick can still be marked not done - the cleaner must then say what is wrong, and you see it in the finish message.")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("Photos, location and messages")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {TOGGLES.map(([k, label, help]) => (
            <label key={k} className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4" checked={!!s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked ? 1 : 0 })} />
              <span>
                <span className="block text-sm font-medium text-zinc-900">{t(label)}</span>
                {help && <span className="block text-xs text-zinc-500">{t(help)}</span>}
              </span>
            </label>
          ))}
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>{busy ? t("Saving…") : t("Save")}</Button>
        {msg && <span className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg.text}</span>}
      </div>
    </div>
  )
}
