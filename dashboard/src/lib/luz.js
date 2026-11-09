import { supabase } from './supabase'

// Cortes de luz por comuna según la SEC (tabla cortes_luz, sql/009).
// Devuelve la última hora publicada y las comunas afectadas en esa hora, de mayor a menor.
export async function cargarCortesLuz() {
  const { data: ult, error: e1 } = await supabase.from('cortes_luz').select('hora_sec').order('hora_sec', { ascending: false }).limit(1)
  if (e1) throw e1
  if (!ult?.length) return { hora: null, comunas: [], total: 0 }
  const hora = ult[0].hora_sec
  const { data, error } = await supabase
    .from('cortes_luz')
    .select('comuna, region, latitud, longitud, clientes')
    .eq('hora_sec', hora)
    .order('clientes', { ascending: false })
  if (error) throw error
  const comunas = data ?? []
  return { hora, comunas, total: comunas.reduce((s, c) => s + c.clientes, 0) }
}

// Total nacional por hora, últimos 30 días (vista ocn_cortes_luz_hora).
export async function cargarSerieLuz() {
  const { data, error } = await supabase.from('ocn_cortes_luz_hora').select('hora, clientes, comunas').order('hora')
  if (error) throw error
  return data ?? []
}

export const FUENTE_SEC = 'https://www.sec.cl/interrupciones-en-linea/'
