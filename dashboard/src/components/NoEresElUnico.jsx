// Respuesta después de reportar: cuántos más tienen el mismo problema (conteos reales).
export default function NoEresElUnico({ empresa, region, enOcn, otras }) {
  const otrosVecinos = Math.max(enOcn - 1, 0) // el propio reporte ya está contado
  return (
    <div className="unico" role="status">
      {otrosVecinos > 0 ? (
        <p><b>No eres el único.</b> {otrosVecinos} vecino{otrosVecinos === 1 ? '' : 's'} más reportaron {empresa} en {region} en la última hora.</p>
      ) : (
        <p><b>Eres el primero</b> en reportar {empresa} en {region} en OCN esta hora. Si más vecinos se suman, la falla se ve en el mapa.</p>
      )}
      {otras > 0 && <p className="unico-otras">Otros sitios de reportes registran {otras} reporte{otras === 1 ? '' : 's'} de {empresa} en {region}.</p>}
    </div>
  )
}
