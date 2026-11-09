-- Bot 24/7 sin GitHub: pg_cron llama a la Edge Function ocn-scraper cada 15 min.
-- Requisitos: extensiones pg_cron y pg_net (Integrations → Cron las instala).
-- Reemplaza <ANON_KEY> (Settings → API Keys → anon, es pública) y <OCN_TOKEN>
-- (el TOKEN_POR_DEFECTO de la función o el secret OCN_CRON_TOKEN).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ocn-scraper-15min')
where exists (select 1 from cron.job where jobname = 'ocn-scraper-15min');

select cron.schedule(
  'ocn-scraper-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://xomhtisorvfcrkpbvzpb.supabase.co/functions/v1/ocn-scraper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-ocn-token', '<OCN_TOKEN>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Ver ejecuciones:   select * from cron.job_run_details order by start_time desc limit 10;
-- Ver respuestas:    select status_code, content from net._http_response order by created desc limit 10;
