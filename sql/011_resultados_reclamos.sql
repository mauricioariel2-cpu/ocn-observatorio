-- OCN · ¿Responden las compañías? Resultado anónimo de cada reclamo que la gente sigue en OCN.
-- La persona guarda su número de reclamo SOLO en su celular. Aquí llega únicamente:
-- empresa, resultado y cuántos días hábiles pasaron. Sin nombre, RUT, folio ni comuna.
-- Ejecutar una vez en Supabase → SQL Editor. Es idempotente. Requiere 004 (esquema ocn_privado).

create table if not exists public.reclamos_resultados (
  id           bigint generated always as identity primary key,
  creado_en    timestamptz not null default now(),
  empresa      text not null check (empresa in ('Movistar','Entel','VTR','Claro','WOM','GTD','Mundo','Telsur','Starlink','DIRECTV','Otro')),
  resultado    text not null check (resultado in ('resuelto','respondido_sin_solucion','sin_respuesta')),
  dias_habiles smallint not null check (dias_habiles between 0 and 365),
  dispositivo  uuid not null
);
create index if not exists reclamos_resultados_creado_idx on public.reclamos_resultados (creado_en desc);
alter table public.reclamos_resultados enable row level security;

revoke all on public.reclamos_resultados from anon, authenticated;
grant insert (empresa, resultado, dias_habiles, dispositivo) on public.reclamos_resultados to anon, authenticated;
grant select (id, creado_en, empresa, resultado, dias_habiles) on public.reclamos_resultados to anon, authenticated;

drop policy if exists "insertar resultado" on public.reclamos_resultados;
create policy "insertar resultado" on public.reclamos_resultados for insert to anon, authenticated with check (true);
drop policy if exists "leer resultados 365 dias" on public.reclamos_resultados;
create policy "leer resultados 365 dias" on public.reclamos_resultados for select to anon, authenticated
  using (creado_en > now() - interval '365 days');

-- Un resultado por dispositivo y empresa cada 3 días (evita inflar el contador).
create or replace function public.limitar_resultado() returns trigger
language plpgsql security definer set search_path = public, ocn_privado as $$
declare k text := 'rr:' || new.dispositivo::text || ':' || new.empresa;
begin
  new.creado_en := now();
  if exists (select 1 from ocn_privado.limites where clave = k and ultimo > now() - interval '3 days') then
    raise exception 'Ya registraste el resultado de tu reclamo contra % hace poco.', new.empresa using errcode = 'P0001';
  end if;
  insert into ocn_privado.limites (clave, ultimo) values (k, now()) on conflict (clave) do update set ultimo = excluded.ultimo;
  return new;
end $$;
revoke all on function public.limitar_resultado() from public, anon, authenticated;
drop trigger if exists limitar_resultado on public.reclamos_resultados;
create trigger limitar_resultado before insert on public.reclamos_resultados for each row execute function public.limitar_resultado();
