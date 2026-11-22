import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, CalendarDays, Check, CreditCard, MailWarning, RefreshCw, X } from "lucide-react"
import { callGuest } from "../lib/api"
import { serverError } from "../lib/resource"
import { Button } from "../components/ui/button"
import { useT, t as translate } from "../lib/i18n"
import { adoptGuestLanguage } from "../lib/dir"
import { cur, moneyLocale } from "../lib/money"

/** Guest booking-offer page: /kamra/offer/<offer_token>. The desk priced
 *  the stay (often a negotiated rate) and sent this link with the full
 *  details. A Pending Payment offer is confirmed by paying the deposit or
 *  the full amount through the payment gateway - unpaid offers are
 *  released when the window closes. A Requested offer is confirmed or
 *  declined directly. */

interface Offer {
  reservation: string
  status: string
  expired: boolean
  property: string
  guest_name: string
  room_type: string
  check_in_date: string
  check_out_date: string
  nights: number
  adults: number
  children: number
  total: number
  nightly_rate?: number
  expires_on?: string | null
  special_requests?: string | null
  pay_token?: string | null
  cancel_note?: string | null
  deposit_due?: number
  deposit_expected?: number
  paid?: number
  remaining?: number
  pay_to_confirm?: boolean
  available?: boolean
  can_change_dates?: boolean
}

const kes = (n: number) =>
  `${cur()}${Number(n).toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })}`

export default function OfferPage() {
  const { t } = useT()
  const { token } = useParams()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<"accepted" | "declined" | null>(null)
  const [payMsg, setPayMsg] = useState<string | null>(null)
  // other dates: offers hold no room, so the guest may need to move
  const [changing, setChanging] = useState(false)
  const [newIn, setNewIn] = useState("")
  const [newOut, setNewOut] = useState("")

  function load() {
    if (!token) return Promise.resolve()
    return callGuest<Offer>("kamra.offers.offer_context", { token })
      .then(setOffer)
      .catch((e) => setFailed(serverError(e)))
  }

  useEffect(() => {
    adoptGuestLanguage()
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function respond(accept: boolean) {
    if (!token) return
    setBusy(accept ? "accept" : "decline")
    setError(null)
    try {
      const out = await callGuest<{ accepted: boolean; status: string }>(
        "kamra.offers.respond_offer",
        { token, accept: accept ? 1 : 0 },
      )
      setDone(out.accepted ? "accepted" : "declined")
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  async function changeDates() {
    if (!token || !newIn || !newOut) return
    setBusy("dates")
    setError(null)
    setPayMsg(null)
    try {
      const out = await callGuest<Offer>("kamra.offers.offer_change_dates", {
        token, check_in_date: newIn, check_out_date: newOut,
      })
      setOffer(out)
      setChanging(false)
      setPayMsg(t("Dates updated - the price below is for your new dates."))
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  async function pay(amount: number) {
    if (!offer?.pay_token) return
    setBusy(`pay${amount}`)
    setError(null)
    setPayMsg(null)
    try {
      const link = await callGuest<{ url: string }>(
        "kamra.public_api.guest_payment_link",
        { token: offer.pay_token, amount },
      )
      if (link?.url) {
        window.open(link.url, "_blank", "noopener")
        setPayMsg(t("Payment page opened - complete the payment there, then check your status below."))
      } else {
        setError(t("Could not create a payment link - please try again."))
      }
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  // m-auto card: vertically centred when it fits, top-aligned and fully
  // scrollable when the content is taller than the viewport (align-items
  // centring clips the top of an over-tall card on small screens)
  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh flex-col bg-zinc-50 px-4 py-10">
      <div className="m-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  )

  if (failed)
    return shell(
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-rose-50">
          <MailWarning className="size-7 text-rose-500" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">
          {t("This offer link isn't valid")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{translate(failed)}</p>
      </div>,
    )

  if (!offer)
    return shell(<div className="text-center text-sm text-zinc-500">{t("Loading…")}</div>)

  if (done === "accepted" || offer.status === "Confirmed")
    return shell(
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50">
          <Check className="size-7 text-emerald-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">
          {t("You're booked!")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          {t("{property} has confirmed your stay{dates}. Ref {ref}.", {
            property: offer.property,
            dates: ` ${offer.check_in_date} → ${offer.check_out_date}`,
            ref: offer.reservation,
          })}
        </p>
        <p className="mt-3 text-xs text-zinc-400">
          {t("We'll send your check-in details before arrival.")}
        </p>
      </div>,
    )

  if (done === "declined" || offer.status === "Cancelled")
    return shell(
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-zinc-100">
          <X className="size-7 text-zinc-500" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">
          {offer.cancel_note === "Hold / payment window expired"
            ? t("This offer expired unpaid")
            : t("Offer declined")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {offer.cancel_note === "Hold / payment window expired"
            ? t("Payment wasn't completed in time, so the dates were released. Ask {property} to send a new offer.", { property: offer.property })
            : t("No booking was made. Contact {property} if you'd like to talk about other dates.", { property: offer.property })}
        </p>
      </div>,
    )

  if (offer.expired || (offer.status !== "Requested" && offer.status !== "Pending Payment"))
    return shell(
      <div className="text-center">
        <h1 className="text-lg font-semibold text-zinc-900">{t("This offer has expired")}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {t("Ask {property} to send a new offer.", { property: offer.property })}
        </p>
      </div>,
    )

  const awaitingPayment = offer.status === "Pending Payment" || !!offer.pay_to_confirm
  const unavailable = offer.status === "Requested" && offer.available === false
  const today = new Date().toISOString().slice(0, 10)
  const datePicker = offer.can_change_dates && (changing || unavailable) && (
    <div className="mt-4 space-y-3 rounded-xl border border-zinc-200 px-4 py-3.5">
      <p className="text-sm font-medium text-zinc-800">{t("Pick other dates")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-medium text-zinc-500">
          {t("Check-in")}
          <input type="date" min={today} value={newIn}
            onChange={(e) => setNewIn(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900" />
        </label>
        <label className="block text-xs font-medium text-zinc-500">
          {t("Check-out")}
          <input type="date" min={newIn || today} value={newOut}
            onChange={(e) => setNewOut(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900" />
        </label>
      </div>
      <Button className="w-full justify-center py-2.5"
        disabled={busy !== null || !newIn || !newOut || newOut <= newIn}
        onClick={changeDates}>
        {busy === "dates" ? t("Checking…") : t("Check availability and update")}
      </Button>
      <p className="text-xs text-zinc-400">
        {t("Same apartment and rate - the price is worked out for the new nights.")}
      </p>
    </div>
  )
  const depositDue = Number(offer.deposit_due ?? 0)
  const remaining = Number(offer.remaining ?? offer.total)
  const paidSoFar = Number(offer.paid ?? 0)

  return shell(
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
        {t("Special offer")}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
        {offer.property}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {offer.room_type}
        {offer.guest_name ? ` · ${offer.guest_name}` : ""}
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <CalendarDays className="size-4 shrink-0 text-zinc-400" aria-hidden />
        <span>
          {offer.check_in_date} → {offer.check_out_date}
          {" · "}
          {t("{n} night{s}", { n: offer.nights, s: offer.nights === 1 ? "" : "s" })}
          {offer.adults ? ` · ${t("{n} guest{s}", { n: offer.adults + offer.children, s: offer.adults + offer.children === 1 ? "" : "s" })}` : ""}
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-zinc-500">
            {awaitingPayment ? t("Total") : t("Your rate")}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-zinc-900">
            {kes(offer.total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          {offer.nightly_rate
            ? t("{per} per night incl. taxes", { per: kes(offer.nightly_rate) })
            : t("Total incl. taxes")}
          {offer.expires_on
            ? ` · ${t("offer valid until {when}", { when: offer.expires_on.slice(0, 16) })}`
            : ""}
        </p>
        {paidSoFar > 0 && (
          <p className="mt-1 text-xs font-medium text-emerald-700">
            {t("Already paid: {amt}", { amt: kes(paidSoFar) })}
          </p>
        )}
      </div>

      {unavailable ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-rose-900">
            <AlertTriangle className="size-4" aria-hidden />
            {t("These dates are no longer available")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-rose-800">
            {t("Someone booked these dates after this offer was sent. Pick other dates below - your offer rate still applies.")}
          </p>
        </div>
      ) : awaitingPayment && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            {t("Payment confirms this booking")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {offer.status === "Pending Payment"
              ? t("Your dates are held until the offer expires. Pay the deposit to confirm, or pay the full amount so nothing is due on arrival.")
              : t("Available now. The dates aren't reserved until you pay - pay the deposit or the full amount to secure these dates.")}
          </p>
        </div>
      )}

      {datePicker}

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {translate(error)}
        </div>
      )}
      {payMsg && (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          {payMsg}
        </div>
      )}

      {unavailable ? null : awaitingPayment ? (
        <div className="mt-5 space-y-2">
          {depositDue > 0.005 && (
            <Button
              className="w-full justify-center py-2.5"
              disabled={busy !== null}
              onClick={() => pay(depositDue)}
            >
              <CreditCard className="mr-2 size-4" aria-hidden />
              {busy === `pay${depositDue}`
                ? t("Opening payment…")
                : t("Pay deposit · {amt}", { amt: kes(depositDue) })}
            </Button>
          )}
          {remaining > depositDue + 0.005 && (
            <Button
              variant={depositDue > 0.005 ? "outline" : "primary"}
              className="w-full justify-center py-2.5"
              disabled={busy !== null}
              onClick={() => pay(remaining)}
            >
              {busy === `pay${remaining}`
                ? t("Opening payment…")
                : depositDue > 0.005
                  ? t("Pay in full · {amt}", { amt: kes(remaining) })
                  : t("Pay now · {amt}", { amt: kes(remaining) })}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              className="justify-center"
              disabled={busy !== null}
              onClick={() => respond(false)}
            >
              {busy === "decline" ? t("Declining…") : t("Decline")}
            </Button>
            <Button
              variant="ghost"
              className="justify-center"
              disabled={busy !== null}
              onClick={() => { setPayMsg(null); load() }}
            >
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden />
              {t("I've paid - check")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="justify-center py-2.5"
            disabled={busy !== null}
            onClick={() => respond(false)}
          >
            {busy === "decline" ? t("Declining…") : t("Decline")}
          </Button>
          <Button
            className="justify-center py-2.5"
            disabled={busy !== null}
            onClick={() => respond(true)}
          >
            {busy === "accept" ? t("Confirming…") : t("Confirm booking")}
          </Button>
        </div>
      )}
      {offer.can_change_dates && !unavailable && !changing && (
        <button type="button"
          className="mt-3 w-full text-center text-xs font-medium text-brand-700 underline"
          onClick={() => { setChanging(true); setNewIn(offer.check_in_date); setNewOut(offer.check_out_date) }}>
          {t("Need other dates?")}
        </button>
      )}
      <p className="mt-3 text-center text-xs text-zinc-400">
        {awaitingPayment
          ? offer.status === "Pending Payment"
            ? t("Payment confirms the booking instantly. If the window closes unpaid, the dates are released.")
            : t("Payment confirms the booking instantly if the dates are still free.")
          : t("Confirming books the dates at this price. Nothing is reserved until you confirm.")}
      </p>
    </div>,
  )
}
