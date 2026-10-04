import { useEffect, useState } from 'react'
import { fetchJson } from '../api.js'

export default function Lookup() {
  const [tenantsMeta, setTenantsMeta] = useState([])
  const [refsText, setRefsText] = useState('')
  const [tenants, setTenants] = useState([])
  const [allTenants, setAllTenants] = useState(false)
  const [refreshProducts, setRefreshProducts] = useState(false)
  const [limit, setLimit] = useState(10)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    fetchJson('/api/report/filters').then(d => setTenantsMeta(d.tenants || [])).catch(() => {})
  }, [])

  const submit = async () => {
    const references = refsText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (references.length === 0) { setErr('Paste at least one reference.'); return }
    if (references.length > 200) { setErr('Max 200 references per request.'); return }
    setBusy(true); setErr(''); setResult(null)
    try {
      const r = await fetchJson('/api/orders/find', {
        method: 'POST',
        body: JSON.stringify({
          references,
          tenants: tenants.length ? tenants : undefined,
          all_tenants: allTenants,
          refresh_products: refreshProducts,
          limit,
        }),
      })
      setResult(r)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Order lookup</h1>
        <p className="text-sm text-slate-500">Paste connotes / tracking references and pull them in from Ouvar without a full tenant scrape.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-3xl">
        <label className="block text-sm text-slate-700 mb-1">References (one per line, or comma-separated)</label>
        <textarea
          value={refsText}
          onChange={e => setRefsText(e.target.value)}
          rows={6}
          className="w-full text-sm font-mono border border-slate-200 rounded px-3 py-2"
          placeholder="RKV100021801&#10;RKU100045832"
        />
        <div className="mt-3 flex flex-wrap gap-3 items-center text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-1">Tenants (empty = all)</div>
            <div className="flex flex-wrap gap-2">
              {tenantsMeta.map(t => {
                const active = tenants.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTenants(active ? tenants.filter(x => x !== t) : [...tenants, t])}
                    className={`text-xs px-2 py-1 rounded border ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allTenants} onChange={e => setAllTenants(e.target.checked)} />
            Don't stop at first hit
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={refreshProducts} onChange={e => setRefreshProducts(e.target.checked)} />
            Refresh product details
          </label>
          <label className="flex items-center gap-2">
            Limit per tenant
            <input type="number" min={1} max={50} value={limit} onChange={e => setLimit(+e.target.value)} className="w-20 border rounded px-2 py-1" />
          </label>
        </div>
        <div className="mt-4">
          <button
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? 'Searching…' : 'Find orders'}
          </button>
        </div>
      </div>

      {err && <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded p-3 text-sm">{err}</div>}

      {result && (
        <div className="mt-5">
          <div className="text-sm text-slate-700 mb-3">
            Searched <b>{result.searched}</b>, found <b>{result.found}</b>, stored <b>{result.orders_stored}</b>.
            {result.not_found?.length > 0 && (
              <span className="text-rose-600 ml-2">Not found: {result.not_found.join(', ')}</span>
            )}
          </div>
          {Object.keys(result.skipped_tenants || {}).length > 0 && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
              Skipped tenants: {Object.entries(result.skipped_tenants).map(([t, r]) => `${t}: ${r}`).join('; ')}
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Tenant</th>
                  <th className="px-3 py-2">Order #</th>
                  <th className="px-3 py-2">Tracking #</th>
                  <th className="px-3 py-2">Items</th>
                  <th className="px-3 py-2">Products</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => {
                  if (!r.found) {
                    return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono">{r.reference}</td>
                        <td className="px-3 py-2 text-rose-700">Not found</td>
                        <td className="px-3 py-2 text-xs text-slate-500" colSpan={5}>
                          {(r.warnings || []).join('; ')}
                        </td>
                      </tr>
                    )
                  }
                  return (r.orders || []).map((o, j) => (
                    <tr key={`${i}-${j}`} className="border-t border-slate-100">
                      {j === 0 && <td className="px-3 py-2 font-mono" rowSpan={r.orders.length}>{r.reference}</td>}
                      {j === 0 && <td className="px-3 py-2 text-emerald-700" rowSpan={r.orders.length}>Found</td>}
                      <td className="px-3 py-2 font-mono text-xs">{o.tenant}</td>
                      <td className="px-3 py-2">{o.order_number}</td>
                      <td className="px-3 py-2 font-mono text-xs">{o.tracking_number}</td>
                      <td className="px-3 py-2">{o.items_saved}</td>
                      <td className="px-3 py-2">{o.products_saved}</td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
