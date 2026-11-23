import { useState } from "react"
import { call } from "../lib/api"
import { serverError, type Row } from "../lib/resource"
import { useT } from "../lib/i18n"

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

/** Room Blocks drawer section: turn an Airbnb/iCal closure into the guest's
 *  booking. Only Active blocks whose note came from an Airbnb calendar show it. */
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
  })
  const note = String(row.note || "")
  const eligible =
    String(row.block_status) === "Active" && /airbnb/i.test(note)
  // after a successful record the block is Released; keep the card so the
  // confirmation stays on screen
  if (!eligible && !done) return null

  const set = (k: keyof typeof f, v: string | number) =>
    setF((cur) => ({ ...cur, [k]: v }))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await call<{
        reservation: string
        room: string | null
        paid?: number
        payment_mode?: string
      }>("kamra.api.record_room_block_booking", {
        name: row.name,
        guest_name: f.guest_name.trim(),
        phone: f.phone.trim() || undefined,
        adults: Number(f.adults) || 2,
        children: Number(f.children) || 0,
        ota_ref: f.ota_ref.trim() || undefined,
        ota_total: Number(f.ota_total) || 0,
        paid_amount: f.paid_amount === "" ? undefined : Number(f.paid_amount),
        booked_via: "Airbnb",
        check_in_date: f.check_in || undefined,
        check_out_date: f.check_out || undefined,
      })
      setDone(
        `${t("Booked")} ${res.reservation}${res.room ? ` · ${res.room}` : ""}` +
          (res.paid ? ` · ${t("OTA Prepaid")} ${res.paid.toLocaleString()}` : ""),
      )
      reload()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-700">
            {t("Airbnb booking")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {t("This closure came from an Airbnb calendar. Record who is staying and Airbnb's total; the dates stay closed.")}
          </p>
        </div>
        {!open && !done && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("Record Airbnb booking")}
          </button>
        )}
      </div>
      {done && <p className="mt-3 text-sm text-emerald-700">{done}</p>}
      {open && !done && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Guest name")} <span className="text-rose-500">*</span>
              </span>
              <input
                className={inputCls}
                value={f.guest_name}
                onChange={(e) => set("guest_name", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Phone")}
              </span>
              <input
                className={inputCls}
                value={f.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Adults")}
              </span>
              <input
                type="number"
                min={1}
                className={inputCls}
                value={f.adults}
                onChange={(e) => set("adults", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Children")}
              </span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={f.children}
                onChange={(e) => set("children", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Airbnb confirmation code")}
              </span>
              <input
                className={inputCls}
                value={f.ota_ref}
                onChange={(e) => set("ota_ref", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Airbnb total (KES)")} <span className="text-rose-500">*</span>
              </span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={f.ota_total}
                onChange={(e) => set("ota_total", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Check-in")}
              </span>
              <input
                type="date"
                className={inputCls}
                value={f.check_in}
                onChange={(e) => set("check_in", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Check-out")}
              </span>
              <input
                type="date"
                className={inputCls}
                value={f.check_out}
                onChange={(e) => set("check_out", e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-zinc-500">
                {t("Amount Airbnb collected (KES, optional)")}
              </span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={f.paid_amount}
                placeholder={t("Defaults to the Airbnb total")}
                onChange={(e) => set("paid_amount", e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !f.guest_name.trim() || !(Number(f.ota_total) > 0)}
              onClick={submit}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? t("Recording…") : t("Record booking")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
