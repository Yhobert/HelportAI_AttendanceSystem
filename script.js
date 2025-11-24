const startBtn=document.getElementById('startBtn'),
      stopBtn=document.getElementById('stopBtn'),
      video=document.getElementById('video'),
      overlay=document.getElementById('overlay'),
      ctx=overlay.getContext('2d'),
      status=document.getElementById('status'),
      lastResult=document.getElementById('lastResult'),
      logEl=document.getElementById('log'),
      fileInput=document.getElementById('fileInput'),
      facingSelect=document.getElementById('facingSelect'),
      beep=document.getElementById('beep'),
      soundToggle=document.getElementById('soundToggle'),
      autoCopy=document.getElementById('autoCopy'),
      autoOpen=document.getElementById('autoOpen'),
      clearLogBtn=document.getElementById('clearLog'),
      exportCsvBtn=document.getElementById('exportCsv');

let stream=null, rafId=null, barcodeDetector=null, fallbackJsQR=null, scanning=false;
const LOG_KEY='qr-scanner-log-v4'; // Changed version to reset old data
const MAX_ENTRIES=10; // Maximum number of log entries to keep

// Enhanced scanning parameters
let scanInterval = 0;
let lastScanTime = 0;
const SCAN_THROTTLE_MS = 300; // Reduce scanning frequency for better performance
const MIN_SCAN_CONFIDENCE = 0.7;

// Focus area visualization
const focusArea = {
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5
};

// YOUR AUDIO FILES - will play automatically on scan
const firstTapAudio = new Audio('ingat.mp3');
const secondTapAudio = new Audio('loginSucc.mp3');

// Optional: Preload audio files
firstTapAudio.preload = 'auto';
secondTapAudio.preload = 'auto';

async function initBarcodeDetector(){
    if('BarcodeDetector' in window){
        try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if(formats.includes('qr_code')) {
                barcodeDetector = new BarcodeDetector({formats:['qr_code']});
                console.log('Using native BarcodeDetector API');
            }
        } catch(e) {
            console.warn('BarcodeDetector API not fully supported');
        }
    }
    if(!barcodeDetector) {
        await loadJsQR();
        console.log('Using JSQR fallback');
    }
}

function loadJsQR(){
    if(fallbackJsQR) return Promise.resolve();
    return new Promise((res,rej)=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        s.onload = ()=>{fallbackJsQR = window.jsQR; res()};
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

async function startCamera(){
    if(scanning) return;
    
    await initBarcodeDetector();
    const facingMode = facingSelect.value || 'environment';
    
    try {
        // Enhanced camera constraints for better focus
        const constraints = {
            video: {
                facingMode: facingMode,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        // Wait for video to be ready with metadata
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play().then(resolve);
            };
        });
        
        // Set overlay dimensions to match video
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        
        scanning = true;
        status.textContent = 'Scanning...';
        lastScanTime = 0;
        
        // Start the scanning loop
        tick();
        
    } catch(e) {
        console.error('Camera error:', e);
        status.textContent = 'Camera unavailable';
        
        // Fallback to less strict constraints
        try {
            const fallbackConstraints = {
                video: {
                    facingMode: facingMode
                }
            };
            stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            video.srcObject = stream;
            await video.play();
            
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
            scanning = true;
            status.textContent = 'Scanning...';
            lastScanTime = 0;
            tick();
        } catch(fallbackError) {
            alert('Unable to access camera: ' + fallbackError.message);
        }
    }
}

function stopCamera(){
    scanning = false;
    status.textContent = 'Camera is Off';
    
    if(rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    
    if(stream) {
        stream.getTracks().forEach(track => {
            track.stop();
        });
        stream = null;
    }
    
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function getFocusAreaBitmap() {
    const focusCanvas = document.createElement('canvas');
    const focusCtx = focusCanvas.getContext('2d');
    
    const focusWidth = overlay.width * focusArea.width;
    const focusHeight = overlay.height * focusArea.height;
    const focusX = overlay.width * focusArea.x;
    const focusY = overlay.height * focusArea.y;
    
    // Set focus area size (slightly larger for better detection)
    focusCanvas.width = focusWidth;
    focusCanvas.height = focusHeight;
    
    // Draw only the focus area
    focusCtx.drawImage(
        video, 
        focusX, focusY, focusWidth, focusHeight,
        0, 0, focusWidth, focusHeight
    );
    
    return focusCanvas;
}

function drawFocusArea() {
    const focusX = overlay.width * focusArea.x;
    const focusY = overlay.height * focusArea.y;
    const focusWidth = overlay.width * focusArea.width;
    const focusHeight = overlay.height * focusArea.height;
    
    // Draw semi-transparent overlay outside focus area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    
    // Clear the focus area
    ctx.clearRect(focusX, focusY, focusWidth, focusHeight);
    
    // Draw focus area border
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.strokeRect(focusX, focusY, focusWidth, focusHeight);
    ctx.setLineDash([]);
    
    // Draw corner markers
    const cornerSize = 20;
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3;
    
    // Top-left
    ctx.beginPath();
    ctx.moveTo(focusX, focusY + cornerSize);
    ctx.lineTo(focusX, focusY);
    ctx.lineTo(focusX + cornerSize, focusY);
    ctx.stroke();
    
    // Top-right
    ctx.beginPath();
    ctx.moveTo(focusX + focusWidth - cornerSize, focusY);
    ctx.lineTo(focusX + focusWidth, focusY);
    ctx.lineTo(focusX + focusWidth, focusY + cornerSize);
    ctx.stroke();
    
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(focusX + focusWidth, focusY + focusHeight - cornerSize);
    ctx.lineTo(focusX + focusWidth, focusY + focusHeight);
    ctx.lineTo(focusX + focusWidth - cornerSize, focusY + focusHeight);
    ctx.stroke();
    
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(focusX + cornerSize, focusY + focusHeight);
    ctx.lineTo(focusX, focusY + focusHeight);
    ctx.lineTo(focusX, focusY + focusHeight - cornerSize);
    ctx.stroke();
}

async function tick() {
    if(!scanning) return;
    
    const now = Date.now();
    
    // Throttle scanning for better performance
    if(now - lastScanTime < SCAN_THROTTLE_MS) {
        rafId = requestAnimationFrame(tick);
        return;
    }
    
    if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        // Update overlay dimensions if they changed
        if(overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }
        
        // Draw focus area guide
        drawFocusArea();
        
        let detected = false;
        
        try {
            if(barcodeDetector) {
                const focusCanvas = getFocusAreaBitmap();
                const bitmap = await createImageBitmap(focusCanvas);
                const results = await barcodeDetector.detect(bitmap);
                
                if(results && results.length > 0) {
                    const bestResult = results[0];
                    // Adjust coordinates from focus area to full canvas
                    const adjustedBox = {
                        x: bestResult.boundingBox.x + (overlay.width * focusArea.x),
                        y: bestResult.boundingBox.y + (overlay.height * focusArea.y),
                        width: bestResult.boundingBox.width,
                        height: bestResult.boundingBox.height
                    };
                    
                    drawBoxes([adjustedBox]);
                    handleResult(bestResult.rawValue, 'camera');
                    detected = true;
                }
                bitmap.close();
            } else if(fallbackJsQR) {
                const focusCanvas = getFocusAreaBitmap();
                const imageData = focusCanvas.getContext('2d').getImageData(0, 0, focusCanvas.width, focusCanvas.height);
                const code = fallbackJsQR(imageData.data, imageData.width, imageData.height);
                
                if(code) {
                    // Adjust coordinates from focus area to full canvas
                    const adjustedLocation = {
                        topLeftCorner: {
                            x: code.location.topLeftCorner.x + (overlay.width * focusArea.x),
                            y: code.location.topLeftCorner.y + (overlay.height * focusArea.y)
                        },
                        topRightCorner: {
                            x: code.location.topRightCorner.x + (overlay.width * focusArea.x),
                            y: code.location.topRightCorner.y + (overlay.height * focusArea.y)
                        },
                        bottomRightCorner: {
                            x: code.location.bottomRightCorner.x + (overlay.width * focusArea.x),
                            y: code.location.bottomRightCorner.y + (overlay.height * focusArea.y)
                        },
                        bottomLeftCorner: {
                            x: code.location.bottomLeftCorner.x + (overlay.width * focusArea.x),
                            y: code.location.bottomLeftCorner.y + (overlay.height * focusArea.y)
                        }
                    };
                    
                    drawPolygon(adjustedLocation);
                    handleResult(code.data, 'camera');
                    detected = true;
                }
            }
        } catch(error) {
            console.warn('Scanning error:', error);
            if(!fallbackJsQR) await loadJsQR();
        }
        
        if(!detected) {
            clearOverlay();
            drawFocusArea(); // Redraw focus area
        }
        
        lastScanTime = now;
    }
    
    rafId = requestAnimationFrame(tick);
}

function drawBoxes(boxes) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = Math.max(3, overlay.width / 300);
    ctx.setLineDash([]);
    
    boxes.forEach(box => {
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.stroke();
        
        // Draw confidence indicator
        ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
        ctx.fillRect(box.x, box.y, box.width, box.height);
    });
}

function drawPolygon(location) {
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = Math.max(3, overlay.width / 300);
    ctx.setLineDash([]);
    
    ctx.beginPath();
    ctx.moveTo(location.topLeftCorner.x, location.topLeftCorner.y);
    ctx.lineTo(location.topRightCorner.x, location.topRightCorner.y);
    ctx.lineTo(location.bottomRightCorner.x, location.bottomRightCorner.y);
    ctx.lineTo(location.bottomLeftCorner.x, location.bottomLeftCorner.y);
    ctx.closePath();
    ctx.stroke();
    
    // Fill with semi-transparent color
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fill();
}

function clearOverlay() {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

let lastSeen = null;
function handleResult(text, type) {
    if (!text) return;
    const now = new Date();

    // Prevent duplicate scans within 2 seconds
    if (lastSeen && lastSeen.text === text && (now - lastSeen.time) < 2000) return;
    lastSeen = { text: text, time: now };
    
    lastResult.textContent = text;
    status.textContent = 'Detected!';
    status.style.color = '#00ff00';

    // Reset status color after 1 second
    setTimeout(() => {
        if(scanning) {
            status.textContent = 'Scanning...';
            status.style.color = '';
        }
    }, 1000);

    // Capture snapshot
    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    const snapCtx = snapshotCanvas.getContext('2d');
    snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const snapshotData = snapshotCanvas.toDataURL('image/jpeg', 0.8);

    saveLogItem({
        text: text,
        type: type,
        snapshot: snapshotData
    });

    // Play appropriate audio
    playTapAudio(text);

    // Handle auto-copy and auto-open
    // Auto-copy if enabled
if (autoCopy.checked && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(e => console.log('Clipboard error:', e));
}

// Always auto-open links automatically (no checkbox needed)
if (/^https?:\/\//i.test(text)) {
    window.open(text, '_blank', 'noopener,noreferrer');
}

}

function playTapAudio(text) {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const today = new Date().toLocaleDateString();
    
    const existingEntry = log.find(e => e.text === text && e.date === today);
    
    try {
        if (existingEntry && existingEntry.logIn && !existingEntry.logOut) {
            // Second tap (log out)
            secondTapAudio.currentTime = 0;
            secondTapAudio.play().catch(e => console.log('Second tap audio play failed:', e));
        } else {
            // First tap (log in)
            firstTapAudio.currentTime = 0;
            firstTapAudio.play().catch(e => console.log('First tap audio play failed:', e));
        }
    } catch (e) {
        console.log('Audio error:', e);
    }
}

function saveLogItem(data) {
    let log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();

    let existing = log.find(e => e.text === data.text && e.date === today);

    const text = (data.text || "").trim();
    let eid = "";
    let name = "";

    // Parse EID and Name from QR text
    if (text.match(/^\d+\s*[-:]\s*[A-Za-z]/)) {
        const parts = text.split(/[-:]/);
        eid = parts[0].trim();
        name = parts[1] ? parts[1].trim() : "";
    }
    else if (text.match(/[A-Za-z].*[-:]\s*\d+$/)) {
        const parts = text.split(/[-:]/);
        name = parts[0].trim();
        eid = parts[1] ? parts[1].trim() : "";
    }
    else if (/[A-Za-z]/.test(text) && !/\d{6,}/.test(text)) {
        name = text;
    }
    else if (/^\d+$/.test(text)) {
        eid = text;
        name = "";
    }
    else {
        name = text;
    }

    if (!existing) {
        const entry = {
            ...data,
            eid: eid,
            name: name,
            date: today,
            logIn: now,
            logOut: '',
            timestamp: Date.now()
        };
        log.unshift(entry);
    } else {
        existing.logOut = now;
        existing.snapshot = data.snapshot;
        existing.timestamp = Date.now();
        
        // Move updated entry to the top
        log = log.filter(item => item !== existing);
        log.unshift(existing);
    }

    // Keep only latest MAX_ENTRIES (10) entries
    if (log.length > MAX_ENTRIES) {
        log = log.slice(0, MAX_ENTRIES);
    }

    localStorage.setItem(LOG_KEY, JSON.stringify(log));
    renderLog();
}

function renderLog() {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.sort((a, b) => b.timestamp - a.timestamp);

    // Update log counter display
    const logCounter = document.getElementById('logCounter') || createLogCounter();
    logCounter.textContent = `Entries: ${log.length}/${MAX_ENTRIES}`;

    logEl.innerHTML = log.map(item => `
        <div class="entry">
            ${item.snapshot ? `<img src="${item.snapshot}" alt="snapshot" style="width:100%;border-radius:8px;margin-bottom:6px;">` : ''}

            <small>
                Date: ${item.date} • 
                Log In: ${item.logIn} • 
                Log Out: ${item.logOut || '—'}
            </small>
        </div>
    `).join('');
}


// Helper function to create log counter
function createLogCounter() {
    const counter = document.createElement('div');
    counter.id = 'logCounter';
    counter.style.cssText = 'text-align: center; font-weight: bold; margin: 10px 0; padding: 5px; background: #0eaa88ff; border-radius: 5px;';
    logEl.parentNode.insertBefore(counter, logEl);
    return counter;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
fileInput.addEventListener('change', handleFileUpload);
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
clearLogBtn.addEventListener('click', clearLog);
exportCsvBtn.addEventListener('click', exportToCsv);

async function handleFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    
    const img = new Image();
    img.onload = async () => {
        overlay.width = img.naturalWidth;
        overlay.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, overlay.width, overlay.height);
        
        if(!barcodeDetector && !fallbackJsQR) await loadJsQR();
        
        let detected = false;
        if(barcodeDetector) {
            try {
                const bitmap = await createImageBitmap(overlay);
                const results = await barcodeDetector.detect(bitmap);
                if(results && results.length) {
                    drawBoxes(results.map(r => r.boundingBox));
                    handleResult(results[0].rawValue, 'image');
                    detected = true;
                }
                bitmap.close();
            } catch(e) {
                console.error('BarcodeDetector error:', e);
            }
        }
        
        if(!detected && fallbackJsQR) {
            const imageData = ctx.getImageData(0, 0, overlay.width, overlay.height);
            const code = fallbackJsQR(imageData.data, imageData.width, imageData.height);
            if(code) {
                drawPolygon(code.location);
                handleResult(code.data, 'image');
                detected = true;
            }
        }
        
        if(!detected) {
            alert('No QR code found in image');
        }
    };
    img.onerror = () => alert('Invalid image file');
    img.src = URL.createObjectURL(file);
}

function clearLog() {
    if(confirm('Clear all log entries?')) {
        localStorage.removeItem(LOG_KEY);
        renderLog();
    }
}

function exportToCsv() {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (!log.length) {
        alert('No entries to export');
        return;
    }

    const csvRows = ['EID,Name,Date,Log In,Log Out,Type,QR Text'];

    log.forEach(record => {
        const row = [
            `"${(record.eid || '').replace(/"/g, '""')}"`,
            `"${(record.name || '').replace(/"/g, '""')}"`,
            `"${record.date}"`,
            `"${record.logIn}"`,
            `"${record.logOut}"`,
            `"${record.type}"`,
            `"${(record.text || '').replace(/"/g, '""')}"`
        ].join(',');

        csvRows.push(row);
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-log-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// Initialize
renderLog();
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', stopCamera);

// Add focus area adjustment controls
function createFocusControls() {
    const controls = document.createElement('div');
    controls.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);padding:10px;border-radius:5px;z-index:1000;color:white;';
    
    controls.innerHTML = `
        <div style="margin-bottom:10px;">
            <label style="display:block;margin-bottom:5px;">Focus Area Size:</label>
            <input type="range" id="focusSize" min="0.3" max="0.8" step="0.05" value="0.5" style="width:100px;">
        </div>
        <div>
            <button id="resetFocus" style="background:#00ffcc;border:none;padding:5px 10px;border-radius:3px;cursor:pointer;">Reset Focus</button>
        </div>
    `;
    
    document.body.appendChild(controls);
    
    const focusSize = document.getElementById('focusSize');
    const resetFocus = document.getElementById('resetFocus');
    
    focusSize.addEventListener('input', (e) => {
        const size = parseFloat(e.target.value);
        focusArea.width = size;
        focusArea.height = size;
        focusArea.x = (1 - size) / 2;
        focusArea.y = (1 - size) / 2;
    });
    
    resetFocus.addEventListener('click', () => {
        focusArea.width = 0.5;
        focusArea.height = 0.5;
        focusArea.x = 0.25;
        focusArea.y = 0.25;
        focusSize.value = 0.5;
    });
}

// Uncomment the line below to add focus controls (optional)
// createFocusControls();
