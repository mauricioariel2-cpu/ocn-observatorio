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

// Las 16 regiones de Chile (centro aproximado en su capital), para mostrar
// también las zonas vigiladas que hoy no tienen fallas.
export const REGIONES_CL = [
  ['Arica y Parinacota', -18.4783, -70.3126], ['Tarapacá', -20.2133, -70.1503],
  ['Antofagasta', -23.6509, -70.3975], ['Atacama', -27.3668, -70.3314],
  ['Coquimbo', -29.9027, -71.2519], ['Valparaíso', -33.0472, -71.6127],
  ['Metropolitana', -33.4489, -70.6693], ["O'Higgins", -34.1708, -70.7444],
  ['Maule', -35.4264, -71.6554], ['Ñuble', -36.6066, -72.1034],
  ['Biobío', -36.827, -73.0503], ['Araucanía', -38.7359, -72.5904],
  ['Los Ríos', -39.8142, -73.2459], ['Los Lagos', -41.4689, -72.9411],
  ['Aysén', -45.5712, -72.0685], ['Magallanes', -53.1638, -70.9171],
]
