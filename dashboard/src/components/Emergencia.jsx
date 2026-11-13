import { estadoEmpresas, TEXTO_ESTADO_EMPRESA } from '../lib/estadoEmpresas'
import { climaFuerte } from '../lib/entorno'
import { REGIONES_CL } from '../lib/geo'
import { FUENTE_SEC } from '../lib/luz'

const fmt = (n) => n.toLocaleString('es-CL')
const hora = (t) => new Date(t).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })

// Fuentes oficiales (verificadas el 12-nov-2026). OCN no emite alertas ni instrucciones de evacuación.
const OFICIALES = [
  ['SENAPRED: alertas y emergencias', 'https://senapred.cl/eventos/', 'Servicio Nacional de Prevención y Respuesta ante Desastres'],
  ['SHOA: alerta de tsunami (SNAM)', 'https://www.snamchile.cl/', 'Sistema Nacional de Alarma de Maremotos, Armada de Chile'],
  ['Centro Sismológico Nacional', 'https://www.sismologia.cl/', 'Últimos sismos en Chile, Universidad de Chile'],
  ['SEC: cortes de luz', FUENTE_SEC, 'Superintendencia de Electricidad y Combustibles'],
]
const NUMEROS = [['131', 'Ambulancia (SAMU)'], ['132', 'Bomberos'], ['133', 'Carabineros']]

// Modo emergencia: una sola página con lo que sirve en una catástrofe (redes, luz, sismos, clima, números y
// enlaces oficiales). Todo sale de los mismos datos en vivo del mapa.
export default function Emergencia({ todas, luz, entorno, actualizado, abrirFicha, verLuz }) {
  const empresas = estadoEmpresas(todas)
  const clima = REGIONES_CL.map(([n]) => [n, climaFuerte(entorno.clima, n)]).filter(([, c]) => c)
  const sismos = [...(entorno.sismos ?? [])].sort((a, b) => b.hora - a.hora)
  return (
    <div className="emergencia">
      <header>
        <p className="sobre">Modo emergencia · en vivo</p>
        <h2>¿Hay señal y luz en Chile?</h2>
        <p className="tenue">{actualizado ? `Actualizado ${hora(actualizado)}` : 'Cargando datos…'} · se actualiza solo cada minuto</p>
      </header>

      <p className="em-oficial">
        <b>Para alertas, evacuación o tsunami sigue solo a las fuentes oficiales</b> (SENAPRED y SHOA, enlaces abajo). OCN no emite alertas: muestra el estado de las redes y la luz con datos reales.
      </p>

      <section>
        <h3>Redes por compañía (última hora)</h3>
        <div className="tarjetas-empresas">
          {empresas.map((e) => (
            <button key={e.clave} className={`tarjeta-empresa ${e.estado}`} onClick={() => abrirFicha(e.empresa)}>
              <span className="te-nombre">{e.empresa}</span>
              <span className="te-estado"><i aria-hidden />{TEXTO_ESTADO_EMPRESA[e.estado]}</span>
              <small>{e.conDatos === 0 ? 'Sin información en la última hora' : e.estado === 'aislados' ? 'Solo reportes de personas en OCN, sin confirmar' : e.conFalla.length ? `${e.conFalla.length} de ${e.conDatos} fuentes ven falla` : `${e.conDatos} fuentes, ninguna ve falla`}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Luz</h3>
        {luz.hora ? (
          <>
            <p><b className="em-num">{fmt(luz.total)}</b> clientes sin luz en {luz.comunas.length} comunas <span className="tenue">(SEC, {hora(luz.hora)})</span></p>
            {luz.comunas.length > 0 && <ul className="em-lista">{luz.comunas.slice(0, 8).map((c) => <li key={c.comuna}><span>{c.comuna} <small>{c.region}</small></span><b>{fmt(c.clientes)}</b></li>)}</ul>}
            <button className="btn-sec" onClick={verLuz}>Ver todas las comunas</button>
          </>
        ) : <p className="tenue">Sin datos de la SEC todavía.</p>}
        <p className="pie">Fuente: <a href={FUENTE_SEC} target="_blank" rel="noreferrer">SEC, interrupciones en línea</a></p>
      </section>

      <section>
        <h3>Sismos fuertes (últimas 6 horas)</h3>
        {sismos.length === 0
          ? <p className="tenue">Ningún sismo de magnitud 5,5 o más en Chile en las últimas 6 horas (USGS). Los sismos menores están en el Centro Sismológico Nacional.</p>
          : <ul className="em-lista">{sismos.map((s) => <li key={s.hora + s.lugar}><span><a href={s.url} target="_blank" rel="noreferrer">{s.lugar}</a> <small>{hora(s.hora)}</small></span><b>M {s.mag.toFixed(1)}</b></li>)}</ul>}
      </section>

      {clima.length > 0 && (
        <section>
          <h3>Lluvia o viento fuerte ahora</h3>
          <ul className="em-lista">{clima.map(([n, c]) => <li key={n}><span>{n}</span><small>{c.lluvia >= 1 ? `${c.lluvia} mm en 15 min` : ''} {c.rafagas >= 60 ? `ráfagas ${Math.round(c.rafagas)} km/h` : ''}</small></li>)}</ul>
          <p className="pie">Open-Meteo, medido en la capital de cada región.</p>
        </section>
      )}

      <section>
        <h3>Si no tienes señal</h3>
        <ul className="em-consejos">
          <li>Si las llamadas no pasan, prueba con <b>SMS o mensajes de texto</b>: ocupan mucho menos la red.</li>
          <li>Haz llamadas cortas y deja libre la línea para emergencias.</li>
          <li>Ahorra batería: baja el brillo y cierra apps que no uses.</li>
          <li>Si tienes señal, <b>reporta tu falla en OCN</b>: ayuda a que otros sepan qué compañía y qué comuna están afectadas.</li>
        </ul>
      </section>

      <section>
        <h3>Números de emergencia</h3>
        <div className="em-numeros">{NUMEROS.map(([n, t]) => <a key={n} href={`tel:${n}`}><b>{n}</b><span>{t}</span></a>)}</div>
      </section>

      <section>
        <h3>Fuentes oficiales</h3>
        <ul className="em-lista">{OFICIALES.map(([t, u, d]) => <li key={u}><span><a href={u} target="_blank" rel="noreferrer">{t}</a><small>{d}</small></span></li>)}</ul>
      </section>
    </div>
  )
}
