// Servicios de telecomunicaciones (los que vigila el OCN). FallaCL también informa apps
// (bancos, streaming, redes sociales): se muestran en el mapa, pero no pintan el semáforo
// de internet ni se atribuyen a cortes de luz.
export const TELECOM = new Set(['internet', 'internet_fijo', 'internet_movil', 'tv', 'telefonia', 'telefonia_fija'])
export const esTelecom = (f) => TELECOM.has(f?.servicio ?? 'internet')
