import { readFileSync, writeFileSync } from "fs";

const AREAS_PATH = "data/liverpool/areas.json";
const curated = JSON.parse(readFileSync(AREAS_PATH));

const lastUpdated = await (await fetch("https://data.police.uk/api/crime-last-updated")).json();
const date = lastUpdated.date.slice(0, 7);
console.log("crime data month:", date);

async function crimeCount([lng, lat]) {
  const url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return (await res.json()).length;
}

for (const a of curated.features) {
  a.crimeTotal = await crimeCount(a.center);
  a.crimeDate = date;
  console.log(`${a.postcode}: ${a.crimeTotal}`);
  await new Promise(r => setTimeout(r, 300));
}

const sorted = [...curated.features].sort((x, y) => x.crimeTotal - y.crimeTotal);
sorted.forEach((a, i) => {
  a.safety = Math.max(1, 5 - Math.floor((i / sorted.length) * 5));
});

writeFileSync(AREAS_PATH, JSON.stringify(curated, null, 2));
console.log("areas.json updated with crime data + data-driven safety scores");
