// ===========================================================
//                   CDTI DISPLAY MODULE
// ===========================================================
//
// Cockpit Display of Traffic Information - live updating
// Track-up display centered on N97CX showing relative traffic
//
// ===========================================================

// ===========================================================
//           GARMIN G500/600 ADS-B SYMBOLOGY (Table 7-4)
// ===========================================================
// Based on Garmin G500/600 Pilot's Guide Rev H, Table 7-4
//
// Traffic Symbol Shapes (Directional = valid heading available):
//   TA (Traffic Advisory):     Yellow circle (open if non-dir, with arrow if dir)
//   Proximate Directional:     Filled cyan chevron/arrow
//   Proximate Non-Directional: Filled cyan diamond
//   Basic Directional:         Open cyan chevron/arrow
//   Basic Non-Directional:     Open cyan diamond
//   Surface Vehicle:           Brown square with tail
//
// Off-Scale Symbols (at display edge):
//   Alerted: Half yellow circle
//   Basic/Proximate: Chevron pointing down (toward center)
//
// Vertical Trend Arrows:
//   Up arrow:   Climbing > 500 fpm
//   Down arrow: Descending > 500 fpm
//   No arrow:   Level or <= 500 fpm
//
// NOTE: RTCA/TCAS symbols preserved in rtcaSymbols.js
// ===========================================================

// Colors per Garmin G500/600 standard
const CDTI_COLORS = {
    RA: '#FF0000',      // Red - Resolution Advisory (TCAS II only, not GDL 88)
    TA: '#FFFF00',      // Yellow - Traffic Advisory
    PA: '#CCCCCC',      // Gray - Proximity Advisory (Proximate traffic)
    OTHER: '#CCCCCC',   // Gray - Basic/Other Traffic
    SURFACE: '#8B4513', // Brown (SaddleBrown) - Surface vehicles
    OWNSHIP: '#FFFFFF', // White - Ownship symbol
};

// Altitude filter modes
const ALTITUDE_FILTERS = {
    NORMAL: { below: -2700, above: 2700, label: 'NORM' },   // ±2,700 ft
    ABV:    { below: -2700, above: 9000, label: 'ABV' },    // -2,700 to +9,000 ft
    BLW:    { below: -9000, above: 2700, label: 'BLW' },    // -9,000 to +2,700 ft
    XTD:    { below: -9000, above: 9000, label: 'XTD' },    // ±9,000 ft
};

// ===========================================================
//           GDL 88 SENSITIVITY LEVELS (Table 4-2)
// ===========================================================
// Altitude-dependent traffic alert sensitivity per GDL 88 Rev E
// Note: Levels 2-3 are TCAS-specific, GDL 88 CSA starts at Level 4
// Uses HAT (Height Above Terrain/Radio Altitude) when available,
// otherwise falls back to GPS phase or ownship MSL altitude
const GDL88_SENSITIVITY_LEVELS = [
    { level: 4, minAlt: 0,     maxAlt: 1000,  tau: 20, vertThreshold: 850,  protectedVol: 0.20, phase: 'Approach' },
    { level: 5, minAlt: 1000,  maxAlt: 2350,  tau: 25, vertThreshold: 850,  protectedVol: 0.20, phase: 'Terminal' },
    { level: 6, minAlt: 2350,  maxAlt: 5000,  tau: 30, vertThreshold: 850,  protectedVol: 0.35, phase: 'Enroute <=5k' },
    { level: 7, minAlt: 5000,  maxAlt: 10000, tau: 40, vertThreshold: 850,  protectedVol: 0.55, phase: 'Enroute 5-10k' },
    { level: 8, minAlt: 10000, maxAlt: 20000, tau: 45, vertThreshold: 850,  protectedVol: 0.80, phase: 'Enroute 10-20k' },
    { level: 9, minAlt: 20000, maxAlt: 42000, tau: 48, vertThreshold: 850,  protectedVol: 1.10, phase: 'Enroute 20-42k' },
];

/**
 * Get GDL 88 sensitivity level based on ownship altitude
 * Per GDL 88 Rev E Table 4-2, CSA algorithm uses levels 4-9
 *
 * Priority order:
 * 1. HAT available → use HAT for SL4-5 selection, MSL for SL6-9
 * 2. HAT unavailable, GPS phase available → APPROACH=SL4, TERMINAL=SL5
 * 3. HAT unavailable, no GPS phase → use MSL altitude for SL6-9
 *
 * @param {number} mslAltitudeFt - Ownship MSL altitude in feet
 * @param {number|null} hatFt - Height Above Terrain in feet (null if unavailable)
 * @returns {Object} Sensitivity level parameters with source info
 */
function getSensitivityLevel(mslAltitudeFt, hatFt = null) {
    // GDL 88 CSA algorithm uses levels 4-9 (levels 2-3 are TCAS-specific)
    let altitudeForLookup;
    let source;

    if (hatFt !== null && CDTI_CONFIG.hatAvailable) {
        // HAT available - use HAT for low altitude levels (SL4-5)
        // Above 2350 ft HAT, use MSL for SL6-9
        if (hatFt < 2350) {
            altitudeForLookup = hatFt;
            source = 'HAT';
        } else {
            altitudeForLookup = mslAltitudeFt;
            source = 'MSL';
        }
    } else {
        // HAT unavailable - check GPS phase first
        if (CDTI_CONFIG.gpsPhase === 'APPROACH') {
            // Approach phase → SL4 (most restrictive)
            const sl4 = GDL88_SENSITIVITY_LEVELS.find(l => l.level === 4);
            return { ...sl4, source: 'GPS_APPROACH' };
        } else if (CDTI_CONFIG.gpsPhase === 'TERMINAL') {
            // Terminal phase → SL5
            const sl5 = GDL88_SENSITIVITY_LEVELS.find(l => l.level === 5);
            return { ...sl5, source: 'GPS_TERMINAL' };
        } else {
            // No GPS phase - use MSL altitude for SL6-9
            // Since we can't confirm low altitude, minimum is SL6
            altitudeForLookup = Math.max(mslAltitudeFt, 2350);  // Floor at SL6
            source = 'MSL_FALLBACK';
        }
    }

    // Look up sensitivity level based on altitude
    for (const level of GDL88_SENSITIVITY_LEVELS) {
        if (altitudeForLookup >= level.minAlt && altitudeForLookup < level.maxAlt) {
            return { ...level, source };
        }
    }

    // Default to highest level (SL9) if above range
    const highest = GDL88_SENSITIVITY_LEVELS[GDL88_SENSITIVITY_LEVELS.length - 1];
    return { ...highest, source };
}

// Configuration
const CDTI_CONFIG = {
    rangeRings: [2],               // nm - configurable range rings (GTN style)
    maxRange: 2,                   // nm - display radius
    updateInterval: 100,           // ms - how often to redraw
    ownshipID: 'N97CX',
    compassTickInterval: 10,       // degrees between tick marks
    altitudeFilter: 'NORMAL',      // Current altitude filter mode
    verticalRateThreshold: 500,    // fpm - threshold for trend arrows
    showUTCClock: true,            // Toggle UTC clock display for screen capture
    // TAU (time-based) alerting thresholds (defaults, overridden by GDL88 sensitivity)
    tauEnabled: true,              // Enable TAU-based TA alerting
    tauThreshold: 20,              // seconds - default, overridden by sensitivity level
    tauDistanceThreshold: 0.20,    // nm - default, overridden by sensitivity level
    tauAltitudeThreshold: 850,     // ft - default, overridden by sensitivity level
    // GDL 88 altitude-based sensitivity
    useGDL88Sensitivity: true,     // Use altitude-based sensitivity levels from Table 4-2
    hatAvailable: true,            // Whether HAT (Height Above Terrain) is available
    gpsPhase: 'NONE',              // GPS flight phase: 'APPROACH', 'TERMINAL', 'NONE'
    kvgtElevation: 2113.5,         // KVGT airport ellipsoidal elevation for HAT calculation (ft MSL)
    // Motion vector configuration (G500 Table 4-21)
    motionVectorMode: 'ABSOLUTE',  // 'ABSOLUTE', 'RELATIVE', or 'OFF'
    motionVectorDuration: 60,      // seconds (30, 60, 120, 300)
    // Directional arrow configuration (G500 Table 4-21)
    showDirectionalArrows: true,   // Show heading arrows inside traffic symbols
    // DO-317B Divergence Test configuration
    divergenceTestEnabled: true,       // Enable TA suppression when target is diverging
    divergenceThreshold: 0,            // Consecutive seconds of divergence required to suppress TA
    divergenceMode: 'HORIZONTAL',      // 'HORIZONTAL' (closureRate < 0) or 'COMBINED' (horiz AND vert)
};

// KVGT Runway definitions (threshold coords from FAA data - converted from DMS)
const KVGT_RUNWAYS = [
    // Runway 12L/30R (southwest runway)
    { 
        name: '12L/30R',
        start: { lat: 36.21242, lon: -115.19642 },  // 12L threshold
        end: { lat: 36.20475, lon: -115.18672 }     // 30R threshold
    },
    // Runway 12R/30L (northeast runway)
    { 
        name: '12R/30L',
        start: { lat: 36.21468, lon: -115.20267 },  // 12R threshold  
        end: { lat: 36.20508, lon: -115.19054 }     // 30L threshold
    },
    // Runway 7/25 (crosses 12R/30L near 12R threshold)
    {
        name: '7/25',
        start: { lat: 36.21330, lon: -115.20337 },  // 7 threshold
        end: { lat: 36.21363, lon: -115.18642 }     // 25 threshold
    }
];

// Module state
let viewerRef = null;
let cdtiCanvas = null;
let cdtiCtx = null;
let cdtiOverlay = null;
let cdtiButton = null;
let exportButton = null;
let cdtiLegend = null;
let cdtiTAAlertBox = null;      // TA aural alert text display element
let isVisible = false;
let isLegendVisible = false;
let updateTimer = null;
let getAircraftDataFn = null;  // Function to get all aircraft positions
let lastTAAlertTime = 0;        // Timestamp of last TA alert (for persistence)
let lastTAMessageLockTime = 0;  // Timestamp when text message was first set (lock duration)
let lastTAAudioTime = 0;        // Timestamp of last TA audio processing (rewind guard)
let lastTAIds = new Set();      // Track active TA targets to dedupe spoken alerts
let lastProcessedTimeMs = 0;    // Rewind detection: last simulation time processed

// Threat persistence tracking (sequential verification per DO-317B)
// Tracks consecutive seconds each target has met TA/PA criteria
const threatPersistence = {
    history: {},        // { targetId: { level, startTime, lastTime, confirmedTime, paConfirmedTime } }
    threshold: 0,       // Seconds required before upgrading to TA (0 = disabled)
    paThreshold: 0,     // Seconds required before upgrading to PA (0 = disabled)
    holdDuration: 2400, // ms - minimum TA display time per DO-317B (6 seconds)
    paHoldDuration: 2400,  // ms - minimum PA display time (0 = disabled)
    maxAge: 10000,      // ms - remove stale entries older than this
};

// Divergence tracking (DO-317B divergence test)
// Tracks consecutive seconds a TA-level target has been diverging
const divergenceTracking = {
    history: {},        // { targetId: { startTime: ms, lastTime: ms } }
    maxAge: 5000,       // ms - remove stale entries older than this
};

// Altitude smoothing (3-point moving average to reduce ADS-B jitter)
const altitudeSmoothing = {
    history: {},        // { targetId: [alt1, alt2, alt3] } - recent altitude readings
    windowSize: 1,      // Number of samples to average
    maxAge: 5000,       // ms - remove stale entries older than this
};

/**
 * Calculate closure rate between two aircraft (horizontal and vertical)
 * Uses actual ADS-B Vx/Vy/Vz when available, falls back to estimates
 *
 * @param {Object} ownship - Ownship state {lat, lon, heading, Vx, Vy, Vz, verticalRate, groundspeed}
 * @param {Object} target - Target state {lat, lon, heading, Vx, Vy, Vz, verticalRate, groundspeed}
 * @param {number} distanceNm - Current horizontal distance in nm
 * @param {Object} relPos - Relative position {x, y} in nm (East, North)
 * @param {number} relAltFt - Relative altitude in feet (target - ownship)
 * @returns {Object} Closure info including horizontal tau, vertical tau, and modified tau
 */
function calculateClosure(ownship, target, distanceNm, relPos, relAltFt) {
    let ownVx, ownVy, tgtVx, tgtVy;
    let velocitySource = 'ESTIMATED';

    // Use actual ADS-B velocity if available
    if (ownship.Vx !== null && ownship.Vx !== undefined &&
        ownship.Vy !== null && ownship.Vy !== undefined) {
        ownVx = ownship.Vx;
        ownVy = ownship.Vy;
        velocitySource = ownship.velocitySource || 'ADSB';
    } else {
        // Fall back to heading-based estimate
        const ownHdgRad = (ownship.heading || 0) * Math.PI / 180;
        const ownGS = ownship.groundspeed || 120;  // knots default
        ownVx = ownGS * Math.sin(ownHdgRad);
        ownVy = ownGS * Math.cos(ownHdgRad);
    }

    if (target.Vx !== null && target.Vx !== undefined &&
        target.Vy !== null && target.Vy !== undefined) {
        tgtVx = target.Vx;
        tgtVy = target.Vy;
    } else {
        // Fall back to heading-based estimate
        const tgtHdgRad = (target.heading || 0) * Math.PI / 180;
        const tgtGS = target.groundspeed || 100;  // knots default
        tgtVx = tgtGS * Math.sin(tgtHdgRad);
        tgtVy = tgtGS * Math.cos(tgtHdgRad);
        velocitySource = 'ESTIMATED';
    }

    // Get vertical rates (Vz from ADS-B or verticalRate from position delta)
    const ownVz = ownship.Vz ?? ownship.verticalRate ?? 0;  // fpm
    const tgtVz = target.Vz ?? target.verticalRate ?? 0;    // fpm

    // ========== HORIZONTAL CLOSURE ==========
    // Relative velocity (target relative to ownship)
    const relVx = tgtVx - ownVx;
    const relVy = tgtVy - ownVy;

    let horizClosureRate = 0;
    let horizTauSeconds = Infinity;

    if (distanceNm >= 0.001) {
        // Line of sight unit vector from ownship to target
        const losX = relPos.x / distanceNm;
        const losY = relPos.y / distanceNm;

        // Horizontal closure rate in knots (positive = closing, negative = diverging)
        horizClosureRate = -(relVx * losX + relVy * losY);

        // Horizontal TAU: time to reach distance threshold
        if (horizClosureRate > 0) {
            const distToThreshold = distanceNm - CDTI_CONFIG.tauDistanceThreshold;
            if (distToThreshold > 0) {
                // closureRate is in knots (nm/hour), convert to seconds
                horizTauSeconds = (distToThreshold / horizClosureRate) * 3600;
            } else {
                horizTauSeconds = 0;  // Already inside threshold
            }
        }
    }

    // ========== VERTICAL CLOSURE ==========
    // Vertical closure rate: positive = altitude separation decreasing (converging)
    // Must account for whether target is above or below ownship:
    //   Target above (relAltFt > 0): converging when ownVz > tgtVz (we rise or they descend)
    //   Target below (relAltFt < 0): converging when tgtVz > ownVz (they rise or we descend)
    //   Co-altitude (relAltFt == 0): no separation to close
    const vertClosureRate = -Math.sign(relAltFt) * (tgtVz - ownVz);  // fpm

    let vertTauSeconds = Infinity;
    const altSeparation = Math.abs(relAltFt);

    // Only calculate vertical tau if converging vertically
    if (vertClosureRate > 0 && altSeparation > 0) {
        // vertClosureRate is in fpm, altSeparation is in ft
        // tau = separation / rate = ft / (ft/min) = minutes, convert to seconds
        vertTauSeconds = (altSeparation / vertClosureRate) * 60;
    }

    // ========== MODIFIED TAU (TCAS-style) ==========
    // Use minimum of horizontal and vertical tau when converging vertically
    let modTauSeconds;
    if (vertClosureRate > 0) {
        modTauSeconds = Math.min(horizTauSeconds, vertTauSeconds);
    } else {
        // Diverging vertically - use horizontal tau only
        modTauSeconds = horizTauSeconds;
    }

    return {
        closureRate: horizClosureRate,           // Horizontal closure (kts)
        tauSeconds: horizTauSeconds,             // Horizontal tau (seconds)
        vertClosureRate: vertClosureRate,        // Vertical closure (fpm, + = converging)
        vertTauSeconds: vertTauSeconds,          // Vertical tau (seconds)
        modTauSeconds: modTauSeconds,            // Modified tau (seconds)
        velocitySource: velocitySource
    };
}

/**
 * Classify traffic threat level based on RTCA/TCAS standards
 * Now includes TAU-based alerting with modified tau (horizontal + vertical)
 * Uses GDL 88 Table 4-2 altitude-dependent sensitivity levels when enabled
 *
 * @param {number} distanceNm - Horizontal distance in nautical miles
 * @param {number} relAltFt - Relative altitude in feet (target - ownship)
 * @param {Object} closureInfo - Closure info from calculateClosure()
 * @param {number} ownshipAlt - Ownship altitude in feet MSL (for sensitivity level)
 * @returns {Object} Threat classification with trigger details
 */
function classifyThreat(distanceNm, relAltFt, closureInfo = null, ownshipAlt = null) {
    const absRelAlt = Math.abs(relAltFt);

    // Get sensitivity level based on ownship altitude (GDL 88 Table 4-2)
    let sensitivity;
    if (CDTI_CONFIG.useGDL88Sensitivity && ownshipAlt !== null) {
        const hat = ownshipAlt - CDTI_CONFIG.kvgtElevation;
        sensitivity = getSensitivityLevel(ownshipAlt, hat);
    } else {
        // Fallback to fixed defaults (SL7 equivalent - 5000-10000ft MSL)
        sensitivity = { level: 7, tau: 40, vertThreshold: 850, protectedVol: 0.55, phase: 'Default', source: 'DEFAULT' };
    }

    // Use sensitivity level values for dynamic thresholds
    const tauThreshold = sensitivity.tau;
    const altThreshold = sensitivity.vertThreshold;
    const protectedVolume = sensitivity.protectedVol;

    // Extract closure info with defaults
    const horizTauSeconds = closureInfo?.tauSeconds ?? Infinity;
    const vertTauSeconds = closureInfo?.vertTauSeconds ?? Infinity;
    const modTauSeconds = closureInfo?.modTauSeconds ?? Infinity;
    const closureRate = closureInfo?.closureRate ?? 0;
    const vertClosureRate = closureInfo?.vertClosureRate ?? 0;
    const velocitySource = closureInfo?.velocitySource ?? 'UNKNOWN';

    // Result object with trigger details
    const result = {
        level: 'OTHER',
        distTrigger: false,
        tauTrigger: false,
        vertTauTrigger: false,
        tauSeconds: horizTauSeconds,
        vertTauSeconds: vertTauSeconds,
        modTauSeconds: modTauSeconds,
        tauThreshold: tauThreshold,            // GDL 88 Look-Ahead Time from Table 4-2
        closureRate: closureRate,
        vertClosureRate: vertClosureRate,
        velocitySource: velocitySource,
        altThreshold: null,    // Will be set based on threat level
        distThreshold: null,   // Will be set based on threat level
        altTrigger: false,     // Whether altitude is within threshold
        sensitivityLevel: sensitivity.level,  // GDL 88 sensitivity level
        sensitivityPhase: sensitivity.phase,  // Flight phase description
        sensitivitySource: sensitivity.source // Source of sensitivity selection (HAT, MSL, GPS_APPROACH, etc.)
    };

    // Resolution Advisory (RA) - TCAS II only (NOT available on GDL 88)
    // GDL 88 is a TAS (Traffic Alert System) that only generates TAs
    // RA logic is skipped when using GDL 88 sensitivity levels
    if (!CDTI_CONFIG.useGDL88Sensitivity) {
        // TCAS II mode: RA for very close traffic
        if (distanceNm <= 0.20 && absRelAlt <= 600) {
            result.level = 'RA';
            result.distTrigger = true;
            result.altThreshold = 600;
            result.distThreshold = 0.20;
            result.altTrigger = absRelAlt <= 600;
            return result;
        }
    }

    // Traffic Advisory (TA) - GDL 88 primary alert type
    // Condition 1: Within protected volume AND vertical threshold
    const inTADistanceZone = distanceNm <= protectedVolume && absRelAlt <= altThreshold;

    // Condition 2: TAU-based using sensitivity level's tau threshold
    // Horizontal tau with altitude gate
    const horizTauTriggered = CDTI_CONFIG.tauEnabled &&
                              horizTauSeconds <= tauThreshold &&
                              absRelAlt <= altThreshold;

    // Vertical tau: converging vertically and within time threshold
    const vertTauTriggered = CDTI_CONFIG.tauEnabled &&
                             vertClosureRate > 0 &&
                             vertTauSeconds <= tauThreshold;

    // Combined: TCAS requires both horizontal AND vertical proximity.
    // Vertical tau alone is not sufficient — it acts as a vertical gate
    // when horizontal tau is also within threshold, preventing false TAs
    // on vertically converging traffic that is far away horizontally.
    const tauTriggered = horizTauTriggered ||
                         (vertTauTriggered && horizTauSeconds <= tauThreshold);

    if (inTADistanceZone || tauTriggered) {
        result.level = 'TA';
        result.distTrigger = inTADistanceZone;
        result.tauTrigger = horizTauTriggered && !inTADistanceZone;
        result.vertTauTrigger = vertTauTriggered && !inTADistanceZone && !horizTauTriggered;
        result.altThreshold = altThreshold;
        result.distThreshold = protectedVolume;
        result.altTrigger = absRelAlt <= altThreshold;
        return result;
    }

    // Proximity Advisory (PA)
    // Within 6nm AND ±1,200 ft (fixed thresholds per Garmin US011543)
    if (distanceNm <= 6.0 && absRelAlt <= 1200) {
        result.level = 'PA';
        result.distTrigger = true;
        result.altThreshold = 1200;
        result.distThreshold = 6.0;
        result.altTrigger = absRelAlt <= 1200;
        return result;
    }

    // Other Traffic (non-alerting)
    return result;
}

/**
 * Apply sequential verification (persistence filtering) to threat level
 * Per DO-317B, alerts should persist for N consecutive seconds before triggering
 * This prevents nuisance alerts from momentary threshold crossings
 *
 * @param {string} targetId - Target aircraft identifier
 * @param {string} rawLevel - Raw threat level from classifyThreat ('RA', 'TA', 'PA', 'OTHER')
 * @param {number} currentTimeMs - Current simulation time in milliseconds
 * @returns {string} Filtered threat level
 */
function applyThreatPersistence(targetId, rawLevel, currentTimeMs) {
    const history = threatPersistence.history;
    const threshold = threatPersistence.threshold;
    const holdDuration = threatPersistence.holdDuration;

    // Clean up stale entries periodically
    if (Math.random() < 0.01) {  // 1% chance each call
        const cutoff = currentTimeMs - threatPersistence.maxAge;
        for (const id in history) {
            if (history[id].lastTime < cutoff) {
                delete history[id];
            }
        }
    }

    // Get or create history entry for this target
    if (!history[targetId]) {
        history[targetId] = { level: 'OTHER', startTime: 0, lastTime: currentTimeMs, confirmedTime: 0, paConfirmedTime: 0 };
    }
    const entry = history[targetId];

    // Update timestamp
    entry.lastTime = currentTimeMs;

    // If raw level is TA (or RA), check upgrade persistence using elapsed time
    if (rawLevel === 'TA' || rawLevel === 'RA') {
        if (entry.level === rawLevel) {
            // Same level as before — check elapsed time since first seen
        } else {
            // Level changed (upgrade or downgrade) — restart the timer
            entry.level = rawLevel;
            entry.startTime = currentTimeMs;
        }

        // Elapsed seconds since this threat level was first seen
        const elapsedMs = currentTimeMs - entry.startTime;

        // Only return TA/RA if persistence threshold met (0 = disabled)
        if (threshold === 0 || elapsedMs >= threshold * 1000) {
            // Mark the time this TA was first confirmed (for hold duration)
            if (!entry.confirmedTime) {
                entry.confirmedTime = currentTimeMs;
            }
            entry.paConfirmedTime = 0;  // Clear PA hold — target is now at TA level
            return rawLevel;
        } else {
            // Not enough elapsed time — show PA instead of TA
            return 'PA';
        }
    } else {
        // Raw level dropped below TA (now PA or OTHER)
        // DO-317B hold: maintain TA for holdDuration after it was confirmed
        if (entry.confirmedTime > 0 && (currentTimeMs - entry.confirmedTime) < holdDuration) {
            // Still within hold window - keep showing TA
            return 'TA';
        }

        // Hold expired or never confirmed - allow downgrade
        entry.confirmedTime = 0;

        // PA persistence: require paThreshold seconds before showing PA
        const paThreshold = threatPersistence.paThreshold;
        if (rawLevel === 'PA') {
            if (entry.level === 'PA') {
                // Same level — check elapsed time since first seen
            } else {
                // Just entered PA — start timer
                entry.level = 'PA';
                entry.startTime = currentTimeMs;
            }
            const elapsedMs = currentTimeMs - entry.startTime;
            if (paThreshold === 0 || elapsedMs >= paThreshold * 1000) {
                if (!entry.paConfirmedTime) {
                    entry.paConfirmedTime = currentTimeMs;
                }
                return 'PA';
            } else {
                return 'OTHER';
            }
        }

        // PA hold: maintain PA for paHoldDuration after it was confirmed
        const paHoldDuration = threatPersistence.paHoldDuration;
        if (entry.paConfirmedTime > 0 && (currentTimeMs - entry.paConfirmedTime) < paHoldDuration) {
            return 'PA';
        }
        // PA hold expired or never confirmed — reset
        entry.paConfirmedTime = 0;

        // OTHER — reset tracking
        entry.level = rawLevel;
        entry.startTime = 0;
        return rawLevel;
    }
}

/**
 * Apply DO-317B divergence test to suppress nuisance TAs
 * If a target classified as TA has been diverging for N consecutive
 * seconds, downgrade the alert to PA.
 *
 * Divergence defined by CDTI_CONFIG.divergenceMode:
 *   'HORIZONTAL': closureRate < 0 (target moving away horizontally)
 *   'COMBINED':   closureRate < 0 AND vertClosureRate < 0 (both diverging)
 *
 * @param {string} targetId - Target aircraft identifier
 * @param {string} persistedLevel - Threat level after persistence filter
 * @param {number} closureRate - Horizontal closure rate in kts (negative = diverging)
 * @param {number} vertClosureRate - Vertical closure rate in fpm (negative = diverging)
 * @param {number} currentTimeMs - Current simulation time in milliseconds
 * @returns {Object} { level, isDiverging, divergenceCount, suppressed }
 */
function applyDivergenceTest(targetId, persistedLevel, closureRate, vertClosureRate, currentTimeMs) {
    const result = {
        level: persistedLevel,
        isDiverging: false,
        divergenceCount: 0,
        suppressed: false
    };

    // Only apply to TA-level targets when feature is enabled
    if (!CDTI_CONFIG.divergenceTestEnabled || persistedLevel !== 'TA') {
        // Reset divergence tracking if target is no longer TA
        if (divergenceTracking.history[targetId]) {
            divergenceTracking.history[targetId].startTime = 0;
        }
        return result;
    }

    // Determine if target is currently diverging
    let isDiverging = false;
    if (CDTI_CONFIG.divergenceMode === 'COMBINED') {
        isDiverging = (closureRate < 0) && (vertClosureRate < 0);
    } else {
        // Default: HORIZONTAL only
        isDiverging = (closureRate < 0);
    }
    result.isDiverging = isDiverging;

    // Get or create history entry
    const history = divergenceTracking.history;
    if (!history[targetId]) {
        history[targetId] = { startTime: 0, lastTime: currentTimeMs };
    }
    const entry = history[targetId];
    entry.lastTime = currentTimeMs;

    if (isDiverging) {
        // Start timer on first diverging call, keep it on subsequent ones
        if (!entry.startTime) {
            entry.startTime = currentTimeMs;
        }
    } else {
        // Reset — must be N CONSECUTIVE seconds of divergence
        entry.startTime = 0;
    }

    // Elapsed seconds of consecutive divergence
    const elapsedMs = entry.startTime ? (currentTimeMs - entry.startTime) : 0;
    result.divergenceCount = entry.startTime ? Math.floor(elapsedMs / 1000) : 0;

    // Check threshold (seconds)
    const threshold = CDTI_CONFIG.divergenceThreshold;
    if (threshold > 0 && elapsedMs >= threshold * 1000) {
        // Suppress TA -> downgrade to PA
        result.level = 'PA';
        result.suppressed = true;
    }

    // Periodic cleanup of stale entries
    if (Math.random() < 0.01) {
        const cutoff = currentTimeMs - divergenceTracking.maxAge;
        for (const id in history) {
            if (history[id].lastTime < cutoff) {
                delete history[id];
            }
        }
    }

    return result;
}

/**
 * Apply 3-point moving average smoothing to altitude
 * Reduces ADS-B altitude jitter that causes alert flickering
 *
 * @param {string} targetId - Target aircraft identifier
 * @param {number} rawAltitude - Raw altitude reading in feet
 * @param {number} currentTimeMs - Current simulation time in milliseconds
 * @returns {number} Smoothed altitude
 */
function smoothAltitude(targetId, rawAltitude, currentTimeMs) {
    const history = altitudeSmoothing.history;
    const windowSize = altitudeSmoothing.windowSize;

    // Clean up stale entries periodically
    if (Math.random() < 0.01) {  // 1% chance each call
        const cutoff = currentTimeMs - altitudeSmoothing.maxAge;
        for (const id in history) {
            if (history[id].lastTime < cutoff) {
                delete history[id];
            }
        }
    }

    // Get or create history entry for this target
    if (!history[targetId]) {
        history[targetId] = { altitudes: [], lastTime: currentTimeMs };
    }
    const entry = history[targetId];

    // Update timestamp
    entry.lastTime = currentTimeMs;

    // Add new altitude to history
    entry.altitudes.push(rawAltitude);

    // Keep only last N samples
    while (entry.altitudes.length > windowSize) {
        entry.altitudes.shift();
    }

    // Calculate moving average
    const sum = entry.altitudes.reduce((a, b) => a + b, 0);
    return sum / entry.altitudes.length;
}

/**
 * Check if traffic passes altitude filter
 * @param {number} relAltFt - Relative altitude in feet
 * @returns {boolean} True if traffic should be displayed
 */
function passesAltitudeFilter(relAltFt) {
    const filter = ALTITUDE_FILTERS[CDTI_CONFIG.altitudeFilter];
    return relAltFt >= filter.below && relAltFt <= filter.above;
}

// ===========================================================
//           GDL 88 AURAL ALERT TEXT DISPLAY
// ===========================================================
// Per GDL 88 documentation, when a TA is generated, the system announces:
// "Traffic! X O'clock, Low/High, X Miles"
// These functions build the visual equivalent of that aural alert.

/**
 * Convert relative bearing to clock position (1-12)
 * @param {number} relBearingDeg - Bearing relative to ownship heading in degrees
 * @returns {number} Clock position (1-12)
 */
function bearingToClockPosition(relBearingDeg) {
    // Normalize to 0-360
    let bearing = ((relBearingDeg % 360) + 360) % 360;
    // Convert to clock: 0° = 12, 30° = 1, 60° = 2, etc.
    let clock = Math.round(bearing / 30);
    if (clock === 0) clock = 12;
    return clock;
}

/**
 * Determine vertical position callout (Low, High, or Same Altitude)
 * Uses ±400ft threshold
 * @param {number} relAltFt - Relative altitude in feet (target - ownship)
 * @returns {string} "Low", "High", or "Same Altitude"
 */
function getVerticalPosition(relAltFt) {
    if (relAltFt > 400) return 'High';
    if (relAltFt < -400) return 'Low';
    return 'Same Altitude';
}

/**
 * Bin distance to callout values
 * ≤0.85nm returns "Less than a mile", otherwise rounded integer miles
 * @param {number} distanceNm - Actual distance in nautical miles
 * @returns {string} Binned distance string
 */
function binDistance(distanceNm) {
    if (distanceNm <= 0.85) return 'Less than a mile';
    return String(Math.round(distanceNm));
}

/**
 * Build the GDL 88 CSA aural alert message
 * Format: "Traffic! X O'clock, [Low|High|Same Altitude], [Less than a mile|X Miles]"
 *
 * @param {number} relX - Relative East position in nm
 * @param {number} relY - Relative North position in nm
 * @param {number} ownHeading - Ownship heading in degrees
 * @param {number} relAltFt - Relative altitude in feet (target - ownship)
 * @param {number} distanceNm - Distance in nautical miles
 * @returns {string} Alert message
 */
function buildTAAlertMessage(relX, relY, ownHeading, relAltFt, distanceNm) {
    // Calculate geographic bearing from ownship to traffic (from North)
    const geoBearing = Math.atan2(relX, relY) * 180 / Math.PI;
    // Convert to relative bearing (from ownship heading)
    const relBearing = geoBearing - ownHeading;

    const clock = bearingToClockPosition(relBearing);
    const vertical = getVerticalPosition(relAltFt);
    const distance = binDistance(distanceNm);

    // Distance phrasing: "Less than a mile" or "X Miles"
    const distancePhrase = distance === 'Less than a mile'
        ? distance
        : `${distance} ${distance === '1' ? 'Mile' : 'Miles'}`;

    return `Traffic! ${clock} O'clock, ${vertical}, ${distancePhrase}`;
}

/**
 * Update the TA alert text box display
 * Once shown, text stays on screen for 5 seconds regardless of TA state.
 * Text content is also locked for that duration to prevent flicker.
 * @param {string|null} message - Alert message to display, or null if no active TA
 * @param {number} currentTimeMs - Current simulation time in milliseconds
 */
const TA_TEXT_DISPLAY_MS = 5000;  // Text box visible duration (seconds)

function updateTAAlertDisplay(message, currentTimeMs) {
    if (!cdtiTAAlertBox) return;

    // Detect backwards scrolling (rewinding) - hide alert immediately
    if (currentTimeMs < lastTAAlertTime) {
        cdtiTAAlertBox.style.display = 'none';
        lastTAAlertTime = 0;
        lastTAMessageLockTime = 0;
        return;
    }

    // If within the 5-second display window, keep showing — don't touch anything
    if (lastTAMessageLockTime > 0 && currentTimeMs - lastTAMessageLockTime < TA_TEXT_DISPLAY_MS) {
        return;
    }

    if (message) {
        // New or refreshed TA — set text and start 5-second display window
        cdtiTAAlertBox.textContent = message;
        cdtiTAAlertBox.style.display = 'block';
        lastTAMessageLockTime = currentTimeMs;
        lastTAAlertTime = currentTimeMs;
    } else {
        // No active TA and display window expired — hide
        cdtiTAAlertBox.style.display = 'none';
        lastTAMessageLockTime = 0;
    }
}

/**
 * Speak TA alert message using Web Speech API (queued, low load)
 * @param {string} message - Alert message to speak
 */
function speakTAAlert(message) {
    if (!message || typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
}

/**
 * Update TA spoken alerts (fire once per new TA target)
 * Per Garmin G500 Pilot's Guide: aural alerts inhibited below 500 ft HAT
 * @param {Map<string, Object>} taTargetsById - Map of targetId -> { rel, relAltFt, distance }
 * @param {number} ownHeading - Ownship heading in degrees
 * @param {number} currentTimeMs - Current simulation time in milliseconds
 * @param {number} ownshipAltMSL - Ownship altitude in feet MSL
 */
function updateTAAudioAlerts(taTargetsById, ownHeading, currentTimeMs, ownshipAltMSL) {
    if (!taTargetsById) return;

    // Garmin G500: aural TA alerts inhibited below 500 ft HAT
    const hat = ownshipAltMSL - CDTI_CONFIG.kvgtElevation;
    if (hat < 500) return;

    // Detect backwards scrolling (rewinding) - clear audio state immediately
    if (currentTimeMs < lastTAAudioTime) {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        lastTAIds = new Set();
        lastTAAudioTime = 0;
        return;
    }
    lastTAAudioTime = currentTimeMs;

    const currentIds = new Set(taTargetsById.keys());
    const newTargets = [];
    currentIds.forEach(id => {
        if (!lastTAIds.has(id)) {
            const target = taTargetsById.get(id);
            if (target) newTargets.push(target);
        }
    });

    // Speak closest new targets first (keeps queue ordering sensible)
    newTargets.sort((a, b) => a.distance - b.distance);
    newTargets.forEach(target => {
        const message = buildTAAlertMessage(
            target.rel.x,
            target.rel.y,
            ownHeading,
            target.relAltFt,
            target.distance
        );
        speakTAAlert(message);  // speak speech alert toggle
    });

    lastTAIds = currentIds;
}

/**
 * Convert lat/lon to nautical miles relative to ownship
 */
function latLonToRelativeNM(ownLat, ownLon, targetLat, targetLon) {
    const dLat = (targetLat - ownLat) * 60;  // 1 degree lat ≈ 60 nm
    const dLon = (targetLon - ownLon) * 60 * Math.cos(ownLat * Math.PI / 180);
    return { x: dLon, y: dLat };
}

/**
 * Rotate point around origin for track-up display
 * Input: x=East (+), y=North (+) in nm
 * Output: rotated coordinates for track-up display
 * 
 * Must match compass rose rotation: displayAngle = bearing - ownHeading
 */
function rotatePoint(x, y, headingDeg) {
    // Geographic to screen: East=+x, North=+y
    // First convert to polar: angle from North (geographic bearing)
    const geoAngle = Math.atan2(x, y);  // atan2(E, N) gives bearing from North
    const distance = Math.sqrt(x * x + y * y);
    
    // Rotate by subtracting heading (same as compass rose)
    const displayAngle = geoAngle - (headingDeg * Math.PI / 180);
    
    // Convert back to cartesian for screen (y=up, x=right)
    return {
        x: distance * Math.sin(displayAngle),
        y: distance * Math.cos(displayAngle)
    };
}

/**
 * Convert nm coordinates to canvas pixels
 */
function nmToPixels(xNm, yNm, canvasSize, maxRange) {
    const scale = (canvasSize / 2) / maxRange;
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    return {
        x: centerX + xNm * scale,
        y: centerY - yNm * scale  // Flip Y for canvas coordinates
    };
}

/**
 * Draw the CDTI display
 */
function drawCDTI() {
    if (!cdtiCtx || !viewerRef || !getAircraftDataFn) return;
    
    const canvas = cdtiCanvas;
    const ctx = cdtiCtx;
    const size = canvas.width;
    const center = size / 2;
    const maxRange = CDTI_CONFIG.maxRange;
    const scale = (size / 2 - 40) / maxRange;  // Leave margin for labels
    
    // Get current time
    const currentTime = viewerRef.clock.currentTime;
    
    // Get all aircraft data
    const aircraftData = getAircraftDataFn(currentTime);
    const ownship = aircraftData.find(a => a.id === CDTI_CONFIG.ownshipID);
    
    if (!ownship) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#666';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No ownship data', center, center);
        return;
    }
    
    const ownHeading = ownship.heading || 0;
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    
    // Draw range rings
    ctx.strokeStyle = '#0a0';
    ctx.setLineDash([]);
    
    CDTI_CONFIG.rangeRings.forEach((range, idx) => {
        const radius = range * scale;
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, 2 * Math.PI);

        // Inner ring (first of two) is dotted; outer ring (or single ring) is solid
        const isInnerRing = idx === 0 && CDTI_CONFIG.rangeRings.length > 1;
        if (isInnerRing) {
            ctx.setLineDash([4, 4]);  // Inner ring dotted
            ctx.strokeStyle = '#080';
        } else {
            ctx.setLineDash([]);
            ctx.strokeStyle = '#0a0';
        }
        ctx.lineWidth = 1;
        ctx.stroke();

        // Range label
        ctx.fillStyle = '#0a0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${range}nm`, center - radius + 5, center - 5);
    });
    
    ctx.setLineDash([]);
    
    // Draw compass rose
    drawCompassRose(ctx, center, size, scale, maxRange, ownHeading);
    
    // Draw runways
    drawRunways(ctx, ownship.lat, ownship.lon, ownHeading, scale, center, maxRange);
    
    // Collect traffic for drawing (sorted by threat priority: OTHER, PA, TA, RA)
    const trafficToDraw = [];
    const outOfRangeAlerts = [];  // RA/TA traffic beyond display range
    const activeTAs = [];         // Active TAs for aural alert text display
    const taTargetsById = new Map(); // TA targets for spoken alerts (keyed by target id)

    // Get current time for smoothing and persistence
    const currentTimeMs = Cesium.JulianDate.toDate(currentTime).getTime();

    // Rewind detection: if time went backwards, flush all stateful tracking
    if (currentTimeMs < lastProcessedTimeMs) {
        threatPersistence.history = {};
        divergenceTracking.history = {};
        altitudeSmoothing.history = {};
        lastTAAlertTime = 0;
        lastTAMessageLockTime = 0;
        lastTAAudioTime = 0;
        lastTAIds = new Set();
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    }
    lastProcessedTimeMs = currentTimeMs;

    // Smooth ownship altitude (3-point moving average)
    const ownshipAltSmoothed = smoothAltitude(ownship.id, ownship.alt, currentTimeMs);

    aircraftData.forEach(aircraft => {
        if (aircraft.id === CDTI_CONFIG.ownshipID) return;

        // Calculate relative position
        const rel = latLonToRelativeNM(ownship.lat, ownship.lon, aircraft.lat, aircraft.lon);
        const distance = Math.sqrt(rel.x * rel.x + rel.y * rel.y);

        // Smooth target altitude (3-point moving average to reduce ADS-B jitter)
        const targetAltSmoothed = smoothAltitude(aircraft.id, aircraft.alt, currentTimeMs);

        // Calculate relative altitude using smoothed values
        const relAltFt = targetAltSmoothed - ownshipAltSmoothed;
        const relAltHundreds = Math.round(relAltFt / 100);

        // Apply altitude filter
        if (!passesAltitudeFilter(relAltFt)) return;

        // Calculate closure and TAU (horizontal and vertical)
        const closureInfo = calculateClosure(ownship, aircraft, distance, rel, relAltFt);

        // Classify threat level (now includes TAU-based alerting with GDL 88 sensitivity)
        const threatResult = classifyThreat(distance, relAltFt, closureInfo, ownshipAltSmoothed);

        // Apply sequential verification (persistence filtering) per DO-317B
        // Requires N consecutive seconds meeting TA criteria before triggering
        const persistedLevel = applyThreatPersistence(aircraft.id, threatResult.level, currentTimeMs);

        // DO-317B divergence test: suppress TA if target diverging for N consecutive seconds
        const divergenceResult = applyDivergenceTest(
            aircraft.id, persistedLevel,
            closureInfo.closureRate, closureInfo.vertClosureRate,
            currentTimeMs
        );
        const threatLevel = divergenceResult.level;
        // Handle out-of-range traffic
        if (distance > maxRange) {
            // Only show RA and TA at compass edge (half symbols)
            if (threatLevel === 'RA' || threatLevel === 'TA') {
                outOfRangeAlerts.push({
                    rel,
                    distance,
                    relAltHundreds,
                    threatLevel,
                    verticalRate: aircraft.verticalRate || 0
                });
            }
            return;
        }

        // Rotate for track-up display
        const rotated = rotatePoint(rel.x, rel.y, ownHeading);

        // Adjust for margin
        const pos = {
            x: center + rotated.x * scale,
            y: center - rotated.y * scale
        };

        // Calculate traffic heading relative to display
        const trafficHeading = (aircraft.heading || 0) - ownHeading;

        // Calculate relative velocity for motion vectors (in display coordinates)
        // Get ownship velocity components
        let ownVx, ownVy;
        if (ownship.Vx !== null && ownship.Vx !== undefined) {
            ownVx = ownship.Vx;
            ownVy = ownship.Vy;
        } else {
            const ownHdgRad = (ownship.heading || 0) * Math.PI / 180;
            const ownGS = ownship.groundspeed || 120;
            ownVx = ownGS * Math.sin(ownHdgRad);
            ownVy = ownGS * Math.cos(ownHdgRad);
        }

        // Get target velocity components
        let tgtVx, tgtVy;
        if (aircraft.Vx !== null && aircraft.Vx !== undefined) {
            tgtVx = aircraft.Vx;
            tgtVy = aircraft.Vy;
        } else {
            const tgtHdgRad = (aircraft.heading || 0) * Math.PI / 180;
            const tgtGS = aircraft.groundspeed || 100;
            tgtVx = tgtGS * Math.sin(tgtHdgRad);
            tgtVy = tgtGS * Math.cos(tgtHdgRad);
        }

        // Relative velocity (target relative to ownship) in geographic coords
        const relVxGeo = tgtVx - ownVx;
        const relVyGeo = tgtVy - ownVy;

        // Rotate relative velocity to display coordinates (track-up)
        const relVelRotated = rotatePoint(relVxGeo, relVyGeo, ownHeading);

        trafficToDraw.push({
            pos,
            trafficHeading,
            relAltHundreds,
            verticalRate: aircraft.verticalRate || 0,
            threatLevel,
            distance,
            groundspeed: aircraft.groundspeed || 100,
            relativeMotion: { vx: relVelRotated.x, vy: relVelRotated.y }
        });

        // Track active TAs for aural alert text display
        if (threatLevel === 'TA' || threatLevel === 'RA') {
            activeTAs.push({
                rel,           // Relative position (x=East, y=North) in nm
                relAltFt,      // Relative altitude in feet
                distance       // Distance in nm
            });
        }

        // Track active TA targets for spoken alerts (TA only)
        if (threatLevel === 'TA') {
            taTargetsById.set(aircraft.id, {
                rel,
                relAltFt,
                distance
            });
        }
    });

    // Sort by threat priority (draw lower priority first so higher priority renders on top)
    const priorityOrder = { 'OTHER': 0, 'PA': 1, 'TA': 2, 'RA': 3 };
    trafficToDraw.sort((a, b) => priorityOrder[a.threatLevel] - priorityOrder[b.threatLevel]);

    // Draw in-range traffic
    trafficToDraw.forEach(traffic => {
        drawTrafficSymbol(
            ctx,
            traffic.pos.x,
            traffic.pos.y,
            traffic.trafficHeading,
            traffic.relAltHundreds,
            traffic.verticalRate,
            traffic.threatLevel,
            {
                groundspeed: traffic.groundspeed,
                scale: scale,
                relativeMotion: traffic.relativeMotion
            }
        );
    });

    // Draw out-of-range RA/TA at compass edge (half symbols)
    outOfRangeAlerts.forEach(alert => {
        const rotated = rotatePoint(alert.rel.x, alert.rel.y, ownHeading);
        // Normalize to edge of display
        const norm = Math.sqrt(rotated.x * rotated.x + rotated.y * rotated.y);
        const edgeX = (rotated.x / norm) * maxRange;
        const edgeY = (rotated.y / norm) * maxRange;
        const pos = {
            x: center + edgeX * scale,
            y: center - edgeY * scale
        };
        drawOutOfRangeSymbol(ctx, pos.x, pos.y, alert.relAltHundreds, alert.verticalRate, alert.threatLevel);
    });
    
    // Draw ownship symbol (always at center, pointing up)
    drawOwnshipSymbol(ctx, center, center);
    
    // Draw heading indicator
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(ownHeading).toString().padStart(3, '0')} TRUE`, center, 20);

    // Draw GDL 88 sensitivity level indicator (top-left)
    if (CDTI_CONFIG.useGDL88Sensitivity) {
        const hat = ownship.alt - CDTI_CONFIG.kvgtElevation;
        const sensitivity = getSensitivityLevel(ownship.alt, hat);
        ctx.fillStyle = '#0f0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`SL${sensitivity.level} ${sensitivity.phase} [${sensitivity.source}]`, 8, 15);
        ctx.fillText(`TAU:${sensitivity.tau}s VOL:${sensitivity.protectedVol}nm`, 8, 27);
    }

    // Draw UTC clock at bottom (for screen capture)
    if (CDTI_CONFIG.showUTCClock) {
        const utcDate = Cesium.JulianDate.toDate(currentTime);
        const utcStr = utcDate.toISOString().slice(11, 19) + ' UTC';  // HH:MM:SS[19].sss[23] UTC
        ctx.fillStyle = '#0f0';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(utcStr, center, size - 8);
    }

    // Update TA aural alert text display (same HAT inhibit as audio alerts)
    const ownshipHAT = ownship.alt - CDTI_CONFIG.kvgtElevation;
    if (activeTAs.length > 0 && ownshipHAT >= 500) {
        // Sort by distance (closest first)
        activeTAs.sort((a, b) => a.distance - b.distance);
        const closest = activeTAs[0];
        const alertMessage = buildTAAlertMessage(
            closest.rel.x,
            closest.rel.y,
            ownHeading,
            closest.relAltFt,
            closest.distance
        );
        updateTAAlertDisplay(alertMessage, currentTimeMs);
    } else {
        // No active TAs - update display (will hide after persistence expires)
        updateTAAlertDisplay(null, currentTimeMs);
    }

    // Update TA spoken alerts (per new TA target)
    updateTAAudioAlerts(taTargetsById, ownHeading, currentTimeMs, ownship.alt);
}

/**
 * Draw compass rose
 */
function drawCompassRose(ctx, center, size, scale, maxRange, ownHeading) {
    const outerRadius = maxRange * scale;
    
    ctx.strokeStyle = '#0a0';
    ctx.fillStyle = '#0a0';
    ctx.lineWidth = 1;
    
    // Draw tick marks and labels
    for (let hdg = 0; hdg < 360; hdg += CDTI_CONFIG.compassTickInterval) {
        const displayAngle = hdg - ownHeading;
        const rad = (displayAngle - 90) * Math.PI / 180;
        
        const innerR = outerRadius - (hdg % 30 === 0 ? 15 : 8);
        const outerR = outerRadius;
        
        const x1 = center + innerR * Math.cos(rad);
        const y1 = center + innerR * Math.sin(rad);
        const x2 = center + outerR * Math.cos(rad);
        const y2 = center + outerR * Math.sin(rad);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        // Labels every 30 degrees
        if (hdg % 30 === 0) {
            const labelR = outerRadius + 15;
            const lx = center + labelR * Math.cos(rad);
            const ly = center + labelR * Math.sin(rad);
            
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Cardinal directions
            let label;
            if (hdg === 0) label = 'N';
            else if (hdg === 90) label = 'E';
            else if (hdg === 180) label = 'S';
            else if (hdg === 270) label = 'W';
            else label = (hdg / 10).toString();
            
            ctx.fillText(label, lx, ly);
        }
    }
}

/**
 * Draw runway lines
 */
function drawRunways(ctx, ownLat, ownLon, ownHeading, scale, center, maxRange) {
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    
    KVGT_RUNWAYS.forEach(rwy => {
        const start = latLonToRelativeNM(ownLat, ownLon, rwy.start.lat, rwy.start.lon);
        const end = latLonToRelativeNM(ownLat, ownLon, rwy.end.lat, rwy.end.lon);
        
        // Calculate runway true bearing (before any rotation)
        const rwyBearing = Math.atan2(end.x - start.x, end.y - start.y) * 180 / Math.PI;
        
        // Check if runway is in view
        const startDist = Math.sqrt(start.x * start.x + start.y * start.y);
        const endDist = Math.sqrt(end.x * end.x + end.y * end.y);
        if (startDist > maxRange * 1.5 && endDist > maxRange * 1.5) return;
        
        // Rotate for track-up
        const startRot = rotatePoint(start.x, start.y, ownHeading);
        const endRot = rotatePoint(end.x, end.y, ownHeading);
        
        const startPx = { x: center + startRot.x * scale, y: center - startRot.y * scale };
        const endPx = { x: center + endRot.x * scale, y: center - endRot.y * scale };
        
        ctx.beginPath();
        ctx.moveTo(startPx.x, startPx.y);
        ctx.lineTo(endPx.x, endPx.y);
        ctx.stroke();
    });
}

/**
 * Draw ownship symbol - narrow isosceles triangle per G500 Figure 4-30
 * Origin (x, y) is at the tip/nose of the triangle (center of screen)
 * Shaded to appear as 3D tetrahedron
 */
function drawOwnshipSymbol(ctx, x, y) {
    const height = 32;  // Triangle height (tip to base)
    const halfWidth = 8;  // Half-width at base (narrow isosceles)

    // Tip at (x, y), base extends downward
    const tipX = x;
    const tipY = y;
    const leftX = x - halfWidth;
    const leftY = y + height;
    const rightX = x + halfWidth;
    const rightY = y + height;

    // Left half (darker/shadowed side)
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(tipX, leftY);  // Center bottom
    ctx.closePath();
    ctx.fillStyle = '#888';  // Darker gray
    ctx.fill();

    // Right half (lighter/illuminated side)
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX, rightY);  // Center bottom
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = '#fff';  // White/light
    ctx.fill();

    // Outline for definition
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(rightX, rightY);
    ctx.lineTo(leftX, leftY);
    ctx.closePath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}

/**
 * Check if heading value is valid for directional display
 * Per G500 Table 7-4: Non-directional symbols used when heading unavailable
 *
 * @param {number} heading - Heading value to check
 * @returns {boolean} True if heading is valid for directional display
 */
function isDirectionalHeading(heading) {
    return heading !== null && heading !== undefined && !isNaN(heading);
}

/**
 * Draw G500/600 chevron/arrow symbol (the symbol IS the arrow)
 * Per Table 7-4: Directional traffic uses chevron shape pointing in direction of travel
 * Base of triangle has concave arc curving inward
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} heading - Traffic heading relative to display (already rotated for track-up)
 * @param {number} size - Size of the symbol
 * @param {string} color - Color for the symbol
 * @param {boolean} filled - Whether to fill (proximate) or stroke (basic)
 */
function drawChevronSymbol(ctx, x, y, heading, size, color, filled) {
    const headingRad = heading * Math.PI / 180;

    // Chevron dimensions - taller and narrower for sharper tip angle
    const tipLength = size * 1.4;    // Distance from center to tip (longer = sharper)
    const wingSpread = size * 0.6;   // Width at widest point (narrower = sharper)
    const wingBack = size * 0.5;     // How far back the wings are from center

    // Calculate points rotated by heading
    // Tip (front, in direction of travel)
    const tipX = x + Math.sin(headingRad) * tipLength;
    const tipY = y - Math.cos(headingRad) * tipLength;

    // Wing points (perpendicular to heading, at the back)
    const perpX = Math.cos(headingRad);
    const perpY = Math.sin(headingRad);

    const wing1X = x - Math.sin(headingRad) * wingBack + perpX * wingSpread;
    const wing1Y = y + Math.cos(headingRad) * wingBack + perpY * wingSpread;
    const wing2X = x - Math.sin(headingRad) * wingBack - perpX * wingSpread;
    const wing2Y = y + Math.cos(headingRad) * wingBack - perpY * wingSpread;

    // Control point for the concave arc (curves inward toward the tip)
    const arcDepth = size * 0.4;     // How deep the concave arc goes
    const arcCtrlX = x + Math.sin(headingRad) * arcDepth;
    const arcCtrlY = y - Math.cos(headingRad) * arcDepth;

    ctx.save();

    if (filled) {
        // Filled chevron needs to be slightly larger to match visual size of stroked version
        // (stroke adds width outside the path, making open chevrons appear larger)
        const scale = 1.15;
        const tipXf = x + Math.sin(headingRad) * tipLength * scale;
        const tipYf = y - Math.cos(headingRad) * tipLength * scale;
        const wing1Xf = x - Math.sin(headingRad) * wingBack * scale + perpX * wingSpread * scale;
        const wing1Yf = y + Math.cos(headingRad) * wingBack * scale + perpY * wingSpread * scale;
        const wing2Xf = x - Math.sin(headingRad) * wingBack * scale - perpX * wingSpread * scale;
        const wing2Yf = y + Math.cos(headingRad) * wingBack * scale - perpY * wingSpread * scale;
        const arcCtrlXf = x + Math.sin(headingRad) * arcDepth * scale;
        const arcCtrlYf = y - Math.cos(headingRad) * arcDepth * scale;

        ctx.beginPath();
        ctx.moveTo(tipXf, tipYf);
        ctx.lineTo(wing1Xf, wing1Yf);
        ctx.quadraticCurveTo(arcCtrlXf, arcCtrlYf, wing2Xf, wing2Yf);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    } else {
        // Open chevron - fill interior with black first to cover motion vector line
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(wing1X, wing1Y);
        ctx.quadraticCurveTo(arcCtrlX, arcCtrlY, wing2X, wing2Y);
        ctx.closePath();
        ctx.fillStyle = '#000000';
        ctx.fill();
        // Then stroke the outline
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Draw G500/600 diamond symbol (non-directional traffic)
 * Per Table 7-4: Non-directional traffic uses diamond shape
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} size - Size of the symbol
 * @param {string} color - Color for the symbol
 * @param {boolean} filled - Whether to fill (proximate) or stroke (basic)
 */
function drawDiamondSymbol(ctx, x, y, size, color, filled) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x, y - size);        // Top
    ctx.lineTo(x + size, y);        // Right
    ctx.lineTo(x, y + size);        // Bottom
    ctx.lineTo(x - size, y);        // Left
    ctx.closePath();

    if (filled) {
        ctx.fill();
    } else {
        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Draw small directional arrow inside TA circle (G500 Table 7-4)
 * For directional alerted traffic - arrow inside yellow circle
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} heading - Traffic heading relative to display
 * @param {number} arrowSize - Size of the arrow
 * @param {string} arrowColor - Color for the arrow (typically black for contrast)
 */
function drawDirectionalArrowInside(ctx, x, y, heading, arrowSize, arrowColor) {
    if (!CDTI_CONFIG.showDirectionalArrows) return;

    const headingRad = heading * Math.PI / 180;

    // Arrow points in direction of travel
    const tipX = x + Math.sin(headingRad) * arrowSize;
    const tipY = y - Math.cos(headingRad) * arrowSize;

    // Arrow base
    const baseX = x - Math.sin(headingRad) * (arrowSize * 0.3);
    const baseY = y + Math.cos(headingRad) * (arrowSize * 0.3);

    // Arrow wings
    const wingSpread = arrowSize * 0.4;
    const wingBack = arrowSize * 0.5;
    const perpX = Math.cos(headingRad);
    const perpY = Math.sin(headingRad);

    const wing1X = x - Math.sin(headingRad) * wingBack + perpX * wingSpread;
    const wing1Y = y + Math.cos(headingRad) * wingBack + perpY * wingSpread;
    const wing2X = x - Math.sin(headingRad) * wingBack - perpX * wingSpread;
    const wing2Y = y + Math.cos(headingRad) * wingBack - perpY * wingSpread;

    ctx.save();
    ctx.fillStyle = arrowColor;
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(wing1X, wing1Y);
    ctx.lineTo(baseX, baseY);
    ctx.lineTo(wing2X, wing2Y);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/**
 * Legacy function for backwards compatibility
 * Now calls drawDirectionalArrowInside
 */
function drawDirectionalArrow(ctx, x, y, heading, arrowSize, arrowColor) {
    drawDirectionalArrowInside(ctx, x, y, heading, arrowSize, arrowColor);
}

/**
 * Draw motion vector extending from traffic symbol
 * Per G500 Figures 4-33 and 4-34:
 * - ABSOLUTE mode: Vector shows intruder's actual ground track, color matches intruder
 * - RELATIVE mode: Vector shows intruder motion relative to ownship, color is green (yellow for TA)
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Symbol center X position (pixels)
 * @param {number} y - Symbol center Y position (pixels)
 * @param {number} heading - Traffic heading relative to display (degrees, already rotated for track-up)
 * @param {number} groundspeed - Traffic groundspeed (knots)
 * @param {number} scale - Pixels per nm
 * @param {string} threatLevel - Threat classification (TA, PA, OTHER)
 * @param {Object} relativeMotion - Optional {vx, vy} for relative motion mode (knots, display coords)
 */
function drawMotionVector(ctx, x, y, heading, groundspeed, scale, threatLevel, relativeMotion = null) {
    if (CDTI_CONFIG.motionVectorMode === 'OFF') return;

    const duration = CDTI_CONFIG.motionVectorDuration;  // seconds
    const durationHours = duration / 3600;

    let vectorX, vectorY, vectorColor;

    if (CDTI_CONFIG.motionVectorMode === 'RELATIVE' && relativeMotion) {
        // RELATIVE mode: Use relative velocity components
        // relativeMotion.vx and vy are in knots (nm/hr), in display coordinates
        vectorX = relativeMotion.vx * durationHours * scale;
        vectorY = -relativeMotion.vy * durationHours * scale;  // Flip Y for canvas

        // Color: green for normal traffic, yellow for TA (per G500)
        vectorColor = (threatLevel === 'TA' || threatLevel === 'RA') ? '#FFFF00' : '#00FF00';
    } else {
        // ABSOLUTE mode: Use actual groundspeed and heading
        const headingRad = heading * Math.PI / 180;
        const distanceNm = groundspeed * durationHours;

        // Convert to display coordinates (heading is already in track-up frame)
        vectorX = Math.sin(headingRad) * distanceNm * scale;
        vectorY = -Math.cos(headingRad) * distanceNm * scale;  // Flip Y for canvas

        // Color: white for normal traffic (matches cyan intruder), yellow for TA
        vectorColor = (threatLevel === 'TA' || threatLevel === 'RA') ? '#FFFF00' : '#FFFFFF';
    }

    // Don't draw if vector is too short (< 3 pixels)
    const vectorLength = Math.sqrt(vectorX * vectorX + vectorY * vectorY);
    if (vectorLength < 3) return;

    ctx.save();
    ctx.strokeStyle = vectorColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    // Draw motion vector line
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + vectorX, y + vectorY);
    ctx.stroke();

    // Draw small arrowhead at end
    const arrowSize = 4;
    const angle = Math.atan2(vectorY, vectorX);
    const endX = x + vectorX;
    const endY = y + vectorY;

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - arrowSize * Math.cos(angle - Math.PI / 6),
        endY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - arrowSize * Math.cos(angle + Math.PI / 6),
        endY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();

    ctx.restore();
}

/**
 * Draw traffic symbol based on Garmin G500/600 Table 7-4 ADS-B symbology
 *
 * Symbol types based on threat level and heading availability:
 * - TA (Traffic Advisory): Yellow circle
 *     - Directional: filled circle with black arrow inside
 *     - Non-directional: open/hollow yellow circle
 * - PA (Proximate): Cyan filled symbols
 *     - Directional: filled chevron pointing in direction of travel
 *     - Non-directional: filled diamond
 * - OTHER (Basic): Cyan open/outline symbols
 *     - Directional: open chevron pointing in direction of travel
 *     - Non-directional: open diamond
 * - RA (TCAS II only): Red filled square (not available on GDL 88 TAS)
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position (pixels)
 * @param {number} y - Center Y position (pixels)
 * @param {number} heading - Traffic heading relative to display (degrees), null/undefined = non-directional
 * @param {number} relAlt - Relative altitude in hundreds of feet
 * @param {number} verticalRate - Vertical rate in fpm
 * @param {string} threatLevel - Threat classification ('RA', 'TA', 'PA', 'OTHER')
 * @param {Object} motionParams - Optional motion vector parameters {groundspeed, scale, relativeMotion}
 */
function drawTrafficSymbol(ctx, x, y, heading, relAlt, verticalRate, threatLevel = 'OTHER', motionParams = null) {
    const size = 10;  // Symbol size in pixels (G500 scale)
    const color = CDTI_COLORS[threatLevel];
    const isDirectional = isDirectionalHeading(heading);

    // Draw motion vector first (behind symbol)
    if (motionParams && CDTI_CONFIG.motionVectorMode !== 'OFF' && isDirectional) {
        drawMotionVector(
            ctx, x, y,
            heading,
            motionParams.groundspeed || 0,
            motionParams.scale || 1,
            threatLevel,
            motionParams.relativeMotion
        );
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    switch (threatLevel) {
        case 'RA':
            // Red filled square (TCAS II only - not shown on GDL 88 TAS)
            ctx.fillStyle = CDTI_COLORS.RA;
            ctx.fillRect(x - size, y - size, size * 2, size * 2);
            // Directional arrow inside if heading available
            if (isDirectional) {
                drawDirectionalArrowInside(ctx, x, y, heading, size * 0.7, '#000000');
            }
            break;

        case 'TA':
            // Traffic Advisory - Yellow circle per G500 Table 7-4
            ctx.fillStyle = CDTI_COLORS.TA;
            ctx.strokeStyle = CDTI_COLORS.TA;
            if (isDirectional) {
                // Directional Alerted Traffic: Filled yellow circle with arrow inside
                ctx.beginPath();
                ctx.arc(x, y, size, 0, 2 * Math.PI);
                ctx.fill();
                // Black arrow inside for contrast (larger for visibility)
                drawDirectionalArrowInside(ctx, x, y, heading, size * 0.85, '#000000');
            } else {
                // Non-Directional Alerted Traffic: Open/hollow yellow circle
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, 2 * Math.PI);
                ctx.stroke();
            }
            break;

        case 'PA':
            // Proximate Traffic - Filled cyan symbols per G500 Table 7-4
            if (isDirectional) {
                // Proximate Directional Traffic: Filled cyan chevron
                drawChevronSymbol(ctx, x, y, heading, size, CDTI_COLORS.PA, true);
            } else {
                // Proximate Non-Directional Traffic: Filled cyan diamond
                drawDiamondSymbol(ctx, x, y, size, CDTI_COLORS.PA, true);
            }
            break;

        case 'OTHER':
        default:
            // Basic Traffic - Open/outline cyan symbols per G500 Table 7-4
            if (isDirectional) {
                // Basic Directional Traffic: Open cyan chevron
                drawChevronSymbol(ctx, x, y, heading, size, CDTI_COLORS.OTHER, false);
            } else {
                // Basic Non-Directional Traffic: Open cyan diamond
                drawDiamondSymbol(ctx, x, y, size, CDTI_COLORS.OTHER, false);
            }
            break;
    }

    // Draw altitude tag with contrast
    drawAltitudeTag(ctx, x + size + 4, y, relAlt, verticalRate, color);
}

/**
 * Draw out-of-range (off-scale) RA/TA symbol at compass edge
 * Per G500 Table 7-4:
 * - Off-Scale Non-Directional Alerted Traffic: Half yellow circle
 * - Off-Scale Directional Alerted Traffic: Half yellow circle with arrow
 *
 * Note: Currently renders as non-directional since heading data not passed
 * TODO: Add heading parameter for directional off-scale symbols
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position at display edge
 * @param {number} y - Y position at display edge
 * @param {number} relAlt - Relative altitude in hundreds of feet
 * @param {number} verticalRate - Vertical rate in fpm
 * @param {string} threatLevel - Threat level ('RA' or 'TA')
 * @param {number} angleFromCenter - Angle from display center (radians), used for half-symbol orientation
 */
function drawOutOfRangeSymbol(ctx, x, y, relAlt, verticalRate, threatLevel, angleFromCenter = 0) {
    const size = 11;  // Off-scale symbol size (G500 scale)
    const color = CDTI_COLORS[threatLevel];

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    switch (threatLevel) {
        case 'RA':
            // Half-filled red square (TCAS II only)
            // Oriented so inner half faces center
            ctx.translate(x, y);
            ctx.rotate(angleFromCenter + Math.PI);  // Rotate to face center
            ctx.fillRect(-size * 0.5, -size, size, size * 2);
            break;

        case 'TA':
            // Off-Scale Alerted Traffic: Half yellow circle per G500 Table 7-4
            // Semi-circle oriented with flat edge toward display center
            ctx.translate(x, y);
            ctx.rotate(angleFromCenter + Math.PI);  // Rotate to face center
            ctx.beginPath();
            ctx.arc(0, 0, size, -Math.PI / 2, Math.PI / 2);
            ctx.closePath();
            ctx.fill();
            break;
    }

    ctx.restore();

    // Draw altitude tag
    drawAltitudeTag(ctx, x + size + 4, y, relAlt, verticalRate, color);
}

/**
 * Draw altitude tag with vertical trend arrow
 * Format: ±XX with up/down arrow for climb/descent > 500 fpm
 */
function drawAltitudeTag(ctx, x, y, relAlt, verticalRate, color) {
    // Clamp altitude display to ±99
    const displayAlt = Math.max(-99, Math.min(99, relAlt));

    // Format altitude text: +XX or -XX
    let altText;
    if (displayAlt >= 0) {
        altText = '+' + displayAlt.toString().padStart(2, '0');
    } else {
        altText = '-' + Math.abs(displayAlt).toString().padStart(2, '0');
    }

    // Draw text with black outline for contrast
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Black outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(altText, x, y);

    // Colored fill
    ctx.fillStyle = color;
    ctx.fillText(altText, x, y);

    // Vertical trend arrow (only if > 500 fpm per RTCA standard)
    if (Math.abs(verticalRate) > CDTI_CONFIG.verticalRateThreshold) {
        const arrowX = x + ctx.measureText(altText).width + 4;
        const arrowY = y;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (verticalRate > 0) {
            // Climbing - up arrow
            ctx.moveTo(arrowX, arrowY + 5);
            ctx.lineTo(arrowX, arrowY - 5);
            ctx.moveTo(arrowX - 3, arrowY - 2);
            ctx.lineTo(arrowX, arrowY - 5);
            ctx.lineTo(arrowX + 3, arrowY - 2);
        } else {
            // Descending - down arrow
            ctx.moveTo(arrowX, arrowY - 5);
            ctx.lineTo(arrowX, arrowY + 5);
            ctx.moveTo(arrowX - 3, arrowY + 2);
            ctx.lineTo(arrowX, arrowY + 5);
            ctx.lineTo(arrowX + 3, arrowY + 2);
        }
        ctx.stroke();
    }
}

/**
 * Create the CDTI overlay window
 */
function createCDTIOverlay() {
    cdtiOverlay = document.createElement('div');
    cdtiOverlay.style.cssText = `
        position: absolute;
        top: 100px;
        right: 100px;
        width: 550px;
        height: 630px;
        z-index: 2000;
        display: none;
        background: rgba(30, 30, 30, 0.95);
        border-radius: 6px;
        border: 1px solid #555;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        min-width: 500px;
        min-height: 400px;
        resize: both;
        overflow: hidden;
    `;
    
    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
        background: #333;
        padding: 6px 10px;
        cursor: move;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #444;
        user-select: none;
    `;
    
    const titleText = document.createElement('span');
    titleText.style.cssText = `color: #ccc; font-size: 12px; font-family: monospace;`;
    titleText.textContent = 'CDTI - Traffic Display';

    // HAT/GPS Phase controls container (middle of title bar)
    const hatControls = document.createElement('div');
    hatControls.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: monospace;
        font-size: 10px;
        cursor: default;
    `;
    // Prevent drag handler from capturing clicks on controls
    hatControls.onmousedown = (e) => e.stopPropagation();

    // HAT Available checkbox
    const hatLabel = document.createElement('label');
    hatLabel.style.cssText = 'color: #aaa; display: flex; align-items: center; gap: 4px; cursor: pointer;';
    const hatCheckbox = document.createElement('input');
    hatCheckbox.type = 'checkbox';
    hatCheckbox.checked = CDTI_CONFIG.hatAvailable;
    hatCheckbox.style.cssText = 'cursor: pointer;';
    hatCheckbox.onchange = (e) => {
        CDTI_CONFIG.hatAvailable = e.target.checked;
        // Update GPS phase selector visibility
        gpsPhaseSelect.style.display = e.target.checked ? 'none' : 'inline';
        gpsPhaseLabel.style.display = e.target.checked ? 'none' : 'inline';
    };
    hatLabel.appendChild(hatCheckbox);
    hatLabel.appendChild(document.createTextNode('HAT'));

    // GPS Phase selector (only visible when HAT unavailable)
    const gpsPhaseLabel = document.createElement('span');
    gpsPhaseLabel.style.cssText = 'color: #aaa;';
    gpsPhaseLabel.style.display = CDTI_CONFIG.hatAvailable ? 'none' : 'inline';
    gpsPhaseLabel.textContent = 'GPS Phase:';

    const gpsPhaseSelect = document.createElement('select');
    gpsPhaseSelect.style.cssText = 'font-size: 10px; padding: 2px 4px; background: #222; color: #fff; border: 1px solid #555; cursor: pointer;';
    gpsPhaseSelect.style.display = CDTI_CONFIG.hatAvailable ? 'none' : 'inline';
    const phaseOptions = [
        { value: 'NONE', label: 'None/Unavailable' },
        { value: 'APPROACH', label: 'Approach' },
        { value: 'TERMINAL', label: 'Terminal' }
    ];
    phaseOptions.forEach(phase => {
        const opt = document.createElement('option');
        opt.value = phase.value;
        opt.textContent = phase.label;
        if (phase.value === CDTI_CONFIG.gpsPhase) opt.selected = true;
        gpsPhaseSelect.appendChild(opt);
    });
    gpsPhaseSelect.onchange = (e) => {
        CDTI_CONFIG.gpsPhase = e.target.value;
    };
    // Extra protection for the select element
    gpsPhaseSelect.onclick = (e) => e.stopPropagation();
    gpsPhaseSelect.onmousedown = (e) => e.stopPropagation();

    hatControls.appendChild(hatLabel);
    hatControls.appendChild(gpsPhaseLabel);
    hatControls.appendChild(gpsPhaseSelect);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: transparent;
        color: #aaa;
        border: none;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
    `;
    closeBtn.onclick = hideCDTI;

    titleBar.appendChild(titleText);
    titleBar.appendChild(hatControls);
    titleBar.appendChild(closeBtn);
    
    // Canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
        width: 100%;
        height: calc(100% - 130px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 5px;
        box-sizing: border-box;
    `;
    
    // Canvas
    cdtiCanvas = document.createElement('canvas');
    cdtiCanvas.width = 500;
    cdtiCanvas.height = 500;
    cdtiCanvas.style.cssText = `
        background: #000;
        border-radius: 4px;
    `;
    cdtiCtx = cdtiCanvas.getContext('2d');
    
    canvasContainer.appendChild(cdtiCanvas);

    // TA Aural Alert Text Display Box
    // Per GDL 88, displays: "Traffic! X O'clock, Low/High, X Miles"
    cdtiTAAlertBox = document.createElement('div');
    cdtiTAAlertBox.id = 'cdti-ta-alert';
    cdtiTAAlertBox.style.cssText = `
        background: rgba(0, 0, 0, 0.9);
        color: #FFFF00;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        padding: 8px 16px;
        text-align: center;
        border: 2px solid #FFFF00;
        border-radius: 4px;
        display: none;
        margin: 4px auto;
        width: fit-content;
    `;

    // Controls bar
    const controlsBar = document.createElement('div');
    controlsBar.style.cssText = `
        background: #333;
        padding: 6px 10px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 15px;
        border-top: 1px solid #444;
        flex-wrap: wrap;
    `;

    // Range control
    const rangeLabel = document.createElement('span');
    rangeLabel.style.cssText = 'color: #aaa; font-size: 11px; font-family: monospace;';
    rangeLabel.textContent = 'Range:';

    const rangeSelect = document.createElement('select');
    rangeSelect.style.cssText = 'font-size: 11px; padding: 2px; background: #222; color: #fff; border: 1px solid #555;';
    // GTN-style range options
    [2, 6, 12, 24, 48].forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = `${r} nm`;
        if (r === CDTI_CONFIG.maxRange) opt.selected = true;
        rangeSelect.appendChild(opt);
    });
    rangeSelect.onchange = (e) => {
        CDTI_CONFIG.maxRange = parseInt(e.target.value);
        // Update range rings based on selection (GTN style)
        // Pattern: outer ring = maxRange, inner ring = maxRange/2 (except 2nm has no inner)
        if (CDTI_CONFIG.maxRange === 2) {
            CDTI_CONFIG.rangeRings = [2];           // No inner ring
        } else if (CDTI_CONFIG.maxRange === 6) {
            CDTI_CONFIG.rangeRings = [2, 6];
        } else if (CDTI_CONFIG.maxRange === 12) {
            CDTI_CONFIG.rangeRings = [6, 12];
        } else if (CDTI_CONFIG.maxRange === 24) {
            CDTI_CONFIG.rangeRings = [12, 24];
        } else if (CDTI_CONFIG.maxRange === 48) {
            CDTI_CONFIG.rangeRings = [24, 48];
        }
    };

    // Altitude filter control
    const altLabel = document.createElement('span');
    altLabel.style.cssText = 'color: #aaa; font-size: 11px; font-family: monospace;';
    altLabel.textContent = 'Alt:';

    const altSelect = document.createElement('select');
    altSelect.style.cssText = 'font-size: 11px; padding: 2px; background: #222; color: #fff; border: 1px solid #555;';
    Object.keys(ALTITUDE_FILTERS).forEach(mode => {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = ALTITUDE_FILTERS[mode].label;
        if (mode === CDTI_CONFIG.altitudeFilter) opt.selected = true;
        altSelect.appendChild(opt);
    });
    altSelect.onchange = (e) => {
        CDTI_CONFIG.altitudeFilter = e.target.value;
    };

    // Motion vector mode control
    const vectorLabel = document.createElement('span');
    vectorLabel.style.cssText = 'color: #aaa; font-size: 11px; font-family: monospace;';
    vectorLabel.textContent = 'Vector:';

    const vectorSelect = document.createElement('select');
    vectorSelect.style.cssText = 'font-size: 11px; padding: 2px; background: #222; color: #fff; border: 1px solid #555;';
    ['OFF', 'ABSOLUTE', 'RELATIVE'].forEach(mode => {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode.charAt(0) + mode.slice(1).toLowerCase();
        if (mode === CDTI_CONFIG.motionVectorMode) opt.selected = true;
        vectorSelect.appendChild(opt);
    });
    vectorSelect.onchange = (e) => {
        CDTI_CONFIG.motionVectorMode = e.target.value;
    };

    // Motion vector duration control
    const durationLabel = document.createElement('span');
    durationLabel.style.cssText = 'color: #aaa; font-size: 11px; font-family: monospace;';
    durationLabel.textContent = 'Dur:';

    const durationSelect = document.createElement('select');
    durationSelect.style.cssText = 'font-size: 11px; padding: 2px; background: #222; color: #fff; border: 1px solid #555;';
    [30, 60, 120, 300].forEach(sec => {
        const opt = document.createElement('option');
        opt.value = sec;
        opt.textContent = sec < 60 ? `${sec}s` : `${sec / 60}m`;
        if (sec === CDTI_CONFIG.motionVectorDuration) opt.selected = true;
        durationSelect.appendChild(opt);
    });
    durationSelect.onchange = (e) => {
        CDTI_CONFIG.motionVectorDuration = parseInt(e.target.value);
    };

    // Legend button
    const legendBtn = document.createElement('button');
    legendBtn.textContent = '?';
    legendBtn.title = 'Show symbology legend';
    legendBtn.style.cssText = `
        font-size: 11px;
        padding: 2px 6px;
        background: #444;
        color: #fff;
        border: 1px solid #555;
        border-radius: 3px;
        cursor: pointer;
    `;
    legendBtn.onclick = () => toggleLegend();

    controlsBar.appendChild(rangeLabel);
    controlsBar.appendChild(rangeSelect);
    controlsBar.appendChild(altLabel);
    controlsBar.appendChild(altSelect);
    controlsBar.appendChild(vectorLabel);
    controlsBar.appendChild(vectorSelect);
    controlsBar.appendChild(durationLabel);
    controlsBar.appendChild(durationSelect);
    controlsBar.appendChild(legendBtn);
    
    cdtiOverlay.appendChild(titleBar);
    cdtiOverlay.appendChild(canvasContainer);
    cdtiOverlay.appendChild(cdtiTAAlertBox);
    cdtiOverlay.appendChild(controlsBar);
    document.body.appendChild(cdtiOverlay);
    
    // Make draggable
    makeDraggable(cdtiOverlay, titleBar);
    
    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const width = entry.contentRect.width;
            const height = entry.contentRect.height - 130;  // Subtract title, alert box, and controls
            const size = Math.min(width - 10, height - 10);
            if (size > 100) {
                cdtiCanvas.width = size;
                cdtiCanvas.height = size;
            }
        }
    });
    resizeObserver.observe(cdtiOverlay);
}

/**
 * Make element draggable
 */
function makeDraggable(element, handle) {
    let offsetX = 0, offsetY = 0, isDragging = false;
    
    handle.onmousedown = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
        document.onmousemove = onMouseMove;
        document.onmouseup = onMouseUp;
        e.preventDefault();
    };
    
    function onMouseMove(e) {
        if (!isDragging) return;
        element.style.left = Math.max(0, e.clientX - offsetX) + 'px';
        element.style.top = Math.max(0, e.clientY - offsetY) + 'px';
        element.style.right = 'auto';
    }
    
    function onMouseUp() {
        isDragging = false;
        document.onmousemove = null;
        document.onmouseup = null;
    }
}

/**
 * Show CDTI display
 */
function showCDTI() {
    cdtiOverlay.style.display = 'block';
    isVisible = true;
    startUpdating();
}

/**
 * Hide CDTI display
 */
function hideCDTI() {
    cdtiOverlay.style.display = 'none';
    isVisible = false;
    stopUpdating();
}

/**
 * Toggle CDTI visibility
 */
function toggleCDTI() {
    if (isVisible) {
        hideCDTI();
    } else {
        showCDTI();
    }
}

/**
 * Start continuous updates
 */
function startUpdating() {
    if (updateTimer) return;
    updateTimer = setInterval(drawCDTI, CDTI_CONFIG.updateInterval);
    drawCDTI();  // Immediate first draw
}

/**
 * Stop updates
 */
function stopUpdating() {
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
}

/**
 * Create the symbology legend overlay
 */
function createLegend() {
    cdtiLegend = document.createElement('div');
    cdtiLegend.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2100;
        display: none;
        background: rgba(20, 20, 20, 0.95);
        border-radius: 8px;
        border: 1px solid #555;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
        padding: 15px 20px;
        font-family: monospace;
        color: #ccc;
        min-width: 280px;
    `;

    cdtiLegend.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #444; padding-bottom: 8px;">
            <span style="font-size: 13px; font-weight: bold; color: #fff;">Garmin G500/600 ADS-B Symbology (Table 7-4)</span>
            <button id="cdtiLegendClose" style="background: transparent; color: #aaa; border: none; cursor: pointer; font-size: 16px; padding: 0 4px;">✕</button>
        </div>

        <div style="font-size: 11px; line-height: 1.8;">
            <div style="margin-bottom: 10px; font-weight: bold; color: #fff;">Traffic Advisory (TA):</div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><circle cx="12" cy="12" r="8" fill="#FFFF00"/><polygon points="12,6 16,14 12,12 8,14" fill="#000"/></svg>
                <span><span style="color: #FFFF00; font-weight: bold;">TA Directional</span> - Yellow circle with arrow</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><circle cx="12" cy="12" r="8" fill="none" stroke="#FFFF00" stroke-width="2"/></svg>
                <span><span style="color: #FFFF00;">TA Non-Directional</span> - Yellow circle (hollow)</span>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Proximate Traffic (PA):</div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><polygon points="12,2 18,14 12,10 6,14" fill="#CCCCCC"/></svg>
                <span><span style="color: #CCCCCC; font-weight: bold;">Proximate Directional</span> - Filled chevron</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><polygon points="12,4 20,12 12,20 4,12" fill="#CCCCCC"/></svg>
                <span><span style="color: #CCCCCC;">Proximate Non-Dir</span> - Filled diamond</span>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Basic Traffic:</div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><polygon points="12,2 18,14 12,10 6,14" fill="none" stroke="#CCCCCC" stroke-width="2"/></svg>
                <span><span style="color: #CCCCCC;">Basic Directional</span> - Open chevron</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><polygon points="12,4 20,12 12,20 4,12" fill="none" stroke="#CCCCCC" stroke-width="2"/></svg>
                <span><span style="color: #CCCCCC;">Basic Non-Directional</span> - Open diamond</span>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Motion Vectors:</div>
            <div style="margin-left: 10px; font-size: 10px;">
                <div><span style="color: #fff;">Absolute:</span> Shows actual ground track (white/yellow)</div>
                <div><span style="color: #0f0;">Relative:</span> Shows motion relative to ownship (green)</div>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">GDL 88 Sensitivity Levels (SL4-SL9):</div>
            <div style="margin-left: 10px; font-size: 10px;">
                <div>SL4: HAT ≤1000ft (TAU=20s, Vol=0.20nm)</div>
                <div>SL5: HAT 1000-2350ft (TAU=25s, Vol=0.20nm)</div>
                <div>SL6: MSL ≤5000ft (TAU=30s, Vol=0.35nm)</div>
                <div>SL7: MSL 5-10kft (TAU=40s, Vol=0.55nm)</div>
                <div>SL8: MSL 10-20kft (TAU=45s, Vol=0.80nm)</div>
                <div>SL9: MSL 20-42kft (TAU=48s, Vol=1.10nm)</div>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Altitude Tag:</div>
            <div style="margin-left: 10px; margin-bottom: 6px;">
                <span style="color: #CCCCCC;">+05</span> = 500ft above &nbsp;&nbsp;
                <span style="color: #CCCCCC;">-02</span> = 200ft below
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Vertical Trend (>500 fpm):</div>
            <div style="margin-left: 10px; margin-bottom: 6px;">
                <span style="color: #CCCCCC;">&#8593;</span> Climbing &nbsp;&nbsp;
                <span style="color: #CCCCCC;">&#8595;</span> Descending
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Altitude Filters:</div>
            <div style="margin-left: 10px; font-size: 10px;">
                <div>NORM: ±2,700ft &nbsp; ABV: -2.7k to +9kft</div>
                <div>BLW: -9k to +2.7kft &nbsp; XTD: ±9,000ft</div>
            </div>
        </div>
    `;

    document.body.appendChild(cdtiLegend);

    // Close button handler
    cdtiLegend.querySelector('#cdtiLegendClose').onclick = () => {
        cdtiLegend.style.display = 'none';
        isLegendVisible = false;
    };

    // Click outside to close
    cdtiLegend.addEventListener('click', (e) => {
        if (e.target === cdtiLegend) {
            cdtiLegend.style.display = 'none';
            isLegendVisible = false;
        }
    });
}

/**
 * Toggle legend visibility
 */
function toggleLegend() {
    if (!cdtiLegend) {
        createLegend();
    }
    isLegendVisible = !isLegendVisible;
    cdtiLegend.style.display = isLegendVisible ? 'block' : 'none';
}

/**
 * Format JulianDate to ISO timestamp string
 */
function julianToISO(julianDate) {
    const jsDate = Cesium.JulianDate.toDate(julianDate);
    return jsDate.toISOString();
}

/**
 * Export CDTI threat data to CSV
 * Only runs when viewer is paused
 */
function exportCDTIData() {
    if (!viewerRef || !getAircraftDataFn) {
        alert('CDTI not initialized');
        return;
    }

    // Check if paused
    if (viewerRef.clock.shouldAnimate) {
        alert('Pause playback to export CDTI data');
        return;
    }

    // console.log('CDTI Export: Starting batch export...');
    const startTime = performance.now();

    // Clear persistence, divergence, and smoothing history for fresh export run
    threatPersistence.history = {};
    divergenceTracking.history = {};
    altitudeSmoothing.history = {};

    // Get time range from viewer clock
    const clockStart = viewerRef.clock.startTime;
    const clockStop = viewerRef.clock.stopTime;
    const totalSeconds = Cesium.JulianDate.secondsDifference(clockStop, clockStart);

    // console.log(`CDTI Export: Time range = ${totalSeconds.toFixed(1)} seconds`);

    // Batch export data
    const exportLog = [];
    const lastLoggedTime = {};  // Deduplication tracker per target

    // Iterate through each second
    for (let sec = 0; sec <= totalSeconds; sec++) {
        const currentTime = Cesium.JulianDate.addSeconds(clockStart, sec, new Cesium.JulianDate());

        // Get all aircraft at this time
        const aircraftData = getAircraftDataFn(currentTime);
        const ownship = aircraftData.find(a => a.id === CDTI_CONFIG.ownshipID);

        if (!ownship) continue;

        // Get current time for smoothing
        const currentTimeMs = Cesium.JulianDate.toDate(currentTime).getTime();

        // Smooth ownship altitude
        const ownshipAltSmoothed = smoothAltitude(ownship.id, ownship.alt, currentTimeMs);

        // Evaluate each traffic aircraft
        aircraftData.forEach(aircraft => {
            if (aircraft.id === CDTI_CONFIG.ownshipID) return;

            // Calculate relative position
            const rel = latLonToRelativeNM(ownship.lat, ownship.lon, aircraft.lat, aircraft.lon);
            const distance = Math.sqrt(rel.x * rel.x + rel.y * rel.y);

            // Smooth target altitude
            const targetAltSmoothed = smoothAltitude(aircraft.id, aircraft.alt, currentTimeMs);

            // Calculate relative altitude using smoothed values
            const relAltFt = targetAltSmoothed - ownshipAltSmoothed;

            // Calculate closure and TAU (horizontal and vertical)
            const closureInfo = calculateClosure(ownship, aircraft, distance, rel, relAltFt);

            // Classify threat (now includes TAU-based alerting with GDL 88 sensitivity)
            const threatResult = classifyThreat(distance, relAltFt, closureInfo, ownshipAltSmoothed);
            const rawLevel = threatResult.level;

            // Apply sequential verification (persistence filtering)
            const filteredLevel = applyThreatPersistence(aircraft.id, rawLevel, currentTimeMs);

            // DO-317B divergence test
            const divergenceResult = applyDivergenceTest(
                aircraft.id, filteredLevel,
                closureInfo.closureRate, closureInfo.vertClosureRate,
                currentTimeMs
            );
            const finalLevel = divergenceResult.level;

            // Only log RA, TA, PA (not OTHER) - use raw level for logging
            if (rawLevel === 'OTHER') return;

            // Deduplication: only log once per second per target
            const targetKey = aircraft.id;
            const lastLogged = lastLoggedTime[targetKey] || -999;
            if (sec - lastLogged < 1) return;
            lastLoggedTime[targetKey] = sec;

            // Build alert basis from threat result
            const absRelAlt = Math.abs(relAltFt);
            let alertBasis = [];

            // Altitude is always a factor for alerts - use dynamic thresholds from threat result
            if (threatResult.altTrigger) alertBasis.push('ALT');

            if (threatResult.distTrigger) alertBasis.push('DIST');
            if (threatResult.tauTrigger || threatResult.vertTauTrigger) alertBasis.push('TAU');

            // Calculate HAT for export
            const ownshipHAT = Math.round(ownship.alt - CDTI_CONFIG.kvgtElevation);

            // Create export entry
            exportLog.push({
                time_seconds: sec.toFixed(2),
                timestamp: julianToISO(currentTime),
                ownship_id: ownship.id,
                ownship_lat: ownship.lat.toFixed(6),
                ownship_lon: ownship.lon.toFixed(6),
                ownship_alt_raw_ft: Math.round(ownship.alt),
                ownship_alt_smooth_ft: Math.round(ownshipAltSmoothed),
                ownship_hat_ft: ownshipHAT,
                ownship_hdg: Math.round(ownship.heading || 0),
                ownship_vs_fpm: Math.round(ownship.verticalRate || 0),
                target_id: aircraft.id,
                target_lat: aircraft.lat.toFixed(6),
                target_lon: aircraft.lon.toFixed(6),
                target_alt_raw_ft: Math.round(aircraft.alt),
                target_alt_smooth_ft: Math.round(targetAltSmoothed),
                target_hdg: Math.round(aircraft.heading || 0),
                target_vs_fpm: Math.round(aircraft.verticalRate || 0),
                distance_nm: distance.toFixed(3),
                dist_threshold_nm: threatResult.distThreshold,
                rel_alt_smooth_ft: Math.round(relAltFt),
                alt_threshold_ft: threatResult.altThreshold,
                horiz_closure_kts: Math.round(threatResult.closureRate),
                vert_closure_fpm: Math.round(threatResult.vertClosureRate),
                horiz_tau_sec: threatResult.tauSeconds === Infinity ? 'INF' : threatResult.tauSeconds.toFixed(1),
                vert_tau_sec: threatResult.vertTauSeconds === Infinity ? 'INF' : threatResult.vertTauSeconds.toFixed(1),
                mod_tau_sec: threatResult.modTauSeconds === Infinity ? 'INF' : threatResult.modTauSeconds.toFixed(1),
                tau_threshold_sec: threatResult.tauThreshold,
                dist_trigger: threatResult.distTrigger ? 1 : 0,
                alt_trigger: threatResult.altTrigger ? 1 : 0,
                horiz_tau_trigger: threatResult.tauTrigger ? 1 : 0,
                vert_tau_trigger: threatResult.vertTauTrigger ? 1 : 0,
                alert_basis: alertBasis.join('+') || 'NONE',
                threat_raw: rawLevel,
                threat_persist: filteredLevel,
                sensitivity_level: threatResult.sensitivityLevel,
                sensitivity_phase: threatResult.sensitivityPhase,
                sensitivity_source: threatResult.sensitivitySource,
                velocity_source: threatResult.velocitySource,
                diverging: divergenceResult.isDiverging ? 1 : 0,
                divergence_count: divergenceResult.divergenceCount,
                divergence_suppressed: divergenceResult.suppressed ? 1 : 0,
                threat_final: finalLevel
            });
        });
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    // console.log(`CDTI Export: Processed ${totalSeconds} seconds, found ${exportLog.length} alert events in ${elapsed}s`);

    if (exportLog.length === 0) {
        alert('No RA/TA/PA events found in the time range.');
        return;
    }

    // Generate CSV
    exportToCSV(exportLog);
}

/**
 * Export data array to CSV file download
 */
function exportToCSV(data) {
    // Column headers (code-friendly)
    const headers = [
        'time_seconds',
        'timestamp',
        'ownship_id',
        'ownship_lat',
        'ownship_lon',
        'ownship_alt_raw_ft',
        'ownship_alt_smooth_ft',
        'ownship_hat_ft',
        'ownship_hdg',
        'ownship_vs_fpm',
        'target_id',
        'target_lat',
        'target_lon',
        'target_alt_raw_ft',
        'target_alt_smooth_ft',
        'target_hdg',
        'target_vs_fpm',
        'distance_nm',
        'dist_threshold_nm',
        'rel_alt_smooth_ft',
        'alt_threshold_ft',
        'horiz_closure_kts',
        'vert_closure_fpm',
        'horiz_tau_sec',
        'vert_tau_sec',
        'mod_tau_sec',
        'tau_threshold_sec',
        'dist_trigger',
        'alt_trigger',
        'horiz_tau_trigger',
        'vert_tau_trigger',
        'alert_basis',
        'threat_raw',
        'threat_persist',
        'sensitivity_level',
        'sensitivity_phase',
        'sensitivity_source',
        'velocity_source',
        'diverging',
        'divergence_count',
        'divergence_suppressed',
        'threat_final'
    ];

    // Excel-friendly headers (for second row)
    const headersExcel = [
        'Time Seconds',
        'Timestamp',
        'Ownship ID',
        'Ownship Lat',
        'Ownship Lon',
        'Ownship Alt Raw ft',
        'Ownship Alt Smooth ft',
        'Ownship HAT ft',
        'Ownship Hdg',
        'Ownship VS fpm',
        'Target ID',
        'Target Lat',
        'Target Lon',
        'Target Alt Raw ft',
        'Target Alt Smooth ft',
        'Target Hdg',
        'Target VS fpm',
        'Distance nm',
        'Dist Threshold nm',
        'Rel Alt Smooth ft',
        'Alt Threshold ft',
        'Horiz Closure kts',
        'Vert Closure fpm',
        'Horiz TAU sec',
        'Vert TAU sec',
        'Mod TAU sec',
        'TAU Threshold sec',
        'Dist Trigger',
        'Alt Trigger',
        'Horiz TAU Trigger',
        'Vert TAU Trigger',
        'Alert Basis',
        'Threat [raw]',
        'Threat [persist]',
        'Sensitivity Level',
        'Sensitivity Phase',
        'Sensitivity Source',
        'Velocity Source',
        'Diverging',
        'Divergence Count',
        'Divergence Suppressed',
        'Threat [final]'
    ];

    let csv = headers.join(',') + '\n';
    csv += headersExcel.join(',') + '\n';

    for (const entry of data) {
        const row = headers.map(h => entry[h]);
        csv += row.join(',') + '\n';
    }

    // Download - filename with timestamp
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join('_');
    link.setAttribute('href', url);
    link.setAttribute('download', `cdti_log_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Download configuration summary as companion .txt file
    const configLines = [
        `CDTI Export Configuration Summary`,
        `Generated: ${new Date().toISOString()}`,
        ``,
        `Ownship: ${CDTI_CONFIG.ownshipID}`,
        `Display Range: ${CDTI_CONFIG.maxRange} nm`,
        `Update Interval: ${CDTI_CONFIG.updateInterval} ms`,
        ``,
        `Altitude Smoothing: window=${altitudeSmoothing.windowSize} samples`,
        `Altitude Filter Mode: ${CDTI_CONFIG.altitudeFilter}`,
        ``,
        `TAU Alerting: ${CDTI_CONFIG.tauEnabled ? 'ENABLED' : 'DISABLED'}`,
        `GDL 88 Sensitivity: ${CDTI_CONFIG.useGDL88Sensitivity ? 'ENABLED' : 'DISABLED'} (HAT available=${CDTI_CONFIG.hatAvailable}${CDTI_CONFIG.hatAvailable ? ', elevation=' + CDTI_CONFIG.kvgtElevation + ' ft' : ''})`,
        `GPS Phase: ${CDTI_CONFIG.gpsPhase}`,
        `Default TAU: threshold=${CDTI_CONFIG.tauThreshold}s, dist=${CDTI_CONFIG.tauDistanceThreshold} nm, alt=${CDTI_CONFIG.tauAltitudeThreshold} ft`,
        ``,
        `Threat Persistence (TA): ${threatPersistence.threshold === 0 ? 'DISABLED' : threatPersistence.threshold + 's'}`,
        `Threat Persistence (PA): ${threatPersistence.paThreshold === 0 ? 'DISABLED' : threatPersistence.paThreshold + 's'}`,
        `TA Hold Duration: ${threatPersistence.holdDuration} ms`,
        `PA Hold Duration: ${threatPersistence.paHoldDuration} ms`,
        ``,
        `Divergence Test: ${CDTI_CONFIG.divergenceTestEnabled ? 'ENABLED' : 'DISABLED'}`,
        `Divergence Threshold: ${CDTI_CONFIG.divergenceThreshold}s consecutive`,
        `Divergence Mode: ${CDTI_CONFIG.divergenceMode}`,
    ];
    const configBlob = new Blob([configLines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8;' });
    const configLink = document.createElement('a');
    configLink.setAttribute('href', URL.createObjectURL(configBlob));
    configLink.setAttribute('download', `cdti_log_${timestamp}_config.txt`);
    configLink.style.visibility = 'hidden';
    document.body.appendChild(configLink);
    configLink.click();
    document.body.removeChild(configLink);

    // console.log(`CDTI Export: CSV downloaded with ${data.length} events`);
}

/**
 * Initialize CDTI module
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {Function} getAircraftData - Function that returns array of aircraft data:
 *   [{ id, lat, lon, alt, heading, verticalRate }, ...]
 */
export function setupCDTI(viewer, getAircraftData) {
    viewerRef = viewer;
    getAircraftDataFn = getAircraftData;

    // Create CDTI button
    cdtiButton = document.createElement('button');
    cdtiButton.textContent = 'CDTI';
    cdtiButton.style.position = 'absolute';
    cdtiButton.style.top = '20px';
    cdtiButton.style.left = '340px';
    cdtiButton.style.zIndex = '1000';
    cdtiButton.onclick = toggleCDTI;
    document.body.appendChild(cdtiButton);

    // Create Export button (to the right of CDTI)
    exportButton = document.createElement('button');
    exportButton.textContent = 'Export';
    exportButton.style.position = 'absolute';
    exportButton.style.top = '20px';
    exportButton.style.left = '380px';
    exportButton.style.zIndex = '1000';
    exportButton.onclick = exportCDTIData;
    document.body.appendChild(exportButton);

    // Create overlay
    createCDTIOverlay();

    // console.log('📡 CDTI Display initialized');
}

/**
 * Remove CDTI module
 */
export function removeCDTI() {
    stopUpdating();
    if (cdtiButton) cdtiButton.remove();
    if (exportButton) exportButton.remove();
    if (cdtiOverlay) cdtiOverlay.remove();
    cdtiTAAlertBox = null;
    lastTAAlertTime = 0;
    lastTAMessageLockTime = 0;
    lastTAAudioTime = 0;
    lastTAIds = new Set();
    lastProcessedTimeMs = 0;
    threatPersistence.history = {};
    divergenceTracking.history = {};
    altitudeSmoothing.history = {};
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    if (cdtiLegend) cdtiLegend.remove();
}

/**
 * Update configuration
 */
export function setCDTIConfig(config) {
    Object.assign(CDTI_CONFIG, config);
}
