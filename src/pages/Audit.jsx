import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, downloadBlob, fetchBlob, fetchJson, filenameFromDisposition, API_BASE } from '../api.js'
import { fmtNum } from '../utils.js'

// How often to poll a running lookup job.
const POLL_MS = 3000
// No batch finished after this long usually means no Temporal worker is running.
const STALL_MS = 60_000

const STATUS = {
  attention: { label: 'Needs attention', badge: 'bg-rose-100 text-rose-700', text: 'text-rose-700' },
  clear: { label: 'Clear', badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700' },
  no_data: { label: 'No dimensions', badge: 'bg-amber-100 text-amber-700', text: 'text-amber-700' },
  not_found: { label: 'Not in system', badge: 'bg-slate-200 text-slate-700', text: 'text-slate-700' },
}

function Tile({ label, value, sub, tone = 'text-slate-900', active, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`bg-white border rounded-lg p-3 text-left ${active ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200'} ${onClick ? 'hover:border-slate-300' : ''}`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${tone}`}>{fmtNum(value)}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </Tag>
  )
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : '—'
}

export default function Audit() {
  const [file, setFile] = useState(null)
  const [connoteCol, setConnoteCol] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [err, setErr] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [drag, setDrag] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [lookup, setLookup] = useState(null) // job progress, see lookupMissing
  const unmounted = useRef(false)
  useEffect(() => () => { unmounted.current = true }, [])

  const qs = (extra = {}) => {
    const p = new URLSearchParams(extra)
    if (connoteCol) p.set('connote_column', connoteCol)
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  const upload = () => {
    const body = new FormData()
    body.append('file', file)
    return { method: 'POST', body }
  }

  const onFile = (f) => {
    setErr(''); setAnalysis(null); setLookup(null); setStatusFilter(''); setSearch('')
    if (!f) return setFile(null)
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setErr('Please upload a .csv file.')
      return
    }
    setFile(f)
  }

  const analyse = async () => {
    if (!file) return
    setBusy(true); setErr('')
    try {
      setAnalysis(await fetchJson(`/api/report/tnt-analysis${qs({ format: 'json' })}`, upload()))
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const download = async () => {
    setDownloading(true); setErr('')
    try {
      const { blob, headers } = await fetchBlob(`/api/report/tnt-analysis${qs()}`, upload())
      downloadBlob(blob, filenameFromDisposition(headers.get('content-disposition'), 'tnt-analysis.xlsx'))
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally { setDownloading(false) }
  }

  const missing = useMemo(
    () => (analysis?.entries || []).filter(e => e.status === 'not_found').map(e => e.connote),
    [analysis],
  )

  // Missing connotes are looked up by Temporal workers: the backend splits them
  // into batches of 10 and starts one workflow per batch; we poll the job.
  const lookupMissing = async () => {
    if (!missing.length) return
    setErr('')
    let job
    try {
      job = await fetchJson('/api/orders/find-batches', {
        method: 'POST',
        body: JSON.stringify({ references: missing }),
      })
    } catch (e) {
      setErr(`Could not start the lookup: ${e instanceof ApiError ? e.message : String(e)}`)
      return
    }
    const batchRefs = Object.fromEntries(job.batches.map(b => [b.index, b.references.length]))
    const started = Date.now()
    setLookup({
      jobId: job.job_id, total: job.references, batchesTotal: job.batches.length,
      batchesDone: 0, done: 0, found: 0, failed: 0, results: {}, skipped: {},
      running: true, started, polledAt: started,
    })
    try {
      while (!unmounted.current) {
        await new Promise(r => setTimeout(r, POLL_MS))
        const st = await fetchJson(`/api/orders/find-batches/${job.job_id}`)
        const results = {}
        let skipped = {}
        for (const x of st.results) {
          results[x.reference.toUpperCase()] = x
          skipped = { ...skipped, ...(x.skipped_tenants || {}) }
        }
        const finished = st.batches.filter(b => b.status !== 'running')
        setLookup(l => ({
          ...l,
          results, skipped,
          batchesDone: finished.length,
          done: finished.reduce((n, b) => n + batchRefs[b.index], 0),
          found: st.found,
          failed: finished.filter(b => b.status !== 'completed').length,
          stopped: finished.some(b => b.status === 'terminated'),
          polledAt: Date.now(),
        }))
        if (st.done) break
      }
    } catch (e) {
      setErr(`Lost track of the lookup: ${e instanceof ApiError ? e.message : String(e)}`)
    } finally {
      setLookup(l => ({ ...l, running: false }))
      // Re-run the analysis so newly stored orders get their verdicts.
      if (!unmounted.current) await analyse()
    }
  }

  const stopLookup = async () => {
    try {
      await fetchJson(`/api/orders/find-batches/${lookup.jobId}`, { method: 'DELETE' })
    } catch (e) {
      setErr(`Could not stop the lookup: ${e instanceof ApiError ? e.message : String(e)}`)
    }
  }

  const entries = useMemo(() => {
    const q = search.trim().toUpperCase()
    return (analysis?.entries || []).filter(e =>
      (!statusFilter || e.status === statusFilter) &&
      (!q || e.connote.includes(q) || e.orders.some(o => (o.order_number || '').toUpperCase().includes(q))),
    )
  }, [analysis, statusFilter, search])

  const a = analysis
  const st = a?.connotes_by_status
  const reasons = a ? Object.entries(a.attention_by_reason) : []
  const maxReason = Math.max(1, ...reasons.map(([, n]) => n))
  const toggle = (s) => setStatusFilter(f => (f === s ? '' : s))

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Carrier invoice audit</h1>
        <p className="text-sm text-slate-500">Upload a carrier CSV (TNT, StarTrack, …), review the analysis, then download the annotated .xlsx.</p>
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-4 max-w-4xl">
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]) }}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition ${
            drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'
          }`}
        >
          <div className="text-slate-600 mb-2">Drop a .csv here, or</div>
          <label className="inline-block cursor-pointer text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
            Choose file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          </label>
          {file && <div className="mt-3 text-sm text-slate-700">Selected: <span className="font-mono">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)</div>}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm text-slate-700 mb-1">Connote column <span className="text-slate-400">(default: Connote)</span></label>
            <input
              value={connoteCol}
              onChange={e => setConnoteCol(e.target.value)}
              placeholder="Connote"
              className="w-full text-sm border border-slate-200 rounded px-3 py-1.5"
            />
          </div>
          <button
            onClick={analyse}
            disabled={!file || busy || lookup?.running}
            className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Analysing…' : analysis ? 'Re-analyse' : 'Analyse'}
          </button>
          <button
            onClick={download}
            disabled={!analysis || downloading}
            className="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download result (.xlsx)'}
          </button>
          <span className="text-xs text-slate-400">Max 32 MB, max 20 000 rows.</span>
        </div>
      </div>

      {err && <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded p-3 text-sm">{err}</div>}

      {a && (
        <div className="mt-6 space-y-4">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Tile label="Invoice rows" value={a.rows} sub={a.blank_connote_rows ? `${a.blank_connote_rows} without connote` : null} />
            <Tile label="Unique connotes" value={a.connotes} active={statusFilter === ''} onClick={() => setStatusFilter('')} />
            <Tile label="In system" value={a.matched} sub={pct(a.matched, a.connotes)} />
            <Tile label="Needs attention" value={st.attention} sub={pct(st.attention, a.connotes)} tone={STATUS.attention.text} active={statusFilter === 'attention'} onClick={() => toggle('attention')} />
            <Tile label="Clear" value={st.clear} sub={pct(st.clear, a.connotes)} tone={STATUS.clear.text} active={statusFilter === 'clear'} onClick={() => toggle('clear')} />
            <Tile label="No dimensions" value={st.no_data} sub={pct(st.no_data, a.connotes)} tone={STATUS.no_data.text} active={statusFilter === 'no_data'} onClick={() => toggle('no_data')} />
            <Tile label="Not in system" value={st.not_found} sub={pct(st.not_found, a.connotes)} active={statusFilter === 'not_found'} onClick={() => toggle('not_found')} />
            <Tile label="Total cartons" value={a.total_cartons} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Why consignments were flagged */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-slate-900 mb-1">Why consignments need attention</div>
              <div className="text-xs text-slate-500 mb-3">Thresholds broken by the first offending product (a consignment can break several).</div>
              {st.attention === 0 ? (
                <div className="text-sm text-slate-400">No consignment breaks a threshold.</div>
              ) : (
                <div className="space-y-2">
                  {reasons.map(([reason, n]) => (
                    <div key={reason} className="text-sm">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-slate-700">{reason}</span>
                        <span className="font-medium text-slate-900">{fmtNum(n)}</span>
                      </div>
                      <div className="h-2 rounded bg-slate-100">
                        <div className="h-2 rounded bg-rose-500" style={{ width: `${(n / maxReason) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Orders missing from the database */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-slate-900 mb-1">Connotes not in the system</div>
              <div className="text-xs text-slate-500 mb-3">
                These are in your upload but not in the scraped orders, so they can't be checked yet. Look them up in Ouvar to pull them in, then the analysis re-runs automatically.
              </div>
              {missing.length === 0 && !lookup && (
                <div className="text-sm text-emerald-700">Every connote in the file is in the system.</div>
              )}
              {missing.length > 0 && !lookup?.running && (
                <button
                  onClick={lookupMissing}
                  disabled={busy}
                  className="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Look up {fmtNum(missing.length)} missing order{missing.length === 1 ? '' : 's'} in Ouvar
                </button>
              )}
              {missing.length > 0 && !lookup && (
                <div className="mt-2 text-xs text-slate-400">Runs on the Temporal workers in batches of 10 connotes, in parallel across workers.</div>
              )}
              {lookup && (
                <div className="mt-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-700">
                      {lookup.running ? 'Searching Ouvar…' : lookup.stopped ? 'Lookup stopped' : 'Lookup finished'}
                      {' '}{fmtNum(lookup.done)} / {fmtNum(lookup.total)}
                      <span className="text-slate-400"> · batch {fmtNum(lookup.batchesDone)} / {fmtNum(lookup.batchesTotal)}</span>
                    </span>
                    <span className="text-emerald-700 font-medium">{fmtNum(lookup.found)} found</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-indigo-500 transition-all" style={{ width: `${(lookup.done / lookup.total) * 100}%` }} />
                  </div>
                  {lookup.running && (
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <button onClick={stopLookup} className="text-slate-500 underline hover:text-slate-800">Stop</button>
                      <span className="text-slate-400 font-mono" title="Temporal workflow ids: find-orders-<job>-<batch>">job {lookup.jobId}</span>
                    </div>
                  )}
                  {lookup.running && lookup.batchesDone === 0 && lookup.polledAt - lookup.started > STALL_MS && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                      No batch has finished yet. If this doesn't move, check that a Temporal worker is running.
                    </div>
                  )}
                  {lookup.failed > 0 && !lookup.stopped && (
                    <div className="mt-2 text-xs text-rose-700">{fmtNum(lookup.failed)} batch(es) failed -- see the Temporal UI.</div>
                  )}
                  {!lookup.running && Object.keys(lookup.results).length > lookup.found && (
                    <div className="mt-2 text-xs text-slate-500">
                      {fmtNum(Object.keys(lookup.results).length - lookup.found)} connote(s) were not found in any tenant's Ouvar.
                    </div>
                  )}
                  {Object.keys(lookup.skipped).length > 0 && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                      Tenants not searched: {Object.entries(lookup.skipped).map(([t, r]) => `${t} (${r})`).join('; ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Per-connote detail */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-900 mr-2">Consignments</div>
              {['', ...Object.keys(STATUS)].map(s => (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1 rounded-full border ${statusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  {s ? STATUS[s].label : 'All'} ({fmtNum(s ? st[s] : a.connotes)})
                </button>
              ))}
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search connote / order #"
                className="ml-auto text-sm border border-slate-200 rounded px-3 py-1 w-56"
              />
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">Connote</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Order(s)</th>
                    <th className="px-3 py-2 text-right">Invoice rows</th>
                    <th className="px-3 py-2 text-right"># Carton</th>
                    <th className="px-3 py-2 text-right">Chargeable kg</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-slate-400">No consignments match.</td></tr>
                  )}
                  {entries.map(e => {
                    const lk = lookup?.results[e.connote]
                    return (
                      <tr key={e.connote} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs">{e.connote}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${STATUS[e.status].badge}`}>{STATUS[e.status].label}</span>
                          {e.status === 'not_found' && lk && !lk.found && (
                            <div className="text-[11px] text-slate-400 mt-0.5" title={(lk.warnings || []).join('\n')}>not found in Ouvar</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {e.orders.length === 0 ? '—' : e.orders.map(o => (
                            <div key={`${o.tenant}-${o.order_number}`}>
                              <span className="font-mono text-slate-500">{o.tenant}</span> {o.order_number}
                              <span className="text-slate-400"> · {o.items} item{o.items === 1 ? '' : 's'}</span>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(e.invoice_rows)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(e.cartons)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(e.measures?.chargeable_kg, 2)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{e.reason || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 text-xs text-slate-400">
        Backend: <span className="font-mono">{API_BASE}</span>
      </div>
    </div>
  )
}
