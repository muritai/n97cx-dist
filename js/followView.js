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
    estimateBankAngle,
    computeHeading
} from "./drones.js";

let viewerRef = null;
let followBtnRef = null;
let followEnabled = false;

const HEADING_BUFFER = [];
const BANK_BUFFER = [];
const MAX_BUFFER_SIZE = 10;  // Smaller for faster response

let previousCamPos = null;
const POSITION_SMOOTHING = 0.12;  // Balance between smooth and responsive

const FOLLOW_TARGET = "N97CX";
const FIXED_PITCH_DEG = 0;  // Level horizon for cockpit POV

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
    const drone = viewerRef.entities.getById(FOLLOW_TARGET);
    if (drone) {
        drone.show = false;
    }
    
    const historyLine = viewerRef.entities.getById(`history-${FOLLOW_TARGET}`);
    if (historyLine) {
        historyLine.show = false;
    }
    
    const groundLine = viewerRef.entities.getById(`groundline-${FOLLOW_TARGET}`);
    if (groundLine) {
        groundLine.show = false;
    }
    
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
    
    // Show N97CX visuals again
    showN97CXVisuals();
}

// ================== CAMERA UPDATE ==================

function onFollowTick(clock) {
    if (!followEnabled) return;
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

    // === Estimate heading ===
    const delta = 0.5;
    const pastTime = Cesium.JulianDate.addSeconds(time, -delta, new Cesium.JulianDate());
    const p1 = drone.position.getValue(pastTime);
    const p2 = drone.position.getValue(time);

    if (!p1 || !p2) {
        console.warn("⚠️ Cannot estimate heading — missing position samples.");
        return;
    }

    let headingRad = computeHeading(p1, p2);
    headingRad = normalizeAngleRad(headingRad);

    // === Get bank angle ===
    let bankDeg;
    const csvRoll = getPiperRollAt(time);
    
    if (csvRoll !== null && droneID === "N97CX") {
        // Use CSV data directly
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
    const chaseDistance = -2;   // Forward from aircraft center (cockpit near nose)
    const chaseHeight   = 0.5;  // Pilot eye level above aircraft center

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
            roll: -avgBank
        }
    });
}
