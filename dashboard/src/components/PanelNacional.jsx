const ETIQUETA = { falla_masiva: 'Falla masiva', posibles_problemas: 'Posibles problemas', normal: 'Reportes aislados' }

import { FUENTES_TOTALES, semaforoRegiones } from '../lib/datos'
import { REGIONES_CL } from '../lib/geo'
import { TEXTO_ESTADO_EMPRESA, estadoEmpresas } from '../lib/estadoEmpresas'
import TvPagada from './TvPagada'
import { FUENTE_CONEXIONES, REGLA_SEMAFORO_COMUNA, semaforoComunas } from '../lib/conexiones'
import { ICONO_CAUSA, alcance, causaDeEmpresa, indiceLuz } from '../lib/causa'
import { SUSCRIPTORES_TV } from '../lib/tv'
import { esTelecom } from '../lib/servicios'

const MEDICIONES = new Set(['blackoutmap', 'ioda', 'atlas', 'cloudflare'])

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
        {!actualizado && !error ? <p className="vacio">Cargando…</p> : (
          <div className="tarjetas-empresas">
            {tarjetas(todas).map((e) => (
              <button key={e.clave} className={`tarjeta-empresa ${e.estado}`} onClick={() => abrirFicha?.(e.empresa)}
                aria-label={`${e.empresa}: ${TEXTO_ESTADO_EMPRESA[e.estado]}. Ver ficha`}>
                <span className="te-nombre">{e.empresa}</span>
                <span className="te-estado"><i aria-hidden />{TEXTO_ESTADO_EMPRESA[e.estado]}</span>
                <small>{e.conDatos === 0 ? 'Ninguna fuente informó en la última hora'
                  : e.estado === 'aislados' ? `${e.vecinos} ${e.vecinos === 1 ? 'persona reportó' : 'personas reportaron'} en OCN; ninguna otra fuente lo confirma`
                  : e.conFalla.length ? `${e.conFalla.length} de ${e.conDatos} fuentes ven falla: ${nombres(new Set(e.conFalla))}`
                  : `${e.conDatos} ${e.conDatos === 1 ? 'fuente' : 'fuentes'} con datos, ninguna ve falla`}</small>
                {e.clientesTexto && <small>{e.clientesTexto}</small>}
              </button>
            ))}
          </div>
        )}
        <p className="pie">Caída confirmada: 2 o más fuentes independientes ven falla en la última hora. Con problemas: 1 sola fuente. Operativa: hay datos y ninguna fuente ve falla. Sin datos: no podemos decir que esté bien. Clientes: SUBTEL, junio de 2026 (internet fijo; en DIRECTV, TV pagada).</p>

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
        {(() => {
          const lista = porEmpresa(nacional)
          if (!lista.length) return <p className="vacio">Sin datos en las últimas 3 horas.</p>
          return (
            <ul className="lista">
              {lista.map((e) => (
                <li key={e.empresa} className={e.gravedad}>
                  <span>{e.empresa}<small>{e.detalle}</small></span>
                  <b>{e.reportes || '–'}</b>
                </li>
              ))}
            </ul>
          )
        })()}
        <p className="pie">Solo internet, TV y telefonía. El número es la mayor cantidad de reportes de personas que informa una fuente.</p>

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
          Actualizado {actualizado ? actualizado.toLocaleTimeString('es-CL') : '…'} · Fuentes: Geoblackout, FallaCL, vecinos en OCN, IODA (© Georgia Tech Research Corporation), <a href="https://atlas.ripe.net" target="_blank" rel="noreferrer">RIPE Atlas</a> (RIPE NCC), <a href="https://radar.cloudflare.com" target="_blank" rel="noreferrer">Cloudflare Radar</a> (CC BY-NC 4.0), <a href="https://blackoutmap.net" target="_blank" rel="noreferrer">Blackout Map</a> (CC BY-NC 4.0), cortes de luz de la SEC, clima de Open-Meteo, sismos del USGS y clientes de SUBTEL
        </p>
      </div>
    </aside>
  )
}

function CausaCorta({ c, a }) {
  if (!c) return null
  return <small className={`causa-corta causa-${c.tipo}`} title={c.evidencia}>{ICONO_CAUSA[c.tipo]} {c.texto}{a ? ` · ${a.texto}` : ''}</small>
}

// Tarjetas con la cifra de clientes que corresponde: TV pagada para DIRECTV; la cifra
// conjunta Claro-VTR se muestra una sola vez (en la primera de las dos tarjetas).
function tarjetas(todas) {
  const vistos = new Set()
  return estadoEmpresas(todas).map((e) => {
    let clientesTexto = null
    if (e.clave === 'directv') clientesTexto = `${SUSCRIPTORES_TV.DIRECTV.toLocaleString('es-CL')} suscriptores de TV`
    else if (e.clientes) {
      const g = e.clientes.grupo ?? e.empresa
      clientesTexto = vistos.has(g) ? `Cifra en la tarjeta ${g}` : `${e.clientes.grupo ? `${g} (juntos)` : g}: ${e.clientes.n.toLocaleString('es-CL')} clientes de internet fijo`
      vistos.add(g)
    }
    return { ...e, clientesTexto }
  })
}

// Una fila por compañía de telecomunicaciones, con lo que dice cada fuente en palabras simples.
const PESO = { falla_masiva: 2, posibles_problemas: 1, normal: 0 }
function porEmpresa(filas) {
  const m = new Map()
  for (const f of filas) {
    if (f.empresa === 'Red completa' || !esTelecom(f)) continue
    const nombre = f.empresa.split(/[\s(]+/)[0]
    const e = m.get(nombre) ?? { empresa: nombre, gravedad: 'normal', reportes: 0, fuentes: new Map() }
    if ((PESO[f.gravedad] ?? 0) > PESO[e.gravedad]) e.gravedad = f.gravedad
    if (!MEDICIONES.has(f.fuente)) e.reportes = Math.max(e.reportes, f.cantidad_reportes ?? 0)
    const texto = MEDICIONES.has(f.fuente)
      ? (f.gravedad === 'normal' ? 'red sin falla medida' : 'mide falla en la red')
      : (f.gravedad === 'normal' ? 'pocos reportes' : f.gravedad === 'falla_masiva' ? 'muchos reportes' : 'varios reportes')
    const previo = e.fuentes.get(f.fuente)
    if (!previo || (PESO[f.gravedad] ?? 0) > previo.peso) e.fuentes.set(f.fuente, { texto, peso: PESO[f.gravedad] ?? 0 })
    m.set(nombre, e)
  }
  return [...m.values()].map((e) => ({ ...e, detalle: [...e.fuentes].map(([k, v]) => `${FUENTE[k] ?? k}: ${v.texto}`).join(' · ') }))
    .sort((a, b) => PESO[b.gravedad] - PESO[a.gravedad] || b.reportes - a.reportes)
}
