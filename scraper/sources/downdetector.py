"""Fuente: Downdetector Chile (https://downdetector.cl/problemas/<empresa>/).

AVISO: Downdetector está detrás de Cloudflare y sus términos de uso prohíben la
extracción automatizada. Este módulo respeta robots.txt, hace 1 petición por
empresa y omite la página si aparece un desafío anti-bot. Para producción, la vía
correcta es la API oficial de Downdetector (Ookla), con licencia.

Los selectores se basan en la estructura conocida de la página (texto de estado
"Los informes de usuarios indican..." y la serie del gráfico {x: fecha, y: n} en
un <script>). Si Downdetector cambia su HTML, ajusta los regex de abajo.
"""
from __future__ import annotations

import logging
import re

from bs4 import BeautifulSoup

from .. import config
from ..http_client import PaginaBloqueada, RobotsProhibe, get_html, pausa
from ..modelo import Reporte, normalizar_gravedad, sin_tildes, ubicar_comuna

log = logging.getLogger("ocn.downdetector")

BASE = "https://downdetector.cl/problemas/{slug}/"

RE_ESTADO = re.compile(r"Los informes de usuarios indican[^.<\n]*", re.I)
RE_SERIE = re.compile(r"""x\s*:\s*['"]([^'"]+)['"]\s*,\s*y\s*:\s*(\d+)""")
RE_PROBLEMAS = re.compile(
    r"(Internet m[oó]vil|Internet|TV|Televisi[oó]n|Se[nñ]al|Telefon[ií]a fija|Telefon[ií]a|Wi-?Fi|App|Inicio de sesi[oó]n)"
    r"\s*\(?\s*(\d{1,3})\s*%",
    re.I,
)

MAPA_SERVICIO = {
    "internet": "internet_fijo",
    "internet movil": "internet_movil",
    "tv": "tv",
    "television": "tv",
    "senal": "tv",
    "telefonia fija": "telefonia_fija",
    "telefonia": "telefonia_fija",
    "wifi": "internet_fijo",
    "wi-fi": "internet_fijo",
}


def parsear(html: str, empresa: str, url: str) -> Reporte | None:
    soup = BeautifulSoup(html, "html.parser")
    texto = soup.get_text(" ", strip=True)

    m_estado = RE_ESTADO.search(texto)
    estado = m_estado.group(0).strip() if m_estado else None

    serie = [(x, int(y)) for x, y in RE_SERIE.findall(html)]
    cantidad = serie[-1][1] if serie else None

    servicio, problemas = None, {}
    for nombre, pct in RE_PROBLEMAS.findall(texto):
        clave = MAPA_SERVICIO.get(sin_tildes(nombre), sin_tildes(nombre))
        problemas[clave] = max(problemas.get(clave, 0), int(pct))
    if problemas:
        servicio = max(problemas, key=problemas.get)

    if estado is None and cantidad is None:
        log.warning("Downdetector %s: no encontré estado ni serie; ¿cambió el HTML?", empresa)
        return None

    comuna, region, lat, lon, prec = ubicar_comuna(None)  # Downdetector es nacional
    return Reporte(
        fuente="downdetector",
        empresa=empresa,
        servicio=servicio,
        region=region,
        comuna=comuna,
        cantidad_reportes=cantidad,
        gravedad=normalizar_gravedad(estado),
        gravedad_texto=estado,
        latitud=lat,
        longitud=lon,
        precision_geo=prec,
        url_fuente=url,
        raw={"serie_ultimos_puntos": serie[-8:], "problemas_pct": problemas},
    )


def recolectar(empresas: dict[str, str] | None = None) -> list[Reporte]:
    empresas = empresas or config.DOWNDETECTOR_EMPRESAS
    salida: list[Reporte] = []
    for i, (slug, nombre) in enumerate(empresas.items()):
        if i:
            pausa()
        url = BASE.format(slug=slug)
        try:
            html = get_html(url)
            rep = parsear(html, nombre, url)
            if rep:
                salida.append(rep)
                log.info("Downdetector %s: %s reportes, %s", nombre, rep.cantidad_reportes, rep.gravedad)
        except RobotsProhibe:
            log.warning("robots.txt de Downdetector no permite %s; se omite la fuente", url)
            break
        except PaginaBloqueada as e:
            log.warning("Downdetector bloqueó la descarga (%s); omitido", e)
            break  # si bloquea una, bloqueará todas: no insistimos
        except Exception:
            log.exception("Error inesperado procesando %s", url)
    return salida
