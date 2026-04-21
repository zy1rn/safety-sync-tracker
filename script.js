// --- GLOBAL VARIABLES ---
let countdown;
let endTime;
let sirenAudio = new Audio('siren.mp3');
let isAlertActive = false; 
let heartbeatInterval; 

// Path & Map variables
let pathCoordinates = []; 
let travelPath; 
let db; 

const settingsBtn = document.getElementById('settings-btn');

// 1. FIREBASE INITIALIZATION
const firebaseConfig = {
    apiKey: "AIzaSyAG_E5aduSJ4_LfYMyo8Lw2MCBCGFP-MKs",
    authDomain: "safety-sync-efb60.firebaseapp.com",
    projectId: "safety-sync-efb60",
    storageBucket: "safety-sync-efb60.firebasestorage.app",
    messagingSenderId: "498372373785",
    appId: "1:498372373785:web:5ea393a85b55a5499da988",
    measurementId: "G-5YELE70MVR"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

// 2. INDEXED DB
const idbRequest = indexedDB.open("SafetySyncDB", 1);
idbRequest.onupgradeneeded = (e) => {
    let database = e.target.result;
    if (!database.objectStoreNames.contains("path")) {
        database.createObjectStore("path", { autoIncrement: true });
    }
};
idbRequest.onsuccess = (e) => { 
    db = e.target.result; 
    console.log("📦 IndexedDB Ready");
};

function saveCoordLocally(coord) {
    if (!db) return;
    try {
        const tx = db.transaction("path", "readwrite");
        const store = tx.objectStore("path");
        store.add(coord);
        logDebug("Coord cached offline");
    } catch (e) { logDebug("DB Error: " + e.message); }
}

// 3. UI SYNC & INITIALIZATION (THE FIX)
function syncStartButton() {
    const tosCheck = document.getElementById('tos-check');
    const startBtn = document.getElementById('start-session-btn');
    if (!tosCheck || !startBtn) return;

    const isChecked = tosCheck.checked;
    startBtn.disabled = !isChecked;
    startBtn.style.opacity = isChecked ? "1" : "0.5";
    startBtn.style.cursor = isChecked ? "pointer" : "not-allowed";
    
    // Remove shake class if user finally checks it
    if (isChecked) startBtn.classList.remove('shake-error');
}

function attemptStart() {
    const tosCheck = document.getElementById('tos-check');
    const startBtn = document.getElementById('start-session-btn');

    if (!tosCheck || !tosCheck.checked) {
        startBtn.classList.add('shake-error');
        if (navigator.vibrate) navigator.vibrate(); 
        setTimeout(() => startBtn.classList.remove('shake-error'), 400);
        return;
    }
    startProtocol();
}

function saveSettings() {
    const val = document.getElementById('new-pin').value;
    if (val.length < 4) return alert("🚨 PIN must be 4 digits.");
    
    // Switch to localStorage so it stays after refresh
    localStorage.setItem('user_safe_pin', val); 
    alert("✅ PIN Saved Successfully.");
    toggleSettings();
}

function togglePinVisibility(inputId) {
    const pinField = document.getElementById(inputId);
    if (pinField) {
        pinField.type = pinField.type === "password" ? "text" : "password";
    }
}

// --- CORE PROTOCOL ---
async function startProtocol() {
    clearInterval(heartbeatInterval);
    clearInterval(countdown);

    const nameInput = document.getElementById('user-name-input'); 
    const currentUserName = nameInput ? nameInput.value.trim() : "Unknown Student";

    // 2. Save it to localStorage so it "sticks" for next time
    if (currentUserName !== "Unknown Student") {
        localStorage.setItem('safety_name', currentUserName);
    }

    const journeyId = "JNY-" + Date.now();

    

    // 3. VALIDATION
    if (!currentUserName || currentUserName === "Unknown Student") {
        alert("🚨 Please enter your name.");
        return;
    }


    const hrVal = parseInt(document.getElementById('input-hours').value) || 0;
    const minVal = parseInt(document.getElementById('input-mins').value) || 0;

    if (hrVal === 0 && minVal === 0) {
        alert("🚨 Set a duration first.");
        return;
    }

    const contactEmail = document.getElementById('contact-email')?.value.trim();
    if (!contactEmail || !contactEmail.includes('@')) {
        alert("🚨 Valid Emergency Email Required.");
        return;
    }

    // 1. THE HARD GATE: Check PIN first
    const storedPin = localStorage.getItem('user_safe_pin');
    if (!storedPin || storedPin === "") {
        alert("🚨 SECURITY ERROR: You must set a 4-digit PIN in Settings first!");
        toggleSettings(); // This opens the popup/area we created
        return; // 🔥 STOP THE CODE HERE
    }

    try {
        await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 });
        });
    } catch (e) {
        alert("🚨 GPS Permission Required.");
        return;
    }

    // 4. GET BATTERY (New Feature)
    let batteryLevel = "100%";
    try {
        const battery = await navigator.getBattery();
        batteryLevel = Math.round(battery.level * 100) + "%";
    } catch(e) { console.log("Battery API not supported"); }

    // Logic for UI Transition
    const actualStartTime = Date.now(); 
    const durationMs = (hrVal * 3600000) + (minVal * 60000);
    endTime = actualStartTime + durationMs;

    localStorage.setItem('safety_endTime', endTime);
    localStorage.setItem('safety_name', currentUserName);
    localStorage.setItem('safety_email', contactEmail);
    localStorage.setItem('current_journey_id', "JNY-" + actualStartTime);

    try {
        await firestore.collection("active_watches").doc(journeyId).set({
            userName: currentUserName,
            contact: contactEmail,
            status: "ON_WAY",
            expectedEndTime: endTime, // Dashboard uses this for the countdown
            lastKnownLocation: "Locating...",
            battery: batteryLevel,
            pathHistory: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showActiveUI();
        document.body.classList.add('timer-running');
        // 4. Start Local Timers
        countdown = setInterval(updateTimerDisplay, 1000);
        heartbeatInterval = setInterval(updateHeartbeatLocation, 60000);
        
    } catch (e) {
        alert("Cloud Sync Failed. Check Internet.");
        console.error(e);
    }

    updateHeartbeatLocation(); 
    heartbeatInterval = setInterval(updateHeartbeatLocation, 60000);
    countdown = setInterval(updateTimerDisplay, 1000);
}

// --- MONITORING ---
async function updateHeartbeatLocation() {
    const journeyId = localStorage.getItem('current_journey_id');
    if (!journeyId) return;


    navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // BUG FIX: Convert [lat, lng] to an Object {lat, lng}
        const newCoord = {
            lat: lat,
            lng: lng,
            timestamp: Date.now()
        };

        pathCoordinates.push([lat, lng]);

        try {
            // BUG FIX: Use 'arrayUnion' to add to the list without nesting arrays
            await firestore.collection("active_watches").doc(journeyId).update({
                lastKnownLocation: `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`,
                // This adds the new object to the pathHistory array in Firebase safely
                pathHistory: firebase.firestore.FieldValue.arrayUnion(newCoord),
                lastHeartbeat: firebase.firestore.FieldValue.serverTimestamp(),
                status: "ON_WAY" 
            });
            console.log("📡 Heartbeat Synced to Admin");
        } catch (e) {
            console.error("Sync Error:", e.message);
        }
    }, null, { enableHighAccuracy: true });
}

async function resolveJourney() {
    const journeyId = localStorage.getItem('current_journey_id');
    if (!journeyId) return;

    try {
        // 1. Delete the record from Firebase so the Admin Watchdog stops
        await firestore.collection("active_watches").doc(journeyId).delete();
        
        // 2. Clear local tracking
        localStorage.removeItem('safety_endTime');
        localStorage.removeItem('current_journey_id');
        clearInterval(heartbeatInterval);
        clearInterval(countdown);
        
        console.log("✅ Journey resolved and deleted from cloud.");
    } catch (e) {
        console.error("Error resolving journey:", e);
        alert("Sync Error: Journey could not be closed on the server.");
    }
}

async function checkSafe() {
    const inputPin = document.getElementById('pin-input').value;
    const storedPin = localStorage.getItem('user_safe_pin'); // Check localStorage

    if (inputPin === storedPin) {
        await resolveJourney(); 
        alert("✅ Safety Confirmed.");
        localStorage.removeItem('safety_endTime');
        location.reload(); 
    } else {
        alert("❌ Incorrect PIN!");
        if (navigator.vibrate) navigator.vibrate(500);
    }
}

async function triggerAlert() {
    if (isAlertActive) return; 
    isAlertActive = true;
    
    sirenAudio.loop = true;
    sirenAudio.play();
    document.getElementById('timer-display').innerText = "HELP!";

    document.body.classList.add('emergency-active');

    // Optional: Change the Heartbeat dot to red during emergency
    const dot = document.querySelector('.heartbeat-dot');
    if (dot) dot.style.backgroundColor = '#ff0033';
    
    // EmailJS & Cloud Alert Logic...
    logDebug("EMERGENCY PROTOCOL ACTIVATED");

    // 🔥 AUTOMATED HELP: Create an incident document for the Admin
    const name = localStorage.getItem('safety_name') || "Unknown User";
    try {
        await firestore.collection("incidents").add({
            userName: name,
            status: "EMERGENCY",
            location: "🚨 Timer Expired",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { console.error("Could not trigger cloud alert", e); }
}

function updateTimerDisplay() {
    const dist = endTime - Date.now();
    const display = document.getElementById('timer-display');

    if (dist <= 0) {
        clearInterval(countdown);
        display.innerText = "00:00:00";
        if (!isAlertActive) triggerAlert();
        return;
    }

    const h = Math.floor(dist / 3600000);
    const m = Math.floor((dist % 3600000) / 60000);
    const s = Math.floor((dist % 60000) / 1000);
    display.innerText = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- UI HELPERS ---
function showActiveUI() {
    document.getElementById('setup-area').style.display = "none";
    document.getElementById('active-area').style.display = "block";

    // THE FIX: Hide the settings button when UI goes active
    const sBtn = document.getElementById('settings-btn');
    if (sBtn) sBtn.style.display = "none";
}

function toggleSettings() {
    const settings = document.getElementById('settings-area');
    const setup = document.getElementById('setup-area');
    if (document.body.classList.contains('timer-running')) return;

    const isHidden = settings.style.display === "none" || settings.style.display === "";
    settings.style.display = isHidden ? "block" : "none";
    setup.style.display = isHidden ? "none" : "block";
}

function logDebug(msg) {
    const logBox = document.getElementById('debug-logs');
    if (logBox) logBox.innerHTML = `<div>> ${msg}</div>` + logBox.innerHTML;
}

function triggerForgotPIN() {
    // 1. Fetch stored credentials
    const storedEmail = localStorage.getItem('safety_email');
    const storedPhone = localStorage.getItem('safety_contact');

    if (!storedEmail && !storedPhone) {
        alert("🚨 ERROR: No recovery data found on this device.");
        return;
    }

    // 2. The Verification Prompt
    const userInput = prompt("To reset your PIN, enter your Registered Email OR Contact Number:").trim();

    if (!userInput) return;

    // 3. Smart Validation Logic
    const isEmailMatch = (userInput.toLowerCase() === storedEmail?.toLowerCase());
    const isPhoneMatch = (userInput === storedPhone);

    if (isEmailMatch || isPhoneMatch) {
        const confirmReset = confirm("✅ IDENTITY VERIFIED.\n\nThis will stop all active sessions and wipe your current PIN. Proceed to reset?");
        
        if (confirmReset) {
            // Wipe only security data, keep the email/phone for the next setup
            localStorage.removeItem('user_safe_pin');
            localStorage.removeItem('safety_endTime');
            localStorage.removeItem('current_journey_id');
            location.reload;
            
            alert("🔒 PIN Cleared. You will now be redirected to set a new one.");
            location.reload(); // Refresh to show setup screen
        }
    } else {
        alert("❌ ACCESS DENIED: The information provided does not match our records.");
        if (navigator.vibrate) navigator.vibrate();
    }
}

function userSnooze() {
    // 1. Calculate new time
    const additionalTime = 5 * 60000; // 2 Minutes
    endTime = endTime + additionalTime;
    
    // 2. Persist to LocalStorage (for Refresh/Resume safety)
    localStorage.setItem('safety_endTime', endTime);
    
    // 3. Update Firebase (so the alert doesn't trigger on other devices/cloud)
    const journeyId = localStorage.getItem('current_journey_id');
    if (journeyId) {
        firestore.collection("active_watches").doc(journeyId).update({
            expectedEndTime: endTime,
            status: "SNOOZED"
        }).catch(e => console.warn("Cloud snooze sync failed", e));
    }

    // 4. Visual Feedback
    const display = document.getElementById('timer-display');
    display.classList.add('snooze-flash'); // Add a CSS class for a quick green glow
    setTimeout(() => display.classList.remove('snooze-flash'), 1000);

    logDebug("Snooze +2min: New End Time " + new Date(endTime).toLocaleTimeString());
    
    // 5. Force the timer display to update immediately
    updateTimerDisplay(); 
}

// --- INITIALIZATION ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    const tosCheck = document.getElementById('tos-check');
    const startBtn = document.getElementById('start-session-btn');

    if (tosCheck && startBtn) {
        // 1. Force state on Refresh
        tosCheck.checked = false;
        syncStartButton();

        // 2. Listeners for the Button
        tosCheck.addEventListener('change', syncStartButton);
        tosCheck.addEventListener('click', syncStartButton);
        
        // 3. The Start Click
        startBtn.onclick = attemptStart; 
    }

    // Resume Logic
    const savedEndTime = localStorage.getItem('safety_endTime');
    if (savedEndTime && parseInt(savedEndTime) > Date.now()) {
        if (confirm("🔄 Resume active safety session?")) {
            endTime = parseInt(savedEndTime);
            showActiveUI();
            countdown = setInterval(updateTimerDisplay, 1000);
            heartbeatInterval = setInterval(updateHeartbeatLocation, 60000);
        } else {
            localStorage.clear();
        }
    }
});

// Final fallback for the button (Double-check after 1s)
window.onload = () => {
    setTimeout(syncStartButton, 500);
};
