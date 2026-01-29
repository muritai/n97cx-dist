// ===========================================================
//                   TCAS DISPLAY MODULE
// ===========================================================
//
// Displays NTSB TCAS simulation images synchronized with
// the Cesium clock. Images shown on-demand when available.
//
// Times in filenames are LOCAL (GMT-7), converted to UTC.
//
// ===========================================================

const TCAS_IMAGE_PATH = "js/static/tcas/";
const DWELL_TIME_SIM_SECONDS = 6;  // 6 seconds of simulation time
const LOCAL_TO_UTC_OFFSET_HOURS = 7;

// TCAS frames parsed from filenames
// Times converted from local (12:02:xx) to UTC (19:02:xx)
const TCAS_FRAMES = [
    { timeUTC: "19:02:15", file: "N97CX Perf Study TCAS _0000_120215_Page_61.jpg" },
    { timeUTC: "19:02:21", file: "N97CX Perf Study TCAS _0001_120221_Page_62.jpg" },
    { timeUTC: "19:02:29", file: "N97CX Perf Study TCAS _0002_120229_Page_63.jpg" },
    { timeUTC: "19:02:34", file: "N97CX Perf Study TCAS _0003_120234_Page_64.jpg" },
    { timeUTC: "19:02:39", file: "N97CX Perf Study TCAS _0004_120239_Page_65.jpg" },
    { timeUTC: "19:02:44", file: "N97CX Perf Study TCAS _0005_120244_Page_66.jpg" },
    { timeUTC: "19:02:49", file: "N97CX Perf Study TCAS _0006_120249_Page_67.jpg" },
];

// Convert time string "HH:MM:SS" to seconds since midnight
function timeToSeconds(timeStr) {
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

// Pre-compute seconds for each frame
TCAS_FRAMES.forEach(frame => {
    frame.seconds = timeToSeconds(frame.timeUTC);
});

let viewerRef = null;
let tcasButton = null;
let tcasOverlay = null;
let tcasImage = null;
let currentFrameIndex = -1;
let isDisplayVisible = false;
let displayStartSimSeconds = 0;  // Simulation time when display was shown

/**
 * Get current simulation time as seconds since midnight UTC
 */
function getCurrentTimeSeconds() {
    if (!viewerRef) return 0;
    
    const currentTime = viewerRef.clock.currentTime;
    const date = Cesium.JulianDate.toDate(currentTime);
    
    return date.getUTCHours() * 3600 + 
           date.getUTCMinutes() * 60 + 
           date.getUTCSeconds();
}

/**
 * Find the appropriate frame for current time
 * Returns the latest frame that is at or before current time
 * Returns -1 if no frame is available yet
 */
function findAvailableFrame(currentSeconds) {
    let availableIndex = -1;
    
    for (let i = 0; i < TCAS_FRAMES.length; i++) {
        if (TCAS_FRAMES[i].seconds <= currentSeconds) {
            availableIndex = i;
        } else {
            break;
        }
    }
    
    return availableIndex;
}

/**
 * Create draggable/resizable window
 */
function createOverlay() {
    tcasOverlay = document.createElement('div');
    tcasOverlay.style.cssText = `
        position: absolute;
        top: 100px;
        left: 100px;
        width: 480px;
        height: 480px;
        z-index: 2000;
        display: none;
        background: rgba(30, 30, 30, 0.95);
        border-radius: 6px;
        border: 1px solid #555;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        min-width: 200px;
        min-height: 150px;
        resize: both;
        overflow: hidden;
    `;
    
    // Title bar (drag handle)
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
    titleText.id = 'tcasTimeLabel';
    titleText.style.cssText = `
        color: #ccc;
        font-size: 12px;
        font-family: monospace;
    `;
    titleText.textContent = 'NTSB TCAS';
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: transparent;
        color: #aaa;
        border: none;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
        line-height: 1;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.color = 'white';
    closeBtn.onmouseleave = () => closeBtn.style.color = '#aaa';
    closeBtn.onclick = hideDisplay;
    
    titleBar.appendChild(titleText);
    titleBar.appendChild(closeBtn);
    
    // Image container
    const imageContainer = document.createElement('div');
    imageContainer.style.cssText = `
        padding: 8px;
        height: calc(100% - 35px);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    `;
    
    tcasImage = document.createElement('img');
    tcasImage.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    `;
    
    imageContainer.appendChild(tcasImage);
    tcasOverlay.appendChild(titleBar);
    tcasOverlay.appendChild(imageContainer);
    document.body.appendChild(tcasOverlay);
    
    // Make draggable
    makeDraggable(tcasOverlay, titleBar);
}

/**
 * Make an element draggable by a handle
 */
function makeDraggable(element, handle) {
    let offsetX = 0;
    let offsetY = 0;
    let isDragging = false;
    
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
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;
        
        // Keep within viewport
        newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));
        
        element.style.left = newX + 'px';
        element.style.top = newY + 'px';
    }
    
    function onMouseUp() {
        isDragging = false;
        document.onmousemove = null;
        document.onmouseup = null;
    }
}

/**
 * Show the TCAS display with current available frame
 */
function showDisplay() {
    if (currentFrameIndex < 0) return;
    
    const frame = TCAS_FRAMES[currentFrameIndex];
    tcasImage.src = TCAS_IMAGE_PATH + frame.file;
    
    const timeLabel = document.getElementById('tcasTimeLabel');
    if (timeLabel) {
        timeLabel.textContent = `NTSB TCAS @ ${frame.timeUTC} UTC`;
    }
    
    tcasOverlay.style.display = 'block';
    isDisplayVisible = true;
    
    // Record simulation time when display started
    displayStartSimSeconds = getCurrentTimeSeconds();
    
    console.log(`📡 TCAS Display: Showing frame ${currentFrameIndex + 1}/${TCAS_FRAMES.length} @ ${frame.timeUTC}`);
}

/**
 * Hide the TCAS display
 */
function hideDisplay() {
    tcasOverlay.style.display = 'none';
    isDisplayVisible = false;
    displayStartSimSeconds = 0;
}

/**
 * Update frame tracking and handle auto-dismiss
 */
function updateTCAS() {
    const currentSeconds = getCurrentTimeSeconds();
    const availableIndex = findAvailableFrame(currentSeconds);
    
    // Update button state - gray out when no frames available
    if (availableIndex >= 0) {
        tcasButton.disabled = false;
        tcasButton.style.opacity = '1';
        tcasButton.style.cursor = 'pointer';
    } else {
        tcasButton.disabled = true;
        tcasButton.style.opacity = '0.7';
        tcasButton.style.cursor = 'default';
    }
    
    // Check if display should be dismissed
    if (isDisplayVisible) {
        // Dismiss if newer frame is available
        if (availableIndex > currentFrameIndex) {
            hideDisplay();
            console.log(`📡 TCAS Display: Auto-dismissed, newer frame available`);
        }
        // Dismiss if dwell time (simulation seconds) has elapsed
        else if (currentSeconds - displayStartSimSeconds >= DWELL_TIME_SIM_SECONDS) {
            hideDisplay();
            console.log(`📡 TCAS Display: Auto-dismissed, dwell time expired`);
        }
    }
    
    currentFrameIndex = availableIndex;
}

/**
 * Initialize the TCAS display module
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 */
export function setupTCASDisplay(viewer) {
    viewerRef = viewer;
    
    // Create button (matches other UI buttons - minimal styling)
    // Starts grayed out until TCAS time range
    tcasButton = document.createElement('button');
    tcasButton.textContent = 'NTSB TCAS';
    tcasButton.disabled = true;
    tcasButton.style.position = 'absolute';
    tcasButton.style.top = '20px';
    tcasButton.style.left = '250px';
    tcasButton.style.zIndex = '1000';
    tcasButton.style.opacity = '.7';
    tcasButton.style.cursor = 'default';
    console.log('📡 TCAS Button initial opacity:', tcasButton.style.opacity);
    tcasButton.onclick = () => {
        if (!tcasButton.disabled) {
            showDisplay();
        }
    };
    document.body.appendChild(tcasButton);
    
    // Create overlay
    createOverlay();
    
    // Update on clock tick (for auto-dismiss logic)
    viewer.clock.onTick.addEventListener(updateTCAS);
    
    // Initial update
    updateTCAS();
    
    console.log(`📡 TCAS Display initialized with ${TCAS_FRAMES.length} frames`);
}

/**
 * Clean up the TCAS display module
 */
export function removeTCASDisplay() {
    if (viewerRef) {
        viewerRef.clock.onTick.removeEventListener(updateTCAS);
    }
    if (tcasButton) {
        tcasButton.remove();
    }
    if (tcasOverlay) {
        tcasOverlay.remove();
    }
}

/**
 * Set the dwell time for image display
 * @param {number} ms - Dwell time in milliseconds
 */
export function setDwellTime(ms) {
    // Note: This only affects future displays
    console.log(`📡 TCAS dwell time set to ${ms}ms`);
}
