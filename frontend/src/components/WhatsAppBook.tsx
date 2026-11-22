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

/** A full-width card on phones, a single row from tablet width up. */
export function WhatsAppBookCard({ propertyName, slug }: { propertyName: string; slug?: string | null }) {
  const { t } = useT()
  const cfg = useWaConfig()
  if (!cfg?.enabled || !cfg.on_property || !cfg.number) return null
  const hello = cfg.brand ? t("Hi {brand},", { brand: cfg.brand }) : t("Hi,")
  const text = `${hello} ${t("I'd like to book {property}.", { property: propertyName })}${slug ? ` Ref: ${slug}` : ""}`
  return (
    <section
      aria-label={t("Book via WhatsApp")}
      className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex sm:items-center sm:gap-5 sm:p-5"
    >
      <div className="flex items-start gap-3 sm:flex-1">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
          <WhatsAppLogo className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900">{t("Prefer to chat?")}</p>
          <p className="mt-0.5 text-sm leading-snug text-zinc-600">
            {t("Book {property} on WhatsApp: pick your dates, see the price and pay by M-Pesa, all in the chat.", { property: propertyName })}
          </p>
        </div>
      </div>
      <a
        href={waLink(cfg.number, text)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#128C7E] px-5 text-base font-semibold text-white shadow-sm transition hover:bg-[#0E7A6E] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#128C7E] sm:mt-0 sm:w-auto sm:shrink-0"
      >
        <WhatsAppLogo className="size-5" />
        {t("Book via WhatsApp")}
      </a>
    </section>
  )
}

/** The homepage's floating button: a round icon on phones (clear of the home
 *  bar), a labelled pill on wider screens. Opens the bot's main menu. */
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
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] end-4 z-40 flex size-14 items-center justify-center gap-2 rounded-full bg-[#25D366] text-white shadow-lg shadow-emerald-900/25 ring-4 ring-white/70 transition hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#128C7E] sm:bottom-6 sm:end-6 sm:size-auto sm:px-5 sm:py-3.5"
      >
        <WhatsAppLogo className="size-7 sm:size-6" />
        <span className="hidden text-sm font-semibold sm:inline">{t("Book on WhatsApp")}</span>
      </a>
    </>
  )
}
