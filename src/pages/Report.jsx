import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildQuery, downloadBlob, fetchBlob, fetchJson, filenameFromDisposition } from '../api.js'
import { fmtDate, fmtNum } from '../utils.js'

const SORTABLE = {
  tenant: 'Tenant',
  order_number: 'Order #',
  store_name: 'Store',
  segment: 'Segment',
  tracking_number: 'Tracking #',
  created_date: 'Created',
  product_code: 'Product code',
  product_name: 'Product name',
  quantity: 'Qty',
  uom_name: 'UoM',
  length: 'L',
  width: 'W',
  height: 'H',
  weight: 'Weight',
  diagonal_length_mm: 'Diagonal',
  chargeable_kg: 'Chargeable',
}

function MultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (o) => {
    const next = value.includes(o) ? value.filter(x => x !== o) : [...value, o]
    onChange(next)
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-sm border border-slate-200 rounded px-3 py-1.5 bg-white hover:bg-slate-50 min-w-[140px] text-left"
      >
        <span className="text-slate-500">{label}:</span>{' '}
        <span className="font-medium">{value.length ? `${value.length} selected` : 'All'}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-slate-200 rounded shadow-lg min-w-[200px] max-h-72 overflow-y-auto">
          {options.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No options</div>}
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ))}
          {value.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-500 border-t border-slate-100 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children, tone = 'indigo' }) {
  const tones = {
    indigo: active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
    rose: active ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
    amber: active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
  }
  return (
    <button type="button" onClick={onClick} className={`text-xs px-3 py-1.5 rounded-full border transition ${tones[tone]}`}>
      {children}
    </button>
  )
}

function Tile({ label, value, active, onClick, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900',
    rose: 'text-rose-700',
    amber: 'text-amber-700',
    indigo: 'text-indigo-700',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white border rounded-lg p-3 text-left transition ${active ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${tones[tone]}`}>{fmtNum(value)}</div>
    </button>
  )
}

function Flag({ v, label }) {
  if (v === true) return <span title={label} className="inline-block w-2 h-2 rounded-full bg-rose-500" />
  if (v === false) return <span title={`${label}: ok`} className="inline-block w-2 h-2 rounded-full bg-slate-200" />
  return <span title="Not enough data to check" className="inline-block w-2 h-2 rounded-full bg-transparent border border-slate-300" />
}

const EMPTY_FILTERS = {
  search: '',
  tenant: [],
  store_name: [],
  segment: [],
  date_from: '',
  date_to: '',
  missing_dimensions: false,
  has_stock_line: false,
  size_issue: false,
  weight_issue: false,
}

export default function Report() {
  const [filtersMeta, setFiltersMeta] = useState({ tenants: [], stores: [], segments: [], date_range: {} })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState('created_date')
  const [direction, setDirection] = useState('desc')
  const [limit, setLimit] = useState(100)
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchJson('/api/report/filters').then(setFiltersMeta).catch(e => setErr(e.message))
  }, [])

  const query = useMemo(() => ({
    ...filters,
    sort, direction, limit, offset,
  }), [filters, sort, direction, limit, offset])

  const fetchRows = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const d = await fetchJson(`/api/report/stock-lines${buildQuery(query)}`)
      setData(d)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [query])

  // debounce
  useEffect(() => {
    const t = setTimeout(fetchRows, 250)
    return () => clearTimeout(t)
  }, [fetchRows])

  const setF = (patch) => { setFilters(f => ({ ...f, ...patch })); setOffset(0) }

  const onSort = (key) => {
    if (sort === key) setDirection(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setDirection('desc') }
    setOffset(0)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { blob, headers } = await fetchBlob(`/api/report/stock-lines.csv${buildQuery({ ...filters, sort, direction })}`)
      const name = filenameFromDisposition(headers.get('content-disposition'), 'ouvar-stock-lines.csv')
      downloadBlob(blob, name)
      if (headers.get('x-row-cap-hit')) {
        alert(`Export truncated at ${headers.get('x-row-cap')} rows (total matched: ${headers.get('x-total-rows')}).`)
      }
    } catch (e) { setErr(e.message) }
    finally { setExporting(false) }
  }

  const s = data?.summary

  return (
    <div>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Freight report</h1>
          <p className="text-sm text-slate-500">Joined order / item / product / stock-line view with derived flags.</p>
        </div>
        <button
          disabled={exporting}
          onClick={exportCsv}
          className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 sticky top-14 z-30">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={filters.search}
            onChange={e => setF({ search: e.target.value })}
            placeholder="Search order, tracking, product…"
            className="text-sm border border-slate-200 rounded px-3 py-1.5 w-72"
          />
          <MultiSelect label="Tenant" options={filtersMeta.tenants} value={filters.tenant} onChange={v => setF({ tenant: v })} />
          <MultiSelect label="Store" options={filtersMeta.stores} value={filters.store_name} onChange={v => setF({ store_name: v })} />
          <MultiSelect label="Segment" options={filtersMeta.segments} value={filters.segment} onChange={v => setF({ segment: v })} />
          <input
            type="date" value={filters.date_from} onChange={e => setF({ date_from: e.target.value })}
            min={filtersMeta.date_range?.min_date?.slice(0, 10)}
            max={filtersMeta.date_range?.max_date?.slice(0, 10)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5"
          />
          <span className="text-slate-400 text-sm">→</span>
          <input
            type="date" value={filters.date_to} onChange={e => setF({ date_to: e.target.value })}
            min={filtersMeta.date_range?.min_date?.slice(0, 10)}
            max={filtersMeta.date_range?.max_date?.slice(0, 10)}
            className="text-sm border border-slate-200 rounded px-2 py-1.5"
          />
          <Chip active={filters.missing_dimensions} onClick={() => setF({ missing_dimensions: !filters.missing_dimensions })}>Missing dimensions</Chip>
          <Chip active={filters.has_stock_line} onClick={() => setF({ has_stock_line: !filters.has_stock_line })}>Has stock line</Chip>
          <Chip tone="rose" active={filters.size_issue} onClick={() => setF({ size_issue: !filters.size_issue })}>Size issue</Chip>
          <Chip tone="amber" active={filters.weight_issue} onClick={() => setF({ weight_issue: !filters.weight_issue })}>Weight issue</Chip>
          <button
            className="text-xs text-slate-500 underline hover:text-slate-800 ml-auto"
            onClick={() => { setFilters(EMPTY_FILTERS); setOffset(0) }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          <Tile label="Rows" value={s.rows_total} />
          <Tile label="Orders" value={s.orders} />
          <Tile label="Products" value={s.products} />
          <Tile label="Stock lines" value={s.stock_lines} />
          <Tile label="Size issues" value={s.size_issues} tone="rose" active={filters.size_issue} onClick={() => setF({ size_issue: !filters.size_issue })} />
          <Tile label="Weight issues" value={s.weight_issues} tone="amber" active={filters.weight_issue} onClick={() => setF({ weight_issue: !filters.weight_issue })} />
          <Tile label="Incomplete" value={s.incomplete_rows} tone="indigo" active={filters.missing_dimensions} onClick={() => setF({ missing_dimensions: !filters.missing_dimensions })} />
        </div>
      )}

      {err && <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 rounded p-3 text-sm">{err}</div>}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {Object.entries(SORTABLE).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => onSort(key)}
                    className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none"
                  >
                    {label}
                    {sort === key && <span className="ml-1 text-indigo-500">{direction === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
                <th className="px-3 py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={Object.keys(SORTABLE).length + 1} className="p-6 text-center text-slate-400">Loading…</td></tr>
              )}
              {data && data.rows.length === 0 && !loading && (
                <tr><td colSpan={Object.keys(SORTABLE).length + 1} className="p-6 text-center text-slate-400">No rows match these filters.</td></tr>
              )}
              {data?.rows.map(r => (
                <tr key={`${r.order_row_id}-${r.item_row_id}-${r.stock_line_id}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs">{r.tenant}</td>
                  <td className="px-3 py-2">{r.order_number}</td>
                  <td className="px-3 py-2">{r.store_name}</td>
                  <td className="px-3 py-2">{r.segment}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.tracking_number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.created_date)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.product_code}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate" title={r.product_name}>{r.product_name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.quantity)}</td>
                  <td className="px-3 py-2">{r.uom_name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.length)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.width)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.height)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.weight, 2)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.diagonal_length_mm, 1)}</td>
                  <td
                    className="px-3 py-2 text-right"
                    title={r.cubic_volume_m3 !== null ? `Cubic volume: ${fmtNum(r.cubic_volume_m3, 4)} m³` : ''}
                  >
                    {fmtNum(r.chargeable_kg, 2)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Flag v={r.flag_length_out_of_range} label="Length out of range" />
                      <Flag v={r.flag_width_out_of_range} label="Width out of range" />
                      <Flag v={r.flag_height_out_of_range} label="Height out of range" />
                      <Flag v={r.flag_diagonal_over_1200mm} label="Diagonal > 1200mm" />
                      <Flag v={r.flag_weight_out_of_range} label="Weight out of range" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50 text-sm">
            <div className="text-slate-600">
              {fmtNum(offset + 1)}–{fmtNum(Math.min(offset + limit, data.total))} of {fmtNum(data.total)}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Page size</label>
              <select value={limit} onChange={e => { setLimit(+e.target.value); setOffset(0) }} className="text-sm border border-slate-200 rounded px-2 py-1">
                {[25, 50, 100, 250, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="px-2 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-white"
              >Prev</button>
              <button
                disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
                className="px-2 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-white"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
