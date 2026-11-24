/** Housekeeping > Housekeepers: the cleaners (name, phone, the houses they
 *  clean) - add, change, remove - and, on the second tab, who cleans each
 *  coming checkout. Same list as WhatsApp "cleaner add ...".
 *  Server: cloudtrade_hospitality.allocations. */
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"
import CleaningCheckouts from "./CleaningCheckouts"

interface HK { name: string; phone: string; properties: string[]; labels: string[]; test: boolean; upcoming: number }
interface Prop { name: string; label: string }
interface Data { housekeepers: HK[]; properties: Prop[]; app_link: string }
interface Form { name: string; phone: string; properties: string[]; original?: string; welcome: boolean }

const M = "cloudtrade_hospitality.allocations."
const nice = (p: string) => (p.startsWith("254") && p.length === 12 ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p)

export default function Housekeepers() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "checkouts" ? "checkouts" : "people"
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex gap-2 border-b border-zinc-200">
        {([["people", t("Housekeepers")], ["checkouts", t("Checkouts")]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setParams(k === "people" ? {} : { tab: k })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-500"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "people" ? <People /> : <div className="-mx-4 sm:-mx-6"><CleaningCheckouts /></div>}
    </div>
  )
}

function People() {
  const { t } = useT()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    call<Data>(M + "housekeepers").then((d) => { setData(d); setErr(null) }).catch((e) => setErr(serverError(e)))
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!form) return
    setBusy(true); setErr(null)
    try {
      setData(await call<Data>(M + "save_housekeeper", {
        name: form.name, phone: form.phone, properties: JSON.stringify(form.properties),
        original_phone: form.original || "", welcome: form.welcome ? 1 : 0,
      }))
      setForm(null)
    } catch (e) { setErr(serverError(e)) } finally { setBusy(false) }
  }
  async function remove(h: HK) {
    if (!window.confirm(t("Remove {name}? Their coming checkouts go back to 'no cleaner'.", { name: h.name }))) return
    setBusy(true); setErr(null)
    try { setData(await call<Data>(M + "remove_housekeeper", { phone: h.phone })) } catch (e) { setErr(serverError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-zinc-900">{t("Housekeepers")}</h1>
          <p className="text-sm text-zinc-500">{t("They need no login: they get their jobs on WhatsApp and use the cleaning app with their phone number.")}</p>
        </div>
        <button type="button" onClick={() => setForm({ name: "", phone: "", properties: [], welcome: true })}
          className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">
          <Plus className="size-4" /> {t("Add housekeeper")}
        </button>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {form && data && (
        <div className="space-y-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
          <div className="flex items-center">
            <h2 className="flex-1 text-base font-semibold text-zinc-900">{form.original ? t("Change housekeeper") : t("New housekeeper")}</h2>
            <button type="button" aria-label="Close" onClick={() => setForm(null)}><X className="size-5 text-zinc-500" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-zinc-700">{t("Name")}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mary Wanjiku"
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-zinc-700">{t("WhatsApp number")}
              <input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0712 345 678"
                className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <div>
            <p className="mb-1 text-sm text-zinc-700">{t("Houses she / he cleans")}</p>
            <div className="flex flex-wrap gap-2">
              {data.properties.map((p) => {
                const on = form.properties.includes(p.name)
                return (
                  <button key={p.name} type="button"
                    onClick={() => setForm({ ...form, properties: on ? form.properties.filter((x) => x !== p.name) : [...form.properties, p.name] })}
                    className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>
          {!form.original && (
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={form.welcome} onChange={(e) => setForm({ ...form, welcome: e.target.checked })} />
              {t("Send a welcome WhatsApp with the cleaning app link")}
            </label>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !form.name.trim() || !form.phone.trim() || form.properties.length === 0}
              onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? t("Saving…") : t("Save")}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700">{t("Cancel")}</button>
          </div>
        </div>
      )}

      {!data ? <p className="text-sm text-zinc-500">{t("Loading…")}</p>
        : data.housekeepers.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">{t("No housekeepers yet. Tap Add housekeeper.")}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {data.housekeepers.map((h) => (
              <li key={h.phone} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900">{h.name}{h.test ? <span className="ms-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{t("test")}</span> : null}</p>
                  <p className="text-xs text-zinc-500">{nice(h.phone)} · {h.labels.join(", ") || t("no houses")}</p>
                  {h.upcoming > 0 && <p className="text-xs text-brand-700">{t("{n} coming checkout(s) given to her / him", { n: h.upcoming })}</p>}
                </div>
                <button type="button" onClick={() => setForm({ name: h.name, phone: h.phone, properties: h.properties, original: h.phone, welcome: false })}
                  className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"><Pencil className="size-4" /> {t("Change")}</button>
                <button type="button" onClick={() => void remove(h)} disabled={busy}
                  className="grid size-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" aria-label="Remove"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      {data && <p className="text-xs text-zinc-500">{t("Cleaning app link to share")}: <span className="font-mono">{data.app_link}</span></p>}
    </div>
  )
}
