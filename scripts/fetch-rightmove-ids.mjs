import { readFileSync, writeFileSync } from "fs";

const AREAS_PATH = "data/liverpool/areas.json";
const curated = JSON.parse(readFileSync(AREAS_PATH));

for (const a of curated.features) {
  const url = `https://los.rightmove.co.uk/typeahead?query=${a.postcode}&limit=10&exclude=STREET`;
  const res = await fetch(url, { headers: { "Referer": "https://www.rightmove.co.uk/", "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.warn(`${a.postcode}: HTTP ${res.status}`); continue; }
  const json = await res.json();
  const match = json.matches.find(m => m.type === "OUTCODE" && m.displayName === a.postcode);
  if (match) {
    a.rightmoveId = `OUTCODE^${match.id}`;
    console.log(`${a.postcode} -> ${a.rightmoveId}`);
  } else {
    console.warn(`${a.postcode}: no match`);
  }
  await new Promise(r => setTimeout(r, 400));
}

writeFileSync(AREAS_PATH, JSON.stringify(curated, null, 2));
console.log("done");
