const ETIQUETA = { falla_masiva: 'Falla masiva', posibles_problemas: 'Posibles problemas', normal: 'Reportes aislados' }

import { FUENTES_TOTALES, semaforoRegiones } from '../lib/datos'
import { REGIONES_CL } from '../lib/geo'
import { TEXTO_ESTADO_EMPRESA, estadoEmpresas } from '../lib/estadoEmpresas'
import TvPagada from './TvPagada'
import { FUENTE_CONEXIONES, REGLA_SEMAFORO_COMUNA, semaforoComunas } from '../lib/conexiones'
import { ICONO_CAUSA, alcance, causaDeEmpresa, indiceLuz } from '../lib/causa'

const LUZ = { falla_masiva: 'Rojo', posibles_problemas: 'Amarillo', normal: 'Verde' }

const FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA', blackoutmap: 'Blackout Map', atlas: 'RIPE Atlas', cloudflare: 'Cloudflare Radar', ocn: 'Vecinos OCN', downdetector: 'Downdetector' }
const nombres = (set) => [...set].map((f) => FUENTE[f] ?? f).join(' + ')

export default function PanelNacional({ comunas, paises, nacional, tri, todas = [], vecinos = [], idxLuz = indiceLuz([]), abrirFicha, actualizado, error, abierto, alternar }) {
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

        <h2>Estado por compañía</h2>
        <div className="tarjetas-empresas">
          {estadoEmpresas(todas).map((e) => (
            <button key={e.clave} className={`tarjeta-empresa ${e.estado}`} onClick={() => abrirFicha?.(e.empresa)}
              aria-label={`${e.empresa}: ${TEXTO_ESTADO_EMPRESA[e.estado]}. Ver ficha`}>
              <span className="te-nombre">{e.empresa}</span>
              <span className="te-estado"><i aria-hidden />{TEXTO_ESTADO_EMPRESA[e.estado]}</span>
              <small>{e.conDatos === 0 ? 'Ninguna fuente informó en la última hora'
                : e.conFalla.length ? `${e.conFalla.length} de ${e.conDatos} fuentes ven falla: ${nombres(new Set(e.conFalla))}`
                : `${e.conDatos} ${e.conDatos === 1 ? 'fuente' : 'fuentes'} con datos, ninguna ve falla`}</small>
              {e.clientes && <small>{(e.clientes.grupo ?? e.empresa)}: {e.clientes.n.toLocaleString('es-CL')} clientes fijos</small>}
            </button>
          ))}
        </div>
        <p className="pie">Caída confirmada: 2 o más fuentes independientes ven falla en la última hora. Con problemas: 1 sola fuente. Operativa: hay datos y ninguna fuente ve falla. Sin datos: no podemos decir que esté bien. Clientes fijos: SUBTEL, junio de 2026.</p>

        <TvPagada vecinos={vecinos} abrirFicha={abrirFicha} />

        <h2>Verificación cruzada</h2>
        {verif.length === 0 && <p className="vacio">Ninguna fuente reporta fallas en la última hora.</p>}
        <ul className="lista">
          {verif.map((e) => (
            <li key={e.empresa} className={`${e.confirmado ? 'falla_masiva' : 'sin-confirmar'} con-ficha`} role="button" tabIndex={0}
              onClick={() => abrirFicha?.(e.empresa)} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && abrirFicha?.(e.empresa)}
              aria-label={`Ver ficha de la caída de ${e.empresa}`}>
              <span>{e.empresa} <em className="ver-ficha">Ver ficha ›</em><small>{e.confirmado ? '✓ Confirmada' : 'Sin confirmar'} · {nombres(e.fuentes)}</small>
                <CausaCorta c={causaDeEmpresa(e.empresa, e.pais, todas, idxLuz, tri)} a={alcance(todas, e.empresa, e.pais)} />
              </span>
              <b>{e.fuentes.size}/{FUENTES_TOTALES}</b>
            </li>
          ))}
        </ul>
        <p className="pie">Causa probable: ⚡ corte de luz informado por la SEC en el mismo lugar · 🌎 sismo fuerte cercano (USGS) · 🌧️ lluvia o viento fuerte en la región (Open-Meteo) · 📡 sondas dentro de la red de la compañía miden la caída · 👥 solo reportes de personas. Es una estimación con datos reales, no una afirmación.</p>
        <p className="pie">Una falla se marca como confirmada solo si al menos 2 fuentes independientes la reportan en la última hora: reportes ciudadanos (Geoblackout, FallaCL, vecinos en OCN) y mediciones de red (IODA, sondas de Blackout Map y de RIPE Atlas).</p>

        <h2>Semáforo por región</h2>
        <ul className="lista semaforo">
          {semaforoRegiones(comunas, REGIONES_CL, tri).map((r) => (
            <li key={r.nombre} className={r.gravedad}>
              <i className={`luz ${r.gravedad}`} role="img" aria-label={LUZ[r.gravedad]} />
              <span>{r.nombre}<small>{r.total === 0 ? 'Sin reportes ahora' : `${ETIQUETA[r.gravedad]}${r.gravedad !== 'normal' && !r.confirmado ? ' (sin confirmar)' : ''} · ${r.principales.join(', ')}`}</small></span>
              <b>{r.total}</b>
            </li>
          ))}
        </ul>

        <h2>Semáforo por comuna</h2>
        {(() => {
          const sc = semaforoComunas(comunas)
          if (!sc.length) return <p className="vacio">Ninguna comuna con reportes ubicados en las últimas 3 h. Una comuna sin reportes no se pinta: no saber no es lo mismo que estar bien.</p>
          return (
            <ul className="lista semaforo">
              {sc.map((c) => (
                <li key={c.id} className={c.gravedad}>
                  <i className={`luz ${c.gravedad}`} role="img" aria-label={LUZ[c.gravedad]} />
                  <span>{c.comuna}<small>{c.tasa < 0.1 ? 'menos de 0,1' : c.tasa.toLocaleString('es-CL')} por cada 10.000 conexiones · {c.region} · {c.principales.join(', ')}</small></span>
                  <b>{c.total}</b>
                </li>
              ))}
            </ul>
          )
        })()}
        <p className="pie">{REGLA_SEMAFORO_COMUNA} Conexiones: {FUENTE_CONEXIONES}.</p>

        <h2>Empresas en Chile</h2>
        {nacional.length === 0 && <p className="vacio">Sin datos en las últimas 3 horas.</p>}
        <ul className="lista">
          {nacional.map((f) => (
            <li key={f.id ?? `${f.fuente}-${f.empresa}`} className={f.gravedad}>
              <span>{f.empresa}<small>{ETIQUETA[f.gravedad] ?? 's/i'} · {FUENTE[f.fuente] ?? f.fuente}{['blackoutmap', 'ioda', 'atlas', 'cloudflare'].includes(f.fuente) ? ` · ${f.gravedad_texto}` : ''}</small></span>
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
          Actualizado {actualizado ? actualizado.toLocaleTimeString('es-CL') : '…'} · Fuentes: Geoblackout, FallaCL, IODA (© Georgia Tech Research Corporation), <a href="https://blackoutmap.net" target="_blank" rel="noreferrer">Blackout Map</a> (CC BY-NC 4.0) y <a href="https://atlas.ripe.net" target="_blank" rel="noreferrer">RIPE Atlas</a> (RIPE NCC)
        </p>
      </div>
    </aside>
  )
}

function CausaCorta({ c, a }) {
  if (!c) return null
  return <small className={`causa-corta causa-${c.tipo}`} title={c.evidencia}>{ICONO_CAUSA[c.tipo]} {c.texto}{a ? ` · ${a.texto}` : ''}</small>
}
