// ===========================================================
//                   AIRCRAFT PANEL MODULE
// ===========================================================
//
// Public API (import into drones.js):
//   setupAircraftPanelUI(viewer, availableDrones, defaultDrones, loadDroneFn, unloadDroneFn, options)
//
// Options:
//   { 
//     showGhostPaths: true/false,           - whether to show ghost path checkboxes
//     showFullPath: (droneID) => {},        - callback to show full flight path polyline
//     hideFullPath: (droneID) => {},        - callback to hide full flight path polyline
//     showHistoricalApproaches: true/false, - whether to show historical approaches checkbox
//     historicalApproachFiles: [],          - array of CSV filenames for N97CX historical approaches
//     historicalDataPath: 'js/data/historical/'  - path to historical CSV files
//   }
//
// This module builds a collapsible Aircraft checkbox list
// in the upper-left corner with two columns:
//   - "Show" checkbox: toggles animated aircraft visibility
//   - "All" checkbox: toggles full flight path polyline display
//
// Historical approaches feature:
//   - Displays N97CX's past approaches as static polylines
//   - Alternating colors for visual distinction
//   - Hover to highlight and see filename
//   - Click-to-measure time/altitude/groundspeed
//
// ===========================================================

// Import measurement functions and 3D model control from drones.js
import { setMeasurementEnabled, setCurrentHistoricalPath, set3DModelVisible,
         set3DModelOutline, setAllModelsViewableAtDistance } from './drones.js';

// ========== Feature Flags ==========
const SHOW_3D_MODELS = false;

let viewerRef = null;
let available = [];
let defaults = [];
let loadDrone = null;
let unloadDrone = null;
let showFullPath = null;   // Callback for showing full flight path
let hideFullPath = null;   // Callback for hiding full flight path
let showGhostPaths = false;  // Feature flag for ghost paths
let showHistoricalApproaches = false;  // Feature flag for historical approaches

// Historical approaches config
let historicalApproachFiles = [];
let historicalDataPath = 'js/data/historical/';
let historicalEntities = [];  // Track created polyline entities
let historicalLabels = [];    // Track label entities for hover

let aircraftPanel;
let toggleBtn;
let listContainer;

const state = {
    expanded: false,
    checkboxes: {},      // droneID → checkbox element (visibility)
    fullPathCbs: {},     // droneID → checkbox element (full path)
    ghostV1Expanded: false,
    ghostV2Expanded: false,
    historicalExpanded: false,
    historicalVisible: false,
    historicalRunwayCheckboxes: {},  // runway → { checkbox, files }
    measurementEnabled: false  // Track measurement toggle state
};


// Aircraft above the separator line (main traffic)
const AIRCRAFT_ABOVE_LINE = [
    "N97CX",
    "N160RA",
    "XSM55",
    "N738CY",
    "N466MD",
    "N90MX",
    "N786TX"
];

// Aircraft below the separator line (other/reference)
const AIRCRAFT_BELOW_LINE = [
    "Sim",
    "Olsen",
    "N2406P"
];

// Combined order for Show All / Hide All
export const AIRCRAFT_ORDER = [...AIRCRAFT_ABOVE_LINE, ...AIRCRAFT_BELOW_LINE];

// Color palette for historical approaches (alternating colors for distinction)
const HISTORICAL_COLORS = [
    Cesium.Color.fromCssColorString('#FF6B6B').withAlpha(0.6),  // Coral red
    Cesium.Color.fromCssColorString('#4ECDC4').withAlpha(0.6),  // Teal
    Cesium.Color.fromCssColorString('#FFE66D').withAlpha(0.6),  // Yellow
    Cesium.Color.fromCssColorString('#95E1D3').withAlpha(0.6),  // Mint
    Cesium.Color.fromCssColorString('#F38181').withAlpha(0.6),  // Pink
    Cesium.Color.fromCssColorString('#AA96DA').withAlpha(0.6),  // Lavender
    Cesium.Color.fromCssColorString('#FCBAD3').withAlpha(0.6),  // Light pink
    Cesium.Color.fromCssColorString('#A8D8EA').withAlpha(0.6),  // Light blue
    Cesium.Color.fromCssColorString('#F9ED69').withAlpha(0.6),  // Bright yellow
    Cesium.Color.fromCssColorString('#B5EAD7').withAlpha(0.6),  // Sage green
];

const HISTORICAL_HIGHLIGHT_COLOR = Cesium.Color.WHITE;
const HISTORICAL_LINE_WIDTH = 8;
const HISTORICAL_HIGHLIGHT_WIDTH = 12;

// Ground/geoid offset (same as drones.js)
const GROUND_GEOID_OFFSET_FT = -91.9;


// ===========================================================
//                       UI PANEL SETUP
// ===========================================================

function buildPanel() {
    aircraftPanel = document.createElement("div");
    aircraftPanel.style.position = "absolute";
    aircraftPanel.style.top = "60px";
    aircraftPanel.style.left = "10px";
    aircraftPanel.style.background = "rgba(0,0,0,0.7)";
    aircraftPanel.style.padding = "8px";
    aircraftPanel.style.borderRadius = "6px";
    aircraftPanel.style.color = "white";
    aircraftPanel.style.zIndex = "1000";
    aircraftPanel.style.width = "190px";
    aircraftPanel.style.maxHeight = "400px";
    aircraftPanel.style.overflowY = "auto";
    document.body.appendChild(aircraftPanel);

    // Header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const title = document.createElement("span");
    title.innerText = "Aircraft";

    toggleBtn = document.createElement("button");
    toggleBtn.innerText = "+";
    toggleBtn.style.marginLeft = "8px";

    header.appendChild(title);
    header.appendChild(toggleBtn);
    aircraftPanel.appendChild(header);

    listContainer = document.createElement("div");
    listContainer.style.display = "none";
    listContainer.style.marginTop = "6px";
    aircraftPanel.appendChild(listContainer);

    toggleBtn.addEventListener("click", () => {
        state.expanded = !state.expanded;
        listContainer.style.display = state.expanded ? "block" : "none";
        toggleBtn.innerText = state.expanded ? "−" : "+";
    });
}

// ===========================================================
//                    HELPER: CREATE CHECKBOX ROW
// ===========================================================

function createAircraftRow(droneID) {
    if (!available.includes(droneID)) return null;

    const row = document.createElement("div");
    row.style.marginBottom = "4px";
    row.style.display = "flex";
    row.style.alignItems = "center";

    // Visibility checkbox (existing)
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = defaults.includes(droneID);
    cb.title = "Show/hide aircraft";

    cb.addEventListener("change", () => {
        if (cb.checked) {
            loadDrone(droneID);
        } else {
            unloadDrone(droneID);
            // Also uncheck full path if visibility is off
            if (state.fullPathCbs[droneID]) {
                state.fullPathCbs[droneID].checked = false;
                if (hideFullPath) hideFullPath(droneID);
            }
        }
    });

    // Full path checkbox (new "All" column)
    const fullPathCb = document.createElement("input");
    fullPathCb.type = "checkbox";
    fullPathCb.checked = false;
    fullPathCb.title = "Show full flight path";
    fullPathCb.style.marginLeft = "8px";

    fullPathCb.addEventListener("change", () => {
        if (fullPathCb.checked) {
            if (showFullPath) showFullPath(droneID);
        } else {
            if (hideFullPath) hideFullPath(droneID);
        }
    });

    const label = document.createElement("label");
    label.innerText = droneID;
    label.style.marginLeft = "4px";
    label.style.fontSize = "12px";
    label.style.flex = "1";

    row.appendChild(cb);
    row.appendChild(fullPathCb);
    row.appendChild(label);

    state.checkboxes[droneID] = cb;
    state.fullPathCbs[droneID] = fullPathCb;

    // Initial load if checked
    if (cb.checked) {
        loadDrone(droneID);
    }

    return row;
}

function createSeparator() {
    const sep = document.createElement("div");
    sep.style.borderTop = "1px solid #555";
    sep.style.margin = "8px 0";
    return sep;
}



// ===========================================================
//                GHOST PATHS SECTION
// ===========================================================

/**
 * Creates a collapsible section for ghost paths with a master checkbox
 * that controls all ghost paths in the group, plus an analysis link.
 */
function createGhostSection(title, ghostIDs, colorHex, expandKey, analysisLink) {
    const container = document.createElement("div");
    container.style.marginBottom = "4px";

    // Header row with master checkboxes (Show + All)
    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.alignItems = "center";

    // Master visibility checkbox
    const masterCb = document.createElement("input");
    masterCb.type = "checkbox";
    masterCb.checked = false;
    masterCb.title = "Show/hide all ghost paths in this group";

    // Master full path checkbox
    const masterFullPathCb = document.createElement("input");
    masterFullPathCb.type = "checkbox";
    masterFullPathCb.checked = false;
    masterFullPathCb.title = "Show/hide all full paths for this group";
    masterFullPathCb.style.marginLeft = "8px";

    // Label
    const labelSpan = document.createElement("label");
    labelSpan.innerText = title;
    labelSpan.style.marginLeft = "4px";
    labelSpan.style.fontSize = "12px";
    labelSpan.style.color = colorHex;
    labelSpan.style.flex = "1";

    // Expand button
    const expandBtn = document.createElement("button");
    expandBtn.innerText = "+";
    expandBtn.style.marginLeft = "4px";
    expandBtn.style.padding = "0 4px";
    expandBtn.style.fontSize = "10px";
    expandBtn.style.cursor = "pointer";

    // Analysis link (small icon/button)
    const analysisBtn = document.createElement("button");
    analysisBtn.innerText = "📊";  // Chart emoji
    analysisBtn.title = "Open analysis plot";
    analysisBtn.style.marginLeft = "4px";
    analysisBtn.style.padding = "0 4px";
    analysisBtn.style.fontSize = "12px";
    analysisBtn.style.cursor = "pointer";
    analysisBtn.style.background = "transparent";
    analysisBtn.style.border = "1px solid #555";
    analysisBtn.style.color = "white";
    analysisBtn.style.borderRadius = "3px";
    
    analysisBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.open(analysisLink, '_blank');
    });

    headerRow.appendChild(masterCb);
    headerRow.appendChild(masterFullPathCb);
    headerRow.appendChild(labelSpan);
    headerRow.appendChild(analysisBtn);
    headerRow.appendChild(expandBtn);
    container.appendChild(headerRow);

    // Sub-list container (initially hidden)
    const subList = document.createElement("div");
    subList.style.display = "none";
    subList.style.marginLeft = "18px";
    subList.style.marginTop = "4px";

    // Create individual ghost checkboxes
    ghostIDs.forEach(ghostID => {
        const row = createAircraftRow(ghostID);
        if (row) subList.appendChild(row);
    });

    container.appendChild(subList);

    // Update master checkboxes based on individual states
    function updateMasterCheckboxes() {
        const visChecked = ghostIDs.filter(id => state.checkboxes[id]?.checked).length;
        const visTotal = ghostIDs.length;
        masterCb.checked = visChecked === visTotal;
        masterCb.indeterminate = visChecked > 0 && visChecked < visTotal;

        const fullChecked = ghostIDs.filter(id => state.fullPathCbs[id]?.checked).length;
        masterFullPathCb.checked = fullChecked === visTotal;
        masterFullPathCb.indeterminate = fullChecked > 0 && fullChecked < visTotal;
    }

    // Master visibility checkbox toggles all
    masterCb.addEventListener("change", () => {
        const newState = masterCb.checked;
        ghostIDs.forEach(ghostID => {
            if (state.checkboxes[ghostID]) {
                state.checkboxes[ghostID].checked = newState;
                if (newState) {
                    loadDrone(ghostID);
                } else {
                    unloadDrone(ghostID);
                    // Also uncheck full path
                    if (state.fullPathCbs[ghostID]) {
                        state.fullPathCbs[ghostID].checked = false;
                        if (hideFullPath) hideFullPath(ghostID);
                    }
                }
            }
        });
    });

    // Master full path checkbox toggles all full paths
    masterFullPathCb.addEventListener("change", () => {
        const newState = masterFullPathCb.checked;
        ghostIDs.forEach(ghostID => {
            if (state.fullPathCbs[ghostID]) {
                state.fullPathCbs[ghostID].checked = newState;
                if (newState) {
                    if (showFullPath) showFullPath(ghostID);
                } else {
                    if (hideFullPath) hideFullPath(ghostID);
                }
            }
        });
    });

    // Expand button toggles sub-list
    expandBtn.addEventListener("click", () => {
        state[expandKey] = !state[expandKey];
        subList.style.display = state[expandKey] ? "block" : "none";
        expandBtn.innerText = state[expandKey] ? "−" : "+";
        updateMasterCheckboxes();
    });

    // Store master checkbox references
    state.checkboxes[`${expandKey}_master`] = masterCb;
    state.fullPathCbs[`${expandKey}_master`] = masterFullPathCb;

    return container;
}



// ===========================================================
//              HISTORICAL APPROACHES SECTION
// ===========================================================

// VGT field elevation (geometric MSL)
const VGT_FIELD_ELEVATION_FT = 2181;

/**
 * Parse historical approach CSV data
 * Uses corrected_alt (MSL altitude from aerocalc3) and sm_gs (smoothed groundspeed)
 */
function parseHistoricalCSV(csvText, filename) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return { positions: [], dataPoints: [] };

    const header = lines[0].split(',');
    const latIdx = header.indexOf('Latitude');
    const lonIdx = header.indexOf('Longitude');
    const altIdx = header.indexOf('corrected_alt');  // Pre-corrected MSL altitude
    const timeIdx = header.indexOf('TSDateTime');
    const gsIdx = header.indexOf('sm_gs');  // Smoothed groundspeed

    if (latIdx === -1 || lonIdx === -1 || altIdx === -1) {
        console.error('Historical CSV missing required columns (need corrected_alt)');
        return { positions: [], dataPoints: [] };
    }

    // Build Cesium positions and data points
    const positions = [];
    const dataPoints = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length > Math.max(latIdx, lonIdx, altIdx)) {
            const lat = parseFloat(cols[latIdx]);
            const lon = parseFloat(cols[lonIdx]);
            const alt = parseFloat(cols[altIdx]);  // Already MSL feet
            const time = timeIdx !== -1 ? cols[timeIdx] : '';
            const gs = gsIdx !== -1 ? parseFloat(cols[gsIdx]) : NaN;

            if (!isNaN(lat) && !isNaN(lon) && !isNaN(alt)) {
                const position = Cesium.Cartesian3.fromDegrees(
                    lon,
                    lat,
                    (alt + GROUND_GEOID_OFFSET_FT) * 0.3048  // Add geoid offset, convert to meters
                );

                positions.push(position);

                dataPoints.push({
                    lat: lat,
                    lon: lon,
                    altFeet: Math.round(alt),  // MSL altitude in feet
                    time: time,
                    gs: gs,
                    position: position
                });
            }
        }
    }

    if (dataPoints.length === 0) return { positions: [], dataPoints: [] };

    return { positions, dataPoints };
}

/**
 * Extract display name from filename
 * "20220318_205204_G127_arr_30L.csv" → "20220318_205204_G127_arr_30L"
 */
function getDisplayName(filename) {
    return filename.replace('.csv', '');
}

/**
 * Load all historical approach paths
 */
async function loadHistoricalApproaches() {
    if (historicalEntities.length > 0) {
        // Already loaded, just show them
        historicalEntities.forEach(entity => {
            entity.show = true;
        });
        return;
    }
    
    
    for (let i = 0; i < historicalApproachFiles.length; i++) {
        const filename = historicalApproachFiles[i];
        const color = HISTORICAL_COLORS[i % HISTORICAL_COLORS.length];
        const displayName = getDisplayName(filename);
        
        try {
            const response = await fetch(`${historicalDataPath}${filename}?v=${Date.now()}`);
            if (!response.ok) {
                console.warn(`Failed to load ${filename}: ${response.status}`);
                continue;
            }
            
            const csvText = await response.text();
            const { positions, dataPoints } = parseHistoricalCSV(csvText, filename);
            
            if (positions.length < 2) {
                console.warn(`${filename}: insufficient positions (${positions.length})`);
                continue;
            }
            
            // Create polyline entity
            const entity = viewerRef.entities.add({
                id: `historical_${displayName}`,
                name: displayName,
                polyline: {
                    positions: positions,
                    width: HISTORICAL_LINE_WIDTH,
                    material: color,
                    clampToGround: false
                },
                properties: {
                    filename: filename,
                    displayName: displayName,
                    originalColor: color,
                    isHistorical: true,
                    dataPoints: dataPoints
                }
            });
            
            historicalEntities.push(entity);
            
        } catch (err) {
            console.error(`Error loading ${filename}:`, err);
        }
    }
    
    
    // Setup hover handler if not already done
    setupHistoricalHoverHandler();
}

/**
 * Hide all historical approach paths
 */
function hideHistoricalApproaches() {
    historicalEntities.forEach(entity => {
        entity.show = false;
    });
    
    // Clear measurement when hiding all paths
    setCurrentHistoricalPath(null, null);
}

/**
 * Remove all historical approach paths
 */
function removeHistoricalApproaches() {
    historicalEntities.forEach(entity => {
        viewerRef.entities.remove(entity);
    });
    historicalEntities = [];
    
    historicalLabels.forEach(label => {
        viewerRef.entities.remove(label);
    });
    historicalLabels = [];
    
    // Clear measurement
    setCurrentHistoricalPath(null, null);
}

// Track current hover state
let currentHoveredEntity = null;
let hoverLabel = null;

// Track isolated path state (double-click to isolate)
let isolatedEntity = null;

/**
 * Setup hover handler for historical paths
 */
function setupHistoricalHoverHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewerRef.scene.canvas);
    
    handler.setInputAction((movement) => {
        const pickedObject = viewerRef.scene.pick(movement.endPosition);
        
        // Reset previous hovered entity
        if (currentHoveredEntity) {
            const props = currentHoveredEntity.properties;
            if (props && props.isHistorical && props.isHistorical.getValue()) {
                currentHoveredEntity.polyline.width = HISTORICAL_LINE_WIDTH;
                currentHoveredEntity.polyline.material = props.originalColor.getValue();
            }
            currentHoveredEntity = null;
        }
        
        // Remove hover label
        if (hoverLabel) {
            viewerRef.entities.remove(hoverLabel);
            hoverLabel = null;
        }
        
        // Check if we picked a historical path
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            const props = entity.properties;
            
            if (props && props.isHistorical && props.isHistorical.getValue()) {
                // Highlight the path
                entity.polyline.width = HISTORICAL_HIGHLIGHT_WIDTH;
                entity.polyline.material = HISTORICAL_HIGHLIGHT_COLOR;
                currentHoveredEntity = entity;
                
                // Create label at cursor position
                const cartesian = viewerRef.scene.pickPosition(movement.endPosition);
                if (Cesium.defined(cartesian)) {
                    hoverLabel = viewerRef.entities.add({
                        position: cartesian,
                        label: {
                            text: props.displayName.getValue(),
                            font: '14px monospace',
                            fillColor: Cesium.Color.WHITE,
                            outlineColor: Cesium.Color.BLACK,
                            outlineWidth: 2,
                            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                            pixelOffset: new Cesium.Cartesian2(0, -10),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            showBackground: true,
                            backgroundColor: Cesium.Color.BLACK.withAlpha(0.7)
                        }
                    });
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Disable Cesium's default double-click zoom-to-entity behavior
    viewerRef.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Double-click to isolate/restore historical paths
    handler.setInputAction((click) => {
        const pickedObject = viewerRef.scene.pick(click.position);

        // Check if we clicked on a historical path
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            const props = entity.properties;

            if (props && props.isHistorical && props.isHistorical.getValue()) {
                if (isolatedEntity === entity) {
                    // Double-clicked the isolated path - restore all
                    restoreAllHistoricalPaths();
                } else {
                    // Isolate this path - hide all others
                    isolateHistoricalPath(entity);
                }
                return;
            }
        }

        // Clicked on empty space - restore all if isolated
        if (isolatedEntity) {
            restoreAllHistoricalPaths();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

/**
 * Isolate a single historical path, hiding all others
 */
function isolateHistoricalPath(entity) {
    historicalEntities.forEach(e => {
        if (e === entity) {
            e.show = true;
        } else {
            e.show = false;
        }
    });
    isolatedEntity = entity;
}

/**
 * Restore all historical paths to visible
 */
function restoreAllHistoricalPaths() {
    historicalEntities.forEach(e => {
        e.show = true;
    });
    isolatedEntity = null;
}

/**
 * Categorize historical approach files by runway
 */
function categorizeByRunway(files) {
    const categories = {
        '12R': [],
        '12L': [],
        '30L': [],
        '30R': []
    };
    
    files.forEach(filename => {
        if (filename.includes('_arr_12R')) {
            categories['12R'].push(filename);
        } else if (filename.includes('_arr_12L')) {
            categories['12L'].push(filename);
        } else if (filename.includes('_arr_30L')) {
            categories['30L'].push(filename);
        } else if (filename.includes('_arr_30R')) {
            categories['30R'].push(filename);
        }
    });
    
    return categories;
}

/**
 * Create the historical approaches section with runway sub-checkboxes and measurement toggle
 */
function createHistoricalApproachesSection() {
    if (historicalApproachFiles.length === 0) return null;
    
    const container = document.createElement("div");
    container.style.marginBottom = "4px";
    
    // Categorize files by runway
    const runwayCategories = categorizeByRunway(historicalApproachFiles);
    
    // Header row with master checkbox, measurement toggle, and expand button
    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.alignItems = "center";
    
    // Master checkbox
    // const masterCb = document.createElement("input");
    // masterCb.type = "checkbox";
    // masterCb.checked = false;
    // masterCb.title = "Show/hide all N97CX historical approaches";
    
    // Spacer to align with other rows (where "All" checkbox would be)
    const spacer = document.createElement("span");
    spacer.style.width = "0px";
    spacer.style.display = "inline-block";
    
    // Label
    const labelSpan = document.createElement("label");
    labelSpan.innerText = `N97CX Historical (${historicalApproachFiles.length})`;
    labelSpan.style.marginLeft = "4px";
    labelSpan.style.fontSize = "12px";
    labelSpan.style.color = "#FFB347";
    labelSpan.style.flex = "1";
    
    // Measurement checkbox
    const measureCb = document.createElement("input");
    measureCb.type = "checkbox";
    measureCb.checked = false;
    measureCb.title = "Enable click-to-measure on historical paths (click path for time/alt/speed, right-click dot to clear)";
    measureCb.style.marginLeft = "4px";
    
    // Measurement label/icon
    const measureLabel = document.createElement("span");
    measureLabel.innerText = "📏";
    measureLabel.style.fontSize = "12px";
    measureLabel.style.marginLeft = "2px";
    measureLabel.style.cursor = "pointer";
    measureLabel.title = "Click path to measure time/alt/speed";
    
    // Wire up measurement toggle
    measureCb.addEventListener("change", () => {
        state.measurementEnabled = measureCb.checked;
        setMeasurementEnabled(measureCb.checked);
        
        // If enabling measurement and paths are already loaded, set the first visible one as current
        if (measureCb.checked && historicalEntities.length > 0) {
            const firstVisible = historicalEntities.find(e => e.show);
            if (firstVisible) {
                const props = firstVisible.properties;
                const filename = props.filename.getValue();
                setCurrentHistoricalPath(firstVisible.id, `${historicalDataPath}${filename}`);
            }
        }
        
    });    

    // Make label clickable too
    measureLabel.addEventListener("click", () => {
        measureCb.checked = !measureCb.checked;
        measureCb.dispatchEvent(new Event('change'));
    });
    
    // Expand button
    const expandBtn = document.createElement("button");
    expandBtn.innerText = "+";
    expandBtn.style.marginLeft = "4px";
    expandBtn.style.padding = "0 4px";
    expandBtn.style.fontSize = "10px";
    expandBtn.style.cursor = "pointer";
    
    // headerRow.appendChild(masterCb);
    headerRow.appendChild(spacer);
    headerRow.appendChild(labelSpan);
    headerRow.appendChild(measureCb);
    headerRow.appendChild(measureLabel);
    headerRow.appendChild(expandBtn);
    container.appendChild(headerRow);
    
    // Sub-list container (initially hidden)
    const subList = document.createElement("div");
    subList.style.display = "none";
    subList.style.marginLeft = "18px";
    subList.style.marginTop = "4px";
    
    // Track runway checkboxes for master checkbox sync
    const runwayCheckboxes = {};
    
    // Create checkbox for each runway that has approaches
    const runwayOrder = ['12R', '12L', '30L', '30R'];
    const runwayColors = {
        '12R': '#4ECDC4',  // Teal
        '12L': '#95E1D3',  // Mint
        '30L': '#FFE66D',  // Yellow
        '30R': '#FF6B6B'   // Coral (accident flight)
    };
    
    runwayOrder.forEach(runway => {
        const files = runwayCategories[runway];
        if (files.length === 0) return;
        
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.style.display = "flex";
        row.style.alignItems = "center";
        
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = false;
        cb.title = `Show/hide approaches to runway ${runway}`;
        
        const lbl = document.createElement("label");
        lbl.innerText = `Rwy ${runway} (${files.length})`;
        lbl.style.marginLeft = "4px";
        lbl.style.fontSize = "11px";
        lbl.style.color = runwayColors[runway];
        lbl.style.flex = "1";
        
        // Store reference for master checkbox sync
        runwayCheckboxes[runway] = { checkbox: cb, files: files };
        
        cb.addEventListener("change", async () => {
            if (cb.checked) {
                await loadHistoricalApproachesByRunway(runway, files, runwayColors[runway]);
            } else {
                hideHistoricalApproachesByRunway(runway);
            }
            // updateHistoricalMasterCheckbox();
        });
        
        row.appendChild(cb);
        row.appendChild(lbl);
        subList.appendChild(row);
    });
    
    container.appendChild(subList);
    
    // Update master checkbox based on individual runway states
    // function updateHistoricalMasterCheckbox() {
    //     const allRunways = Object.values(runwayCheckboxes);
    //     const allChecked = allRunways.every(r => r.checkbox.checked);
    //     const someChecked = allRunways.some(r => r.checkbox.checked);
    //     masterCb.checked = allChecked;
    //     masterCb.indeterminate = someChecked && !allChecked;
    // }
    
    // Master checkbox toggles all runways
    // masterCb.addEventListener("change", async () => {
    //     const newState = masterCb.checked;
    //     for (const runway of runwayOrder) {
    //         const entry = runwayCheckboxes[runway];
    //         if (entry && entry.checkbox.checked !== newState) {
    //             entry.checkbox.checked = newState;
    //             if (newState) {
    //                 await loadHistoricalApproachesByRunway(runway, entry.files, runwayColors[runway]);
    //             } else {
    //                 hideHistoricalApproachesByRunway(runway);
    //             }
    //         }
    //     }
    // });
    
    // Expand button toggles sub-list
    expandBtn.addEventListener("click", () => {
        state.historicalExpanded = !state.historicalExpanded;
        subList.style.display = state.historicalExpanded ? "block" : "none";
        expandBtn.innerText = state.historicalExpanded ? "−" : "+";
    });
    
    // Store reference
    // state.checkboxes["historicalApproaches"] = masterCb;
    state.historicalRunwayCheckboxes = runwayCheckboxes;
    
    return container;
}

/**
 * Load historical approaches for a specific runway
 */
async function loadHistoricalApproachesByRunway(runway, files, baseColorHex) {
    
    // Create base color for this runway
    const baseColor = Cesium.Color.fromCssColorString(baseColorHex);
    
    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const displayName = getDisplayName(filename);
        const entityId = `historical_${displayName}`;
        
        // Check if already loaded
        const existing = historicalEntities.find(e => e.id === entityId);
        if (existing) {
            existing.show = true;
            continue;
        }
        
        // Vary the color slightly for each approach within the runway
        // Adjust brightness by ±15% based on position in list
        const brightnessFactor = 0.85 + (i / Math.max(files.length - 1, 1)) * 0.3;  // Range: 0.85 to 1.15
        const color = new Cesium.Color(
            Math.min(1, baseColor.red * brightnessFactor),
            Math.min(1, baseColor.green * brightnessFactor),
            Math.min(1, baseColor.blue * brightnessFactor),
            0.6  // Alpha
        );
        
        try {
            const response = await fetch(`${historicalDataPath}${filename}?v=${Date.now()}`);
            if (!response.ok) {
                console.warn(`Failed to load ${filename}: ${response.status}`);
                continue;
            }
            
            const csvText = await response.text();
            const { positions, dataPoints } = parseHistoricalCSV(csvText, filename);
            
            if (positions.length < 2) {
                console.warn(`${filename}: insufficient positions (${positions.length})`);
                continue;
            }
            
            // Create polyline entity
            const entity = viewerRef.entities.add({
                id: entityId,
                name: displayName,
                polyline: {
                    positions: positions,
                    width: HISTORICAL_LINE_WIDTH,
                    material: color,
                    clampToGround: false
                },
                properties: {
                    filename: filename,
                    displayName: displayName,
                    originalColor: color,
                    runway: runway,
                    isHistorical: true,
                    dataPoints: dataPoints
                }
            });
            
            historicalEntities.push(entity);
            
            // Set as current path for measurement (last loaded becomes active)
            // Only set if measurement is enabled
            if (state.measurementEnabled) {
                setCurrentHistoricalPath(entityId, `${historicalDataPath}${filename}`);
            }
            
        } catch (err) {
            console.error(`Error loading ${filename}:`, err);
        }
    }
    
    
    // Setup hover handler if not already done
    if (!hoverHandlerSetup) {
        setupHistoricalHoverHandler();
        hoverHandlerSetup = true;
    }
    
    // Setup click handler for altitude display if not already done
    // if (!clickHandlerSetup) {
    //     setupHistoricalClickHandler();
    //     clickHandlerSetup = true;
    // }
}

// Track if hover handler is set up
let hoverHandlerSetup = false;

// Track if click handler is set up
let clickHandlerSetup = false;
let altitudePopup = null;

/**
 * Setup click handler to show altitude at clicked point on historical approaches
 */
function setupHistoricalClickHandler() {
    // Create popup element
    altitudePopup = document.createElement('div');
    altitudePopup.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
        pointer-events: none;
        z-index: 2000;
        display: none;
        border: 1px solid #444;
    `;
    document.body.appendChild(altitudePopup);
    
    // Click handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewerRef.scene.canvas);
    
    handler.setInputAction((click) => {
        const pickedObject = viewerRef.scene.pick(click.position);
        
        if (Cesium.defined(pickedObject) && pickedObject.id) {
            const entity = pickedObject.id;
            const props = entity.properties;
            
            // Check if this is a historical approach
            if (props && props.isHistorical && props.isHistorical.getValue()) {
                const dataPoints = props.dataPoints?.getValue();
                
                if (dataPoints && dataPoints.length > 0) {
                    // Find closest point to click
                    const clickCartesian = viewerRef.scene.pickPosition(click.position);
                    
                    if (clickCartesian) {
                        const clickCarto = Cesium.Cartographic.fromCartesian(clickCartesian);
                        const clickLat = Cesium.Math.toDegrees(clickCarto.latitude);
                        const clickLon = Cesium.Math.toDegrees(clickCarto.longitude);
                        
                        // Find closest data point
                        let minDist = Infinity;
                        let closestPoint = null;
                        
                        dataPoints.forEach(p => {
                            const dist = Math.sqrt(
                                Math.pow(p.lat - clickLat, 2) + 
                                Math.pow(p.lon - clickLon, 2)
                            );
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                            }
                        });
                        
                        if (closestPoint) {
                            // Show popup
                            const displayName = props.displayName?.getValue() || 'Unknown';
                            altitudePopup.innerHTML = `
                                <div style="color: #FFB347; margin-bottom: 4px;">${displayName}</div>
                                <div>Altitude: <b>${closestPoint.altFeet.toLocaleString()}'</b> MSL</div>
                            `;
                            altitudePopup.style.left = (click.position.x + 15) + 'px';
                            altitudePopup.style.top = (click.position.y - 15) + 'px';
                            altitudePopup.style.display = 'block';
                            
                            // Auto-hide after 3 seconds
                            setTimeout(() => {
                                altitudePopup.style.display = 'none';
                            }, 3000);
                        }
                    }
                }
            } else {
                // Clicked elsewhere - hide popup
                altitudePopup.style.display = 'none';
            }
        } else {
            // Clicked on nothing - hide popup
            altitudePopup.style.display = 'none';
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
}

/**
 * Hide historical approaches for a specific runway
 */
function hideHistoricalApproachesByRunway(runway) {
    historicalEntities.forEach(entity => {
        const props = entity.properties;
        if (props && props.runway && props.runway.getValue() === runway) {
            entity.show = false;
        }
    });
    
    // Clear measurement when hiding paths
    setCurrentHistoricalPath(null, null);
}


// ===========================================================
//                       BUILD CHECKBOXES
// ===========================================================

function buildAircraftList() {
    listContainer.innerHTML = "";
    state.checkboxes = {};
    state.fullPathCbs = {};

    // --- Master row (Show All / Hide All) ---
    const master = document.createElement("div");
    master.style.marginBottom = "6px";

    const showAll = document.createElement("button");
    showAll.innerText = "Show All";
    showAll.style.marginRight = "6px";
    showAll.onclick = () => {
        AIRCRAFT_ORDER.forEach(droneID => {
            if (state.checkboxes[droneID]) {
                state.checkboxes[droneID].checked = true;
            }
            if (available.includes(droneID)) {
                loadDrone(droneID);
            }
        });
    };

    const hideAll = document.createElement("button");
    hideAll.innerText = "Hide All";
    hideAll.onclick = () => {
        AIRCRAFT_ORDER.forEach(droneID => {
            if (state.checkboxes[droneID]) {
                state.checkboxes[droneID].checked = false;
            }
            if (state.fullPathCbs[droneID]) {
                state.fullPathCbs[droneID].checked = false;
                if (hideFullPath) hideFullPath(droneID);
            }
            if (available.includes(droneID)) {
                unloadDrone(droneID);
            }
        });
        // Also unload ghosts if they're enabled
        if (showGhostPaths) {
            // Unload V1
            GHOST_V1_IDS.forEach(id => {
                if (state.checkboxes[id]) {
                    state.checkboxes[id].checked = false;
                }
                if (state.fullPathCbs[id]) {
                    state.fullPathCbs[id].checked = false;
                    if (hideFullPath) hideFullPath(id);
                }
                unloadDrone(id);
            });
            if (state.checkboxes["ghostV1Expanded_master"]) {
                state.checkboxes["ghostV1Expanded_master"].checked = false;
                state.checkboxes["ghostV1Expanded_master"].indeterminate = false;
            }
            if (state.fullPathCbs["ghostV1Expanded_master"]) {
                state.fullPathCbs["ghostV1Expanded_master"].checked = false;
                state.fullPathCbs["ghostV1Expanded_master"].indeterminate = false;
            }
            // Unload V2
            GHOST_V2_IDS.forEach(id => {
                if (state.checkboxes[id]) {
                    state.checkboxes[id].checked = false;
                }
                if (state.fullPathCbs[id]) {
                    state.fullPathCbs[id].checked = false;
                    if (hideFullPath) hideFullPath(id);
                }
                unloadDrone(id);
            });
            if (state.checkboxes["ghostV2Expanded_master"]) {
                state.checkboxes["ghostV2Expanded_master"].checked = false;
                state.checkboxes["ghostV2Expanded_master"].indeterminate = false;
            }
            if (state.fullPathCbs["ghostV2Expanded_master"]) {
                state.fullPathCbs["ghostV2Expanded_master"].checked = false;
                state.fullPathCbs["ghostV2Expanded_master"].indeterminate = false;
            }
        }
        // Also hide historical approaches
        if (showHistoricalApproaches && state.checkboxes["historicalApproaches"]) {
            state.checkboxes["historicalApproaches"].checked = false;
            state.checkboxes["historicalApproaches"].indeterminate = false;
            // Hide all runway categories
            if (state.historicalRunwayCheckboxes) {
                Object.values(state.historicalRunwayCheckboxes).forEach(entry => {
                    entry.checkbox.checked = false;
                });
            }
            hideHistoricalApproaches();
            state.historicalVisible = false;
        }
    };

    master.appendChild(showAll);
    master.appendChild(hideAll);
    listContainer.appendChild(master);

    // --- Column headers ---
    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.alignItems = "center";
    headerRow.style.marginBottom = "4px";
    headerRow.style.fontSize = "10px";
    headerRow.style.color = "#aaa";
    
    const showHeader = document.createElement("span");
    showHeader.innerText = "Show";
    showHeader.style.width = "18px";
    showHeader.style.textAlign = "center";
    
    const allHeader = document.createElement("span");
    allHeader.innerText = "All";
    allHeader.style.width = "18px";
    allHeader.style.textAlign = "center";
    allHeader.style.marginLeft = "8px";
    
    const nameHeader = document.createElement("span");
    nameHeader.innerText = "";
    nameHeader.style.marginLeft = "4px";
    
    headerRow.appendChild(showHeader);
    headerRow.appendChild(allHeader);
    headerRow.appendChild(nameHeader);
    listContainer.appendChild(headerRow);

    // Aircraft above the line
    AIRCRAFT_ABOVE_LINE.forEach(id => {
        const row = createAircraftRow(id);
        if (row) listContainer.appendChild(row);
    });

    // Historical approaches (only if feature enabled and files provided)
    // Placed right after main aircraft, before ghosts
    if (showHistoricalApproaches && historicalApproachFiles.length > 0) {
        listContainer.appendChild(createSeparator());
        
        // Historical approaches section with runway sub-checkboxes and measurement
        const historicalSection = createHistoricalApproachesSection();
        if (historicalSection) {
            listContainer.appendChild(historicalSection);
        }
    }

    // Separator before ghost paths
    listContainer.appendChild(createSeparator());

    // Ghost paths (only if feature flag is enabled)
    if (showGhostPaths) {
        // V1 Ghost Paths - Aqua
        const v1Section = createGhostSection(
            "Ghost Paths (v1)",
            GHOST_V1_IDS,
            "#7FFFD4",  // Aqua
            "ghostV1Expanded",
            "ghost_v1_analysis_plot.html"  // Analysis link for V1
        );
        listContainer.appendChild(v1Section);
        
        // V2 Ghost Paths - Orange
        const v2Section = createGhostSection(
            "Ghost Paths (v2)",
            GHOST_V2_IDS,
            "#FF8C00",  // Dark orange
            "ghostV2Expanded",
            "ghost_v2_analysis_plot.html"  // Analysis link for V2
        );
        listContainer.appendChild(v2Section);
    }

    // Separator
    listContainer.appendChild(createSeparator());

    // Aircraft below the line
    AIRCRAFT_BELOW_LINE.forEach(id => {
        const row = createAircraftRow(id);
        if (row) listContainer.appendChild(row);
    });

    // ========== 3D Models Section ==========
    if (SHOW_3D_MODELS) {
        listContainer.appendChild(createSeparator());

        const models3DSection = document.createElement("div");
        models3DSection.style.marginTop = "4px";

        // Viewable at dx checkbox (above section label)
        const viewableRow = document.createElement("div");
        viewableRow.style.display = "flex";
        viewableRow.style.alignItems = "center";
        viewableRow.style.marginBottom = "6px";

        const viewableCb = document.createElement("input");
        viewableCb.type = "checkbox";
        viewableCb.checked = false;
        viewableCb.title = "Keep 3D models visible at any distance (minimum 48 pixels)";

        viewableCb.addEventListener("change", () => {
            setAllModelsViewableAtDistance(viewableCb.checked);
            setAllGhostsViewableAtDistance(viewableCb.checked);
        });

        const viewableLabel = document.createElement("label");
        viewableLabel.innerText = "Viewable at dx";
        viewableLabel.style.marginLeft = "4px";
        viewableLabel.style.fontSize = "11px";
        viewableLabel.style.color = "#aaa";
        viewableLabel.style.cursor = "pointer";
        viewableLabel.onclick = () => {
            viewableCb.checked = !viewableCb.checked;
            viewableCb.dispatchEvent(new Event('change'));
        };

        viewableRow.appendChild(viewableCb);
        viewableRow.appendChild(viewableLabel);
        models3DSection.appendChild(viewableRow);

        // Section label
        const models3DLabel = document.createElement("div");
        models3DLabel.innerText = "3D Models (HPB orientation)";
        models3DLabel.style.fontSize = "10px";
        models3DLabel.style.color = "#888";
        models3DLabel.style.marginBottom = "4px";
        models3DSection.appendChild(models3DLabel);

        // N97CX 3D model checkbox with outline
        const n97cx3DRow = document.createElement("div");
        n97cx3DRow.style.display = "flex";
        n97cx3DRow.style.alignItems = "center";
        n97cx3DRow.style.marginBottom = "2px";

        const n97cx3DCb = document.createElement("input");
        n97cx3DCb.type = "checkbox";
        n97cx3DCb.checked = false;
        n97cx3DCb.title = "Show N97CX with 3D Bonanza model and actual flight attitude";

        n97cx3DCb.addEventListener("change", async () => {
            await set3DModelVisible('N97CX', n97cx3DCb.checked);
        });

        const n97cx3DLabel = document.createElement("label");
        n97cx3DLabel.innerText = "N97CX 3D";
        n97cx3DLabel.style.marginLeft = "4px";
        n97cx3DLabel.style.fontSize = "12px";
        n97cx3DLabel.style.color = "#FF6B6B";
        n97cx3DLabel.style.flex = "1";

        const n97cxOutlineCb = document.createElement("input");
        n97cxOutlineCb.type = "checkbox";
        n97cxOutlineCb.checked = false;
        n97cxOutlineCb.title = "Toggle yellow outline on N97CX model";
        n97cxOutlineCb.style.marginLeft = "8px";
        n97cxOutlineCb.style.outline = "2px solid #FFFF00";
        n97cxOutlineCb.style.outlineOffset = "1px";

        n97cxOutlineCb.addEventListener("change", () => {
            set3DModelOutline('N97CX', n97cxOutlineCb.checked);
        });

        n97cx3DRow.appendChild(n97cx3DCb);
        n97cx3DRow.appendChild(n97cx3DLabel);
        n97cx3DRow.appendChild(n97cxOutlineCb);
        models3DSection.appendChild(n97cx3DRow);

        // N160RA 3D model checkbox with outline
        const n160ra3DRow = document.createElement("div");
        n160ra3DRow.style.display = "flex";
        n160ra3DRow.style.alignItems = "center";
        n160ra3DRow.style.marginBottom = "2px";

        const n160ra3DCb = document.createElement("input");
        n160ra3DCb.type = "checkbox";
        n160ra3DCb.checked = false;
        n160ra3DCb.title = "Show N160RA with 3D Cessna 172 model and actual flight attitude";

        n160ra3DCb.addEventListener("change", async () => {
            await set3DModelVisible('N160RA', n160ra3DCb.checked);
        });

        const n160ra3DLabel = document.createElement("label");
        n160ra3DLabel.innerText = "N160RA 3D";
        n160ra3DLabel.style.marginLeft = "4px";
        n160ra3DLabel.style.fontSize = "12px";
        n160ra3DLabel.style.color = "#4ECDC4";
        n160ra3DLabel.style.flex = "1";

        const n160raOutlineCb = document.createElement("input");
        n160raOutlineCb.type = "checkbox";
        n160raOutlineCb.checked = false;
        n160raOutlineCb.title = "Toggle cyan outline on N160RA model";
        n160raOutlineCb.style.marginLeft = "8px";
        n160raOutlineCb.style.outline = "2px solid #00FFFF";
        n160raOutlineCb.style.outlineOffset = "1px";

        n160raOutlineCb.addEventListener("change", () => {
            set3DModelOutline('N160RA', n160raOutlineCb.checked);
        });

        n160ra3DRow.appendChild(n160ra3DCb);
        n160ra3DRow.appendChild(n160ra3DLabel);
        n160ra3DRow.appendChild(n160raOutlineCb);
        models3DSection.appendChild(n160ra3DRow);

        listContainer.appendChild(models3DSection);

        // ========== Ghost 3D Models Section ==========
        const ghost3DSection = document.createElement("div");
        ghost3DSection.style.marginTop = "8px";
        ghost3DSection.style.paddingTop = "6px";
        ghost3DSection.style.borderTop = "1px solid #444";

        const ghost3DLabel = document.createElement("div");
        ghost3DLabel.innerText = "Ghost Aircraft (3D)";
        ghost3DLabel.style.fontSize = "10px";
        ghost3DLabel.style.color = "#888";
        ghost3DLabel.style.marginBottom = "4px";
        ghost3DSection.appendChild(ghost3DLabel);

        // Ghost 3D configurations
        const ghost3DConfigs = [
            { id: 'Ghost_080x', label: 'Ghost 0.80x' },
            { id: 'Ghost_090x', label: 'Ghost 0.90x' },
            { id: 'Ghost_110x', label: 'Ghost 1.10x' },
            { id: 'Ghost_120x', label: 'Ghost 1.20x' }
        ];

        ghost3DConfigs.forEach(({ id, label }) => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.marginBottom = "2px";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = false;
            cb.title = `Show Ghost at ${label.split(' ')[1]} range`;

            cb.addEventListener("change", async () => {
                await setGhostVisible(id, cb.checked);
            });

            const lbl = document.createElement("label");
            lbl.innerText = label;
            lbl.style.marginLeft = "4px";
            lbl.style.fontSize = "12px";
            lbl.style.color = "#ccc";
            lbl.style.flex = "1";

            // Outline checkbox for ghost
            const outlineCb = document.createElement("input");
            outlineCb.type = "checkbox";
            outlineCb.checked = false;
            outlineCb.title = `Toggle lime outline on ${label} model`;
            outlineCb.style.marginLeft = "8px";
            outlineCb.style.outline = "2px solid #00FF00";
            outlineCb.style.outlineOffset = "1px";

            outlineCb.addEventListener("change", () => {
                setGhostOutline(id, outlineCb.checked);
            });

            row.appendChild(cb);
            row.appendChild(lbl);
            row.appendChild(outlineCb);
            ghost3DSection.appendChild(row);
        });

        listContainer.appendChild(ghost3DSection);
    }
}

// ===========================================================
//                        PUBLIC API
// ===========================================================

export function setupAircraftPanelUI(
    viewer,
    availableDrones,
    defaultDrones,
    loadDroneFn,
    unloadDroneFn,
    options = {}
) {
    viewerRef = viewer;
    available = availableDrones;
    defaults = defaultDrones;
    loadDrone = loadDroneFn;
    unloadDrone = unloadDroneFn;
    showFullPath = options.showFullPath || null;    // Callback: showFullPath(droneID)
    hideFullPath = options.hideFullPath || null;    // Callback: hideFullPath(droneID)
    showGhostPaths = options.showGhostPaths || false;  // Feature flag for ghost paths
    
    // Historical approaches config
    showHistoricalApproaches = options.showHistoricalApproaches || false;  // Feature flag
    historicalApproachFiles = options.historicalApproachFiles || [];
    historicalDataPath = options.historicalDataPath || 'js/data/historical/';

    buildPanel();
    buildAircraftList();

    // Start collapsed
    state.expanded = false;
    listContainer.style.display = "none";
    toggleBtn.innerText = "+";
}

export function refreshAircraftPanel() {
    buildAircraftList();
}

// Export for external access if needed
export function getHistoricalEntities() {
    return historicalEntities;
}
