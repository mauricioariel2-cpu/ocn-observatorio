import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { puntosRegion } from '../lib/datos'
import { VISTAS, nivelPorZoom } from '../lib/geo'

const SERVICIO = { internet_fijo: 'Internet hogar', internet_movil: 'Internet móvil', tv: 'TV', internet: 'Internet', telefonia_fija: 'Telefonía' }

function diametro(total) {
  return Math.round(Math.min(30 + Math.sqrt(total) * 7, 92))
}

function icono(p, nuevo) {
  const d = diametro(p.total)
  const clases = ['burbuja', p.gravedad, nuevo ? 'nuevo' : ''].join(' ')
  return L.divIcon({
    className: 'burbuja-wrap',
    html: `<div class="${clases}" style="width:${d}px;height:${d}px;font-size:${Math.max(12, d / 3.2)}px"><span>${p.total}</span></div>`,
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

export default function MapaCaidas({ comunas, paises, vista, nuevos }) {
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
  const iconos = useMemo(
    () => Object.fromEntries(puntos.map((p) => [p.id, icono(p, p.detalle.some((f) => nuevos.has(f.id)))])),
    [puntos, nuevos],
  )

  return (
    <MapContainer
      whenReady={(e) => setZoom(e.target.getZoom())}
      bounds={VISTAS.chile.bounds}
      minZoom={2}
      maxBounds={[[-85, -240], [85, 240]]}
      worldCopyJump
      className="mapa"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />
      <ZoomControl position="bottomright" />
      <Camara vista={vista} />
      <SeguirZoom alCambiar={setZoom} />
      {puntos.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={iconos[p.id]}>
          <Popup>
            <div className="popup">
              <strong>{p.titulo}</strong>
              {p.subtitulo && <span className="popup-sub">{p.subtitulo}</span>}
              <div className="popup-total">{p.total} reportes · últimas 3 h</div>
              <ul>
                {p.detalle.map((e) => (
                  <li key={e.id ?? e.hash_dedup}>
                    <b>{e.empresa}</b> {e.comuna && nivel !== 'comuna' ? `· ${e.comuna} ` : ''}
                    · {SERVICIO[e.servicio] ?? e.servicio ?? 's/i'}: {e.cantidad_reportes ?? '–'}
                  </li>
                ))}
              </ul>
              {nivel !== 'comuna' && <em className="popup-tip">Acércate para ver más detalle</em>}
              <button className="btn-afecta" disabled title="Llega con el motor de reclamos">Me afecta</button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
