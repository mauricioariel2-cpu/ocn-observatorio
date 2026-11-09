-- OCN · Botón "Me afecta": reportes ciudadanos propios.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente (se puede re-ejecutar).
--
-- Privacidad: no se guarda la IP. Solo una huella SHA-256 con sal secreta, en un
-- esquema privado al que la web no tiene acceso, y se borra sola a las 24 h.
-- La ubicación, si la persona la comparte, se guarda redondeada a 2 decimales (~1 km).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.reportes_usuarios (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  empresa     text not null check (empresa in ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','Otro')),
  servicio    text not null check (servicio in ('internet_fijo','internet_movil','tv','telefonia')),
  region      text not null check (region in ('Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso',
                'Metropolitana','O''Higgins','Maule','Ñuble','Biobío','Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes')),
  comuna      text check (char_length(comuna) between 2 and 60),
  latitud     numeric(5,2) check (latitud between -56.5 and -17),
  longitud    numeric(6,2) check (longitud between -110 and -66),
  dispositivo uuid not null
);
create index if not exists reportes_usuarios_creado_idx on public.reportes_usuarios (creado_en desc);

alter table public.reportes_usuarios enable row level security;

-- La web (anon) puede insertar y leer las últimas 24 h, pero NO la columna "dispositivo".
revoke all on public.reportes_usuarios from anon, authenticated;
grant insert (empresa, servicio, region, comuna, latitud, longitud, dispositivo) on public.reportes_usuarios to anon, authenticated;
grant select (id, creado_en, empresa, servicio, region, comuna, latitud, longitud) on public.reportes_usuarios to anon, authenticated;

drop policy if exists "insertar reporte" on public.reportes_usuarios;
create policy "insertar reporte" on public.reportes_usuarios for insert to anon, authenticated with check (true);
drop policy if exists "leer ultimas 24h" on public.reportes_usuarios;
create policy "leer ultimas 24h" on public.reportes_usuarios for select to anon, authenticated
  using (creado_en > now() - interval '24 hours');

-- Esquema privado para el límite anti-spam (la web no puede verlo).
create schema if not exists ocn_privado;
revoke all on schema ocn_privado from public, anon, authenticated;
create table if not exists ocn_privado.config (clave text primary key, valor text not null);
insert into ocn_privado.config values ('sal', gen_random_uuid()::text) on conflict (clave) do nothing;
create table if not exists ocn_privado.limites (clave text primary key, ultimo timestamptz not null);

create or replace function public.limitar_reporte() returns trigger
language plpgsql security definer set search_path = public, ocn_privado, extensions as $$
declare
  ip text;
  sal text;
  claves text[];
  k text;
begin
  new.creado_en := now();                       -- la hora la pone el servidor, no el celular
  new.latitud := round(new.latitud, 2);
  new.longitud := round(new.longitud, 2);
  new.comuna := nullif(trim(new.comuna), '');

  -- Freno global ante ataques: más de 300 reportes en un minuto.
  if (select count(*) from public.reportes_usuarios where creado_en > now() - interval '1 minute') > 300 then
    raise exception 'Demasiados reportes en este momento. Intenta en un minuto.' using errcode = 'P0001';
  end if;

  select valor into sal from ocn_privado.config where clave = 'sal';
  ip := trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  claves := array['d:' || new.dispositivo::text];
  if ip <> '' then
    claves := claves || ('i:' || encode(digest(ip || sal, 'sha256'), 'hex'));
  end if;

  foreach k in array claves loop
    if exists (select 1 from ocn_privado.limites where clave = k and ultimo > now() - interval '30 minutes') then
      raise exception 'Ya enviaste un reporte hace poco. Puedes volver a reportar en 30 minutos.' using errcode = 'P0001';
    end if;
  end loop;
  foreach k in array claves loop
    insert into ocn_privado.limites (clave, ultimo) values (k, now())
      on conflict (clave) do update set ultimo = excluded.ultimo;
  end loop;
  delete from ocn_privado.limites where ultimo < now() - interval '24 hours';
  return new;
end $$;

revoke all on function public.limitar_reporte() from public, anon, authenticated;

drop trigger if exists limitar_reporte on public.reportes_usuarios;
create trigger limitar_reporte before insert on public.reportes_usuarios
  for each row execute function public.limitar_reporte();
