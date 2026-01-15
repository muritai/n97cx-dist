// ===========================================================
//                REPORTING POINTS MODULE (V2 CLEAN)
// ===========================================================

let viewerRef = null;
let ATCTLat = null;
let ATCTLon = null;

let reportingPointEntities = [];
let referencePointEntities = [];  // For Lauer X and similar
let panel, toggleBtn, listContainer;
let panelVisible = false;

// ===========================================================
//       BUILT-IN DEFAULT REPORTING POINT CONFIG (KVGT)
// ===========================================================

const DEFAULT_REPORTING_POINTS = [
    { name: "Lone Mountain *", distanceNM: 6.0,   bearingDeg: 315 },
    { name: "Kyle Canyon Road", distanceNM: 10.0, bearingDeg: 315 },
    { name: "Centennial Hills Hospital", distanceNM: 7.5, bearingDeg: 315 },
    { name: "I – 215 & HWY 95 Intersection", distanceNM: 6.5, bearingDeg: 315 },
    { name: "Water Retention Basin", distanceNM: 8.0, bearingDeg: 315 },

    { name: "Aliante Casino & Hotel", distanceNM: 5.75, bearingDeg: 0 },

    { name: "Craig Ranch Regional Park *", distanceNM: 3.25, bearingDeg: 45 },

    { name: "Three Fingers Lake *", distanceNM: 4.0, bearingDeg: 270 },
    { name: "Mountain View Hospital / HWY 95 & Cheyenne *", distanceNM: 3.5, bearingDeg: 270 },
    { name: "The Resorts", distanceNM: 7.0, bearingDeg: 270 },

    { name: "Summerlin Hospital", distanceNM: 6.0, bearingDeg: 225 },
    { name: "Suncoast Casino & Hotel", distanceNM: 6.25, bearingDeg: 225 },
    { name: "Red Rock Retention Basin", distanceNM: 9.0, bearingDeg: 225 },
    { name: "Red Rock Casino & Hotel / Golf Course", distanceNM: 8.75, bearingDeg: 225 },
    { name: "Bank of America *", distanceNM: 4.0, bearingDeg: 225 },

    { name: "Spaghetti Bowl *", distanceNM: 3.0, bearingDeg: 135 },
    { name: "Stratosphere *", distanceNM: 4.25, bearingDeg: 135 },
    { name: "El Cortez Hotel *", distanceNM: 4.0, bearingDeg: 135 },

    { name: "Meadows Mall *", distanceNM: 2.75, bearingDeg: 180 },

    { name: "EG&G Building", distanceNM: 3.0, bearingDeg: 90 }
];

// ===========================================================
//       REFERENCE POINTS (fixed lat/lon, ground-clamped)
// ===========================================================

const REFERENCE_POINTS = [

    {   name: "ATCT", 
        lat:  36.210167, 
        lon: -115.189259},

    {   name: "N97CX Wreckage", 
        lat:  36.205332, 
        lon: -115.186376},

    {   name: "N160RA Wreckage", 
        lat:  36.203256, 
        lon: -115.184910},

    {   name: "Lauer 'X'", 
        lat: 36.185481, 
        lon: -115.183500},

    {   name: "N97CX @ 19:02:04", 
        lat: 36.2015623375471, 
        lon: -115.200868297736},

    {    name: "North LAS Fire Station 53", 
        lat: 36.225268, 
        lon: -115.179007}

];

// ===========================================================
//  GREAT-CIRCLE DESTINATION FROM ATCT (bearing + NM)
// ===========================================================

function destinationFromATCT(distanceNM, bearingDeg) {
    const R = 6371000.0;
    const d = distanceNM * 1852.0;

    const φ1 = Cesium.Math.toRadians(ATCTLat);
    const λ1 = Cesium.Math.toRadians(ATCTLon);
    const θ  = Cesium.Math.toRadians(bearingDeg);
    const δ  = d / R;

    const sinφ1 = Math.sin(φ1);
    const cosφ1 = Math.cos(φ1);
    const sinδ  = Math.sin(δ);
    const cosδ  = Math.cos(δ);

    const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);

    const y = Math.sin(θ) * sinδ * cosφ1;
    const x = cosδ - sinφ1 * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    return {
        lat: Cesium.Math.toDegrees(φ2),
        lon: Cesium.Math.toDegrees(λ2)
    };
}

// ===========================================================
//        TERRAIN HEIGHT (cached per point)
// ===========================================================

const terrainCache = new Map();

async function getTerrainHeight(lon, lat) {
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`;
    if (terrainCache.has(key)) return terrainCache.get(key);

    const positions = [Cesium.Cartographic.fromDegrees(lon, lat)];
    const updated = await Cesium.sampleTerrainMostDetailed(viewerRef.terrainProvider, positions);

    const h = updated[0].height;
    terrainCache.set(key, h);
    return h;
}

// ===========================================================
//        CREATE REPORTING POINT ENTITIES
// ===========================================================

async function createReportingPoints() {
    // Remove old
    reportingPointEntities.forEach(e => {
        viewerRef.entities.remove(e.pole);
        viewerRef.entities.remove(e.marker);
        viewerRef.entities.remove(e.label);
    });
    reportingPointEntities = [];

    for (const cfg of DEFAULT_REPORTING_POINTS) {
        const dest = destinationFromATCT(cfg.distanceNM, cfg.bearingDeg);
        const groundHeight = await getTerrainHeight(dest.lon, dest.lat);
        const markerHeight = groundHeight + 2000;

        const pole = viewerRef.entities.add({
            show: false,
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                    dest.lon, dest.lat, groundHeight,
                    dest.lon, dest.lat, markerHeight
                ]),
                width: 3,
                material: Cesium.Color.BLACK.withAlpha(0.6)
            }
        });

        const marker = viewerRef.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, markerHeight),
            billboard: {
                image: "static/icons/red_triangle.png",
                scale: 0.8,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });

        const label = viewerRef.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, markerHeight + 5),
            label: {
                text: `${cfg.name}\n${cfg.distanceNM.toFixed(2)} NM`,
                font: "13px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18)
            }
        });

        reportingPointEntities.push({ cfg, pole, marker, label });
    }
}

// ===========================================================
//        CREATE REFERENCE POINT ENTITIES
// ===========================================================

async function createReferencePoints() {
    // Remove old
    referencePointEntities.forEach(e => {
        viewerRef.entities.remove(e.marker);
        viewerRef.entities.remove(e.label);
    });
    referencePointEntities = [];

    for (const cfg of REFERENCE_POINTS) {
        const marker = viewerRef.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(cfg.lon, cfg.lat),
            point: {
                pixelSize: 12,
                color: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });

        const label = viewerRef.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(cfg.lon, cfg.lat),
            label: {
                text: cfg.name,
                font: "13px sans-serif",
                fillColor: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -10),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });

        referencePointEntities.push({ cfg, marker, label });
    }
}

// ===========================================================
//        VISIBILITY API
// ===========================================================

export function showAllReportingPoints() {
    reportingPointEntities.forEach(rp => {
        rp.pole.show = true;
        rp.marker.show = true;
        rp.label.show = true;
    });
}

export function hideAllReportingPoints() {
    reportingPointEntities.forEach(rp => {
        rp.pole.show = false;
        rp.marker.show = false;
        rp.label.show = false;
    });
}

function setOneVisible(name, show) {
    const rp = reportingPointEntities.find(r => r.cfg.name === name);
    if (!rp) return;

    rp.pole.show = show;
    rp.marker.show = show;
    rp.label.show = show;
}

function setReferenceVisible(name, show) {
    const rp = referencePointEntities.find(r => r.cfg.name === name);
    if (!rp) return;

    rp.marker.show = show;
    rp.label.show = show;
}

// ===========================================================
//        UI PANEL
// ===========================================================

function buildUI() {
    panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.top = "10px";
    panel.style.right = "10px";
    panel.style.background = "rgba(0,0,0,0.7)";
    panel.style.padding = "8px";
    panel.style.borderRadius = "6px";
    panel.style.color = "white";
    panel.style.zIndex = "1001";
    panel.style.width = "250px";

    document.body.appendChild(panel);

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";

    const title = document.createElement("span");
    title.innerText = "Reporting Points and Reference";

    toggleBtn = document.createElement("button");
    toggleBtn.innerText = "+";
    toggleBtn.style.marginLeft = "8px";

    header.appendChild(title);
    header.appendChild(toggleBtn);
    panel.appendChild(header);

    listContainer = document.createElement("div");
    listContainer.style.display = "none";
    listContainer.style.marginTop = "6px";
    panel.appendChild(listContainer);

    toggleBtn.onclick = () => {
        panelVisible = !panelVisible;
        listContainer.style.display = panelVisible ? "block" : "none";
        toggleBtn.innerText = panelVisible ? "−" : "+";
    };
}

function buildList() {
    listContainer.innerHTML = "";

    // master row
    const master = document.createElement("div");
    master.style.marginBottom = "6px";

    const s = document.createElement("button");
    s.innerText = "Show All";
    s.onclick = () => {
        showAllReportingPoints();
        listContainer.querySelectorAll("input[data-type='reporting']").forEach(cb => cb.checked = true);
    };

    const h = document.createElement("button");
    h.innerText = "Hide All";
    h.onclick = () => {
        hideAllReportingPoints();
        listContainer.querySelectorAll("input[data-type='reporting']").forEach(cb => cb.checked = false);
    };

    master.appendChild(s);
    master.appendChild(h);
    listContainer.appendChild(master);

    // individual reporting point rows
    reportingPointEntities.forEach(rp => {
        const row = document.createElement("div");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-type", "reporting");
        cb.onchange = () => setOneVisible(rp.cfg.name, cb.checked);

        const label = document.createElement("label");
        label.style.fontSize = "11px";
        label.innerText = `${rp.cfg.name} (${rp.cfg.distanceNM} NM)`;
        label.style.marginLeft = "4px";

        row.appendChild(cb);
        row.appendChild(label);
        listContainer.appendChild(row);
    });

    // Separator line
    const separator = document.createElement("div");
    separator.style.borderTop = "1px solid #aaa";
    separator.style.margin = "6px 0";
    listContainer.appendChild(separator);

    // Reference points section
    referencePointEntities.forEach(rp => {
        const row = document.createElement("div");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-type", "reference");
        cb.onchange = () => setReferenceVisible(rp.cfg.name, cb.checked);

        const label = document.createElement("label");
        label.style.fontSize = "11px";
        label.innerText = rp.cfg.name;
        label.style.marginLeft = "4px";

        row.appendChild(cb);
        row.appendChild(label);
        listContainer.appendChild(row);
    });
}

// ===========================================================
//        PUBLIC INIT API
// ===========================================================

export async function initReportingPoints(viewer, atctLat, atctLon) {
    viewerRef = viewer;
    ATCTLat = atctLat;
    ATCTLon = atctLon;

    buildUI();
    await createReportingPoints();
    await createReferencePoints();
    buildList();
}