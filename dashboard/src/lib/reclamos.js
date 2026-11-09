import { supabase } from './supabase'

const SERVICIO = { internet_fijo: 'internet de hogar', internet_movil: 'internet móvil', tv: 'televisión', telefonia: 'telefonía' }
const DESDE = { recien: 'hace pocos minutos', '1h': 'hace aproximadamente 1 hora', '3h': 'hace 3 horas o más', ayer: 'desde ayer o antes' }

export const PORTAL_SUBTEL = 'https://tramites.subtel.gob.cl/atencionciudadana/Inicio'
export const DERECHOS_SUBTEL = 'https://www.subtel.gob.cl/derechos-del-usuario-en-materia-de-telecomunicaciones/'

// Texto del reclamo formal. Los datos personales quedan como campos para completar:
// OCN no los pide ni los guarda.
export function textoReclamo({ empresa, servicio, region, comuna, tipo, desde }, ahora = new Date()) {
  const fecha = ahora.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const problema = tipo === 'lento' ? 'lentitud y cortes intermitentes' : 'interrupción total'
  return `Señores ${empresa}:

Presento un reclamo por ${problema} del servicio de ${SERVICIO[servicio] ?? servicio} en ${comuna ? `${comuna}, ` : ''}región ${region}. El problema comenzó ${DESDE[desde] ?? 'recientemente'} (registrado el ${fecha} a las ${hora} h) y a la fecha no ha sido solucionado.

Solicito:
1. Restablecer el servicio a la brevedad.
2. Informarme el número de este reclamo y la causa de la falla.
3. Aplicar el descuento o la compensación que corresponda por el tiempo sin servicio, según la normativa vigente.

Titular: [Nombre completo]
RUT: [RUT]
N° de cliente o de servicio: [N°]
Dirección del servicio: [Dirección]
Teléfono o correo de contacto: [Contacto]

Atentamente,
[Nombre]`
}

export async function registrarReclamo({ empresa, servicio, region, tipo, desde, dispositivo }) {
  const { error } = await supabase.from('reclamos_ciudadanos').insert({ empresa, servicio, region, tipo, desde: desde ?? null, dispositivo })
  if (error) throw new Error(error.message)
}

export async function cargarReclamos(dias = 30) {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data, error } = await supabase.from('reclamos_ciudadanos').select('creado_en, empresa, region, tipo').gte('creado_en', desde).limit(10000)
  if (error) throw error
  return data ?? []
}
