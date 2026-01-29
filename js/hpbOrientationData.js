// ===========================================================
//              HPB ORIENTATION DATA MODULE
// ===========================================================
// Loads heading/pitch/bank (roll) data for 3D aircraft model orientation
//
// Data files:
//   N97CX:  js/data/HPB/Flight Path Perf_CX_HPB.csv (default)
//           js/data/HPB/Flight Path Perf_CX_HPB_NTSB.csv (NTSB version)
//   N160RA: js/data/HPB/Flight Path Perf_RA_HPB.csv
//
// Provides interpolated orientation for any playback time
// ===========================================================

// ========== Configuration ==========
// Set to true to use NTSB HPB data for N97CX (Piper), false for default
export const USE_NTSB_HPB_FOR_N97CX = false;

// Date prefix for converting HH:MM:SS.mmm to full ISO timestamp
const DATE_PREFIX = '2022-07-17T';

// Stored orientation data: { aircraftId: [ {julianTime, heading, pitch, roll}, ... ] }
const orientationData = {};

// Loading state
const loadingPromises = {};

/**
 * Parse time string (HH:MM:SS.mmm) to Cesium JulianDate
 */
function parseTimeToJulian(timeStr) {
    // Handle both "HH:MM:SS.mmm" and already-full timestamps
    const isoStr = timeStr.includes('T') ? timeStr : DATE_PREFIX + timeStr;
    return Cesium.JulianDate.fromIso8601(isoStr + 'Z');
}

/**
 * Parse N97CX HPB CSV format:
 * simtime, hdg_deg_T, pitch_deg, bank_deg
 */
function parseN97CXFormat(csvText) {
    const lines = csvText.trim().split('\n');
    const data = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 4) continue;

        const timeStr = cols[0].trim();
        const heading = parseFloat(cols[1]);  // hdg_deg_T (true heading)
        const pitch = parseFloat(cols[2]);    // pitch_deg
        const roll = parseFloat(cols[3]);     // bank_deg

        if (isNaN(heading) || isNaN(pitch) || isNaN(roll)) continue;

        data.push({
            julianTime: parseTimeToJulian(timeStr),
            heading: heading,
            pitch: pitch,
            roll: roll
        });
    }

    return data;
}

/**
 * Parse N160RA HPB CSV format:
 * totsec, true_course_deg, hdg_deg_T, pitch_deg, bank_deg
 */
function parseN160RAFormat(csvText) {
    const lines = csvText.trim().split('\n');
    const data = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 5) continue;

        const timeStr = cols[0].trim();       // "totsec" column but contains HH:MM:SS.mmm
        const heading = parseFloat(cols[2]);  // hdg_deg_T (true heading)
        const pitch = parseFloat(cols[3]);    // pitch_deg
        const roll = parseFloat(cols[4]);     // bank_deg

        if (isNaN(heading) || isNaN(pitch) || isNaN(roll)) continue;

        data.push({
            julianTime: parseTimeToJulian(timeStr),
            heading: heading,
            pitch: pitch,
            roll: roll
        });
    }

    return data;
}

/**
 * Load HPB data for an aircraft
 */
export async function loadHPBData(aircraftId) {
    // Return cached data if already loaded
    if (orientationData[aircraftId]) {
        return orientationData[aircraftId];
    }

    // Return existing loading promise if in progress
    if (loadingPromises[aircraftId]) {
        return loadingPromises[aircraftId];
    }

    // Determine file path and parser
    let filePath, parser;
    if (aircraftId === 'N97CX') {
        if (USE_NTSB_HPB_FOR_N97CX) {
            filePath = 'js/data/HPB/Flight Path Perf_CX_HPB_NTSB.csv';
            parser = parseN160RAFormat;  // NTSB format matches N160RA (5 columns)
        } else {
            filePath = 'js/data/HPB/Flight Path Perf_CX_HPB.csv';
            parser = parseN97CXFormat;
        }
    } else if (aircraftId === 'N160RA') {
        filePath = 'js/data/HPB/Flight Path Perf_RA_HPB.csv';
        parser = parseN160RAFormat;
    } else {
        console.error(`Unknown aircraft ID for HPB data: ${aircraftId}`);
        return null;
    }

    // Load and parse
    loadingPromises[aircraftId] = (async () => {
        try {
            const response = await fetch(filePath);
            if (!response.ok) {
                throw new Error(`Failed to load ${filePath}: ${response.status}`);
            }
            const csvText = await response.text();
            const data = parser(csvText);

            // Sort by time
            data.sort((a, b) => Cesium.JulianDate.compare(a.julianTime, b.julianTime));

            orientationData[aircraftId] = data;
            console.log(`✅ Loaded ${data.length} HPB samples for ${aircraftId}`);

            if (data.length > 0) {
                const first = data[0];
                const last = data[data.length - 1];
                console.log(`   Time range: ${Cesium.JulianDate.toIso8601(first.julianTime)} to ${Cesium.JulianDate.toIso8601(last.julianTime)}`);
            }

            return data;
        } catch (error) {
            console.error(`❌ Error loading HPB data for ${aircraftId}:`, error);
            return null;
        }
    })();

    return loadingPromises[aircraftId];
}

/**
 * Get interpolated orientation for an aircraft at a specific time
 * Returns { heading, pitch, roll } in degrees, or null if no data
 */
export function getOrientation(aircraftId, julianTime) {
    const data = orientationData[aircraftId];
    if (!data || data.length === 0) return null;

    // Binary search for surrounding samples
    let low = 0;
    let high = data.length - 1;

    // Check bounds
    if (Cesium.JulianDate.lessThanOrEquals(julianTime, data[0].julianTime)) {
        return { heading: data[0].heading, pitch: data[0].pitch, roll: data[0].roll };
    }
    if (Cesium.JulianDate.greaterThanOrEquals(julianTime, data[high].julianTime)) {
        return { heading: data[high].heading, pitch: data[high].pitch, roll: data[high].roll };
    }

    // Binary search
    while (low < high - 1) {
        const mid = Math.floor((low + high) / 2);
        if (Cesium.JulianDate.lessThan(julianTime, data[mid].julianTime)) {
            high = mid;
        } else {
            low = mid;
        }
    }

    // Linear interpolation
    const t0 = data[low];
    const t1 = data[high];

    const totalSeconds = Cesium.JulianDate.secondsDifference(t1.julianTime, t0.julianTime);
    const elapsedSeconds = Cesium.JulianDate.secondsDifference(julianTime, t0.julianTime);
    const t = totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0;

    // Interpolate heading (handle wraparound)
    let h0 = t0.heading;
    let h1 = t1.heading;

    // Normalize headings to 0-360 range
    while (h0 < 0) h0 += 360;
    while (h1 < 0) h1 += 360;
    while (h0 >= 360) h0 -= 360;
    while (h1 >= 360) h1 -= 360;

    // Handle wraparound (e.g., interpolating from 350° to 10°)
    let headingDiff = h1 - h0;
    if (headingDiff > 180) headingDiff -= 360;
    if (headingDiff < -180) headingDiff += 360;

    let heading = h0 + headingDiff * t;
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;

    return {
        heading: heading,
        pitch: t0.pitch + (t1.pitch - t0.pitch) * t,
        roll: t0.roll + (t1.roll - t0.roll) * t
    };
}

/**
 * Check if HPB data is loaded for an aircraft
 */
export function isHPBLoaded(aircraftId) {
    return orientationData[aircraftId] && orientationData[aircraftId].length > 0;
}

/**
 * Get the time range of HPB data for an aircraft
 */
export function getHPBTimeRange(aircraftId) {
    const data = orientationData[aircraftId];
    if (!data || data.length === 0) return null;

    return {
        start: data[0].julianTime,
        end: data[data.length - 1].julianTime
    };
}
