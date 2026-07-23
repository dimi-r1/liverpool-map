import { readFileSync, writeFileSync } from "fs";

const AREAS_PATH = "data/liverpool/areas.json";
const curated = JSON.parse(readFileSync(AREAS_PATH));

const lastUpdated = await (await fetch("https://data.police.uk/api/crime-last-updated")).json();
const date = lastUpdated.date.slice(0, 7);
console.log("crime data month:", date);

async function crimeStats([lng, lat]) {
  const url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${date}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const crimes = await res.json();
    const cats = {};
    crimes.forEach(c => cats[c.category] = (cats[c.category] || 0) + 1);
    return { total: crimes.length, cats };
  }
  throw new Error(`rate limited: ${url}`);
}

for (const a of curated.features) {
  if (a.crimeCats && a.crimeDate === date) { console.log(`${a.postcode}: cached`); continue; }
  const { total, cats } = await crimeStats(a.center);
  a.crimeTotal = total;
  a.crimeCats = JSON.stringify(cats);
  a.crimeDate = date;
  console.log(`${a.postcode}: ${total}`);
  await new Promise(r => setTimeout(r, 600));
}

const sorted = [...curated.features].sort((x, y) => x.crimeTotal - y.crimeTotal);
sorted.forEach((a, i) => {
  a.safety = Math.max(1, 5 - Math.floor((i / sorted.length) * 5));
});

writeFileSync(AREAS_PATH, JSON.stringify(curated, null, 2));
console.log("areas.json updated with crime data + data-driven safety scores");
