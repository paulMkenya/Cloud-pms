/** The cleaner's phone app (/clean): sign in with a WhatsApp code, clock in,
 *  check in to an apartment, record damages and items left (with photos),
 *  tick the checklist, finish, clock out. Cleaners are not system users -
 *  a token from the WhatsApp code is kept on the phone. Server:
 *  cloudtrade_hospitality.cleaner_app. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Camera, Check, ChevronLeft, ChevronRight, Clock, Download, Image as ImageIcon, LogOut, MapPin, MoreVertical, RefreshCw, RotateCcw, Share, X } from "lucide-react"

const API = "cloudtrade_hospitality.cleaner_app."
const TOKEN_KEY = "ct_cleaner_token"

interface Task {
  name: string
  property: string
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
  inventory_due?: Due[]
}
interface Due { property: string; property_name: string; items: { item: string; qty: number }[] }

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

/** Photos are made small on the phone before sending (1280px JPEG,
 *  ~150-300 KB): quick on a slow connection, and light on memory - an old
 *  Android phone that runs out of memory closes the page. */
const MAX_SIDE = 1280
const QUALITY = 0.72

function toJpeg(src: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h))
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height)
  const out = c.toDataURL("image/jpeg", QUALITY)
  c.width = c.height = 0 // free the memory now
  return out
}

async function prepare(file: File): Promise<string> {
  // decode straight to a small size where the browser can (much less memory)
  if ("createImageBitmap" in window) {
    try {
      const probe = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
      const { width, height } = probe
      probe.close()
      const k = Math.min(1, MAX_SIDE / Math.max(width, height))
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image", resizeWidth: Math.round(width * k),
        resizeHeight: Math.round(height * k), resizeQuality: "medium",
      } as ImageBitmapOptions)
      const out = toJpeg(bmp, bmp.width, bmp.height)
      bmp.close()
      return out
    } catch { /* fall back below */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(toJpeg(img, img.naturalWidth, img.naturalHeight)) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the photo. Try again. / Jaribu tena.")) }
    img.src = url
  })
}

/** add_photo with upload progress and a time limit (fetch has no progress). */
function sendPhoto(params: Record<string, unknown>, onProgress: (pct: number) => void): Promise<Visit> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open("POST", `/api/method/${API}add_photo`)
    x.setRequestHeader("Content-Type", "application/json")
    x.setRequestHeader("Accept", "application/json")
    x.timeout = 120_000
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    x.onload = () => {
      let body: { message?: Visit; _server_messages?: string } = {}
      try { body = JSON.parse(x.responseText || "{}") } catch { /* keep empty */ }
      if (x.status >= 200 && x.status < 300 && body.message) return resolve(body.message)
      let msg = "The photo did not send."
      try { const m = JSON.parse(body._server_messages || "[]"); if (m.length) msg = JSON.parse(m[0]).message || msg } catch { /* default */ }
      const e = new ApiError(msg.replace(/<[^>]+>/g, ""))
      e.status = x.status
      reject(e)
    }
    x.onerror = () => reject(new Error("No internet - the photo is kept and will send again."))
    x.ontimeout = () => reject(new Error("The connection is slow - the photo is kept and will send again."))
    x.send(JSON.stringify(params))
  })
}

/** Photos not yet confirmed by the server are kept on the phone, so a
 *  reload, a lost connection or a closed page never loses one. */
interface Pending { id: string; visit: string; stage: string; image: string; pct: number; failed?: string }
const PENDING_KEY = "ct_clean_pending"
function readPending(): Pending[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") } catch { return [] }
}
function writePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.map(({ pct: _pct, failed: _f, ...rest }) => ({ ...rest, pct: 0 }))))
  } catch { /* storage full: still uploads, just not kept across a reload */ }
}

/** Notes and ticks of the apartment in hand, kept on the phone. */
const draftKey = (visit: string) => `ct_clean_draft_${visit}`
function readDraft<T>(visit: string): Partial<T> {
  try { return JSON.parse(localStorage.getItem(draftKey(visit)) || "{}") } catch { return {} }
}
function clearDrafts(keep?: string) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("ct_clean_draft_") && k !== (keep ? draftKey(keep) : "")) localStorage.removeItem(k)
    }
    if (!keep) localStorage.removeItem(PENDING_KEY)
  } catch { /* private mode */ }
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

const PICKING_KEY = "ct_clean_picking"     // set while the phone's gallery is open
const SKIP_INSTALL_KEY = "ct_clean_install_skip"
const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true
const buzz = (ms = 40) => { try { navigator.vibrate?.(ms) } catch { /* not supported */ } }

export default function CleanerApp() {
  const [installed, setInstalled] = useState(() => {
    if (standalone()) return true
    try { return sessionStorage.getItem(SKIP_INSTALL_KEY) === "1" } catch { return false }
  })
  if (!installed) return <InstallGate onContinue={() => setInstalled(true)} />
  return <CleanerMain />
}

function CleanerMain() {
  const [token, setToken] = useState<string | null>(readToken)
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  // the phone closed the page while its gallery was open: say so kindly
  const [notice, setNotice] = useState<string | null>(() => {
    try {
      const at = Number(localStorage.getItem(PICKING_KEY) || 0)
      localStorage.removeItem(PICKING_KEY)
      return at && Date.now() - at < 15 * 60_000
        ? "Your phone closed the app while you were choosing a photo. Everything you did is saved - just add the photo again. / Kila kitu kimehifadhiwa."
        : null
    } catch { return null }
  })

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
  // the background refresh is silent: no spinner, no blocked buttons
  const quiet = useCallback(async () => {
    if (!token) return
    try { setMe(await api<Me>("me", { token })) } catch (e) { if (e instanceof ApiError && e.status === 401) signOut() }
  }, [token, signOut])
  // no apartment open any more: drop the phone's notes and photo copies
  useEffect(() => { if (me && !me.visit) clearDrafts() }, [me])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    document.title = "Cleaning"
    const id = setInterval(() => document.visibilityState === "visible" && !busy && void quiet(), 60_000)
    return () => clearInterval(id)
  }, [quiet, busy])

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
        {notice && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-3 text-base text-amber-900">
            <span className="flex-1">{notice}</span>
            <button type="button" aria-label="Close" onClick={() => setNotice(null)}><X className="size-5" /></button>
          </div>
        )}
        {err && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-3 text-base text-rose-800">
            <span className="flex-1">{err}</span>
            <button type="button" aria-label="Close" onClick={() => setErr(null)}><X className="size-5" /></button>
          </div>
        )}
        {done ? (
          <DoneScreen unit={done} onClose={() => setDone(null)} />
        ) : !me ? (
          <p className="py-10 text-center text-zinc-500">Loading…</p>
        ) : me.visit ? (
          <VisitView me={me} token={token} busy={busy} run={run} setErr={setErr} onDone={(u) => { buzz(120); setDone(u) }} />
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
  const [counting, setCounting] = useState<Due | null>(null)
  const due = me.inventory_due || []
  const dueFor = (prop: string) => due.find((d) => d.property === prop)
  // the house was accepted (or the list was dropped) - back to the list
  useEffect(() => { if (counting && !dueFor(counting.property)) setCounting(null) })
  if (counting) return <InventoryView due={counting} token={token} busy={busy} run={run} back={() => setCounting(null)} />
  return (
    <>
      {due.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-base font-semibold text-amber-900">Count the house inventory / Hesabu vitu vya nyumba</h2>
          <p className="text-sm text-amber-900">Before your first clean in a house, count its items and accept responsibility for them.</p>
          {due.map((d) => (
            <Big key={d.property} tone="light" disabled={busy} onClick={() => setCounting(d)}>
              {d.property_name} · {d.items.length} items
            </Big>
          ))}
        </section>
      )}
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
                  onClick={() => dueFor(t.property) ? setCounting(dueFor(t.property)!)
                    : run(async () => api<Me>("start_visit", { token, task: t.name, ...(await where(!!me.settings.gps)) }))}
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
                    {t.busy_by ? `${t.busy_by} is cleaning` : dueFor(t.property) ? "Count the inventory first · Hesabu kwanza" : "Check in · Anza hapa"}
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

/** A house's inventory: she counts each item (filled in with the
 *  director's number), notes any difference, and accepts responsibility. */
function InventoryView({ due, token, busy, run, back }: {
  due: Due; token: string; busy: boolean; run: (fn: () => Promise<Me | void>) => Promise<void>; back: () => void
}) {
  const invKey = `ct_clean_inv_${due.property}`
  const [rows, setRows] = useState(() => {
    const base = due.items.map((i) => ({ item: i.item, qty: i.qty, counted: String(i.qty), note: "" }))
    try {
      const kept = JSON.parse(localStorage.getItem(invKey) || "null") as typeof base | null
      if (kept) return base.map((r) => ({ ...r, ...(kept.find((k) => k.item === r.item && k.qty === r.qty) || {}) }))
    } catch { /* nothing kept */ }
    return base
  })
  useEffect(() => { try { localStorage.setItem(invKey, JSON.stringify(rows)) } catch { /* full */ } }, [invKey, rows])
  const set = (k: number, v: Partial<(typeof rows)[number]>) => setRows(rows.map((r, i) => (i === k ? { ...r, ...v } : r)))
  const bad = rows.some((r) => !/^\d+$/.test(r.counted.trim()))
  const diffs = rows.filter((r) => /^\d+$/.test(r.counted.trim()) && Number(r.counted) !== r.qty).length
  return (
    <>
      <button type="button" onClick={back} className="flex items-center text-base text-brand-700">
        <ChevronLeft className="size-5" /> Back
      </button>
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{due.property_name}</h2>
          <p className="text-sm text-zinc-600">Count each item. Change the number if it is different and say why. / Hesabu kila kitu.</p>
        </div>
        <ul className="divide-y divide-zinc-100">
          {rows.map((r, i) => {
            const off = /^\d+$/.test(r.counted.trim()) && Number(r.counted) !== r.qty
            return (
              <li key={r.item} className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium text-zinc-900">{r.item}</span>
                    <span className="block text-sm text-zinc-500">List: {r.qty}</span>
                  </span>
                  <input inputMode="numeric" value={r.counted} aria-label={`${r.item} counted`}
                    onChange={(e) => set(i, { counted: e.target.value.replace(/\D/g, "") })}
                    className={`min-h-12 w-20 rounded-xl border px-2 text-center text-lg ${off ? "border-amber-500 bg-amber-50" : "border-zinc-300"}`} />
                </div>
                {off && (
                  <input value={r.note} onChange={(e) => set(i, { note: e.target.value })}
                    placeholder="Why different? e.g. 2 torn, 1 missing"
                    className="min-h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" />
                )}
              </li>
            )
          })}
        </ul>
      </section>
      {diffs > 0 && <p className="text-sm text-amber-800">{diffs} item(s) different from the list - the manager will see this.</p>}
      <Big disabled={busy || bad}
        onClick={() => window.confirm(`I have counted the items in ${due.property_name} and I take responsibility for them. / Nakubali kuwajibika.`) &&
          run(async () => {
            const r = await api<Me>("accept_inventory", { token, property: due.property, counts: JSON.stringify(rows.map((r) => ({ item: r.item, counted: r.counted.trim(), note: r.note }))) })
            try { localStorage.removeItem(invKey) } catch { /* private mode */ }
            buzz()
            return r
          })}>
        <Check className="size-6" /> I confirm and take responsibility · Nakubali
      </Big>
    </>
  )
}

/** Full-screen camera inside the page: the phone never switches to its
 *  camera app, so Android cannot close the page while a photo is taken. */
function CameraSheet({ onShot, onClose, onGallery }: {
  onShot: (dataUrl: string) => void; onClose: () => void; onGallery: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let stream: MediaStream | null = null
    let gone = false
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    }).then((st) => {
      if (gone) { st.getTracks().forEach((t) => t.stop()); return }
      stream = st
      if (video.current) {
        video.current.srcObject = st
        void video.current.play().then(() => setReady(true)).catch(() => setReady(true))
      }
    }).catch(() => setFailed(true))
    return () => { gone = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  useEffect(() => { if (failed) onGallery() }, [failed, onGallery])
  const shoot = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    onShot(toJpeg(v, v.videoWidth, v.videoHeight))
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video ref={video} playsInline muted className="min-h-0 flex-1 object-contain" />
      {!ready && <p className="absolute inset-x-0 top-1/3 text-center text-lg text-white">Opening camera… / Inafungua kamera…<br /><span className="text-sm opacity-80">Tap “Allow” if your phone asks.</span></p>}
      <div className="flex items-center justify-around bg-black px-4 pb-8 pt-4">
        <button type="button" onClick={onClose} aria-label="Cancel" className="grid size-14 place-items-center rounded-full bg-white/15 text-white">
          <X className="size-7" />
        </button>
        <button type="button" onClick={shoot} disabled={!ready} aria-label="Take photo"
          className="size-20 rounded-full border-4 border-white bg-white/90 active:scale-95 disabled:opacity-40" />
        <button type="button" onClick={onGallery} aria-label="Choose from gallery" className="grid size-14 place-items-center rounded-full bg-white/15 text-white">
          <ImageIcon className="size-7" />
        </button>
      </div>
    </div>
  )
}

function PhotoRow({ visit, stage, token, setErr, setVisit, label, pending, add, retry }: {
  visit: Visit; stage: string; token: string; label: string
  setErr: (e: string | null) => void
  pending: Pending[]; add: (stage: string, image: string) => void; retry: (id: string) => void
  setVisit: (v: Visit) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const mine = visit.photos.filter((p) => p.stage === stage)
  const waiting = pending.filter((p) => p.stage === stage)
  const canCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  const openGallery = useCallback(() => {
    setCamera(false)
    try { localStorage.setItem(PICKING_KEY, String(Date.now())) } catch { /* private mode */ }
    file.current?.click()
  }, [])
  const fromFiles = async (files: FileList | null) => {
    try { localStorage.removeItem(PICKING_KEY) } catch { /* private mode */ }
    if (!files?.length) return
    setPreparing(true)
    setErr(null)
    try {
      for (const f of Array.from(files).slice(0, 4)) add(stage, await prepare(f))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPreparing(false)
      if (file.current) file.current.value = ""
    }
  }
  return (
    <div className="space-y-2">
      {(mine.length > 0 || waiting.length > 0) && (
        <div className="flex flex-wrap gap-3">
          {mine.map((p) => (
            <div key={p.name} className="relative">
              <img src={p.image} alt="" className="size-20 rounded-xl object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.3")} />
              <span className="absolute bottom-1 start-1 grid size-6 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-4" /></span>
              <button type="button" aria-label="Remove photo"
                onClick={async () => {
                  if (!window.confirm("Remove this photo? / Ondoa picha?")) return
                  try { setVisit(await api<Visit>("remove_photo", { token, visit: visit.name, row: p.name })) } catch (e) { setErr((e as Error).message) }
                }}
                className="absolute -end-2 -top-2 grid size-8 place-items-center rounded-full bg-zinc-900 text-white"><X className="size-4" /></button>
            </div>
          ))}
          {waiting.map((p) => (
            <button key={p.id} type="button" disabled={!p.failed} onClick={() => retry(p.id)} className="relative size-20 overflow-hidden rounded-xl">
              <img src={p.image} alt="" className="size-20 object-cover opacity-60" />
              {p.failed ? (
                <span className="absolute inset-0 grid place-items-center bg-rose-600/80 px-1 text-center text-xs font-semibold text-white">
                  <RotateCcw className="mx-auto size-5" />Tap to send again
                </span>
              ) : (
                <span className="absolute inset-0 grid place-items-center bg-black/30 text-sm font-semibold text-white">
                  {p.pct > 0 && p.pct < 100 ? `${p.pct}%` : "…"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {waiting.some((p) => !p.failed) && <p className="text-sm text-zinc-600">Sending photo… you can carry on. / Inatuma picha…</p>}
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => void fromFiles(e.target.files)} />
      <div className="flex gap-2">
        <button type="button" disabled={preparing} onClick={() => (canCamera ? setCamera(true) : openGallery())}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-600 bg-brand-50 text-base font-semibold text-brand-700 active:bg-brand-100">
          <Camera className="size-6" /> {preparing ? "Getting photo…" : label}
        </button>
        {canCamera && (
          <button type="button" disabled={preparing} onClick={openGallery} aria-label="Choose from gallery"
            className="grid min-h-14 w-14 place-items-center rounded-xl border border-zinc-300 bg-white text-zinc-600 active:bg-zinc-50">
            <ImageIcon className="size-6" />
          </button>
        )}
      </div>
      {camera && (
        <CameraSheet onClose={() => setCamera(false)} onGallery={openGallery}
          onShot={(img) => { buzz(); setCamera(false); add(stage, img) }} />
      )}
    </div>
  )
}

/** The upload queue of one apartment: sends one photo at a time, tries
 *  again on its own when the connection comes back, survives a reload. */
function usePhotoQueue(visit: string, token: string, onVisit: (v: Visit) => void) {
  const list = useRef<Pending[]>(readPending().filter((p) => p.visit === visit))
  const [, render] = useState(0)
  const sending = useRef(false)
  const commit = (next: Pending[], persist: boolean) => {
    list.current = next
    if (persist) writePending([...readPending().filter((p) => p.visit !== visit), ...next])
    render((n) => n + 1)
  }
  const patch = (id: string, v: Partial<Pending>) => commit(list.current.map((p) => (p.id === id ? { ...p, ...v } : p)), false)
  const drop = (id: string) => commit(list.current.filter((p) => p.id !== id), true)
  const pump = useCallback(async () => {
    if (sending.current) return
    sending.current = true
    try {
      for (let next = list.current.find((p) => !p.failed); next; next = list.current.find((p) => !p.failed)) {
        const item = next
        try {
          const v = await sendPhoto({ token, visit, stage: item.stage, image: item.image }, (pct) => patch(item.id, { pct }))
          drop(item.id)
          onVisit(v)
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0
          if (status >= 400 && status < 500) {
            // refused for good (apartment already finished, not a photo): drop it and say why
            drop(item.id)
            window.dispatchEvent(new CustomEvent("ct-clean-error", { detail: (e as Error).message }))
          } else {
            patch(item.id, { failed: (e as Error).message, pct: 0 })
          }
        }
      }
    } finally {
      sending.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit, token, onVisit])
  useEffect(() => { void pump() }, [pump])
  // back online, back to the app, or every 30 seconds: send the failed ones again
  useEffect(() => {
    const again = () => {
      if (!list.current.some((p) => p.failed)) return
      commit(list.current.map((p) => ({ ...p, failed: undefined })), false)
      void pump()
    }
    const vis = () => document.visibilityState === "visible" && again()
    window.addEventListener("online", again)
    document.addEventListener("visibilitychange", vis)
    const t = setInterval(() => navigator.onLine && again(), 30_000)
    return () => { window.removeEventListener("online", again); document.removeEventListener("visibilitychange", vis); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pump])
  const add = (stage: string, image: string) => {
    commit([...list.current, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, visit, stage, image, pct: 0 }], true)
    void pump()
  }
  const retry = (id: string) => { patch(id, { failed: undefined }); void pump() }
  return { items: list.current, add, retry }
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

const STEPS = ["Damage", "Left items", "Checklist", "Photo", "Finish"] as const

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`Step ${step} of ${STEPS.length}`}>
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1">
          <div className={`h-2 rounded-full ${i + 1 <= step ? "bg-white" : "bg-white/30"}`} />
          <p className={`mt-1 truncate text-center text-[11px] ${i + 1 === step ? "font-semibold opacity-100" : "opacity-70"}`}>{label}</p>
        </div>
      ))}
    </div>
  )
}

/** One apartment as a guided path, one question per screen. Every step is
 *  shown and answered; what she types is kept on the phone throughout. */
function VisitView({ me, token, busy, run, setErr, onDone }: {
  me: Me; token: string; busy: boolean
  run: (fn: () => Promise<Me | void>) => Promise<void>; setErr: (e: string | null) => void
  onDone: (unit: string) => void
}) {
  const [visit, setVisitState] = useState<Visit>(me.visit!)
  useEffect(() => setVisitState(me.visit!), [me.visit])
  type Checks = Record<string, { ok?: number; value?: string; note?: string }>
  const draft = useRef(readDraft<{ step: number; noDamage: boolean | null; damage: string; noLeft: boolean | null; left: string; checks: Checks }>(me.visit!.name)).current
  const [step, setStepRaw] = useState<number>(draft.step && draft.step >= 1 && draft.step <= 5 ? draft.step : me.visit!.report_done ? 3 : 1)
  const [noDamage, setNoDamage] = useState<boolean | null>(draft.noDamage !== undefined ? draft.noDamage : visit.no_damage ? true : visit.damage_note ? false : null)
  const [damage, setDamage] = useState(draft.damage ?? (visit.damage_note || ""))
  const [noLeft, setNoLeft] = useState<boolean | null>(draft.noLeft !== undefined ? draft.noLeft : visit.no_left_items ? true : visit.left_note ? false : null)
  const [left, setLeft] = useState(draft.left ?? (visit.left_note || ""))
  const [checks, setChecks] = useState<Checks>(draft.checks || {})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    try { localStorage.setItem(draftKey(visit.name), JSON.stringify({ step, noDamage, damage, noLeft, left, checks })) } catch { /* full */ }
  }, [visit.name, step, noDamage, damage, noLeft, left, checks])
  const onVisit = useCallback((v: Visit) => setVisitState(v), [])
  const queue = usePhotoQueue(visit.name, token, onVisit)
  const sendingPhotos = queue.items.length > 0
  const sendingRef = useRef(sendingPhotos)
  sendingRef.current = sendingPhotos
  useEffect(() => {
    const showErr = (e: Event) => setErr((e as CustomEvent<string>).detail)
    window.addEventListener("ct-clean-error", showErr)
    return () => window.removeEventListener("ct-clean-error", showErr)
  }, [setErr])
  const photoProps = { pending: queue.items, add: queue.add, retry: queue.retry, setVisit: setVisitState }
  const s = me.settings
  const set = (label: string, v: { ok?: number; value?: string; note?: string }) =>
    setChecks((c) => ({ ...c, [label]: { ...c[label], ...v } }))
  const go = (n: number) => { setErr(null); setStepRaw(n); window.scrollTo(0, 0) }
  const photos = (stage: string) => visit.photos.filter((p) => p.stage === stage).length
    + queue.items.filter((p) => p.stage === stage).length

  // what each step still needs before Next
  const need1 = noDamage === null ? "Tap No damage or Yes, damage." : noDamage === false && !damage.trim() ? "Write what is damaged."
    : noDamage === false && s.photo_damage && !photos("Damage") ? "Take a photo of the damage." : null
  const need2 = noLeft === null ? "Tap Nothing left or Yes, items." : noLeft === false && !left.trim() ? "Write what the guest left."
    : noLeft === false && s.photo_left && !photos("Left item") ? "Take a photo of the item." : null
  const need3 = (() => {
    for (const it of s.checklist) {
      const c = checks[it.label] || {}
      if (it.kind === "number") { if (it.required && !(c.value || "").trim()) return `Fill in: ${it.label}` }
      else if (c.ok === undefined) return `Answer: ${it.label}`
      else if (c.ok === 0 && it.required && !(c.note || "").trim()) return `Say what is wrong: ${it.label}`
    }
    return null
  })()
  const need4 = s.photo_final && !photos("Final") ? "Take a photo of the clean room." : null

  const saveReport = async (nothingLeft: boolean | null = noLeft) => {
    setSaving(true)
    setErr(null)
    try {
      const v = await api<Visit>("save_report", {
        token, visit: visit.name,
        no_damage: noDamage ? 1 : 0, damage_note: noDamage ? "" : damage,
        no_left_items: nothingLeft ? 1 : 0, left_note: nothingLeft ? "" : left,
      })
      setVisitState(v)
      go(3)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const finish = () => run(async () => {
    const list = s.checklist.map((it) => ({ item: it.label, ...checks[it.label] }))
    const r = await api<Me>("finish_visit", { token, visit: visit.name, checks: JSON.stringify(list), ...(await where(!!s.gps)) })
    onDone(visit.unit)
    return r
  })
  // a "No ..." answer moves on by itself after a moment
  const auto = useRef<number | undefined>(undefined)
  const answer = (setter: (v: boolean) => void, v: boolean, next: () => void) => {
    setter(v)
    window.clearTimeout(auto.current)
    if (v) auto.current = window.setTimeout(next, 450)
  }
  useEffect(() => () => window.clearTimeout(auto.current), [])

  const NextBar = ({ need, onNext, label = "Next · Endelea", wait }: { need: string | null; onNext: () => void; label?: string; wait?: boolean }) => (
    <div className="space-y-2">
      {need && <p className="text-center text-sm text-zinc-500">{need}</p>}
      <Big disabled={busy || saving || !!need || !!wait} onClick={onNext}>
        {wait ? "Wait - sending photos… / Subiri" : <>{label} <ChevronRight className="size-6" /></>}
      </Big>
      {step > 1 && (
        <button type="button" onClick={() => go(step - 1)} className="flex w-full items-center justify-center gap-1 py-2 text-base text-zinc-600">
          <ChevronLeft className="size-5" /> Back · Rudi
        </button>
      )}
    </div>
  )
  const card = "space-y-4 rounded-2xl border border-zinc-200 bg-white p-4"

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl bg-brand-600 p-4 text-white">
        <div>
          <p className="text-sm opacity-90">{visit.task_type} · checked in {hhmm(visit.started_on)}</p>
          <p className="text-xl font-semibold">{visit.unit}</p>
        </div>
        <Progress step={step} />
      </div>

      {step === 1 && (
        <>
          <section className={card}>
            <h2 className="text-xl font-semibold text-zinc-900">Is anything damaged? / Kuna uharibifu?</h2>
            <YesNo none={noDamage} setNone={(v) => answer(setNoDamage, v, () => go(2))} noneLabel="No damage" someLabel="Yes, damage" />
            {noDamage === false && (
              <>
                <textarea value={damage} onChange={(e) => setDamage(e.target.value)} rows={3}
                  placeholder="What is damaged? e.g. bedside lamp broken"
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-lg" />
                <PhotoRow visit={visit} stage="Damage" token={token} setErr={setErr} {...photoProps}
                  label={`Photo of the damage${s.photo_damage ? " (required)" : ""}`} />
              </>
            )}
          </section>
          <NextBar need={need1} onNext={() => go(2)} />
        </>
      )}

      {step === 2 && (
        <>
          <section className={card}>
            <h2 className="text-xl font-semibold text-zinc-900">Did the guest leave anything? / Ameacha kitu?</h2>
            <YesNo none={noLeft} setNone={(v) => answer(setNoLeft, v, () => { if (!sendingRef.current) void saveReport(true) })} noneLabel="Nothing left" someLabel="Yes, items" />
            {noLeft === false && (
              <>
                <textarea value={left} onChange={(e) => setLeft(e.target.value)} rows={2}
                  placeholder="What? e.g. phone charger, black jacket"
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-lg" />
                <PhotoRow visit={visit} stage="Left item" token={token} setErr={setErr} {...photoProps}
                  label={`Photo of the item${s.photo_left ? " (required)" : ""}`} />
              </>
            )}
          </section>
          <NextBar need={need1 || need2} wait={sendingPhotos} onNext={() => void saveReport()} label="Save and clean · Hifadhi" />
        </>
      )}

      {step === 3 && (
        <>
          <section className={card}>
            <h2 className="text-xl font-semibold text-zinc-900">After cleaning, check each one / Orodha</h2>
            {s.checklist.map((it) => {
              const c = checks[it.label] || {}
              return it.kind === "number" ? (
                <label key={it.label} className="block">
                  <span className="mb-1 block text-lg font-medium text-zinc-800">{it.label}</span>
                  <input inputMode="decimal" value={c.value || ""} onChange={(e) => set(it.label, { value: e.target.value })}
                    placeholder="e.g. 34.5" className="min-h-14 w-full rounded-xl border border-zinc-300 px-3 text-xl" />
                </label>
              ) : (
                <div key={it.label} className="space-y-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-lg font-medium text-zinc-800">{it.label}</span>
                    <button type="button" aria-label={`${it.label}: done`} onClick={() => { buzz(20); set(it.label, { ok: 1 }) }}
                      className={`grid h-14 w-16 place-items-center rounded-xl border-2 ${c.ok === 1 ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 bg-white text-zinc-500"}`}>
                      <Check className="size-7" />
                    </button>
                    <button type="button" aria-label={`${it.label}: not done`} onClick={() => set(it.label, { ok: 0 })}
                      className={`grid h-14 w-16 place-items-center rounded-xl border-2 ${c.ok === 0 ? "border-rose-600 bg-rose-600 text-white" : "border-zinc-300 bg-white text-zinc-500"}`}>
                      <X className="size-7" />
                    </button>
                  </div>
                  {c.ok === 0 && (
                    <input value={c.note || ""} onChange={(e) => set(it.label, { note: e.target.value })}
                      placeholder="What is wrong? / Shida ni nini?" className="min-h-12 w-full rounded-xl border border-rose-300 px-3 text-lg" />
                  )}
                </div>
              )
            })}
          </section>
          <NextBar need={need3} onNext={() => go(4)} />
        </>
      )}

      {step === 4 && (
        <>
          <section className={card}>
            <h2 className="text-xl font-semibold text-zinc-900">Photo of the clean room / Picha ya chumba{s.photo_final ? "" : " (if you can)"}</h2>
            <PhotoRow visit={visit} stage="Final" token={token} setErr={setErr} {...photoProps} label="Take the photo" />
          </section>
          <NextBar need={need4} onNext={() => go(5)} />
        </>
      )}

      {step === 5 && (
        <>
          <section className={card}>
            <h2 className="text-xl font-semibold text-zinc-900">Check and finish / Hakiki na umalize</h2>
            <ul className="space-y-2 text-base text-zinc-800">
              <li className="flex gap-2">{noDamage ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-rose-600" />}
                {noDamage ? "No damage" : `Damage: ${damage}`}</li>
              <li className="flex gap-2">{noLeft ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-amber-600" />}
                {noLeft ? "Nothing left by the guest" : `Left: ${left}`}</li>
              {s.checklist.map((it) => {
                const c = checks[it.label] || {}
                const ok = it.kind === "number" ? !!(c.value || "").trim() : c.ok === 1
                return (
                  <li key={it.label} className="flex gap-2">
                    {ok ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-rose-600" />}
                    {it.label}{it.kind === "number" && c.value ? `: ${c.value}` : ""}{c.ok === 0 && c.note ? ` - ${c.note}` : ""}
                  </li>
                )
              })}
              <li className="flex gap-2"><Camera className="size-5 shrink-0 text-zinc-500" /> {visit.photos.length} photo(s)</li>
            </ul>
          </section>
          <div className="space-y-2">
            <Big disabled={busy || sendingPhotos} onClick={() => void finish()}>
              <Check className="size-6" /> {sendingPhotos ? "Wait - sending photos… / Subiri" : "Finish · Nimemaliza"}
            </Big>
            <button type="button" onClick={() => go(4)} className="flex w-full items-center justify-center gap-1 py-2 text-base text-zinc-600">
              <ChevronLeft className="size-5" /> Back · Rudi
            </button>
          </div>
          {s.gps ? <p className="flex items-center justify-center gap-1 text-sm text-zinc-500"><MapPin className="size-4" /> Your location is recorded at check-in and finish.</p> : null}
        </>
      )}
    </div>
  )
}

function DoneScreen({ unit, onClose }: { unit: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [onClose])
  return (
    <button type="button" onClick={onClose} className="flex w-full flex-col items-center gap-4 py-16 text-center">
      <span className="grid size-24 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-14" /></span>
      <span className="text-2xl font-semibold text-zinc-900">Well done! / Kazi nzuri!</span>
      <span className="text-lg text-zinc-600">{unit} is clean.</span>
      <span className="text-base text-zinc-500">Back to your list…</span>
    </button>
  )
}

/** The page opened in the phone's browser: install it as the "Cleaning" app
 *  first - it opens straight on this screen, full screen, and the phone
 *  keeps it open better while the camera is used. */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
declare global { interface Window { __ctInstall?: BIPEvent | null } }

function InstallGate({ onContinue }: { onContinue: () => void }) {
  const [prompt, setPrompt] = useState<BIPEvent | null>(() => window.__ctInstall || null)
  const [installed, setInstalled] = useState(false)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    document.title = "Cleaning"
    const got = (e: Event) => { e.preventDefault(); window.__ctInstall = e as BIPEvent; setPrompt(e as BIPEvent) }
    const done = () => setInstalled(true)
    window.addEventListener("beforeinstallprompt", got)
    window.addEventListener("appinstalled", done)
    const t = setTimeout(() => setWaited(true), 5000)
    return () => { window.removeEventListener("beforeinstallprompt", got); window.removeEventListener("appinstalled", done); clearTimeout(t) }
  }, [])
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const skip = () => { try { sessionStorage.setItem(SKIP_INSTALL_KEY, "1") } catch { /* private */ } onContinue() }
  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    const r = await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const }))
    window.__ctInstall = null
    setPrompt(null)
    if (r.outcome === "accepted") setInstalled(true)
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 bg-zinc-50 px-6 text-center">
      <img src="/assets/kamra/frontend/clean-192.png" alt="" className="mx-auto size-24 rounded-3xl shadow" />
      {installed ? (
        <>
          <h1 className="text-2xl font-semibold text-zinc-900">Installed! / Imewekwa!</h1>
          <p className="text-lg text-zinc-700">Close this page. Open <b>Cleaning</b> from your phone's home screen.</p>
          <p className="text-base text-zinc-500">Funga ukurasa huu. Fungua <b>Cleaning</b> kwenye skrini ya simu.</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-zinc-900">Put the Cleaning app on your phone</h1>
          <p className="text-lg text-zinc-700">One tap. It opens straight to your work, like WhatsApp. / Weka app kwenye simu yako.</p>
          {prompt ? (
            <Big onClick={() => void install()}><Download className="size-6" /> Install · Weka app</Big>
          ) : ios ? (
            <ol className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-start text-base text-zinc-800">
              <li>1. Tap <Share className="inline size-5 align-text-bottom text-brand-700" /> <b>Share</b> at the bottom of Safari.</li>
              <li>2. Tap <b>Add to Home Screen</b>.</li>
              <li>3. Tap <b>Add</b>, then open <b>Cleaning</b> from your home screen.</li>
            </ol>
          ) : waited ? (
            <ol className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-start text-base text-zinc-800">
              <li>1. Open this link in <b>Chrome</b>.</li>
              <li>2. Tap <MoreVertical className="inline size-5 align-text-bottom text-brand-700" /> at the top right.</li>
              <li>3. Tap <b>Install app</b> or <b>Add to Home screen</b>, then open <b>Cleaning</b> from your home screen.</li>
            </ol>
          ) : (
            <p className="text-base text-zinc-500">Getting ready… / Inaandaa…</p>
          )}
        </>
      )}
      {(installed || ios || waited) && (
        <button type="button" onClick={skip} className="py-2 text-sm text-zinc-500 underline">
          {installed ? "Continue here instead" : "I can't install - continue in the browser"}
        </button>
      )}
    </div>
  )
}
