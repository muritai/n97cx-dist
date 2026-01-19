// ===========================================================
//                     FOLLOW VIEW MODULE
// ===========================================================
//
// Public API:
//   setupFollowView(viewer, followBtn)
//   disableFollowView()
//   isFollowEnabled()
//
// Behavior:
//   - Follow-button toggles cockpit POV of N97CX
//   - Heading is estimated from position data
//   - Bank is taken from CSV (piperRollData), or estimated
//   - Hides N97CX point, label, history, and ground line in follow mode
//   - Auto-disables when ATCT view is active
//
// ===========================================================

import { disableATCT } from "./atctView.js";
import {
    getPiperRollAt,
    getRollAt,
    estimateBankAngle,
    computeHeading,
    isSimEnabled
} from "./drones.js";

let viewerRef = null;
let followBtnRef = null;
let followEnabled = false;

const HEADING_BUFFER = [];
const BANK_BUFFER = [];
const MAX_BUFFER_SIZE = 15;  // Larger buffer for smoother bank transitions

let previousCamPos = null;
const POSITION_SMOOTHING = 0.12;  // Balance between smooth and responsive

const FOLLOW_TARGET = "N97CX";
const FIXED_PITCH_DEG = 0;  // Level horizon for cockpit POV

// Simulation extension indicator (after this time, we're in simulated path)
const SIM_SPLIT_TIME = "2022-07-17T19:02:51Z";
let simSplitJulian = null;
let simOverlay = null;
let simLabel = null;
let isInSimExtension = false;

// Store original FOV to restore later
let originalFOV = null;
const COCKPIT_FOV_DEG = 90;  // Wider FOV for cockpit view

// ================== PUBLIC API ==================

export function setupFollowView(viewer, followBtn) {
    viewerRef = viewer;
    followBtnRef = followBtn;
    followBtn.addEventListener("click", toggleFollowView);
}

export function disableFollowView() {
    if (!followEnabled) return;
    toggleFollowView();
}

export function isFollowEnabled() {
    return followEnabled;
}

// ================== TOGGLE ==================

function toggleFollowView() {
    followEnabled = !followEnabled;

    if (followEnabled) {
        disableATCT(); // Cannot use both
        activateButtonStyle();
        enableFollow();
    } else {
        deactivateButtonStyle();
        disableFollow();
    }
}

function activateButtonStyle() {
    followBtnRef.style.backgroundColor = "gray";
    followBtnRef.style.color = "white";
    followBtnRef.textContent = "Following N97CX";
}

function deactivateButtonStyle() {
    followBtnRef.style.backgroundColor = "";
    followBtnRef.style.color = "";
    followBtnRef.textContent = "Follow N97CX";
}

// ================== SHOW/HIDE N97CX VISUALS ==================

function hideN97CXVisuals() {
    // Hide the drone point, label, and path trail
    const drone = viewerRef.entities.getById(FOLLOW_TARGET);
    if (drone) {
        drone.show = false;
    }

    // Hide history line
    const historyLine = viewerRef.entities.getById(`history-${FOLLOW_TARGET}`);
    if (historyLine) {
        historyLine.show = false;
    }

    // Hide ground line
    const groundLine = viewerRef.entities.getById(`groundline-${FOLLOW_TARGET}`);
    if (groundLine) {
        groundLine.show = false;
    }

    // Hide full path (when "All" checkbox is checked)
    const fullPath = viewerRef.entities.getById(`fullpath-${FOLLOW_TARGET}`);
    if (fullPath) {
        fullPath.show = false;
    }

    // Hide sim path dots
    viewerRef.entities.values.forEach(entity => {
        if (entity.id && entity.id.startsWith(`sim-dot-${FOLLOW_TARGET}-`)) {
            entity.show = false;
        }
    });
}

function showN97CXVisuals() {
    const drone = viewerRef.entities.getById(FOLLOW_TARGET);
    if (drone) {
        drone.show = true;
    }

    const historyLine = viewerRef.entities.getById(`history-${FOLLOW_TARGET}`);
    if (historyLine) {
        historyLine.show = true;
    }

    const groundLine = viewerRef.entities.getById(`groundline-${FOLLOW_TARGET}`);
    if (groundLine) {
        groundLine.show = true;
    }

    // Show full path (if it exists)
    const fullPath = viewerRef.entities.getById(`fullpath-${FOLLOW_TARGET}`);
    if (fullPath) {
        fullPath.show = true;
    }

    // Show sim path dots (if sim is enabled)
    if (isSimEnabled()) {
        viewerRef.entities.values.forEach(entity => {
            if (entity.id && entity.id.startsWith(`sim-dot-${FOLLOW_TARGET}-`)) {
                entity.show = true;
            }
        });
    }
}

// ================== SIM EXTENSION OVERLAY ==================

function createSimOverlay() {
    // Create dark overlay
    simOverlay = document.createElement('div');
    simOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.3);
        pointer-events: none;
        z-index: 999;
        display: none;
        transition: opacity 0.5s ease;
    `;
    document.body.appendChild(simOverlay);

    // Create flashing label
    simLabel = document.createElement('div');
    simLabel.textContent = 'SIM EXTENSION';
    simLabel.style.cssText = `
        position: fixed;
        bottom: 200px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 100, 0, 0.85);
        color: white;
        padding: 8px 20px;
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        border-radius: 4px;
        z-index: 1000;
        display: none;
        animation: simPulse 1.5s ease-in-out infinite;
    `;
    document.body.appendChild(simLabel);

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes simPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    `;
    document.head.appendChild(style);
}

function showSimOverlay() {
    if (!isInSimExtension) {
        isInSimExtension = true;
        if (simOverlay) simOverlay.style.display = 'block';
        if (simLabel) simLabel.style.display = 'block';
    }
}

function hideSimOverlay() {
    if (isInSimExtension) {
        isInSimExtension = false;
        if (simOverlay) simOverlay.style.display = 'none';
        if (simLabel) simLabel.style.display = 'none';
    }
}

function removeSimOverlay() {
    hideSimOverlay();
    if (simOverlay) {
        simOverlay.remove();
        simOverlay = null;
    }
    if (simLabel) {
        simLabel.remove();
        simLabel = null;
    }
}

// ================== ENABLE / DISABLE ==================

function enableFollow() {
    // Store original FOV and set cockpit FOV
    originalFOV = viewerRef.camera.frustum.fov;
    viewerRef.camera.frustum.fov = Cesium.Math.toRadians(COCKPIT_FOV_DEG);

    // Hide N97CX visuals
    hideN97CXVisuals();

    // Clear buffers for fresh start
    HEADING_BUFFER.length = 0;
    BANK_BUFFER.length = 0;
    previousCamPos = null;

    // Initialize sim split time and create overlay
    simSplitJulian = Cesium.JulianDate.fromIso8601(SIM_SPLIT_TIME);
    createSimOverlay();

    // Start following
    viewerRef.clock.onTick.addEventListener(onFollowTick);
}

function disableFollow() {
    viewerRef.clock.onTick.removeEventListener(onFollowTick);
    viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

    // Restore original FOV
    if (originalFOV !== null) {
        viewerRef.camera.frustum.fov = originalFOV;
        originalFOV = null;
    }

    // Remove sim overlay
    removeSimOverlay();

    // Show N97CX visuals again
    showN97CXVisuals();
}

// ================== CAMERA UPDATE ==================

function onFollowTick(clock) {
    if (!followEnabled) return;

    const pastSplitTime = simSplitJulian && Cesium.JulianDate.greaterThan(clock.currentTime, simSplitJulian);

    // If past split time and sim not enabled, stop clock at split time
    if (pastSplitTime && !isSimEnabled()) {
        clock.currentTime = Cesium.JulianDate.clone(simSplitJulian);
        clock.shouldAnimate = false;
        hideSimOverlay();
        return;
    }

    // Show sim overlay only when sim is enabled and past split time
    if (pastSplitTime && isSimEnabled()) {
        showSimOverlay();
    } else {
        hideSimOverlay();
    }

    updateFollowCamera(clock, FOLLOW_TARGET);
}

// ================== UTIL ==================

function normalizeAngleRad(angle) {
    return Cesium.Math.negativePiToPi(angle);
}

// ================== MAIN CAMERA LOGIC ==================

export function updateFollowCamera(clock, droneID = "N97CX") {
    const drone = viewerRef.entities.getById(droneID);
    if (!drone) {
        console.warn("🚨 Drone not found:", droneID);
        return;
    }

    const time = clock.currentTime;
    const pos = drone.position?.getValue(time);
    if (!Cesium.defined(pos)) {
        console.warn("❌ Position undefined at", time.toString());
        return;
    }

    // === Estimate heading (forward-looking for better path centering) ===
    const delta = 0.5;
    const futureTime = Cesium.JulianDate.addSeconds(time, delta, new Cesium.JulianDate());
    const pastTime = Cesium.JulianDate.addSeconds(time, -delta, new Cesium.JulianDate());

    // Try forward-looking first, fall back to backward-looking
    let p1 = drone.position.getValue(time);
    let p2 = drone.position.getValue(futureTime);

    if (!p2) {
        // Fall back to backward-looking at end of flight data
        p2 = p1;
        p1 = drone.position.getValue(pastTime);
    }

    if (!p1 || !p2) {
        console.warn("⚠️ Cannot estimate heading — missing position samples.");
        return;
    }

    let headingRad = computeHeading(p1, p2);
    headingRad = normalizeAngleRad(headingRad);

    // === Get bank angle ===
    let bankDeg;
    const csvRoll = getRollAt(droneID, time);

    if (csvRoll !== null) {
        // Use CSV data directly for N97CX
        bankDeg = csvRoll;
    } else {
        // Fall back to estimated bank angle
        bankDeg = estimateBankAngle(time, drone.position);
    }
    
    let bankRad = normalizeAngleRad(Cesium.Math.toRadians(bankDeg));

    // === Smooth heading and bank ===
    HEADING_BUFFER.push(headingRad);
    BANK_BUFFER.push(bankRad);

    if (HEADING_BUFFER.length > MAX_BUFFER_SIZE) HEADING_BUFFER.shift();
    if (BANK_BUFFER.length > MAX_BUFFER_SIZE) BANK_BUFFER.shift();

    const avgHeading = HEADING_BUFFER.reduce((sum, val) => sum + val, 0) / HEADING_BUFFER.length;
    const avgBank = BANK_BUFFER.reduce((sum, val) => sum + val, 0) / BANK_BUFFER.length;

    // === Smooth the aircraft position ===
    if (!previousCamPos) {
        previousCamPos = Cesium.Cartesian3.clone(pos);
    } else {
        previousCamPos = Cesium.Cartesian3.lerp(
            previousCamPos,
            pos,
            POSITION_SMOOTHING,
            new Cesium.Cartesian3()
        );
    }

    // === Cockpit POV camera offset ===
    // Piper Meridian: pilot eye position relative to aircraft center
    const chaseDistance = -3;   // Forward from aircraft center (cockpit near nose)
    const chaseHeight   = 1.5;  // Pilot eye level above aircraft center

    const headingPitchRoll = new Cesium.HeadingPitchRoll(avgHeading, 0, 0);
    const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
        previousCamPos, 
        headingPitchRoll, 
        Cesium.Ellipsoid.WGS84,
        Cesium.Transforms.localFrameToFixedFrameDefault
    );

    const localOffset = new Cesium.Cartesian3(
        -chaseDistance,  // X: negative = behind, positive = in front
        0,               // Y: left/right offset
        chaseHeight      // Z: up/down offset
    );

    const cameraPos = Cesium.Matrix4.multiplyByPoint(
        transform, 
        localOffset, 
        new Cesium.Cartesian3()
    );

    // === Set Camera View ===
    viewerRef.camera.setView({
        destination: cameraPos,
        orientation: {
            heading: avgHeading,
            pitch: Cesium.Math.toRadians(FIXED_PITCH_DEG),
            roll: avgBank
        }
    });
}
