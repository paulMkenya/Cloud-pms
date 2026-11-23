/** Phone cards for list tables (index.css, table.m-cards): each cell gets
 *  its column's header text as data-label, so a row can show "Guest: Kamau"
 *  without the header row. Watches the page, so tables that load or
 *  re-render later are labelled too. Started once by the app shell. */
export function startTableCards(): () => void {
  let queued = 0
  const label = () => {
    queued = 0
    document.querySelectorAll<HTMLTableElement>("table.m-cards").forEach((tb) => {
      const headRow = tb.tHead?.rows[tb.tHead.rows.length - 1]
      const heads: string[] = []
      if (headRow)
        for (const th of Array.from(headRow.cells))
          for (let k = 0; k < (th.colSpan || 1); k++) heads.push((th.textContent || "").trim())
      const rows = [...Array.from(tb.tBodies).flatMap((b) => Array.from(b.rows)),
                    ...(tb.tFoot ? Array.from(tb.tFoot.rows) : [])]
      for (const tr of rows) {
        let i = 0
        for (const cell of Array.from(tr.cells)) {
          const want = (cell.colSpan || 1) > 1 && i === 0 && tr.cells.length === 1 ? "" : heads[i] || ""
          if (cell.getAttribute("data-label") !== want) cell.setAttribute("data-label", want)
          i += cell.colSpan || 1
        }
      }
    })
  }
  const mo = new MutationObserver(() => {
    if (!queued) queued = window.requestAnimationFrame(label)
  })
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  label()
  return () => {
    mo.disconnect()
    if (queued) window.cancelAnimationFrame(queued)
  }
}
