// ===========================================================
//                   LABEL MODE MODULE
// ===========================================================
//
// Handles label display modes and groundspeed data loading.
// Cycles through: Minimal → Standard → Extended
//
// Minimal:  N97CX
// Standard: N97CX
//           4521'
// Extended: N97CX
//           4521'
//           125kt
//           15°  (N97CX only - bank angle)
//
// ===========================================================

// Label modes
const LABEL_MODES = ['Minimal', 'Standard', 'Extended'];
let currentLabelMode = 1; // Start with Standard (index 1)

// Groundspeed data storage: { droneID: [{ timestamp, value }, ...] }
const groundspeedData = {};

// Reference to viewer (set during init)
let viewerRef = null;

// Button element
let labelModeButton = null;

/**
 * Load groundspeed data for a specific drone
 * @param {string} droneID - The drone identifier (e.g., "N97CX")
 * @param {string} [customFilename] - Optional custom filename override
 */
async function loadGroundspeedData(droneID, customFilename = null) {
    const filename = customFilename || `js/data/${droneID}_gs.csv`;
    
    try {
        const response = await fetch(filename);
        if (!response.ok) {
            console.warn(`⚠️ GS data not found for ${droneID}: ${filename}`);
            return;
        }
        
        const csvText = await response.text();
        const rows = csvText.split("\n").slice(1); // Skip header
        
        groundspeedData[droneID] = rows.map(row => {
            const [timestamp, value] = row.split(",");
            if (!timestamp || !value) return null;
            
            return {
                timestamp: Cesium.JulianDate.fromIso8601(timestamp.trim() + "Z"),
                value: parseFloat(value)
            };
        }).filter(entry => entry !== null && !isNaN(entry.value));
        
    } catch (error) {
        console.warn(`⚠️ Error loading GS data for ${droneID}:`, error.message);
    }
}

/**
 * Get groundspeed value for a drone at a specific time
 * @param {string} droneID - The drone identifier
 * @param {Cesium.JulianDate} time - The current time
 * @returns {number|null} - Groundspeed in knots or null if not available
 */
export function getGroundspeed(droneID, time) {
    const data = groundspeedData[droneID];
    if (!data || data.length === 0) return null;
    
    // Find the most recent value at or before current time
    for (let i = data.length - 1; i >= 0; i--) {
        if (Cesium.JulianDate.lessThanOrEquals(data[i].timestamp, time)) {
            return Math.round(data[i].value);
        }
    }
    return null;
}

/**
 * Get the current label mode
 * @returns {string} - 'Minimal', 'Standard', or 'Extended'
 */
export function getLabelMode() {
    return LABEL_MODES[currentLabelMode];
}

/**
 * Cycle to the next label mode
 */
function cycleLabeMode() {
    currentLabelMode = (currentLabelMode + 1) % LABEL_MODES.length;
    updateButtonText();
}

/**
 * Update button text to show current mode
 */
function updateButtonText() {
    if (labelModeButton) {
        labelModeButton.textContent = `Labels: ${LABEL_MODES[currentLabelMode]}`;
    }
}

/**
 * Build label text based on current mode
 * @param {string} droneID - The drone identifier
 * @param {number} altitudeFeet - Altitude in feet
 * @param {Cesium.JulianDate} time - Current time
 * @param {number|null} bankAngle - Bank angle (N97CX only)
 * @returns {string} - Formatted label text
 */
export function buildLabelText(droneID, altitudeFeet, time, bankAngle = null) {
    const mode = LABEL_MODES[currentLabelMode];
    
    if (mode === 'Minimal') {
        return droneID;
    }
    
    if (mode === 'Standard') {
        return `${droneID}\n${altitudeFeet}'`;
    }
    
    // Extended mode
    let label = `${droneID}\n${altitudeFeet}'`;
    
    // Add groundspeed
    const gs = getGroundspeed(droneID, time);
    if (gs !== null) {
        label += `\n${gs}kt`;
    }
    
    // Add bank angle (N97CX only)
    if (droneID === "N97CX" && bankAngle !== null) {
        label += `\n${bankAngle}°`;
    }
    
    return label;
}

/**
 * Initialize the label mode system
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @param {string[]} droneIDs - List of drone IDs to load GS data for
 */
export async function setupLabelMode(viewer, droneIDs = []) {
    viewerRef = viewer;
    
    // Create cycling button
    labelModeButton = document.createElement('button');
    labelModeButton.style.position = 'absolute';
    labelModeButton.style.top = '70px';
    labelModeButton.style.left = '260px';
    labelModeButton.style.zIndex = '1000';
    labelModeButton.onclick = cycleLabeMode;
    updateButtonText();
    document.body.appendChild(labelModeButton);
    
    // Load groundspeed data for all specified drones
    await Promise.all(droneIDs.map(id => loadGroundspeedData(id)));
    
}

/**
 * Load GS data for a single drone (call when drone is loaded dynamically)
 * @param {string} droneID - The drone identifier
 * @param {string} [customFilename] - Optional custom filename override
 */
export async function loadGSForDrone(droneID, customFilename = null) {
    if (!groundspeedData[droneID] || customFilename) {
        await loadGroundspeedData(droneID, customFilename);
    }
}

/**
 * Clear cached GS data for a drone (call before reloading)
 * @param {string} droneID - The drone identifier
 */
export function clearGSForDrone(droneID) {
    delete groundspeedData[droneID];
}

/**
 * Remove the label mode system
 */
export function removeLabelMode() {
    if (labelModeButton) {
        labelModeButton.remove();
        labelModeButton = null;
    }
}
