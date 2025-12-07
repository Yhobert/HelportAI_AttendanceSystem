const DB_NAME = 'AttendanceDB';
const DB_VERSION = 2;
const STORE_NAME = 'attendance';
let db = null;

const attendanceTableContainer = document.getElementById('attendanceTableContainer');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

// IndexedDB initialization
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
                store.createIndex('filename', 'filename', { unique: false });
                store.createIndex('logIn', 'logIn', { unique: false });
            }
        };
    });
}

// Get all records from database
async function getAllRecords() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        // Use timestamp index to get records in chronological order
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'next'); // Change from 'prev' to 'next' for chronological order
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

// Clear all records
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

async function loadAttendanceData() {
    const log = await getAllRecords();
    
    if (log.length === 0) {
        attendanceTableContainer.innerHTML = `
            <div class="no-data">
                <h3>No attendance data found</h3>
                <p>Scan some QR codes to populate the attendance log.</p>
                <p><small>Snapshots are automatically saved to your local disk</small></p>
            </div>
        `;
        return;
    }

    // Show storage info
    const storageInfo = document.getElementById('storageInfo') || createStorageInfo();
    
    // Count files saved to disk
    const filesSaved = log.filter(record => record.filename && record.filename !== 'null').length;
    storageInfo.textContent = `Database: ${log.length} records | Files saved to disk: ${filesSaved}`;

    // Group by date and then create entries in chronological order
    const groupedData = {};
    
    // First, sort all records by timestamp (chronological order)
    const sortedLog = log.sort((a, b) => {
        // Use the timestamp for sorting if available
        if (a.timestamp && b.timestamp) {
            return new Date(a.timestamp) - new Date(b.timestamp);
        }
        // Fallback to date and time comparison
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        
        // If same date, compare times
        return compareTimeStrings(a.logIn || a.logOut, b.logIn || b.logOut);
    });

    // Process records in chronological order
    sortedLog.forEach(entry => {
        if (!groupedData[entry.date]) {
            groupedData[entry.date] = [];
        }
        
        // Find if this person already has an entry for this date
        const existingEntryIndex = groupedData[entry.date].findIndex(
            e => e.eid === entry.eid && e.name === entry.name
        );
        
        if (existingEntryIndex === -1) {
            // New entry
            groupedData[entry.date].push({
                name: entry.name,
                eid: entry.eid,
                logIn: entry.logIn,
                logOut: entry.logOut || '',
                date: entry.date,
                filename: entry.filename,
                timestamp: entry.timestamp,
                totalHours: '—'
            });
        } else {
            // Update existing entry
            const existingEntry = groupedData[entry.date][existingEntryIndex];
            
            // If this is a login and we don't have one yet, set it
            if (entry.logIn && !existingEntry.logIn) {
                existingEntry.logIn = entry.logIn;
                existingEntry.timestamp = entry.timestamp;
            }
            
            // If this is a logout, update it (should be chronologically later than login)
            if (entry.logOut) {
                existingEntry.logOut = entry.logOut;
                existingEntry.filename = entry.filename;
            }
            
            // Update timestamp if this record is newer
            if (entry.timestamp && existingEntry.timestamp) {
                if (new Date(entry.timestamp) > new Date(existingEntry.timestamp)) {
                    existingEntry.timestamp = entry.timestamp;
                }
            }
        }
    });

    // Calculate total hours for each entry
    Object.keys(groupedData).forEach(date => {
        groupedData[date].forEach(entry => {
            if (entry.logIn && entry.logOut) {
                entry.totalHours = calculateTotalHours(entry.logIn, entry.logOut);
            }
        });
        
        // Sort entries within each date by time (chronologically)
        groupedData[date].sort((a, b) => {
            // Compare by login time first
            if (a.logIn && b.logIn) {
                return compareTimeStrings(a.logIn, b.logIn);
            }
            // If no login time, compare by timestamp
            if (a.timestamp && b.timestamp) {
                return new Date(a.timestamp) - new Date(b.timestamp);
            }
            return 0;
        });
    });

    // Create table HTML
    let tableHTML = `
        <table class="attendance-table">
            <thead>
                <tr>
                    <th class="time-column">Time</th>
                    <th class="name-column">Name</th>
                    <th class="eid-column">EID</th>
                    <th class="time-column">Log In</th>
                    <th class="time-column">Log Out</th>
                    <th class="hours-column">Total Hours</th>
                    <th class="file-column" style="width: 100px; text-align: center;">File Saved</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Sort dates in descending order (most recent first)
    const sortedDates = Object.keys(groupedData).sort((a, b) => new Date(b) - new Date(a));
    
    sortedDates.forEach(date => {
        // Add date header
        tableHTML += `
            <tr style="background: rgba(6, 182, 212, 0.1);">
                <td colspan="7" style="font-weight: bold; text-align: center;">
                    📅 ${date}
                </td>
            </tr>
        `;
        
        const dayEntries = groupedData[date];
        
        dayEntries.forEach(entry => {
            const hasFile = entry.filename && entry.filename !== 'null';
            // Determine if this is login or logout event for time display
            const eventTime = entry.logIn || entry.logOut || '—';
            
            tableHTML += `
                <tr>
                    <td class="time-column">${eventTime}</td>
                    <td class="name-column">${escapeHtml(entry.name || '—')}</td>
                    <td class="eid-column">${escapeHtml(entry.eid || '—')}</td>
                    <td class="time-column">${entry.logIn || '—'}</td>
                    <td class="time-column">${entry.logOut || '—'}</td>
                    <td class="hours-column ${entry.totalHours && entry.totalHours !== '—' ? 'total-hours' : ''}">
                        ${entry.totalHours || '—'}
                    </td>
                    <td class="file-column" style="text-align: center;">
                        ${hasFile ? '✅' : '❌'}
                    </td>
                </tr>
            `;
        });
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    attendanceTableContainer.innerHTML = tableHTML;
}

// Helper function to compare time strings
function compareTimeStrings(timeA, timeB) {
    if (!timeA || !timeB) return 0;
    
    const parseTime = (timeStr) => {
        const [time, period] = timeStr.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        
        if (period === 'PM' && hours < 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        return hours * 60 + minutes;
    };
    
    return parseTime(timeA) - parseTime(timeB);
}

function createStorageInfo() {
    const info = document.createElement('div');
    info.id = 'storageInfo';
    info.style.cssText = 'text-align: center; margin: 10px 0; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 5px; font-size: 12px;';
    attendanceTableContainer.parentNode.insertBefore(info, attendanceTableContainer);
    return info;
}

function calculateTotalHours(logIn, logOut) {
    if (!logIn || !logOut) return '';
    
    try {
        // Parse times (assuming format like "10:00:00 AM")
        const inTime = parseTimeString(logIn);
        const outTime = parseTimeString(logOut);
        
        if (!inTime || !outTime) return '';
        
        let diffMs = outTime - inTime;
        
        // If out time is earlier than in time, assume next day
        if (diffMs < 0) {
            diffMs += 24 * 60 * 60 * 1000; // Add 24 hours
        }
        
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours.toFixed(2);
    } catch (error) {
        console.error('Error calculating hours:', error);
        return '';
    }
}

function parseTimeString(timeStr) {
    if (!timeStr) return null;
    
    try {
        // Remove seconds if present and handle AM/PM
        const timeParts = timeStr.split(' ');
        let time = timeParts[0];
        const period = timeParts[1];
        
        let [hours, minutes] = time.split(':').map(Number);
        
        if (period === 'PM' && hours < 12) {
            hours += 12;
        } else if (period === 'AM' && hours === 12) {
            hours = 0;
        }
        
        // Create a date object with today's date and the parsed time
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
    } catch (error) {
        console.error('Error parsing time:', error);
        return null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function exportToCSV() {
    const log = await getAllRecords();
    
    if (log.length === 0) {
        alert('No data to export');
        return;
    }
    
    // Sort data chronologically
    const sortedLog = log.sort((a, b) => {
        if (a.timestamp && b.timestamp) {
            return new Date(a.timestamp) - new Date(b.timestamp);
        }
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return compareTimeStrings(a.logIn || a.logOut, b.logIn || b.logOut);
    });
    
    // CSV headers
    const csvRows = ['Timestamp,Date,Time,Name,EID,Log In,Log Out,Total Hours,File Saved'];
    
    sortedLog.forEach(entry => {
        const eventTime = entry.logIn || entry.logOut || '';
        const fileStatus = entry.filename && entry.filename !== 'null' ? 'Yes' : 'No';
        let totalHours = '';
        
        if (entry.logIn && entry.logOut) {
            totalHours = calculateTotalHours(entry.logIn, entry.logOut);
        }
        
        const row = [
            `"${entry.timestamp || ''}"`,
            `"${entry.date}"`,
            `"${eventTime}"`,
            `"${(entry.name || '').replace(/"/g, '""')}"`,
            `"${(entry.eid || '').replace(/"/g, '""')}"`,
            `"${entry.logIn || ''}"`,
            `"${entry.logOut || ''}"`,
            `"${totalHours}"`,
            `"${fileStatus}"`
        ].join(',');
        
        csvRows.push(row);
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

async function clearAllData() {
    if (confirm('Are you sure you want to clear ALL attendance data? This cannot be undone.')) {
        await clearAllRecords();
        loadAttendanceData();
        alert('All attendance data has been cleared.');
    }
}

// Event listeners
refreshBtn.addEventListener('click', loadAttendanceData);
exportBtn.addEventListener('click', exportToCSV);
clearBtn.addEventListener('click', clearAllData);

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    loadAttendanceData();
});
