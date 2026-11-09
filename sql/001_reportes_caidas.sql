-- Esquema que espera el recolector. Si tu tabla ya existe, compara columnas
-- y ejecuta solo los ALTER que falten (al final hay ejemplos).

create table if not exists public.reportes_caidas (
  id                bigint generated always as identity primary key,
  fuente            text        not null,               -- 'downdetector' | 'geoblackout'
  empresa           text        not null,               -- 'DIRECTV', 'Movistar', ...
  pais              text        not null default 'CL',  -- ISO 3166-1 alfa-2
  servicio          text,                               -- 'internet_fijo' | 'internet_movil' | 'tv' | ...
  region            text,
  comuna            text,
  cantidad_reportes integer,
  gravedad          text check (gravedad in ('normal','posibles_problemas','falla_masiva')),
  gravedad_texto    text,                               -- texto original de la fuente
  latitud           double precision,
  longitud          double precision,
  precision_geo     text,                               -- 'comuna' | 'pais' | 'sin_geo'
  url_fuente        text,
  ventana           timestamptz not null,               -- tramo de 15 min de la captura
  capturado_en      timestamptz not null default now(),
  hash_dedup        text        not null unique,        -- evita duplicados si el bot corre 2 veces
  raw               jsonb       not null default '{}'::jsonb  -- evidencia cruda para reclamos
);

create index if not exists reportes_caidas_ventana_idx on public.reportes_caidas (ventana desc);
create index if not exists reportes_caidas_empresa_idx on public.reportes_caidas (empresa, ventana desc);

-- Seguridad: el bot escribe con la service_role key (salta RLS).
-- El dashboard (anon key) solo puede LEER.
alter table public.reportes_caidas enable row level security;
drop policy if exists "lectura publica" on public.reportes_caidas;
create policy "lectura publica" on public.reportes_caidas for select to anon using (true);

-- Si tu tabla ya existía con otras columnas, agrega las que falten, p. ej.:
-- alter table public.reportes_caidas add column if not exists precision_geo text;
-- alter table public.reportes_caidas add column if not exists hash_dedup text unique;
-- alter table public.reportes_caidas add column if not exists raw jsonb not null default '{}'::jsonb;
