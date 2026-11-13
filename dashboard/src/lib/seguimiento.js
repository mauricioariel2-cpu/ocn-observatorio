// Seguimiento de reclamos enviados. El número de reclamo y la fecha quedan SOLO en el
// celular de la persona (localStorage): OCN no los sube. Al servidor solo va, si la persona
// responde "¿te contestaron?", un resultado anónimo (empresa + resultado + días hábiles).
import { supabase } from './supabase'
// Las tablas de reclamos aún no incluyen TuVes ni Zapping: se guardan como "Otro" (el texto del reclamo sí lleva el nombre).
const EMPRESA_RECLAMO = new Set(['Movistar', 'Entel', 'VTR', 'Claro', 'WOM', 'GTD', 'Mundo', 'Telsur', 'Starlink', 'DIRECTV', 'Otro'])

const CLAVE = 'ocn-mis-reclamos'

// Plazos publicados (no los inventamos; las dos fuentes oficiales no coinciden):
// - ChileAtiende (ficha 3826): la empresa responde en máximo 5 días hábiles.
// - SUBTEL (derechos del usuario): 15 días hábiles si responde por correo electrónico, 20 por carta;
//   si no hay respuesta o no se resuelve, insistir en SUBTEL dentro de los 10 días hábiles siguientes.
export const PLAZO_CORTO = 5
export const PLAZO_LARGO = 15
export const FICHA_CHILEATIENDE = 'https://www.chileatiende.gob.cl/fichas/3826'

export function leerReclamos() {
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE) ?? '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

function guardar(lista) {
  try { localStorage.setItem(CLAVE, JSON.stringify(lista.slice(-20))) } catch { /* modo privado: no se recuerda */ }
}

export function agregarReclamo(r) {
  const nuevo = { id: crypto.randomUUID(), enviado: new Date().toISOString(), estado: 'esperando', ...r }
  guardar([...leerReclamos(), nuevo])
  return nuevo
}

export function actualizarReclamo(id, cambios) {
  guardar(leerReclamos().map((r) => (r.id === id ? { ...r, ...cambios } : r)))
}

export function borrarReclamo(id) {
  guardar(leerReclamos().filter((r) => r.id !== id))
}

// Días hábiles: lunes a viernes. No descuenta feriados, por eso la web dice "aprox.".
export function sumarHabiles(desde, n) {
  const d = new Date(desde)
  d.setHours(12, 0, 0, 0)
  let k = 0
  while (k < n) {
    d.setDate(d.getDate() + 1)
    const dia = d.getDay()
    if (dia !== 0 && dia !== 6) k++
  }
  return d
}

export function habilesEntre(desde, hasta = new Date()) {
  const d = new Date(desde)
  d.setHours(12, 0, 0, 0)
  const fin = new Date(hasta)
  fin.setHours(12, 0, 0, 0)
  let k = 0
  while (d < fin) {
    d.setDate(d.getDate() + 1)
    const dia = d.getDay()
    if (d <= fin && dia !== 0 && dia !== 6) k++
  }
  return k
}

export const fechaCorta = (d) => new Date(d).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })

// Reclamos que ya cumplieron el plazo corto y siguen sin resultado.
export function vencidos(lista = leerReclamos(), ahora = new Date()) {
  return lista.filter((r) => r.estado === 'esperando' && habilesEntre(r.enviado, ahora) >= PLAZO_CORTO)
}

export function pendientes(lista = leerReclamos(), ahora = new Date()) {
  return lista.filter((r) => r.estado === 'esperando' && habilesEntre(r.enviado, ahora) < PLAZO_CORTO)
}

// Recordatorio de calendario (.ics) que la persona descarga y agrega a su propio calendario.
export function archivoCalendario(r) {
  const p = (n) => String(n).padStart(2, '0')
  const dia = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const evento = (d, titulo, desc, n) => [
    'BEGIN:VEVENT',
    `UID:${r.id}-${n}@ocn-chile`,
    `DTSTAMP:${sello}`,
    `DTSTART;VALUE=DATE:${dia(d)}`,
    `DTEND;VALUE=DATE:${dia(sumarHabiles(d, 1))}`,
    `SUMMARY:${titulo}`,
    `DESCRIPTION:${desc.replace(/\n/g, '\\n').replace(/,/g, '\\,')}`,
    'BEGIN:VALARM', 'TRIGGER:PT10H', 'ACTION:DISPLAY', `DESCRIPTION:${titulo}`, 'END:VALARM',
    'END:VEVENT',
  ]
  const folio = r.folio ? ` N° ${r.folio}` : ''
  const abrir = `Abre ${location.origin} y el asistente te arma la insistencia ante SUBTEL.`
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OCN//Reclamos//ES', 'CALSCALE:GREGORIAN',
    ...evento(sumarHabiles(r.enviado, PLAZO_CORTO), `¿Respondió ${r.empresa} tu reclamo${folio}?`,
      `Se cumplen ${PLAZO_CORTO} días hábiles (aprox.) desde que reclamaste a ${r.empresa}. ${abrir}`, 1),
    ...evento(sumarHabiles(r.enviado, PLAZO_LARGO), `Último aviso: reclamo${folio} a ${r.empresa}`,
      `Se cumplen ${PLAZO_LARGO} días hábiles (aprox.). Si no te solucionaron, insiste en SUBTEL. ${abrir}`, 2),
    'END:VCALENDAR',
  ].join('\r\n')
  return new Blob([ics], { type: 'text/calendar;charset=utf-8' })
}

export function descargarCalendario(r) {
  const url = URL.createObjectURL(archivoCalendario(r))
  const a = document.createElement('a')
  a.href = url
  a.download = `recordatorio-reclamo-${r.empresa.toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Compensación según SUBTEL: corte de más de 3 días seguidos → 3 veces el cargo fijo diario
// por cada día. El cargo diario se aproxima como el cargo fijo mensual / 30.
export function compensacion(cargoMensual, dias) {
  const diario = cargoMensual / 30
  return { diario, total: dias > 3 ? Math.round(3 * diario * dias) : 0 }
}

export const pesos = (n) => `$${Math.round(n).toLocaleString('es-CL')}`

// Texto para insistir ante SUBTEL (segunda instancia), con el número de reclamo de la empresa.
export function textoInsistencia(r, { motivo, cargoMensual, dias } = {}) {
  const fecha = new Date(r.enviado).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const transcurridos = habilesEntre(r.enviado)
  const porQue = motivo === 'sin_respuesta'
    ? `Han transcurrido ${transcurridos} días hábiles y la empresa no ha respondido.`
    : 'La empresa respondió, pero no solucionó el problema ni ofreció la compensación que corresponde.'
  const comp = cargoMensual && dias > 3
    ? `\n3. Ordenar el pago de la indemnización por los ${dias} días seguidos sin servicio: 3 veces el cargo fijo diario por día (cargo fijo mensual ${pesos(cargoMensual)}; aprox. ${pesos(compensacion(cargoMensual, dias).total)}).`
    : '\n3. Ordenar el descuento o la compensación que corresponda por el tiempo sin servicio.'
  return `A la Subsecretaría de Telecomunicaciones (SUBTEL):

Insisto en mi reclamo contra ${r.empresa} por ${r.tipo === 'lento' ? 'lentitud y cortes intermitentes' : 'interrupción'} del servicio de ${r.servicioTexto ?? 'telecomunicaciones'} en ${r.comuna ? `${r.comuna}, ` : ''}región ${r.region}.

Presenté el reclamo a la empresa el ${fecha}${r.folio ? ` con el número ${r.folio}` : ''}${r.canal ? ` (canal: ${r.canal})` : ''}. ${porQue}

Solicito:
1. Que SUBTEL acoja este reclamo y ordene a ${r.empresa} restablecer el servicio de forma definitiva.
2. Que la empresa informe la causa y la duración de la falla.${comp}

Titular: [Nombre completo]
RUT: [RUT]
N° de cliente o de servicio: [N°]
Dirección del servicio: [Dirección]
Teléfono o correo de contacto: [Contacto]

Adjunto: respuesta de la empresa (si la hubo) y evidencia del corte.

Atentamente,
[Nombre]`
}

// Resultado anónimo para el contador público "¿responden las compañías?" (sql/011).
export async function registrarResultado({ empresa, resultado, dias_habiles, dispositivo }) {
  const { error } = await supabase.from('reclamos_resultados').insert({ empresa: EMPRESA_RECLAMO.has(empresa) ? empresa : 'Otro', resultado, dias_habiles, dispositivo })
  if (error) throw new Error(error.message)
}

export async function cargarResultados(dias = 90) {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data, error } = await supabase.from('reclamos_resultados').select('creado_en, empresa, resultado, dias_habiles').gte('creado_en', desde).limit(10000)
  if (error) throw error
  return data ?? []
}
