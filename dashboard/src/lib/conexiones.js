// Conexiones fijas a internet por comuna, junio de 2026.
// Fuente: SUBTEL, "Series de conexiones de internet fija" (archivo 1_SERIES_CONEXIONES_INTERNET_FIJA_JUN26_270826-VF.xlsx,
// hoja 7.11 CO_FIJAS_COMUNA, columna junio 2026). La suma de las 345 comunas coincide con el total nacional
// de la misma hoja: 4.904.397 conexiones. Sirve para dar escala: no es lo mismo 20 reportes en una comuna
// de 2.000 hogares conectados que en una de 150.000.
export const FUENTE_CONEXIONES = 'SUBTEL, conexiones fijas a junio de 2026'
export const URL_CONEXIONES = 'https://www.subtel.gob.cl/estudios-y-estadisticas/internet/'

const POR_REGION = {
  "Tarapacá": {"Alto Hospicio":25231,"Camiña":65,"Colchane":157,"Huara":374,"Iquique":64702,"Pica":828,"Pozo Almonte":2965},
  "Antofagasta": {"Antofagasta":121033,"Calama":48010,"María Elena":1797,"Mejillones":3213,"Ollagüe":74,"San Pedro de Atacama":1792,"Sierra Gorda":961,"Taltal":3321,"Tocopilla":6793},
  "Atacama": {"Alto Del Carmen":248,"Caldera":5264,"Chañaral":2534,"Copiapó":46441,"Diego de Almagro":2514,"Freirina":402,"Huasco":1654,"Tierra Amarilla":2386,"Vallenar":14239},
  "Coquimbo": {"Andacollo":1763,"Canela":1227,"Combarbalá":1482,"Coquimbo":75055,"Illapel":5407,"La Higuera":478,"La Serena":81410,"Los Vilos":6007,"Monte Patria":2417,"Ovalle":21590,"Paihuano":209,"Punitaqui":1301,"Río Hurtado":186,"Salamanca":2361,"Vicuña":3295},
  "Valparaíso": {"Algarrobo":8951,"Cabildo":2592,"Calera":13396,"Calle Larga":4448,"Cartagena":7166,"Casablanca":6291,"Catemu":1958,"Concón":20623,"El Quisco":8708,"El Tabo":7061,"Hijuelas":3906,"Isla de Pascua":2673,"Juan Fernández":241,"La Cruz":7470,"La Ligua":8068,"Limache":14901,"Llaillay":5943,"Los Andes":22450,"Nogales":4612,"Olmué":4735,"Panquehue":1692,"Papudo":2755,"Petorca":375,"Puchuncaví":8824,"Putaendo":2834,"Quillota":27393,"Quilpué":55662,"Quintero":9370,"Rinconada":3044,"San Antonio":25236,"San Esteban":4196,"San Felipe":21552,"Santa María":2826,"Santo Domingo":5173,"Valparaíso":88564,"Villa Alemana":51817,"Viña del Mar":126457,"Zapallar":3423},
  "O'Higgins": {"Chépica":1118,"Chimbarongo":3667,"Codegua":1806,"Coinco":1553,"Coltauco":3793,"Doñihue":4443,"Graneros":9082,"La Estrella":616,"Las Cabras":2265,"Litueche":1299,"Lolol":674,"Machalí":17999,"Malloa":1304,"Marchihue":677,"Mostazal":4793,"Nancagua":2480,"Navidad":2266,"Olivar":2612,"Palmilla":543,"Paredones":290,"Peralillo":937,"Peumo":1525,"Pichidegua":1834,"Pichilemu":5979,"Placilla":347,"Pumanque":157,"Quinta de Tilcoco":2355,"Rancagua":78084,"Rengo":15287,"Requinoa":4411,"San Fernando":18659,"San Vicente":6561,"Santa Cruz":7234},
  "Maule": {"Cauquenes":9732,"Chanco":432,"Colbún":1605,"Constitución":8172,"Curepto":403,"Curicó":47519,"Empedrado":289,"Hualañé":939,"Licantén":1493,"Linares":20262,"Longaví":4307,"Maule":10104,"Molina":6141,"Parral":11910,"Pelarco":418,"Pelluhue":1812,"Pencahue":602,"Rauco":1339,"Retiro":3722,"Río Claro":892,"Romeral":3061,"Sagrada Familia":309,"San Clemente":5496,"San Javier":5663,"San Rafael":776,"Talca":68294,"Teno":2557,"Vichuquén":822,"Villa Alegre":1452,"Yerbas Buenas":1838},
  "Biobío": {"Alto Biobío":423,"Antuco":206,"Arauco":8672,"Cabrero":5743,"Cañete":5569,"Chiguayante":26965,"Concepción":100262,"Contulmo":1116,"Coronel":38651,"Curanilahue":8307,"Florida":1582,"Hualpén":28970,"Hualqui":6704,"Laja":4278,"Lebu":6552,"Los Alamos":4932,"Los Angeles":60498,"Lota":11483,"Mulchén":5073,"Nacimiento":5767,"Negrete":892,"Penco":13125,"Quilaco":583,"Quilleco":207,"San Pedro de la Paz":52403,"San Rosendo":540,"Santa Bárbara":2131,"Santa Juana":3413,"Talcahuano":47611,"Tirúa":446,"Tomé":18301,"Tucapel":3089,"Yumbel":3659},
  "Araucanía": {"Angol":14609,"Carahue":1886,"Cholchol":827,"Collipulli":4313,"Cunco":3059,"Curacautín":3900,"Curarrehue":417,"Ercilla":1004,"Freire":2810,"Galvarino":865,"Gorbea":1924,"Lautaro":8187,"Loncoche":4920,"Lonquimay":392,"Los Sauces":1084,"Lumaco":417,"Melipeuco":303,"Nueva Imperial":4812,"Padre Las Casas":11763,"Perquenco":868,"Pitrufquén":7994,"Pucón":8008,"Purén":1767,"Renaico":1363,"Saavedra":630,"Temuco":98763,"Teodoro Schmidt":1411,"Toltén":1320,"Traiguén":3258,"Victoria":9447,"Vilcún":4001,"Villarrica":17725},
  "Los Lagos": {"Ancud":7788,"Calbuco":5408,"Castro":10408,"Chaitén":914,"Chonchi":1748,"Cochamó":563,"Curaco de Vélez":256,"Dalcahue":1714,"Fresia":1341,"Frutillar":4931,"Futaleufú":875,"Hualaihue":785,"Llanquihue":4049,"Los Muermos":1669,"Maullín":1562,"Osorno":46212,"Palena":473,"Puerto Montt":68838,"Puerto Octay":1083,"Puerto Varas":14722,"Puqueldón":207,"Purranque":3521,"Puyehue":1604,"Queilén":534,"Quellón":3675,"Quemchi":830,"Quinchao":632,"Río Negro":1996,"San Juan de la Costa":244,"San Pablo":1606},
  "Aysén": {"Aisén":5748,"Chile Chico":845,"Cisnes":1638,"Cochrane":835,"Coyhaique":15785,"Guaitecas":345,"Lago Verde":189,"O'Higgins":272,"Río Ibáñez":581,"Tortel":56},
  "Magallanes": {"Cabo de Hornos":447,"Laguna Blanca":44,"Natales":8988,"Porvenir":2167,"Primavera":111,"Punta Arenas":44813,"Río Verde":86,"San Gregorio":129,"Timaukel":69,"Torres del Paine":202},
  "Metropolitana": {"Alhué":2768,"Buin":21829,"Calera de Tango":4046,"Cerrillos":23924,"Cerro Navia":28935,"Colina":41205,"Conchalí":30612,"Curacaví":4425,"El Bosque":38115,"El Monte":6769,"Estación Central":54990,"Huechuraba":28730,"Independencia":33736,"Isla de Maipo":6569,"La Cisterna":35862,"La Florida":121607,"La Granja":25489,"La Pintana":16583,"La Reina":29657,"Lampa":23878,"Las Condes":126218,"Lo Barnechea":31399,"Lo Espejo":15628,"Lo Prado":22468,"Macul":42651,"Maipú":149054,"María Pinto":3291,"Melipilla":20068,"Ñuñoa":109235,"Padre Hurtado":23070,"Paine":8408,"Pedro Aguirre Cerda":23278,"Peñaflor":24193,"Peñalolén":57580,"Pirque":4436,"Providencia":75627,"Pudahuel":59738,"Puente Alto":144125,"Quilicura":51205,"Quinta Normal":35971,"Recoleta":39160,"Renca":34589,"San Bernardo":69855,"San Joaquín":26802,"San José de Maipo":2178,"San Miguel":55879,"San Pedro":634,"San Ramón":15052,"Santiago":182688,"Talagante":15978,"Til Til":3686,"Vitacura":37041},
  "Los Ríos": {"Corral":506,"Futrono":1703,"La Unión":9018,"Lago Ranco":951,"Lanco":2776,"Los Lagos":2559,"Mafil":1193,"Mariquina":3983,"Paillaco":3064,"Panguipulli":5302,"Río Bueno":5783,"Valdivia":50119},
  "Arica y Parinacota": {"Arica":59011,"Camarones":78,"General Lagos":1128,"Putre":129},
  "Ñuble": {"Bulnes":3760,"Chillán":56979,"Chillán Viejo":10946,"Cobquecura":839,"Coelemu":2827,"Coihueco":1568,"El Carmen":674,"Ninhue":374,"Ñiquén":370,"Pemuco":914,"Pinto":2458,"Portezuelo":330,"Quillón":3284,"Quirihue":990,"Ranquil":686,"San Carlos":9959,"San Fabián":714,"San Ignacio":1265,"San Nicolás":663,"Treguaco":464,"Yungay":2795},
}

const sinTilde = (t) => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const COMUNAS = new Map()
const REGIONES = new Map()
for (const [region, comunas] of Object.entries(POR_REGION)) {
  let total = 0
  for (const [comuna, n] of Object.entries(comunas)) { COMUNAS.set(sinTilde(comuna), { comuna, region, n }); total += n }
  REGIONES.set(sinTilde(region), { region, n: total })
}
// Nombres que las fuentes escriben distinto a SUBTEL.
const ALIAS = { 'aysen': 'aisen', 'puerto aysen': 'aisen', 'puerto natales': 'natales', 'tiltil': 'til til', 'llay-llay': 'llaillay', 'la calera': 'calera', 'marchigue': 'marchihue', 'trehuaco': 'treguaco', 'hualaihue': 'hualaihue' }

export function conexionesComuna(nombre) {
  const k = sinTilde(nombre)
  return COMUNAS.get(k) ?? COMUNAS.get(ALIAS[k]) ?? null
}
export function conexionesRegion(nombre) {
  const k = sinTilde(nombre).replace(/^region (de |del )?/, '').replace(/^la araucania$/, 'araucania').replace(/^region metropolitana.*$/, 'metropolitana')
  return REGIONES.get(k) ?? null
}
// Reportes por cada 10.000 conexiones fijas, con un decimal. null si no hay base.
export function tasaPor10mil(reportes, conexiones) {
  if (!conexiones || !Number.isFinite(reportes)) return null
  return Math.round((reportes / conexiones) * 100_000) / 10
}

export const TOTAL_PAIS = [...REGIONES.values()].reduce((a, r) => a + r.n, 0)

// Escala de un punto del mapa: comuna (si el punto es una comuna) o región.
export function escalaDePunto(p, nivel) {
  if ((p?.pais ?? 'CL') !== 'CL') return null
  const esRegion = nivel === 'region' || !p.subtitulo || p.titulo === p.subtitulo
  const b = esRegion ? conexionesRegion(p.titulo) : conexionesComuna(p.titulo)
  if (!b) return null
  return { lugar: b.comuna ?? `región ${b.region}`, n: b.n, tasa: tasaPor10mil(p.total, b.n) }
}

// Hogares conectados en la zona de una caída: suma de las comunas con reportes; si no hay comunas, las regiones;
// si la falla es nacional, el país.
export function escalaDeZona(comunas = [], regiones = [], nacional = false) {
  if (nacional) return { n: TOTAL_PAIS, texto: 'en todo Chile' }
  const cs = [...new Set(comunas.map(conexionesComuna).filter(Boolean))]
  if (cs.length) return { n: cs.reduce((a, c) => a + c.n, 0), texto: cs.length === 1 ? `en ${cs[0].comuna}` : `en las ${cs.length} comunas con reportes` }
  const rs = [...new Set(regiones.map(conexionesRegion).filter(Boolean))]
  if (rs.length) return { n: rs.reduce((a, r) => a + r.n, 0), texto: rs.length === 1 ? `en la región ${rs[0].region}` : `en las ${rs.length} regiones con reportes` }
  return null
}
