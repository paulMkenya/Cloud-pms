/** The cleaner's phone app (/clean): sign in with a WhatsApp code, clock in,
 *  check in to an apartment, record damages and items left (with photos),
 *  tick the checklist, finish, clock out. Cleaners are not system users -
 *  a token from the WhatsApp code is kept on the phone. Server:
 *  cloudtrade_hospitality.cleaner_app. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Camera, Check, ChevronLeft, Clock, LogOut, MapPin, RefreshCw, X } from "lucide-react"

const API = "cloudtrade_hospitality.cleaner_app."
const TOKEN_KEY = "ct_cleaner_token"

interface Task {
  name: string
  unit: string
  property_name: string
  task_type: string
  status: string
  priority: "Urgent" | "High" | "Normal"
  next_guest: string
  notes?: string | null
  busy_by?: string | null
}
interface Photo { name: string; stage: string; image: string; note?: string }
interface Visit {
  name: string
  unit: string
  task_type: string
  started_on: string
  no_damage: number
  damage_note?: string | null
  no_left_items: number
  left_note?: string | null
  report_done: boolean
  photos: Photo[]
}
interface CheckItem { label: string; kind: "check" | "number"; required: number }
interface Me {
  name: string
  shift: { name: string; clock_in: string } | null
  visit: Visit | null
  tasks: Task[]
  done_today: { unit: string; from: string; to: string; minutes: number }[]
  settings: { checklist: CheckItem[]; photo_damage: number; photo_left: number; photo_final: number; gps: number }
}

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function writeToken(t: string | null) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

class ApiError extends Error { status = 0 }

async function api<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/method/${API}${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(params),
      credentials: "omit",
    })
  } catch {
    throw new Error("No internet. Check your connection and try again. / Hakuna mtandao.")
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    let msg = "Something went wrong. Try again."
    try {
      const m = JSON.parse(body._server_messages || "[]")
      if (m.length) msg = JSON.parse(m[0]).message || msg
    } catch { /* keep default */ }
    if (body.exception && !body._server_messages) msg = String(body.exception).split(":").slice(1).join(":").trim() || msg
    const e = new ApiError(msg.replace(/<[^>]+>/g, ""))
    e.status = res.status
    throw e
  }
  return body.message as T
}

type Geo = { lat?: number; lng?: number; accuracy?: number }
function where(on: boolean): Promise<Geo> {
  if (!on || !navigator.geolocation) return Promise.resolve({})
  return new Promise((resolve) => {
    const done = (g: Geo) => resolve(g)
    const timer = setTimeout(() => done({}), 9000)
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); done({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }) },
      () => { clearTimeout(timer); done({}) },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}

/** Phone photos are big - shrink to 1600px JPEG before sending. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1600
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement("canvas")
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL("image/jpeg", 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the photo.")) }
    img.src = url
  })
}

const hhmm = (s?: string | null) => (s ? s.slice(11, 16) : "")
const PRIO: Record<string, string> = {
  Urgent: "bg-rose-100 text-rose-800",
  High: "bg-amber-100 text-amber-800",
  Normal: "bg-zinc-100 text-zinc-600",
}

function Big({ children, onClick, tone = "brand", disabled }: {
  children: ReactNode; onClick: () => void; tone?: "brand" | "dark" | "red" | "light"; disabled?: boolean
}) {
  const c = {
    brand: "bg-brand-600 text-white active:bg-brand-700",
    dark: "bg-zinc-900 text-white active:bg-zinc-800",
    red: "bg-rose-600 text-white active:bg-rose-700",
    light: "border border-zinc-300 bg-white text-zinc-800 active:bg-zinc-50",
  }[tone]
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-semibold disabled:opacity-50 ${c}`}>
      {children}
    </button>
  )
}

export default function CleanerApp() {
  const [token, setToken] = useState<string | null>(readToken)
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signOut = useCallback(() => {
    const t = token
    writeToken(null)
    setToken(null)
    setMe(null)
    if (t) void api("sign_out", { token: t }).catch(() => undefined)
  }, [token])

  const run = useCallback(async (fn: () => Promise<Me | void>) => {
    setBusy(true)
    setErr(null)
    try {
      const r = await fn()
      if (r) setMe(r)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut()
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [signOut])

  const load = useCallback(() => token ? run(() => api<Me>("me", { token })) : Promise.resolve(), [token, run])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    document.title = "Cleaning"
    const id = setInterval(() => document.visibilityState === "visible" && !busy && void load(), 60_000)
    return () => clearInterval(id)
  }, [load, busy])

  if (!token) return <SignIn onToken={(t) => { writeToken(t); setToken(t) }} />

  return (
    <div className="min-h-dvh bg-zinc-50 pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-zinc-900">{me ? `Hi ${me.name}` : "Cleaning"}</p>
          {me?.shift && <p className="text-sm text-emerald-700">Clocked in {hhmm(me.shift.clock_in)}</p>}
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh" className="grid size-11 place-items-center rounded-full text-zinc-500 active:bg-zinc-100">
          <RefreshCw className={`size-5 ${busy ? "animate-spin" : ""}`} />
        </button>
        <button type="button" onClick={signOut} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-zinc-500 active:bg-zinc-100">
          <LogOut className="size-5" />
        </button>
      </header>
      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {err && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-3 text-base text-rose-800">
            <span className="flex-1">{err}</span>
            <button type="button" aria-label="Close" onClick={() => setErr(null)}><X className="size-5" /></button>
          </div>
        )}
        {!me ? (
          <p className="py-10 text-center text-zinc-500">Loading…</p>
        ) : me.visit ? (
          <VisitView me={me} token={token} busy={busy} run={run} setErr={setErr} />
        ) : !me.shift ? (
          <div className="space-y-4 pt-6 text-center">
            <Clock className="mx-auto size-14 text-brand-600" />
            <p className="text-lg text-zinc-700">Start your day / Anza siku</p>
            <Big disabled={busy} onClick={() => run(async () => api<Me>("clock_in", { token, ...(await where(!!me.settings.gps)) }))}>
              Clock in · Ingia kazini
            </Big>
            {me.tasks.length > 0 && <p className="text-sm text-zinc-500">{me.tasks.length} apartment(s) waiting</p>}
          </div>
        ) : (
          <Home me={me} token={token} busy={busy} run={run} />
        )}
      </main>
    </div>
  )
}

function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 bg-zinc-50 px-5">
      <h1 className="text-2xl font-semibold text-zinc-900">Cleaning app</h1>
      <p className="text-base text-zinc-600">
        {sent ? "Type the 6-digit code we sent you on WhatsApp. / Andika namba tuliyokutumia." : "Your phone number - we send a code on WhatsApp. / Namba yako ya simu."}
      </p>
      {!sent ? (
        <input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="0712 345 678" className="min-h-14 rounded-2xl border border-zinc-300 bg-white px-4 text-xl" />
      ) : (
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456" className="min-h-14 rounded-2xl border border-zinc-300 bg-white px-4 text-center text-2xl tracking-[0.4em]" />
      )}
      {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-base text-rose-800">{err}</p>}
      {!sent ? (
        <Big disabled={busy || phone.replace(/\D/g, "").length < 9}
          onClick={() => go(async () => { await api("request_code", { phone }); setSent(true) })}>
          Send code · Tuma namba
        </Big>
      ) : (
        <>
          <Big disabled={busy || code.length !== 6}
            onClick={() => go(async () => { const r = await api<{ token: string }>("verify_code", { phone, code }); onToken(r.token) })}>
            Sign in · Ingia
          </Big>
          <button type="button" className="py-2 text-base text-brand-700" onClick={() => { setSent(false); setCode("") }}>
            Change number / send again
          </button>
        </>
      )}
    </div>
  )
}

function Home({ me, token, busy, run }: {
  me: Me; token: string; busy: boolean; run: (fn: () => Promise<Me | void>) => Promise<void>
}) {
  return (
    <>
      <section>
        <h2 className="mb-2 text-base font-semibold text-zinc-800">Apartments to clean / Za kusafisha ({me.tasks.length})</h2>
        {me.tasks.length === 0 ? (
          <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-center text-base text-zinc-500">
            Nothing waiting right now. 👍<br />Hakuna kazi sasa hivi.
          </p>
        ) : (
          <ul className="space-y-3">
            {me.tasks.map((t) => (
              <li key={t.name}>
                <button type="button" disabled={busy || !!t.busy_by}
                  onClick={() => run(async () => api<Me>("start_visit", { token, task: t.name, ...(await where(!!me.settings.gps)) }))}
                  className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-start active:bg-zinc-50 disabled:opacity-60">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold text-zinc-900">{t.unit}</span>
                      <span className="block text-sm text-zinc-600">{t.task_type} · {t.next_guest}</span>
                      {t.notes && <span className="mt-1 block text-sm text-zinc-500 line-clamp-2">{t.notes}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ${PRIO[t.priority]}`}>{t.priority}</span>
                  </div>
                  <span className="mt-3 block rounded-xl bg-brand-50 py-2.5 text-center text-base font-semibold text-brand-700">
                    {t.busy_by ? `${t.busy_by} is cleaning` : "Check in · Anza hapa"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {me.done_today.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold text-zinc-800">Done today / Umemaliza</h2>
          <ul className="space-y-1 text-base text-zinc-700">
            {me.done_today.map((d, i) => (
              <li key={i} className="flex gap-2"><Check className="size-5 shrink-0 text-emerald-600" /> {d.unit} · {d.from}–{d.to}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="pt-4">
        <Big tone="dark" disabled={busy}
          onClick={() => window.confirm("Clock out for today? / Toka kazini?") &&
            run(async () => api<Me>("clock_out", { token, ...(await where(!!me.settings.gps)) }))}>
          Clock out · Toka kazini
        </Big>
      </div>
    </>
  )
}

function PhotoRow({ visit, stage, token, setVisit, setErr, label }: {
  visit: Visit; stage: string; token: string; label: string
  setVisit: (v: Visit) => void; setErr: (e: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [up, setUp] = useState(false)
  const mine = visit.photos.filter((p) => p.stage === stage)
  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setUp(true)
    setErr(null)
    try {
      for (const f of Array.from(files).slice(0, 4)) {
        const image = await shrink(f)
        setVisit(await api<Visit>("add_photo", { token, visit: visit.name, stage, image }))
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setUp(false)
      if (ref.current) ref.current.value = ""
    }
  }
  return (
    <div className="space-y-2">
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mine.map((p) => (
            <div key={p.name} className="relative">
              <img src={p.image} alt="" className="size-20 rounded-xl object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.3")} />
              <button type="button" aria-label="Remove photo"
                onClick={async () => { try { setVisit(await api<Visit>("remove_photo", { token, visit: visit.name, row: p.name })) } catch (e) { setErr((e as Error).message) } }}
                className="absolute -end-2 -top-2 grid size-7 place-items-center rounded-full bg-zinc-900 text-white"><X className="size-4" /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void pick(e.target.files)} />
      <button type="button" disabled={up} onClick={() => ref.current?.click()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-400 bg-white text-base font-medium text-zinc-700 active:bg-zinc-50">
        <Camera className="size-5" /> {up ? "Sending…" : label}
      </button>
    </div>
  )
}

function YesNo({ none, setNone, noneLabel, someLabel }: { none: boolean | null; setNone: (v: boolean) => void; noneLabel: string; someLabel: string }) {
  const b = (on: boolean) => `min-h-12 flex-1 rounded-xl border px-3 text-base font-semibold ${on ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-300 bg-white text-zinc-700"}`
  return (
    <div className="flex gap-2">
      <button type="button" className={b(none === true)} onClick={() => setNone(true)}>{noneLabel}</button>
      <button type="button" className={b(none === false)} onClick={() => setNone(false)}>{someLabel}</button>
    </div>
  )
}

function VisitView({ me, token, busy, run, setErr }: {
  me: Me; token: string; busy: boolean
  run: (fn: () => Promise<Me | void>) => Promise<void>; setErr: (e: string | null) => void
}) {
  const [visit, setVisitState] = useState<Visit>(me.visit!)
  useEffect(() => setVisitState(me.visit!), [me.visit])
  const [step, setStep] = useState<1 | 2>(me.visit!.report_done ? 2 : 1)
  const [noDamage, setNoDamage] = useState<boolean | null>(visit.no_damage ? true : visit.damage_note ? false : null)
  const [damage, setDamage] = useState(visit.damage_note || "")
  const [noLeft, setNoLeft] = useState<boolean | null>(visit.no_left_items ? true : visit.left_note ? false : null)
  const [left, setLeft] = useState(visit.left_note || "")
  const [checks, setChecks] = useState<Record<string, { ok?: number; value?: string; note?: string }>>({})
  const s = me.settings
  const set = (label: string, v: { ok?: number; value?: string; note?: string }) =>
    setChecks((c) => ({ ...c, [label]: { ...c[label], ...v } }))

  const saveReport = async () => {
    setErr(null)
    try {
      const v = await api<Visit>("save_report", {
        token, visit: visit.name,
        no_damage: noDamage ? 1 : 0, damage_note: noDamage ? "" : damage,
        no_left_items: noLeft ? 1 : 0, left_note: noLeft ? "" : left,
      })
      setVisitState(v)
      setStep(2)
      window.scrollTo(0, 0)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-brand-600 p-4 text-white">
        <p className="text-sm opacity-90">{visit.task_type} · checked in {hhmm(visit.started_on)}</p>
        <p className="text-xl font-semibold">{visit.unit}</p>
        <p className="mt-1 text-sm opacity-90">Step {step} of 2</p>
      </div>

      {step === 1 ? (
        <>
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-zinc-900">Any damage? / Kuna uharibifu?</h2>
            <YesNo none={noDamage} setNone={setNoDamage} noneLabel="No damage" someLabel="Yes, damage" />
            {noDamage === false && (
              <>
                <textarea value={damage} onChange={(e) => setDamage(e.target.value)} rows={3}
                  placeholder="What is damaged? e.g. bedside lamp broken"
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-base" />
                <PhotoRow visit={visit} stage="Damage" token={token} setVisit={setVisitState} setErr={setErr}
                  label={`Photo of the damage${s.photo_damage ? " (required)" : ""}`} />
              </>
            )}
          </section>
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-zinc-900">Did the guest leave anything? / Ameacha kitu?</h2>
            <YesNo none={noLeft} setNone={setNoLeft} noneLabel="Nothing left" someLabel="Yes, items" />
            {noLeft === false && (
              <>
                <textarea value={left} onChange={(e) => setLeft(e.target.value)} rows={2}
                  placeholder="What? e.g. phone charger, black jacket"
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-base" />
                <PhotoRow visit={visit} stage="Left item" token={token} setVisit={setVisitState} setErr={setErr}
                  label={`Photo of the item${s.photo_left ? " (required)" : ""}`} />
              </>
            )}
          </section>
          <Big disabled={busy || noDamage === null || noLeft === null || (noDamage === false && !damage.trim()) || (noLeft === false && !left.trim())}
            onClick={() => void saveReport()}>
            Save and start cleaning
          </Big>
        </>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-lg font-semibold text-zinc-900">Checklist / Orodha</h2>
              <button type="button" onClick={() => setStep(1)} className="flex items-center text-sm text-brand-700">
                <ChevronLeft className="size-4" /> Damages
              </button>
            </div>
            {s.checklist.map((it) => {
              const c = checks[it.label] || {}
              return it.kind === "number" ? (
                <label key={it.label} className="block">
                  <span className="mb-1 block text-base font-medium text-zinc-800">{it.label}</span>
                  <input inputMode="decimal" value={c.value || ""} onChange={(e) => set(it.label, { value: e.target.value })}
                    placeholder="e.g. 34.5" className="min-h-12 w-full rounded-xl border border-zinc-300 px-3 text-lg" />
                </label>
              ) : (
                <div key={it.label} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-base font-medium text-zinc-800">{it.label}</span>
                    <button type="button" onClick={() => set(it.label, { ok: 1 })}
                      className={`grid h-12 w-16 place-items-center rounded-xl border text-base font-semibold ${c.ok === 1 ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>
                      <Check className="size-6" />
                    </button>
                    <button type="button" onClick={() => set(it.label, { ok: 0 })}
                      className={`grid h-12 w-16 place-items-center rounded-xl border text-base font-semibold ${c.ok === 0 ? "border-rose-600 bg-rose-600 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>
                      <X className="size-6" />
                    </button>
                  </div>
                  {c.ok === 0 && (
                    <input value={c.note || ""} onChange={(e) => set(it.label, { note: e.target.value })}
                      placeholder="What is wrong? / Shida ni nini?" className="min-h-12 w-full rounded-xl border border-rose-300 px-3 text-base" />
                  )}
                </div>
              )
            })}
          </section>
          <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-zinc-900">Final photo{s.photo_final ? " (required)" : ""}</h2>
            <PhotoRow visit={visit} stage="Final" token={token} setVisit={setVisitState} setErr={setErr} label="Take a photo of the clean room" />
          </section>
          <Big disabled={busy}
            onClick={() => run(async () => {
              const list = s.checklist.map((it) => ({ item: it.label, ...checks[it.label] }))
              return api<Me>("finish_visit", { token, visit: visit.name, checks: JSON.stringify(list), ...(await where(!!s.gps)) })
            })}>
            <Check className="size-6" /> Finish · Nimemaliza
          </Big>
          {s.gps ? <p className="flex items-center justify-center gap-1 text-sm text-zinc-500"><MapPin className="size-4" /> Your location is recorded at check-in and finish.</p> : null}
        </>
      )}
    </div>
  )
}
