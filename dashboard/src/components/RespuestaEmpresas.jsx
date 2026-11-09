import { useEffect, useState } from 'react'
import { cargarResultados } from '../lib/seguimiento'

// "¿Responden las compañías?": lo que la gente contesta cuando OCN le pregunta por su reclamo.
// Son respuestas anónimas de personas, no una medición oficial; se rotula así.
const COLOR = { resuelto: 'var(--verde, #34c759)', respondido_sin_solucion: 'var(--amarillo, #ffcc00)', sin_respuesta: 'var(--rojo, #ff3b30)' }
const NOMBRE = { resuelto: 'Solucionado', respondido_sin_solucion: 'Respondió sin solucionar', sin_respuesta: 'Sin respuesta' }

export default function RespuestaEmpresas() {
  const [filas, setFilas] = useState(null)
  useEffect(() => {
    let vivo = true
    cargarResultados(90).then((x) => vivo && setFilas(x)).catch(() => vivo && setFilas([]))
    return () => { vivo = false }
  }, [])
  if (filas === null) return <p className="vacio">Cargando…</p>
  if (!filas.length) return <p className="vacio">Aún no hay resultados. Cuando guardes tu número de reclamo en el chat, OCN te preguntará si la compañía respondió y tu respuesta (anónima) aparecerá aquí.</p>
  const por = new Map()
  for (const f of filas) {
    const e = por.get(f.empresa) ?? { total: 0, resuelto: 0, respondido_sin_solucion: 0, sin_respuesta: 0 }
    e.total++; e[f.resultado]++
    por.set(f.empresa, e)
  }
  const orden = [...por].sort((a, b) => b[1].sin_respuesta / b[1].total - a[1].sin_respuesta / a[1].total || b[1].total - a[1].total)
  return (
    <>
      <ul className="barras">
        {orden.map(([empresa, e]) => (
          <li key={empresa} title={Object.keys(NOMBRE).map((k) => `${NOMBRE[k]}: ${e[k]}`).join(' · ')}>
            <span className="b-nombre">{empresa} <small>({e.total})</small></span>
            <span className="b-pista" style={{ display: 'flex' }}>
              {Object.keys(NOMBRE).map((k) => e[k] > 0 && <i key={k} style={{ width: `${(e[k] / e.total) * 100}%`, background: COLOR[k] }} />)}
            </span>
            <b title="sin respuesta">{Math.round((e.sin_respuesta / e.total) * 100)}%</b>
          </li>
        ))}
      </ul>
      <p className="leyenda-resp"><span>% = sin respuesta · (n) = reclamos seguidos</span>{Object.keys(NOMBRE).map((k) => <span key={k}><i style={{ background: COLOR[k] }} />{NOMBRE[k]}</span>)}</p>
    </>
  )
}
