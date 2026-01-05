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
      clearLogBtn=document.getElementById('clearLog'),
      logTypeSelect=document.getElementById('logTypeSelect');

// Admin system variables
const adminToggle = document.getElementById('adminToggle');
const adminLoginModal = document.getElementById('adminLoginModal');
const adminUsername = document.getElementById('adminUsername');
const adminPassword = document.getElementById('adminPassword');
const adminLoginSubmit = document.getElementById('adminLoginSubmit');
const adminLoginCancel = document.getElementById('adminLoginCancel');
const viewLogBtn = document.getElementById('viewLogBtn');

// Admin credentials (in production, use proper authentication)
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'admin123' // Change this in production
};

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

// Audio files for login/logout
const logoutAudio = new Audio('ingat.mp3');      // For logout (time out)
const loginAudio = new Audio('loginSucc.mp3');   // For login (time in)

// Set audio properties
logoutAudio.preload = 'auto';
loginAudio.preload = 'auto';
logoutAudio.volume = 1.0;
loginAudio.volume = 1.0;

// Notification System Function - ADD THIS AT TOP LEVEL
function showNotification(message, type = 'success') {
    // Remove any existing notification
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // Add icon based on type
    let icon = '✓';
    if (type === 'error') icon = '✗';
    else if (type === 'info') icon = 'ℹ';
    else if (type === 'warning') icon = '⚠';
    
    notification.innerHTML = `<span class="notification-icon">${icon}</span> ${message}`;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : type === 'info' ? '#2196F3' : '#ff9800'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: 10px;
        opacity: 0;
        transform: translateX(100px);
        transition: opacity 0.3s, transform 0.3s;
        max-width: 350px;
        word-break: break-word;
        cursor: pointer;
        border-left: 4px solid ${type === 'success' ? '#2E7D32' : type === 'error' ? '#c62828' : type === 'info' ? '#1565C0' : '#ef6c00'};
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    });
}

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
            if (cursor) {
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

        showNotification('Camera started', 'info');
        tick();
        
    } catch(e) {
        console.error('Camera error:', e);
        status.textContent = 'Camera unavailable';
        showNotification('Camera unavailable', 'error');

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
            showNotification('Camera started (fallback mode)', 'info');
            tick();
        } catch(fallbackError) {
            showNotification('Unable to access camera', 'error');
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
    showNotification('Camera stopped', 'info');
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

    if (/^https?:\/\//i.test(text)) {
        window.open(text, '_blank', 'noopener,noreferrer');
    }
}

async function saveLogItem(data) {
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();
    const timestamp = Date.now();

    const text = (data.text || "").trim();
    let eid = "";
    let name = "";

    // Parse EID and Name
    if (text.match(/^\d+\s*[-:]\s*[A-Za-z]/)) {
        const parts = text.split(/[-:]/);
        eid = parts[0].trim();
        name = parts[1] ? parts[1].trim() : "";
    } else if (text.match(/[A-Za-z].*[-:]\s*\d+$/)) {
        const parts = text.split(/[-:]/);
        name = parts[0].trim();
        eid = parts[1] ? parts[1].trim() : "";
    } else if (/[A-Za-z]/.test(text) && !/\d{6,}/.test(text)) {
        name = text;
    } else if (/^\d+$/.test(text)) {
        eid = text;
        name = "";
    } else {
        name = text;
    }

    // Determine log type
    const userChoice = logTypeSelect.value; // auto / login / logout
    
    // Get all records for today for this person (by text or eid)
    const allRecords = await getAllRecords();
    const todayRecords = allRecords.filter(r => r.date === today && 
        (r.text === text || r.eid === eid || (r.name && r.name === name)));
    
    let existingRecord = null;
    let latestRecord = null;
    
    if (todayRecords.length > 0) {
        // Find the most recent record for today
        latestRecord = todayRecords.reduce((latest, current) => {
            return (current.timestamp > latest.timestamp) ? current : latest;
        });
        
        // Check if there's an exact text match
        existingRecord = todayRecords.find(r => r.text === text);
        if (!existingRecord && latestRecord) {
            existingRecord = latestRecord;
        }
    }

    let isLogin = true; // default
    
    if(userChoice === 'login') {
        isLogin = true; // Force login
    } else if(userChoice === 'logout') {
        isLogin = false; // Force logout
    } else {
        // AUTO MODE LOGIC: Alternates between login and logout
        if (latestRecord) {
            // If latest record has logIn but no logOut → time for logout
            if (latestRecord.logIn && !latestRecord.logOut) {
                isLogin = false; // Time out
            } 
            // If latest record has logOut → time for new login
            else if (latestRecord.logOut) {
                isLogin = true; // Time in
            }
            // If latest record has only logOut (no logIn) → time for login
            else if (!latestRecord.logIn && latestRecord.logOut) {
                isLogin = true; // Time in
            }
            // Fallback: if unclear, alternate
            else {
                isLogin = true; // Default to time in
            }
        } else {
            // No record for today → start with login
            isLogin = true;
        }
    }

    const filename = generateSnapshotFilename(eid, name, timestamp, !isLogin);
    const savedFilename = await saveSnapshotToDisk(data.snapshot, filename);

    if(isLogin) {
        // Log In → create new record
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
        
        // Show success notification
        const displayName = name || eid || text;
        showNotification(`✓ ${displayName} - Time In Successful!`, 'success');
        
        // Play LOGIN sound (loginSucc.mp3)
        console.log('Playing login audio (loginSucc.mp3)');
        loginAudio.currentTime = 0;
        loginAudio.play().catch(e => {
            console.log('Login audio play failed:', e);
            if (e.name === 'NotAllowedError') {
                console.log('Audio blocked. Click "Start camera" button first.');
            }
        });
    } else {
        // Log Out → update last record
        if(latestRecord) {
            await updateRecord(latestRecord.id, {
                logOut: now,
                filename: savedFilename, 
                timestamp: timestamp
            });
            
            // Show success notification
            const displayName = latestRecord.name || latestRecord.eid || latestRecord.text;
            showNotification(`✓ ${displayName} - Time Out Successful!`, 'success');
            
            // Play LOGOUT sound (ingat.mp3)
            console.log('Playing logout audio (ingat.mp3)');
            logoutAudio.currentTime = 0;
            logoutAudio.play().catch(e => {
                console.log('Logout audio play failed:', e);
                if (e.name === 'NotAllowedError') {
                    console.log('Audio blocked. Click "Start camera" button first.');
                }
            });
        } else {
            // If no existing record, fallback → create new row as logOut only
            const entry = {
                text: data.text,
                type: data.type,
                eid: eid,
                name: name,
                date: today,
                logIn: '',
                logOut: now,
                filename: savedFilename, 
                timestamp: timestamp
            };
            await addRecord(entry);
            
            // Show info notification (first entry of the day as time out)
            const displayName = name || eid || text;
            showNotification(`ℹ ${displayName} - First Entry Today Recorded as Time Out`, 'info');
            
            // Play LOGIN sound for new entry (since it's a first entry)
            console.log('Playing login audio for first entry (loginSucc.mp3)');
            loginAudio.currentTime = 0;
            loginAudio.play().catch(e => {
                console.log('Login audio play failed:', e);
                if (e.name === 'NotAllowedError') {
                    console.log('Audio blocked. Click "Start camera" button first.');
                }
            });
        }
    }

    renderLog();
}

async function getAllRecords() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    const results = [];
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

async function renderLog() {
    // Remove the limit parameter to get ALL records instead of just 10
    const recentScans = await getRecords(); // Changed from getRecords(10) to getRecords()
    const totalCount = await getRecordsCount();

    const logCounter = document.getElementById('logCounter') || createLogCounter();

    const hasFileAccess = await checkDirectoryPermission();
    const accessStatus = hasFileAccess ? '✓ Disk Storage' : '⚠ Request Folder Access';
    
    // Update counter to show all records count
    logCounter.textContent = `Showing: ${recentScans.length} records | Total: ${totalCount} | ${accessStatus}`;

    // Clear the log element
    logEl.innerHTML = '';
    
    // Check if there are no records
    if (recentScans.length === 0) {
        logEl.innerHTML = `
            <div class="entry" style="text-align: center; color: #aaa; padding: 20px;">
                <strong>No attendance records found</strong><br>
                <small>Scan a QR code to get started</small>
            </div>
        `;
        return;
    }
    
    // Display ALL records
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
                Log Out: ${item.logOut || '—'} •
                Type: ${item.type || 'scan'}
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
            showNotification('✓ Folder access granted! Snapshots will be saved automatically.', 'success');
            renderLog();
        } else {
            showNotification('⚠ Please allow folder access to save snapshots to your disk.', 'warning');
        }
    });
    
    controls.appendChild(folderBtn);
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

fileInput.addEventListener('change', handleFileUpload);
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

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
            showNotification('No QR code found in image', 'error');
        }
    };
    img.onerror = () => showNotification('Invalid image file', 'error');
    img.src = URL.createObjectURL(file);
}

// Update mode display in lower left corner
// Update mode display in lower left corner
function updateModeDisplay() {
    const selectedMode = logTypeSelect.value; // 'auto', 'login', or 'logout'
    const modeText = document.getElementById('modeText');
    
    if (modeText) {
        // Remove all mode classes
        modeText.classList.remove('auto', 'login', 'logout');
        
        // Add current mode class
        modeText.classList.add(selectedMode);
        
        // Update text
        if (selectedMode === 'auto') {
            modeText.textContent = 'AUTO';
        } else if (selectedMode === 'login') {
            modeText.textContent = 'LOG IN';
        } else if (selectedMode === 'logout') {
            modeText.textContent = 'LOG OUT';
        }
    }
    
    // Show notification for mode change
    if (selectedMode === 'auto') {
        showNotification('Mode set to Auto', 'info');
    } else if (selectedMode === 'login') {
        showNotification('Mode set to Log In Only', 'info');
    } else if (selectedMode === 'logout') {
        showNotification('Mode set to Log Out Only', 'info');
    }
    
    // Also update status briefly
    status.textContent = `Mode set to ${selectedMode === 'auto' ? 'Auto' : selectedMode === 'login' ? 'Log In' : 'Log Out'}`;
    status.style.color = selectedMode === 'auto' ? '' : selectedMode === 'login' ? '#4CAF50' : '#f44336';
    
    // Temporarily show mode, then revert if scanning
    setTimeout(() => {
        if (scanning) {
            status.textContent = 'Scanning...';
            status.style.color = '';
        } else {
            status.textContent = 'Camera is Off';
            status.style.color = '';
        }
    }, 2000);
}
// Call this when mode changes
logTypeSelect.addEventListener('change', updateModeDisplay);

function initAudio() {
    // Create a silent audio context to unlock audio on user interaction
    const unlockAudio = () => {
        // Play a silent sound to unlock audio
        const silentAudio = new Audio();
        silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        silentAudio.volume = 0;
        
        silentAudio.play().then(() => {
            console.log('Audio unlocked');
            silentAudio.pause();
        }).catch(e => {
            console.log('Audio unlock failed:', e);
        });
        
        // Remove event listeners after first interaction
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    
    // Add event listeners for user interaction
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
    
    // Also unlock when clicking any button
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('click', unlockAudio, { once: true });
    });
}

// Check if user is logged in as admin
function isAdminLoggedIn() {
  return localStorage.getItem('adminLoggedIn') === 'true';
}

// Update admin UI based on login state
function updateAdminUI() {
  const isAdmin = isAdminLoggedIn();
  
  if (isAdmin) {
    // Show admin buttons
    viewLogBtn.style.display = 'inline-flex';
    clearLogBtn.style.display = 'inline-block';
    adminToggle.textContent = 'Admin Logout';
    adminToggle.style.background = 'linear-gradient(135deg, #f44336 0%, #c62828 100%)';
  } else {
    // Hide admin buttons
    viewLogBtn.style.display = 'none';
    clearLogBtn.style.display = 'none';
    adminToggle.textContent = 'Admin Login';
    adminToggle.style.background = 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)';
  }
}

// Show admin login modal
function showAdminLogin() {
  adminUsername.value = '';
  adminPassword.value = '';
  adminLoginModal.style.display = 'flex';
  adminUsername.focus();
}

// Hide admin login modal
function hideAdminLogin() {
  adminLoginModal.style.display = 'none';
}

// Handle admin login
function handleAdminLogin() {
  const username = adminUsername.value.trim();
  const password = adminPassword.value.trim();
  
  if (!username || !password) {
    showNotification('Please enter username and password', 'error');
    return;
  }
  
  // Check credentials (in production, use server-side validation)
  if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
    // Login successful
    localStorage.setItem('adminLoggedIn', 'true');
    hideAdminLogin();
    updateAdminUI();
    
    // Show success notification
    showNotification('✓ Admin login successful', 'success');
  } else {
    showNotification('Invalid username or password', 'error');
    adminPassword.value = '';
    adminPassword.focus();
  }
}

// Handle admin logout
function handleAdminLogout() {
  if (confirm('Are you sure you want to logout from admin?')) {
    localStorage.setItem('adminLoggedIn', 'false');
    updateAdminUI();
    
    // Show logout notification
    showNotification('Admin logged out', 'info');
  }
}

// Initialize admin system
function initAdminSystem() {
  // Check initial login state
  updateAdminUI();
  
  // Admin toggle button click
  adminToggle.addEventListener('click', () => {
    if (isAdminLoggedIn()) {
      handleAdminLogout();
    } else {
      showAdminLogin();
    }
  });
  
  // Admin login submit
  adminLoginSubmit.addEventListener('click', handleAdminLogin);
  
  // Admin login cancel
  adminLoginCancel.addEventListener('click', hideAdminLogin);
  
  // Handle Enter key in admin login
  adminUsername.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAdminLogin();
    }
  });
  
  adminPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAdminLogin();
    }
  });
  
  // Close modal when clicking outside
  adminLoginModal.addEventListener('click', (e) => {
    if (e.target === adminLoginModal) {
      hideAdminLogin();
    }
  });
}

async function clearLog() {
  if(confirm('Clear ALL attendance data? This will remove all records from the database.')) {
    await clearAllRecords();
    renderLog();
    showNotification('All attendance records cleared', 'warning');
  }
}

clearLogBtn.addEventListener('click', clearLog);

async function initialize() {
    await initDB();
    addFolderAccessButton();
    await checkDirectoryPermission(); 
    renderLog();
    initAdminSystem();
    initAudio(); // Initialize audio system
    
    // Initialize mode display
    setTimeout(updateModeDisplay, 100);
}

initialize();
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', stopCamera);
