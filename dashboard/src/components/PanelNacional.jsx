const ETIQUETA = { falla_masiva: 'Falla masiva', posibles_problemas: 'Posibles problemas', normal: 'Normal' }

import { FUENTES_TOTALES } from '../lib/datos'

const FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA', blackoutmap: 'Blackout Map', downdetector: 'Downdetector' }
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
        <p className="pie">Una falla se marca como confirmada solo si al menos 2 fuentes independientes la reportan en la última hora: reportes ciudadanos (Geoblackout, FallaCL) y mediciones de red (IODA, sondas de Blackout Map).</p>

        <h2>Zonas afectadas en Chile</h2>
        {comunas.filter((c) => c.pais === 'CL').length === 0 && (
          <p className="vacio">Aún no hay reportes con ubicación. Se pintarán apenas lleguen.</p>
        )}
        <ul className="lista">
          {comunas.filter((c) => c.pais === 'CL').slice(0, 12).map((c) => (
            <li key={c.id} className={c.gravedad}>
              <span>{c.titulo}<small>{c.subtitulo}</small></span>
              <b>{c.total}</b>
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
          <i className="falla_masiva" /> Falla masiva <i className="posibles_problemas" /> Posibles problemas <i className="sin-confirmar" /> Sin confirmar <i className="pocos" /> Pocos reportes <i className="region-ok" /> Sin fallas
        </p>
        <p className="pie">
          Actualizado {actualizado ? actualizado.toLocaleTimeString('es-CL') : '…'} · Fuentes: Geoblackout, FallaCL, IODA (© Georgia Tech Research Corporation) y <a href="https://blackoutmap.net" target="_blank" rel="noreferrer">Blackout Map</a> (CC BY-NC 4.0)
        </p>
      </div>
    </aside>
  )
}
