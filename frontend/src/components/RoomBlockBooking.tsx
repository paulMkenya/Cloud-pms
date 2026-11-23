import { useState, type ReactNode } from "react"
import { call } from "../lib/api"
import { serverError, type Row } from "../lib/resource"
import { useT } from "../lib/i18n"

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:py-1.5 sm:text-sm " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

const MODES = ["M-Pesa", "Cash", "Bank Transfer", "Card"] as const

function nightsBetween(a: string, b: string) {
  const x = Date.parse(a), y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 86_400_000) : 0
}

/** Room Blocks drawer section: enter the guest staying on closed dates -
 *  an Airbnb guest (money Airbnb collected, nothing due) or a direct guest
 *  (agreed price per night, deposit received). One booking covers all of
 *  the guest's nights: the dates may run past this closure, and every
 *  closure they touch on the unit opens for this guest only. */
export default function RoomBlockBooking({
  row,
  reload,
}: {
  row: Row
  reload: () => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const note = String(row.note || "")
  const fromCalendar = /airbnb|ical-import/i.test(note)
  const [via, setVia] = useState<"Airbnb" | "Direct">(fromCalendar ? "Airbnb" : "Direct")
  const [f, setF] = useState({
    guest_name: "",
    phone: "",
    adults: 2,
    children: 0,
    check_in: String(row.from_date || "").slice(0, 10),
    check_out: String(row.to_date || "").slice(0, 10),
    ota_ref: "",
    ota_total: "",
    paid_amount: "",
    rate: "",
    deposit: "",
    deposit_mode: "M-Pesa" as string,
    deposit_ref: "",
  })
  const eligible =
    String(row.block_status) === "Active" && String(row.reason) !== "Maintenance"
  // after a successful record the block is Released; keep the card so the
  // confirmation stays on screen
  if (!eligible && !done) return null

  const set = (k: keyof typeof f, v: string | number) =>
    setF((cur) => ({ ...cur, [k]: v }))
  const nights = nightsBetween(f.check_in, f.check_out)
  const directTotal = (Number(f.rate) || 0) * Math.max(0, nights)
  const pastClosure =
    f.check_in < String(row.from_date || "").slice(0, 10) ||
    f.check_out > String(row.to_date || "").slice(0, 10)
  const ready =
    !!f.guest_name.trim() &&
    nights > 0 &&
    (via === "Airbnb" ? Number(f.ota_total) > 0 : Number(f.rate) > 0)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await call<{
        reservation: string
        room: string | null
        paid?: number
        balance?: number
        payment_mode?: string
      }>("kamra.api.record_room_block_booking", {
        name: row.name,
        guest_name: f.guest_name.trim(),
        phone: f.phone.trim() || undefined,
        adults: Number(f.adults) || 2,
        children: Number(f.children) || 0,
        booked_via: via,
        check_in_date: f.check_in || undefined,
        check_out_date: f.check_out || undefined,
        ...(via === "Airbnb"
          ? {
              ota_ref: f.ota_ref.trim() || undefined,
              ota_total: Number(f.ota_total) || 0,
              paid_amount: f.paid_amount === "" ? undefined : Number(f.paid_amount),
            }
          : {
              rate_per_night: Number(f.rate) || 0,
              deposit: Number(f.deposit) || 0,
              deposit_mode: f.deposit_mode,
              deposit_ref: f.deposit_ref.trim() || undefined,
            }),
      })
      setDone(
        `${t("Booked")} ${res.reservation}${res.room ? ` · ${res.room}` : ""}` +
          (res.paid ? ` · ${t("paid")} ${res.paid.toLocaleString()} (${res.payment_mode})` : "") +
          (res.balance ? ` · ${t("balance")} ${res.balance.toLocaleString()}` : ""),
      )
      reload()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, el: ReactNode, wide = false, req = false) => (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-500">
        {label} {req && <span className="text-rose-500">*</span>}
      </span>
      {el}
    </label>
  )

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-700">{t("Guest on these dates")}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {fromCalendar
              ? t("Closed by an Airbnb calendar. Record who is staying - the dates stay closed to everyone else.")
              : t("Record a guest you agreed with directly - the dates stay closed to everyone else.")}
          </p>
        </div>
        {!open && !done && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 max-sm:min-h-11"
          >
            {t("Record booking")}
          </button>
        )}
      </div>
      {done && <p className="mt-3 text-sm text-emerald-700">{done}</p>}
      {open && !done && (
        <div className="mt-4 space-y-3">
          <div role="radiogroup" aria-label={t("Booked on")} className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-200/70 p-1 text-sm">
            {(["Airbnb", "Direct"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={via === v}
                onClick={() => setVia(v)}
                className={`rounded-md px-3 py-1.5 font-medium max-sm:min-h-10 ${via === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}
              >
                {v === "Airbnb" ? t("Booked on Airbnb") : t("Direct guest")}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {field(t("Guest name"), <input className={inputCls} value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} />, false, true)}
            {field(t("Phone"), <input className={inputCls} inputMode="tel" value={f.phone} placeholder="0712 345 678" onChange={(e) => set("phone", e.target.value)} />)}
            {field(t("Check-in"), <input type="date" className={inputCls} value={f.check_in} onChange={(e) => set("check_in", e.target.value)} />, false, true)}
            {field(t("Check-out"), <input type="date" className={inputCls} value={f.check_out} min={f.check_in} onChange={(e) => set("check_out", e.target.value)} />, false, true)}
            <p className="text-xs text-zinc-500 sm:col-span-2">
              {nights > 0 ? `${nights} ${nights === 1 ? t("night") : t("nights")}. ` : ""}
              {pastClosure
                ? t("These dates run past this closure - every closure they touch on this unit opens for this guest, in one booking.")
                : t("Use the guest's full stay - one booking covers all their nights, even across several closures.")}
            </p>
            {field(t("Adults"), <input type="number" min={1} className={inputCls} value={f.adults} onChange={(e) => set("adults", e.target.value)} />)}
            {field(t("Children"), <input type="number" min={0} className={inputCls} value={f.children} onChange={(e) => set("children", e.target.value)} />)}
            {via === "Airbnb" ? (
              <>
                {field(t("Airbnb total (KES)"), <input type="number" min={0} inputMode="decimal" className={inputCls} value={f.ota_total} onChange={(e) => set("ota_total", e.target.value)} />, false, true)}
                {field(t("Airbnb confirmation code"), <input className={inputCls} value={f.ota_ref} onChange={(e) => set("ota_ref", e.target.value)} />)}
                {field(t("Amount Airbnb collected (KES, optional)"), <input type="number" min={0} inputMode="decimal" className={inputCls} value={f.paid_amount} placeholder={t("Defaults to the Airbnb total")} onChange={(e) => set("paid_amount", e.target.value)} />, true)}
              </>
            ) : (
              <>
                {field(t("Price per night (KES)"), <input type="number" min={0} inputMode="decimal" className={inputCls} value={f.rate} onChange={(e) => set("rate", e.target.value)} />, false, true)}
                {field(t("Deposit received (KES)"), <input type="number" min={0} inputMode="decimal" className={inputCls} value={f.deposit} placeholder="0" onChange={(e) => set("deposit", e.target.value)} />)}
                {Number(f.deposit) > 0 && (
                  <>
                    {field(t("Deposit paid by"), (
                      <select className={inputCls} value={f.deposit_mode} onChange={(e) => set("deposit_mode", e.target.value)}>
                        {MODES.map((m) => <option key={m} value={m}>{t(m)}</option>)}
                      </select>
                    ))}
                    {field(t("Reference (e.g. M-Pesa code)"), <input className={inputCls} value={f.deposit_ref} onChange={(e) => set("deposit_ref", e.target.value)} />)}
                  </>
                )}
                {directTotal > 0 && (
                  <p className="text-sm text-zinc-700 sm:col-span-2">
                    {t("Total")} <strong>{directTotal.toLocaleString()}</strong>
                    {Number(f.deposit) > 0 && (
                      <> · {t("balance due")} <strong>{Math.max(0, directTotal - Number(f.deposit)).toLocaleString()}</strong></>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={submit}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 max-sm:min-h-11"
            >
              {busy ? t("Recording…") : t("Record booking")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 max-sm:min-h-11"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
