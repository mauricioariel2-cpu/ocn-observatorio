import { useEffect, useState } from 'react'
import { enviarReporte } from '../lib/datos'
import { REGIONES_CL } from '../lib/geo'
import { detectarCompania } from '../lib/isp'
import { dispositivo, guardarPerfil, leerPerfil } from '../lib/perfil'
import NoEresElUnico from './NoEresElUnico'

const EMPRESAS = ['Movistar', 'Entel', 'VTR', 'Claro', 'WOM', 'GTD', 'Mundo', 'Telsur', 'Starlink', 'DIRECTV', 'Otro']
const SERVICIOS = [['internet_fijo', 'Hogar'], ['internet_movil', 'Móvil'], ['tv', 'TV'], ['telefonia', 'Teléfono']]
const PASOS = ['Detectando tu compañía', 'Midiendo tu conexión', 'Revisando reportes cerca de ti']

// Región más cercana a una coordenada (por la capital regional): solo sugiere.
function regionCercana(lat, lon) {
  let mejor = null
  for (const [nombre, la, lo] of REGIONES_CL) {
    const d = (la - lat) ** 2 + ((lo - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (!mejor || d < mejor.d) mejor = { nombre, d }
  }
  return mejor?.nombre
}

// Asistente de reporte: escanea la conexión (compañía real por ASN y latencia medida),
// precarga lo que la persona eligió antes y deja el reporte a un toque.
export default function Asistente({ contar, vecinosEn }) {
  const perfil = leerPerfil()
  const [abierto, setAbierto] = useState(true)
  const [paso, setPaso] = useState(0) // 0..3 (3 = listo)
  const [red, setRed] = useState(null)
  const [empresa, setEmpresa] = useState(perfil?.empresa ?? '')
  const [detectada, setDetectada] = useState(false)
  const [servicio, setServicio] = useState(perfil?.servicio ?? 'internet_fijo')
  const [region, setRegion] = useState(perfil?.region ?? '')
  const [comuna, setComuna] = useState(perfil?.comuna ?? '')
  const [coords, setCoords] = useState(null)
  const [estado, setEstado] = useState({ tipo: 'idle' })

  useEffect(() => {
    let vivo = true
    const avanzar = (n) => vivo && setPaso((p) => Math.max(p, n))
    ;(async () => {
      try {
        const r = await detectarCompania()
        if (!vivo) return
        setRed(r)
        if (r.empresa) {
          // Si navega por la misma compañía que eligió antes, o no había elegido, se usa la detectada.
          if (!perfil?.empresa || perfil.empresa === r.empresa) { setEmpresa(r.empresa); setDetectada(true) }
        }
        if (!perfil && r.tipoConexion === 'movil') setServicio('internet_movil')
      } catch {
        if (vivo) setRed({ error: true })
      }
      avanzar(2)
      setTimeout(() => avanzar(3), 600)
    })()
    const t = setTimeout(() => avanzar(1), 700)
    return () => { vivo = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ubicar() {
    if (!navigator.geolocation) return setEstado({ tipo: 'error', msg: 'Tu navegador no permite ubicación.' })
    setEstado({ tipo: 'ubicando' })
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = Math.round(p.coords.latitude * 100) / 100
        const lon = Math.round(p.coords.longitude * 100) / 100
        if (lat > -17 || lat < -56.5 || lon > -66 || lon < -110) return setEstado({ tipo: 'error', msg: 'Tu ubicación no parece estar en Chile. Elige la región.' })
        setCoords({ lat, lon })
        setRegion(regionCercana(lat, lon) ?? '')
        setEstado({ tipo: 'idle' })
      },
      () => setEstado({ tipo: 'error', msg: 'No se pudo obtener tu ubicación. Elige la región.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  async function reportar(tipo) {
    if (tipo === 'funciona') { setEstado({ tipo: 'funciona' }); return }
    if (!empresa || !region) return setEstado({ tipo: 'error', msg: 'Elige tu compañía y tu región para reportar.' })
    setEstado({ tipo: 'enviando', cual: tipo })
    try {
      const datos = { empresa, servicio, region, comuna: comuna.trim() || null }
      await enviarReporte({
        ...datos, tipo, empresa_detectada: detectada && red?.empresa === empresa,
        latitud: coords?.lat ?? null, longitud: coords?.lon ?? null, dispositivo: dispositivo(),
      })
      guardarPerfil(datos)
      setEstado({ tipo: 'ok', ...(await contar(empresa, region)) })
    } catch (e) {
      setEstado({ tipo: 'error', msg: e.message })
    }
  }

  if (!abierto) {
    return (
      <button className="asis-pildora" onClick={() => setAbierto(true)}>
        <span className="asis-ojo" aria-hidden /> ¿Cómo está tu internet?
      </button>
    )
  }

  const enZona = empresa && region ? vecinosEn(empresa, region) : null
  const listo = paso >= 3

  return (
    <section className="asis" aria-label="Asistente de reporte">
      <header className="asis-cab">
        <span className={`asis-ojo ${listo ? '' : 'buscando'}`} aria-hidden />
        <div>
          <b>Asistente OCN</b>
          <small>{listo ? 'Conexión analizada' : 'Analizando tu conexión…'}</small>
        </div>
        <button className="asis-min" onClick={() => setAbierto(false)} aria-label="Minimizar">▾</button>
      </header>

      {estado.tipo === 'ok' ? (
        <div className="asis-cuerpo">
          <p className="asis-hecho">✓ Reporte registrado</p>
          <NoEresElUnico empresa={empresa} region={region} enOcn={estado.enOcn} otras={estado.otras} />
          <p className="nota">Puedes volver a reportar en 30 minutos si sigue el problema.</p>
        </div>
      ) : estado.tipo === 'funciona' ? (
        <div className="asis-cuerpo">
          <p className="asis-hecho ok">¡Bien! Tu {empresa || 'conexión'} funciona.</p>
          <p className="nota">Si se cae, vuelve aquí: el reporte es de un toque.</p>
          <button className="enlace" onClick={() => setEstado({ tipo: 'idle' })}>Volver</button>
        </div>
      ) : (
        <div className="asis-cuerpo">
          <ol className="asis-pasos">
            {PASOS.map((t, i) => (
              <li key={t} className={paso > i ? 'hecho' : paso === i ? 'activo' : ''}>
                <i aria-hidden />{t}
                {i === 0 && paso > 0 && red && (
                  <em>{red.error ? 'no se pudo detectar' : red.empresa ? `${red.empresa} (red AS${red.asn})` : red.titular ?? `red AS${red.asn}`}</em>
                )}
                {i === 1 && paso > 1 && red?.latenciaMs != null && <em>{red.latenciaMs} ms</em>}
                {i === 2 && listo && enZona && <em>{enZona.enOcn + enZona.otras} reportes de {empresa} en {region}</em>}
              </li>
            ))}
          </ol>

          {listo && (
            <>
              <div className="asis-campo">
                <span>Compañía {detectada && red?.empresa === empresa && <small className="detectada">✓ detectada</small>}</span>
                <div className="chips mini">
                  {EMPRESAS.map((x) => (
                    <button key={x} className={empresa === x ? 'activo' : ''} onClick={() => { setEmpresa(x); setDetectada(false) }}>{x}</button>
                  ))}
                </div>
                {servicio === 'internet_fijo' && red?.tipoConexion === 'movil' && <small className="pista">Si usas datos móviles porque se cayó tu hogar, elige la compañía de tu hogar.</small>}
              </div>
              <div className="asis-fila">
                <div className="chips mini">
                  {SERVICIOS.map(([v, t]) => (
                    <button key={v} className={servicio === v ? 'activo' : ''} onClick={() => setServicio(v)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="asis-fila">
                <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Región">
                  <option value="">Región…</option>
                  {REGIONES_CL.map(([n]) => <option key={n}>{n}</option>)}
                </select>
                <input value={comuna} onChange={(e) => setComuna(e.target.value)} maxLength={60} placeholder="Comuna" aria-label="Comuna (opcional)" />
                <button className="btn-ubic" onClick={ubicar} title="Usar mi ubicación aproximada" aria-label="Usar mi ubicación">{coords ? '✓' : '📍'}</button>
              </div>
              {estado.tipo === 'error' && <p className="error">{estado.msg}</p>}
              <div className="asis-botones">
                <button className="b-caido" disabled={estado.tipo === 'enviando'} onClick={() => reportar('caido')}>
                  {estado.cual === 'caido' ? 'Enviando…' : <>Sin servicio</>}
                </button>
                <button className="b-lento" disabled={estado.tipo === 'enviando'} onClick={() => reportar('lento')}>
                  {estado.cual === 'lento' ? 'Enviando…' : <>Lento o se corta</>}
                </button>
                <button className="b-ok" onClick={() => reportar('funciona')}>Funciona</button>
              </div>
              <p className="nota">OCN no guarda tu IP ni tu ubicación exacta. La compañía se detecta con RIPEstat, un servicio público.</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
