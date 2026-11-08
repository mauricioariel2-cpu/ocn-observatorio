"""Conexión a Supabase e inserción idempotente en reportes_caidas."""
from __future__ import annotations

import logging

from supabase import Client, create_client

from . import config
from .modelo import Reporte

log = logging.getLogger("ocn.db")


def cliente() -> Client:
    if not config.SUPABASE_URL or not config.SUPABASE_KEY:
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env o secrets)")
    return create_client(config.SUPABASE_URL, config.SUPABASE_KEY)


def guardar(reportes: list[Reporte], lote: int = 200) -> int:
    """Inserta los reportes. Si el script corre dos veces en la misma ventana de 15 min,
    el UNIQUE(hash_dedup) evita duplicados (ON CONFLICT DO NOTHING)."""
    if not reportes:
        log.info("Nada que guardar")
        return 0
    filas = list({r.hash_dedup: r.a_fila() for r in reportes}.values())
    sb = cliente()
    insertadas = 0
    for i in range(0, len(filas), lote):
        parte = filas[i : i + lote]
        try:
            res = (
                sb.table(config.TABLA)
                .upsert(parte, on_conflict="hash_dedup", ignore_duplicates=True)
                .execute()
            )
            insertadas += len(res.data or [])
        except Exception:
            log.exception("Falló la inserción del lote %s-%s", i, i + len(parte))
            raise
    log.info("Supabase: %s filas nuevas de %s enviadas", insertadas, len(filas))
    return insertadas
