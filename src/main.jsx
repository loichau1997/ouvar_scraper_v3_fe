import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Report from './pages/Report.jsx'
import Audit from './pages/Audit.jsx'
import Lookup from './pages/Lookup.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/report" element={<Report />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/lookup" element={<Lookup />} />
          <Route path="*" element={<div className="p-8">Not found</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
