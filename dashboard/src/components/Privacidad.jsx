import { useState } from 'react'
import { avisoGuardado, desactivarAviso } from '../lib/avisos'
import {
  FECHA_POLITICA, RETENCION_DIAS, VERSION_POLITICA, borrarMisDatos, consentimiento, datosLocales, descargarJSON,
  dispositivoExistente, enviarSolicitud, misDatos, retirarConsentimiento,
} from '../lib/privacidad'

const TIPOS = [
  ['acceso', 'Acceso: saber qué datos tienen de mí'],
  ['rectificacion', 'Rectificación: corregir un dato'],
  ['supresion', 'Supresión: borrar mis datos'],
  ['oposicion', 'Oposición: que no usen mis datos para algo'],
  ['portabilidad', 'Portabilidad: recibir mis datos en un archivo'],
  ['bloqueo', 'Bloqueo: suspender temporalmente el uso'],
  ['consentimiento', 'Retirar mi consentimiento'],
  ['otra', 'Otra consulta de privacidad'],
]

// Política de tratamiento de datos (Ley 19.628 modificada por la Ley 21.719, art. 14 ter)
// y herramientas para ejercer los derechos en un toque.
export default function Privacidad() {
  const [estado, setEstado] = useState({ tipo: 'idle' })
  const [form, setForm] = useState({ tipo: 'acceso', mensaje: '', contacto: '' })
  const [envio, setEnvio] = useState({ tipo: 'idle' })
  const [acepto, setAcepto] = useState(() => !!consentimiento())
  const codigo = dispositivoExistente()

  async function ver(descargar) {
    setEstado({ tipo: 'cargando' })
    try {
      const servidor = await misDatos()
      const todo = { politica: VERSION_POLITICA, en_este_celular: datosLocales(), en_servidor_ocn: servidor }
      if (descargar) descargarJSON(todo, 'mis-datos-ocn.json')
      setEstado({ tipo: 'ok', datos: todo })
    } catch (e) {
      setEstado({ tipo: 'error', msg: e.message })
    }
  }

  async function borrar() {
    setEstado({ tipo: 'cargando' })
    try {
      const r = await borrarMisDatos()
      setAcepto(false)
      setEstado({ tipo: 'borrado', r })
    } catch (e) {
      setEstado({ tipo: 'error', msg: e.message })
    }
  }

  async function solicitar(e) {
    e.preventDefault()
    setEnvio({ tipo: 'enviando' })
    try {
      const n = await enviarSolicitud(form)
      setEnvio({ tipo: 'ok', n })
      setForm({ tipo: 'acceso', mensaje: '', contacto: '' })
    } catch (err) {
      setEnvio({ tipo: 'error', msg: err.message })
    }
  }

  const n = estado.datos?.en_servidor_ocn
  return (
    <article className="privacidad">
      <header>
        <h2>Privacidad y tus datos</h2>
        <p className="pv-sub">Política de tratamiento de datos personales · versión {VERSION_POLITICA} · {FECHA_POLITICA}</p>
        <AvisoActivo />
        <p className="pv-lead">
          OCN no te pide nombre, RUT, correo ni teléfono para reportar. Lo que envías se usa para mostrar dónde hay fallas
          y contar cuántas personas están afectadas. Aquí puedes ver, descargar o borrar lo tuyo cuando quieras.
        </p>
      </header>

      <section className="pv-caja pv-acciones" aria-labelledby="pv-tus-datos">
        <h3 id="pv-tus-datos">Tus datos en un toque</h3>
        {codigo
          ? <p>Este celular tiene un código aleatorio de OCN (<code>{codigo.slice(0, 8)}…</code>). Con él vemos qué reportes son tuyos, sin saber quién eres.</p>
          : <p>Este celular todavía no ha enviado reportes a OCN, así que no tenemos datos tuyos.</p>}
        <div className="pv-botones">
          <button type="button" className="btn-secundario" onClick={() => ver(false)} disabled={estado.tipo === 'cargando'}>Ver mis datos</button>
          <button type="button" className="btn-secundario" onClick={() => ver(true)} disabled={estado.tipo === 'cargando'}>Descargar (JSON)</button>
          <button type="button" className="btn-peligro" onClick={() => { if (estado.tipo === 'confirmar') borrar(); else setEstado({ tipo: 'confirmar' }) }} disabled={estado.tipo === 'cargando'}>
            {estado.tipo === 'confirmar' ? 'Sí, borrar todo' : 'Borrar mis datos'}
          </button>
          {acepto && (
            <button type="button" className="btn-link" onClick={() => { retirarConsentimiento(); setAcepto(false) }}>Retirar mi consentimiento</button>
          )}
        </div>
        {estado.tipo === 'confirmar' && <p className="pv-aviso">Se borran tus reportes y reclamos del servidor y todo lo que OCN guardó en este celular (tu compañía, tus reclamos y su número). No se puede deshacer.</p>}
        {estado.tipo === 'cargando' && <p>Un momento…</p>}
        {estado.tipo === 'error' && <p className="pv-error">No se pudo completar: {estado.msg}. Si sigue fallando, usa el formulario de abajo.</p>}
        {estado.tipo === 'borrado' && (
          <p className="pv-ok">Listo. Borramos {estado.r ? `${estado.r.reportes} reporte(s), ${estado.r.me_funciona ?? 0} señal(es) «me funciona», ${estado.r.reclamos} reclamo(s) y ${estado.r.resultados} resultado(s) del servidor, y ` : ''}todo lo guardado en este celular.</p>
        )}
        {estado.tipo === 'ok' && (
          <>
            <p className="pv-ok">
              En el servidor: {n ? `${n.reportes.length} reporte(s), ${(n.me_funciona ?? []).length} señal(es) «me funciona», ${n.reclamos.length} reclamo(s) y ${n.resultados_reclamos.length} resultado(s).` : 'nada asociado a este celular.'}
              {' '}En este celular: {Object.keys(estado.datos.en_este_celular).length} dato(s) guardado(s).
            </p>
            <pre className="pv-json">{JSON.stringify(estado.datos, null, 2)}</pre>
          </>
        )}
      </section>

      <section>
        <h3>1. Quién es responsable</h3>
        <p>
          <b>OCN · Observatorio Ciudadano de Redes</b>, iniciativa ciudadana sin fines de lucro, en proceso de formalización como
          persona jurídica. Puedes contactarnos por el <a href="#pv-formulario">formulario de privacidad</a> de esta página.
          No hay encargado de prevención designado.
        </p>
      </section>

      <section>
        <h3>2. Qué datos tratamos, para qué y con qué base</h3>
        <div className="pv-tabla" role="table">
          <div role="row" className="pv-fila pv-cab"><span role="columnheader">Dato</span><span role="columnheader">Para qué</span><span role="columnheader">Base legal</span><span role="columnheader">Cuánto tiempo</span></div>
          <Fila d="Reporte de falla: compañía, servicio, tipo de problema, desde cuándo, región y comuna (opcional), hora"
            p="Mostrar la falla en el mapa, contar personas afectadas y estadísticas" b="Tu consentimiento (art. 12)" t="Visible al público 24 h; luego queda como estadística anónima" />
          <Fila d="Señal «Me funciona bien»: compañía, servicio, región y comuna (opcional), hora"
            p="Saber cuánta gente está conectada sin problemas, para detectar caídas con más certeza (línea base)" b="Tu consentimiento (art. 12)" t="Visible al público 24 h; luego queda como estadística anónima" />
          <Fila d="Aviso de caídas (si lo activas): la dirección de entrega que crea tu navegador, la compañía y la región elegidas. Sin correo ni teléfono"
            p="Avisarte cuando se cae tu compañía en tu región" b="Tu consentimiento (lo das al activar el aviso)" t="Hasta que lo desactives, borres tus datos o pasen 180 días sin uso" />
          <Fila d="Ubicación aproximada (redondeada a ~1 km), solo si tocas “usar mi ubicación” y tu navegador lo permite"
            p="Sugerir tu región y ubicar mejor la falla. No es pública" b="Tu consentimiento" t={`Se borra a los ${RETENCION_DIAS} días`} />
          <Fila d="Código aleatorio del celular (no es tu número ni tu identidad)"
            p="Evitar reportes repetidos y permitirte ver o borrar tus datos" b="Tu consentimiento" t={`Se desvincula a los ${RETENCION_DIAS} días`} />
          <Fila d="Huella cifrada de tu dirección IP (SHA-256 con clave secreta; la IP no se guarda)"
            p="Frenar el spam: un reporte cada 30 minutos y una señal «me funciona» por hora" b="Interés legítimo en la integridad de los datos (art. 13 d)" t="Máximo 3 días" />
          <Fila d="Reclamo armado en OCN: solo se cuenta (compañía, servicio, región, tipo, desde cuándo)"
            p="Contador público de reclamos" b="Tu consentimiento" t={`Código desvinculado a los ${RETENCION_DIAS} días`} />
          <Fila d="Resultado de tu reclamo: compañía, resultado y días hábiles"
            p="Estadística “¿responden las compañías?”" b="Tu consentimiento" t={`Código desvinculado a los ${RETENCION_DIAS} días`} />
          <Fila d="Solicitudes de privacidad: tipo, mensaje y el contacto que nos des"
            p="Responder tu solicitud" b="Obligación legal (art. 13 b)" t="2 años desde que se cierra" />
        </div>
        <p>
          <b>Nunca subimos</b> tu nombre, RUT, número de cliente, dirección, número de reclamo ni el texto de tu reclamo:
          eso queda solo en tu celular. Tampoco tratamos datos sensibles ni vendemos datos personales.
        </p>
        <p>
          <b>En tu celular</b> (almacenamiento local del navegador) guardamos tu compañía y comuna para reportar en un toque,
          tus reclamos para recordarte los plazos, el código aleatorio y tu aceptación de esta política. No usamos cookies de
          publicidad ni herramientas de analítica.
        </p>
        <p>
          <b>Otras fuentes:</b> el mapa también muestra datos públicos de sitios de reportes y de mediciones de red
          (Geoblackout, FallaCL, IODA, Blackout Map, RIPE Atlas, Cloudflare Radar, SEC, clima de Open-Meteo, sismos de USGS y conexiones por comuna de SUBTEL). De Geoblackout guardamos extractos de comentarios
          públicos con su ciudad, sin nombres de usuario, solo para ubicar fallas.
        </p>
      </section>

      <section>
        <h3>3. Con quién se comparten (destinatarios y transferencias internacionales)</h3>
        <ul>
          <li><b>Supabase Inc.</b> (Estados Unidos): base de datos donde se guardan los reportes.</li>
          <li><b>Netlify Inc.</b> (Estados Unidos): aloja esta página web.</li>
          <li><b>Esri</b> (Estados Unidos): dibuja el mapa base; tu navegador le pide las imágenes del mapa.</li>
          <li><b>RIPE NCC</b> (Países Bajos): al abrir el asistente, tu navegador le consulta a qué red pertenece tu conexión, para sugerirte tu compañía. OCN no recibe ni guarda tu IP.</li>
          <li><b>WhatsApp</b>, <b>SUBTEL</b> u otro canal: solo si tú decides compartir o enviar tu reclamo; OCN no envía nada a tu nombre.</li>
        </ul>
        <p>
          Estos proveedores reciben técnicamente tu dirección IP al cargar la página, según sus propias políticas.
          Los datos se transfieren fuera de Chile por necesidad técnica del servicio que tú usas. A la fecha de esta
          política, la Agencia de Protección de Datos Personales aún no ha publicado la lista de países con nivel adecuado
          de protección (art. 28). Las publicaciones y estadísticas de OCN usan solo cifras agregadas.
        </p>
      </section>

      <section>
        <h3>4. Tus derechos</h3>
        <p>
          Puedes pedir <b>acceso</b>, <b>rectificación</b>, <b>supresión</b>, <b>oposición</b>, <b>portabilidad</b> y
          <b> bloqueo</b> de tus datos, y <b>retirar tu consentimiento</b> cuando quieras, sin dar razones (lo ya tratado
          antes sigue siendo válido). Acceso, portabilidad y supresión los haces arriba en un toque. Para lo demás, usa
          el formulario.
        </p>
        <p>
          Respondemos dentro de <b>30 días corridos</b> (prorrogables una vez por 30 más, avisándote). Una solicitud de
          bloqueo temporal se responde en 2 días hábiles. Si rechazamos tu solicitud o no respondemos a tiempo, puedes
          reclamar ante la <b>Agencia de Protección de Datos Personales</b>.
        </p>
      </section>

      <section>
        <h3>5. Seguridad</h3>
        <p>
          Conexión cifrada (HTTPS). Reglas de acceso por fila en la base de datos: la web solo puede leer lo público y
          nunca el código de tu celular. Los límites anti-spam y las solicitudes están en un esquema privado sin acceso
          desde la web. Guardamos lo mínimo (sin nombre ni RUT) y seudonimizado. Si ocurre una vulneración de seguridad
          con riesgo para las personas, la informaremos a la Agencia de Protección de Datos Personales sin demora.
        </p>
      </section>

      <section>
        <h3>6. Decisiones automatizadas</h3>
        <p>
          El semáforo del mapa se calcula automáticamente con el número de reportes y mediciones de red por compañía y
          región. Evalúa redes, no personas: OCN no hace perfiles ni toma decisiones sobre ti.
        </p>
      </section>

      <section>
        <h3>7. Menores de edad</h3>
        <p>OCN no está dirigido a menores de 14 años. Si tienes menos de 14, pídele a un adulto que haga el reporte.</p>
      </section>

      <section>
        <h3>8. Cambios</h3>
        <p>Si cambiamos esta política, actualizamos la versión y la fecha aquí. Al enviar un reporte aceptas la versión vigente.</p>
      </section>

      <section className="pv-caja" id="pv-formulario" aria-labelledby="pv-form-titulo">
        <h3 id="pv-form-titulo">Formulario de privacidad</h3>
        {envio.tipo === 'ok' ? (
          <p className="pv-ok">Recibimos tu solicitud N° {envio.n}. Te responderemos al contacto que dejaste dentro de 30 días corridos.</p>
        ) : (
          <form onSubmit={solicitar} className="pv-form">
            <label>Qué necesitas
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label>Detalle
              <textarea required minLength={5} maxLength={2000} rows={4} value={form.mensaje}
                onChange={(e) => setForm({ ...form, mensaje: e.target.value })}
                placeholder="Cuéntanos qué dato y qué quieres que hagamos. No incluyas tu RUT." />
            </label>
            <label>Dónde te respondemos (correo o teléfono)
              <input required minLength={5} maxLength={200} value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
            </label>
            <p className="pv-nota">Usaremos este contacto solo para responder esta solicitud.</p>
            <button type="submit" className="btn-primario" disabled={envio.tipo === 'enviando'}>{envio.tipo === 'enviando' ? 'Enviando…' : 'Enviar solicitud'}</button>
            {envio.tipo === 'error' && <p className="pv-error">No se pudo enviar: {envio.msg}</p>}
          </form>
        )}
      </section>
    </article>
  )
}

function Fila({ d, p, b, t }) {
  return (
    <div role="row" className="pv-fila">
      <span role="cell" data-t="Dato">{d}</span>
      <span role="cell" data-t="Para qué">{p}</span>
      <span role="cell" data-t="Base legal">{b}</span>
      <span role="cell" data-t="Plazo">{t}</span>
    </div>
  )
}

// Si este celular tiene un aviso de caídas activo, se puede desactivar aquí en un toque.
function AvisoActivo() {
  const [aviso, setAviso] = useState(avisoGuardado)
  if (!aviso) return null
  return (
    <p className="pv-aviso">🔔 Tienes activado el aviso de caídas de {aviso.empresa} en {aviso.region}.{' '}
      <button type="button" className="btn-link" onClick={async () => { await desactivarAviso().catch(() => {}); setAviso(null) }}>Desactivar aviso</button>
    </p>
  )
}
