import { createReadStream, writeFileSync, existsSync } from "fs";
import { createInterface } from "readline";

const EDUBASE_URL = d => `https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata${d}.csv`;
const OFSTED_URL = "https://assets.publishing.service.gov.uk/media/6a54efeba6586e258d371d9c/Management_information_-_state-funded_schools_-_latest_inspections_as_at_30_June_2026.csv";
const OFSTED_CSV = "/tmp/ofsted.csv";
const EDUBASE_CSV = "/tmp/edubase.csv";
const BBOX = { minLat: 53.25, maxLat: 53.60, minLng: -3.35, maxLng: -2.75 };

async function download(url, path) {
  if (existsSync(path)) { console.log(`cached: ${path}`); return; }
  console.log(`downloading ${url}…`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}
await download(EDUBASE_URL(new Date().toISOString().slice(0, 10).replace(/-/g, "")), EDUBASE_CSV).catch(async () => {
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  await download(EDUBASE_URL(y), EDUBASE_CSV);
});
await download(OFSTED_URL, OFSTED_CSV);

// OSGB36 easting/northing -> WGS84 lat/lng (Helmert transform, standard algorithm)
function osgbToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + 5 / 4 * n ** 2 + 5 / 4 * n ** 3) * (lat - lat0);
    const Mb = (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = 35 / 24 * n ** 3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat ** 2);
  const rho = a * F0 * (1 - e2) / (1 - e2 * sinLat ** 2) ** 1.5;
  const eta2 = nu / rho - 1, tanLat = Math.tan(lat);
  const secLat = 1 / cosLat;
  const VII = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu ** 3) * (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2);
  const IX = tanLat / (720 * rho * nu ** 5) * (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4);
  const X = secLat / nu;
  const XI = secLat / (6 * nu ** 3) * (nu / rho + 2 * tanLat ** 2);
  const XII = secLat / (120 * nu ** 5) * (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4);
  const XIIA = secLat / (5040 * nu ** 7) * (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6);
  const dE = E - E0;
  const latAiry = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lonAiry = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  // Airy 1830 -> WGS84 via Helmert
  const h = 0;
  const airyA = 6377563.396, airyB = 6356256.909;
  const wgsA = 6378137.0, wgsB = 6356752.3141;
  const e2A = 1 - airyB ** 2 / airyA ** 2, e2W = 1 - wgsB ** 2 / wgsA ** 2;
  const nuA = airyA / Math.sqrt(1 - e2A * Math.sin(latAiry) ** 2);
  const x1 = (nuA + h) * Math.cos(latAiry) * Math.cos(lonAiry);
  const y1 = (nuA + h) * Math.cos(latAiry) * Math.sin(lonAiry);
  const z1 = ((1 - e2A) * nuA + h) * Math.sin(latAiry);
  const tx = 446.448, ty = -125.157, tz = 542.060;
  const rx = 0.1502 * Math.PI / (180 * 3600), ry = 0.2470 * Math.PI / (180 * 3600), rz = 0.8421 * Math.PI / (180 * 3600);
  const s = -20.4894e-6;
  const x2 = tx + (1 + s) * x1 + -rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 + -rx * z1;
  const z2 = tz + -ry * x1 + rx * y1 + (1 + s) * z1;
  const p = Math.sqrt(x2 ** 2 + y2 ** 2);
  let lat2 = Math.atan2(z2, p * (1 - e2W)), latPrev;
  let nuW;
  do {
    latPrev = lat2;
    nuW = wgsA / Math.sqrt(1 - e2W * Math.sin(lat2) ** 2);
    lat2 = Math.atan2(z2 + e2W * nuW * Math.sin(lat2), p);
  } while (Math.abs(lat2 - latPrev) > 1e-10);
  const lon2 = Math.atan2(y2, x2);
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

async function* rows(path) {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let hdr = null;
  for await (const line of rl) {
    const cols = parseCsv(line);
    if (!hdr) { hdr = cols; continue; }
    yield Object.fromEntries(hdr.map((h, i) => [h, cols[i] ?? ""]));
  }
}

function parseCsv(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// 1. Ofsted ratings by URN
const NUM_GRADE = { "1": "Outstanding", "2": "Good", "3": "Requires improvement", "4": "Inadequate" };
console.log("loading ofsted…");
const ofsted = new Map();
for await (const r of rows(OFSTED_CSV)) {
  let grade = NUM_GRADE[r["Latest OEIF overall effectiveness"]] || "";
  if (!grade) {
    const ungraded = r["Ungraded inspection overall outcome"] || "";
    const m = ungraded.match(/remains (Outstanding|Good)/i) || ungraded.match(/^(Outstanding|Good)$/i);
    if (m) grade = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }
  if (r["URN"] && grade) ofsted.set(r["URN"], grade);
}
console.log(`ofsted: ${ofsted.size} schools with ratings`);

// 2. Edubase within bbox
console.log("loading edubase…");
const GRADE_MAP = { "Outstanding": 5, "Good": 4, "Requires improvement": 2, "Inadequate": 1 };
const PHASE_MAP = { "Primary": "primary", "Secondary": "secondary", "All-through": "all-through", "Middle deemed secondary": "secondary", "Middle deemed primary": "primary", "16 plus": "sixth-form", "Not applicable": null, "Nursery": "nursery" };

const schools = [];
for await (const r of rows(EDUBASE_CSV)) {
  if (r["EstablishmentStatus (name)"] !== "Open") continue;
  const phase = PHASE_MAP[r["PhaseOfEducation (name)"]];
  if (!phase || phase === "nursery") continue;
  const E = parseFloat(r["Easting"]), N = parseFloat(r["Northing"]);
  if (!E || !N) continue;
  const [lat, lng] = osgbToWgs84(E, N);
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) continue;
  const gradeName = ofsted.get(r["URN"]) || "";
  schools.push({
    name: r["EstablishmentName"],
    phase,
    type: r["TypeOfEstablishment (name)"],
    location: [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6],
    postcode: r["Postcode"],
    pupils: null,
    ofsted: GRADE_MAP[gradeName] || null,
    ofstedLabel: gradeName || "Not yet rated",
    website: r["SchoolWebsite"] || null,
    urn: r["URN"]
  });
}
console.log(`schools in bbox: ${schools.length}`);

writeFileSync("data/liverpool/schools.json", JSON.stringify({ schools }));
console.log("wrote data/liverpool/schools.json");
