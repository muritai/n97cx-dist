// Cesium Initialization

// ===========================================================
//                    FEATURE FLAGS
// ===========================================================
// Distribution version - ghost paths and analysis tools removed
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

// ✅ Set Cesium Ion Token
Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;


// ✅ Initialize viewer only ONCE in drones.js
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

// Store all drone position properties persistently (survives entity removal)
const storedDronePositions = {};

// ✅ Store layer references
let ionLayer, esriLayer;
let googleTileset = null;

// ✅ Load ESRI World Imagery by default
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

const centerLon = -115.189259;
const centerLat = 36.206500;
const centerAlt = 10000;

const ATCTLat = 36.210167;
const ATCTLon = -115.189259;
const ATCTHeight = (2168 + 70 + GROUND_GEOID_OFFSET_FT) / 3.28084;  // ~654m ellipsoid height

const atctPosition = Cesium.Cartesian3.fromDegrees(ATCTLon, ATCTLat, ATCTHeight);

import { setupCDTI } from './cdti.js';

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

// Later, after viewer is created:

// Initialize historical measurement system
setupHistoricalMeasurement(viewer, ATCTLat, ATCTLon, ATCTHeight);

import { setupMeasurements } from "./measurements.js";
setupMeasurements(viewer, ATCTLat, ATCTLon);

if (FEATURES.azElRays) {
    import("./azElRays.js").then(m => {
        m.setupAzElRays(viewer);
        if (FEATURES.ambiguitySurface) {
            m.setupAmbiguitySurface(viewer);
        }
    });
}

import { setupAircraftPanelUI } from "./aircraftPanel.js";
import { setupATCTView } from "./atctView.js";
import { setupFollowView, disableFollowView, isFollowEnabled, updateFollowCamera }
    from "./followView.js";

import { setupFalconLimits, toggleFalconLimits, setFalconLimitsVisible } from './FalconLimits.js';

// In your initialization:
setupFalconLimits(viewer, { visible: false });

// Or set directly:
setFalconLimitsVisible(false);

// ========== Test Aircraft: PropJet (PA-46 Meridian Proxy) ==========
// Position: 1.5nm south of ATCT, bearing 180°
const TEST_AIRCRAFT_CONFIG = {
    distanceNM: 1.5,        // Distance from ATCT in nautical miles
    bearing: 180,           // Bearing from ATCT (180° = south)
    altitudeMSL: 2500,      // Altitude in feet MSL
    heading: 360,           // Aircraft heading (360° = north)
    pitch: 0,               // Pitch angle (0° = level)
    roll: 45,               // Roll angle (0° = wings level)
    // Scale: May need adjustment based on PropJet model dimensions
    scale: 1.0
};

// Calculate position from bearing and distance
function calculatePositionFromATCT(distanceNM, bearingDeg) {
    const bearingRad = Cesium.Math.toRadians(bearingDeg);
    const latOffset = (distanceNM / 60) * Math.cos(bearingRad);
    const lonOffset = (distanceNM / 60) * Math.sin(bearingRad) / Math.cos(Cesium.Math.toRadians(ATCTLat));
    return {
        lat: ATCTLat + latOffset,
        lon: ATCTLon + lonOffset
    };
}

const bonanzaPos = calculatePositionFromATCT(TEST_AIRCRAFT_CONFIG.distanceNM, TEST_AIRCRAFT_CONFIG.bearing);
const bonanzaAltMeters = (TEST_AIRCRAFT_CONFIG.altitudeMSL + GROUND_GEOID_OFFSET_FT) * 0.3048;

const bonanzaPosition = Cesium.Cartesian3.fromDegrees(bonanzaPos.lon, bonanzaPos.lat, bonanzaAltMeters);
const bonanzaHpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(TEST_AIRCRAFT_CONFIG.heading),
    Cesium.Math.toRadians(TEST_AIRCRAFT_CONFIG.pitch),
    Cesium.Math.toRadians(TEST_AIRCRAFT_CONFIG.roll)
);
const bonanzaOrientation = Cesium.Transforms.headingPitchRollQuaternion(bonanzaPosition, bonanzaHpr);

const testBonanzaEntity = viewer.entities.add({
    id: 'test-bonanza',
    name: 'PropJet (PA-46 proxy)',
    position: bonanzaPosition,
    orientation: bonanzaOrientation,
    show: false,  // Hidden by default
    model: {
        uri: 'js/models/PropJet/PropJet_NoProp.glb',
        minimumPixelSize: 32,
        scale: TEST_AIRCRAFT_CONFIG.scale,
        maximumScale: 20000
    },
    label: {
        text: `PropJet @ ${TEST_AIRCRAFT_CONFIG.distanceNM}nm`,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.6)
    }
});

// Export function to toggle test aircraft visibility
export function setTestBonanzaVisible(visible) {
    testBonanzaEntity.show = visible;
    console.log(`Test PropJet ${visible ? 'shown' : 'hidden'}: ${TEST_AIRCRAFT_CONFIG.distanceNM}nm @ ${TEST_AIRCRAFT_CONFIG.bearing}°, ${TEST_AIRCRAFT_CONFIG.altitudeMSL}' MSL`);
}

console.log(`✅ Test PropJet initialized (hidden): ${bonanzaPos.lat.toFixed(5)}°N, ${TEST_AIRCRAFT_CONFIG.altitudeMSL}' MSL, scale ${TEST_AIRCRAFT_CONFIG.scale.toFixed(3)}x`);

// ========== 3D Aircraft Models with HPB Orientation ==========
import { loadHPBData, getOrientation, isHPBLoaded } from './hpbOrientationData.js';

// Model configuration
// headingOffset: degrees to add to heading to align model forward direction with flight path
// pitchMultiplier/rollMultiplier: 1 or -1 to correct orientation for model axis differences
// swapPitchRoll: true if model's pitch/roll axes are swapped relative to expected
//
// Cessna 172 Model License (CC-BY-4.0):
// This work is based on "Cessna172" (https://sketchfab.com/3d-models/cessna172-d1b15841c29c43d0862667300bad55a4)
// by KOG_THORNS (https://sketchfab.com/ioai25312) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
const MODEL_CONFIG = {
    N97CX: {
        modelUri: 'js/models/PropJet/PropJet_NoProp.glb',
        scale: 0.809,  // Scaled to PA-46 Meridian wingspan (43 ft / 13.11m)
        label: 'N97CX 3D',
        color: '#FF6B6B',
        // PropJet model axis corrections
        headingOffset: 90,    // PropJet orientation correction
        pitchMultiplier: 1,
        rollMultiplier: -1,   // Invert roll
        swapPitchRoll: false,
        silhouetteColor: Cesium.Color.YELLOW  // Outline color
    },
    N160RA: {
        modelUri: 'js/models/cessna172/Cessna_NoProp.glb',
        scale: 0.717, // ← CORRECT (11.0m / 15.338m)
        label: 'N160RA 3D',
        color: '#4ECDC4',
        headingOffset: -90,   // C172 model points +90° from expected
        pitchMultiplier: 1,
        rollMultiplier: 1,
        swapPitchRoll: false,
        silhouetteColor: Cesium.Color.CYAN  // Outline color
    }
};

/**
 * Get model configuration for an aircraft
 */
export function getModelConfig(aircraftId) {
    return MODEL_CONFIG[aircraftId] || null;
}

// Store 3D model entities and their position properties
const model3DEntities = {};
const model3DPositions = {};  // Store position properties separately for tracking
let model3DTickHandler = null;

/**
 * Load position data from CSV for standalone 3D model creation
 */
async function loadPositionFromCSV(aircraftId) {
    const filename = `js/data/${aircraftId}_xyz.csv`;
    try {
        const response = await fetch(filename);
        const data = await response.text();
        const flightData = parseCSV(data);

        if (!flightData.length) {
            console.error(`No flight data in ${filename}`);
            return null;
        }

        const positionProperty = new Cesium.SampledPositionProperty();
        flightData.forEach(point => {
            const sampleTime = Cesium.JulianDate.fromIso8601(point.time + "Z");
            const position = Cesium.Cartesian3.fromDegrees(
                point.lon,
                point.lat,
                (point.alt + GROUND_GEOID_OFFSET_FT) * 0.3048
            );
            positionProperty.addSample(sampleTime, position);
        });

        console.log(`✅ Loaded ${flightData.length} positions from ${filename}`);
        return positionProperty;
    } catch (error) {
        console.error(`Failed to load ${filename}:`, error);
        return null;
    }
}

/**
 * Create a 3D model entity that follows XYZ position with HPB orientation
 */
async function create3DModelEntity(aircraftId) {
    const config = MODEL_CONFIG[aircraftId];
    if (!config) {
        console.error(`No model config for ${aircraftId}`);
        return null;
    }

    // Try to get position from multiple sources (in order of preference)
    let positionProperty = null;

    // 1. Check stored positions (from previously loaded drone)
    if (storedDronePositions[aircraftId]) {
        positionProperty = storedDronePositions[aircraftId];
        console.log(`Using stored position for ${aircraftId}`);
    }

    // 2. Check if base entity exists
    if (!positionProperty) {
        const droneEntity = viewer.entities.getById(aircraftId);
        if (droneEntity && droneEntity.position) {
            positionProperty = droneEntity.position;
            console.log(`Using base entity position for ${aircraftId}`);
        }
    }

    // 3. Load from CSV directly (independent mode)
    if (!positionProperty) {
        console.log(`Loading position data for ${aircraftId} from CSV...`);
        positionProperty = await loadPositionFromCSV(aircraftId);
    }

    if (!positionProperty) {
        console.error(`No position data available for ${aircraftId}`);
        return null;
    }

    // Store position property for tracking
    model3DPositions[aircraftId] = positionProperty;
    storedDronePositions[aircraftId] = positionProperty;

    // Set availability for collision aircraft (hide after impact)
    let availability = undefined;
    if (aircraftId === 'N160RA') {
        const collisionEnd = Cesium.JulianDate.fromIso8601('2022-07-17T19:02:51.598Z');
        availability = new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({
                start: Cesium.JulianDate.fromIso8601('2022-07-17T18:00:00Z'),
                stop: collisionEnd
            })
        ]);
    }

    // Create entity with model (no label for clean comparison)
    const entity = viewer.entities.add({
        id: `${aircraftId}-3d-model`,
        name: `${aircraftId} 3D Model`,
        position: positionProperty,
        availability: availability,
        show: false,  // Hidden by default
        model: {
            uri: config.modelUri,
            scale: config.scale,
            minimumPixelSize: 0,  // 0 = scale with distance (default off)
            maximumScale: 20000,
            silhouetteColor: config.silhouetteColor || Cesium.Color.WHITE,
            silhouetteSize: 0  // 0 = outline off by default
        }
    });

    model3DEntities[aircraftId] = entity;
    console.log(`✅ Created 3D model entity for ${aircraftId}`);
    
    // 🔍 DEBUG: Measure model dimensions when loaded
    // We need to wait for the model to be added to the scene and get its primitive
    const checkModelLoaded = () => {
        // Find the model primitive in the scene
        const primitives = viewer.scene.primitives;
        for (let i = 0; i < primitives.length; i++) {
            const primitive = primitives.get(i);
            if (primitive instanceof Cesium.Model && primitive.id === entity) {
                // Check if model is fully ready before accessing boundingSphere
                if (!primitive.ready) {
                    setTimeout(checkModelLoaded, 100);
                    return;
                }
                // Model is loaded
                const boundingSphere = primitive.boundingSphere;
                if (boundingSphere) {
                    const radius = boundingSphere.radius;
                    const diameter = radius * 2;
                    
                    console.log(`\n📐 3D MODEL DIMENSIONS for ${aircraftId}:`);
                    console.log(`   Model URI: ${config.modelUri}`);
                    console.log(`   Scale factor: ${config.scale}`);
                    console.log(`   Bounding sphere radius: ${radius.toFixed(3)} meters`);
                    console.log(`   Bounding sphere diameter: ${diameter.toFixed(3)} meters`);
                    console.log(`   Approximate wingspan (scaled): ${diameter.toFixed(3)} meters (${(diameter * 3.28084).toFixed(2)} feet)`);
                    
                    // For Cessna 172, expected wingspan is 11.0 meters (36.1 feet)
                    if (aircraftId === 'N160RA') {
                        const expected = 11.0;
                        const diff = diameter - expected;
                        const diffPercent = (diff / expected) * 100;
                        console.log(`   ✈️  Cessna 172 expected wingspan: 11.0 meters (36.1 feet)`);
                        console.log(`   ${Math.abs(diffPercent) < 5 ? '✅' : '⚠️'}  Difference: ${diff > 0 ? '+' : ''}${diff.toFixed(3)} meters (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);
                        if (Math.abs(diffPercent) > 5) {
                            const correctedScale = config.scale * (expected / diameter);
                            console.log(`   💡 Suggested scale adjustment: ${correctedScale.toFixed(3)}`);
                        }
                    }
                    
                    // For PropJet (PA-46 proxy), expected wingspan is 13.11 meters (43.0 feet)
                    if (aircraftId === 'N97CX') {
                        const expected = 13.11;  // PA-46 Meridian wingspan
                        const diff = diameter - expected;
                        const diffPercent = (diff / expected) * 100;
                        console.log(`   ✈️  PA-46 Meridian expected wingspan: 13.11 meters (43.0 feet)`);
                        console.log(`   ${Math.abs(diffPercent) < 5 ? '✅' : '⚠️'}  Difference: ${diff > 0 ? '+' : ''}${diff.toFixed(3)} meters (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`);
                        if (Math.abs(diffPercent) > 5) {
                            const correctedScale = config.scale * (expected / diameter);
                            console.log(`   💡 Suggested scale adjustment: ${correctedScale.toFixed(3)}`);
                        }
                    }
                    console.log('');
                }
                return; // Found it, stop checking
            }
        }
        
        // Not found yet, check again in a bit
        setTimeout(checkModelLoaded, 100);
    };
    
    // Start checking after entity is added to scene
    setTimeout(checkModelLoaded, 500);
    
    return entity;
}

/**
 * Update 3D model orientations based on current playback time
 */
function update3DModelOrientations(clock) {
    const currentTime = clock.currentTime;

    for (const [aircraftId, entity] of Object.entries(model3DEntities)) {
        if (!entity.show) continue;

        // Skip N97CX when follow is enabled - followView.js handles it directly
        // to ensure perfect sync between camera and model
        if (aircraftId === 'N97CX' && isFollowEnabled()) {
            continue;
        }

        const config = MODEL_CONFIG[aircraftId];
        if (!config) continue;

        const orientation = getOrientation(aircraftId, currentTime);
        if (!orientation) continue;

        // Get current position for orientation calculation
        const position = entity.position?.getValue ? entity.position.getValue(currentTime) : null;
        if (!position) continue;

        // Apply model-specific corrections
        const adjustedHeading = orientation.heading + (config.headingOffset || 0);

        // Swap pitch/roll if model axes are swapped
        let pitchValue = orientation.pitch;
        let rollValue = orientation.roll;
        if (config.swapPitchRoll) {
            pitchValue = orientation.roll;
            rollValue = orientation.pitch;
        }

        const adjustedPitch = pitchValue * (config.pitchMultiplier || 1);
        const adjustedRoll = rollValue * (config.rollMultiplier || 1);

        // Convert HPB to Cesium orientation
        const hpr = new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(adjustedHeading),
            Cesium.Math.toRadians(adjustedPitch),
            Cesium.Math.toRadians(adjustedRoll)
        );

        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
    }
}

/**
 * Start the orientation update tick handler
 */
function start3DModelUpdates() {
    if (model3DTickHandler) return;  // Already running

    model3DTickHandler = viewer.clock.onTick.addEventListener(update3DModelOrientations);
    console.log('✅ Started 3D model orientation updates');
}

/**
 * Stop the orientation update tick handler
 */
function stop3DModelUpdates() {
    if (!model3DTickHandler) return;

    viewer.clock.onTick.removeEventListener(model3DTickHandler);
    model3DTickHandler = null;
    console.log('⏹️ Stopped 3D model orientation updates');
}

/**
 * Toggle 3D model visibility for an aircraft
 */
export async function set3DModelVisible(aircraftId, visible) {
    let entity = model3DEntities[aircraftId];

    if (visible) {
        // Load HPB data if not already loaded
        if (!isHPBLoaded(aircraftId)) {
            console.log(`Loading HPB data for ${aircraftId}...`);
            await loadHPBData(aircraftId);
        }

        // Create entity if not exists
        if (!entity) {
            entity = await create3DModelEntity(aircraftId);
            if (!entity) return;
        }

        entity.show = true;

        // Start tick handler if any model is visible
        start3DModelUpdates();

        console.log(`🛩️ ${aircraftId} 3D model shown`);
    } else {
        if (entity) {
            entity.show = false;
        }

        // Stop tick handler if no models are visible
        const anyVisible = Object.values(model3DEntities).some(e => e && e.show);
        if (!anyVisible) {
            stop3DModelUpdates();
        }

        console.log(`🛩️ ${aircraftId} 3D model hidden`);
    }
}

/**
 * Check if a 3D model is currently visible
 */
export function is3DModelVisible(aircraftId) {
    const entity = model3DEntities[aircraftId];
    return entity && entity.show;
}

/**
 * Get the stored position property for a 3D model (for tracking)
 */
export function get3DModelPosition(aircraftId) {
    return model3DPositions[aircraftId] || null;
}

/**
 * Toggle outline (silhouette) for a 3D model
 * @returns {boolean} New outline state (true = on)
 */
export function toggle3DModelOutline(aircraftId) {
    const entity = model3DEntities[aircraftId];
    if (!entity || !entity.model) return false;

    const currentSize = entity.model.silhouetteSize?.getValue ?
        entity.model.silhouetteSize.getValue() :
        entity.model.silhouetteSize;
    const newSize = currentSize > 0 ? 0 : 2;
    entity.model.silhouetteSize = newSize;

    console.log(`${aircraftId} outline: ${newSize > 0 ? 'ON' : 'OFF'}`);
    return newSize > 0;
}

/**
 * Set outline state for a 3D model
 */
export function set3DModelOutline(aircraftId, enabled) {
    const entity = model3DEntities[aircraftId];
    if (!entity || !entity.model) return;

    const config = MODEL_CONFIG[aircraftId];
    const highlightColor = config?.silhouetteColor || Cesium.Color.YELLOW;

    // Silhouette not supported in this environment, use color highlight instead
    if (enabled) {
        // Bright highlight effect - makes model "glow" with the highlight color
        entity.model.color = highlightColor;
        entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
        entity.model.colorBlendAmount = 0.5;
    } else {
        // Reset to normal appearance
        entity.model.color = Cesium.Color.WHITE;
        entity.model.colorBlendMode = Cesium.ColorBlendMode.HIGHLIGHT;
        entity.model.colorBlendAmount = 0.0;
    }
}

/**
 * Set minimumPixelSize for all 3D models (viewable at distance toggle)
 * @param {boolean} viewable - true = always visible (48px min), false = scale with distance
 */
export function setAllModelsViewableAtDistance(viewable) {
    const pixelSize = viewable ? 48 : 0;

    // Update main aircraft models
    for (const [aircraftId, entity] of Object.entries(model3DEntities)) {
        if (entity && entity.model) {
            entity.model.minimumPixelSize = pixelSize;
        }
    }

    console.log(`All 3D models viewable at distance: ${viewable ? 'ON' : 'OFF'}`);
}

import { setupViewController, createChangeViewButton } from './viewController.js';





// 🌍 Store the Original Camera View
const originalView = {
    destination: Cesium.Cartesian3.fromDegrees(centerLon,centerLat, centerAlt), // lon, lat, height (meters)
    orientation: {
        heading: Cesium.Math.toRadians(0),  // Default heading (change if needed)
        pitch: Cesium.Math.toRadians(-90),  // Looking downward
        roll: 0
    }
};

// 🎯 Function to Reset to the Original View
function resetToOriginalView() {
    viewer.camera.setView(originalView);
    if (DEBUG) console.log("📍 Camera reset to original view.");
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

        // Always calculate heading from position delta (for CDTI display)
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

        // Velocity data (derived only in dist version)
        let Vx = null;
        let Vy = null;
        let Vz = null;
        let groundspeed = null;
        let velocitySource = 'DERIVED';

        result.push({
            id: droneID,
            lat: lat,
            lon: lon,
            alt: alt,
            heading: heading,
            verticalRate: verticalRate,
            Vx: Vx,
            Vy: Vy,
            Vz: Vz,
            groundspeed: groundspeed,
            velocitySource: velocitySource
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


// 📌 Global history time window (outside the function)
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

// ✅ Manually assign colors for known aircraft
const FIXED_ASSIGNMENTS = {
    "N97CX": Cesium.Color.RED,
    "N160RA": Cesium.Color.BLUE,
    "N738CY": Cesium.Color.GREEN,
    "N466MD": Cesium.Color.MAGENTA,
};


// Stores all aircraft-to-color mappings
const aircraftColorMap = {};

// ✅ Public API
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
        console.log('Switched to ESRI World Imagery (Photo)');
    } else if (currentImageryMode === '3d') {
        try {
            // Load Google Photorealistic 3D Tiles via Cesium Ion (legacy method)
            const resource = await Cesium.IonResource.fromAssetId(2275207);
            googleTileset = new Cesium.Cesium3DTileset({ url: resource });
            viewer.scene.primitives.add(googleTileset);
            imageryButton.textContent = "Imagery - 3D";
            console.log('Switched to Google Photorealistic 3D Tiles');
        } catch (error) {
            console.error('Failed to load Google 3D Tiles:', error);
            // Fall back to VFR on error
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
        console.log('Switched to Cesium Ion VFR Imagery');
    }
}

// ✅ Add a UI Button to Cycle Imagery
const imageryButton = document.createElement('button');
imageryButton.textContent = "Imagery - Photo";
imageryButton.style.position = "absolute";
imageryButton.style.bottom = "75px";
imageryButton.style.right = "10px";
imageryButton.style.zIndex = "1000";
imageryButton.onclick = cycleImagery;
document.body.appendChild(imageryButton);


// 🎛️ Create Buttons UI
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

// 🛠️ Add Buttons to UI


// // createButton("Reset to North", 300, resetToNorth);
// createButton("Reset View", 125, resetToOriginalView);


const followBtn = createButton("Follow N97CX", 150, () => {});
console.log("Created follow button =", followBtn);
setupFollowView(viewer, followBtn);

// ✅ Now attach actual follow behavior
setupFollowView(viewer, followBtn);



// Initialize ATCT View module
setupATCTView(viewer, ATCTLat, ATCTLon, ATCTHeight);



// Store Drone Entities
let activeDrones = {};

// Default Drones
const defaultDrones = ["N97CX", "N160RA","XSM55","N466MD","N738CY"];
const loadedDrones = new Set();

// List of drone files (distribution version - no ghost/sim/olsen/N2406P)
const availableFiles = [
    "N97CX_xyz.csv",
    "N160RA_xyz.csv",
    "N90MX_xyz.csv",
    "N786TX_xyz.csv",
    "XSM55_xyz.csv",
    "N466MD_xyz.csv",
    "N738CY_xyz.csv",
];

const availableDrones = availableFiles.map(f => f.split("_")[0]);

import { parseCSV } from './csvParser.js';
import { setupLabelMode, buildLabelText, loadGSForDrone } from './labelMode.js';

// Global variables
let allTimes = [];  // ✅ Ensure this is defined globally
const droneHistories = {}; 


// ===========================================================
//  REPLACEMENT CODE FOR drones.js
//  Replace your existing loadDrone function and setupAircraftPanelUI call
// ===========================================================

// ===========================================================
//  LOAD DRONE FUNCTION (replace existing)
// ===========================================================

function loadDrone(filename, droneID) {
    if (loadedDrones.has(droneID)) return;
    loadedDrones.add(droneID);
    
    fetch(`js/data/${filename}`)
        .then(response => response.text())
        .then(data => {
            const dronePosition = new Cesium.SampledPositionProperty();

            const flightData = parseCSV(data);

            // Store position property persistently (for 3D models and tracking)
            storedDronePositions[droneID] = dronePosition;

            // Store N97CX position property for TCAS alignment
            if (droneID === "N97CX") {
                n97cxPositionProperty = dronePosition;
            }
            
            if (!flightData.length) {
                console.error(`❌ No flight data for ${droneID}! Check CSV format.`);
                return;
            }
            
            // ========== Store full path positions for "All" display ==========
            const fullPathPositions = flightData.map(point => 
                Cesium.Cartesian3.fromDegrees(
                    point.lon,
                    point.lat,
                    (point.alt + GROUND_GEOID_OFFSET_FT) * 0.3048
                )
            );
            
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
            
            console.log(`${droneID} first time: ${flightData[0]?.time}`);
            console.log(`${droneID} last time: ${flightData[flightData.length-1]?.time}`);
            console.log(`${droneID} total samples: ${flightData.length}`);
            
            // ========== Create Cesium Entity ==========
            const color = getAircraftColor(droneID) || Cesium.Color.YELLOW;
            
            // Set availability for collision aircraft (hide after impact)
            let availability = undefined;
            if (droneID === 'N160RA') {
                // Hide N160RA 0.2 seconds after collision (19:02:51.398 + 0.2 = 19:02:51.598)
                const collisionEnd = Cesium.JulianDate.fromIso8601('2022-07-17T19:02:51.598Z');
                availability = new Cesium.TimeIntervalCollection([
                    new Cesium.TimeInterval({
                        start: Cesium.JulianDate.fromIso8601('2022-07-17T18:00:00Z'),
                        stop: collisionEnd
                    })
                ]);
            }

            // Configure path - for N160RA, no lead time (don't show future path)
            const pathConfig = {
                resolution: 1,
                material: color,
                width: 2,
                leadTime: 0,  // Don't show future positions
                trailTime: 60  // Show 60 seconds of trail
            };

            const drone = viewer.entities.add({
                id: droneID,
                position: dronePosition,
                availability: availability,
                point: { pixelSize: 10, color: color },
                label: {
                    text: droneID,
                    showBackground: true,
                    font: "14px sans-serif",
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM
                },
                path: pathConfig
            });

            activeDrones[droneID] = drone;
            
            // ========== Attach data for later use ==========
            drone._attitudeSamples = attitudeSamples;
            drone._fullPathPositions = fullPathPositions;  // For "All" checkbox
            
            if (droneID === "N97CX") {
                console.log("✅ Loaded attitude samples for N97CX:", attitudeSamples.size);
                const firstSample = [...attitudeSamples.keys()][0];
                console.log("📅 First attitude timestamp:", firstSample.toString());
            }
            
            // ========== Add visuals ==========
            updateDroneLabel(droneID, dronePosition);
            loadGSForDrone(droneID);  // Load groundspeed data for labels
            manageDroneHistory(droneID, dronePosition);
            drawGroundLine(droneID, dronePosition);
            
            // ========== Clock setup ==========
            if (!initialZoomDone && loadedDrones.size >= defaultDrones.length) {
                setCesiumClock();
            }
            
            // ========== Start follow camera if enabled ==========
            if (droneID === "N97CX" && isFollowEnabled()) {
                updateFollowCamera(viewer.clock, "N97CX");
                console.log("📸 Follow camera activated for N97CX");
            }
        })
        .catch(error => console.error(`❌ Error loading drone data for ${droneID}:`, error));
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

            // Set availability for N160RA (hide after collision + 0.2s)
            let availability = undefined;
            if (droneID === 'N160RA') {
                const collisionEnd = Cesium.JulianDate.fromIso8601('2022-07-17T19:02:51.598Z');
                availability = new Cesium.TimeIntervalCollection([
                    new Cesium.TimeInterval({
                        start: Cesium.JulianDate.fromIso8601('2022-07-17T18:00:00Z'),
                        stop: collisionEnd
                    })
                ]);
            }

            viewer.entities.add({
                id: `fullpath-${droneID}`,
                availability: availability,
                polyline: {
                    positions: drone._fullPathPositions,
                    width: 3,
                    material: color.withAlpha(0.8),
                    clampToGround: false
                }
            });

            console.log(`📍 Showing full path for ${droneID} (${drone._fullPathPositions.length} points)`);
        },
        
        hideFullPath: (droneID) => {
            viewer.entities.removeById(`fullpath-${droneID}`);
            console.log(`📍 Hiding full path for ${droneID}`);
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
            "20220717_185827_G141_arr_30L.csv"
        ]    }
);


setupCDTI(viewer, getAircraftDataForCDTI);



// Initialize label mode system (Minimal/Standard/Extended cycling)
setupLabelMode(viewer, defaultDrones);


// 📌 Function to Round Altitude to the Nearest 25 Feet
function roundAltitude(feet) {
    return Math.round(feet / 25) * 25; // Round to nearest 25 feet
}


// ✅ Load Piper Roll Data with JulianDate conversion
let piperRollData = [];

async function loadPiperRollData() {
    try {
        const response = await fetch('js/data/N97CX_roll.csv'); // Adjust path as needed
        const csvText = await response.text();
        const rows = csvText.split("\n").slice(1); // Skip the header

        piperRollData = rows.map(row => {
            const [timestamp, value] = row.split(",");

            return {
                timestamp: Cesium.JulianDate.fromIso8601(timestamp.trim() + "Z"), // Convert to Cesium.JulianDate
                value: parseFloat(value)
            };
        }).filter(entry => !isNaN(entry.value));

        console.log("✅ Piper Roll Data Loaded (Julian Dates):", piperRollData);
    } catch (error) {
        console.error("❌ Error loading Piper Roll Data:", error);
    }
}


// 🛠️ Update drone label based on current label mode
function updateDroneLabel(droneID, dronePosition) {
    viewer.entities.getById(droneID).label.text = new Cesium.CallbackProperty((time, result) => {
        const position = dronePosition.getValue(time);

        if (!Cesium.defined(position)) {
            return `${droneID}\nNo Data`;
        }

        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const altitudeFeet = roundAltitude(cartographic.height * 3.28084);

        // Get bank angle for N97CX (from existing piperRollData)
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


// 🕒 Store last recorded time per drone
let lastDroneTime = {};

// 📊 History Window Control (TOP LEFT - separate container)
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

// ✅ Add listeners RIGHT HERE, after elements exist
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


// 📌 Function to Manage Drone History (Updates & Clears as Needed)
function manageDroneHistory(droneID, dronePosition) {
    // ✅ Ensure history array is initialized
    if (!droneHistories[droneID]) {
        droneHistories[droneID] = [];
    }

    // Remove old history entity
    viewer.entities.removeById(`history-${droneID}`);

    // Set availability for N160RA (hide after collision + 0.2s)
    let availability = undefined;
    if (droneID === 'N160RA') {
        const collisionEnd = Cesium.JulianDate.fromIso8601('2022-07-17T19:02:51.598Z');
        availability = new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({
                start: Cesium.JulianDate.fromIso8601('2022-07-17T18:00:00Z'),
                stop: collisionEnd
            })
        ]);
    }

    // 🖊️ History Polyline
    viewer.entities.add({
        id: `history-${droneID}`,
        availability: availability,
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

                // ✅ Only add if this timestamp is newer than the last entry
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

                // ✅ Sort by time to ensure correct order
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



//  Ground Line
function drawGroundLine(droneID, dronePosition) {
    const groundLineID = `groundline-${droneID}`;

    // Remove old entity
    viewer.entities.removeById(groundLineID);

    // Set availability for N160RA (hide after collision + 0.2s)
    let availability = undefined;
    if (droneID === 'N160RA') {
        const collisionEnd = Cesium.JulianDate.fromIso8601('2022-07-17T19:02:51.598Z');
        availability = new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({
                start: Cesium.JulianDate.fromIso8601('2022-07-17T18:00:00Z'),
                stop: collisionEnd
            })
        ]);
    }

    const dynamicPositions = new Cesium.CallbackProperty((time, result) => {
        const droneCartesian = dronePosition.getValue(time);

        if (!Cesium.defined(droneCartesian)) {
            return [];
        }

        const carto = Cesium.Cartographic.fromCartesian(droneCartesian);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);

        // 🔥 Get the terrain elevation at that point
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
        availability: availability,
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


// Audio
// 🎵 Audio Variables
let audioContext;
let audioBuffer;
let audioSource;
let audioGainNode;  // For volume control
let audioStartTime = 0; // Start time in Cesium
let isPlaying = false;
let userInteracted = false; // Tracks if user clicked Play
let isMuted = false;
let currentVolume = 0.7;  // Default volume (0-1)

// 🎚️ Create Audio Control Panel
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



// 🔄 Load the audio file into an AudioBuffer
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
        if (DEBUG) console.log("✅ Audio file loaded!");
    } catch (err) {
        audioPlayBtn.innerText = "⚠";
        audioPlayBtn.title = "Audio Failed";
        console.error("❌ Audio load error:", err);
    }
}

// 🎵 Play audio from a specific simulation time
function playAudioFrom(simulationTime) {
    if (!audioBuffer || !audioContext || !userInteracted) return; // Prevent autoplay issue

    stopAudio(); // Ensure any existing audio is stopped

    const elapsedAudioTime = simulationTime - audioStartTime;
    if (elapsedAudioTime < 0 || elapsedAudioTime > audioBuffer.duration) {
        console.warn("🚨 Audio is out of bounds!");
        return;
    }

    // Create and start a new audio source at the correct offset
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    // Route through gain node for volume control
    audioSource.connect(audioGainNode);
    audioSource.start(0, elapsedAudioTime);

    isPlaying = true;
    if (DEBUG) console.log(`🎵 Audio started at ${elapsedAudioTime} seconds.`);
}

// ⏹️ Stop audio playback
function stopAudio() {
    if (audioSource) {
        audioSource.stop();
        audioSource.disconnect();
        audioSource = null;
    }
    isPlaying = false;
}

// 🎚️ Sync audio with Cesium clock
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

// ✅ Ensure user interaction before starting audio
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

        if (DEBUG) console.log("🔊 User clicked Play Audio, playback enabled.");
    }
}

// 🖱️ Listen for Play Button Click
audioPlayBtn.addEventListener("click", enableAudioPlayback);

// 🎯 Sync audio on every tick (but only after user interacts)
viewer.clock.onTick.addEventListener(syncAudioToClock);


loadAudio("js/static/LC1_1845-1912.mp3").then(() => {
    if (DEBUG) console.log("🔊 Audio ready to sync with Cesium clock!");
});

// // 🎵 Load audio file (but won't play until user clicks button)
// loadAudio("js/static/LC1_1845-1912.wav").then(() => {
//     if (DEBUG) console.log("🔊 Audio ready to sync with Cesium clock!");
// });


function viewFromPoleTop() {
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(ATCTLon, ATCTLat, ATCTHeight),
        orientation: {
            heading: Cesium.Math.toRadians(160),   // 
            pitch: Cesium.Math.toRadians(0),   // tilt
            roll: 0
        }
    });

    if (DEBUG) console.log("📍 Camera moved to top of the reference pole.");
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

    if (DEBUG) console.log(`✅ Camera adjusted to view all drones: Center (${centerLon}, ${centerLat}), Altitude: ${centerAlt}`);
}


let initialZoomDone = false; // Prevent re-zooming
// ✅ Define Time Bounds Globally
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

    // NOTE: Follow camera hook removed - followView.js handles this via onFollowTick
    // Having it here caused updateFollowCamera to be called twice per frame, breaking smoothing

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



// 🎚️ Define Magnet Threshold (How Close to Snap to 1x)
const MAGNET_THRESHOLD = 0.5; // Snaps when speed is between 0.7x and 1.3x

// 🔄 Monitor Playback Speed and Snap to 1x if Close
function checkPlaybackSpeed() {
    const currentSpeed = viewer.clock.multiplier;

    // ✅ Snap to 1x if within threshold
    if (currentSpeed > 1 - MAGNET_THRESHOLD && currentSpeed < 1 + MAGNET_THRESHOLD) {
        viewer.clock.multiplier = 1;
        if (DEBUG) console.log("🔄 Snapped playback speed to 1x.");
    }
}

// 🎯 Monitor Playback Speed During Scrubbing and Animation
viewer.clock.onTick.addEventListener(checkPlaybackSpeed);


// // Build Drone Toggle UI - pass feature flag for ghost paths
// setupAircraftPanelUI(
//     viewer,
//     availableDrones,
//     defaultDrones,
//     (droneID) => loadDrone(`${droneID}_xyz.csv`, droneID),   // load
//     (droneID) => {                                            // unload
//         viewer.entities.removeById(droneID);
//         viewer.entities.removeById(`history-${droneID}`);
//         viewer.entities.removeById(`groundline-${droneID}`);
//         viewer.entities.removeById(`fullpath-${droneID}`);   // Also remove full path
//         delete activeDrones[droneID];
//         delete droneHistories[droneID];
//         loadedDrones.delete(droneID);
//     },
//     { 
//         showGhostPaths: FEATURES.ghostPaths,
//         showFullPath: (droneID) => {
//             // Get the drone's full position data and create polyline
//             const drone = activeDrones[droneID];
//             if (!drone || !drone.positions) return;
            
//             viewer.entities.add({
//                 id: `fullpath-${droneID}`,
//                 polyline: {
//                     positions: drone.positions,  // All Cartesian3 positions
//                     width: 2,
//                     material: Cesium.Color.YELLOW.withAlpha(0.7)
//                 }
//             });
//         },
//         hideFullPath: (droneID) => {
//             viewer.entities.removeById(`fullpath-${droneID}`);
//         }
//     }
// );


if (FEATURES.reportingPoints) {
    initReportingPoints(viewer, ATCTLat, ATCTLon);
}
