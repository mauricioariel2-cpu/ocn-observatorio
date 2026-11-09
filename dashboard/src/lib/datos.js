import { supabase } from './supabase'
import { PAISES } from './geo'

export const HORAS_VENTANA = 3
const ORDEN = { normal: 0, posibles_problemas: 1, falla_masiva: 2 }
const peor = (a, b) => ((ORDEN[b] ?? 0) > (ORDEN[a] ?? 0) ? b : a)
const paisDe = (f) => f.pais ?? 'CL' // filas antiguas no traen país: son de Chile

export function desdeISO(horas = HORAS_VENTANA) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString()
}

export async function cargarReportes(horas = HORAS_VENTANA) {
  const { data, error } = await supabase
    .from('reportes_caidas')
    .select('*')
    .gte('ventana', desdeISO(horas))
    .order('ventana', { ascending: false })
    .limit(5000)
  if (error) throw error
  return data ?? []
}

// Escucha inserciones nuevas en vivo. Devuelve la función para desuscribirse.
export function escucharNuevos(alLlegar, alCambiarEstado) {
  const canal = supabase
    .channel('reportes-en-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reportes_caidas' }, (p) => alLlegar(p.new))
    .subscribe((estado) => alCambiarEstado?.(estado))
  return () => supabase.removeChannel(canal)
}

// Une filas nuevas con las existentes (sin duplicar) y descarta las viejas.
export function mezclar(actuales, nuevas, horas = HORAS_VENTANA) {
  const limite = desdeISO(horas)
  const porId = new Map(actuales.map((f) => [f.id ?? f.hash_dedup, f]))
  for (const f of nuevas) porId.set(f.id ?? f.hash_dedup, f)
  return [...porId.values()]
    .filter((f) => f.ventana >= limite)
    .sort((a, b) => (a.ventana < b.ventana ? 1 : -1))
}

// La medición más reciente de cada (fuente, país, empresa, servicio, comuna).
function ultimos(filas) {
  const vistos = new Map()
  for (const f of filas) {
    const k = [f.fuente, paisDe(f), f.empresa, f.servicio, f.comuna, f.region, f.precision_geo].join('|')
    if (!vistos.has(k)) vistos.set(k, f)
  }
  return [...vistos.values()]
}

// Círculos por lugar (zoom cercano): comunas (Geoblackout) y regiones (FallaCL).
const CON_LUGAR = new Set(['comuna', 'region'])
export function puntosComuna(filas) {
  const porLugar = new Map()
  for (const f of ultimos(filas)) {
    if (!CON_LUGAR.has(f.precision_geo) || f.latitud == null || f.longitud == null) continue
    const k = `${f.latitud},${f.longitud}`
    const p = porLugar.get(k) ?? {
      id: k, lat: f.latitud, lon: f.longitud, titulo: f.comuna ?? f.region, subtitulo: f.region,
      pais: paisDe(f), total: 0, gravedad: 'normal', detalle: [],
    }
    p.total += f.cantidad_reportes ?? 0
    p.gravedad = peor(p.gravedad, f.gravedad)
    p.detalle.push(f)
    porLugar.set(k, p)
  }
  // Se muestran los lugares con falla y también los que tienen reportes aunque sean pocos.
  return [...porLugar.values()].filter((p) => p.gravedad !== 'normal' || p.total > 0).sort((a, b) => b.total - a.total)
}

// Agrupa las comunas por región (centro = promedio de sus comunas).
export function puntosRegion(comunas) {
  const porRegion = new Map()
  for (const c of comunas) {
    const k = `${c.pais}|${c.subtitulo ?? c.titulo}`
    const r = porRegion.get(k) ?? { id: k, latSum: 0, lonSum: 0, n: 0, titulo: c.subtitulo ?? c.titulo, subtitulo: null, pais: c.pais, total: 0, gravedad: 'normal', detalle: [] }
    r.latSum += c.lat; r.lonSum += c.lon; r.n += 1
    r.total += c.total
    r.gravedad = peor(r.gravedad, c.gravedad)
    r.detalle.push(...c.detalle)
    porRegion.set(k, r)
  }
  return [...porRegion.values()]
    .map(({ latSum, lonSum, n, ...r }) => ({ ...r, lat: latSum / n, lon: lonSum / n, subtitulo: n > 1 ? `${n} comunas` : r.detalle[0]?.comuna }))
    .sort((a, b) => b.total - a.total)
}

// Burbujas por país (zoom lejano / vista mundo). Suma totales nacionales;
// si un país no tiene total nacional, suma sus comunas.
export function puntosPais(filas) {
  const porPais = new Map()
  const recientes = ultimos(filas)
  for (const f of recientes) {
    const cod = paisDe(f)
    const info = PAISES[cod]
    if (!info) continue
    const p = porPais.get(cod) ?? {
      id: cod, lat: info.centro[0], lon: info.centro[1], titulo: info.nombre, subtitulo: null,
      pais: cod, totalNacional: 0, totalComunas: 0, gravedad: 'normal', detalle: [],
    }
    if (f.precision_geo === 'pais') p.totalNacional += f.cantidad_reportes ?? 0
    if (CON_LUGAR.has(f.precision_geo)) p.totalComunas += f.cantidad_reportes ?? 0
    p.gravedad = peor(p.gravedad, f.gravedad)
    p.detalle.push(f)
    porPais.set(cod, p)
  }
  return [...porPais.values()]
    .map((p) => ({ ...p, total: p.totalNacional || p.totalComunas }))
    .filter((p) => p.total > 0 && p.gravedad !== 'normal')
    .sort((a, b) => b.total - a.total)
}

// Estado nacional por empresa, para el panel.
export function estadoNacional(filas, pais = 'CL') {
  return ultimos(filas)
    .filter((f) => f.precision_geo === 'pais' && paisDe(f) === pais)
    .sort((a, b) => (ORDEN[b.gravedad] ?? 0) - (ORDEN[a.gravedad] ?? 0) || (b.cantidad_reportes ?? 0) - (a.cantidad_reportes ?? 0))
}

// ---------- Triangulación ----------
// Una falla de una empresa se considera CONFIRMADA solo si al menos dos fuentes
// independientes la reportan (gravedad distinta de normal) en la misma ventana reciente.
// Con una sola fuente se muestra como "sin confirmar". Nunca se inventan datos:
// todo lo que se ve sale de filas reales de reportes_caidas, con su enlace de origen.
export const MIN_FUENTES = 2
export const FUENTES_TOTALES = 6 // Geoblackout, FallaCL, IODA, Blackout Map, RIPE Atlas, OCN (vecinos)
const VENTANA_CRUCE_MIN = 60

export function claveEmpresa(nombre) {
  return String(nombre ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().split(/[\s(]+/)[0] // "DIRECTV GO" y "DIRECTV" -> "directv"
}

export function triangular(filas, ahora = Date.now()) {
  const limite = ahora - VENTANA_CRUCE_MIN * 60_000
  const porEmpresa = new Map()
  for (const f of filas) {
    if (f.gravedad === 'normal' || !f.gravedad) continue
    if (f.empresa === 'Red completa') continue // medición de toda la red, no de una empresa
    const t = Date.parse(f.capturado_en ?? f.ventana)
    if (Number.isFinite(t) && t < limite) continue
    const k = `${paisDe(f)}|${claveEmpresa(f.empresa)}`
    const e = porEmpresa.get(k) ?? { empresa: f.empresa, pais: paisDe(f), fuentes: new Set() }
    e.fuentes.add(f.fuente)
    porEmpresa.set(k, e)
  }
  for (const e of porEmpresa.values()) e.confirmado = e.fuentes.size >= MIN_FUENTES
  return porEmpresa
}

export function verifDe(tri, f) {
  return tri.get(`${paisDe(f)}|${claveEmpresa(f.empresa)}`) ?? { fuentes: new Set(), confirmado: false }
}

// ---------- Reportes propios de OCN (botón "Me afecta") ----------
export async function cargarVecinos(horas = HORAS_VENTANA) {
  const { data, error } = await supabase
    .from('reportes_usuarios')
    .select('id, creado_en, empresa, servicio, region, comuna, tipo, empresa_detectada')
    .gte('creado_en', desdeISO(horas))
    .order('creado_en', { ascending: false })
    .limit(5000)
  if (error) throw error
  return data ?? []
}

export async function enviarReporte(reporte) {
  const { error } = await supabase.from('reportes_usuarios').insert(reporte)
  if (error) throw new Error(error.message)
}

// Agrupa los reportes de vecinos por empresa, servicio y región, como filas
// con el mismo formato que reportes_caidas (fuente "ocn"). Se cuentan, no se estiman.
export function resumirVecinos(vecinos, centros) {
  const grupos = new Map()
  for (const v of vecinos) {
    const k = [v.empresa, v.servicio, v.region].join('|')
    const g = grupos.get(k) ?? { ...v, n: 0, comunas: new Set(), ultimo: v.creado_en }
    g.n += 1
    if (v.tipo === 'lento') g.lentos = (g.lentos ?? 0) + 1
    if (v.comuna) g.comunas.add(v.comuna)
    if (v.creado_en > g.ultimo) g.ultimo = v.creado_en
    grupos.set(k, g)
  }
  return [...grupos.entries()].map(([k, g]) => {
    const c = centros[g.region]
    return {
      id: `ocn|${k}`, hash_dedup: `ocn|${k}`, fuente: 'ocn', pais: 'CL', empresa: g.empresa, servicio: g.servicio,
      comuna: null, region: g.region, latitud: c?.[0] ?? null, longitud: c?.[1] ?? null, precision_geo: 'region',
      cantidad_reportes: g.n, gravedad: g.n >= 5 ? 'falla_masiva' : g.n >= 2 ? 'posibles_problemas' : 'normal',
      gravedad_texto: `${g.n} vecino(s) reportaron en OCN en las últimas ${HORAS_VENTANA} h` +
        (g.lentos ? ` · ${g.n - g.lentos} sin servicio, ${g.lentos} lento` : '') +
        (g.comunas.size ? ` (${[...g.comunas].slice(0, 5).join(', ')})` : ''),
      ventana: g.ultimo, capturado_en: g.ultimo, url_fuente: null,
    }
  })
}

// Semáforo de las 16 regiones: rojo (falla masiva), amarillo (posibles problemas),
// verde (normal: sin reportes o solo reportes aislados). Todo sale de los datos reales.
const sinTilde = (t) => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function semaforoRegiones(comunas, regiones, tri) {
  return regiones.map(([nombre]) => {
    const enRegion = comunas.filter((c) => c.pais === 'CL' && sinTilde(c.subtitulo ?? c.titulo) === sinTilde(nombre))
    const detalle = enRegion.flatMap((c) => c.detalle)
    const gravedad = enRegion.reduce((g, c) => peor(g, c.gravedad), 'normal')
    const porEmpresa = new Map()
    for (const f of detalle) porEmpresa.set(f.empresa, (porEmpresa.get(f.empresa) ?? 0) + (f.cantidad_reportes ?? 0))
    const principales = [...porEmpresa].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([e, n]) => `${e} ${n}`)
    const confirmado = detalle.some((f) => f.gravedad !== 'normal' && (verifDe(tri, f).confirmado || f.fuente === 'ioda'))
    return { nombre, gravedad, total: enRegion.reduce((s, c) => s + c.total, 0), principales, confirmado }
  }).sort((a, b) => ORDEN[b.gravedad] - ORDEN[a.gravedad] || b.total - a.total)
}

// "No eres el único": cuántos vecinos reportaron la misma compañía en la misma región
// en la última hora, y cuántos reportes registran las otras fuentes ahí. Solo conteos reales.
export function contarSimilares(vecinos, filas, empresa, region) {
  const hace1h = Date.now() - 3600 * 1000
  const r = sinTilde(region)
  const k = claveEmpresa(empresa)
  const enOcn = vecinos.filter((v) => v.empresa === empresa && sinTilde(v.region) === r && Date.parse(v.creado_en) > hace1h).length
  const externas = ultimos(filas).filter((f) => f.fuente !== 'ocn' && sinTilde(f.region) === r && claveEmpresa(f.empresa) === k)
  const otras = externas.reduce((s, f) => s + (f.cantidad_reportes ?? 0), 0)
  // Desglose por fuente, para citar la evidencia en el reclamo.
  const porFuente = {}
  for (const f of externas) if (f.cantidad_reportes > 0) porFuente[f.fuente] = (porFuente[f.fuente] ?? 0) + f.cantidad_reportes
  return { enOcn, otras, porFuente }
}

// ---------- Coincidencias internacionales ----------
// Una misma compañía con reportes de personas (no mediciones de red) en 2 o más países a la vez.
const FUENTES_PERSONAS = new Set(['geoblackout', 'fallacl', 'ocn', 'bluesky'])
export function coincidencias(filas) {
  const porEmpresa = new Map()
  for (const f of ultimos(filas)) {
    if (!FUENTES_PERSONAS.has(f.fuente) || f.empresa === 'Red completa' || f.gravedad === 'normal' || !f.gravedad) continue
    const k = claveEmpresa(f.empresa)
    if (!k || k === 'otro') continue
    const e = porEmpresa.get(k) ?? { empresa: f.empresa.split(/[\s(]+/)[0], paises: new Map() }
    const p = e.paises.get(paisDe(f)) ?? { reportes: 0, lugares: new Set(), fuentes: new Set() }
    p.reportes += f.cantidad_reportes ?? 0
    if (f.comuna || f.region) p.lugares.add(f.comuna ?? f.region)
    p.fuentes.add(f.fuente)
    e.paises.set(paisDe(f), p)
    porEmpresa.set(k, e)
  }
  return [...porEmpresa.values()].filter((e) => e.paises.size >= 2)
    .sort((a, b) => b.paises.size - a.paises.size)
}
