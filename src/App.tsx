import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import ERDiagram from './pages/ERDiagram'
import LogicalDiagram from './pages/LogicalDiagram'
import PhysicalDiagram from './pages/PhysicalDiagram'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/diagram/er/:id" element={<ERDiagram />} />
      <Route path="/diagram/logical/:id" element={<LogicalDiagram />} />
      <Route path="/diagram/physical/:id" element={<PhysicalDiagram />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
