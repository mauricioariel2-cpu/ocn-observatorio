import { useState } from 'react'
import { ALCANCES, FUENTE_TV, SINTOMAS, TECNOLOGIAS, resumenTv } from '../lib/tv'

// Sección "TV pagada" del panel: reportes de vecinos en OCN (últimas 3 h), ordenados por compañía y filtrables
// por tecnología, síntoma y canales afectados. Solo datos propios: no hay otra fuente pública de TV en vivo.
export default function TvPagada({ vecinos = [], abrirFicha }) {
  const [filtro, setFiltro] = useState({ tecnologia: '', sintoma: '', alcance: '' })
  const lista = resumenTv(vecinos, filtro)
  const total = lista.reduce((s, e) => s + e.n, 0)
  const chips = (campo, opciones) => (
    <div className="tv-filtro" role="group" aria-label={campo}>
      <button className={!filtro[campo] ? 'activo' : ''} onClick={() => setFiltro({ ...filtro, [campo]: '' })}>Todos</button>
      {Object.entries(opciones).map(([v, t]) => (
        <button key={v} className={filtro[campo] === v ? 'activo' : ''} onClick={() => setFiltro({ ...filtro, [campo]: filtro[campo] === v ? '' : v })}>{t}</button>
      ))}
    </div>
  )
  return (
    <>
      <h2>TV pagada <small className="tenue">· {total} reporte{total === 1 ? '' : 's'} en 3 h</small></h2>
      {chips('tecnologia', TECNOLOGIAS)}
      {chips('alcance', ALCANCES)}
      {chips('sintoma', SINTOMAS)}
      {lista.length === 0
        ? <p className="vacio">Nadie ha reportado fallas de TV {filtro.tecnologia || filtro.alcance || filtro.sintoma ? 'con estos filtros ' : ''}en las últimas 3 horas.</p>
        : (
          <ul className="lista">
            {lista.map((e) => (
              <li key={e.empresa} className={`${e.n >= 5 ? 'falla_masiva' : e.n >= 2 ? 'posibles_problemas' : ''} con-ficha`} role="button" tabIndex={0}
                onClick={() => abrirFicha?.(e.empresa)} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && abrirFicha?.(e.empresa)}>
                <span>{e.empresa}
                  <small>{[...e.topAlcance.map(([k, n]) => `${ALCANCES[k]} (${n})`), ...e.topSintoma.map(([k, n]) => `${SINTOMAS[k]} (${n})`)].join(' · ')}</small>
                  <small>{e.topRegiones.map(([r, n]) => `${r} ${n}`).join(', ')}{e.topCodigos.length ? ` · código ${e.topCodigos.map(([c, n]) => `${c} (${n})`).join(', ')}` : ''}</small>
                  {e.suscriptores && <small>{e.suscriptores.toLocaleString('es-CL')} suscriptores de TV en Chile</small>}
                </span>
                <b>{e.n}</b>
              </li>
            ))}
          </ul>
        )}
      <p className="pie">Reportes de vecinos en OCN: no existe otra fuente pública en vivo de fallas de TV. Suscriptores: {FUENTE_TV}.</p>
    </>
  )
}
