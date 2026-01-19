// Cesium Initialization

// ===========================================================
//                    FEATURE FLAGS
// ===========================================================
// Set to false to disable features before deployment
const FEATURES = {
    followView: true,
    runwayCenterlines: true,
    reportingPoints: true,
    audioSync: true,
    historicalApproaches: true,
};


// ===========================================================


// Vista
export const CESIUM_ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGQwODE2OC01Y2JhLTRmMWUtOGUzMS04ODk0ZDJmZjg1NmEiLCJpZCI6MTE1MTE4LCJpYXQiOjE3NDAxODU3Mzh9.cCnkmnPs-DuDqFWvJk7GI_0VpFJaiwf1DztXkfCJPBo';
// Re-export measurement functions for aircraftPanel
export { setMeasurementEnabled, setCurrentHistoricalPath };

Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;


export const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: Cesium.createWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true
    }),
    imageryProvider: false,
    baseLayerPicker: false,
    homeButton: false,
    sceneModePicker: false,
    geocoder: false,
    navigationHelpButton: false,
    fullscreenButton: false
});




window.viewer = viewer;


let n97cxPositionProperty = null;

let ionLayer, esriLayer;
let googleTileset = null;

(async () => {
    try {
        esriLayer = viewer.imageryLayers.addImageryProvider(new Cesium.ArcGisMapServerImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        }));
    } catch (error) {
        console.error('Failed to load ESRI imagery:', error);
    }
})();


const DEBUG = false;

const GROUND_GEOID_OFFSET_FT = -91.9; // in feet

const centerLon = -115.188626;
const centerLat = 36.203855;
const centerAlt = 6000;

const ATCTLat = 36.210167;
const ATCTLon = -115.189259;
const ATCTHeight = (2168 + 70 + GROUND_GEOID_OFFSET_FT) / 3.28084;  // ~654m ellipsoid height

const atctPosition = Cesium.Cartesian3.fromDegrees(ATCTLon, ATCTLat, ATCTHeight);

import { setupTranscriptSync } from './transcriptSync.js';

import { setupHistoricalMeasurement, setMeasurementEnabled, setCurrentHistoricalPath } 
    from './historicalMeasurement.js';

import { setupUIOverlay } from './uiOverlay.js';
setupUIOverlay(viewer);

// Conditional feature imports
if (FEATURES.runwayCenterlines) {
    import("./runwayCenterlines.js").then(m => m.setupRunwayCenterlines(viewer));
}

import { setupTCASDisplay } from './tcasDisplay.js';
import { setupTCASAlign } from './tcasAlign.js';

setupHistoricalMeasurement(viewer, ATCTLat, ATCTLon, ATCTHeight);

import { setupMeasurements } from "./measurements.js";
setupMeasurements(viewer, ATCTLat, ATCTLon);

import { setupAircraftPanelUI } from "./aircraftPanel.js";
import { setupATCTView } from "./atctView.js";
import { setupFollowView, disableFollowView, isFollowEnabled, updateFollowCamera }
    from "./followView.js";
import { setupFalconLimits, toggleFalconLimits, setFalconLimitsVisible } from './FalconLimits.js';
setupFalconLimits(viewer, { visible: false });
setFalconLimitsVisible(false);

import { setupViewController, createChangeViewButton } from './viewController.js';





const originalView = {
    destination: Cesium.Cartesian3.fromDegrees(centerLon,centerLat, centerAlt), // lon, lat, height (meters)
    orientation: {
        heading: Cesium.Math.toRadians(0),  // Default heading (change if needed)
        pitch: Cesium.Math.toRadians(-90),  // Looking downward
        roll: 0
    }
};

function resetToOriginalView() {
    viewer.camera.setView(originalView);
}


// After viewer and originalView are defined:
setupViewController(viewer, originalView);
createChangeViewButton(createButton, 125);

// After viewer is created, controlled by flag
const ENABLE_TCAS = true;  // Set false for VGT version

if (ENABLE_TCAS) {
    setupTCASDisplay(viewer);
    setupTCASAlign(viewer, (julianDate) => {
        return n97cxPositionProperty ? n97cxPositionProperty.getValue(julianDate) : null;
    });
}

// ----------------- Bank lookup for N97CX -----------------
export function getPiperRollAt(time) {
    let value = null;

    for (let i = piperRollData.length - 1; i >= 0; i--) {
        if (Cesium.JulianDate.lessThanOrEquals(piperRollData[i].timestamp, time)) {
            value = piperRollData[i].value;
            break;
        }
    }

    return value ?? null; // Return null, not 0
}

// ----------------- Bank lookup for any aircraft with roll data -----------------
export function getRollAt(droneID, time) {
    if (droneID !== "N97CX") return null;

    for (let i = piperRollData.length - 1; i >= 0; i--) {
        if (Cesium.JulianDate.lessThanOrEquals(piperRollData[i].timestamp, time)) {
            return piperRollData[i].value;
        }
    }
    return null;
}

/**
 * Get all active aircraft data for CDTI display
 * @param {Cesium.JulianDate} time - Current simulation time
 * @returns {Array} Array of aircraft data objects
 */
function getAircraftDataForCDTI(time) {
    const result = [];
    
    for (const [droneID, drone] of Object.entries(activeDrones)) {
        const position = drone.position?.getValue(time);
        if (!position) continue;
        
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const alt = cartographic.height * 3.28084;  // Convert to feet
        
        // Calculate heading from position delta
        let heading = 0;
        let verticalRate = 0;
        
        const prevTime = Cesium.JulianDate.addSeconds(time, -2, new Cesium.JulianDate());
        const prevPosition = drone.position?.getValue(prevTime);
        
        if (prevPosition) {
            const prevCarto = Cesium.Cartographic.fromCartesian(prevPosition);
            const dLon = cartographic.longitude - prevCarto.longitude;
            const dLat = cartographic.latitude - prevCarto.latitude;
            
            // Calculate heading (atan2 with lon/lat gives heading from north)
            if (Math.abs(dLon) > 1e-10 || Math.abs(dLat) > 1e-10) {
                heading = Math.atan2(
                    dLon * Math.cos(cartographic.latitude), 
                    dLat
                ) * 180 / Math.PI;
                if (heading < 0) heading += 360;
            }
            
            // Calculate vertical rate
            const prevAlt = prevCarto.height * 3.28084;
            verticalRate = (alt - prevAlt) * 30;  // fpm (2 sec delta)
        }
        
        result.push({
            id: droneID,
            lat: lat,
            lon: lon,
            alt: alt,
            heading: heading,
            verticalRate: verticalRate
        });
    }
    
    return result;
}

export function computeHeading(from, to) {
    const fromCarto = Cesium.Cartographic.fromCartesian(from);
    const toCarto = Cesium.Cartographic.fromCartesian(to);

    const lon1 = Cesium.Math.toRadians(fromCarto.longitude);
    const lat1 = Cesium.Math.toRadians(fromCarto.latitude);
    const lon2 = Cesium.Math.toRadians(toCarto.longitude);
    const lat2 = Cesium.Math.toRadians(toCarto.latitude);

    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let heading = Math.atan2(y, x);
    return Cesium.Math.zeroToTwoPi(heading); // Normalize
}


/**
 * Estimate bank angle (degrees) from position data.
 * Assumes coordinated turn, no wind, level flight.
 */
export function estimateBankAngle(time, positionProp) {
    const dt = 1.0; // seconds before and after
    const g = 9.81; // gravity

    // Get three times: t0 < t1 < t2
    const t1 = time;
    const t0 = Cesium.JulianDate.addSeconds(time, -dt, new Cesium.JulianDate());
    const t2 = Cesium.JulianDate.addSeconds(time, +dt, new Cesium.JulianDate());

    const p0 = positionProp.getValue(t0);
    const p1 = positionProp.getValue(t1);
    const p2 = positionProp.getValue(t2);

    if (!p0 || !p1 || !p2) return 0; // Not enough data

    // Compute headings (in radians)
    const h01 = computeHeading(p0, p1);
    const h12 = computeHeading(p1, p2);

    // Change in heading (rate of turn)
    let dHeading = h12 - h01;
    if (dHeading > Math.PI) dHeading -= 2 * Math.PI;
    if (dHeading < -Math.PI) dHeading += 2 * Math.PI;

    const turnRate = dHeading / (2 * dt); // radians per second

    // Ground speed (m/s)
    const dist = Cesium.Cartesian3.distance(p0, p2);
    const speed = dist / (2 * dt);

    // Avoid divide by zero
    if (Math.abs(turnRate) < 0.00001 || speed < 1.0) return 0;

    // Turn radius
    const radius = speed / turnRate;

    // Bank angle in radians
    const bankRad = Math.atan(speed * speed / (g * radius));

    // Return bank angle in degrees, preserve sign
    const bankDeg = Cesium.Math.toDegrees(bankRad) * Math.sign(turnRate);

    return bankDeg;
}

let lastRoll = 0;
export function getSmoothedRoll(time) {
    const raw = estimateBankAngle(time, drone.position);
    const alpha = 0.2;
    lastRoll = alpha * raw + (1 - alpha) * lastRoll;
    return lastRoll;
}


// Global history time window (outside the function)
let HISTORY_TIME_WINDOW = 30; // seconds



// ===========================================================
//                   AIRCRAFT COLOR MANAGER
// ===========================================================

// Base palette (expand anytime)
const COLOR_PALETTE = [
    Cesium.Color.RED,
    Cesium.Color.BLUE,
    Cesium.Color.AQUA,
    Cesium.Color.FUCHSIA,
    Cesium.Color.LIGHTSEAGREEN,
    Cesium.Color.PLUM,
    Cesium.Color.DARKORANGE,
    Cesium.Color.MAGENTA,
    Cesium.Color.YELLOW,
    Cesium.Color.LAWNGREEN,
    Cesium.Color.CYAN,
    Cesium.Color.INDIGO,
    Cesium.Color.SALMON,
    Cesium.Color.CHARTREUSE
];

// Aircraft color assignments
const FIXED_ASSIGNMENTS = {
    "N97CX": Cesium.Color.RED,
    "N160RA": Cesium.Color.BLUE,
    "N738CY": Cesium.Color.GREEN,
    "N466MD": Cesium.Color.MAGENTA,
    "Olsen": Cesium.Color.YELLOW,
};


// Stores all aircraft-to-color mappings
const aircraftColorMap = {};

// Public API
export function getAircraftColor(droneID) {
    // 1. Fixed assignment
    if (FIXED_ASSIGNMENTS[droneID]) {
        aircraftColorMap[droneID] = FIXED_ASSIGNMENTS[droneID];
        return FIXED_ASSIGNMENTS[droneID];
    }

    // 2. Already assigned randomly
    if (aircraftColorMap[droneID]) {
        return aircraftColorMap[droneID];
    }

    // 3. Assign next available color from palette
    const usedColors = new Set(Object.values(aircraftColorMap));
    const nextColor = COLOR_PALETTE.find(c => !usedColors.has(c)) || Cesium.Color.WHITE;

    aircraftColorMap[droneID] = nextColor;
    return nextColor;
}


// Imagery modes: 'photo' (ESRI), '3d' (Google), 'vfr' (Cesium Ion)
let currentImageryMode = 'photo';

async function cycleImagery() {
    // Clear current imagery/tileset
    if (esriLayer) {
        viewer.imageryLayers.remove(esriLayer);
        esriLayer = null;
    }
    if (ionLayer) {
        viewer.imageryLayers.remove(ionLayer);
        ionLayer = null;
    }
    if (googleTileset) {
        viewer.scene.primitives.remove(googleTileset);
        googleTileset = null;
    }

    // Cycle to next mode
    if (currentImageryMode === 'photo') {
        currentImageryMode = '3d';
    } else if (currentImageryMode === '3d') {
        currentImageryMode = 'vfr';
    } else {
        currentImageryMode = 'photo';
    }

    // Apply new mode
    if (currentImageryMode === 'photo') {
        esriLayer = viewer.imageryLayers.addImageryProvider(new Cesium.ArcGisMapServerImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        }));
        imageryButton.textContent = "Imagery - Photo";
    } else if (currentImageryMode === '3d') {
        try {
            const resource = await Cesium.IonResource.fromAssetId(2275207);
            googleTileset = new Cesium.Cesium3DTileset({ url: resource });
            viewer.scene.primitives.add(googleTileset);
            imageryButton.textContent = "Imagery - 3D";
        } catch (error) {
            console.error('Failed to load Google 3D Tiles:', error);
            currentImageryMode = 'vfr';
            ionLayer = viewer.imageryLayers.addImageryProvider(new Cesium.IonImageryProvider({
                assetId: 3128787
            }));
            imageryButton.textContent = "Imagery - VFR";
        }
    } else {
        ionLayer = viewer.imageryLayers.addImageryProvider(new Cesium.IonImageryProvider({
            assetId: 3128787
        }));
        imageryButton.textContent = "Imagery - VFR";
    }
}

// Imagery cycle button
const imageryButton = document.createElement('button');
imageryButton.textContent = "Imagery - Photo";
imageryButton.style.position = "absolute";
imageryButton.style.bottom = "75px";
imageryButton.style.right = "10px";
imageryButton.style.zIndex = "1000";
imageryButton.onclick = cycleImagery;
document.body.appendChild(imageryButton);


function createButton(text, bottomOffset, onClick) {
    const button = document.createElement("button");
    button.innerText = text;
    button.style.position = "absolute";
    button.style.bottom = `${bottomOffset}px`;
    button.style.right = "10px";
    button.style.zIndex = "1000";
    button.addEventListener("click", onClick);
    document.body.appendChild(button);
    return button;
}

const followBtn = createButton("Follow N97CX", 150, () => {});
setupFollowView(viewer, followBtn);

// Sim state - controlled by checkbox in Aircraft Panel
let simEnabled = false;

export function isSimEnabled() {
    return simEnabled;
}

export function setSimEnabled(enabled) {
    const wasEnabled = simEnabled;
    simEnabled = enabled;

    // If sim state changed, reload N97CX with appropriate data
    if (wasEnabled !== enabled && loadedDrones.has("N97CX")) {
        reloadN97CXData();
    }

    updateSimVisibility();
}

// Reload N97CX data when sim mode changes
function reloadN97CXData() {
    // Remove existing N97CX entities
    viewer.entities.removeById("N97CX");
    viewer.entities.removeById("history-N97CX");
    viewer.entities.removeById("groundline-N97CX");
    viewer.entities.removeById("fullpath-N97CX");
    removeSimPath("N97CX");

    delete activeDrones["N97CX"];
    delete droneHistories["N97CX"];
    loadedDrones.delete("N97CX");

    // Clear cached groundspeed data
    clearGSForDrone("N97CX");

    // Reload with appropriate files
    const filename = simEnabled ? "N97CX_xyz_sim.csv" : "N97CX_xyz.csv";
    loadDrone(filename, "N97CX");

    // Reload roll data
    loadPiperRollData();
}

// Update visibility of simulated path elements
function updateSimVisibility() {
    viewer.entities.values.forEach(entity => {
        if (entity.id && entity.id.startsWith("sim-dot-N97CX-")) {
            entity.show = simEnabled;
        }
    });
}



// Initialize ATCT View module
setupATCTView(viewer, ATCTLat, ATCTLon, ATCTHeight);



// Store Drone Entities
let activeDrones = {};

// Default Drones
const defaultDrones = ["N97CX", "N160RA","XSM55","N466MD","N738CY"];  //,"N90MX","N786TX"
const loadedDrones = new Set();

// Fetch List of Drone Files (Simulated for now)
const availableFiles = [
    "N97CX_xyz.csv",
    "N160RA_xyz.csv",
    "N90MX_xyz.csv",
    "N786TX_xyz.csv",
    "XSM55_xyz.csv",
    "N466MD_xyz.csv",
    "N738CY_xyz.csv",
    "Olsen_xyz.csv",
];


const availableDrones = availableFiles.map(f => f.split("_")[0]);

import { parseCSV } from './csvParser.js';
import { setupLabelMode, buildLabelText, loadGSForDrone, clearGSForDrone } from './labelMode.js';

let allTimes = [];
const droneHistories = {}; 


function loadDrone(filename, droneID) {
    if (loadedDrones.has(droneID)) return;
    loadedDrones.add(droneID);
    
    fetch(`js/data/${filename}`)
        .then(response => response.text())
        .then(data => {
            const dronePosition = new Cesium.SampledPositionProperty();

            const flightData = parseCSV(data);

            // Store N97CX position property for TCAS alignment
            if (droneID === "N97CX") {
                n97cxPositionProperty = dronePosition;
            }
            
            if (!flightData.length) {
                console.error(`No flight data for ${droneID}`);
                return;
            }
            
            // ========== Store full path positions for "All" display ==========
            const fullPathPositions = flightData.map(point => ({
                time: Cesium.JulianDate.fromIso8601(point.time + "Z"),
                position: Cesium.Cartesian3.fromDegrees(
                    point.lon,
                    point.lat,
                    (point.alt + GROUND_GEOID_OFFSET_FT) * 0.3048
                )
            }));
            
            // ========== Prepare attitude samples ==========
            const attitudeSamples = new Map();
            
            flightData.forEach(point => {
                const sampleTime = Cesium.JulianDate.fromIso8601(point.time + "Z");
                const position = Cesium.Cartesian3.fromDegrees(
                    point.lon,
                    point.lat,
                    (point.alt + GROUND_GEOID_OFFSET_FT) * 0.3048
                );
                dronePosition.addSample(sampleTime, position);
                allTimes.push(sampleTime);
                
                attitudeSamples.set(sampleTime, {
                    heading: point.course,
                    pitch: point.pitch,
                    bank: point.bank
                });
            });
            
            // Create Cesium Entity
            const color = getAircraftColor(droneID) || Cesium.Color.YELLOW;

            // For N97CX with sim enabled, don't show path trail (dots show sim instead)
            const showPath = !(droneID === "N97CX" && simEnabled);

            const drone = viewer.entities.add({
                id: droneID,
                position: dronePosition,
                point: { pixelSize: 10, color: color },
                label: {
                    text: droneID,
                    showBackground: true,
                    font: "14px sans-serif",
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM
                },
                path: showPath ? { resolution: 1, material: color, width: 2 } : undefined
            });
            
            activeDrones[droneID] = drone;
            
            // ========== Attach data for later use ==========
            drone._attitudeSamples = attitudeSamples;
            drone._fullPathPositions = fullPathPositions;  // For "All" checkbox
            
            // Add visuals
            updateDroneLabel(droneID, dronePosition);
            // Load groundspeed data - use sim file for N97CX when sim enabled
            if (droneID === "N97CX" && simEnabled) {
                loadGSForDrone(droneID, "js/data/N97CX_gs_sim.csv");
            } else {
                loadGSForDrone(droneID);
            }
            // Don't show history trail for N97CX when sim enabled (dots show sim path)
            if (!(droneID === "N97CX" && simEnabled)) {
                manageDroneHistory(droneID, dronePosition);
            }
            drawGroundLine(droneID, dronePosition);

            // Create simulated path for N97CX (dashed line after collision)
            if (droneID === "N97CX") {
                createSimPath(droneID, fullPathPositions);
            }
            
            // ========== Clock setup ==========
            if (!initialZoomDone && loadedDrones.size >= defaultDrones.length) {
                setCesiumClock();
            }
            
            if (droneID === "N97CX" && isFollowEnabled()) {
                updateFollowCamera(viewer.clock, "N97CX");
            }
        })
        .catch(error => console.error(`Error loading drone data for ${droneID}:`, error));
}


// ===========================================================
//  SETUP AIRCRAFT PANEL UI CALL (replace existing)
// ===========================================================



setupAircraftPanelUI(
    viewer,
    availableDrones,
    defaultDrones,
    // Load callback
    (droneID) => loadDrone(`${droneID}_xyz.csv`, droneID),
    // Unload callback
    (droneID) => {
        viewer.entities.removeById(droneID);
        viewer.entities.removeById(`history-${droneID}`);
        viewer.entities.removeById(`groundline-${droneID}`);
        viewer.entities.removeById(`fullpath-${droneID}`);
        delete activeDrones[droneID];
        delete droneHistories[droneID];
        loadedDrones.delete(droneID);
    },
    // Options
    {
        showFullPath: (droneID) => {
            const drone = activeDrones[droneID];
            if (!drone || !drone._fullPathPositions) {
                console.warn(`No full path data for ${droneID}`);
                return;
            }

            const color = getAircraftColor(droneID) || Cesium.Color.YELLOW;

            // For N97CX, only show pre-collision path (solid line)
            // Sim path (dashed) is shown separately when Sim is enabled
            let positions;
            if (droneID === "N97CX") {
                positions = drone._fullPathPositions.filter(p =>
                    Cesium.JulianDate.lessThanOrEquals(p.time, SIM_SPLIT_TIME)
                ).map(p => p.position);
            } else {
                // Other aircraft: extract positions from the time/position objects
                positions = drone._fullPathPositions.map(p => p.position);
            }

            viewer.entities.add({
                id: `fullpath-${droneID}`,
                polyline: {
                    positions: positions,
                    width: 3,
                    material: color.withAlpha(0.8),
                    clampToGround: false
                }
            });

        },

        hideFullPath: (droneID) => {
            viewer.entities.removeById(`fullpath-${droneID}`);
        },
        
        showHistoricalApproaches: FEATURES.historicalApproaches,
        historicalDataPath: 'js/data/historical/',
        historicalApproachFiles: [
            "20190711_184547_G02_arr_12R.csv",
            "20190823_195301_G04_arr_12R.csv",
            "20190831_181848_G06_arr_12L.csv",
            "20190921_181531_G08_arr_12R.csv",
            "20191005_183738_G10_arr_12R.csv",
            "20191013_193450_G12_arr_12R.csv",
            "20191020_193121_G14_arr_12R.csv",
            "20191102_192333_G16_arr_12R.csv",
            "20191108_185955_G18_arr_12R.csv",
            "20191117_192809_G20_arr_30L.csv",
            "20191126_204904_G22_arr_12R.csv",
            "20191201_230550_G24_arr_12R.csv",
            "20191209_225443_G26_arr_30L.csv",
            "20191229_205957_G28_arr_12R.csv",
            "20200112_225753_G30_arr_12R.csv",
            "20200125_191742_G32_arr_12R.csv",
            "20200501_200256_G34_arr_12R.csv",
            "20200509_184539_G36_arr_12R.csv",
            "20200516_192049_G38_arr_12R.csv",
            "20200525_211551_G40_arr_12R.csv",
            "20200602_174031_G42_arr_12R.csv",
            "20200612_171523_G44_arr_12R.csv",
            "20200622_202128_G46_arr_12R.csv",
            "20200627_183549_G48_arr_12R.csv",
            "20200707_005045_G50_arr_12R.csv",
            "20200801_173915_G52_arr_12R.csv",
            "20200807_192149_G54_arr_12R.csv",
            "20200829_190006_G56_arr_12R.csv",
            "20200911_220025_G58_arr_12R.csv",
            "20200926_183904_G60_arr_12R.csv",
            "20201007_205645_G62_arr_12R.csv",
            "20201014_201256_G64_arr_12R.csv",
            "20201030_192213_G66_arr_12R.csv",
            "20210301_224817_G73_arr_12R.csv",
            "20210316_183837_G75_arr_12L.csv",
            "20210328_210641_G77_arr_12R.csv",
            "20210403_183340_G79_arr_12R.csv",
            "20210410_183252_G81_arr_12R.csv",
            "20210419_185309_G83_arr_12R.csv",
            "20210607_195320_G85_arr_12R.csv",
            "20210613_165555_G87_arr_12R.csv",
            "20210624_182812_G89_arr_12R.csv",
            "20210703_175547_G91_arr_12R.csv",
            "20210713_203449_G93_arr_12R.csv",
            "20210801_204242_G95_arr_30L.csv",
            "20210823_202239_G97_arr_12R.csv",
            "20210906_203456_G99_arr_12R.csv",
            "20210925_212350_G101_arr_12R.csv",
            "20211007_182034_G103_arr_12R.csv",
            "20211017_192346_G105_arr_12L.csv",
            "20211101_203626_G107_arr_12R.csv",
            "20211113_191930_G109_arr_30L.csv",
            "20211120_171757_G111_arr_30L.csv",
            "20211126_215941_G113_arr_12R.csv",
            "20211204_192658_G115_arr_12R.csv",
            "20211218_195627_G117_arr_12R.csv",
            "20220110_215252_G119_arr_30L.csv",
            "20220124_205841_G121_arr_12R.csv",
            "20220217_195406_G123_arr_30L.csv",
            "20220227_210810_G125_arr_12R.csv",
            "20220318_205204_G127_arr_30L.csv",
            "20220403_192032_G129_arr_12R.csv",
            "20220422_192808_G131_arr_30L.csv",
            "20220504_202535_G133_arr_12R.csv",
            "20220514_182325_G135_arr_12R.csv",
            "20220604_193544_G137_arr_12R.csv",
            "20220705_191226_G139_arr_12R.csv",
            "20220717_185827_G141_arr_30R.csv"
        ]    }
);


setupLabelMode(viewer, defaultDrones);
loadPiperRollData();  // Load bank angle data for N97CX


function roundAltitude(feet) {
    return Math.round(feet / 25) * 25;
}

let piperRollData = [];

async function loadPiperRollData() {
    try {
        // Load N97CX roll data - use sim file when sim mode enabled
        const rollFile = simEnabled ? 'js/data/N97CX_roll_sim.csv' : 'js/data/N97CX_roll.csv';
        const response = await fetch(rollFile);
        const csvText = await response.text();
        const rows = csvText.split("\n").slice(1); // Skip the header

        piperRollData = rows.map(row => {
            const [timestamp, value] = row.split(",");

            return {
                timestamp: Cesium.JulianDate.fromIso8601(timestamp.trim() + "Z"),
                value: parseFloat(value)
            };
        }).filter(entry => !isNaN(entry.value));

    } catch (error) {
        console.error("Error loading Roll Data:", error);
    }
}

function updateDroneLabel(droneID, dronePosition) {
    viewer.entities.getById(droneID).label.text = new Cesium.CallbackProperty((time, result) => {
        const position = dronePosition.getValue(time);

        if (!Cesium.defined(position)) {
            return `${droneID}\nNo Data`;
        }

        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const altitudeFeet = roundAltitude(cartographic.height * 3.28084);

        // Get bank angle for N97CX
        let bankAngle = null;
        if (droneID === "N97CX") {
            for (let i = piperRollData.length - 1; i >= 0; i--) {
                if (Cesium.JulianDate.lessThanOrEquals(piperRollData[i].timestamp, time)) {
                    bankAngle = Math.round(piperRollData[i].value);
                    break;
                }
            }
        }

        // Build label using current mode
        return buildLabelText(droneID, altitudeFeet, time, bankAngle);
    }, false);
}


let lastDroneTime = {};

const historyContainer = document.createElement("div");
historyContainer.style.position = "absolute";
historyContainer.style.top = "10px";
historyContainer.style.left = "10px";
historyContainer.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
historyContainer.style.color = 'White';
historyContainer.style.padding = "10px";
historyContainer.style.borderRadius = "5px";
historyContainer.style.zIndex = "1000";
document.body.appendChild(historyContainer);

// Toggle checkbox (default on)
const historyToggle = document.createElement("input");
historyToggle.type = "checkbox";
historyToggle.id = "historyToggle";
historyToggle.checked = true;
historyToggle.style.marginRight = "6px";
historyContainer.appendChild(historyToggle);

const historyLabel = document.createElement("label");
historyLabel.innerText = "Path history (sec): ";
historyLabel.htmlFor = "historyWindow";
historyContainer.appendChild(historyLabel);

const historyInput = document.createElement("input");
historyInput.id = "historyWindow";
historyInput.type = "text";
historyInput.value = "30";
historyInput.style.width = "50px";
historyInput.style.textAlign = "center";
historyContainer.appendChild(historyInput);

historyInput.addEventListener("input", (event) => {
    const newValue = parseInt(event.target.value, 10);
    if (!isNaN(newValue) && newValue >= 5 && newValue <= 300) {
        HISTORY_TIME_WINDOW = newValue;
    }
});

historyToggle.addEventListener("change", (event) => {
    if (!event.target.checked) {
        Object.keys(droneHistories).forEach(id => {
            droneHistories[id] = [];
        });
    }
});


function manageDroneHistory(droneID, dronePosition) {
    if (!droneHistories[droneID]) {
        droneHistories[droneID] = [];
    }

    viewer.entities.removeById(`history-${droneID}`);

    viewer.entities.add({
        id: `history-${droneID}`,
        polyline: {
            positions: new Cesium.CallbackProperty((time, result) => {
                // Check if history is enabled
                const historyEnabled = historyToggle.checked;
                if (!historyEnabled) {
                    return result || [];
                }

                const currentTime = viewer.clock.currentTime;
                const latestPosition = dronePosition.getValue(currentTime);
                if (!Cesium.defined(latestPosition)) return result || [];

                // Scrub check - clear history if we went backwards in time
                if (lastDroneTime[droneID] && Cesium.JulianDate.lessThan(currentTime, lastDroneTime[droneID])) {
                    droneHistories[droneID] = [];
                }
                lastDroneTime[droneID] = currentTime.clone();

                const history = droneHistories[droneID];
                const lastEntry = history[history.length - 1];
                
                if (!lastEntry || Cesium.JulianDate.greaterThan(currentTime, lastEntry.time)) {
                    history.push({
                        time: currentTime.clone(),  // Clone to avoid reference issues
                        position: latestPosition.clone()  // Clone position too
                    });
                }

                // Prune old history
                droneHistories[droneID] = history.filter(entry =>
                    Cesium.JulianDate.secondsDifference(currentTime, entry.time) <= HISTORY_TIME_WINDOW
                );

                droneHistories[droneID].sort((a, b) =>
                    Cesium.JulianDate.compare(a.time, b.time)
                );

                return droneHistories[droneID].map(entry => entry.position);
            }, false),
            material: getAircraftColor(droneID).withAlpha(0.7),
            width: 4
        }
    });
}

// Create dotted path for simulated flight (N97CX after collision)
const SIM_SPLIT_TIME = Cesium.JulianDate.fromIso8601("2022-07-17T19:02:51.5Z");
const SIM_DOT_SPACING = 2;  // Show every Nth position as a dot

function createSimPath(droneID, fullPathPositions) {
    // Remove existing sim path dots
    removeSimPath(droneID);

    // Filter positions after split time
    const simPositions = fullPathPositions.filter(p =>
        Cesium.JulianDate.greaterThan(p.time, SIM_SPLIT_TIME)
    );

    if (simPositions.length === 0) return;

    const color = getAircraftColor(droneID).withAlpha(0.9);

    // Create point entities at intervals for dotted appearance
    // Show based on current sim state (not always hidden)
    simPositions.forEach((p, i) => {
        if (i % SIM_DOT_SPACING === 0) {
            viewer.entities.add({
                id: `sim-dot-${droneID}-${i}`,
                position: p.position,
                point: {
                    pixelSize: 4,
                    color: color,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 1
                },
                show: simEnabled  // Show based on current sim state
            });
        }
    });
}

function removeSimPath(droneID) {
    // Remove all sim dot entities for this drone
    const toRemove = [];
    viewer.entities.values.forEach(entity => {
        if (entity.id && entity.id.startsWith(`sim-dot-${droneID}-`)) {
            toRemove.push(entity);
        }
    });
    toRemove.forEach(entity => viewer.entities.remove(entity));
}



//  Ground Line
function drawGroundLine(droneID, dronePosition) {
    const groundLineID = `groundline-${droneID}`;

    // Remove old entity
    viewer.entities.removeById(groundLineID);

    const dynamicPositions = new Cesium.CallbackProperty((time, result) => {
        const droneCartesian = dronePosition.getValue(time);

        if (!Cesium.defined(droneCartesian)) {
            return [];
        }

        const carto = Cesium.Cartographic.fromCartesian(droneCartesian);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);

        const groundHeight =
            viewer.scene.globe.getHeight(
                Cesium.Cartographic.fromDegrees(lon, lat)
            ) ?? 0;

        const groundCartesian = Cesium.Cartesian3.fromDegrees(
            lon,
            lat,
            groundHeight
        );

        return [droneCartesian, groundCartesian];
    }, false);

    viewer.entities.add({
        id: groundLineID,
        polyline: {
            positions: dynamicPositions,
            material: getAircraftColor(droneID).withAlpha(0.7),
            width: 2,
            clampToGround: false
        }
    });
}



import {
    initReportingPoints,
    showAllReportingPoints,
    hideAllReportingPoints
} from "./reportingPoints.js";


let audioContext;
let audioBuffer;
let audioSource;
let audioGainNode;  // For volume control
let audioStartTime = 0; // Start time in Cesium
let isPlaying = false;
let userInteracted = false; // Tracks if user clicked Play
let isMuted = false;
let currentVolume = 0.7;  // Default volume (0-1)

const audioControlPanel = document.createElement("div");
audioControlPanel.style.cssText = `
    position: absolute;
    bottom: 30px;
    right: 120px;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: white;
    font-size: 12px;
`;
document.body.appendChild(audioControlPanel);

// Play/Enable button (required for browser autoplay policy)
const audioPlayBtn = document.createElement("button");
audioPlayBtn.innerText = "▶";
audioPlayBtn.title = "Enable Audio";
audioPlayBtn.style.cssText = `
    background: #444;
    color: white;
    border: 1px solid #666;
    border-radius: 3px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
`;
audioControlPanel.appendChild(audioPlayBtn);

// Mute checkbox
const muteContainer = document.createElement("label");
muteContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
`;
const muteCheckbox = document.createElement("input");
muteCheckbox.type = "checkbox";
muteCheckbox.checked = false;
muteCheckbox.title = "Mute audio";
muteCheckbox.style.cursor = "pointer";
const muteLabel = document.createElement("span");
muteLabel.innerText = "Mute";
muteContainer.appendChild(muteCheckbox);
muteContainer.appendChild(muteLabel);
audioControlPanel.appendChild(muteContainer);

// Volume slider
const volumeSlider = document.createElement("input");
volumeSlider.type = "range";
volumeSlider.min = "0";
volumeSlider.max = "100";
volumeSlider.value = "70";
volumeSlider.title = "Volume";
volumeSlider.style.cssText = `
    width: 80px;
    cursor: pointer;
`;
audioControlPanel.appendChild(volumeSlider);

// Volume percentage label
const volumeLabel = document.createElement("span");
volumeLabel.innerText = "70%";
volumeLabel.style.cssText = `
    min-width: 32px;
    text-align: right;
`;
audioControlPanel.appendChild(volumeLabel);

// Mute checkbox handler
muteCheckbox.addEventListener("change", () => {
    isMuted = muteCheckbox.checked;
    if (audioGainNode) {
        audioGainNode.gain.value = isMuted ? 0 : currentVolume;
    }
    volumeSlider.disabled = isMuted;
    volumeSlider.style.opacity = isMuted ? "0.4" : "1";
});

// Volume slider handler
volumeSlider.addEventListener("input", () => {
    currentVolume = volumeSlider.value / 100;
    volumeLabel.innerText = `${volumeSlider.value}%`;
    if (audioGainNode && !isMuted) {
        audioGainNode.gain.value = currentVolume;
    }
});



async function loadAudio(url) {
    audioPlayBtn.innerText = "⏳";
    audioPlayBtn.disabled = true;
    audioPlayBtn.style.opacity = "0.5";

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Create gain node for volume control
    if (!audioGainNode) {
        audioGainNode = audioContext.createGain();
        audioGainNode.gain.value = currentVolume;
        audioGainNode.connect(audioContext.destination);
    }

    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        audioPlayBtn.innerText = "▶";
        audioPlayBtn.disabled = false;
        audioPlayBtn.style.opacity = "1.0";
    } catch (err) {
        audioPlayBtn.innerText = "⚠";
        audioPlayBtn.title = "Audio Failed";
        console.error("Audio load error:", err);
    }
}

function playAudioFrom(simulationTime) {
    if (!audioBuffer || !audioContext || !userInteracted) return; // Prevent autoplay issue

    stopAudio(); // Ensure any existing audio is stopped

    const elapsedAudioTime = simulationTime - audioStartTime;
    if (elapsedAudioTime < 0 || elapsedAudioTime > audioBuffer.duration) {
        return;
    }

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioGainNode);
    audioSource.start(0, elapsedAudioTime);

    isPlaying = true;
}

function stopAudio() {
    if (audioSource) {
        audioSource.stop();
        audioSource.disconnect();
        audioSource = null;
    }
    isPlaying = false;
}

function syncAudioToClock() {
    if (!userInteracted) return; // Prevent autoplay error before user interacts

    const simulationTime = Cesium.JulianDate.secondsDifference(
        viewer.clock.currentTime,
        viewer.clock.startTime
    ) + audioStartTime;

    if (!viewer.clock.shouldAnimate) {
        stopAudio(); // Pause audio when Cesium clock is paused
    } else {
        playAudioFrom(simulationTime); // Resume from correct position
    }
}

function enableAudioPlayback() {
    if (!userInteracted) {
        userInteracted = true;

        // Only create AudioContext after user interaction
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Create gain node if not exists
        if (!audioGainNode) {
            audioGainNode = audioContext.createGain();
            audioGainNode.gain.value = isMuted ? 0 : currentVolume;
            audioGainNode.connect(audioContext.destination);
        }

        // Start audio sync with Cesium
        syncAudioToClock();

        // Update button to show audio is enabled
        audioPlayBtn.innerText = "🔊";
        audioPlayBtn.title = "Audio Enabled";
        audioPlayBtn.style.background = "#2a5";
        audioPlayBtn.disabled = true;
    }
}

audioPlayBtn.addEventListener("click", enableAudioPlayback);
viewer.clock.onTick.addEventListener(syncAudioToClock);

loadAudio("js/static/LC1_1845-1912.mp3");


function viewFromPoleTop() {
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(ATCTLon, ATCTLat, ATCTHeight),
        orientation: {
            heading: Cesium.Math.toRadians(160),   // 
            pitch: Cesium.Math.toRadians(0),   // tilt
            roll: 0
        }
    });

}


//  Set Camera View

function setDefaultCamera() {
 
    // Move the camera to fit all drones
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(centerLon,centerLat, centerAlt),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0.0
        }
    });

}

let initialZoomDone = false;
const startTime = Cesium.JulianDate.fromIso8601("2022-07-17T18:45:00Z");
const endTime = Cesium.JulianDate.fromIso8601("2022-07-17T19:10:00Z");


// Initialize transcript sync
if (FEATURES.audioSync) {
    setupTranscriptSync(
        viewer, 
        'js/static/LC1_1845-1912.srt',
        startTime  // This is your already-defined startTime = "2022-07-17T18:45:00Z"
    );
}




function setCesiumClock() {
    // Use fixed time bounds instead of allTimes array
    const startTime = Cesium.JulianDate.fromIso8601("2022-07-17T18:45:00Z");
    const endTime = Cesium.JulianDate.fromIso8601("2022-07-17T19:10:00Z");

    viewer.clock.startTime   = startTime.clone();
    viewer.clock.stopTime    = endTime.clone();
    viewer.clock.currentTime = startTime.clone();
    
    viewer.clock.clockRange   = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier   = 1;
    viewer.clock.shouldAnimate = true;

    if (viewer.timeline) {
        viewer.timeline.zoomTo(startTime, endTime);
    }

    // FOLLOW CAMERA HOOK
    viewer.clock.onTick.addEventListener((clock) => {
        if (isFollowEnabled()) {
            updateFollowCamera(clock, "N97CX");
        }
    });

    // Keep time inside [start, stop] but DO NOT disable animation
    viewer.clock.onTick.addEventListener((clock) => {
        if (Cesium.JulianDate.lessThan(clock.currentTime, viewer.clock.startTime)) {
            clock.currentTime = viewer.clock.startTime.clone();
        }
        if (Cesium.JulianDate.greaterThan(clock.currentTime, viewer.clock.stopTime)) {
            clock.currentTime = viewer.clock.stopTime.clone();
        }
    });

    if (!initialZoomDone) {
        setDefaultCamera();
        initialZoomDone = true;
    }
}



// ===========================================================
//                PLAYBACK SPEED CLAMP MODULE
// ===========================================================

const MAX_SPEED = 30;
const MIN_SPEED = -30;

// Hard clamp + optional snap to 1x if close
function clampPlaybackSpeed() {
    let m = viewer.clock.multiplier;

    // ----- HARD LIMITS -----
    if (m > MAX_SPEED) {
        viewer.clock.multiplier = MAX_SPEED;
        return;
    }
    if (m < MIN_SPEED) {
        viewer.clock.multiplier = MIN_SPEED;
        return;
    }

    // ----- OPTIONAL: SNAP NEAR 1x -----
    const SNAP_RANGE = 0.3;  // snap when between 0.7x and 1.3x

    if (Math.abs(m - 1) < SNAP_RANGE) {
        viewer.clock.multiplier = 1;
    }
}

// Attach to Cesium tick
viewer.clock.onTick.addEventListener(clampPlaybackSpeed);



const MAGNET_THRESHOLD = 0.5;

function checkPlaybackSpeed() {
    const currentSpeed = viewer.clock.multiplier;

    if (currentSpeed > 1 - MAGNET_THRESHOLD && currentSpeed < 1 + MAGNET_THRESHOLD) {
        viewer.clock.multiplier = 1;
    }
}

viewer.clock.onTick.addEventListener(checkPlaybackSpeed);


if (FEATURES.reportingPoints) {
    initReportingPoints(viewer, ATCTLat, ATCTLon);
}
