// ===========================================================
//                   ADS-B VELOCITY DATA MODULE
// ===========================================================
//
// Loads and interpolates ADS-B velocity data (Vx, Vy, Vz) for
// accurate TAU calculations in the CDTI display.
//
// Data sources:
//   - ADSB: Actual ADS-B velocity reports
//   - DERIVED-PPB: Position-based derived velocity
//
// ===========================================================

// Storage for velocity data per aircraft
const velocityData = new Map();

// Reference to Cesium viewer for time conversion
let viewerRef = null;

/**
 * Parse ISO timestamp to seconds since midnight UTC
 * @param {string} isoTime - ISO 8601 timestamp
 * @returns {number} Seconds since midnight UTC
 */
function parseTimeToSeconds(isoTime) {
    // Ensure timestamp is treated as UTC (add Z if not present)
    const utcTime = isoTime.endsWith('Z') ? isoTime : isoTime + 'Z';
    const date = new Date(utcTime);
    return date.getUTCHours() * 3600 +
           date.getUTCMinutes() * 60 +
           date.getUTCSeconds() +
           date.getUTCMilliseconds() / 1000;
}

/**
 * Parse ISO timestamp to JulianDate
 * @param {string} isoTime - ISO 8601 timestamp
 * @returns {Cesium.JulianDate} Julian date
 */
function parseTimeToJulian(isoTime) {
    // Ensure timestamp is treated as UTC (add Z if not present)
    const utcTime = isoTime.endsWith('Z') ? isoTime : isoTime + 'Z';
    return Cesium.JulianDate.fromIso8601(utcTime);
}

/**
 * Load ADS-B velocity data from CSV file
 * @param {string} aircraftId - Aircraft identifier (e.g., 'N97CX')
 * @param {string} csvPath - Path to CSV file
 * @returns {Promise<boolean>} Success status
 */
async function loadADSBVelocityFile(aircraftId, csvPath) {
    try {
        const response = await fetch(csvPath);
        if (!response.ok) {
            console.warn(`ADSB Velocity: Could not load ${csvPath}`);
            return false;
        }

        const text = await response.text();
        const lines = text.trim().split('\n');

        if (lines.length < 2) {
            console.warn(`ADSB Velocity: Empty file ${csvPath}`);
            return false;
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const timeIdx = header.indexOf('time');
        const latIdx = header.indexOf('lat');
        const lonIdx = header.indexOf('lon');
        const altIdx = header.indexOf('alt');
        const vxIdx = header.indexOf('vx');
        const vyIdx = header.indexOf('vy');
        const vzIdx = header.indexOf('vz');
        const sourceIdx = header.indexOf('source');

        if (timeIdx < 0 || vxIdx < 0 || vyIdx < 0) {
            console.error(`ADSB Velocity: Missing required columns in ${csvPath}`);
            return false;
        }

        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < Math.max(timeIdx, vxIdx, vyIdx) + 1) continue;

            const timeStr = cols[timeIdx].trim();
            const entry = {
                time: timeStr,
                julianDate: parseTimeToJulian(timeStr),
                seconds: parseTimeToSeconds(timeStr),
                lat: latIdx >= 0 ? parseFloat(cols[latIdx]) : null,
                lon: lonIdx >= 0 ? parseFloat(cols[lonIdx]) : null,
                alt: altIdx >= 0 ? parseFloat(cols[altIdx]) : null,
                Vx: parseFloat(cols[vxIdx]),
                Vy: parseFloat(cols[vyIdx]),
                Vz: vzIdx >= 0 ? parseFloat(cols[vzIdx]) : 0,
                source: sourceIdx >= 0 ? cols[sourceIdx].trim() : 'UNKNOWN'
            };

            // Validate numeric values
            if (!isNaN(entry.Vx) && !isNaN(entry.Vy) &&
                !isNaN(entry.lat) && !isNaN(entry.lon) && !isNaN(entry.alt)) {
                data.push(entry);
            }
        }

        // Sort by time
        data.sort((a, b) => a.seconds - b.seconds);

        // Store in map
        velocityData.set(aircraftId, {
            data: data,
            source: data.length > 0 ? data[0].source : 'UNKNOWN'
        });

        // console.log(`ADSB Velocity: Loaded ${data.length} points for ${aircraftId} (${data.length > 0 ? data[0].source : 'empty'})`);
        return true;

    } catch (err) {
        console.error(`ADSB Velocity: Error loading ${csvPath}:`, err);
        return false;
    }
}

/**
 * Load velocity data for multiple aircraft
 * @param {string[]} aircraftIds - Array of aircraft IDs
 * @param {string} basePath - Base path to CDTI data folder
 * @returns {Promise<number>} Number of successfully loaded files
 */
async function loadAllADSBVelocity(aircraftIds, basePath = 'js/data/CDTI') {
    let loaded = 0;

    const promises = aircraftIds.map(async (id) => {
        const csvPath = `${basePath}/${id}_adsb.csv`;
        const success = await loadADSBVelocityFile(id, csvPath);
        if (success) loaded++;
        return success;
    });

    await Promise.all(promises);
    // console.log(`ADSB Velocity: Loaded ${loaded}/${aircraftIds.length} aircraft velocity files`);
    return loaded;
}

/**
 * Get interpolated velocity at a specific time
 * @param {string} aircraftId - Aircraft identifier
 * @param {Cesium.JulianDate} julianDate - Time to query
 * @returns {Object|null} {Vx, Vy, Vz, groundspeed, track, source} or null if not available
 */
function getADSBVelocity(aircraftId, julianDate) {
    const aircraft = velocityData.get(aircraftId);
    if (!aircraft || aircraft.data.length === 0) {
        return null;
    }

    const data = aircraft.data;
    // Convert query time to seconds since midnight for comparison
    const queryDate = Cesium.JulianDate.toDate(julianDate);
    const querySecOfDay = queryDate.getUTCHours() * 3600 +
                          queryDate.getUTCMinutes() * 60 +
                          queryDate.getUTCSeconds() +
                          queryDate.getUTCMilliseconds() / 1000;

    // Find bracketing points
    let before = null;
    let after = null;

    for (let i = 0; i < data.length; i++) {
        if (data[i].seconds <= querySecOfDay) {
            before = data[i];
        }
        if (data[i].seconds >= querySecOfDay && after === null) {
            after = data[i];
        }
        if (before && after) break;
    }

    // Handle edge cases
    if (!before && !after) return null;
    if (!before) before = after;
    if (!after) after = before;

    // Interpolate
    let lat, lon, alt, Vx, Vy, Vz;
    if (before === after || before.seconds === after.seconds) {
        lat = before.lat;
        lon = before.lon;
        alt = before.alt;
        Vx = before.Vx;
        Vy = before.Vy;
        Vz = before.Vz;
    } else {
        const t = (querySecOfDay - before.seconds) / (after.seconds - before.seconds);
        lat = before.lat + t * (after.lat - before.lat);
        lon = before.lon + t * (after.lon - before.lon);
        alt = before.alt + t * (after.alt - before.alt);
        Vx = before.Vx + t * (after.Vx - before.Vx);
        Vy = before.Vy + t * (after.Vy - before.Vy);
        Vz = before.Vz + t * (after.Vz - before.Vz);
    }

    // Calculate groundspeed and track from Vx, Vy
    const groundspeed = Math.sqrt(Vx * Vx + Vy * Vy);
    let track = Math.atan2(Vx, Vy) * 180 / Math.PI;
    if (track < 0) track += 360;

    return {
        lat: lat,
        lon: lon,
        alt: alt,
        Vx: Vx,
        Vy: Vy,
        Vz: Vz,
        groundspeed: groundspeed,
        track: track,
        source: aircraft.source
    };
}

/**
 * Get ADS-B sample at fixed cadence (for CDTI).
 * @param {string} aircraftId - Aircraft identifier
 * @param {Cesium.JulianDate} julianDate - Time to query
 * @param {number} sampleDtSeconds - Sample cadence in seconds
 * @returns {Object|null} {lat, lon, alt, Vx, Vy, Vz, groundspeed, track, source} or null
 */
function getADSBSample(aircraftId, julianDate, sampleDtSeconds = 1) {
    const aircraft = velocityData.get(aircraftId);
    if (!aircraft || aircraft.data.length === 0) {
        return null;
    }

    const data = aircraft.data;
    const queryDate = Cesium.JulianDate.toDate(julianDate);
    const querySecOfDay = queryDate.getUTCHours() * 3600 +
                          queryDate.getUTCMinutes() * 60 +
                          queryDate.getUTCSeconds() +
                          queryDate.getUTCMilliseconds() / 1000;

    const snappedSec = Math.round(querySecOfDay / sampleDtSeconds) * sampleDtSeconds;

    if (snappedSec < data[0].seconds || snappedSec > data[data.length - 1].seconds) {
        return null;
    }

    let before = null;
    let after = null;

    for (let i = 0; i < data.length; i++) {
        if (data[i].seconds <= snappedSec) {
            before = data[i];
        }
        if (data[i].seconds >= snappedSec && after === null) {
            after = data[i];
        }
        if (before && after) break;
    }

    if (!before || !after) return null;

    let lat, lon, alt, Vx, Vy, Vz;
    if (before === after || before.seconds === after.seconds) {
        lat = before.lat;
        lon = before.lon;
        alt = before.alt;
        Vx = before.Vx;
        Vy = before.Vy;
        Vz = before.Vz;
    } else {
        const t = (snappedSec - before.seconds) / (after.seconds - before.seconds);
        lat = before.lat + t * (after.lat - before.lat);
        lon = before.lon + t * (after.lon - before.lon);
        alt = before.alt + t * (after.alt - before.alt);
        Vx = before.Vx + t * (after.Vx - before.Vx);
        Vy = before.Vy + t * (after.Vy - before.Vy);
        Vz = before.Vz + t * (after.Vz - before.Vz);
    }

    const groundspeed = Math.sqrt(Vx * Vx + Vy * Vy);
    let track = Math.atan2(Vx, Vy) * 180 / Math.PI;
    if (track < 0) track += 360;

    return {
        lat: lat,
        lon: lon,
        alt: alt,
        Vx: Vx,
        Vy: Vy,
        Vz: Vz,
        groundspeed: groundspeed,
        track: track,
        source: aircraft.source
    };
}

/**
 * Check if velocity data is available for an aircraft
 * @param {string} aircraftId - Aircraft identifier
 * @returns {boolean} True if data is loaded
 */
function hasADSBVelocity(aircraftId) {
    return velocityData.has(aircraftId) && velocityData.get(aircraftId).data.length > 0;
}

/**
 * Get list of aircraft with loaded velocity data
 * @returns {string[]} Array of aircraft IDs
 */
function getLoadedAircraft() {
    return Array.from(velocityData.keys());
}

/**
 * Clear all loaded velocity data
 */
function clearADSBVelocity() {
    velocityData.clear();
    // console.log('ADSB Velocity: Cleared all data');
}

/**
 * Initialize the velocity module
 * @param {Cesium.Viewer} viewer - Cesium viewer reference
 */
function initADSBVelocity(viewer) {
    viewerRef = viewer;
}

// Export functions
export {
    initADSBVelocity,
    loadADSBVelocityFile,
    loadAllADSBVelocity,
    getADSBVelocity,
    getADSBSample,
    hasADSBVelocity,
    getLoadedAircraft,
    clearADSBVelocity
};
