import { claveEmpresa, verifDe } from './datos'
import { esTelecom } from './servicios'

// ---------- Causa probable de una caída ----------
// Idea inspirada en el Centro de caídas de Cloudflare Radar, que etiqueta cada caída con su causa y su alcance.
// Aquí NUNCA se afirma una causa: se dice cuál es la más probable según datos reales que ya tiene el OCN,
// y se cita la evidencia. Orden de prioridad:
//   1. Corte de luz informado por la SEC en la misma comuna (o en la misma región, con menos certeza).
//   2. Sondas dentro de la red de la compañía (IODA, Blackout Map, RIPE Atlas) que miden la caída.
//   3. Solo reportes de personas: causa sin determinar.

const sinTilde = (t) => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const MEDICIONES = new Set(['ioda', 'blackoutmap', 'atlas', 'cloudflare'])
const NOMBRE_MEDICION = { ioda: 'IODA', blackoutmap: 'Blackout Map', atlas: 'RIPE Atlas', cloudflare: 'Cloudflare Radar' }
const fmt = (n) => n.toLocaleString('es-CL')
// En la región se exige un corte relevante para sugerirlo como causa (un poste aislado no explica una falla regional).
export const MIN_CLIENTES_REGION = 5000
// Un corte de luz solo explica fallas de servicios de telecomunicaciones (internet, TV, telefonía),
// no de aplicaciones como bancos, streaming o correo, que funcionan desde servidores lejanos.


// Índice de cortes de luz SEC por comuna y por región.
export function indiceLuz(luz = []) {
  const comuna = new Map()
  const region = new Map()
  for (const c of luz) {
    comuna.set(sinTilde(c.comuna), c)
    const k = sinTilde(c.region)
    const r = region.get(k) ?? { clientes: 0, comunas: 0 }
    r.clientes += c.clientes
    r.comunas += 1
    region.set(k, r)
  }
  return { comuna, region }
}

// Filas de medición de red (no de personas) con falla, por compañía.
function medicionesConFalla(filas, empresa) {
  const k = claveEmpresa(empresa)
  return filas.filter((f) => MEDICIONES.has(f.fuente) && f.gravedad && f.gravedad !== 'normal' &&
    f.empresa !== 'Red completa' && claveEmpresa(f.empresa) === k)
}

// Causa probable de UNA fila (una compañía en un lugar).
// Devuelve { tipo: 'luz' | 'luz_region' | 'red' | 'personas', texto, evidencia } o null si la fila no es una falla.
export function causaDeFila(f, filas, idx, tri) {
  if (!f || !f.gravedad || f.gravedad === 'normal') return null
  if ((f.pais ?? 'CL') === 'CL' && esTelecom(f)) {
    const enComuna = f.comuna ? idx.comuna.get(sinTilde(f.comuna)) : null
    if (enComuna) {
      return {
        tipo: 'luz',
        texto: 'Probable corte de luz',
        evidencia: `La SEC informa ${fmt(enComuna.clientes)} clientes sin luz en ${enComuna.comuna}.`,
      }
    }
    const enRegion = f.region ? idx.region.get(sinTilde(f.region)) : null
    if (enRegion && enRegion.clientes >= MIN_CLIENTES_REGION) {
      return {
        tipo: 'luz_region',
        texto: 'Podría ser un corte de luz',
        evidencia: `La SEC informa ${fmt(enRegion.clientes)} clientes sin luz en ${enRegion.comunas} comuna(s) de la región ${f.region}.`,
      }
    }
  }
  const red = MEDICIONES.has(f.fuente) ? [f] : medicionesConFalla(filas, f.empresa)
  if (red.length > 0) {
    const fuentes = [...new Set(red.map((x) => NOMBRE_MEDICION[x.fuente] ?? x.fuente))]
    return {
      tipo: 'red',
      texto: 'Falla en la red de la compañía',
      evidencia: `Lo miden sondas independientes (${fuentes.join(', ')}), no solo reportes de personas.`,
    }
  }
  const v = verifDe(tri, f)
  return {
    tipo: 'personas',
    texto: 'Causa sin determinar',
    evidencia: v.confirmado
      ? `Lo reportan ${v.fuentes.size} fuentes de personas; ninguna medición de red ni corte de luz lo explica todavía.`
      : 'Por ahora solo hay reportes de personas en una fuente.',
  }
}

// Alcance de la falla de una compañía: en cuántas regiones de Chile tiene reportes con falla.
export function alcance(filas, empresa, pais = 'CL') {
  const k = claveEmpresa(empresa)
  const regiones = new Set()
  let nacional = false
  for (const f of filas) {
    if ((f.pais ?? 'CL') !== pais || claveEmpresa(f.empresa) !== k || !f.gravedad || f.gravedad === 'normal') continue
    if (f.region) regiones.add(sinTilde(f.region))
    if (f.precision_geo === 'pais') nacional = true
  }
  if (regiones.size >= 3) return { tipo: 'nacional', texto: `En ${regiones.size} regiones` }
  if (regiones.size >= 1) return { tipo: 'regional', texto: regiones.size === 1 ? 'En 1 región' : `En ${regiones.size} regiones` }
  if (nacional) return { tipo: 'nacional', texto: 'A nivel país (sin detalle por región)' }
  return null
}

// Causa más probable para un punto del mapa (varias filas): la de mayor prioridad entre sus fallas.
const PRIORIDAD = { luz: 4, red: 3, luz_region: 2, personas: 1 }
export function causaDePunto(detalle, filas, idx, tri) {
  let mejor = null
  for (const f of detalle) {
    const c = causaDeFila(f, filas, idx, tri)
    if (c && (!mejor || PRIORIDAD[c.tipo] > PRIORIDAD[mejor.tipo])) mejor = c
  }
  return mejor
}

// Causa probable por compañía, para el panel de verificación cruzada.
export function causaDeEmpresa(empresa, pais, filas, idx, tri) {
  const k = claveEmpresa(empresa)
  const propias = filas.filter((f) => (f.pais ?? 'CL') === pais && claveEmpresa(f.empresa) === k)
  const conLugar = propias.filter((f) => f.comuna || f.region)
  // Si la mayoría de los lugares con falla tiene corte de luz, se sugiere luz; si no, se evalúa la red.
  const causas = conLugar.map((f) => causaDeFila(f, filas, idx, tri)).filter(Boolean)
  const conLuz = causas.filter((c) => c.tipo === 'luz' || c.tipo === 'luz_region')
  if (causas.length > 0 && conLuz.length * 2 > causas.length) {
    const base = conLuz.find((c) => c.tipo === 'luz') ?? conLuz[0]
    return { ...base, evidencia: `${conLuz.length} de ${causas.length} lugares con falla tienen cortes de luz informados por la SEC.` }
  }
  // La luz no explica la mayoría: se evalúa la red y los reportes, sin considerar la luz.
  return causaDePunto(propias, filas, indiceLuz([]), tri)
}

export const ICONO_CAUSA = { luz: '⚡', luz_region: '⚡', red: '📡', personas: '👥' }
