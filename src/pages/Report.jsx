import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildQuery, downloadBlob, fetchBlob, fetchJson, filenameFromDisposition } from '../api.js'
import { fmtDate, fmtNum } from '../utils.js'

function FlagCell({ v }) {
  if (v === true) return <span className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">FLAG</span>
  if (v === false) return <span className="text-[11px] text-slate-400">OK</span>
  return <span title="Not enough data to check" className="text-slate-300">—</span>
}

const flag = (key, label, rule) => ({ key, label, rule, isFlag: true, align: 'center', render: r => <FlagCell v={r[key]} /> })
const num = (key, label, dp = 0, rule) => ({ key, label, rule, dp, align: 'right', render: r => fmtNum(r[key], dp) })

// Columns totalled on an order's sum row. Dimensions and per-item derived
// measures (diagonal, MHP) are not additive, so they are left blank there.
const SUM_KEYS = new Set(['quantity', 'cartons', 'weight', 'cubic_volume_m3', 'cubic_kg', 'chargeable_kg'])

// Every column is sortable server-side; keys match the backend's SORTABLE map.
const COLUMNS = [
  // order: true -> order-level column, shown once per order (rowSpan over its lines).
  { key: 'tenant', label: 'Tenant', order: true, cls: 'font-mono text-xs' },
  {
    key: 'order_number', label: 'Order #', order: true,
    render: (r, g) => (
      <>
        <div className="font-medium">{r.order_number}</div>
        {g.size > 1 && <div className="text-[10px] text-indigo-500 whitespace-nowrap">{g.size} lines</div>}
      </>
    ),
  },
  { key: 'store_name', label: 'Store', order: true },
  { key: 'segment', label: 'Segment', order: true },
  { key: 'tracking_number', label: 'Tracking #', order: true, cls: 'font-mono text-xs' },
  { key: 'created_date', label: 'Created', order: true, cls: 'whitespace-nowrap', render: r => fmtDate(r.created_date) },
  { key: 'product_code', label: 'Product code', cls: 'font-mono text-xs' },
  { key: 'product_name', label: 'Product name', cls: 'max-w-[260px] truncate', title: r => r.product_name },
  num('quantity', 'Qty'),
  { key: 'uom_name', label: 'UoM' },
  num('cartons', '# Carton', 0, 'Single/Carton = qty · Bundle = qty/50 ↑'),
  num('length', 'L', 0, 'mm'),
  num('width', 'W', 0, 'mm'),
  num('height', 'H', 0, 'mm'),
  num('weight', 'Weight', 2, 'kg'),
  flag('flag_length_out_of_range', 'Length flag', '<200 / >1200 mm'),
  flag('flag_width_out_of_range', 'Width flag', '<100 / >500 mm'),
  flag('flag_height_out_of_range', 'Height flag', '<15 / >500 mm'),
  num('diagonal_length_mm', 'Diagonal', 1, 'mm'),
  flag('flag_diagonal_over_1200mm', 'Diagonal flag', '>1200 mm'),
  flag('flag_weight_out_of_range', 'Weight flag', '<250 g / >30 kg'),
  num('mhp_diameter_cm', 'MHP diameter', 1, 'cm'),
  num('cubic_volume_m3', 'Cubic volume', 4, 'm³'),
  num('cubic_kg', 'Cubic weight', 2, 'kg'),
  num('chargeable_kg', 'Chargeable weight', 2, 'kg'),
]

const ALIGN = { right: 'text-right', center: 'text-center' }

function sumCell(c, rows) {
  if (SUM_KEYS.has(c.key)) {
    const vals = rows.map(r => r[c.key]).filter(v => v !== null && v !== undefined)
    return vals.length ? fmtNum(vals.reduce((a, b) => a + b, 0), c.dp) : '—'
  }
  if (c.isFlag) {
    const n = rows.filter(r => r[c.key] === true).length
    return n ? <span className="text-[11px] font-semibold text-rose-700">{n} flagged</span> : null
  }
  return null
}

// Totals for one order. Only rendered for orders with more than one line, and it
// covers the lines on this page -- an order split across pages is totalled per page.
function SumRow({ g }) {
  const orderCols = COLUMNS.filter(c => c.order).length
  return (
    <tr className={`border-t border-slate-200 font-semibold text-slate-900 ${g.band ? 'bg-slate-100' : 'bg-slate-50'}`}>
      <td colSpan={orderCols} className="px-3 py-1.5 text-xs text-right text-slate-600">
        Order {g.rows[0].order_number} total · {g.size} lines
      </td>
      {COLUMNS.filter(c => !c.order).map(c => (
        <td key={c.key} className={`px-3 py-1.5 ${ALIGN[c.align] || ''}`}>{sumCell(c, g.rows)}</td>
      ))}
    </tr>
  )
}

/**
 * Group consecutive rows of the same order. Rows only sit together when the
 * sort keeps them adjacent (any order-level column does, via the backend's
 * order_row_id tiebreak); otherwise an order simply shows as several groups.
 */
function groupByOrder(rows) {
  const groups = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.id === r.order_row_id) last.rows.push(r)
    else groups.push({ id: r.order_row_id, rows: [r] })
  }
  return groups.map((g, i) => ({ ...g, size: g.rows.length, band: i % 2 === 1 }))
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
  const groups = useMemo(() => groupByOrder(data?.rows || []), [data])

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
                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    title={c.rule}
                    className={`px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none align-bottom ${ALIGN[c.align] || ''}`}
                  >
                    {c.label}
                    {sort === c.key && <span className="ml-1 text-indigo-500">{direction === 'asc' ? '▲' : '▼'}</span>}
                    {c.rule && <div className="normal-case tracking-normal font-normal text-[10px] text-slate-400">{c.rule}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={COLUMNS.length} className="p-6 text-center text-slate-400">Loading…</td></tr>
              )}
              {data && data.rows.length === 0 && !loading && (
                <tr><td colSpan={COLUMNS.length} className="p-6 text-center text-slate-400">No rows match these filters.</td></tr>
              )}
              {groups.map(g => [...g.rows.map((r, i) => (
                <tr
                  key={`${r.order_row_id}-${r.item_row_id}-${r.stock_line_id}`}
                  className={`${i === 0 ? 'border-t-2 border-slate-300' : 'border-t border-dashed border-slate-100'} ${g.band ? 'bg-slate-50' : ''} hover:bg-indigo-50/40`}
                >
                  {COLUMNS.map(c => {
                    if (c.order && i > 0) return null
                    return (
                      <td
                        key={c.key}
                        rowSpan={c.order ? g.size : undefined}
                        title={c.title?.(r)}
                        className={`px-3 py-2 ${c.order ? 'align-top' : ''} ${ALIGN[c.align] || ''} ${c.cls || ''}`}
                      >
                        {c.render ? c.render(r, g) : r[c.key]}
                      </td>
                    )
                  })}
                </tr>
              )), g.size > 1 && <SumRow key={`sum-${g.id}`} g={g} />])}
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
