-- OCN · Chat del asistente: desde cuándo la persona tiene el problema (sirve para reclamos).
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.
alter table public.reportes_usuarios
  add column if not exists desde text check (desde in ('recien', '1h', '3h', 'ayer'));
grant insert (desde) on public.reportes_usuarios to anon, authenticated;
grant select (desde) on public.reportes_usuarios to anon, authenticated;
