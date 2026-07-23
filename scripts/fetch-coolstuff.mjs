import { readFileSync, writeFileSync } from "fs";

const BBOX = "53.25,-3.35,53.60,-2.75";

const QUERIES = {
  park: `nwr["leisure"="park"]["name"](BBOX);`,
  beach: `nwr["natural"="beach"]["name"](BBOX);`,
  swim: `nwr["leisure"="swimming_pool"]["name"](BBOX);`,
  gym: `nwr["leisure"="fitness_centre"]["name"](BBOX);`,
  attraction: `nwr["tourism"~"attraction|museum|gallery|viewpoint"]["name"](BBOX);`,
  stadium: `nwr["leisure"="stadium"]["name"](BBOX);`,
  nature: `nwr["leisure"="nature_reserve"]["name"](BBOX);`,
  marina: `nwr["leisure"="marina"]["name"](BBOX);`,
  golf: `nwr["leisure"="golf_course"]["name"](BBOX);`,
  watersports: `nwr["sport"~"swimming|sailing|rowing|kayaking|canoeing|windsurfing|paddleboarding",i]["name"](BBOX);`
};

const CURATED = [
  { name: "Princes parkrun", type: "parkrun", location: [-2.9642, 53.3883], notes: "Free timed 5k every Saturday 9am, Princes Park (L8). The friendliest way to meet people as a newcomer." },
  { name: "Sefton Park parkrun", type: "parkrun", location: [-2.9380, 53.3810], notes: "Free timed 5k every Saturday 9am, Sefton Park (L17). Huge post-run coffee scene at Lark Lane." },
  { name: "Croxteth Hall parkrun", type: "parkrun", location: [-2.9050, 53.4400], notes: "Free timed 5k every Saturday 9am through Croxteth country park." },
  { name: "Birkenhead parkrun", type: "parkrun", location: [-3.0400, 53.3930], notes: "Free timed 5k every Saturday 9am in Birkenhead Park — the park that inspired Central Park, NYC." },
  { name: "New Brighton parkrun", type: "parkrun", location: [-3.0350, 53.4420], notes: "Free timed 5k every Saturday 9am along the Marine Lake / promenade. Flat and fast." },
  { name: "Liverpool Running Club", type: "club", location: [-2.984, 53.404], notes: "Big social running club, multiple weekly sessions from the city centre. All paces welcome.", url: "https://www.liverpoolrunningclub.co.uk" },
  { name: "Penny Lane Striders", type: "club", location: [-2.920, 53.390], notes: "Friendly south-Liverpool running club, runs from the Penny Lane / Wavertree area.", url: "https://www.pennylanestriders.org.uk" },
  { name: "Wirral AC", type: "club", location: [-3.0430, 53.3930], notes: "Wirral's main athletics & running club, based at Bebington Oval.", url: "https://www.wirralac.co.uk" },
  { name: "Anfield (Liverpool FC)", type: "landmark", location: [-2.9608, 53.4308], notes: "The Kop. Even non-football people should do the stadium tour once." },
  { name: "Hill Dickinson Stadium (Everton FC)", type: "landmark", location: [-2.9990, 53.4270], notes: "Everton's new waterfront stadium at Bramley-Moore Dock — the city's newest landmark." },
  { name: "Royal Albert Dock", type: "landmark", location: [-2.9920, 53.4010], notes: "Tate Liverpool, Maritime Museum, bars on the water. Touristy but genuinely great." },
  { name: "Sefton Park Palm House", type: "landmark", location: [-2.9360, 53.3820], notes: "Victorian glasshouse in Sefton Park, free entry. Sunday afternoon win." },
  { name: "Crosby Beach — Another Place", type: "landmark", location: [-3.0450, 53.4780], notes: "100 Antony Gormley iron men staring out to sea. Best at sunset, low tide." },
  { name: "Port Sunlight Village", type: "landmark", location: [-2.9980, 53.3520], notes: "Model village with 900 listed cottages + Lady Lever Art Gallery. Feels like a film set." },
  { name: "Hilbre Island", type: "landmark", location: [-3.2210, 53.3780], notes: "Walk across the sands from West Kirby at low tide. Seals sometimes. Check tide times!" }
];

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

async function overpass(query) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(MIRRORS[attempt % MIRRORS.length] + "?data=" + encodeURIComponent(query), {
        headers: { "User-Agent": "scouse-compass/1.0 (github.com/dimi-r1/liverpool-map)" }
      });
      if (res.ok) return res.json();
      console.warn(`  attempt ${attempt + 1}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`  attempt ${attempt + 1}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error("overpass failed");
}

function dist(a, b) {
  const dx = (a[0] - b[0]) * 0.62, dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * 111;
}

const OUT = "data/liverpool/coolstuff.json";
let prev = { items: [] };
try { prev = JSON.parse(readFileSync(OUT)); } catch {}

const items = [...CURATED];
for (const [type, body] of Object.entries(QUERIES)) {
  const cached = prev.items.filter(i => i.type === type);
  if (cached.length && !process.argv.includes("--fresh")) {
    console.log(`${type}: cached (${cached.length})`);
    items.push(...cached);
    continue;
  }
  const q = `[out:json][timeout:60];${body.replace(/BBOX/g, BBOX)}out center tags;`;
  const data = await overpass(q);
  let added = 0;
  for (const e of data.elements) {
    const name = e.tags?.name;
    if (!name) continue;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    const loc = [lon, lat];
    if (items.some(s => s.name.toLowerCase() === name.toLowerCase() && dist(s.location, loc) < 0.3)) continue;
    if (items.some(s => s.type === type && dist(s.location, loc) < 0.02)) continue;
    items.push({ name, type, location: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6], source: "osm" });
    added++;
  }
  console.log(`${type}: +${added} (${data.elements.length} raw)`);
  await new Promise(r => setTimeout(r, 1000));
}

writeFileSync("data/liverpool/coolstuff.json", JSON.stringify({ items }, null, 2));
console.log(`total: ${items.length} items`);
