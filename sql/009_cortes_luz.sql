-- OCN · Cortes de luz por comuna, según la SEC (apps.sec.cl/INTONLINEv1, datos que cargan las distribuidoras).
-- Tabla aparte de reportes_caidas: un corte de luz no es una falla de la empresa de internet,
-- pero explica muchas caídas y sirve para advertir y, con historial, para predecir.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.

create table if not exists public.cortes_luz (
  id           bigint generated always as identity primary key,
  capturado_en timestamptz not null default now(),
  hora_sec     timestamptz not null,           -- hora del corte informada por la SEC (hora de Chile, guardada en UTC)
  comuna       text not null,
  region       text,
  latitud      double precision,
  longitud     double precision,
  clientes     integer not null check (clientes >= 0),
  unique (hora_sec, comuna)
);
create index if not exists cortes_luz_hora_idx on public.cortes_luz (hora_sec desc);
alter table public.cortes_luz enable row level security;

revoke all on public.cortes_luz from anon, authenticated;
grant select on public.cortes_luz to anon, authenticated;
drop policy if exists "lectura publica" on public.cortes_luz;
create policy "lectura publica" on public.cortes_luz for select to anon, authenticated using (true);

-- Total nacional por hora (para gráficos y para cruzar con caídas de internet).
create or replace view public.ocn_cortes_luz_hora with (security_invoker = on) as
select hora_sec as hora, sum(clientes)::int as clientes, count(*)::int as comunas
from public.cortes_luz where hora_sec > now() - interval '30 days'
group by 1;
grant select on public.ocn_cortes_luz_hora to anon, authenticated;
