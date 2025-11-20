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
const LOG_KEY='qr-scanner-log-v3';

// YOUR AUDIO FILES - will play automatically on scan
const firstTapAudio = new Audio('ingat.mp3'); // First tap audio file
const secondTapAudio = new Audio('loginSucc.mp3'); // Second tap audio file

// Optional: Preload audio files
firstTapAudio.preload = 'auto';
secondTapAudio.preload = 'auto';

async function initBarcodeDetector(){
    if('BarcodeDetector' in window){
        const f = await window.BarcodeDetector.getSupportedFormats().catch(()=>[]);
        if(f.includes('qr_code')) barcodeDetector = new BarcodeDetector({formats:['qr_code']});
    }
    if(!barcodeDetector) await loadJsQR();
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
    const f = facingSelect.value || 'environment';
    try{
        stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:f}});
        video.srcObject = stream;
        await video.play();
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 360;
        scanning = true;
        status.textContent='Scanning...';
        tick();
    }catch(e){
        status.textContent='Camera unavailable';
        alert('Unable to access camera');
    }
}

function stopCamera(){
    scanning=false;
    status.textContent='Camera is Off';
    if(rafId) cancelAnimationFrame(rafId);
    if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null;}
    ctx.clearRect(0,0,overlay.width,overlay.height);
}

async function tick(){
    if(!scanning) return;
    if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA){
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        ctx.drawImage(video,0,0,overlay.width,overlay.height);

        if(barcodeDetector){
            try{
                const b = await createImageBitmap(overlay);
                const r = await barcodeDetector.detect(b);
                if(r && r.length){drawBoxes(r.map(e=>e.boundingBox)); handleResult(r[0].rawValue,'camera');}
                else clearOverlay();
                b.close();
            }catch(err){if(!fallbackJsQR) await loadJsQR();}
        } else if(fallbackJsQR){
            const i = ctx.getImageData(0,0,overlay.width,overlay.height);
            const c = fallbackJsQR(i.data,i.width,i.height);
            if(c){drawPolygon(c.location); handleResult(c.data,'camera');} else clearOverlay();
        }
    }
    rafId=requestAnimationFrame(tick);
}

function drawBoxes(b){ctx.strokeStyle='#00ffcc'; ctx.lineWidth=Math.max(2,overlay.width/400); b.forEach(x=>{ctx.beginPath(); ctx.rect(x.x,x.y,x.width,x.height); ctx.stroke();});}
function drawPolygon(l){ctx.strokeStyle='#00ffcc'; ctx.lineWidth=Math.max(2,overlay.width/400); ctx.beginPath(); ctx.moveTo(l.topLeftCorner.x,l.topLeftCorner.y); ctx.lineTo(l.topRightCorner.x,l.topRightCorner.y); ctx.lineTo(l.bottomRightCorner.x,l.bottomRightCorner.y); ctx.lineTo(l.bottomLeftCorner.x,l.bottomLeftCorner.y); ctx.closePath(); ctx.stroke();}
function clearOverlay(){ctx.clearRect(0,0,overlay.width,overlay.height);}

let lastSeen=null;
function handleResult(t, type) {
    if (!t) return;
    const now = new Date();

    if (lastSeen && lastSeen.text === t && (now - lastSeen.time) < 2500) return;
    lastSeen = { text: t, time: now };
    lastResult.textContent = t;
    status.textContent = 'Detected';

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    const snapCtx = snapshotCanvas.getContext('2d');
    snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const snapshotData = snapshotCanvas.toDataURL('image/jpeg', 0.9);

    saveLogItem({
        text: t,
        type: type,
        snapshot: snapshotData
    });

    // ALWAYS play appropriate audio based on whether it's first or second tap
    playTapAudio(t);

    if (autoCopy.checked && navigator.clipboard) {
        navigator.clipboard.writeText(t);
    }

    if (autoOpen.checked && /^https?:\/\//i.test(t)) {
        window.open(t, '_blank');
    }
}

function playTapAudio(text) {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const today = new Date().toLocaleDateString();
    
    // Check if this is first tap (log in) or second tap (log out)
    const existingEntry = log.find(e => e.text === text && e.date === today);
    
    try {
        if (existingEntry && existingEntry.logIn && !existingEntry.logOut) {
            // Second tap (log out) - play second tap audio
            secondTapAudio.currentTime = 0;
            secondTapAudio.play().catch(e => console.log('Second tap audio play failed:', e));
        } else {
            // First tap (log in) - play first tap audio
            firstTapAudio.currentTime = 0;
            firstTapAudio.play().catch(e => console.log('First tap audio play failed:', e));
        }
    } catch (e) {
        console.log('Audio error:', e);
    }
}

function saveLogItem(d) {
    let log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const today = new Date().toLocaleDateString();
    const now = new Date().toLocaleTimeString();

    let existing = log.find(e => e.text === d.text && e.date === today);

    const text = (d.text || "").trim();
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

    if (!existing) {
        const entry = {
            ...d,
            date: today,
            logIn: now,
            logOut: '',
            timestamp: Date.now()
        };
        log.unshift(entry);
    } else {
        existing.logOut = now;
        existing.snapshot = d.snapshot;
        existing.timestamp = Date.now();
    }

    log.sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));

    renderLog();
}

function renderLog() {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.sort((a, b) => b.timestamp - a.timestamp);

    logEl.innerHTML = log.map(i => `
        <div class="entry">
            <div><strong>${escapeHtml(i.text)}</strong></div>
            ${i.snapshot ? `<img src="${i.snapshot}" alt="snapshot" style="width:100%;border-radius:8px;margin-top:6px;">` : ''}
            <small>Date: ${i.date} • Log In: ${i.logIn} • Log Out: ${i.logOut || '—'} • ${i.type}</small>
        </div>
    `).join('');
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

fileInput.addEventListener('change', async e=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const img = new Image();
    img.onload = async ()=>{
        overlay.width = img.naturalWidth; overlay.height = img.naturalHeight;
        ctx.drawImage(img,0,0,overlay.width,overlay.height);
        if(!barcodeDetector && !fallbackJsQR) await loadJsQR();
        if(barcodeDetector){
            try{
                const b = await createImageBitmap(overlay);
                const r = await barcodeDetector.detect(b);
                if(r && r.length) handleResult(r[0].rawValue,'image'); else alert('No QR found'); b.close();
            }catch(e){}
        } else if(fallbackJsQR){
            const d = ctx.getImageData(0,0,overlay.width,overlay.height);
            const c = fallbackJsQR(d.data,d.width,d.height);
            if(c) handleResult(c.data,'image'); else alert('No QR found');
        }
    };
    img.onerror=()=>alert('Invalid image');
    img.src=URL.createObjectURL(f);
});

startBtn.addEventListener('click',startCamera);
stopBtn.addEventListener('click',stopCamera);
clearLogBtn.addEventListener('click',()=>{localStorage.removeItem(LOG_KEY); renderLog();});
exportCsvBtn.addEventListener('click', () => {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (!log.length) {
        alert('No entries');
        return;
    }

    const csvRows = ['EID,Name,Date,Log In,Log Out,Type'];

    log.forEach(r => {
        let name = '';
        let eid = '';

        const text = r.text || '';
        if (text.includes('-')) {
            [eid, name] = text.split('-').map(x => x.trim());
        } else if (text.includes(',')) {
            [name, eid] = text.split(',').map(x => x.trim());
        } else {
            name = text.trim();
        }

        const row = [
            `"${name.replace(/"/g, '""')}"`,
            `"${eid.replace(/"/g, '""')}"`,
            `"${r.date}"`,
            `"${r.logIn}"`,
            `"${r.logOut}"`,
            `"${r.type}"`
        ].join(',');

        csvRows.push(row);
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance-log.csv';
    a.click();
    URL.revokeObjectURL(url);
});

renderLog();
window.addEventListener('pagehide',()=>stopCamera());
