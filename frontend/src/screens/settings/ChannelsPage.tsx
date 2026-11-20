import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Copy, RadioTower, XCircle } from "lucide-react"

import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { call, serverError } from "../../lib/api"
import { useT, t as translate } from "../../lib/i18n"

/** Channels status (CloudTrade Hospitality / Kamra channel manager).
 *  Per property: OTA connections with sync health, room-type external
 *  ids, and the iCal export feed state. Read-only. */

interface Mapping {
  room_type: string
  external_room_id: string
  external_rate_id: string
}
interface Connection {
  name: string
  provider: string
  active: number
  external_property_id: string
  sync_days: number
  last_push: string
  last_push_status: string
  mappings: Mapping[]
}
interface PropStatus {
  property: string
  property_name: string
  units: number
  room_types: { name: string; label: string }[]
  connections: Connection[]
  ical: { configured: boolean }
}

const PROVIDER_LABEL: Record<string, string> = {
  channex: "Channex",
  aiosell: "Aiosell",
  staah: "STAaH",
  airbnb: "Airbnb",
  booking: "Booking.com",
  agoda: "Agoda",
  expedia: "Expedia",
}

export function ChannelsPage() {
  const { t } = useT()
  const [rows, setRows] = useState<PropStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prop, setProp] = useState("")
  const [feedUrl, setFeedUrl] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState("")

  const load = useCallback(() => {
    call<PropStatus[]>("kamra.channel_manager.channel_status_matrix", {
      property: prop || undefined,
    })
      .then(setRows)
      .catch((e) => setError(serverError(e)))
  }, [prop])
  useEffect(load, [load])

  const shown = useMemo(() => rows ?? [], [rows])

  async function showFeed(p: string) {
    try {
      const out = await call<{ url: string }>(
        "kamra.channel_manager.ical_feed_link", { property: p })
      setFeedUrl((m) => ({ ...m, [p]: out.url }))
    } catch (e) {
      setError(serverError(e))
    }
  }

  if (error)
    return (
      <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">
        {translate(error)}
      </p>
    )
  if (!rows)
    return <p className="py-10 text-center text-sm text-zinc-400">{t("Loading…")}</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RadioTower className="size-5 text-brand-700" aria-hidden />
            {t("Channels")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {t("Where each property sells: channel-manager connections, per room-type listings and the iCal export feed.")}
          </p>
        </div>
        <label className="text-xs font-medium text-zinc-600">
          {t("Property")}
          <select
            className="ml-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            value={prop}
            onChange={(e) => setProp(e.target.value)}
          >
            <option value="">{t("All properties")}</option>
            {shown.map((r) => (
              <option key={r.property} value={r.property}>{r.property_name}</option>
            ))}
          </select>
        </label>
      </div>

      {shown.map((p) => (
        <section key={p.property} className="rounded-xl border border-zinc-200 bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
            <h3 className="font-semibold text-zinc-900">{p.property_name}</h3>
            <Badge tone="zinc">{t("{n} units", { n: p.units })}</Badge>
            <Badge tone={p.connections.length ? "brand" : "zinc"}>
              {p.connections.length
                ? t("{n} channel{s}", { n: p.connections.length, s: p.connections.length === 1 ? "" : "s" })
                : t("No channel manager")}
            </Badge>
            <Badge tone={p.ical.configured ? "green" : "zinc"}>
              {p.ical.configured ? t("iCal feed on") : t("iCal feed off")}
            </Badge>
          </header>

          <div className="space-y-4 px-4 py-4">
            {/* channel manager connections */}
            {p.connections.map((c) => {
              const ok = (c.last_push_status || "").startsWith("OK")
              const failed = (c.last_push_status || "").startsWith("FAILED")
              return (
                <div key={c.name} className="rounded-lg border border-zinc-200">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-medium text-zinc-800">
                      {PROVIDER_LABEL[(c.provider || "").toLowerCase()] ?? c.provider}
                    </span>
                    {!c.active && <Badge tone="zinc">{t("inactive")}</Badge>}
                    <span className="text-xs text-zinc-400">
                      {t("{n} day sync", { n: c.sync_days || 90 })}
                    </span>
                    <span className="ms-auto flex items-center gap-1.5 text-xs">
                      {c.last_push ? (
                        <>
                          {ok ? (
                            <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                          ) : failed ? (
                            <XCircle className="size-3.5 text-rose-500" aria-hidden />
                          ) : null}
                          <span className={failed ? "text-rose-600" : "text-zinc-500"}>
                            {c.last_push_status || t("never pushed")}
                          </span>
                          <span className="text-zinc-400">· {c.last_push.slice(0, 16)}</span>
                        </>
                      ) : (
                        <span className="text-zinc-400">{t("never pushed")}</span>
                      )}
                    </span>
                  </div>
                  {c.mappings.length > 0 && (
                    <table className="w-full text-xs">
                      <tbody>
                        {c.mappings.map((m) => {
                          const rt = p.room_types.find((r) => r.name === m.room_type)
                          return (
                            <tr key={m.room_type} className="border-t border-zinc-100">
                              <td className="px-3 py-1.5 text-zinc-700">{rt?.label ?? m.room_type}</td>
                              <td className="px-3 py-1.5 font-mono text-zinc-500">{m.external_room_id || "—"}</td>
                              <td className="px-3 py-1.5 font-mono text-zinc-500">{m.external_rate_id || "—"}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}

            {!p.connections.length && (
              <p className="text-sm text-zinc-500">
                {t("No channel manager connected for this property yet. The iCal feed below still blocks sold nights on Airbnb and other calendars.")}
              </p>
            )}

            {/* iCal export */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
              <span className="font-medium text-zinc-700">{t("iCal export")}</span>
              <span className="text-xs text-zinc-500">
                {p.ical.configured
                  ? t("Feed configured - paste the URL into Airbnb or Booking.com calendar import.")
                  : t("No feed yet - generating one creates a secret URL.")}
              </span>
              <span className="ms-auto">
                {feedUrl[p.property] ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    onClick={() => {
                      navigator.clipboard?.writeText(feedUrl[p.property])
                      setCopied(p.property)
                      setTimeout(() => setCopied(""), 1500)
                    }}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {copied === p.property ? t("Copied") : t("Copy feed URL")}
                  </button>
                ) : (
                  <Button variant="outline" className="px-2 py-1 text-xs"
                    onClick={() => showFeed(p.property)}>
                    {p.ical.configured ? t("Show feed URL") : t("Create feed URL")}
                  </Button>
                )}
              </span>
            </div>
            {feedUrl[p.property] && (
              <p className="break-all rounded-lg bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-500">
                {feedUrl[p.property]}
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
