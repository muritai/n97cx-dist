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
    
    // Format as HH:MM:SS
    const hours = String(currentTime.getUTCHours()).padStart(2, '0');
    const minutes = String(currentTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(currentTime.getUTCSeconds()).padStart(2, '0');
    
    clockDisplay.textContent = `${hours}:${minutes}:${seconds} UTC`;
    
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
    
    const camera = viewerRef.camera;
    const cartographic = camera.positionCartographic;
    
    // Position
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const altEllipsoidM = cartographic.height;
    const altEllipsoidFt = altEllipsoidM * 3.28084;
    
    // Convert ellipsoid height to MSL
    // At VGT: geoid is ~92 ft below ellipsoid, so MSL = ellipsoid + 92
    // GEOID_OFFSET_FT = -91.9, so MSL = ellipsoid - GEOID_OFFSET_FT
    const altMSLFt = altEllipsoidFt - GEOID_OFFSET_FT;  // Subtracting -91.9 = adding 91.9
    
    // Orientation (convert to degrees)
    const heading = Cesium.Math.toDegrees(camera.heading);
    const pitch = Cesium.Math.toDegrees(camera.pitch);
    const roll = Cesium.Math.toDegrees(camera.roll);
    
    // Format altitude display (using MSL)
    let altDisplay;
    if (altMSLFt > 100000) {
        altDisplay = `${(altMSLFt / 5280).toFixed(1)} mi`;
    } else if (altMSLFt > 10000) {
        altDisplay = `${(altMSLFt / 1000).toFixed(1)}k ft`;
    } else {
        altDisplay = `${altMSLFt.toFixed(0)} ft`;
    }
    
    cameraContent.innerHTML = `
        <div style="margin-bottom: 4px;">
            <span style="color: #888;">Lat:</span> ${lat.toFixed(6)}°
        </div>
        <div style="margin-bottom: 4px;">
            <span style="color: #888;">Lon:</span> ${lon.toFixed(6)}°
        </div>
        <div style="margin-bottom: 4px;">
            <span style="color: #888;">Alt (MSL):</span> ${altDisplay}
        </div>
        <div style="margin-bottom: 4px;">
            <span style="color: #888;">Hdg:</span> ${heading.toFixed(1)}°
        </div>
        <div style="margin-bottom: 4px;">
            <span style="color: #888;">Pitch:</span> ${pitch.toFixed(1)}°
        </div>
        <div>
            <span style="color: #888;">Roll:</span> ${roll.toFixed(1)}°
        </div>
    `;
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
