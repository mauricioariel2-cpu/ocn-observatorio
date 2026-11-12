import { useEffect, useMemo, useState } from 'react'
import { verifDe } from '../lib/datos'
import { alcance, causaDeEmpresa, ICONO_CAUSA } from '../lib/causa'
import { armarFicha, cargarHistorial, duracionTexto, HORAS_FICHA, textoEvidenciaFicha, urlFicha } from '../lib/ficha'
import { PORTAL_SUBTEL } from '../lib/reclamos'

const hora = (t) => new Date(t).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })
const horaCorta = (t) => new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })

// Ficha pública de una caída (#caida/<compañía>): sirve para compartir y como evidencia en un reclamo.
export default function FichaCaida({ slug, cerrar, todas, tri, idxLuz, reportar }) {
  const [historial, setHistorial] = useState(null)
  const [error, setError] = useState(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let vivo = true
    setHistorial(null); setError(null)
    cargarHistorial(slug).then((h) => vivo && setHistorial(h)).catch((e) => vivo && setError(e.message ?? String(e)))
    return () => { vivo = false }
  }, [slug])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && cerrar()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [cerrar])

  // Se suman los reportes de vecinos (fuente "ocn"), que viven en otra tabla.
  const ficha = useMemo(() => historial && armarFicha(slug, historial, todas.filter((f) => f.fuente === 'ocn')), [slug, historial, todas])
  const verif = ficha?.hayFalla ? verifDe(tri, { pais: 'CL', empresa: ficha.nombre }) : null
  const causa = ficha?.hayFalla ? causaDeEmpresa(ficha.nombre, 'CL', ficha.filas, idxLuz, tri) : null
  const alc = ficha?.hayFalla ? alcance(ficha.filas, ficha.nombre) : null
  const evidencia = ficha?.hayFalla ? textoEvidenciaFicha(ficha, verif, causa) : ''
  const maxN = ficha?.linea ? Math.max(1, ...ficha.linea.map((x) => x.n)) : 1

  async function copiar() {
    try { await navigator.clipboard.writeText(evidencia); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { setCopiado(false) }
  }
  async function compartir() {
    const texto = `Caída de ${ficha.nombre}${ficha.activa ? ' en curso' : ''}: ${duracionTexto(ficha.duracionMin)} registradas por el OCN. ¿Te afecta? Repórtalo:`
    const url = urlFicha(slug)
    if (navigator.share) { try { await navigator.share({ title: `OCN · Caída de ${ficha.nombre}`, text: texto, url }); return } catch { /* cancelado */ } }
    open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, '_blank', 'noopener')
  }
  async function reclamar() {
    await copiar()
    open(PORTAL_SUBTEL, '_blank', 'noopener')
  }

  return (
    <div className="modal-fondo" role="dialog" aria-modal="true" aria-labelledby="titulo-ficha" onClick={cerrar}>
      <article className="modal ficha" onClick={(e) => e.stopPropagation()}>
        <button className="ficha-cerrar" onClick={cerrar} aria-label="Cerrar ficha">✕</button>
        <p className="sobre">Ficha de caída · OCN</p>
        <h2 id="titulo-ficha">{ficha?.nombre ?? slug.toUpperCase()}</h2>

        {error && <p className="error">No pude leer el historial: {error}</p>}
        {!historial && !error && <p className="tenue">Leyendo las últimas {HORAS_FICHA} horas…</p>}
        {ficha && !ficha.hayFalla && <p className="ok-msg">Sin fallas registradas para {ficha.nombre} en las últimas {HORAS_FICHA} horas.</p>}

        {ficha?.hayFalla && (
          <>
            <div className={`ficha-estado ${ficha.activa ? 'activa' : 'terminada'}`}>
              <b>{ficha.activa ? '● Falla en curso' : 'Falla terminada'}</b>
              <span>{verif?.confirmado ? `✓ Confirmada por ${verif.fuentes.size} fuentes` : 'Sin confirmar (1 fuente)'}</span>
            </div>

            <dl className="ficha-datos">
              <div><dt>Desde</dt><dd>{hora(ficha.inicio)}<small>primera señal registrada</small></dd></div>
              <div><dt>{ficha.activa ? 'Lleva' : 'Duró'}</dt><dd>{duracionTexto(ficha.duracionMin)}<small>{ficha.activa ? `última señal ${horaCorta(ficha.fin)}` : `hasta ${horaCorta(ficha.fin)}`}</small></dd></div>
              <div><dt>Alcance</dt><dd>{alc?.texto ?? '—'}<small>{ficha.regiones.slice(0, 4).join(', ') || (ficha.nacional ? 'nivel país' : '')}</small></dd></div>
              {ficha.pico.n > 0 && <div><dt>Punto más alto</dt><dd>{ficha.pico.n} reportes<small>sumando lugares y fuentes, a las {horaCorta(ficha.pico.t)}</small></dd></div>}
            </dl>

            {causa && (
              <div className={`causa causa-${causa.tipo}`}>
                <b>{ICONO_CAUSA[causa.tipo]} {causa.texto}</b>
                <small>{causa.evidencia}</small>
              </div>
            )}

            {ficha.linea.length > 1 && (
              <figure className="ficha-linea" aria-label="Reportes cada 15 minutos">
                <div className="barras">
                  {ficha.linea.map((x) => (
                    <i key={x.t} title={`${horaCorta(x.t)}: ${x.n} reportes`} style={{ height: `${x.señal ? Math.max(6, (x.n / maxN) * 100) : 2}%` }} className={x.señal ? 'con' : ''} />
                  ))}
                </div>
                <figcaption><span>{horaCorta(ficha.linea[0].t)}</span><span>Reportes cada 15 min</span><span>{ficha.activa ? 'ahora' : horaCorta(ficha.fin)}</span></figcaption>
              </figure>
            )}

            {ficha.comunas.length > 0 && <p className="ficha-lugares"><b>Comunas:</b> {ficha.comunas.slice(0, 20).join(', ')}{ficha.comunas.length > 20 ? ` y ${ficha.comunas.length - 20} más` : ''}</p>}

            <h3>Fuentes</h3>
            <ul className="ficha-fuentes">
              {ficha.fuentes.map((f) => (
                <li key={f.fuente}>
                  <span>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.nombre}</a> : f.nombre}<small>{f.tipo === 'red' ? 'Medición de red' : 'Reportes de personas'} · última {horaCorta(f.ultima)}</small></span>
                  <b>{f.maxReportes || '—'}</b>
                </li>
              ))}
            </ul>

            <div className="ficha-acciones">
              <button className="btn-afecta" onClick={reclamar}>Usar como evidencia en mi reclamo</button>
              <button className="btn-sec" onClick={copiar}>{copiado ? '✓ Evidencia copiada' : 'Copiar evidencia'}</button>
              <button className="btn-sec" onClick={compartir}>Compartir</button>
              <button className="btn-sec" onClick={() => { cerrar(); reportar() }}>Me afecta</button>
            </div>
            <p className="pie">«Usar como evidencia» copia un párrafo con estos datos y abre el portal de reclamos de SUBTEL para que lo pegues. El OCN no envía nada a tu nombre. Las horas son las de la primera y la última señal que registraron las fuentes: la caída pudo empezar antes.</p>
          </>
        )}
      </article>
    </div>
  )
}
