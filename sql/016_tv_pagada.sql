-- OCN · Reportes de TV pagada (satelital, cable, fibra y apps), ordenados para poder filtrarlos.
-- Ejecutar una vez en Supabase → SQL Editor, DESPUÉS de 004, 005, 006, 014 y 015. Es idempotente.
--
-- Compañías: las de SUBTEL "Servicios limitados de TV" (jun-2026): VTR, Movistar, Mundo, DIRECTV, Claro, Entel,
-- Telsur, TuVes y GTD; más Zapping (TV por internet, no aparece en SUBTEL). Las cableras pequeñas van como "Otro".
-- Cada reporte de TV lleva campos cerrados (nada de texto libre salvo el código de error y el canal, con
-- caracteres limitados), para que se puedan filtrar y contar sin ambigüedad.

do $$ begin
  alter table public.reportes_usuarios drop constraint if exists reportes_usuarios_empresa_check;
  alter table public.reportes_usuarios add constraint reportes_usuarios_empresa_check check (empresa in
    ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','TuVes','Zapping','Otro'));
  alter table public.senales_ok drop constraint if exists senales_ok_empresa_check;
  alter table public.senales_ok add constraint senales_ok_empresa_check check (empresa in
    ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','TuVes','Zapping','Otro'));
  alter table ocn_privado.suscripciones drop constraint if exists suscripciones_empresa_check;
  alter table ocn_privado.suscripciones add constraint suscripciones_empresa_check check (empresa in
    ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','TuVes','Zapping'));
end $$;

alter table public.reportes_usuarios
  add column if not exists tv_tecnologia text check (tv_tecnologia in ('satelital','cable_fibra','app')),
  add column if not exists tv_alcance    text check (tv_alcance in ('todos','hd','algunos','uno')),
  add column if not exists tv_sintoma    text check (tv_sintoma in ('sin_senal','pixelado','sin_audio','mensaje')),
  add column if not exists tv_codigo     text check (tv_codigo ~ '^[A-Za-z0-9 -]{1,20}$'),
  add column if not exists tv_canal      text check (tv_canal ~ '^[[:alnum:] .+ÁÉÍÓÚÑáéíóúñ-]{1,40}$');

-- Los campos de TV solo existen en reportes de TV.
alter table public.reportes_usuarios drop constraint if exists reportes_usuarios_tv_solo_tv;
alter table public.reportes_usuarios add constraint reportes_usuarios_tv_solo_tv check (
  servicio = 'tv' or (tv_tecnologia is null and tv_alcance is null and tv_sintoma is null and tv_codigo is null and tv_canal is null));

grant insert (tv_tecnologia, tv_alcance, tv_sintoma, tv_codigo, tv_canal) on public.reportes_usuarios to anon, authenticated;
grant select (tv_tecnologia, tv_alcance, tv_sintoma, tv_codigo, tv_canal) on public.reportes_usuarios to anon, authenticated;

-- Derecho de acceso: la descarga de "mis datos" incluye los campos de TV.
create or replace function public.ocn_mis_datos(p_dispositivo uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generado_en', now(),
    'dispositivo', p_dispositivo,
    'reportes', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', creado_en, 'empresa', empresa, 'servicio', servicio, 'tipo', tipo, 'desde', desde,
        'region', region, 'comuna', comuna, 'latitud', latitud, 'longitud', longitud,
        'empresa_detectada', empresa_detectada, 'tv_tecnologia', tv_tecnologia, 'tv_alcance', tv_alcance,
        'tv_sintoma', tv_sintoma, 'tv_codigo', tv_codigo, 'tv_canal', tv_canal) order by creado_en)
      from public.reportes_usuarios where dispositivo = p_dispositivo), '[]'::jsonb),
    'me_funciona', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', creado_en, 'empresa', empresa, 'servicio', servicio, 'region', region, 'comuna', comuna,
        'empresa_detectada', empresa_detectada) order by creado_en)
      from public.senales_ok where dispositivo = p_dispositivo), '[]'::jsonb),
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
revoke all on function public.ocn_mis_datos(uuid) from public;
grant execute on function public.ocn_mis_datos(uuid) to anon, authenticated;
