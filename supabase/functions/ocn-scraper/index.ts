// OCN · Recolector como Supabase Edge Function (reemplaza a GitHub Actions).
//
// Lo llama pg_cron cada 15 minutos (ver sql/003_cron_scraper.sql).
// Fuentes (cada una con UNA o dos peticiones por corrida):
//  · Geoblackout Chile (robots.txt: Allow /, Crawl-delay 1): reportes por comuna.
//  · FallaCL (robots.txt: Allow /): API JSON pública que usa su propia web,
//    /api/reports/live, con reportes por servicio y la región del último reporte.
//  · IODA (Georgia Tech, api.ioda.inetintel.cc.gatech.edu): mediciones objetivas de
//    la red (BGP, ping a /24, telescopio). No son reportes de usuarios: detecta caídas
//    por operador (sistema autónomo), por región y del país completo.
//  · RIPE Atlas (RIPE NCC, API pública /api/v2/probes): sondas físicas en Chile; si varias
//    sondas de un mismo operador se desconectan en las últimas 3 h, es señal de corte.
//  · Blackout Map (blackoutmap.net, robots: Allow /, Crawl-delay 1; datos CC BY-NC 4.0,
//    citar "Blackout Map"): sus propios puntos de prueba DENTRO de la red de cada operador
//    chileno (ping cada 5 min) y reportes de usuarios de la última hora. Regiones de
//    status.json medidas por sus sondas.
// Downdetector no se incluye: su robots.txt prohíbe la página de DIRECTV.
//
// Variables que Supabase ya pone solas en toda función: SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY. OCN_CRON_TOKEN es opcional: si la defines en
// Edge Functions → Secrets, reemplaza al token por defecto de abajo.

const FUENTE_URL = "https://geoblackout.com/cl/report/internet";
const FALLACL_URL = "https://fallacl.cl";
const IODA_API = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const IODA_VENTANA_H = 3;
const ATLAS_API = "https://atlas.ripe.net/api/v2";
const ATLAS_CAIDA_H = 3; // una sonda que se desconectó hace menos de esto cuenta como caída reciente
const BLACKOUT_URL = "https://blackoutmap.net";
const VENTANA_HORAS = 3;
const MIN_ENTRE_CORRIDAS_MIN = 10; // freno anti-abuso: no scrapea más seguido que esto

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
];
const CONTACTO = "OCN-Observatorio-Ciudadano/0.2";
const TOKEN_POR_DEFECTO = "__OCN_TOKEN__";

const OPERADORES = ["DIRECTV", "Movistar", "Entel", "VTR", "Claro", "WOM", "GTD", "Mundo", "Telsur", "Starlink"];
const RE_OPERADOR = new RegExp(`\\b(${OPERADORES.join("|")})\\b`, "i");
const RE_CHIP = new RegExp(`^(${OPERADORES.join("|")})\\s*(\\d+)$`, "i");
const RE_ITEM = /^(.+?)\s+ca[ií]d[oa]\s+en\s+([^,\n]+)/i;
const RE_EDAD = /^hace\s+(\d+)\s*(min|h|d|s)\b/i;
const RE_ESTADO = new RegExp(`^((?:${OPERADORES.join("|")})[^\\n]{0,30}?)\\s+(Operativo|Menor|Cr[ií]tico)$`, "i");

// Centroides de comunas: [comuna, región, lat, lon]. Amplía con la tabla del INE.
const COMUNAS: Record<string, [string, string, number, number]> = {
  "maipu": ["Maipú", "Metropolitana", -33.5106, -70.7572],
  "santiago": ["Santiago", "Metropolitana", -33.4489, -70.6693],
  "puente alto": ["Puente Alto", "Metropolitana", -33.6117, -70.5758],
  "la florida": ["La Florida", "Metropolitana", -33.5227, -70.5980],
  "las condes": ["Las Condes", "Metropolitana", -33.4080, -70.5670],
  "providencia": ["Providencia", "Metropolitana", -33.4314, -70.6093],
  "nunoa": ["Ñuñoa", "Metropolitana", -33.4569, -70.5979],
  "pudahuel": ["Pudahuel", "Metropolitana", -33.4400, -70.7600],
  "quilicura": ["Quilicura", "Metropolitana", -33.3600, -70.7300],
  "san bernardo": ["San Bernardo", "Metropolitana", -33.5922, -70.6996],
  "penalolen": ["Peñalolén", "Metropolitana", -33.4850, -70.5400],
  "estacion central": ["Estación Central", "Metropolitana", -33.4600, -70.7000],
  "cerrillos": ["Cerrillos", "Metropolitana", -33.5000, -70.7160],
  "la pintana": ["La Pintana", "Metropolitana", -33.5833, -70.6333],
  "valparaiso": ["Valparaíso", "Valparaíso", -33.0472, -71.6127],
  "vina del mar": ["Viña del Mar", "Valparaíso", -33.0245, -71.5518],
  "concepcion": ["Concepción", "Biobío", -36.8270, -73.0503],
  "chillan": ["Chillán", "Ñuble", -36.6066, -72.1034],
  "temuco": ["Temuco", "Araucanía", -38.7359, -72.5904],
  "antofagasta": ["Antofagasta", "Antofagasta", -23.6509, -70.3975],
  "la serena": ["La Serena", "Coquimbo", -29.9027, -71.2519],
  "rancagua": ["Rancagua", "O'Higgins", -34.1708, -70.7444],
  "talca": ["Talca", "Maule", -35.4264, -71.6554],
  "puerto montt": ["Puerto Montt", "Los Lagos", -41.4689, -72.9411],
  "iquique": ["Iquique", "Tarapacá", -20.2133, -70.1503],
  "arica": ["Arica", "Arica y Parinacota", -18.4783, -70.3126],
};
// Centro aproximado (capital regional) de cada región, para datos con precisión de región.
const REGIONES: Record<string, [string, number, number]> = {
  "arica y parinacota": ["Arica y Parinacota", -18.4783, -70.3126],
  "tarapaca": ["Tarapacá", -20.2133, -70.1503],
  "antofagasta": ["Antofagasta", -23.6509, -70.3975],
  "atacama": ["Atacama", -27.3668, -70.3314],
  "coquimbo": ["Coquimbo", -29.9027, -71.2519],
  "valparaiso": ["Valparaíso", -33.0472, -71.6127],
  "metropolitana": ["Metropolitana", -33.4489, -70.6693],
  "o'higgins": ["O'Higgins", -34.1708, -70.7444],
  "ohiggins": ["O'Higgins", -34.1708, -70.7444],
  "maule": ["Maule", -35.4264, -71.6554],
  "nuble": ["Ñuble", -36.6066, -72.1034],
  "biobio": ["Biobío", -36.8270, -73.0503],
  "araucania": ["Araucanía", -38.7359, -72.5904],
  "la araucania": ["Araucanía", -38.7359, -72.5904],
  "los rios": ["Los Ríos", -39.8142, -73.2459],
  "los lagos": ["Los Lagos", -41.4689, -72.9411],
  "aysen": ["Aysén", -45.5712, -72.0685],
  "aisen": ["Aysén", -45.5712, -72.0685],
  "higgins": ["O'Higgins", -34.1708, -70.7444],
  "santiago": ["Metropolitana", -33.4489, -70.6693],
  "bio-bio": ["Biobío", -36.8270, -73.0503],
  "bio bio": ["Biobío", -36.8270, -73.0503],
  "magallanes": ["Magallanes", -53.1638, -70.9171],
};
const CENTRO_PAIS: [number, number] = [-33.4489, -70.6693];

type Fila = Record<string, unknown>;

export function sinTildes(t: string) {
  return t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function gravedadVolumen(n: number, posibles: number, masiva: number) {
  return n >= masiva ? "falla_masiva" : n >= posibles ? "posibles_problemas" : "normal";
}

function gravedadTexto(t?: string) {
  if (!t) return null;
  const s = sinTildes(t);
  if (/operativo|nivel habitual|no hay problemas/.test(s)) return "normal";
  if (/menor|posibles problemas/.test(s)) return "posibles_problemas";
  if (/critico|falla masiva/.test(s)) return "falla_masiva";
  return null;
}

function operador(t: string) {
  const m = t.match(RE_OPERADOR);
  return m ? OPERADORES.find((o) => o.toLowerCase() === m[1].toLowerCase())! : null;
}

function servicio(producto: string) {
  const p = sinTildes(producto.replace(RE_OPERADOR, " "));
  if (/fibra|hfc|hogar|wifi/.test(p)) return "internet_fijo";
  if (/movil|4g|5g|celular|senal/.test(p)) return "internet_movil";
  if (/tv|television|cable|satelital|canal/.test(p)) return "tv";
  return "internet_fijo";
}

function edadMin(linea: string): number | null {
  const l = linea.trim().toLowerCase();
  if (["ahora", "justo ahora", "hace un momento"].includes(l)) return 0;
  const m = l.match(RE_EDAD);
  if (!m) return null;
  const n = Number(m[1]);
  return { s: n / 60, min: n, h: n * 60, d: n * 1440 }[m[2] as "s" | "min" | "h" | "d"];
}

export function ventana15(d = new Date()) {
  const v = new Date(d);
  v.setUTCMinutes(v.getUTCMinutes() - (v.getUTCMinutes() % 15), 0, 0);
  return v.toISOString();
}

async function hash(partes: unknown[]) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(partes.map(String).join("|")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function lineasDeHtml(html: string): string[] {
  const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "\n").replace(/<style[\s\S]*?<\/style>/gi, "\n");
  const texto = sinScripts
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export async function parsear(html: string, url = FUENTE_URL, ahora = new Date()): Promise<Fila[]> {
  const lineas = lineasDeHtml(html);
  const ventana = ventana15(ahora);

  // 1) Reportes con comuna dentro de la ventana de horas.
  const activos = new Map<string, { empresa: string; serv: string; comuna: string; items: string[] }>();
  lineas.forEach((linea, i) => {
    const m = linea.match(RE_ITEM);
    if (!m) return;
    const edad = lineas.slice(i + 1, i + 6).map(edadMin).find((e) => e !== null);
    if (edad == null || edad > VENTANA_HORAS * 60) return;
    const empresa = operador(m[1]) ?? "Otro";
    const serv = servicio(m[1]);
    const k = `${empresa}|${serv}|${m[2].trim()}`;
    const a = activos.get(k) ?? { empresa, serv, comuna: m[2].trim(), items: [] };
    a.items.push(linea);
    activos.set(k, a);
  });

  // 2) Estado declarado por servicio y 3) totales 24 h por operador.
  const estados = new Map<string, string>();
  const totales = new Map<string, number>();
  lineas.forEach((linea, i) => {
    const sig = lineas[i + 1] ?? "";
    const e = linea.match(RE_ESTADO) ?? `${linea} ${sig}`.match(RE_ESTADO);
    if (e) { const op = operador(e[1]); if (op && !estados.has(op)) estados.set(op, e[2]); }
    const c = linea.match(RE_CHIP) ?? (/^\d+$/.test(sig) ? `${linea} ${sig}`.match(RE_CHIP) : null);
    if (c) totales.set(operador(c[1])!, Number(c[2]));
  });

  const filas: Fila[] = [];
  for (const a of activos.values()) {
    const info = COMUNAS[sinTildes(a.comuna)];
    const n = a.items.length;
    const base = {
      fuente: "geoblackout", pais: "CL", empresa: a.empresa, servicio: a.serv,
      comuna: info ? info[0] : a.comuna, region: info ? info[1] : null,
      latitud: info ? info[2] : null, longitud: info ? info[3] : null,
      precision_geo: info ? "comuna" : "sin_geo",
      cantidad_reportes: n, gravedad: gravedadVolumen(n, 1, 5),
      gravedad_texto: `${n} reporte(s) en las últimas ${VENTANA_HORAS} h`,
      url_fuente: url, ventana, raw: { items: a.items.slice(0, 20) },
    };
    filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", base.empresa, base.servicio, base.comuna, ventana]) });
  }
  for (const [empresa, total] of totales) {
    const est = estados.get(empresa);
    const base = {
      fuente: "geoblackout", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
      cantidad_reportes: total, gravedad: gravedadTexto(est) ?? gravedadVolumen(total, 10, 30),
      gravedad_texto: est ?? `${total} reportes en 24 h`, url_fuente: url, ventana, raw: { total_24h: total },
    };
    filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", empresa, "internet", "None", ventana]) });
  }
  return filas.filter((f) => (f.cantidad_reportes as number) > 0 || f.gravedad !== "normal");
}

// ---------- FallaCL ----------
// Mismos umbrales que muestra su web: >=5 "Falla masiva", >=2 "Posibles problemas".
const SERVICIO_FALLACL: Record<string, string> = { isp: "internet", streaming: "streaming", bancos: "banca" };

export function catalogoFallacl(html: string): Map<string, { nombre: string; cat: string }> {
  const m = new Map<string, { nombre: string; cat: string }>();
  for (const x of html.matchAll(/\{id:"([a-z0-9]+)",name:"([^"]+)",cat:"([^"]+)"/g)) m.set(x[1], { nombre: x[2], cat: x[3] });
  return m;
}

type RegionesFallacl = Record<string, { region: string; count: string | number }[]>;

// Por cada servicio con actividad: una fila nacional (reportes recientes, sirve para
// el cruce de fuentes) y una fila por región con los reportes de HOY en esa región
// (/api/reports/regions?service_id=...). Nada se reparte ni se estima: son sus conteos.
export async function parsearFallacl(
  live: { data?: Record<string, { count?: number; last_region?: string; last_ciudad?: string; last_at?: string }> },
  catalogo = new Map<string, { nombre: string; cat: string }>(),
  regiones: RegionesFallacl = {},
  ahora = new Date(),
): Promise<Fila[]> {
  const ventana = ventana15(ahora);
  const filas: Fila[] = [];
  for (const [id, d] of Object.entries(live?.data ?? {})) {
    const n = Number(d?.count ?? 0);
    const info = catalogo.get(id);
    const empresa = info?.nombre ?? id;
    const servicio = SERVICIO_FALLACL[info?.cat ?? ""] ?? info?.cat ?? "otro";
    const activo = n > 0; // tuvo reportes recientes (ventana de su sitio)
    if (activo) {
      const base = {
        fuente: "fallacl", pais: "CL", empresa, servicio, comuna: null, region: null,
        latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
        cantidad_reportes: n, gravedad: gravedadVolumen(n, 2, 5),
        gravedad_texto: `${n} reporte(s) recientes en todo Chile`,
        url_fuente: `${FALLACL_URL}/${id}`, ventana, raw: { id, ...d },
      };
      filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", id, "pais", ventana]) });
    }
    for (const r of regiones[id] ?? []) {
      const reg = regionDe(r.region);
      const c = Number(r.count);
      if (!reg || !(c > 0)) continue;
      const base = {
        fuente: "fallacl", pais: "CL", empresa, servicio, comuna: null, region: reg[0],
        latitud: reg[1], longitud: reg[2], precision_geo: "region",
        cantidad_reportes: c,
        // Solo cuenta como falla si el servicio sigue con reportes recientes.
        gravedad: activo ? gravedadVolumen(c, 2, 5) : "normal",
        gravedad_texto: `${c} reporte(s) hoy en la región ${reg[0]}`,
        url_fuente: `${FALLACL_URL}/${id}`, ventana, raw: { id, region: r.region, count: c },
      };
      filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", id, reg[0], ventana]) });
    }
  }
  return filas;
}

// ---------- IODA ----------
// Sistemas autónomos (ASN) de cada operador, verificados el 2026-11-09 contra
// /v2/entities/query?entityType=asn&relatedTo=country/CL (campo "org").
const ASN_EMPRESA: Record<string, string> = {
  "7418": "Movistar", "27680": "Movistar", "7004": "Movistar", "52489": "Movistar",
  "22047": "VTR",
  "27651": "Entel", "27925": "Entel", "6471": "Entel",
  "27995": "Claro",
  "14259": "GTD",
  "14117": "Telsur",
  "52341": "WOM",
  "273019": "DIRECTV",
};
const NIVEL_IODA: Record<string, string> = { critical: "falla_masiva", warning: "posibles_problemas" };
const FUENTE_IODA: Record<string, string> = {
  "bgp": "rutas BGP", "ping-slash24": "ping a redes /24", "merit-nt": "telescopio de red", "gtr": "tráfico a Google",
};

type AlertaIoda = {
  level: string; time: number; datasource: string; value: number; historyValue: number; condition?: string;
  entity: { code: string; type: string; name: string; attrs?: Record<string, string> };
};

export function regionDe(nombre?: string | null) {
  if (!nombre) return undefined;
  const n = sinTildes(nombre).replace(/^region (de |del )?/, "");
  if (REGIONES[n]) return REGIONES[n];
  const clave = Object.keys(REGIONES).sort((a, b) => b.length - a.length).find((k) => n.includes(k));
  return clave ? REGIONES[clave] : undefined;
}

// Por entidad, la alerta más reciente. Si es "normal", la caída ya terminó.
function vigentes(alertas: AlertaIoda[]) {
  const ult = new Map<string, AlertaIoda>();
  for (const a of alertas) {
    const k = `${a.entity.type}|${a.entity.code}|${a.datasource}`;
    if (!ult.has(k) || ult.get(k)!.time < a.time) ult.set(k, a);
  }
  return [...ult.values()].filter((a) => NIVEL_IODA[a.level]);
}

function textoIoda(a: AlertaIoda) {
  const caida = a.historyValue > 0 ? Math.round((1 - a.value / a.historyValue) * 100) : null;
  const hora = new Date(a.time * 1000).toISOString().slice(11, 16);
  return `IODA ${a.level === "critical" ? "crítico" : "alerta"}: ${FUENTE_IODA[a.datasource] ?? a.datasource}` +
    (caida != null && caida > 0 ? ` ${caida}% bajo lo normal` : "") + ` (${a.value} vs ${a.historyValue}) desde ${hora} UTC`;
}

export async function parsearIoda(alertas: AlertaIoda[], ahora = new Date()): Promise<Fila[]> {
  const ventana = ventana15(ahora);
  const peor = (x: string, y: string) => (x === "falla_masiva" || y === "falla_masiva" ? "falla_masiva" : "posibles_problemas");
  const porEmpresa = new Map<string, { gravedad: string; alertas: AlertaIoda[] }>();
  const filas: Fila[] = [];
  for (const a of vigentes(alertas)) {
    const g = NIVEL_IODA[a.level];
    if (a.entity.type === "asn") {
      const empresa = ASN_EMPRESA[a.entity.code];
      if (!empresa) continue; // solo operadores que seguimos
      const e = porEmpresa.get(empresa) ?? { gravedad: g, alertas: [] };
      e.gravedad = peor(e.gravedad, g);
      e.alertas.push(a);
      porEmpresa.set(empresa, e);
    } else if (a.entity.type === "region" || a.entity.type === "country") {
      const reg = a.entity.type === "region" ? regionDe(a.entity.name) : undefined;
      if (a.entity.type === "region" && !reg) continue;
      const base = {
        fuente: "ioda", pais: "CL", empresa: "Red completa", servicio: "internet",
        comuna: null, region: reg ? reg[0] : null,
        latitud: reg ? reg[1] : CENTRO_PAIS[0], longitud: reg ? reg[2] : CENTRO_PAIS[1],
        precision_geo: reg ? "region" : "pais", cantidad_reportes: null, gravedad: g,
        gravedad_texto: textoIoda(a), url_fuente: `https://ioda.inetintel.cc.gatech.edu/${a.entity.type}/${a.entity.code}`,
        ventana, raw: a,
      };
      filas.push({ ...base, hash_dedup: await hash(["ioda", a.entity.type, a.entity.code, a.datasource, ventana]) });
    }
  }
  for (const [empresa, e] of porEmpresa) {
    const a = e.alertas.sort((x, y) => y.time - x.time)[0];
    const base = {
      fuente: "ioda", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
      cantidad_reportes: null, gravedad: e.gravedad,
      gravedad_texto: `${textoIoda(a)} · AS${e.alertas.map((x) => x.entity.code).join(", AS")}`,
      url_fuente: `https://ioda.inetintel.cc.gatech.edu/asn/${a.entity.code}`,
      ventana, raw: { alertas: e.alertas },
    };
    filas.push({ ...base, hash_dedup: await hash(["ioda", "asn", empresa, ventana]) });
  }
  return filas;
}

// ---------- Blackout Map ----------
const PROVEEDORES_BM: Record<string, string> = {
  "movistar-chile": "Movistar", "entel-chile": "Entel", "vtr": "VTR", "mundo": "Mundo", "wom-chile": "WOM",
};

// Lee "12 of 12 test points inside X's network answer" y "0 people reported a problem in the last hour".
export function leerProveedorBM(html: string) {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&#0?39;|&#x27;/g, "'").replace(/\s+/g, " ");
  const p = t.match(/(\d+) of (\d+) test points inside/);
  const r = t.match(/(\d+) (?:people|person) reported a problem in the last hour/);
  if (!p) return null;
  return { arriba: Number(p[1]), total: Number(p[2]), reportes: r ? Number(r[1]) : null };
}

export function gravedadBM(arriba: number, total: number, reportes: number | null) {
  const frac = total > 0 ? arriba / total : 1;
  if (frac < 0.5) return "falla_masiva";
  if (frac < 0.9 || (reportes ?? 0) >= 5) return "posibles_problemas";
  return "normal";
}

export async function filaProveedorBM(slug: string, html: string, ahora = new Date()): Promise<Fila | null> {
  const d = leerProveedorBM(html);
  const empresa = PROVEEDORES_BM[slug];
  if (!d || !empresa) return null;
  const ventana = ventana15(ahora);
  const base = {
    fuente: "blackoutmap", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
    latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
    cantidad_reportes: d.reportes, gravedad: gravedadBM(d.arriba, d.total, d.reportes),
    gravedad_texto: `${d.arriba} de ${d.total} puntos de prueba en la red responden` +
      (d.reportes != null ? ` · ${d.reportes} reporte(s) en la última hora` : ""),
    url_fuente: `${BLACKOUT_URL}/providers/${slug}`, ventana, raw: { slug, ...d },
  };
  return { ...base, hash_dedup: await hash(["blackoutmap", slug, ventana]) };
}

const NIVEL_BM: Record<string, string> = { blackout: "falla_masiva", partial: "falla_masiva", degraded: "posibles_problemas" };

export async function filasRegionesBM(status: { regions?: { cc: string; region: string; s: string; up: number; n: number; since?: string }[] }, ahora = new Date()) {
  const ventana = ventana15(ahora);
  const filas: Fila[] = [];
  for (const r of status?.regions ?? []) {
    if (r.cc !== "CL" || !NIVEL_BM[r.s]) continue;
    const reg = regionDe(r.region);
    if (!reg) continue;
    const base = {
      fuente: "blackoutmap", pais: "CL", empresa: "Red completa", servicio: "internet", comuna: null, region: reg[0],
      latitud: reg[1], longitud: reg[2], precision_geo: "region", cantidad_reportes: null, gravedad: NIVEL_BM[r.s],
      gravedad_texto: `Blackout Map: ${r.up} de ${r.n} sondas responden (${r.s})` + (r.since ? ` desde ${r.since.slice(11, 16)} UTC` : ""),
      url_fuente: `${BLACKOUT_URL}/country/chile`, ventana, raw: r,
    };
    filas.push({ ...base, hash_dedup: await hash(["blackoutmap", "region", r.region, ventana]) });
  }
  return filas;
}

// ── RIPE Atlas (RIPE NCC): sondas físicas instaladas en casas y oficinas de Chile ──
// Datos públicos y gratuitos. Una sonda que pasó a "Disconnected" hace poco es una señal
// de corte en esa red; una sola puede ser alguien que la desenchufó, por eso se exigen varias.
type SondaAtlas = { id: number; asn_v4: number | null; status?: { name?: string }; status_since?: number; geometry?: { coordinates?: [number, number] } };

function regionMasCercana(lat: number, lon: number): [string, number, number] | null {
  let mejor: [string, number, number] | null = null, d0 = Infinity;
  for (const r of new Set(Object.values(REGIONES))) {
    const d = (r[1] - lat) ** 2 + ((r[2] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < d0) { d0 = d; mejor = r; }
  }
  return mejor;
}

export async function parsearAtlas(sondas: SondaAtlas[], ahora = new Date()): Promise<Fila[]> {
  const t = ahora.getTime() / 1000;
  const ventana = ventana15(ahora);
  const porEmpresa = new Map<string, { conectadas: number; caidas: SondaAtlas[] }>();
  for (const s of sondas) {
    const empresa = s.asn_v4 != null ? ASN_EMPRESA[String(s.asn_v4)] : undefined;
    if (!empresa) continue;
    const estado = s.status?.name;
    const reciente = s.status_since != null && t - s.status_since < ATLAS_CAIDA_H * 3600;
    if (estado !== "Connected" && !(estado === "Disconnected" && reciente)) continue; // abandonadas o caídas antiguas no cuentan
    const e = porEmpresa.get(empresa) ?? { conectadas: 0, caidas: [] };
    if (estado === "Connected") e.conectadas++; else e.caidas.push(s);
    porEmpresa.set(empresa, e);
  }
  const filas: Fila[] = [];
  for (const [empresa, e] of porEmpresa) {
    const total = e.conectadas + e.caidas.length;
    const n = e.caidas.length;
    const gravedad = n >= 3 && n / total >= 0.25 ? "falla_masiva" : n >= 2 ? "posibles_problemas" : "normal";
    const regiones = new Map<string, { reg: [string, number, number]; n: number }>();
    for (const s of e.caidas) {
      const c = s.geometry?.coordinates;
      const reg = c ? regionMasCercana(c[1], c[0]) : null;
      if (reg) regiones.set(reg[0], { reg, n: (regiones.get(reg[0])?.n ?? 0) + 1 });
    }
    const dondeTxt = regiones.size ? ` (${[...regiones.values()].map((r) => `${r.reg[0]} ${r.n}`).join(", ")})` : "";
    const base = {
      fuente: "atlas", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais", cantidad_reportes: null, gravedad,
      gravedad_texto: `${n} de ${total} sondas RIPE Atlas en la red de ${empresa} se desconectaron en las últimas ${ATLAS_CAIDA_H} h${dondeTxt}`,
      url_fuente: "https://atlas.ripe.net/probes/?country_code=CL", ventana, raw: { conectadas: e.conectadas, caidas: n, total, ids: e.caidas.map((s) => s.id) },
    };
    filas.push({ ...base, hash_dedup: await hash(["atlas", empresa, ventana]) });
    // Por región, solo si en esa región cayeron 2 o más sondas de la misma empresa.
    for (const { reg, n: nr } of regiones.values()) {
      if (nr < 2) continue;
      const fr = {
        ...base, region: reg[0], latitud: reg[1], longitud: reg[2], precision_geo: "region",
        gravedad: gravedad === "normal" ? "posibles_problemas" : gravedad,
        gravedad_texto: `${nr} sondas RIPE Atlas de ${empresa} se desconectaron en ${reg[0]} en las últimas ${ATLAS_CAIDA_H} h`,
      };
      filas.push({ ...fr, hash_dedup: await hash(["atlas", empresa, reg[0], ventana]) });
    }
  }
  return filas;
}

async function filasAtlas(): Promise<Fila[]> {
  const r = await fetch(`${ATLAS_API}/probes/?country_code=CL&page_size=500&fields=id,asn_v4,status,status_since,geometry`, { headers: cabeceras("application/json") });
  if (!r.ok) throw new Error(`RIPE Atlas HTTP ${r.status}`);
  return parsearAtlas((await r.json()).results ?? []);
}

async function rest(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 ? [] : r.json();
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cabeceras(accept: string) {
  return {
    "User-Agent": `${USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]} ${CONTACTO}`,
    "Accept-Language": "es-CL,es;q=0.9",
    Accept: accept,
  };
}

async function filasGeoblackout(): Promise<Fila[]> {
  const r = await fetch(FUENTE_URL, { headers: cabeceras("text/html") });
  const html = await r.text();
  if (!r.ok || /cf-chl|challenge-platform/i.test(html.slice(0, 20000))) {
    throw new Error(`Geoblackout respondió ${r.status} o con desafío anti-bot; se omite`);
  }
  return parsear(html);
}

async function filasFallacl(): Promise<Fila[]> {
  const r = await fetch(`${FALLACL_URL}/api/reports/live`, { headers: cabeceras("application/json") });
  if (!r.ok) throw new Error(`FallaCL respondió ${r.status}`);
  const live = await r.json();
  let catalogo = new Map<string, { nombre: string; cat: string }>();
  try {
    const h = await fetch(FALLACL_URL, { headers: cabeceras("text/html") });
    if (h.ok) catalogo = catalogoFallacl(await h.text());
  } catch { /* sin nombres bonitos: se usa el id */ }
  const regiones: RegionesFallacl = {};
  for (const id of Object.keys(live?.data ?? {})) {
    try {
      const rr = await fetch(`${FALLACL_URL}/api/reports/regions?service_id=${encodeURIComponent(id)}`, { headers: cabeceras("application/json") });
      if (rr.ok) regiones[id] = (await rr.json()).regions ?? [];
    } catch { /* esa región queda sin desglose */ }
    await pausa(300);
  }
  return parsearFallacl(live, catalogo, regiones);
}

async function filasIoda(): Promise<Fila[]> {
  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - IODA_VENTANA_H * 3600;
  const q = (extra: string) => `${IODA_API}/outages/alerts?from=${desde}&until=${hasta}&limit=2000&${extra}`;
  const consultas = ["entityType=asn&relatedTo=country/CL", "entityType=region&relatedTo=country/CL", "entityType=country&entityCode=CL"];
  const alertas: AlertaIoda[] = [];
  for (const c of consultas) {
    const r = await fetch(q(c), { headers: cabeceras("application/json") });
    if (!r.ok) throw new Error(`IODA respondió ${r.status}`);
    const j = await r.json();
    alertas.push(...(j.data ?? []));
  }
  return parsearIoda(alertas);
}

async function filasBlackoutMap(): Promise<Fila[]> {
  const filas: Fila[] = [];
  for (const slug of Object.keys(PROVEEDORES_BM)) {
    const r = await fetch(`${BLACKOUT_URL}/providers/${slug}`, { headers: cabeceras("text/html") });
    if (r.ok) { const f = await filaProveedorBM(slug, await r.text()); if (f) filas.push(f); }
    await pausa(1100); // Crawl-delay: 1
  }
  const st = await fetch(`${BLACKOUT_URL}/data/status.json`, { headers: cabeceras("application/json") });
  if (st.ok) filas.push(...await filasRegionesBM(await st.json()));
  if (!filas.length) throw new Error("Blackout Map sin datos; ¿cambió la página?");
  return filas;
}

async function corrida(): Promise<Record<string, unknown>> {
  // Freno: si hubo una captura hace menos de 10 min, no volvemos a pedir las páginas.
  const ult = await rest("reportes_caidas?select=capturado_en&order=capturado_en.desc&limit=1");
  if (ult[0] && Date.now() - Date.parse(ult[0].capturado_en) < MIN_ENTRE_CORRIDAS_MIN * 60_000) {
    return { omitido: "corrida reciente", ultima: ult[0].capturado_en };
  }
  const res: Record<string, unknown> = {};
  const filas: Fila[] = [];
  // Cada fuente va por separado: si una falla, la otra igual se guarda.
  for (const [nombre, fn] of [["geoblackout", filasGeoblackout], ["fallacl", filasFallacl], ["ioda", filasIoda], ["blackoutmap", filasBlackoutMap], ["atlas", filasAtlas]] as const) {
    try {
      const f = await fn();
      filas.push(...f);
      res[nombre] = f.length;
    } catch (e) {
      res[nombre] = `error: ${e instanceof Error ? e.message : e}`;
    }
  }
  if (!filas.length) return { ...res, insertadas: 0, nota: "sin datos nuevos" };
  const nuevas = await rest("reportes_caidas?on_conflict=hash_dedup", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(filas),
  });
  return {
    ...res,
    enviadas: filas.length,
    insertadas: nuevas.length,
    con_ubicacion: filas.filter((f) => f.precision_geo === "comuna" || f.precision_geo === "region").length,
  };
}

if (Deno.env.get("SUPABASE_URL")) {
  Deno.serve(async (req) => {
    // Solo pg_cron conoce este token (ver sql/003_cron_scraper.sql).
    const token = Deno.env.get("OCN_CRON_TOKEN") ?? TOKEN_POR_DEFECTO;
    if (req.headers.get("x-ocn-token") !== token) return new Response("no autorizado", { status: 401 });
    try {
      const res = await corrida();
      console.log(JSON.stringify(res));
      return Response.json(res);
    } catch (e) {
      console.error(e);
      return Response.json({ error: String(e) }, { status: 500 });
    }
  });
}
