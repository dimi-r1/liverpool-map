const SCORE_COLORS = { 5: "#1e8e4e", 4: "#5cb85c", 3: "#e6a817", 2: "#e07b39", 1: "#d64545" };

const LAYERS = {
  overall: {
    label: "Overall vibe",
    score: a => a.overall,
    legend: [["5", "Great all-rounder"], ["3", "Mixed / check streets"], ["1", "Do your homework"]]
  },
  safety: {
    label: "Safety",
    score: a => a.safety,
    legend: [["5", "Generally safe"], ["3", "Average"], ["1", "Higher crime stats"]]
  },
  rent: {
    label: "Rent (green = cheaper)",
    score: a => a.rentAvg <= 620 ? 5 : a.rentAvg <= 720 ? 4 : a.rentAvg <= 820 ? 3 : a.rentAvg <= 900 ? 2 : 1,
    legend: [["5", "≤ £620/mo"], ["3", "£720–820/mo"], ["1", "£900+/mo"]]
  },
  commute: {
    label: "Commute to city centre (green = quicker)",
    score: a => a.commuteMins <= 15 ? 5 : a.commuteMins <= 25 ? 4 : a.commuteMins <= 35 ? 3 : 2,
    legend: [["5", "≤ 15 mins"], ["3", "25–35 mins"], ["2", "40+ mins"]]
  }
};

const TYPE_ICONS = { restaurant: "🍖", shop: "🛒", church: "⛪", group: "🤸", barber: "💈", other: "📍",
  park: "🌳", beach: "🏖️", swim: "🏊", gym: "💪", attraction: "🎡", stadium: "🏟️",
  nature: "🦆", marina: "⛵", golf: "⛳", watersports: "🚣", parkrun: "🏃", club: "👟", landmark: "📸",
  school: "🏫" };

const OFSTED_STYLE = {
  5: ["Outstanding", "#1e8e4e"], 4: ["Good", "#5cb85c"],
  2: ["Needs improvement", "#e6a817"], 1: ["Inadequate", "#d64545"],
  null: ["Not yet rated", "#999"]
};

const CRIME_LABELS = {
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  "burglary": "Burglary",
  "criminal-damage-arson": "Criminal damage & arson",
  "drugs": "Drugs",
  "other-theft": "Other theft",
  "possession-of-weapons": "Weapons possession",
  "public-order": "Public order",
  "robbery": "Robbery",
  "shoplifting": "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence & sexual offences",
  "other-crime": "Other crime"
};

let currentLayer = "overall";
let areasFC = null;
let spotMarkers = [];
let coolMarkers = [];
let schoolMarkers = [];
let coolStuff = null;
let schools = null;
let hoveredPostcode = null;

function km(a, b) {
  const dx = (a[0] - b[0]) * 0.62, dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * 111;
}

async function loadCoolStuff() {
  if (!coolStuff) coolStuff = (await (await fetch("data/liverpool/coolstuff.json")).json()).items;
  return coolStuff;
}

async function loadSchools() {
  if (!schools) schools = (await (await fetch("data/liverpool/schools.json")).json()).schools;
  return schools;
}

function spotLink(s) {
  if (s.url) return s.url;
  return `https://www.google.com/maps/search/?api=1&query=${s.location[1]},${s.location[0]}`;
}

function schoolLink(s) {
  return s.website || `https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(s.name)}`;
}

function nearbySchools(center, limit = 5) {
  if (!schools) return [];
  return [...schools]
    .sort((a, b) => km(a.location, center) - km(b.location, center))
    .filter(s => km(s.location, center) <= 2)
    .slice(0, limit);
}

function nearbyCool(center, limit = 6) {
  if (!coolStuff) return [];
  return [...coolStuff]
    .sort((a, b) => km(a.location, center) - km(b.location, center))
    .filter(s => km(s.location, center) <= 2.5)
    .slice(0, limit);
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" }
    ]
  },
  center: [-2.98, 53.40],
  zoom: 10.5,
  maxBounds: [[-3.6, 53.10], [-2.40, 53.70]]
});

const hoverTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "hover-tip" });

function scoreExpr() {
  const stops = [[5, SCORE_COLORS[5]], [4, SCORE_COLORS[4]], [3, SCORE_COLORS[3]], [2, SCORE_COLORS[2]], [1, SCORE_COLORS[1]]];
  return ["match", ["get", "_score"], ...stops.flat(), "#999999"];
}

function applyScores() {
  const layer = LAYERS[currentLayer];
  areasFC.features.forEach(f => { f.properties._score = layer.score(f.properties); });
  map.getSource("areas").setData(areasFC);
  map.setPaintProperty("areas-fill", "fill-color", scoreExpr());
  renderLegend();
}

function renderLegend() {
  const layer = LAYERS[currentLayer];
  document.getElementById("legend").innerHTML =
    `<strong>${layer.label}</strong>` +
    layer.legend.map(([score, text]) =>
      `<div class="row"><span class="swatch" style="background:${SCORE_COLORS[score]}"></span>${text}</div>`
    ).join("");
}

function setHover(postcode, state) {
  if (hoveredPostcode !== null) map.setFeatureState({ source: "areas", id: hoveredPostcode }, { hover: false });
  hoveredPostcode = state ? postcode : null;
  if (state) map.setFeatureState({ source: "areas", id: postcode }, { hover: true });
}

function featureBounds(feature) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = coords => coords.forEach(c => {
    if (typeof c[0] === "number") {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    } else walk(c);
  });
  walk(feature.geometry.coordinates);
  return [[b[0], b[1]], [b[2], b[3]]];
}

function bar(label, score, text) {
  return `<div class="bar-row">
    <span class="bar-label">${label}</span>
    <div class="bar-track"><div class="bar-fill" data-width="${score * 20}" style="background:${SCORE_COLORS[score]}"></div></div>
    <span class="bar-text">${text}</span>
  </div>`;
}

function crimeBreakdownHTML(p) {
  const cats = asArr(p.crimeCats);
  const entries = Array.isArray(cats) ? [] : Object.entries(cats);
  if (!entries.length) return `<div class="crime-loading">No breakdown available.</div>`;
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0][1];
  return top.map(([cat, n]) => `
    <div class="crime-row">
      <span class="crime-name">${CRIME_LABELS[cat] || cat}</span>
      <div class="bar-track"><div class="bar-fill crime" data-width="${Math.round(n / max * 100)}"></div></div>
      <span class="bar-text">${n}</span>
    </div>`).join("");
}

function rentalLinks(p) {
  const pc = p.postcode;
  const low = pc.toLowerCase();
  const links = [
    ["Rightmove", `https://www.rightmove.co.uk/property-to-rent/find.html?locationIdentifier=${encodeURIComponent(p.rightmoveId || "")}&includeLetAgreed=false`],
    ["Zoopla", `https://www.zoopla.co.uk/to-rent/property/${low}/?q=${pc}&price_frequency=per_month`],
    ["OnTheMarket", `https://www.onthemarket.com/to-rent/property/${low}/`],
    ["OpenRent", `https://www.openrent.co.uk/properties-to-rent?term=${pc}`],
    ["SpareRoom", `https://www.spareroom.co.uk/flatshare/?search=${pc}`]
  ];
  return links.map(([name, url]) =>
    `<a href="${url}" target="_blank" rel="noopener">${name} →</a>`).join("");
}

function showPanel(p, feature) {
  const rentScore = LAYERS.rent.score(p);
  const commuteScore = LAYERS.commute.score(p);
  const areaQuery = encodeURIComponent(`${p.postcode} ${p.side === "wirral" ? "Wirral" : "Liverpool"}`);

  document.getElementById("panel-content").innerHTML = `
    <h2>${p.postcode}</h2>
    <div class="area-name">${p.name} · ${p.side === "wirral" ? "Wirral side 🌊" : "Liverpool side 🔴"}</div>
    <div class="bars">
      ${bar("Overall", p.overall, ["", "Avoid-ish", "Caution", "Mixed", "Good", "Great"][p.overall])}
      ${bar("Safety", p.safety, p.safety + "/5")}
      ${bar("Rent value", rentScore, "~£" + p.rentAvg + "/mo")}
      ${bar("Commute", commuteScore, "~" + p.commuteMins + " mins")}
    </div>
    <div class="verdict">💬 ${p.verdict}</div>
    <ul class="notes">${asArr(p.notes).map(n => `<li>${n}</li>`).join("")}</ul>
    <div class="cool-box" id="cool-box"><h3>✨ Nearby cool stuff</h3><div class="crime-loading">Loading…</div></div>
    <div class="school-box" id="school-box"><h3>🏫 Nearest schools</h3><div class="crime-loading">Loading…</div></div>
    <div class="crime-box">
      <h3>🚔 Crime breakdown <small>(${p.crimeDate || "latest"}, ${p.crimeTotal ?? "?"} reported, ~1mi radius)</small></h3>
      ${crimeBreakdownHTML(p)}
      <small class="src">Source: police.uk open data</small>
    </div>
    <div class="rentals">
      <h3>🏠 Find rentals in ${p.postcode}</h3>
      <div class="panel-links">${rentalLinks(p)}</div>
    </div>
    <div class="panel-links single">
      <a href="https://www.google.com/maps/search/?api=1&query=${areaQuery}" target="_blank" rel="noopener">📍 Explore on Google Maps</a>
    </div>
  `;
  document.getElementById("panel").classList.remove("hidden");

  requestAnimationFrame(() =>
    document.querySelectorAll(".bar-fill").forEach(el => el.style.width = el.dataset.width + "%"));

  if (feature) map.fitBounds(featureBounds(feature), { padding: { top: 60, bottom: 60, left: 60, right: 400 }, duration: 900, maxZoom: 13.5 });

  const center = asArr(p.center);
  loadCoolStuff().then(() => {
    const near = nearbyCool(center);
    const box = document.getElementById("cool-box");
    if (!box) return;
    box.innerHTML = `<h3>✨ Nearby cool stuff</h3>` + (near.length
      ? near.map(s => `<div class="cool-row">
          <span class="cool-icon">${TYPE_ICONS[s.type] || "📍"}</span>
          <span class="cool-name"><a href="${spotLink(s)}" target="_blank" rel="noopener">${s.name}</a>${s.notes ? `<small>${s.notes}</small>` : ""}</span>
          <span class="cool-dist">${km(s.location, center).toFixed(1)}km</span>
        </div>`).join("")
      : `<div class="crime-loading">Nothing mapped nearby — yet.</div>`);
  });

  loadSchools().then(() => {
    const near = nearbySchools(center);
    const box = document.getElementById("school-box");
    if (!box) return;
    box.innerHTML = `<h3>🏫 Nearest schools <small>(Ofsted rated)</small></h3>` + (near.length
      ? near.map(s => {
          const [label, color] = OFSTED_STYLE[s.ofsted] || OFSTED_STYLE[null];
          return `<div class="cool-row">
            <span class="cool-icon">${s.phase === "secondary" ? "🎓" : "🏫"}</span>
            <span class="cool-name"><a href="${schoolLink(s)}" target="_blank" rel="noopener">${s.name}</a><small>${s.phase} · ${s.type}</small></span>
            <span class="pill" style="background:${color}">${label}</span>
          </div>`;
        }).join("")
      : `<div class="crime-loading">No schools within 2km.</div>`);
  });
}

function clearSpots() {
  spotMarkers.forEach(m => m.remove());
  spotMarkers = [];
}

function clearCool() {
  coolMarkers.forEach(m => m.remove());
  coolMarkers = [];
  schoolMarkers.forEach(m => m.remove());
  schoolMarkers = [];
}

async function showSchools() {
  const items = await loadSchools();
  items.forEach(s => {
    const [, color] = OFSTED_STYLE[s.ofsted] || OFSTED_STYLE[null];
    const el = document.createElement("div");
    el.className = "spot-marker school-marker";
    el.style.setProperty("--school-color", color);
    el.innerHTML = `<span class="spot-emoji">${s.phase === "secondary" ? "🎓" : "🏫"}</span>`;
    const [label] = OFSTED_STYLE[s.ofsted] || OFSTED_STYLE[null];
    const popup = new maplibregl.Popup({ offset: 24, className: "spot-popup" }).setHTML(`
      <div class="spot-card">
        <div class="spot-icon">${s.phase === "secondary" ? "🎓" : "🏫"}</div>
        <div>
          <strong><a href="${schoolLink(s)}" target="_blank" rel="noopener">${s.name}</a></strong>
          <div class="spot-type">${s.phase} · ${s.type}</div>
          <p>Ofsted: <strong style="color:${color}">${label}</strong>${s.postcode ? ` · ${s.postcode}` : ""}</p>
          <a href="https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(s.name)}" target="_blank" rel="noopener">Ofsted report →</a>
        </div>
      </div>
    `);
    const marker = new maplibregl.Marker({ element: el }).setLngLat(s.location).setPopup(popup).addTo(map);
    el.addEventListener("click", () =>
      map.flyTo({ center: s.location, zoom: Math.max(map.getZoom(), 14), duration: 800 }));
    schoolMarkers.push(marker);
  });
}

async function showCoolStuff(filter) {
  clearCool();
  if (!filter) return;
  if (filter === "schools") return showSchools();
  const items = await loadCoolStuff();
  items.filter(s => filter === "all" || s.type === filter).forEach(s => {
    const el = document.createElement("div");
    el.className = "spot-marker";
    el.innerHTML = `<span class="spot-emoji">${TYPE_ICONS[s.type] || "📍"}</span>`;
    const popup = new maplibregl.Popup({ offset: 24, className: "spot-popup" }).setHTML(`
      <div class="spot-card">
        <div class="spot-icon">${TYPE_ICONS[s.type] || "📍"}</div>
        <div>
          <strong><a href="${spotLink(s)}" target="_blank" rel="noopener">${s.name}</a></strong>
          <div class="spot-type">${s.type}</div>
          ${s.notes ? `<p>${s.notes}</p>` : ""}
          <a href="${spotLink(s)}" target="_blank" rel="noopener">${s.url ? "website →" : "directions →"}</a>
        </div>
      </div>
    `);
    const marker = new maplibregl.Marker({ element: el }).setLngLat(s.location).setPopup(popup).addTo(map);
    el.addEventListener("click", () =>
      map.flyTo({ center: s.location, zoom: Math.max(map.getZoom(), 14), duration: 800 }));
    coolMarkers.push(marker);
  });
}

async function showCommunity(id) {
  clearSpots();
  if (!id) return;
  const res = await fetch(`data/communities/${id}.json`);
  const data = await res.json();
  data.spots.filter(s => s.city === "liverpool").forEach(spot => {
    const el = document.createElement("div");
    el.className = "spot-marker";
    el.innerHTML = `<span class="spot-emoji">${TYPE_ICONS[spot.type] || TYPE_ICONS.other}</span>`;
    const popup = new maplibregl.Popup({ offset: 24, className: "spot-popup" }).setHTML(`
      <div class="spot-card">
        <div class="spot-icon">${TYPE_ICONS[spot.type] || TYPE_ICONS.other}</div>
        <div>
          <strong><a href="${spotLink(spot)}" target="_blank" rel="noopener">${spot.name}</a></strong>
          <div class="spot-type">${spot.type}</div>
          <p>${spot.notes}</p>
          <a href="${spotLink(spot)}" target="_blank" rel="noopener">${spot.url ? "website →" : "directions →"}</a>
          ${spot.verified ? "" : "<small>⚠️ placeholder — verify</small>"}
        </div>
      </div>
    `);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(spot.location)
      .setPopup(popup)
      .addTo(map);
    el.addEventListener("click", () =>
      map.flyTo({ center: spot.location, zoom: Math.max(map.getZoom(), 14), duration: 800 }));
    spotMarkers.push(marker);
  });
}

map.on("load", async () => {
  const res = await fetch("data/liverpool/areas.geojson");
  areasFC = await res.json();

  map.addSource("areas", { type: "geojson", data: areasFC, promoteId: "postcode" });
  map.addLayer({
    id: "areas-fill",
    type: "fill",
    source: "areas",
    paint: {
      "fill-color": "#999",
      "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0.55]
    }
  });
  map.addLayer({
    id: "areas-outline",
    type: "line",
    source: "areas",
    paint: {
      "line-color": "#1c2430",
      "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 3, 1.2]
    }
  });
  map.addLayer({
    id: "areas-label",
    type: "symbol",
    source: "areas",
    layout: {
      "text-field": ["get", "postcode"],
      "text-size": 13,
      "text-font": ["Open Sans Semibold"]
    },
    paint: {
      "text-color": "#1c2430",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5
    }
  });

  applyScores();

  map.on("mousemove", "areas-fill", e => {
    map.getCanvas().style.cursor = "pointer";
    const p = e.features[0].properties;
    setHover(p.postcode, true);
    hoverTip.setLngLat(e.lngLat)
      .setHTML(`<strong>${p.postcode}</strong> · ${p.name}`)
      .addTo(map);
  });
  map.on("mouseleave", "areas-fill", () => {
    map.getCanvas().style.cursor = "";
    setHover(null, false);
    hoverTip.remove();
  });
  map.on("click", "areas-fill", e => {
    const f = e.features[0];
    history.replaceState(null, "", "#" + f.properties.postcode);
    showPanel(f.properties, f);
  });

  const hash = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  if (hash) {
    const f = areasFC.features.find(f => f.properties.postcode === hash);
    if (f) showPanel(f.properties, f);
  }
});

document.getElementById("layer-select").addEventListener("change", e => {
  currentLayer = e.target.value;
  applyScores();
});
document.getElementById("community-select").addEventListener("change", e => showCommunity(e.target.value));
document.getElementById("coolstuff-select").addEventListener("change", e => showCoolStuff(e.target.value));
document.getElementById("panel-close").addEventListener("click", () =>
  document.getElementById("panel").classList.add("hidden"));
document.getElementById("intro-close").addEventListener("click", () =>
  document.getElementById("intro").classList.add("hidden"));
