-- OCN · Ley 21.719 (protección de datos personales): retención, derechos y solicitudes.
-- Ejecutar una vez en Supabase → SQL Editor, DESPUÉS de 004, 008 y 011. Es idempotente.
--
-- Qué hace:
-- 1. Retención: a los 30 días se borra el código del dispositivo y la ubicación aproximada
--    de cada reporte/reclamo. La fila queda solo como estadística anónima (empresa, región, hora).
-- 2. Derechos de acceso, portabilidad y supresión "en un toque": la web consulta o borra
--    todo lo asociado al código aleatorio de ese celular (solo quien tiene el código puede hacerlo).
-- 3. Solicitudes de privacidad (rectificación, oposición, bloqueo, consultas): formulario
--    que guarda en un esquema privado; la web puede escribir pero no leer.

-- ── 1. Retención ─────────────────────────────────────────────────────────────
alter table public.reportes_usuarios   alter column dispositivo drop not null;
alter table public.reclamos_ciudadanos alter column dispositivo drop not null;
alter table public.reclamos_resultados alter column dispositivo drop not null;

create or replace function ocn_privado.aplicar_retencion() returns jsonb
language plpgsql security definer set search_path = public, ocn_privado as $$
declare a int; b int; c int; d int;
begin
  update public.reportes_usuarios set dispositivo = null, latitud = null, longitud = null
   where creado_en < now() - interval '30 days' and (dispositivo is not null or latitud is not null);
  get diagnostics a = row_count;
  update public.reclamos_ciudadanos set dispositivo = null
   where creado_en < now() - interval '30 days' and dispositivo is not null;
  get diagnostics b = row_count;
  update public.reclamos_resultados set dispositivo = null
   where creado_en < now() - interval '30 days' and dispositivo is not null;
  get diagnostics c = row_count;
  -- Límites anti-spam (huella de IP con sal y código de dispositivo): máximo 3 días.
  delete from ocn_privado.limites where ultimo < now() - interval '3 days';
  -- Solicitudes ya cerradas: se guardan 2 años como respaldo de que se respondió.
  delete from ocn_privado.solicitudes where cerrada_en < now() - interval '2 years';
  get diagnostics d = row_count;
  return jsonb_build_object('reportes', a, 'reclamos', b, 'resultados', c, 'solicitudes', d);
end $$;
revoke all on function ocn_privado.aplicar_retencion() from public, anon, authenticated;

-- ── 2. Acceso, portabilidad y supresión por código de dispositivo ───────────
create or replace function public.ocn_mis_datos(p_dispositivo uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generado_en', now(),
    'dispositivo', p_dispositivo,
    'reportes', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', creado_en, 'empresa', empresa, 'servicio', servicio, 'tipo', tipo, 'desde', desde,
        'region', region, 'comuna', comuna, 'latitud', latitud, 'longitud', longitud,
        'empresa_detectada', empresa_detectada) order by creado_en)
      from public.reportes_usuarios where dispositivo = p_dispositivo), '[]'::jsonb),
    'reclamos', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', creado_en, 'empresa', empresa, 'servicio', servicio, 'region', region, 'tipo', tipo, 'desde', desde)
        order by creado_en)
      from public.reclamos_ciudadanos where dispositivo = p_dispositivo), '[]'::jsonb),
    'resultados_reclamos', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', creado_en, 'empresa', empresa, 'resultado', resultado, 'dias_habiles', dias_habiles)
        order by creado_en)
      from public.reclamos_resultados where dispositivo = p_dispositivo), '[]'::jsonb)
  )
$$;

create or replace function public.ocn_borrar_mis_datos(p_dispositivo uuid) returns jsonb
language plpgsql security definer set search_path = public, ocn_privado as $$
declare a int; b int; c int;
begin
  if p_dispositivo is null then raise exception 'Falta el código del dispositivo' using errcode = 'P0001'; end if;
  delete from public.reportes_usuarios   where dispositivo = p_dispositivo; get diagnostics a = row_count;
  delete from public.reclamos_ciudadanos where dispositivo = p_dispositivo; get diagnostics b = row_count;
  delete from public.reclamos_resultados where dispositivo = p_dispositivo; get diagnostics c = row_count;
  delete from ocn_privado.limites where clave like 'd:'  || p_dispositivo::text
                                     or clave like 'r:'  || p_dispositivo::text || ':%'
                                     or clave like 'rr:' || p_dispositivo::text || ':%';
  return jsonb_build_object('reportes', a, 'reclamos', b, 'resultados', c);
end $$;

revoke all on function public.ocn_mis_datos(uuid), public.ocn_borrar_mis_datos(uuid) from public;
grant execute on function public.ocn_mis_datos(uuid), public.ocn_borrar_mis_datos(uuid) to anon, authenticated;

-- ── 3. Solicitudes de privacidad (formulario de la web) ─────────────────────
create table if not exists ocn_privado.solicitudes (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  tipo        text not null check (tipo in ('acceso','rectificacion','supresion','oposicion','portabilidad','bloqueo','consentimiento','otra')),
  mensaje     text not null check (char_length(mensaje) between 5 and 2000),
  contacto    text not null check (char_length(contacto) between 5 and 200),
  dispositivo uuid,
  estado      text not null default 'nueva' check (estado in ('nueva','en_curso','respondida','rechazada')),
  respuesta   text,
  cerrada_en  timestamptz
);

-- La web llama a esta función; no puede leer la tabla. Freno: 3 solicitudes por día por dispositivo.
create or replace function public.ocn_solicitud_privacidad(p_tipo text, p_mensaje text, p_contacto text, p_dispositivo uuid)
returns bigint language plpgsql security definer set search_path = public, ocn_privado as $$
declare k text := 's:' || coalesce(p_dispositivo::text, 'sin'); n bigint;
begin
  if (select count(*) from ocn_privado.solicitudes where creado_en > now() - interval '1 day'
       and dispositivo is not distinct from p_dispositivo) >= 3 then
    raise exception 'Ya enviaste varias solicitudes hoy. Las estamos revisando.' using errcode = 'P0001';
  end if;
  insert into ocn_privado.solicitudes (tipo, mensaje, contacto, dispositivo)
  values (p_tipo, trim(p_mensaje), trim(p_contacto), p_dispositivo) returning id into n;
  return n;
end $$;
revoke all on function public.ocn_solicitud_privacidad(text, text, text, uuid) from public;
grant execute on function public.ocn_solicitud_privacidad(text, text, text, uuid) to anon, authenticated;

-- Retención diaria a las 04:30 UTC (requiere pg_cron, ya instalado por 003).
select cron.unschedule('ocn-retencion-diaria')
where exists (select 1 from cron.job where jobname = 'ocn-retencion-diaria');
select cron.schedule('ocn-retencion-diaria', '30 4 * * *', $$ select ocn_privado.aplicar_retencion(); $$);

-- Aplicar ya la primera vez:
select ocn_privado.aplicar_retencion();

-- Para atender solicitudes (plazo legal: 30 días corridos, art. 11):
--   select * from ocn_privado.solicitudes where estado <> 'respondida' order by creado_en;
--   update ocn_privado.solicitudes set estado = 'respondida', respuesta = '...', cerrada_en = now() where id = ...;

-- ── 4. Privacidad por defecto (art. 14 quáter) ──────────────────────────────
-- La web no usa la ubicación aproximada de los reportes ajenos (el mapa agrupa por región),
-- así que deja de ser pública. Se sigue guardando (máx. 30 días) solo para estadísticas internas.
revoke select (latitud, longitud) on public.reportes_usuarios from anon, authenticated;
