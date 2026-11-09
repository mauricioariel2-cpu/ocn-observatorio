-- Fase mapa en vivo: país de cada reporte + Supabase Realtime.
-- Se puede ejecutar más de una vez sin romper nada.

-- 1) País (código ISO de 2 letras). Lo existente queda como Chile.
alter table public.reportes_caidas add column if not exists pais text not null default 'CL';
create index if not exists reportes_caidas_pais_idx on public.reportes_caidas (pais, ventana desc);

-- 2) Tiempo real: el mapa recibe cada fila nueva apenas el bot la inserta.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reportes_caidas'
  ) then
    alter publication supabase_realtime add table public.reportes_caidas;
  end if;
end $$;
