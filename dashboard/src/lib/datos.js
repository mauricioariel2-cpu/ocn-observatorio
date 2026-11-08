import { supabase } from './supabase'

export const HORAS_VENTANA = 3
const ORDEN = { normal: 0, posibles_problemas: 1, falla_masiva: 2 }

export async function cargarReportes(horas = HORAS_VENTANA) {
  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('reportes_caidas')
    .select('empresa, servicio, comuna, region, cantidad_reportes, gravedad, gravedad_texto, latitud, longitud, precision_geo, fuente, ventana, url_fuente')
    .gte('ventana', desde)
    .order('ventana', { ascending: false })
    .limit(2000)
  if (error) throw error
  return data ?? []
}

// Se queda con la medición más reciente de cada (fuente, empresa, servicio, comuna).
function ultimos(filas) {
  const vistos = new Map()
  for (const f of filas) {
    const k = [f.fuente, f.empresa, f.servicio, f.comuna].join('|')
    if (!vistos.has(k)) vistos.set(k, f) // vienen ordenadas de más nueva a más vieja
  }
  return [...vistos.values()]
}

// Puntos del mapa: solo datos con comuna real, agrupados por coordenada.
export function puntosMapa(filas) {
  const porLugar = new Map()
  for (const f of ultimos(filas)) {
    if (f.precision_geo !== 'comuna' || f.latitud == null || f.longitud == null) continue
    const k = `${f.latitud},${f.longitud}`
    const p = porLugar.get(k) ?? { lat: f.latitud, lon: f.longitud, comuna: f.comuna, region: f.region, total: 0, gravedad: 'normal', empresas: [] }
    p.total += f.cantidad_reportes ?? 0
    if ((ORDEN[f.gravedad] ?? 0) > (ORDEN[p.gravedad] ?? 0)) p.gravedad = f.gravedad
    p.empresas.push(f)
    porLugar.set(k, p)
  }
  return [...porLugar.values()].filter((p) => p.gravedad !== 'normal').sort((a, b) => b.total - a.total)
}

// Estado nacional (Downdetector y totales de Geoblackout): va al panel, no al mapa,
// para no inventar un punto en Santiago.
export function estadoNacional(filas) {
  return ultimos(filas)
    .filter((f) => f.precision_geo === 'pais')
    .sort((a, b) => (ORDEN[b.gravedad] ?? 0) - (ORDEN[a.gravedad] ?? 0) || (b.cantidad_reportes ?? 0) - (a.cantidad_reportes ?? 0))
}
