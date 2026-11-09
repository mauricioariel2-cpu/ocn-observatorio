import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Color fijo por empresa (sigue a la entidad, nunca al ranking). Paleta categórica
// validada para fondo oscuro (CVD ΔE ≥ 9.4 entre vecinos). El resto va a "Otras" en gris.
const COLOR = { Movistar: '#3987e5', Entel: '#d95926', VTR: '#199e70', Claro: '#9085e9', WOM: '#d55181' }
const OTRAS = '#7d8597'
const RANGOS = [['24h', 24], ['7 días', 168], ['30 días', 720]]
const HORAS_PARA_PREDECIR = 24 * 28

const fmtHora = (d) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fmtDia = (d) => d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' })

async function leer(vista, columnas, orden) {
  let q = supabase.from(vista).select(columnas)
  if (orden) q = q.order(orden, { ascending: true })
  const { data, error } = await q.limit(5000)
  if (error) throw error
  return data ?? []
}

export default function Estadisticas({ nacional, vecinos }) {
  const [serie, setSerie] = useState([])
  const [disp, setDisp] = useState([])
  const [regiones, setRegiones] = useState([])
  const [error, setError] = useState(null)
  const [rango, setRango] = useState(24)
  const [tabla, setTabla] = useState(false)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      try {
        const [s, d, r] = await Promise.all([
          leer('ocn_serie_reportes', 'hora, empresa, reportes, fuentes', 'hora'),
          leer('ocn_disponibilidad', 'hora, empresa, pct, sondas', 'hora'),
          leer('ocn_regiones_hoy', 'region, reportes, principal'),
        ])
        if (!vivo) return
        setSerie(s); setDisp(d); setRegiones(r.sort((a, b) => b.reportes - a.reportes)); setError(null)
      } catch (e) {
        if (vivo) setError(e.message ?? String(e))
      }
    }
    cargar()
    const id = setInterval(cargar, 120_000)
    return () => { vivo = false; clearInterval(id) }
  }, [])

  const horasHistorial = useMemo(() => {
    if (!serie.length) return 0
    return Math.max(1, Math.round((Date.now() - Date.parse(serie[0].hora)) / 3_600_000))
  }, [serie])

  const series = useMemo(() => armarSeries(serie, rango), [serie, rango])
  const ultimaHora = series.horas.at(-1)
  const ahora = ultimaHora ? series.lineas.reduce((s, l) => s + (l.valores.at(-1) ?? 0), 0) : 0
  const conFalla = nacional.filter((f) => f.gravedad !== 'normal' && f.empresa !== 'Red completa')
  const empresasConFalla = new Set(conFalla.map((f) => f.empresa.split(' ')[0])).size

  return (
    <div className="stats">
      <div className="stats-cab">
        <div>
          <h2>Tendencias de la red en Chile</h2>
          <p>Datos reales que el bot guarda cada 15 minutos desde {serie[0] ? `${fmtDia(new Date(serie[0].hora))}, ${fmtHora(new Date(serie[0].hora))} h` : '…'}.</p>
        </div>
        <div className="seg" role="group" aria-label="Rango de tiempo">
          {RANGOS.map(([t, h]) => <button key={t} className={rango === h ? 'activo' : ''} onClick={() => setRango(h)}>{t}</button>)}
        </div>
      </div>
      {error && <p className="error">No pude leer las estadísticas: {error}</p>}

      <div className="kpis">
        <Kpi valor={ahora} titulo="Reportes ciudadanos" detalle={ultimaHora ? `hora de las ${fmtHora(ultimaHora)} · Geoblackout + FallaCL` : 'sin datos aún'} />
        <Kpi valor={empresasConFalla} titulo="Empresas con falla ahora" detalle={conFalla.length ? [...new Set(conFalla.map((f) => f.empresa))].slice(0, 3).join(', ') : 'ninguna'} acento={empresasConFalla ? 'rojo' : 'verde'} />
        <Kpi valor={vecinos.length} titulo="Vecinos reportaron en OCN" detalle="últimas 3 horas" />
        <Kpi valor={`${horasHistorial} h`} titulo="Historial acumulado" detalle="crece solo, cada 15 min" />
      </div>

      <section className="tarjeta">
        <header>
          <h3>Reportes ciudadanos por hora</h3>
          <button className="enlace" onClick={() => setTabla((t) => !t)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button>
        </header>
        {series.horas.length < 2
          ? <p className="vacio">Aún hay pocas horas de datos en este rango. El gráfico se llena solo.</p>
          : tabla ? <TablaSerie series={series} /> : <GraficoLineas series={series} />}
        <p className="fuente">Máximo informado en cada hora por Geoblackout y FallaCL (totales nacionales). Movistar, Entel, VTR, Claro y WOM llevan color propio; el resto suma "Otras". Las horas sin captura nueva quedan en blanco.</p>
      </section>

      <div className="dos-col">
        <section className="tarjeta">
          <header><h3>Regiones con más reportes hoy</h3></header>
          {regiones.length === 0 ? <p className="vacio">Sin reportes por región hoy.</p> : <BarrasRegiones filas={regiones.slice(0, 10)} />}
          <p className="fuente">FallaCL, acumulado desde las 00:00 (hora de Chile).</p>
        </section>
        <section className="tarjeta">
          <header><h3>¿Responde la red por dentro?</h3></header>
          <Disponibilidad filas={disp} />
          <p className="fuente">Sondas de Blackout Map dentro de cada red (CC BY-NC 4.0). 100% = todos los puntos de prueba responden.</p>
        </section>
      </div>

      <section className="tarjeta prediccion">
        <header><h3>Predicción de fallas</h3></header>
        <p>Para predecir cuándo y dónde falla cada empresa necesitamos al menos <b>4 semanas</b> de historial: así se ven los patrones por hora, por día de la semana y por región. No vamos a mostrar predicciones inventadas.</p>
        <div className="progreso" role="progressbar" aria-valuemin={0} aria-valuemax={HORAS_PARA_PREDECIR} aria-valuenow={horasHistorial}>
          <i style={{ width: `${Math.min(100, (horasHistorial / HORAS_PARA_PREDECIR) * 100)}%` }} />
        </div>
        <small>{horasHistorial} de {HORAS_PARA_PREDECIR} horas reunidas ({Math.round((horasHistorial / HORAS_PARA_PREDECIR) * 100)}%)</small>
      </section>
    </div>
  )
}

function Kpi({ valor, titulo, detalle, acento }) {
  return (
    <div className={`kpi ${acento ?? ''}`}>
      <span>{titulo}</span>
      <b>{valor}</b>
      <small>{detalle}</small>
    </div>
  )
}

// Matriz hora × empresa en un eje continuo de horas. Una hora sin captura queda vacía
// (null): el gráfico corta la línea en vez de inventar un cero o repetir el valor.
function armarSeries(filas, rangoH) {
  const desde = Date.now() - rangoH * 3_600_000
  const dentro = filas.filter((f) => Date.parse(f.hora) >= desde)
  if (!dentro.length) return { horas: [], lineas: [] }
  const t0 = Math.min(...dentro.map((f) => Date.parse(f.hora)))
  const t1 = Math.max(...dentro.map((f) => Date.parse(f.hora)))
  const horas = []
  for (let t = t0; t <= t1; t += 3_600_000) horas.push(new Date(t))
  const total = new Map()
  for (const f of dentro) total.set(f.empresa, (total.get(f.empresa) ?? 0) + f.reportes)
  const propias = [...total].filter(([e]) => COLOR[e]).sort((a, b) => b[1] - a[1]).map(([e]) => e)
  const lineas = [...propias, 'Otras'].map((nombre) => ({ nombre, color: COLOR[nombre] ?? OTRAS, valores: horas.map(() => null) }))
  const porNombre = new Map(lineas.map((l) => [l.nombre, l]))
  for (const f of dentro) {
    const l = porNombre.get(COLOR[f.empresa] ? f.empresa : 'Otras')
    const i = Math.round((Date.parse(f.hora) - t0) / 3_600_000)
    l.valores[i] = (l.valores[i] ?? 0) + f.reportes
  }
  return { horas, lineas: lineas.filter((l) => l.valores.some((v) => v != null)) }
}

function GraficoLineas({ series }) {
  const { horas, lineas } = series
  const ref = useRef(null)
  const caja = useRef(null)
  const [hover, setHover] = useState(null)
  const [W, setW] = useState(720)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(caja.current)
    return () => ro.disconnect()
  }, [])
  const H = W < 500 ? 220 : 260, m = { t: 12, r: 74, b: 28, l: 32 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const max = Math.max(1, ...lineas.flatMap((l) => l.valores.filter((v) => v != null)))
  const paso = Math.pow(10, Math.floor(Math.log10(max)))
  const tope = Math.ceil(max / paso) * paso
  const x = (i) => m.l + (horas.length === 1 ? iw / 2 : (i / (horas.length - 1)) * iw)
  const y = (v) => m.t + ih - (v / tope) * ih
  const ticks = [0, tope / 2, tope]
  const cadaX = Math.max(1, Math.ceil(horas.length / Math.max(3, Math.floor(W / 110))))
  const ultimoValor = (l) => l.valores.findLast((v) => v != null)
  const ultimos = lineas.map((l) => ({ ...l, yFin: y(ultimoValor(l)) })).sort((a, b) => a.yFin - b.yFin)
  for (let i = 1; i < ultimos.length; i++) if (ultimos[i].yFin - ultimos[i - 1].yFin < 13) ultimos[i].yFin = ultimos[i - 1].yFin + 13

  function mover(e) {
    const r = ref.current.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - m.l) / iw) * (horas.length - 1))
    setHover(Math.max(0, Math.min(horas.length - 1, i)))
  }

  return (
    <div className="graf" ref={caja}>
      <div className="leyenda-graf">
        {lineas.map((l) => <span key={l.nombre}><i style={{ background: l.color }} />{l.nombre}</span>)}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reportes por hora y empresa"
        onPointerMove={mover} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} className="grilla" />
            <text x={m.l - 6} y={y(t) + 4} className="eje" textAnchor="end">{t}</text>
          </g>
        ))}
        {horas.map((h, i) => i % cadaX === 0 && (
          <text key={i} x={x(i)} y={H - 8} className="eje" textAnchor="middle">{fmtHora(h)}</text>
        ))}
        {lineas.map((l) => (
          <g key={l.nombre}>
            <path d={l.valores.map((v, i) => v == null ? '' : `${i && l.valores[i - 1] != null ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}
              fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {l.valores.map((v, i) => v != null && l.valores[i - 1] == null && l.valores[i + 1] == null &&
              <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={l.color} stroke="var(--panel)" strokeWidth="2" />)}
          </g>
        ))}
        {ultimos.map((l) => (
          <text key={l.nombre} x={m.l + iw + 8} y={l.yFin + 4} className="etiqueta">{l.nombre}</text>
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} className="cruz" />
            {lineas.map((l) => l.valores[hover] != null && <circle key={l.nombre} cx={x(hover)} cy={y(l.valores[hover])} r="4.5" fill={l.color} stroke="var(--panel)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > horas.length / 2 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)' }}>
          <b>{fmtDia(horas[hover])} · {fmtHora(horas[hover])}</b>
          {lineas.map((l) => <span key={l.nombre}><i style={{ background: l.color }} />{l.nombre}<em>{l.valores[hover] ?? 'sin dato'}</em></span>)}
        </div>
      )}
    </div>
  )
}

function TablaSerie({ series }) {
  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead><tr><th>Hora</th>{series.lineas.map((l) => <th key={l.nombre}>{l.nombre}</th>)}</tr></thead>
        <tbody>
          {series.horas.map((h, i) => (
            <tr key={i}><td>{fmtDia(h)} {fmtHora(h)}</td>{series.lineas.map((l) => <td key={l.nombre}>{l.valores[i] ?? '–'}</td>)}</tr>
          )).reverse()}
        </tbody>
      </table>
    </div>
  )
}

function BarrasRegiones({ filas }) {
  const max = Math.max(1, ...filas.map((f) => f.reportes))
  return (
    <ul className="barras">
      {filas.map((f) => (
        <li key={f.region} title={`${f.region}: ${f.reportes} reportes hoy (más: ${f.principal})`}>
          <span className="b-nombre">{f.region}</span>
          <span className="b-pista"><i style={{ width: `${(f.reportes / max) * 100}%` }} /></span>
          <b>{f.reportes}</b>
          <small>{f.principal}</small>
        </li>
      ))}
    </ul>
  )
}

function Disponibilidad({ filas }) {
  const porEmpresa = new Map()
  for (const f of filas) porEmpresa.set(f.empresa, [...(porEmpresa.get(f.empresa) ?? []), f])
  if (!porEmpresa.size) return <p className="vacio">Sin mediciones aún.</p>
  return (
    <ul className="disp">
      {[...porEmpresa].map(([empresa, puntos]) => {
        const ult = puntos.at(-1)
        const estado = ult.pct >= 90 ? 'ok' : ult.pct >= 50 ? 'medio' : 'mal'
        const w = 120, h = 28
        const pts = puntos.slice(-48).map((p, i, a) => `${a.length === 1 ? w / 2 : (i / (a.length - 1)) * w},${h - 3 - (p.pct / 100) * (h - 6)}`).join(' ')
        return (
          <li key={empresa} title={`${empresa}: ${ult.pct}% de ${ult.sondas} sondas responden`}>
            <span className="d-nombre">{empresa}</span>
            <svg viewBox={`0 0 ${w} ${h}`} className="spark" aria-hidden><polyline points={pts} fill="none" strokeWidth="2" /></svg>
            <b className={estado}>{estado === 'ok' ? '✓' : estado === 'medio' ? '!' : '✕'} {ult.pct}%</b>
          </li>
        )
      })}
    </ul>
  )
}
