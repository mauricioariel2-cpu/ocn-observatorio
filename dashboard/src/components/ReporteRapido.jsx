import { useState } from 'react'
import { enviarReporte } from '../lib/datos'
import { dispositivo, leerPerfil } from '../lib/perfil'
import NoEresElUnico from './NoEresElUnico'

const NOMBRE_SERVICIO = { internet_fijo: 'internet de hogar', internet_movil: 'internet móvil', tv: 'TV', telefonia: 'telefonía' }

// Reporte de un toque: si la persona ya reportó antes, se le pregunta "¿funciona?" con
// sus datos recordados y "No" envía el reporte al instante. Si no, abre el formulario.
export default function ReporteRapido({ abrirFormulario, contar, version }) {
  const perfil = leerPerfil()
  const [estado, setEstado] = useState({ tipo: 'pregunta' })
  void version // fuerza a releer el perfil cuando cambia

  if (!perfil) {
    return <button className="btn-reportar" onClick={abrirFormulario}>⚠ ¿Sin internet? Repórtalo</button>
  }

  async function noFunciona() {
    setEstado({ tipo: 'enviando' })
    try {
      await enviarReporte({ ...perfil, latitud: null, longitud: null, dispositivo: dispositivo() })
      setEstado({ tipo: 'ok', ...(await contar(perfil.empresa, perfil.region)) })
    } catch (e) {
      setEstado({ tipo: 'error', msg: e.message })
    }
  }

  if (estado.tipo === 'cerrado') {
    return <button className="btn-reportar" onClick={() => setEstado({ tipo: 'pregunta' })}>⚠ ¿Se cayó tu {perfil.empresa}?</button>
  }

  return (
    <div className="rapido" role="region" aria-label="Reporte rápido">
      <button className="rapido-cerrar" onClick={() => setEstado({ tipo: 'cerrado' })} aria-label="Ocultar">✕</button>
      {estado.tipo === 'ok' ? (
        <>
          <p className="rapido-titulo">✓ Reporte enviado</p>
          <NoEresElUnico empresa={perfil.empresa} region={perfil.region} enOcn={estado.enOcn} otras={estado.otras} />
        </>
      ) : (
        <>
          <p className="rapido-titulo">¿Funciona tu {NOMBRE_SERVICIO[perfil.servicio] ?? 'servicio'} {perfil.empresa}?</p>
          <p className="rapido-sub">{perfil.comuna ? `${perfil.comuna}, ` : ''}{perfil.region} · <button className="enlace" onClick={abrirFormulario}>cambiar</button></p>
          {estado.tipo === 'error' && <p className="error">{estado.msg}</p>}
          <div className="rapido-botones">
            <button className="btn-si" onClick={() => setEstado({ tipo: 'cerrado' })}>Sí, funciona</button>
            <button className="btn-no" onClick={noFunciona} disabled={estado.tipo === 'enviando'}>
              {estado.tipo === 'enviando' ? 'Enviando…' : 'No, se cayó'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
