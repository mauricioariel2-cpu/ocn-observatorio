-- Relevo SEC: la SEC solo responde desde Chile. Una función en Google Cloud Santiago
-- (relay-sec/) consulta la SEC cada 15 minutos y entrega los datos crudos aquí con una clave.
-- El recolector (ocn-scraper) los lee de sec_crudo y los procesa como siempre.
create table if not exists sec_crudo (
  id bigserial primary key,
  recibido_en timestamptz not null default now(),
  ultima jsonb not null,
  comunas jsonb not null
);
alter table sec_crudo enable row level security; -- sin políticas: solo service_role la lee

create table if not exists ocn_claves (nombre text primary key, hash text not null);
alter table ocn_claves enable row level security; -- sin políticas: nadie la lee por la API

create or replace function ocn_recibir_sec(clave text, ultima jsonb, comunas jsonb) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from ocn_claves c where c.nombre = 'sec' and c.hash = encode(sha256(convert_to(clave, 'UTF8')), 'hex')) then
    raise exception 'clave invalida' using errcode = '42501';
  end if;
  if jsonb_typeof(ultima) <> 'object' or jsonb_typeof(comunas) <> 'array' or jsonb_array_length(comunas) > 2000 then
    raise exception 'formato invalido' using errcode = '22023';
  end if;
  insert into sec_crudo (ultima, comunas) values (ultima, comunas);
  delete from sec_crudo where recibido_en < now() - interval '2 days';
  return jsonb_array_length(comunas);
end $$;
revoke all on function ocn_recibir_sec(text, jsonb, jsonb) from public;
grant execute on function ocn_recibir_sec(text, jsonb, jsonb) to anon;

-- El hash de la clave se carga aparte (no va en el repositorio):
-- insert into ocn_claves values ('sec', '<sha256 hex>') on conflict (nombre) do update set hash = excluded.hash;
