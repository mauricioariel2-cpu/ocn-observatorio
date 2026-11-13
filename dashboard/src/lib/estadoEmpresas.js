// Tarjetas "estado por compañía": operativa, con problemas, caída o sin datos.
// Todo sale de las filas reales de la última hora (mismas reglas que la verificación cruzada):
//   caída        = 2 o más fuentes independientes ven falla (confirmada)
//   con problemas = 1 sola fuente ve falla (sin confirmar)
//   operativa    = ninguna fuente ve falla y al menos una fuente con datos de esa compañía dice que está normal
//   sin datos    = ninguna fuente informó sobre esa compañía en la última hora (no se afirma que esté bien)
import { claveEmpresa, MIN_FUENTES } from './datos'
import { esTelecom } from './servicios'
import { clientesEmpresa } from './conexiones'

export const EMPRESAS_CL = ['Movistar', 'Entel', 'VTR', 'Claro', 'WOM', 'GTD', 'Mundo', 'Telsur', 'Starlink', 'DIRECTV']
const VENTANA_MIN = 60
const ORDEN = { caida: 4, problemas: 3, aislados: 2, operativa: 1, sin_datos: 0 }
export const TEXTO_ESTADO_EMPRESA = { caida: 'Caída confirmada', problemas: 'Con problemas', aislados: 'Reportes de usuarios', operativa: 'Operativa', sin_datos: 'Sin datos' }

export function estadoEmpresas(filas, ahora = Date.now()) {
  const limite = ahora - VENTANA_MIN * 60_000
  const porEmpresa = new Map(EMPRESAS_CL.map((e) => [claveEmpresa(e), { empresa: e, fuentes: new Map() }]))
  for (const f of filas) {
    if ((f.pais ?? 'CL') !== 'CL' || f.empresa === 'Red completa' || !esTelecom(f)) continue
    const e = porEmpresa.get(claveEmpresa(f.empresa))
    if (!e) continue
    const t = Date.parse(f.capturado_en ?? f.ventana)
    if (!Number.isFinite(t) || t < limite) continue
    const fu = e.fuentes.get(f.fuente) ?? { falla: false, reportes: 0, ultima: 0 }
    if (f.gravedad && f.gravedad !== 'normal') fu.falla = true
    fu.reportes = Math.max(fu.reportes, f.cantidad_reportes ?? 0)
    fu.ultima = Math.max(fu.ultima, t)
    e.fuentes.set(f.fuente, fu)
  }
  return [...porEmpresa.entries()].map(([clave, e]) => {
    const conFalla = [...e.fuentes].filter(([, v]) => v.falla).map(([k]) => k)
    const conDatos = e.fuentes.size
    // Si los únicos datos son reportes de vecinos en OCN no se puede decir "operativa": hay gente con problemas, sin otra fuente que lo confirme.
    const soloVecinos = conDatos > 0 && [...e.fuentes.keys()].every((k) => k === 'ocn') && [...e.fuentes.values()].some((v) => v.reportes > 0)
    const estado = conFalla.length >= MIN_FUENTES ? 'caida' : conFalla.length === 1 ? 'problemas' : soloVecinos ? 'aislados' : conDatos > 0 ? 'operativa' : 'sin_datos'
    const vecinos = e.fuentes.get('ocn')?.reportes ?? 0
    const ultima = Math.max(0, ...[...e.fuentes.values()].map((v) => v.ultima))
    return { clave, empresa: e.empresa, estado, conFalla, conDatos, vecinos, ultima: ultima || null, clientes: clientesEmpresa(clave, [], true) }
  }).sort((a, b) => ORDEN[b.estado] - ORDEN[a.estado] || b.conFalla.length - a.conFalla.length || (b.clientes?.n ?? 0) - (a.clientes?.n ?? 0))
}
