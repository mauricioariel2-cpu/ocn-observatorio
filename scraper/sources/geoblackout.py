"""Fuente: Geoblackout Chile (https://geoblackout.com/cl/report/internet).

robots.txt de Geoblackout: "Allow: /" y "Crawl-delay: 1". Es una app Next.js:
el listado de reportes viene en el HTML, pero los contadores se rellenan con
JavaScript, por eso se descarga con Playwright.

Da algo que Downdetector no da: la COMUNA de cada reporte ("DIRECTV DFibra caído
en Maipú"). Agregamos por (empresa, comuna) los reportes de las últimas horas.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import timedelta

from bs4 import BeautifulSoup

from .. import config
from ..http_client import PaginaBloqueada, RobotsProhibe, get_html, pausa
from ..modelo import NORMAL, Reporte, gravedad_por_volumen, normalizar_gravedad, sin_tildes, ubicar_comuna

log = logging.getLogger("ocn.geoblackout")

VENTANA_HORAS = 3  # reportes más antiguos no cuentan como "activos"

OPERADORES = ["DIRECTV", "Movistar", "Entel", "VTR", "Claro", "WOM", "GTD", "Mundo", "Telsur", "Starlink"]
RE_OPERADOR = re.compile(r"\b(" + "|".join(OPERADORES) + r")\b", re.I)
RE_CHIP = re.compile(r"^(" + "|".join(OPERADORES) + r")\s*(\d+)$", re.I)
RE_ITEM = re.compile(r"^(?P<producto>.+?)\s+ca[ií]d[oa]\s+en\s+(?P<comuna>[^,\n]+)", re.I)
RE_EDAD = re.compile(r"^hace\s+(\d+)\s*(min|h|d|s)\b", re.I)
RE_ESTADO_SERV = re.compile(r"^(?P<serv>(?:" + "|".join(OPERADORES) + r")[^\n]{0,30}?)\s+(?P<est>Operativo|Menor|Cr[ií]tico)$", re.I)


def _edad(linea: str) -> timedelta | None:
    l = linea.strip().lower()
    if l in ("ahora", "justo ahora", "hace un momento"):
        return timedelta(0)
    m = RE_EDAD.match(l)
    if not m:
        return None
    n, u = int(m.group(1)), m.group(2)
    return {"s": timedelta(seconds=n), "min": timedelta(minutes=n), "h": timedelta(hours=n), "d": timedelta(days=n)}[u]


def _servicio(producto: str) -> str:
    p = sin_tildes(RE_OPERADOR.sub(" ", producto))  # "DIRECTV" contiene "tv": se quita antes
    if any(k in p for k in ("fibra", "hfc", "hogar", "wifi")):
        return "internet_fijo"
    if any(k in p for k in ("movil", "4g", "5g", "celular", "senal")):
        return "internet_movil"
    if any(k in p for k in ("tv", "television", "cable", "satelital", "canal")):
        return "tv"
    return "internet_fijo"  # fibra, dfibra, hfc, internet hogar


def _canon_operador(texto: str) -> str | None:
    m = RE_OPERADOR.search(texto)
    if not m:
        return None
    return next(o for o in OPERADORES if o.lower() == m.group(1).lower())


def parsear(html: str, url: str) -> list[Reporte]:
    soup = BeautifulSoup(html, "html.parser")
    lineas = [l.strip() for l in soup.get_text("\n").split("\n") if l.strip()]

    # 1) Reportes individuales con comuna: "<producto> caído en <comuna>" + "hace N min" cercano.
    activos: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for i, linea in enumerate(lineas):
        m = RE_ITEM.match(linea)
        if not m:
            continue
        edad = next((e for e in (_edad(x) for x in lineas[i + 1 : i + 6]) if e is not None), None)
        if edad is None or edad > timedelta(hours=VENTANA_HORAS):
            continue
        empresa = _canon_operador(m.group("producto")) or "Otro"
        clave = (empresa, _servicio(m.group("producto")), m.group("comuna").strip())
        activos[clave].append(linea)

    # 2) Estado declarado por servicio ("VTR Cable  Operativo").
    estados = {}
    for i, linea in enumerate(lineas):
        m = RE_ESTADO_SERV.match(linea) or (
            i + 1 < len(lineas) and RE_ESTADO_SERV.match(f"{linea} {lineas[i + 1]}")
        )
        if m:
            op = _canon_operador(m.group("serv"))
            if op:
                estados.setdefault(op, m.group("est"))

    # 3) Totales 24 h por operador del filtro ("Movistar18" / "Movistar 18").
    totales = {}
    for i, linea in enumerate(lineas):
        sig = lineas[i + 1] if i + 1 < len(lineas) else ""
        m = RE_CHIP.match(linea.replace(" ", " ")) or (sig.isdigit() and RE_CHIP.match(f"{linea} {sig}"))
        if m:
            totales[_canon_operador(m.group(1))] = int(m.group(2))

    salida: list[Reporte] = []
    for (empresa, servicio, comuna_txt), items in activos.items():
        comuna, region, lat, lon, prec = ubicar_comuna(comuna_txt)
        n = len(items)
        salida.append(
            Reporte(
                fuente="geoblackout",
                empresa=empresa,
                servicio=servicio,
                region=region,
                comuna=comuna,
                cantidad_reportes=n,
                gravedad=gravedad_por_volumen(n, posibles=1, masiva=5),  # por comuna, en 3 h
                gravedad_texto=f"{n} reporte(s) en las últimas {VENTANA_HORAS} h",
                latitud=lat,
                longitud=lon,
                precision_geo=prec,
                url_fuente=url,
                raw={"items": items[:20]},
            )
        )

    for empresa, total in totales.items():
        est_txt = estados.get(empresa)
        _, _, lat, lon, prec = ubicar_comuna(None)
        salida.append(
            Reporte(
                fuente="geoblackout",
                empresa=empresa,
                servicio="internet",
                cantidad_reportes=total,
                gravedad=normalizar_gravedad(est_txt) or gravedad_por_volumen(total, posibles=10, masiva=30),  # 24 h
                gravedad_texto=est_txt or f"{total} reportes en 24 h",
                latitud=lat,
                longitud=lon,
                precision_geo=prec,
                url_fuente=url,
                raw={"total_24h": total},
            )
        )
    return salida


def recolectar(paginas: list[str] | None = None) -> list[Reporte]:
    salida: list[Reporte] = []
    for i, url in enumerate(paginas or config.GEOBLACKOUT_PAGINAS):
        if i:
            pausa()
        try:
            html = get_html(url, necesita_js=config.USAR_PLAYWRIGHT)
            reps = parsear(html, url)
            salida.extend(reps)
            log.info("Geoblackout %s: %s registros (%s con comuna)", url, len(reps),
                     sum(r.precision_geo == "comuna" for r in reps))
        except RobotsProhibe:
            log.warning("robots.txt no permite %s; omitido", url)
        except PaginaBloqueada as e:
            log.warning("Geoblackout bloqueó la descarga (%s); omitido", e)
        except Exception:
            log.exception("Error inesperado procesando %s", url)
    return [r for r in salida if r.cantidad_reportes or r.gravedad != NORMAL]
