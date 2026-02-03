// ===========================================================
//              RUNWAY EXTENDED CENTERLINES MODULE
// ===========================================================
//
// Public API:
//   setupRunwayCenterlines(viewer)
//   toggleRunwayCenterlines()
//   showRunwayCenterlines()
//   hideRunwayCenterlines()
//
// ===========================================================

let viewerRef = null;
let centerlineEntities = [];
let centerlinesVisible = false;
let centerlineBtn = null;

// ===========================================================
//                    RUNWAY THRESHOLD DATA
// ===========================================================

// Helper to convert DMS to decimal degrees
function dmsToDecimal(degrees, minutes, seconds, direction) {
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }
    return decimal;
}

// Runway threshold coordinates
const RUNWAY_THRESHOLDS = {
    "12R": {
        lat: dmsToDecimal(36, 12, 52.8382, 'N'),   // N 36° 12' 52.8382"
        lon: dmsToDecimal(115, 12, 9.5974, 'W')    // W 115° 12' 09.5974"
    },
    "30L": {
        lat: dmsToDecimal(36, 12, 18.2920, 'N'),   // N 36° 12' 18.2920"
        lon: dmsToDecimal(115, 11, 25.9538, 'W')   // W 115° 11' 25.9538"
    },
    "12L": {
        lat: dmsToDecimal(36, 12, 44.7206, 'N'),   // N 36° 12' 44.7206"
        lon: dmsToDecimal(115, 11, 47.1091, 'W')   // W 115° 11' 47.1091"
    },
    "30R": {
        lat: dmsToDecimal(36, 12, 17.0803, 'N'),   // N 36° 12' 15.7068"
        lon: dmsToDecimal(115, 11, 12.2029, 'W')   // W 115° 11' 10.4691"
    }
};


// Runway pairs (threshold → opposite end, for computing heading)
const RUNWAY_PAIRS = {
    "12R": "30L",
    "30L": "12R",
    "12L": "30R",
    "30R": "12L"
};

// Extension distance in nautical miles
const EXTENSION_NM = 2.0;

// Tick mark intervals (in NM)
const SMALL_TICK_INTERVAL = 0.1;
const LARGE_TICK_INTERVAL = 0.5;

// Tick mark sizes (in meters, perpendicular to centerline)
const SMALL_TICK_SIZE = 50/3.28084;   // feet each side
const LARGE_TICK_SIZE = 125/3.28084;   // feet each side

// ===========================================================
//                    MATH UTILITIES
// ===========================================================

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const NM_TO_METERS = 1852;

/**
 * Compute bearing from point A to point B (in degrees, 0-360)
 */
function computeBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * DEG_TO_RAD;
    const φ2 = lat2 * DEG_TO_RAD;
    const Δλ = (lon2 - lon1) * DEG_TO_RAD;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let bearing = Math.atan2(y, x) * RAD_TO_DEG;
    return (bearing + 360) % 360;
}

/**
 * Compute destination point given start, bearing, and distance
 * Uses Haversine formula
 */
function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat * DEG_TO_RAD;
    const λ1 = lon * DEG_TO_RAD;
    const θ = bearingDeg * DEG_TO_RAD;
    const d = distanceMeters / R;

    const φ2 = Math.asin(
        Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ)
    );

    const λ2 = λ1 + Math.atan2(
        Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
        Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );

    return {
        lat: φ2 * RAD_TO_DEG,
        lon: λ2 * RAD_TO_DEG
    };
}

/**
 * Get the reciprocal bearing (opposite direction)
 */
function reciprocalBearing(bearing) {
    return (bearing + 180) % 360;
}

// ===========================================================
//                 CENTERLINE GENERATION
// ===========================================================

/**
 * Generate extended centerline for a runway
 * Returns array of Cesium entities (line + tick marks)
 */
function generateExtendedCenterline(runwayId) {
    const entities = [];
    const threshold = RUNWAY_THRESHOLDS[runwayId];
    const oppositeId = RUNWAY_PAIRS[runwayId];
    const opposite = RUNWAY_THRESHOLDS[oppositeId];

    // Compute runway heading (from threshold toward opposite end)
    const runwayHeading = computeBearing(threshold.lat, threshold.lon, opposite.lat, opposite.lon);

    // Extended centerline goes in the OPPOSITE direction (away from runway)
    const extensionHeading = reciprocalBearing(runwayHeading);

    // Compute end point of extension (2 NM from threshold)
    const extensionEnd = destinationPoint(
        threshold.lat,
        threshold.lon,
        extensionHeading,
        EXTENSION_NM * NM_TO_METERS
    );

    // Create the main centerline
    const centerlinePositions = [
        Cesium.Cartesian3.fromDegrees(threshold.lon, threshold.lat, 0),
        Cesium.Cartesian3.fromDegrees(extensionEnd.lon, extensionEnd.lat, 0)
    ];

    const centerlineEntity = viewerRef.entities.add({
        id: `centerline-${runwayId}`,
        polyline: {
            positions: centerlinePositions,
            width: 4,
            material: Cesium.Color.RED,
            clampToGround: true
        }
    });
    entities.push(centerlineEntity);

    // Generate tick marks
    const totalDistanceNM = EXTENSION_NM;
    let currentNM = SMALL_TICK_INTERVAL;

    while (currentNM <= totalDistanceNM) {
        const isLargeTick = Math.abs(currentNM % LARGE_TICK_INTERVAL) < 0.001 ||
                           Math.abs(currentNM % LARGE_TICK_INTERVAL - LARGE_TICK_INTERVAL) < 0.001;

        const tickSize = isLargeTick ? LARGE_TICK_SIZE : SMALL_TICK_SIZE;
        const tickWidth = isLargeTick ? 4 : 3;

        // Position along centerline
        const tickCenter = destinationPoint(
            threshold.lat,
            threshold.lon,
            extensionHeading,
            currentNM * NM_TO_METERS
        );

        // Perpendicular bearing (90° to centerline)
        const perpBearing1 = (extensionHeading + 90) % 360;
        const perpBearing2 = (extensionHeading - 90 + 360) % 360;

        // Tick endpoints
        const tickEnd1 = destinationPoint(tickCenter.lat, tickCenter.lon, perpBearing1, tickSize);
        const tickEnd2 = destinationPoint(tickCenter.lat, tickCenter.lon, perpBearing2, tickSize);

        const tickEntity = viewerRef.entities.add({
            id: `tick-${runwayId}-${currentNM.toFixed(1)}`,
            polyline: {
                positions: [
                    Cesium.Cartesian3.fromDegrees(tickEnd1.lon, tickEnd1.lat, 0),
                    Cesium.Cartesian3.fromDegrees(tickEnd2.lon, tickEnd2.lat, 0)
                ],
                width: tickWidth,
                material: Cesium.Color.RED,
                clampToGround: true
            }
        });
        entities.push(tickEntity);

        currentNM += SMALL_TICK_INTERVAL;
    }

    return entities;
}

// ===========================================================
//                    PUBLIC API
// ===========================================================

export function setupRunwayCenterlines(viewer) {
    viewerRef = viewer;
    createCenterlineButton();
}

export function toggleRunwayCenterlines() {
    if (centerlinesVisible) {
        hideRunwayCenterlines();
    } else {
        showRunwayCenterlines();
    }
}

export function showRunwayCenterlines() {
    if (centerlinesVisible) return;

    // Generate centerlines for all four runway ends
    ["12R", "30L", "12L", "30R"].forEach(rwyId => {
        const entities = generateExtendedCenterline(rwyId);
        centerlineEntities.push(...entities);
    });

    centerlinesVisible = true;
    if (centerlineBtn) {
        centerlineBtn.innerText = "Hide Centerlines";
        centerlineBtn.style.backgroundColor = "gray";
        centerlineBtn.style.color = "white";
    }

}

export function hideRunwayCenterlines() {
    if (!centerlinesVisible) return;

    // Remove all centerline entities
    centerlineEntities.forEach(entity => {
        viewerRef.entities.remove(entity);
    });
    centerlineEntities = [];

    centerlinesVisible = false;
    if (centerlineBtn) {
        centerlineBtn.innerText = "Show Centerlines";
        centerlineBtn.style.backgroundColor = "";
        centerlineBtn.style.color = "";
    }

}

export function isCenterlinesVisible() {
    return centerlinesVisible;
}

// ===========================================================
//                    UI BUTTON
// ===========================================================

function createCenterlineButton() {
    centerlineBtn = document.createElement("button");
    centerlineBtn.innerText = "Show Centerlines";
    centerlineBtn.style.position = "absolute";
    centerlineBtn.style.bottom = "100px";
    centerlineBtn.style.right = "10px";
    centerlineBtn.style.zIndex = "1000";

    centerlineBtn.addEventListener("click", toggleRunwayCenterlines);
    document.body.appendChild(centerlineBtn);
}