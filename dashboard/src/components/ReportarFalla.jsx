import { useEffect, useState } from 'react'
import { enviarFunciona, enviarReporte } from '../lib/datos'
import { dispositivo, guardarPerfil, leerPerfil } from '../lib/perfil'
import { aceptar } from '../lib/privacidad'
import NoEresElUnico from './NoEresElUnico'
import { REGIONES_CL } from '../lib/geo'

const EMPRESAS = ['Movistar', 'Entel', 'VTR', 'Claro', 'WOM', 'GTD', 'Mundo', 'Telsur', 'Starlink', 'DIRECTV', 'Otro']
const SERVICIOS = [['internet_fijo', 'Internet hogar'], ['internet_movil', 'Internet móvil'], ['tv', 'TV'], ['telefonia', 'Telefonía']]

// Región más cercana a una coordenada (por la capital regional): solo sugiere, la persona confirma.
function regionCercana(lat, lon) {
  let mejor = null
  for (const [nombre, la, lo] of REGIONES_CL) {
    const d = (la - lat) ** 2 + ((lo - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (!mejor || d < mejor.d) mejor = { nombre, d }
  }
  return mejor?.nombre
}

export default function ReportarFalla({ abierto, cerrar, regionInicial, alEnviar, contar, verPrivacidad }) {
  const recordado = leerPerfil()
  const [empresa, setEmpresa] = useState(recordado?.empresa ?? '')
  const [servicio, setServicio] = useState(recordado?.servicio ?? 'internet_fijo')
  const [region, setRegion] = useState(recordado?.region ?? '')
  const [comuna, setComuna] = useState(recordado?.comuna ?? '')
  const [coords, setCoords] = useState(null)
  const [estado, setEstado] = useState({ tipo: 'idle' })
  // Antibots: un campo trampa invisible (las personas no lo ven ni lo llenan) y un tiempo mínimo
  // desde que se abre el formulario. Además, la base de datos limita a 1 reporte cada 30 min por dispositivo.
  const [trampa, setTrampa] = useState('')
  const [abiertoEn, setAbiertoEn] = useState(0)

  useEffect(() => {
    if (abierto) { setEstado({ tipo: 'idle' }); setTrampa(''); setAbiertoEn(Date.now()); if (regionInicial) setRegion(regionInicial) }
  }, [abierto, regionInicial])

  if (!abierto) return null

  function ubicar() {
    if (!navigator.geolocation) return setEstado({ tipo: 'error', msg: 'Tu navegador no permite ubicación.' })
    setEstado({ tipo: 'ubicando' })
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = Math.round(p.coords.latitude * 100) / 100
        const lon = Math.round(p.coords.longitude * 100) / 100
        if (lat > -17 || lat < -56.5 || lon > -66 || lon < -110) {
          setEstado({ tipo: 'error', msg: 'Tu ubicación no parece estar en Chile. Elige la región a mano.' })
          return
        }
        setCoords({ lat, lon })
        setRegion(regionCercana(lat, lon) ?? '')
        setEstado({ tipo: 'idle' })
      },
      () => setEstado({ tipo: 'error', msg: 'No se pudo obtener tu ubicación. Elige la región a mano.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  async function enviar(e) {
    e.preventDefault()
    if (!empresa || !region) return setEstado({ tipo: 'error', msg: 'Elige tu compañía y tu región.' })
    if (trampa || Date.now() - abiertoEn < 1500) return setEstado({ tipo: 'error', msg: 'Espera un segundo y vuelve a intentarlo.' })
    aceptar()
    setEstado({ tipo: 'enviando' })
    try {
      const perfil = { empresa, servicio, region, comuna: comuna.trim() || null }
      await enviarReporte({ ...perfil, latitud: coords?.lat ?? null, longitud: coords?.lon ?? null, dispositivo: dispositivo() })
      guardarPerfil(perfil) // la próxima vez basta un toque
      setEstado({ tipo: 'ok', ...(await contar(empresa, region)) })
      alEnviar?.()
    } catch (err) {
      setEstado({ tipo: 'error', msg: err.message })
    }
  }

  // "Me funciona bien": línea base propia. No se pinta como falla; sirve para comparar.
  async function funciona() {
    if (!empresa || !region) return setEstado({ tipo: 'error', msg: 'Elige tu compañía y tu región.' })
    if (trampa || Date.now() - abiertoEn < 1500) return setEstado({ tipo: 'error', msg: 'Espera un segundo y vuelve a intentarlo.' })
    aceptar()
    setEstado({ tipo: 'enviando' })
    try {
      const perfil = { empresa, servicio, region, comuna: comuna.trim() || null }
      await enviarFunciona({ ...perfil, dispositivo: dispositivo() })
      guardarPerfil(perfil)
      setEstado({ tipo: 'ok-funciona' })
    } catch (err) {
      setEstado({ tipo: 'error', msg: err.message })
    }
  }

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" aria-labelledby="titulo-reporte" onClick={cerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={enviar}>
        <h2 id="titulo-reporte">¿Se te cayó el servicio?</h2>
        <input className="trampa" type="text" name="sitio_web" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trampa} onChange={(e) => setTrampa(e.target.value)} />
        {estado.tipo === 'ok-funciona' ? (
          <>
            <p className="ok-msg">✓ Gracias. Anotamos que tu {empresa} funciona bien.</p>
            <p className="nota">Tu señal ayuda a distinguir una caída real de un problema aislado.</p>
            <button type="button" className="btn-primario" onClick={cerrar}>Volver al mapa</button>
          </>
        ) : estado.tipo === 'ok' ? (
          <>
            <p className="ok-msg">✓ Gracias. Tu reporte ya aparece en el mapa.</p>
            <NoEresElUnico empresa={empresa} region={region} enOcn={estado.enOcn} otras={estado.otras} />
            <p className="nota">La próxima vez basta un toque: te preguntaremos si funciona tu {empresa}.</p>
            <button type="button" className="btn-primario" onClick={cerrar}>Volver al mapa</button>
          </>
        ) : (
          <>
            <label>Compañía
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} required>
                <option value="">Elige…</option>
                {EMPRESAS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <fieldset className="chips">
              <legend>Servicio</legend>
              {SERVICIOS.map(([v, t]) => (
                <button type="button" key={v} className={servicio === v ? 'activo' : ''} onClick={() => setServicio(v)}>{t}</button>
              ))}
            </fieldset>
            <label>Región
              <select value={region} onChange={(e) => setRegion(e.target.value)} required>
                <option value="">Elige…</option>
                {REGIONES_CL.map(([n]) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className="btn-secundario" onClick={ubicar} disabled={estado.tipo === 'ubicando'}>
              {estado.tipo === 'ubicando' ? 'Buscando…' : coords ? `📍 Ubicación aproximada lista (~1 km)` : '📍 Usar mi ubicación (opcional)'}
            </button>
            <label>Comuna (opcional)
              <input value={comuna} onChange={(e) => setComuna(e.target.value)} maxLength={60} placeholder="Ej: Maipú" />
            </label>
            {estado.tipo === 'error' && <p className="error">{estado.msg}</p>}
            <button type="submit" className="btn-primario" disabled={estado.tipo === 'enviando'}>
              {estado.tipo === 'enviando' ? 'Enviando…' : 'Enviar reporte'}
            </button>
            <button type="button" className="btn-secundario" onClick={funciona} disabled={estado.tipo === 'enviando'}>
              🟢 A mí me funciona bien
            </button>
            <p className="nota">Sin nombre ni RUT. Al enviar aceptas la <button type="button" className="btn-link" onClick={() => { cerrar(); verPrivacidad?.() }}>política de privacidad</button>.</p>
            <button type="button" className="cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
          </>
        )}
      </form>
    </div>
  )
}
