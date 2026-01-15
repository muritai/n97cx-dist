// ===========================================================
//                    TRANSCRIPT SYNC MODULE
// ===========================================================
// Displays synchronized ATC transcript from SRT file
// Features: draggable window, resize handle, dimming previous/next

let transcriptData = [];
let transcriptWindow = null;
let transcriptContent = null;
let isTranscriptVisible = false;
let currentTransmissionIndex = -1;

// Speaker color coding (matches your aircraft colors)
const SPEAKER_COLORS = {
    "LC": "#4A9EFF",       // Blue
    "N97CX": "#FF4444",    // Red  "#FF4444"
    "N160RA": "#44FF44",   // Green
    "N738CY": "#44FF44",   // Green
    "N466MD": "#44FF44",   // Magenta #FF44FF
    "DEFAULT": "#44FF44"   // White  #FFFFFF
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
    `;

    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'Local Control Transcript';
    header.appendChild(headerTitle);

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

function findCurrentTransmission(currentTime) {
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
    if (!isTranscriptVisible || transcriptData.length === 0) return;
    
    const index = findCurrentTransmission(currentTime);
    
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
 * Initialize transcript system
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {string} srtPath - Path to SRT file
 * @param {Cesium.JulianDate} audioStartTime - Audio start time in simulation
 */
export async function setupTranscriptSync(viewer, srtPath, audioStartTime) {
    try {
        // Load SRT file
        const response = await fetch(srtPath);
        const srtText = await response.text();
        
        // Parse SRT
        transcriptData = parseSRT(srtText);
        console.log(`✅ Loaded ${transcriptData.length} transcript entries`);
        
        // Create UI
        createTranscriptWindow();
        createToggleButton();
        
        // Sync with Cesium clock
        viewer.clock.onTick.addEventListener((clock) => {
            if (!isTranscriptVisible) return;
            
            // Calculate seconds since audio start
            const currentTime = Cesium.JulianDate.secondsDifference(
                clock.currentTime,
                audioStartTime
            );
            
            updateTranscriptDisplay(currentTime);
        });
        
        console.log('✅ Transcript sync initialized');
        
    } catch (error) {
        console.error('❌ Error loading transcript:', error);
    }
}
