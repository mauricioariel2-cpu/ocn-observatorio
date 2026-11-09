import { feature } from 'topojson-client'
import { supabase } from './supabase'

// Semáforo mundial: estado de internet de cada país (tabla estado_paises, sql/012).
// Lo llena el recolector cada 15 min con Blackout Map, que combina sus sondas con IODA (Georgia Tech).
export async function cargarEstadoPaises() {
  const { data, error } = await supabase
    .from('estado_paises')
    .select('cc, iso_num, nombre, estado, detalle, desde, url_fuente, actualizado')
  if (error) throw error
  return data ?? []
}

// Contornos de países (Natural Earth 1:110m vía world-atlas, dominio público). Se cargan solo en la vista Mundo.
let contornos
export async function cargarContornos() {
  if (!contornos) {
    const topo = (await import('world-atlas/countries-110m.json')).default
    contornos = feature(topo, topo.objects.countries)
    // Países que cruzan el meridiano 180 (Rusia, Fiyi): se corren al mismo lado para que no dibujen una franja.
    for (const f of contornos.features) {
      const g = f.geometry
      if (!g) continue
      const poligonos = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      for (const anillos of poligonos) for (const anillo of anillos) {
        const lons = anillo.map((c) => c[0])
        if (Math.max(...lons) - Math.min(...lons) > 180) for (const c of anillo) if (c[0] < 0) c[0] += 360
      }
    }
  }
  return contornos
}

const nombres = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['es'], { type: 'region' }) : null
export function nombrePais(cc, respaldo) {
  try { return nombres?.of(cc) ?? respaldo ?? cc } catch { return respaldo ?? cc }
}

export const COLOR_ESTADO = {
  normal: '#34c759',
  posibles_problemas: '#ffcc00',
  falla_masiva: '#ff3b30',
  sin_datos: '#8e8e93',
}

export const TEXTO_ESTADO = {
  normal: 'Internet funcionando normal',
  posibles_problemas: 'Posibles problemas',
  falla_masiva: 'Caída de internet',
  sin_datos: 'Sin datos suficientes',
}
