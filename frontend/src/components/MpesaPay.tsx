import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, Smartphone } from "lucide-react"
import { callGuest } from "../lib/api"
import { serverError } from "../lib/resource"
import { useT } from "../lib/i18n"
import { Button } from "./ui/button"

/* M-Pesa prompt (STK push) on the booking confirmation screen: the guest
   types their number and approves the payment on their phone right away.
   The page polls our own server only (cloudtrade_hospitality.guest_pay) -
   the money settles through the CloudPay webhook like a link payment. */

type Status = {
  payment: string | null
  status: string | null
  amount: number
  mpesa_receipt?: string | null
  reason?: string | null
  booking_status: string
  deposit_due: number
  balance: number
}

const POLL_MS = 3000
const GIVE_UP_MS = 150000

export default function MpesaPay({
  token, defaultPhone, deposit, full, money, onPaid,
}: {
  token: string
  defaultPhone: string
  deposit: number
  full: number
  money: (n: number) => string
  onPaid: (s: Status) => void
}) {
  const { t } = useT()
  const [phone, setPhone] = useState(defaultPhone)
  const [amount, setAmount] = useState(deposit > 0 ? deposit : full)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [result, setResult] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(0)

  useEffect(() => {
    if (!waiting) return
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        const s = await callGuest<Status>("cloudtrade_hospitality.guest_pay.mpesa_status",
          { token, payment: waiting })
        if (s.status === "Success") {
          setWaiting(null); setResult(s); onPaid(s); return
        }
        if (s.status && s.status !== "Pending") {
          setWaiting(null)
          setError(s.status === "Cancelled"
            ? t("The payment was cancelled on the phone. You can try again.")
            : t("The payment did not go through ({reason}). You can try again.",
                { reason: s.reason || s.status }))
          return
        }
      } catch { /* keep waiting; a network blip is not a failure */ }
      if (Date.now() - started.current > GIVE_UP_MS) {
        setWaiting(null)
        setError(t("We have not received the payment yet. If you paid, it will show shortly and we will message you; otherwise try again."))
        return
      }
      setTimeout(tick, POLL_MS)
    }
    const h = setTimeout(tick, POLL_MS)
    return () => { stop = true; clearTimeout(h) }
  }, [waiting]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true); setError(null)
    try {
      const s = await callGuest<Status>("cloudtrade_hospitality.guest_pay.mpesa_prompt",
        { token, phone, amount })
      if (s.status === "Success") { setResult(s); onPaid(s); return }
      if (!s.payment) throw new Error(t("Could not start the payment."))
      started.current = Date.now()
      setWaiting(s.payment)
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  if (result)
    return (
      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-start">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="size-5" aria-hidden />
          {t("Payment received: {amount}", { amount: money(result.amount) })}
        </p>
        <p className="mt-1 text-sm text-emerald-900">
          {result.booking_status === "Confirmed" ? t("Your booking is confirmed.") : t("Thank you!")}
          {" "}
          {result.balance > 0
            ? t("Balance {amount}: we have sent you a link to pay it, or pay on arrival.", { amount: money(result.balance) })
            : t("Your stay is fully paid.")}
        </p>
        {result.mpesa_receipt && (
          <p className="mt-1 text-xs text-emerald-800">{t("M-Pesa ref {ref}", { ref: result.mpesa_receipt })}</p>
        )}
      </div>
    )

  return (
    <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-start">
      <p className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
        <Smartphone className="size-4" aria-hidden /> {t("Pay with M-Pesa now")}
      </p>
      {deposit > 0 && deposit < full && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[[deposit, t("Deposit")], [full, t("Full amount")]].map(([v, label]) => (
            <button key={String(label)} type="button" disabled={!!waiting}
              onClick={() => setAmount(Number(v))}
              className={"rounded-xl border p-2.5 text-start text-sm " +
                (amount === v ? "border-brand-600 bg-white ring-1 ring-brand-600" : "border-zinc-200 bg-white/60")}>
              <span className="block text-xs text-zinc-500">{label}</span>
              <span className="block font-semibold text-zinc-900">{money(Number(v))}</span>
            </button>
          ))}
        </div>
      )}
      <label className="mt-3 block text-xs font-medium text-zinc-600" htmlFor="mpesa-phone">
        {t("M-Pesa number")}
      </label>
      <input id="mpesa-phone" type="tel" inputMode="tel" autoComplete="tel"
        value={phone} disabled={!!waiting}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="07XX XXX XXX"
        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-brand-600" />
      {waiting ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-white p-3 text-sm text-zinc-700">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand-600" aria-hidden />
          <span>{t("Check your phone and enter your M-Pesa PIN to pay {amount}.", { amount: money(amount) })}</span>
        </div>
      ) : (
        <Button className="mt-3 w-full justify-center py-2.5" disabled={busy || phone.replace(/\D/g, "").length < 9}
          onClick={() => void send()}>
          {busy ? t("Sending…") : t("Send M-Pesa prompt for {amount}", { amount: money(amount) })}
        </Button>
      )}
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      <p className="mt-2 text-xs text-zinc-500">
        {t("We also send your booking details and a payment link to your WhatsApp.")}
      </p>
    </div>
  )
}
