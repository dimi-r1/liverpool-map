import { readFileSync, writeFileSync } from "fs";

const COMMUNITY = process.argv[2] || "brazilian";
const FILE = `data/communities/${COMMUNITY}.json`;

const CONFIG = {
  brazilian: {
    bbox: "53.25,-3.35,53.60,-2.75",
    overpass: `(nwr["cuisine"~"brazilian",i](BBOX);nwr["name"~"brazil|brasil",i](BBOX);nwr["name"~"capoeira",i](BBOX););`,
    blacklist: [/elgato negro/i],
    typeOf: tags =>
      tags.amenity === "restaurant" || tags.amenity === "bar" || tags.amenity === "cafe" ? "restaurant" :
      tags.shop ? "shop" :
      tags.amenity === "place_of_worship" ? "church" :
      /capoeira/i.test(tags.name || "") ? "group" : "other"
  }
};

const cfg = CONFIG[COMMUNITY];
if (!cfg) { console.error(`no config for community "${COMMUNITY}"`); process.exit(1); }

const query = `[out:json][timeout:60];${cfg.overpass.replace(/BBOX/g, cfg.bbox)}out center tags;`;
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter"
];

let res;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = MIRRORS[attempt % MIRRORS.length] + "?data=" + encodeURIComponent(query);
  res = await fetch(url, { headers: { "User-Agent": "scouse-compass/1.0 (github.com/dimi-r1/liverpool-map)" } });
  if (res.ok) break;
  console.warn(`attempt ${attempt + 1}: HTTP ${res.status}, retrying…`);
  await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
}
if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
const data = await res.json();

const existing = JSON.parse(readFileSync(FILE));
const curated = existing.spots.filter(s => s.curated !== false && !s.source);

function dist(a, b) {
  const dx = (a[0] - b[0]) * 0.62, dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * 111;
}

const osmSpots = [];
for (const e of data.elements) {
  const tags = e.tags || {};
  const name = tags.name;
  if (!name) continue;
  if (cfg.blacklist.some(re => re.test(name))) continue;
  const isPoi = tags.amenity || tags.shop || tags.leisure || tags.office;
  if (!isPoi) continue;
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null) continue;
  const loc = [lon, lat];
  if (curated.some(c => dist(c.location, loc) < 0.15)) continue;
  if (osmSpots.some(s => dist(s.location, loc) < 0.05)) continue;

  const parts = [tags["addr:street"], tags["addr:postcode"]].filter(Boolean).join(", ");
  osmSpots.push({
    city: "liverpool",
    name,
    type: cfg.typeOf(tags),
    location: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6],
    notes: parts ? `${parts}. Sourced from OpenStreetMap.` : "Sourced from OpenStreetMap.",
    url: tags.website || tags["contact:website"],
    verified: true,
    source: "osm",
    osmId: `${e.type}/${e.id}`
  });
}

const out = { ...existing, spots: [...curated, ...osmSpots] };
writeFileSync(FILE, JSON.stringify(out, null, 2));
console.log(`${COMMUNITY}: ${curated.length} curated + ${osmSpots.length} from OSM = ${out.spots.length} spots`);
