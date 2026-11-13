-- OCN · Botón "Me funciona bien": línea base propia (cuánta gente está conectada sin problemas).
-- Ejecutar una vez en Supabase → SQL Editor, DESPUÉS de 004 y 013. Es idempotente.
--
-- Por qué una tabla aparte: los reportes de falla (reportes_usuarios) pintan el mapa y las estadísticas;
-- las señales "funciona" no deben sumarse como fallas. Sirven para comparar: si en una región
-- 40 vecinos dicen que Movistar funciona y de pronto 15 dicen que no, la caída es clara.
-- Sin nombre, sin RUT, sin ubicación exacta (solo región y comuna opcional).

create table if not exists public.senales_ok (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  empresa     text not null check (empresa in ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','Otro')),
  servicio    text not null check (servicio in ('internet_fijo','internet_movil','tv','telefonia')),
  region      text not null check (region in ('Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso',
                'Metropolitana','O''Higgins','Maule','Ñuble','Biobío','Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes')),
  comuna      text check (char_length(comuna) between 2 and 60),
  empresa_detectada boolean not null default false,
  dispositivo uuid
);
create index if not exists senales_ok_creado_idx on public.senales_ok (creado_en desc);

alter table public.senales_ok enable row level security;
revoke all on public.senales_ok from anon, authenticated;
grant insert (empresa, servicio, region, comuna, empresa_detectada, dispositivo) on public.senales_ok to anon, authenticated;
grant select (id, creado_en, empresa, servicio, region, comuna) on public.senales_ok to anon, authenticated;
drop policy if exists "insertar senal" on public.senales_ok;
create policy "insertar senal" on public.senales_ok for insert to anon, authenticated with check (true);
drop policy if exists "leer ultimas 24h" on public.senales_ok;
create policy "leer ultimas 24h" on public.senales_ok for select to anon, authenticated
  using (creado_en > now() - interval '24 hours');

-- Anti-spam: 1 señal por hora por dispositivo y por huella de IP (con sal). No bloquea "Me afecta".
create or replace function public.limitar_senal_ok() returns trigger
language plpgsql security definer set search_path = public, ocn_privado, extensions as $$
declare ip text; sal text; claves text[]; k text;
begin
  new.creado_en := now();
  new.comuna := nullif(trim(new.comuna), '');
  if (select count(*) from public.senales_ok where creado_en > now() - interval '1 minute') > 300 then
    raise exception 'Demasiadas señales en este momento. Intenta en un minuto.' using errcode = 'P0001';
  end if;
  select valor into sal from ocn_privado.config where clave = 'sal';
  ip := trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  claves := array['ok:' || coalesce(new.dispositivo::text, 'sin')];
  if ip <> '' then claves := claves || ('oki:' || encode(digest(ip || sal, 'sha256'), 'hex')); end if;
  foreach k in array claves loop
    if exists (select 1 from ocn_privado.limites where clave = k and ultimo > now() - interval '60 minutes') then
      raise exception 'Ya nos contaste que te funciona hace poco. ¡Gracias! Puedes volver a contarnos en una hora.' using errcode = 'P0001';
    end if;
  end loop;
  foreach k in array claves loop
    insert into ocn_privado.limites (clave, ultimo) values (k, now()) on conflict (clave) do update set ultimo = excluded.ultimo;
  end loop;
  return new;
end $$;
revoke all on function public.limitar_senal_ok() from public, anon, authenticated;
drop trigger if exists limitar_senal_ok on public.senales_ok;
create trigger limitar_senal_ok before insert on public.senales_ok for each row execute function public.limitar_senal_ok();

-- Retención (Ley 21.719): a los 30 días se borra el código del dispositivo.
select cron.unschedule('ocn-retencion-ok') where exists (select 1 from cron.job where jobname = 'ocn-retencion-ok');
select cron.schedule('ocn-retencion-ok', '35 4 * * *',
  $$ update public.senales_ok set dispositivo = null where creado_en < now() - interval '30 days' and dispositivo is not null; $$);

-- Derechos de acceso y supresión: se agregan las señales a las funciones de 013.
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

create or replace function public.ocn_borrar_mis_datos(p_dispositivo uuid) returns jsonb
language plpgsql security definer set search_path = public, ocn_privado as $$
declare a int; b int; c int; d int;
begin
  if p_dispositivo is null then raise exception 'Falta el código del dispositivo' using errcode = 'P0001'; end if;
  delete from public.reportes_usuarios   where dispositivo = p_dispositivo; get diagnostics a = row_count;
  delete from public.reclamos_ciudadanos where dispositivo = p_dispositivo; get diagnostics b = row_count;
  delete from public.reclamos_resultados where dispositivo = p_dispositivo; get diagnostics c = row_count;
  delete from public.senales_ok          where dispositivo = p_dispositivo; get diagnostics d = row_count;
  delete from ocn_privado.limites where clave like 'd:'  || p_dispositivo::text
                                     or clave like 'ok:' || p_dispositivo::text
                                     or clave like 'r:'  || p_dispositivo::text || ':%'
                                     or clave like 'rr:' || p_dispositivo::text || ':%';
  return jsonb_build_object('reportes', a, 'reclamos', b, 'resultados', c, 'me_funciona', d);
end $$;

revoke all on function public.ocn_mis_datos(uuid), public.ocn_borrar_mis_datos(uuid) from public;
grant execute on function public.ocn_mis_datos(uuid), public.ocn_borrar_mis_datos(uuid) to anon, authenticated;
