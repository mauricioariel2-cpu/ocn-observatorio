import { useEffect, useRef, useState } from 'react'
import { balanceVecinos, enviarFunciona, enviarReporte } from '../lib/datos'
import { ALCANCES, EMPRESAS_TV, SINTOMAS, TECNOLOGIAS, TECNOLOGIA_FIJA, limpiarCodigo } from '../lib/tv'
import { activarAviso, avisoGuardado, soportaAvisos } from '../lib/avisos'
import { REGIONES_CL } from '../lib/geo'
import { detectarCompania } from '../lib/isp'
import { dispositivo, guardarPerfil, leerPerfil } from '../lib/perfil'
import { aceptar, consentimiento } from '../lib/privacidad'
import { DERECHOS_SUBTEL, PORTAL_SUBTEL, cargarReclamos, registrarReclamo, servicioTexto, textoReclamo } from '../lib/reclamos'
import {
  FICHA_CHILEATIENDE, PLAZO_CORTO, PLAZO_LARGO, actualizarReclamo, agregarReclamo, compensacion, descargarCalendario,
  fechaCorta, habilesEntre, leerReclamos, pendientes, pesos, registrarResultado, sumarHabiles, textoInsistencia, vencidos,
} from '../lib/seguimiento'

const EMPRESAS = ['Movistar', 'Entel', 'VTR', 'Claro', 'WOM', 'GTD', 'Mundo', 'Telsur', 'Starlink', 'DIRECTV', 'Otro']
const SERVICIOS = { internet_fijo: 'Internet de hogar', internet_movil: 'Internet móvil', tv: 'TV', telefonia: 'Teléfono' }
const DESDE = { recien: 'Recién', '1h': 'Hace como 1 hora', '3h': 'Hace 3 horas o más', ayer: 'Desde ayer o antes' }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

function regionCercana(lat, lon) {
  let mejor = null
  for (const [nombre, la, lo] of REGIONES_CL) {
    const d = (la - lat) ** 2 + ((lo - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (!mejor || d < mejor.d) mejor = { nombre, d }
  }
  return mejor?.nombre
}

// Chat guiado: el asistente conversa con la persona afectada y le pide los datos de a uno.
// Las respuestas del bot son guiones fijos; todos los números que muestra son conteos reales.
export default function ChatOCN({ contar, abierto, setAbierto, verMapa, verPrivacidad }) {
  const [msgs, setMsgs] = useState([])
  const [escribiendo, setEscribiendo] = useState(false)
  const [opciones, setOpciones] = useState(null) // { tipo: 'botones'|'region'|'texto', ... }
  const datos = useRef({ ...(leerPerfil() ?? {}) })
  const red = useRef(null)
  const fin = useRef(null)
  const iniciado = useRef(false)

  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, escribiendo, opciones])

  async function bot(...textos) {
    for (const t of textos.filter(Boolean)) {
      setEscribiendo(true)
      await espera(Math.min(450 + String(t).length * 12, 1300))
      setEscribiendo(false)
      setMsgs((m) => [...m, { de: 'bot', t }])
    }
  }
  const yo = (t) => setMsgs((m) => [...m, { de: 'yo', t }])
  const preguntar = (o) => setOpciones(o)
  const responder = (texto, siguiente) => { setOpciones(null); yo(texto); siguiente() }

  // La conversación parte la primera vez que se abre el chat, y se mantiene al cerrarlo.
  useEffect(() => {
    if (!abierto || iniciado.current) return
    iniciado.current = true
    inicio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  function inicio() { continuar(!consentimiento()) }

  async function continuar(saludo) {
    const deteccion = detectarCompania().catch(() => null)
    await bot(saludo ? 'Hola 👋 Soy el asistente de OCN. Estoy revisando tu conexión…' : 'Hola de nuevo 👋 Estoy revisando tu conexión…')
    red.current = await deteccion
    const r = red.current
    if (r?.empresa) await bot(`Veo que te conectas por **${r.empresa}** (red AS${r.asn}).`)
    const [vencido] = vencidos()
    if (vencido) { revisarReclamo(vencido); return }
    const [esperando] = pendientes()
    if (esperando) await bot(`📂 Sigo atento a tu reclamo${esperando.folio ? ` N° ${esperando.folio}` : ''} a ${esperando.empresa}. Te pregunto si respondieron desde el **${fechaCorta(sumarHabiles(esperando.enviado, PLAZO_CORTO))}**.`)
    preguntaEstado()
  }

  async function preguntaEstado() {
    await bot('¿Cómo está tu servicio ahora?')
    preguntar({ tipo: 'botones', clase: 'estado', items: [
      ['🔴 Sin servicio', () => { datos.current.tipo = 'caido'; preguntaServicio() }],
      ['🟡 Lento o se corta', () => { datos.current.tipo = 'lento'; preguntaServicio() }],
      ['🟢 Funciona bien', funciona],
      ...(leerReclamos().length ? [['📂 Mis reclamos', misReclamos]] : []),
    ] })
  }

  // "Me funciona bien": también se registra. Es la línea base que permite notar una caída antes y con más certeza.
  async function funciona() {
    datos.current.tipo = 'funciona'
    const d = datos.current
    if (d.empresa && d.servicio && d.region) {
      await bot(`¡Qué bueno! 🙌 ¿Te refieres a tu ${SERVICIOS[d.servicio].toLowerCase()} **${d.empresa}** en ${d.comuna ? `${d.comuna}, ` : ''}${d.region}?`)
      preguntar({ tipo: 'botones', items: [['Sí, ese', enviarOk], ['Es otro servicio o lugar', preguntaServicio]] })
    } else preguntaServicio()
  }

  // Botón "Avísame": solo si el navegador lo permite, la compañía es conocida y aún no está activado igual.
  function botonAviso() {
    const d = datos.current
    const ya = avisoGuardado()
    if (!soportaAvisos() || !d.empresa || d.empresa === 'Otro' || (ya?.empresa === d.empresa && ya?.region === d.region)) return []
    return [[`🔔 Avísame si se cae ${d.empresa}`, avisarme]]
  }

  async function avisarme() {
    const d = datos.current
    setOpciones(null)
    yo(`🔔 Avísame si se cae ${d.empresa}`)
    try {
      await activarAviso(d.empresa, d.region)
      await bot(`Listo 🔔 Te aviso en este celular si muchos vecinos reportan una caída de **${d.empresa}** en ${d.region}, o si las mediciones de red detectan una falla de la compañía.`, 'Sin cuenta ni correo. Puedes desactivarlo en Privacidad.')
    } catch (e) {
      await bot(`No pude activar el aviso: ${e.message}`)
    }
    preguntar({ tipo: 'botones', items: [['Ver el mapa', () => { setAbierto(false); verMapa?.() }], ['Reportar un problema', preguntaEstado]] })
  }

  async function enviarOk() {
    aceptar()
    const d = datos.current
    setEscribiendo(true)
    try {
      await enviarFunciona({
        empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null,
        empresa_detectada: !!d.detectada, dispositivo: dispositivo(),
      })
      guardarPerfil({ empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null })
      const b = await balanceVecinos(d.empresa, d.region).catch(() => null)
      setEscribiendo(false)
      await bot(
        `✅ Anotado: ${d.empresa} te funciona bien en ${d.comuna ? `${d.comuna}, ` : ''}${d.region}.`,
        b ? `En las últimas 3 horas, en ${d.region}: **${b.funciona}** vecino${b.funciona === 1 ? '' : 's'} dice${b.funciona === 1 ? '' : 'n'} que ${d.empresa} funciona y **${b.falla}** reporta${b.falla === 1 ? '' : 'n'} falla.` : null,
        'Tu señal sirve: así el OCN distingue una caída real de un problema aislado. Si se cae, vuelve aquí y reportar toma 10 segundos.',
      )
      preguntar({ tipo: 'botones', items: [...botonAviso(), ['Ver el mapa', () => { setAbierto(false); verMapa?.() }], ['Reportar un problema', preguntaEstado]] })
    } catch (e) {
      setEscribiendo(false)
      await bot(e.message)
      preguntar({ tipo: 'botones', items: [['Ver el mapa', () => { setAbierto(false); verMapa?.() }], ['Reportar un problema', preguntaEstado]] })
    }
  }

  async function preguntaServicio() {
    await bot(datos.current.tipo === 'funciona' ? '¿Qué servicio te funciona bien?' : 'Lo siento 😕 Te ayudo a reportarlo. ¿Qué servicio es?')
    const sugerido = red.current?.tipoConexion === 'movil' ? 'internet_movil' : null
    preguntar({ tipo: 'botones', items: Object.entries(SERVICIOS).map(([v, t]) => [t, () => { datos.current.servicio = v; preguntaEmpresa() }]), destacado: sugerido && SERVICIOS[sugerido] })
  }

  async function preguntaEmpresa() {
    const detectada = red.current?.empresa
    const recordada = datos.current.empresa
    const candidata = datos.current.servicio === 'internet_fijo' && red.current?.tipoConexion === 'movil' ? recordada : (detectada ?? recordada)
    if (candidata) {
      await bot(`¿Tu compañía de ${SERVICIOS[datos.current.servicio].toLowerCase()} es **${candidata}**?`)
      preguntar({ tipo: 'botones', items: [
        [`Sí, ${candidata}`, () => { datos.current.empresa = candidata; datos.current.detectada = candidata === detectada; preguntaRegion() }],
        ['Es otra', listaEmpresas],
      ] })
    } else listaEmpresas()
  }

  async function listaEmpresas() {
    await bot('¿Cuál es tu compañía?')
    preguntar({ tipo: 'botones', items: (datos.current.servicio === 'tv' ? EMPRESAS_TV : EMPRESAS).map((e) => [e, () => { datos.current.empresa = e; datos.current.detectada = e === red.current?.empresa; preguntaRegion() }]) })
  }

  async function preguntaRegion() {
    const recordada = datos.current.region
    if (recordada) {
      await bot(`¿Sigues en ${datos.current.comuna ? `${datos.current.comuna}, ` : ''}${recordada}?`)
      preguntar({ tipo: 'botones', items: [['Sí', preguntaDesde], ['No, estoy en otro lugar', () => { datos.current.region = null; datos.current.comuna = null; preguntaRegion() }]] })
      return
    }
    await bot('¿Dónde estás? Puedo usar tu ubicación aproximada (~1 km) o eliges la región.')
    preguntar({ tipo: 'region' })
  }

  function ubicar() {
    setOpciones(null)
    yo('📍 Usa mi ubicación')
    if (!navigator.geolocation) { bot('Tu navegador no permite ubicación. Elige la región.').then(() => preguntar({ tipo: 'region' })); return }
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = Math.round(p.coords.latitude * 100) / 100
        const lon = Math.round(p.coords.longitude * 100) / 100
        if (lat > -17 || lat < -56.5 || lon > -66 || lon < -110) { await bot('Tu ubicación no parece estar en Chile. Elige la región.'); preguntar({ tipo: 'region' }); return }
        datos.current.lat = lat; datos.current.lon = lon
        datos.current.region = regionCercana(lat, lon)
        await bot(`Listo, estás en la región **${datos.current.region}**.`)
        preguntaComuna()
      },
      async () => { await bot('No pude obtener tu ubicación. Elige la región.'); preguntar({ tipo: 'region' }) },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  async function preguntaComuna() {
    await bot('¿En qué comuna? Ayuda a ubicar la falla con más precisión.')
    preguntar({ tipo: 'texto', placeholder: 'Ej: Maipú', saltar: 'Prefiero no decir' })
  }

  // TV pagada: tres preguntas cerradas (y un código opcional) para que los reportes se puedan ordenar y filtrar.
  async function preguntaTv() {
    const d = datos.current
    d.tv = { tecnologia: TECNOLOGIA_FIJA[d.empresa] ?? null }
    if (!d.tv.tecnologia) {
      await bot('¿Cómo te llega la TV?')
      preguntar({ tipo: 'botones', items: Object.entries(TECNOLOGIAS).map(([v, t]) => [t, () => { d.tv.tecnologia = v; tvAlcance() }]) })
    } else tvAlcance()
  }
  async function tvAlcance() {
    await bot('¿Qué canales fallan?')
    preguntar({ tipo: 'botones', items: Object.entries(ALCANCES).map(([v, t]) => [t, () => { datos.current.tv.alcance = v; tvSintoma() }]) })
  }
  async function tvSintoma() {
    await bot('¿Qué ves en la pantalla?')
    preguntar({ tipo: 'botones', items: Object.entries(SINTOMAS).map(([v, t]) => [t, () => {
      datos.current.tv.sintoma = v
      if (v === 'mensaje') { bot('¿Qué código o mensaje aparece? (por ejemplo 771)').then(() => preguntar({ tipo: 'codigo' })) } else preguntaDesde(true)
    }]) })
  }

  async function preguntaDesde(tvListo = false) {
    if (datos.current.tipo === 'funciona') { enviarOk(); return }
    if (datos.current.servicio === 'tv' && tvListo !== true) { preguntaTv(); return }
    await bot('¿Desde cuándo tienes el problema?')
    preguntar({ tipo: 'botones', items: Object.entries(DESDE).map(([v, t]) => [t, () => { datos.current.desde = v; enviar() }]) })
  }

  async function enviar() {
    aceptar() // enviar el reporte, con el aviso a la vista, es la aceptación (art. 12)
    const d = datos.current
    setEscribiendo(true)
    try {
      await enviarReporte({
        empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null,
        tipo: d.tipo, empresa_detectada: !!d.detectada, desde: d.desde ?? null,
        ...(d.servicio === 'tv' && d.tv ? { tv_tecnologia: d.tv.tecnologia, tv_alcance: d.tv.alcance, tv_sintoma: d.tv.sintoma, tv_codigo: d.tv.codigo ?? null } : {}),
        latitud: d.lat ?? null, longitud: d.lon ?? null, dispositivo: dispositivo(),
      })
      guardarPerfil({ empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null })
      const { enOcn, otras, porFuente } = await contar(d.empresa, d.region)
      d.evidencia = { enOcn, otras, porFuente }
      setEscribiendo(false)
      const otros = Math.max(enOcn - 1, 0)
      await bot(
        `✅ Registré tu reporte: ${d.empresa}, ${SERVICIOS[d.servicio].toLowerCase()}, ${d.comuna ? `${d.comuna}, ` : ''}${d.region}.`,
        otros > 0
          ? `**No eres el único.** ${otros} vecino${otros === 1 ? '' : 's'} más reportaron ${d.empresa} en ${d.region} en la última hora.`
          : `Eres el primero en reportar ${d.empresa} en ${d.region} en OCN esta hora. Cuando se sumen más vecinos, la falla se pinta en el mapa.`,
        ...(otras > 0 ? [`Otros sitios de reportes registran además ${otras} reporte${otras === 1 ? '' : 's'} de ${d.empresa} en ${d.region}.`] : []),
        'Mientras más personas reporten, más fuerza tiene el reclamo ante la compañía y SUBTEL. Comparte OCN con tus vecinos 🙏',
      )
      preguntar({ tipo: 'botones', items: [['📝 Armar mi reclamo', armarReclamo], ...botonAviso(), ['Compartir por WhatsApp', compartir], ['Ver el mapa', () => { setAbierto(false); verMapa?.() }]] })
    } catch (e) {
      setEscribiendo(false)
      await bot(`No pude registrar el reporte: ${e.message}`)
      preguntar({ tipo: 'botones', items: [['Volver a empezar', preguntaEstado]] })
    }
  }

  async function armarReclamo() {
    const d = datos.current
    await bot(
      'Te armo el reclamo formal 📝 No te pido nombre ni RUT: esos datos los completas tú y no salen de tu celular.',
      `Según SUBTEL, si el servicio se interrumpe más de 12 horas sin justificación puedes exigir una rebaja del cargo fijo, y si el corte dura más de 3 días seguidos, una compensación de 3 veces el cargo fijo diario por cada día. [Ver tus derechos en SUBTEL](${DERECHOS_SUBTEL})`,
    )
    const texto = textoReclamo(d, new Date(), d.evidencia)
    d.texto = texto
    setMsgs((m) => [...m, { de: 'bot', reclamo: texto, onCambio: (v) => { d.texto = v } }])
    await bot(
      d.evidencia?.enOcn || d.evidencia?.otras ? 'Le agregué como **evidencia** los reportes reales que OCN registra ahora mismo sobre la falla.' : 'Completa los campos entre [ ] y elige por dónde enviarlo.',
      '¿Por dónde lo envías? Te recomiendo **SUBTEL**: ahí también se puede presentar el reclamo contra la compañía, queda registrado con tu ClaveÚnica y te dan un número para seguirlo.',
    )
    preguntar({ tipo: 'botones', destacado: '🏛️ Enviar por SUBTEL', items: [
      ['🏛️ Enviar por SUBTEL', () => enviarPor('SUBTEL')],
      [`📞 Directo a ${d.empresa}`, () => enviarPor('empresa')],
      ['✉️ Por correo', () => enviarPor('correo')],
      ['Lo envío después', () => bot('Perfecto. El texto queda aquí arriba. Cuando lo envíes, vuelve y toca "Mis reclamos" para que lo siga.')],
    ] })
  }

  async function copiarTexto() {
    try { await navigator.clipboard.writeText(datos.current.texto); return true } catch { return false }
  }

  async function enviarPor(canal) {
    const d = datos.current
    d.canal = canal === 'SUBTEL' ? 'portal SUBTEL' : canal === 'correo' ? 'correo electrónico' : `atención de ${d.empresa}`
    const copiado = await copiarTexto()
    const yaCopie = copiado ? '📋 Ya copié tu reclamo.' : '📋 Copia el texto de arriba (mantén presionado y "Copiar").'
    if (canal === 'SUBTEL') {
      window.open(PORTAL_SUBTEL, '_blank', 'noopener')
      await bot(
        `${yaCopie} Abrí el portal de reclamos de SUBTEL en otra pestaña.`,
        '**1.** Entra con tu ClaveÚnica (o usuario y clave de SUBTEL).\n**2.** Ingresa un reclamo nuevo contra ' + d.empresa + '.\n**3.** Pega el texto en la descripción y adjunta tu boleta si la tienes.',
        'Por ley el reclamo lo firma la persona afectada, por eso el último clic es tuyo. OCN no entra a tu cuenta ni envía nada a tu nombre.',
      )
    } else if (canal === 'correo') {
      location.href = `mailto:?subject=${encodeURIComponent(`Reclamo por falla de servicio ${d.empresa}`)}&body=${encodeURIComponent(d.texto)}`
      await bot(`${yaCopie} Abrí tu correo con el reclamo listo. Pon la dirección de reclamos que ${d.empresa} indica en su web o en tu boleta, y guarda el correo enviado como prueba.`)
    } else {
      await bot(`${yaCopie} Ingrésalo en la web o app de ${d.empresa}, o llama al **105** desde tu línea (canal de reclamos que indica SUBTEL). Exige siempre el **número de reclamo**.`)
    }
    await bot('Cuando lo envíes, escríbeme el **número de reclamo** que te den. Lo guardo solo en tu celular y te aviso cuando venza el plazo de respuesta.')
    preguntar({ tipo: 'folio' })
  }

  async function guardarFolio(folio) {
    const d = datos.current
    const r = agregarReclamo({
      empresa: d.empresa, servicio: d.servicio, servicioTexto: servicioTexto(d.servicio), region: d.region, comuna: d.comuna || null,
      tipo: d.tipo, desde: d.desde ?? null, canal: d.canal, folio: folio || null,
    })
    await sumarReclamo()
    const corto = sumarHabiles(r.enviado, PLAZO_CORTO)
    await bot(
      `📂 Guardado${folio ? ` el reclamo N° **${folio}**` : ''}. Según ChileAtiende, ${d.empresa} tiene hasta **${PLAZO_CORTO} días hábiles** para responder (aprox. el **${fechaCorta(corto)}**, sin contar feriados); la página de SUBTEL indica hasta ${PLAZO_LARGO} si responde por correo. [Ver ficha](${FICHA_CHILEATIENDE})`,
      'Cuando vuelvas a OCN después de esa fecha, te pregunto si respondieron y, si no, te dejo lista la insistencia ante SUBTEL. Si quieres, agrégalo a tu calendario para no olvidarlo.',
    )
    preguntar({ tipo: 'botones', items: [
      ['📅 Agregar recordatorio', async () => { descargarCalendario(r); await bot('Listo, descargué el recordatorio. Ábrelo para agregarlo a tu calendario.'); finReclamo() }],
      ['Compartir por WhatsApp', compartir],
      ['Ver el mapa', () => { setAbierto(false); verMapa?.() }],
    ] })
  }

  function finReclamo() {
    preguntar({ tipo: 'botones', items: [['Compartir por WhatsApp', compartir], ['Ver el mapa', () => { setAbierto(false); verMapa?.() }]] })
  }

  async function sumarReclamo() {
    const d = datos.current
    setEscribiendo(true)
    try {
      await registrarReclamo({ ...d, dispositivo: dispositivo() })
      const todos = await cargarReclamos(30)
      setEscribiendo(false)
      const n = todos.filter((r) => r.empresa === d.empresa).length
      await bot(`💪 Sumado al contador público: en los últimos 30 días van **${n} reclamo${n === 1 ? '' : 's'}** contra ${d.empresa} registrados en OCN.`)
    } catch (e) {
      setEscribiendo(false)
      if (!/6 horas/.test(e.message)) await bot(`No pude sumarlo al contador: ${e.message}`)
    }
  }

  async function misReclamos() {
    const lista = leerReclamos().slice().reverse()
    if (!lista.length) { await bot('Todavía no tienes reclamos guardados.'); preguntaEstado(); return }
    const ESTADO = { esperando: '⏳ esperando respuesta', resuelto: '✅ solucionado', insistido: '🏛️ insistido en SUBTEL' }
    await bot(lista.map((r) => `• **${r.empresa}**${r.folio ? ` N° ${r.folio}` : ''}, ${fechaCorta(r.enviado)}: ${ESTADO[r.estado] ?? r.estado} (${habilesEntre(r.enviado)} días hábiles)`).join('\n'))
    const abiertos = lista.filter((r) => r.estado === 'esperando')
    preguntar({ tipo: 'botones', items: [
      ...abiertos.slice(0, 3).map((r) => [`Revisar ${r.empresa}${r.folio ? ` N° ${r.folio}` : ''}`, () => revisarReclamo(r)]),
      ['Reportar un problema', preguntaEstado],
    ] })
  }

  async function revisarReclamo(r) {
    const n = habilesEntre(r.enviado)
    await bot(`📂 Tu reclamo${r.folio ? ` N° **${r.folio}**` : ''} a **${r.empresa}** (${fechaCorta(r.enviado)}) lleva **${n} día${n === 1 ? '' : 's'} hábil${n === 1 ? '' : 'es'}**. ¿Te respondieron?`)
    preguntar({ tipo: 'botones', items: [
      ['✅ Sí, lo solucionaron', () => resultado(r, 'resuelto')],
      ['😐 Respondieron, pero no solucionan', () => resultado(r, 'respondido_sin_solucion')],
      ['🔇 No me han respondido', () => resultado(r, 'sin_respuesta')],
      ['Todavía no sé', preguntaEstado],
    ] })
  }

  async function resultado(r, res) {
    const dias = habilesEntre(r.enviado)
    registrarResultado({ empresa: r.empresa, resultado: res, dias_habiles: Math.min(dias, 365), dispositivo: dispositivo() }).catch(() => {})
    if (res === 'resuelto') {
      actualizarReclamo(r.id, { estado: 'resuelto' })
      await bot('¡Bien! 🙌 Lo marqué como solucionado. Si el corte duró más de 3 días seguidos, igual te corresponde compensación: te ayudo a calcularla.')
      preguntar({ tipo: 'botones', items: [['💰 Calcular compensación', () => calcular(r, null)], ['Listo', preguntaEstado]] })
      return
    }
    if (res === 'sin_respuesta' && dias < PLAZO_CORTO) {
      await bot(`Todavía está dentro del plazo (${dias} de ${PLAZO_CORTO} días hábiles). Te vuelvo a preguntar el ${fechaCorta(sumarHabiles(r.enviado, PLAZO_CORTO))}.`)
      preguntaEstado()
      return
    }
    await bot(
      res === 'sin_respuesta' ? `${r.empresa} no cumplió. Ahora toca **insistir en SUBTEL** (segunda instancia), que resuelve en hasta 30 días.` : `Entonces toca **insistir en SUBTEL** (segunda instancia), que resuelve en hasta 30 días.`,
      'Según SUBTEL, hay que hacerlo dentro de los 10 días hábiles siguientes. ¿El corte duró más de 3 días seguidos? Si es así, sumo el cálculo de tu compensación.',
    )
    preguntar({ tipo: 'botones', items: [['Sí, más de 3 días', () => calcular(r, res)], ['No', () => insistir(r, res, {})]] })
  }

  async function calcular(r, res) {
    await bot('¿Cuánto pagas de **cargo fijo mensual** por ese servicio? (está en tu boleta) Y ¿cuántos **días seguidos** estuviste sin servicio?')
    preguntar({ tipo: 'compensacion', r, res })
  }

  async function mostrarCompensacion(r, res, cargoMensual, dias) {
    const c = compensacion(cargoMensual, dias)
    if (dias > 3) await bot(`💰 Cargo diario aprox. ${pesos(c.diario)} (mensual ÷ 30). Por ${dias} días seguidos sin servicio, la compensación sería cerca de **${pesos(c.total)}** (3 veces el cargo diario por día, según SUBTEL). Es una estimación: el monto final lo calcula la empresa o SUBTEL.`)
    else await bot('Con 3 días o menos no aplica la compensación triple, pero si el corte pasó de 12 horas puedes pedir la rebaja del cargo fijo.')
    if (res) insistir(r, res, { cargoMensual, dias })
    else preguntar({ tipo: 'botones', items: [['Listo', preguntaEstado]] })
  }

  async function insistir(r, res, extra) {
    const texto = textoInsistencia(r, { motivo: res, ...extra })
    datos.current.texto = texto
    setMsgs((m) => [...m, { de: 'bot', reclamo: texto, titulo: 'Insistencia ante SUBTEL', onCambio: (v) => { datos.current.texto = v } }])
    await bot('Te dejé la insistencia lista, con tu número de reclamo. Completa los campos entre [ ] y envíala en el portal de SUBTEL.')
    preguntar({ tipo: 'botones', destacado: '🏛️ Copiar y abrir SUBTEL', items: [
      ['🏛️ Copiar y abrir SUBTEL', async () => {
        const ok = await copiarTexto()
        window.open(PORTAL_SUBTEL, '_blank', 'noopener')
        actualizarReclamo(r.id, { estado: 'insistido' })
        await bot(`${ok ? '📋 Copiado.' : '📋 Copia el texto de arriba.'} En SUBTEL entra con tu ClaveÚnica, ingresa el reclamo contra ${r.empresa}, pega el texto y adjunta la respuesta de la empresa si la hubo. Guarda el número que te dé SUBTEL.`)
        finReclamo()
      }],
      ['Lo hago después', () => bot('El texto queda aquí arriba. Lo encuentras de nuevo en "Mis reclamos".').then(preguntaEstado)],
    ] })
  }

  function compartir() {
    const d = datos.current
    const texto = `Se cayó ${d.empresa} en ${d.comuna || d.region}. Si también te afecta, repórtalo en OCN: ${location.origin}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  if (!abierto) return null

  return (
    <section className="asis chat" aria-label="Asistente OCN">
      <header className="asis-cab">
        <span className={`asis-ojo ${escribiendo ? 'buscando' : ''}`} aria-hidden />
        <div>
          <b>Asistente OCN</b>
          <small>{escribiendo ? 'escribiendo…' : 'en línea'}</small>
        </div>
        <button className="asis-priv" onClick={() => { setAbierto(false); verPrivacidad?.() }}>Privacidad</button>
        <button className="asis-min" onClick={() => setAbierto(false)} aria-label="Cerrar el asistente">✕</button>
      </header>
      <div className="chat-hilo" aria-live="polite">
        {msgs.map((m, i) => m.reclamo
          ? <TarjetaReclamo key={i} texto={m.reclamo} titulo={m.titulo} onCambio={m.onCambio} />
          : <p key={i} className={`burb ${m.de}`} dangerouslySetInnerHTML={{ __html: negrita(m.t) }} />)}
        {escribiendo && <p className="burb bot puntos" aria-label="escribiendo"><i /><i /><i /></p>}
        {opciones?.tipo === 'botones' && (
          <div className={`chat-opciones ${opciones.clase ?? ''}`}>
            {opciones.items.map(([t, fn]) => (
              <button key={t} className={opciones.destacado === t ? 'destacado' : ''} onClick={() => responder(t, fn)}>{t}</button>
            ))}
          </div>
        )}
        {opciones?.tipo === 'region' && (
          <div className="chat-opciones">
            <button className="destacado" onClick={ubicar}>📍 Usar mi ubicación</button>
            <select defaultValue="" aria-label="Región" onChange={(e) => { const r = e.target.value; if (!r) return; datos.current.region = r; responder(r, preguntaComuna) }}>
              <option value="">Elegir región…</option>
              {REGIONES_CL.map(([n]) => <option key={n}>{n}</option>)}
            </select>
          </div>
        )}
        {opciones?.tipo === 'texto' && (
          <form className="chat-texto" onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('t')?.toString().trim().slice(0, 60)
            if (!v || v.length < 2) return
            datos.current.comuna = v
            responder(v, preguntaDesde)
          }}>
            <input name="t" placeholder={opciones.placeholder} autoComplete="address-level2" maxLength={60} autoFocus />
            <button type="submit" aria-label="Enviar">➤</button>
            <button type="button" className="saltar" onClick={() => { datos.current.comuna = null; responder(opciones.saltar, preguntaDesde) }}>{opciones.saltar}</button>
          </form>
        )}
        {opciones?.tipo === 'codigo' && (
          <form className="chat-texto" onSubmit={(e) => {
            e.preventDefault()
            const v = limpiarCodigo(new FormData(e.currentTarget).get('c'))
            if (!v) return
            datos.current.tv.codigo = v
            responder(v, () => preguntaDesde(true))
          }}>
            <input name="c" placeholder="Ej: 771" maxLength={20} autoFocus autoComplete="off" />
            <button type="submit" aria-label="Enviar">➤</button>
            <button type="button" className="saltar" onClick={() => { datos.current.tv.codigo = null; responder('No recuerdo', () => preguntaDesde(true)) }}>No recuerdo</button>
          </form>
        )}
        {opciones?.tipo === 'folio' && (
          <form className="chat-texto" onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('f')?.toString().trim().slice(0, 40)
            if (!v) return
            setOpciones(null); yo(`N° ${v}`); guardarFolio(v)
          }}>
            <input name="f" placeholder="N° de reclamo" maxLength={40} autoFocus autoComplete="off" />
            <button type="submit" aria-label="Guardar">➤</button>
            <button type="button" className="saltar" onClick={() => { setOpciones(null); yo('No me dieron número'); guardarFolio(null) }}>No me dieron número</button>
          </form>
        )}
        {opciones?.tipo === 'compensacion' && (
          <form className="chat-texto chat-comp" onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const cargo = Number(String(f.get('c')).replace(/\D/g, ''))
            const dias = Number(f.get('d'))
            if (!(cargo > 0) || !(dias > 0)) return
            const { r, res } = opciones
            setOpciones(null); yo(`${pesos(cargo)} al mes, ${dias} día${dias === 1 ? '' : 's'}`); mostrarCompensacion(r, res, cargo, dias)
          }}>
            <input name="c" inputMode="numeric" placeholder="Cargo mensual $" maxLength={9} autoFocus />
            <input name="d" type="number" min="1" max="60" inputMode="numeric" placeholder="Días" />
            <button type="submit" aria-label="Calcular">➤</button>
          </form>
        )}
        <div ref={fin} />
      </div>
      <p className="nota chat-nota">Sin nombre ni RUT. Al reportar aceptas la <button type="button" className="btn-link" onClick={() => { setAbierto(false); verPrivacidad?.() }}>política de privacidad</button>.</p>
    </section>
  )
}

// Solo **negrita** y [enlaces](https://...); el resto se escapa.
function negrita(t) {
  const esc = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function TarjetaReclamo({ texto, titulo = 'Tu reclamo', onCambio }) {
  const [valor, setValorLocal] = useState(texto)
  const setValor = (v) => { setValorLocal(v); onCambio?.(v) }
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(valor); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* el usuario puede seleccionar a mano */ }
  }
  return (
    <div className="reclamo-carta">
      <div className="reclamo-cab"><b>{titulo}</b><small>Completa los campos entre [ ]</small></div>
      <textarea value={valor} onChange={(e) => setValor(e.target.value)} rows={12} aria-label="Texto del reclamo" />
      <div className="reclamo-botones">
        <button onClick={copiar}>{copiado ? '✓ Copiado' : '📋 Copiar'}</button>
        <a href={`mailto:?subject=${encodeURIComponent('Reclamo por falla de servicio')}&body=${encodeURIComponent(valor)}`}>✉️ Correo</a>
        {navigator.share && <button onClick={() => navigator.share({ text: valor }).catch(() => {})}>↗ Compartir</button>}
      </div>
    </div>
  )
}
