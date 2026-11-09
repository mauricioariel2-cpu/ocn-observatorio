// OCN · Recolector como Supabase Edge Function (reemplaza a GitHub Actions).
//
// Lo llama pg_cron cada 15 minutos (ver sql/003_cron_scraper.sql).
// Fuentes (cada una con UNA o dos peticiones por corrida):
//  · Geoblackout Chile (robots.txt: Allow /, Crawl-delay 1): reportes por comuna.
//  · FallaCL (robots.txt: Allow /): API JSON pública que usa su propia web,
//    /api/reports/live, con reportes por servicio y la región del último reporte.
//  · IODA (Georgia Tech, api.ioda.inetintel.cc.gatech.edu): mediciones objetivas de
//    la red (BGP, ping a /24, telescopio). No son reportes de usuarios: detecta caídas
//    por operador (sistema autónomo), por región y del país completo.
//  · RIPE Atlas (RIPE NCC, API pública /api/v2/probes): sondas físicas en Chile; si varias
//    sondas de un mismo operador se desconectan en las últimas 3 h, es señal de corte.
//  · SEC (apps.sec.cl/INTONLINEv1): clientes sin luz por comuna, cada hora; van a la tabla cortes_luz.
//  · Blackout Map (blackoutmap.net, robots: Allow /, Crawl-delay 1; datos CC BY-NC 4.0,
//    citar "Blackout Map"): sus propios puntos de prueba DENTRO de la red de cada operador
//    chileno (ping cada 5 min) y reportes de usuarios de la última hora. Regiones de
//    status.json medidas por sus sondas.
// Downdetector no se incluye: su robots.txt prohíbe la página de DIRECTV.
//
// Variables que Supabase ya pone solas en toda función: SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY. OCN_CRON_TOKEN es opcional: si la defines en
// Edge Functions → Secrets, reemplaza al token por defecto de abajo.

const FUENTE_URL = "https://geoblackout.com/cl/report/internet";
const FALLACL_URL = "https://fallacl.cl";
const IODA_API = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const IODA_VENTANA_H = 3;
const ATLAS_API = "https://atlas.ripe.net/api/v2";
const ATLAS_CAIDA_H = 3; // una sonda que se desconectó hace menos de esto cuenta como caída reciente
const BLACKOUT_URL = "https://blackoutmap.net";
const VENTANA_HORAS = 3;
const MIN_ENTRE_CORRIDAS_MIN = 10; // freno anti-abuso: no scrapea más seguido que esto

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
];
const CONTACTO = "OCN-Observatorio-Ciudadano/0.2";
const TOKEN_POR_DEFECTO = "__OCN_TOKEN__";
// Ninguna petición puede colgar la corrida: si una fuente no responde en 15 s, se corta y las demás siguen.
const TIEMPO_MAX_MS = 15_000;
const fetchGlobal = globalThis.fetch;
const fetch = (url: string | URL | Request, init: RequestInit = {}) =>
  fetchGlobal(url, { signal: AbortSignal.timeout(TIEMPO_MAX_MS), ...init });

const OPERADORES = ["DIRECTV", "Movistar", "Entel", "VTR", "Claro", "WOM", "GTD", "Mundo", "Telsur", "Starlink"];
const RE_OPERADOR = new RegExp(`\\b(${OPERADORES.join("|")})\\b`, "i");
const RE_CHIP = new RegExp(`^(${OPERADORES.join("|")})\\s*(\\d+)$`, "i");
const RE_ITEM = /^(.+?)\s+ca[ií]d[oa]\s+en\s+([^,\n]+)/i;
const RE_EDAD = /^hace\s+(\d+)\s*(min|h|d|s)\b/i;
const RE_ESTADO = new RegExp(`^((?:${OPERADORES.join("|")})[^\\n]{0,30}?)\\s+(Operativo|Menor|Cr[ií]tico)$`, "i");

// Centroides de las 345 comunas: [comuna, región, lat, lon]. Calculados del polígono más grande
// de cada comuna en la cartografía de la Biblioteca del Congreso Nacional (BCN), vía react-chile-map (MIT).
const COMUNAS: Record<string, [string, string, number, number]> = {
  "algarrobo": ["Algarrobo", "Valparaíso", -33.3295, -71.5987],
  "alhue": ["Alhué", "Metropolitana", -34.0418, -71.0564],
  "alto biobio": ["Alto Biobío", "Biobío", -37.8651, -71.3488],
  "alto del carmen": ["Alto del Carmen", "Atacama", -28.9908, -70.1564],
  "alto hospicio": ["Alto Hospicio", "Tarapacá", -20.1907, -70.0111],
  "ancud": ["Ancud", "Los Lagos", -42.0176, -73.7989],
  "andacollo": ["Andacollo", "Coquimbo", -30.2595, -71.1006],
  "angol": ["Angol", "Araucanía", -37.7678, -72.7983],
  "antofagasta": ["Antofagasta", "Antofagasta", -24.2783, -69.4051],
  "antuco": ["Antuco", "Biobío", -37.3276, -71.3672],
  "arauco": ["Arauco", "Biobío", -37.2886, -73.399],
  "arica": ["Arica", "Arica y Parinacota", -18.5329, -69.9727],
  "aysen": ["Aysén", "Aysén", -46.0911, -73.7191],
  "buin": ["Buin", "Metropolitana", -33.749, -70.7417],
  "bulnes": ["Bulnes", "Ñuble", -36.7907, -72.2904],
  "cabildo": ["Cabildo", "Valparaíso", -32.4173, -70.8236],
  "cabo de hornos": ["Cabo de Hornos", "Magallanes", -54.6998, -70.1635],
  "cabrero": ["Cabrero", "Biobío", -37.0623, -72.3811],
  "calama": ["Calama", "Antofagasta", -22.1682, -68.6291],
  "calbuco": ["Calbuco", "Los Lagos", -41.7032, -73.2469],
  "caldera": ["Caldera", "Atacama", -27.1428, -70.6825],
  "calera": ["Calera", "Valparaíso", -32.7937, -71.1556],
  "calera de tango": ["Calera de Tango", "Metropolitana", -33.6194, -70.7867],
  "calle larga": ["Calle Larga", "Valparaíso", -32.9507, -70.5448],
  "camarones": ["Camarones", "Arica y Parinacota", -18.9373, -69.7144],
  "camina": ["Camiña", "Tarapacá", -19.3708, -69.4972],
  "canela": ["Canela", "Coquimbo", -31.4018, -71.3941],
  "canete": ["Cañete", "Biobío", -37.8737, -73.3176],
  "carahue": ["Carahue", "Araucanía", -38.6122, -73.2686],
  "cartagena": ["Cartagena", "Valparaíso", -33.5338, -71.4421],
  "casablanca": ["Casablanca", "Valparaíso", -33.3159, -71.4347],
  "castro": ["Castro", "Los Lagos", -42.461, -73.8322],
  "catemu": ["Catemu", "Valparaíso", -32.7074, -70.9447],
  "cauquenes": ["Cauquenes", "Maule", -35.9715, -72.2803],
  "cerrillos": ["Cerrillos", "Metropolitana", -33.4993, -70.7132],
  "cerro navia": ["Cerro Navia", "Metropolitana", -33.4222, -70.7414],
  "chaiten": ["Chaitén", "Los Lagos", -43.0982, -72.5714],
  "chanaral": ["Chañaral", "Atacama", -26.3731, -70.3381],
  "chanco": ["Chanco", "Maule", -35.6991, -72.4851],
  "chepica": ["Chépica", "O'Higgins", -34.7912, -71.3608],
  "chiguayante": ["Chiguayante", "Biobío", -36.901, -73.0062],
  "chile chico": ["Chile Chico", "Aysén", -46.7678, -72.5875],
  "chillan": ["Chillán", "Ñuble", -36.6164, -72.1265],
  "chillan viejo": ["Chillán Viejo", "Ñuble", -36.6802, -72.1989],
  "chimbarongo": ["Chimbarongo", "O'Higgins", -34.7519, -70.9812],
  "cholchol": ["Cholchol", "Araucanía", -38.5828, -72.9029],
  "chonchi": ["Chonchi", "Los Lagos", -42.6819, -73.9305],
  "cisnes": ["Cisnes", "Aysén", -44.3549, -72.6354],
  "cobquecura": ["Cobquecura", "Ñuble", -36.1814, -72.7203],
  "cochamo": ["Cochamó", "Los Lagos", -41.7709, -72.0689],
  "cochrane": ["Cochrane", "Aysén", -47.3588, -72.7427],
  "codegua": ["Codegua", "O'Higgins", -34.0573, -70.5473],
  "coelemu": ["Coelemu", "Ñuble", -36.5052, -72.7498],
  "coihueco": ["Coihueco", "Ñuble", -36.7028, -71.5802],
  "coinco": ["Coinco", "O'Higgins", -34.2824, -70.9752],
  "colbun": ["Colbún", "Maule", -36.0773, -70.9785],
  "colchane": ["Colchane", "Tarapacá", -19.3525, -68.8438],
  "colina": ["Colina", "Metropolitana", -33.1354, -70.6174],
  "collipulli": ["Collipulli", "Araucanía", -38.0254, -72.1277],
  "coltauco": ["Coltauco", "O'Higgins", -34.258, -71.0775],
  "combarbala": ["Combarbalá", "Coquimbo", -31.1467, -70.9654],
  "concepcion": ["Concepción", "Biobío", -36.8345, -72.9511],
  "conchali": ["Conchalí", "Metropolitana", -33.3849, -70.6752],
  "concon": ["Concón", "Valparaíso", -32.9526, -71.4669],
  "constitucion": ["Constitución", "Maule", -35.3632, -72.2766],
  "contulmo": ["Contulmo", "Biobío", -38.0522, -73.2114],
  "copiapo": ["Copiapó", "Atacama", -27.3169, -69.8218],
  "coquimbo": ["Coquimbo", "Coquimbo", -30.2286, -71.3585],
  "coronel": ["Coronel", "Biobío", -37.0046, -73.078],
  "corral": ["Corral", "Los Ríos", -39.9963, -73.3759],
  "coyhaique": ["Coyhaique", "Aysén", -45.5544, -71.9923],
  "cunco": ["Cunco", "Araucanía", -38.9777, -71.9926],
  "curacautin": ["Curacautín", "Araucanía", -38.427, -71.7711],
  "curacavi": ["Curacaví", "Metropolitana", -33.3676, -71.08],
  "curaco de velez": ["Curaco de Vélez", "Los Lagos", -42.4263, -73.5785],
  "curanilahue": ["Curanilahue", "Biobío", -37.4829, -73.2355],
  "curarrehue": ["Curarrehue", "Araucanía", -39.3352, -71.5392],
  "curepto": ["Curepto", "Maule", -35.1296, -71.9534],
  "curico": ["Curicó", "Maule", -35.1985, -70.8961],
  "dalcahue": ["Dalcahue", "Los Lagos", -42.3098, -73.8355],
  "diego de almagro": ["Diego de Almagro", "Atacama", -26.2329, -69.1887],
  "donihue": ["Doñihue", "O'Higgins", -34.195, -70.9222],
  "el bosque": ["El Bosque", "Metropolitana", -33.562, -70.6759],
  "el carmen": ["El Carmen", "Ñuble", -36.9247, -71.8469],
  "el monte": ["El Monte", "Metropolitana", -33.6679, -71.0329],
  "el quisco": ["El Quisco", "Valparaíso", -33.4152, -71.6511],
  "el tabo": ["El Tabo", "Valparaíso", -33.4829, -71.5801],
  "empedrado": ["Empedrado", "Maule", -35.6138, -72.2838],
  "ercilla": ["Ercilla", "Araucanía", -38.0829, -72.3543],
  "estacion central": ["Estación Central", "Metropolitana", -33.4633, -70.7061],
  "florida": ["Florida", "Biobío", -36.8225, -72.7182],
  "freire": ["Freire", "Araucanía", -38.9548, -72.5881],
  "freirina": ["Freirina", "Atacama", -28.8139, -71.1782],
  "fresia": ["Fresia", "Los Lagos", -41.1545, -73.6049],
  "frutillar": ["Frutillar", "Los Lagos", -41.087, -73.0943],
  "futaleufu": ["Futaleufú", "Los Lagos", -43.1806, -72.0066],
  "futrono": ["Futrono", "Los Ríos", -40.1187, -72.1149],
  "galvarino": ["Galvarino", "Araucanía", -38.4474, -72.7917],
  "general lagos": ["General Lagos", "Arica y Parinacota", -17.8307, -69.5719],
  "gorbea": ["Gorbea", "Araucanía", -39.1721, -72.6697],
  "graneros": ["Graneros", "O'Higgins", -34.0652, -70.7468],
  "guaitecas": ["Guaitecas", "Aysén", -43.8595, -73.9787],
  "hijuelas": ["Hijuelas", "Valparaíso", -32.8693, -71.0811],
  "hualaihue": ["Hualaihué", "Los Lagos", -42.181, -72.3704],
  "hualane": ["Hualañé", "Maule", -34.9528, -71.7069],
  "hualpen": ["Hualpén", "Biobío", -36.7886, -73.1409],
  "hualqui": ["Hualqui", "Biobío", -37.0449, -72.8706],
  "huara": ["Huara", "Tarapacá", -19.6014, -69.6561],
  "huasco": ["Huasco", "Atacama", -28.2503, -71.0285],
  "huechuraba": ["Huechuraba", "Metropolitana", -33.3619, -70.6357],
  "illapel": ["Illapel", "Coquimbo", -31.5493, -70.9704],
  "independencia": ["Independencia", "Metropolitana", -33.4142, -70.6647],
  "iquique": ["Iquique", "Tarapacá", -20.9242, -70.048],
  "isla de maipo": ["Isla de Maipo", "Metropolitana", -33.7488, -70.9469],
  "isla de pascua": ["Isla de Pascua", "Valparaíso", -27.1193, -109.3549],
  "juan fernandez": ["Juan Fernández", "Valparaíso", -33.7674, -80.7918],
  "la cisterna": ["La Cisterna", "Metropolitana", -33.5296, -70.6638],
  "la cruz": ["La Cruz", "Valparaíso", -32.825, -71.24],
  "la estrella": ["La Estrella", "O'Higgins", -34.2234, -71.6036],
  "la florida": ["La Florida", "Metropolitana", -33.5289, -70.5407],
  "la granja": ["La Granja", "Metropolitana", -33.5353, -70.6227],
  "la higuera": ["La Higuera", "Coquimbo", -29.3756, -70.9008],
  "la ligua": ["La Ligua", "Valparaíso", -32.354, -71.2709],
  "la pintana": ["La Pintana", "Metropolitana", -33.586, -70.6329],
  "la reina": ["La Reina", "Metropolitana", -33.4461, -70.5386],
  "la serena": ["La Serena", "Coquimbo", -29.7893, -71.0607],
  "la union": ["La Unión", "Los Ríos", -40.2019, -73.2198],
  "lago ranco": ["Lago Ranco", "Los Ríos", -40.3726, -72.1656],
  "lago verde": ["Lago Verde", "Aysén", -44.4926, -71.8336],
  "laguna blanca": ["Laguna Blanca", "Magallanes", -52.3302, -71.2399],
  "laja": ["Laja", "Biobío", -37.3128, -72.5826],
  "lampa": ["Lampa", "Metropolitana", -33.2783, -70.8747],
  "lanco": ["Lanco", "Los Ríos", -39.5121, -72.6214],
  "las cabras": ["Las Cabras", "O'Higgins", -34.165, -71.3328],
  "las condes": ["Las Condes", "Metropolitana", -33.4205, -70.5013],
  "lautaro": ["Lautaro", "Araucanía", -38.5428, -72.2905],
  "lebu": ["Lebu", "Biobío", -37.607, -73.5578],
  "licanten": ["Licantén", "Maule", -34.9732, -72.0589],
  "limache": ["Limache", "Valparaíso", -33.0312, -71.2781],
  "linares": ["Linares", "Maule", -35.9578, -71.3331],
  "litueche": ["Litueche", "O'Higgins", -34.1055, -71.7298],
  "llaillay": ["Llaillay", "Valparaíso", -32.8882, -70.9016],
  "llanquihue": ["Llanquihue", "Los Lagos", -41.2379, -73.133],
  "lo barnechea": ["Lo Barnechea", "Metropolitana", -33.2994, -70.3686],
  "lo espejo": ["Lo Espejo", "Metropolitana", -33.5205, -70.69],
  "lo prado": ["Lo Prado", "Metropolitana", -33.4451, -70.7253],
  "lolol": ["Lolol", "O'Higgins", -34.7677, -71.6478],
  "loncoche": ["Loncoche", "Araucanía", -39.3555, -72.5808],
  "longavi": ["Longaví", "Maule", -36.1107, -71.4408],
  "lonquimay": ["Lonquimay", "Araucanía", -38.4738, -71.2382],
  "los alamos": ["Los Alamos", "Biobío", -37.674, -73.357],
  "los andes": ["Los Andes", "Valparaíso", -32.9509, -70.2431],
  "los angeles": ["Los Angeles", "Biobío", -37.4076, -72.3273],
  "los lagos": ["Los Lagos", "Los Ríos", -39.879, -72.5539],
  "los muermos": ["Los Muermos", "Los Lagos", -41.3967, -73.5808],
  "los sauces": ["Los Sauces", "Araucanía", -37.9828, -72.7965],
  "los vilos": ["Los Vilos", "Coquimbo", -31.9779, -71.3036],
  "lota": ["Lota", "Biobío", -37.1199, -73.1045],
  "lumaco": ["Lumaco", "Araucanía", -38.2871, -73.0465],
  "machali": ["Machalí", "O'Higgins", -34.3203, -70.319],
  "macul": ["Macul", "Metropolitana", -33.489, -70.6003],
  "mafil": ["Máfil", "Los Ríos", -39.692, -72.8637],
  "maipu": ["Maipú", "Metropolitana", -33.5074, -70.8105],
  "malloa": ["Malloa", "O'Higgins", -34.4749, -70.8756],
  "marchigue": ["Marchigüe", "O'Higgins", -34.3728, -71.6709],
  "maria elena": ["María Elena", "Antofagasta", -22.0931, -69.4655],
  "maria pinto": ["María Pinto", "Metropolitana", -33.499, -71.2128],
  "mariquina": ["Mariquina", "Los Ríos", -39.5104, -73.0172],
  "maule": ["Maule", "Maule", -35.5087, -71.71],
  "maullin": ["Maullín", "Los Lagos", -41.649, -73.4761],
  "mejillones": ["Mejillones", "Antofagasta", -22.9463, -70.2029],
  "melipeuco": ["Melipeuco", "Araucanía", -38.825, -71.6106],
  "melipilla": ["Melipilla", "Metropolitana", -33.7442, -71.1946],
  "molina": ["Molina", "Maule", -35.3527, -70.9093],
  "monte patria": ["Monte Patria", "Coquimbo", -30.8346, -70.6503],
  "mostazal": ["Mostazal", "O'Higgins", -33.9554, -70.5688],
  "mulchen": ["Mulchén", "Biobío", -37.8383, -72.0972],
  "nacimiento": ["Nacimiento", "Biobío", -37.4851, -72.8236],
  "nancagua": ["Nancagua", "O'Higgins", -34.6686, -71.191],
  "natales": ["Natales", "Magallanes", -50.2751, -73.7231],
  "navidad": ["Navidad", "O'Higgins", -34.0124, -71.8211],
  "negrete": ["Negrete", "Biobío", -37.6078, -72.5756],
  "ninhue": ["Ninhue", "Ñuble", -36.3564, -72.4097],
  "niquen": ["Ñiquén", "Ñuble", -36.3029, -71.8973],
  "nogales": ["Nogales", "Valparaíso", -32.6916, -71.1761],
  "nueva imperial": ["Nueva Imperial", "Araucanía", -38.7512, -72.9704],
  "nunoa": ["Ñuñoa", "Metropolitana", -33.4565, -70.6004],
  "o'higgins": ["O'Higgins", "Aysén", -48.4778, -72.9029],
  "olivar": ["Olivar", "O'Higgins", -34.2117, -70.8208],
  "ollague": ["Ollagüe", "Antofagasta", -21.4585, -68.3152],
  "olmue": ["Olmué", "Valparaíso", -33.0357, -71.1104],
  "osorno": ["Osorno", "Los Lagos", -40.6117, -73.0869],
  "ovalle": ["Ovalle", "Coquimbo", -30.6732, -71.4052],
  "padre hurtado": ["Padre Hurtado", "Metropolitana", -33.5585, -70.8719],
  "padre las casas": ["Padre Las Casas", "Araucanía", -38.8018, -72.5543],
  "paihuano": ["Paihuano", "Coquimbo", -30.2345, -70.3719],
  "paillaco": ["Paillaco", "Los Ríos", -40.0742, -72.8431],
  "paine": ["Paine", "Metropolitana", -33.8639, -70.7558],
  "palena": ["Palena", "Los Lagos", -43.6832, -71.9837],
  "palmilla": ["Palmilla", "O'Higgins", -34.5285, -71.3549],
  "panguipulli": ["Panguipulli", "Los Ríos", -39.7145, -72.0297],
  "panquehue": ["Panquehue", "Valparaíso", -32.7937, -70.8285],
  "papudo": ["Papudo", "Valparaíso", -32.4749, -71.3798],
  "paredones": ["Paredones", "O'Higgins", -34.6742, -71.9104],
  "parral": ["Parral", "Maule", -36.2618, -71.6461],
  "pedro aguirre cerda": ["Pedro Aguirre Cerda", "Metropolitana", -33.4919, -70.6758],
  "pelarco": ["Pelarco", "Maule", -35.3826, -71.3501],
  "pelluhue": ["Pelluhue", "Maule", -35.911, -72.6068],
  "pemuco": ["Pemuco", "Ñuble", -36.9829, -72.0678],
  "penaflor": ["Peñaflor", "Metropolitana", -33.6105, -70.8937],
  "penalolen": ["Peñalolén", "Metropolitana", -33.4844, -70.5253],
  "pencahue": ["Pencahue", "Maule", -35.3276, -71.8162],
  "penco": ["Penco", "Biobío", -36.7478, -72.9437],
  "peralillo": ["Peralillo", "O'Higgins", -34.4659, -71.4976],
  "perquenco": ["Perquenco", "Araucanía", -38.4274, -72.4346],
  "petorca": ["Petorca", "Valparaíso", -32.1905, -70.87],
  "peumo": ["Peumo", "O'Higgins", -34.3296, -71.2216],
  "pica": ["Pica", "Tarapacá", -20.4815, -68.913],
  "pichidegua": ["Pichidegua", "O'Higgins", -34.3709, -71.3404],
  "pichilemu": ["Pichilemu", "O'Higgins", -34.385, -71.9111],
  "pinto": ["Pinto", "Ñuble", -36.9219, -71.4992],
  "pirque": ["Pirque", "Metropolitana", -33.7186, -70.5064],
  "pitrufquen": ["Pitrufquén", "Araucanía", -39.0836, -72.6654],
  "placilla": ["Placilla", "O'Higgins", -34.6188, -71.0852],
  "portezuelo": ["Portezuelo", "Ñuble", -36.5462, -72.4659],
  "porvenir": ["Porvenir", "Magallanes", -53.3123, -69.38],
  "pozo almonte": ["Pozo Almonte", "Tarapacá", -20.773, -69.5073],
  "primavera": ["Primavera", "Magallanes", -52.8176, -69.3293],
  "providencia": ["Providencia", "Metropolitana", -33.4299, -70.6117],
  "puchuncavi": ["Puchuncaví", "Valparaíso", -32.7454, -71.3875],
  "pucon": ["Pucón", "Araucanía", -39.2714, -71.793],
  "pudahuel": ["Pudahuel", "Metropolitana", -33.4246, -70.8535],
  "puente alto": ["Puente Alto", "Metropolitana", -33.5917, -70.5569],
  "puerto montt": ["Puerto Montt", "Los Lagos", -41.4875, -72.7925],
  "puerto octay": ["Puerto Octay", "Los Lagos", -40.9329, -72.5992],
  "puerto varas": ["Puerto Varas", "Los Lagos", -41.1899, -72.3857],
  "pumanque": ["Pumanque", "O'Higgins", -34.5953, -71.692],
  "punitaqui": ["Punitaqui", "Coquimbo", -30.9464, -71.3329],
  "punta arenas": ["Punta Arenas", "Magallanes", -53.3968, -71.4736],
  "puqueldon": ["Puqueldón", "Los Lagos", -42.6262, -73.6377],
  "puren": ["Purén", "Araucanía", -38.0126, -73.0511],
  "purranque": ["Purranque", "Los Lagos", -40.9356, -73.4566],
  "putaendo": ["Putaendo", "Valparaíso", -32.4812, -70.5216],
  "putre": ["Putre", "Arica y Parinacota", -18.4287, -69.3116],
  "puyehue": ["Puyehue", "Los Lagos", -40.7257, -72.3842],
  "queilen": ["Queilén", "Los Lagos", -42.8214, -73.5966],
  "quellon": ["Quellón", "Los Lagos", -43.1129, -73.9606],
  "quemchi": ["Quemchi", "Los Lagos", -42.1483, -73.4786],
  "quilaco": ["Quilaco", "Biobío", -37.9606, -71.7047],
  "quilicura": ["Quilicura", "Metropolitana", -33.3564, -70.735],
  "quilleco": ["Quilleco", "Biobío", -37.4369, -71.861],
  "quillon": ["Quillón", "Ñuble", -36.8189, -72.5021],
  "quillota": ["Quillota", "Valparaíso", -32.9047, -71.2726],
  "quilpue": ["Quilpué", "Valparaíso", -33.1472, -71.2543],
  "quinchao": ["Quinchao", "Los Lagos", -42.5117, -73.4618],
  "quinta de tilcoco": ["Quinta de Tilcoco", "O'Higgins", -34.3593, -70.9985],
  "quinta normal": ["Quinta Normal", "Metropolitana", -33.4285, -70.701],
  "quintero": ["Quintero", "Valparaíso", -32.8431, -71.4727],
  "quirihue": ["Quirihue", "Ñuble", -36.235, -72.5438],
  "rancagua": ["Rancagua", "O'Higgins", -34.126, -70.816],
  "ranquil": ["Ranquil", "Ñuble", -36.64, -72.588],
  "rauco": ["Rauco", "Maule", -34.9383, -71.4251],
  "recoleta": ["Recoleta", "Metropolitana", -33.4079, -70.6391],
  "renaico": ["Renaico", "Araucanía", -37.7173, -72.5769],
  "renca": ["Renca", "Metropolitana", -33.4015, -70.7241],
  "rengo": ["Rengo", "O'Higgins", -34.4538, -70.7192],
  "requinoa": ["Requínoa", "O'Higgins", -34.3342, -70.6605],
  "retiro": ["Retiro", "Maule", -36.0021, -71.8294],
  "rinconada": ["Rinconada", "Valparaíso", -32.8765, -70.7062],
  "rio bueno": ["Río Bueno", "Los Ríos", -40.4963, -72.5345],
  "rio claro": ["Río Claro", "Maule", -35.2598, -71.2709],
  "rio hurtado": ["Río Hurtado", "Coquimbo", -30.4305, -70.654],
  "rio ibanez": ["Río Ibáñez", "Aysén", -46.3004, -72.4862],
  "rio negro": ["Río Negro", "Los Lagos", -40.7704, -73.4163],
  "rio verde": ["Río Verde", "Magallanes", -53.0076, -72.357],
  "romeral": ["Romeral", "Maule", -35.0687, -70.7113],
  "saavedra": ["Saavedra", "Araucanía", -38.8329, -73.2958],
  "sagrada familia": ["Sagrada Familia", "Maule", -35.1041, -71.497],
  "salamanca": ["Salamanca", "Coquimbo", -31.8934, -70.6613],
  "san antonio": ["San Antonio", "Valparaíso", -33.665, -71.4893],
  "san bernardo": ["San Bernardo", "Metropolitana", -33.6284, -70.7224],
  "san carlos": ["San Carlos", "Ñuble", -36.3858, -72.0181],
  "san clemente": ["San Clemente", "Maule", -35.7119, -70.8487],
  "san esteban": ["San Esteban", "Valparaíso", -32.6867, -70.3483],
  "san fabian": ["San Fabián", "Ñuble", -36.5796, -71.2867],
  "san felipe": ["San Felipe", "Valparaíso", -32.7365, -70.753],
  "san fernando": ["San Fernando", "O'Higgins", -34.7431, -70.603],
  "san gregorio": ["San Gregorio", "Magallanes", -52.3207, -70.2223],
  "san ignacio": ["San Ignacio", "Ñuble", -36.8224, -72.0312],
  "san javier": ["San Javier", "Maule", -35.6288, -71.9273],
  "san joaquin": ["San Joaquín", "Metropolitana", -33.4958, -70.6284],
  "san jose de maipo": ["San José de Maipo", "Metropolitana", -33.7046, -70.0972],
  "san juan de la costa": ["San Juan de la Costa", "Los Lagos", -40.5067, -73.5606],
  "san miguel": ["San Miguel", "Metropolitana", -33.4989, -70.6514],
  "san nicolas": ["San Nicolás", "Ñuble", -36.4791, -72.2289],
  "san pablo": ["San Pablo", "Los Lagos", -40.4272, -73.1619],
  "san pedro": ["San Pedro", "Metropolitana", -33.9319, -71.4518],
  "san pedro de atacama": ["San Pedro de Atacama", "Antofagasta", -23.4041, -67.9095],
  "san pedro de la paz": ["San Pedro de la Paz", "Biobío", -36.8808, -73.0984],
  "san rafael": ["San Rafael", "Maule", -35.3026, -71.5015],
  "san ramon": ["San Ramón", "Metropolitana", -33.5404, -70.642],
  "san rosendo": ["San Rosendo", "Biobío", -37.2141, -72.7213],
  "san vicente": ["San Vicente", "O'Higgins", -34.4774, -71.1236],
  "santa barbara": ["Santa Bárbara", "Biobío", -37.6213, -71.749],
  "santa cruz": ["Santa Cruz", "O'Higgins", -34.6436, -71.4015],
  "santa juana": ["Santa Juana", "Biobío", -37.2767, -72.9604],
  "santa maria": ["Santa María", "Valparaíso", -32.6861, -70.6097],
  "santiago": ["Santiago", "Metropolitana", -33.4544, -70.6593],
  "santo domingo": ["Santo Domingo", "Valparaíso", -33.8097, -71.6763],
  "sierra gorda": ["Sierra Gorda", "Antofagasta", -23.26, -69.3092],
  "talagante": ["Talagante", "Metropolitana", -33.6797, -70.8949],
  "talca": ["Talca", "Maule", -35.4275, -71.6023],
  "talcahuano": ["Talcahuano", "Biobío", -36.7202, -73.1011],
  "taltal": ["Taltal", "Antofagasta", -25.3103, -69.862],
  "temuco": ["Temuco", "Araucanía", -38.6722, -72.6674],
  "teno": ["Teno", "Maule", -34.8885, -71.0215],
  "teodoro schmidt": ["Teodoro Schmidt", "Araucanía", -39.0057, -73.1279],
  "tierra amarilla": ["Tierra Amarilla", "Atacama", -27.8632, -69.6709],
  "tiltil": ["Tiltil", "Metropolitana", -33.0631, -70.8769],
  "timaukel": ["Timaukel", "Magallanes", -54.2024, -69.5425],
  "tirua": ["Tirúa", "Biobío", -38.2969, -73.3941],
  "tocopilla": ["Tocopilla", "Antofagasta", -22.0033, -70.0179],
  "tolten": ["Toltén", "Araucanía", -39.2167, -73.0647],
  "tome": ["Tomé", "Biobío", -36.617, -72.8583],
  "torres del paine": ["Torres del Paine", "Magallanes", -51.0504, -72.8416],
  "tortel": ["Tortel", "Aysén", -47.4815, -73.8622],
  "traiguen": ["Traiguén", "Araucanía", -38.2457, -72.6542],
  "treguaco": ["Treguaco", "Ñuble", -36.4282, -72.6591],
  "tucapel": ["Tucapel", "Biobío", -37.2252, -71.7446],
  "valdivia": ["Valdivia", "Los Ríos", -39.8475, -73.1063],
  "vallenar": ["Vallenar", "Atacama", -28.5949, -70.6031],
  "valparaiso": ["Valparaíso", "Valparaíso", -33.1297, -71.5731],
  "vichuquen": ["Vichuquén", "Maule", -34.8411, -72.0217],
  "victoria": ["Victoria", "Araucanía", -38.2811, -72.2328],
  "vicuna": ["Vicuña", "Coquimbo", -29.8921, -70.3821],
  "vilcun": ["Vilcún", "Araucanía", -38.7048, -72.1142],
  "villa alegre": ["Villa Alegre", "Maule", -35.6862, -71.6842],
  "villa alemana": ["Villa Alemana", "Valparaíso", -33.0674, -71.3303],
  "villarrica": ["Villarrica", "Araucanía", -39.3016, -72.1828],
  "vina del mar": ["Viña del Mar", "Valparaíso", -33.0278, -71.5153],
  "vitacura": ["Vitacura", "Metropolitana", -33.379, -70.5731],
  "yerbas buenas": ["Yerbas Buenas", "Maule", -35.6899, -71.5448],
  "yumbel": ["Yumbel", "Biobío", -37.0894, -72.6156],
  "yungay": ["Yungay", "Ñuble", -37.1045, -71.9312],
  "zapallar": ["Zapallar", "Valparaíso", -32.5876, -71.3358],
};
// Nombres que la SEC escribe distinto a la BCN.
const ALIAS_COMUNA: Record<string, string> = {
  "marchihue": "marchigue", "paiguano": "paihuano", "punitagui": "punitaqui", "la calera": "calera",
  "sierra;rda": "sierra gorda", "llay-llay": "llaillay", "trehuaco": "treguaco", "aisen": "aysen",
};
export function buscarComuna(nombre: string) {
  const k = sinTildes(nombre).replace(/\s*\(.*\)\s*$/, "");
  return COMUNAS[ALIAS_COMUNA[k] ?? k];
}
// Centro aproximado (capital regional) de cada región, para datos con precisión de región.
const REGIONES: Record<string, [string, number, number]> = {
  "arica y parinacota": ["Arica y Parinacota", -18.4783, -70.3126],
  "tarapaca": ["Tarapacá", -20.2133, -70.1503],
  "antofagasta": ["Antofagasta", -23.6509, -70.3975],
  "atacama": ["Atacama", -27.3668, -70.3314],
  "coquimbo": ["Coquimbo", -29.9027, -71.2519],
  "valparaiso": ["Valparaíso", -33.0472, -71.6127],
  "metropolitana": ["Metropolitana", -33.4489, -70.6693],
  "o'higgins": ["O'Higgins", -34.1708, -70.7444],
  "ohiggins": ["O'Higgins", -34.1708, -70.7444],
  "maule": ["Maule", -35.4264, -71.6554],
  "nuble": ["Ñuble", -36.6066, -72.1034],
  "biobio": ["Biobío", -36.8270, -73.0503],
  "araucania": ["Araucanía", -38.7359, -72.5904],
  "la araucania": ["Araucanía", -38.7359, -72.5904],
  "los rios": ["Los Ríos", -39.8142, -73.2459],
  "los lagos": ["Los Lagos", -41.4689, -72.9411],
  "aysen": ["Aysén", -45.5712, -72.0685],
  "aisen": ["Aysén", -45.5712, -72.0685],
  "higgins": ["O'Higgins", -34.1708, -70.7444],
  "santiago": ["Metropolitana", -33.4489, -70.6693],
  "bio-bio": ["Biobío", -36.8270, -73.0503],
  "bio bio": ["Biobío", -36.8270, -73.0503],
  "magallanes": ["Magallanes", -53.1638, -70.9171],
};
const CENTRO_PAIS: [number, number] = [-33.4489, -70.6693];

type Fila = Record<string, unknown>;

export function sinTildes(t: string) {
  return t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function gravedadVolumen(n: number, posibles: number, masiva: number) {
  return n >= masiva ? "falla_masiva" : n >= posibles ? "posibles_problemas" : "normal";
}

function gravedadTexto(t?: string) {
  if (!t) return null;
  const s = sinTildes(t);
  if (/operativo|nivel habitual|no hay problemas/.test(s)) return "normal";
  if (/menor|posibles problemas/.test(s)) return "posibles_problemas";
  if (/critico|falla masiva/.test(s)) return "falla_masiva";
  return null;
}

function operador(t: string) {
  const m = t.match(RE_OPERADOR);
  return m ? OPERADORES.find((o) => o.toLowerCase() === m[1].toLowerCase())! : null;
}

function servicio(producto: string) {
  const p = sinTildes(producto.replace(RE_OPERADOR, " "));
  if (/fibra|hfc|hogar|wifi/.test(p)) return "internet_fijo";
  if (/movil|4g|5g|celular|senal/.test(p)) return "internet_movil";
  if (/tv|television|cable|satelital|canal/.test(p)) return "tv";
  return "internet_fijo";
}

function edadMin(linea: string): number | null {
  const l = linea.trim().toLowerCase();
  if (["ahora", "justo ahora", "hace un momento"].includes(l)) return 0;
  const m = l.match(RE_EDAD);
  if (!m) return null;
  const n = Number(m[1]);
  return { s: n / 60, min: n, h: n * 60, d: n * 1440 }[m[2] as "s" | "min" | "h" | "d"];
}

export function ventana15(d = new Date()) {
  const v = new Date(d);
  v.setUTCMinutes(v.getUTCMinutes() - (v.getUTCMinutes() % 15), 0, 0);
  return v.toISOString();
}

async function hash(partes: unknown[]) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(partes.map(String).join("|")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function lineasDeHtml(html: string): string[] {
  const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "\n").replace(/<style[\s\S]*?<\/style>/gi, "\n");
  const texto = sinScripts
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export async function parsear(html: string, url = FUENTE_URL, ahora = new Date()): Promise<Fila[]> {
  const lineas = lineasDeHtml(html);
  const ventana = ventana15(ahora);

  // 1) Reportes con comuna dentro de la ventana de horas.
  const activos = new Map<string, { empresa: string; serv: string; comuna: string; items: string[] }>();
  lineas.forEach((linea, i) => {
    const m = linea.match(RE_ITEM);
    if (!m) return;
    const edad = lineas.slice(i + 1, i + 6).map(edadMin).find((e) => e !== null);
    if (edad == null || edad > VENTANA_HORAS * 60) return;
    const empresa = operador(m[1]) ?? "Otro";
    const serv = servicio(m[1]);
    const k = `${empresa}|${serv}|${m[2].trim()}`;
    const a = activos.get(k) ?? { empresa, serv, comuna: m[2].trim(), items: [] };
    a.items.push(linea);
    activos.set(k, a);
  });

  // 2) Estado declarado por servicio y 3) totales 24 h por operador.
  const estados = new Map<string, string>();
  const totales = new Map<string, number>();
  lineas.forEach((linea, i) => {
    const sig = lineas[i + 1] ?? "";
    const e = linea.match(RE_ESTADO) ?? `${linea} ${sig}`.match(RE_ESTADO);
    if (e) { const op = operador(e[1]); if (op && !estados.has(op)) estados.set(op, e[2]); }
    const c = linea.match(RE_CHIP) ?? (/^\d+$/.test(sig) ? `${linea} ${sig}`.match(RE_CHIP) : null);
    if (c) totales.set(operador(c[1])!, Number(c[2]));
  });

  const filas: Fila[] = [];
  for (const a of activos.values()) {
    const info = COMUNAS[sinTildes(a.comuna)];
    const n = a.items.length;
    const base = {
      fuente: "geoblackout", pais: "CL", empresa: a.empresa, servicio: a.serv,
      comuna: info ? info[0] : a.comuna, region: info ? info[1] : null,
      latitud: info ? info[2] : null, longitud: info ? info[3] : null,
      precision_geo: info ? "comuna" : "sin_geo",
      cantidad_reportes: n, gravedad: gravedadVolumen(n, 1, 5),
      gravedad_texto: `${n} reporte(s) en las últimas ${VENTANA_HORAS} h`,
      url_fuente: url, ventana, raw: { items: a.items.slice(0, 20) },
    };
    filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", base.empresa, base.servicio, base.comuna, ventana]) });
  }
  for (const [empresa, total] of totales) {
    const est = estados.get(empresa);
    const base = {
      fuente: "geoblackout", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
      cantidad_reportes: total, gravedad: gravedadTexto(est) ?? gravedadVolumen(total, 10, 30),
      gravedad_texto: est ?? `${total} reportes en 24 h`, url_fuente: url, ventana, raw: { total_24h: total },
    };
    filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", empresa, "internet", "None", ventana]) });
  }
  return filas.filter((f) => (f.cantidad_reportes as number) > 0 || f.gravedad !== "normal");
}

// ---------- FallaCL ----------
// Mismos umbrales que muestra su web: >=5 "Falla masiva", >=2 "Posibles problemas".
const SERVICIO_FALLACL: Record<string, string> = { isp: "internet", streaming: "streaming", bancos: "banca" };

export function catalogoFallacl(html: string): Map<string, { nombre: string; cat: string }> {
  const m = new Map<string, { nombre: string; cat: string }>();
  for (const x of html.matchAll(/\{id:"([a-z0-9]+)",name:"([^"]+)",cat:"([^"]+)"/g)) m.set(x[1], { nombre: x[2], cat: x[3] });
  return m;
}

type RegionesFallacl = Record<string, { region: string; count: string | number }[]>;

// Por cada servicio con actividad: una fila nacional (reportes recientes, sirve para
// el cruce de fuentes) y una fila por región con los reportes de HOY en esa región
// (/api/reports/regions?service_id=...). Nada se reparte ni se estima: son sus conteos.
export async function parsearFallacl(
  live: { data?: Record<string, { count?: number; last_region?: string; last_ciudad?: string; last_at?: string }> },
  catalogo = new Map<string, { nombre: string; cat: string }>(),
  regiones: RegionesFallacl = {},
  ahora = new Date(),
): Promise<Fila[]> {
  const ventana = ventana15(ahora);
  const filas: Fila[] = [];
  for (const [id, d] of Object.entries(live?.data ?? {})) {
    const n = Number(d?.count ?? 0);
    const info = catalogo.get(id);
    const empresa = info?.nombre ?? id;
    const servicio = SERVICIO_FALLACL[info?.cat ?? ""] ?? info?.cat ?? "otro";
    const activo = n > 0; // tuvo reportes recientes (ventana de su sitio)
    if (activo) {
      const base = {
        fuente: "fallacl", pais: "CL", empresa, servicio, comuna: null, region: null,
        latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
        cantidad_reportes: n, gravedad: gravedadVolumen(n, 2, 5),
        gravedad_texto: `${n} reporte(s) recientes en todo Chile`,
        url_fuente: `${FALLACL_URL}/${id}`, ventana, raw: { id, ...d },
      };
      filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", id, "pais", ventana]) });
    }
    for (const r of regiones[id] ?? []) {
      const reg = regionDe(r.region);
      const c = Number(r.count);
      if (!reg || !(c > 0)) continue;
      const base = {
        fuente: "fallacl", pais: "CL", empresa, servicio, comuna: null, region: reg[0],
        latitud: reg[1], longitud: reg[2], precision_geo: "region",
        cantidad_reportes: c,
        // Solo cuenta como falla si el servicio sigue con reportes recientes.
        gravedad: activo ? gravedadVolumen(c, 2, 5) : "normal",
        gravedad_texto: `${c} reporte(s) hoy en la región ${reg[0]}`,
        url_fuente: `${FALLACL_URL}/${id}`, ventana, raw: { id, region: r.region, count: c },
      };
      filas.push({ ...base, hash_dedup: await hash([base.fuente, "CL", id, reg[0], ventana]) });
    }
  }
  return filas;
}

// ---------- IODA ----------
// Sistemas autónomos (ASN) de cada operador, verificados el 2026-11-09 contra
// /v2/entities/query?entityType=asn&relatedTo=country/CL (campo "org").
const ASN_EMPRESA: Record<string, string> = {
  "7418": "Movistar", "27680": "Movistar", "7004": "Movistar", "52489": "Movistar",
  "22047": "VTR",
  "27651": "Entel", "27925": "Entel", "6471": "Entel",
  "27995": "Claro",
  "14259": "GTD",
  "14117": "Telsur",
  "52341": "WOM",
  "273019": "DIRECTV",
};
const NIVEL_IODA: Record<string, string> = { critical: "falla_masiva", warning: "posibles_problemas" };
const FUENTE_IODA: Record<string, string> = {
  "bgp": "rutas BGP", "ping-slash24": "ping a redes /24", "merit-nt": "telescopio de red", "gtr": "tráfico a Google",
};

type AlertaIoda = {
  level: string; time: number; datasource: string; value: number; historyValue: number; condition?: string;
  entity: { code: string; type: string; name: string; attrs?: Record<string, string> };
};

export function regionDe(nombre?: string | null) {
  if (!nombre) return undefined;
  const n = sinTildes(nombre).replace(/^region (de |del )?/, "");
  if (REGIONES[n]) return REGIONES[n];
  const clave = Object.keys(REGIONES).sort((a, b) => b.length - a.length).find((k) => n.includes(k));
  return clave ? REGIONES[clave] : undefined;
}

// Por entidad, la alerta más reciente. Si es "normal", la caída ya terminó.
function vigentes(alertas: AlertaIoda[]) {
  const ult = new Map<string, AlertaIoda>();
  for (const a of alertas) {
    const k = `${a.entity.type}|${a.entity.code}|${a.datasource}`;
    if (!ult.has(k) || ult.get(k)!.time < a.time) ult.set(k, a);
  }
  return [...ult.values()].filter((a) => NIVEL_IODA[a.level]);
}

function textoIoda(a: AlertaIoda) {
  const caida = a.historyValue > 0 ? Math.round((1 - a.value / a.historyValue) * 100) : null;
  const hora = new Date(a.time * 1000).toISOString().slice(11, 16);
  return `IODA ${a.level === "critical" ? "crítico" : "alerta"}: ${FUENTE_IODA[a.datasource] ?? a.datasource}` +
    (caida != null && caida > 0 ? ` ${caida}% bajo lo normal` : "") + ` (${a.value} vs ${a.historyValue}) desde ${hora} UTC`;
}

export async function parsearIoda(alertas: AlertaIoda[], ahora = new Date()): Promise<Fila[]> {
  const ventana = ventana15(ahora);
  const peor = (x: string, y: string) => (x === "falla_masiva" || y === "falla_masiva" ? "falla_masiva" : "posibles_problemas");
  const porEmpresa = new Map<string, { gravedad: string; alertas: AlertaIoda[] }>();
  const filas: Fila[] = [];
  for (const a of vigentes(alertas)) {
    const g = NIVEL_IODA[a.level];
    if (a.entity.type === "asn") {
      const empresa = ASN_EMPRESA[a.entity.code];
      if (!empresa) continue; // solo operadores que seguimos
      const e = porEmpresa.get(empresa) ?? { gravedad: g, alertas: [] };
      e.gravedad = peor(e.gravedad, g);
      e.alertas.push(a);
      porEmpresa.set(empresa, e);
    } else if (a.entity.type === "region" || a.entity.type === "country") {
      const reg = a.entity.type === "region" ? regionDe(a.entity.name) : undefined;
      if (a.entity.type === "region" && !reg) continue;
      const base = {
        fuente: "ioda", pais: "CL", empresa: "Red completa", servicio: "internet",
        comuna: null, region: reg ? reg[0] : null,
        latitud: reg ? reg[1] : CENTRO_PAIS[0], longitud: reg ? reg[2] : CENTRO_PAIS[1],
        precision_geo: reg ? "region" : "pais", cantidad_reportes: null, gravedad: g,
        gravedad_texto: textoIoda(a), url_fuente: `https://ioda.inetintel.cc.gatech.edu/${a.entity.type}/${a.entity.code}`,
        ventana, raw: a,
      };
      filas.push({ ...base, hash_dedup: await hash(["ioda", a.entity.type, a.entity.code, a.datasource, ventana]) });
    }
  }
  for (const [empresa, e] of porEmpresa) {
    const a = e.alertas.sort((x, y) => y.time - x.time)[0];
    const base = {
      fuente: "ioda", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
      cantidad_reportes: null, gravedad: e.gravedad,
      gravedad_texto: `${textoIoda(a)} · AS${e.alertas.map((x) => x.entity.code).join(", AS")}`,
      url_fuente: `https://ioda.inetintel.cc.gatech.edu/asn/${a.entity.code}`,
      ventana, raw: { alertas: e.alertas },
    };
    filas.push({ ...base, hash_dedup: await hash(["ioda", "asn", empresa, ventana]) });
  }
  return filas;
}

// ---------- Blackout Map ----------
const PROVEEDORES_BM: Record<string, string> = {
  "movistar-chile": "Movistar", "entel-chile": "Entel", "vtr": "VTR", "mundo": "Mundo", "wom-chile": "WOM",
};

// Lee "12 of 12 test points inside X's network answer" y "0 people reported a problem in the last hour".
export function leerProveedorBM(html: string) {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&#0?39;|&#x27;/g, "'").replace(/\s+/g, " ");
  const p = t.match(/(\d+) of (\d+) test points inside/);
  const r = t.match(/(\d+) (?:people|person) reported a problem in the last hour/);
  if (!p) return null;
  return { arriba: Number(p[1]), total: Number(p[2]), reportes: r ? Number(r[1]) : null };
}

export function gravedadBM(arriba: number, total: number, reportes: number | null) {
  const frac = total > 0 ? arriba / total : 1;
  if (frac < 0.5) return "falla_masiva";
  if (frac < 0.9 || (reportes ?? 0) >= 5) return "posibles_problemas";
  return "normal";
}

export async function filaProveedorBM(slug: string, html: string, ahora = new Date()): Promise<Fila | null> {
  const d = leerProveedorBM(html);
  const empresa = PROVEEDORES_BM[slug];
  if (!d || !empresa) return null;
  const ventana = ventana15(ahora);
  const base = {
    fuente: "blackoutmap", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
    latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais",
    cantidad_reportes: d.reportes, gravedad: gravedadBM(d.arriba, d.total, d.reportes),
    gravedad_texto: `${d.arriba} de ${d.total} puntos de prueba en la red responden` +
      (d.reportes != null ? ` · ${d.reportes} reporte(s) en la última hora` : ""),
    url_fuente: `${BLACKOUT_URL}/providers/${slug}`, ventana, raw: { slug, ...d },
  };
  return { ...base, hash_dedup: await hash(["blackoutmap", slug, ventana]) };
}

const NIVEL_BM: Record<string, string> = { blackout: "falla_masiva", partial: "falla_masiva", degraded: "posibles_problemas" };

export async function filasRegionesBM(status: { regions?: { cc: string; region: string; s: string; up: number; n: number; since?: string }[] }, ahora = new Date()) {
  const ventana = ventana15(ahora);
  const filas: Fila[] = [];
  for (const r of status?.regions ?? []) {
    if (r.cc !== "CL" || !NIVEL_BM[r.s]) continue;
    const reg = regionDe(r.region);
    if (!reg) continue;
    const base = {
      fuente: "blackoutmap", pais: "CL", empresa: "Red completa", servicio: "internet", comuna: null, region: reg[0],
      latitud: reg[1], longitud: reg[2], precision_geo: "region", cantidad_reportes: null, gravedad: NIVEL_BM[r.s],
      gravedad_texto: `Blackout Map: ${r.up} de ${r.n} sondas responden (${r.s})` + (r.since ? ` desde ${r.since.slice(11, 16)} UTC` : ""),
      url_fuente: `${BLACKOUT_URL}/country/chile`, ventana, raw: r,
    };
    filas.push({ ...base, hash_dedup: await hash(["blackoutmap", "region", r.region, ventana]) });
  }
  return filas;
}

// ── SEC: clientes sin luz por comuna (Superintendencia de Electricidad y Combustibles) ──
// apps.sec.cl/INTONLINEv1 (sin robots.txt; es la API que usa su propia página). Datos por hora, en hora de Chile,
// cargados por las distribuidoras. Se guardan en la tabla cortes_luz (sql/009), no en reportes_caidas.
const SEC_API = "https://apps.sec.cl/INTONLINEv1/ClientesAfectados";
const SEC_MIN_CLIENTES = 10; // menos que esto es ruido (un poste, un empalme)
type HoraSec = { anho: number; mes: number; dia: number; hora: number; clientes_afectados: number };
type ComunaSec = { NOMBRE_COMUNA: string; NOMBRE_REGION: string; CLIENTES_AFECTADOS: number };

// La SEC da la hora local de Chile; la pasamos a UTC con el desfase real de esa fecha.
export function horaSecUTC(h: HoraSec): string {
  const local = Date.UTC(h.anho, h.mes - 1, h.dia, h.hora);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  let utc = local + 4 * 3600_000; // primer intento: UTC-4
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    const visto = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24);
    utc += local - visto;
  }
  return new Date(utc).toISOString();
}

export function parsearSec(hora: HoraSec, comunas: ComunaSec[]) {
  const hora_sec = horaSecUTC(hora);
  const filas = [];
  for (const c of comunas) {
    if (!(c.CLIENTES_AFECTADOS >= SEC_MIN_CLIENTES)) continue;
    const info = buscarComuna(c.NOMBRE_COMUNA);
    filas.push({
      hora_sec, comuna: info ? info[0] : c.NOMBRE_COMUNA, region: info ? info[1] : c.NOMBRE_REGION,
      latitud: info ? info[2] : null, longitud: info ? info[3] : null, clientes: c.CLIENTES_AFECTADOS,
    });
  }
  return filas;
}

async function secPost<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${SEC_API}/${ruta}`, {
    method: "POST", headers: { ...cabeceras("application/json"), "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
  return r.json();
}

// Guarda la última hora publicada por la SEC (si ya estaba, la base la ignora).
async function guardarSec(): Promise<string | number> {
  const serie = await secPost<HoraSec[]>("Get", {});
  const ult = serie.at(-1);
  if (!ult) throw new Error("SEC sin datos");
  await pausa(500);
  const filas = parsearSec(ult, await secPost<ComunaSec[]>("GetPorFecha", { anho: ult.anho, mes: ult.mes, dia: ult.dia, hora: ult.hora }));
  if (!filas.length) return 0;
  const nuevas = await rest("cortes_luz?on_conflict=hora_sec,comuna", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(filas),
  });
  return nuevas.length;
}

// ── RIPE Atlas (RIPE NCC): sondas físicas instaladas en casas y oficinas de Chile ──
// Datos públicos y gratuitos. Una sonda que pasó a "Disconnected" hace poco es una señal
// de corte en esa red; una sola puede ser alguien que la desenchufó, por eso se exigen varias.
type SondaAtlas = { id: number; asn_v4: number | null; status?: { name?: string }; status_since?: number; geometry?: { coordinates?: [number, number] } };

function regionMasCercana(lat: number, lon: number): [string, number, number] | null {
  let mejor: [string, number, number] | null = null, d0 = Infinity;
  for (const r of new Set(Object.values(REGIONES))) {
    const d = (r[1] - lat) ** 2 + ((r[2] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < d0) { d0 = d; mejor = r; }
  }
  return mejor;
}

export async function parsearAtlas(sondas: SondaAtlas[], ahora = new Date()): Promise<Fila[]> {
  const t = ahora.getTime() / 1000;
  const ventana = ventana15(ahora);
  const porEmpresa = new Map<string, { conectadas: number; caidas: SondaAtlas[] }>();
  for (const s of sondas) {
    const empresa = s.asn_v4 != null ? ASN_EMPRESA[String(s.asn_v4)] : undefined;
    if (!empresa) continue;
    const estado = s.status?.name;
    const reciente = s.status_since != null && t - s.status_since < ATLAS_CAIDA_H * 3600;
    if (estado !== "Connected" && !(estado === "Disconnected" && reciente)) continue; // abandonadas o caídas antiguas no cuentan
    const e = porEmpresa.get(empresa) ?? { conectadas: 0, caidas: [] };
    if (estado === "Connected") e.conectadas++; else e.caidas.push(s);
    porEmpresa.set(empresa, e);
  }
  const filas: Fila[] = [];
  for (const [empresa, e] of porEmpresa) {
    const total = e.conectadas + e.caidas.length;
    const n = e.caidas.length;
    const gravedad = n >= 3 && n / total >= 0.25 ? "falla_masiva" : n >= 2 ? "posibles_problemas" : "normal";
    const regiones = new Map<string, { reg: [string, number, number]; n: number }>();
    for (const s of e.caidas) {
      const c = s.geometry?.coordinates;
      const reg = c ? regionMasCercana(c[1], c[0]) : null;
      if (reg) regiones.set(reg[0], { reg, n: (regiones.get(reg[0])?.n ?? 0) + 1 });
    }
    const dondeTxt = regiones.size ? ` (${[...regiones.values()].map((r) => `${r.reg[0]} ${r.n}`).join(", ")})` : "";
    const base = {
      fuente: "atlas", pais: "CL", empresa, servicio: "internet", comuna: null, region: null,
      latitud: CENTRO_PAIS[0], longitud: CENTRO_PAIS[1], precision_geo: "pais", cantidad_reportes: null, gravedad,
      gravedad_texto: `${n} de ${total} sondas RIPE Atlas en la red de ${empresa} se desconectaron en las últimas ${ATLAS_CAIDA_H} h${dondeTxt}`,
      url_fuente: "https://atlas.ripe.net/probes/?country_code=CL", ventana, raw: { conectadas: e.conectadas, caidas: n, total, ids: e.caidas.map((s) => s.id) },
    };
    filas.push({ ...base, hash_dedup: await hash(["atlas", empresa, ventana]) });
    // Por región, solo si en esa región cayeron 2 o más sondas de la misma empresa.
    for (const { reg, n: nr } of regiones.values()) {
      if (nr < 2) continue;
      const fr = {
        ...base, region: reg[0], latitud: reg[1], longitud: reg[2], precision_geo: "region",
        gravedad: gravedad === "normal" ? "posibles_problemas" : gravedad,
        gravedad_texto: `${nr} sondas RIPE Atlas de ${empresa} se desconectaron en ${reg[0]} en las últimas ${ATLAS_CAIDA_H} h`,
      };
      filas.push({ ...fr, hash_dedup: await hash(["atlas", empresa, reg[0], ventana]) });
    }
  }
  return filas;
}

async function filasAtlas(): Promise<Fila[]> {
  const r = await fetch(`${ATLAS_API}/probes/?country_code=CL&page_size=500&fields=id,asn_v4,status,status_since,geometry`, { headers: cabeceras("application/json") });
  if (!r.ok) throw new Error(`RIPE Atlas HTTP ${r.status}`);
  return parsearAtlas((await r.json()).results ?? []);
}

async function rest(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 ? [] : r.json();
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cabeceras(accept: string) {
  return {
    "User-Agent": `${USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]} ${CONTACTO}`,
    "Accept-Language": "es-CL,es;q=0.9",
    Accept: accept,
  };
}

async function filasGeoblackout(): Promise<Fila[]> {
  const r = await fetch(FUENTE_URL, { headers: cabeceras("text/html") });
  const html = await r.text();
  if (!r.ok || /cf-chl|challenge-platform/i.test(html.slice(0, 20000))) {
    throw new Error(`Geoblackout respondió ${r.status} o con desafío anti-bot; se omite`);
  }
  return parsear(html);
}

async function filasFallacl(): Promise<Fila[]> {
  const r = await fetch(`${FALLACL_URL}/api/reports/live`, { headers: cabeceras("application/json") });
  if (!r.ok) throw new Error(`FallaCL respondió ${r.status}`);
  const live = await r.json();
  let catalogo = new Map<string, { nombre: string; cat: string }>();
  try {
    const h = await fetch(FALLACL_URL, { headers: cabeceras("text/html") });
    if (h.ok) catalogo = catalogoFallacl(await h.text());
  } catch { /* sin nombres bonitos: se usa el id */ }
  const regiones: RegionesFallacl = {};
  for (const id of Object.keys(live?.data ?? {})) {
    try {
      const rr = await fetch(`${FALLACL_URL}/api/reports/regions?service_id=${encodeURIComponent(id)}`, { headers: cabeceras("application/json") });
      if (rr.ok) regiones[id] = (await rr.json()).regions ?? [];
    } catch { /* esa región queda sin desglose */ }
    await pausa(300);
  }
  return parsearFallacl(live, catalogo, regiones);
}

async function filasIoda(): Promise<Fila[]> {
  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - IODA_VENTANA_H * 3600;
  const q = (extra: string) => `${IODA_API}/outages/alerts?from=${desde}&until=${hasta}&limit=2000&${extra}`;
  const consultas = ["entityType=asn&relatedTo=country/CL", "entityType=region&relatedTo=country/CL", "entityType=country&entityCode=CL"];
  const alertas: AlertaIoda[] = [];
  for (const c of consultas) {
    const r = await fetch(q(c), { headers: cabeceras("application/json") });
    if (!r.ok) throw new Error(`IODA respondió ${r.status}`);
    const j = await r.json();
    alertas.push(...(j.data ?? []));
  }
  return parsearIoda(alertas);
}

async function filasBlackoutMap(): Promise<Fila[]> {
  // Desde 2026-11-09 las páginas /providers/ responden 403 a robots: lo respetamos y ya no las pedimos.
  // Solo se usa /data/status.json (sigue abierto), que trae las caídas medidas por región.
  const st = await fetch(`${BLACKOUT_URL}/data/status.json`, { headers: cabeceras("application/json") });
  if (!st.ok) { await st.body?.cancel(); throw new Error(`Blackout Map status.json HTTP ${st.status}`); }
  const filas: Fila[] = await filasRegionesBM(await st.json());
  return filas;
}

async function corrida(): Promise<Record<string, unknown>> {
  // Freno: si hubo una captura hace menos de 10 min, no volvemos a pedir las páginas.
  const ult = await rest("reportes_caidas?select=capturado_en&order=capturado_en.desc&limit=1");
  if (ult[0] && Date.now() - Date.parse(ult[0].capturado_en) < MIN_ENTRE_CORRIDAS_MIN * 60_000) {
    return { omitido: "corrida reciente", ultima: ult[0].capturado_en };
  }
  const res: Record<string, unknown> = {};
  const filas: Fila[] = [];
  // Cada fuente va por separado: si una falla, la otra igual se guarda.
  // Las fuentes se piden en paralelo (son sitios distintos) y cada una tiene su propio tiempo máximo.
  const fuentes = [["geoblackout", filasGeoblackout], ["fallacl", filasFallacl], ["ioda", filasIoda], ["blackoutmap", filasBlackoutMap], ["atlas", filasAtlas]] as const;
  const [resultados, sec] = await Promise.all([
    Promise.allSettled(fuentes.map(([, fn]) => fn())),
    guardarSec().catch((e) => `error: ${e instanceof Error ? e.message : e}`),
  ]);
  resultados.forEach((r, i) => {
    const nombre = fuentes[i][0];
    if (r.status === "fulfilled") { filas.push(...r.value); res[nombre] = r.value.length; }
    else res[nombre] = `error: ${r.reason instanceof Error ? r.reason.message : r.reason}`;
  });
  res.sec = sec;
  if (!filas.length) return { ...res, insertadas: 0, nota: "sin datos nuevos" };
  const nuevas = await rest("reportes_caidas?on_conflict=hash_dedup", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(filas),
  });
  return {
    ...res,
    enviadas: filas.length,
    insertadas: nuevas.length,
    con_ubicacion: filas.filter((f) => f.precision_geo === "comuna" || f.precision_geo === "region").length,
  };
}

if (Deno.env.get("SUPABASE_URL")) {
  Deno.serve(async (req) => {
    // Solo pg_cron conoce este token (ver sql/003_cron_scraper.sql).
    const token = Deno.env.get("OCN_CRON_TOKEN") ?? TOKEN_POR_DEFECTO;
    if (req.headers.get("x-ocn-token") !== token) return new Response("no autorizado", { status: 401 });
    try {
      const res = await corrida();
      console.log(JSON.stringify(res));
      return Response.json(res);
    } catch (e) {
      console.error(e);
      return Response.json({ error: String(e) }, { status: 500 });
    }
  });
}
