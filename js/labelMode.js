// ===========================================================
//                   LABEL MODE MODULE
// ===========================================================
//
// Handles label display modes and groundspeed data loading.
// Cycles through: Minimal → Standard → Extended
//
// Minimal:  N97CX (callsign only)
//
// Standard: N97CX
//           4525' (altitude rounded to 25 ft)
//
// Extended: N97CX
//           4525'
//           125kt (groundspeed)
//           120kt (CAS - N97CX/N160RA only)
//           15° (bank - N97CX/N160RA only)
//
// ===========================================================

// Label modes
const LABEL_MODES = ['Minimal', 'Standard', 'Extended'];
let currentLabelMode = 1; // Start with Standard (index 1)

// Groundspeed data storage: { droneID: [{ timestamp, value }, ...] }
const groundspeedData = {};

// CAS data storage: { droneID: [{ timestamp, value }, ...] }
const casData = {};

// Bank/roll data storage: { droneID: [{ timestamp, value }, ...] }
const bankData = {};

// Reference to viewer (set during init)
let viewerRef = null;

// Button element
let labelModeButton = null;

/**
 * Load groundspeed data for a specific drone
 * @param {string} droneID - The drone identifier (e.g., "N97CX", "Ghost_080x")
 */
async function loadGroundspeedData(droneID) {
    // Construct filename - handle both regular and ghost formats
    const filename = `js/data/${droneID}_gs.csv`;
    
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
        
        console.log(`✅ GS data loaded for ${droneID}: ${groundspeedData[droneID].length} samples`);
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
 * Load CAS data for a specific drone (N97CX or N160RA only)
 * CAS files have format: totsec,z_fdr,ROC_fpm,groundspeed_kts,...,CAS_kts,bank_deg
 * Time format is "19:01:59.406" (time only, assumes 2022-07-17)
 * @param {string} droneID - The drone identifier
 */
async function loadCASData(droneID) {
    if (droneID !== 'N97CX' && droneID !== 'N160RA') return;

    const filename = `js/data/${droneID}_cas.csv`;

    try {
        const response = await fetch(filename);
        if (!response.ok) {
            console.warn(`⚠️ CAS data not found for ${droneID}: ${filename}`);
            return;
        }

        const csvText = await response.text();
        const lines = csvText.split("\n");
        const header = lines[0].split(",");

        // Find column indices
        const timeIdx = header.indexOf('totsec');
        const casIdx = header.indexOf('CAS_kts');

        if (timeIdx === -1 || casIdx === -1) {
            console.warn(`⚠️ CAS file missing required columns for ${droneID}`);
            return;
        }

        casData[droneID] = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",");
            if (cols.length <= Math.max(timeIdx, casIdx)) continue;

            const timeStr = cols[timeIdx].trim();
            const casValue = parseFloat(cols[casIdx]);

            if (!timeStr || isNaN(casValue)) continue;

            // Convert time string "19:01:59.406" to full ISO timestamp
            const fullTimestamp = `2022-07-17T${timeStr}Z`;

            casData[droneID].push({
                timestamp: Cesium.JulianDate.fromIso8601(fullTimestamp),
                value: casValue
            });
        }

        console.log(`✅ CAS data loaded for ${droneID}: ${casData[droneID].length} samples`);
    } catch (error) {
        console.warn(`⚠️ Error loading CAS data for ${droneID}:`, error.message);
    }
}

/**
 * Get CAS value for a drone at a specific time
 * @param {string} droneID - The drone identifier
 * @param {Cesium.JulianDate} time - The current time
 * @returns {number|null} - CAS in knots or null if not available
 */
export function getCAS(droneID, time) {
    const data = casData[droneID];
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
 * Load bank/roll data for a specific drone
 * Roll files have format: 2022-07-17T18:45:00,-0.14 (ISO timestamp, roll value)
 * @param {string} droneID - The drone identifier
 */
async function loadBankData(droneID) {
    if (droneID !== 'N97CX' && droneID !== 'N160RA') return;

    const filename = `js/data/${droneID}_roll.csv`;

    try {
        const response = await fetch(filename);
        if (!response.ok) {
            console.warn(`⚠️ Bank data not found for ${droneID}: ${filename}`);
            return;
        }

        const csvText = await response.text();
        const rows = csvText.split("\n");

        bankData[droneID] = rows.map(row => {
            const [timestamp, value] = row.split(",");
            if (!timestamp || !value) return null;

            return {
                timestamp: Cesium.JulianDate.fromIso8601(timestamp.trim() + "Z"),
                value: parseFloat(value)
            };
        }).filter(entry => entry !== null && !isNaN(entry.value));

        console.log(`✅ Bank data loaded for ${droneID}: ${bankData[droneID].length} samples`);
    } catch (error) {
        console.warn(`⚠️ Error loading bank data for ${droneID}:`, error.message);
    }
}

/**
 * Get bank angle for a drone at a specific time
 * @param {string} droneID - The drone identifier
 * @param {Cesium.JulianDate} time - The current time
 * @returns {number|null} - Bank angle in degrees or null if not available
 */
export function getBankAngle(droneID, time) {
    const data = bankData[droneID];
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
    console.log(`🏷️ Label mode: ${LABEL_MODES[currentLabelMode]}`);
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
 * @param {number} altitudeFeet - Altitude in feet (already rounded to 25 ft)
 * @param {Cesium.JulianDate} time - Current time
 * @param {number|null} bankAngle - Bank angle (legacy param, now fetched internally)
 * @returns {string} - Formatted label text
 */
export function buildLabelText(droneID, altitudeFeet, time, bankAngle = null) {
    const mode = LABEL_MODES[currentLabelMode];

    // Minimal: callsign only
    if (mode === 'Minimal') {
        return droneID;
    }

    // Standard: callsign + altitude
    if (mode === 'Standard') {
        return `${droneID}\n${altitudeFeet}'`;
    }

    // Extended: callsign + altitude + groundspeed + CAS + bank (CAS/bank for CX/RA only)
    let label = `${droneID}\n${altitudeFeet}'`;

    // Add groundspeed (all aircraft)
    const gs = getGroundspeed(droneID, time);
    if (gs !== null) {
        label += `\n${gs}kt`;
    }

    // Add CAS (N97CX and N160RA only)
    if (droneID === 'N97CX' || droneID === 'N160RA') {
        const cas = getCAS(droneID, time);
        if (cas !== null) {
            label += `\n${cas}cas`;
        }
    }

    // Add bank angle (N97CX and N160RA only)
    if (droneID === 'N97CX' || droneID === 'N160RA') {
        const bank = getBankAngle(droneID, time);
        if (bank !== null) {
            label += `\n${bank}°`;
        }
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
    console.log(`🏷️ Loading GS data for ${droneIDs.length} drones...`);
    await Promise.all(droneIDs.map(id => loadGroundspeedData(id)));

    // Load CAS and bank data for N97CX and N160RA
    console.log(`🏷️ Loading CAS and bank data for N97CX and N160RA...`);
    await Promise.all([
        loadCASData('N97CX'),
        loadCASData('N160RA'),
        loadBankData('N97CX'),
        loadBankData('N160RA')
    ]);

    console.log(`🏷️ Label mode system initialized (mode: ${LABEL_MODES[currentLabelMode]})`);
}

/**
 * Load GS data for a single drone (call when drone is loaded dynamically)
 * @param {string} droneID - The drone identifier
 */
export async function loadGSForDrone(droneID) {
    if (!groundspeedData[droneID]) {
        await loadGroundspeedData(droneID);
    }
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
