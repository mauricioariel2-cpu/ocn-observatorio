import { useEffect, useMemo, useState } from 'react'
import MapaCaidas from './components/MapaCaidas'
import PanelNacional from './components/PanelNacional'
import { cargarReportes, estadoNacional, puntosMapa } from './lib/datos'

const REFRESCO_MS = 60_000

export default function App() {
  const [filas, setFilas] = useState([])
  const [error, setError] = useState(null)
  const [actualizado, setActualizado] = useState(null)

  useEffect(() => {
    let vivo = true
    async function tick() {
      try {
        const data = await cargarReportes()
        if (!vivo) return
        setFilas(data)
        setError(null)
        setActualizado(new Date())
      } catch (e) {
        if (vivo) setError(e.message ?? String(e))
      }
    }
    tick()
    const id = setInterval(tick, REFRESCO_MS)
    return () => { vivo = false; clearInterval(id) }
  }, [])

  const puntos = useMemo(() => puntosMapa(filas), [filas])
  const nacional = useMemo(() => estadoNacional(filas), [filas])

  return (
    <div className="app">
      <PanelNacional filas={nacional} puntos={puntos} actualizado={actualizado} error={error} />
      <MapaCaidas puntos={puntos} />
    </div>
  )
}
