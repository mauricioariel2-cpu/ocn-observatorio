"""Modelo de un registro de caída y normalizaciones comunes."""
from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from . import config

# Niveles normalizados que usará el dashboard.
NORMAL = "normal"
POSIBLES = "posibles_problemas"
MASIVA = "falla_masiva"


def sin_tildes(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in t if not unicodedata.combining(c)).lower().strip()


def normalizar_gravedad(texto: str | None) -> str | None:
    """Convierte el texto de cada fuente a normal / posibles_problemas / falla_masiva."""
    if not texto:
        return None
    t = sin_tildes(texto)
    if any(k in t for k in ("no hay problemas", "operativo", "nivel habitual", "sin problemas")):
        return NORMAL
    if any(k in t for k in ("posibles problemas", "menor", "possible problems")):
        return POSIBLES
    if any(k in t for k in ("critico", "indican problemas", "falla masiva", "caida masiva", "problems at")):
        return MASIVA
    return None


def gravedad_por_volumen(cantidad: int, posibles: int = 3, masiva: int = 10) -> str:
    """Umbral simple para fuentes que solo dan conteos (ajústalo con datos históricos)."""
    if cantidad >= masiva:
        return MASIVA
    if cantidad >= posibles:
        return POSIBLES
    return NORMAL


def ubicar_comuna(nombre: str | None):
    """Devuelve (comuna, region, lat, lon, precision) usando la tabla de config.COMUNAS."""
    if nombre:
        clave = sin_tildes(nombre).split(",")[0].strip()
        if clave in config.COMUNAS:
            comuna, region, lat, lon = config.COMUNAS[clave]
            return comuna, region, lat, lon, "comuna"
        return nombre.strip(), None, None, None, "sin_geo"
    lat, lon = config.CENTRO_PAIS
    return None, None, lat, lon, "pais"


def ventana_15min(dt: datetime | None = None) -> datetime:
    dt = dt or datetime.now(timezone.utc)
    return dt.replace(minute=dt.minute - dt.minute % 15, second=0, microsecond=0)


@dataclass
class Reporte:
    fuente: str
    empresa: str
    servicio: str | None = None
    region: str | None = None
    comuna: str | None = None
    cantidad_reportes: int | None = None
    gravedad: str | None = None
    gravedad_texto: str | None = None
    latitud: float | None = None
    longitud: float | None = None
    precision_geo: str | None = None
    url_fuente: str | None = None
    ventana: datetime = field(default_factory=ventana_15min)
    raw: dict = field(default_factory=dict)

    @property
    def hash_dedup(self) -> str:
        """Mismo origen + empresa + servicio + comuna + ventana de 15 min = mismo registro."""
        clave = "|".join(
            str(x) for x in (self.fuente, self.empresa, self.servicio, self.comuna, self.ventana.isoformat())
        )
        return hashlib.sha256(clave.encode()).hexdigest()

    def a_fila(self) -> dict:
        fila = asdict(self)
        fila["ventana"] = self.ventana.isoformat()
        fila["hash_dedup"] = self.hash_dedup
        return fila
