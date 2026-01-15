// ===========================================================
//                   VIEW CONTROLLER MODULE
// ===========================================================
//
// Popup menu for selecting camera views:
//   - Runway - Approach view centered between 30L/30R
//   - FALCON LIMITS - Top-down matching FALCON display coverage
//   - Overhead - Original overhead perspective
//
// ===========================================================

import { setFalconLimitsVisible, ATCT_POSITION, FALCON_HEIGHT_NM, FALCON_WIDTH_NM } from './FalconLimits.js';

let viewerRef = null;
let currentViewIndex = 0;
let viewButton = null;
let menuVisible = false;
let menuElement = null;

// Runway 30L/30R approach position
// Centered between the two runways, 0.25nm out on approach
const RUNWAY_30_CENTER = {
    lat: 36.197462,       // South of field, on approach
    lon: -115.178855,     // Centered between 30L/30R
    altFt: 2500
};

// View definitions
const VIEWS = [
    {
        name: "Runway",
        buttonLabel: "[+] Runway View",
        getView: () => {
            const altitudeMeters = RUNWAY_30_CENTER.altFt * 0.3048;
            
            return {
                destination: Cesium.Cartesian3.fromDegrees(
                    RUNWAY_30_CENTER.lon,
                    RUNWAY_30_CENTER.lat,
                    altitudeMeters
                ),
                orientation: {
                    heading: Cesium.Math.toRadians(315),
                    pitch: Cesium.Math.toRadians(-10),
                    roll: 0
                }
            };
        }
    },
    {
        name: "FALCON LIMITS",
        buttonLabel: "[+] FALCON Limits View",
        getView: () => {
            const coverageNM = Math.max(FALCON_WIDTH_NM, FALCON_HEIGHT_NM);
            const altitudeMeters = coverageNM * 1852 * 0.9;
            
            return {
                destination: Cesium.Cartesian3.fromDegrees(
                    ATCT_POSITION.lon,
                    ATCT_POSITION.lat,
                    altitudeMeters
                ),
                orientation: {
                    heading: Cesium.Math.toRadians(0),
                    pitch: Cesium.Math.toRadians(-90),
                    roll: 0
                }
            };
        }
    },
    {
        name: "Overhead",
        buttonLabel: "[+] Overhead View",
        getView: (originalView) => originalView
    }
];

/**
 * Create and show the popup menu
 */
function toggleMenu(event) {
    event.stopPropagation();
    if (menuVisible) {
        hideMenu();
    } else {
        showMenu();
    }
}

function showMenu() {
    if (!menuElement) {
        menuElement = document.createElement('div');
        menuElement.style.cssText = `
            position: absolute;
            background: rgba(48, 51, 54, 0.95);
            border: 1px solid #555;
            border-radius: 4px;
            padding: 4px 0;
            z-index: 1001;
            min-width: 150px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        
        VIEWS.forEach((view, index) => {
            const item = document.createElement('div');
            item.textContent = view.buttonLabel;
            item.dataset.index = index;
            item.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                color: white;
                font-size: 14px;
                white-space: nowrap;
            `;
            item.onmouseenter = () => {
                item.style.background = '#555';
            };
            item.onmouseleave = () => {
                if (parseInt(item.dataset.index) !== currentViewIndex) {
                    item.style.background = 'transparent';
                } else {
                    item.style.background = '#444';
                }
            };
            item.onclick = (e) => {
                e.stopPropagation();
                selectView(index);
            };
            menuElement.appendChild(item);
        });
        
        document.body.appendChild(menuElement);
    }
    
    // Update current selection highlight
    updateMenuHighlight();
    
    // Position above the button
    // Position above the button, aligned to right edge
    const rect = viewButton.getBoundingClientRect();
    menuElement.style.right = (window.innerWidth - rect.right) + 'px';
    menuElement.style.left = 'auto';  // Clear left positioning
    menuElement.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
    menuElement.style.display = 'block';
    menuVisible = true;
}

function updateMenuHighlight() {
    if (!menuElement) return;
    const items = menuElement.children;
    for (let i = 0; i < items.length; i++) {
        if (i === currentViewIndex) {
            items[i].style.background = '#444';
            items[i].style.borderLeft = '3px solid #4a9eff';
            items[i].style.paddingLeft = '13px';
        } else {
            items[i].style.background = 'transparent';
            items[i].style.borderLeft = 'none';
            items[i].style.paddingLeft = '16px';
        }
    }
}

function hideMenu() {
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    menuVisible = false;
}

function selectView(index) {
    currentViewIndex = index;
    const view = VIEWS[currentViewIndex];
    const viewConfig = view.getView(viewerRef._originalView);
    
    // Toggle FALCON limits visibility based on view selection
    setFalconLimitsVisible(view.name === "FALCON LIMITS");
    
    viewerRef.camera.flyTo({
        destination: viewConfig.destination,
        orientation: viewConfig.orientation,
        duration: 1.0
    });
    
    // Update button text to show current view
    if (viewButton) {
        viewButton.textContent = view.buttonLabel;
    }
    
    hideMenu();
}

/**
 * Initialize the view controller
 * @param {Cesium.Viewer} viewer - The Cesium viewer
 * @param {Object} originalView - The original view configuration
 * @param {HTMLButtonElement} button - The existing button to repurpose (optional)
 */
export function setupViewController(viewer, originalView, button = null) {
    viewerRef = viewer;
    viewerRef._originalView = originalView;
    
    if (button) {
        viewButton = button;
        viewButton.textContent = VIEWS[currentViewIndex].buttonLabel;
        viewButton.onclick = toggleMenu;
    }
    
    // Close menu when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (menuVisible && menuElement && !menuElement.contains(e.target) && e.target !== viewButton) {
            hideMenu();
        }
    });
    
    // Set initial FALCON visibility based on current view
    const currentView = VIEWS[currentViewIndex];
    setFalconLimitsVisible(currentView.name === "FALCON LIMITS");
    
}

/**
 * Create the Change View button
 * @param {Function} createButtonFn - Your existing createButton function
 * @param {number} position - Button position
 * @returns {HTMLButtonElement}
 */
export function createChangeViewButton(createButtonFn, position) {
    currentViewIndex = VIEWS.length - 1;  // Start at Overhead (last index)
    viewButton = createButtonFn(VIEWS[currentViewIndex].buttonLabel, position, toggleMenu);
    
    // Explicitly set initial FALCON visibility based on starting view
    const initialView = VIEWS[currentViewIndex];
    setFalconLimitsVisible(initialView.name === "FALCON LIMITS");
    
    return viewButton;
}

/**
 * Go to a specific view by name
 * @param {string} viewName - "FALCON LIMITS", "Runway", "Ambiguity Surface", or "Overhead"
 */
export function goToView(viewName) {
    const index = VIEWS.findIndex(v => v.name === viewName);
    if (index >= 0) {
        selectView(index);
    }
}

/**
 * Get current view name
 * @returns {string}
 */
export function getCurrentViewName() {
    return VIEWS[currentViewIndex].name;
}

/**
 * Add a custom view to the cycle
 * @param {string} name - View name
 * @param {string} buttonLabel - Label for button/menu
 * @param {Function} getViewFn - Function that returns view config
 */
export function addView(name, buttonLabel, getViewFn) {
    VIEWS.push({ name, buttonLabel, getView: getViewFn });
    
    // Rebuild menu if it exists
    if (menuElement) {
        menuElement.remove();
        menuElement = null;
    }
    
}
