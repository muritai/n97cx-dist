// ===========================================================
//                   FALCON LIMITS MODULE
// ===========================================================
//
// Displays a ground-clamped rectangle representing the
// FALCON radar display coverage area, centered on ATCT.
//
// Based on screenshot analysis:
//   - 1772 x 895 pixels
//   - 97 pixels = 2.25 nm (Rwy 7/25)
//   - Coverage: ~41.1 nm x 20.8 nm
//
// ===========================================================

// ATCT Position (center of display)
export const ATCT_POSITION = {
    lat: 36.210167,
    lon: -115.189259
};

// Display dimensions in nautical miles
export const FALCON_WIDTH_NM = 41.1;   // East-West
export const FALCON_HEIGHT_NM = 20.8;  // North-South

// Conversion constants
const NM_TO_METERS = 1852;
const DEG_TO_RAD = Math.PI / 180;

let falconEntity = null;
let viewerRef = null;

/**
 * Calculate corner positions of the FALCON display rectangle
 * centered on ATCT
 */
function calculateCorners() {
    const centerLat = ATCT_POSITION.lat;
    const centerLon = ATCT_POSITION.lon;
    
    // Half dimensions in nm
    const halfWidthNM = FALCON_WIDTH_NM / 2;
    const halfHeightNM = FALCON_HEIGHT_NM / 2;
    
    // Convert nm to degrees
    // Latitude: 1 degree ≈ 60 nm
    // Longitude: 1 degree ≈ 60 nm * cos(lat)
    const latDelta = halfHeightNM / 60;
    const lonDelta = halfWidthNM / (60 * Math.cos(centerLat * DEG_TO_RAD));
    
    return {
        west: centerLon - lonDelta,
        east: centerLon + lonDelta,
        south: centerLat - latDelta,
        north: centerLat + latDelta
    };
}

/**
 * Create the FALCON display rectangle entity
 */
function createFalconRectangle(viewer) {
    const corners = calculateCorners();
    
    // Create rectangle coordinates (ground level)
    const positions = Cesium.Cartesian3.fromDegreesArray([
        corners.west, corners.south,
        corners.east, corners.south,
        corners.east, corners.north,
        corners.west, corners.north
    ]);
    
    falconEntity = viewer.entities.add({
        name: 'FALCON Display Limits',
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            height: 0,  // Clamped to ground
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 6
        }
    });
    
    // Cesium polygons don't support thick outlines well,
    // so we'll use a polyline for the border instead
    viewer.entities.remove(falconEntity);
    
    falconEntity = viewer.entities.add({
        name: 'FALCON Display Limits',
        polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([
                corners.west, corners.south,
                corners.east, corners.south,
                corners.east, corners.north,
                corners.west, corners.north,
                corners.west, corners.south  // Close the rectangle
            ]),
            width: 6,
            material: Cesium.Color.BLACK,
            clampToGround: true
        }
    });
    
    return falconEntity;
}

/**
 * Initialize the FALCON limits display
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @param {Object} options - Configuration options
 * @param {boolean} options.visible - Initial visibility (default: true)
 */
export function setupFalconLimits(viewer, options = {}) {
    viewerRef = viewer;
    const visible = options.visible !== undefined ? options.visible : true;
    
    createFalconRectangle(viewer);
    
    if (falconEntity) {
        falconEntity.show = visible;
    }
    
    return falconEntity;
}

/**
 * Show or hide the FALCON limits rectangle
 * @param {boolean} visible 
 */
export function setFalconLimitsVisible(visible) {
    if (falconEntity) {
        falconEntity.show = visible;
    }
}

/**
 * Toggle FALCON limits visibility
 * @returns {boolean} New visibility state
 */
export function toggleFalconLimits() {
    if (falconEntity) {
        falconEntity.show = !falconEntity.show;
        return falconEntity.show;
    }
    return false;
}

/**
 * Get current visibility state
 * @returns {boolean}
 */
export function isFalconLimitsVisible() {
    return falconEntity ? falconEntity.show : false;
}

/**
 * Remove the FALCON limits from the viewer
 */
export function removeFalconLimits() {
    if (viewerRef && falconEntity) {
        viewerRef.entities.remove(falconEntity);
        falconEntity = null;
    }
}

/**
 * Get the FALCON display dimensions
 * @returns {Object} { widthNM, heightNM, corners }
 */
export function getFalconDimensions() {
    return {
        widthNM: FALCON_WIDTH_NM,
        heightNM: FALCON_HEIGHT_NM,
        corners: calculateCorners()
    };
}