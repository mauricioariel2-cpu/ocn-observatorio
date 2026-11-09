import { useEffect, useRef, useState } from 'react'
import { enviarReporte } from '../lib/datos'
import { REGIONES_CL } from '../lib/geo'
import { detectarCompania } from '../lib/isp'
import { dispositivo, guardarPerfil, leerPerfil } from '../lib/perfil'
import { DERECHOS_SUBTEL, PORTAL_SUBTEL, cargarReclamos, registrarReclamo, textoReclamo } from '../lib/reclamos'

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
export default function ChatOCN({ contar }) {
  const [abierto, setAbierto] = useState(true)
  const [msgs, setMsgs] = useState([])
  const [escribiendo, setEscribiendo] = useState(false)
  const [opciones, setOpciones] = useState(null) // { tipo: 'botones'|'region'|'texto', ... }
  const datos = useRef({ ...(leerPerfil() ?? {}) })
  const red = useRef(null)
  const fin = useRef(null)
  const iniciado = useRef(false)

  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, escribiendo, opciones])

  async function bot(...textos) {
    for (const t of textos) {
      setEscribiendo(true)
      await espera(Math.min(450 + String(t).length * 12, 1300))
      setEscribiendo(false)
      setMsgs((m) => [...m, { de: 'bot', t }])
    }
  }
  const yo = (t) => setMsgs((m) => [...m, { de: 'yo', t }])
  const preguntar = (o) => setOpciones(o)
  const responder = (texto, siguiente) => { setOpciones(null); yo(texto); siguiente() }

  useEffect(() => {
    if (iniciado.current) return
    iniciado.current = true
    inicio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function inicio() {
    const deteccion = detectarCompania().catch(() => null)
    await bot('Hola 👋 Soy el asistente de OCN. Estoy revisando tu conexión…')
    red.current = await deteccion
    const r = red.current
    if (r?.empresa) await bot(`Veo que te conectas por **${r.empresa}** (red AS${r.asn}). Tu conexión respondió en ${r.latenciaMs} ms.`)
    preguntaEstado()
  }

  async function preguntaEstado() {
    await bot('¿Cómo está tu servicio ahora?')
    preguntar({ tipo: 'botones', clase: 'estado', items: [
      ['🔴 Sin servicio', () => { datos.current.tipo = 'caido'; preguntaServicio() }],
      ['🟡 Lento o se corta', () => { datos.current.tipo = 'lento'; preguntaServicio() }],
      ['🟢 Funciona bien', funciona],
    ] })
  }

  async function funciona() {
    await bot('¡Qué bueno! 🙌 Si se cae, vuelve aquí: reportar toma 10 segundos.', 'Mientras tanto puedes ver en el mapa cómo está tu región.')
    preguntar({ tipo: 'botones', items: [['Reportar un problema', preguntaEstado]] })
  }

  async function preguntaServicio() {
    await bot('Lo siento 😕 Te ayudo a reportarlo. ¿Qué servicio es?')
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
    preguntar({ tipo: 'botones', items: EMPRESAS.map((e) => [e, () => { datos.current.empresa = e; datos.current.detectada = e === red.current?.empresa; preguntaRegion() }]) })
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

  async function preguntaDesde() {
    await bot('¿Desde cuándo tienes el problema?')
    preguntar({ tipo: 'botones', items: Object.entries(DESDE).map(([v, t]) => [t, () => { datos.current.desde = v; enviar() }]) })
  }

  async function enviar() {
    const d = datos.current
    setEscribiendo(true)
    try {
      await enviarReporte({
        empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null,
        tipo: d.tipo, empresa_detectada: !!d.detectada, desde: d.desde ?? null,
        latitud: d.lat ?? null, longitud: d.lon ?? null, dispositivo: dispositivo(),
      })
      guardarPerfil({ empresa: d.empresa, servicio: d.servicio, region: d.region, comuna: d.comuna || null })
      const { enOcn, otras } = await contar(d.empresa, d.region)
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
      preguntar({ tipo: 'botones', items: [['📝 Armar mi reclamo', armarReclamo], ['Compartir por WhatsApp', compartir], ['Ver el mapa', () => setAbierto(false)]] })
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
    setMsgs((m) => [...m, { de: 'bot', reclamo: textoReclamo(d) }])
    await bot(
      `**Paso 1:** envíalo a ${d.empresa} por su web, su app o su teléfono de atención, y anota el **número de reclamo** que te den.`,
      `**Paso 2:** si ${d.empresa} no responde o no te soluciona, insiste en SUBTEL con ese número. [Abrir portal de reclamos SUBTEL](${PORTAL_SUBTEL})`,
      'Cuando lo envíes, avísame y lo sumo al contador público de reclamos contra la empresa.',
    )
    preguntar({ tipo: 'botones', items: [[`✅ Ya lo envié a ${d.empresa}`, sumarReclamo], ['Lo envío después', () => bot('Perfecto. El texto queda aquí arriba para copiarlo cuando quieras.')]] })
  }

  async function sumarReclamo() {
    const d = datos.current
    setEscribiendo(true)
    try {
      await registrarReclamo({ ...d, dispositivo: dispositivo() })
      const todos = await cargarReclamos(30)
      setEscribiendo(false)
      const n = todos.filter((r) => r.empresa === d.empresa).length
      await bot(`💪 Sumado. En los últimos 30 días van **${n} reclamo${n === 1 ? '' : 's'}** contra ${d.empresa} registrados en OCN. Mientras más seamos, más difícil es ignorarnos.`)
      preguntar({ tipo: 'botones', items: [['Compartir por WhatsApp', compartir], ['Ver el mapa', () => setAbierto(false)]] })
    } catch (e) {
      setEscribiendo(false)
      await bot(`No pude sumarlo: ${e.message}`)
    }
  }

  function compartir() {
    const d = datos.current
    const texto = `Se cayó ${d.empresa} en ${d.comuna || d.region}. Si también te afecta, repórtalo en OCN: ${location.origin}`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  }

  if (!abierto) {
    return (
      <button className="asis-pildora" onClick={() => setAbierto(true)}>
        <span className="asis-ojo" aria-hidden /> Asistente OCN
      </button>
    )
  }

  return (
    <section className="asis chat" aria-label="Asistente OCN">
      <header className="asis-cab">
        <span className={`asis-ojo ${escribiendo ? 'buscando' : ''}`} aria-hidden />
        <div>
          <b>Asistente OCN</b>
          <small>{escribiendo ? 'escribiendo…' : 'en línea'}</small>
        </div>
        <button className="asis-min" onClick={() => setAbierto(false)} aria-label="Minimizar">▾</button>
      </header>
      <div className="chat-hilo" aria-live="polite">
        {msgs.map((m, i) => m.reclamo
          ? <TarjetaReclamo key={i} texto={m.reclamo} />
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
        <div ref={fin} />
      </div>
      <p className="nota chat-nota">OCN no guarda tu IP ni tu ubicación exacta.</p>
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

function TarjetaReclamo({ texto }) {
  const [valor, setValor] = useState(texto)
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(valor); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* el usuario puede seleccionar a mano */ }
  }
  return (
    <div className="reclamo-carta">
      <div className="reclamo-cab"><b>Tu reclamo</b><small>Completa los campos entre [ ]</small></div>
      <textarea value={valor} onChange={(e) => setValor(e.target.value)} rows={12} aria-label="Texto del reclamo" />
      <div className="reclamo-botones">
        <button onClick={copiar}>{copiado ? '✓ Copiado' : '📋 Copiar'}</button>
        <a href={`mailto:?subject=${encodeURIComponent('Reclamo por falla de servicio')}&body=${encodeURIComponent(valor)}`}>✉️ Correo</a>
        {navigator.share && <button onClick={() => navigator.share({ text: valor }).catch(() => {})}>↗ Compartir</button>}
      </div>
    </div>
  )
}
