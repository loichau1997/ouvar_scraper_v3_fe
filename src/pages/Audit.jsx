import { useState } from 'react'
import { ApiError, downloadBlob, fetchBlob, filenameFromDisposition, API_BASE } from '../api.js'

export default function Audit() {
  const [file, setFile] = useState(null)
  const [connoteCol, setConnoteCol] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [drag, setDrag] = useState(false)

  const onFile = (f) => {
    setErr('')
    setResult(null)
    if (!f) return setFile(null)
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setErr('Please upload a .csv file.')
      return
    }
    setFile(f)
  }

  const submit = async () => {
    if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const qs = connoteCol ? `?connote_column=${encodeURIComponent(connoteCol)}` : ''
      const { blob, headers } = await fetchBlob(`/api/report/tnt-analysis${qs}`, {
        method: 'POST',
        body: fd,
      })
      const name = filenameFromDisposition(headers.get('content-disposition'), 'tnt-analysis.xlsx')
      downloadBlob(blob, name)
      setResult({
        rows: headers.get('x-csv-rows'),
        connotes: headers.get('x-connotes'),
        matched: headers.get('x-connotes-matched'),
        attention: headers.get('x-rows-needing-attention'),
        filename: name,
      })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Carrier invoice audit</h1>
        <p className="text-sm text-slate-500">Upload a carrier CSV (TNT, StarTrack, …) and get an .xlsx back with attention flags and derived weights.</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]) }}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition ${
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

      <div className="mt-4">
        <label className="block text-sm text-slate-700 mb-1">Connote column name <span className="text-slate-400">(optional, default: Connote)</span></label>
        <input
          value={connoteCol}
          onChange={e => setConnoteCol(e.target.value)}
          placeholder="Connote"
          className="w-full text-sm border border-slate-200 rounded px-3 py-1.5"
        />
      </div>

      <div className="mt-5 flex gap-2 items-center">
        <button
          onClick={submit}
          disabled={!file || busy}
          className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Analysing…' : 'Analyse and download'}
        </button>
        <span className="text-xs text-slate-400">Max 32 MB, max 20 000 rows.</span>
      </div>

      {err && <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded p-3 text-sm">{err}</div>}

      {result && (
        <div className="mt-5 bg-emerald-50 border border-emerald-200 rounded p-4 text-sm">
          <div className="font-semibold text-emerald-800 mb-1">Analysis complete — {result.filename} downloaded.</div>
          <div className="text-emerald-900">
            Analysed <b>{result.rows}</b> rows / <b>{result.connotes}</b> unique connotes — <b>{result.matched}</b> matched, <b className="text-rose-700">{result.attention}</b> need attention.
          </div>
        </div>
      )}

      <div className="mt-8 text-xs text-slate-400">
        Backend: <span className="font-mono">{API_BASE}</span>
      </div>
    </div>
  )
}
