/** "Book via WhatsApp" for the public booking pages - switched on and set up
 *  by an administrator (Settings > WhatsApp booking button). The property
 *  button pre-fills "... Ref: <slug>" so the bot starts that property's
 *  booking at the dates question; the homepage button opens the bot menu. */
import { useEffect, useState } from "react"
import { call } from "../lib/api"
import { useT } from "../lib/i18n"

interface WaConfig {
  enabled: number
  number?: string
  brand?: string
  on_property?: number
  on_home?: number
}

let cached: Promise<WaConfig> | null = null
function loadConfig(): Promise<WaConfig> {
  cached ??= call<WaConfig>("cloudtrade_hospitality.wa_button.public_config").catch(() => ({ enabled: 0 }))
  return cached
}

function useWaConfig(): WaConfig | null {
  const [cfg, setCfg] = useState<WaConfig | null>(null)
  useEffect(() => {
    let live = true
    loadConfig().then((c) => live && setCfg(c))
    return () => {
      live = false
    }
  }, [])
  return cfg
}

const waLink = (number: string, text: string) =>
  `https://wa.me/${number}?text=${encodeURIComponent(text)}`

/** The WhatsApp glyph (simple-icons, CC0). */
export function WhatsAppLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

export interface StayChoice {
  propertyName: string
  slug?: string | null
  unitName?: string | null
  unitSlug?: string | null
  checkIn: string
  checkOut: string
  adults: number
  children?: number
}

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

/** The guest's choice as a WhatsApp message: readable for the guest, and a
 *  Ref the bot reads (property, dates, guests, unit) so it skips straight to
 *  the name and payment. */
function stayMessage(cfg: WaConfig, c: StayChoice, t: ReturnType<typeof useT>["t"]) {
  const hello = cfg.brand ? t("Hi {brand},", { brand: cfg.brand }) : t("Hi,")
  const what = c.unitName ? `${c.propertyName} - ${c.unitName}` : c.propertyName
  const kids = c.children ? `, ${c.children} ${c.children === 1 ? t("child") : t("children")}` : ""
  const people = `${c.adults} ${c.adults === 1 ? t("adult") : t("adults")}${kids}`
  const ref = c.slug
    ? ` Ref: ${c.slug} ${c.checkIn} ${c.checkOut} ${c.adults}+${c.children || 0}${c.unitSlug ? ` ${c.unitSlug}` : ""}`
    : ""
  return `${hello} ${t("I'd like to book {what}, {from} to {to}, {people}.", {
    what, from: dayLabel(c.checkIn), to: dayLabel(c.checkOut), people,
  })}${ref}`
}

/** Under the booking button, in the property's own accent: the same stay,
 *  finished on WhatsApp. `compact` is the icon-only version for the phone
 *  bottom bar. */
export function WhatsAppStayButton({ choice, compact = false }: { choice: StayChoice; compact?: boolean }) {
  const { t } = useT()
  const cfg = useWaConfig()
  if (!cfg?.enabled || !cfg.on_property || !cfg.number) return null
  const href = waLink(cfg.number, stayMessage(cfg, choice, t))
  if (compact)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("Book on WhatsApp instead")}
        title={t("Book on WhatsApp instead")}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700 transition hover:bg-brand-100 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <WhatsAppLogo className="size-5" />
      </a>
    )
  return (
    <div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <WhatsAppLogo className="size-[18px]" />
        {t("Book on WhatsApp instead")}
      </a>
      <p className="mt-1.5 text-center text-xs text-zinc-500">
        {t("Your dates go with you – just add your name and confirm.")}
      </p>
    </div>
  )
}

/** The homepage's floating button, in the site accent: a round icon on phones
 *  (clear of the home bar), a labelled pill on wider screens. Opens the bot's
 *  main menu. */
export function WhatsAppFab() {
  const { t } = useT()
  const cfg = useWaConfig()
  if (!cfg?.enabled || !cfg.on_home || !cfg.number) return null
  const hello = cfg.brand ? t("Hi {brand},", { brand: cfg.brand }) : t("Hi,")
  const text = `${hello} ${t("I'd like to book a stay.")}`
  return (
    <>
      {/* room under the last card so the button never covers it */}
      <div className="h-20" aria-hidden />
      <a
        href={waLink(cfg.number, text)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("Book on WhatsApp")}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] end-4 z-40 flex size-13 items-center justify-center gap-2 rounded-full bg-brand-600 text-white shadow-md shadow-black/15 transition hover:bg-brand-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:bottom-6 sm:end-6 sm:size-auto sm:px-5 sm:py-3"
      >
        <WhatsAppLogo className="size-6 sm:size-5" />
        <span className="hidden text-sm font-semibold sm:inline">{t("Book on WhatsApp")}</span>
      </a>
    </>
  )
}
