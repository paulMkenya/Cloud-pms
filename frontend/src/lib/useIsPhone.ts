import { useEffect, useState } from "react"

/** True below Tailwind's sm breakpoint (640px): the layouts that turn
 *  tables into cards and move toolbars into panels follow this. */
const QUERY = "(max-width: 639px)"

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() =>
    typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return phone
}
