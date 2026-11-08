"""Configuración central del recolector OCN."""
import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# Usa la service_role key SOLO en el servidor (GitHub Actions / tu PC). Nunca en el frontend.
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
TABLA = os.getenv("OCN_TABLA", "reportes_caidas")

# Identificación honesta del bot (se añade al final del User-Agent).
BOT_CONTACTO = os.getenv("OCN_CONTACTO", "OCN-Observatorio-Ciudadano/0.1")

# Límites de tasa: pausa aleatoria entre peticiones (segundos).
PAUSA_MIN = float(os.getenv("OCN_PAUSA_MIN", "4"))
PAUSA_MAX = float(os.getenv("OCN_PAUSA_MAX", "9"))
TIMEOUT = float(os.getenv("OCN_TIMEOUT", "25"))
REINTENTOS = int(os.getenv("OCN_REINTENTOS", "3"))

# Si es "1", cuando una página exige JavaScript se reintenta con Playwright.
USAR_PLAYWRIGHT = os.getenv("OCN_PLAYWRIGHT", "1") == "1"
CHROMIUM_PATH = os.getenv("OCN_CHROMIUM_PATH") or None

# Empresas a vigilar en Downdetector Chile: slug de la URL -> nombre normalizado.
DOWNDETECTOR_EMPRESAS = {
    "directv": "DIRECTV",
    "movistar": "Movistar",
    "vtr": "VTR",
    "entel": "Entel",
    "claro": "Claro",
    "wom": "WOM",
    "gtd": "GTD",
    "mundo": "Mundo",
}

# Páginas de Geoblackout (robots.txt permite /, Crawl-delay: 1).
GEOBLACKOUT_PAGINAS = [
    "https://geoblackout.com/cl/report/internet",
]

# Centroides aproximados de comunas (lat, lon) para pintar el mapa.
# Amplía esta tabla o reemplázala por la tabla oficial de comunas del INE.
COMUNAS = {
    "maipu": ("Maipú", "Metropolitana", -33.5106, -70.7572),
    "santiago": ("Santiago", "Metropolitana", -33.4489, -70.6693),
    "puente alto": ("Puente Alto", "Metropolitana", -33.6117, -70.5758),
    "la florida": ("La Florida", "Metropolitana", -33.5227, -70.5980),
    "las condes": ("Las Condes", "Metropolitana", -33.4080, -70.5670),
    "providencia": ("Providencia", "Metropolitana", -33.4314, -70.6093),
    "nunoa": ("Ñuñoa", "Metropolitana", -33.4569, -70.5979),
    "pudahuel": ("Pudahuel", "Metropolitana", -33.4400, -70.7600),
    "quilicura": ("Quilicura", "Metropolitana", -33.3600, -70.7300),
    "san bernardo": ("San Bernardo", "Metropolitana", -33.5922, -70.6996),
    "penalolen": ("Peñalolén", "Metropolitana", -33.4850, -70.5400),
    "estacion central": ("Estación Central", "Metropolitana", -33.4600, -70.7000),
    "cerrillos": ("Cerrillos", "Metropolitana", -33.5000, -70.7160),
    "la pintana": ("La Pintana", "Metropolitana", -33.5833, -70.6333),
    "valparaiso": ("Valparaíso", "Valparaíso", -33.0472, -71.6127),
    "vina del mar": ("Viña del Mar", "Valparaíso", -33.0245, -71.5518),
    "concepcion": ("Concepción", "Biobío", -36.8270, -73.0503),
    "chillan": ("Chillán", "Ñuble", -36.6066, -72.1034),
    "temuco": ("Temuco", "Araucanía", -38.7359, -72.5904),
    "antofagasta": ("Antofagasta", "Antofagasta", -23.6509, -70.3975),
    "la serena": ("La Serena", "Coquimbo", -29.9027, -71.2519),
    "rancagua": ("Rancagua", "O'Higgins", -34.1708, -70.7444),
    "talca": ("Talca", "Maule", -35.4264, -71.6554),
    "puerto montt": ("Puerto Montt", "Los Lagos", -41.4689, -72.9411),
    "iquique": ("Iquique", "Tarapacá", -20.2133, -70.1503),
    "arica": ("Arica", "Arica y Parinacota", -18.4783, -70.3126),
}

# Si la fuente no da comuna (Downdetector es nacional), se usa el centro de Santiago
# marcado con precision_geo = 'pais' para que el mapa lo dibuje distinto.
CENTRO_PAIS = (-33.4489, -70.6693)
