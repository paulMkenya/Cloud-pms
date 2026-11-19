import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { Check, Star } from "lucide-react"
import { callGuest } from "../lib/api"
import { serverError } from "../lib/resource"
import { Button } from "../components/ui/button"
import { useT, t as translate } from "../lib/i18n"
import { adoptGuestLanguage } from "../lib/dir"

/** Post-stay review page: /kamra/review/<precheckin_token>. The guest picks
 *  1-5 stars + optional words; the review lands as Pending and only shows
 *  publicly after the property approves it. */

interface Ctx {
  reservation: string
  property: string
  status: string
  guest_name: string
  submitted: boolean
  rating: number
}

export default function GuestReview() {
  const { t } = useT()
  const { token } = useParams()
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [headline, setHeadline] = useState("")
  const [comment, setComment] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adoptGuestLanguage()
    if (!token) return
    callGuest<Ctx>("cloudtrade_hospitality.reviews.review_context", { token })
      .then((c) => {
        setCtx(c)
        setRating(c.rating || 0)
        setName(c.guest_name || "")
      })
      .catch((e) => setFailed(serverError(e)))
  }, [token])

  async function submit() {
    if (!token || !rating) return
    setBusy(true)
    setError(null)
    try {
      await callGuest("cloudtrade_hospitality.reviews.submit_review", {
        token, rating, headline, comment, display_name: name,
      })
      setDone(true)
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </div>
  )

  if (failed)
    return shell(
      <div className="text-center">
        <h1 className="text-lg font-semibold text-zinc-900">{t("This link isn't valid")}</h1>
        <p className="mt-2 text-sm text-zinc-500">{translate(failed)}</p>
      </div>,
    )

  if (!ctx)
    return shell(<div className="text-center text-sm text-zinc-500">{t("Loading…")}</div>)

  if (ctx.status !== "Checked Out" && !ctx.submitted)
    return shell(
      <div className="text-center">
        <h1 className="text-lg font-semibold text-zinc-900">{t("Thanks for staying with us")}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {t("You'll be able to review your stay after check-out.")}
        </p>
      </div>,
    )

  if (done || ctx.submitted)
    return shell(
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-50">
          <Check className="size-7 text-brand-700" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-zinc-900">{t("Thank you!")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          {t("Your review of {property} has been received. The property may publish it on their booking page once they've read it.", { property: ctx.property })}
        </p>
      </div>,
    )

  const inputCls =
    "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-base " +
    "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

  return shell(
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{t("How was your stay?")}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {ctx.property}{ctx.guest_name ? ` · ${ctx.guest_name}` : ""}
      </p>

      <div className="mt-5 flex justify-center gap-1.5" role="radiogroup" aria-label={t("Rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={t("{n} stars", { n })}
            className="rounded-lg p-1.5 transition hover:bg-amber-50"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
          >
            <Star
              className={"size-9 transition " +
                (n <= (hover || rating)
                  ? "fill-amber-400 text-amber-400"
                  : "fill-zinc-100 text-zinc-300")}
            />
          </button>
        ))}
      </div>
      <p className="mt-1 text-center text-sm text-zinc-500">
        {rating === 0
          ? t("Tap a star to rate")
          : ["", t("Poor"), t("Fair"), t("Good"), t("Very good"), t("Excellent")][rating]}
      </p>

      <div className="mt-5 space-y-3">
        <input
          className={inputCls}
          placeholder={t("Headline (optional)")}
          maxLength={140}
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
        />
        <textarea
          className={inputCls}
          rows={4}
          placeholder={t("Tell other guests about your stay (optional)")}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder={t("Name to show publicly")}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {translate(error)}
        </div>
      )}

      <Button
        className="mt-5 w-full justify-center py-2.5"
        disabled={busy || !rating}
        onClick={submit}
      >
        {busy ? t("Sending…") : t("Send review")}
      </Button>
      <p className="mt-3 text-center text-xs text-zinc-400">
        {t("Your review is checked by the property before it appears on their page.")}
      </p>
    </div>,
  )
}
