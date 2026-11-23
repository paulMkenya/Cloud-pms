import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { call, serverError } from "../../lib/api"
import { useT } from "../../lib/i18n"

interface Prop {
  name: string
  property_name: string
  city?: string | null
  hero_image?: string | null
}

/** Settings > Order of properties: the order the booking homepage shows
 *  the properties in. Move each one up or down, then save. */
export function PropertyOrderPage() {
  const { t } = useT()
  const [list, setList] = useState<Prop[] | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const take = (r: { properties: Prop[]; can_edit: boolean }) => {
    setList(r.properties)
    setSaved(r.properties.map((p) => p.name))
    setCanEdit(r.can_edit)
  }
  useEffect(() => {
    call<{ properties: Prop[]; can_edit: boolean }>("cloudtrade_hospitality.property_order.get_order")
      .then(take)
      .catch((e) => setMsg({ ok: false, text: serverError(e) }))
  }, [])

  const move = (i: number, by: number) =>
    setList((l) => {
      if (!l) return l
      const j = i + by
      if (j < 0 || j >= l.length) return l
      const n = [...l]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  const changed = !!list && list.map((p) => p.name).join("|") !== saved.join("|")

  async function save() {
    if (!list) return
    setBusy(true)
    setMsg(null)
    try {
      take(await call("cloudtrade_hospitality.property_order.save_order", {
        names: JSON.stringify(list.map((p) => p.name)),
      }))
      setMsg({ ok: true, text: t("Saved - the booking homepage now shows the properties in this order.") })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Order of properties")}</CardTitle>
        <p className="text-sm text-zinc-500">
          {t("The order guests see on the booking homepage. When a guest searches dates, the ones free for those dates come first, still in this order.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!list && !msg && <p className="text-sm text-zinc-400">{t("Loading…")}</p>}
        {list && (
          <ol className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {list.map((p, i) => (
              <li key={p.name} className="flex items-center gap-3 px-3 py-2">
                <span className="w-6 shrink-0 text-end text-sm font-semibold tabular-nums text-zinc-400">{i + 1}</span>
                {p.hero_image ? (
                  <img src={p.hero_image} alt="" className="size-10 shrink-0 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="size-10 shrink-0 rounded-lg bg-zinc-100" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{p.property_name}</span>
                  {p.city && <span className="block truncate text-xs text-zinc-500">{p.city}</span>}
                </span>
                {canEdit && (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      aria-label={t("Move {name} up", { name: p.property_name })}
                      className="grid size-10 place-items-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-30">
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1}
                      aria-label={t("Move {name} down", { name: p.property_name })}
                      className="grid size-10 place-items-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-30">
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {!canEdit && list && (
          <p className="text-sm text-zinc-500">{t("Only a Hotel Admin can change the order.")}</p>
        )}
        {msg && (
          <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
            {msg.text}
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy || !changed}>
              {busy ? t("Saving…") : t("Save order")}
            </Button>
            {changed && (
              <Button variant="ghost" onClick={() => setList((l) => l && saved.map((n) => l.find((p) => p.name === n)!))}>
                {t("Undo changes")}
              </Button>
            )}
            <a href="/kamra/book" target="_blank" rel="noreferrer"
              className="self-center text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
              {t("Open the booking homepage")}
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
