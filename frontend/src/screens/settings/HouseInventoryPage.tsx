import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { call, serverError } from "../../lib/api"
import { useT } from "../../lib/i18n"

interface Row { item: string; qty: number }
interface House { property: string; label: string; items: number; cleaners: number; accepted: number }
interface Detail {
  items: Row[]
  cleaners: { cleaner: string; accepted_on: string | null; differences: string | null; record: string | null; current: boolean }[]
}
const M = "cloudtrade_hospitality.cleaner_app."
const STARTER = ["Towels", "Bed sheets", "Duvets", "Pillows", "Plates", "Cups", "Glasses", "Spoons", "Forks", "Knives", "Pots", "Remote controls"]

/** Settings > House inventory: each house's items (towels, duvets, plates,
 *  cups...). Cleaners count them in the cleaning app and accept
 *  responsibility before their first clean, and again when the list changes. */
export function HouseInventoryPage() {
  const { t } = useT()
  const [houses, setHouses] = useState<House[] | null>(null)
  const [open, setOpen] = useState<House | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const loadAll = () => call<House[]>(M + "inventory_overview").then(setHouses).catch((e) => setMsg(serverError(e)))
  useEffect(() => { void loadAll() }, [])

  if (open) return <HouseEditor house={open} back={() => { setOpen(null); void loadAll() }} />
  if (!houses) return <p className="text-sm text-zinc-500">{msg || t("Loading…")}</p>
  return (
    <Card>
      <CardHeader><CardTitle>{t("House inventory")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-600">{t("List the items in each house. A cleaner counts them in the cleaning app and accepts responsibility before her first clean there - and again whenever you change the list. You get her count on WhatsApp.")}</p>
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {houses.map((h) => (
            <li key={h.property}>
              <button type="button" onClick={() => setOpen(h)} className="flex w-full items-center gap-3 px-3 py-3 text-start hover:bg-zinc-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zinc-900">{h.label}</span>
                  <span className="block text-xs text-zinc-500">
                    {h.items ? `${h.items} ${t("items")}` : t("No list yet")}
                    {h.items > 0 && h.cleaners > 0 && ` · ${h.accepted}/${h.cleaners} ${t("cleaners accepted")}`}
                  </span>
                </span>
                <ChevronRight className="size-4 text-zinc-400" />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function HouseEditor({ house, back }: { house: House; back: () => void }) {
  const { t } = useT()
  const [d, setD] = useState<Detail | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    call<Detail>(M + "get_inventory", { property: house.property })
      .then((r) => { setD(r); setRows(r.items.length ? r.items : STARTER.map((item) => ({ item, qty: 0 }))) })
      .catch((e) => setMsg({ ok: false, text: serverError(e) }))
  }, [house.property])
  const set = (i: number, v: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...v } : r)))
  const move = (i: number, by: number) => {
    const j = i + by
    if (j < 0 || j >= rows.length) return
    const n = [...rows]
    ;[n[i], n[j]] = [n[j], n[i]]
    setRows(n)
  }
  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await call<Detail>(M + "save_inventory", {
        property: house.property, items: JSON.stringify(rows.filter((x) => x.item.trim())),
      })
      setD(r)
      setRows(r.items)
      setMsg({ ok: true, text: t("Saved. Cleaners of this house will be asked to count it again.") })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <button type="button" onClick={back} className="flex items-center text-sm font-medium text-brand-700">
        <ChevronLeft className="size-4" /> {t("All houses")}
      </button>
      <Card>
        <CardHeader><CardTitle>{house.label}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!d ? <p className="text-sm text-zinc-500">{msg?.text || t("Loading…")}</p> : (
            <>
              {d.items.length === 0 && <p className="text-xs text-zinc-500">{t("A starter list - set the numbers, remove what this house does not have, then Save.")}</p>}
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2">
                  <input value={r.item} onChange={(e) => set(i, { item: e.target.value })} placeholder={t("Item")}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
                  <input inputMode="numeric" value={String(r.qty)} aria-label={t("Quantity")}
                    onChange={(e) => set(i, { qty: Number(e.target.value.replace(/\D/g, "") || 0) })}
                    className="w-16 rounded-lg border border-zinc-300 px-2 py-1.5 text-center text-sm" />
                  <button type="button" aria-label="Up" onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100"><ArrowUp className="size-4" /></button>
                  <button type="button" aria-label="Down" onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100"><ArrowDown className="size-4" /></button>
                  <button type="button" aria-label="Remove" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="grid size-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setRows([...rows, { item: "", qty: 1 }])}>
                <Plus className="size-4" /> {t("Add an item")}
              </Button>
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={() => void save()} disabled={busy}>{busy ? t("Saving…") : t("Save")}</Button>
                {msg && <span className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg.text}</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {d && (
        <Card>
          <CardHeader><CardTitle>{t("Cleaners' sign-off")}</CardTitle></CardHeader>
          <CardContent>
            {d.cleaners.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("No cleaner is assigned to this house. On WhatsApp: cleaner add Mary 07… and the house name.")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.cleaners.map((c) => (
                  <li key={c.cleaner} className="rounded-xl border border-zinc-200 p-3">
                    <span className="font-medium text-zinc-900">{c.cleaner}</span>{" · "}
                    {c.current ? <span className="text-emerald-700">{t("accepted")} {c.accepted_on?.slice(0, 16)}</span>
                      : c.accepted_on ? <span className="text-amber-700">{t("list changed since")} {c.accepted_on.slice(0, 10)} - {t("asked to count again")}</span>
                        : <span className="text-amber-700">{t("not counted yet")}</span>}
                    {c.differences && <p className="mt-1 text-amber-800">{t("Differences")}: {c.differences}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
