// Ley 21.719: consentimiento informado y derechos de la persona (acceso, portabilidad,
// supresión) sobre lo que OCN guarda asociado al código aleatorio de este celular.
import { supabase } from './supabase'

export const VERSION_POLITICA = '1.1'
export const FECHA_POLITICA = '9 de noviembre de 2026'
export const RETENCION_DIAS = 30

const CLAVE_CONSENTIMIENTO = 'ocn-consentimiento'
// Todo lo que OCN guarda en el navegador (ver perfil.js y seguimiento.js).
const CLAVES_LOCALES = ['ocn-dispositivo', 'ocn-mi-servicio', 'ocn-mis-reclamos', CLAVE_CONSENTIMIENTO]

export function consentimiento() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_CONSENTIMIENTO) ?? 'null')
    return c?.version === VERSION_POLITICA ? c : null
  } catch {
    return null
  }
}

export function aceptar() {
  try { localStorage.setItem(CLAVE_CONSENTIMIENTO, JSON.stringify({ version: VERSION_POLITICA, fecha: new Date().toISOString() })) } catch { /* modo privado */ }
}

export function retirarConsentimiento() {
  try { localStorage.removeItem(CLAVE_CONSENTIMIENTO) } catch { /* nada */ }
}

// Código del dispositivo SIN crearlo: si nunca reportó, no hay nada que consultar.
export function dispositivoExistente() {
  try { return localStorage.getItem('ocn-dispositivo') } catch { return null }
}

export function datosLocales() {
  const out = {}
  try {
    for (const k of CLAVES_LOCALES) {
      const v = localStorage.getItem(k)
      if (v != null) { try { out[k] = JSON.parse(v) } catch { out[k] = v } }
    }
  } catch { /* nada */ }
  return out
}

export function borrarLocales() {
  try { CLAVES_LOCALES.forEach((k) => localStorage.removeItem(k)) } catch { /* nada */ }
}

export async function misDatos(id = dispositivoExistente()) {
  if (!id) return null
  const { data, error } = await supabase.rpc('ocn_mis_datos', { p_dispositivo: id })
  if (error) throw new Error(error.message)
  return data
}

export async function borrarMisDatos(id = dispositivoExistente()) {
  let servidor = null
  if (id) {
    const { data, error } = await supabase.rpc('ocn_borrar_mis_datos', { p_dispositivo: id })
    if (error) throw new Error(error.message)
    servidor = data
  }
  borrarLocales()
  return servidor
}

export async function enviarSolicitud({ tipo, mensaje, contacto }) {
  const { data, error } = await supabase.rpc('ocn_solicitud_privacidad', {
    p_tipo: tipo, p_mensaje: mensaje, p_contacto: contacto, p_dispositivo: dispositivoExistente(),
  })
  if (error) throw new Error(error.message)
  return data
}

export function descargarJSON(obj, nombre) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
