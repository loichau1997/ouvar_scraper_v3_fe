const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const KEY = import.meta.env.VITE_API_KEY || ''

function headers(extra = {}) {
  const h = { ...extra }
  if (KEY) h['X-API-Key'] = KEY
  return h
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function fetchJson(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: headers({
      // FormData sets its own multipart Content-Type (with boundary).
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(opts.headers || {}),
    }),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`
    throw new ApiError(msg, res.status, data)
  }
  return data
}

export async function fetchBlob(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res = await fetch(url, { ...opts, headers: headers(opts.headers || {}) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let body = null
    try { body = JSON.parse(text) } catch { body = text }
    const msg = (body && body.error) || `HTTP ${res.status}`
    throw new ApiError(msg, res.status, body)
  }
  const blob = await res.blob()
  return { blob, headers: res.headers }
}

export function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function filenameFromDisposition(cd, fallback) {
  if (!cd) return fallback
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  return m ? decodeURIComponent(m[1]) : fallback
}

export function buildQuery(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    if (Array.isArray(v)) q.set(k, v.join(','))
    else if (typeof v === 'boolean') { if (v) q.set(k, '1') }
    else q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const API_BASE = BASE
