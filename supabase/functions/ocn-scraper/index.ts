// OCN · Recolector como Supabase Edge Function (reemplaza a GitHub Actions).
//
// Lo llama pg_cron cada 15 minutos (ver sql/003_cron_scraper.sql).
// Lee Geoblackout Chile (robots.txt: Allow /, Crawl-delay 1): UNA petición por corrida.
// Downdetector no se incluye: su robots.txt prohíbe la página de DIRECTV.
//
// Variables que Supabase ya pone solas en toda función: SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY. OCN_CRON_TOKEN es opcional: si la defines en
// Edge Functions → Secrets, reemplaza al token por defecto de abajo.

const FUENTE_URL = "https://geoblackout.com/cl/report/internet";
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

async function corrida(): Promise<Record<string, unknown>> {
  // Freno: si hubo una captura hace menos de 10 min, no volvemos a pedir la página.
  const ult = await rest("reportes_caidas?select=capturado_en&order=capturado_en.desc&limit=1");
  if (ult[0] && Date.now() - Date.parse(ult[0].capturado_en) < MIN_ENTRE_CORRIDAS_MIN * 60_000) {
    return { omitido: "corrida reciente", ultima: ult[0].capturado_en };
  }
  const r = await fetch(FUENTE_URL, {
    headers: {
      "User-Agent": `${USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]} ${CONTACTO}`,
      "Accept-Language": "es-CL,es;q=0.9",
      Accept: "text/html",
    },
  });
  const html = await r.text();
  if (!r.ok || /cf-chl|challenge-platform/i.test(html.slice(0, 20000))) {
    return { error: `Geoblackout respondió ${r.status} o con desafío anti-bot; se omite` };
  }
  const filas = await parsear(html);
  if (!filas.length) return { insertadas: 0, nota: "sin datos; ¿cambió el HTML?" };
  const nuevas = await rest("reportes_caidas?on_conflict=hash_dedup", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(filas),
  });
  return {
    enviadas: filas.length,
    insertadas: nuevas.length,
    con_comuna: filas.filter((f) => f.precision_geo === "comuna").length,
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
