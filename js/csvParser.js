// CSV Parsing Utility
function parseCSV(csv) {
    // Split on actual newlines, ignoring the first row (header)
    const rows = csv.split(/\r?\n/).slice(1);

    // Convert each CSV row into an object with time/lon/lat/alt
    return rows.map(row => {
        const cols = row.split(","); // Split by commas
        return {
            time: (cols[0] || "").trim(),
            lon: parseFloat((cols[1] || "").trim()),
            lat: parseFloat((cols[2] || "").trim()),
            alt: parseFloat((cols[3] || "").trim())
        };
    }).filter(r => r.time); // Filter out empty lines
}

// Export the function for use in drones.js
export { parseCSV };
