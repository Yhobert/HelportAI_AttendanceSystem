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
      clearLogBtn=document.getElementById('clearLog');

let stream=null, rafId=null, barcodeDetector=null, fallbackJsQR=null, scanning=false;
let snapshotDirectoryHandle = null;
const DB_NAME = 'AttendanceDB';
const DB_VERSION = 2; // Incremented version for new schema
const STORE_NAME = 'attendance';
let db = null;

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

// File System Access API - Request directory permission
// File System Access API - Request directory permission
async function requestDirectoryPermission() {
    try {
        // Check if the File System Access API is supported
        if ('showDirectoryPicker' in window) {
            snapshotDirectoryHandle = await window.showDirectoryPicker();
            // Store permission state
            localStorage.setItem('hasDirectoryPermission', 'true');
            console.log('Directory access granted');
            
            // Create a subdirectory for snapshots
            try {
                snapshotDirectoryHandle = await snapshotDirectoryHandle.getDirectoryHandle('attendance-snapshots', { create: true });
                console.log('Created attendance-snapshots folder');
            } catch (e) {
                console.log('Using root directory for snapshots');
            }
            
            return true;
        } else {
            console.warn('File System Access API not supported in this browser');
            return false;
        }
    } catch (error) {
        console.warn('User denied directory access or API not available:', error);
        localStorage.setItem('hasDirectoryPermission', 'false');
        return false;
    }
}

// Save snapshot to local disk - UPDATED VERSION
async function saveSnapshotToDisk(snapshotData, filename) {
    if (!snapshotDirectoryHandle) {
        console.log('No directory handle available. Snapshots will not be saved to disk.');
        return null;
    }

    try {
        // Convert base64 to blob
        const response = await fetch(snapshotData);
        const blob = await response.blob();
        
        // Create file handle
        const fileHandle = await snapshotDirectoryHandle.getFileHandle(filename, { create: true });
        
        // Create writable stream
        const writable = await fileHandle.createWritable();
        
        // Write the blob to the file
        await writable.write(blob);
        
        // Close the file
        await writable.close();
        
        console.log(`Snapshot saved as: ${filename}`);
        return filename;
    } catch (error) {
        console.error('Error saving snapshot to disk:', error);
        return null;
    }
}

// Update the saveLogItem function to handle disk save failures gracefully
// In the saveLogItem function, add this line to ensure total hours calculation:
async function saveLogItem(data) {
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();
    const timestamp = Date.now();

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

    // Check for existing record for today
    const existing = await getRecordByTextAndDate(text, today);

    let savedFilename = null;
    
    // Try to save snapshot to disk if we have directory access
    if (snapshotDirectoryHandle) {
        const filename = generateSnapshotFilename(eid, name, timestamp, !!existing);
        savedFilename = await saveSnapshotToDisk(data.snapshot, filename);
    }

    if (!existing) {
        // First scan (log in)
        const entry = {
            text: data.text,
            type: data.type,
            eid: eid,
            name: name,
            date: today,
            logIn: now,
            logOut: '',
            filename: savedFilename,
            timestamp: timestamp
        };
        await addRecord(entry);
    } else {

        await updateRecord(existing.id, {
            logOut: now,
            filename: savedFilename,
            timestamp: timestamp
        });
    }

    renderLog();
}

async function checkDirectoryPermission() {
    if (localStorage.getItem('hasDirectoryPermission') === 'true' && 'showDirectoryPicker' in window) {
        try {
            return true;
        } catch (error) {
            return false;
        }
    }
    return false;
}

async function saveSnapshotToDisk(snapshotData, filename) {
    if (!snapshotDirectoryHandle) {
        console.log('No directory handle available. Snapshots will not be saved to disk.');
        return null;
    }

    try {
        const response = await fetch(snapshotData);
        const blob = await response.blob();

        const fileHandle = await snapshotDirectoryHandle.getFileHandle(filename, { create: true });

        const writable = await fileHandle.createWritable();

        await writable.write(blob);

        await writable.close();
        
        console.log(`Snapshot saved as: ${filename}`);
        return filename;
    } catch (error) {
        console.error('Error saving snapshot to disk:', error);
        return null;
    }
}

function generateSnapshotFilename(eid, name, timestamp, isLogOut = false) {
    const date = new Date(timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const type = isLogOut ? 'out' : 'in';
    const safeName = (name || 'unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const safeEid = (eid || 'unknown').replace(/[^a-z0-9]/gi, '_');
    
    return `${dateStr}_${timeStr}_${safeEid}_${safeName}_${type}.jpg`;
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('text', 'text', { unique: false });
                store.createIndex('filename', 'filename', { unique: false });
            }
        };
    });
}

async function addRecord(record) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(record);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function updateRecord(id, updates) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);
        
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
            const record = getRequest.result;
            if (record) {
                const updatedRecord = { ...record, ...updates };
                const putRequest = store.put(updatedRecord);
                putRequest.onerror = () => reject(putRequest.error);
                putRequest.onsuccess = () => resolve(putRequest.result);
            } else {
                reject(new Error('Record not found'));
            }
        };
    });
}

async function getRecords(limit = null) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');
        const results = [];
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && (!limit || results.length < limit)) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

async function getRecordByTextAndDate(text, date) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('text');
        const request = index.openCursor();
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.text === text && cursor.value.date === date) {
                    resolve(cursor.value);
                } else {
                    cursor.continue();
                }
            } else {
                resolve(null);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}

async function clearAllRecords() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function getRecordsCount() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

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

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play().then(resolve);
            };
        });

        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        
        scanning = true;
        status.textContent = 'Scanning...';
        lastScanTime = 0;

        tick();
        
    } catch(e) {
        console.error('Camera error:', e);
        status.textContent = 'Camera unavailable';

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

    focusCanvas.width = focusWidth;
    focusCanvas.height = focusHeight;

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

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, overlay.width, overlay.height);

    ctx.clearRect(focusX, focusY, focusWidth, focusHeight);

    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.strokeRect(focusX, focusY, focusWidth, focusHeight);
    ctx.setLineDash([]);

    const cornerSize = 20;
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(focusX, focusY + cornerSize);
    ctx.lineTo(focusX, focusY);
    ctx.lineTo(focusX + cornerSize, focusY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(focusX + focusWidth - cornerSize, focusY);
    ctx.lineTo(focusX + focusWidth, focusY);
    ctx.lineTo(focusX + focusWidth, focusY + cornerSize);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(focusX + focusWidth, focusY + focusHeight - cornerSize);
    ctx.lineTo(focusX + focusWidth, focusY + focusHeight);
    ctx.lineTo(focusX + focusWidth - cornerSize, focusY + focusHeight);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(focusX + cornerSize, focusY + focusHeight);
    ctx.lineTo(focusX, focusY + focusHeight);
    ctx.lineTo(focusX, focusY + focusHeight - cornerSize);
    ctx.stroke();
}

async function tick() {
    if(!scanning) return;
    
    const now = Date.now();

    if(now - lastScanTime < SCAN_THROTTLE_MS) {
        rafId = requestAnimationFrame(tick);
        return;
    }
    
    if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        if(overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        drawFocusArea();
        
        let detected = false;
        
        try {
            if(barcodeDetector) {
                const focusCanvas = getFocusAreaBitmap();
                const bitmap = await createImageBitmap(focusCanvas);
                const results = await barcodeDetector.detect(bitmap);
                
                if(results && results.length > 0) {
                    const bestResult = results[0];
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
            drawFocusArea(); 
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

    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fill();
}

function clearOverlay() {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

let lastSeen = null;
async function handleResult(text, type) {
    if (!text) return;
    const now = new Date();

    if (lastSeen && lastSeen.text === text && (now - lastSeen.time) < 2000) return;
    lastSeen = { text: text, time: now };
    
    lastResult.textContent = text;
    status.textContent = 'Detected!';
    status.style.color = '#00ff00';

    setTimeout(() => {
        if(scanning) {
            status.textContent = 'Scanning...';
            status.style.color = '';
        }
    }, 1000);

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    const snapCtx = snapshotCanvas.getContext('2d');
    snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const snapshotData = snapshotCanvas.toDataURL('image/jpeg', 0.8);

    await saveLogItem({
        text: text,
        type: type,
        snapshot: snapshotData
    });

    playTapAudio(text);

    if (autoCopy.checked && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(e => console.log('Clipboard error:', e));
    }

    if (/^https?:\/\//i.test(text)) {
        window.open(text, '_blank', 'noopener,noreferrer');
    }
}

async function playTapAudio(text) {
    const today = new Date().toLocaleDateString();
    const existingEntry = await getRecordByTextAndDate(text, today);
    
    try {
        if (existingEntry && existingEntry.logIn && !existingEntry.logOut) {

            secondTapAudio.currentTime = 0;
            secondTapAudio.play().catch(e => console.log('Second tap audio play failed:', e));
        } else {

            firstTapAudio.currentTime = 0;
            firstTapAudio.play().catch(e => console.log('First tap audio play failed:', e));
        }
    } catch (e) {
        console.log('Audio error:', e);
    }
}

async function saveLogItem(data) {
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();
    const timestamp = Date.now();

    const text = (data.text || "").trim();
    let eid = "";
    let name = "";

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

    const existing = await getRecordByTextAndDate(text, today);

    if (!existing) {
        const filename = generateSnapshotFilename(eid, name, timestamp, false);
        const savedFilename = await saveSnapshotToDisk(data.snapshot, filename);
        
        const entry = {
            text: data.text,
            type: data.type,
            eid: eid,
            name: name,
            date: today,
            logIn: now,
            logOut: '',
            filename: savedFilename, 
            timestamp: timestamp
        };
        await addRecord(entry);
    } else {
        const filename = generateSnapshotFilename(eid, name, timestamp, true);
        const savedFilename = await saveSnapshotToDisk(data.snapshot, filename);
        
        await updateRecord(existing.id, {
            logOut: now,
            filename: savedFilename, 
            timestamp: timestamp
        });
    }

    renderLog();
}

async function renderLog() {
    const recentScans = await getRecords(10);
    const totalCount = await getRecordsCount();

    const logCounter = document.getElementById('logCounter') || createLogCounter();

    const hasFileAccess = await checkDirectoryPermission();
    const accessStatus = hasFileAccess ? '✓ Disk Storage' : '⚠ Request Folder Access';
    
    logCounter.textContent = `Recent: ${recentScans.length} | Total: ${totalCount} | ${accessStatus}`;

    logEl.innerHTML = recentScans.map(item => {
        const hasFile = item.filename && item.filename !== 'null';
        return `
        <div class="entry">
            <div style="margin-bottom: 6px;">
                ${item.eid ? `<strong>EID: ${escapeHtml(item.eid)}</strong>` : ''}
                ${item.name ? `<br><strong>Name: ${escapeHtml(item.name)}</strong>` : ''}
            </div>
            
            <small>
                Date: ${item.date} • 
                Log In: ${item.logIn} • 
                Log Out: ${item.logOut || '—'}
                ${hasFile ? `<br>📁 File: ${escapeHtml(item.filename)}` : '<br>⚠ File not saved'}
            </small>
        </div>
    `}).join('');
}

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

function addFolderAccessButton() {
    const controls = document.querySelector('.controls');
    const folderBtn = document.createElement('button');
    folderBtn.id = 'folderAccessBtn';
    folderBtn.textContent = '📁 Choose Snapshot Folder';
    folderBtn.style.marginLeft = '10px';
    
    folderBtn.addEventListener('click', async () => {
        const granted = await requestDirectoryPermission();
        if (granted) {
            alert('Folder access granted! Snapshots will be saved automatically.');
            renderLog();
        } else {
            alert('Please allow folder access to save snapshots to your disk.');
        }
    });
    
    controls.appendChild(folderBtn);
}

fileInput.addEventListener('change', handleFileUpload);
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
clearLogBtn.addEventListener('click', clearLog);

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

async function clearLog() {
    if(confirm('Clear ALL attendance data? This will remove all records from the database.')) {
        await clearAllRecords();
        renderLog();
    }
}

async function initialize() {
    await initDB();
    addFolderAccessButton();
    await checkDirectoryPermission(); 
    renderLog();
}

initialize();
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', stopCamera);
