import { useEffect, useMemo, useState } from 'react'
import MapaCaidas from './components/MapaCaidas'
import PanelNacional from './components/PanelNacional'
import { cargarReportes, escucharNuevos, estadoNacional, mezclar, puntosComuna, puntosPais, triangular } from './lib/datos'

const REFRESCO_MS = 60_000 // respaldo por si se corta el canal en vivo
const DESTACAR_MS = 20_000 // cuánto parpadea un círculo con reportes nuevos

export default function App() {
  const [filas, setFilas] = useState([])
  const [error, setError] = useState(null)
  const [actualizado, setActualizado] = useState(null)
  const [enVivo, setEnVivo] = useState(false)
  const [vista, setVista] = useState('chile')
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [nuevos, setNuevos] = useState(() => new Set())

  useEffect(() => {
    let vivo = true
    const timers = []
    async function recargar() {
      try {
        const data = await cargarReportes()
        if (!vivo) return
        setFilas((act) => mezclar(act, data))
        setError(null)
        setActualizado(new Date())
      } catch (e) {
        if (vivo) setError(e.message ?? String(e))
      }
    }
    recargar()
    const id = setInterval(recargar, REFRESCO_MS)
    const salir = escucharNuevos(
      (fila) => {
        setFilas((act) => mezclar(act, [fila]))
        setActualizado(new Date())
        setNuevos((s) => new Set(s).add(fila.id))
        timers.push(setTimeout(() => setNuevos((s) => { const n = new Set(s); n.delete(fila.id); return n }), DESTACAR_MS))
      },
      (estado) => setEnVivo(estado === 'SUBSCRIBED'),
    )
    return () => {
      vivo = false
      clearInterval(id)
      timers.forEach(clearTimeout)
      salir()
    }
  }, [])

  const comunas = useMemo(() => puntosComuna(filas), [filas])
  const paises = useMemo(() => puntosPais(filas), [filas])
  const nacional = useMemo(() => estadoNacional(filas, 'CL'), [filas])
  const tri = useMemo(() => triangular(filas), [filas])

  return (
    <div className={`app ${panelAbierto ? 'panel-abierto' : ''}`}>
      <header className="barra">
        <div className="marca">
          <span className="logo" aria-hidden>●</span>
          <div>
            <h1>OCN</h1>
            <p>Observatorio Ciudadano de Redes</p>
          </div>
        </div>
        <nav className="vistas" aria-label="Cambiar vista del mapa">
          {['chile', 'mundo'].map((v) => (
            <button key={v} className={vista === v ? 'activo' : ''} onClick={() => setVista(v)}>
              {v === 'chile' ? 'Chile' : 'Mundo'}
            </button>
          ))}
        </nav>
        <span className={`vivo ${enVivo ? 'on' : ''}`} title={enVivo ? 'Conectado en vivo' : 'Actualizando cada minuto'}>
          <i /> {enVivo ? 'En vivo' : 'Cada 1 min'}
        </span>
      </header>

      <main className="contenido">
        <MapaCaidas comunas={comunas} paises={paises} vista={vista} nuevos={nuevos} tri={tri} />
        <PanelNacional
          comunas={comunas}
          paises={paises}
          nacional={nacional}
          tri={tri}
          actualizado={actualizado}
          error={error}
          abierto={panelAbierto}
          alternar={() => setPanelAbierto((a) => !a)}
        />
      </main>
    </div>
  )
}
