import { useEffect, useState } from "react"

/** A guest / pet count the guest can type freely: the box may be emptied
 *  and retyped ("2" -> "" -> "6", not "26" or "16"); the number is passed on
 *  as soon as it is valid, and an empty or too-small box settles to `min`
 *  when the guest leaves it. A numeric keypad on phones, no spinner. */
export default function CountInput({
  value,
  min = 0,
  max = 99,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: number
  min?: number
  max?: number
  onChange: (n: number) => void
  className?: string
  "aria-label"?: string
}) {
  const [draft, setDraft] = useState(String(value))
  // follow outside changes (a link, a reset) without fighting the typing
  useEffect(() => {
    setDraft((d) => (d === "" || Number(d) !== value ? String(value) : d))
  }, [value])
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      aria-label={ariaLabel}
      className={className}
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, String(max).length)
        setDraft(v)
        if (v !== "" && Number(v) >= min && Number(v) <= max) onChange(Number(v))
      }}
      onBlur={() => {
        const n = draft === "" ? min : Math.min(max, Math.max(min, Number(draft)))
        setDraft(String(n))
        if (n !== value) onChange(n)
      }}
    />
  )
}
