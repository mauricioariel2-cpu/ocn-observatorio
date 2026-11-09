const ETIQUETA = { falla_masiva: 'Falla masiva', posibles_problemas: 'Posibles problemas', normal: 'Reportes aislados' }

import { FUENTES_TOTALES, semaforoRegiones } from '../lib/datos'
import { REGIONES_CL } from '../lib/geo'

const LUZ = { falla_masiva: 'Rojo', posibles_problemas: 'Amarillo', normal: 'Verde' }

const FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA', blackoutmap: 'Blackout Map', ocn: 'Vecinos OCN', downdetector: 'Downdetector' }
const nombres = (set) => [...set].map((f) => FUENTE[f] ?? f).join(' + ')

export default function PanelNacional({ comunas, paises, nacional, tri, actualizado, error, abierto, alternar }) {
  const totalChile = paises.find((p) => p.pais === 'CL')?.total ?? 0
  const verif = [...tri.values()].filter((e) => e.pais === 'CL').sort((a, b) => b.fuentes.size - a.fuentes.size)
  return (
    <aside className="panel" aria-label="Resumen de caídas">
      <button className="asa" onClick={alternar} aria-expanded={abierto}>
        <span className="asa-raya" aria-hidden />
        <span><b>{totalChile}</b> reportes en Chile · últimas 3 h</span>
        <span className="asa-flecha" aria-hidden>{abierto ? '▾' : '▴'}</span>
      </button>

      <div className="panel-cuerpo">
        {error && <p className="error">No pude leer los datos: {error}</p>}

        <h2>Verificación cruzada</h2>
        {verif.length === 0 && <p className="vacio">Ninguna fuente reporta fallas en la última hora.</p>}
        <ul className="lista">
          {verif.map((e) => (
            <li key={e.empresa} className={e.confirmado ? 'falla_masiva' : 'sin-confirmar'}>
              <span>{e.empresa}<small>{e.confirmado ? '✓ Confirmada' : 'Sin confirmar'} · {nombres(e.fuentes)}</small></span>
              <b>{e.fuentes.size}/{FUENTES_TOTALES}</b>
            </li>
          ))}
        </ul>
        <p className="pie">Una falla se marca como confirmada solo si al menos 2 fuentes independientes la reportan en la última hora: reportes ciudadanos (Geoblackout, FallaCL, vecinos en OCN) y mediciones de red (IODA, sondas de Blackout Map).</p>

        <h2>Semáforo por región</h2>
        <ul className="lista semaforo">
          {semaforoRegiones(comunas, REGIONES_CL, tri).map((r) => (
            <li key={r.nombre} className={r.gravedad}>
              <i className={`luz ${r.gravedad}`} aria-label={LUZ[r.gravedad]} />
              <span>{r.nombre}<small>{r.total === 0 ? 'Sin reportes ahora' : `${ETIQUETA[r.gravedad]}${r.gravedad !== 'normal' && !r.confirmado ? ' (sin confirmar)' : ''} · ${r.principales.join(', ')}`}</small></span>
              <b>{r.total}</b>
            </li>
          ))}
        </ul>

        <h2>Empresas en Chile</h2>
        {nacional.length === 0 && <p className="vacio">Sin datos en las últimas 3 horas.</p>}
        <ul className="lista">
          {nacional.map((f) => (
            <li key={f.id ?? `${f.fuente}-${f.empresa}`} className={f.gravedad}>
              <span>{f.empresa}<small>{ETIQUETA[f.gravedad] ?? 's/i'} · {FUENTE[f.fuente] ?? f.fuente}{f.fuente === 'blackoutmap' || f.fuente === 'ioda' ? ` · ${f.gravedad_texto}` : ''}</small></span>
              <b>{f.cantidad_reportes ?? '–'}</b>
            </li>
          ))}
        </ul>

        {paises.filter((p) => p.pais !== 'CL').length > 0 && (
          <>
            <h2>Resto del mundo</h2>
            <ul className="lista">
              {paises.filter((p) => p.pais !== 'CL').map((p) => (
                <li key={p.id} className={p.gravedad}><span>{p.titulo}</span><b>{p.total}</b></li>
              ))}
            </ul>
          </>
        )}

        <p className="leyenda">
          <i className="falla_masiva" /> Rojo: falla masiva <i className="posibles_problemas" /> Amarillo: posibles problemas <i className="region-ok" /> Verde: normal o reportes aislados <i className="sin-confirmar" /> Sin confirmar
        </p>
        <p className="pie">
          Actualizado {actualizado ? actualizado.toLocaleTimeString('es-CL') : '…'} · Fuentes: Geoblackout, FallaCL, IODA (© Georgia Tech Research Corporation) y <a href="https://blackoutmap.net" target="_blank" rel="noreferrer">Blackout Map</a> (CC BY-NC 4.0)
        </p>
      </div>
    </aside>
  )
}
