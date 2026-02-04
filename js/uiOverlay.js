// ===========================================================
//                     UI OVERLAY MODULE
// ===========================================================
//
// Displays clock, camera info, and project label overlays
//
// ===========================================================

let clockDisplay = null;
let cameraPanel = null;
let cameraContent = null;
let cameraToggleBtn = null;
let projectLabel = null;
let viewerRef = null;

let cameraExpanded = false;
let cameraInputs = {};  // { lat, lon, alt, hdg, pitch, roll } input elements

// Geoid offset for converting ellipsoid height to MSL
// At VGT: MSL = Ellipsoid - 91.9 ft (or Ellipsoid + GEOID_OFFSET where GEOID_OFFSET = -91.9)
const GEOID_OFFSET_FT = -91.9;

// ================== PUBLIC API ==================

export function setupUIOverlay(viewer) {
    viewerRef = viewer;
    createClockDisplay();
    createCameraPanel();
    createProjectLabel();
    
    // Start updating the clock and camera info
    viewerRef.clock.onTick.addEventListener(updateClock);
    viewerRef.camera.changed.addEventListener(updateCameraInfo);
    
    // Initial camera info update
    updateCameraInfo();
}

// ================== CLOCK DISPLAY ==================

function createClockDisplay() {
    clockDisplay = document.createElement("div");
    clockDisplay.style.position = "absolute";
    clockDisplay.style.top = "20px";
    clockDisplay.style.left = "50%";
    clockDisplay.style.transform = "translateX(-50%)";
    clockDisplay.style.fontSize = "32px";
    clockDisplay.style.fontWeight = "bold";
    clockDisplay.style.color = "white";
    clockDisplay.style.textShadow = "2px 2px 4px rgba(0,0,0,0.8)";
    clockDisplay.style.backgroundColor = "rgba(0,0,0,0.5)";
    clockDisplay.style.padding = "10px 20px";
    clockDisplay.style.borderRadius = "8px";
    clockDisplay.style.zIndex = "9999";
    clockDisplay.style.fontFamily = "monospace";
    
    document.body.appendChild(clockDisplay);
}

function updateClock(clock) {
    if (!clockDisplay) return;

    const currentTime = Cesium.JulianDate.toDate(clock.currentTime);

    // Convert UTC to local time (PDT = UTC-7)
    const LOCAL_OFFSET_HOURS = -7;
    let hours = currentTime.getUTCHours() + LOCAL_OFFSET_HOURS;

    // Handle day wrap
    if (hours < 0) hours += 24;
    if (hours >= 24) hours -= 24;

    // Format as HH:MM:SS
    const hoursStr = String(hours).padStart(2, '0');
    const minutes = String(currentTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(currentTime.getUTCSeconds()).padStart(2, '0');

    clockDisplay.textContent = `${hoursStr}:${minutes}:${seconds} PDT`;
    
    // Also update camera info if panel is expanded
    if (cameraExpanded) {
        updateCameraInfo();
    }
}

// ================== CAMERA INFO PANEL ==================

function createCameraPanel() {
    cameraPanel = document.createElement("div");
    cameraPanel.style.position = "absolute";
    cameraPanel.style.top = "85px";  // Below the clock
    cameraPanel.style.left = "50%";
    cameraPanel.style.transform = "translateX(-50%)";
    cameraPanel.style.backgroundColor = "rgba(0,0,0,0.7)";
    cameraPanel.style.borderRadius = "6px";
    cameraPanel.style.zIndex = "9998";
    cameraPanel.style.fontFamily = "monospace";
    cameraPanel.style.fontSize = "12px";
    cameraPanel.style.color = "white";
    cameraPanel.style.minWidth = "200px";
    
    // Header with toggle button
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.padding = "4px 10px";
    header.style.cursor = "pointer";
    
    const title = document.createElement("span");
    title.textContent = "Camera";
    title.style.fontSize = "11px";
    title.style.color = "#aaa";
    
    cameraToggleBtn = document.createElement("span");
    cameraToggleBtn.textContent = "+";
    cameraToggleBtn.style.fontSize = "14px";
    cameraToggleBtn.style.fontWeight = "bold";
    cameraToggleBtn.style.color = "#aaa";
    
    header.appendChild(title);
    header.appendChild(cameraToggleBtn);
    cameraPanel.appendChild(header);
    
    // Content area (initially hidden)
    cameraContent = document.createElement("div");
    cameraContent.style.display = "none";
    cameraContent.style.padding = "6px 10px 10px 10px";
    cameraContent.style.borderTop = "1px solid #444";
    // Create labeled input fields
    const fields = [
        { key: 'lat',   label: 'Lat' },
        { key: 'lon',   label: 'Lon' },
        { key: 'alt',   label: 'Alt MSL ft' },
        { key: 'hdg',   label: 'Hdg' },
        { key: 'pitch', label: 'Pitch' },
        { key: 'roll',  label: 'Roll' },
    ];
    fields.forEach(({ key, label }) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.marginBottom = "4px";

        const lbl = document.createElement("span");
        lbl.textContent = label + ":";
        lbl.style.color = "#888";
        lbl.style.marginRight = "6px";

        const input = document.createElement("input");
        input.type = "text";
        input.size = 12;
        input.style.fontFamily = "monospace";
        input.style.fontSize = "12px";
        input.style.background = "#1a1a1a";
        input.style.color = "#ddd";
        input.style.border = "1px solid #444";
        input.style.borderRadius = "3px";
        input.style.padding = "2px 4px";
        input.style.textAlign = "right";

        row.appendChild(lbl);
        row.appendChild(input);
        cameraContent.appendChild(row);
        cameraInputs[key] = input;
    });

    // Apply / Fly To button
    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Fly To";
    applyBtn.style.width = "100%";
    applyBtn.style.marginTop = "6px";
    applyBtn.style.padding = "4px 0";
    applyBtn.style.fontFamily = "monospace";
    applyBtn.style.fontSize = "12px";
    applyBtn.style.background = "#333";
    applyBtn.style.color = "#ccc";
    applyBtn.style.border = "1px solid #555";
    applyBtn.style.borderRadius = "3px";
    applyBtn.style.cursor = "pointer";
    applyBtn.addEventListener("click", applyCameraPosition);
    cameraContent.appendChild(applyBtn);

    cameraPanel.appendChild(cameraContent);

    // Toggle on click
    header.addEventListener("click", () => {
        cameraExpanded = !cameraExpanded;
        cameraContent.style.display = cameraExpanded ? "block" : "none";
        cameraToggleBtn.textContent = cameraExpanded ? "−" : "+";
        if (cameraExpanded) {
            updateCameraInfo();  // Refresh when expanding
        }
    });
    
    document.body.appendChild(cameraPanel);
}

function updateCameraInfo() {
    if (!cameraContent || !cameraExpanded) return;
    // Skip updates if user is editing any field
    if (document.activeElement && cameraContent.contains(document.activeElement)) return;

    const camera = viewerRef.camera;
    const cartographic = camera.positionCartographic;
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const altMSLFt = cartographic.height * 3.28084 - GEOID_OFFSET_FT;
    const heading = Cesium.Math.toDegrees(camera.heading);
    const pitch = Cesium.Math.toDegrees(camera.pitch);
    const roll = Cesium.Math.toDegrees(camera.roll);

    cameraInputs.lat.value = lat.toFixed(6);
    cameraInputs.lon.value = lon.toFixed(6);
    cameraInputs.alt.value = altMSLFt.toFixed(0);
    cameraInputs.hdg.value = heading.toFixed(1);
    cameraInputs.pitch.value = pitch.toFixed(1);
    cameraInputs.roll.value = roll.toFixed(1);
}

function applyCameraPosition() {
    const lat = parseFloat(cameraInputs.lat.value);
    const lon = parseFloat(cameraInputs.lon.value);
    const altMSLFt = parseFloat(cameraInputs.alt.value);
    const hdg = parseFloat(cameraInputs.hdg.value);
    const pitch = parseFloat(cameraInputs.pitch.value);
    const roll = parseFloat(cameraInputs.roll.value);

    if ([lat, lon, altMSLFt, hdg, pitch, roll].some(isNaN)) return;

    // Convert MSL feet back to ellipsoid meters
    const altEllipsoidFt = altMSLFt + GEOID_OFFSET_FT;
    const altMeters = altEllipsoidFt * 0.3048;

    viewerRef.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, altMeters),
        orientation: {
            heading: Cesium.Math.toRadians(hdg),
            pitch: Cesium.Math.toRadians(pitch),
            roll: Cesium.Math.toRadians(roll)
        },
        duration: 1.0
    });
}

// ================== PROJECT LABEL ==================

function createProjectLabel() {
    projectLabel = document.createElement("div");
    projectLabel.textContent = "Demonstration Study";
    projectLabel.style.position = "absolute";
    projectLabel.style.bottom = "40px";
    projectLabel.style.left = "50%";
    projectLabel.style.transform = "translateX(-20%)";
    projectLabel.style.fontSize = "24px";
    projectLabel.style.fontWeight = "bold";
    projectLabel.style.color = "rgba(255,255,255,0.7)";
    projectLabel.style.textShadow = "2px 2px 4px rgba(0,0,0,0.8)";
    projectLabel.style.zIndex = "9999";
    projectLabel.style.letterSpacing = "2px";
    
    document.body.appendChild(projectLabel);
}
