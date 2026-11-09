import { useEffect, useMemo, useState } from 'react'
import MapaCaidas from './components/MapaCaidas'
import PanelNacional from './components/PanelNacional'
import ReportarFalla from './components/ReportarFalla'
import ChatOCN from './components/ChatOCN'
import Estadisticas from './components/Estadisticas'
import { REGIONES_CL } from './lib/geo'
import { cargarReportes, cargarVecinos, contarSimilares, escucharNuevos, estadoNacional, mezclar, puntosComuna, puntosPais, resumirVecinos, triangular } from './lib/datos'

const CENTROS = Object.fromEntries(REGIONES_CL.map(([n, la, lo]) => [n, [la, lo]]))

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
  const [vecinos, setVecinos] = useState([])
  const [reporte, setReporte] = useState({ abierto: false, region: '' })

  const [versionPerfil, setVersionPerfil] = useState(0)

  async function recargarVecinos() {
    try { const v = await cargarVecinos(); setVecinos(v); return v } catch { return [] /* si la tabla aún no existe, el mapa sigue funcionando */ }
  }

  // Después de reportar: datos frescos para responder "no eres el único".
  async function contar(empresa, region) {
    const v = await recargarVecinos()
    return contarSimilares(v, filas, empresa, region)
  }

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
    recargarVecinos()
    const id = setInterval(() => { recargar(); recargarVecinos() }, REFRESCO_MS)
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

  const todas = useMemo(() => [...filas, ...resumirVecinos(vecinos, CENTROS)], [filas, vecinos])
  const comunas = useMemo(() => puntosComuna(todas), [todas])
  const paises = useMemo(() => puntosPais(todas), [todas])
  const nacional = useMemo(() => estadoNacional(todas, 'CL'), [todas])
  const tri = useMemo(() => triangular(todas), [todas])

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
          {[['chile', 'Chile'], ['mundo', 'Mundo'], ['tendencias', 'Tendencias']].map(([v, t]) => (
            <button key={v} className={vista === v ? 'activo' : ''} onClick={() => setVista(v)}>{t}</button>
          ))}
        </nav>
        <span className={`vivo ${enVivo ? 'on' : ''}`} title={enVivo ? 'Conectado en vivo' : 'Actualizando cada minuto'}>
          <i /> {enVivo ? 'En vivo' : 'Cada 1 min'}
        </span>
      </header>

      {vista === 'tendencias' ? (
        <main className="contenido scroll"><Estadisticas nacional={nacional} vecinos={vecinos} /></main>
      ) : (
      <main className="contenido">
        <MapaCaidas comunas={comunas} paises={paises} vista={vista} nuevos={nuevos} tri={tri}
          meAfecta={(region) => setReporte({ abierto: true, region: region ?? '' })} />
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
        <ChatOCN contar={contar} />
      </main>
      )}
      <ReportarFalla abierto={reporte.abierto} regionInicial={reporte.region}
        contar={contar}
        cerrar={() => { setReporte({ abierto: false, region: '' }); setVersionPerfil((n) => n + 1) }} />
    </div>
  )
}
