// Vistas del mapa y centroides de países (lat, lon) para las burbujas por país.
// Agrega países aquí a medida que el recolector los cubra.

export const VISTAS = {
  chile: { nombre: 'Chile', bounds: [[-56.0, -76.0], [-17.4, -66.4]] },
  mundo: { nombre: 'Mundo', centro: [20, 0], zoom: 2 },
}

// Niveles de detalle según el zoom: país (mundo) → región → comuna.
export const ZOOM_REGION = 3
export const ZOOM_COMUNA = 8

export function nivelPorZoom(zoom) {
  if (zoom >= ZOOM_COMUNA) return 'comuna'
  if (zoom >= ZOOM_REGION) return 'region'
  return 'pais'
}

export const PAISES = {
  CL: { nombre: 'Chile', centro: [-35.7, -71.5] },
  AR: { nombre: 'Argentina', centro: [-34.6, -64.0] },
  PE: { nombre: 'Perú', centro: [-9.2, -75.0] },
  BO: { nombre: 'Bolivia', centro: [-16.3, -63.6] },
  CO: { nombre: 'Colombia', centro: [4.6, -74.1] },
  MX: { nombre: 'México', centro: [23.6, -102.5] },
  BR: { nombre: 'Brasil', centro: [-14.2, -51.9] },
  ES: { nombre: 'España', centro: [40.4, -3.7] },
  US: { nombre: 'Estados Unidos', centro: [39.8, -98.6] },
}
