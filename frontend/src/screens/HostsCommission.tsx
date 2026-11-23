import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, History, Plus, Send, Undo2, Wallet } from "lucide-react"

import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"
import { fmtMoney } from "../lib/money"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { Sheet } from "../components/ui/sheet"

/** Hosts & Commission: the units you own vs manage, the hosts you manage
 *  for, what they are owed, payouts and your commission per month - in the
 *  app, instead of the desk pages. Saves through the same records
 *  (Unit Commission Setup, Host, Host Payout, Booking Commission). */

type Model = "" | "Owned" | "Managed"
interface Unit {
  property: string
  property_label: string
  room_type: string
  unit_label: string
  rate_card: number
  model: Model
  host: string
  net_rate: number
  basis: Basis
  percent: number
  monthly_rent: number
}
type Basis = "Fixed price per night" | "Percentage" | "Monthly rent"
const BASES: { v: Basis; label: string; hint: string }[] = [
  { v: "Fixed price per night", label: "Fixed price", hint: "Host gets an agreed price per night, you keep what you sell above it" },
  { v: "Percentage", label: "Percentage", hint: "You keep a % of what the guest pays" },
  { v: "Monthly rent", label: "Monthly rent", hint: "Host gets a fixed amount every month, you keep all booking income" },
]
interface Host {
  name: string
  host_name: string
  phone?: string
  email?: string
  payout_method?: string
  bank_name?: string
  account_name?: string
  notes?: string
  disabled?: number
  owed: number
  paid: number
  balance: number
  units: number
}
interface Overview { enabled: boolean; can_edit: boolean; units: Unit[]; hosts: Host[] }
interface CommRow {
  reservation: string
  guest: string
  property_label: string
  unit_label: string
  host_label: string
  basis?: string
  check_in: string
  check_out: string
  nights: number
  status: string
  guest_total: number
  levy: number
  host_share: number
  commission: number
}
interface Commission {
  month: string
  prev: string
  next: string
  rows: CommRow[]
  totals: Record<string, number>
  properties: { name: string; label: string }[]
}

const money = (n: number) => fmtMoney(Math.round(n || 0))
const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
const METHODS = ["M-Pesa", "Bank Transfer", "Cash", "Other"]

export default function HostsCommission() {
  const { t } = useT()
  const [tab, setTab] = useState<"units" | "hosts" | "commission">("units")
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    call<Overview>("cloudtrade_hospitality.commission_api.overview")
      .then(setData)
      .catch((e) => setError(serverError(e)))
  }, [])
  useEffect(load, [load])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">{t("Hosts & Commission")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Which units are yours and which you manage, what each host is owed, and your commission.")}
        </p>
      </div>
      {data && !data.enabled && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("Commission tracking is switched off. Ask support to switch it on.")}
        </p>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 text-sm">
        {(["units", "hosts", "commission"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "flex-1 rounded-lg px-3 py-2 font-medium " +
              (tab === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")
            }
          >
            {k === "units" ? t("Units") : k === "hosts" ? t("Hosts") : t("Commission")}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      ) : tab === "units" ? (
        <UnitsTab data={data} onSaved={setData} onAddHost={() => setTab("hosts")} />
      ) : tab === "hosts" ? (
        <HostsTab hosts={data.hosts} canEdit={data.can_edit}
          onChanged={(hosts) => setData({ ...data, hosts })} />
      ) : (
        <CommissionTab />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- units */

function UnitsTab({ data, onSaved, onAddHost }: {
  data: Overview
  onSaved: (d: Overview) => void
  onAddHost: () => void
}) {
  const { t } = useT()
  const [rows, setRows] = useState<Unit[]>(data.units)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => setRows(data.units), [data.units])

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(data.units),
    [rows, data.units],
  )
  const byProperty = useMemo(() => {
    const m = new Map<string, Unit[]>()
    rows.forEach((u) => m.set(u.property_label, [...(m.get(u.property_label) || []), u]))
    return [...m.entries()]
  }, [rows])
  const activeHosts = data.hosts.filter((h) => !h.disabled)

  const set = (u: Unit, patch: Partial<Unit>) =>
    setRows((rs) => rs.map((r) => (r.room_type === u.room_type ? { ...r, ...patch } : r)))

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const out = await call<Overview>("cloudtrade_hospitality.commission_api.save_units", {
        rows: JSON.stringify(rows),
      })
      onSaved(out)
      setMsg({ ok: true, text: t("Saved. New bookings now track commission with these rates.") })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        {t("For each unit choose Mine (your own) or Managed (you manage it for a host). For a managed unit pick the host and how you split the money: a fixed price per night to the host, a percentage for you, or a fixed monthly rent to the host.")}
      </p>
      {activeHosts.length === 0 && (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          {t("No hosts yet.")}{" "}
          <button className="font-semibold text-brand-700 hover:underline" onClick={onAddHost}>
            {t("Add your first host")}
          </button>
        </p>
      )}
      {byProperty.map(([label, units]) => (
        <div key={label} className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-800">{label}</div>
          <div className="divide-y divide-zinc-100">
            {units.map((u) => {
              const managed = u.model === "Managed"
              const basis = u.basis || "Fixed price per night"
              const keep =
                !managed ? null
                : basis === "Fixed price per night" ? (u.net_rate > 0 ? u.rate_card - u.net_rate : null)
                : basis === "Percentage" ? (u.percent > 0 ? (u.rate_card * u.percent) / 100 : null)
                : null
              return (
                <div key={u.room_type} className="grid gap-3 px-4 py-3 sm:grid-cols-[1.1fr_1.3fr_1.3fr_1.3fr] sm:items-start">
                  <div>
                    <div className="text-sm font-medium text-zinc-900">{u.unit_label}</div>
                    <div className="text-xs text-zinc-500">{t("Your price")}: {money(u.rate_card)} / {t("night")}</div>
                  </div>
                  <div className="flex rounded-lg border border-zinc-300 p-0.5 text-sm">
                    {(["Owned", "Managed", ""] as Model[]).map((m) => (
                      <button
                        key={m || "none"}
                        disabled={!data.can_edit}
                        onClick={() => set(u, { model: m })}
                        className={
                          "flex-1 rounded-md px-2 py-1.5 " +
                          (u.model === m ? "bg-brand-600 font-semibold text-white" : "text-zinc-600 hover:bg-zinc-50")
                        }
                      >
                        {m === "Owned" ? t("Mine") : m === "Managed" ? t("Managed") : t("Not set")}
                      </button>
                    ))}
                  </div>
                  {managed ? (
                    <div className="space-y-2">
                      <select
                        className={inputCls}
                        value={u.host}
                        disabled={!data.can_edit}
                        onChange={(e) => set(u, { host: e.target.value })}
                      >
                        <option value="">{t("Choose host…")}</option>
                        {activeHosts.map((h) => (
                          <option key={h.name} value={h.name}>{h.host_name}</option>
                        ))}
                      </select>
                      <select
                        className={inputCls}
                        value={basis}
                        disabled={!data.can_edit}
                        title={t(BASES.find((b) => b.v === basis)?.hint || "")}
                        onChange={(e) => set(u, { basis: e.target.value as Basis })}
                      >
                        {BASES.map((b) => <option key={b.v} value={b.v}>{t(b.label)}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                  {managed ? (
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">
                        {basis === "Percentage" ? t("Your commission %")
                          : basis === "Monthly rent" ? t("Rent to host per month")
                          : t("Host price per night")}
                      </label>
                      <input
                        className={inputCls}
                        inputMode="numeric"
                        value={(basis === "Percentage" ? u.percent : basis === "Monthly rent" ? u.monthly_rent : u.net_rate) || ""}
                        disabled={!data.can_edit}
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/[^0-9.]/g, "")) || 0
                          set(u, basis === "Percentage" ? { percent: v } : basis === "Monthly rent" ? { monthly_rent: v } : { net_rate: v })
                        }}
                      />
                      <div className={"mt-1 text-xs " + (keep !== null && keep <= 0 ? "text-rose-700" : "text-emerald-700")}>
                        {basis === "Monthly rent"
                          ? (u.monthly_rent > 0 ? t("You keep all booking income and owe the host {amount} every month", { amount: money(u.monthly_rent) }) : "")
                          : keep === null ? ""
                          : keep > 0 ? t("You keep about {amount} / night at your price", { amount: money(keep) })
                          : t("Host price is above your price")}
                      </div>
                    </div>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {data.can_edit && (
        <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-rose-700")}>{msg.text}</span>}
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Save changes")}
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- hosts */

function HostsTab({ hosts, canEdit, onChanged }: {
  hosts: Host[]
  canEdit: boolean
  onChanged: (h: Host[]) => void
}) {
  const { t } = useT()
  const [edit, setEdit] = useState<Partial<Host> & { payout_account?: string } | null>(null)
  const [pay, setPay] = useState<Host | null>(null)
  const [stmt, setStmt] = useState<Host | null>(null)
  const [hist, setHist] = useState<Host | null>(null)
  const owedTotal = hosts.reduce((s, h) => s + Math.max(0, h.balance), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          {t("Owed to hosts now")}: <b className="text-zinc-900">{money(owedTotal)}</b>
        </p>
        {canEdit && (
          <Button onClick={() => setEdit({ payout_method: "M-Pesa" })}>
            <Plus className="size-4" aria-hidden /> {t("Add host")}
          </Button>
        )}
      </div>
      {hosts.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
          {t("No hosts yet. Add the owners of the units you manage.")}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {hosts.map((h) => (
          <div key={h.name} className={"rounded-xl border bg-white p-4 " + (h.disabled ? "border-zinc-200 opacity-60" : "border-zinc-200")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-zinc-900">{h.host_name}</div>
                <div className="text-xs text-zinc-500">
                  {[h.phone, h.payout_method, t("{n} units", { n: String(h.units) })].filter(Boolean).join(" · ")}
                </div>
              </div>
              {h.disabled ? <Badge tone="zinc">{t("Inactive")}</Badge> : null}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-zinc-500">{t("Earned")}</dt><dd className="font-medium">{money(h.owed)}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t("Paid")}</dt><dd className="font-medium">{money(h.paid)}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t("Owed now")}</dt><dd className={"font-semibold " + (h.balance > 0 ? "text-amber-700" : "text-zinc-900")}>{money(h.balance)}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" onClick={() => setPay(h)}>
                  <Wallet className="size-4" aria-hidden /> {t("Record payout")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setHist(h)}>
                <History className="size-4" aria-hidden /> {t("History")}
              </Button>
              <Button variant="outline" onClick={() => setStmt(h)}>
                <FileText className="size-4" aria-hidden /> {t("Statement")}
              </Button>
              {canEdit && (
                <Button variant="outline" onClick={() => setEdit(h)}>{t("Edit")}</Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {edit && <HostForm host={edit} onClose={() => setEdit(null)} onSaved={(hs) => { onChanged(hs); setEdit(null) }} />}
      {pay && <PayoutForm host={pay} onClose={() => setPay(null)} onSaved={(hs) => { onChanged(hs); setPay(null) }} />}
      {stmt && <StatementPanel host={stmt} canEdit={canEdit} onClose={() => setStmt(null)} />}
      {hist && <PayoutHistory host={hist} canEdit={canEdit} onClose={() => setHist(null)} onChanged={onChanged} />}
    </div>
  )
}

function HostForm({ host, onClose, onSaved }: {
  host: Partial<Host> & { payout_account?: string }
  onClose: () => void
  onSaved: (h: Host[]) => void
}) {
  const { t } = useT()
  const [f, setF] = useState(host)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const field = (k: keyof typeof f, label: string, props: Record<string, string> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-600">{label}</span>
      <input className={inputCls} value={String(f[k] ?? "")} {...props}
        onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const out = await call<{ hosts: Host[] }>("cloudtrade_hospitality.commission_api.save_host", {
        data: JSON.stringify(f),
      })
      onSaved(out.hosts)
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={host.name ? t("Edit host") : t("Add host")} onClose={onClose}
      footer={<Button className="w-full justify-center" disabled={busy || !f.host_name} onClick={() => void save()}>{busy ? t("Saving…") : t("Save")}</Button>}>
      <div className="space-y-3">
        {field("host_name", t("Name"))}
        {field("phone", t("Phone (for statements on WhatsApp)"), { inputMode: "tel", placeholder: "0712 345 678" })}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-600">{t("How they are paid")}</span>
          <select className={inputCls} value={f.payout_method || "M-Pesa"} onChange={(e) => setF({ ...f, payout_method: e.target.value })}>
            {METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}
          </select>
        </label>
        {field("payout_account", t("M-Pesa number or account number (kept private)"), { placeholder: host.name ? t("Leave empty to keep the saved one") : "" })}
        {f.payout_method === "Bank Transfer" && field("bank_name", t("Bank"))}
        {f.payout_method === "Bank Transfer" && field("account_name", t("Account name"))}
        {field("email", t("Email (optional)"), { type: "email" })}
        {host.name && (
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" className="size-4 accent-brand-600" checked={Boolean(f.disabled)}
              onChange={(e) => setF({ ...f, disabled: e.target.checked ? 1 : 0 })} />
            {t("Inactive (no longer managed)")}
          </label>
        )}
        {err && <p className="text-sm text-rose-700">{err}</p>}
      </div>
    </Sheet>
  )
}

function PayoutForm({ host, onClose, onSaved }: { host: Host; onClose: () => void; onSaved: (h: Host[]) => void }) {
  const { t } = useT()
  const [amount, setAmount] = useState(host.balance > 0 ? String(Math.round(host.balance)) : "")
  const [method, setMethod] = useState(host.payout_method || "M-Pesa")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const out = await call<{ hosts: Host[] }>("cloudtrade_hospitality.commission_api.record_payout", {
        host: host.name, amount: Number(amount), method, reference,
      })
      onSaved(out.hosts)
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t("Record payout")} description={`${host.host_name} · ${t("owed now")} ${money(host.balance)}`} onClose={onClose}
      footer={<Button className="w-full justify-center" disabled={busy || !(Number(amount) > 0)} onClick={() => void save()}>{busy ? t("Saving…") : t("Record payout")}</Button>}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-600">{t("Amount paid (KES)")}</span>
          <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-600">{t("Paid by")}</span>
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-600">{t("Reference (e.g. M-Pesa code)")}</span>
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {err && <p className="text-sm text-rose-700">{err}</p>}
      </div>
    </Sheet>
  )
}

function monthNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}
function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number)
  const d = new Date(y, mo - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function StatementPanel({ host, canEdit, onClose }: { host: Host; canEdit: boolean; onClose: () => void }) {
  const { t } = useT()
  const [month, setMonth] = useState(monthNow())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function download() {
    try {
      const r = await call<{ url: string }>("cloudtrade_hospitality.commission_api.statement_link", { host: host.name, month })
      window.open(r.url, "_blank")
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    }
  }
  async function send() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await call<{ sent?: boolean; skipped?: string; to?: string; error?: string }>(
        "cloudtrade_hospitality.commission_api.send_statement", { host: host.name, month })
      setMsg(r.sent
        ? { ok: true, text: t("Sent to {to} on WhatsApp.", { to: r.to || "" }) }
        : { ok: false, text: r.skipped === "no phone" ? t("Add the host's phone number first.") : (r.error || t("Not sent.")) })
    } catch (e) {
      setMsg({ ok: false, text: serverError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t("Statement")} description={host.host_name} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-2 py-1.5">
          <button className="rounded p-1 hover:bg-zinc-100" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Previous month")}><ChevronLeft className="size-4" /></button>
          <span className="text-sm font-medium">{monthLabel(month)}</span>
          <button className="rounded p-1 hover:bg-zinc-100" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Next month")}><ChevronRight className="size-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download()}><Download className="size-4" aria-hidden /> {t("Download PDF")}</Button>
          {canEdit && <Button disabled={busy} onClick={() => void send()}><Send className="size-4" aria-hidden /> {busy ? t("Sending…") : t("Send on WhatsApp")}</Button>}
        </div>
        {msg && <p className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-rose-700")}>{msg.text}</p>}
        <p className="text-xs text-zinc-500">{t("Every host also gets their statement automatically on the 1st of each month.")}</p>
      </div>
    </Sheet>
  )
}

/* ----------------------------------------------------------- commission */

function CommissionTab() {
  const { t } = useT()
  const [month, setMonth] = useState(monthNow())
  const [property, setProperty] = useState("")
  const [d, setD] = useState<Commission | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setErr(null)
    call<Commission>("cloudtrade_hospitality.commission_api.commission", { month, property })
      .then(setD)
      .catch((e) => setErr(serverError(e)))
  }, [month, property])

  function exportCsv() {
    if (!d) return
    const head = ["Booking", "Guest", "Property", "Unit", "Host", "Check-in", "Check-out", "Nights", "Status", "Guest paid", "Levy", "Host share", "Your commission"]
    const lines = d.rows.map((r) => [r.reservation, r.guest, r.property_label, r.unit_label, r.host_label, r.check_in, r.check_out, r.nights, r.status, r.guest_total, r.levy, r.host_share, r.commission])
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    a.download = `commission-${month}.csv`
    a.click()
  }

  const tot = d?.totals || {}
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 px-1.5 py-1">
          <button className="rounded p-1 hover:bg-zinc-100" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Previous month")}><ChevronLeft className="size-4" /></button>
          <span className="min-w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
          <button className="rounded p-1 hover:bg-zinc-100" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Next month")}><ChevronRight className="size-4" /></button>
        </div>
        <select className={inputCls + " w-auto"} value={property} onChange={(e) => setProperty(e.target.value)}>
          <option value="">{t("All properties")}</option>
          {(d?.properties || []).map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
        </select>
        <Button variant="outline" className="ms-auto" disabled={!d?.rows.length} onClick={exportCsv}>
          <Download className="size-4" aria-hidden /> {t("Export")}
        </Button>
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t("Your commission"), tot.commission, "text-emerald-700"],
          [t("Hosts' share"), tot.host_share, "text-zinc-900"],
          [t("Guests paid (managed units)"), tot.guest_total, "text-zinc-900"],
          [t("Your own units"), tot.own_revenue, "text-zinc-900"],
          ...((tot.rent_due || 0) > 0 ? [[t("Rent owed to hosts this month"), tot.rent_due, "text-amber-700"]] : []),
        ].map(([label, v, cls]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className={"text-lg font-semibold " + cls}>{money(Number(v) || 0)}</div>
          </div>
        ))}
      </div>
      {(tot.pending_commission || 0) > 0 && (
        <p className="text-xs text-zinc-500">{t("Plus {amount} expected from bookings not yet paid.", { amount: money(tot.pending_commission) })}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="m-cards w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">{t("Stay")}</th>
              <th className="px-3 py-2">{t("Guest")}</th>
              <th className="px-3 py-2 text-right">{t("Guest paid")}</th>
              <th className="px-3 py-2 text-right">{t("Host share")}</th>
              <th className="px-3 py-2 text-right">{t("Your commission")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(d?.rows || []).map((r) => (
              <tr key={r.reservation}>
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-900">{r.property_label}</div>
                  <div className="text-xs text-zinc-500">{r.unit_label} · {r.check_in} → {r.check_out}{r.host_label ? ` · ${r.host_label}` : ""}{r.basis && r.basis !== "Fixed price per night" ? ` · ${t(r.basis)}` : ""}</div>
                </td>
                <td className="px-3 py-2">
                  <div>{r.guest}</div>
                  <div className="text-xs text-zinc-500">{r.reservation}{r.status === "Pending" ? ` · ${t("not paid yet")}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-right">{money(r.guest_total)}</td>
                <td className="px-3 py-2 text-right">{money(r.host_share)}</td>
                <td className={"px-3 py-2 text-right font-semibold " + (r.status === "Pending" ? "text-zinc-400" : "text-emerald-700")}>{money(r.commission)}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-500">{t("No bookings in managed units this month.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}


interface Payout {
  name: string
  date: string
  amount: number
  method: string
  reference: string
  notes: string
  undone: boolean
  undo_reason: string
  by: string
}

function PayoutHistory({ host, canEdit, onClose, onChanged }: {
  host: Host
  canEdit: boolean
  onClose: () => void
  onChanged: (h: Host[]) => void
}) {
  const { t } = useT()
  const [rows, setRows] = useState<Payout[] | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    call<Payout[]>("cloudtrade_hospitality.commission_api.payouts", { host: host.name })
      .then(setRows)
      .catch((e) => setErr(serverError(e)))
  }, [host.name])
  const total = (rows || []).filter((p) => !p.undone).reduce((a, p) => a + p.amount, 0)

  async function undo(p: Payout) {
    setBusy(true)
    setErr(null)
    try {
      const out = await call<{ payouts: Payout[]; hosts: Host[] }>(
        "cloudtrade_hospitality.commission_api.undo_payout", { payout: p.name, reason })
      setRows(out.payouts)
      onChanged(out.hosts)
      setUndoing(null)
      setReason("")
    } catch (e) {
      setErr(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t("Payout history")} description={`${host.host_name} · ${t("paid in total")} ${money(total)}`} onClose={onClose}>
      {err && <p className="mb-3 text-sm text-rose-700">{err}</p>}
      {!rows ? (
        <p className="py-6 text-center text-sm text-zinc-400">{t("Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{t("No payouts yet.")}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((p) => (
            <li key={p.name} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className={p.undone ? "text-zinc-400" : ""}>
                  <div className={"font-semibold " + (p.undone ? "line-through" : "text-zinc-900")}>{money(p.amount)}</div>
                  <div className="text-xs text-zinc-500">
                    {[p.date, t(p.method || ""), p.reference, p.by ? t("by {name}", { name: p.by }) : ""].filter(Boolean).join(" · ")}
                  </div>
                  {p.undone && (
                    <div className="mt-1 text-xs text-rose-700">{t("Undone")}: {p.undo_reason}</div>
                  )}
                </div>
                {canEdit && !p.undone && undoing !== p.name && (
                  <Button variant="outline" onClick={() => { setUndoing(p.name); setReason("") }}>
                    <Undo2 className="size-4" aria-hidden /> {t("Undo")}
                  </Button>
                )}
              </div>
              {undoing === p.name && (
                <div className="mt-2 space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm text-rose-800">
                    {t("Undo this payout of {amount}? It stays in the history, crossed out, and the host's balance goes back up.", { amount: money(p.amount) })}
                  </p>
                  <input className={inputCls} autoFocus placeholder={t("Why? e.g. entered twice")} value={reason}
                    onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button disabled={busy || !reason.trim()} onClick={() => void undo(p)}>{busy ? t("Undoing…") : t("Undo payout")}</Button>
                    <Button variant="outline" onClick={() => setUndoing(null)}>{t("Keep it")}</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
