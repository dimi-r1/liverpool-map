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

const TYPE_ICONS = { restaurant: "🍖", shop: "🛒", church: "⛪", group: "🤸", barber: "💈", other: "📍" };

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
let hoveredPostcode = null;
let panelFetchId = 0;

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

function showPanel(p, feature) {
  const fetchId = ++panelFetchId;
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
    <ul class="notes">${p.notes.map(n => `<li>${n}</li>`).join("")}</ul>
    <div class="crime-box">
      <h3>🚔 Crime breakdown <small>(${p.crimeDate || "latest"}, ~1mi radius)</small></h3>
      <div class="crime-loading">Loading live police.uk data…</div>
    </div>
    <div class="panel-links">
      <a href="https://www.google.com/maps/search/?api=1&query=${areaQuery}" target="_blank" rel="noopener">📍 Google Maps</a>
      <a href="https://www.rightmove.co.uk/property-to-rent/find.html?searchLocation=${encodeURIComponent(p.postcode)}" target="_blank" rel="noopener">🏠 Rentals on Rightmove</a>
    </div>
  `;
  document.getElementById("panel").classList.remove("hidden");

  requestAnimationFrame(() =>
    document.querySelectorAll(".bar-fill").forEach(el => el.style.width = el.dataset.width + "%"));

  if (feature) map.fitBounds(featureBounds(feature), { padding: { top: 60, bottom: 60, left: 60, right: 400 }, duration: 900, maxZoom: 13.5 });

  loadCrimeBreakdown(p, fetchId);
}

async function loadCrimeBreakdown(p, fetchId) {
  try {
    const res = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${p.center[1]}&lng=${p.center[0]}&date=${p.crimeDate}`);
    if (!res.ok) throw new Error(res.status);
    const crimes = await res.json();
    if (fetchId !== panelFetchId) return;

    const counts = {};
    crimes.forEach(c => counts[c.category] = (counts[c.category] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = top[0] ? top[0][1] : 1;

    const box = document.querySelector(".crime-box");
    if (!box) return;
    box.innerHTML = `
      <h3>🚔 Crime breakdown <small>(${p.crimeDate}, ${crimes.length} reported)</small></h3>
      ${top.map(([cat, n]) => `
        <div class="crime-row">
          <span class="crime-name">${CRIME_LABELS[cat] || cat}</span>
          <div class="bar-track"><div class="bar-fill crime" data-width="${Math.round(n / max * 100)}"></div></div>
          <span class="bar-text">${n}</span>
        </div>`).join("")}
      <small class="src">Source: police.uk open data</small>
    `;
    requestAnimationFrame(() =>
      box.querySelectorAll(".bar-fill").forEach(el => el.style.width = el.dataset.width + "%"));
  } catch {
    const box = document.querySelector(".crime-loading");
    if (box && fetchId === panelFetchId) box.textContent = "Couldn't load live crime data right now.";
  }
}

function clearSpots() {
  spotMarkers.forEach(m => m.remove());
  spotMarkers = [];
}

async function showCommunity(id) {
  clearSpots();
  if (!id) return;
  const res = await fetch(`data/communities/${id}.json`);
  const data = await res.json();
  data.spots.filter(s => s.city === "liverpool").forEach(spot => {
    const el = document.createElement("div");
    el.className = "spot-marker";
    el.textContent = TYPE_ICONS[spot.type] || TYPE_ICONS.other;
    el.addEventListener("mouseenter", () => el.classList.add("grown"));
    el.addEventListener("mouseleave", () => el.classList.remove("grown"));
    const popup = new maplibregl.Popup({ offset: 24, className: "spot-popup" }).setHTML(`
      <div class="spot-card">
        <div class="spot-icon">${TYPE_ICONS[spot.type] || TYPE_ICONS.other}</div>
        <div>
          <strong>${spot.name}</strong>
          <div class="spot-type">${spot.type}</div>
          <p>${spot.notes}</p>
          ${spot.url ? `<a href="${spot.url}" target="_blank" rel="noopener">website →</a>` : ""}
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
    showPanel(f.properties, f);
  });
});

document.getElementById("layer-select").addEventListener("change", e => {
  currentLayer = e.target.value;
  applyScores();
});
document.getElementById("community-select").addEventListener("change", e => showCommunity(e.target.value));
document.getElementById("panel-close").addEventListener("click", () =>
  document.getElementById("panel").classList.add("hidden"));
document.getElementById("intro-close").addEventListener("click", () =>
  document.getElementById("intro").classList.add("hidden"));
