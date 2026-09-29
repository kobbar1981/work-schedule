    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, collection, onSnapshot, deleteDoc, doc, setDoc, getDoc, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    const firebaseConfig = {
        apiKey: "AIzaSyASfsSMXS62ehM1kVSjOpudOEUGUh37BYI",
        authDomain: "work-schedule-17c39.firebaseapp.com",
        projectId: "work-schedule-17c39",
        storageBucket: "work-schedule-17c39.firebasestorage.app",
        messagingSenderId: "708640197618",
        appId: "1:708640197618:web:c3731ecf7c7ef80fd3396b"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // ===== הפרדה בין מסעדות/עסקים שונים על גבי אותו פרויקט Firebase =====
    // מזהה העסק נקבע כך: קודם מפרמטר ?r= בכתובת (אם קיים, גם נשמר במכשיר לפעמים הבאות),
    // אחרת ממה שנשמר במכשיר מפעם קודמת, ואחרת המשתמש מתבקש להזין/ליצור שם עסק.
    // כל עסק מקבל קבוצת collections נפרדת לגמרי, כך שהנתונים לעולם לא מתערבבים.
    function sanitizeRestaurantId(raw) {
        const cleaned = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return cleaned || '';
    }

    let RESTAURANT_ID = '';
    let superAdminVerified = false;

    function getEmpCollection() { return collection(db, `${RESTAURANT_ID}_employees`); }
    function getAvailCollection() { return collection(db, `${RESTAURANT_ID}_availability`); }
    function getSettingsDoc(docName) { return doc(db, `${RESTAURANT_ID}_settings`, docName); }

    // מרשם מרכזי של כל העסקים שנוצרו אי-פעם, לצורך מסך "ניהול-על"
    const getRegistryDoc = (id) => doc(db, '_registry', id);
    const getSuperAdminConfigDoc = () => doc(db, '_system', 'super_admin_config');
    const SUPER_ADMIN_DEFAULT_PASSWORD = "9999";

    async function touchRegistry() {
        if (!RESTAURANT_ID) return;
        try {
            const ref = getRegistryDoc(RESTAURANT_ID);
            const snap = await getDoc(ref);
            const payload = { id: RESTAURANT_ID, lastSeenAt: Date.now() };
            if (!snap.exists()) payload.createdAt = Date.now();
            await setDoc(ref, payload, { merge: true });
        } catch(e) {}
    }


    // ===== חלונות פנימיים (במקום alert/confirm/prompt של הדפדפן) =====
    let _toastTimer = null;
    function notify(msg) {
        let t = document.getElementById('appToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'appToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
    }

    function askDialog(msg, withInput) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'app-dialog-overlay';
            const box = document.createElement('div');
            box.className = 'app-dialog';
            const p = document.createElement('p');
            p.textContent = msg;
            box.appendChild(p);
            let inp = null;
            if (withInput) {
                inp = document.createElement('input');
                inp.type = 'password';
                box.appendChild(inp);
            }
            const row = document.createElement('div');
            row.className = 'app-dialog-actions';
            const ok = document.createElement('button');
            ok.textContent = 'אישור';
            const cancel = document.createElement('button');
            cancel.textContent = 'ביטול';
            cancel.className = 'cancel';
            row.appendChild(ok);
            row.appendChild(cancel);
            box.appendChild(row);
            ov.appendChild(box);
            document.body.appendChild(ov);
            const close = (val) => { ov.remove(); resolve(val); };
            ok.onclick = () => close(withInput ? inp.value : true);
            cancel.onclick = () => close(withInput ? null : false);
            if (inp) {
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
                setTimeout(() => inp.focus(), 50);
            }
        });
    }
    const askText = (msg) => askDialog(msg, true);
    const askConfirm = (msg) => askDialog(msg, false);

    function updateRestaurantTag() {
        const tagEl = document.getElementById('restaurantTag');
        if (tagEl) tagEl.textContent = RESTAURANT_ID ? `עסק: ${RESTAURANT_ID}` : '';
    }

    // כתובת ציבורית קבועה - כדי שהקישור לעובדים יעבוד גם מתוך אפליקציית ה-APK
    const PUBLIC_BASE_URL = 'https://kobbar1981.github.io/work-schedule/';

    function updateInviteLink() {
        const el = document.getElementById('inviteLinkDisplay');
        if (!el || !RESTAURANT_ID) return;
        el.value = PUBLIC_BASE_URL + '?r=' + encodeURIComponent(RESTAURANT_ID);
    }

    window.copyInviteLink = function() {
        const el = document.getElementById('inviteLinkDisplay');
        if (!el || !el.value) return;
        el.select();
        el.setSelectionRange(0, 99999);
        const finish = (ok) => notify(ok ? "הקישור הועתק" : "העתק ידנית מהשדה");
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(el.value).then(() => finish(true)).catch(() => {
                try { document.execCommand('copy'); finish(true); } catch(e) { finish(false); }
            });
        } else {
            try { document.execCommand('copy'); finish(true); } catch(e) { finish(false); }
        }
    };

    window.switchBusiness = function() {
        document.getElementById('selectionView').classList.add('hidden');
        document.getElementById('employeeView').classList.add('hidden');
        document.getElementById('managerView').classList.add('hidden');
        document.getElementById('businessSetupView').classList.remove('hidden');
        const input = document.getElementById('businessNameInput');
        if (input) input.value = RESTAURANT_ID || '';
    };

    window.confirmBusinessSetup = async function() {
        const raw = document.getElementById('businessNameInput').value;
        const cleaned = sanitizeRestaurantId(raw);
        if (!cleaned) { notify("שם עסק לא תקין"); return; }

        try {
            const snap = await getDoc(getRegistryDoc(cleaned));
            if (snap.exists() && snap.data().deleted) {
                notify("העסק נמחק. פנה לניהול-על.");
                return;
            }
            if (!snap.exists()) {
                if (!superAdminVerified) {
                    notify("העסק לא קיים");
                    return;
                }
                await setDoc(getRegistryDoc(cleaned), { id: cleaned, createdAt: Date.now(), lastSeenAt: Date.now() });
            }
        } catch(e) { notify("שגיאה בבדיקת העסק."); return; }

        try { localStorage.setItem('work_schedule_restaurant_id', cleaned); } catch(e){}
        const url = new URL(window.location.href);
        url.searchParams.set('r', cleaned);
        window.location.href = url.toString();
    };

    async function initRestaurantId() {
        const fromUrl = sanitizeRestaurantId(new URLSearchParams(window.location.search).get('r'));
        let fromStorage = '';
        try { fromStorage = sanitizeRestaurantId(localStorage.getItem('work_schedule_restaurant_id')); } catch(e){}

        const candidate = fromUrl || fromStorage || '';

        if (candidate) {
            // בדיקה אם העסק הזה סומן כמחוק - חוסם כניסה מחדש דרך קישור ישן
            let isDeleted = false, blockedMsg = '';
            try {
                const snap = await getDoc(getRegistryDoc(candidate));
                if (!snap.exists()) { isDeleted = true; blockedMsg = `העסק "${candidate}" לא קיים במערכת.`; }
                else if (snap.data().deleted) { isDeleted = true; blockedMsg = `העסק "${candidate}" הוסר מהמערכת.`; }
            } catch(e) {
                notify("שגיאה בבדיקת העסק: " + (e.code || e.message));
                isDeleted = true; blockedMsg = 'שגיאה בבדיקת העסק.';
            }

            if (isDeleted) {
                try { localStorage.removeItem('work_schedule_restaurant_id'); } catch(e){}
                RESTAURANT_ID = '';
                updateRestaurantTag();
                document.getElementById('businessSetupView').classList.add('hidden');
                document.getElementById('selectionView').classList.add('hidden');

                document.querySelector('h1').insertAdjacentHTML('afterend',
                    `<div class="card" id="deletedNoticeCard" style="text-align:center;">
                        <h2>העסק הוסר</h2>
                        <p>${esc(blockedMsg)} פנה למנהל לקבלת קישור מעודכן.</p>
                        <button onclick="checkSuperAdminPassword()" style="background-color:#2c3e50; font-size:0.85em;">כניסת ניהול-על</button>
                    </div>`);
                return false;
            }
        }

        RESTAURANT_ID = candidate;
        try { if (candidate) localStorage.setItem('work_schedule_restaurant_id', candidate); } catch(e){}

        updateRestaurantTag();
        const tagEl = document.getElementById('restaurantTag');
        if (tagEl && RESTAURANT_ID) tagEl.textContent += ' | v4';

        if (!RESTAURANT_ID) {
            document.getElementById('businessSetupView').classList.remove('hidden');
            document.getElementById('selectionView').classList.add('hidden');
            return false;
        } else {
            document.getElementById('businessSetupView').classList.add('hidden');
            document.getElementById('selectionView').classList.remove('hidden');
            updateInviteLink();
            return true;
        }
    }

    const LEGACY_DEFAULT_PASSWORD = "1212";

    const daysKeys = ['0', '1', '2', '3', '4', '5', '6'];
    const daysNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    const TIME_INPUT_IDS = [
        'mStart', 'mEnd', 'eStart', 'eEnd',
        'friMStart', 'friMEnd', 'friEStart', 'friEEnd',
        'satMStart', 'satMEnd', 'satEStart', 'satEEnd'
    ];
    
    let employees = [];
    let employeeAvailMap = {};
    let employeeNotesMap = {};

    let currentSchedule = {};
    let customShiftTimes = {};

    let publishedSchedule = {};
    let publishedTimes = {};
    let publishedCustomShiftTimes = {};
    let isPublished = false;
    
    let activeShiftsConfig = {
        '0-m': true, '0-e': true,
        '1-m': true, '1-e': true,
        '2-m': true, '2-e': true,
        '3-m': true, '3-e': true,
        '4-m': true, '4-e': true,
        '5-m': true, '5-e': false,
        '6-m': false, '6-e': false
    };

    let activeSwapKey = null;
    let activeSwapIndex = null;
    let activeTimeKey = null;
    let activeTimeEmpName = null;
    let verifiedEmployeeName = null;
    let originalEditingName = null;

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function bytesToHex(buf) {
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function hexToBytes(hex) {
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
        return out;
    }

    function generateSalt() {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return bytesToHex(arr);
    }

    async function hashPassword(pass, saltHex) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 150000, hash: "SHA-256" },
            keyMaterial,
            256
        );
        return bytesToHex(bits);
    }

    async function saveManagerPassword(newPass) {
        const salt = generateSalt();
        const hash = await hashPassword(newPass, salt);
        await setDoc(getSettingsDoc("manager_config"), {
            passwordHash: hash,
            salt: salt,
            password: deleteField() 
        }, { merge: true });
    }

    async function makeMergePinFields(pin) {
        const salt = generateSalt();
        const hash = await hashPassword(String(pin), salt);
        return { pinHash: hash, pinSalt: salt, pin: deleteField() };
    }

    const colorPaletteList = [
        '#ff7675', '#d63031', '#c0392b', '#e84393', '#fd79a8', '#fab1a0',
        '#e67e22', '#f39c12', '#f1c40f', '#ffeaa7', '#d35400', '#cd6133',
        '#55efc4', '#00b894', '#27ae60', '#2ecc71', '#1abc9c', '#00cec9',
        '#74b9ff', '#0984e3', '#2980b9', '#3498db', '#81ecec', '#18dcff',
        '#a29bfe', '#6c5ce7', '#8e44ad', '#9b59b6', '#e056fd', '#b2bec3',
        '#2d3436', '#636e72', '#badc58', '#dfe6e9', '#485460', '#ff9f43'
    ];

    function buildColorPalettes() {
        const addContainer = document.getElementById('addColorPalette');
        const editContainer = document.getElementById('editColorPalette');
        let addHtml = '', editHtml = '';
        colorPaletteList.forEach((hex) => {
            addHtml += `<div class="color-swatch" style="background-color: ${hex};" onclick="selectColorAdd('${hex}', this)" data-hex="${hex}"></div>`;
            editHtml += `<div class="color-swatch edit-swatch" style="background-color: ${hex};" onclick="selectColorEdit('${hex}', this)" data-hex="${hex}"></div>`;
        });
        if (addContainer) addContainer.innerHTML = addHtml;
        if (editContainer) editContainer.innerHTML = editHtml;
    }

    buildColorPalettes();

    (function markDefaultAddSwatch() {
        const defaultColor = (document.getElementById('empColorInput').value || '').toLowerCase();
        document.querySelectorAll('#addColorPalette .color-swatch').forEach(el => {
            if (el.getAttribute('data-hex').toLowerCase() === defaultColor) el.classList.add('selected');
        });
    })();

    window.selectColorAdd = function(colorHex, element) {
        document.getElementById('empColorInput').value = colorHex;
        document.querySelectorAll('#addColorPalette .color-swatch').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
    };

    window.selectColorEdit = function(colorHex, element) {
        document.getElementById('editEmpColorInput').value = colorHex;
        document.querySelectorAll('#editColorPalette .color-swatch').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
    };

    function getIsraelLastThreshold(targetDay) {
        const nowMs = Date.now();
        const strIsrael = new Date().toLocaleString("en-US", {timeZone: "Asia/Jerusalem"});
        const dIsrael = new Date(strIsrael);
        const currentIsraelTime = dIsrael.getTime();
        
        let daysToSubtract = (dIsrael.getDay() - targetDay + 7) % 7;
        if (dIsrael.getDay() === targetDay && dIsrael.getHours() < 7) { 
            daysToSubtract = 7; 
        }
        dIsrael.setDate(dIsrael.getDate() - daysToSubtract);
        dIsrael.setHours(7, 0, 0, 0);
        return nowMs - (currentIsraelTime - dIsrael.getTime());
    }

    function getLastFriday7AM() { return getIsraelLastThreshold(5); }
    function getLastThursday7AM() { return getIsraelLastThreshold(4); }

    function isScheduleExpired(publishedAt) {
        if (!publishedAt) return false;
        return publishedAt < getLastFriday7AM();
    }

    function getScheduleDates() {
        const strIsrael = new Date().toLocaleString("en-US", {timeZone: "Asia/Jerusalem"});
        const dIsrael = new Date(strIsrael);
        const dayOfWeek = dIsrael.getDay(); 
        const hour = dIsrael.getHours();
        
        let sunday = new Date(dIsrael);
        if ((dayOfWeek === 4 && hour >= 7) || dayOfWeek === 5 || dayOfWeek === 6) {
            const daysUntilNextSunday = (7 - dayOfWeek) % 7 || 7;
            sunday.setDate(dIsrael.getDate() + daysUntilNextSunday);
        } else {
            sunday.setDate(dIsrael.getDate() - dayOfWeek);
        }
        
        const dates = [];
        for(let i=0; i<7; i++) { 
            let d = new Date(sunday);
            d.setDate(sunday.getDate() + i);
            dates.push(`${d.getDate()}/${d.getMonth()+1}`);
        }
        return dates;
    }

    function updateDatesInUI() {
        const dates = getScheduleDates();
        const daysShort = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
        
        for(let i=0; i<7; i++) {
            let thEmp = document.getElementById(`th-emp-${i}`);
            if(thEmp) thEmp.innerHTML = `<b>${daysShort[i]}</b><br><span style="font-size:0.85em; font-weight:normal; color:#555;">${dates[i]}</span>`;
            let thMgr = document.getElementById(`th-mgr-${i}`);
            if(thMgr) thMgr.innerHTML = `<b>${daysShort[i]}</b><br><span style="font-size:0.85em; font-weight:normal; color:#555;">${dates[i]}</span>`;
        }
    }
    updateDatesInUI();

    /* ===== עזרי הצגת שעות (שתי שורות: התחלה מעל סיום) ===== */

    function readTimesFromInputs() {
        const t = {};
        TIME_INPUT_IDS.forEach(id => {
            const el = document.getElementById(id);
            t[id] = el ? el.value : '';
        });
        return t;
    }

    function hoursFromTimes(t, dayIdx, shiftType) {
        t = t || {};
        if (dayIdx === '5') {
            return shiftType === 'm'
                ? `${t.friMStart || "09:30"} - ${t.friMEnd || "14:00"}`
                : `${t.friEStart || "15:00"} - ${t.friEEnd || "19:00"}`;
        } else if (dayIdx === '6') {
            return shiftType === 'm'
                ? `${t.satMStart || "10:00"} - ${t.satMEnd || "16:00"}`
                : `${t.satEStart || "18:30"} - ${t.satEEnd || "23:00"}`;
        }
        return shiftType === 'm'
            ? `${t.mStart || "11:00"} - ${t.mEnd || "16:00"}`
            : `${t.eStart || "16:00"} - ${t.eEnd || "21:00"}`;
    }

    function splitTimeRange(str) {
        const parts = String(str || '').split('-').map(s => s.trim());
        return parts.length === 2 ? parts : [String(str || ''), ''];
    }

    // שעות בשתי שורות: התחלה מעל סיום, בלי חיתוך
    function hoursHtml(str, extraClass) {
        const [s, e] = splitTimeRange(str);
        return `<span class="hours-2l ${extraClass || ''}"><span class="h-line">${esc(s)}</span>${e ? `<span class="h-line h-end">${esc(e)}</span>` : ''}</span>`;
    }

    window.saveActiveShiftsConfig = async function() {
        const checkboxes = document.querySelectorAll('#managerActiveShiftsContainer input[type="checkbox"]');
        activeShiftsConfig = {};
        checkboxes.forEach(cb => {
            activeShiftsConfig[cb.value] = cb.checked;
        });
        try {
            await setDoc(getSettingsDoc("active_shifts_config"), { activeShifts: activeShiftsConfig });
        } catch(e) {}
    };

    function renderEmployeeShiftCheckboxes() {
        const container = document.getElementById('shiftsCheckboxContainer');
        if(!container) return;
        const dates = getScheduleDates();

        const shiftLabels = [
            {key: '0-m', label: `ראשון בוקר (${dates[0]})`},
            {key: '0-e', label: `ראשון ערב (${dates[0]})`},
            {key: '1-m', label: `שני בוקר (${dates[1]})`},
            {key: '1-e', label: `שני ערב (${dates[1]})`},
            {key: '2-m', label: `שלישי בוקר (${dates[2]})`},
            {key: '2-e', label: `שלישי ערב (${dates[2]})`},
            {key: '3-m', label: `רביעי בוקר (${dates[3]})`},
            {key: '3-e', label: `רביעי ערב (${dates[3]})`},
            {key: '4-m', label: `חמישי בוקר (${dates[4]})`},
            {key: '4-e', label: `חמישי ערב (${dates[4]})`},
            {key: '5-m', label: `שישי בוקר (${dates[5]})`},
            {key: '5-e', label: `שישי ערב (${dates[5]})`},
            {key: '6-m', label: `שבת בוקר (${dates[6]})`},
            {key: '6-e', label: `שבת ערב/מוצ"ש (${dates[6]})`}
        ];

        let html = '';
        shiftLabels.forEach(item => {
            const isActive = activeShiftsConfig[item.key] !== false;
            if (isActive) {
                html += `<label><input type="checkbox" value="${item.key}"> <span>${item.label}</span></label>`;
            } else {
                html += `<label class="disabled-shift"><input type="checkbox" value="${item.key}" disabled> <span>${item.label} (סגורה)</span></label>`;
            }
        });
        container.innerHTML = html;
    }

    async function saveDraftToFirestore() {
        try {
            await setDoc(getSettingsDoc("draft_schedule"), {
                schedule: currentSchedule,
                slotTimes: customShiftTimes,
                updatedAt: Date.now()
            });
        } catch(e){}
    }

    async function syncPublishedIfActive() {
        if (isPublished) {
            try {
                const currentTimes = readTimesFromInputs();
                await setDoc(getSettingsDoc("published_schedule"), { 
                    schedule: currentSchedule,
                    times: currentTimes,
                    slotTimes: customShiftTimes,
                    publishedAt: Date.now()
                });
            } catch(e){}
        }
    }

    function initRealtimeListeners() {
        onSnapshot(getEmpCollection(), (snapshot) => {
            employees = [];
            snapshot.forEach((d) => {
                let data = d.data();
                if(!data.name) data.name = d.id; 
                if(!data.color) data.color = "#74b9ff";
                employees.push(data);
            });
            renderEmployeesList();
            renderDailyAvailabilityTable();
            renderSummaryTable();
            if(verifiedEmployeeName) renderScheduleForEmployee(verifiedEmployeeName);
        });

        onSnapshot(getAvailCollection(), (snapshot) => {
            employeeAvailMap = {};
            employeeNotesMap = {};
            const lastThu7AM = getLastThursday7AM();
            snapshot.forEach(d => {
                let data = d.data();
                if (data.updatedAt && data.updatedAt >= lastThu7AM) {
                    let empName = data.name || d.id;
                    employeeAvailMap[empName] = data.shifts || {};
                    if(data.note) employeeNotesMap[empName] = data.note;
                }
            });
            renderDailyAvailabilityTable();
            renderSummaryTable();
            renderManagerNotes();
        });

        onSnapshot(getSettingsDoc("active_shifts_config"), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.activeShifts) {
                    activeShiftsConfig = data.activeShifts;
                    const checkboxes = document.querySelectorAll('#managerActiveShiftsContainer input[type="checkbox"]');
                    checkboxes.forEach(cb => {
                        if (activeShiftsConfig[cb.value] !== undefined) {
                            cb.checked = activeShiftsConfig[cb.value];
                        }
                    });
                }
            }
            renderEmployeeShiftCheckboxes();
        });

        onSnapshot(getSettingsDoc("draft_schedule"), async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.updatedAt && data.updatedAt < getLastFriday7AM()) {
                    currentSchedule = {};
                    customShiftTimes = {};
                    try { await deleteDoc(getSettingsDoc("draft_schedule")); } catch(e){}
                } else {
                    currentSchedule = data.schedule || {};
                    customShiftTimes = data.slotTimes || {};
                }
            } else {
                currentSchedule = {};
                customShiftTimes = {};
            }
            renderFullScheduleForManager();
            renderSummaryTable();
        });

        onSnapshot(getSettingsDoc("published_schedule"), async (scheduleSnap) => {
            if (scheduleSnap.exists()) {
                const data = scheduleSnap.data();
                if (isScheduleExpired(data.publishedAt)) {
                    publishedSchedule = {};
                    publishedTimes = {};
                    publishedCustomShiftTimes = {};
                    isPublished = false;
                    updatePublishBadge(false);
                    try { await deleteDoc(getSettingsDoc("published_schedule")); } catch(e){}
                } else {
                    publishedSchedule = data.schedule || {};
                    publishedTimes = data.times || {};
                    publishedCustomShiftTimes = data.slotTimes || {};
                    isPublished = true;
                    updatePublishBadge(true);
                }
            } else {
                publishedSchedule = {};
                publishedTimes = {};
                publishedCustomShiftTimes = {};
                isPublished = false;
                updatePublishBadge(false);
            }
            renderFullScheduleForManager();
            renderSummaryTable();
            if(verifiedEmployeeName) renderScheduleForEmployee(verifiedEmployeeName);
        });
    }
    (async function boot() {
        if (await initRestaurantId()) {
            initRealtimeListeners();
            touchRegistry();
        }
    })();

    function getShiftHours(dayIdx, shiftType) {
        return hoursFromTimes(publishedTimes, dayIdx, shiftType);
    }

    window.openTimeModal = function(shiftKey, empName, currentHoursStr) {
        activeTimeKey = shiftKey;
        activeTimeEmpName = empName;
        document.getElementById('timeModalTitle').innerText = `עדכון שעות עבור ${empName}`;
        let parts = currentHoursStr.split('-').map(s => s.trim());
        if(parts.length === 2) {
            document.getElementById('modalStartTime').value = parts[0];
            document.getElementById('modalEndTime').value = parts[1];
        }
        document.getElementById('timeModal').style.display = 'flex';
    };

    window.closeTimeModal = function() { document.getElementById('timeModal').style.display = 'none'; };
    window.setQuickTime = function(start, end) {
        document.getElementById('modalStartTime').value = start;
        document.getElementById('modalEndTime').value = end;
    };

    window.saveTimeFromModal = async function() {
        const start = document.getElementById('modalStartTime').value;
        const end = document.getElementById('modalEndTime').value;
        if(!start || !end) { notify("בחר שעות"); return; }
        customShiftTimes[`${activeTimeKey}-${activeTimeEmpName}`] = `${start} - ${end}`;
        closeTimeModal();
        await saveDraftToFirestore();
        await syncPublishedIfActive();
        renderFullScheduleForManager();
    };

    window.switchView = function(viewName) {
        document.getElementById('selectionView').classList.add('hidden');
        document.getElementById('employeeView').classList.add('hidden');
        document.getElementById('managerView').classList.add('hidden');

        if(viewName === 'employee') {
            document.getElementById('employeeView').classList.remove('hidden');
            loadEmployeesForEmployeeView();
        } else if(viewName === 'manager') {
            document.getElementById('managerView').classList.remove('hidden');
            renderFullScheduleForManager();
        } else {
            document.getElementById('selectionView').classList.add('hidden');
            document.getElementById('selectionView').classList.remove('hidden');
        }
    };

    window.checkManagerPassword = async function() {
        let cfg = null;
        try {
            const docSnap = await getDoc(getSettingsDoc("manager_config"));
            if (docSnap.exists()) cfg = docSnap.data();
        } catch(e) {
            notify("שגיאת חיבור");
            return;
        }

        const rawPass = await askText("סיסמת מנהל");
        if (rawPass === null) return;
        const pass = rawPass.trim();

        try {
            let ok = false, mustSetNew = false;
            if (cfg && cfg.passwordHash && cfg.salt) {
                ok = (await hashPassword(pass, cfg.salt)) === cfg.passwordHash;
            } else if (cfg && cfg.password) {
                ok = (pass === String(cfg.password));
                if (ok) await saveManagerPassword(pass);
            } else {
                ok = (pass === LEGACY_DEFAULT_PASSWORD);
                mustSetNew = ok;
            }

            if (!ok) { notify("סיסמה שגויה"); return; }

            if (mustSetNew) {
                const newRaw = await askText("הגדר סיסמה חדשה (לפחות 4 תווים)");
                const newPass = newRaw === null ? "" : newRaw.trim();
                if (newPass.length < 4 || newPass === LEGACY_DEFAULT_PASSWORD) {
                    notify("סיסמה לא תקינה");
                    return;
                }
                await saveManagerPassword(newPass);
                notify("הסיסמה נשמרה");
            }
            switchView('manager');
        } catch(e) { notify("שגיאה באימות"); }
    };

    window.updateManagerPassword = async function() {
        const newPass = document.getElementById('newManagerPass').value.trim();
        if (!newPass) { notify("הכנס סיסמה"); return; }
        if (newPass.length < 4) { notify("לפחות 4 תווים"); return; }
        try {
            await saveManagerPassword(newPass);
            notify("הסיסמה עודכנה");
            document.getElementById('newManagerPass').value = '';
        } catch(e){ notify("שגיאה בעדכון"); }
    };

    window.checkSuperAdminPassword = async function() {
        let cfg = null;
        try {
            const docSnap = await getDoc(getSuperAdminConfigDoc());
            if (docSnap.exists()) cfg = docSnap.data();
        } catch(e) {
            notify("שגיאת חיבור");
            return;
        }

        const rawPass = await askText("סיסמת ניהול-על");
        if (rawPass === null) return;
        const pass = rawPass.trim();

        try {
            let ok = false, mustSetNew = false;
            if (cfg && cfg.passwordHash && cfg.salt) {
                ok = (await hashPassword(pass, cfg.salt)) === cfg.passwordHash;
            } else {
                ok = (pass === SUPER_ADMIN_DEFAULT_PASSWORD);
                mustSetNew = ok;
            }

            if (!ok) { notify("סיסמה שגויה"); return; }

            if (mustSetNew) {
                const newRaw = await askText("הגדר סיסמה חדשה (לפחות 4 תווים)");
                const newPass = newRaw === null ? "" : newRaw.trim();
                if (newPass.length < 4 || newPass === SUPER_ADMIN_DEFAULT_PASSWORD) {
                    notify("סיסמה לא תקינה");
                    return;
                }
                const salt = generateSalt();
                const hash = await hashPassword(newPass, salt);
                await setDoc(getSuperAdminConfigDoc(), { passwordHash: hash, salt: salt });
                notify("הסיסמה נשמרה");
            }

            document.getElementById('selectionView').classList.add('hidden');
            document.getElementById('employeeView').classList.add('hidden');
            document.getElementById('managerView').classList.add('hidden');
            const notice = document.getElementById('deletedNoticeCard');
            if (notice) notice.remove();
            superAdminVerified = true;
            document.getElementById('businessSetupView').classList.add('hidden');
            document.getElementById('superAdminView').classList.remove('hidden');
            loadSuperAdminList();
        } catch(e) { notify("שגיאה באימות"); }
    };

    window.loadSuperAdminList = async function() {
        const container = document.getElementById('superAdminList');
        if (!container) return;
        container.innerHTML = '<p style="color:#888;">טוען רשימת עסקים...</p>';

        try {
            const snap = await getDocs(collection(db, '_registry'));
            if (snap.empty) {
                container.innerHTML = '<p style="color:#888;">לא נמצאו עסקים רשומים עדיין. עסקים נרשמים אוטומטית בכניסה הראשונה שלהם למערכת.</p>';
                return;
            }

            const businesses = [];
            snap.forEach(d => businesses.push(d.data()));
            const activeBiz = businesses.filter(b => !b.deleted).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
            const deletedBiz = businesses.filter(b => b.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

            const fmtDate = (ms) => ms ? new Date(ms).toLocaleString('he-IL', { day:'numeric', month:'numeric', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

            let html = '';
            if (activeBiz.length === 0) {
                html += '<p style="color:#888;">אין עסקים פעילים.</p>';
            }
            for (const biz of activeBiz) {
                let empCount = 0;
                try {
                    const empSnap = await getDocs(collection(db, `${biz.id}_employees`));
                    empCount = empSnap.size;
                } catch(e) {}

                html += `
                    <div class="biz-item">
                        <div class="biz-info">
                            <b>${esc(biz.id)}</b> ${biz.id === RESTAURANT_ID ? '⭐ (הנוכחי)' : ''}<br>
                            עובדים: ${empCount} | נוצר: ${fmtDate(biz.createdAt)}<br>
                            כניסה אחרונה: ${fmtDate(biz.lastSeenAt)}
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="edit-btn" style="width:auto;" data-id="${esc(biz.id)}" onclick="jumpToBusiness(this.dataset.id)">עבור לעסק</button>
                            <button class="delete-btn" style="width:auto;" data-id="${esc(biz.id)}" onclick="deleteBusiness(this.dataset.id)">מחק עסק</button>
                        </div>
                    </div>`;
            }

            if (deletedBiz.length > 0) {
                html += `<h4 style="margin-top:16px; color:#888;">עסקים שנמחקו (${deletedBiz.length}):</h4>`;
                for (const biz of deletedBiz) {
                    html += `
                        <div class="biz-item" style="opacity:0.7; background:#f5f5f5;">
                            <div class="biz-info">
                                <b>${esc(biz.id)}</b><br>
                                נמחק בתאריך: ${fmtDate(biz.deletedAt)}
                            </div>
                            <div style="display:flex; gap:6px;">
                                <button class="edit-btn" style="width:auto;" data-id="${esc(biz.id)}" onclick="restoreBusiness(this.dataset.id)">שחזר שם</button>
                                <button class="delete-btn" style="width:auto;" data-id="${esc(biz.id)}" onclick="purgeBusinessRecord(this.dataset.id)">הסר מהרשימה</button>
                            </div>
                        </div>`;
                }
            }

            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = '<p style="color:red;">שגיאה בטעינת הרשימה.</p>';
        }
    };

    window.jumpToBusiness = function(bizId) {
        try { localStorage.setItem('work_schedule_restaurant_id', bizId); } catch(e){}
        const url = new URL(window.location.href);
        url.searchParams.set('r', bizId);
        window.location.href = url.toString();
    };

    window.deleteBusiness = async function(bizId) {
        if (!await askConfirm(`למחוק לצמיתות את "${bizId}"?`)) return;
        if (!await askConfirm(`בטוח? למחוק את "${bizId}"`)) return;

        try {
            const empSnap = await getDocs(collection(db, `${bizId}_employees`));
            await Promise.all(empSnap.docs.map(d => deleteDoc(doc(db, `${bizId}_employees`, d.id))));

            const availSnap = await getDocs(collection(db, `${bizId}_availability`));
            await Promise.all(availSnap.docs.map(d => deleteDoc(doc(db, `${bizId}_availability`, d.id))));

            const settingsDocs = ["manager_config", "active_shifts_config", "draft_schedule", "published_schedule"];
            await Promise.all(settingsDocs.map(name => deleteDoc(doc(db, `${bizId}_settings`, name))));

            // לא מוחקים את רשומת המרשם עצמה - מסמנים כ"נמחק" כדי לחסום כניסה מחדש דרך קישור ישן
            await setDoc(getRegistryDoc(bizId), { id: bizId, deleted: true, deletedAt: Date.now() }, { merge: true });

            notify("העסק נמחק");
            loadSuperAdminList();
        } catch(e) { notify("שגיאה במחיקה"); }
    };

    window.restoreBusiness = async function(bizId) {
        if (!await askConfirm(`לשחזר את "${bizId}"? הנתונים שנמחקו לא יחזרו.`)) return;
        try {
            await setDoc(getRegistryDoc(bizId), { id: bizId, deleted: false, deletedAt: null }, { merge: true });
            notify("שוחזר");
            loadSuperAdminList();
        } catch(e) { notify("שגיאה בשחזור."); }
    };

    window.purgeBusinessRecord = async function(bizId) {
        if (!await askConfirm(`להסיר את "${bizId}" מהרשימה?`)) return;
        try {
            await deleteDoc(getRegistryDoc(bizId));
            loadSuperAdminList();
        } catch(e) { notify("שגיאה."); }
    };

    window.encryptAllLegacyPins = async function() {
        const legacy = employees.filter(e => e.pin && !e.pinHash);
        if (legacy.length === 0) { notify("הכול כבר מוצפן"); return; }
        if (!await askConfirm(`להצפין ${legacy.length} קודים?`)) return;
        try {
            for (const e of legacy) {
                const fields = await makeMergePinFields(e.pin);
                await setDoc(doc(getEmpCollection(), e.name), fields, { merge: true });
            }
            notify("הקודים הוצפנו");
        } catch(err) { notify("שגיאה בהצפנה"); }
    };

    function updatePublishBadge(published) {
        const badge = document.getElementById('publishStatusBadge');
        if(!badge) return;
        if(published) {
            badge.innerText = "פורסם לעובדים";
            badge.className = "status-badge status-published";
        } else {
            badge.innerText = "טיוטה (טרם פורסם)";
            badge.className = "status-badge status-draft";
        }
    }

    window.addEmployee = async function() {
        const name = document.getElementById('empName').value.trim();
        const pin = document.getElementById('empPin').value.trim();
        const rank = parseInt(document.getElementById('empRank').value);
        const color = document.getElementById('empColorInput').value;

        if (!name) { notify("הכנס שם עובד"); return; }
        if (name.includes('/')) { notify("השם לא יכול להכיל /"); return; }
        if (!/^\d{4}$/.test(pin)) { notify("קוד אישי: 4 ספרות"); return; }
        if (employees.some(e => e.name === name)) {
            notify("השם כבר קיים"); return;
        }
        
        try {
            const salt = generateSalt();
            const pinHash = await hashPassword(pin, salt);
            const empData = { id: Date.now(), name, pinHash, pinSalt: salt, rank, color };
            await setDoc(doc(getEmpCollection(), name), empData);
            document.getElementById('empName').value = '';
            document.getElementById('empPin').value = '';
            notify("העובד נוסף");
        } catch(e) { notify("שגיאה בהוספה"); }
    };

    window.openEditModal = function(name, pin, rank, color) {
        originalEditingName = name;
        document.getElementById('editEmpName').value = name;
        document.getElementById('editEmpPin').value = pin || '';
        document.getElementById('editEmpRank').value = rank;
        document.getElementById('editEmpColorInput').value = color || '#74b9ff';

        document.querySelectorAll('#editColorPalette .color-swatch').forEach(el => {
            el.classList.remove('selected');
            if(el.getAttribute('data-hex').toLowerCase() === (color || '').toLowerCase()) {
                el.classList.add('selected');
            }
        });
        document.getElementById('editEmployeeModal').style.display = 'flex';
    };

    window.closeEditModal = function() {
        document.getElementById('editEmployeeModal').style.display = 'none';
    };

    async function renameEmployeeReferences(oldName, newName) {
        try {
            const oldRef = doc(getAvailCollection(), oldName);
            const snap = await getDoc(oldRef);
            if (snap.exists()) {
                await setDoc(doc(getAvailCollection(), newName), { ...snap.data(), name: newName });
                await deleteDoc(oldRef);
            }
        } catch(e){}

        const swapNames = (sched) => {
            const out = {};
            Object.keys(sched || {}).forEach(k => {
                out[k] = (sched[k] || []).map(n => n === oldName ? newName : n);
            });
            return out;
        };

        try {
            const draftRef = getSettingsDoc("draft_schedule");
            const snap = await getDoc(draftRef);
            if (snap.exists()) {
                const d = snap.data();
                await setDoc(draftRef, { ...d, schedule: swapNames(d.schedule) });
            }
        } catch(e){}

        try {
            const pubRef = getSettingsDoc("published_schedule");
            const snap = await getDoc(pubRef);
            if (snap.exists()) {
                const d = snap.data();
                await setDoc(pubRef, { ...d, schedule: swapNames(d.schedule) });
            }
        } catch(e){}
    }

    window.saveEditedEmployee = async function() {
        const newName = document.getElementById('editEmpName').value.trim();
        const pinRaw = document.getElementById('editEmpPin').value.trim();
        const rank = parseInt(document.getElementById('editEmpRank').value);
        const color = document.getElementById('editEmpColorInput').value;

        if (!newName) { notify("הכנס שם עובד"); return; }
        if (newName.includes('/')) { notify("השם לא יכול להכיל /"); return; }
        if (pinRaw && !/^\d{4}$/.test(pinRaw)) { notify("קוד אישי: 4 ספרות"); return; }

        const oldEmp = employees.find(e => e.name === originalEditingName);
        if (!oldEmp) { notify("העובד לא נמצא"); closeEditModal(); return; }

        const renamed = (originalEditingName !== newName);
        if (renamed && employees.some(e => e.name === newName)) {
            notify("השם כבר קיים"); return;
        }

        const hasExistingCode = !!(oldEmp.pinHash || oldEmp.pin);
        if (!pinRaw && !hasExistingCode) { notify("קוד אישי: 4 ספרות"); return; }

        try {
            const updated = { ...oldEmp, name: newName, rank: rank, color: color };
            if (pinRaw) {
                const salt = generateSalt();
                updated.pinHash = await hashPassword(pinRaw, salt);
                updated.pinSalt = salt;
                delete updated.pin;
            }
            await setDoc(doc(getEmpCollection(), newName), updated);
            if (renamed) {
                await renameEmployeeReferences(originalEditingName, newName);
                await deleteDoc(doc(getEmpCollection(), originalEditingName));
            }
            closeEditModal();
            notify("עודכן");
        } catch(e) { notify("שגיאה בעדכון"); }
    };

    window.deleteEmployee = async function(name) {
        if(await askConfirm(`למחוק את ${name}?`)) {
            try {
                await deleteDoc(doc(getEmpCollection(), name));
                await deleteDoc(doc(getAvailCollection(), name));
            } catch(e){}
        }
    };

    function renderEmployeesList() {
        const list = document.getElementById('empList');
        if (!list) return;
        if (employees.length === 0) { list.innerHTML = '<p style="color:#888;">אין עובדים במערכת.</p>'; return; }
        list.innerHTML = employees.map((e) => {
            const pinInfo = e.pinHash ? 'קוד: מוצפן' : `קוד: ${esc(e.pin || '—')} (לא מוצפן)`;
            return `
            <div class="emp-item">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span class="emp-tag" style="background-color: ${esc(e.color || '#74b9ff')}; margin:0;">${esc(e.name)}</span>
                    <span style="font-size:0.75em; color:#555;">(${pinInfo}, רמה ${esc(e.rank || 1)})</span>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="edit-btn" data-name="${esc(e.name)}" data-pin="${esc(e.pinHash ? '' : (e.pin || ''))}" data-rank="${esc(e.rank || 3)}" data-color="${esc(e.color || '#74b9ff')}" onclick="openEditModal(this.dataset.name, this.dataset.pin, this.dataset.rank, this.dataset.color)">ערוך</button>
                    <button class="delete-btn" data-name="${esc(e.name)}" onclick="deleteEmployee(this.dataset.name)">הסר</button>
                </div>
            </div>`;
        }).join('');
    }

    function loadEmployeesForEmployeeView() {
        const dropdown = document.getElementById('employeeNameDropdown');
        if(!dropdown) return;
        dropdown.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'בחר את שמך...';
        dropdown.appendChild(placeholder);
        resetPinStep();
        employees.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.name;
            opt.textContent = emp.name;
            dropdown.appendChild(opt);
        });
    }

    window.resetPinStep = function() {
        verifiedEmployeeName = null;
        document.getElementById('employeePinInput').value = '';
        document.getElementById('employeeFormArea').classList.add('hidden');
    };

    window.verifyEmployeePin = async function() {
        const selectedName = document.getElementById('employeeNameDropdown').value;
        const inputPin = document.getElementById('employeePinInput').value.trim();
        if (!selectedName || !inputPin) { notify("בחר שם והכנס קוד"); return; }

        const emp = employees.find(e => e.name === selectedName);
        if (!emp) { notify("העובד לא נמצא."); return; }

        let ok = false, needsMigration = false;
        try {
            if (emp.pinHash && emp.pinSalt) {
                ok = ((await hashPassword(inputPin, emp.pinSalt)) === emp.pinHash);
            } else if (emp.pin) {
                ok = (inputPin === String(emp.pin));
                needsMigration = ok;
            } else {
                notify("לא הוגדר קוד. פנה למנהל."); return;
            }
        } catch(e) { notify("שגיאה באימות"); return; }

        if (ok) {
            verifiedEmployeeName = selectedName;
            document.getElementById('employeeFormArea').classList.remove('hidden');

            try {
                const now = new Date();
                const formattedTime = now.toLocaleString('he-IL', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' });
                const update = { lastViewedAt: formattedTime };
                if (needsMigration) Object.assign(update, await makeMergePinFields(inputPin));
                await setDoc(doc(getEmpCollection(), selectedName), update, { merge: true });
            } catch(e){}
            
            renderEmployeeShiftCheckboxes();
            let existingAvail = employeeAvailMap[selectedName] || {};
            let existingNote = employeeNotesMap[selectedName] || '';

            document.querySelectorAll('#shiftsCheckboxContainer input').forEach(cb => {
                cb.checked = !!existingAvail[cb.value];
            });
            document.getElementById('employeeNoteInput').value = existingNote;
            renderScheduleForEmployee(selectedName);
        } else {
            notify("קוד שגוי");
            document.getElementById('employeeFormArea').classList.add('hidden');
        }
    };

    function renderScheduleForEmployee(empName) {
        const summaryBox = document.getElementById('myShiftsSummary');
        if (!summaryBox) return;

        if (!isPublished) {
            summaryBox.innerHTML = `<div style="background: #fff3cd; color: #856404; padding: 10px; border-radius: 8px; border: 1px solid #ffeeba; text-align: center; font-size:0.9em;"><b>סידור העבודה לשבוע הבא טרם פורסם.</b></div>`;
            daysKeys.forEach(d => ['m','e'].forEach(s => {
                const cell = document.getElementById(`emp-cell-${d}-${s}`);
                if(cell) cell.innerHTML = '-';
            }));
            return;
        }

        let myShiftsList = [];
        daysKeys.forEach(dIdx => {
            ['m', 'e'].forEach(shiftType => {
                const key = `${dIdx}-${shiftType}`;
                const cell = document.getElementById(`emp-cell-${key}`);
                if(!cell) return;

                const assigned = publishedSchedule[key] || [];
                const defaultHours = getShiftHours(dIdx, shiftType);
                let html = '';

                assigned.forEach((name, index) => {
                    if(!name) return;
                    const empObj = employees.find(e => e.name === name);
                    const empColor = empObj ? empObj.color : '#74b9ff';
                    const isMe = (name === empName);
                    const customHours = publishedCustomShiftTimes[`${key}-${name}`];
                    const shiftHours = customHours || defaultHours;
                    const isCustom = !!customHours && customHours !== defaultHours;

                    if (isMe) myShiftsList.push(`יום ${daysNames[dIdx]} (${shiftType === 'm' ? 'בוקר' : 'ערב'} ${esc(shiftHours)})`);

                    html += `
                        <div class="emp-container ${isMe ? 'my-shift-highlight' : ''}" style="cursor: default;">
                            <span class="emp-tag" style="background-color: ${esc(empColor)}; cursor: default; pointer-events: none;">${esc(name)} ${isMe ? '⭐' : ''}</span>
                            <div style="margin-top: 2px;">${hoursHtml(shiftHours, isCustom ? 'custom' : '')}</div>
                        </div>`;
                });

                cell.innerHTML = html || '-';
            });
        });

        if (myShiftsList.length > 0) {
            summaryBox.innerHTML = `<div class="my-shifts-box"><h3 style="margin: 0 0 6px 0; color: #0d47a1; font-size:1em;">שלום ${esc(empName)}, שובצת ל-${myShiftsList.length} משמרות השבוע:</h3><ul style="margin: 0; padding-right: 18px; color: #1565c0; font-weight: bold; font-size:0.85em;">${myShiftsList.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
        } else {
            summaryBox.innerHTML = `<div class="my-shifts-box" style="background:#f5f5f5; border-color:#ccc;"><h3 style="margin:0; color:#666; font-size:0.95em;">שלום ${esc(empName)}, לא שובצת למשמרות השבוע.</h3></div>`;
        }
    }

    window.submitEmployeeAvailability = async function() {
        if(!verifiedEmployeeName) return;
        const checkboxes = document.querySelectorAll('#shiftsCheckboxContainer input:not([disabled]):checked');
        let selectedShifts = {};
        checkboxes.forEach(cb => selectedShifts[cb.value] = true);
        const note = document.getElementById('employeeNoteInput').value.trim();

        try {
            await setDoc(doc(getAvailCollection(), verifiedEmployeeName), {
                name: verifiedEmployeeName,
                shifts: selectedShifts,
                note: note,
                updatedAt: Date.now()
            });
            notify("הזמינות עודכנה");
            switchView('selection');
        } catch(e){ notify("שגיאה בשמירה"); }
    };

    window.generateSchedule = async function() {
        if (employees.length === 0) { notify("אין עובדים"); return; }
        let shiftCounts = {};
        employees.forEach(e => shiftCounts[e.name] = 0);
        currentSchedule = {};
        customShiftTimes = {};

        daysKeys.forEach(dIdx => {
            let assignedToday = [];
            let reqMCount = parseInt(document.getElementById('mCount').value);
            if (dIdx === '5') reqMCount = parseInt(document.getElementById('friMCount').value);
            if (dIdx === '6') reqMCount = parseInt(document.getElementById('satMCount').value);

            if (activeShiftsConfig[`${dIdx}-m`] !== false) {
                let morningShift = assignShift(reqMCount, dIdx, 'm', assignedToday, shiftCounts);
                assignedToday.push(...morningShift);
                morningShift.forEach(e => shiftCounts[e.name]++);
                currentSchedule[`${dIdx}-m`] = morningShift.map(e => e.name);
            } else {
                currentSchedule[`${dIdx}-m`] = [];
            }

            let reqECount = parseInt(document.getElementById('eCount').value);
            if (dIdx === '5') reqECount = parseInt(document.getElementById('friECount').value);
            if (dIdx === '6') reqECount = parseInt(document.getElementById('satECount').value);
            
            if (activeShiftsConfig[`${dIdx}-e`] !== false) {
                let eveningShift = assignShift(reqECount, dIdx, 'e', assignedToday, shiftCounts);
                assignedToday.push(...eveningShift);
                eveningShift.forEach(e => shiftCounts[e.name]++);
                currentSchedule[`${dIdx}-e`] = eveningShift.map(e => e.name);
            } else {
                currentSchedule[`${dIdx}-e`] = [];
            }
        });

        await saveDraftToFirestore();
        renderFullScheduleForManager();
        renderSummaryTable();
        renderManagerNotes();
        notify("הטיוטה נשמרה");
    };

    window.publishSchedule = async function() {
        if (!currentSchedule || Object.keys(currentSchedule).length === 0) { notify("אין סידור לפרסום"); return; }
        const currentTimes = readTimesFromInputs();
        try {
            await saveDraftToFirestore();
            await setDoc(getSettingsDoc("published_schedule"), { 
                schedule: currentSchedule,
                times: currentTimes,
                slotTimes: customShiftTimes,
                publishedAt: Date.now()
            });
            notify("הסידור פורסם");
        } catch(e){ notify("שגיאה בפרסום"); }
    };

    window.unpublishSchedule = async function() {
        if (!isPublished) { notify("הסידור לא מפורסם"); return; }
        if (!await askConfirm("לבטל פרסום?")) return;
        try {
            await deleteDoc(getSettingsDoc("published_schedule"));
            notify("הפרסום בוטל");
        } catch(e){ notify("שגיאה בביטול"); }
    };

    window.renderFullScheduleForManager = function() {
        const t = readTimesFromInputs();

        daysKeys.forEach(dIdx => {
            renderShiftCell(dIdx, 'm', hoursFromTimes(t, dIdx, 'm'));
            renderShiftCell(dIdx, 'e', hoursFromTimes(t, dIdx, 'e'));
        });
    };

    function assignShift(requiredCount, dayIdx, shiftType, alreadyAssignedToday, shiftCounts) {
        const key = `${dayIdx}-${shiftType}`;
        let available = employees.filter(e => (employeeAvailMap[e.name] || {})[key]);
        let fresh = available.filter(e => !alreadyAssignedToday.some(a => a.name === e.name));
        let tired = available.filter(e => alreadyAssignedToday.some(a => a.name === e.name));

        const sortEmps = (arr) => {
            arr.sort((a, b) => {
                if (b.rank !== a.rank) return b.rank - a.rank;
                if (shiftCounts[a.name] !== shiftCounts[b.name]) return shiftCounts[a.name] - shiftCounts[b.name];
                return Math.random() - 0.5;
            });
        };
        sortEmps(fresh);
        sortEmps(tired);

        let chosen = fresh.slice(0, requiredCount);
        if (chosen.length < requiredCount && tired.length > 0) {
            chosen.push(...tired.slice(0, requiredCount - chosen.length));
        }
        return chosen;
    }

    function renderShiftCell(dayIdx, shiftType, defaultTime) {
        const key = `${dayIdx}-${shiftType}`;
        const cell = document.getElementById(`cell-${key}`);
        if (!cell) return;

        if (activeShiftsConfig[key] === false) {
            cell.innerHTML = `<span style="color: #aaa; font-size: 0.75em;">לא פעילה השבוע</span>`;
            return;
        }

        const assignedNames = (currentSchedule[key] || []).filter(Boolean);
        
        let reqCount = parseInt(document.getElementById(shiftType === 'm' ? 'mCount' : 'eCount').value);
        if (dayIdx === '5') {
            reqCount = parseInt(document.getElementById(shiftType === 'm' ? 'friMCount' : 'friECount').value);
        }
        if (dayIdx === '6') {
            reqCount = parseInt(document.getElementById(shiftType === 'm' ? 'satMCount' : 'satECount').value);
        }

        let html = '';
        assignedNames.forEach((empName, index) => {
            const emp = employees.find(e => e.name === empName);
            const isAvail = employeeAvailMap[empName]?.[key];
            const empColor = (emp && emp.color) ? emp.color : '#74b9ff';
            const customTime = customShiftTimes[`${key}-${empName}`];
            const slotTime = customTime || defaultTime;
            const isCustom = !!customTime && customTime !== defaultTime;

            html += `
                <div class="emp-container">
                    <span class="emp-tag" style="background-color: ${esc(empColor)}" onclick="openSwapModal('${key}', ${index})">
                        ${esc(empName)}
                    </span>
                    ${!isAvail ? '<div class="unavail-badge">ללא זמינות</div>' : ''}
                    <div>
                        <button type="button" class="time-badge-btn ${isCustom ? 'custom' : ''}" title="שינוי שעות"
                            data-key="${key}" data-time="${esc(slotTime)}" data-name="${esc(empName)}"
                            onclick="openTimeModal(this.dataset.key, this.dataset.name, this.dataset.time)">
                            ${hoursHtml(slotTime)}
                        </button>
                    </div>
                </div>`;
        });

        let maxSlots = Math.max(reqCount, assignedNames.length + 1);
        for (let i = assignedNames.length; i < maxSlots; i++) {
            const isExtra = i >= reqCount;
            html += `
                <div class="empty-slot" style="${isExtra ? 'border-color:#e67e22; color:#d35400; background:#fef5e7;' : ''}" onclick="openSwapModal('${key}', ${i})">
                    + ${isExtra ? 'לאלץ עובד נוסף' : 'שיבוץ עובד'}
                </div>`;
        }
        cell.innerHTML = html;
    }

    window.openSwapModal = function(shiftKey, index) {
        activeSwapKey = shiftKey;
        activeSwapIndex = index;
        const modal = document.getElementById('swapModal');
        const list = document.getElementById('modalEmpList');

        let html = `<button class="modal-emp-btn" style="color:red;" onclick="applySwap(null)"><span>הסר עובד ממשבצת זו</span></button>`;
        employees.forEach((emp) => {
            const isAvail = employeeAvailMap[emp.name]?.[shiftKey];
            html += `
                <button class="modal-emp-btn" data-name="${esc(emp.name)}" onclick="applySwap(this.dataset.name)">
                    <span><strong style="color:${esc(emp.color || '#74b9ff')}">●</strong> ${esc(emp.name)} (רמה ${esc(emp.rank || 1)})</span>
                    <span style="font-size:0.75em; color:${isAvail?'green':'red'}">${isAvail?'זמין':'לא הגיש'}</span>
                </button>`;
        });

        list.innerHTML = html;
        modal.style.display = 'flex';
    };

    window.closeModal = function() { document.getElementById('swapModal').style.display = 'none'; };

    window.applySwap = async function(empName) {
        if(!activeSwapKey) return;
        if(!currentSchedule[activeSwapKey]) currentSchedule[activeSwapKey] = [];

        if (empName === null) {
            const removedName = currentSchedule[activeSwapKey][activeSwapIndex];
            currentSchedule[activeSwapKey].splice(activeSwapIndex, 1);
            if (removedName) delete customShiftTimes[`${activeSwapKey}-${removedName}`];
        } else {
            currentSchedule[activeSwapKey][activeSwapIndex] = empName;
        }
        closeModal();
        await saveDraftToFirestore();
        await syncPublishedIfActive();
        renderFullScheduleForManager();
        renderSummaryTable();
    };

    function renderDailyAvailabilityTable() {
        const tbody = document.getElementById('dailyAvailTableBody');
        if (!tbody) return;

        const tagHtml = (e) => `<span class="emp-tag" style="background-color:${esc(e.color || '#74b9ff')}; font-size:0.75em; margin:2px;">${esc(e.name)} (${esc(e.rank || 1)})</span>`;

        let html = '';
        daysKeys.forEach((dIdx) => {
            const dayName = daysNames[dIdx];
            const mKey = `${dIdx}-m`;
            const eKey = `${dIdx}-e`;

            let morningAvail = employees.filter(e => employeeAvailMap[e.name]?.[mKey]);
            let eveningAvail = employees.filter(e => employeeAvailMap[e.name]?.[eKey]);

            let mHtml = morningAvail.length > 0 ? morningAvail.map(tagHtml).join(' ') : '<span style="color:#aaa; font-size:0.8em;">אין זמינים</span>';
            let eHtml = eveningAvail.length > 0 ? eveningAvail.map(tagHtml).join(' ') : '<span style="color:#aaa; font-size:0.8em;">אין זמינים</span>';

            html += `<tr><td><b>${dayName}</b></td><td style="text-align: right;">${mHtml}</td><td style="text-align: right;">${eHtml}</td></tr>`;
        });
        tbody.innerHTML = html;
    }

    function renderSummaryTable() {
        const tbody = document.getElementById('summaryTableBody');
        const countSummary = document.getElementById('submissionSummaryCount');
        if (!tbody) return;
        
        if (employees.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">אין עובדים במערכת</td></tr>'; return;
        }

        let submittedCount = 0;
        tbody.innerHTML = employees.map((emp) => {
            let userAvail = employeeAvailMap[emp.name] || {};
            let hasSubmitted = Object.values(userAvail).some(val => val === true);
            if (hasSubmitted) submittedCount++;

            let statusHtml = hasSubmitted ? '<span style="color: #27ae60; font-weight: bold; font-size: 1.25em;">✔</span>' : '<span style="color: #e74c3c; font-weight: bold; font-size: 1.25em;">✖</span>';
            let availCount = Object.values(userAvail).filter(Boolean).length;
            let assignedCount = 0;
            Object.values(currentSchedule).forEach(list => { 
                if(Array.isArray(list)) assignedCount += list.filter(name => name === emp.name).length;
            });
            let lastView = emp.lastViewedAt ? `<span style="color:#27ae60; font-size:0.85em; font-weight:bold;">👁️ ${esc(emp.lastViewedAt)}</span>` : `<span style="color:#888; font-size:0.85em;">טרם צפה</span>`;
            
            return `
                <tr>
                    <td><span class="emp-tag" style="background-color:${esc(emp.color || '#74b9ff')}; display:inline-block; margin:0;">${esc(emp.name)}</span></td>
                    <td>${statusHtml}</td>
                    <td><span class="stat-num">${availCount}</span></td>
                    <td><span class="stat-num" style="color:#1877f2;">${assignedCount}</span></td>
                    <td>${lastView}</td>
                </tr>`;
        }).join('');

        if(countSummary) {
            countSummary.innerHTML = `<div style="background: #eef5ff; padding: 8px; border-radius: 6px; margin-bottom: 10px; text-align: center; font-weight: bold; color: #1877f2; font-size: 0.85em;">מילאו זמינות: ${submittedCount} מתוך ${employees.length} עובדים</div>`;
        }
    }

    function renderManagerNotes() {
        const container = document.getElementById('managerNotesContainer');
        if(!container) return;
        let notesHtml = '<h4>הערות עובדים:</h4><ul>';
        let hasNotes = false;
        Object.keys(employeeNotesMap).forEach(name => {
            if(employeeNotesMap[name]) {
                hasNotes = true;
                notesHtml += `<li><strong>${esc(name)}:</strong> ${esc(employeeNotesMap[name])}</li>`;
            }
        });
        container.innerHTML = hasNotes ? notesHtml + '</ul>' : '';
    }

    window.resetScheduleOnly = async function() {
        if(!await askConfirm("למחוק את כל הזמינויות והסידור?")) return;
        try {
            const availSnap = await getDocs(getAvailCollection());
            await Promise.all(availSnap.docs.map(d => deleteDoc(doc(getAvailCollection(), d.id))));
            await deleteDoc(getSettingsDoc("draft_schedule"));
            await deleteDoc(getSettingsDoc("published_schedule"));
            currentSchedule = {}; customShiftTimes = {};
            renderFullScheduleForManager();
            renderSummaryTable();
            notify("הנתונים נמחקו");
        } catch(e){ notify("שגיאה במחיקה"); }
    };

    window.exportToPDF = async function() {
        const btn = document.getElementById('pdfExportBtn');
        btn.disabled = true;
        btn.innerText = "מייצר PDF...";

        const dates = getScheduleDates();
        const daysShort = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
        
        // עדכון התאריכים בכותרות הטבלה של ה-PDF הנסתר
        for(let i=0; i<7; i++) {
            let th = document.getElementById(`pdf-th-${i}`);
            if(th) th.innerHTML = `<b>${daysShort[i]}</b><br><span style="font-size:0.85em; font-weight:normal; color:#555;">${dates[i]}</span>`;
        }
        document.getElementById('pdfSubtitleDates').innerText = `תאריכים: ${dates[0]} - ${dates[6]}`;

        // שעות ברירת המחדל: מהשעות שהמנהל מגדיר כרגע (אם אין ערך, אז מהשעות שפורסמו)
        const inputTimes = readTimesFromInputs();
        const pdfTimes = {};
        TIME_INPUT_IDS.forEach(id => { pdfTimes[id] = inputTimes[id] || publishedTimes[id] || ''; });

        // מילוי נתוני המשמרות לתוך הטבלה הנסתרת - בכל תא מוצגות שעות לכל עובד
        daysKeys.forEach(dIdx => {
            ['m', 'e'].forEach(shiftType => {
                const key = `${dIdx}-${shiftType}`;
                const targetCell = document.getElementById(`pdf-cell-${key}`);
                if(!targetCell) return;

                if (activeShiftsConfig[key] === false) {
                    targetCell.innerHTML = `<div style="color: #aaa; font-size: 16px; text-align: center;">לא פעילה</div>`;
                    return;
                }

                const assignedNames = (currentSchedule[key] || []).filter(Boolean);
                let html = '';
                const defaultTime = hoursFromTimes(pdfTimes, dIdx, shiftType);

                assignedNames.forEach((empName, index) => {
                    const emp = employees.find(e => e.name === empName);
                    const empColor = (emp && emp.color) ? emp.color : '#74b9ff';
                    const customTime = customShiftTimes[`${key}-${empName}`];
                    const slotTime = customTime || defaultTime;
                    const isCustom = !!customTime && customTime !== defaultTime;

                    html += `
                        <div style="background: white; border: 1px solid #bbb; border-radius: 6px; padding: 6px 4px; margin-bottom: 6px; text-align: center;">
                            <div style="display: inline-block; background-color: ${esc(empColor)}; padding: 4px 10px; border-radius: 6px; font-weight: bold; font-size: 20px; color: black; border: 1px solid rgba(0,0,0,0.15);">${esc(empName)}</div>
                            <div style="margin-top: 5px;">${hoursHtml(slotTime, isCustom ? 'custom' : '')}</div>
                        </div>`;
                });
                targetCell.innerHTML = html || '<div style="color:#aaa; font-size:20px; text-align:center;">—</div>';
            });
        });

        const exportContainer = document.getElementById('pdfExportContainer');
        exportContainer.style.display = 'block';

        try {
            const canvas = await html2canvas(exportContainer, { scale: 2, useCORS: true, logging: false });
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('l', 'mm', 'a4'); // A4 לרוחב מלא
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            
            let imgWidth = pageWidth - 16;
            let imgHeight = (canvas.height * imgWidth) / canvas.width;
            
            if (imgHeight > pageHeight - 16) {
                imgHeight = pageHeight - 16;
                imgWidth = (canvas.width * imgHeight) / canvas.height;
            }
            
            const x = (pageWidth - imgWidth) / 2;
            const y = 8;

            pdf.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
            pdf.save('work-schedule.pdf');
        } catch (err) {
            notify("שגיאה בייצוא");
        } finally {
            exportContainer.style.display = 'none';
            btn.disabled = false;
            btn.innerText = "ייצא ל-PDF";
        }
    };

    window.sendScheduleToWhatsapp = function() {
        const dates = getScheduleDates();
        let text = `📋 *סידור עבודה שבועי* 📋\n`;
        
        daysKeys.forEach(dIdx => {
            const dayName = daysNames[dIdx];
            const dateStr = dates[dIdx];
            text += `\n📅 *${dayName} (${dateStr}):*\n`;
            
            ['m', 'e'].forEach(shiftType => {
                const key = `${dIdx}-${shiftType}`;
                if (activeShiftsConfig[key] === false) return;
                const shiftName = shiftType === 'm' ? 'בוקר' : 'ערב';
                const assignedNames = (publishedSchedule[key] || []).filter(Boolean);
                
                if (assignedNames.length > 0) {
                    let defaultTime = getShiftHours(dIdx, shiftType);
                    text += `  • *${shiftName}:*\n`;
                    assignedNames.forEach((name, index) => {
                        const timeStr = publishedCustomShiftTimes[`${key}-${name}`] || defaultTime;
                        text += `    - ${name} (${timeStr})\n`;
                    });
                }
            });
        });

        const encoded = encodeURIComponent(text);
        window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    };


// רישום service worker (מאפשר התקנה כאפליקציה)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
