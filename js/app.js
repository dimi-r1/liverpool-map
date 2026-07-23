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

let currentLayer = "overall";
let areasFC = null;
let spotMarkers = [];

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

function scoreExpr(layer) {
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

function pill(text, score) {
  return `<span class="pill" style="background:${SCORE_COLORS[score] || "#999"}">${text}</span>`;
}

function showPanel(p) {
  const panel = document.getElementById("panel");
  const rentScore = LAYERS.rent.score(p);
  const commuteScore = LAYERS.commute.score(p);
  document.getElementById("panel-content").innerHTML = `
    <h2>${p.postcode}</h2>
    <div class="area-name">${p.name} · ${p.side === "wirral" ? "Wirral side 🌊" : "Liverpool side 🔴"}</div>
    <div class="score-row"><span>Overall vibe</span>${pill(["", "Avoid-ish", "Caution", "Mixed", "Good", "Great"][p.overall], p.overall)}</div>
    <div class="score-row"><span>Safety</span>${pill(p.safety + "/5", p.safety)}</div>
    ${p.crimeTotal != null ? `<div class="score-row"><span>Reported crimes (${p.crimeDate}, ~1mi radius)</span><span>${p.crimeTotal}</span></div>` : ""}
    <div class="score-row"><span>Rent (1-bed, indicative)</span>${pill("~£" + p.rentAvg + "/mo " + p.rentBand, rentScore)}</div>
    <div class="score-row"><span>Commute to centre</span>${pill("~" + p.commuteMins + " mins", commuteScore)}</div>
    <div class="verdict">💬 ${p.verdict}</div>
    <ul class="notes">${p.notes.map(n => `<li>${n}</li>`).join("")}</ul>
  `;
  panel.classList.remove("hidden");
}

async function clearSpots() {
  spotMarkers.forEach(m => m.remove());
  spotMarkers = [];
}

async function showCommunity(id) {
  await clearSpots();
  if (!id) return;
  const res = await fetch(`data/communities/${id}.json`);
  const data = await res.json();
  data.spots.filter(s => s.city === "liverpool").forEach(spot => {
    const el = document.createElement("div");
    el.className = "spot-marker";
    el.textContent = TYPE_ICONS[spot.type] || TYPE_ICONS.other;
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(spot.location)
      .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(
        `<strong>${spot.name}</strong><br><em>${spot.type}</em><br>${spot.notes}` +
        (spot.url ? `<br><a href="${spot.url}" target="_blank" rel="noopener">website →</a>` : "") +
        (spot.verified ? "" : "<br><small>⚠️ placeholder — verify</small>")
      ))
      .addTo(map);
    spotMarkers.push(marker);
  });
}

map.on("load", async () => {
  const res = await fetch("data/liverpool/areas.geojson");
  areasFC = await res.json();

  map.addSource("areas", { type: "geojson", data: areasFC });
  map.addLayer({
    id: "areas-fill",
    type: "fill",
    source: "areas",
    paint: { "fill-color": "#999", "fill-opacity": 0.55 }
  });
  map.addLayer({
    id: "areas-outline",
    type: "line",
    source: "areas",
    paint: { "line-color": "#1c2430", "line-width": 1.2 }
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

  map.on("click", "areas-fill", e => showPanel(e.features[0].properties));
  map.on("mouseenter", "areas-fill", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "areas-fill", () => map.getCanvas().style.cursor = "");
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
