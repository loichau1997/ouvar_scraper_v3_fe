import { useCallback, useEffect, useState } from 'react'
import { fetchJson, API_BASE } from '../api.js'
import { fmtDuration, fmtNum, relTime } from '../utils.js'

function TokenBadge({ token }) {
  if (!token || !token.stored) {
    return <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Not set</span>
  }
  if (token.expired) {
    return <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Expired</span>
  }
  return <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Live</span>
}

function ScrapeDialog({ tenant, onClose, onSubmit }) {
  const [maxPages, setMaxPages] = useState(10)
  const [pageSize, setPageSize] = useState(10)
  const [startPage, setStartPage] = useState(1)
  const [ignoreKnown, setIgnoreKnown] = useState(false)
  const [refreshProducts, setRefreshProducts] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Scrape {tenant.label}</h3>
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span>Max pages</span>
            <input type="number" min={1} max={50} value={maxPages} onChange={e => setMaxPages(+e.target.value)} className="w-24 border rounded px-2 py-1" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Page size</span>
            <input type="number" min={1} max={100} value={pageSize} onChange={e => setPageSize(+e.target.value)} className="w-24 border rounded px-2 py-1" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Start page</span>
            <input type="number" min={1} value={startPage} onChange={e => setStartPage(+e.target.value)} className="w-24 border rounded px-2 py-1" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ignoreKnown} onChange={e => setIgnoreKnown(e.target.checked)} />
            <span>Ignore known orders (backfill)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={refreshProducts} onChange={e => setRefreshProducts(e.target.checked)} />
            <span>Refresh product details</span>
          </label>
          {err && <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 text-xs">{err}</div>}
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button className="px-3 py-1.5 text-sm rounded border border-slate-200 hover:bg-slate-50" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setErr('')
              try {
                await onSubmit({ max_pages: maxPages, page_size: pageSize, start_page: startPage, ignore_known: ignoreKnown, refresh_products: refreshProducts })
                onClose()
              } catch (e) { setErr(e.message); setBusy(false) }
            }}
          >
            {busy ? 'Submitting…' : 'Start scrape'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TenantCard({ t, onScrape }) {
  const r = t.last_run
  const needsToken = !t.token?.stored || t.token?.expired
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-mono text-slate-500">{t.tenant}</div>
          <div className="text-lg font-semibold">{t.label}</div>
        </div>
        <TokenBadge token={t.token} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <div className="text-slate-500 text-xs">Orders stored</div>
          <div className="font-semibold">{fmtNum(t.orders_stored)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">Products stored</div>
          <div className="font-semibold">{fmtNum(t.products_stored)}</div>
        </div>
      </div>
      <div className="text-xs text-slate-600 border-t border-slate-100 pt-3 mb-3 flex-1">
        {r ? (
          <>
            <div className="flex justify-between mb-1">
              <span>
                Last run
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  r.status === 'success' ? 'bg-emerald-100 text-emerald-700'
                    : r.status === 'failed' ? 'bg-rose-100 text-rose-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>{r.status}</span>
              </span>
              <span className="text-slate-400">{relTime(r.started_at)}</span>
            </div>
            {r.stop_reason_label && <div className="text-slate-500">{r.stop_reason_label}</div>}
            <div className="mt-1 grid grid-cols-3 gap-1 text-[11px]">
              <div><span className="text-slate-400">created</span> {fmtNum(r.orders_created)}</div>
              <div><span className="text-slate-400">updated</span> {fmtNum(r.orders_updated)}</div>
              <div><span className="text-slate-400">products</span> {fmtNum(r.products_saved)}</div>
            </div>
            <div className="text-slate-400 mt-1">duration {fmtDuration(r.duration_seconds)}</div>
          </>
        ) : (
          <div className="italic text-slate-400">No runs yet</div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onScrape(t)}
          disabled={needsToken}
          className="flex-1 px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
          title={needsToken ? 'Token missing or expired' : 'Scrape now'}
        >
          Scrape now
        </button>
        {needsToken && (
          <a
            href={`${API_BASE}/tokens/`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-sm rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
          >
            Re-paste cURL
          </a>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialogTenant, setDialogTenant] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await fetchJson('/api/tenants')
      setData(d)
      setErr('')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [load])

  const submitScrape = async (tenant, body) => {
    const res = await fetchJson(`/api/tenants/${tenant.tenant}/scrape`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    setToast(`Scrape submitted for ${tenant.label} — ${res.workflow_id}`)
    setTimeout(() => setToast(''), 5000)
    load()
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
          <p className="text-sm text-slate-500">Token state, stored counts, and recent scrape activity.</p>
        </div>
        <button className="text-sm px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50" onClick={load}>
          Refresh
        </button>
      </div>

      {err && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 rounded p-3 text-sm">
          {err}
        </div>
      )}
      {loading && !data && <div className="text-slate-500">Loading…</div>}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.tenants.map(t => (
            <TenantCard key={t.tenant} t={t} onScrape={setDialogTenant} />
          ))}
        </div>
      )}

      {dialogTenant && (
        <ScrapeDialog
          tenant={dialogTenant}
          onClose={() => setDialogTenant(null)}
          onSubmit={(body) => submitScrape(dialogTenant, body)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-2 rounded shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
