import { supabase } from './supabase'

// Avisos sin cuenta: el navegador crea una "dirección de entrega" (Web Push) y la guardamos solo con
// la compañía y la región elegidas. Sin correo, sin teléfono, sin nombre.
const CLAVE = 'ocn-aviso'

export function soportaAvisos() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// En iPhone los avisos solo funcionan con la web instalada en la pantalla de inicio.
export const esIosSinInstalar = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone)

export function avisoGuardado() {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? 'null') } catch { return null }
}

const deB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

export async function activarAviso(empresa, region) {
  if (!soportaAvisos()) throw new Error('Tu navegador no permite avisos.')
  if (esIosSinInstalar()) throw new Error('En iPhone, primero agrega el OCN a tu pantalla de inicio (Compartir → Agregar a inicio) y actívalo desde ahí.')
  const { data: publica, error: e1 } = await supabase.rpc('ocn_vapid_publica')
  if (e1) throw new Error(e1.message)
  if (!publica) throw new Error('Los avisos se están activando. Prueba de nuevo en 15 minutos.')
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') throw new Error('Sin permiso para avisos. Puedes activarlo en los ajustes del navegador.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64u(publica) })
  const j = sub.toJSON()
  const { error } = await supabase.rpc('ocn_suscribir_aviso', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_empresa: empresa, p_region: region })
  if (error) throw new Error(error.message)
  try { localStorage.setItem(CLAVE, JSON.stringify({ empresa, region })) } catch { /* modo privado */ }
}

export async function desactivarAviso() {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) { await supabase.rpc('ocn_cancelar_aviso', { p_endpoint: sub.endpoint }); await sub.unsubscribe() }
  } finally {
    try { localStorage.removeItem(CLAVE) } catch { /* nada */ }
  }
}
