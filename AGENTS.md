# Scouse Compass

Interactive map helping newcomers (originally a friend relocating from Brazil) decide where to live in Liverpool & Merseyside. Postcode districts are colour-coded by vibe/safety/rent/commute, with clickable info panels, real crime stats, schools with Ofsted ratings, rental-site deep links, a Brazilian community layer, and a "cool stuff" layer (parks, parkruns, beaches, gyms, landmarks).

Live site: https://dimi-r1.github.io/liverpool-map/ (GitHub Pages, auto-deploys from `main`).

## Tech

- **Static site, no build step** — plain HTML/CSS/JS
- **MapLibre GL JS 4.7.1** (CDN) + OpenStreetMap raster tiles, glyphs from demotiles.maplibre.org
- **Data baked to JSON/GeoJSON by Node scripts** — no runtime backend

## Layout

```
index.html            entry point (cache-bust with ?v=N on css/js when they change!)
css/style.css
js/app.js             all map logic: layers, hover, panels, markers
data/liverpool/
  areas.json          curated source of truth per postcode (verdicts, rents, scores)
  areas.geojson       generated: areas.json + real district polygons + computed fields
  coolstuff.json      generated: 500+ OSM POIs + curated landmarks/parkruns/clubs
  schools.json        generated: 497 schools with Ofsted ratings
data/communities/
  brazilian.json      curated spots + OSM-derived spots (deduped)
scripts/
  build-areas.mjs     merges areas.json with district polygons -> areas.geojson
  fetch-crime.mjs     police.uk API per district -> crimeTotal, crimeCats, safety score
  fetch-rightmove-ids.mjs  harvests Rightmove OUTCODE^xxxx IDs via los.rightmove.co.uk/typeahead
  fetch-community.mjs Overpass API -> Brazilian spots, dedupes against curated
  fetch-coolstuff.mjs Overpass API -> parks/beaches/gyms/etc by category
  fetch-schools.mjs   Edubase + Ofsted MI joined on URN, OSGB36->WGS84 conversion
.github/workflows/update-data.yml  weekly cron runs all fetch scripts, commits changes
```

## Key data notes

- **Postcode polygons**: from `missinglink/uk-postcode-polygons` (OSM/Wikipedia-derived), downloaded to a temp dir referenced in build-areas.mjs — re-download L.geojson + CH.geojson there if rebuilding from scratch.
- **Crime**: police.uk street-level API, 1-mile radius per district centre; safety score is a 1–5 percentile rank across the 39 districts. Rate-limited — script has backoff.
- **Rents**: curated estimates in areas.json (no free UK rent API exists).
- **Rightmove**: does NOT accept postcodes in URLs — needs internal IDs (harvested, stored as `rightmoveId` per area).
- **Schools**: catchment polygons are not open data, so we show "schools in the area" + Ofsted + council admissions link. Ofsted grades are numeric in the CSV or "School remains X" for ungraded.
- **parkrun**: parkrun.org blocks bots (even real browsers); the 5 event entries are manually curated + verified.
- **Bot-blocked sites** (parkrun, Rightmove search, GIAS): use puppeteer-core with system Chrome when scraping is unavoidable; prefer direct blob/API URLs (e.g. ea-edubase-api-prod.azurewebsites.net).

## Gotchas

- **Never animate/scale MapLibre marker elements** (they're positioned via transform; overriding breaks anchoring). Scale an inner `.spot-emoji` span instead.
- **MapLibre can stringify array/object GeoJSON properties** — always read them via `asArr()` in app.js.
- **Browser caching is aggressive** — bump `?v=N` in index.html for both app.js and style.css on every JS/CSS change.
- Overpass API: needs a User-Agent header; use mirrors + retries (overpass-api.de, kumi.systems, private.coffee).

## Commands

- Local dev: `python3 -m http.server 8000`
- Checks: `node --check js/app.js` + validate JSON with `node -e "JSON.parse(...)"`
- Full browser regression tests: puppeteer-core script pattern in `/var/folders/.../T/opencode/pptr/test.js` (headless system Chrome with `--enable-unsafe-swiftshader` for WebGL)
- Data refresh: `node scripts/fetch-crime.mjs && node scripts/fetch-rightmove-ids.mjs && node scripts/fetch-community.mjs brazilian && node scripts/fetch-coolstuff.mjs && node scripts/fetch-schools.mjs && node scripts/build-areas.mjs`

## Roadmap ideas

- More communities (Polish, Nigerian, Portuguese…) via data/communities/*.json
- More cities (architecture is city-per-folder: data/<city>/ + routing)
- Real rent data; commute calculator; "submit a spot" crowdsourcing
