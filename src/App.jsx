import { NavLink, Outlet } from 'react-router-dom'
import { API_BASE } from './api.js'

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/report', label: 'Freight report' },
  { to: '/audit', label: 'Carrier audit' },
  { to: '/lookup', label: 'Order lookup' },
]

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="font-semibold text-slate-900 tracking-tight">Ouvar Scraper</div>
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
            </nav>
          </div>
          <div className="text-xs text-slate-400 font-mono">{API_BASE}</div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
