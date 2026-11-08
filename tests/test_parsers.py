from pathlib import Path

from scraper.http_client import es_desafio
from scraper.modelo import MASIVA, NORMAL, POSIBLES, Reporte, normalizar_gravedad
from scraper.sources import downdetector, geoblackout

FIX = Path(__file__).parent / "fixtures"


def test_downdetector_parsea_estado_cantidad_y_servicio():
    html = (FIX / "downdetector_directv.html").read_text()
    r = downdetector.parsear(html, "DIRECTV", "https://downdetector.cl/problemas/directv/")
    assert r.empresa == "DIRECTV"
    assert r.cantidad_reportes == 143
    assert r.gravedad == MASIVA
    assert r.servicio == "internet_fijo"
    assert r.precision_geo == "pais"


def test_detecta_cloudflare():
    html = (FIX / "downdetector_cloudflare.html").read_text()
    assert es_desafio(403, html)
    assert not es_desafio(200, "<html>ok</html>")


def test_geoblackout_agrega_por_comuna_y_descarta_viejos():
    html = (FIX / "geoblackout_internet.html").read_text()
    reps = geoblackout.parsear(html, "https://geoblackout.com/cl/report/internet")
    por_comuna = {(r.empresa, r.comuna): r for r in reps if r.precision_geo == "comuna"}
    maipu = por_comuna[("DIRECTV", "Maipú")]
    assert maipu.cantidad_reportes == 2 and maipu.servicio == "internet_fijo"
    assert maipu.gravedad == POSIBLES
    assert round(maipu.latitud, 2) == -33.51
    assert ("Movistar", "Las Condes") in por_comuna
    assert not any(r.comuna == "Chillán" for r in reps)  # hace 4 d: fuera de ventana
    totales = {r.empresa: r for r in reps if r.precision_geo == "pais"}
    assert totales["Movistar"].cantidad_reportes == 18
    assert totales["VTR"].gravedad == NORMAL  # declarado "Operativo"


def test_normalizar_gravedad():
    assert normalizar_gravedad("Los informes de usuarios indican posibles problemas en VTR") == POSIBLES
    assert normalizar_gravedad("Los informes de usuarios indican que no hay problemas actuales en VTR") == NORMAL
    assert normalizar_gravedad("Crítico") == MASIVA


def test_dedup_misma_ventana():
    a = Reporte(fuente="x", empresa="VTR", comuna="Maipú")
    b = Reporte(fuente="x", empresa="VTR", comuna="Maipú", ventana=a.ventana)
    assert a.hash_dedup == b.hash_dedup


def test_guardar_deduplica_y_usa_upsert(monkeypatch):
    from scraper import db

    llamadas = {}

    class Q:
        def upsert(self, filas, on_conflict, ignore_duplicates):
            llamadas.update(filas=filas, on_conflict=on_conflict, ignore=ignore_duplicates)
            return self

        def execute(self):
            return type("R", (), {"data": llamadas["filas"]})()

    class C:
        def table(self, nombre):
            llamadas["tabla"] = nombre
            return Q()

    monkeypatch.setattr(db, "cliente", lambda: C())
    a = Reporte(fuente="x", empresa="VTR", comuna="Maipú")
    b = Reporte(fuente="x", empresa="VTR", comuna="Maipú", ventana=a.ventana)
    assert db.guardar([a, b]) == 1
    assert llamadas["tabla"] == "reportes_caidas"
    assert llamadas["on_conflict"] == "hash_dedup" and llamadas["ignore"] is True
