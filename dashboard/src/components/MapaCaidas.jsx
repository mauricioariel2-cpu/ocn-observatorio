import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const COLOR = { falla_masiva: '#d7191c', posibles_problemas: '#f28c28' }

function radio(total) {
  return Math.min(8 + Math.sqrt(total) * 4, 40)
}

export default function MapaCaidas({ puntos }) {
  return (
    <MapContainer center={[-33.45, -70.66]} zoom={10} minZoom={4} className="mapa" worldCopyJump>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {puntos.map((p) => (
        <CircleMarker
          key={`${p.lat},${p.lon}`}
          center={[p.lat, p.lon]}
          radius={radio(p.total)}
          pathOptions={{ color: COLOR[p.gravedad], fillColor: COLOR[p.gravedad], fillOpacity: 0.55, weight: 2 }}
        >
          <Tooltip>{p.comuna}: {p.total} reportes</Tooltip>
          <Popup>
            <strong>{p.comuna}</strong>{p.region ? `, ${p.region}` : ''}
            <ul className="popup-lista">
              {p.empresas.map((e) => (
                <li key={`${e.fuente}-${e.empresa}-${e.servicio}`}>
                  {e.empresa} · {e.servicio ?? 'servicio s/i'}: <b>{e.cantidad_reportes}</b> ({e.gravedad_texto})
                </li>
              ))}
            </ul>
            <button className="btn-afecta" disabled title="Llega en la fase del motor de reclamos">
              Me afecta
            </button>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
