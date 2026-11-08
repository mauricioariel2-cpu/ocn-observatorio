# OCN · Recolector de caídas (Pasos 1 y 2)

## Estructura (raíz de tu repo)

```
ocn/
├── scraper/
│   ├── config.py           # variables, empresas, tabla de comunas con lat/lon
│   ├── http_client.py      # rotación de User-Agent, reintentos, robots.txt, Playwright
│   ├── modelo.py           # registro Reporte, gravedad normalizada, dedup
│   ├── db.py               # supabase-py: upsert en reportes_caidas
│   ├── main.py             # punto de entrada
│   └── sources/
│       ├── downdetector.py
│       └── geoblackout.py
├── sql/001_reportes_caidas.sql
├── tests/                  # pytest con HTML de ejemplo
├── requirements.txt
├── .env.example
└── .gitignore
```

## Instalación (macOS / Linux)

```bash
cd ocn
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium        # en Linux/CI: playwright install --with-deps chromium
cp .env.example .env               # y pega tu SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
```

## Supabase

1. Dashboard de Supabase → SQL Editor → pega `sql/001_reportes_caidas.sql` → Run.
   Si ya creaste la tabla, revisa las columnas y usa los `ALTER` del final.
2. Project Settings → API: copia `Project URL` y la `service_role` key al `.env`.
   La service_role solo vive en `.env` y en los secrets de GitHub; el dashboard usará la `anon` key.

## Ejecutar

```bash
pytest -q                                   # 6 pruebas de parsers y BD (sin red)
python -m scraper.main --dry-run            # recolecta e imprime JSON, no escribe
python -m scraper.main --solo geoblackout   # una sola fuente
python -m scraper.main                      # recolecta y guarda en Supabase
```

## Qué hace contra bloqueos (y qué no)

- Rota 6 User-Agents reales y añade `OCN_CONTACTO` para identificarse.
- 3 reintentos con espera exponencial; respeta `Retry-After` en HTTP 429.
- Pausa aleatoria de 4 a 9 s entre páginas; 1 petición por página por corrida.
- Lee robots.txt antes de descargar. Si no lo puede leer, no descarga.
- Si detecta un desafío de Cloudflare, prueba una vez con Playwright; si sigue
  el desafío, omite la fuente y lo deja en el log. No intenta resolverlo.
- `hash_dedup` (fuente + empresa + servicio + comuna + tramo de 15 min) evita
  duplicados si el bot corre dos veces en el mismo tramo.

## Paso 3 · GitHub Actions (cada 15 min)

Archivo: `.github/workflows/scraper.yml` (en la raíz del repo, junto a `scraper/` y `requirements.txt`).

Secrets: repo → Settings → Secrets and variables → Actions → New repository secret
- `SUPABASE_URL` = `https://xomhtisorvfcrkpbvzpb.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = la service_role

O con GitHub CLI: `gh secret set SUPABASE_URL` y `gh secret set SUPABASE_SERVICE_ROLE_KEY`.

Prueba manual: pestaña Actions → "OCN scraper" → Run workflow.

## Paso 4 · Dashboard (React + Leaflet)

```bash
cd dashboard
npm install
cp .env.example .env.local     # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (anon, NO service_role)
npm run dev                    # http://localhost:5173
npm run build                  # genera dist/ para Vercel o Netlify
```
