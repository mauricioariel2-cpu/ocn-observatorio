// Relevo SEC: la API de la SEC solo responde a conexiones desde Chile, así que esta
// función corre en Google Cloud Santiago (southamerica-west1). Cloud Scheduler la llama
// cada 15 minutos con autenticación de Google (el servicio no acepta llamadas públicas);
// consulta los dos endpoints fijos de la SEC y entrega los datos crudos a Supabase
// (función ocn_recibir_sec, protegida con clave). El recolector los procesa después.
import * as ff from '@google-cloud/functions-framework';

const SEC = 'https://apps.sec.cl/INTONLINEv1/ClientesAfectados';
const SUPABASE_URL = 'https://xomhtisorvfcrkpbvzpb.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '__ANON_KEY__'; // clave pública (la misma de la web)
const CLAVE = process.env.SEC_CLAVE || '__SEC_CLAVE__';

const post = async (ruta, cuerpo) => {
  const r = await fetch(`${SEC}/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'OCN-Observatorio/1.0' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
  return r.json();
};

ff.http('sec', async (req, res) => {
  try {
    const t0 = Date.now();
    const serie = await post('Get', {});
    const ultima = serie.at(-1);
    if (!ultima) return res.status(502).json({ error: 'SEC sin datos' });
    const comunas = await post('GetPorFecha', { anho: ultima.anho, mes: ultima.mes, dia: ultima.dia, hora: ultima.hora });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ocn_recibir_sec`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: CLAVE, ultima, comunas }),
      signal: AbortSignal.timeout(20000),
    });
    const txt = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Supabase HTTP ${r.status}`, detalle: txt.slice(0, 200) });
    res.json({ ok: true, hora: ultima, comunas: comunas.length, guardadas: Number(txt), ms: Date.now() - t0 });
  } catch (e) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
});
