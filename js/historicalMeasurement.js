// ===========================================================
//              HISTORICAL MEASUREMENT MODULE
// ===========================================================
// Click on historical path to measure time, altitude, groundspeed
// Right-click measurement point to clear
// One measurement at a time

let viewer = null;
let atctLat = null;
let atctLon = null;
let atctHeight = null;

let measurementEnabled = false;
let currentHistoricalPath = null;
let currentHistoricalData = null;
let currentMeasurement = null; // Stores { dot, line, label } entity IDs

const MEASUREMENT_DOT_ID = 'historical-measurement-dot';
const MEASUREMENT_LINE_ID = 'historical-measurement-line';

/**
 * Initialize the measurement system
 */
export function setupHistoricalMeasurement(cesiumViewer, towerLat, towerLon, towerHeight) {
    viewer = cesiumViewer;
    atctLat = towerLat;
    atctLon = towerLon;
    atctHeight = towerHeight;
    
    // Set up click handler
    setupClickHandler();
    
    console.log('✅ Historical measurement system initialized');
}

/**
 * Enable/disable measurement feature
 */
export function setMeasurementEnabled(enabled) {
    measurementEnabled = enabled;
    
    if (!enabled) {
        clearMeasurement();
    }
}

/**
 * Set the current historical path being displayed
 */
export function setCurrentHistoricalPath(pathId, csvFilePath) {
    currentHistoricalPath = pathId;
    
    if (csvFilePath) {
        loadHistoricalData(csvFilePath);
    } else {
        currentHistoricalData = null;
        clearMeasurement();
    }
}

async function loadHistoricalData(csvPath) {
    try {
        const response = await fetch(csvPath);
        const csvText = await response.text();
        
        // Parse CSV
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',');
        
        // Find column indices (trim headers to handle whitespace)
        const trimmedHeaders = headers.map(h => h.trim());
        const timeIdx = trimmedHeaders.indexOf('TSDateTime');
        const latIdx = trimmedHeaders.indexOf('Latitude');
        const lonIdx = trimmedHeaders.indexOf('Longitude');
        const altIdx = trimmedHeaders.indexOf('corrected_alt');  // Pre-corrected MSL altitude
        const gsIdx = trimmedHeaders.indexOf('sm_gs');

        console.log('Headers found:', trimmedHeaders);
        console.log('Column indices:', { timeIdx, latIdx, lonIdx, altIdx, gsIdx });
        if (timeIdx === -1 || latIdx === -1 || lonIdx === -1) {
            console.error('❌ Missing required columns (lat/lon/time) in historical data');
            return;
        }

        if (altIdx === -1) {
            console.error('❌ Missing corrected_alt column - run altitude correction script');
            return;
        }

        if (gsIdx === -1) {
            console.warn('⚠️ Missing sm_gs column - groundspeed will be unavailable');
        }
        
        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length < headers.length) continue;
            
            const lat = parseFloat(values[latIdx]);
            const lon = parseFloat(values[lonIdx]);
            const alt = parseFloat(values[altIdx]);
            const gs = parseFloat(values[gsIdx]);
            
            if (isNaN(lat) || isNaN(lon) || isNaN(alt) || isNaN(gs)) continue;
            
            data.push({
                time: values[timeIdx],
                lat: lat,
                lon: lon,
                alt: alt,
                gs: gs,
                position: Cesium.Cartesian3.fromDegrees(
                    lon,
                    lat,
                    alt * 0.3048 // corrected_alt is MSL feet, convert to meters
                )
            });
        }
        
        currentHistoricalData = data;
        console.log(`📊 Loaded ${data.length} points for ${currentHistoricalPath}`);
        
    } catch (error) {
        console.error('❌ Error loading historical data:', error);
        currentHistoricalData = null;
    }
}

/**
 * Set up click handler for measurement
 */
function setupClickHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    
    // Left click - create measurement
    handler.setInputAction((click) => {
        if (!measurementEnabled) return;

        const pickedObject = viewer.scene.pick(click.position);

        // Check if clicked on historical path polyline
        if (Cesium.defined(pickedObject) &&
            pickedObject.id &&
            pickedObject.id.id &&
            pickedObject.id.id.startsWith('historical_')) {  // underscore not dash!

            // Get the clicked entity and its data points
            const clickedEntity = pickedObject.id;
            const props = clickedEntity.properties;

            if (!props || !props.dataPoints) {
                console.warn('No dataPoints found on clicked entity');
                return;
            }

            const dataPoints = props.dataPoints.getValue();
            if (!dataPoints || dataPoints.length === 0) {
                console.warn('Empty dataPoints on clicked entity');
                return;
            }

            // Get click position in 3D
            const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
            if (!cartesian) return;

            // Find nearest point in the CLICKED entity's data (not currentHistoricalData)
            const nearestPoint = findNearestDataPointInArray(cartesian, dataPoints);
            if (nearestPoint) {
                createMeasurement(nearestPoint, clickedEntity.id);
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    // Right click - clear measurement
    handler.setInputAction((click) => {
        if (!measurementEnabled) return;
        
        const pickedObject = viewer.scene.pick(click.position);
        
        // Check if clicked on measurement dot
        if (Cesium.defined(pickedObject) && 
            pickedObject.id && 
            pickedObject.id.id === MEASUREMENT_DOT_ID) {
            clearMeasurement();
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

/**
 * Find nearest data point to clicked position (legacy - uses currentHistoricalData)
 */
function findNearestDataPoint(clickedCartesian) {
    if (!currentHistoricalData || currentHistoricalData.length === 0) return null;

    let minDistance = Infinity;
    let nearestPoint = null;

    for (const point of currentHistoricalData) {
        const distance = Cesium.Cartesian3.distance(clickedCartesian, point.position);
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = point;
        }
    }

    return nearestPoint;
}

/**
 * Find nearest data point in a specific data array
 * Used when clicking on a specific entity to search only that entity's data
 */
function findNearestDataPointInArray(clickedCartesian, dataPoints) {
    if (!dataPoints || dataPoints.length === 0) return null;

    let minDistance = Infinity;
    let nearestPoint = null;

    for (const point of dataPoints) {
        const distance = Cesium.Cartesian3.distance(clickedCartesian, point.position);
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = point;
        }
    }

    return nearestPoint;
}

/**
 * Create measurement point, line, and label
 * @param {Object} dataPoint - The data point with position, time, altFeet, gs
 * @param {string} entityId - The entity ID of the clicked path (for color matching)
 */
function createMeasurement(dataPoint, entityId) {
    // Clear any existing measurement
    clearMeasurement();

    // Get path color from the clicked entity (or fall back to currentHistoricalPath)
    const pathEntity = viewer.entities.getById(entityId || currentHistoricalPath);
    let color = Cesium.Color.YELLOW;
    if (pathEntity && pathEntity.polyline && pathEntity.polyline.material) {
        color = pathEntity.polyline.material.color.getValue();
    }

    // Format time - extract just HH:MM:SS from timestamp
    const timeMatch = dataPoint.time ? dataPoint.time.match(/(\d{2}:\d{2}:\d{2})/) : null;
    const timeStr = timeMatch ? timeMatch[1] : (dataPoint.time || 'N/A');

    // Use altFeet (from entity dataPoints) or alt (from currentHistoricalData)
    const altitude = dataPoint.altFeet !== undefined ? dataPoint.altFeet : dataPoint.alt;
    const groundspeed = !isNaN(dataPoint.gs) ? Math.round(dataPoint.gs) : 'N/A';

    // Format label text
    const labelText = `${timeStr} | ${Math.round(altitude)}' | ${groundspeed}kt`;
    
    // Create measurement dot
    const dot = viewer.entities.add({
        id: MEASUREMENT_DOT_ID,
        position: dataPoint.position,
        point: {
            pixelSize: 12,
            color: color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
        },
        label: {
            text: labelText,
            font: '14px monospace',
            fillColor: Cesium.Color.WHITE,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
            showBackground: true,
            pixelOffset: new Cesium.Cartesian2(0, -25),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });
    
    // Create line from ATCT to measurement point
    const atctPosition = Cesium.Cartesian3.fromDegrees(atctLon, atctLat, atctHeight);
    
    const line = viewer.entities.add({
        id: MEASUREMENT_LINE_ID,
        polyline: {
            positions: [atctPosition, dataPoint.position],
            width: 4,
            material: new Cesium.PolylineDashMaterialProperty({
                // color: color.withAlpha(0.7),
                color: Cesium.Color.WHITE.withAlpha(0.7),
                dashLength: 16
            })
        }
    });
    
    currentMeasurement = {
        dot: MEASUREMENT_DOT_ID,
        line: MEASUREMENT_LINE_ID,
        data: dataPoint
    };
    
    console.log(`📍 Measurement: ${labelText}`);
}

/**
 * Clear current measurement
 */
function clearMeasurement() {
    if (currentMeasurement) {
        viewer.entities.removeById(currentMeasurement.dot);
        viewer.entities.removeById(currentMeasurement.line);
        currentMeasurement = null;
    }
}

/**
 * Get current measurement data (for external use)
 */
export function getCurrentMeasurement() {
    return currentMeasurement ? currentMeasurement.data : null;
}
