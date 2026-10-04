import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { API_BASE } from './api.js'

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/report', label: 'Freight report' },
  { to: '/audit', label: 'Carrier audit' },
  { to: '/lookup', label: 'Order lookup' },
]

// External: the Temporal UI for scrape / lookup workflows.
const TEMPORAL_URL = 'https://temporal.a2mated.cloud'

// Wide tables: these pages use the full viewport width instead of max-w-7xl.
const FULL_WIDTH = ['/report']

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* storage unavailable */ }
    setTheme(next)
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </button>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const width = FULL_WIDTH.includes(pathname) ? 'max-w-none' : 'max-w-7xl'
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className={`${width} mx-auto px-6 h-14 flex items-center justify-between`}>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 font-semibold text-slate-900 tracking-tight">
              <img src="/favicon.svg" alt="" className="w-7 h-7" />
              Ouvar Scraper <span className="text-xs font-medium text-indigo-600">V3</span>
            </div>
            <nav className="flex items-center gap-1">
              {links.map(l => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              <a
                href={TEMPORAL_URL}
                target="_blank"
                rel="noreferrer"
                title="Temporal UI (opens in a new tab)"
                className="px-3 py-1.5 rounded-md text-sm font-medium transition text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                Temporal <span className="text-xs">↗</span>
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 font-mono">{API_BASE}</div>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={`flex-1 ${width} w-full mx-auto px-6 py-6`}>
        <Outlet />
      </main>
    </div>
  )
}
