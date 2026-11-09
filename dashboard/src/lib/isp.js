// Detecta con qué compañía navega la persona, a partir del número de red (ASN) de su
// conexión, usando RIPEstat (RIPE NCC, servicio público y gratuito). OCN no guarda la IP:
// solo se usa en el navegador para saber la compañía.
const RIPE = 'https://stat.ripe.net/data'
const APP = 'sourceapp=ocn-observatorio'

// Mismos ASN verificados que usa el recolector (IODA).
export const ASN_EMPRESA = {
  7418: 'Movistar', 27680: 'Movistar', 7004: 'Movistar', 52489: 'Movistar',
  22047: 'VTR',
  27651: 'Entel', 27925: 'Entel', 6471: 'Entel',
  27995: 'Claro',
  14259: 'GTD',
  14117: 'Telsur',
  52341: 'WOM',
  273019: 'DIRECTV',
}

async function json(url, ms = 6000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// Devuelve { empresa, asn, titular, latenciaMs, tipoConexion } o lanza error.
export async function detectarCompania() {
  const t0 = performance.now()
  const ip = (await json(`${RIPE}/whats-my-ip/data.json?${APP}`)).data?.ip
  const latenciaMs = Math.round(performance.now() - t0)
  if (!ip) throw new Error('sin IP')
  const asn = (await json(`${RIPE}/network-info/data.json?${APP}&resource=${encodeURIComponent(ip)}`)).data?.asns?.[0]
  let titular = null
  if (asn && !ASN_EMPRESA[asn]) {
    try { titular = (await json(`${RIPE}/as-overview/data.json?${APP}&resource=AS${asn}`)).data?.holder ?? null } catch { /* opcional */ }
  }
  const tipo = navigator.connection?.type // Android/Chrome: 'cellular' | 'wifi' | ...
  return {
    empresa: ASN_EMPRESA[asn] ?? null,
    asn: asn ?? null,
    titular,
    latenciaMs,
    tipoConexion: tipo === 'cellular' ? 'movil' : tipo === 'wifi' || tipo === 'ethernet' ? 'hogar' : null,
  }
}
