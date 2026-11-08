const ETIQUETA = { falla_masiva: 'Falla masiva', posibles_problemas: 'Posibles problemas', normal: 'Normal' }

export default function PanelNacional({ filas, puntos, actualizado, error }) {
  return (
    <aside className="panel">
      <h1>Observatorio Ciudadano de Redes</h1>
      <p className="sub">Caídas reportadas en las últimas 3 horas</p>
      {error && <p className="error">No pude leer Supabase: {error}</p>}

      <h2>Comunas afectadas ({puntos.length})</h2>
      {puntos.length === 0 && <p className="vacio">Sin focos activos con ubicación.</p>}
      <ul className="lista">
        {puntos.slice(0, 10).map((p) => (
          <li key={`${p.lat},${p.lon}`} className={p.gravedad}>
            <span>{p.comuna}</span><b>{p.total}</b>
          </li>
        ))}
      </ul>

      <h2>Estado nacional por empresa</h2>
      <ul className="lista">
        {filas.map((f) => (
          <li key={`${f.fuente}-${f.empresa}-${f.servicio}`} className={f.gravedad}>
            <span>{f.empresa} <small>({f.fuente})</small></span>
            <b>{f.cantidad_reportes ?? '–'}</b>
            <em>{ETIQUETA[f.gravedad] ?? 's/i'}</em>
          </li>
        ))}
      </ul>
      <p className="pie">Actualizado: {actualizado ? actualizado.toLocaleTimeString('es-CL') : '…'} · se refresca cada minuto</p>
    </aside>
  )
}
