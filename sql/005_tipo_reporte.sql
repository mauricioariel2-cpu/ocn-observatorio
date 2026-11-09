-- OCN · Asistente: tipo de problema y compañía detectada por la conexión.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.
alter table public.reportes_usuarios
  add column if not exists tipo text not null default 'caido' check (tipo in ('caido', 'lento')),
  add column if not exists empresa_detectada boolean not null default false;

grant insert (tipo, empresa_detectada) on public.reportes_usuarios to anon, authenticated;
grant select (tipo, empresa_detectada) on public.reportes_usuarios to anon, authenticated;
