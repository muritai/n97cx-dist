// ===========================================================
//                     ATCT VIEW MODULE  (Patched)
// ===========================================================
//
// Public API:
//   setupATCTView(viewer, atctLat, atctLon, atctHeight, followBtn)
//
// ===========================================================

let viewerRef = null;
let followBtnRef = null;

let atctLat = null;
let atctLon = null;
let atctHeight = null;
let atctPosition = null;

let atctTrackingTarget = null;

let atctViewEnabled = false;
let atctTrackEnabled = false;

let atctPanDeg = 155;
let atctTiltDeg = 5;

let atctRange = 1000;
let atctHeightOffsetFeet = 0;  // Offset above tower in feet
const MAX_HEIGHT_OFFSET = 3500; // Maximum height above tower (feet)
const HEIGHT_SNAP_RANGE = 50;   // Magnetize to base within this range (feet)

// FOV (Field of View) settings
let atctFovDeg = 50;  // Default: Human Eye
const FOV_MIN = 20;
const FOV_MAX = 80;
const FOV_SNAP_TOLERANCE = 3;  // Snap within ±3 degrees

// FOV detents with labels
const FOV_DETENTS = [
    { value: 20, label: "Binoculars" },
    { value: 50, label: "Human Eye" },
    { value: 60, label: "Default" },
    { value: 80, label: "Wide Angle" }
];

let atctBtn = null;
let panel = null;
let panSlider = null;
let tiltSlider = null;
let rangeSlider = null;
let trackCheckbox = null;
let snapRunwayBtn = null;
let trackSelect = null;
let heightSlider = null;
let fovSlider = null;
let fovModeLabel = null;

import { AIRCRAFT_ORDER } from "./aircraftPanel.js";

import { disableFollowView } from "./followView.js";


// ================== PUBLIC API (MODIFIED) ==================

export function setupATCTView(viewer, towerLat, towerLon, towerHeight, followBtn = null) {
    viewerRef = viewer;
    followBtnRef = followBtn;
    atctLat = towerLat;
    atctLon = towerLon;
    atctHeight = towerHeight;

    atctPosition = Cesium.Cartesian3.fromDegrees(atctLon, atctLat, atctHeight);

    createATCTButton();
    buildControlPanel();

    panel.style.display = "none";
    deactivateButtonStyle();
}

// Optional exports
export function isATCTEnabled() { return atctViewEnabled; }
export function disableATCT() { if (atctViewEnabled) toggleATCTView(); }

// ================== INTERNAL UI HELPERS ==================

function createATCTButton() {
    atctBtn = document.createElement("button");
    atctBtn.innerText = "[+] ATCT View";
    atctBtn.style.position = "absolute";
    atctBtn.style.bottom = "175px";
    atctBtn.style.right = "10px";
    atctBtn.style.zIndex = "1000";
    atctBtn.addEventListener("click", toggleATCTView);
    document.body.appendChild(atctBtn);
}

function activateButtonStyle() {
    atctBtn.style.backgroundColor = "gray";
    atctBtn.style.color = "white";
    atctBtn.textContent = "ATCT View ON";
    
    if (followBtnRef) {
        followBtnRef.disabled = true;
        followBtnRef.style.opacity = "0.4";
        disableFollowView();
    }
}

function deactivateButtonStyle() {
    atctBtn.style.backgroundColor = "";
    atctBtn.style.color = "";
    atctBtn.textContent = "[+] ATCT View";

    if (followBtnRef) {
        followBtnRef.disabled = false;
        followBtnRef.style.opacity = "1.0";
    }
}

// ================== CONTROL PANEL ==================

function buildControlPanel() {
    panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.bottom = "250px";
    panel.style.right = "10px";
    panel.style.padding = "8px";
    panel.style.borderRadius = "6px";
    panel.style.background = "rgba(0,0,0,0.7)";
    panel.style.color = "white";
    panel.style.zIndex = "10000";
    panel.style.width = "170px";
    document.body.appendChild(panel);

    // Header row with title and close button
    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.justifyContent = "space-between";
    headerRow.style.alignItems = "center";
    headerRow.style.marginBottom = "6px";

    const title = document.createElement("span");
    title.innerHTML = "<b>ATCT View</b>";

    const closeBtn = document.createElement("button");
    closeBtn.innerText = "✕";
    closeBtn.title = "Close ATCT View";
    closeBtn.style.background = "transparent";
    closeBtn.style.border = "1px solid #666";
    closeBtn.style.color = "#aaa";
    closeBtn.style.borderRadius = "3px";
    closeBtn.style.width = "20px";
    closeBtn.style.height = "20px";
    closeBtn.style.fontSize = "12px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.padding = "0";
    closeBtn.style.lineHeight = "1";

    closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.color = "white";
        closeBtn.style.borderColor = "#999";
    });
    closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.color = "#aaa";
        closeBtn.style.borderColor = "#666";
    });
    closeBtn.addEventListener("click", () => {
        toggleATCTView();  // This will disable ATCT view
    });

    headerRow.appendChild(title);
    headerRow.appendChild(closeBtn);
    panel.appendChild(headerRow);


    const trackContainer = document.createElement("div");
    trackContainer.style.marginBottom = "8px";
    trackContainer.style.display = "none";

    const trackLabel = document.createElement("div");
    trackLabel.innerText = "Track Aircraft";
    trackLabel.style.fontSize = "12px";
    trackLabel.style.marginBottom = "2px";
    trackContainer.appendChild(trackLabel);

    trackSelect = document.createElement("select");
    trackSelect.style.width = "100%";
    trackSelect.style.fontSize = "12px";

    // "(none)" option
    const noTrack = document.createElement("option");
    noTrack.value = "none";
    noTrack.textContent = "(none)";
    trackSelect.appendChild(noTrack);

    // <-- DO NOT populate here (list will be empty)
    // Instead, refresh when panel opens.

    // Tracking change handler
    // Tracking change handler
    trackSelect.addEventListener("change", () => {
        if (trackSelect.value === "none") {
            atctTrackEnabled = false;
            atctTrackingTarget = null;
            enableSliders();  // Re-enable sliders
        } else {
            atctTrackEnabled = true;
            atctTrackingTarget = trackSelect.value;
            disableSliders();  // Disable sliders
        }
    });
    trackContainer.appendChild(trackSelect);
    panel.appendChild(trackContainer);


    // --- Snap Runway ---
    snapRunwayBtn = document.createElement("button");
    snapRunwayBtn.innerText = "Snap Runway";
    snapRunwayBtn.style.display = "block";
    snapRunwayBtn.style.marginBottom = "8px";
    snapRunwayBtn.style.width = "100%";
    snapRunwayBtn.style.fontSize = "11px";

    snapRunwayBtn.addEventListener("click", () => {
        atctPanDeg = 165;
        atctTiltDeg = 5;
        panSlider.value = atctPanDeg;
        tiltSlider.value = atctTiltDeg;
    });

    panel.appendChild(snapRunwayBtn);

    // --- Pan ---
    const panLabel = document.createElement("div");
    panLabel.innerText = "Pan";
    panel.appendChild(panLabel);

    panSlider = document.createElement("input");
    panSlider.type = "range";
    panSlider.min = 0;
    panSlider.max = 360;
    panSlider.value = atctPanDeg;
    panSlider.style.width = "100%";
    panSlider.addEventListener("input", () => {
        atctPanDeg = Number(panSlider.value);
    });
    panel.appendChild(panSlider);

    // --- Tilt ---
    const tiltLabel = document.createElement("div");
    tiltLabel.innerText = "Tilt";
    tiltLabel.style.marginTop = "8px";
    panel.appendChild(tiltLabel);

    tiltSlider = document.createElement("input");
    tiltSlider.type = "range";
    tiltSlider.min = -89;
    tiltSlider.max = 89;
    tiltSlider.value = atctTiltDeg;
    tiltSlider.style.width = "100%";
    tiltSlider.addEventListener("input", () => {
        atctTiltDeg = Number(tiltSlider.value);
    });
    panel.appendChild(tiltSlider);

// --- Height Offset ---
    const heightLabel = document.createElement("div");
    heightLabel.innerText = "Height (Virtual)";
    heightLabel.style.marginTop = "8px";
    panel.appendChild(heightLabel);

    heightSlider = document.createElement("input");
    heightSlider.type = "range";
    heightSlider.min = 0;
    heightSlider.max = MAX_HEIGHT_OFFSET;
    heightSlider.value = atctHeightOffsetFeet;
    heightSlider.style.width = "100%";
    heightSlider.addEventListener("input", () => {
        let value = Number(heightSlider.value);

        // Magnetize to base (tower height) when close
        if (value < HEIGHT_SNAP_RANGE) {
            value = 0;
            heightSlider.value = 0;
        }

        atctHeightOffsetFeet = value;
    });
    panel.appendChild(heightSlider);

    const fovContainer = document.createElement("div");
    fovContainer.style.display = "none";
    fovContainer.style.marginTop = "12px";
    fovContainer.style.borderTop = "1px solid #555";
    fovContainer.style.paddingTop = "8px";

    const fovHeaderRow = document.createElement("div");
    fovHeaderRow.style.display = "flex";
    fovHeaderRow.style.justifyContent = "space-between";
    fovHeaderRow.style.alignItems = "center";
    fovHeaderRow.style.marginBottom = "4px";

    const fovLabel = document.createElement("span");
    fovLabel.innerText = "FOV";
    fovLabel.style.fontSize = "12px";

    fovModeLabel = document.createElement("span");
    fovModeLabel.style.fontSize = "11px";
    fovModeLabel.style.color = "#aaa";
    fovModeLabel.innerText = "Human Eye";

    fovHeaderRow.appendChild(fovLabel);
    fovHeaderRow.appendChild(fovModeLabel);
    fovContainer.appendChild(fovHeaderRow);

    // Slider with tick marks container
    const fovSliderContainer = document.createElement("div");
    fovSliderContainer.style.position = "relative";
    fovSliderContainer.style.marginBottom = "4px";

    fovSlider = document.createElement("input");
    fovSlider.type = "range";
    fovSlider.min = FOV_MIN;
    fovSlider.max = FOV_MAX;
    fovSlider.value = atctFovDeg;
    fovSlider.style.width = "100%";
    fovSlider.style.margin = "0";

    fovSlider.addEventListener("input", () => {
        let value = Number(fovSlider.value);

        // Check for magnetic snap to detents
        for (const detent of FOV_DETENTS) {
            if (Math.abs(value - detent.value) <= FOV_SNAP_TOLERANCE) {
                value = detent.value;
                fovSlider.value = value;
                break;
            }
        }

        atctFovDeg = value;
        updateFovModeLabel();
        applyFovToCamera();
    });

    fovSliderContainer.appendChild(fovSlider);

    // Tick marks
    const tickContainer = document.createElement("div");
    tickContainer.style.position = "relative";
    tickContainer.style.height = "8px";
    tickContainer.style.marginTop = "2px";

    FOV_DETENTS.forEach(detent => {
        const tick = document.createElement("div");
        const percent = ((detent.value - FOV_MIN) / (FOV_MAX - FOV_MIN)) * 100;
        tick.style.position = "absolute";
        tick.style.left = `${percent}%`;
        tick.style.transform = "translateX(-50%)";
        tick.style.width = "1px";
        tick.style.height = "6px";
        tick.style.backgroundColor = "#888";
        tickContainer.appendChild(tick);
    });

    fovSliderContainer.appendChild(tickContainer);
    fovContainer.appendChild(fovSliderContainer);

    // Current value display
    const fovValueRow = document.createElement("div");
    fovValueRow.style.display = "flex";
    fovValueRow.style.justifyContent = "space-between";
    fovValueRow.style.fontSize = "10px";
    fovValueRow.style.color = "#666";

    const fovMinLabel = document.createElement("span");
    fovMinLabel.innerText = `${FOV_MIN}°`;
    const fovMaxLabel = document.createElement("span");
    fovMaxLabel.innerText = `${FOV_MAX}°`;

    fovValueRow.appendChild(fovMinLabel);
    fovValueRow.appendChild(fovMaxLabel);
    fovContainer.appendChild(fovValueRow);

    panel.appendChild(fovContainer);
}



// ================== FOV HELPERS ==================

function updateFovModeLabel() {
    if (!fovModeLabel) return;

    // Find matching detent or show degree value
    const detent = FOV_DETENTS.find(d => d.value === atctFovDeg);
    if (detent) {
        fovModeLabel.innerText = detent.label;
        fovModeLabel.style.color = "#7bf";  // Highlight when at detent
    } else {
        fovModeLabel.innerText = `${atctFovDeg}°`;
        fovModeLabel.style.color = "#aaa";
    }
}

function applyFovToCamera() {
    if (!viewerRef) return;

    // Apply FOV to camera frustum
    viewerRef.camera.frustum.fov = Cesium.Math.toRadians(atctFovDeg);
}

function resetFovToDefault() {
    atctFovDeg = 60;  // Human Eye
    if (fovSlider) fovSlider.value = atctFovDeg;
    updateFovModeLabel();
    applyFovToCamera();
}

// ================== TOGGLE & STATE ==================

function toggleATCTView() {
    atctViewEnabled = !atctViewEnabled;
    if (atctViewEnabled) {
        activateButtonStyle();
        enableATCTView();
    } else {
        deactivateButtonStyle();
        disableATCTView();
    }
}


function enableATCTView() {
    if (!viewerRef) return;

    panel.style.display = "block";

    // Set default FOV (Human Eye 50°)
    resetFovToDefault();

    refreshTrackingList(trackSelect);



    const c = viewerRef.scene.screenSpaceCameraController;
    c.enableRotate = false;
    c.enableTranslate = false;
    c.enableZoom = false;
    c.enableTilt = false;
    c.enableLook = false;

    viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

    // Place camera EXACTLY at tower
    viewerRef.camera.setView({
        destination: atctPosition,
        orientation: {
            heading: Cesium.Math.toRadians(atctPanDeg),
            pitch: Cesium.Math.toRadians(atctTiltDeg),
            roll: 0
        }
    });

    viewerRef.clock.onTick.addEventListener(atctViewTick);
}


function disableATCTView() {
    if (!viewerRef) return;

    panel.style.display = "none";

    const c = viewerRef.scene.screenSpaceCameraController;
    c.enableRotate = true;
    c.enableTranslate = true;
    c.enableZoom = true;
    c.enableTilt = true;
    c.enableLook = true;

    viewerRef.clock.onTick.removeEventListener(atctViewTick);

    viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}


// ================== TRACKING & CAMERA TICK (FINAL FIX) ==================

function atctViewTick(clock) {
    if (!atctViewEnabled || !viewerRef) return;

    let finalHeading = atctPanDeg;
    let finalPitch = atctTiltDeg;

    // ---- TRACKING MODE ----
    if (atctTrackEnabled && atctTrackingTarget) {
        let targetCartesian = null;

        // Look up the target entity directly
        const drone = viewerRef.entities.getById(atctTrackingTarget);
        if (drone && drone.position) {
            targetCartesian = drone.position.getValue(clock.currentTime);
        }

        if (targetCartesian) {
            // Calculate heading (azimuth) from tower to aircraft
            finalHeading = computeBearing(atctPosition, targetCartesian);

            // Calculate pitch (elevation angle) from tower to aircraft
            finalPitch = computeElevationAngle(atctPosition, targetCartesian);

            // Update module variables and UI sliders
            atctPanDeg = finalHeading;
            atctTiltDeg = finalPitch;

            if (panSlider) panSlider.value = atctPanDeg;
            if (tiltSlider) tiltSlider.value = atctTiltDeg;
        }
    }

// ---- ALWAYS SET CAMERA VIEW ----
    // Calculate camera position with height offset
    const heightOffsetMeters = atctHeightOffsetFeet * 0.3048;  // Convert feet to meters
    const cameraPosition = Cesium.Cartesian3.fromDegrees(
        atctLon, 
        atctLat, 
        atctHeight + heightOffsetMeters
    );
    
    // Set camera position at tower (+ offset) with calculated/manual orientation
    viewerRef.camera.setView({
        destination: cameraPosition,
        orientation: {
            heading: Cesium.Math.toRadians(finalHeading),
            pitch: Cesium.Math.toRadians(finalPitch),
            roll: 0
        }
    });
}

// ================== HELPER ==================

function computeBearing(startCartesian, endCartesian) {
    const s = Cesium.Cartographic.fromCartesian(startCartesian);
    const e = Cesium.Cartographic.fromCartesian(endCartesian);

    const dLon = e.longitude - s.longitude;
    const y = Math.sin(dLon) * Math.cos(e.latitude);
    const x = Math.cos(s.latitude) * Math.sin(e.latitude) -
              Math.sin(s.latitude) * Math.cos(e.latitude) * Math.cos(dLon);

    let b = Cesium.Math.toDegrees(Math.atan2(y, x));
    return b < 0 ? b + 360 : b;
}

// ================== SLIDER STATE HELPERS ==================

function disableSliders() {
    if (panSlider) {
        panSlider.disabled = true;
        panSlider.style.opacity = "0.4";
        panSlider.style.cursor = "not-allowed";
    }

    if (tiltSlider) {
        tiltSlider.disabled = true;
        tiltSlider.style.opacity = "0.4";
        tiltSlider.style.cursor = "not-allowed";
    }

    if (heightSlider) {
        heightSlider.disabled = true;
        heightSlider.style.opacity = "0.4";
        heightSlider.style.cursor = "not-allowed";
    }

    if (snapRunwayBtn) {
        snapRunwayBtn.disabled = true;
        snapRunwayBtn.style.opacity = "0.4";
        snapRunwayBtn.style.cursor = "not-allowed";
    }

    // FOV slider stays enabled during tracking (user can adjust zoom)
}

function enableSliders() {
    if (panSlider) {
        panSlider.disabled = false;
        panSlider.style.opacity = "1.0";
        panSlider.style.cursor = "pointer";
    }
    
    if (tiltSlider) {
        tiltSlider.disabled = false;
        tiltSlider.style.opacity = "1.0";
        tiltSlider.style.cursor = "pointer";
    }
    
    if (heightSlider) {
        heightSlider.disabled = false;
        heightSlider.style.opacity = "1.0";
        heightSlider.style.cursor = "pointer";
    }
    
    if (snapRunwayBtn) {
        snapRunwayBtn.disabled = false;
        snapRunwayBtn.style.opacity = "1.0";
        snapRunwayBtn.style.cursor = "pointer";
    }
}

function computeElevationAngle(towerCartesian, targetCartesian) {
    // Convert positions to cartographic
    const towerCarto = Cesium.Cartographic.fromCartesian(towerCartesian);
    const targetCarto = Cesium.Cartographic.fromCartesian(targetCartesian);
    
    // Calculate the difference in height (altitude)
    const deltaHeight = targetCarto.height - towerCarto.height;
    
    // Calculate surface distance between tower and target
    const ellipsoid = Cesium.Ellipsoid.WGS84;
    const surfaceDistance = ellipsoid.cartesianToCartographic(
        Cesium.Cartesian3.subtract(targetCartesian, towerCartesian, new Cesium.Cartesian3())
    );
    
    // Use Haversine formula for accurate surface distance
    const dLat = targetCarto.latitude - towerCarto.latitude;
    const dLon = targetCarto.longitude - towerCarto.longitude;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(towerCarto.latitude) * Math.cos(targetCarto.latitude) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const horizontalDistance = ellipsoid.maximumRadius * c;
    
    // Calculate elevation angle: arctan(height difference / horizontal distance)
    const elevationAngleRad = Math.atan2(deltaHeight, horizontalDistance);
    return Cesium.Math.toDegrees(elevationAngleRad);
}

function refreshTrackingList(trackSelect) {
    // Clear existing entries except the first "(none)" option.
    while (trackSelect.options.length > 1) {
        trackSelect.remove(1);
    }

    // Add aircraft following the AIRCRAFT_ORDER list
    AIRCRAFT_ORDER.forEach(id => {
        const ent = viewerRef.entities.getById(id);
        if (!ent) return;

        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        trackSelect.appendChild(opt);
    });
}
