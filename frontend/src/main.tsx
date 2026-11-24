import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "./index.css"

// A tab opened before a deploy can ask for a screen chunk that no longer
// exists. Reload once to pick up the new build instead of a dead screen.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const key = "kamra_chunk_reload"
    const last = Number(sessionStorage.getItem(key) || 0)
    if (Date.now() - last > 60_000) {
      sessionStorage.setItem(key, String(Date.now()))
      event.preventDefault()
      window.location.reload()
    }
  } catch {
    window.location.reload()
  }
})
// The cleaning app (/clean) shows its own Install button: keep the
// browser's install offer for it, even if it comes before that screen loads.
if (/^\/kamra\/clean\/?$/.test(location.pathname)) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    ;(window as unknown as { __ctInstall?: Event }).__ctInstall = e
  })
}
import App from "./App"
import { initTheme } from "./lib/theme"
import { initLang } from "./lib/dir"
import { setLabelOverrides } from "./lib/i18n"
import { uiLabels } from "./lib/api"
import { asset } from "./lib/asset"
import { AuthProvider } from "./lib/auth"
import { CashierAuthProvider } from "./lib/cashierAuth"
import { ROUTER_BASENAME } from "./lib/routing"

initTheme()

// Favicons, base-aware (see index.html note).
function setIcon(rel: string, href: string, type?: string) {
  const link = document.createElement("link")
  link.rel = rel
  link.href = asset(href)
  if (type) link.type = type
  document.head.appendChild(link)
}
setIcon("icon", "kamra-mark.svg", "image/svg+xml")
setIcon("icon", "favicon-32.png", "image/png")
// the cleaning app (/clean) brings its own home-screen icon from the server
if (!/^\/kamra\/clean\/?$/.test(location.pathname)) setIcon("apple-touch-icon", "apple-touch-180.png")

// Offline (#228): the service worker keeps the app shell and built files
// (kamra/www/kamra-sw.min.js, served at the site root so it may control
// /kamra). Production only; the dev server has no /kamra.
function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
  if (!location.pathname.startsWith("/kamra")) return
  navigator.serviceWorker.register("/kamra-sw.min.js", { scope: "/kamra" })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      const loaded = performance.getEntriesByType("resource").map((e) => e.name)
      reg.active?.postMessage({ cache: loaded })
    })
    .catch(() => undefined) // offline support is a bonus, never a blocker
}
registerServiceWorker()

function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <AuthProvider>
          <CashierAuthProvider>
            <App />
          </CashierAuthProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}

// Wait for the active locale chunk so the first paint is already
// translated; English skips the network round-trip. Tenant label overrides
// ride along - a site without them gets an empty map and changes nothing.
void Promise.all([
  initLang(),
  uiLabels()
    .then((map) => {
      setLabelOverrides(map)
      window.dispatchEvent(new Event("kamra:lang"))
    })
    .catch(() => {}),
]).then(mount)
