// Relevo SEC: la API de la SEC solo responde a conexiones desde Chile, así que esta
// función corre en Google Cloud Santiago (southamerica-west1) y le pasa los datos
// al recolector de Supabase. Solo consulta los dos endpoints fijos de la SEC; no es un proxy abierto.
const SEC = 'https://apps.sec.cl/INTONLINEv1/ClientesAfectados';

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

exports.sec = async (req, res) => {
  try {
    const serie = await post('Get', {});
    const ultima = serie.at(-1);
    if (!ultima) return res.status(502).json({ error: 'SEC sin datos' });
    const comunas = await post('GetPorFecha', { anho: ultima.anho, mes: ultima.mes, dia: ultima.dia, hora: ultima.hora });
    res.set('Cache-Control', 'no-store').json({ ultima, comunas });
  } catch (e) {
    res.status(502).json({ error: String(e?.message ?? e) });
  }
};
