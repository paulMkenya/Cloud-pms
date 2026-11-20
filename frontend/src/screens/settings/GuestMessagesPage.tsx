import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageSquareText, Plus, Trash2 } from "lucide-react"

import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { call, serverError } from "../../lib/api"
import { useT, t as translate } from "../../lib/i18n"

/** Guest WhatsApp/SMS template editor (CloudTrade Hospitality).
 *  Overrides live in site_config guest_templates: scope "*" = every
 *  property, a Property name = that property, "<property>:<room>" = one
 *  unit. Empty body clears the override. */

interface TemplateOverride {
  whatsapp?: string
  sms?: string
  both?: string
}
interface GuestTemplate {
  key: string
  label: string
  tokens: string[]
  default_whatsapp: string
  default_sms: string
  overrides: Record<string, TemplateOverride>
}
interface Scopes {
  properties: string[]
  rooms: { name: string; property: string; label: string }[]
}
interface TemplateList {
  templates: GuestTemplate[]
  token_docs: Record<string, string>
}

const CHANNELS = [
  { id: "both", label: "WhatsApp + SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
] as const

function scopeLabel(scope: string, props: Scopes | null) {
  if (scope === "*") return translate("All properties")
  const [prop, room] = scope.split(":")
  const p = props?.properties.find((x) => x === prop) ?? prop
  if (!room) return p
  const r = props?.rooms.find((x) => x.name === room)
  return `${p} · ${r?.label.split(": ")[1] ?? room}`
}

export function GuestMessagesPage() {
  const { t } = useT()
  const [templates, setTemplates] = useState<GuestTemplate[] | null>(null)
  const [tokenDocs, setTokenDocs] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState("")
  const [scopes, setScopes] = useState<Scopes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // new-override form
  const [scopeKind, setScopeKind] = useState<"*" | "property" | "unit">("*")
  const [scopeProp, setScopeProp] = useState("")
  const [scopeRoom, setScopeRoom] = useState("")
  const [channel, setChannel] = useState<string>("both")
  const [body, setBody] = useState("")

  const load = useCallback(() => {
    call<TemplateList>("cloudtrade_hospitality.guest_templates.list_templates")
      .then((rows) => {
        setTemplates(rows.templates)
        setTokenDocs(rows.token_docs || {})
        setSel((s) => s ?? rows.templates[0]?.key ?? null)
      })
      .catch((e) => setError(serverError(e)))
    call<Scopes>("cloudtrade_hospitality.guest_templates.template_scopes")
      .then(setScopes)
      .catch(() => setScopes(null))
  }, [])
  useEffect(load, [load])

  const tpl = useMemo(
    () => templates?.find((x) => x.key === sel) ?? null,
    [templates, sel],
  )

  const scopeValue = useMemo(() => {
    if (scopeKind === "*") return "*"
    if (scopeKind === "property") return scopeProp
    return scopeRoom ? `${scopeProp}:${scopeRoom}` : ""
  }, [scopeKind, scopeProp, scopeRoom])

  // live preview of whatever is in the editor box, rendered with sample
  // values at the scope/channel currently picked
  useEffect(() => {
    if (!sel) return
    const ch = channel === "sms" ? "sms" : "whatsapp"
    const id = setTimeout(() => {
      call<{ text: string }>("cloudtrade_hospitality.guest_templates.preview_template", {
        key: sel, scope: scopeValue || "*", channel: ch, body,
      }).then((r) => setPreview(r.text || "")).catch(() => setPreview(""))
    }, 350)
    return () => clearTimeout(id)
  }, [sel, scopeValue, channel, body])

  function insertToken(tok: string) {
    setBody((b) => `${b}{${tok}}`)
  }

  const roomsForProp = useMemo(
    () => (scopes?.rooms ?? []).filter((r) => r.property === scopeProp),
    [scopes, scopeProp],
  )

  const effectiveDefault = useCallback(
    (key: string, ch: string) => {
      const t2 = templates?.find((x) => x.key === key)
      if (!t2) return ""
      if (ch === "whatsapp") return t2.default_whatsapp
      if (ch === "sms") return t2.default_sms
      return t2.default_whatsapp || t2.default_sms
    },
    [templates],
  )

  function startEdit(scope: string, ch: string, existing?: string) {
    const [kind, prop, room] =
      scope === "*" ? ["*", "", ""]
      : scope.includes(":") ? ["unit", ...scope.split(":")]
      : ["property", scope, ""]
    setScopeKind(kind as typeof scopeKind)
    setScopeProp(prop ?? "")
    setScopeRoom(room ?? "")
    setChannel(ch)
    setBody(existing ?? effectiveDefault(sel!, ch === "both" ? "whatsapp" : ch))
  }

  async function save(scope: string, ch: string, text: string) {
    if (!sel) return
    setBusy(true)
    try {
      await call("cloudtrade_hospitality.guest_templates.save_template", {
        key: sel, scope, channel: ch, body: text,
      })
      load()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  if (error)
    return (
      <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">
        {translate(error)}
      </p>
    )
  if (!templates)
    return <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquareText className="size-5 text-brand-700" aria-hidden />
          {t("Guest messages")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          {t("WhatsApp and SMS texts guests receive. Edit the built-in wording per property or per unit - leave a scope empty to use the default.")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* template list */}
        <div className="space-y-1.5">
          {templates.map((tp) => (
            <button
              key={tp.key}
              type="button"
              onClick={() => setSel(tp.key)}
              className={`w-full rounded-lg border px-3 py-2 text-start text-sm transition ${
                sel === tp.key
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
              }`}
            >
              <span className="block">{t(tp.label)}</span>
              <span className="block text-[11px] text-zinc-400">{tp.key}</span>
            </button>
          ))}
        </div>

        {/* editor */}
        {tpl && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="text-sm font-medium text-zinc-800">{t("Default text")}</p>
              <div className="mt-1">
                <p className="text-xs font-medium text-zinc-500">{t("Placeholders - click to insert")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tpl.tokens.map((x) => (
                    <button
                      key={x}
                      type="button"
                      title={tokenDocs[x] ? translate(tokenDocs[x]) : x}
                      onClick={() => insertToken(x)}
                      className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-brand-700 hover:border-brand-300 hover:bg-brand-50"
                    >
                      {`{${x}}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {tpl.default_whatsapp && (
                  <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">{tpl.default_whatsapp}</pre>
                )}
                {tpl.default_sms && (
                  <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">{tpl.default_sms}</pre>
                )}
              </div>
            </div>

            {/* existing overrides */}
            {Object.keys(tpl.overrides).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-800">{t("Custom wording")}</p>
                {Object.entries(tpl.overrides).map(([scope, ov]) => {
                  const chans = [ov.both ? "both" : "", ov.whatsapp ? "whatsapp" : "", ov.sms ? "sms" : ""]
                    .filter(Boolean).join("+")
                  return (
                    <div key={scope} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
                      <span className="font-medium text-zinc-700">{scopeLabel(scope, scopes)}</span>
                      <Badge tone="zinc">{chans}</Badge>
                      <span className="flex-1 truncate text-xs text-zinc-400">
                        {(ov.both || ov.whatsapp || ov.sms || "").slice(0, 80)}
                      </span>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => startEdit(scope, ov.both ? "both" : ov.whatsapp ? "whatsapp" : "sms", ov.both || ov.whatsapp || ov.sms)}>
                        {t("Edit")}
                      </Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy}
                        onClick={() => save(scope, ov.both ? "both" : ov.whatsapp ? "whatsapp" : "sms", "")}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* new override */}
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800">
                <Plus className="size-4" aria-hidden /> {t("Add custom wording")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-zinc-600">
                  {t("Applies to")}
                  <select className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                    value={scopeKind}
                    onChange={(e) => { setScopeKind(e.target.value as typeof scopeKind); setScopeRoom("") }}>
                    <option value="*">{t("All properties")}</option>
                    <option value="property">{t("One property")}</option>
                    <option value="unit">{t("One unit / room")}</option>
                  </select>
                </label>
                {scopeKind !== "*" && (
                  <label className="block text-xs font-medium text-zinc-600">
                    {t("Property")}
                    <select className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                      value={scopeProp} onChange={(e) => { setScopeProp(e.target.value); setScopeRoom("") }}>
                      <option value="">{t("Pick a property")}</option>
                      {(scopes?.properties ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                )}
                {scopeKind === "unit" && (
                  <label className="block text-xs font-medium text-zinc-600">
                    {t("Unit / room")}
                    <select className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                      value={scopeRoom} onChange={(e) => setScopeRoom(e.target.value)}>
                      <option value="">{t("Pick a room")}</option>
                      {roomsForProp.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-medium text-zinc-600">
                  {t("Channel")}
                  <select className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                    value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {CHANNELS.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {tpl.tokens.map((x) => (
                  <button
                    key={x}
                    type="button"
                    title={tokenDocs[x] ? translate(tokenDocs[x]) : x}
                    onClick={() => insertToken(x)}
                    className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-brand-700 hover:border-brand-300 hover:bg-brand-50"
                  >
                    {`{${x}}`}
                  </button>
                ))}
              </div>
              <textarea
                className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("Message text with {placeholders}")}
              />
              {(body.trim() || channel !== "both") && (
                <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-sky-700">
                    {t("Preview")} · {channel === "sms" ? "SMS" : "WhatsApp"}
                    {scopeValue && scopeValue !== "*" ? ` · ${scopeLabel(scopeValue, scopes)}` : ""}
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">
                    {preview || t("(preview appears as you type)")}
                  </pre>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <Button className="px-3 py-1.5 text-xs" disabled={busy || !scopeValue || !body.trim()}
                  onClick={() => { save(scopeValue, channel, body); setBody("") }}>
                  {t("Save wording")}
                </Button>
                {body && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy}
                    onClick={() => setBody("")}>{t("Clear")}</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
