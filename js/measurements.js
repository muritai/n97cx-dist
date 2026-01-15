// ===========================================================
//                  MEASUREMENTS MODULE
//   (Distance Measure, Range Rings, Collapsible UI)
// ===========================================================

export function setupMeasurements(viewer, atctLat, atctLon, debug = false) {

    let measuring = false;
    let measurePoints = [];
    let measureLine = null;
    let measureLabel = null;


    console.log("✅ setupMeasurements called");

    if (!viewer) {
        console.error("❌ setupMeasurements: viewer is undefined!");
        return;
    }

    // Store ATCT coordinates for range rings
    const ATCT_LAT = atctLat;
    const ATCT_LON = atctLon;

    // =======================================================
    // Helper: Check if click is on UI instead of map
    // =======================================================
    function isClickOnUI(screenPosition) {
        const element = document.elementFromPoint(screenPosition.x, screenPosition.y);
        return element && !element.closest("#cesiumContainer");
    }

    // =======================================================
    // Reset Measurement
    // =======================================================
    function resetMeasurement() {
        measuring = false;
        measurePoints = [];

        if (measureLine) {
            viewer.entities.remove(measureLine);
            measureLine = null;
        }
        if (measureLabel) {
            viewer.entities.remove(measureLabel);
            measureLabel = null;
        }
    }

    // =======================================================
    // Compute Bearing Between Points
    // =======================================================
    function computeMeasurementBearing(start, end) {
        const startCarto = Cesium.Cartographic.fromCartesian(start);
        const endCarto = Cesium.Cartographic.fromCartesian(end);

        const lon1 = Cesium.Math.toRadians(startCarto.longitude);
        const lat1 = Cesium.Math.toRadians(startCarto.latitude);
        const lon2 = Cesium.Math.toRadians(endCarto.longitude);
        const lat2 = Cesium.Math.toRadians(endCarto.latitude);

        const dLon = lon2 - lon1;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
                  Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

        let bearing = Cesium.Math.toDegrees(Math.atan2(y, x));
        if (bearing < 0) bearing += 360;

        return bearing.toFixed(1);
    }

    // =======================================================
    // Draw Measurement Line + Label
    // =======================================================
    function drawMeasurement() {
        if (measurePoints.length !== 2) return;

        const start = measurePoints[0];
        const end   = measurePoints[1];

        const distanceMeters = Cesium.Cartesian3.distance(start, end);
        const distanceNM = (distanceMeters / 1852).toFixed(2);
        const bearing = computeMeasurementBearing(start, end);

        const startUp = Cesium.Cartesian3.add(start, new Cesium.Cartesian3(0,0,5), new Cesium.Cartesian3());
        const endUp = Cesium.Cartesian3.add(end, new Cesium.Cartesian3(0,0,5), new Cesium.Cartesian3());

        measureLine = viewer.entities.add({
            polyline: {
                positions: [startUp, endUp],
                width: 3,
                material: new Cesium.PolylineOutlineMaterialProperty({
                    color: Cesium.Color.YELLOW,
                    outlineWidth: 2,
                    outlineColor: Cesium.Color.BLACK
                })
            }
        });

        const mid = Cesium.Cartesian3.midpoint(startUp, endUp, new Cesium.Cartesian3());
        measureLabel = viewer.entities.add({
            position: mid,
            label: {
                text: `${distanceNM} nm\nBearing: ${bearing}°`,
                font: "16px sans-serif",
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
                pixelOffset: new Cesium.Cartesian2(0, -20),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });
    }

    // =======================================================
    // Range Rings
    // =======================================================

    let rangeRingEntities = [];
    let ringsVisible = false;

    function addRangeRings(lat, lon, nmValues, color = Cesium.Color.RED) {
        const centerCarto = Cesium.Cartographic.fromDegrees(lon, lat);

        nmValues.forEach(nm => {
            const radius = nm * 1852;
            const positions = [];

            for (let i = 0; i <= 360; i += 5) {
                const angle = Cesium.Math.toRadians(i);
                const latOff = radius * Math.cos(angle) / 111320;
                const lonOff = radius * Math.sin(angle) / (111320 * Math.cos(centerCarto.latitude));

                positions.push(
                    Cesium.Cartesian3.fromDegrees(lon + lonOff, lat + latOff)
                );
            }

            const ring = viewer.entities.add({
                polyline: {
                    positions,
                    width: 4,
                    material: color,
                    clampToGround: true
                }
            });

            // Label position - adjust longitude offset for latitude
            const lonOffset = -.0025 + radius / (111320 * Math.cos(lat * Math.PI / 180));
            const eastPt = Cesium.Cartesian3.fromDegrees(lon + lonOffset, lat);

            const label = viewer.entities.add({
                position: eastPt,
                label: {
                    text: `${nm} NM`,
                    font: "18px sans-serif",
                    fillColor: Cesium.Color.RED,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                }
            });
            rangeRingEntities.push(ring, label);
        });
    }

    function toggleRangeRings(lat, lon, nmList) {
        if (ringsVisible) {
            rangeRingEntities.forEach(e => viewer.entities.remove(e));
            rangeRingEntities = [];
            ringsVisible = false;
            ringBtn.textContent = "Show ATCT Range Rings";
            ringBtn.style.background = "";        // Remove gray background
            console.log("❌ Range rings hidden");
        } else {
            addRangeRings(lat, lon, nmList);
            ringsVisible = true;
            ringBtn.textContent = "Hide ATCT Range Rings";
            ringBtn.style.background = "gray";    // Add gray background
        }
    }

    // =======================================================
    // Build UI Box (collapsible)
    // =======================================================

    const ui = document.createElement("div");
    ui.style.position = "absolute";
    ui.style.top = "50px";
    ui.style.right = "10px";
    ui.style.background = "rgba(0,0,0,0.7)";
    ui.style.padding = "8px";
    ui.style.borderRadius = "6px";
    ui.style.color = "white";
    ui.style.zIndex = 1000;
    ui.style.width = "170px";
    document.body.appendChild(ui);

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.cursor = "pointer";

    const title = document.createElement("span");
    title.innerText = "Measurements";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "+";
    toggleBtn.style.marginLeft = "8px";

    header.appendChild(title);
    header.appendChild(toggleBtn);
    ui.appendChild(header);

    const content = document.createElement("div");
    content.style.display = "none";
    content.style.marginTop = "6px";
    ui.appendChild(content);

    let expanded = false;
    toggleBtn.onclick = () => {
        expanded = !expanded;
        content.style.display = expanded ? "block" : "none";
        toggleBtn.textContent = expanded ? "−" : "+";
    };

    // Distance button
    const measureBtn = document.createElement("button");
    measureBtn.textContent = "Distance Measure (NM)";
    measureBtn.style.width = "100%";
    measureBtn.style.marginBottom = "10px";
    content.appendChild(measureBtn);

    measureBtn.onclick = evt => {
        evt.stopPropagation();

        if (measuring) {
            resetMeasurement();
            measureBtn.style.background = "";
        } else {
            measuring = true;
            measureBtn.style.background = "gray";
        }
    };

    // Range ring UI
    const ringLabel = document.createElement("label");
    ringLabel.textContent = "ATCT Rings (NM):";
    ringLabel.style.display = "block";
    content.appendChild(ringLabel);

    const ringInput = document.createElement("input");
    ringInput.type = "text";
    ringInput.value = ".5,1,1.5,2,5,10";
    ringInput.style.width = "120px";
    content.appendChild(ringInput);

    const ringBtn = document.createElement("button");
    ringBtn.textContent = "Show ATCT Range Rings";
    ringBtn.style.width = "100%";
    ringBtn.style.marginTop = "10px";
    content.appendChild(ringBtn);

    // ...
    ringBtn.onclick = () => {
        // const nums = ringInput.value.split(",").map(v => parseFloat(v)).filter(v => !isNaN(v));
        
        // 1. Get the Cartesian position directly under the camera (the center of the screen)
        // const centerScreenPos = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
        // const ray = viewer.camera.getPickRay(centerScreenPos);
        // const centerCartesian = viewer.scene.globe.pick(ray, viewer.scene);
        
        // if (!Cesium.defined(centerCartesian)) {
        //     console.error("Could not find a pick position for range rings.");
        //     return;
        // }

        // 2. Convert the Cartesian point on the globe to a Cartographic object (Lat/Lon)
        // const centerCartographic = Cesium.Cartographic.fromCartesian(centerCartesian);
        
        const nums = ringInput.value.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        // toggleRangeRings(ATCT_LAT, ATCT_LON, nums);


        const lat = ATCT_LAT;
        const lon = ATCT_LON;

        // 4. Pass the latitude and longitude to toggleRangeRings
        toggleRangeRings(lat, lon, nums);
    };
    // =======================================================

    // =======================================================
    // Handle clicks on map for measurement
    // =======================================================
    viewer.screenSpaceEventHandler.setInputAction(click => {
        if (!measuring) return;

        if (isClickOnUI(click.position)) return;

        // Always use globe.pick for consistent ground-based measurements
        // (pickPosition uses depth buffer which varies with zoom level)
        const ray = viewer.camera.getPickRay(click.position);
        const pos = viewer.scene.globe.pick(ray, viewer.scene);
        
        if (!Cesium.defined(pos)) return;

        measurePoints.push(pos);
        if (measurePoints.length === 2) drawMeasurement();

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

}