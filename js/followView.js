// ===========================================================
//                     FOLLOW VIEW MODULE
// ===========================================================
//
// Public API:
//   setupFollowView(viewer, followBtn)
//   disableFollowView()
//   isFollowEnabled()
//   getSmoothedFollowPosition()  - Returns smoothed position for 3D model sync
//
// Behavior:
//   - Follow-button toggles tail view POV of N97CX (camera behind aircraft)
//   - Heading/pitch/bank from HPB data, with fallback to estimated values
//   - Camera and 3D model share smoothed position (prevents jitter)
//   - Hides N97CX point, label, history, and ground line in follow mode
//   - Keeps 3D model visible for tail view
//   - Auto-disables when ATCT view is active
//
// ===========================================================

import { disableATCT } from "./atctView.js";
import {
    getPiperRollAt,
    estimateBankAngle,
    computeHeading,
    get3DModelPosition,
    getModelConfig
} from "./drones.js";
import { getOrientation, isHPBLoaded, loadHPBData } from "./hpbOrientationData.js";

let viewerRef = null;
let followBtnRef = null;
let followEnabled = false;

let previousCamPos = null;
const POSITION_SMOOTHING = 1.0;  // 1.0 = no smoothing, use raw position

// Orientation smoothing to blend HPB data transitions
let previousHeading = null;
let previousPitch = null;
let previousBank = null;
const ORIENTATION_SMOOTHING = 0.3;  // Lower = smoother transitions, higher = more responsive

// Use preRender instead of onTick for tighter timing
let preRenderHandler = null;

// Smoothed position shared with 3D model (prevents jitter)
let smoothedModelPosition = null;

// Store original position property to restore when follow ends
let originalModelPositionProperty = null;

const FOLLOW_TARGET = "N97CX";
const FIXED_PITCH_DEG = 0;  // Level horizon for cockpit POV

// Tail view: camera behind aircraft, looking at tail (medium chase)
const TAIL_VIEW_BACK = 25.0;   // Meters behind aircraft
const TAIL_VIEW_UP = 3.0;    // Meters above aircraft 
const TAIL_VIEW_LEFT = 0.0;   // Centered behind

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

export function getSmoothedFollowPosition() {
    return smoothedModelPosition;
}

// ================== TOGGLE ==================

function toggleFollowView() {
    followEnabled = !followEnabled;
    console.log("TOGGLE followEnabled =", followEnabled);

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
        console.log("  Hidden drone entity");
    }

    // Keep 3D model visible for tail view (camera is behind aircraft)
    const model3DId = `${FOLLOW_TARGET}-3d-model`;
    const model3D = viewerRef.entities.getById(model3DId);
    console.log(`  Looking for 3D model: ${model3DId}, found: ${!!model3D}`);
    if (model3D) {
        model3D.show = true;  // Keep visible for tail view
        console.log("  Showing 3D model for tail view");
    }

    const historyLine = viewerRef.entities.getById(`history-${FOLLOW_TARGET}`);
    if (historyLine) {
        historyLine.show = false;
    }

    const groundLine = viewerRef.entities.getById(`groundline-${FOLLOW_TARGET}`);
    if (groundLine) {
        groundLine.show = false;
    }

    console.log("👁️ N97CX visuals configured for tail view");
}

function showN97CXVisuals() {
    const drone = viewerRef.entities.getById(FOLLOW_TARGET);
    if (drone) {
        drone.show = true;
    }

    // Restore the 3D model entity
    const model3D = viewerRef.entities.getById(`${FOLLOW_TARGET}-3d-model`);
    if (model3D) {
        model3D.show = true;
    }

    const historyLine = viewerRef.entities.getById(`history-${FOLLOW_TARGET}`);
    if (historyLine) {
        historyLine.show = true;
    }

    const groundLine = viewerRef.entities.getById(`groundline-${FOLLOW_TARGET}`);
    if (groundLine) {
        groundLine.show = true;
    }

    console.log("👁️ N97CX visuals restored");
}

// ================== ENABLE / DISABLE ==================

async function enableFollow() {
    // Load HPB data if not already loaded (needed for smooth heading/bank)
    if (!isHPBLoaded(FOLLOW_TARGET)) {
        console.log(`Loading HPB data for ${FOLLOW_TARGET}...`);
        await loadHPBData(FOLLOW_TARGET);
    }

    // Store original FOV and set cockpit FOV
    originalFOV = viewerRef.camera.frustum.fov;
    viewerRef.camera.frustum.fov = Cesium.Math.toRadians(COCKPIT_FOV_DEG);

    // Hide N97CX visuals
    hideN97CXVisuals();

    // Reset position smoothing
    previousCamPos = null;
    smoothedModelPosition = null;
    originalModelPositionProperty = null;  // Will be captured on first use

    // Reset orientation smoothing
    previousHeading = null;
    previousPitch = null;
    previousBank = null;

    // Start following - use preRender for tightest timing (right before frame renders)
    preRenderHandler = viewerRef.scene.preRender.addEventListener(onFollowPreRender);
}

function disableFollow() {
    // Remove preRender handler
    if (preRenderHandler) {
        preRenderHandler();  // Cesium event listeners return a removal function
        preRenderHandler = null;
    }
    viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

    // Restore original FOV
    if (originalFOV !== null) {
        viewerRef.camera.frustum.fov = originalFOV;
        originalFOV = null;
    }

    // Restore original position property for 3D model
    if (originalModelPositionProperty) {
        const model3D = viewerRef.entities.getById(`${FOLLOW_TARGET}-3d-model`);
        if (model3D) {
            model3D.position = originalModelPositionProperty;
            console.log('Restored original position property for N97CX 3D model');
        }
        originalModelPositionProperty = null;
    }

    // Reset smoothed position
    smoothedModelPosition = null;

    // Show N97CX visuals again
    showN97CXVisuals();
}

// ================== CAMERA UPDATE ==================

function onFollowTick(clock) {
    if (!followEnabled) return;

    // Ensure N97CX model stays visible for tail view (in case 3D was disabled after follow started)
    const model3D = viewerRef.entities.getById(`${FOLLOW_TARGET}-3d-model`);
    if (model3D && !model3D.show) {
        model3D.show = true;
    }

    updateFollowCamera(clock, FOLLOW_TARGET);
}

// preRender handler - fires right before frame renders for tightest timing
function onFollowPreRender(scene, time) {
    if (!followEnabled) return;

    // Ensure N97CX model stays visible for tail view
    const model3D = viewerRef.entities.getById(`${FOLLOW_TARGET}-3d-model`);
    if (model3D && !model3D.show) {
        model3D.show = true;
    }

    // Use the viewer's clock for the update
    updateFollowCamera(viewerRef.clock, FOLLOW_TARGET);
}

// ================== UTIL ==================

function normalizeAngleRad(angle) {
    return Cesium.Math.negativePiToPi(angle);
}

// ================== MAIN CAMERA LOGIC ==================

export function updateFollowCamera(clock, droneID = "N97CX") {
    const time = clock.currentTime;

    // Try to get position from 3D model first, then fall back to drone entity
    let pos = null;
    const positionProperty = get3DModelPosition(droneID);
    if (positionProperty) {
        pos = positionProperty.getValue(time);
    }

    // Fall back to drone entity position
    if (!pos) {
        const drone = viewerRef.entities.getById(droneID);
        if (drone && drone.position) {
            pos = drone.position.getValue(time);
        }
    }

    if (!Cesium.defined(pos)) {
        return;  // No position available
    }

    // === Get heading, pitch, bank from HPB data ===
    let headingDeg, pitchDeg, bankDeg;

    if (isHPBLoaded(droneID)) {
        const orientation = getOrientation(droneID, time);
        if (orientation) {
            headingDeg = orientation.heading;
            pitchDeg = orientation.pitch;
            bankDeg = orientation.roll;

            // Apply smoothing to blend HPB data transitions (e.g., at 19:02:00)
            if (previousHeading !== null) {
                // Handle heading wraparound (e.g., 350° to 10°)
                let headingDiff = headingDeg - previousHeading;
                if (headingDiff > 180) headingDiff -= 360;
                if (headingDiff < -180) headingDiff += 360;
                headingDeg = previousHeading + headingDiff * ORIENTATION_SMOOTHING;
                // Normalize to 0-360
                if (headingDeg < 0) headingDeg += 360;
                if (headingDeg >= 360) headingDeg -= 360;

                pitchDeg = previousPitch + (pitchDeg - previousPitch) * ORIENTATION_SMOOTHING;
                bankDeg = previousBank + (bankDeg - previousBank) * ORIENTATION_SMOOTHING;
            }
            previousHeading = headingDeg;
            previousPitch = pitchDeg;
            previousBank = bankDeg;
        } else {
            return;  // No orientation data
        }
    } else {
        // Fall back to estimated values
        const drone = viewerRef.entities.getById(droneID);
        if (!drone || !drone.position) return;

        const delta = 0.5;
        const pastTime = Cesium.JulianDate.addSeconds(time, -delta, new Cesium.JulianDate());
        const p1 = drone.position.getValue(pastTime);
        const p2 = drone.position.getValue(time);

        if (!p1 || !p2) return;

        headingDeg = Cesium.Math.toDegrees(computeHeading(p1, p2));
        pitchDeg = 0;

        const csvRoll = getPiperRollAt(time);
        bankDeg = (csvRoll !== null) ? csvRoll : estimateBankAngle(time, drone.position);
    }

    // Convert to radians
    const headingRad = Cesium.Math.toRadians(headingDeg);
    const pitchRad = Cesium.Math.toRadians(pitchDeg);
    const bankRad = Cesium.Math.toRadians(bankDeg);

    // === Smooth position (camera and model will both use this) ===
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
    smoothedModelPosition = previousCamPos;  // Share the same position object

    // === Let model use its original position property ===
    // Don't try to override - just let camera and model both use the same raw data source
    // The camera computes offset from `pos` which comes from the same SampledPositionProperty
    const model3D = viewerRef.entities.getById(`${droneID}-3d-model`);
    if (model3D && model3D.show) {
        // Just update orientation - let position come from original SampledPositionProperty
        const config = getModelConfig(droneID);
        if (config) {
            const adjustedHeading = headingDeg + (config.headingOffset || 0);
            const adjustedPitch = pitchDeg * (config.pitchMultiplier || 1);
            const adjustedRoll = bankDeg * (config.rollMultiplier || 1);

            const modelHpr = new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(adjustedHeading),
                Cesium.Math.toRadians(adjustedPitch),
                Cesium.Math.toRadians(adjustedRoll)
            );
            // Use `pos` (raw position from SampledPositionProperty) for orientation calc
            model3D.orientation = Cesium.Transforms.headingPitchRollQuaternion(pos, modelHpr);
        }
    }

    // Camera also uses `pos` (same raw position) - they should move together
    smoothedModelPosition = pos;

    // === Tail view camera position ===
    const cameraForward = -TAIL_VIEW_BACK;  // Meters behind aircraft
    const cameraUp = TAIL_VIEW_UP;          // Meters above aircraft
    const cameraLeft = TAIL_VIEW_LEFT;      // Centered behind

    // Build transform at aircraft position (use same position as model)
    const hprForTransform = new Cesium.HeadingPitchRoll(headingRad, 0, 0);
    const transform = Cesium.Transforms.headingPitchRollToFixedFrame(
        smoothedModelPosition,
        hprForTransform,
        Cesium.Ellipsoid.WGS84,
        Cesium.Transforms.localFrameToFixedFrameGenerator('east', 'north')
    );

    // Camera offset in local frame
    const localOffset = new Cesium.Cartesian3(
        -cameraLeft,
        cameraForward,
        cameraUp
    );

    const cameraPos = Cesium.Matrix4.multiplyByPoint(
        transform,
        localOffset,
        new Cesium.Cartesian3()
    );

    // Set camera view
    viewerRef.camera.setView({
        destination: cameraPos,
        orientation: {
            heading: headingRad,
            pitch: Cesium.Math.toRadians(FIXED_PITCH_DEG),
            roll: bankRad
        }
    });
}
