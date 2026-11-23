/** Front Desk > Guests to record: dates an Airbnb calendar closed with no
 *  guest in the system yet. One card per stay (a house's units and listings
 *  closing the same nights are one stay); "Add guest" records the whole
 *  stay in one booking (kamra.api.record_stay), "Not a guest" hides dates
 *  the director closed on Airbnb for himself. */
import { useCallback, useEffect, useState, type ReactElement } from "react"
import { Link } from "react-router-dom"
import { CalendarX2, Check, UserPlus } from "lucide-react"
import { Button } from "../components/ui/button"
import CountInput from "../components/CountInput"
import { call, serverError } from "../lib/api"
import { useT } from "../lib/i18n"

export interface UnrecordedStay {
  key: string
  property: string
  check_in: string
  check_out: string
  nights: number
  in_house: boolean
  rooms: string[]
  room_labels: Record<string, string>
  channel: string
  whole_house: boolean
}

const inputCls =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:py-1.5 sm:text-sm " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"
const MODES = ["M-Pesa", "Cash", "Bank Transfer", "Card"]

const fmt = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

export default function GuestsToRecord() {
  const { t } = useT()
  const [rows, setRows] = useState<UnrecordedStay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    call<UnrecordedStay[]>("cloudtrade_hospitality.unrecorded.guests_to_record")
      .then((r) => setRows(r || []))
      .catch((e) => setError(serverError(e)))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    document.title = t("Guests to record")
  }, [t])

  async function hide(key: string) {
    try {
      await call("cloudtrade_hospitality.unrecorded.hide", { key })
      setRows((r) => (r || []).filter((x) => x.key !== key))
      window.dispatchEvent(new Event("kamra:unrecorded-changed"))
    } catch (e) {
      setError(serverError(e))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">{t("Guests to record")}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {t("Dates your Airbnb calendar closed with no guest in the system yet. Add who is staying - one booking covers the whole stay - or mark dates you closed yourself as not a guest.")}
      </p>
      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {rows === null && !error && <p className="mt-6 text-sm text-zinc-400">{t("Loading…")}</p>}
      {rows && rows.length === 0 && (
        <p className="mt-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Check className="size-4" aria-hidden /> {t("Every closed date has its guest recorded.")}
        </p>
      )}
      <ul className="mt-5 space-y-3">
        {(rows || []).map((r) => (
          <li key={r.key} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">{r.property}</p>
                <p className="mt-0.5 text-sm text-zinc-600">
                  {r.in_house
                    ? `${t("Already started")} → ${fmt(r.check_out)}`
                    : `${fmt(r.check_in)} → ${fmt(r.check_out)}`}{" "}
                  · {r.nights} {r.nights === 1 ? t("night") : t("nights")}
                  {r.in_house && <span className="text-zinc-400"> {t("(left from today)")}</span>}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
                  <CalendarX2 className="size-3.5" aria-hidden />
                  {t("Closed on {channel}", { channel: r.channel })}
                  {r.rooms.length > 1 ? ` · ${r.rooms.length} ${t("units")}` : ""}
                </p>
              </div>
              {done[r.key] ? (
                <span className="text-sm font-medium text-emerald-700">{done[r.key]}</span>
              ) : openKey !== r.key ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => void hide(r.key)} className="max-sm:min-h-11">
                    {t("Not a guest")}
                  </Button>
                  <Button onClick={() => setOpenKey(r.key)} className="gap-1.5 max-sm:min-h-11">
                    <UserPlus className="size-4" aria-hidden /> {t("Add guest")}
                  </Button>
                </div>
              ) : null}
            </div>
            {openKey === r.key && !done[r.key] && (
              <AddGuest
                stay={r}
                onCancel={() => setOpenKey(null)}
                onDone={(msg) => {
                  setDone((d) => ({ ...d, [r.key]: msg }))
                  setOpenKey(null)
                  window.dispatchEvent(new Event("kamra:unrecorded-changed"))
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddGuest({ stay, onCancel, onDone }: { stay: UnrecordedStay; onCancel: () => void; onDone: (m: string) => void }) {
  const { t } = useT()
  const [via, setVia] = useState<"Airbnb" | "Direct">("Airbnb")
  const [f, setF] = useState({
    guest_name: "", phone: "", room: stay.rooms[0] || "",
    check_in: stay.check_in, check_out: stay.check_out, adults: 2, children: 0,
    ota_total: "", ota_ref: "", rate: "", deposit: "", deposit_mode: "M-Pesa", deposit_ref: "",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | number) => setF((c) => ({ ...c, [k]: v }))
  const nights = nightsBetween(f.check_in, f.check_out)
  const total = (Number(f.rate) || 0) * Math.max(0, nights)
  const ready = !!f.guest_name.trim() && !!f.room && nights > 0 &&
    (via === "Airbnb" ? Number(f.ota_total) > 0 : Number(f.rate) > 0)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await call<{ reservation: string; balance?: number }>("kamra.api.record_stay", {
        property: stay.property, room: f.room,
        check_in_date: f.check_in, check_out_date: f.check_out,
        guest_name: f.guest_name.trim(), phone: f.phone.trim() || undefined,
        adults: f.adults, children: f.children,
        booked_via: via === "Airbnb" ? stay.channel : "Direct",
        ...(via === "Airbnb"
          ? { ota_total: Number(f.ota_total), ota_ref: f.ota_ref.trim() || undefined }
          : { rate_per_night: Number(f.rate), deposit: Number(f.deposit) || 0,
              deposit_mode: f.deposit_mode, deposit_ref: f.deposit_ref.trim() || undefined }),
      })
      onDone(`${t("Booked")} ${res.reservation}` + (res.balance ? ` · ${t("balance")} ${res.balance.toLocaleString()}` : ""))
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, el: ReactElement, wide = false) => (
    <label className={`block min-w-0 ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {el}
    </label>
  )
  return (
    <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
      <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
        {(["Airbnb", "Direct"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={via === v} onClick={() => setVia(v)}
            className={`rounded-md px-3 py-1.5 font-medium max-sm:min-h-10 ${via === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}>
            {v === "Airbnb" ? t("Booked on {channel}", { channel: stay.channel }) : t("Direct guest")}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field(t("Guest name"), <input className={inputCls} value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} />, true)}
        {field(t("Phone"), <input className={inputCls} inputMode="tel" placeholder="0712 345 678" value={f.phone} onChange={(e) => set("phone", e.target.value)} />)}
        {field(t("Unit / listing"), (
          <select className={inputCls} value={f.room} onChange={(e) => set("room", e.target.value)}>
            {stay.rooms.map((rm) => <option key={rm} value={rm}>{stay.room_labels[rm] || rm}</option>)}
          </select>
        ))}
        {field(t("Check-in"), <input type="date" className={inputCls} value={f.check_in} onChange={(e) => set("check_in", e.target.value)} />)}
        {field(t("Check-out"), <input type="date" className={inputCls} value={f.check_out} min={f.check_in} onChange={(e) => set("check_out", e.target.value)} />)}
        <p className="col-span-2 -mt-1 text-xs text-zinc-500">
          {stay.in_house
            ? t("This stay had already started - set the guest's real check-in date.")
            : t("Shorten the dates if this was more than one guest - the rest stays on this list.")}
        </p>
        {field(t("Adults"), <CountInput min={1} className={inputCls} value={f.adults} onChange={(n) => set("adults", n)} />)}
        {field(t("Children"), <CountInput min={0} className={inputCls} value={f.children} onChange={(n) => set("children", n)} />)}
        {via === "Airbnb" ? (
          <>
            {field(t("{channel} total (KES)", { channel: stay.channel }), <input inputMode="decimal" className={inputCls} value={f.ota_total} onChange={(e) => set("ota_total", e.target.value.replace(/[^\d.]/g, ""))} />)}
            {field(t("Confirmation code"), <input className={inputCls} value={f.ota_ref} onChange={(e) => set("ota_ref", e.target.value)} />)}
          </>
        ) : (
          <>
            {field(t("Price per night (KES)"), <input inputMode="decimal" className={inputCls} value={f.rate} onChange={(e) => set("rate", e.target.value.replace(/[^\d.]/g, ""))} />)}
            {field(t("Deposit received (KES)"), <input inputMode="decimal" className={inputCls} placeholder="0" value={f.deposit} onChange={(e) => set("deposit", e.target.value.replace(/[^\d.]/g, ""))} />)}
            {Number(f.deposit) > 0 && field(t("Deposit paid by"), (
              <select className={inputCls} value={f.deposit_mode} onChange={(e) => set("deposit_mode", e.target.value)}>
                {MODES.map((m) => <option key={m} value={m}>{t(m)}</option>)}
              </select>
            ))}
            {Number(f.deposit) > 0 && field(t("Reference (e.g. M-Pesa code)"), <input className={inputCls} value={f.deposit_ref} onChange={(e) => set("deposit_ref", e.target.value)} />)}
            {total > 0 && (
              <p className="col-span-2 text-sm text-zinc-700">
                {t("Total")} <strong>{total.toLocaleString()}</strong>
                {Number(f.deposit) > 0 && <> · {t("balance due")} <strong>{Math.max(0, total - Number(f.deposit)).toLocaleString()}</strong></>}
              </p>
            )}
          </>
        )}
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={busy || !ready} onClick={() => void submit()} className="max-sm:min-h-11">
          {busy ? t("Recording…") : t("Record booking")}
        </Button>
        <Button variant="ghost" onClick={onCancel} className="max-sm:min-h-11">{t("Cancel")}</Button>
      </div>
    </div>
  )
}

/** Header badge: how many stays wait for a guest; hidden at zero. */
export function UnrecordedBadge() {
  const { t } = useT()
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    const load = () =>
      call<number>("cloudtrade_hospitality.unrecorded.count")
        .then((c) => live && setN(Number(c) || 0))
        .catch(() => {})
    load()
    const iv = window.setInterval(load, 5 * 60_000)
    window.addEventListener("kamra:unrecorded-changed", load)
    return () => {
      live = false
      window.clearInterval(iv)
      window.removeEventListener("kamra:unrecorded-changed", load)
    }
  }, [])
  if (!n) return null
  const label = t("{n} closed stays with no guest recorded", { n })
  return (
    <Link to="/guests-to-record" title={label} aria-label={label}
      className="relative grid size-9 place-items-center rounded-lg text-amber-700 hover:bg-amber-50">
      <CalendarX2 className="size-5" aria-hidden />
      <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-4 text-white">
        {n > 99 ? "99+" : n}
      </span>
    </Link>
  )
}
