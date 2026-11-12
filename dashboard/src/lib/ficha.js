import { supabase } from './supabase'
import { claveEmpresa } from './datos'
import { esTelecom } from './servicios'

// ---------- Ficha de una caída ----------
// Idea tomada del rastreador de cortes de Internet Society Pulse (una ficha por evento con inicio, fin,
// regiones, causa, alcance y verificación), aplicada a reclamos de consumidores en Chile:
// la ficha sirve como evidencia para adjuntar a un reclamo en SUBTEL.
// Todo sale de filas reales de reportes_caidas; nada se estima ni se rellena.

export const HORAS_FICHA = 24
const PAUSA_MAX_MIN = 60 // si pasan más de 60 min sin señales de falla, se considera otra caída
const BLOQUE_MIN = 15

export const NOMBRE_FUENTE = { geoblackout: 'Geoblackout', fallacl: 'FallaCL', ioda: 'IODA (Georgia Tech)', blackoutmap: 'Blackout Map', atlas: 'RIPE Atlas', ocn: 'Vecinos en OCN', downdetector: 'Downdetector', bluesky: 'Bluesky' }
const PERSONAS = new Set(['geoblackout', 'fallacl', 'ocn', 'bluesky', 'downdetector'])

export const slugEmpresa = (empresa) => claveEmpresa(empresa)
const tiempo = (f) => Date.parse(f.capturado_en ?? f.ventana)

// Historial de las últimas 24 h de una compañía en Chile (filas de todas las fuentes).
export async function cargarHistorial(slug, horas = HORAS_FICHA) {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('reportes_caidas')
    .select('id, fuente, pais, empresa, servicio, comuna, region, precision_geo, cantidad_reportes, gravedad, gravedad_texto, ventana, capturado_en, url_fuente')
    .gte('ventana', desde)
    .ilike('empresa', `${slug}%`)
    .order('ventana', { ascending: false })
    .limit(5000)
  if (error) throw error
  return data ?? []
}

// Arma la ficha de la caída más reciente de la compañía a partir de su historial.
export function armarFicha(slug, historial, extras = [], ahora = Date.now()) {
  const propias = [...historial, ...extras].filter((f) =>
    (f.pais ?? 'CL') === 'CL' && claveEmpresa(f.empresa) === slug && esTelecom(f) && f.empresa !== 'Red completa' && Number.isFinite(tiempo(f)))
  const nombre = propias[0]?.empresa?.split(/[\s(]+/)[0] ?? slug.toUpperCase()
  const fallas = propias.filter((f) => f.gravedad && f.gravedad !== 'normal').sort((a, b) => tiempo(b) - tiempo(a))
  if (fallas.length === 0) return { slug, nombre, hayFalla: false }

  // Episodio más reciente: se retrocede mientras las señales de falla estén a menos de 60 min entre sí.
  const episodio = [fallas[0]]
  for (let i = 1; i < fallas.length; i++) {
    if (tiempo(episodio[episodio.length - 1]) - tiempo(fallas[i]) > PAUSA_MAX_MIN * 60_000) break
    episodio.push(fallas[i])
  }
  const fin = tiempo(episodio[0])
  const inicio = tiempo(episodio[episodio.length - 1])
  const activa = ahora - fin <= PAUSA_MAX_MIN * 60_000
  const duracionMin = Math.max(0, Math.round(((activa ? ahora : fin) - inicio) / 60_000))

  // Lugares afectados
  const regiones = new Set()
  const comunas = new Set()
  let nacional = false
  for (const f of episodio) {
    if (f.region) regiones.add(f.region)
    if (f.comuna) comunas.add(f.comuna)
    if (f.precision_geo === 'pais') nacional = true
  }

  // Por fuente: cuántas veces marcó falla, su máximo de reportes, la última vez y su enlace.
  const fuentes = new Map()
  for (const f of episodio) {
    const e = fuentes.get(f.fuente) ?? { fuente: f.fuente, nombre: NOMBRE_FUENTE[f.fuente] ?? f.fuente, tipo: PERSONAS.has(f.fuente) ? 'personas' : 'red', senales: 0, maxReportes: 0, ultima: 0, url: null, texto: null }
    e.senales += 1
    e.maxReportes = Math.max(e.maxReportes, f.cantidad_reportes ?? 0)
    if (tiempo(f) > e.ultima) { e.ultima = tiempo(f); e.texto = f.gravedad_texto ?? null }
    e.url = e.url ?? f.url_fuente ?? null
    fuentes.set(f.fuente, e)
  }

  // Línea de tiempo por bloques de 15 min: en cada bloque se toma el último conteo de cada fuente y lugar
  // (las fuentes repiten la misma foto en cada consulta: sumar todas las fotos inflaría el número).
  const bloques = new Map()
  for (const f of episodio) {
    const b = Math.floor(tiempo(f) / (BLOQUE_MIN * 60_000))
    const k = `${f.fuente}|${f.comuna ?? ''}|${f.region ?? ''}`
    const m = bloques.get(b) ?? new Map()
    const previo = m.get(k)
    if (!previo || tiempo(f) > previo.t) m.set(k, { t: tiempo(f), n: f.cantidad_reportes ?? 0 })
    bloques.set(b, m)
  }
  const primero = Math.floor(inicio / (BLOQUE_MIN * 60_000))
  const ultimo = Math.floor((activa ? ahora : fin) / (BLOQUE_MIN * 60_000))
  const linea = []
  for (let b = Math.max(primero, ultimo - 95); b <= ultimo; b++) {
    const m = bloques.get(b)
    linea.push({ t: b * BLOQUE_MIN * 60_000, n: m ? sumarBloque(m) : 0, señal: !!m })
  }
  const pico = linea.reduce((a, x) => (x.n > a.n ? x : a), { n: 0, t: null })

  return {
    slug, nombre, hayFalla: true, activa, inicio, fin, duracionMin,
    regiones: [...regiones], comunas: [...comunas], nacional,
    fuentes: [...fuentes.values()].sort((a, b) => b.senales - a.senales),
    linea, pico, filas: episodio,
  }
}

// Suma de un bloque sin contar dos veces: si una fuente da un total nacional y además el detalle por lugar,
// se usa el mayor de los dos (no la suma).
function sumarBloque(m) {
  const porFuente = new Map()
  for (const [k, x] of m) {
    const [fuente, comuna, region] = k.split('|')
    const e = porFuente.get(fuente) ?? { nacional: 0, lugares: 0 }
    if (!comuna && !region) e.nacional = Math.max(e.nacional, x.n)
    else e.lugares += x.n
    porFuente.set(fuente, e)
  }
  return [...porFuente.values()].reduce((s, e) => s + Math.max(e.nacional, e.lugares), 0)
}

export function duracionTexto(min) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const fechaHora = (t) => new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })

export const urlFicha = (slug) => `${location.origin}/#caida/${slug}`

// Párrafo de evidencia para pegar en un reclamo. Sin datos personales; solo conteos con su fuente.
export function textoEvidenciaFicha(fi, verif, causa, ahora = Date.now()) {
  if (!fi?.hayFalla) return ''
  const lugares = fi.comunas.length ? `en ${fi.comunas.slice(0, 8).join(', ')}` : fi.regiones.length ? `en la(s) región(es) ${fi.regiones.slice(0, 8).join(', ')}` : 'a nivel país'
  const fuentes = fi.fuentes.map((f) => `${f.nombre}${f.maxReportes ? ` (hasta ${f.maxReportes} reportes)` : ''}`).join('; ')
  const estado = fi.activa ? `continuaba activa al ${fechaHora(ahora)} h` : `su última señal fue el ${fechaHora(fi.fin)} h`
  return `Evidencia del Observatorio Ciudadano de Redes (OCN): se registran señales de falla de ${fi.nombre} ${lugares} desde al menos el ${fechaHora(fi.inicio)} h; ${estado} (duración registrada: ${duracionTexto(fi.duracionMin)}). ` +
    `Fuentes independientes: ${fuentes}. Verificación OCN: ${verif?.confirmado ? `confirmada por ${verif.fuentes.size} fuentes` : 'sin confirmar (1 fuente)'}` +
    `${causa && causa.tipo !== 'personas' ? `. Causa probable según OCN: ${causa.texto.toLowerCase()} (${causa.evidencia.replace(/\.$/, '')})` : ''}. Ficha pública: ${urlFicha(fi.slug)}`
}
