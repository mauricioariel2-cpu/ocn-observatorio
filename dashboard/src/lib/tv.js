// TV pagada: reportes ordenados en campos cerrados para poder filtrarlos y contarlos.
// Compañías y suscriptores: SUBTEL, "Servicios limitados de televisión", junio de 2026 (hoja 9.5 SUS_Emp2;
// la suma de todas las empresas da el total de SUBTEL: 2.476.567). Zapping es TV por internet y no está en SUBTEL.

export const EMPRESAS_TV = ['VTR', 'Movistar', 'Mundo', 'DIRECTV', 'Claro', 'Entel', 'Telsur', 'TuVes', 'GTD', 'Zapping', 'Otro']

export const TECNOLOGIAS = { satelital: 'Antena satelital (plato)', cable_fibra: 'Cable o fibra (decodificador)', app: 'App o internet' }
export const ALCANCES = { todos: 'Todos los canales', hd: 'Solo los canales HD', algunos: 'Algunos canales', uno: 'Un canal' }
export const SINTOMAS = { sin_senal: 'Sin señal / pantalla negra', pixelado: 'Se congela o pixela', sin_audio: 'Sin audio', mensaje: 'Aparece un mensaje o código' }

// Tecnología que ya se sabe por la compañía (SUBTEL: la TV satelital en Chile es DIRECTV, Claro DTH y TuVes).
export const TECNOLOGIA_FIJA = { DIRECTV: 'satelital', TuVes: 'satelital', Zapping: 'app', VTR: 'cable_fibra', Mundo: 'cable_fibra', Telsur: 'cable_fibra', GTD: 'cable_fibra', Entel: 'cable_fibra', Movistar: 'cable_fibra' }

// Suscriptores de TV pagada por compañía (SUBTEL jun-2026). Claro suma Claro Comunicaciones (cable) + Claro DTH (satelital).
export const SUSCRIPTORES_TV = {
  VTR: 726151, Movistar: 489915, Mundo: 433440, DIRECTV: 401362, Claro: 217380, Entel: 106002, Telsur: 72198, TuVes: 10865, GTD: 164,
}
export const SATELITAL_TOTAL = 495632 // DIRECTV + Claro DTH + TuVes, coincide con el total satelital de SUBTEL
export const FUENTE_TV = 'SUBTEL, suscriptores de TV pagada a junio de 2026'

export const limpiarCodigo = (t) => String(t ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 20) || null

// Resumen de reportes de TV de vecinos (últimas horas) por compañía, con filtros opcionales.
export function resumenTv(vecinos, filtro = {}) {
  const tv = vecinos.filter((v) => v.servicio === 'tv'
    && (!filtro.tecnologia || v.tv_tecnologia === filtro.tecnologia)
    && (!filtro.sintoma || v.tv_sintoma === filtro.sintoma)
    && (!filtro.alcance || v.tv_alcance === filtro.alcance))
  const porEmpresa = new Map()
  for (const v of tv) {
    const e = porEmpresa.get(v.empresa) ?? { empresa: v.empresa, n: 0, alcance: {}, sintoma: {}, regiones: {}, codigos: {}, tecnologia: {} }
    e.n += 1
    const sumar = (o, k) => { if (k) o[k] = (o[k] ?? 0) + 1 }
    sumar(e.alcance, v.tv_alcance); sumar(e.sintoma, v.tv_sintoma); sumar(e.regiones, v.region)
    sumar(e.codigos, v.tv_codigo); sumar(e.tecnologia, v.tv_tecnologia)
    porEmpresa.set(v.empresa, e)
  }
  const top = (o, n = 3) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
  return [...porEmpresa.values()].map((e) => ({
    ...e,
    suscriptores: SUSCRIPTORES_TV[e.empresa] ?? null,
    topAlcance: top(e.alcance, 2), topSintoma: top(e.sintoma, 2), topRegiones: top(e.regiones), topCodigos: top(e.codigos, 2),
  })).sort((a, b) => b.n - a.n)
}
