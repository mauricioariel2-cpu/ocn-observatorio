-- OCN · Centro de reclamos: cuenta los reclamos formales que la gente arma en OCN.
-- No se guarda nombre, RUT ni número de cliente: esos datos solo quedan en el celular de la persona.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente.

create table if not exists public.reclamos_ciudadanos (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  empresa     text not null check (empresa in ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','Otro')),
  servicio    text not null check (servicio in ('internet_fijo','internet_movil','tv','telefonia')),
  region      text not null check (char_length(region) between 3 and 40),
  tipo        text not null check (tipo in ('caido','lento')),
  desde       text check (desde in ('recien','1h','3h','ayer')),
  dispositivo uuid not null
);
create index if not exists reclamos_ciudadanos_creado_idx on public.reclamos_ciudadanos (creado_en desc);
alter table public.reclamos_ciudadanos enable row level security;

revoke all on public.reclamos_ciudadanos from anon, authenticated;
grant insert (empresa, servicio, region, tipo, desde, dispositivo) on public.reclamos_ciudadanos to anon, authenticated;
grant select (id, creado_en, empresa, servicio, region, tipo, desde) on public.reclamos_ciudadanos to anon, authenticated;

drop policy if exists "insertar reclamo" on public.reclamos_ciudadanos;
create policy "insertar reclamo" on public.reclamos_ciudadanos for insert to anon, authenticated with check (true);
drop policy if exists "leer reclamos 90 dias" on public.reclamos_ciudadanos;
create policy "leer reclamos 90 dias" on public.reclamos_ciudadanos for select to anon, authenticated
  using (creado_en > now() - interval '90 days');

-- Un reclamo por dispositivo y empresa cada 6 horas (mismo esquema privado del botón "Me afecta").
create or replace function public.limitar_reclamo() returns trigger
language plpgsql security definer set search_path = public, ocn_privado as $$
declare k text := 'r:' || new.dispositivo::text || ':' || new.empresa;
begin
  new.creado_en := now();
  if exists (select 1 from ocn_privado.limites where clave = k and ultimo > now() - interval '6 hours') then
    raise exception 'Ya registraste un reclamo contra % hace poco. Lo contamos una vez cada 6 horas.', new.empresa using errcode = 'P0001';
  end if;
  insert into ocn_privado.limites (clave, ultimo) values (k, now()) on conflict (clave) do update set ultimo = excluded.ultimo;
  return new;
end $$;
revoke all on function public.limitar_reclamo() from public, anon, authenticated;
drop trigger if exists limitar_reclamo on public.reclamos_ciudadanos;
create trigger limitar_reclamo before insert on public.reclamos_ciudadanos for each row execute function public.limitar_reclamo();
