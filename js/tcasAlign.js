// ===========================================================
//                   TCAS ALIGN MODULE
// ===========================================================
//
// One-shot camera alignment to match TCAS display orientation.
// Sets camera to top-down view with heading matching N97CX track.
//
// ===========================================================

let viewerRef = null;
let getN97CXPositionFn = null;  // Function to get N97CX position at a time
let alignButton = null;

// Number of seconds to look back for track calculation
const TRACK_LOOKBACK_SECONDS = 3;

/**
 * Calculate bearing between two lat/lon points
 * Returns heading in degrees (0-360)
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

/**
 * Get N97CX track direction based on recent positions
 */
function getN97CXTrack() {
    if (!viewerRef || !getN97CXPositionFn) return null;
    
    const currentTime = viewerRef.clock.currentTime;
    const previousTime = Cesium.JulianDate.addSeconds(
        currentTime, 
        -TRACK_LOOKBACK_SECONDS, 
        new Cesium.JulianDate()
    );
    
    const currentPos = getN97CXPositionFn(currentTime);
    const previousPos = getN97CXPositionFn(previousTime);
    
    if (!currentPos || !previousPos) {
        console.warn('📡 TCAS Align: Could not get N97CX positions');
        return null;
    }
    
    // Convert Cartesian3 to lat/lon
    const currentCarto = Cesium.Cartographic.fromCartesian(currentPos);
    const previousCarto = Cesium.Cartographic.fromCartesian(previousPos);
    
    const currentLat = Cesium.Math.toDegrees(currentCarto.latitude);
    const currentLon = Cesium.Math.toDegrees(currentCarto.longitude);
    const previousLat = Cesium.Math.toDegrees(previousCarto.latitude);
    const previousLon = Cesium.Math.toDegrees(previousCarto.longitude);
    
    const track = calculateBearing(previousLat, previousLon, currentLat, currentLon);
    
    console.log(`📡 TCAS Align: N97CX track = ${track.toFixed(1)}°`);
    return track;
}

/**
 * Align camera to TCAS orientation
 * Top-down view with heading matching N97CX track
 */
function alignToTCAS() {
    const track = getN97CXTrack();
    
    if (track === null) {
        console.warn('📡 TCAS Align: Cannot determine track');
        return;
    }
    
    // Get current camera position (keep altitude and location)
    const currentPosition = viewerRef.camera.positionCartographic;
    
    viewerRef.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
            currentPosition.longitude,
            currentPosition.latitude,
            currentPosition.height
        ),
        orientation: {
            heading: Cesium.Math.toRadians(track),
            pitch: Cesium.Math.toRadians(-90),  // Top down
            roll: 0
        }
    });
    
    console.log(`📡 TCAS Align: Camera aligned to track ${track.toFixed(1)}°`);
}

/**
 * Initialize the TCAS Align module
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @param {Function} positionFn - Function that takes JulianDate and returns Cartesian3 position of N97CX
 */
export function setupTCASAlign(viewer, positionFn) {
    viewerRef = viewer;
    getN97CXPositionFn = positionFn;
    
    // Create button (matches other UI buttons - minimal styling)
    alignButton = document.createElement('button');
    alignButton.textContent = 'N97CX Track Up Now';
    alignButton.style.position = 'absolute';
    alignButton.style.top = '45px';
    alignButton.style.left = '250px';
    alignButton.style.zIndex = '1000';
    alignButton.onclick = alignToTCAS;
    document.body.appendChild(alignButton);
    
    console.log('📡 TCAS Align initialized');
}

/**
 * Remove the TCAS Align module
 */
export function removeTCASAlign() {
    if (alignButton) {
        alignButton.remove();
        alignButton = null;
    }
}

/**
 * Programmatically trigger alignment
 */
export function triggerTCASAlign() {
    alignToTCAS();
}
