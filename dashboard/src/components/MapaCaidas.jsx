import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FUENTES_TOTALES, puntosRegion, verifDe } from '../lib/datos'
import { REGIONES_CL, VISTAS, nivelPorZoom, paisDeVista } from '../lib/geo'
import { ICONO_CAUSA, causaDePunto, indiceLuz } from '../lib/causa'
import { FUENTE_CONEXIONES, escalaDePunto, semaforoComunas } from '../lib/conexiones'
import { COLOR_ESTADO, TEXTO_ESTADO, cargarContornos, cargarEstadoPaises, nombrePais } from '../lib/mundo'

const SERVICIO = { internet_fijo: 'Internet hogar', internet_movil: 'Internet móvil', tv: 'TV', internet: 'Internet', telefonia_fija: 'Telefonía', streaming: 'Streaming', banca: 'Banca' }
const norm = (t) => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA (Georgia Tech)', blackoutmap: 'Blackout Map', atlas: 'RIPE Atlas', cloudflare: 'Cloudflare Radar', ocn: 'Vecinos en OCN', downdetector: 'Downdetector' }

function hace(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!Number.isFinite(min)) return ''
  return min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`
}

function diametro(total) {
  return Math.round(Math.min(30 + Math.sqrt(total) * 7, 92))
}

function icono(p, nuevo, confirmado) {
  const d = diametro(p.total)
  const clases = ['burbuja', p.gravedad, nuevo ? 'nuevo' : '', confirmado ? 'confirmado' : 'sin-confirmar'].join(' ')
  return L.divIcon({
    className: 'burbuja-wrap',
    html: `<div class="${clases}" style="width:${d}px;height:${d}px;font-size:${Math.max(12, d / 3.2)}px"><span>${p.total || '!'}</span></div>`,
    iconSize: [d, d],
    iconAnchor: [d / 2, d / 2],
  })
}

// Mueve la cámara cuando cambias entre Chile y Mundo.
function Camara({ vista }) {
  const map = useMap()
  useEffect(() => {
    const v = VISTAS[vista]
    if (v.bounds) map.flyToBounds(v.bounds, { duration: 1.2, padding: [10, 10] })
    else map.flyTo(v.centro, v.zoom, { duration: 1.2 })
  }, [vista, map])
  return null
}

// Semáforo mundial: cada país pintado según el estado de su internet (estado_paises).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function CapaMundo() {
  const [geo, setGeo] = useState(null)
  const [estados, setEstados] = useState(null)
  useEffect(() => {
    let vivo = true
    const leer = () => cargarEstadoPaises().then((e) => vivo && setEstados(e)).catch(() => vivo && setEstados([]))
    cargarContornos().then((g) => vivo && setGeo(g)).catch(() => {})
    leer()
    const id = setInterval(leer, 5 * 60_000)
    return () => { vivo = false; clearInterval(id) }
  }, [])
  const porNum = useMemo(() => new Map((estados ?? []).filter((e) => e.iso_num != null).map((e) => [Number(e.iso_num), e])), [estados])
  if (!geo || !estados) return null
  const de = (f) => porNum.get(Number(f.id))
  return (
    <GeoJSON
      key={estados.length + '|' + (estados[0]?.actualizado ?? '')}
      data={geo}
      style={(f) => {
        const e = de(f)
        const c = COLOR_ESTADO[e?.estado ?? 'sin_datos']
        return { color: c, weight: 0.8, fillColor: c, fillOpacity: e?.estado === 'normal' ? 0.18 : e ? 0.5 : 0.08, opacity: 0.7 }
      }}
      onEachFeature={(f, capa) => {
        const e = de(f)
        const nombre = e ? nombrePais(e.cc, e.nombre) : (f.properties?.name ?? '')
        capa.bindTooltip(
          `<b>${esc(nombre)}</b><br>${esc(TEXTO_ESTADO[e?.estado ?? 'sin_datos'])}` +
          (e?.detalle ? `<br><small>${esc(e.detalle)}</small>` : '') +
          (e?.desde && e.estado !== 'normal' ? `<br><small>Desde ${esc(new Date(e.desde).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }))}</small>` : '') +
          `<br><small>Medición de red: Blackout Map + IODA</small>`,
          { sticky: true },
        )
      }}
    />
  )
}

// Etiqueta "causa probable" (ver lib/causa.js). Nunca afirma: dice lo más probable y cita la evidencia.
export function Causa({ c, extra }) {
  if (!c) return null
  return (
    <div className={`causa causa-${c.tipo}`}>
      <b>{ICONO_CAUSA[c.tipo]} {c.texto}</b>{extra && <span className="causa-alcance"> · {extra}</span>}
      <small>{c.evidencia}</small>
    </div>
  )
}

function SeguirZoom({ alCambiar }) {
  const map = useMapEvents({ zoomend: () => alCambiar(map.getZoom()) })
  return null
}

// Escala: cuántos hogares tienen internet fijo en ese lugar (SUBTEL), para leer los reportes en proporción.
function Escala({ e }) {
  if (!e) return null
  const tasa = e.tasa == null ? null : e.tasa < 0.1 ? 'menos de 0,1' : e.tasa.toLocaleString('es-CL')
  return (
    <div className="popup-escala" title={FUENTE_CONEXIONES}>
      🏠 {e.lugar}: {e.n.toLocaleString('es-CL')} conexiones de internet fijo{tasa ? ` · ${tasa} reportes por cada 10.000` : ''}
      <small>Fuente: {FUENTE_CONEXIONES}</small>
    </div>
  )
}

export default function MapaCaidas({ comunas, paises, vista, nuevos, tri, todas = [], idxLuz = indiceLuz([]), abrirFicha, meAfecta, luz = [], capaLuz = false, alternarLuz }) {
  const [zoom, setZoom] = useState(4)
  const nivel = nivelPorZoom(zoom)
  const puntos = useMemo(() => {
    if (nivel === 'pais') return paises
    // En la vista de un país solo se muestra ese país, para no confundir con los vecinos.
    const cc = paisDeVista(vista)
    const enVista = (p) => !cc || p.pais === cc
    const lugares = comunas.filter(enVista)
    const conDetalle = new Set(lugares.map((c) => c.pais))
    const sinDetalle = paises.filter((p) => enVista(p) && !conDetalle.has(p.pais)) // país con solo total nacional
    return [...(nivel === 'region' ? puntosRegion(lugares) : lugares), ...sinDetalle]
  }, [nivel, comunas, paises, vista])
  // Regiones vigiladas sin fallas: punto verde, para que se vea todo Chile.
  const tranquilas = useMemo(() => {
    if (nivel === 'pais' || vista !== 'chile') return []
    const conFalla = new Set(puntos.flatMap((p) => [p.titulo, p.subtitulo, ...p.detalle.map((f) => f.region)]).map(norm))
    return REGIONES_CL.filter(([n]) => !conFalla.has(norm(n)))
  }, [nivel, vista, puntos])
  // En el zoom de comuna, el color de cada comuna de Chile sale de los reportes por cada 10.000 conexiones.
  const luzPorComuna = useMemo(() => (nivel === 'comuna' ? new Map(semaforoComunas(puntos).map((c) => [c.id, c.gravedad])) : new Map()), [nivel, puntos])
  const iconos = useMemo(
    () => Object.fromEntries(puntos.map((p) => [p.id, icono(
      luzPorComuna.has(p.id) ? { ...p, gravedad: luzPorComuna.get(p.id) } : p,
      p.detalle.some((f) => nuevos.has(f.id)),
      p.detalle.some((f) => f.gravedad !== 'normal' && (verifDe(tri, f).confirmado || f.fuente === 'ioda')),
    )])),
    [puntos, nuevos, tri, luzPorComuna],
  )

  return (
    <>
    {vista === 'chile' && luz.length > 0 && (
      <button className={`chip-luz ${capaLuz ? 'on' : ''}`} onClick={alternarLuz} aria-pressed={capaLuz}>
        ⚡ Cortes de luz <b>{luz.length}</b>
      </button>
    )}
    {vista !== 'chile' && (
      <div className="leyenda-mundo" role="note">
        <span><i style={{ background: COLOR_ESTADO.normal }} />Normal</span>
        <span><i style={{ background: COLOR_ESTADO.posibles_problemas }} />Problemas</span>
        <span><i style={{ background: COLOR_ESTADO.falla_masiva }} />Caída</span>
        <span><i style={{ background: COLOR_ESTADO.sin_datos }} />Sin datos</span>
        <small>Color del país: mediciones de red de <a href="https://blackoutmap.net" target="_blank" rel="noreferrer">Blackout Map</a> (CC BY-NC) + IODA. Círculos: reportes de personas.</small>
      </div>
    )}
    {puntos.length === 0 && vista !== 'mundo' && (
      <div className="sin-caidas" role="status">
        <b>Sin caídas activas en {VISTAS[vista]?.nombre ?? 'el mundo'}</b>
        <span>Los círculos rojos aparecen apenas haya reportes masivos.</span>
      </div>
    )}
    <MapContainer
      whenReady={(e) => setZoom(e.target.getZoom())}
      bounds={VISTAS.chile.bounds}
      minZoom={2}
      maxBounds={[[-85, -240], [85, 240]]}
      worldCopyJump
      className="mapa"
      zoomControl={false}
    >
      {/* Mapa base oscuro de Esri (CARTO ahora exige API key) */}
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
      />
      <ZoomControl position="bottomright" />
      <Camara vista={vista} />
      <SeguirZoom alCambiar={setZoom} />
      {vista !== 'chile' && <CapaMundo />}
      {tranquilas.map(([nombre, lat, lon]) => (
        <CircleMarker key={nombre} center={[lat, lon]} radius={6} className="region-ok"
          pathOptions={{ color: '#34c759', fillColor: '#34c759', fillOpacity: 0.55, weight: 1.5 }}>
          <Tooltip direction="top">{nombre}: sin fallas reportadas ahora</Tooltip>
        </CircleMarker>
      ))}
      {capaLuz && vista === 'chile' && luz.filter((c) => c.latitud != null).map((c) => (
        <CircleMarker key={`luz-${c.comuna}`} center={[c.latitud, c.longitud]} radius={Math.min(4 + Math.sqrt(c.clientes) / 3, 22)}
          pathOptions={{ color: '#9fe3ff', fillColor: '#3fb8f5', fillOpacity: 0.35, weight: 1.5, dashArray: '3 3' }}>
          <Tooltip direction="top">⚡ {c.comuna}: {c.clientes.toLocaleString('es-CL')} clientes sin luz (SEC)</Tooltip>
        </CircleMarker>
      ))}
      {puntos.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={iconos[p.id]}>
          <Popup>
            <div className="popup">
              <strong>{p.titulo}</strong>
              {p.subtitulo && <span className="popup-sub">{p.subtitulo}</span>}
              <div className="popup-total">{p.total ? `${p.total} reportes` : 'Caída medida en la red'}</div>
              <Escala e={p.total ? escalaDePunto(p, nivel) : null} />
              <Causa c={causaDePunto(p.detalle, todas, idxLuz, tri)} />
              <ul>
                {p.detalle.map((e) => {
                  const v = verifDe(tri, e)
                  return (
                    <li key={e.id ?? e.hash_dedup}>
                      <b>{e.empresa}</b> {e.comuna && nivel !== 'comuna' ? `· ${e.comuna} ` : ''}
                      · {SERVICIO[e.servicio] ?? e.servicio ?? 's/i'}: {e.cantidad_reportes ?? '–'}
                      <small className="origen">
                        {e.gravedad !== 'normal' && (
                          <span className={v.confirmado ? 'sello ok' : 'sello'}>
                            {v.confirmado ? `✓ Confirmado por ${v.fuentes.size} de ${FUENTES_TOTALES} fuentes` : e.empresa === 'Red completa' ? 'Medición de red' : `Sin confirmar (1 de ${FUENTES_TOTALES} fuentes)`}
                          </span>
                        )}
                        {' '}Fuente: {e.url_fuente
                          ? <a href={e.url_fuente} target="_blank" rel="noreferrer">{FUENTE[e.fuente] ?? e.fuente}</a>
                          : (FUENTE[e.fuente] ?? e.fuente)} · {hace(e.capturado_en ?? e.ventana)}
                        {e.gravedad_texto && <><br />{e.gravedad_texto}</>}
                        {e.gravedad !== 'normal' && e.empresa !== 'Red completa' && abrirFicha && <><br /><button className="link-ficha" onClick={() => abrirFicha(e.empresa)}>Ver ficha de la caída de {e.empresa} ›</button></>}
                      </small>
                    </li>
                  )
                })}
              </ul>
              {nivel !== 'comuna' && <em className="popup-tip">Acércate para ver más detalle</em>}
              <button className="btn-afecta" onClick={() => meAfecta?.(REGIONES_CL.some(([n]) => n === (p.subtitulo ?? p.titulo)) ? (p.subtitulo ?? p.titulo) : p.detalle.find((f) => f.region)?.region)}>Me afecta</button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
    </>
  )
}
