import { REGIONES_CL } from './geo'

// ---------- Entorno: clima y sismos, para la causa probable ----------
// Clima actual por región: Open-Meteo (gratis para uso no comercial, sin clave; https://open-meteo.com).
// Sismos recientes: USGS (Servicio Geológico de EE.UU., datos de dominio público; https://earthquake.usgs.gov).
// Solo se usan para SUGERIR una causa, con su evidencia; nunca para afirmarla.

export const LLUVIA_FUERTE_MM = 1 // mm en los últimos 15 min (Open-Meteo entrega la lluvia de cada cuarto de hora), ~4 mm/h
export const RAFAGA_FUERTE_KMH = 60
export const SISMO_MIN = 5.5
const HORAS_SISMO = 6

export async function cargarClima() {
  const lat = REGIONES_CL.map(([, la]) => la).join(',')
  const lon = REGIONES_CL.map(([, , lo]) => lo).join(',')
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,wind_gusts_10m&wind_speed_unit=kmh&timezone=America%2FSantiago`)
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
  const j = await r.json()
  const lista = Array.isArray(j) ? j : [j]
  const porRegion = new Map()
  lista.forEach((x, i) => {
    const c = x.current ?? {}
    porRegion.set(REGIONES_CL[i][0], { lluvia: c.precipitation ?? 0, rafagas: c.wind_gusts_10m ?? 0, hora: c.time })
  })
  return porRegion
}

export async function cargarSismos() {
  const desde = new Date(Date.now() - HORAS_SISMO * 3600_000).toISOString().slice(0, 19)
  const r = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${desde}&minmagnitude=${SISMO_MIN}&minlatitude=-57&maxlatitude=-17&minlongitude=-80&maxlongitude=-65`)
  if (!r.ok) throw new Error(`USGS ${r.status}`)
  const j = await r.json()
  return (j.features ?? []).map((f) => ({
    mag: f.properties.mag, lugar: f.properties.place, hora: f.properties.time, url: f.properties.url,
    lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
  }))
}

const km = (a, b, c, d) => {
  const r = Math.PI / 180
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(x))
}

// Sismo que podría explicar una falla en una región: M ≥ 5,5 a menos de 300 km de su capital, o M ≥ 7 en cualquier parte de Chile.
export function sismoCerca(sismos, region) {
  const reg = REGIONES_CL.find(([n]) => n === region)
  return (sismos ?? []).filter((s) => s.mag >= 7 || (reg && km(reg[1], reg[2], s.lat, s.lon) < 300))
    .sort((a, b) => b.mag - a.mag)[0] ?? null
}

export function climaFuerte(clima, region) {
  const c = clima?.get?.(region)
  if (!c) return null
  return c.lluvia >= LLUVIA_FUERTE_MM || c.rafagas >= RAFAGA_FUERTE_KMH ? c : null
}
