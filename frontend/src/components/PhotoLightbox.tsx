import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useT, t as translate } from "../lib/i18n"

export interface Photo {
  url: string
  caption: string | null
}

/** Full-screen photo viewer. A native <dialog> gives focus trapping and
 *  Escape for free. Shared by the booking engine and listing pages. */
export default function PhotoLightbox({ photos, start, title, onClose }: {
  photos: Photo[]
  start: number
  title: string
  onClose: () => void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [i, setI] = useState(start)
  const n = photos.length
  const go = (d: number) => setI((x) => (x + d + n) % n)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const photo = photos[i]
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      onKeyDown={(e) => {
        const rtl = document.documentElement.dir === "rtl"
        if (e.key === "ArrowRight") go(rtl ? -1 : 1)
        if (e.key === "ArrowLeft") go(rtl ? 1 : -1)
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-zinc-950 p-0 text-white backdrop:bg-black/90"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium">{title}</span>
            <span className="ms-2 tabular-nums text-white/60">{i + 1} / {n}</span>
          </p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded-full p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            aria-label={t("Close")}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
          <img src={photo.url} alt={photo.caption ? translate(photo.caption) : ""} className="max-h-full max-w-full rounded-lg object-contain" />
          {n > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label={t("Previous photo")}
                className="absolute start-2 rounded-full bg-white/10 p-2.5 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white sm:start-4">
                <ChevronLeft className="size-6 rtl:rotate-180" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label={t("Next photo")}
                className="absolute end-2 rounded-full bg-white/10 p-2.5 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white sm:end-4">
                <ChevronRight className="size-6 rtl:rotate-180" />
              </button>
            </>
          )}
        </div>
        <p className="h-8 px-4 pt-2 text-center text-sm text-white/70">{photo.caption ? translate(photo.caption) : ""}</p>
        {n > 1 && (
          <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4">
            {photos.map((ph, k) => (
              <button key={ph.url + k} type="button" onClick={() => setI(k)}
                aria-label={t("Photo {n}", { n: k + 1 })}
                aria-current={k === i}
                className={"h-14 w-20 shrink-0 overflow-hidden rounded-md ring-2 transition " +
                  (k === i ? "ring-white" : "opacity-50 ring-transparent hover:opacity-100")}>
                <img src={ph.url} alt="" className="size-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  )
}
