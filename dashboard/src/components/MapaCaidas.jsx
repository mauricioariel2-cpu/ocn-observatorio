import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FUENTES_TOTALES, puntosRegion, verifDe } from '../lib/datos'
import { REGIONES_CL, VISTAS, nivelPorZoom } from '../lib/geo'

const SERVICIO = { internet_fijo: 'Internet hogar', internet_movil: 'Internet móvil', tv: 'TV', internet: 'Internet', telefonia_fija: 'Telefonía', streaming: 'Streaming', banca: 'Banca' }
const norm = (t) => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA (Georgia Tech)', blackoutmap: 'Blackout Map', atlas: 'RIPE Atlas', ocn: 'Vecinos en OCN', downdetector: 'Downdetector' }

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

function SeguirZoom({ alCambiar }) {
  const map = useMapEvents({ zoomend: () => alCambiar(map.getZoom()) })
  return null
}

export default function MapaCaidas({ comunas, paises, vista, nuevos, tri, meAfecta }) {
  const [zoom, setZoom] = useState(4)
  const nivel = nivelPorZoom(zoom)
  const puntos = useMemo(() => {
    if (nivel === 'pais') return paises
    // En la vista Chile solo se muestra Chile, para no confundir con países vecinos.
    const enVista = (p) => vista !== 'chile' || p.pais === 'CL'
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
  const iconos = useMemo(
    () => Object.fromEntries(puntos.map((p) => [p.id, icono(
      p,
      p.detalle.some((f) => nuevos.has(f.id)),
      p.detalle.some((f) => f.gravedad !== 'normal' && (verifDe(tri, f).confirmado || f.fuente === 'ioda')),
    )])),
    [puntos, nuevos, tri],
  )

  return (
    <>
    {puntos.length === 0 && (
      <div className="sin-caidas" role="status">
        <b>Sin caídas activas {vista === 'chile' ? 'en Chile' : 'en el mundo'}</b>
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
      {tranquilas.map(([nombre, lat, lon]) => (
        <CircleMarker key={nombre} center={[lat, lon]} radius={6} className="region-ok"
          pathOptions={{ color: '#34c759', fillColor: '#34c759', fillOpacity: 0.55, weight: 1.5 }}>
          <Tooltip direction="top">{nombre}: sin fallas reportadas ahora</Tooltip>
        </CircleMarker>
      ))}
      {puntos.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={iconos[p.id]}>
          <Popup>
            <div className="popup">
              <strong>{p.titulo}</strong>
              {p.subtitulo && <span className="popup-sub">{p.subtitulo}</span>}
              <div className="popup-total">{p.total ? `${p.total} reportes` : 'Caída medida en la red'}</div>
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
