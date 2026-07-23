import { readFileSync, writeFileSync } from "fs";

const TMP = "/var/folders/hc/88xpksn551gdwymr86ps7vp80000gn/T/opencode/pc";
const l = JSON.parse(readFileSync(`${TMP}/L.geojson`));
const ch = JSON.parse(readFileSync(`${TMP}/CH.geojson`));
const curated = JSON.parse(readFileSync("data/liverpool/areas.json"));

const polys = new Map();
for (const f of [...l.features, ...ch.features]) polys.set(f.properties.name, f.geometry);

const round = n => Math.round(n * 1e5) / 1e5;
const roundRing = ring => ring.map(([x, y]) => [round(x), round(y)]);
function roundGeom(g) {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(roundRing) };
  if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.coordinates.map(p => p.map(roundRing)) };
  return g;
}

const missing = [];
const features = curated.features.map(a => {
  const geom = polys.get(a.postcode);
  if (!geom) { missing.push(a.postcode); return null; }
  return { type: "Feature", properties: { ...a }, geometry: roundGeom(geom) };
}).filter(Boolean);

if (missing.length) console.warn("missing polygons:", missing.join(", "));

const out = { type: "FeatureCollection", features };
writeFileSync("data/liverpool/areas.geojson", JSON.stringify(out));
console.log(`wrote ${features.length} features, ${(JSON.stringify(out).length / 1024).toFixed(0)}KB`);
