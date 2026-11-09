import { useEffect, useMemo, useState } from 'react'
import MapaCaidas from './components/MapaCaidas'
import PanelNacional from './components/PanelNacional'
import ReportarFalla from './components/ReportarFalla'
import ChatOCN from './components/ChatOCN'
import Estadisticas from './components/Estadisticas'
import CortesLuz from './components/CortesLuz'
import { cargarCortesLuz } from './lib/luz'
import { REGIONES_CL } from './lib/geo'
import { cargarReportes, cargarVecinos, contarSimilares, escucharNuevos, estadoNacional, mezclar, puntosComuna, puntosPais, resumirVecinos, semaforoRegiones, triangular } from './lib/datos'

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
  const [chatAbierto, setChatAbierto] = useState(false)
  const [luz, setLuz] = useState({ hora: null, comunas: [], total: 0 })
  const [errorLuz, setErrorLuz] = useState(null)
  const [capaLuz, setCapaLuz] = useState(false)

  async function recargarLuz() {
    try { setLuz(await cargarCortesLuz()); setErrorLuz(null) } catch (e) { setErrorLuz(e.message ?? String(e)) }
  }

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
    recargarLuz()
    const id = setInterval(() => { recargar(); recargarVecinos(); recargarLuz() }, REFRESCO_MS)
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

  const semaforo = useMemo(() => semaforoRegiones(comunas, REGIONES_CL, tri), [comunas, tri])
  const enRojo = semaforo.filter((r) => r.gravedad === 'falla_masiva').length
  const enAmarillo = semaforo.filter((r) => r.gravedad === 'posibles_problemas').length
  const reportesChile = paises.find((p) => p.pais === 'CL')?.total ?? 0
  const ir = (v) => { setVista(v); if (v !== 'chile' && v !== 'mundo') setPanelAbierto(false) }
  const enMapa = vista === 'chile' || vista === 'mundo'

  const NAV = [['chile', 'Chile', 'mapa'], ['mundo', 'Mundo', 'mundo'], ['tendencias', 'Tendencias', 'tendencias'], ['luz', 'Luz', 'luz']]

  return (
    <div className={`app vista-${vista} ${panelAbierto ? 'panel-abierto' : ''} ${chatAbierto ? 'chat-abierto' : ''}`}>
      <header className="barra">
        <div className="marca">
          <svg className="logo" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="5" />
            <path d="M8.5 8.5a10.6 10.6 0 0 0 0 15M23.5 8.5a10.6 10.6 0 0 1 0 15M4.4 4.4a16.4 16.4 0 0 0 0 23.2M27.6 4.4a16.4 16.4 0 0 1 0 23.2" />
          </svg>
          <div>
            <h1>OCN</h1>
            <p>Observatorio Ciudadano de Redes</p>
          </div>
        </div>
        <nav className="vistas" aria-label="Secciones">
          {NAV.map(([v, t]) => (
            <button key={v} className={vista === v ? 'activo' : ''} onClick={() => ir(v)}>{t}</button>
          ))}
        </nav>
        <span className={`vivo ${enVivo ? 'on' : ''}`} title={enVivo ? 'Conectado en vivo' : 'Actualizando cada minuto'}>
          <i /> {enVivo ? 'En vivo' : 'Cada 1 min'}
        </span>
        <button className="btn-reportar-top" onClick={() => setChatAbierto(true)}>Reportar falla</button>
      </header>

      {enMapa && vista === 'chile' && (
        <div className="ahora" role="status" aria-label="Ahora en Chile">
          <span className={`kpi-chip ${enRojo ? 'rojo' : enAmarillo ? 'amarillo' : 'verde'}`}>
            <i aria-hidden />
            {enRojo ? <><b>{enRojo}</b> en rojo</> : enAmarillo ? <><b>{enAmarillo}</b> en amarillo</> : <>Todo Chile en verde</>}
          </span>
          <span className="kpi-chip"><b>{reportesChile.toLocaleString('es-CL')}</b> reportes · 3 h</span>
          {luz.hora && (
            <button className="kpi-chip electrico" onClick={() => ir('luz')}>
              ⚡ <b>{luz.total.toLocaleString('es-CL')}</b> sin luz
            </button>
          )}
        </div>
      )}

      {vista === 'tendencias' && <main className="contenido scroll"><Estadisticas nacional={nacional} vecinos={vecinos} /></main>}
      {vista === 'luz' && (
        <main className="contenido scroll">
          <CortesLuz luz={luz} error={errorLuz} verEnMapa={() => { setCapaLuz(true); ir('chile') }} />
        </main>
      )}
      {enMapa && (
      <main className="contenido">
        <MapaCaidas comunas={comunas} paises={paises} vista={vista} nuevos={nuevos} tri={tri}
          luz={luz.comunas} capaLuz={capaLuz} alternarLuz={() => setCapaLuz((c) => !c)}
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
      </main>
      )}

      {!chatAbierto && (
        <button className="fab-reportar" onClick={() => setChatAbierto(true)} aria-label="Reportar una falla">
          <span className="fab-pulso" aria-hidden />
          <span className="fab-txt"><b>¿Se te cayó?</b> Repórtalo en 10 segundos</span>
        </button>
      )}
      <ChatOCN contar={contar} abierto={chatAbierto} setAbierto={setChatAbierto} verMapa={() => ir('chile')} />

      <nav className="tabbar" aria-label="Secciones">
        {NAV.slice(0, 2).map(([v, t, ic]) => (
          <button key={v} className={vista === v ? 'activo' : ''} onClick={() => ir(v)}><Icono n={ic} />{t}</button>
        ))}
        <button className="tab-reportar" onClick={() => setChatAbierto(true)}><span aria-hidden><Icono n="mas" /></span>Reportar</button>
        {NAV.slice(2).map(([v, t, ic]) => (
          <button key={v} className={vista === v ? 'activo' : ''} onClick={() => ir(v)}><Icono n={ic} />{t}</button>
        ))}
      </nav>

      <ReportarFalla abierto={reporte.abierto} regionInicial={reporte.region}
        contar={contar}
        cerrar={() => { setReporte({ abierto: false, region: '' }); setVersionPerfil((n) => n + 1) }} />
    </div>
  )
}

// Íconos de línea simples para la barra inferior (sin emojis, se ven igual en todos los teléfonos).
const TRAZOS = {
  mapa: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  mundo: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z',
  tendencias: 'M3 20h18M5 16l4-5 4 3 6-8',
  luz: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  mas: 'M12 5v14M5 12h14',
}
function Icono({ n }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={TRAZOS[n]} />
    </svg>
  )
}
