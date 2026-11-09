-- OCN · Semáforo mundial: estado de internet de cada país, actualizado cada 15 minutos por ocn-scraper.
-- Fuente: Blackout Map (/data/status.json, "countries"), que combina sus sondas con IODA (Georgia Tech).
-- Licencia CC BY-NC 4.0: se cita con enlace y no se usa con fines comerciales.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.

create table if not exists public.estado_paises (
  cc           text primary key check (cc ~ '^[A-Z]{2}$'),
  iso_num      smallint,
  nombre       text not null,
  estado       text not null check (estado in ('normal','posibles_problemas','falla_masiva','sin_datos')),
  detalle      text,
  desde        timestamptz,
  url_fuente   text,
  actualizado  timestamptz not null default now()
);
alter table public.estado_paises enable row level security;
revoke all on public.estado_paises from anon, authenticated;
grant select on public.estado_paises to anon, authenticated;
drop policy if exists "lectura publica" on public.estado_paises;
create policy "lectura publica" on public.estado_paises for select to anon, authenticated using (true);

select count(*) filas, has_table_privilege('anon','public.estado_paises','select') anon_lee,
       has_table_privilege('anon','public.estado_paises','insert') anon_escribe from public.estado_paises;
