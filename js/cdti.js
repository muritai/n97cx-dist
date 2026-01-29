// ===========================================================
//                   CDTI DISPLAY MODULE
// ===========================================================
//
// Cockpit Display of Traffic Information - live updating
// Track-up display centered on N97CX showing relative traffic
//
// ===========================================================

// ===========================================================
//                   RTCA STANDARD SYMBOLOGY
// ===========================================================
// Based on Sandel SN3500 Pilot's Guide - RTCA Standard
//
// Traffic Symbol Shapes:
//   RA (Resolution Advisory): Filled red square
//   TA (Traffic Advisory):    Filled yellow circle
//   PA (Proximity Advisory):  Filled cyan diamond
//   Other Traffic:            Open/hollow cyan diamond
//
// Vertical Trend Arrows:
//   Up arrow:   Climbing > 500 fpm
//   Down arrow: Descending > 500 fpm
//   No arrow:   Level or ≤ 500 fpm
// ===========================================================

// Colors per RTCA standard
const CDTI_COLORS = {
    RA: '#FF0000',      // Red - Resolution Advisory
    TA: '#FFFF00',      // Yellow - Traffic Advisory
    PA: '#00FFFF',      // Cyan - Proximity Advisory
    OTHER: '#00FFFF',   // Cyan - Other Traffic (hollow)
    OWNSHIP: '#FFFFFF', // White - Ownship symbol
};

// Altitude filter modes
const ALTITUDE_FILTERS = {
    NORMAL: { below: -2700, above: 2700, label: 'NORM' },   // ±2,700 ft
    ABV:    { below: -2700, above: 9000, label: 'ABV' },    // -2,700 to +9,000 ft
    BLW:    { below: -9000, above: 2700, label: 'BLW' },    // -9,000 to +2,700 ft
    XTD:    { below: -9000, above: 9000, label: 'XTD' },    // ±9,000 ft
};

// Configuration
const CDTI_CONFIG = {
    rangeRings: [2, 5],            // nm - configurable range rings
    maxRange: 5,                   // nm - display radius
    updateInterval: 100,           // ms - how often to redraw
    ownshipID: 'N97CX',
    compassTickInterval: 10,       // degrees between tick marks
    altitudeFilter: 'NORMAL',      // Current altitude filter mode
    verticalRateThreshold: 500,    // fpm - threshold for trend arrows
    showUTCClock: true,            // Toggle UTC clock display for screen capture
    // TAU (time-based) alerting thresholds
    tauEnabled: true,              // Enable TAU-based TA alerting
    tauThreshold: 15,              // seconds - GDL-88 uses 20s, Sandel uses 15-30s
    tauDistanceThreshold: 0.20,    // nm - TA distance threshold for TAU calculation (Sandel value; no value available for GDL)
    tauAltitudeThreshold: 800,     // ft - must be within this altitude for TAU alert
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
let cdtiLegend = null;
let isVisible = false;
let isLegendVisible = false;
let updateTimer = null;
let getAircraftDataFn = null;  // Function to get all aircraft positions

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
    // Vertical closure rate = -(target_Vz - ownship_Vz)
    // Positive = aircraft converging vertically, Negative = diverging
    const vertClosureRate = -(tgtVz - ownVz);  // fpm

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
 *
 * @param {number} distanceNm - Horizontal distance in nautical miles
 * @param {number} relAltFt - Relative altitude in feet (target - ownship)
 * @param {Object} closureInfo - Closure info from calculateClosure()
 * @returns {Object} Threat classification with trigger details
 */
function classifyThreat(distanceNm, relAltFt, closureInfo = null) {
    const absRelAlt = Math.abs(relAltFt);

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
        closureRate: closureRate,
        vertClosureRate: vertClosureRate,
        velocitySource: velocitySource,
        altThreshold: null,    // Will be set based on threat level
        distThreshold: null,   // Will be set based on threat level
        altTrigger: false      // Whether altitude is within threshold
    };

    // Resolution Advisory (RA) - TCAS II only
    // Immediate threat requiring evasive action
    // RA: Very close traffic
    if (distanceNm <= 0.20 && absRelAlt <= 600) {
        result.level = 'RA';
        result.distTrigger = true;
        result.altThreshold = 600;
        result.distThreshold = 0.20;
        result.altTrigger = absRelAlt <= 600;
        return result;
    }

    // Traffic Advisory (TA)
    // Condition 1: Within distance threshold (0.20 to 0.55nm AND ±800 ft)
    const inTADistanceZone = distanceNm <= 0.55 && absRelAlt <= 800;

    // Condition 2: TAU-based using MODIFIED TAU (considers both horizontal and vertical)
    // Modified tau uses min(horizontal, vertical) when converging vertically
    const horizTauTriggered = CDTI_CONFIG.tauEnabled &&
                              horizTauSeconds <= CDTI_CONFIG.tauThreshold &&
                              absRelAlt <= CDTI_CONFIG.tauAltitudeThreshold;

    // Vertical tau trigger: converging vertically and within time threshold
    const vertTauTriggered = CDTI_CONFIG.tauEnabled &&
                             vertClosureRate > 0 &&
                             vertTauSeconds <= CDTI_CONFIG.tauThreshold;

    // Combined: either horizontal or vertical tau triggered
    const tauTriggered = horizTauTriggered || vertTauTriggered;

    if (inTADistanceZone || tauTriggered) {
        result.level = 'TA';
        result.distTrigger = inTADistanceZone;
        result.tauTrigger = horizTauTriggered && !inTADistanceZone;
        result.vertTauTrigger = vertTauTriggered && !inTADistanceZone && !horizTauTriggered;
        result.altThreshold = 800;
        result.distThreshold = 0.55;
        result.altTrigger = absRelAlt <= 800;
        return result;
    }

    // Proximity Advisory (PA)
    // Within 4nm AND ±1,200 ft
    if (distanceNm <= 4.0 && absRelAlt <= 1200) {
        result.level = 'PA';
        result.distTrigger = true;
        result.altThreshold = 1200;
        result.distThreshold = 4.0;
        result.altTrigger = absRelAlt <= 1200;
        return result;
    }

    // Other Traffic (non-alerting)
    return result;
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
    
    // Debug: log heading
    console.log(`CDTI: N97CX heading = ${ownHeading.toFixed(1)}°`);
    
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
        
        if (idx === 0) {
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

    aircraftData.forEach(aircraft => {
        if (aircraft.id === CDTI_CONFIG.ownshipID) return;

        // Calculate relative position
        const rel = latLonToRelativeNM(ownship.lat, ownship.lon, aircraft.lat, aircraft.lon);
        const distance = Math.sqrt(rel.x * rel.x + rel.y * rel.y);

        // Calculate relative altitude in feet
        const relAltFt = aircraft.alt - ownship.alt;
        const relAltHundreds = Math.round(relAltFt / 100);

        // Apply altitude filter
        if (!passesAltitudeFilter(relAltFt)) return;

        // Calculate closure and TAU (horizontal and vertical)
        const closureInfo = calculateClosure(ownship, aircraft, distance, rel, relAltFt);

        // Classify threat level (now includes TAU-based alerting)
        const threatResult = classifyThreat(distance, relAltFt, closureInfo);
        const threatLevel = threatResult.level;

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

        trafficToDraw.push({
            pos,
            trafficHeading,
            relAltHundreds,
            verticalRate: aircraft.verticalRate || 0,
            threatLevel,
            distance
        });
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
            traffic.threatLevel
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

    // Draw UTC clock at bottom (for screen capture)
    if (CDTI_CONFIG.showUTCClock) {
        const utcDate = Cesium.JulianDate.toDate(currentTime);
        const utcStr = utcDate.toISOString().slice(11, 19) + ' UTC';  // HH:MM:SS[19].sss[23] UTC
        ctx.fillStyle = '#0f0';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(utcStr, center, size - 8);
    }
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
        
        // Debug
        console.log(`CDTI Runway ${rwy.name}: true bearing = ${rwyBearing.toFixed(1)}°`);
        
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
 * Draw ownship chevron symbol
 */
function drawOwnshipSymbol(ctx, x, y) {
    const size = 12;
    
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    // Chevron pointing up
    ctx.moveTo(x, y - size);           // Top point
    ctx.lineTo(x - size * 0.7, y + size * 0.5);  // Bottom left
    ctx.lineTo(x, y);                   // Center notch
    ctx.lineTo(x + size * 0.7, y + size * 0.5);  // Bottom right
    ctx.closePath();
    ctx.fill();
}

/**
 * Draw traffic symbol based on RTCA standard
 * - RA: Red filled square
 * - TA: Yellow filled circle
 * - PA: Cyan filled diamond
 * - OTHER: Cyan open/hollow diamond
 */
function drawTrafficSymbol(ctx, x, y, heading, relAlt, verticalRate, threatLevel = 'OTHER') {
    const size = 8;
    const color = CDTI_COLORS[threatLevel];

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    switch (threatLevel) {
        case 'RA':
            // Filled red square
            ctx.fillRect(x - size, y - size, size * 2, size * 2);
            break;

        case 'TA':
            // Filled yellow circle
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fill();
            break;

        case 'PA':
            // Filled cyan diamond
            ctx.beginPath();
            ctx.moveTo(x, y - size);        // Top
            ctx.lineTo(x + size, y);        // Right
            ctx.lineTo(x, y + size);        // Bottom
            ctx.lineTo(x - size, y);        // Left
            ctx.closePath();
            ctx.fill();
            break;

        case 'OTHER':
        default:
            // Open/hollow cyan diamond
            ctx.beginPath();
            ctx.moveTo(x, y - size);        // Top
            ctx.lineTo(x + size, y);        // Right
            ctx.lineTo(x, y + size);        // Bottom
            ctx.lineTo(x - size, y);        // Left
            ctx.closePath();
            ctx.stroke();
            break;
    }

    // Draw altitude tag with contrast
    drawAltitudeTag(ctx, x + size + 4, y, relAlt, verticalRate, color);
}

/**
 * Draw out-of-range RA/TA symbol (half symbol at compass edge)
 */
function drawOutOfRangeSymbol(ctx, x, y, relAlt, verticalRate, threatLevel) {
    const size = 10;
    const color = CDTI_COLORS[threatLevel];

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    // Calculate angle from center to position for clipping
    ctx.save();

    switch (threatLevel) {
        case 'RA':
            // Half-filled red square (only inner half visible)
            ctx.fillRect(x - size * 0.5, y - size, size, size * 2);
            break;

        case 'TA':
            // Half-filled yellow circle
            ctx.beginPath();
            ctx.arc(x, y, size, -Math.PI / 2, Math.PI / 2);
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
        width: 450px;
        height: 480px;
        z-index: 2000;
        display: none;
        background: rgba(30, 30, 30, 0.95);
        border-radius: 6px;
        border: 1px solid #555;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        min-width: 300px;
        min-height: 330px;
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
    titleBar.appendChild(closeBtn);
    
    // Canvas container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
        width: 100%;
        height: calc(100% - 60px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 5px;
        box-sizing: border-box;
    `;
    
    // Canvas
    cdtiCanvas = document.createElement('canvas');
    cdtiCanvas.width = 400;
    cdtiCanvas.height = 400;
    cdtiCanvas.style.cssText = `
        background: #000;
        border-radius: 4px;
    `;
    cdtiCtx = cdtiCanvas.getContext('2d');
    
    canvasContainer.appendChild(cdtiCanvas);
    
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
    [2, 5, 10, 20].forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = `${r} nm`;
        if (r === CDTI_CONFIG.maxRange) opt.selected = true;
        rangeSelect.appendChild(opt);
    });
    rangeSelect.onchange = (e) => {
        CDTI_CONFIG.maxRange = parseInt(e.target.value);
        // Update range rings based on selection
        if (CDTI_CONFIG.maxRange <= 2) {
            CDTI_CONFIG.rangeRings = [1, 2];
        } else if (CDTI_CONFIG.maxRange <= 5) {
            CDTI_CONFIG.rangeRings = [2, 5];
        } else if (CDTI_CONFIG.maxRange <= 10) {
            CDTI_CONFIG.rangeRings = [5, 10];
        } else {
            CDTI_CONFIG.rangeRings = [10, 20];
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
    controlsBar.appendChild(legendBtn);
    
    cdtiOverlay.appendChild(titleBar);
    cdtiOverlay.appendChild(canvasContainer);
    cdtiOverlay.appendChild(controlsBar);
    document.body.appendChild(cdtiOverlay);
    
    // Make draggable
    makeDraggable(cdtiOverlay, titleBar);
    
    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const width = entry.contentRect.width;
            const height = entry.contentRect.height - 60;  // Subtract title and controls
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
            <span style="font-size: 13px; font-weight: bold; color: #fff;">CDTI Symbology (RTCA)</span>
            <button id="cdtiLegendClose" style="background: transparent; color: #aaa; border: none; cursor: pointer; font-size: 16px; padding: 0 4px;">✕</button>
        </div>

        <div style="font-size: 11px; line-height: 1.8;">
            <div style="margin-bottom: 10px; font-weight: bold; color: #fff;">Traffic Symbols:</div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><rect x="4" y="4" width="16" height="16" fill="#FF0000"/></svg>
                <span><span style="color: #FF0000; font-weight: bold;">RA</span> - Resolution Advisory (TCAS II)</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><circle cx="12" cy="12" r="8" fill="#FFFF00"/></svg>
                <span><span style="color: #FFFF00; font-weight: bold;">TA</span> - Traffic Advisory (≤0.55nm, ±800ft)</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                <svg width="24" height="24"><polygon points="12,2 22,12 12,22 2,12" fill="#00FFFF"/></svg>
                <span><span style="color: #00FFFF; font-weight: bold;">PA</span> - Proximity Advisory (≤4nm, ±1200ft)</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                <svg width="24" height="24"><polygon points="12,4 20,12 12,20 4,12" fill="none" stroke="#00FFFF" stroke-width="2"/></svg>
                <span style="color: #00FFFF;">Other Traffic (non-alerting)</span>
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Altitude Tag:</div>
            <div style="margin-left: 10px; margin-bottom: 6px;">
                <span style="color: #00FFFF;">+05</span> = 500ft above ownship
            </div>
            <div style="margin-left: 10px; margin-bottom: 6px;">
                <span style="color: #00FFFF;">-02</span> = 200ft below ownship
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Vertical Trend (>500 fpm):</div>
            <div style="margin-left: 10px; margin-bottom: 6px;">
                <span style="color: #00FFFF;">↑</span> Climbing &nbsp;&nbsp;
                <span style="color: #00FFFF;">↓</span> Descending
            </div>

            <div style="margin: 10px 0; font-weight: bold; color: #fff;">Altitude Filters:</div>
            <div style="margin-left: 10px; font-size: 10px;">
                <div>NORM: ±2,700ft</div>
                <div>ABV: -2,700 to +9,000ft</div>
                <div>BLW: -9,000 to +2,700ft</div>
                <div>XTD: ±9,000ft</div>
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

    console.log('CDTI Export: Starting batch export...');
    const startTime = performance.now();

    // Get time range from viewer clock
    const clockStart = viewerRef.clock.startTime;
    const clockStop = viewerRef.clock.stopTime;
    const totalSeconds = Cesium.JulianDate.secondsDifference(clockStop, clockStart);

    console.log(`CDTI Export: Time range = ${totalSeconds.toFixed(1)} seconds`);

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

        // Evaluate each traffic aircraft
        aircraftData.forEach(aircraft => {
            if (aircraft.id === CDTI_CONFIG.ownshipID) return;

            // Calculate relative position
            const rel = latLonToRelativeNM(ownship.lat, ownship.lon, aircraft.lat, aircraft.lon);
            const distance = Math.sqrt(rel.x * rel.x + rel.y * rel.y);

            // Calculate relative altitude
            const relAltFt = aircraft.alt - ownship.alt;

            // Calculate closure and TAU (horizontal and vertical)
            const closureInfo = calculateClosure(ownship, aircraft, distance, rel, relAltFt);

            // Classify threat (now includes TAU-based alerting)
            const threatResult = classifyThreat(distance, relAltFt, closureInfo);

            // Only log RA, TA, PA (not OTHER)
            if (threatResult.level === 'OTHER') return;

            // Deduplication: only log once per second per target
            const targetKey = aircraft.id;
            const lastLogged = lastLoggedTime[targetKey] || -999;
            if (sec - lastLogged < 1) return;
            lastLoggedTime[targetKey] = sec;

            // Build alert basis from threat result
            const absRelAlt = Math.abs(relAltFt);
            let alertBasis = [];

            // Altitude is always a factor for alerts
            if (threatResult.level === 'RA' && absRelAlt <= 600) alertBasis.push('ALT');
            else if (threatResult.level === 'TA' && absRelAlt <= 800) alertBasis.push('ALT');
            else if (threatResult.level === 'PA' && absRelAlt <= 1200) alertBasis.push('ALT');

            if (threatResult.distTrigger) alertBasis.push('DIST');
            if (threatResult.tauTrigger || threatResult.vertTauTrigger) alertBasis.push('TAU');

            // Create export entry
            exportLog.push({
                time_seconds: sec.toFixed(2),
                timestamp: julianToISO(currentTime),
                ownship_id: ownship.id,
                ownship_lat: ownship.lat.toFixed(6),
                ownship_lon: ownship.lon.toFixed(6),
                ownship_alt_ft: Math.round(ownship.alt),
                ownship_hdg: Math.round(ownship.heading || 0),
                ownship_vs_fpm: Math.round(ownship.verticalRate || 0),
                target_id: aircraft.id,
                target_lat: aircraft.lat.toFixed(6),
                target_lon: aircraft.lon.toFixed(6),
                target_alt_ft: Math.round(aircraft.alt),
                target_hdg: Math.round(aircraft.heading || 0),
                target_vs_fpm: Math.round(aircraft.verticalRate || 0),
                threat_level: threatResult.level,
                distance_nm: distance.toFixed(3),
                dist_threshold_nm: threatResult.distThreshold,
                rel_alt_ft: Math.round(relAltFt),
                alt_threshold_ft: threatResult.altThreshold,
                horiz_closure_kts: Math.round(threatResult.closureRate),
                vert_closure_fpm: Math.round(threatResult.vertClosureRate),
                horiz_tau_sec: threatResult.tauSeconds === Infinity ? 'INF' : threatResult.tauSeconds.toFixed(1),
                vert_tau_sec: threatResult.vertTauSeconds === Infinity ? 'INF' : threatResult.vertTauSeconds.toFixed(1),
                mod_tau_sec: threatResult.modTauSeconds === Infinity ? 'INF' : threatResult.modTauSeconds.toFixed(1),
                dist_trigger: threatResult.distTrigger ? 1 : 0,
                alt_trigger: threatResult.altTrigger ? 1 : 0,
                horiz_tau_trigger: threatResult.tauTrigger ? 1 : 0,
                vert_tau_trigger: threatResult.vertTauTrigger ? 1 : 0,
                alert_basis: alertBasis.join('+') || 'NONE',
                velocity_source: threatResult.velocitySource
            });
        });
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`CDTI Export: Processed ${totalSeconds} seconds, found ${exportLog.length} alert events in ${elapsed}s`);

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
        'ownship_alt_ft',
        'ownship_hdg',
        'ownship_vs_fpm',
        'target_id',
        'target_lat',
        'target_lon',
        'target_alt_ft',
        'target_hdg',
        'target_vs_fpm',
        'threat_level',
        'distance_nm',
        'dist_threshold_nm',
        'rel_alt_ft',
        'alt_threshold_ft',
        'horiz_closure_kts',
        'vert_closure_fpm',
        'horiz_tau_sec',
        'vert_tau_sec',
        'mod_tau_sec',
        'dist_trigger',
        'alt_trigger',
        'horiz_tau_trigger',
        'vert_tau_trigger',
        'alert_basis',
        'velocity_source'
    ];

    // Excel-friendly headers (for second row)
    const headersExcel = [
        'Time Seconds',
        'Timestamp',
        'Ownship ID',
        'Ownship Lat',
        'Ownship Lon',
        'Ownship Alt ft',
        'Ownship Hdg',
        'Ownship VS fpm',
        'Target ID',
        'Target Lat',
        'Target Lon',
        'Target Alt ft',
        'Target Hdg',
        'Target VS fpm',
        'Threat Level',
        'Distance nm',
        'Dist Threshold nm',
        'Rel Alt ft',
        'Alt Threshold ft',
        'Horiz Closure kts',
        'Vert Closure fpm',
        'Horiz TAU sec',
        'Vert TAU sec',
        'Mod TAU sec',
        'Dist Trigger',
        'Alt Trigger',
        'Horiz TAU Trigger',
        'Vert TAU Trigger',
        'Alert Basis',
        'Velocity Source'
    ];

    let csv = headers.join(',') + '\n';
    csv += headersExcel.join(',') + '\n';

    for (const entry of data) {
        const row = headers.map(h => entry[h]);
        csv += row.join(',') + '\n';
    }

    // Download - filename reflects TAU config: t=time(s), d=distance(nm*100), a=altitude(ft)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const tauT = Math.round(CDTI_CONFIG.tauThreshold);
    const tauD = Math.round(CDTI_CONFIG.tauDistanceThreshold * 100);
    const tauA = Math.round(CDTI_CONFIG.tauAltitudeThreshold);
    link.setAttribute('href', url);
    link.setAttribute('download', `cdti_t${tauT}_d${tauD}_a${tauA}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`CDTI Export: CSV downloaded with ${data.length} events`);
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

    // Create overlay
    createCDTIOverlay();

    console.log('📡 CDTI Display initialized');
}

/**
 * Remove CDTI module
 */
export function removeCDTI() {
    stopUpdating();
    if (cdtiButton) cdtiButton.remove();
    if (cdtiOverlay) cdtiOverlay.remove();
    if (cdtiLegend) cdtiLegend.remove();
}

/**
 * Update configuration
 */
export function setCDTIConfig(config) {
    Object.assign(CDTI_CONFIG, config);
}
