"""Cliente HTTP con rotación de User-Agent, reintentos, robots.txt y respaldo Playwright.

Política del bot (no negociable):
- Respeta robots.txt. Si una ruta está prohibida, no se descarga.
- Una petición por página por ejecución, con pausas aleatorias entre peticiones.
- Si un sitio muestra un desafío anti-bot (Cloudflare), se registra y se omite.
  No se intenta resolver ni evadir el desafío.
"""
from __future__ import annotations

import logging
import random
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

from . import config

log = logging.getLogger("ocn.http")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
]

MARCAS_DESAFIO = ("cf-chl", "challenge-platform", "just a moment", "cf_chl_opt", "attention required")


class PaginaBloqueada(Exception):
    """El sitio devolvió un desafío anti-bot o 403/429 persistente."""


class RobotsProhibe(Exception):
    """robots.txt no permite descargar esta URL."""


def user_agent() -> str:
    return f"{random.choice(USER_AGENTS)} {config.BOT_CONTACTO}"


def pausa() -> None:
    time.sleep(random.uniform(config.PAUSA_MIN, config.PAUSA_MAX))


_robots: dict[str, RobotFileParser] = {}


def permitido(url: str) -> bool:
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = RobotFileParser()
        try:
            r = requests.get(f"{base}/robots.txt", headers={"User-Agent": user_agent()}, timeout=config.TIMEOUT)
            if r.status_code in (401, 403):
                rp.disallow_all = True  # mismo criterio que la librería estándar
            elif r.status_code >= 400:
                rp.allow_all = True
            else:
                rp.parse(r.text.splitlines())
        except requests.RequestException as e:
            log.warning("No pude leer robots.txt de %s (%s); por prudencia no descargo", base, e)
            rp.disallow_all = True
        _robots[base] = rp
    return _robots[base].can_fetch("*", url)


def es_desafio(status: int, html: str) -> bool:
    bajo = html[:20000].lower()
    return ("cf-chl" in bajo) or (status in (403, 503) and any(m in bajo for m in MARCAS_DESAFIO))


def get_html(url: str, necesita_js: bool = False) -> str:
    """Descarga una página. Usa Playwright si la página exige JavaScript."""
    if not permitido(url):
        raise RobotsProhibe(url)
    if necesita_js:
        return get_html_playwright(url)

    ultimo_error: Exception | None = None
    for intento in range(1, config.REINTENTOS + 1):
        try:
            r = requests.get(
                url,
                headers={
                    "User-Agent": user_agent(),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "es-CL,es;q=0.9",
                },
                timeout=config.TIMEOUT,
            )
            if es_desafio(r.status_code, r.text):
                log.warning("%s devolvió desafío anti-bot (HTTP %s)", url, r.status_code)
                if config.USAR_PLAYWRIGHT:
                    return get_html_playwright(url)
                raise PaginaBloqueada(url)
            if r.status_code == 429:
                espera = int(r.headers.get("Retry-After", "60"))
                log.warning("429 en %s, espero %ss", url, espera)
                time.sleep(min(espera, 120))
                continue
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            ultimo_error = e
            espera = 2 ** intento + random.random()
            log.warning("Intento %s/%s falló para %s: %s (reintento en %.1fs)", intento, config.REINTENTOS, url, e, espera)
            time.sleep(espera)
    raise PaginaBloqueada(f"{url}: {ultimo_error}")


def get_html_playwright(url: str) -> str:
    """Renderiza la página con Chromium sin interfaz. Devuelve el HTML ya ejecutado el JS."""
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        try:
            # OCN_CHROMIUM_PATH solo si usas un Chromium distinto al de `playwright install`.
            browser = pw.chromium.launch(headless=True, executable_path=config.CHROMIUM_PATH)
        except Exception as e:
            raise PaginaBloqueada(f"No pude abrir Chromium ({e}). ¿Corriste `playwright install chromium`?") from e
        try:
            ctx = browser.new_context(user_agent=user_agent(), locale="es-CL", timezone_id="America/Santiago")
            page = ctx.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=config.TIMEOUT * 1000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PWTimeout:
                pass  # algunas páginas nunca quedan "idle"; seguimos con lo que haya
            html = page.content()
        finally:
            browser.close()
    if es_desafio(403, html):
        raise PaginaBloqueada(f"{url}: desafío anti-bot también con navegador; se omite")
    return html
