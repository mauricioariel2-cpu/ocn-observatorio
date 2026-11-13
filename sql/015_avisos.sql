-- OCN · Avisos sin cuenta: "avísame si se cae mi compañía en mi región".
-- Ejecutar una vez en Supabase → SQL Editor, DESPUÉS de 004 y 013. Es idempotente.
--
-- Sin correo, sin teléfono, sin cuenta: solo la "dirección de entrega" que el navegador crea para avisos
-- (Web Push) más la compañía y la región elegidas. La web puede suscribirse y anularse, pero NO leer la tabla.
-- Las claves VAPID (para firmar los avisos) las genera el propio robot la primera vez y quedan en el
-- esquema privado: ninguna persona tiene que copiarlas ni pegarlas.

create table if not exists ocn_privado.suscripciones (
  endpoint     text primary key check (endpoint like 'https://%' and char_length(endpoint) < 1000),
  p256dh       text not null check (char_length(p256dh) between 20 and 200),
  auth         text not null check (char_length(auth) between 10 and 100),
  empresa      text not null check (empresa in ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV')),
  region       text not null check (region in ('Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso',
                 'Metropolitana','O''Higgins','Maule','Ñuble','Biobío','Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes')),
  creado_en    timestamptz not null default now(),
  renovado_en  timestamptz not null default now(),
  ultimo_aviso timestamptz
);
create index if not exists suscripciones_empresa_region_idx on ocn_privado.suscripciones (lower(empresa), region);
alter table ocn_privado.suscripciones enable row level security;  -- sin políticas: solo las funciones de abajo la tocan

-- La web: suscribirse (o cambiar compañía/región) y anularse. Freno: 200 altas por minuto en total.
create or replace function public.ocn_suscribir_aviso(p_endpoint text, p_p256dh text, p_auth text, p_empresa text, p_region text)
returns boolean language plpgsql security definer set search_path = public, ocn_privado as $$
begin
  if (select count(*) from ocn_privado.suscripciones where renovado_en > now() - interval '1 minute') > 200 then
    raise exception 'Demasiadas suscripciones en este momento. Intenta en un minuto.' using errcode = 'P0001';
  end if;
  insert into ocn_privado.suscripciones (endpoint, p256dh, auth, empresa, region)
  values (p_endpoint, p_p256dh, p_auth, p_empresa, p_region)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    empresa = excluded.empresa, region = excluded.region, renovado_en = now();
  return true;
end $$;

create or replace function public.ocn_cancelar_aviso(p_endpoint text) returns boolean
language sql security definer set search_path = public, ocn_privado as $$
  with d as (delete from ocn_privado.suscripciones where endpoint = p_endpoint returning 1) select exists (select 1 from d)
$$;

-- Clave pública VAPID (es pública por diseño: el navegador la necesita para suscribirse).
create or replace function public.ocn_vapid_publica() returns text
language sql stable security definer set search_path = public, ocn_privado as $$
  select valor from ocn_privado.config where clave = 'vapid_publica'
$$;

revoke all on function public.ocn_suscribir_aviso(text, text, text, text, text), public.ocn_cancelar_aviso(text), public.ocn_vapid_publica() from public;
grant execute on function public.ocn_suscribir_aviso(text, text, text, text, text), public.ocn_cancelar_aviso(text), public.ocn_vapid_publica() to anon, authenticated;

-- El robot (service_role): leer o guardar las claves VAPID y tomar los avisos que tocan.
create or replace function public.ocn_vapid_claves() returns jsonb
language sql stable security definer set search_path = public, ocn_privado as $$
  select jsonb_build_object(
    'publica', (select valor from ocn_privado.config where clave = 'vapid_publica'),
    'privada', (select valor from ocn_privado.config where clave = 'vapid_privada'))
$$;
create or replace function public.ocn_vapid_guardar(p_publica text, p_privada text) returns boolean
language sql security definer set search_path = public, ocn_privado as $$
  insert into ocn_privado.config values ('vapid_publica', p_publica), ('vapid_privada', p_privada)
  on conflict (clave) do nothing;  -- nunca se reemplazan: cambiarlas anularía todas las suscripciones
  select true
$$;
-- p_pares: [{"empresa":"movistar","region":"Metropolitana"}, {"empresa":"vtr","region":null}, ...]
-- region null = falla de la red de la compañía a nivel país: avisa en todas las regiones.
-- Máximo un aviso cada 3 horas por suscripción; se marca al tomarla, así dos corridas no avisan doble.
create or replace function public.ocn_avisos_pendientes(p_pares jsonb) returns table (endpoint text, p256dh text, auth text, empresa text, region text)
language sql security definer set search_path = public, ocn_privado as $$
  update ocn_privado.suscripciones s set ultimo_aviso = now()
   where (s.ultimo_aviso is null or s.ultimo_aviso < now() - interval '3 hours')
     and exists (select 1 from jsonb_array_elements(p_pares) p
                  where lower(s.empresa) = p ->> 'empresa' and (p ->> 'region' is null or p ->> 'region' = s.region))
  returning s.endpoint, s.p256dh, s.auth, s.empresa, s.region
$$;
revoke all on function public.ocn_vapid_claves(), public.ocn_vapid_guardar(text, text), public.ocn_avisos_pendientes(jsonb) from public, anon, authenticated;
grant execute on function public.ocn_vapid_claves(), public.ocn_vapid_guardar(text, text), public.ocn_avisos_pendientes(jsonb) to service_role;

-- Retención: una suscripción que el navegador no renueva en 180 días se borra.
select cron.unschedule('ocn-retencion-avisos') where exists (select 1 from cron.job where jobname = 'ocn-retencion-avisos');
select cron.schedule('ocn-retencion-avisos', '40 4 * * *',
  $$ delete from ocn_privado.suscripciones where renovado_en < now() - interval '180 days'; $$);
