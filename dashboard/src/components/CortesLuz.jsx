import { useMemo, useState } from 'react'
import { FUENTE_SEC } from '../lib/luz'

const fmt = (n) => n.toLocaleString('es-CL')
const horaCL = (iso) => new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' })

// Vista "Cortes de luz": comunas con clientes sin suministro eléctrico según la SEC.
// Un corte de luz explica muchas caídas de internet; por eso se muestra junto al mapa de fallas.
export default function CortesLuz({ luz, error, verEnMapa }) {
  const [filtro, setFiltro] = useState('')
  const porRegion = useMemo(() => {
    const m = new Map()
    for (const c of luz.comunas) {
      const r = m.get(c.region) ?? { region: c.region, clientes: 0, comunas: [] }
      r.clientes += c.clientes
      r.comunas.push(c)
      m.set(c.region, r)
    }
    return [...m.values()].sort((a, b) => b.clientes - a.clientes)
  }, [luz])
  const max = luz.comunas[0]?.clientes ?? 1
  const q = filtro.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const visibles = q
    ? luz.comunas.filter((c) => `${c.comuna} ${c.region}`.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').includes(q))
    : luz.comunas

  return (
    <div className="cortes">
      <header className="cortes-cab">
        <div>
          <p className="sobre">Cortes de luz · ahora</p>
          <h2>{luz.hora ? <><b>{fmt(luz.total)}</b> clientes sin luz</> : 'Sin datos de la SEC todavía'}</h2>
          <p className="tenue">
            {luz.hora ? <>en {luz.comunas.length} comunas · datos SEC de {horaCL(luz.hora)}</> : 'El recolector consulta la SEC cada 15 minutos.'}
          </p>
        </div>
        {luz.hora && <button className="btn-sec" onClick={verEnMapa}>Ver en el mapa</button>}
      </header>

      {error && <p className="error">No pude leer los cortes de luz: {error}</p>}

      <p className="cortes-por-que">
        <b>¿Por qué importa?</b> Sin luz se apaga el módem y también las antenas del barrio. Si tu internet se cayó y tu comuna aparece aquí,
        lo más probable es que la causa sea el corte eléctrico y no la empresa de internet.
      </p>

      {porRegion.length > 0 && (
        <section className="tarjeta">
          <h3>Por región</h3>
          <ul className="barras-luz">
            {porRegion.map((r) => (
              <li key={r.region}>
                <span>{r.region}</span>
                <i style={{ width: `${Math.max(2, (r.clientes / porRegion[0].clientes) * 100)}%` }} />
                <b>{fmt(r.clientes)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {luz.comunas.length > 0 && (
        <section className="tarjeta">
          <div className="tarjeta-cab">
            <h3>Comunas afectadas</h3>
            <input type="search" placeholder="Buscar comuna" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar comuna" />
          </div>
          <ul className="lista-luz">
            {visibles.map((c) => (
              <li key={c.comuna}>
                <span><b>{c.comuna}</b><small>{c.region}</small></span>
                <span className="medidor" aria-hidden><i style={{ width: `${Math.max(3, (c.clientes / max) * 100)}%` }} /></span>
                <em>{fmt(c.clientes)}</em>
              </li>
            ))}
            {visibles.length === 0 && <li className="vacio">Tu comuna no tiene cortes informados ahora.</li>}
          </ul>
        </section>
      )}

      <p className="pie">
        Fuente: <a href={FUENTE_SEC} target="_blank" rel="noreferrer">SEC, Interrupciones en línea</a>. Los datos los cargan las empresas distribuidoras y
        pueden variar mientras completan su carga. Se muestran comunas con 10 clientes o más sin suministro.
      </p>
    </div>
  )
}
