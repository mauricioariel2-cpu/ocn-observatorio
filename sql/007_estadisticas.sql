-- OCN · Estadísticas: vistas de solo lectura sobre el historial que ya guarda el bot.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.
-- security_invoker: las vistas respetan la RLS de reportes_caidas (lectura pública).

-- Reportes ciudadanos por hora y empresa (totales nacionales de Geoblackout y FallaCL).
-- Dentro de cada hora se toma el valor más alto que informó cada fuente (no se suman capturas repetidas).
create or replace view public.ocn_serie_reportes with (security_invoker = on) as
with por_fuente as (
  select date_trunc('hour', capturado_en) as hora, fuente, empresa, max(cantidad_reportes) as n
  from public.reportes_caidas
  where pais = 'CL' and precision_geo = 'pais' and fuente in ('geoblackout', 'fallacl')
    and capturado_en > now() - interval '30 days' and cantidad_reportes is not null
  group by 1, 2, 3
)
select hora, empresa, sum(n)::int as reportes, array_agg(distinct fuente) as fuentes
from por_fuente group by 1, 2;

-- Disponibilidad medida por las sondas de Blackout Map dentro de cada red (% de puntos que responden).
create or replace view public.ocn_disponibilidad with (security_invoker = on) as
select date_trunc('hour', capturado_en) as hora, empresa,
       round(100.0 * avg((raw->>'arriba')::numeric / nullif((raw->>'total')::numeric, 0)), 1) as pct,
       max((raw->>'total')::int) as sondas
from public.reportes_caidas
where fuente = 'blackoutmap' and raw ? 'arriba' and capturado_en > now() - interval '30 days'
group by 1, 2;

-- Reportes de HOY (hora de Chile) por región, según FallaCL.
create or replace view public.ocn_regiones_hoy with (security_invoker = on) as
with x as (
  select region, empresa, servicio, max(cantidad_reportes) as n
  from public.reportes_caidas
  where fuente = 'fallacl' and precision_geo = 'region' and region is not null
    and capturado_en >= (date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago')
  group by 1, 2, 3
)
select region, sum(n)::int as reportes,
       (array_agg(empresa order by n desc))[1] as principal
from x group by 1;

grant select on public.ocn_serie_reportes, public.ocn_disponibilidad, public.ocn_regiones_hoy to anon, authenticated;
