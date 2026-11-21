import { useEffect, useMemo, useState } from "react"
import { Coins, Gift, Star } from "lucide-react"
import { callGuest } from "../lib/api"
import { serverError } from "../lib/resource"
import { Button } from "../components/ui/button"
import { useT, t as translate } from "../lib/i18n"
import { adoptGuestLanguage } from "../lib/dir"

/** Public loyalty page: /kamra/loyalty. The phone number is the account,
 *  but a number on its own shows nothing: the guest gets a one-time code
 *  (members on the phone they joined with, new numbers on the number
 *  typed - the same code signs them up) and the account opens with a
 *  short-lived session. Points are earned on completed stays and redeemed
 *  into single-use vouchers; the voucher code is only ever sent to the
 *  member's phone, never shown here in full. */

interface LoyaltyStatus {
  ok: boolean
  enabled: boolean
  enrolled: boolean
  verified?: boolean
  session?: string
  name: string
  points: number
  lifetime: number
  tier: string
  enrolled_on: string
  earn: { divisor: number; text: string }
  redeem: { kes_per_point: number; min_points: number; voucher_days: number }
  properties: { name: string; label: string; city: string }[]
  recent?: { date: string; kind: string; points: number; balance: number; note: string }[]
}

interface RedeemResult {
  ok: boolean
  code_masked: string
  value_kes: number
  points_used: number
  points_balance: number
  valid_to: string
  property: string
  sent_to: string
}

type Step = "phone" | "code" | "member"

const kes = (n: number) =>
  `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default function LoyaltyPage() {
  const { t } = useT()
  const [step, setStep] = useState<Step>("phone")
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [codeSentTo, setCodeSentTo] = useState("")
  const [code, setCode] = useState("")
  const [session, setSession] = useState("")
  const [status, setStatus] = useState<LoyaltyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [redeemed, setRedeemed] = useState<RedeemResult | null>(null)

  // redeem form
  const [prop, setProp] = useState("")
  const [points, setPoints] = useState("")

  useEffect(() => {
    adoptGuestLanguage()
  }, [])

  const redeemValue = useMemo(() => {
    const p = parseInt(points || "0", 10)
    if (!p || !status) return 0
    return Math.round(p * status.redeem.kes_per_point)
  }, [points, status])

  function reset() {
    setStep("phone")
    setPhone("")
    setName("")
    setCode("")
    setCodeSentTo("")
    setSession("")
    setStatus(null)
    setError(null)
    setRedeemed(null)
    setProp("")
    setPoints("")
  }

  async function requestCode() {
    setBusy("code")
    setError(null)
    try {
      const out = await callGuest<{ sent_to: string }>("kamra.loyalty.loyalty_request_code", { phone })
      setCodeSentTo(out.sent_to)
      setCode("")
      setStep("code")
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  async function verify() {
    setBusy("verify")
    setError(null)
    try {
      const out = await callGuest<LoyaltyStatus>("kamra.loyalty.loyalty_verify", {
        phone, code: code.trim(), name,
      })
      setStatus(out)
      setSession(out.session || "")
      setCode("")
      setStep("member")
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  async function refresh() {
    const out = await callGuest<LoyaltyStatus>("kamra.loyalty.loyalty_status", { phone, session })
    if (out.verified) {
      setStatus(out)
    } else {
      // the session lapsed: back to the code step for this number
      setSession("")
      setStep("phone")
      setError(t("Your session ended - send yourself a new code to continue."))
    }
  }

  async function redeem() {
    setBusy("redeem")
    setError(null)
    try {
      const out = await callGuest<RedeemResult>("kamra.loyalty.loyalty_redeem", {
        phone, property: prop, points: parseInt(points || "0", 10), session,
      })
      setRedeemed(out)
      setPoints("")
      await refresh()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh flex-col bg-zinc-50 px-4 py-10">
      <div className="m-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  )

  const header = (
    <div className="text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-50">
        <Coins className="size-7 text-amber-500" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">
        {t("Loyalty programme")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {t("Earn points on every stay, spend them on your next booking.")}
      </p>
    </div>
  )

  const errorBox = error && (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {translate(error)}
    </div>
  )

  // 1. phone entry
  if (step === "phone") {
    return shell(
      <div className="space-y-4">
        {header}
        <label className="block text-sm font-medium text-zinc-700">
          {t("Your phone number")}
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm"
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {errorBox}
        <Button
          className="w-full justify-center py-2.5"
          disabled={busy !== null || phone.trim().length < 9}
          onClick={requestCode}
        >
          {busy === "code" ? t("Sending code…") : t("Send me a code")}
        </Button>
        <p className="text-center text-xs leading-relaxed text-zinc-400">
          {t("We'll send a 6-digit code by WhatsApp/SMS - members get it on the number they joined with. New here? The same code signs you up, free.")}
        </p>
      </div>,
    )
  }

  // 2. one-time code (and a name, for a number that's joining)
  if (step === "code") {
    return shell(
      <div className="space-y-4">
        {header}
        <label className="block text-sm font-medium text-zinc-700">
          {t("Code sent to {phone}", { phone: codeSentTo })}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-center text-lg tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          {t("Your name (new members, optional)")}
          <input
            type="text"
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm"
            placeholder={t("Jane Wanjiru")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {errorBox}
        <Button
          className="w-full justify-center py-2.5"
          disabled={busy !== null || code.trim().length !== 6}
          onClick={verify}
        >
          {busy === "verify" ? t("Checking…") : t("Continue")}
        </Button>
        <div className="flex justify-between text-xs text-zinc-400">
          <button type="button" className="underline" disabled={busy !== null} onClick={requestCode}>
            {t("Send a new code")}
          </button>
          <button type="button" className="underline" disabled={busy !== null} onClick={reset}>
            {t("Use a different number")}
          </button>
        </div>
      </div>,
    )
  }

  if (!status) return null

  if (!status.enabled)
    return shell(
      <div className="space-y-4">
        {header}
        <p className="text-center text-sm text-zinc-500">
          {t("The loyalty programme isn't running right now - please check back soon.")}
        </p>
      </div>,
    )

  // 3. verified member -> balance + redeem
  const minPts = status.redeem.min_points
  const maxRedeem = Math.floor((status.points || 0))
  const wanted = parseInt(points || "0", 10)
  const canRedeem = status.points >= minPts && !!prop && wanted >= minPts && wanted <= maxRedeem

  return shell(
    <div className="space-y-4">
      {header}

      {/* balance card */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          {status.name ? `${status.name} · ` : ""}
          {status.tier || t("Member")}
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-zinc-900">
          {status.points.toLocaleString()}
        </p>
        <p className="text-xs text-zinc-500">{t("points available")}</p>
        <p className="mt-1 text-[11px] text-zinc-400">
          {t("{lifetime} lifetime points", { lifetime: status.lifetime.toLocaleString() })}
        </p>
      </div>

      {redeemed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <Gift className="size-4" aria-hidden />
            {t("Voucher created - check your WhatsApp")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-800">
            {t("{value} off {property}, sent to {phone}. Code {code} - valid until {when}.", {
              value: kes(redeemed.value_kes),
              property: redeemed.property,
              phone: redeemed.sent_to,
              code: redeemed.code_masked,
              when: redeemed.valid_to,
            })}
          </p>
        </div>
      )}

      {/* how it works */}
      <div className="rounded-xl bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-zinc-500">
        <p className="flex items-center gap-1.5 font-medium text-zinc-700">
          <Star className="size-3.5 text-amber-500" aria-hidden />
          {status.earn.text}
        </p>
        <p className="mt-1">
          {t("Each point is worth {kes} off a future stay. Minimum redeem: {min} points.", {
            kes: kes(Math.round(status.redeem.kes_per_point * 100) / 100),
            min: minPts.toLocaleString(),
          })}
        </p>
      </div>

      {errorBox}

      {/* redeem */}
      {status.points > 0 && (
        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <p className="text-sm font-medium text-zinc-800">{t("Redeem points")}</p>
          <label className="block text-xs font-medium text-zinc-600">
            {t("Property for the voucher")}
            <select
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
              value={prop}
              onChange={(e) => setProp(e.target.value)}
            >
              <option value="">{t("Pick a property")}</option>
              {status.properties.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}{p.city ? ` · ${p.city}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-600">
            {t("Points to spend (max {max})", { max: maxRedeem.toLocaleString() })}
            <input
              type="number"
              inputMode="numeric"
              min={minPts}
              max={maxRedeem}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </label>
          {redeemValue > 0 && (
            <p className="text-xs text-zinc-500">
              {t("= {value} voucher", { value: kes(redeemValue) })}
              {status.redeem.voucher_days ? ` · ${t("valid {days} days", { days: status.redeem.voucher_days })}` : ""}
            </p>
          )}
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={busy !== null || !canRedeem}
            onClick={redeem}
          >
            {busy === "redeem" ? t("Creating voucher…") : t("Get voucher")}
          </Button>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            {t("The voucher code is sent to your WhatsApp/SMS on this number only - enter it at checkout on the booking page.")}
          </p>
        </div>
      )}

      {/* recent activity */}
      {status.recent && status.recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            {t("Recent activity")}
          </p>
          {status.recent.slice(0, 6).map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs">
              <span className="text-zinc-600">
                {r.kind}{r.note ? ` · ${r.note.slice(0, 40)}` : ""}
              </span>
              <span className={`font-medium tabular-nums ${r.points >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                {r.points >= 0 ? "+" : ""}{r.points}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="w-full text-center text-xs text-zinc-400 underline"
        onClick={reset}
      >
        {t("Sign out / use a different number")}
      </button>
    </div>,
  )
}
