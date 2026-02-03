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

let atctViewEnabled = false;

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
    { value: 20, label: "20 - tele" },
    { value: 40, label: "40" },
    { value: 50, label: "50" },
    { value: 60, label: "60" },
    { value: 80, label: "80 - wide" }
];

let atctBtn = null;
let panel = null;
let panSlider = null;
let tiltSlider = null;
let rangeSlider = null;
let snapRunwayBtn = null;
let heightSlider = null;
let fovSlider = null;
let fovModeLabel = null;


import { disableFollowView } from "./followView.js";



// ================== PUBLIC API (MODIFIED) ==================

export function setupATCTView(viewer, towerLat, towerLon, towerHeight, followBtn = null) {
    viewerRef = viewer;
    followBtnRef = followBtn;
    atctLat = towerLat;
    atctLon = towerLon;
    atctHeight = towerHeight;

    // 🔥 ADDED LOGGING HERE:
    // console.log("-----------------------------------------");
    // console.log("✅ ATCT View Setup:");
    // console.log(`Input Height (meters): ${atctHeight.toFixed(2)}`);
    // console.log(`Input Lat/Lon: (${atctLat.toFixed(5)}, ${atctLon.toFixed(5)})`);
    // console.log("-----------------------------------------");

    atctPosition = Cesium.Cartesian3.fromDegrees(atctLon, atctLat, atctHeight);

    // 🔥 ADDED LOGGING OF FINAL CARTESIAN:
    // console.log("Final ATCT Camera Position (Cartesian3):", atctPosition.toString());
    // console.log("-----------------------------------------");

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

    // --- FOV (Field of View) ---
    const fovContainer = document.createElement("div");
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
    atctFovDeg = 50;  // Human Eye
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

