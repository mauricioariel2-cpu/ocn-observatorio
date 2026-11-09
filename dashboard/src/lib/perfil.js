// Datos que la persona ya eligió (compañía, servicio, región, comuna), guardados solo
// en su propio celular para que el próximo reporte sea de un toque. Nunca se suben aparte.
const CLAVE = 'ocn-mi-servicio'

export function dispositivo() {
  try {
    let id = localStorage.getItem('ocn-dispositivo')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ocn-dispositivo', id) }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export function leerPerfil() {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
    return p?.empresa && p?.region && p?.servicio ? p : null
  } catch {
    return null
  }
}

export function guardarPerfil(p) {
  try { localStorage.setItem(CLAVE, JSON.stringify(p)) } catch { /* modo privado: no se recuerda */ }
}

export function borrarPerfil() {
  try { localStorage.removeItem(CLAVE) } catch { /* nada */ }
}
