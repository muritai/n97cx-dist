// ===========================================================
//                    TRANSCRIPT SYNC MODULE
// ===========================================================
// Displays synchronized ATC transcript from SRT files
// Features: draggable window, resize handle, dimming previous/next
// Supports multiple transcripts (Nellis Control, Local Control)

// Transcript configuration - defines available transcripts
const TRANSCRIPT_CONFIGS = {
    nellis: {
        path: 'js/static/Nellis_US004758-US004762.srt',
        name: 'Nellis Control',
        startTime: '2022-07-17T18:15:00Z',  // Clock time for SRT 00:00:00
        hasAudio: false
    },
    lc: {
        path: 'js/static/LC1_1845-1912.srt',
        name: 'Local Control',
        startTime: '2022-07-17T18:45:00Z',  // Clock time for SRT 00:00:00
        hasAudio: true
    }
};

let transcripts = {};  // {nellis: [...], lc: [...]}
let activeTranscript = 'lc';  // Currently displayed transcript
let transcriptWindow = null;
let transcriptContent = null;
let frequencySelector = null;
let isTranscriptVisible = false;
let currentTransmissionIndex = -1;
let viewerRef = null;  // Store viewer reference for time calculations

// Speaker color coding (matches your aircraft colors)
const SPEAKER_COLORS = {
    "LC": "#4A9EFF",       // Blue - Local Control
    "LR": "#4A9EFF",       // Blue - Nellis Low Radar
    "TA": "#4A9EFF",       // Blue - Nellis TRACON Approach
    "N97CX": "#FF4444",    // Red
    "N160RA": "#44FF44",   // Green
    "N738CY": "#44FF44",   // Green
    "N466MD": "#44FF44",   // Green
    "DEFAULT": "#44FF44"   // Default green
};

/**
 * Parse SRT file into structured data
 */
function parseSRT(srtText) {
    const blocks = srtText.trim().split('\n\n');
    const parsed = [];
    
    blocks.forEach(block => {
        const lines = block.split('\n');
        if (lines.length < 3) return;
        
        // Parse timestamp line (format: 00:00:15,200 --> 00:00:18,500)
        const timeLine = lines[1];
        const [startStr, endStr] = timeLine.split(' --> ');
        
        const start = parseTimestamp(startStr);
        const end = parseTimestamp(endStr);
        
        // Text is everything after line 2
        const text = lines.slice(2).join(' ');
        
        parsed.push({ start, end, text });
    });
    
    return parsed;
}

/**
 * Convert SRT timestamp to seconds
 * Format: HH:MM:SS,mmm
 */
function parseTimestamp(timestamp) {
    const [time, ms] = timestamp.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + (ms ? ms / 1000 : 0);
}

/**
 * Extract speaker tag from text [TWR] or [N97CX]
 */
function extractSpeaker(text) {
    const match = text.match(/^\[([^\]]+)\]/);
    return match ? match[1] : null;
}

/**
 * Get color for speaker
 */
function getSpeakerColor(speaker) {
    return SPEAKER_COLORS[speaker] || SPEAKER_COLORS.DEFAULT;
}

/**
 * Create the transcript window UI
 */
function createTranscriptWindow() {
    // Main container
    transcriptWindow = document.createElement('div');
    transcriptWindow.id = 'transcript-window';
    transcriptWindow.style.cssText = `
        position: absolute;
        right: 10px;
        top: 100px;
        width: 280px;
        height: 600px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid #444;
        border-radius: 5px;
        z-index: 1000;
        display: none;
        flex-direction: column;
    `;

    // Header (draggable)
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 10px;
        background: rgba(48, 51, 54, 0.95);
        border-bottom: 1px solid #555;
        cursor: move;
        user-select: none;
        font-weight: bold;
        color: white;
        border-radius: 5px 5px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    `;

    // Title container with dropdown
    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
    `;

    // Static label
    const label = document.createElement('span');
    label.textContent = 'Transcript:';
    label.style.fontSize = '12px';
    titleContainer.appendChild(label);

    // Frequency selector dropdown
    frequencySelector = document.createElement('select');
    frequencySelector.style.cssText = `
        background: #333;
        color: white;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 3px 6px;
        font-size: 12px;
        cursor: pointer;
        font-weight: bold;
    `;

    // Add options for each transcript
    Object.entries(TRANSCRIPT_CONFIGS).forEach(([key, config]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = config.name;
        if (key === activeTranscript) {
            option.selected = true;
        }
        frequencySelector.appendChild(option);
    });

    frequencySelector.addEventListener('change', (e) => {
        e.stopPropagation();  // Prevent drag
        switchTranscript(e.target.value);
    });

    titleContainer.appendChild(frequencySelector);
    header.appendChild(titleContainer);

    // Legend button (?)
    const legendBtn = document.createElement('button');
    legendBtn.innerText = '?';
    legendBtn.title = 'Show Symbology Legend';
    legendBtn.style.cssText = `
        background: transparent;
        border: 1px solid #666;
        color: #aaa;
        border-radius: 3px;
        width: 20px;
        height: 20px;
        font-size: 12px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        flex-shrink: 0;
    `;
    legendBtn.addEventListener('mouseenter', () => {
        legendBtn.style.color = 'white';
        legendBtn.style.borderColor = '#999';
    });
    legendBtn.addEventListener('mouseleave', () => {
        legendBtn.style.color = '#aaa';
        legendBtn.style.borderColor = '#666';
    });
    legendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showLegend();
    });
    header.appendChild(legendBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '✕';
    closeBtn.title = 'Close Transcript';
    closeBtn.style.cssText = `
        background: transparent;
        border: 1px solid #666;
        color: #aaa;
        border-radius: 3px;
        width: 20px;
        height: 20px;
        font-size: 12px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        flex-shrink: 0;
    `;
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.color = 'white';
        closeBtn.style.borderColor = '#999';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.color = '#aaa';
        closeBtn.style.borderColor = '#666';
    });
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();  // Prevent drag from triggering
        toggleTranscript();
    });
    header.appendChild(closeBtn);

    transcriptWindow.appendChild(header);
    
    // Content area (scrollable)
    transcriptContent = document.createElement('div');
    transcriptContent.id = 'transcript-content';
    transcriptContent.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        color: white;
        font-family: monospace;
        font-size: 13px;
        line-height: 1.6;
    `;
    transcriptWindow.appendChild(transcriptContent);
    
    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = `
        height: 10px;
        background: rgba(48, 51, 54, 0.95);
        border-top: 1px solid #555;
        cursor: ns-resize;
        border-radius: 0 0 5px 5px;
    `;
    transcriptWindow.appendChild(resizeHandle);
    
    document.body.appendChild(transcriptWindow);
    
    // Make draggable
    makeDraggable(transcriptWindow, header);
    
    // Make resizable
    makeResizable(transcriptWindow, resizeHandle);
}

/**
 * Make window draggable by header
 */
function makeDraggable(window, header) {
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - window.offsetLeft;
        offsetY = e.clientY - window.offsetTop;
        header.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        window.style.left = (e.clientX - offsetX) + 'px';
        window.style.top = (e.clientY - offsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
        header.style.cursor = 'move';
    });
}

/**
 * Make window resizable from bottom
 */
function makeResizable(window, handle) {
    let isResizing = false;
    let startY, startHeight;
    
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = window.offsetHeight;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = e.clientY - startY;
        const newHeight = Math.max(300, Math.min(1200, startHeight + delta));
        window.style.height = newHeight + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

/**
 * Switch to a different transcript
 */
function switchTranscript(transcriptKey) {
    if (!TRANSCRIPT_CONFIGS[transcriptKey]) {
        console.warn(`Unknown transcript: ${transcriptKey}`);
        return;
    }

    activeTranscript = transcriptKey;
    currentTransmissionIndex = -1;  // Reset to force re-render

    // Update dropdown selection (in case called programmatically)
    if (frequencySelector) {
        frequencySelector.value = transcriptKey;
    }

    // Force immediate display update if visible
    if (isTranscriptVisible && viewerRef) {
        const config = TRANSCRIPT_CONFIGS[activeTranscript];
        const baseTime = Cesium.JulianDate.fromIso8601(config.startTime);
        const currentTime = Cesium.JulianDate.secondsDifference(
            viewerRef.clock.currentTime,
            baseTime
        );
        updateTranscriptDisplay(currentTime);
    }

    console.log(`Switched to transcript: ${TRANSCRIPT_CONFIGS[transcriptKey].name}`);
}

/**
 * Get simulation time in seconds for current transcript
 */
function getTranscriptTime(clock) {
    const config = TRANSCRIPT_CONFIGS[activeTranscript];
    const baseTime = Cesium.JulianDate.fromIso8601(config.startTime);
    return Cesium.JulianDate.secondsDifference(clock.currentTime, baseTime);
}

function findCurrentTransmission(currentTime, transcriptData) {
    if (!transcriptData || transcriptData.length === 0) return 0;

    // Find exact match first
    for (let i = 0; i < transcriptData.length; i++) {
        if (currentTime >= transcriptData[i].start && currentTime <= transcriptData[i].end) {
            return i;
        }
    }

    // During gaps: return the last transmission that completed
    for (let i = transcriptData.length - 1; i >= 0; i--) {
        if (currentTime > transcriptData[i].end) {
            return i;
        }
    }

    return 0;  // Before any transmissions, show first one
}


/**
 * Update transcript display based on current time
 */
function updateTranscriptDisplay(currentTime) {
    const transcriptData = transcripts[activeTranscript] || [];
    if (!isTranscriptVisible || transcriptData.length === 0) return;

    const index = findCurrentTransmission(currentTime, transcriptData);

    // Only update if transmission changed
    if (index === currentTransmissionIndex) return;
    currentTransmissionIndex = index;
    
    // Clear content
    transcriptContent.innerHTML = '';
    
    // Show context window: 3 before, current, 2 after
    const contextBefore = 3;
    const contextAfter = 2;
    const startIdx = Math.max(0, index - contextBefore);
    const endIdx = Math.min(transcriptData.length - 1, index + contextAfter);
    
    for (let i = startIdx; i <= endIdx; i++) {
        const transmission = transcriptData[i];
        const div = document.createElement('div');
        
        // Determine opacity based on distance from current
        let opacity = 1.0;
        let backgroundColor = 'transparent';
        
        if (i === index) {
            // Current transmission - bright with subtle highlight
            opacity = 1.0;
            backgroundColor = 'rgba(255, 255, 255, 0.1)';
        } else if (i < index) {
            // Previous transmissions - dim based on distance
            const distance = index - i;
            opacity = Math.max(0.25, 1.0 - (distance * 0.25));
        } else {
            // Future transmissions - very dim
            opacity = 0.3;
        }
        
        // Extract speaker and text
        const speaker = extractSpeaker(transmission.text);
        const text = transmission.text;
        
        // Style the transmission
        div.style.cssText = `
            padding: 8px;
            margin-bottom: 4px;
            border-left: 3px solid ${speaker ? getSpeakerColor(speaker) : '#666'};
            background: ${backgroundColor};
            opacity: ${opacity};
            border-radius: 3px;
            transition: opacity 0.3s ease;
        `;
        
        // Color speaker tag
        if (speaker) {
            const speakerSpan = document.createElement('span');
            speakerSpan.style.color = getSpeakerColor(speaker);
            speakerSpan.style.fontWeight = 'bold';
            speakerSpan.textContent = `[${speaker}] `;
            div.appendChild(speakerSpan);
            
            const textNode = document.createTextNode(text.replace(`[${speaker}] `, ''));
            div.appendChild(textNode);
        } else {
            div.textContent = text;
        }
        
        transcriptContent.appendChild(div);
        
        // Auto-scroll to keep current transmission centered
        if (i === index) {
            setTimeout(() => {
                div.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }
}

/**
 * Show speaker symbology legend
 */
function showLegend() {
    // Remove existing legend if present
    const existing = document.getElementById('transcript-legend');
    if (existing) {
        existing.remove();
        return;  // Toggle off
    }

    const legend = document.createElement('div');
    legend.id = 'transcript-legend';
    legend.style.cssText = `
        position: absolute;
        right: 300px;
        top: 100px;
        width: 220px;
        background: rgba(0, 0, 0, 0.95);
        border: 1px solid #444;
        border-radius: 5px;
        z-index: 1001;
        padding: 12px;
        color: white;
        font-family: monospace;
        font-size: 12px;
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        font-weight: bold;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid #555;
    `;
    title.textContent = 'Speaker Legend';
    legend.appendChild(title);

    const entries = [
        { code: 'LC', desc: 'Local Control (Tower)', color: SPEAKER_COLORS.LC },
        { code: 'LR', desc: 'Nellis Low Radar', color: SPEAKER_COLORS.LR },
        { code: 'TA', desc: 'Nellis TRACON Approach', color: SPEAKER_COLORS.TA },
        { code: 'N97CX', desc: 'Piper Meridian (accident)', color: SPEAKER_COLORS.N97CX },
        { code: 'N160RA', desc: 'Cessna 172 (accident)', color: SPEAKER_COLORS.N160RA },
    ];

    entries.forEach(entry => {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            align-items: center;
            margin-bottom: 6px;
            padding-left: 8px;
            border-left: 3px solid ${entry.color};
        `;

        const code = document.createElement('span');
        code.style.cssText = `
            color: ${entry.color};
            font-weight: bold;
            min-width: 65px;
        `;
        code.textContent = entry.code;
        row.appendChild(code);

        const desc = document.createElement('span');
        desc.style.color = '#ccc';
        desc.textContent = entry.desc;
        row.appendChild(desc);

        legend.appendChild(row);
    });

    // Close on click outside
    const closeHandler = (e) => {
        if (!legend.contains(e.target) && e.target.innerText !== '?') {
            legend.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);

    document.body.appendChild(legend);
}

/**
 * Toggle transcript window visibility
 */
function toggleTranscript() {
    isTranscriptVisible = !isTranscriptVisible;
    transcriptWindow.style.display = isTranscriptVisible ? 'flex' : 'none';
    
    // Update button text
    const btn = document.getElementById('transcript-toggle-btn');
    if (btn) {
        btn.textContent = isTranscriptVisible ? 'Hide Transcript' : 'Show Transcript';
    }
}

/**
 * Create toggle button
 */
function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'transcript-toggle-btn';
    btn.textContent = 'Show Transcript';
    btn.style.position = 'absolute';
    btn.style.bottom = '50px';
    btn.style.right = '10px';
    btn.style.zIndex = '1000';
    btn.style.backgroundColor = 'White';
    btn.style.color = 'Black';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', toggleTranscript);
    document.body.appendChild(btn);
}

/**
 * Load a single SRT file and parse it
 */
async function loadSRT(path) {
    const response = await fetch(path);
    const srtText = await response.text();
    return parseSRT(srtText);
}

/**
 * Initialize transcript system
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {string} srtPath - Path to SRT file (kept for backward compatibility)
 * @param {Cesium.JulianDate} audioStartTime - Audio start time in simulation (kept for backward compatibility)
 */
export async function setupTranscriptSync(viewer, srtPath, audioStartTime) {
    try {
        // Store viewer reference for time calculations
        viewerRef = viewer;

        // Load all transcript SRT files
        const loadPromises = Object.entries(TRANSCRIPT_CONFIGS).map(async ([key, config]) => {
            try {
                const data = await loadSRT(config.path);
                transcripts[key] = data;
                console.log(`✅ Loaded ${data.length} entries from ${config.name}`);
            } catch (err) {
                console.error(`❌ Error loading ${config.name}:`, err);
                transcripts[key] = [];
            }
        });

        await Promise.all(loadPromises);

        // Create UI
        createTranscriptWindow();
        createToggleButton();

        // Sync with Cesium clock
        viewer.clock.onTick.addEventListener((clock) => {
            if (!isTranscriptVisible) return;

            // Calculate seconds since the active transcript's start time
            const currentTime = getTranscriptTime(clock);
            updateTranscriptDisplay(currentTime);
        });

        console.log('✅ Transcript sync initialized with multiple frequencies');

    } catch (error) {
        console.error('❌ Error initializing transcript system:', error);
    }
}
