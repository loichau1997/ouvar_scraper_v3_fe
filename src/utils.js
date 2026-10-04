export function relTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const ms = Date.now() - d.getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export function fmtNum(n, dp = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtDuration(sec) {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}
