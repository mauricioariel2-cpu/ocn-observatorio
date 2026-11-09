import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local')
}

// Solo la anon key: RLS deja a la web leer reportes_caidas e insertar/leer reportes_usuarios
// (botón "Me afecta", con límite anti-spam en la base de datos). Nunca la service_role.
export const supabase = createClient(url, anonKey)
