"""Punto de entrada del recolector OCN.

Uso:
    python -m scraper.main              # recolecta y guarda en Supabase
    python -m scraper.main --dry-run    # recolecta e imprime JSON, sin tocar la BD
    python -m scraper.main --solo geoblackout
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from .sources import downdetector, geoblackout

FUENTES = {"downdetector": downdetector.recolectar, "geoblackout": geoblackout.recolectar}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Recolector del Observatorio Ciudadano de Redes")
    ap.add_argument("--dry-run", action="store_true", help="no escribe en Supabase")
    ap.add_argument("--solo", choices=FUENTES.keys(), action="append", help="ejecutar solo esta fuente")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("ocn")

    reportes, fallidas = [], []
    for nombre in args.solo or FUENTES:
        try:
            reportes.extend(FUENTES[nombre]())
        except Exception:
            log.exception("La fuente %s falló completa", nombre)
            fallidas.append(nombre)

    log.info("Total: %s registros (%s fuentes con error)", len(reportes), len(fallidas))

    if args.dry_run:
        print(json.dumps([r.a_fila() for r in reportes], ensure_ascii=False, indent=2, default=str))
        return 0

    from .db import guardar

    guardar(reportes)
    # Código 1 solo si TODAS las fuentes fallaron: así GitHub Actions te avisa.
    return 1 if fallidas and len(fallidas) == len(args.solo or FUENTES) else 0


if __name__ == "__main__":
    sys.exit(main())
