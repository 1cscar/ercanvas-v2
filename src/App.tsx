import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

const Home = lazy(() => import('./pages/Home'))
const ERDiagram = lazy(() => import('./pages/ERDiagram'))
const LogicalDiagram = lazy(() => import('./pages/LogicalDiagram'))
const PhysicalDiagram = lazy(() => import('./pages/PhysicalDiagram'))
const SharedLinkRedirect = lazy(() => import('./pages/SharedLinkRedirect'))

export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">載入中…</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/diagram/er/:id" element={<ERDiagram />} />
        <Route path="/diagram/logical/:id" element={<LogicalDiagram />} />
        <Route path="/diagram/physical/:id" element={<PhysicalDiagram />} />
        <Route path="/shared/:token" element={<SharedLinkRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
