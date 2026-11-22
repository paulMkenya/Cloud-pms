import { useEffect, useState } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { WhatsAppLogo } from "../../components/WhatsAppBook"
import { call, serverError } from "../../lib/api"
import { useT } from "../../lib/i18n"
import { Switch } from "./ModulePage"

interface Cfg {
  enabled: number
  number: string
  on_property: number
  on_home: number
  brand: string
  can_edit: boolean
}

/** Settings > WhatsApp booking button: an administrator switches the public
 *  "Book via WhatsApp" buttons on or off and sets the business number. */
export function WhatsAppButtonPage() {
  const { t } = useT()
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [number, setNumber] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    call<Cfg>("cloudtrade_hospitality.wa_button.get_config")
      .then((c) => {
        setCfg(c)
        setNumber(c.number ? `+${c.number}` : "")
      })
      .catch((e) => setMsg({ ok: false, text: serverError(e) }))
  }, [])

  async function save(next: Partial<Cfg>) {
    if (!cfg) return
    const merged = { ...cfg, ...next }
    setBusy(true)
    setMsg(null)
    try {
      const out = await call<Cfg>("cloudtrade_hospitality.wa_button.save_config", {
        enabled: merged.enabled, number, on_property: merged.on_property, on_home: merged.on_home,
      })
      setCfg(out)
      setNumber(out.number ? `+${out.number}` : "")
      setMsg({ ok: true, text: t("Saved.") })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!cfg) return <p className="py-6 text-sm text-zinc-400">{msg?.text || t("Loading…")}</p>
  const locked = !cfg.can_edit || busy
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white">
            <WhatsAppLogo className="size-5" />
          </span>
          <div>
            <CardTitle>{t("WhatsApp booking button")}</CardTitle>
            <p className="mt-1 text-sm text-zinc-500">
              {t("Under the booking button, \"Book on WhatsApp instead\" carries the guest's chosen unit, dates and guests into the chat - the bot only asks for the name and payment. A small button on the homepage opens the bot menu.")}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-zinc-900">{t("Show the WhatsApp buttons")}</p>
            <p className="text-sm text-zinc-500">{cfg.enabled ? t("On - guests see them now.") : t("Off - guests don't see them.")}</p>
          </div>
          <Switch on={!!cfg.enabled} disabled={locked} label={t("Show the WhatsApp buttons")}
            onToggle={() => save({ enabled: cfg.enabled ? 0 : 1 })} />
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{t("Business WhatsApp number")}</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 sm:max-w-xs"
              inputMode="tel" placeholder="+254 7XX XXX XXX" value={number} disabled={!cfg.can_edit}
              onChange={(e) => setNumber(e.target.value)} />
            <Button disabled={locked || !number.trim()} onClick={() => save({})}>{t("Save number")}</Button>
          </div>
          <span className="mt-1 block text-xs text-zinc-500">{t("The number the booking bot answers on.")}</span>
        </label>

        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          <div className="flex items-center justify-between gap-4 p-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t("Under the booking button")}</p>
              <p className="text-xs text-zinc-500">{t("Shows once the dates are available, in your booking page colour.")}</p>
            </div>
            <Switch on={!!cfg.on_property} disabled={locked} label={t("Under the booking button")}
              onToggle={() => save({ on_property: cfg.on_property ? 0 : 1 })} />
          </div>
          <div className="flex items-center justify-between gap-4 p-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">{t("Floating button on the homepage")}</p>
              <p className="text-xs text-zinc-500">{t("Opens the bot's main menu.")}</p>
            </div>
            <Switch on={!!cfg.on_home} disabled={locked} label={t("Floating button on the homepage")}
              onToggle={() => save({ on_home: cfg.on_home ? 0 : 1 })} />
          </div>
        </div>

        {!cfg.can_edit && <p className="text-sm text-zinc-500">{t("Only a Hotel Admin can change this.")}</p>}
        {msg && <p role="status" className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</p>}
      </CardContent>
    </Card>
  )
}
