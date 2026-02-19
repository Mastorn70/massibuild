// ====== STATE ====== //
const state = { 
    laboratori: [], 
    classi: [], 
    professori: [], 
    progetti: [], 
    disponibilita: [], 
    classActivities: [], 
    risultato: [], 
    warnings: [], 
    meta: { lastUpdated: null } 
};

const rulesConfig = { 
    rule1Enable: true, rule1Value: 6, rule1Min: 1, rule1Max: 24,
    rule2Enable: true, rule2Value: 18, rule2Min: 5, rule2Max: 40,
    rule3Enable: true, rule3Value: 2, rule3Min: 1, rule3Max: 8,
    rule4Enable: true, rule4Value: 0,
    rule5Enable: true, rule5Value: 20,
    rule6Enable: true,
    rule7Enable: true, rule7Value: 15,
    rule8Enable: true, rule8Days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    rule9Enable: true, rule9Start: '08:00', rule9End: '14:00',
    rule10Enable: true, rule10Value: 2
};

let selectedClassForProg = null;
const LS_KEY = "pianificatore_v45", RULES_KEY = "pianificatore_rules_v45";

// ====== FILTRI CERCA ====== //
const tableFilters = {
    availability: '',
    matrix: '',
    summary: ''
};

// ====== SORT DISPONIBILITÀ ====== //
const availabilitySort = { key: 'giorno', dir: 'asc' };

function setAvailabilitySort(key) {
    if (availabilitySort.key === key) {
        availabilitySort.dir = availabilitySort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        availabilitySort.key = key;
        availabilitySort.dir = 'asc';
    }
    renderDaysAvailableTable();
}

function getSortValue(d, key) {
    if (!d) return '';
    return (d[key] || '').toString().toLowerCase();
}

// ====== OVERLAP ====== //
function hasActivityOverlap(classe, giorno, oraInizio, oraFine, excludeIndexGlobal = null) {
    const start = timeToMin(oraInizio);
    const end = timeToMin(oraFine);
    const giornoNorm = normalizeDateStr(giorno);

    return state.classActivities.some((a, idx) => {
        if (excludeIndexGlobal !== null && idx === excludeIndexGlobal) return false;
        if (a.classe !== classe || normalizeDateStr(a.giorno) !== giornoNorm) return false;
        if (!a.oraInizio || !a.oraFine) return false;

        const aStart = timeToMin(a.oraInizio);
        const aEnd = timeToMin(a.oraFine);

        return start < aEnd && end > aStart;
    });
}

function getActivityLabName(activityName) {
    const lab = state.laboratori.find(l => l.nome === activityName);
    if (lab) return lab.nome;
    const proj = state.progetti.find(p => p.nome === activityName);
    if (proj && proj.laboratorio) return proj.laboratorio;
    return null;
}

function hasLabOrActivityConflict({ classe, nome, giorno, oraInizio, oraFine, allowOverlap }, excludeIndexGlobal = null) {
    if (!giorno || !oraInizio || !oraFine) return false;
    const start = timeToMin(oraInizio);
    const end = timeToMin(oraFine);
    const labName = getActivityLabName(nome);

    return state.classActivities.some((a, idx) => {
        if (excludeIndexGlobal !== null && idx === excludeIndexGlobal) return false;
        if (normalizeDateStr(a.giorno) !== normalizeDateStr(giorno)) return false;
        if (!a.oraInizio || !a.oraFine) return false;

        const aStart = timeToMin(a.oraInizio);
        const aEnd = timeToMin(a.oraFine);
        if (start >= aEnd || end <= aStart) return false;

        const sameActivity = a.nome === nome;
        const aLab = getActivityLabName(a.nome);
        const sameLab = labName && aLab && labName === aLab;

        if (!sameActivity && !sameLab) return false;

        const allowBoth = !!allowOverlap && !!a.allowOverlap;
        return !allowBoth;
    });
}

function setAvailabilityFilter(val) {
    tableFilters.availability = (val || '').toLowerCase().trim();
    renderDaysAvailableTable();
}

function setMatrixFilter(val) {
    tableFilters.matrix = (val || '').toLowerCase().trim();
    updateMatrixOreDocente();
}

function setSummaryFilter(val) {
    tableFilters.summary = (val || '').toLowerCase().trim();
    renderSummaryTable();
}

// ====== UTILS ====== //
const persist = () => { 
    state.meta.lastUpdated = new Date().toISOString(); 
    localStorage.setItem(LS_KEY, JSON.stringify(state)); 
};

const loadLS = () => { 
    const r = localStorage.getItem(LS_KEY); 
    if(r) try { Object.assign(state, JSON.parse(r)); } catch(e) {} 
};

const timeToMin = t => { 
    const [h,m] = t.split(':').map(Number); 
    return h*60+m; 
};

const minToTime = m => { 
    const h = Math.floor(m/60), n = m%60; 
    return `${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}`; 
};

const genSlots = (s,e) => { 
    const st = timeToMin(s), en = timeToMin(e); 
    const l = []; 
    for(let m=st; m<en; m+=60) l.push({start: minToTime(m), end: minToTime(m+60)}); 
    return l; 
};

function normalizeDateStr(s) {
    if (!s) return s;
    // if format dd/mm/yyyy convert to yyyy-mm-dd
    if (typeof s === 'string' && s.includes('/')) {
        const parts = s.split('/');
        if (parts.length === 3) {
            const dd = parts[0].padStart(2,'0'), mm = parts[1].padStart(2,'0'), yyyy = parts[2];
            return `${yyyy}-${mm}-${dd}`;
        }
    }
    return s;
}

// ====== LIVE JSON ====== //
let liveHandle = null;
let liveIntervalId = null;
let liveEnabled = false;
let liveFileName = '';
let liveLastSaved = '';

const openLiveDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('pianificatore_live', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const storeLiveHandle = async (handle) => {
    const db = await openLiveDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'live');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const getStoredLiveHandle = async () => {
    const db = await openLiveDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('live');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
};

const clearStoredLiveHandle = async () => {
    const db = await openLiveDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('live');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// safe permission check: only requestPermission when allowPrompt === true (i.e. in response to user gesture)
const verifyFilePermission = async (handle, readWrite, allowPrompt = false) => {
  const opts = { mode: readWrite ? 'readwrite' : 'read' };
  try {
    const q = await handle.queryPermission(opts);
    if (q === 'granted') return true;
    if (!allowPrompt) {
      // do not call requestPermission outside user gesture
      return false;
    }
    const r = await handle.requestPermission(opts);
    return r === 'granted';
  } catch (err) {
    console.warn('verifyFilePermission error', err);
    return false;
  }
};

const updateLiveStatus = () => {
    const status = document.getElementById('liveStatus');
    if (!status) return;

    if (!liveEnabled) {
        status.textContent = 'LIVE: off';
        return;
    }

    status.textContent = `LIVE: attivo (${liveFileName || 'file'}) | ultimo salvataggio: ${liveLastSaved || '--:--:--'}`;
};

const updateLiveButtons = (active) => {
    const btn = document.getElementById('liveButton');
    const switchBtn = document.getElementById('liveSwitchButton');
    if (!btn || !switchBtn) return;

    btn.classList.toggle('active', active);
    btn.classList.toggle('pulse', active);
    btn.textContent = active ? '🟢 LIVE' : '🔴 LIVE';
    switchBtn.disabled = !active;
    updateLiveStatus();
};

const loadStateFromLiveFile = async () => {
    if (!liveHandle) return;
    const file = await liveHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return;
    try {
        Object.assign(state, JSON.parse(text));
        renderData();
    } catch (err) {
        alert('❌ JSON non valido nel file LIVE');
    }
};

const saveLiveFile = async () => {
    if (!liveHandle) return;
    const writable = await liveHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();

    const now = new Date();
    liveLastSaved = now.toLocaleTimeString();
    updateLiveStatus();
};

const startLiveSync = () => {
    liveEnabled = true;
    updateLiveButtons(true);
    clearInterval(liveIntervalId);
    liveIntervalId = setInterval(saveLiveFile, 5000);
};

const stopLiveSync = async () => {
    liveEnabled = false;
    updateLiveButtons(false);
    clearInterval(liveIntervalId);
    liveIntervalId = null;
    liveHandle = null;
    liveFileName = '';
    liveLastSaved = '';
    await clearStoredLiveHandle();
    updateLiveStatus();
};

const pickLiveFile = async () => {
    if (!window.showOpenFilePicker) {
        alert('❌ Il browser non supporta File System Access');
        return null;
    }

    const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });

    // this is triggered by user gesture (picker), so allow prompting for permission
    const permitted = await verifyFilePermission(handle, true, true);
    if (!permitted) {
        alert('❌ Permesso negato');
        return null;
    }

    return handle;
};

async function toggleLive() {
    if (liveEnabled) {
        await stopLiveSync();
        return;
    }

    try {
        const handle = await pickLiveFile();
        if (!handle) return;

        liveHandle = handle;
        liveFileName = handle.name || 'file.json';
        await storeLiveHandle(handle);
        await loadStateFromLiveFile();
        startLiveSync();
    } catch (err) {
        // annullato
    }
}

async function switchLiveFile() {
    if (!liveEnabled) return;

    try {
        const handle = await pickLiveFile();
        if (!handle) return;

        liveHandle = handle;
        liveFileName = handle.name || 'file.json';
        await storeLiveHandle(handle);
        await loadStateFromLiveFile();
        await saveLiveFile();
        updateLiveStatus();
    } catch (err) {
        // annullato
    }
}

async function initLiveLink() {
    if (!window.showOpenFilePicker) return;
    const handle = await getStoredLiveHandle();
    if (!handle) return;

    // do not request permission during init (avoids SecurityError); only query
    const permitted = await verifyFilePermission(handle, true, /*allowPrompt=*/ false);
    if (!permitted) {
        console.info('Live file found but permission not granted. Click LIVE to reconnect.');
        return;
    }

    liveHandle = handle;
    liveFileName = handle.name || 'file.json';
    await loadStateFromLiveFile();
    startLiveSync();
}

// ====== REGOLE ====== //
function updateRulesDisplay() {
    const elStatusRule1 = document.getElementById('statusRule1');
    if (elStatusRule1) elStatusRule1.textContent = document.getElementById('rule1Enable').checked ? document.getElementById('rule1Value').value + 'h' : '❌';
    const el2 = document.getElementById('statusRule2');
    if (el2) el2.textContent = document.getElementById('rule2Enable').checked ? document.getElementById('rule2Value').value + 'h' : '❌';
    const el3 = document.getElementById('statusRule3');
    if (el3) el3.textContent = document.getElementById('rule3Enable').checked ? document.getElementById('rule3Value').value + 'h' : '❌';
    const el4 = document.getElementById('statusRule4');
    if (el4) el4.textContent = document.getElementById('rule4Enable').checked ? document.getElementById('rule4Value').value + "'" : '❌';
    const el5 = document.getElementById('statusRule5');
    if (el5) el5.textContent = document.getElementById('rule5Enable').checked ? document.getElementById('rule5Value').value + '%' : '❌';
    const el6 = document.getElementById('statusRule6');
    if (el6) el6.textContent = document.getElementById('rule6Enable').checked ? '✅' : '❌';
    const el7 = document.getElementById('statusRule7');
    if (el7) el7.textContent = document.getElementById('rule7Enable').checked ? document.getElementById('rule7Value').value + '👥' : '❌';
    const daysSelected = [document.getElementById('rule8Mon')?.checked ? 'Lun' : '', document.getElementById('rule8Tue')?.checked ? 'Mar' : '', document.getElementById('rule8Wed')?.checked ? 'Mer' : '', document.getElementById('rule8Thu')?.checked ? 'Gio' : '', document.getElementById('rule8Fri')?.checked ? 'Ven' : '', document.getElementById('rule8Sat')?.checked ? 'Sab' : '', document.getElementById('rule8Sun')?.checked ? 'Dom' : ''].filter(d => d).length;
    const el8 = document.getElementById('statusRule8');
    if (el8) el8.textContent = document.getElementById('rule8Enable').checked ? daysSelected + 'gg' : '❌';
    const el9 = document.getElementById('statusRule9');
    if (el9) el9.textContent = document.getElementById('rule9Enable').checked ? document.getElementById('rule9Start').value.substring(0,2) + '-' + document.getElementById('rule9End').value.substring(0,2) : '❌';
    const el10 = document.getElementById('statusRule10');
    if (el10) el10.textContent = document.getElementById('rule10Enable').checked ? document.getElementById('rule10Value').value + 'h' : '❌';
}

function saveRulesConfig() {
    rulesConfig.rule1Enable = document.getElementById('rule1Enable').checked;
    rulesConfig.rule1Value = Math.max(rulesConfig.rule1Min, Math.min(rulesConfig.rule1Max, Number(document.getElementById('rule1Value').value) || 6));
    rulesConfig.rule1Min = Number(document.getElementById('rule1Min').value) || 1;
    rulesConfig.rule1Max = Number(document.getElementById('rule1Max').value) || 24;
    rulesConfig.rule2Enable = document.getElementById('rule2Enable').checked;
    rulesConfig.rule2Value = Math.max(rulesConfig.rule2Min, Math.min(rulesConfig.rule2Max, Number(document.getElementById('rule2Value').value) || 18));
    rulesConfig.rule2Min = Number(document.getElementById('rule2Min').value) || 5;
    rulesConfig.rule2Max = Number(document.getElementById('rule2Max').value) || 40;
    rulesConfig.rule3Enable = document.getElementById('rule3Enable').checked;
    rulesConfig.rule3Value = Math.max(rulesConfig.rule3Min, Math.min(rulesConfig.rule3Max, Number(document.getElementById('rule3Value').value) || 2));
    rulesConfig.rule3Min = Number(document.getElementById('rule3Min').value) || 1;
    rulesConfig.rule3Max = Number(document.getElementById('rule3Max').value) || 8;
    rulesConfig.rule4Enable = document.getElementById('rule4Enable').checked;
    rulesConfig.rule4Value = Math.max(0, Number(document.getElementById('rule4Value').value) || 0);
    rulesConfig.rule5Enable = document.getElementById('rule5Enable').checked;
    rulesConfig.rule5Value = Math.max(0, Math.min(100, Number(document.getElementById('rule5Value').value) || 20));
    rulesConfig.rule6Enable = document.getElementById('rule6Enable').checked;
    rulesConfig.rule7Enable = document.getElementById('rule7Enable').checked;
    rulesConfig.rule7Value = Math.max(1, Number(document.getElementById('rule7Value').value) || 15);
    rulesConfig.rule8Enable = document.getElementById('rule8Enable').checked;
    rulesConfig.rule8Days = [document.getElementById('rule8Mon').checked ? 'Mon' : '', document.getElementById('rule8Tue').checked ? 'Tue' : '', document.getElementById('rule8Wed').checked ? 'Wed' : '', document.getElementById('rule8Thu').checked ? 'Thu' : '', document.getElementById('rule8Fri').checked ? 'Fri' : '', document.getElementById('rule8Sat').checked ? 'Sat' : '', document.getElementById('rule8Sun').checked ? 'Sun' : ''].filter(d => d);
    rulesConfig.rule9Enable = document.getElementById('rule9Enable').checked;
    rulesConfig.rule9Start = document.getElementById('rule9Start').value || '08:00';
    rulesConfig.rule9End = document.getElementById('rule9End').value || '14:00';
    rulesConfig.rule10Enable = document.getElementById('rule10Enable').checked;
    rulesConfig.rule10Value = Number(document.getElementById('rule10Value').value) || 2;
    localStorage.setItem(RULES_KEY, JSON.stringify(rulesConfig));
    updateRulesDisplay();
    persist();
    alert('✅ Regole salvate!');
}

function resetRulesConfig() {
    rulesConfig.rule1Enable = true; rulesConfig.rule1Value = 6; rulesConfig.rule1Min = 1; rulesConfig.rule1Max = 24;
    rulesConfig.rule2Enable = true; rulesConfig.rule2Value = 18; rulesConfig.rule2Min = 5; rulesConfig.rule2Max = 40;
    rulesConfig.rule3Enable = true; rulesConfig.rule3Value = 2; rulesConfig.rule3Min = 1; rulesConfig.rule3Max = 8;
    rulesConfig.rule4Enable = true; rulesConfig.rule4Value = 0;
    rulesConfig.rule5Enable = true; rulesConfig.rule5Value = 20;
    rulesConfig.rule6Enable = true;
    rulesConfig.rule7Enable = true; rulesConfig.rule7Value = 15;
    rulesConfig.rule8Enable = true; rulesConfig.rule8Days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    rulesConfig.rule9Enable = true; rulesConfig.rule9Start = '08:00'; rulesConfig.rule9End = '14:00';
    rulesConfig.rule10Enable = true; rulesConfig.rule10Value = 2;
    // update DOM if present
    try {
        document.getElementById('rule1Enable').checked = true; document.getElementById('rule1Value').value = '6'; document.getElementById('rule1Min').value = '1'; document.getElementById('rule1Max').value = '24';
        document.getElementById('rule2Enable').checked = true; document.getElementById('rule2Value').value = '18'; document.getElementById('rule2Min').value = '5'; document.getElementById('rule2Max').value = '40';
        document.getElementById('rule3Enable').checked = true; document.getElementById('rule3Value').value = '2'; document.getElementById('rule3Min').value = '1'; document.getElementById('rule3Max').value = '8';
        document.getElementById('rule4Enable').checked = true; document.getElementById('rule4Value').value = '0';
        document.getElementById('rule5Enable').checked = true; document.getElementById('rule5Value').value = '20';
        document.getElementById('rule6Enable').checked = true;
        document.getElementById('rule7Enable').checked = true; document.getElementById('rule7Value').value = '15';
        document.getElementById('rule8Mon').checked = true; document.getElementById('rule8Tue').checked = true; document.getElementById('rule8Wed').checked = true;
        document.getElementById('rule8Thu').checked = true; document.getElementById('rule8Fri').checked = true; document.getElementById('rule8Sat').checked = false; document.getElementById('rule8Sun').checked = false;
        document.getElementById('rule9Start').value = '08:00'; document.getElementById('rule9End').value = '14:00';
        document.getElementById('rule10Enable').checked = true; document.getElementById('rule10Value').value = '2';
    } catch (e) {}
    localStorage.removeItem(RULES_KEY);
    updateRulesDisplay();
    alert('🔄 Regole ripristinate!');
}

function loadRulesConfig() {
    const saved = localStorage.getItem(RULES_KEY);
    if(saved) Object.assign(rulesConfig, JSON.parse(saved));
    try {
        document.getElementById('rule1Enable').checked = rulesConfig.rule1Enable; document.getElementById('rule1Value').value = rulesConfig.rule1Value;
        document.getElementById('rule1Min').value = rulesConfig.rule1Min; document.getElementById('rule1Max').value = rulesConfig.rule1Max;
        document.getElementById('rule2Enable').checked = rulesConfig.rule2Enable; document.getElementById('rule2Value').value = rulesConfig.rule2Value;
        document.getElementById('rule2Min').value = rulesConfig.rule2Min; document.getElementById('rule2Max').value = rulesConfig.rule2Max;
        document.getElementById('rule3Enable').checked = rulesConfig.rule3Enable; document.getElementById('rule3Value').value = rulesConfig.rule3Value;
        document.getElementById('rule3Min').value = rulesConfig.rule3Min; document.getElementById('rule3Max').value = rulesConfig.rule3Max;
        document.getElementById('rule4Enable').checked = rulesConfig.rule4Enable; document.getElementById('rule4Value').value = rulesConfig.rule4Value;
        document.getElementById('rule5Enable').checked = rulesConfig.rule5Enable; document.getElementById('rule5Value').value = rulesConfig.rule5Value;
        document.getElementById('rule6Enable').checked = rulesConfig.rule6Enable;
        document.getElementById('rule7Enable').checked = rulesConfig.rule7Enable; document.getElementById('rule7Value').value = rulesConfig.rule7Value;
        document.getElementById('rule8Enable').checked = rulesConfig.rule8Enable;
        document.getElementById('rule8Mon').checked = rulesConfig.rule8Days.includes('Mon');
        document.getElementById('rule8Tue').checked = rulesConfig.rule8Days.includes('Tue');
        document.getElementById('rule8Wed').checked = rulesConfig.rule8Days.includes('Wed');
        document.getElementById('rule8Thu').checked = rulesConfig.rule8Days.includes('Thu');
        document.getElementById('rule8Fri').checked = rulesConfig.rule8Days.includes('Fri');
        document.getElementById('rule8Sat').checked = rulesConfig.rule8Days.includes('Sat');
        document.getElementById('rule8Sun').checked = rulesConfig.rule8Days.includes('Sun');
        document.getElementById('rule9Enable').checked = rulesConfig.rule9Enable;
        document.getElementById('rule9Start').value = rulesConfig.rule9Start;
        document.getElementById('rule9End').value = rulesConfig.rule9End;
        document.getElementById('rule10Enable').checked = rulesConfig.rule10Enable;
        document.getElementById('rule10Value').value = rulesConfig.rule10Value;
    } catch (e) {}
    updateRulesDisplay();
}

function switchTab(tabName) { 
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active')); 
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active')); 
    const target = document.getElementById(tabName);
    if (target) target.classList.add('active'); 
    const btns = Array.from(document.querySelectorAll('.tab-button'));
    const btn = btns.find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName));
    if (btn) btn.classList.add('active');

    if (tabName === 'tab-planning') {
        const card = document.getElementById('quickFormCard');
        if (card) card.classList.add('collapsed');
        if (typeof run === 'function') run(true);
        if (typeof generatePlanningView === 'function') generatePlanningView();
        // nuova riga: genera anche la vista lab quando si apre il tab planning
        if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    }
}
// ====== Availability Modal: open/save/delete ====== //

function _populateAvailabilitySelects() {
  const profSel = document.getElementById('avProf');
  const labSel = document.getElementById('avLab');
  if (profSel) profSel.innerHTML = '<option value="">-- Nessuno --</option>' + state.professori.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
  if (labSel) labSel.innerHTML = '<option value="">-- Nessuno --</option>' + state.laboratori.map(l => `<option value="${l.nome}">${l.nome}</option>`).join('');
}

// open modal to edit an existing availability (index) or create new (index === null)
function openAvailabilityModal(index = null) {
  const modal = document.getElementById('availabilityEditModal');
  if (!modal) return alert('Modal disponibilità non trovato nel DOM.');

  _populateAvailabilitySelects();

  // store current index on modal element
  modal._currentIdx = (index === undefined ? null : index);

  const title = document.getElementById('availabilityEditTitle');
  const deleteBtn = document.getElementById('avDeleteBtn');
  const avMsg = document.getElementById('avMsg');

  if (index === null) {
    title.textContent = 'Nuova Disponibilità';
    deleteBtn.style.display = 'none';
    document.getElementById('avGiorno').value = '';
    document.getElementById('avProf').value = '';
    document.getElementById('avInizio').value = '';
    document.getElementById('avFine').value = '';
    document.getElementById('avLab').value = '';
  } else {
    title.textContent = 'Modifica Disponibilità';
    deleteBtn.style.display = '';
    const d = state.disponibilita[index];
    if (!d) return alert('Disponibilità non trovata');
    document.getElementById('avGiorno').value = d.giorno || '';
    document.getElementById('avProf').value = d.professore || '';
    document.getElementById('avInizio').value = d.oraInizio || '';
    document.getElementById('avFine').value = d.oraFine || '';
    document.getElementById('avLab').value = d.laboratorio || '';
  }

  if (avMsg) avMsg.textContent = '';
  modal.classList.add('show');
  modal.style.display = 'flex';

  // focus first input
  setTimeout(() => {
    const first = document.getElementById('avGiorno');
    if (first) first.focus();
  }, 50);
}

function closeAvailabilityModal() {
  const modal = document.getElementById('availabilityEditModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal._currentIdx = null;
  const avMsg = document.getElementById('avMsg');
  if (avMsg) avMsg.textContent = '';
}

function saveAvailabilityFromModal() {
  const modal = document.getElementById('availabilityEditModal');
  if (!modal) return;
  const idx = modal._currentIdx;

  const giorno = document.getElementById('avGiorno').value;
  const prof = document.getElementById('avProf').value || null;
  const inizio = document.getElementById('avInizio').value;
  const fine = document.getElementById('avFine').value;
  const lab = document.getElementById('avLab').value || null;
  const avMsg = document.getElementById('avMsg');

  if (!giorno || !inizio || !fine || !prof) {
    if (avMsg) avMsg.textContent = 'Compila Giorno, Inizio, Fine e Professore.';
    return;
  }
  if (inizio >= fine) {
    if (avMsg) avMsg.textContent = 'Orario non valido: Inizio deve essere prima di Fine.';
    return;
  }

  if (idx === null) {
    // add new
    state.disponibilita.push({
      giorno,
      oraInizio: inizio,
      oraFine: fine,
      professore: prof,
      laboratorio: lab || null
    });
  } else {
    // update existing
    if (!state.disponibilita[idx]) {
      if (avMsg) avMsg.textContent = 'Elemento non trovato.';
      return;
    }
    state.disponibilita[idx].giorno = giorno;
    state.disponibilita[idx].oraInizio = inizio;
    state.disponibilita[idx].oraFine = fine;
    state.disponibilita[idx].professore = prof;
    state.disponibilita[idx].laboratorio = lab || null;
  }

  persist();
  renderDaysAvailableTable();
  closeAvailabilityModal();
}

function deleteAvailabilityFromModal() {
  const modal = document.getElementById('availabilityEditModal');
  if (!modal) return;
  const idx = modal._currentIdx;
  if (idx === null || idx === undefined) return;
  if (!confirm('Eliminare questa disponibilità?')) return;
  state.disponibilita.splice(idx, 1);
  persist();
  renderDaysAvailableTable();
  closeAvailabilityModal();
}

// Expose globally for inline onclick usage
window.openAvailabilityModal = openAvailabilityModal;
window.closeAvailabilityModal = closeAvailabilityModal;
window.saveAvailabilityFromModal = saveAvailabilityFromModal;
window.deleteAvailabilityFromModal = deleteAvailabilityFromModal;
// ====== DARK MODE ====== //
function toggleDarkMode() { 
    document.documentElement.classList.toggle('dark-mode'); 
    localStorage.setItem('darkMode', document.documentElement.classList.contains('dark-mode')); 
}

// ====== LABORATORI ====== //
function addLab() { 
    const nome = document.getElementById('labName').value.trim(); 
    const nomeKey = nome.toLowerCase();
    const alunni = Math.max(0, Number(document.getElementById('labAlunni')?.value) || 15);

    if (!nome || state.laboratori.some(l => l.nome.toLowerCase() === nomeKey)) {
        return alert("Nome non valido");
    }

    state.laboratori.push({
        nome,
        owner: null,
        maxOreGiornoLab: rulesConfig.rule3Value,
        alunni
    }); 
    document.getElementById('labName').value = ''; 
    document.getElementById('labAlunni').value = '15';
    updateActivitySelect(); 
    updateLabSelect(); 
    persist(); 
    renderData(); 
}

function updateLabSelect() { 
    const el = document.getElementById('dLab');
    if (!el) return;
    el.innerHTML = '<option value="">-- Nessuno --</option>' + state.laboratori.map(l => `<option value="${l.nome}">${l.nome}</option>`).join(''); 
}

function openLabModal() { 
    const modal = document.getElementById('labModal'); 
    const body = document.getElementById('labModalBody'); 
    if (!modal || !body) return;
    modal.classList.add('show'); 
    modal.style.display = 'flex';
    if(state.laboratori.length === 0) { body.innerHTML = '<p style="opacity:0.5;">Nessun laboratorio</p>'; return; } 
    body.innerHTML = state.laboratori.map((l, i) => `<div class="modal-item"><div id="labDisplay${i}"><div style="display:flex; justify-content:space-between; align-items:center;"><div><strong>${l.nome}</strong> ${l.owner ? `<span class="lab-badge">👨‍🏫 ${l.owner}</span>` : '<span style="color:#ef4444; font-weight:bold;">❌ SENZA OWNER</span>'}<br><small>Alunni: ${l.alunni ?? 15} | Max ore/giorno: ${l.maxOreGiornoLab}h</small></div><div style="display:flex; gap:5px;"><button class="btn-xs" onclick="editLabShow(${i})">✏️</button><button class="btn-xs btn-r" onclick="delLab(${i})">❌</button></div></div></div><div id="labEdit${i}" style="display:none;"><div class="edit-form"><input id="labEditName${i}" type="text" value="${l.nome}"><select id="labEditOwner${i}"><option value="">-- Seleziona Owner --</option>${state.professori.map(p => `<option value="${p.nome}" ${l.owner === p.nome ? 'selected' : ''}>${p.nome}</option>`).join('')}</select><input id="labEditMaxOreGiorno${i}" type="number" value="${l.maxOreGiornoLab}" min="1"><input id="labEditAlunni${i}" type="number" value="${l.alunni ?? 15}" min="0"><div style="display:flex; gap:5px;"><button class="btn-g btn-xs" style="flex:1;" onclick="saveLabEdit(${i})">💾</button><button class="btn-xs" style="flex:1;" onclick="editLabHide(${i})">❌</button></div></div></div></div>`).join(''); 
}

function editLabShow(i) { 
    const disp = document.getElementById(`labDisplay${i}`);
    const edit = document.getElementById(`labEdit${i}`);
    if (disp) disp.style.display = 'none'; 
    if (edit) edit.style.display = 'block'; 
}

function editLabHide(i) { 
    const disp = document.getElementById(`labDisplay${i}`);
    const edit = document.getElementById(`labEdit${i}`);
    if (disp) disp.style.display = 'block'; 
    if (edit) edit.style.display = 'none'; 
}

function saveLabEdit(i) { 
    const nuovoNome = document.getElementById(`labEditName${i}`).value.trim(); 
    const nomeKey = nuovoNome.toLowerCase();

    if (
        !nuovoNome ||
        state.laboratori.some((l, idx) => l.nome.toLowerCase() === nomeKey && idx !== i)
    ) {
        alert("Nome non valido");
        return;
    }

    const nuovoOwner = document.getElementById(`labEditOwner${i}`).value; 
    const nuovoMaxOreGiorno = Number(document.getElementById(`labEditMaxOreGiorno${i}`).value) || 2; 
    const nuovoAlunni = Math.max(0, Number(document.getElementById(`labEditAlunni${i}`).value) || 15);
    const vecchioNome = state.laboratori[i].nome; 
    state.laboratori[i].nome = nuovoNome; 
    state.laboratori[i].owner = nuovoOwner || null; 
    state.laboratori[i].maxOreGiornoLab = nuovoMaxOreGiorno; 
    state.laboratori[i].alunni = nuovoAlunni;
    state.disponibilita.forEach(d => { if(d.laboratorio === vecchioNome) d.laboratorio = nuovoNome; }); 
    if (nuovoOwner) {
        state.disponibilita.forEach(d => {
            if (d.professore === nuovoOwner && !d.laboratorio) {
                d.laboratorio = nuovoNome;
            }
        });
    }
    persist(); 
    openLabModal(); 
}

function delLab(i) { 
    if(!confirm(`Eliminare "${state.laboratori[i].nome}"?`)) return; 
    const labName = state.laboratori[i].nome; 
    state.laboratori.splice(i, 1); 
    state.disponibilita = state.disponibilita.filter(d => d.laboratorio !== labName); 
    persist(); 
    openLabModal(); 
}

function closeLabModal() { 
    const modal = document.getElementById('labModal');
    if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
    renderData(); 
}

// ====== CLASSI ====== //
function addClass() { 
    const nome = document.getElementById('className').value.trim().toUpperCase(); 
    const alunni = Number(document.getElementById('classAlunni').value);

    if (!nome || state.classi.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
        return alert("Nome non valido");
    }
    if (!alunni || alunni < 1) {
        return alert("Numero alunni obbligatorio");
    }

    state.classi.push({nome, alunni, bypassRule7: false}); 
    document.getElementById('className').value = ''; 
    document.getElementById('classAlunni').value = '20';
    persist(); 
    renderData(); 
}

function openClassiModal() { 
    const modal = document.getElementById('classiModal'); 
    const body = document.getElementById('classiModalBody'); 
    if (!modal || !body) return;
    modal.classList.add('show'); modal.style.display = 'flex';
    if(state.classi.length === 0) { body.innerHTML = '<p style="opacity:0.5">Nessuna classe</p>'; return; } 
    body.innerHTML = state.classi.map((c, i) => `<div class="modal-item"><div id="classDisplay${i}"><strong>${c.nome}</strong><br><small>👥 ${c.alunni} alunni ${c.bypassRule7 ? '| ✅ Bypass R7 Limiti alunni' : ''}</small><div style="margin-top:5px;"><button class="btn-xs" onclick="editClassShow(${i})">✏️</button><button class="btn-xs btn-r" onclick="delClass(${i})">❌</button></div></div><div id="classEdit${i}" style="display:none;"><div class="edit-form"><input id="classEditName${i}" type="text" value="${c.nome}"><label>Alunni:</label><input id="classEditAlunni${i}" type="number" value="${c.alunni}" min="1"><div class="checkbox-group"><input type="checkbox" id="classEditBypass${i}" ${c.bypassRule7 ? 'checked' : ''}><label>Bypass Regola 7</label></div><div style="display:flex; gap:5px;"><button class="btn-g btn-xs" style="flex:1;" onclick="saveClassEdit(${i})">💾</button><button class="btn-xs" style="flex:1;" onclick="editClassHide(${i})">❌</button></div></div></div></div>`).join(''); 
}

function editClassShow(i) { 
    const disp = document.getElementById(`classDisplay${i}`);
    const edit = document.getElementById(`classEdit${i}`);
    if (disp) disp.style.display = 'none'; 
    if (edit) edit.style.display = 'block'; 
}

function editClassHide(i) { 
    const disp = document.getElementById(`classDisplay${i}`);
    const edit = document.getElementById(`classEdit${i}`);
    if (disp) disp.style.display = 'block'; 
    if (edit) edit.style.display = 'none'; 
}

function saveClassEdit(i) { 
    const nuovoNome = document.getElementById(`classEditName${i}`).value.trim().toUpperCase(); 
    if (
        !nuovoNome ||
        state.classi.some((c, idx) => c.nome.toLowerCase() === nuovoNome.toLowerCase() && idx !== i)
    ) {
        alert("Nome non valido");
        return;
    }
    const vecchioNome = state.classi[i].nome; 
    state.classi[i].nome = nuovoNome; 
    state.classi[i].alunni = Math.max(1, Number(document.getElementById(`classEditAlunni${i}`).value) || 20); 
    state.classi[i].bypassRule7 = document.getElementById(`classEditBypass${i}`).checked; 
    state.classActivities.forEach(a => { if(a.classe === vecchioNome) a.classe = nuovoNome; }); 
    persist(); 
    openClassiModal(); 
}

function delClass(i) { 
    const classNameToRemove = state.classi[i].nome; 
    if(!confirm(`Eliminare "${classNameToRemove}"?`)) return; 
    state.classi.splice(i, 1); 
    state.classActivities = state.classActivities.filter(a => a.classe !== classNameToRemove); 
    persist(); 
    openClassiModal(); 
}

function closeClassiModal() { 
    const m = document.getElementById('classiModal');
    if (m) { m.classList.remove('show'); m.style.display = 'none'; }
    renderData(); 
}

// ====== PROFESSORI ====== //
function addProf() { 
    const nome = document.getElementById('pNome').value.trim(); 
    const maxGiorno = Number(document.getElementById('pMaxGiorno').value) || rulesConfig.rule1Value; 
    const maxWeek = Number(document.getElementById('pMaxWeek').value) || rulesConfig.rule2Value; 
    if (!nome || state.professori.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
        return alert("Nome non valido");
    }
    state.professori.push({nome, maxOreGiorno: maxGiorno, maxOreSettimana: maxWeek}); 
    document.getElementById('pNome').value = ''; 
    document.getElementById('pMaxGiorno').value = rulesConfig.rule1Value; 
    document.getElementById('pMaxWeek').value = rulesConfig.rule2Value; 
    persist(); 
    renderData(); 
}

function openProfModal() { 
    const modal = document.getElementById('profModal'); 
    const body = document.getElementById('profModalBody'); 
    if (!modal || !body) return;
    modal.classList.add('show'); modal.style.display = 'flex';
    if(state.professori.length === 0) { body.innerHTML = '<p style="opacity:0.5">Nessun professore</p>'; return; } 
    body.innerHTML = state.professori.map((p, i) => `<div class="modal-item"><div id="profDisplay${i}"><strong>${p.nome}</strong><br><small>Max/gg: ${p.maxOreGiorno}h | Max/sett: ${p.maxOreSettimana}h</small><div style="margin-top:5px;"><button class="btn-xs" onclick="editProfShow(${i})">✏️</button><button class="btn-xs btn-r" onclick="delProf(${i})">❌</button></div></div><div id="profEdit${i}" style="display:none;"><div class="edit-form"><input id="profEditName${i}" type="text" value="${p.nome}"><label>Max ore/giorno:</label><input id="profEditMaxGiorno${i}" type="number" value="${p.maxOreGiorno}" min="1"><label>Max ore/settimana:</label><input id="profEditMaxWeek${i}" type="number" value="${p.maxOreSettimana}" min="1"><div style="display:flex; gap:5px;"><button class="btn-g btn-xs" style="flex:1;" onclick="saveProfEdit(${i})">💾</button><button class="btn-xs" style="flex:1;" onclick="editProfHide(${i})">❌</button></div></div></div></div>`).join(''); 
}

function editProfShow(i) { 
    const disp = document.getElementById(`profDisplay${i}`);
    const edit = document.getElementById(`profEdit${i}`);
    if (disp) disp.style.display = 'none'; 
    if (edit) edit.style.display = 'block'; 
}

function editProfHide(i) { 
    const disp = document.getElementById(`profDisplay${i}`);
    const edit = document.getElementById(`profEdit${i}`);
    if (disp) disp.style.display = 'block'; 
    if (edit) edit.style.display = 'none'; 
}

function saveProfEdit(i) { 
    const nuovoNome = document.getElementById(`profEditName${i}`).value.trim(); 
    const nuovoMaxGiorno = Number(document.getElementById(`profEditMaxGiorno${i}`).value) || 6; 
    const nuovoMaxWeek = Number(document.getElementById(`profEditMaxWeek${i}`).value) || 18; 
    if (
        !nuovoNome ||
        state.professori.some((p, idx) => p.nome.toLowerCase() === nuovoNome.toLowerCase() && idx !== i)
    ) {
        alert("Nome non valido");
        return;
    }
    const vecchioNome = state.professori[i].nome; 
    state.professori[i].nome = nuovoNome; 
    state.professori[i].maxOreGiorno = nuovoMaxGiorno; 
    state.professori[i].maxOreSettimana = nuovoMaxWeek; 
    state.disponibilita.forEach(d => { if(d.professore === vecchioNome) d.professore = nuovoNome; }); 
    state.laboratori.forEach(l => { if(l.owner === vecchioNome) l.owner = nuovoNome; }); 
    persist(); 
    openProfModal(); 
}

function delProf(i) { 
    const profName = state.professori[i].nome; 
    if(!confirm(`Eliminare "${profName}"?`)) return; 
    state.professori.splice(i, 1); 
    state.disponibilita = state.disponibilita.filter(d => d.professore !== profName); 
    state.laboratori = state.laboratori.map(l => ({...l, owner: l.owner === profName ? null : l.owner})); 
    persist(); 
    openProfModal(); 
}

function closeProfModal() { 
    const m = document.getElementById('profModal');
    if (m) { m.classList.remove('show'); m.style.display = 'none'; }
    renderData(); 
}

// ====== PROGETTI ====== //
function addProjComplete() { 
    const nome = document.getElementById('prNome').value.trim(); 
    if (!nome || state.progetti.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
        return alert("Nome non valido");
    }
    state.progetti.push({nome}); 
    document.getElementById('prNome').value = ''; 
    persist(); 
    renderData(); 
}

function openProjModal() { 
    const modal = document.getElementById('projModal'); 
    const body = document.getElementById('projModalBody'); 
    if (!modal || !body) return;
    modal.classList.add('show'); modal.style.display = 'flex';
    if(state.progetti.length === 0) { body.innerHTML = '<p style="opacity:0.5">Nessun progetto</p>'; return; } 
    body.innerHTML = state.progetti.map((p, i) => `<div class="modal-item"><div id="projDisplay${i}"><strong>${p.nome}</strong><div style="margin-top:5px;"><button class="btn-xs" onclick="editProjShow(${i})">✏️</button><button class="btn-xs btn-r" onclick="delProj(${i})">❌</button></div></div><div id="projEdit${i}" style="display:none;"><div class="edit-form"><input id="projEditName${i}" type="text" value="${p.nome}"><div style="display:flex; gap:5px;"><button class="btn-g btn-xs" style="flex:1;" onclick="saveProjEdit(${i})">💾</button><button class="btn-xs" style="flex:1;" onclick="editProjHide(${i})">❌</button></div></div></div></div>`).join(''); 
}

function editProjShow(i) { 
    const disp = document.getElementById(`projDisplay${i}`);
    const edit = document.getElementById(`projEdit${i}`);
    if (disp) disp.style.display = 'none'; 
    if (edit) edit.style.display = 'block'; 
}

function editProjHide(i) { 
    const disp = document.getElementById(`projDisplay${i}`);
    const edit = document.getElementById(`projEdit${i}`);
    if (disp) disp.style.display = 'block'; 
    if (edit) edit.style.display = 'none'; 
}

function saveProjEdit(i) { 
    const nuovoNome = document.getElementById(`projEditName${i}`).value.trim(); 
    if (
        !nuovoNome ||
        state.progetti.some((p, idx) => p.nome.toLowerCase() === nuovoNome.toLowerCase() && idx !== i)
    ) {
        alert("Nome non valido");
        return;
    }
    const vecchioNome = state.progetti[i].nome; 
    state.progetti[i].nome = nuovoNome; 
    state.classActivities.forEach(a => { if(a.nome === vecchioNome) a.nome = nuovoNome; }); 
    persist(); 
    openProjModal(); 
}

function delProj(i) { 
    const projNameToRemove = state.progetti[i].nome; 
    if(!confirm(`Eliminare "${projNameToRemove}"?`)) return; 
    state.progetti.splice(i, 1); 
    state.classActivities = state.classActivities.filter(a => a.nome !== projNameToRemove); 
    persist(); 
    openProjModal(); 
}

function closeProjModal() { 
    const m = document.getElementById('projModal');
    if (m) { m.classList.remove('show'); m.style.display = 'none'; }
    renderData(); 
}

// ====== PROGRAMMAZIONE CLASSI ====== //
function loadClassActivities() { 
    selectedClassForProg = document.getElementById('classSelectForProg').value; 
    if(!selectedClassForProg) { 
        const container = document.getElementById('classActivitiesContainer');
        if (container) container.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">Seleziona una classe</p>'; 
        const title = document.getElementById('classActivitiesTitle');
        if (title) title.textContent = 'Attività';
        return; 
    } 
    const title = document.getElementById('classActivitiesTitle');
    if (title) title.textContent = `Attività - ${selectedClassForProg}`; 
    const activities = state.classActivities.filter(a => a.classe === selectedClassForProg); 
    const container = document.getElementById('classActivitiesContainer');
    if (!container) return;
    if(activities.length === 0) { 
        container.innerHTML = '<p style="opacity:0.5; text-align:center; padding:20px;">Nessuna attività</p>'; 
        return; 
    } 
    container.innerHTML = activities.map((a, i) => `<div class="activity-item"><div id="actDisplay${i}"><strong>${a.nome}</strong><br><small>📅 ${a.giorno} | 🕐 ${(a.oraInizio || rulesConfig.rule9Start || '--:--')}-${(a.oraFine || rulesConfig.rule9End || '--:--')}</small>${a.allowOverlap ? '<br><small>⚠️ Consenso sovrapposizione</small>' : ''}${a.allowLabMaxOverride ? '<br><small style="color:#f59e0b">⚠️ Bypass lab max</small>' : ''}<div style="margin-top:5px;"><button class="btn-xs" onclick="editActShow(${i})">✏️</button><button class="btn-xs btn-r" onclick="delClassActivityByIndex(${i})">❌</button></div></div><div id="actEdit${i}" style="display:none;" class="edit-form"><select id="actEditName${i}"><option value="${a.nome}" selected>${a.nome}</option>${[...state.laboratori.map(l => l.nome), ...state.progetti.map(p => p.nome)].filter(n => n !== a.nome).map(n => `<option value="${n}">${n}</option>`).join('')}</select><input id="actEditGiorno${i}" type="date" value="${a.giorno}"><input id="actEditInizio${i}" type="time" value="${a.oraInizio}"><input id="actEditFine${i}" type="time" value="${a.oraFine}"><div class="checkbox-group"><input type="checkbox" id="actEditOverlap${i}" ${a.allowOverlap ? 'checked' : ''}><label>Consenso sovrapposizioni</label></div><div class="checkbox-group"><input type="checkbox" id="actEditAllowLabOverride${i}" ${a.allowLabMaxOverride ? 'checked' : ''}><label>Bypass max ore lab/giorno</label></div><div style="display:flex; gap:5px;"><button class="btn-g btn-xs" style="flex:1;" onclick="saveActEdit(${i})">💾</button><button class="btn-xs" style="flex:1;" onclick="editActHide(${i})">❌</button></div></div></div>`).join(''); 
}

function editActShow(i) { 
    const disp = document.getElementById(`actDisplay${i}`);
    const edit = document.getElementById(`actEdit${i}`);
    if (disp) disp.style.display = 'none'; 
    if (edit) edit.style.display = 'block'; 
}

function editActHide(i) { 
    const disp = document.getElementById(`actDisplay${i}`);
    const edit = document.getElementById(`actEdit${i}`);
    if (disp) disp.style.display = 'block'; 
    if (edit) edit.style.display = 'none'; 
}

function saveActEdit(i) { 
    let count = 0; 
    for(let j = 0; j < state.classActivities.length; j++) { 
        if(state.classActivities[j].classe === selectedClassForProg) { 
            if(count === i) { 
                const newNome = document.getElementById(`actEditName${i}`).value;
                const newGiorno = normalizeDateStr(document.getElementById(`actEditGiorno${i}`).value);

                let newInizio = document.getElementById(`actEditInizio${i}`).value;
                let newFine = document.getElementById(`actEditFine${i}`).value;

                if (!newInizio && rulesConfig.rule9Enable) newInizio = rulesConfig.rule9Start;
                if (!newFine && rulesConfig.rule9Enable) newFine = rulesConfig.rule9End;

                if (!newInizio || !newFine) {
                    alert('Compila gli orari');
                    return;
                }
                if (newInizio >= newFine) {
                    alert('Orario non valido: "Alle" deve essere dopo "Dalle"');
                    return;
                }

                // validation duration vs lab max, consider override
                const durataOre = (timeToMin(newFine) - timeToMin(newInizio)) / 60;
                let activityLab = null;
                const proj = state.progetti.find(p => p.nome === newNome);
                if (proj && proj.laboratorio) activityLab = proj.laboratorio;
                else if (state.laboratori.some(l => l.nome === newNome)) activityLab = newNome;

                const allowLabOverride = document.getElementById(`actEditAllowLabOverride${i}`)?.checked || false;

                if (activityLab && rulesConfig.rule3Enable) {
                    const labItem = state.laboratori.find(l => l.nome === activityLab);
                    if (labItem && typeof labItem.maxOreGiornoLab === 'number' && durataOre > labItem.maxOreGiornoLab && !allowLabOverride) {
                        alert(`❌ Il laboratorio "${activityLab}" ha max ${labItem.maxOreGiornoLab} ore/giorno. Seleziona "Bypass" per forzare.`);
                        return;
                    }
                }

                if (hasActivityOverlap(selectedClassForProg, newGiorno, newInizio, newFine, j)) {
                    alert('⚠️ Orario sovrapposto con un’altra attività della stessa classe e giorno');
                    return;
                }

                const allowOverlap = document.getElementById(`actEditOverlap${i}`).checked;
                if (hasLabOrActivityConflict({
                    classe: selectedClassForProg,
                    nome: newNome,
                    giorno: newGiorno,
                    oraInizio: newInizio,
                    oraFine: newFine,
                    allowOverlap
                }, j)) {
                    alert('⚠️ Conflitto: stessa Attività o stesso Lab nello stesso orario/giorno (serve consenso su entrambe)');
                    return;
                }

                state.classActivities[j].nome = newNome;
                state.classActivities[j].giorno = newGiorno;
                state.classActivities[j].oraInizio = newInizio;
                state.classActivities[j].oraFine = newFine;
                state.classActivities[j].allowOverlap = allowOverlap;
                state.classActivities[j].allowLabMaxOverride = !!allowLabOverride;
                break; 
            } 
            count++; 
        } 
    } 
    persist(); 
    loadClassActivities(); 
    if (document.getElementById('planningWeekStart')?.value) {
        if (typeof generatePlanningView === 'function') generatePlanningView();
        if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    }
}

function addActivityToClass() { 
    if(!selectedClassForProg) return alert('Seleziona una classe'); 
    if(!document.getElementById('actName').value) return alert('Seleziona un\'attività'); 
    if(!document.getElementById('actGiorno').value) return alert('Compila tutti i campi'); 

    let oraInizio = document.getElementById('actOraInizio').value; 
    let oraFine = document.getElementById('actOraFine').value; 

    if(!oraInizio && rulesConfig.rule9Enable) oraInizio = rulesConfig.rule9Start; 
    if(!oraFine && rulesConfig.rule9Enable) oraFine = rulesConfig.rule9End; 
    if(!oraInizio || !oraFine) return alert('Compila gli orari'); 
    if(oraInizio >= oraFine) return alert('Orario non valido: "Alle" deve essere dopo "Dalle"'); 

    const giorno = document.getElementById('actGiorno').value;

    if (hasActivityOverlap(selectedClassForProg, normalizeDateStr(giorno), oraInizio, oraFine)) {
        alert('⚠️ Orario sovrapposto con un’altra attività della stessa classe e giorno');
        return;
    }

    const prof1 = document.getElementById('actProf1')?.value || '';
    const prof2 = document.getElementById('actProf2')?.value || '';
    const allowOverlap = document.getElementById('actAllowOverlap')?.checked || false;
    const allowLabOverride = document.getElementById('actAllowLabOverride')?.checked || false;

    const actNameVal = document.getElementById('actName').value;

    if (hasLabOrActivityConflict({
        classe: selectedClassForProg,
        nome: actNameVal,
        giorno: normalizeDateStr(giorno),
        oraInizio,
        oraFine,
        allowOverlap
    })) {
        alert('⚠️ Conflitto: stessa Attività o stesso Lab nello stesso orario/giorno (serve consenso su entrambe)');
        return;
    }

    // lab duration check
    const durataOre = (timeToMin(oraFine) - timeToMin(oraInizio)) / 60;
    let activityLab = null;
    const proj = state.progetti.find(p => p.nome === actNameVal);
    if (proj && proj.laboratorio) activityLab = proj.laboratorio;
    else if (state.laboratori.some(l => l.nome === actNameVal)) activityLab = actNameVal;

    if (activityLab && rulesConfig.rule3Enable) {
        const labItem = state.laboratori.find(l => l.nome === activityLab);
        if (labItem && typeof labItem.maxOreGiornoLab === 'number' && durataOre > labItem.maxOreGiornoLab && !allowLabOverride) {
            alert(`❌ Il laboratorio "${activityLab}" ha max ${labItem.maxOreGiornoLab} ore/giorno. Seleziona "Bypass" per forzare.`);
            return;
        }
    }

    state.classActivities.push({ 
        classe: selectedClassForProg, 
        nome: actNameVal, 
        giorno: normalizeDateStr(giorno), 
        oraInizio: oraInizio, 
        oraFine: oraFine,
        prof1: prof1 || null,
        prof2: prof2 || null,
        allowOverlap,
        allowLabMaxOverride: !!allowLabOverride
    }); 

    document.getElementById('actName').value = ''; 
    document.getElementById('actGiorno').value = ''; 
    document.getElementById('actOraInizio').value = ''; 
    document.getElementById('actOraFine').value = ''; 
    document.getElementById('actProf1').value = ''; 
    document.getElementById('actProf2').value = ''; 
    document.getElementById('actAllowOverlap').checked = false; 
    try { document.getElementById('actAllowLabOverride').checked = false; } catch(e) {}

    persist(); 
    loadClassActivities(); 
    if (document.getElementById('planningWeekStart')?.value) {
        if (typeof generatePlanningView === 'function') generatePlanningView();
        if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    }
}

function delClassActivityByIndex(index) { 
    if(!confirm('Eliminare questa attività?')) return; 
    let count = 0; 
    for(let i = 0; i < state.classActivities.length; i++) { 
        if(state.classActivities[i].classe === selectedClassForProg) { 
            if(count === index) { 
                state.classActivities.splice(i, 1); 
                break; 
            } 
            count++; 
        } 
    } 
    persist(); 
    loadClassActivities(); 
    if (document.getElementById('planningWeekStart')?.value) {
        if (typeof generatePlanningView === 'function') generatePlanningView();
        if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    }
}

// ====== DISPONIBILITÀ ====== //
function getSelectedAvailabilityDays() {
    const map = [
        { id: 'dDaySun', day: 0 },
        { id: 'dDayMon', day: 1 },
        { id: 'dDayTue', day: 2 },
        { id: 'dDayWed', day: 3 },
        { id: 'dDayThu', day: 4 },
        { id: 'dDayFri', day: 5 },
        { id: 'dDaySat', day: 6 }
    ];
    return map.filter(x => document.getElementById(x.id)?.checked).map(x => x.day);
}

function calcAvailabilityStats(d) {
    if (!d.oraInizio || !d.oraFine) {
        return { disponibili: 0, occupate: 0, saldo: 0 };
    }

    const start = timeToMin(d.oraInizio);
    const end = timeToMin(d.oraFine);
    const disponibili = Math.max(0, (end - start) / 60);

    const occupate = state.risultato.filter(r => {
        if (r.professore !== d.professore) return false;
        if (r.giorno !== d.giorno) return false;
        if (d.laboratorio && r.laboratorio !== d.laboratorio) return false;

        const ora = timeToMin(r.ora);
        return ora >= start && ora < end;
    }).length;

    return {
        disponibili,
        occupate,
        saldo: disponibili - occupate
    };
}

function getDatesBetween(startStr, endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr || startStr);
    if (end < start) return [];
    const dates = [];
    const d = new Date(start);
    while (d <= end) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function autoSelectLabForProf() {
    const prof = document.getElementById('dProf')?.value;
    if (!prof) return;

    const ownedLabs = state.laboratori.filter(l => l.owner === prof);
    const labSelect = document.getElementById('dLab');

    if (ownedLabs.length === 1 && labSelect) {
        labSelect.value = ownedLabs[0].nome;
    }
}

function addDaySlot() { 
    const start = document.getElementById('dGiornoStart').value; 
    const end = document.getElementById('dGiornoEnd').value || start; 
    let s = document.getElementById('dOraInizio').value; 
    let e = document.getElementById('dOraFine').value; 
    const p = document.getElementById('dProf').value; 
    let l = document.getElementById('dLab').value; 

    if(!s && rulesConfig.rule9Enable) s = rulesConfig.rule9Start; 
    if(!e && rulesConfig.rule9Enable) e = rulesConfig.rule9End; 

    if(!start || !s || !e || !p) return alert("Dati mancanti"); 
    if(s >= e) return alert('Orario non valido: "Alle" deve essere dopo "Dalle"'); 

    const selectedDays = getSelectedAvailabilityDays();
    if(selectedDays.length === 0) return alert("Seleziona almeno un giorno");

    if(!l) {
        const owned = state.laboratori.filter(x => x.owner === p);
        if(owned.length === 1) l = owned[0].nome;
    }

    const dates = getDatesBetween(start, end);
    if(dates.length === 0) return alert("Intervallo date non valido");

    let added = 0;
    dates.forEach(dateObj => {
        if(!selectedDays.includes(dateObj.getDay())) return;

        const dateStr = dateObj.toISOString().split('T')[0];
        const exists = state.disponibilita.some(d =>
            d.giorno === dateStr &&
            d.oraInizio === s &&
            d.oraFine === e &&
            d.professore === p &&
            (d.laboratorio || '') === (l || '')
        );
        if(exists) return;

        state.disponibilita.push({
            giorno: dateStr,
            oraInizio: s,
            oraFine: e,
            professore: p,
            laboratorio: l || null
        });
        added++;
    });

    if(added === 0) {
        alert("Nessuna disponibilità aggiunta (duplicati o giorni esclusi)");
        return;
    }

    document.getElementById('dGiornoStart').value = ''; 
    document.getElementById('dGiornoEnd').value = ''; 
    document.getElementById('dOraInizio').value = ''; 
    document.getElementById('dOraFine').value = ''; 
    document.getElementById('dProf').value = ''; 
    document.getElementById('dLab').value = ''; 

    persist(); 
    renderDaysAvailableTable(); 
}

function renderDaysAvailableTable() { 
    const tbl = document.getElementById('tblDaysAvailable'); 
    const term = tableFilters.availability;

    if (!tbl) return;

    let list = state.disponibilita.map((d, idx) => ({ d, idx, placeholder: false }));

    const profNoAvail = state.professori.filter(p => !state.disponibilita.some(d => d.professore === p.nome));
    profNoAvail.forEach(p => {
        list.push({
            d: {
                giorno: '',
                professore: p.nome,
                oraInizio: '',
                oraFine: '',
                laboratorio: null
            },
            idx: null,
            placeholder: true
        });
    });

    if (term) {
        list = list.filter(({ d }) => {
            const hay = `${d.giorno} ${d.professore} ${d.oraInizio} ${d.oraFine} ${d.laboratorio || ''}`.toLowerCase();
            return hay.includes(term);
        });
    }

    list.sort((a, b) => {
        const v1 = getSortValue(a.d, availabilitySort.key);
        const v2 = getSortValue(b.d, availabilitySort.key);
        if (v1 < v2) return availabilitySort.dir === 'asc' ? -1 : 1;
        if (v1 > v2) return availabilitySort.dir === 'asc' ? 1 : -1;
        return 0;
    });

    if(list.length === 0) { 
        tbl.innerHTML = '<tr><td colspan="9" style="text-align:center; opacity:0.5;">Nessun risultato</td></tr>'; 
        return; 
    } 

    tbl.innerHTML = list.map(({ d, idx, placeholder }) => {
        const stats = calcAvailabilityStats(d);
        const saldoColor = stats.saldo < 0 ? '#ef4444' : '#10b981';

        return `<tr>
            <td>${d.giorno || '-'}</td>
            <td>${d.professore || '-'}</td>
            <td>${d.oraInizio || '-'}</td>
            <td>${d.oraFine || '-'}</td>
            <td>${d.laboratorio ? `<span class="lab-badge">${d.laboratorio}</span>` : '-'}</td>
            <td style="text-align:center; font-weight:600;">${stats.disponibili}h</td>
            <td style="text-align:center; font-weight:600;">${stats.occupate}h</td>
            <td style="text-align:center; font-weight:700; color:${saldoColor};">${stats.saldo}h</td>
            <td>${placeholder ? '-' : `<button class="btn-xs" onclick="openAvailabilityModal(${idx})">✏️</button><button class="btn-xs btn-r" onclick="delDay(${idx})">❌</button>`}</td>
        </tr>`;
    }).join(''); 
}

function delDay(i) { 
    if(!confirm('Eliminare?')) return; 
    state.disponibilita.splice(i, 1); 
    persist(); 
    renderDaysAvailableTable(); 
}

// ====== ACTIVITY SELECT ====== //
function updateActivitySelect() { 
    const items = [...state.laboratori.map(l => ({name: l.nome, type: 'laboratorio'})), ...state.progetti.map(p => ({name: p.nome, type: 'progetto'}))]; 
    const el = document.getElementById('actName');
    if (!el) return;
    el.innerHTML = '<option value="">-- Seleziona --</option>' + items.map(p => `<option value="${p.name}">${p.type === 'laboratorio' ? '🔬' : '📚'} ${p.name}</option>`).join(''); 
}

function updateProfessorSelects() {
    const options = '<option value="">-- Nessuno --</option>' +
        state.professori.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');

    const actProf1 = document.getElementById('actProf1');
    const actProf2 = document.getElementById('actProf2');
    const quickProf1 = document.getElementById('quickProf1');
    const quickProf2 = document.getElementById('quickProf2');

    if (actProf1) actProf1.innerHTML = options;
    if (actProf2) actProf2.innerHTML = options;
    if (quickProf1) quickProf1.innerHTML = options;
    if (quickProf2) quickProf2.innerHTML = options;
}

// ====== RENDER ====== //
function renderData() { 
    const repLab = document.getElementById('repLabCount');
    if (repLab) repLab.textContent = state.laboratori.length; 
    const repClass = document.getElementById('repClassCount');
    if (repClass) repClass.textContent = state.classi.length; 
    const repProf = document.getElementById('repProfCount');
    if (repProf) repProf.textContent = state.professori.length; 
    const repProj = document.getElementById('repProjCount');
    if (repProj) repProj.textContent = state.progetti.length; 
    const repAct = document.getElementById('repActCount');
    if (repAct) repAct.textContent = state.classActivities.length; 
    const repAvail = document.getElementById('repAvailCount');
    if (repAvail) repAvail.textContent = state.disponibilita.length; 
    const classSelect = document.getElementById('classSelectForProg');
    if (classSelect) classSelect.innerHTML = '<option value="">-- Scegli Classe --</option>' + state.classi.map(c => `<option value="${c.nome}">${c.nome}</option>`).join(''); 
    const dProf = document.getElementById('dProf');
    if (dProf) dProf.innerHTML = '<option value="">Seleziona...</option>' + state.professori.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
    updateLabSelect(); 
    renderDaysAvailableTable(); 
    updateActivitySelect(); 
    updateProfessorSelects();
    const today = new Date(); 
    const monday = new Date(today); 
    monday.setDate(today.getDate() - today.getDay() + 1); 
    const planStart = document.getElementById('planningWeekStart');
    if (planStart) planStart.value = monday.toISOString().split('T')[0];
    const labStart = document.getElementById('labPlanningWeekStart');
    if (labStart) labStart.value = monday.toISOString().split('T')[0];
    if (rulesConfig.rule9Enable) {
        if (!document.getElementById('actOraInizio')?.value) document.getElementById('actOraInizio').value = rulesConfig.rule9Start;
        if (!document.getElementById('actOraFine')?.value) document.getElementById('actOraFine').value = rulesConfig.rule9End;
        if (!document.getElementById('dOraInizio')?.value) document.getElementById('dOraInizio').value = rulesConfig.rule9Start;
        if (!document.getElementById('dOraFine')?.value) document.getElementById('dOraFine').value = rulesConfig.rule9End;
    }
    if (typeof run === 'function') {
        run(true);
    } else {
        setTimeout(() => {
            if (typeof run === 'function') run(true);
        }, 0);
    }
}

// ====== EXPORT ====== //
function exportJSON() { 
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type: "application/json"})); 
    a.download = "pianificatore.json"; 
    a.click(); 
}
function resetMemory() {
    if (!confirm('Azzerare tutta la memoria salvata?')) return;

    state.laboratori = [];
    state.classi = [];
    state.professori = [];
    state.progetti = [];
    state.disponibilita = [];
    state.classActivities = [];
    state.risultato = [];
    state.warnings = [];
    state.meta = { lastUpdated: null };

    localStorage.removeItem(LS_KEY);

    renderData();
    alert('✅ Memoria azzerata');
}

// restore resetAssegnazioni()
function resetAssegnazioni() {
    if (!confirm('Resettare tutte le assegnazioni?')) return;

    state.risultato = [];
    state.warnings = [];
    persist();

    if (typeof run === 'function') run(false);
    if (typeof generatePlanningView === 'function') generatePlanningView();
    if (typeof generateLabPlanningView === 'function') generateLabPlanningView();

    alert('✅ Assegnazioni azzerate');
}

function exportCSV() { 
    if(!state.risultato.length) return alert("Nessun dato da esportare"); 
    const csv = "Giorno,Ora,Professore,Attività,Classe,Lab\n" + state.risultato.map(r => `${r.giorno},${r.ora},${r.professore},${r.attivita},${r.classe},${r.laboratorio||''}`).join('\n'); 
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(new Blob([csv], {type: "text/csv"})); 
    a.download = "pianificatore.csv"; 
    a.click(); 
}

function importJSONFile() { 
    const f = document.getElementById('jsonFileInput').files?.[0]; 
    if(f) { 
        const reader = new FileReader(); 
        reader.onload = e => { 
            try { 
                Object.assign(state, JSON.parse(e.target.result)); 
                renderData(); 
                alert('✅ File importato'); 
            } catch(err) { 
                alert('❌ Errore'); 
            } 
        }; 
        reader.readAsText(f); 
    } 
}

// ====== INIT ====== //
loadLS(); 
loadRulesConfig(); 
if(localStorage.getItem('darkMode') === 'true') { 
    document.documentElement.classList.add('dark-mode'); 
} 
renderData();
initLiveLink();

// ====== IMPORT EXCEL CON PREVIEW: Professori (ENHANCED) ====== //
// Requires SheetJS (XLSX) included in index.html before this script.

function triggerImportProfExcel() {
    const inp = document.getElementById('profExcelInput');
    if (!inp) {
        alert('Input file per Excel non trovato.');
        return;
    }
    inp.value = null;
    inp.click();
}

function handleProfExcelFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = e.target.result;
        let workbook;
        try {
            workbook = XLSX.read(data, { type: 'array' });
        } catch (err) {
            alert('Errore lettura file Excel: ' + err.message);
            return;
        }

        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];

        // raw array rows (header-agnostic)
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (!rawRows || rawRows.length === 0) {
            alert('Foglio vuoto o non leggibile.');
            return;
        }

        // Build preview data: array of { originalCells: [...], suggestedName: string, availability, ownerLab }
        const preview = buildProfPreviewData(rawRows);

        if (!preview.length) {
            alert('Nessuna riga valida trovata nel file.');
            return;
        }

        openProfImportModal(preview, file.name);
        // ensure modal buttons attached
        setTimeout(attachProfImportModalButtons, 30);
    };

    reader.readAsArrayBuffer(file);
}

// ====== IMPORT: Enhanced preview with column mapping ====== //

function tryParseDateToISO(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  // already iso yyyy-mm-dd?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy -> yyyy-mm-dd
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  // try Date parsing (fallback)
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
  return null;
}
function buildProfPreviewData(rawRows) {
  const preview = [];
  if (!rawRows || rawRows.length === 0) return preview;

  // detect header row (as before)
  const first = (rawRows[0] || []).map(c => (c === null || c === undefined) ? '' : String(c).trim().toLowerCase()).filter(Boolean).join(' ');
  let startIdx = 0;
  let headerMap = null;

  const headerKeywords = {
    name: ['nome','fullname','nome completo','cognome','nome e cognome','full name'],
    day: ['giorno','date','data','day'],
    start: ['inizio','ora inizio','start','ora_start','orainizio','from'],
    end: ['fine','ora fine','end','ora_end','orafine','to'],
    orari: ['orari','orario','orario_range','orario/ora','orario -','orario_range'],
    ownerLab: ['labowner','ownerlab','laboratorio_owner','lab_owner','owner','lab owner','laboratorio']
  };

  if (first && (first.includes('nome') || first.includes('cognom') || first.includes('full') || first.includes('nome completo'))) {
    startIdx = 1;
    const headers = rawRows[0].map(h => (h === null || h === undefined) ? '' : String(h).trim().toLowerCase());
    headerMap = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      if (headerKeywords.name.some(k => h.includes(k))) headerMap.name = idx;
      if (headerKeywords.day.some(k => h.includes(k))) headerMap.day = idx;
      if (headerKeywords.start.some(k => h.includes(k))) headerMap.start = idx;
      if (headerKeywords.end.some(k => h.includes(k))) headerMap.end = idx;
      if (headerKeywords.orari.some(k => h.includes(k))) headerMap.orari = idx;
      if (headerKeywords.ownerLab.some(k => h.includes(k))) headerMap.ownerLab = idx;
    });
  }

  // helpers
  const pad = s => String(s).padStart(2,'0');
  const toHHMM = (hours, minutes=0) => `${pad(hours)}:${pad(minutes)}`;

  function fromExcelTime(val) {
    // if val is number between 0 and 1 -> fraction of day
    if (typeof val === 'number' && val > 0 && val < 1) {
      const minutes = Math.round(val * 24 * 60);
      return toHHMM(Math.floor(minutes/60), minutes%60);
    }
    // if integer in [0..24] -> treat as hour
    if (typeof val === 'number' && Number.isFinite(val)) {
      const h = Math.floor(val);
      const m = Math.round((val - h) * 60);
      if (m === 0) return toHHMM(h, 0);
      return toHHMM(h, m);
    }
    return null;
  }

  function parseTimeToken(token) {
    if (token === null || token === undefined) return null;
    if (token instanceof Date) {
      const h = token.getHours(), m = token.getMinutes();
      return toHHMM(h, m);
    }
    if (typeof token === 'number') return fromExcelTime(token);
    const s = String(token).trim();
    if (!s) return null;
    // formats: 08:00, 8:00, 0800, 8.00, 8, 8.5
    // replace comma with dot
    const normalized = s.replace(',', '.').replace(/\s+/g,'');
    // hh:mm
    const m1 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (m1) return toHHMM(Number(m1[1]), Number(m1[2]));
    // hhmm
    const m2 = normalized.match(/^(\d{1,2})(\d{2})$/);
    if (m2) return toHHMM(Number(m2[1]), Number(m2[2]));
    // decimal hours e.g. 8.5
    const m3 = normalized.match(/^(\d{1,2})(\.\d+)$/);
    if (m3) {
      const h = Number(m3[1]);
      const dec = Number(m3[2]);
      const minutes = Math.round(dec * 60);
      return toHHMM(h, minutes);
    }
    // integer hour '8' or '08'
    const m4 = normalized.match(/^(\d{1,2})$/);
    if (m4) return toHHMM(Number(m4[1]), 0);
    return null;
  }

  function parseOrariRange(s) {
    if (s === null || s === undefined) return null;
    if (s instanceof Date) return null;
    if (typeof s === 'number') return null;
    const txt = String(s).trim();
    // patterns like 08:00-10:00 or 8-10 or 08.00 - 10.00
    const m = txt.match(/^\s*(\d{1,2}[:.,]?\d{0,2})\s*[-–]\s*(\d{1,2}[:.,]?\d{0,2})\s*$/);
    if (m) {
      const a = parseTimeToken(m[1]);
      const b = parseTimeToken(m[2]);
      if (a && b) return { start: a, end: b };
    }
    return null;
  }

  // if header not present, we will attempt heuristic detection of time columns per row
  for (let i = startIdx; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    // keep original cell values (no forced string)
    const cells = row.slice();

    // skip entirely empty rows
    if (cells.every(c => c === '' || c === null || c === undefined)) continue;

    // suggested name
    const nonEmptyStr = cells.map(c => (c === null || c === undefined) ? '' : String(c).trim()).filter(Boolean);
    let suggested = '';
    if (headerMap && headerMap.name !== undefined) {
      suggested = String(cells[headerMap.name] || '').trim();
    } else {
      if (nonEmptyStr.length === 1) suggested = nonEmptyStr[0];
      else if (nonEmptyStr.length === 2) suggested = `${nonEmptyStr[1]} ${nonEmptyStr[0]}`.trim();
      else if (nonEmptyStr.length > 2) suggested = `${nonEmptyStr.slice(0, nonEmptyStr.length - 1).join(' ')} ${nonEmptyStr[nonEmptyStr.length - 1]}`.trim();
    }

    let avail = null;
    let ownerLab = '';

    if (headerMap) {
      const dayRaw = headerMap.day !== undefined ? cells[headerMap.day] : '';
      const startRaw = headerMap.start !== undefined ? cells[headerMap.start] : '';
      const endRaw = headerMap.end !== undefined ? cells[headerMap.end] : '';
      const orariRaw = headerMap.orari !== undefined ? cells[headerMap.orari] : '';
      const ownerRaw = headerMap.ownerLab !== undefined ? cells[headerMap.ownerLab] : '';

      const dayIso = tryParseDateToISO(dayRaw);

      // priority: orari range -> startRaw/endRaw -> try guess in row
      let startTime = null, endTime = null;
      if (orariRaw) {
        const pr = parseOrariRange(orariRaw);
        if (pr) { startTime = pr.start; endTime = pr.end; }
      }
      if (!startTime && startRaw !== undefined) startTime = parseTimeToken(startRaw);
      if (!endTime && endRaw !== undefined) endTime = parseTimeToken(endRaw);

      // if still missing, try search in other cells for time tokens
      if (!startTime || !endTime) {
        for (let c of cells) {
          if (startTime && endTime) break;
          const pr = parseOrariRange(c);
          if (pr && (!startTime || !endTime)) {
            startTime = startTime || pr.start;
            endTime = endTime || pr.end;
            continue;
          }
          const t = parseTimeToken(c);
          if (t) {
            if (!startTime) startTime = t;
            else if (!endTime) endTime = t;
          }
        }
      }

      if (dayIso) {
        const sTime = startTime || rulesConfig.rule9Start;
        const eTime = endTime || rulesConfig.rule9End;
        if (sTime && eTime) avail = { giorno: dayIso, oraInizio: sTime, oraFine: eTime };
      }

      if (ownerRaw) ownerLab = String(ownerRaw).trim();
    } else {
      // no header: try heuristics: look for a date cell and times in row
      let dayIso = null;
      let startTime = null, endTime = null;

      for (let c of cells) {
        if (!dayIso) {
          const d = tryParseDateToISO(c);
          if (d) { dayIso = d; continue; }
          if (c instanceof Date && !isNaN(c.getTime())) { dayIso = c.toISOString().split('T')[0]; continue; }
        }
        if (!startTime || !endTime) {
          const pr = parseOrariRange(c);
          if (pr) { startTime = startTime || pr.start; endTime = endTime || pr.end; continue; }
          const t = parseTimeToken(c);
          if (t) {
            if (!startTime) startTime = t;
            else if (!endTime) endTime = t;
          }
        }
      }

      if (dayIso) {
        const sTime = startTime || rulesConfig.rule9Start;
        const eTime = endTime || rulesConfig.rule9End;
        if (sTime && eTime) avail = { giorno: dayIso, oraInizio: sTime, oraFine: eTime };
      }
    }

    preview.push({
      originalCells: cells.map(c => (c === null || c === undefined) ? '' : c),
      suggestedName: suggested || nonEmptyStr.join(' '),
      include: true,
      status: '',
      availability: avail,
      ownerLab: ownerLab || ''
    });
  }

  return preview;
}

function openProfImportModal(previewData, filename) {
  const tbody = document.getElementById('profImportTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  previewData.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.index = idx;
    tr.style.borderBottom = '1px solid var(--border)';

    // checkbox
    const tdCheck = document.createElement('td');
    tdCheck.style.textAlign = 'center';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!item.include;
    chk.style.width = '18px';
    chk.onchange = () => item.include = chk.checked;
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    // name editable
    const tdName = document.createElement('td');
    const inpName = document.createElement('input');
    inpName.type = 'text';
    inpName.value = item.suggestedName || '';
    inpName.id = `profNameInput_${idx}`;
    inpName.style.width = '140px';
    inpName.oninput = () => { item.suggestedName = inpName.value.trim(); updatePreviewStatus(previewData); updateImportSummary(previewData); };
    tdName.appendChild(inpName);
    tr.appendChild(tdName);

    // original raw preview
    const tdOrig = document.createElement('td');
    tdOrig.textContent = item.originalCells.filter(c => c).join('  |  ');
    tdOrig.style.maxWidth = '240px';
    tdOrig.style.overflow = 'hidden';
    tdOrig.style.textOverflow = 'ellipsis';
    tdOrig.style.whiteSpace = 'nowrap';
    tr.appendChild(tdOrig);

    // day (date input)
    const tdDay = document.createElement('td');
    const inpDay = document.createElement('input');
    inpDay.type = 'date';
    inpDay.id = `profDayInput_${idx}`;
    inpDay.value = item.availability && item.availability.giorno ? item.availability.giorno : '';
    inpDay.onchange = () => { item.availability = item.availability || {}; item.availability.giorno = inpDay.value; updateImportSummary(previewData); };
    tdDay.appendChild(inpDay);
    tr.appendChild(tdDay);

    // start time
    const tdStart = document.createElement('td');
    const inpStart = document.createElement('input');
    inpStart.type = 'time';
    inpStart.id = `profStartInput_${idx}`;
    inpStart.value = item.availability && item.availability.oraInizio ? item.availability.oraInizio : '';
    inpStart.onchange = () => { item.availability = item.availability || {}; item.availability.oraInizio = inpStart.value; updateImportSummary(previewData); };
    tdStart.appendChild(inpStart);
    tr.appendChild(tdStart);

    // end time
    const tdEnd = document.createElement('td');
    const inpEnd = document.createElement('input');
    inpEnd.type = 'time';
    inpEnd.id = `profEndInput_${idx}`;
    inpEnd.value = item.availability && item.availability.oraFine ? item.availability.oraFine : '';
    inpEnd.onchange = () => { item.availability = item.availability || {}; item.availability.oraFine = inpEnd.value; updateImportSummary(previewData); };
    tdEnd.appendChild(inpEnd);
    tr.appendChild(tdEnd);

    // owner lab
    const tdOwner = document.createElement('td');
    const inpOwner = document.createElement('input');
    inpOwner.type = 'text';
    inpOwner.id = `profOwnerInput_${idx}`;
    inpOwner.value = item.ownerLab || '';
    inpOwner.placeholder = 'Lab (opz.)';
    inpOwner.style.width = '120px';
    inpOwner.oninput = () => { item.ownerLab = inpOwner.value.trim(); updateImportSummary(previewData); };
    tdOwner.appendChild(inpOwner);
    tr.appendChild(tdOwner);

    // status
    const tdStatus = document.createElement('td');
    tdStatus.style.textAlign = 'center';
    tdStatus.style.color = '#6b7280';
    tdStatus.id = `profStatus_${idx}`;
    tdStatus.textContent = '';
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });

  // check duplicates and set statuses
  updatePreviewStatus(previewData);
  updateImportSummary(previewData);

  // show modal
  const modal = document.getElementById('profImportModal');
  if (!modal) return;
  const content = modal.querySelector('.modal-content');
  modal.classList.add('show');
  modal.style.display = 'flex';
  if (content) content.style.display = 'block';
  modal._previewData = previewData;

  const summaryEl = document.getElementById('profImportSummary');
  if (summaryEl) summaryEl.textContent = `File: ${filename || ''} — righe: ${previewData.length}`;

  // focus first name input
  const firstInput = document.getElementById('profNameInput_0');
  if (firstInput) firstInput.focus();
}

function updatePreviewStatus(previewData) {
  const tbody = document.getElementById('profImportTableBody');
  if (!tbody) return;
  previewData.forEach((item, idx) => {
    const statusCell = document.getElementById(`profStatus_${idx}`);
    const name = (item.suggestedName || '').trim();
    if (!name) {
      if (statusCell) { statusCell.textContent = '⚠ vuoto'; statusCell.style.color = '#f59e0b'; }
      item.status = 'empty';
      return;
    }
    const exists = state.professori.some(p => p.nome.trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      if (statusCell) { statusCell.textContent = '⛔ duplicato'; statusCell.style.color = '#ef4444'; }
      item.status = 'duplicate';
      return;
    }
    // basic availability validation if present
    if (item.availability && item.availability.giorno) {
      const g = tryParseDateToISO(item.availability.giorno) || item.availability.giorno;
      const s = item.availability.oraInizio || '';
      const e = item.availability.oraFine || '';
      if (!g || (!s && rulesConfig.rule9Enable && !rulesConfig.rule9Start) || (s && e && s >= e)) {
        if (statusCell) { statusCell.textContent = '⚠ avail'; statusCell.style.color = '#f59e0b'; }
        item.status = 'invalid_availability';
        return;
      }
    }
    if (statusCell) { statusCell.textContent = '✔ ok'; statusCell.style.color = '#10b981'; }
    item.status = 'ok';
  });

  updateImportSummary(previewData);
}

function updateImportSummary(previewData) {
  const total = previewData.length;
  const toImport = previewData.filter((p, i) => {
    // include checkbox + name non-empty + not duplicate
    return p.include && (p.suggestedName || '').trim() && p.status !== 'duplicate';
  }).length;
  const duplicates = previewData.filter(p => p.include && p.status === 'duplicate').length;
  const invalid = previewData.filter(p => p.include && (p.status === 'empty' || p.status === 'invalid_availability')).length;
  const s = document.getElementById('profImportSummary');
  if (s) s.textContent = `Selezionate: ${toImport}/${total} — duplicati: ${duplicates} — non validi: ${invalid}`;
}

function importProfFromPreview() {
  const modal = document.getElementById('profImportModal');
  if (!modal || !modal._previewData) return;

  const previewData = modal._previewData;
  let added = 0, skipped = 0, invalid = 0;

  previewData.forEach((item, idx) => {
    if (!item.include) return;
    // read latest values from inputs (in case user edited)
    const nameEl = document.getElementById(`profNameInput_${idx}`);
    const dayEl = document.getElementById(`profDayInput_${idx}`);
    const startEl = document.getElementById(`profStartInput_${idx}`);
    const endEl = document.getElementById(`profEndInput_${idx}`);
    const ownerEl = document.getElementById(`profOwnerInput_${idx}`);

    const fullname = nameEl ? nameEl.value.trim() : (item.suggestedName || '').trim();
    if (!fullname) { invalid++; return; }
    const exists = state.professori.some(p => p.nome.trim().toLowerCase() === fullname.toLowerCase());
    if (exists) { skipped++; return; }

    // add professor
    state.professori.push({
      nome: fullname,
      maxOreGiorno: rulesConfig.rule1Value,
      maxOreSettimana: rulesConfig.rule2Value
    });

    // availability
    const dayVal = dayEl ? dayEl.value : (item.availability && item.availability.giorno ? item.availability.giorno : '');
    const startVal = startEl ? startEl.value : (item.availability && item.availability.oraInizio ? item.availability.oraInizio : '');
    const endVal = endEl ? endEl.value : (item.availability && item.availability.oraFine ? item.availability.oraFine : '');
    const dayIso = tryParseDateToISO(dayVal) || dayVal;

    if (dayIso && (startVal || rulesConfig.rule9Enable) && (endVal || rulesConfig.rule9Enable)) {
      const sTime = startVal || rulesConfig.rule9Start;
      const eTime = endVal || rulesConfig.rule9End;
      // avoid duplicates
      const dup = state.disponibilita.some(d =>
        d.giorno === dayIso && d.oraInizio === sTime && d.oraFine === eTime && d.professore === fullname
      );
      if (!dup) {
        state.disponibilita.push({
          giorno: dayIso,
          oraInizio: sTime,
          oraFine: eTime,
          professore: fullname,
          laboratorio: null
        });
      }
    }

// Sostituisci la parte "owner lab" dentro importProfFromPreview con questo blocco
    // owner lab
    const ownerVal = ownerEl ? ownerEl.value.trim() : (item.ownerLab || '');
    if (ownerVal) {
      const labIdx = state.laboratori.findIndex(l => l.nome.toLowerCase() === ownerVal.toLowerCase());
      if (labIdx >= 0) {
        // assegna owner al lab esistente
        state.laboratori[labIdx].owner = fullname;
        // aggiorna eventuali disponibilità già presenti per questo professore senza lab
        const labName = state.laboratori[labIdx].nome;
        state.disponibilita.forEach(d => {
          if (d.professore === fullname && !d.laboratorio) d.laboratorio = labName;
        });
      } else {
        // crea nuovo lab e assegna owner; assegna anche eventuali disponibilità esistenti del docente
        state.laboratori.push({
          nome: ownerVal,
          owner: fullname,
          maxOreGiornoLab: rulesConfig.rule3Value,
          alunni: 15
        });
        state.disponibilita.forEach(d => {
          if (d.professore === fullname && !d.laboratorio) d.laboratorio = ownerVal;
        });
      }
    }

    added++;
  });

  persist();
  renderData();
  closeProfImportModal();
  showToast(`Import completato. Aggiunti: ${added}. Saltati: ${skipped}. Non validi: ${invalid}.`, 4000);
}

// backdrop click = chiudi quando si clicca fuori dalla modal-content
(function attachProfModalBackdropClick() {
    const modal = document.getElementById('profImportModal');
    if (!modal) return;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeProfImportModal();
        }
    });
})();

// small toast helper
function showToast(message, duration = 3000) {
    // rimuovi eventuale toast precedente
    const existing = document.getElementById('appToast');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'appToast';
    div.textContent = message;
    Object.assign(div.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: 99999,
        background: 'rgba(17,24,39,0.95)',
        color: '#fff',
        padding: '10px 14px',
        borderRadius: '8px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
        fontSize: '13px',
        opacity: '0',
        transition: 'opacity 220ms'
    });
    document.body.appendChild(div);
    // force reflow then show
    void div.offsetWidth;
    div.style.opacity = '1';

    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 280);
    }, duration);
}

// Attach modal buttons and expose functions safely
window.openProfImportModal = openProfImportModal;
window.closeProfImportModal = function() {
  const modal = document.getElementById('profImportModal');
  if (!modal) return;
  // clear table
  const tbody = document.getElementById('profImportTableBody');
  if (tbody) tbody.innerHTML = '';
  const summaryEl = document.getElementById('profImportSummary');
  if (summaryEl) summaryEl.textContent = '';
  if (modal._previewData) modal._previewData = null;
  modal.classList.remove('show');
  modal.style.display = 'none';
  const content = modal.querySelector('.modal-content');
  if (content) content.style.display = 'none';
  const inp = document.getElementById('profExcelInput');
  if (inp) inp.value = null;
};
window.importProfFromPreview = importProfFromPreview;

function attachProfImportModalButtons() {
    const importBtn = document.getElementById('importProfBtn');
    const cancelBtn = document.getElementById('cancelProfImportBtn');

    if (importBtn) {
        if (importBtn._handler) importBtn.removeEventListener('click', importBtn._handler);
        importBtn._handler = function () {
            try {
                importProfFromPreview();
            } catch (err) {
                console.error('Errore importProfFromPreview:', err);
                showToast('Errore durante l\'import. Controlla console.', 5000);
            }
        };
        importBtn.addEventListener('click', importBtn._handler);
    }

    if (cancelBtn) {
        if (cancelBtn._handler) cancelBtn.removeEventListener('click', cancelBtn._handler);
        cancelBtn._handler = function () {
            try {
                closeProfImportModal();
            } catch (err) {
                console.error('Errore closeProfImportModal:', err);
            }
        };
        cancelBtn.addEventListener('click', cancelBtn._handler);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    attachProfImportModalButtons();
});

// If openProfImportModal is called after DOM injection, ensure buttons attached
const originalOpen = window.openProfImportModal;
window.openProfImportModal = function (previewData, filename) {
    try {
        originalOpen(previewData, filename);
    } finally {
        setTimeout(attachProfImportModalButtons, 30);
    }
};
// ====== SUMMARY MODAL: gestione semplice (aggiunta rapida) ====== //

function openSummaryModal() {
  const body = document.getElementById('summaryModalBody');
  if (!body) return alert('summaryModalBody non trovato');

  // costruisci HTML per i gruppi principali
  const makeList = (title, group, items, renderItem) => {
    const rows = items.map((it, idx) => {
      return `<div class="modal-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; gap:8px; align-items:center; max-width:70%;">
          <button class="btn-xs" onclick="openSummaryEditor('${group}', ${idx})">✏️</button>
          <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <strong>${renderItem(it)}</strong>
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-xs btn-r" onclick="deleteSummaryItem('${group}', ${idx})">❌</button>
        </div>
      </div>`;
    }).join('');

    return `<div>
      <h4 style="margin:6px 0 6px 0;">${title} (${items.length})</h4>
      <div>${rows || '<p style="opacity:0.6;">Nessun elemento</p>'}</div>
    </div>`;
  };

  const labs = makeList('Laboratori', 'laboratori', state.laboratori, (l) => `${l.nome}${l.owner ? ' — owner: ' + l.owner : ''}`);
  const classes = makeList('Classi', 'classi', state.classi, (c) => `${c.nome} — ${c.alunni} alunni ${c.bypassRule7 ? '| bypass R7' : ''}`);
  const profs = makeList('Professori', 'professori', state.professori, (p) => `${p.nome} — MaxG: ${p.maxOreGiorno}h / MaxW: ${p.maxOreSettimana}h`);
  const projs = makeList('Progetti', 'progetti', state.progetti, (p) => `${p.nome}${p.laboratorio ? ' — Lab: ' + p.laboratorio : ''}`);
  const avails = state.disponibilita.length ? state.disponibilita.map((d, i) => `<div class="modal-item" style="display:flex; justify-content:space-between; align-items:center;"><div style="max-width:70%;"><strong>${d.giorno} — ${d.professore}</strong><br><small>${d.oraInizio} - ${d.oraFine} ${d.laboratorio ? '| ' + d.laboratorio : ''}</small></div><div style="display:flex; gap:6px;"><button class="btn-xs" onclick="openAvailabilityModal(${i})">✏️</button><button class="btn-xs btn-r" onclick="deleteSummaryItem('disponibilita', ${i})">❌</button></div></div>`).join('') : '<p style="opacity:0.6;">Nessuna disponibilità</p>';

  body.innerHTML = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
    <div>${labs}${classes}</div>
    <div>${profs}${projs}<h4 style="margin-top:6px;">Disponibilità</h4>${avails}</div>
  </div>`;

  document.getElementById('summaryModal').classList.add('show');
}

function closeSummaryModal() {
  const modal = document.getElementById('summaryModal');
  if (!modal) return;
  modal.classList.remove('show');
}

// ====== SUMMARY MODAL: editor avanzato (form inline per tutti i gruppi) ====== //

// ====== SUMMARY MODAL: editor avanzato (SENZA Sezione Disponibilità) ====== //

function _createOptionHtml(list, valueField, labelFn, emptyLabel = '-- Nessuno --') {
  return [ `<option value="">${emptyLabel}</option>`, ...(list || []).map(item => `<option value="${item[valueField]}">${labelFn(item)}</option>`) ].join('');
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openSummaryModal() {
  const body = document.getElementById('summaryModalBody');
  if (!body) return alert('summaryModalBody non trovato');

  const original = {
    laboratori: state.laboratori.map(l => ({ ...l })),
    classi: state.classi.map(c => ({ ...c })),
    professori: state.professori.map(p => ({ ...p })),
    progetti: state.progetti.map(p => ({ ...p }))
  };
  const modal = document.getElementById('summaryModal');
  modal._summaryOriginal = original;

  // Build editable rows for each group (no disponibilità)
  const labOwnerOptions = _createOptionHtml(state.professori, 'nome', p => p.nome, '-- Nessuno --');
  const labRows = state.laboratori.map((l, i) => `
    <div class="modal-item" data-group="laboratori" data-idx="${i}" style="display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input data-group="laboratori" data-idx="${i}" data-field="nome" type="text" value="${escapeHtml(l.nome)}" style="width:220px;">
          <select data-group="laboratori" data-idx="${i}" data-field="owner">${labOwnerOptions.replace(`value="${escapeHtml(l.owner||'')}"`,`value="${escapeHtml(l.owner||'')}" selected`)}</select>
          <input data-group="laboratori" data-idx="${i}" data-field="maxOreGiornoLab" type="number" min="0" value="${l.maxOreGiornoLab || rulesConfig.rule3Value}" style="width:80px;">
          <input data-group="laboratori" data-idx="${i}" data-field="alunni" type="number" min="0" value="${l.alunni || 15}" style="width:80px;">
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-xs" onclick="deleteSummaryItem('laboratori', ${i})">❌</button>
      </div>
    </div>
  `).join('') || `<p style="opacity:0.6;">Nessun laboratorio</p>`;

  const classRows = state.classi.map((c, i) => `
    <div class="modal-item" data-group="classi" data-idx="${i}" style="display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input data-group="classi" data-idx="${i}" data-field="nome" type="text" value="${escapeHtml(c.nome)}" style="width:160px;">
          <input data-group="classi" data-idx="${i}" data-field="alunni" type="number" min="1" value="${c.alunni || 20}" style="width:80px;">
          <label style="display:flex; align-items:center; gap:6px; font-size:12px;"><input data-group="classi" data-idx="${i}" data-field="bypassRule7" type="checkbox" ${c.bypassRule7 ? 'checked' : ''}> Bypass R7</label>
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-xs" onclick="deleteSummaryItem('classi', ${i})">❌</button>
      </div>
    </div>
  `).join('') || `<p style="opacity:0.6;">Nessuna classe</p>`;

  const profRows = state.professori.map((p, i) => `
    <div class="modal-item" data-group="professori" data-idx="${i}" style="display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input data-group="professori" data-idx="${i}" data-field="nome" type="text" value="${escapeHtml(p.nome)}" style="width:180px;">
          <input data-group="professori" data-idx="${i}" data-field="maxOreGiorno" type="number" min="0" value="${p.maxOreGiorno || rulesConfig.rule1Value}" style="width:80px;">
          <input data-group="professori" data-idx="${i}" data-field="maxOreSettimana" type="number" min="0" value="${p.maxOreSettimana || rulesConfig.rule2Value}" style="width:80px;">
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-xs" onclick="deleteSummaryItem('professori', ${i})">❌</button>
      </div>
    </div>
  `).join('') || `<p style="opacity:0.6;">Nessun professore</p>`;

  const projLabOptions = _createOptionHtml(state.laboratori, 'nome', l => l.nome, '-- Nessuno --');
  const projRows = state.progetti.map((p, i) => `
    <div class="modal-item" data-group="progetti" data-idx="${i}" style="display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;">
      <div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input data-group="progetti" data-idx="${i}" data-field="nome" type="text" value="${escapeHtml(p.nome)}" style="width:180px;">
          <select data-group="progetti" data-idx="${i}" data-field="laboratorio">${projLabOptions.replace(`value="${escapeHtml(p.laboratorio||'')}"`,`value="${escapeHtml(p.laboratorio||'')}" selected`)}</select>
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-xs" onclick="deleteSummaryItem('progetti', ${i})">❌</button>
      </div>
    </div>
  `).join('') || `<p style="opacity:0.6;">Nessun progetto</p>`;

  // Add-new rows (no disponibilità)
  const addNewLab = `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
      <input id="summary_new_lab_name" placeholder="Nome lab" style="width:180px;">
      <select id="summary_new_lab_owner">${labOwnerOptions}</select>
      <input id="summary_new_lab_maxOre" type="number" min="0" value="${rulesConfig.rule3Value}" style="width:80px;">
      <input id="summary_new_lab_alunni" type="number" min="0" value="15" style="width:80px;">
      <button class="btn-xs btn-p" onclick="summaryAddNew('laboratori')">➕</button>
    </div>`;
  const addNewClass = `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
      <input id="summary_new_class_name" placeholder="Nome classe" style="width:160px;">
      <input id="summary_new_class_alunni" type="number" min="1" value="20" style="width:80px;">
      <label style="display:flex; gap:6px; align-items:center;"><input id="summary_new_class_bypass" type="checkbox"> Bypass R7 limiti alunni</label>
      <button class="btn-xs btn-p" onclick="summaryAddNew('classi')">➕</button>
    </div>`;
  const addNewProf = `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
      <input id="summary_new_prof_name" placeholder="Nome prof" style="width:180px;">
      <input id="summary_new_prof_maxG" type="number" min="0" value="${rulesConfig.rule1Value}" style="width:80px;">
      <input id="summary_new_prof_maxW" type="number" min="0" value="${rulesConfig.rule2Value}" style="width:80px;">
      <button class="btn-xs btn-p" onclick="summaryAddNew('professori')">➕</button>
    </div>`;
  const addNewProj = `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
      <input id="summary_new_proj_name" placeholder="Nome progetto" style="width:180px;">
      <select id="summary_new_proj_lab">${projLabOptions}</select>
      <button class="btn-xs btn-p" onclick="summaryAddNew('progetti')">➕</button>
    </div>`;

  body.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div class="card">
        <h4>Laboratori</h4>
        ${addNewLab}
        <div id="summary_section_laboratori">${labRows}</div>
      </div>
      <div class="card">
        <h4>Classi</h4>
        ${addNewClass}
        <div id="summary_section_classi">${classRows}</div>
      </div>
      <div class="card">
        <h4>Professori</h4>
        ${addNewProf}
        <div id="summary_section_professori">${profRows}</div>
      </div>
      <div class="card">
        <h4>Progetti</h4>
        ${addNewProj}
        <div id="summary_section_progetti">${projRows}</div>
      </div>
    </div>
  `;

  modal.classList.add('show');
}

// summaryAddNew = aggiungi nuovo elemento (senza disponibilità)
function summaryAddNew(group) {
  switch (group) {
    case 'laboratori': {
      const name = document.getElementById('summary_new_lab_name')?.value.trim();
      const owner = document.getElementById('summary_new_lab_owner')?.value || null;
      const maxOre = Number(document.getElementById('summary_new_lab_maxOre')?.value) || rulesConfig.rule3Value;
      const alunni = Math.max(0, Number(document.getElementById('summary_new_lab_alunni')?.value) || 15);
      if (!name) return alert('Nome lab obbligatorio');
      if (state.laboratori.some(l => l.nome.toLowerCase() === name.toLowerCase())) return alert('Laboratorio esistente');
      state.laboratori.push({ nome: name, owner: owner || null, maxOreGiornoLab: maxOre, alunni });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'classi': {
      const name = document.getElementById('summary_new_class_name')?.value.trim().toUpperCase();
      const alunni = Math.max(1, Number(document.getElementById('summary_new_class_alunni')?.value) || 20);
      const bypass = !!document.getElementById('summary_new_class_bypass')?.checked;
      if (!name) return alert('Nome classe obbligatorio');
      if (state.classi.some(c => c.nome.toLowerCase() === name.toLowerCase())) return alert('Classe esistente');
      state.classi.push({ nome: name, alunni, bypassRule7: bypass });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'professori': {
      const name = document.getElementById('summary_new_prof_name')?.value.trim();
      const maxG = Math.max(0, Number(document.getElementById('summary_new_prof_maxG')?.value) || rulesConfig.rule1Value);
      const maxW = Math.max(0, Number(document.getElementById('summary_new_prof_maxW')?.value) || rulesConfig.rule2Value);
      if (!name) return alert('Nome professore obbligatorio');
      if (state.professori.some(p => p.nome.toLowerCase() === name.toLowerCase())) return alert('Professore esistente');
      state.professori.push({ nome: name, maxOreGiorno: maxG, maxOreSettimana: maxW });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'progetti': {
      const name = document.getElementById('summary_new_proj_name')?.value.trim();
      const lab = document.getElementById('summary_new_proj_lab')?.value || null;
      if (!name) return alert('Nome progetto obbligatorio');
      if (state.progetti.some(p => p.nome.toLowerCase() === name.toLowerCase())) return alert('Progetto esistente');
      state.progetti.push({ nome: name, laboratorio: lab || null });
      persist(); renderData(); openSummaryModal();
      break;
    }
    default:
      return;
  }
}

// deleteSummaryItem rimane funzionante (gestisce anche disponibilita se chiamata altrove)
function deleteSummaryItem(group, idx) {
  if (!confirm('Confermi eliminazione?')) return;
  switch (group) {
    case 'laboratori': {
      if (!state.laboratori[idx]) return;
      const labName = state.laboratori[idx].nome;
      state.laboratori.splice(idx, 1);
      state.disponibilita = state.disponibilita.map(d => d.laboratorio === labName ? ({...d, laboratorio: null}) : d);
      state.progetti.forEach(p => { if (p.laboratorio === labName) p.laboratorio = null; });
      break;
    }
    case 'classi': {
      if (!state.classi[idx]) return;
      const clsName = state.classi[idx].nome;
      state.classi.splice(idx, 1);
      state.classActivities = state.classActivities.filter(a => a.classe !== clsName);
      break;
    }
    case 'professori': {
      if (!state.professori[idx]) return;
      const profName = state.professori[idx].nome;
      state.professori.splice(idx, 1);
      state.disponibilita = state.disponibilita.filter(d => d.professore !== profName);
      state.laboratori = state.laboratori.map(l => ({...l, owner: l.owner === profName ? null : l.owner}));
      break;
    }
    case 'progetti': {
      if (!state.progetti[idx]) return;
      const projName = state.progetti[idx].nome;
      state.progetti.splice(idx, 1);
      state.classActivities = state.classActivities.filter(a => a.nome !== projName);
      break;
    }
    case 'disponibilita': {
      if (!state.disponibilita[idx]) return;
      state.disponibilita.splice(idx, 1);
      break;
    }
    default:
      return;
  }
  persist();
  renderData();
  openSummaryModal();
}

// salva tutte le modifiche dai campi del modal (senza gestire disponibilita nel modal)
function saveAllSummaryChanges() {
  const modal = document.getElementById('summaryModal');
  const original = modal._summaryOriginal || { laboratori: [], classi: [], professori: [], progetti: [] };

  const inputs = Array.from(document.querySelectorAll('[data-group][data-idx][data-field]'));
  const groups = {};
  inputs.forEach(inp => {
    const grp = inp.dataset.group;
    const idx = Number(inp.dataset.idx);
    const field = inp.dataset.field;
    groups[grp] = groups[grp] || {};
    groups[grp][idx] = groups[grp][idx] || {};
    if (inp.type === 'checkbox') groups[grp][idx][field] = !!inp.checked;
    else groups[grp][idx][field] = inp.value;
  });

  const validateUnique = (arr, fieldName, friendly) => {
    const vals = arr.map(x => (x[fieldName] || '').toString().trim().toLowerCase());
    const dup = vals.find((v,i)=> v && vals.indexOf(v)!==i);
    if (dup) { alert(`Valore duplicato in ${friendly}: "${dup}"`); return false; }
    return true;
  };

  if (groups.laboratori) {
    const newLabs = [];
    const keys = Object.keys(groups.laboratori).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.laboratori[i];
      const name = (g.nome || '').trim();
      if (!name) return;
      newLabs.push({
        nome: name,
        owner: (g.owner || '') || null,
        maxOreGiornoLab: Number(g.maxOreGiornoLab) || rulesConfig.rule3Value,
        alunni: Math.max(0, Number(g.alunni) || 15)
      });
    });
    if (!validateUnique(newLabs, 'nome', 'Laboratori')) return;
    state.laboratori = newLabs;
  }

  if (groups.classi) {
    const newClasses = [];
    const keys = Object.keys(groups.classi).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.classi[i];
      const name = (g.nome || '').trim().toUpperCase();
      if (!name) return;
      newClasses.push({
        nome: name,
        alunni: Math.max(1, Number(g.alunni) || 20),
        bypassRule7: !!g.bypassRule7
      });
    });
    if (!validateUnique(newClasses, 'nome', 'Classi')) return;
    state.classi = newClasses;
  }

  if (groups.professori) {
    const newProfs = [];
    const keys = Object.keys(groups.professori).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.professori[i];
      const name = (g.nome || '').trim();
      if (!name) return;
      newProfs.push({
        nome: name,
        maxOreGiorno: Math.max(0, Number(g.maxOreGiorno) || rulesConfig.rule1Value),
        maxOreSettimana: Math.max(0, Number(g.maxOreSettimana) || rulesConfig.rule2Value)
      });
    });
    if (!validateUnique(newProfs, 'nome', 'Professori')) return;
    state.professori = newProfs;
  }

  if (groups.progetti) {
    const newProjs = [];
    const keys = Object.keys(groups.progetti).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.progetti[i];
      const name = (g.nome || '').trim();
      if (!name) return;
      newProjs.push({
        nome: name,
        laboratorio: (g.laboratorio || '') || null
      });
    });
    if (!validateUnique(newProjs, 'nome', 'Progetti')) return;
    state.progetti = newProjs;
  }

  // Propagate renames
  const mapping = (origArr, newArr, key='nome') => {
    const map = {};
    origArr.forEach((o) => {
      const n = newArr.find(nv => nv[key] && nv[key].toString().trim().toLowerCase() === (o[key] || '').toString().trim().toLowerCase());
      if (n) {
        if (n[key] !== o[key]) map[o[key]] = n[key];
      } else {
        map[o[key]] = null;
      }
    });
    return map;
  };

  const labsMap = mapping(original.laboratori, state.laboratori, 'nome');
  const classesMap = mapping(original.classi, state.classi, 'nome');
  const profsMap = mapping(original.professori, state.professori, 'nome');
  const projsMap = mapping(original.progetti, state.progetti, 'nome');

  state.classActivities.forEach(a => {
    if (a.classe && classesMap.hasOwnProperty(a.classe)) {
      const v = classesMap[a.classe];
      if (v !== null) a.classe = v;
    }
    if (a.nome && projsMap.hasOwnProperty(a.nome)) {
      const v = projsMap[a.nome];
      if (v !== null) a.nome = v;
    }
    if (a.nome && labsMap.hasOwnProperty(a.nome)) {
      const v = labsMap[a.nome];
      if (v !== null) a.nome = v;
    }
  });

  state.laboratori.forEach(l => {
    if (l.owner && profsMap.hasOwnProperty(l.owner)) {
      const v = profsMap[l.owner];
      if (v !== null) l.owner = v;
    }
  });

  persist();
  renderData();
  closeSummaryModal();
  showToast('Modifiche salvate', 2000);
}

// close modal
function closeSummaryModal() {
  const modal = document.getElementById('summaryModal');
  if (!modal) return;
  modal.classList.remove('show');
  const body = document.getElementById('summaryModalBody');
  if (body) body.innerHTML = '';
  modal._summaryOriginal = null;
}

// esporta funzioni globali (compatibilità onclick già usate nel DOM)
window.openSummaryModal = openSummaryModal;
window.closeSummaryModal = closeSummaryModal;
window.saveAllSummaryChanges = saveAllSummaryChanges;
window.deleteSummaryItem = deleteSummaryItem;
window.summaryAddNew = summaryAddNew;

// helper escape HTML
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Add new item from "add" row
function summaryAddNew(group) {
  switch (group) {
    case 'laboratori': {
      const name = document.getElementById('summary_new_lab_name')?.value.trim();
      const owner = document.getElementById('summary_new_lab_owner')?.value || null;
      const maxOre = Number(document.getElementById('summary_new_lab_maxOre')?.value) || rulesConfig.rule3Value;
      const alunni = Math.max(0, Number(document.getElementById('summary_new_lab_alunni')?.value) || 15);
      if (!name) return alert('Nome lab obbligatorio');
      if (state.laboratori.some(l => l.nome.toLowerCase() === name.toLowerCase())) return alert('Laboratorio esistente');
      state.laboratori.push({ nome: name, owner: owner || null, maxOreGiornoLab: maxOre, alunni });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'classi': {
      const name = document.getElementById('summary_new_class_name')?.value.trim().toUpperCase();
      const alunni = Math.max(1, Number(document.getElementById('summary_new_class_alunni')?.value) || 20);
      const bypass = !!document.getElementById('summary_new_class_bypass')?.checked;
      if (!name) return alert('Nome classe obbligatorio');
      if (state.classi.some(c => c.nome.toLowerCase() === name.toLowerCase())) return alert('Classe esistente');
      state.classi.push({ nome: name, alunni, bypassRule7: bypass });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'professori': {
      const name = document.getElementById('summary_new_prof_name')?.value.trim();
      const maxG = Math.max(0, Number(document.getElementById('summary_new_prof_maxG')?.value) || rulesConfig.rule1Value);
      const maxW = Math.max(0, Number(document.getElementById('summary_new_prof_maxW')?.value) || rulesConfig.rule2Value);
      if (!name) return alert('Nome professore obbligatorio');
      if (state.professori.some(p => p.nome.toLowerCase() === name.toLowerCase())) return alert('Professore esistente');
      state.professori.push({ nome: name, maxOreGiorno: maxG, maxOreSettimana: maxW });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'progetti': {
      const name = document.getElementById('summary_new_proj_name')?.value.trim();
      const lab = document.getElementById('summary_new_proj_lab')?.value || null;
      if (!name) return alert('Nome progetto obbligatorio');
      if (state.progetti.some(p => p.nome.toLowerCase() === name.toLowerCase())) return alert('Progetto esistente');
      state.progetti.push({ nome: name, laboratorio: lab || null });
      persist(); renderData(); openSummaryModal();
      break;
    }
    case 'disponibilita': {
      const giorno = document.getElementById('summary_new_av_giorno')?.value;
      let s = document.getElementById('summary_new_av_start')?.value;
      let e = document.getElementById('summary_new_av_end')?.value;
      const prof = document.getElementById('summary_new_av_prof')?.value || null;
      const lab = document.getElementById('summary_new_av_lab')?.value || null;
      if (!giorno || !prof) return alert('Giorno e Professore obbligatori');
      if (!s && rulesConfig.rule9Enable) s = rulesConfig.rule9Start;
      if (!e && rulesConfig.rule9Enable) e = rulesConfig.rule9End;
      if (s >= e) return alert('Orario non valido');
      // avoid dup
      const dup = state.disponibilita.some(d => d.giorno === giorno && d.oraInizio === s && d.oraFine === e && d.professore === prof && ((d.laboratorio||'') === (lab||'')));
      if (dup) return alert('Disponibilità duplicata');
      state.disponibilita.push({ giorno, oraInizio: s, oraFine: e, professore: prof, laboratorio: lab || null });
      persist(); renderData(); openSummaryModal();
      break;
    }
    default:
      return;
  }
}

// Delete item inline
function deleteSummaryItem(group, idx) {
  if (!confirm('Confermi eliminazione?')) return;
  switch (group) {
    case 'laboratori': {
      if (!state.laboratori[idx]) return;
      const labName = state.laboratori[idx].nome;
      state.laboratori.splice(idx, 1);
      state.disponibilita = state.disponibilita.map(d => d.laboratorio === labName ? ({...d, laboratorio: null}) : d);
      state.progetti.forEach(p => { if (p.laboratorio === labName) p.laboratorio = null; });
      // leave classActivities as-is (activities named after lab remain but lab link removed)
      break;
    }
    case 'classi': {
      if (!state.classi[idx]) return;
      const clsName = state.classi[idx].nome;
      state.classi.splice(idx, 1);
      state.classActivities = state.classActivities.filter(a => a.classe !== clsName);
      break;
    }
    case 'professori': {
      if (!state.professori[idx]) return;
      const profName = state.professori[idx].nome;
      state.professori.splice(idx, 1);
      state.disponibilita = state.disponibilita.filter(d => d.professore !== profName);
      state.laboratori = state.laboratori.map(l => ({...l, owner: l.owner === profName ? null : l.owner}));
      break;
    }
    case 'progetti': {
      if (!state.progetti[idx]) return;
      const projName = state.progetti[idx].nome;
      state.progetti.splice(idx, 1);
      state.classActivities = state.classActivities.filter(a => a.nome !== projName);
      break;
    }
    case 'disponibilita': {
      if (!state.disponibilita[idx]) return;
      state.disponibilita.splice(idx, 1);
      break;
    }
    default:
      return;
  }
  persist();
  renderData();
  openSummaryModal();
}

// Save all changes from inputs; propagate renames
function saveAllSummaryChanges() {
  const modal = document.getElementById('summaryModal');
  const original = modal._summaryOriginal || { laboratori: [], classi: [], professori: [], progetti: [] };

  // helper to collect inputs by group
  const inputs = Array.from(document.querySelectorAll('[data-group][data-idx][data-field]'));
  const groups = {};
  inputs.forEach(inp => {
    const grp = inp.dataset.group;
    const idx = Number(inp.dataset.idx);
    const field = inp.dataset.field;
    groups[grp] = groups[grp] || {};
    groups[grp][idx] = groups[grp][idx] || {};
    if (inp.type === 'checkbox') groups[grp][idx][field] = !!inp.checked;
    else groups[grp][idx][field] = inp.value;
  });
// --- assegna automaticamente il lab alle disponibilità del suo owner (solo se laboratorio vuoto) ---
const ownerToLab = {};
state.laboratori.forEach(l => {
  if (l.owner) ownerToLab[l.owner] = l.nome;
});

// assegna solo se d.laboratorio è falsy (non sovrascriviamo valori esistenti)
state.disponibilita.forEach(d => {
  if (!d) return;
  if (d.professore && (!d.laboratorio || d.laboratorio === '')) {
    const labName = ownerToLab[d.professore];
    if (labName) d.laboratorio = labName;
  }
});
// -------------------------------------------------------------------
  // Validate duplicates in key fields (names)
  const validateUnique = (arr, fieldName, friendly) => {
    const vals = arr.map(x => (x[fieldName] || '').toString().trim().toLowerCase());
    const dup = vals.find((v,i)=> v && vals.indexOf(v)!==i);
    if (dup) { alert(`Valore duplicato in ${friendly}: "${dup}"`); return false; }
    return true;
  };

  // Apply groups to state arrays
  // LABS
  if (groups.laboratori) {
    const newLabs = [];
    const keys = Object.keys(groups.laboratori).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.laboratori[i];
      const name = (g.nome || '').trim();
      if (!name) return; // skip empty
      newLabs.push({
        nome: name,
        owner: (g.owner || '') || null,
        maxOreGiornoLab: Number(g.maxOreGiornoLab) || rulesConfig.rule3Value,
        alunni: Math.max(0, Number(g.alunni) || 15)
      });
    });
    if (!validateUnique(newLabs, 'nome', 'Laboratori')) return;
    state.laboratori = newLabs;
  }

  // CLASSI
  if (groups.classi) {
    const newClasses = [];
    const keys = Object.keys(groups.classi).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.classi[i];
      const name = (g.nome || '').trim().toUpperCase();
      if (!name) return;
      newClasses.push({
        nome: name,
        alunni: Math.max(1, Number(g.alunni) || 20),
        bypassRule7: !!g.bypassRule7
      });
    });
    if (!validateUnique(newClasses, 'nome', 'Classi')) return;
    state.classi = newClasses;
  }

  // PROF
  if (groups.professori) {
    const newProfs = [];
    const keys = Object.keys(groups.professori).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.professori[i];
      const name = (g.nome || '').trim();
      if (!name) return;
      newProfs.push({
        nome: name,
        maxOreGiorno: Math.max(0, Number(g.maxOreGiorno) || rulesConfig.rule1Value),
        maxOreSettimana: Math.max(0, Number(g.maxOreSettimana) || rulesConfig.rule2Value)
      });
    });
    if (!validateUnique(newProfs, 'nome', 'Professori')) return;
    state.professori = newProfs;
  }

  // PROGETTI
  if (groups.progetti) {
    const newProjs = [];
    const keys = Object.keys(groups.progetti).map(k=>Number(k)).sort((a,b)=>a-b);
    keys.forEach(i => {
      const g = groups.progetti[i];
      const name = (g.nome || '').trim();
      if (!name) return;
      newProjs.push({
        nome: name,
        laboratorio: (g.laboratorio || '') || null
      });
    });
    if (!validateUnique(newProjs, 'nome', 'Progetti')) return;
    state.progetti = newProjs;
  }

  // DISPONIBILITA
  if (groups.disponibilita) {
    const newAv = [];
    const keys = Object.keys(groups.disponibilita).map(k=>Number(k)).sort((a,b)=>a-b);
    for (const i of keys) {
      const g = groups.disponibilita[i];
      const giorno = (g.giorno || '').trim();
      let s = (g.oraInizio || '').trim();
      let e = (g.oraFine || '').trim();
      const prof = (g.professore || '') || null;
      const lab = (g.laboratorio || '') || null;
      if (!giorno || !prof) continue; // skip invalid
      if (!s && rulesConfig.rule9Enable) s = rulesConfig.rule9Start;
      if (!e && rulesConfig.rule9Enable) e = rulesConfig.rule9End;
      if (s >= e) { alert(`Orario non valido per disponibilità ${giorno} ${s}-${e}`); return; }
      newAv.push({ giorno, oraInizio: s, oraFine: e, professore: prof, laboratorio: lab || null });
    }
    state.disponibilita = newAv;
  }

  // Propagate renames (original -> new)
  const mapping = (origArr, newArr, key='nome') => {
    const map = {};
    origArr.forEach((o, idx) => {
      const n = newArr.find(nv => nv[key] && nv[key].toString().trim().toLowerCase() === (o[key] || '').toString().trim().toLowerCase());
      if (n) {
        // if same string (case-insensitive) but maybe different case, map old -> new exact
        if (n[key] !== o[key]) map[o[key]] = n[key];
      } else {
        // old not found -> removed; map to null
        map[o[key]] = null;
      }
    });
    return map;
  };

  const labsMap = mapping(original.laboratori, state.laboratori, 'nome');
  const classesMap = mapping(original.classi, state.classi, 'nome');
  const profsMap = mapping(original.professori, state.professori, 'nome');
  const projsMap = mapping(original.progetti, state.progetti, 'nome');

  // apply mapping to disponibilita.professore and laboratorio
  state.disponibilita.forEach(d => {
    if (d.professore && profsMap.hasOwnProperty(d.professore)) {
      const v = profsMap[d.professore];
      if (v === null) d.professore = d.professore; // keep old if removed? we keep as-is to avoid accidental deletion
      else d.professore = v;
    }
    if (d.laboratorio && labsMap.hasOwnProperty(d.laboratorio)) {
      const v = labsMap[d.laboratorio];
      if (v === null) d.laboratorio = null;
      else d.laboratorio = v;
    }
  });

  // apply mapping to classActivities attivita/classe
  state.classActivities.forEach(a => {
    if (a.classe && classesMap.hasOwnProperty(a.classe)) {
      const v = classesMap[a.classe];
      if (v === null) a.classe = a.classe;
      else a.classe = v;
    }
    if (a.nome && projsMap.hasOwnProperty(a.nome)) {
      const v = projsMap[a.nome];
      if (v === null) a.nome = a.nome;
      else a.nome = v;
    }
    if (a.nome && labsMap.hasOwnProperty(a.nome)) {
      const v = labsMap[a.nome];
      if (v === null) a.nome = a.nome;
      else a.nome = v;
    }
  });

  // update lab owners that were renamed: if a professor was renamed, update lab.owner
  state.laboratori.forEach(l => {
    if (l.owner && profsMap.hasOwnProperty(l.owner)) {
      const v = profsMap[l.owner];
      if (v === null) l.owner = l.owner; else l.owner = v;
    }
  });

  persist();
  renderData();
  closeSummaryModal();
  showToast('Modifiche salvate', 2000);
}

// Close modal
function closeSummaryModal() {
  const modal = document.getElementById('summaryModal');
  if (!modal) return;
  modal.classList.remove('show');
  // clear body
  const body = document.getElementById('summaryModalBody');
  if (body) body.innerHTML = '';
  modal._summaryOriginal = null;
}
// ====== IMPORT: Classi × Attività da Excel/CSV (preview + import) ====== //

function triggerImportClassExcel() {
  const inp = document.getElementById('classExcelInput');
  if (!inp) {
    alert('Input file per Excel Classi non trovato.');
    return;
  }
  inp.value = null;
  inp.click();
}

function handleClassExcelFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    let workbook;
    try {
      workbook = XLSX.read(data, { type: 'array' });
    } catch (err) {
      alert('Errore lettura file Excel: ' + err.message);
      return;
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rawRows || rawRows.length === 0) {
      alert('Foglio vuoto o non leggibile.');
      return;
    }

    const preview = buildClassPreviewData(rawRows);

    if (!preview.length) {
      alert('Nessuna riga valida trovata nel file.');
      return;
    }

    openClassImportModal(preview, file.name);
    setTimeout(attachClassImportModalButtons, 30);
  };

  reader.readAsArrayBuffer(file);
}

// helpers (reuse parse helpers if present)
function _class_parseTimeToken(token) {
  if (token === null || token === undefined) return null;
  if (token instanceof Date) {
    const h = token.getHours(), m = token.getMinutes();
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  if (typeof token === 'number') {
    // Excel time fraction
    if (token > 0 && token < 1) {
      const minutes = Math.round(token * 24 * 60);
      return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    }
    const h = Math.floor(token);
    const m = Math.round((token - h) * 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  const s = String(token).trim().replace(',', '.').replace(/\s+/g,'');
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) return `${m1[1].padStart(2,'0')}:${m1[2]}`;
  const m2 = s.match(/^(\d{1,2})(\d{2})$/);
  if (m2) return `${m2[1].padStart(2,'0')}:${m2[2]}`;
  const m3 = s.match(/^(\d{1,2})(\.\d+)$/);
  if (m3) {
    const hh = Number(m3[1]), dec = Number(m3[2]);
    const minutes = Math.round(dec * 60);
    return `${String(hh).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  }
  const m4 = s.match(/^(\d{1,2})$/);
  if (m4) return `${String(m4[1]).padStart(2,'0')}:00`;
  return null;
}

function tryParseDateToISO_forClass(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/');
    return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
  return null;
}

function buildClassPreviewData(rawRows) {
  const preview = [];
  if (!rawRows || rawRows.length === 0) return preview;

  // detect header
  const headers = (rawRows[0] || []).map(h => (h===null||h===undefined)?'':String(h).trim().toLowerCase());
  let startIdx = 0;
  let headerMap = null;

  const headerKeywords = {
    classe: ['classe','class','class name','classe.nome'],
    activity: ['attivita','attività','activity','activity name','nome attività','nome'],
    lab: ['lab','laboratorio','laboratorio name','laboratorio_nome','labname'],
    day: ['giorno','date','data','day'],
    start: ['inizio','start','ora inizio','ora_start','from'],
    end: ['fine','end','ora fine','ora_end','to'],
    students: ['alunni','students','n_alunni','num students'],
    prof1: ['prof1','docente1','professore1','docente 1'],
    prof2: ['prof2','docente2','professore2','docente 2'],
    overlap: ['allowoverlap','allow_overlap','sovrapposizione','allowover','overlap']
  };

  const firstLineCombined = headers.filter(Boolean).join(' ');
  if (firstLineCombined && (firstLineCombined.includes('classe') || firstLineCombined.includes('attivita') || firstLineCombined.includes('activity'))) {
    startIdx = 1;
    headerMap = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      if (headerKeywords.classe.some(k => h.includes(k))) headerMap.classe = idx;
      if (headerKeywords.activity.some(k => h.includes(k))) headerMap.activity = idx;
      if (headerKeywords.lab.some(k => h.includes(k))) headerMap.lab = idx;
      if (headerKeywords.day.some(k => h.includes(k))) headerMap.day = idx;
      if (headerKeywords.start.some(k => h.includes(k))) headerMap.start = idx;
      if (headerKeywords.end.some(k => h.includes(k))) headerMap.end = idx;
      if (headerKeywords.students.some(k => h.includes(k))) headerMap.students = idx;
      if (headerKeywords.prof1.some(k => h.includes(k))) headerMap.prof1 = idx;
      if (headerKeywords.prof2.some(k => h.includes(k))) headerMap.prof2 = idx;
      if (headerKeywords.overlap.some(k => h.includes(k))) headerMap.overlap = idx;
    });
  }

  for (let i = startIdx; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    if (row.every(c => c === '' || c === null || c === undefined)) continue;

    const cells = row.slice();
    const getCell = (idx) => (idx !== undefined && idx !== null) ? (cells[idx] === null || cells[idx] === undefined ? '' : cells[idx]) : '';

    let classe = headerMap && headerMap.classe !== undefined ? String(getCell(headerMap.classe)).trim() : String(cells[0] || '').trim();
    let activity = headerMap && headerMap.activity !== undefined ? String(getCell(headerMap.activity)).trim() : String(cells[1] || '').trim();
    let lab = headerMap && headerMap.lab !== undefined ? String(getCell(headerMap.lab)).trim() : String(cells[2] || '').trim();
    let dayRaw = headerMap && headerMap.day !== undefined ? getCell(headerMap.day) : (cells[3] || '');
    let startRaw = headerMap && headerMap.start !== undefined ? getCell(headerMap.start) : (cells[4] || '');
    let endRaw = headerMap && headerMap.end !== undefined ? getCell(headerMap.end) : (cells[5] || '');
    let studentsRaw = headerMap && headerMap.students !== undefined ? getCell(headerMap.students) : (cells[6] || '');
    let prof1 = headerMap && headerMap.prof1 !== undefined ? String(getCell(headerMap.prof1)).trim() : String(cells[7] || '').trim();
    let prof2 = headerMap && headerMap.prof2 !== undefined ? String(getCell(headerMap.prof2)).trim() : String(cells[8] || '').trim();
    let overlapRaw = headerMap && headerMap.overlap !== undefined ? String(getCell(headerMap.overlap)).trim() : String(cells[9] || '').trim();

    classe = String(classe || '').trim();
    activity = String(activity || '').trim();
    lab = String(lab || '').trim();
    prof1 = prof1 || '';
    prof2 = prof2 || '';
    const alunni = Number(studentsRaw) || 0;
    const allowOverlap = /^(1|y|yes|true|si|s)$/i.test(String(overlapRaw || '').trim());

    const dayIso = tryParseDateToISO_forClass(dayRaw) || '';
    const startTime = _class_parseTimeToken(startRaw) || '';
    const endTime = _class_parseTimeToken(endRaw) || '';

    const status = (() => {
      if (!classe) return 'missing_class';
      if (!activity) return 'missing_activity';
      if (!dayIso) return 'missing_day';
      if (!startTime || !endTime) return 'missing_time';
      if (startTime >= endTime) return 'invalid_time';
      return 'ok';
    })();

    preview.push({
      originalCells: cells.map(c => (c === null || c === undefined) ? '' : c),
      include: status === 'ok',
      status,
      classe,
      activity,
      lab: lab || '',
      giorno: dayIso,
      oraInizio: startTime,
      oraFine: endTime,
      alunni,
      prof1: prof1 || '',
      prof2: prof2 || '',
      allowOverlap
    });
  }

  return preview;
}

function openClassImportModal(previewData, filename) {
  const tbody = document.getElementById('classImportTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  previewData.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.index = idx;
    tr.style.borderBottom = '1px solid var(--border)';

    const tdCheck = document.createElement('td');
    tdCheck.style.textAlign = 'center';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!item.include;
    chk.style.width = '18px';
    chk.onchange = () => item.include = chk.checked;
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    const tdClass = document.createElement('td');
    const inpClass = document.createElement('input');
    inpClass.type = 'text';
    inpClass.value = item.classe || '';
    inpClass.oninput = () => { item.classe = inpClass.value.trim(); updateClassImportStatus(previewData, idx); };
    tdClass.appendChild(inpClass);
    tr.appendChild(tdClass);

    const tdAct = document.createElement('td');
    const inpAct = document.createElement('input');
    inpAct.type = 'text';
    inpAct.value = item.activity || '';
    inpAct.oninput = () => { item.activity = inpAct.value.trim(); updateClassImportStatus(previewData, idx); };
    tdAct.appendChild(inpAct);
    tr.appendChild(tdAct);

    const tdLab = document.createElement('td');
    const inpLab = document.createElement('input');
    inpLab.type = 'text';
    inpLab.value = item.lab || '';
    inpLab.oninput = () => { item.lab = inpLab.value.trim(); updateClassImportStatus(previewData, idx); };
    tdLab.appendChild(inpLab);
    tr.appendChild(tdLab);

    const tdDay = document.createElement('td');
    const inpDay = document.createElement('input');
    inpDay.type = 'date';
    inpDay.value = item.giorno || '';
    inpDay.onchange = () => { item.giorno = inpDay.value; updateClassImportStatus(previewData, idx); };
    tdDay.appendChild(inpDay);
    tr.appendChild(tdDay);

    const tdStart = document.createElement('td');
    const inpStart = document.createElement('input');
    inpStart.type = 'time';
    inpStart.value = item.oraInizio || '';
    inpStart.onchange = () => { item.oraInizio = inpStart.value; updateClassImportStatus(previewData, idx); };
    tdStart.appendChild(inpStart);
    tr.appendChild(tdStart);

    const tdEnd = document.createElement('td');
    const inpEnd = document.createElement('input');
    inpEnd.type = 'time';
    inpEnd.value = item.oraFine || '';
    inpEnd.onchange = () => { item.oraFine = inpEnd.value; updateClassImportStatus(previewData, idx); };
    tdEnd.appendChild(inpEnd);
    tr.appendChild(tdEnd);

    const tdStu = document.createElement('td');
    const inpStu = document.createElement('input');
    inpStu.type = 'number';
    inpStu.min = 0;
    inpStu.value = item.alunni || 0;
    inpStu.onchange = () => { item.alunni = Math.max(0, Number(inpStu.value) || 0); };
    tdStu.appendChild(inpStu);
    tr.appendChild(tdStu);

    const tdProf = document.createElement('td');
    const inpProf1 = document.createElement('input');
    inpProf1.type = 'text';
    inpProf1.value = item.prof1 || '';
    inpProf1.placeholder = 'Prof1';
    inpProf1.style.width = '48%';
    inpProf1.oninput = () => { item.prof1 = inpProf1.value.trim(); };
    const inpProf2 = document.createElement('input');
    inpProf2.type = 'text';
    inpProf2.value = item.prof2 || '';
    inpProf2.placeholder = 'Prof2';
    inpProf2.style.width = '48%';
    inpProf2.oninput = () => { item.prof2 = inpProf2.value.trim(); };
    tdProf.appendChild(inpProf1);
    tdProf.appendChild(document.createTextNode(' '));
    tdProf.appendChild(inpProf2);
    tr.appendChild(tdProf);

    const tdStatus = document.createElement('td');
    tdStatus.style.textAlign = 'center';
    tdStatus.style.color = '#6b7280';
    tdStatus.id = `classImportStatus_${idx}`;
    tdStatus.textContent = item.status;
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });

  updateClassImportSummary(previewData);

  const modal = document.getElementById('classImportModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.style.display = 'flex';
  modal._previewData = previewData;

  const summaryEl = document.getElementById('classImportSummary');
  if (summaryEl) summaryEl.textContent = `File: ${filename || ''} — righe: ${previewData.length}`;

  const firstInput = document.querySelector('#classImportTableBody input[type="text"]');
  if (firstInput) firstInput.focus();
}

function updateClassImportStatus(previewData, idx) {
  const item = previewData[idx];
  if (!item) return;
  let status = 'ok';
  if (!item.classe) status = 'missing_class';
  else if (!item.activity) status = 'missing_activity';
  else if (!item.giorno) status = 'missing_day';
  else if (!item.oraInizio || !item.oraFine) status = 'missing_time';
  else if (item.oraInizio >= item.oraFine) status = 'invalid_time';
  item.status = status;
  const statusCell = document.getElementById(`classImportStatus_${idx}`);
  if (statusCell) {
    statusCell.textContent = status;
    statusCell.style.color = status === 'ok' ? '#10b981' : '#f59e0b';
  }
  updateClassImportSummary(previewData);
}

function updateClassImportSummary(previewData) {
  const total = previewData.length;
  const toImport = previewData.filter(p => p.include && p.status === 'ok').length;
  const invalid = previewData.filter(p => p.include && p.status !== 'ok').length;
  const s = document.getElementById('classImportSummary');
  if (s) s.textContent = `Selezionate: ${toImport}/${total} — non validi: ${invalid}`;
}

function attachClassImportModalButtons() {
  const importBtn = document.getElementById('importClassBtn');
  const cancelBtn = document.getElementById('cancelClassImportBtn');

  if (importBtn) {
    if (importBtn._handler) importBtn.removeEventListener('click', importBtn._handler);
    importBtn._handler = function () {
      try {
        importClassFromPreview();
      } catch (err) {
        console.error('Errore importClassFromPreview:', err);
        showToast('Errore durante l\'import. Controlla console.', 5000);
      }
    };
    importBtn.addEventListener('click', importBtn._handler);
  }

  if (cancelBtn) {
    if (cancelBtn._handler) cancelBtn.removeEventListener('click', cancelBtn._handler);
    cancelBtn._handler = function () {
      try {
        closeClassImportModal();
      } catch (err) {
        console.error('Errore closeClassImportModal:', err);
      }
    };
    cancelBtn.addEventListener('click', cancelBtn._handler);
  }
}

function closeClassImportModal() {
  const modal = document.getElementById('classImportModal');
  if (!modal) return;
  const tbody = document.getElementById('classImportTableBody');
  if (tbody) tbody.innerHTML = '';
  const summaryEl = document.getElementById('classImportSummary');
  if (summaryEl) summaryEl.textContent = '';
  if (modal._previewData) modal._previewData = null;
  modal.classList.remove('show');
  modal.style.display = 'none';
  const content = modal.querySelector('.modal-content');
  if (content) content.style.display = 'none';
  const inp = document.getElementById('classExcelInput');
  if (inp) inp.value = null;
}

// Main import logic
function importClassFromPreview() {
  const modal = document.getElementById('classImportModal');
  if (!modal || !modal._previewData) return;

  const previewData = modal._previewData;
  let addedActivities = 0, skipped = 0, invalid = 0;

  previewData.forEach((item) => {
    if (!item.include) return;
    if (item.status !== 'ok') { invalid++; return; }

    const classe = item.classe.trim().toUpperCase();
    const activity = item.activity.trim();
    const labName = item.lab ? item.lab.trim() : null;
    const giorno = item.giorno;
    const inizio = item.oraInizio;
    const fine = item.oraFine;
    const alunni = Math.max(0, Number(item.alunni) || 0);
    const prof1 = item.prof1 ? item.prof1.trim() : null;
    const prof2 = item.prof2 ? item.prof2.trim() : null;
    const allowOverlap = !!item.allowOverlap;

    // create class if missing
    let cls = state.classi.find(c => c.nome.toUpperCase() === classe);
    if (!cls) {
      cls = { nome: classe, alunni: alunni || 20, bypassRule7: false };
      state.classi.push(cls);
    } else {
      // update alunni if provided
      if (alunni) cls.alunni = alunni;
    }

    // create lab if missing
    let labItem = null;
    if (labName) {
      labItem = state.laboratori.find(l => l.nome.toLowerCase() === labName.toLowerCase());
      if (!labItem) {
        labItem = { nome: labName, owner: null, maxOreGiornoLab: rulesConfig.rule3Value, alunni: 15 };
        state.laboratori.push(labItem);
      }
    }
// === ensure project exists for activity (insert this before pushing the classActivity) ===
(function ensureProjectForActivity(activityName, labName) {
  if (!activityName) return;
  const exists = state.progetti && state.progetti.some(p => p.nome === activityName);
  if (exists) return;

  // create lab if provided and missing
  if (labName) {
    const labLower = labName.trim().toLowerCase();
    const labExists = state.laboratori.some(l => l.nome.toLowerCase() === labLower);
    if (!labExists) {
      // create a minimal lab entry; owner left null for now
      state.laboratori.push({ nome: labName, owner: null, maxOreGiornoLab: rulesConfig.rule3Value || 2, alunni: 20 });
    }
  }

  // create project template referencing lab if provided
  const newProj = {
    nome: activityName,
    descrizione: '',
    laboratorio: labName || null,
    note: ''
    // aggiungi altri campi template se necessari nel tuo schema (es. durataStandard, livello, ecc.)
  };
  if (!state.progetti) state.progetti = [];
  state.progetti.push(newProj);
  console.debug('Import: created project template for activity', newProj);
})(activity, labName);
    // create professors if missing (default limits)
    function ensureProf(name) {
      if (!name) return null;
      let p = state.professori.find(pp => pp.nome.toLowerCase() === name.toLowerCase());
      if (!p) {
        p = { nome: name, maxOreGiorno: rulesConfig.rule1Value, maxOreSettimana: rulesConfig.rule2Value };
        state.professori.push(p);
      }
      return p.nome;
    }
    const p1 = ensureProf(prof1);
    const p2 = ensureProf(prof2);
	

    // avoid duplicates: if exact same classActivity exists (same classe,nome,giorno,inizio) skip
    const exists = state.classActivities.some(a =>
      a.classe === classe && a.nome === activity && normalizeDateStr(a.giorno) === normalizeDateStr(giorno) && a.oraInizio === inizio && a.oraFine === fine
    );
    if (exists) { skipped++; return; }

    // push activity
    state.classActivities.push({
      classe,
      nome: activity,
      giorno: giorno,
      oraInizio: inizio,
      oraFine: fine,
      prof1: p1 || null,
      prof2: p2 || null,
      allowOverlap,
      allowLabMaxOverride: false
    });

    addedActivities++;
  });

  persist();
  renderData();
  closeClassImportModal();
  showToast(`Import completato. Aggiunte: ${addedActivities}. Saltate: ${skipped}. Non valide: ${invalid}.`, 5000);
}

// attach modal backdrop close
(function attachClassModalBackdrop() {
  const modal = document.getElementById('classImportModal');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeClassImportModal();
    }
  });
})();

// ensure buttons attached on load
document.addEventListener('DOMContentLoaded', () => {
  attachClassImportModalButtons();
});
/* ===== Activities Grid Enhanced: form editing, drag&drop, export, validation =====
   Place this code at the end of parte2.js (or in a file loaded after it).
   Requires: state, persist(), run(), generatePlanningView(), generateLabPlanningView(),
             normalizeDateStr(), genSlots(), timeToMin() if present.
   If helper funcs not present, local fallback implementations are used.
*/

// include SheetJS in page if not already present (for export)
(function ensureSheetJS() {
  if (typeof XLSX !== 'undefined') return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  document.head.appendChild(s);
})();

// local helper fallbacks (use existing ones if defined)
const _helpers = {
  normalizeDateStr: typeof normalizeDateStr === 'function' ? normalizeDateStr : (d => (d||'').split('T')[0]),
  genSlots: typeof genSlots === 'function' ? genSlots : function(start, end) {
    // produce 1-hour slots from start to end (hh:mm strings); inclusive start, exclusive end
    function toMin(t) { const [h,m]=t.split(':').map(Number); return h*60 + (m||0); }
    function toHHMM(m){ return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
    if (!start || !end) return [];
    let s = toMin(start), e = toMin(end);
    const slots = [];
    for (let t=s; t<e; t+=60) slots.push({ start: toHHMM(t), end: toHHMM(Math.min(t+60,e)) });
    return slots;
  },
  timeToMin: typeof timeToMin === 'function' ? timeToMin : (t => { const [h,m]=String(t||'00:00').split(':').map(Number); return h*60+(m||0); })
};

// open modal
function openActivitiesGridModalEnhanced(defaultClass) {
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal) return alert('Modal Activities Enhanced non trovato.');
  // populate class select
  const sel = document.getElementById('activitiesGridClassFilterEnhanced');
  sel.innerHTML = '<option value="">— Tutte —</option>';
  (state.classi || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.nome;
    opt.textContent = c.nome;
    sel.appendChild(opt);
  });
  if (defaultClass) sel.value = defaultClass;
  const startEl = document.getElementById('activitiesGridStartDateEnhanced');
  startEl.value = (document.getElementById('planningWeekStart') && document.getElementById('planningWeekStart').value) ? document.getElementById('planningWeekStart').value : (new Date()).toISOString().split('T')[0];
  modal.style.display = 'flex';
  modal.classList.add('show');
  modal._changes = {}; // key: idx -> {giorno, oraInizio, oraFine, prof1, prof2, laboratorio}
  activitiesGridRenderEnhanced();
}

// close
function closeActivitiesGridModalEnhanced() {
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.remove('show');
  document.getElementById('activitiesGridContainerEnhanced').innerHTML = '';
  document.getElementById('activitiesGridEditForm').style.display = 'none';
}

// render
function activitiesGridRenderEnhanced() {
  const classFilter = document.getElementById('activitiesGridClassFilterEnhanced').value;
  const startDate = document.getElementById('activitiesGridStartDateEnhanced').value;
  const days = Math.max(1, Math.min(14, Number(document.getElementById('activitiesGridDaysEnhanced').value || 5)));
  if (!startDate) return alert('Seleziona una data di inizio.');
  const daysArr = [];
  for (let i=0;i<days;i++){
    const d = new Date(startDate + 'T00:00:00'); d.setDate(d.getDate()+i);
    daysArr.push(d.toISOString().split('T')[0]);
  }

  let activities = (state.classActivities || []).slice();
  if (classFilter) activities = activities.filter(a => a.classe === classFilter);
  activities.sort((a,b) => (a.nome||'').localeCompare(b.nome||'') || (a.giorno||'').localeCompare(b.giorno||'') || (a.oraInizio||'').localeCompare(b.oraInizio||''));

  const container = document.getElementById('activitiesGridContainerEnhanced');
  container.innerHTML = '';

  // table
  const table = document.createElement('table');
  table.style.width = '100%'; table.style.borderCollapse = 'collapse'; table.style.fontSize = '13px';

  // header
  const thead = document.createElement('thead');
  const hdr = document.createElement('tr');
  hdr.style.background = 'var(--card-bg)';
  const stickyTh = document.createElement('th');
  stickyTh.style.position='sticky'; stickyTh.style.left='0'; stickyTh.style.background='var(--card-bg)'; stickyTh.style.zIndex='3'; stickyTh.style.minWidth='300px';
  stickyTh.textContent = 'Attività (Classe — Nome)';
  hdr.appendChild(stickyTh);
  daysArr.forEach(d => {
    const dt = new Date(d + 'T00:00:00');
    const label = dt.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'2-digit' });
    const th = document.createElement('th');
    th.textContent = label;
    th.style.textAlign = 'center'; th.style.padding='6px'; th.style.borderLeft='1px solid var(--border)';
    hdr.appendChild(th);
  });
  thead.appendChild(hdr); table.appendChild(thead);

  // group by classe+nome
  const groups = {};
  activities.forEach((a, idx) => {
    const key = `${a.classe}||${a.nome}`;
    if (!groups[key]) groups[key] = { items: [], idxs: [] };
    groups[key].items.push(a);
    groups[key].idxs.push(idx); // note: idx relative to activities array, not state.classActivities
  });

  const tbody = document.createElement('tbody');

  Object.entries(groups).forEach(([key, group]) => {
    const [classe, nome] = key.split('||');
    const row = document.createElement('tr');
    row.style.borderTop='1px solid var(--border)';

    // left cell
    const left = document.createElement('td');
    left.style.padding='8px'; left.style.verticalAlign='top'; left.style.minWidth='300px';
    left.innerHTML = `<strong>${nome}</strong><div style="color:#9ca3af">${classe}</div>`;
    const btns = document.createElement('div'); btns.style.marginTop='6px';
    const btnEdit = document.createElement('button'); btnEdit.className='btn-xs'; btnEdit.textContent='Modifica gruppo';
    btnEdit.onclick = () => openGroupEditModalEnhanced(group.items);
    btns.appendChild(btnEdit);
    left.appendChild(btns);
    row.appendChild(left);

    // populate columns
    daysArr.forEach(dateISO => {
      const td = document.createElement('td');
      td.style.padding='6px'; td.style.verticalAlign='top'; td.style.borderLeft='1px solid var(--border)';
      td.dataset.date = dateISO;
      // make droppable
      td.ondragover = e => { e.preventDefault(); td.style.outline='2px dashed #888'; };
      td.ondragleave = e => { td.style.outline=''; };
      td.ondrop = e => {
        e.preventDefault(); td.style.outline='';
        const payload = e.dataTransfer.getData('text/plain');
        if (!payload) return;
        try {
          const { idxGlobal } = JSON.parse(payload);
          handleDropActivityEnhanced(idxGlobal, dateISO);
        } catch(err){ console.error(err); }
      };

      // find items in this day
      const items = group.items.filter(it => _helpers.normalizeDateStr(it.giorno) === dateISO);
      if (items.length === 0) {
        td.innerHTML = '<small style="color:#9ca3af">—</small>';
      } else {
        items.forEach(it => {
          const card = document.createElement('div');
          card.style.marginBottom='6px'; card.style.padding='6px'; card.style.borderRadius='6px';
          // color by assignment state
          const assigned = isActivityAssigned(it);
          if (assigned === 'assigned') card.style.background = 'linear-gradient(90deg,#064e3b,#065f46)'; // green
          else if (assigned === 'pending') card.style.background = 'linear-gradient(90deg,#b45309,#92400e)'; // amber
          else card.style.background = 'linear-gradient(90deg,#0f172a,#0b1220)'; // neutral dark
          card.style.color = '#fff'; card.style.cursor='grab';
          card.draggable = true;
          // when dragging, we encode the index of the activity in state.classActivities
          card.ondragstart = function(ev) {
            // find global index
            const idxGlobal = state.classActivities.findIndex(a => a === it || (a.classe===it.classe && a.nome===it.nome && a.giorno===it.giorno && a.oraInizio===it.oraInizio && a.oraFine===it.oraFine));
            ev.dataTransfer.setData('text/plain', JSON.stringify({ idxGlobal }));
            ev.dataTransfer.effectAllowed = 'move';
          };
          const timeLabel = `${it.oraInizio || ''} - ${it.oraFine || ''}`;
          card.innerHTML = `<div style="font-weight:700">${timeLabel}</div><div style="font-size:12px;">${it.prof1 || ''}${it.prof2 ? ', '+it.prof2 : ''}</div>`;
          card.onclick = () => openEditFormEnhanced(it);
          td.appendChild(card);
        });
      }
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// check if an activity (classActivity obj) is assigned (uses state.risultato)
function isActivityAssigned(act) {
  if (!act) return 'none';
  // find any risultato entries matching class/activity/date/time
  const rs = (state.risultato || []).filter(r => r.classe === act.classe && r.attivita === act.nome && _helpers.normalizeDateStr(r.giorno) === _helpers.normalizeDateStr(act.giorno) && r.ora === act.oraInizio);
  if (!rs || rs.length === 0) return 'pending';
  // if any assignment is locked or has professor, consider assigned
  const assigned = rs.some(r => r.professore || r.locked);
  return assigned ? 'assigned' : 'pending';
}

// open the advanced edit form for one activity
function openEditFormEnhanced(activityObj) {
  const idx = state.classActivities.findIndex(a => a === activityObj || (a.classe===activityObj.classe && a.nome===activityObj.nome && a.giorno===activityObj.giorno && a.oraInizio===activityObj.oraInizio && a.oraFine===activityObj.oraFine));
  if (idx === -1) return alert('Attività non trovata.');
  document.getElementById('activitiesGridEditForm').style.display = 'block';
  document.getElementById('edit_idx').value = idx;
  document.getElementById('edit_classe').value = activityObj.classe || '';
  document.getElementById('edit_nome').value = activityObj.nome || '';
  document.getElementById('edit_giorno').value = _helpers.normalizeDateStr(activityObj.giorno) || '';
  document.getElementById('edit_inizio').value = activityObj.oraInizio || '';
  document.getElementById('edit_fine').value = activityObj.oraFine || '';
  document.getElementById('edit_prof1').value = activityObj.prof1 || '';
  document.getElementById('edit_prof2').value = activityObj.prof2 || '';
  document.getElementById('edit_lab').value = activityObj.laboratorio || activityObj.lab || '';
  document.getElementById('editFormValidation').textContent = '';
}
// Apri il form di edit per un gruppo: mostra lo stesso form avanzato e salva la lista di indici di gruppo
function openGroupEditModalEnhanced(items) {
  if (!items || !items.length) return alert('Nessuna attività per il gruppo.');
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal) return alert('Modal non trovato.');
  // trova gli indici globali (state.classActivities)
  const indices = [];
  items.forEach(it => {
    const idx = state.classActivities.findIndex(a => a === it || (a.classe===it.classe && a.nome===it.nome && a.giorno===it.giorno && a.oraInizio===it.oraInizio && a.oraFine===it.oraFine));
    if (idx !== -1) indices.push(idx);
  });
  if (!indices.length) return alert('Impossibile mappare attività del gruppo.');

  // usa il primo elemento come sample per popolare il form
  const sample = items[0];
  openEditFormEnhanced(sample); // apre il form e lo popola
  // memorizza la lista degli indici del gruppo nel modal
  modal._groupEditIndices = indices;
  // mostra indicazione sul form
  document.getElementById('editFormValidation').textContent = `Modifica gruppo: ${indices.length} attività (la modifica sarà applicata a tutte)`;
}
// cancel edit
function cancelEditFormEnhanced() {
  document.getElementById('activitiesGridEditForm').style.display = 'none';
  document.getElementById('activitiesGridEditFormBody').reset && document.getElementById('activitiesGridEditFormBody').reset();
}

// save single edit into modal._changes
function saveEditFormEnhanced() {
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal) return;
  const idx = Number(document.getElementById('edit_idx').value);
  const giorno = document.getElementById('edit_giorno').value;
  const inizio = document.getElementById('edit_inizio').value;
  const fine = document.getElementById('edit_fine').value;
  const prof1 = document.getElementById('edit_prof1').value.trim();
  const prof2 = document.getElementById('edit_prof2').value.trim();
  const lab = document.getElementById('edit_lab').value.trim();

  // basic validation immediate
  if (!giorno || !inizio || !fine || inizio >= fine) {
    document.getElementById('editFormValidation').textContent = 'Orario non valido.';
    return;
  }

  // if group edit indices present -> apply to each
  const groupIndices = modal._groupEditIndices || null;
  if (groupIndices && Array.isArray(groupIndices) && groupIndices.length) {
    const applied = [];
    groupIndices.forEach(i => {
      if (!state.classActivities[i]) return;
      state.classActivities[i].giorno = giorno;
      state.classActivities[i].oraInizio = inizio;
      state.classActivities[i].oraFine = fine;
      state.classActivities[i].prof1 = prof1 || state.classActivities[i].prof1;
      state.classActivities[i].prof2 = prof2 || state.classActivities[i].prof2;
      if (lab !== '') state.classActivities[i].laboratorio = lab;
      applied.push(i);
    });
    persist && persist();
    // rerun planner
    if (typeof run === 'function') run(true);
    if (typeof generatePlanningView === 'function') generatePlanningView();
    if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    showToast(`Applicate ${applied.length} modifiche al gruppo`, 3000);
    // clear group flag and form
    modal._groupEditIndices = null;
    document.getElementById('editFormValidation').textContent = '';
    activitiesGridRenderEnhanced();
    return;
  }

  // Otherwise: single activity — apply immediately
  const targetIdx = idx;
  if (state.classActivities[targetIdx]) {
    state.classActivities[targetIdx].giorno = giorno;
    state.classActivities[targetIdx].oraInizio = inizio;
    state.classActivities[targetIdx].oraFine = fine;
    state.classActivities[targetIdx].prof1 = prof1 || state.classActivities[targetIdx].prof1;
    state.classActivities[targetIdx].prof2 = prof2 || state.classActivities[targetIdx].prof2;
    if (lab !== '') state.classActivities[targetIdx].laboratorio = lab;

    persist && persist();
    if (typeof run === 'function') run(true);
    if (typeof generatePlanningView === 'function') generatePlanningView();
    if (typeof generateLabPlanningView === 'function') generateLabPlanningView();

    document.getElementById('editFormValidation').textContent = 'Modifica applicata.';
    showToast('Modifica applicata', 2000);
    // hide form
    document.getElementById('activitiesGridEditForm').style.display = 'none';
    activitiesGridRenderEnhanced();
  } else {
    document.getElementById('editFormValidation').textContent = 'Attività non trovata.';
  }
}

// bulk edit (group)
function editActivityBulkEnhanced(items) {
  if (!items || !items.length) return;
  const sample = items[0];
  // open a simple modal-like prompt form
  const newDate = prompt('Giorno (YYYY-MM-DD) - lascia vuoto per non modificare:', sample.giorno || '');
  if (newDate === null) return;
  const newStart = prompt('Ora inizio (HH:MM) - lascia vuoto per non modificare:', sample.oraInizio || '');
  if (newStart === null) return;
  const newEnd = prompt('Ora fine (HH:MM) - lascia vuoto per non modificare:', sample.oraFine || '');
  if (newEnd === null) return;

  const modal = document.getElementById('activitiesGridModalEnhanced');
  modal._changes = modal._changes || {};
  items.forEach(it => {
    const idx = state.classActivities.findIndex(a => a === it || (a.classe===it.classe && a.nome===it.nome && a.giorno===it.giorno && a.oraInizio===it.oraInizio && a.oraFine===it.oraFine));
    if (idx !== -1) {
      modal._changes[idx] = {
        giorno: newDate || it.giorno,
        oraInizio: newStart || it.oraInizio,
        oraFine: newEnd || it.oraFine,
        prof1: it.prof1 || null,
        prof2: it.prof2 || null,
        laboratorio: it.laboratorio || null
      };
    }
  });
  showToast('Modifiche di gruppo memorizzate (salva per applicare)', 3000);
  activitiesGridRenderEnhanced();
}

// handle drop: idxGlobal from payload, targetDate -> create change with same time but new date
function handleDropActivityEnhanced(idxGlobal, targetDate) {
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal) return;
  const act = state.classActivities[idxGlobal];
  if (!act) return;
  // apply immediately
  act.giorno = targetDate;
  persist && persist();
  if (typeof run === 'function') run(true);
  if (typeof generatePlanningView === 'function') generatePlanningView();
  if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
  showToast('Attività spostata', 1600);
  activitiesGridRenderEnhanced();
}

// Apply all changes with validations (R1/R2/availability/lab owner)
function activitiesGridApplyChangesEnhanced() {
  const modal = document.getElementById('activitiesGridModalEnhanced');
  if (!modal || !modal._changes || Object.keys(modal._changes).length === 0) return alert('Nessuna modifica da salvare.');

  const changes = modal._changes;
  const errors = [];
  const warnings = [];
  const applied = [];

  // helpers for validations
  function profDailyHours(profName, day, extraChange) {
    // count hours already assigned in state.risultato for that prof on day plus extraChange (in hours)
    const dayStr = _helpers.normalizeDateStr(day);
    const assignedHours = (state.risultato || []).filter(r => r.professore === profName && _helpers.normalizeDateStr(r.giorno) === dayStr).reduce((s,r)=> s + (r.durata || 1), 0);
    return assignedHours + (extraChange || 0);
  }
  function profWeeklyHours(profName, weekStartISO, extraChange) {
    const ws = new Date(weekStartISO + 'T00:00:00');
    const we = new Date(ws); we.setDate(ws.getDate()+7);
    const assigned = (state.risultato || []).filter(r => r.professore === profName && new Date(_helpers.normalizeDateStr(r.giorno)+'T00:00:00') >= ws && new Date(_helpers.normalizeDateStr(r.giorno)+'T00:00:00') < we).reduce((s,r)=> s + (r.durata || 1), 0);
    return assigned + (extraChange || 0);
  }
  function profHasAvailability(profName, day, start, end) {
    if (!profName) return true; // no professor specified -> can't check, assume ok
    // find availability entry for professor covering the entire interval
    const avail = (state.disponibilita || []).filter(d => d.professore && d.professore.toLowerCase() === profName.toLowerCase() && _helpers.normalizeDateStr(d.giorno) === _helpers.normalizeDateStr(day));
    if (!avail || avail.length===0) return false;
    const smin = _helpers.timeToMin(start), emin = _helpers.timeToMin(end);
    return avail.some(a => _helpers.timeToMin(a.oraInizio) <= smin && _helpers.timeToMin(a.oraFine) >= emin);
  }
  function findProfObjByName(name) {
    return (state.professori || []).find(p => p.nome.toLowerCase() === (name||'').toLowerCase());
  }
  function weekStartOfISO(dateISO) {
    const d = new Date(dateISO + 'T00:00:00');
    const day = d.getDay(); // 0 sunday
    const diff = (day + 6) % 7; // monday as start
    d.setDate(d.getDate() - diff);
    return d.toISOString().split('T')[0];
  }

  // validate all changes first
  Object.keys(changes).forEach(k => {
    const idx = Number(k);
    const ch = changes[k];
    const orig = state.classActivities[idx];
    if (!orig) { errors.push(`Riga ${idx}: attività non trovata`); return; }
    // basic time validation
    if (!ch.giorno || !ch.oraInizio || !ch.oraFine || ch.oraInizio >= ch.oraFine) { errors.push(`${orig.classe} — ${orig.nome}: orario non valido`); return; }

    // check lab owner if lab present (project/lab rules handled here — if lab requested check owner)
    const labName = ch.laboratorio || orig.laboratorio || null;
    if (labName) {
      const labObj = (state.laboratori || []).find(l => l.nome === labName);
      if (labObj && !labObj.owner) { errors.push(`${orig.classe} — ${orig.nome}: lab "${labName}" senza owner`); return; }
    }

    // check professors availability + R1/R2
    const p1 = ch.prof1 || orig.prof1;
    const p2 = ch.prof2 || orig.prof2;

    // compute duration hours (in hours, may be non-integer but we use hour slots)
    const smin = _helpers.timeToMin(ch.oraInizio), emin = _helpers.timeToMin(ch.oraFine);
    const durHours = (emin - smin)/60;

    // for each professor specified verify availability and limits
    [p1, p2].forEach((pn) => {
      if (!pn) return;
      // availability
      if (!profHasAvailability(pn, ch.giorno, ch.oraInizio, ch.oraFine)) {
        errors.push(`${orig.classe} — ${orig.nome}: il docente ${pn} non è disponibile per ${ch.giorno} ${ch.oraInizio}-${ch.oraFine}`);
        return;
      }
      // daily limit
      const profObj = findProfObjByName(pn);
      const maxDay = profObj ? (profObj.maxOreGiorno || rulesConfig.rule1Value) : rulesConfig.rule1Value;
      const dayStart = profDailyHours(pn, ch.giorno, durHours);
      if (dayStart > maxDay) {
        errors.push(`${orig.classe} — ${orig.nome}: il docente ${pn} supererebbe limite giornaliero (${dayStart}/${maxDay})`);
        return;
      }
      // weekly limit
      const ws = weekStartOfISO(ch.giorno);
      const wk = profWeeklyHours(pn, ws, durHours);
      const maxWeek = profObj ? (profObj.maxOreSettimana || rulesConfig.rule2Value) : rulesConfig.rule2Value;
      if (wk > maxWeek) {
        errors.push(`${orig.classe} — ${orig.nome}: il docente ${pn} supererebbe limite settimanale (${wk}/${maxWeek})`);
        return;
      }
    });

    // R10-ish: if activity is a multi-hour block, ensure at least one professor can cover entire block (already checked by profHasAvailability)
    // R10 specifics (consecutive same prof preferences) are enforced by planner; here we ensure availability only.

    // if passed all checks, record as ok
  });

  if (errors.length) {
    alert('Modifiche non applicate. Errori:\n' + errors.join('\n'));
    return;
  }

  // apply changes
  Object.keys(changes).forEach(k => {
    const idx = Number(k);
    const ch = changes[k];
    const orig = state.classActivities[idx];
    if (!orig) return;
    // update fields
    orig.giorno = ch.giorno;
    orig.oraInizio = ch.oraInizio;
    orig.oraFine = ch.oraFine;
    if (ch.prof1 !== undefined) orig.prof1 = ch.prof1;
    if (ch.prof2 !== undefined) orig.prof2 = ch.prof2;
    if (ch.laboratorio !== undefined) orig.laboratorio = ch.laboratorio;
    applied.push(`${orig.classe} — ${orig.nome} → ${ch.giorno} ${ch.oraInizio}-${ch.oraFine}`);
  });

  if (applied.length) {
    persist && persist();
    modal._changes = {}; // clear
    // rerun planner
    if (typeof run === 'function') run(true);
    if (typeof generatePlanningView === 'function') generatePlanningView();
    if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    showToast(`Applicate ${applied.length} modifiche`, 3000);
  }
  activitiesGridRenderEnhanced();
}

// Export CSV / XLSX: gather visible table rows into CSV
function activitiesGridExportCSV() {
  const startDate = document.getElementById('activitiesGridStartDateEnhanced').value;
  const days = Math.max(1, Math.min(14, Number(document.getElementById('activitiesGridDaysEnhanced').value || 5)));
  if (!startDate) return alert('Seleziona data di inizio prima di esportare.');
  const daysArr = [];
  for (let i=0;i<days;i++){ const d = new Date(startDate+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }

  // build CSV rows: Classe,Attività,Giorno,Inizio,Fine,Prof1,Prof2,Lab,Stato
  const rows = [['Classe','Attività','Giorno','Inizio','Fine','Prof1','Prof2','Lab','Stato']];
  const activities = (state.classActivities || []).slice();
  activities.forEach(a => {
    if (!daysArr.includes(_helpers.normalizeDateStr(a.giorno))) return;
    const st = isActivityAssigned(a);
    rows.push([a.classe, a.nome, _helpers.normalizeDateStr(a.giorno), a.oraInizio, a.oraFine, a.prof1||'', a.prof2||'', a.laboratorio||'', st]);
  });

  const csv = rows.map(r => r.map(cell => `"${String(cell||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'activities_export.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// XLSX export using SheetJS
function activitiesGridExportXLSX() {
  if (typeof XLSX === 'undefined') return alert('XLSX library non caricata (SheetJS). Riprova dopo qualche secondo.');
  const startDate = document.getElementById('activitiesGridStartDateEnhanced').value;
  const days = Math.max(1, Math.min(14, Number(document.getElementById('activitiesGridDaysEnhanced').value || 5)));
  if (!startDate) return alert('Seleziona data di inizio prima di esportare.');
  const daysArr = [];
  for (let i=0;i<days;i++){ const d = new Date(startDate+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }

  const rows = [['Classe','Attività','Giorno','Inizio','Fine','Prof1','Prof2','Lab','Stato']];
  (state.classActivities || []).forEach(a => {
    if (!daysArr.includes(_helpers.normalizeDateStr(a.giorno))) return;
    const st = isActivityAssigned(a);
    rows.push([a.classe, a.nome, _helpers.normalizeDateStr(a.giorno), a.oraInizio, a.oraFine, a.prof1||'', a.prof2||'', a.laboratorio||'', st]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Activities');
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'activities_export.xlsx'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* small UI helper */
function showToast(msg, ms = 2000) {
  // Try to use app's showToast if available and safe
  try {
    if (typeof window.showToast === 'function' && window.showToast !== showToast) {
      try { window.showToast(msg, ms); return; } catch (err) { console.warn('window.showToast failed, fallback', err); }
    }
  } catch (err) {
    console.warn('showToast detection failure', err);
  }
  // fallback simple toast
  try {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.right = '16px';
    el.style.bottom = '16px';
    el.style.background = '#111';
    el.style.color = '#fff';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '6px';
    el.style.zIndex = 99999;
    document.body.appendChild(el);
    setTimeout(() => {
      try { el.remove(); } catch(e){ if (el.parentNode) el.parentNode.removeChild(el); }
    }, ms || 2000);
  } catch (err) {
    // last resort: console log
    console.log('Toast:', msg);
  }
}
// ===== Prof Availability Modal =====
//
// Inserire dopo le definizioni di state, state.disponibilita, state.risultato, state.professori.
// Espone globalmente openProfAvailabilityModal(nameOpt) e closeProfAvailabilityModal().
//

(function(){
  // Carica SheetJS se serve (per esportazione XLSX)
  (function ensureSheetJS(){
    if (typeof XLSX !== 'undefined') return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    document.head.appendChild(s);
  })();

  // helper fallback
  const H = {
    normalizeDateStr: typeof normalizeDateStr === 'function' ? normalizeDateStr : (d => (d||'').split('T')[0]),
    timeToMin: typeof timeToMin === 'function' ? timeToMin : (t => { const [h,m]=String(t||'00:00').split(':').map(Number); return h*60 + (m||0); }),
    minToTime: (m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'))
  };

  // DOM refs
  const modal = document.getElementById('profAvailabilityModal');
  const content = document.getElementById('profAvailabilityModalContent');
  const header = document.getElementById('profAvailabilityHeader');
  const selectProf = document.getElementById('profAvailabilitySelect');
  const startEl = document.getElementById('profAvailabilityStart');
  const daysEl = document.getElementById('profAvailabilityDays');
  const fromEl = document.getElementById('profAvailabilityFrom');
  const toEl = document.getElementById('profAvailabilityTo');
  const slotEl = document.getElementById('profAvailabilitySlotMin');
  const container = document.getElementById('profAvailabilityContainer');
  const subtitle = document.getElementById('profAvailabilitySubtitle');

  // state for modal
  let multiMode = false;
  let selectedMultiple = []; // array of prof names if multiMode

  // populate professor select
  function populateProfSelect() {
    if (!selectProf) return;
    selectProf.innerHTML = '<option value="">— Seleziona docente —</option>';
    (state.professori || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.nome;
      opt.textContent = p.nome;
      selectProf.appendChild(opt);
    });
  }
  populateProfSelect();

  // open modal
  window.openProfAvailabilityModal = function(name) {
    if (!modal || !content) { console.warn('Modal non trovato'); return; }
    if (!startEl.value && document.getElementById('planningWeekStart')) startEl.value = document.getElementById('planningWeekStart').value || new Date().toISOString().split('T')[0];
    if (!startEl.value) startEl.value = new Date().toISOString().split('T')[0];
    modal.style.display = 'block';
    content.style.display = 'block';
    subtitle.textContent = name ? ` — ${name}` : '';
    if (name) selectProf.value = name;
    renderProfAvailabilityGrid();
  };

  window.closeProfAvailabilityModal = function() {
    if (!modal || !content) return;
    modal.style.display = 'none';
  };

  // toggle multi mode
  window.profAvailabilityToggleMulti = function() {
    multiMode = !multiMode;
    if (multiMode) {
      // show multi selection prompt (simple)
      const names = prompt('Inserisci i nomi dei docenti separati da virgola (es. Marco Rossi, Lucia Bianchi):', '');
      if (!names) { multiMode = false; return; }
      selectedMultiple = names.split(',').map(s => s.trim()).filter(Boolean);
      subtitle.textContent = ` — multi: ${selectedMultiple.join(', ')}`;
    } else {
      selectedMultiple = [];
      subtitle.textContent = '';
    }
    renderProfAvailabilityGrid();
  };

  // compute availability grid for a single professor
  function computeGridForProf(profName, daysArr, slotMin, fromMin, toMin) {
    // build array of slots (start minutes)
    const slots = [];
    for (let m = fromMin; m < toMin; m += slotMin) slots.push(m);

    // gather availabilities for profName
    const av = (state.disponibilita || []).filter(d => d.professore && d.professore.toLowerCase() === (profName||'').toLowerCase());

    // gather assignments from state.risultato
    const assigned = (state.risultato || []).filter(r => r.professore && r.professore.toLowerCase() === (profName||'').toLowerCase());

    // Results: per day -> slot -> state: 'free' | 'busy' | 'no-availability'
    const result = {};
    daysArr.forEach(d => {
      result[d] = {};
      slots.forEach(s => {
        // is there availability covering this slot?
        const availForDay = av.filter(a => H.normalizeDateStr(a.giorno) === d);
        const hasAvail = availForDay.some(a => H.timeToMin(a.oraInizio) <= s && H.timeToMin(a.oraFine) >= (s + slotMin));
        if (!hasAvail) {
          result[d][s] = 'no-availability';
          return;
        }
        // is there an assignment covering this slot?
        const busy = assigned.some(a => H.normalizeDateStr(a.giorno) === d && H.timeToMin(a.ora) <= s && H.timeToMin(a.ora) + (a.durata||1)*60 > s);
        result[d][s] = busy ? 'busy' : 'free';
      });
    });
    return { slots, result };
  }

  // render grid (single or multi)
  window.renderProfAvailabilityGrid = function() {
    if (!container) return;
    const prof = selectProf.value;
    const start = startEl.value;
    const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const from = fromEl.value || '08:00';
    const to = toEl.value || '17:00';
    const slotMin = Math.max(15, Math.min(180, Number(slotEl.value || 60)));
    if (!start) return alert('Seleziona data di inizio');
    // build days array
    const daysArr = [];
    for (let i=0;i<days;i++){ const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const fromMin = H.timeToMin(from), toMin = H.timeToMin(to);
    container.innerHTML = '';

    // header: days
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '13px';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th style="position:sticky; left:0; background:var(--card-bg); z-index:3; min-width:160px">Orario / Giorno</th>`;
    daysArr.forEach(d => {
      const dt = new Date(d + 'T00:00:00');
      const label = dt.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'2-digit' });
      const th = document.createElement('th');
      th.textContent = label;
      th.style.textAlign = 'center';
      th.style.padding = '6px';
      th.style.borderLeft = '1px solid var(--border)';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    // rows: slots
    const tbody = document.createElement('tbody');

    // if multiMode, we will show badge per slot with professor names free/busy
    const slotStarts = [];
    for (let m = fromMin; m < toMin; m += slotMin) slotStarts.push(m);

    slotStarts.forEach(s => {
      const tr = document.createElement('tr');
      tr.style.borderTop = '1px solid var(--border)';
      const left = document.createElement('td');
      left.style.padding = '6px';
      left.style.minWidth = '160px';
      left.textContent = H.minToTime(s) + ' - ' + H.minToTime(Math.min(s + slotMin, toMin));
      tr.appendChild(left);

      daysArr.forEach(d => {
        const td = document.createElement('td');
        td.style.padding = '6px';
        td.style.borderLeft = '1px solid var(--border)';
        td.style.textAlign = 'center';
        // compute for single or multi
        if (!multiMode) {
          if (!prof) { td.innerHTML = '<small style="color:#9ca3af">Seleziona docente</small>'; }
          else {
            const grid = computeGridForProf(prof, daysArr, slotMin, fromMin, toMin);
            const stateSlot = grid.result[d] ? grid.result[d][s] : 'no-availability';
            if (stateSlot === 'free') td.innerHTML = `<div style="background:#064e3b;color:#fff;padding:6px;border-radius:6px">LIBERO</div>`;
            else if (stateSlot === 'busy') td.innerHTML = `<div style="background:#b91c1c;color:#fff;padding:6px;border-radius:6px">OCCUPATO</div>`;
            else td.innerHTML = `<div style="background:#374151;color:#fff;padding:6px;border-radius:6px">N/DISP</div>`;
          }
        } else {
          // multi mode: for each selectedMultiple prof compute status
          if (!selectedMultiple || selectedMultiple.length===0) {
            td.innerHTML = '<small style="color:#9ca3af">Aggiungi docenti</small>';
          } else {
            const badges = [];
            selectedMultiple.forEach(pn => {
              const g = computeGridForProf(pn, daysArr, slotMin, fromMin, toMin);
              const st = g.result[d] ? g.result[d][s] : 'no-availability';
              let color = '#6b7280', label = 'N/D';
              if (st === 'free') { color = '#065f46'; label = 'L'; }
              else if (st === 'busy') { color = '#b91c1c'; label = 'O'; }
              else { color = '#374151'; label = 'N'; }
              badges.push(`<span title="${pn}" style="display:inline-block;margin:2px;padding:4px 6px;border-radius:4px;background:${color};color:#fff;font-size:11px">${label}</span>`);
            });
            td.innerHTML = badges.join('');
          }
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  };

  // Export CSV/XLSX (visible data)
  window.profAvailabilityExportCSV = function() {
    const prof = selectProf.value;
    const start = startEl.value; const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const fromMin = H.timeToMin(fromEl.value||'08:00'), toMin = H.timeToMin(toEl.value||'17:00');
    const slotMin = Math.max(15, Number(slotEl.value||60));
    const daysArr = []; for (let i=0;i<days;i++){ const d = new Date(start+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const rows = [['Professore','Giorno','Inizio','Fine','Stato']];
    if (!multiMode) {
      if (!prof) return alert('Seleziona un docente');
      const grid = computeGridForProf(prof, daysArr, slotMin, fromMin, toMin);
      daysArr.forEach(d => {
        grid.slots.forEach(s => {
          const st = grid.result[d] ? grid.result[d][s] : 'no-availability';
          rows.push([prof,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)),st]);
        });
      });
    } else {
      if (!selectedMultiple || selectedMultiple.length===0) return alert('Nessun docente specificato per export multi');
      selectedMultiple.forEach(p => {
        const grid = computeGridForProf(p, daysArr, slotMin, fromMin, toMin);
        daysArr.forEach(d => {
          grid.slots.forEach(s => {
            const st = grid.result[d] ? grid.result[d][s] : 'no-availability';
            rows.push([p,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)),st]);
          });
        });
      });
    }
    const csv = rows.map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'prof_availability.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window.profAvailabilityExportXLSX = function() {
    if (typeof XLSX === 'undefined') return alert('XLSX library non caricata. Riprova tra un secondo.');
    // reuse CSV logic to build rows
    const prof = selectProf.value;
    const start = startEl.value; const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const fromMin = H.timeToMin(fromEl.value||'08:00'), toMin = H.timeToMin(toEl.value||'17:00');
    const slotMin = Math.max(15, Number(slotEl.value||60));
    const daysArr = []; for (let i=0;i<days;i++){ const d = new Date(start+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const rows = [['Professore','Giorno','Inizio','Fine','Stato']];
    if (!multiMode) {
      if (!prof) return alert('Seleziona un docente');
      const grid = computeGridForProf(prof, daysArr, slotMin, fromMin, toMin);
      daysArr.forEach(d => {
        grid.slots.forEach(s => rows.push([prof,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)), grid.result[d] ? grid.result[d][s] : 'no-availability']));
      });
    } else {
      if (!selectedMultiple || selectedMultiple.length===0) return alert('Nessun docente specificato per export multi');
      selectedMultiple.forEach(p => {
        const grid = computeGridForProf(p, daysArr, slotMin, fromMin, toMin);
        daysArr.forEach(d => { grid.slots.forEach(s => rows.push([p,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)), grid.result[d] ? grid.result[d][s] : 'no-availability'])); });
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Availability');
    const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'prof_availability.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Apply & Close: utile se vuoi confermare e chiudere
  window.profAvailabilityApplyAndClose = function() {
    // per ora solo ricalcola e chiude
    renderProfAvailabilityGrid();
    closeProfAvailabilityModal();
  };

  // Make modal draggable by header (store position in style left/top)
  (function makeDraggable(){
    if (!header || !content) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener('mousedown', function(e){
      dragging = true;
      const rect = content.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e){
      if (!dragging) return;
      let left = e.clientX - offsetX;
      let top = e.clientY - offsetY;
      // keep within window bounds
      left = Math.max(8, Math.min(left, window.innerWidth - content.offsetWidth - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - content.offsetHeight - 8));
      content.style.left = left + 'px';
      content.style.top = top + 'px';
    });
    document.addEventListener('mouseup', function(){
      dragging = false; document.body.style.userSelect = '';
    });
    // prevent clicks inside modal from closing (we don't close on outside clicks anyway)
    modal.addEventListener('click', function(e){ /* noop */ });
    // ensure content click does not close
    content.addEventListener('click', function(e){ e.stopPropagation(); });
  })();

  // re-populate professor select periodically in case state.professori changes
  // meno intrusivo: aggiorna ogni 10 secondi e salva l'id per poterlo cancellare
if (window._profSelectInterval) clearInterval(window._profSelectInterval);
window._profSelectInterval = setInterval(() => {
  try { populateProfSelect(); } catch(e){ /* silent */ }
}, 10000);

  // expose helpers for testing
  window._profAvailability_computeGridForProf = computeGridForProf;
})();
// ===== Prof Availability Modal =====
//
// Inserire dopo le definizioni di state, state.disponibilita, state.risultato, state.professori.
// Espone globalmente openProfAvailabilityModal(nameOpt) e closeProfAvailabilityModal().
//

(function(){
  // Carica SheetJS se serve (per esportazione XLSX)
  (function ensureSheetJS(){
    if (typeof XLSX !== 'undefined') return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    document.head.appendChild(s);
  })();

  // helper fallback
  const H = {
    normalizeDateStr: typeof normalizeDateStr === 'function' ? normalizeDateStr : (d => (d||'').split('T')[0]),
    timeToMin: typeof timeToMin === 'function' ? timeToMin : (t => { const [h,m]=String(t||'00:00').split(':').map(Number); return h*60 + (m||0); }),
    minToTime: (m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'))
  };

  // DOM refs
  const modal = document.getElementById('profAvailabilityModal');
  const content = document.getElementById('profAvailabilityModalContent');
  const header = document.getElementById('profAvailabilityHeader');
  const selectProf = document.getElementById('profAvailabilitySelect');
  const startEl = document.getElementById('profAvailabilityStart');
  const daysEl = document.getElementById('profAvailabilityDays');
  const fromEl = document.getElementById('profAvailabilityFrom');
  const toEl = document.getElementById('profAvailabilityTo');
  const slotEl = document.getElementById('profAvailabilitySlotMin');
  const container = document.getElementById('profAvailabilityContainer');
  const subtitle = document.getElementById('profAvailabilitySubtitle');

  // state for modal
  let multiMode = false;
  let selectedMultiple = []; // array of prof names if multiMode

  // populate professor select
  function populateProfSelect() {
    if (!selectProf) return;
    selectProf.innerHTML = '<option value="">— Seleziona docente —</option>';
    (state.professori || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.nome;
      opt.textContent = p.nome;
      selectProf.appendChild(opt);
    });
  }
  populateProfSelect();

  // open modal
  window.openProfAvailabilityModal = function(name) {
    if (!modal || !content) { console.warn('Modal non trovato'); return; }
    if (!startEl.value && document.getElementById('planningWeekStart')) startEl.value = document.getElementById('planningWeekStart').value || new Date().toISOString().split('T')[0];
    if (!startEl.value) startEl.value = new Date().toISOString().split('T')[0];
    modal.style.display = 'block';
    content.style.display = 'block';
    subtitle.textContent = name ? ` — ${name}` : '';
    if (name) selectProf.value = name;
    renderProfAvailabilityGrid();
  };

  window.closeProfAvailabilityModal = function() {
    if (!modal || !content) return;
    modal.style.display = 'none';
  };

  // toggle multi mode
  window.profAvailabilityToggleMulti = function() {
    multiMode = !multiMode;
    if (multiMode) {
      // show multi selection prompt (simple)
      const names = prompt('Inserisci i nomi dei docenti separati da virgola (es. Marco Rossi, Lucia Bianchi):', '');
      if (!names) { multiMode = false; return; }
      selectedMultiple = names.split(',').map(s => s.trim()).filter(Boolean);
      subtitle.textContent = ` — multi: ${selectedMultiple.join(', ')}`;
    } else {
      selectedMultiple = [];
      subtitle.textContent = '';
    }
    renderProfAvailabilityGrid();
  };

  // compute availability grid for a single professor
// REPLACE computeGridForProf + renderProfAvailabilityGrid with this implementation
// This produces a grid: for each day and slot -> array of professor names available (not busy)

function computeAvailabilityForAllProfs(profFilterNames, daysArr, slotMin, fromMin, toMin) {
  // profFilterNames: if provided (array), consider only those profs; otherwise consider all in state.professori
  const profList = (profFilterNames && profFilterNames.length) ? profFilterNames.slice() : (state.professori || []).map(p => p.nome);
  // normalize names to string
  const profs = profList.map(p => String(p || '').trim()).filter(Boolean);

  // build slot starts (minutes)
  const slotStarts = [];
  for (let m = fromMin; m < toMin; m += slotMin) slotStarts.push(m);

  // gather disponibilita grouped by professor and day for faster checks
  const dispByProf = {};
  (state.disponibilita || []).forEach(d => {
    const name = (d.professore || '').toString().trim();
    if (!name) return;
    if (profList && profList.length && profList.indexOf(name) === -1 && profs.indexOf(name) === -1) {
      // if profFilterNames given and name not in it, skip
      if (profFilterNames && profFilterNames.length) return;
    }
    dispByProf[name] = dispByProf[name] || {};
    const day = (typeof normalizeDateStr === 'function') ? normalizeDateStr(d.giorno) : (d.giorno||'').split('T')[0];
    dispByProf[name][day] = dispByProf[name][day] || [];
    dispByProf[name][day].push({ start: (d.oraInizio || '00:00'), end: (d.oraFine || '00:00') });
  });

  // gather assignments (state.risultato) grouped by prof and day -> array of occupied minute intervals
  const busyByProf = {};
  (state.risultato || []).forEach(r => {
    const name = (r.professore || r.prof || '').toString().trim();
    if (!name) return;
    busyByProf[name] = busyByProf[name] || {};
    const day = (typeof normalizeDateStr === 'function') ? normalizeDateStr(r.giorno) : (r.giorno||'').split('T')[0];
    busyByProf[name][day] = busyByProf[name][day] || [];
    const startMin = (typeof timeToMin === 'function') ? timeToMin(r.ora) : (function(t){ const [h,m]=String(t||'00:00').split(':').map(Number); return h*60+(m||0); })(r.ora);
    // durata in minuti: r.durata (ore) * 60 or default 60
    const durMin = (r.durata && typeof r.durata === 'number') ? Math.round(r.durata*60) : 60;
    busyByProf[name][day].push({ start: startMin, end: startMin + durMin });
  });

  // helper to check whether an availability entry covers a slot start for slotMin
  function availCovers(availStartStr, availEndStr, slotStart, slotMin) {
    const parse = s => { const [h,m]=String(s||'00:00').split(':').map(Number); return h*60+(m||0); };
    const aS = parse(availStartStr), aE = parse(availEndStr);
    return aS <= slotStart && aE >= (slotStart + slotMin);
  }

  // helper to check busy overlap
  function isBusy(busyArr, slotStart, slotMin) {
    if (!busyArr || !busyArr.length) return false;
    return busyArr.some(b => !(b.end <= slotStart || b.start >= (slotStart + slotMin)));
  }

  // build result: availMap[day][slotStart] = [profNames...]
  const availMap = {};
  daysArr.forEach(d => {
    availMap[d] = {};
    slotStarts.forEach(s => availMap[d][s] = []);
  });

  profs.forEach(prof => {
    daysArr.forEach(d => {
      const profDispOnDay = (dispByProf[prof] && dispByProf[prof][d]) ? dispByProf[prof][d] : [];
      const profBusyOnDay = (busyByProf[prof] && busyByProf[prof][d]) ? busyByProf[prof][d] : [];
      slotStarts.forEach(s => {
        // check avail
        const hasAvail = profDispOnDay.some(a => availCovers(a.start, a.end, s, slotMin));
        if (!hasAvail) return; // not available
        // check not busy
        if (isBusy(profBusyOnDay, s, slotMin)) return; // busy -> skip
        // available: add to cell
        availMap[d][s].push(prof);
      });
    });
  });

  return { slotStarts, availMap, profs };
}

function renderProfAvailabilityGrid() {
  if (!container) return;
  const selectedProf = selectProf.value;
  const start = startEl.value;
  const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
  const from = fromEl.value || '08:00';
  const to = toEl.value || '17:00';
  const slotMin = Math.max(15, Math.min(180, Number(slotEl.value || 60)));
  if (!start) return alert('Seleziona data di inizio');

  // days array
  const daysArr = [];
  for (let i=0;i<days;i++){ const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
  const fromMin = H.timeToMin(from), toMin = H.timeToMin(to);

  // optionally limit professor set to those in select if selected (else all)
  const profFilter = selectedProf ? [selectedProf] : null;

  // compute availability map
  const { slotStarts, availMap, profs } = computeAvailabilityForAllProfs(profFilter, daysArr, slotMin, fromMin, toMin);

  // render table: rows = slots, cols = days
  container.innerHTML = '';
  const table = document.createElement('table');
  table.style.width = '100%'; table.style.borderCollapse = 'collapse'; table.style.fontSize = '13px';

  // header
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = `<th style="position:sticky; left:0; background:var(--card-bg); z-index:3; min-width:160px">Orario / Giorno</th>`;
  daysArr.forEach(d => {
    const dt = new Date(d + 'T00:00:00');
    const label = dt.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'2-digit' });
    const th = document.createElement('th');
    th.textContent = label;
    th.style.textAlign = 'center'; th.style.padding='6px'; th.style.borderLeft='1px solid var(--border)';
    trh.appendChild(th);
  });
  thead.appendChild(trh); table.appendChild(thead);

  // body: one row per slot
  const tbody = document.createElement('tbody');
  slotStarts.forEach(s => {
    const tr = document.createElement('tr'); tr.style.borderTop='1px solid var(--border)';
    const left = document.createElement('td');
    left.style.padding='6px'; left.style.minWidth='160px';
    left.textContent = H.minToTime(s) + ' - ' + H.minToTime(Math.min(s + slotMin, toMin));
    tr.appendChild(left);

    daysArr.forEach(d => {
      const td = document.createElement('td');
      td.style.padding='6px'; td.style.borderLeft='1px solid var(--border)'; td.style.verticalAlign='top';
      const availList = (availMap[d] && availMap[d][s]) ? availMap[d][s].slice() : [];

      if (!availList || availList.length === 0) {
        td.innerHTML = `<div style="color:#9ca3af">— nessuno —</div>`;
      } else {
        // if a specific professor is selected, highlight them first
        if (selectedProf) {
          availList.sort((a,b) => (a === selectedProf ? -1 : 1) - (b === selectedProf ? -1 : 1));
        }
        // create badges: show up to 3 names, then +N
        const maxShow = 3;
        const toShow = availList.slice(0, maxShow);
        const more = Math.max(0, availList.length - maxShow);
        const frag = document.createDocumentFragment();
        toShow.forEach(name => {
          const span = document.createElement('div');
          span.textContent = name;
          span.style.display = 'inline-block';
          span.style.margin = '2px';
          span.style.padding = '4px 6px';
          span.style.borderRadius = '6px';
          span.style.background = (name === selectedProf) ? '#065f46' : '#0f172a';
          span.style.color = '#fff';
          span.style.fontSize = '12px';
          frag.appendChild(span);
        });
        if (more > 0) {
          const moreEl = document.createElement('div');
          moreEl.textContent = `+${more} altri`;
          moreEl.style.display = 'inline-block';
          moreEl.style.margin = '2px';
          moreEl.style.padding = '4px 6px';
          moreEl.style.borderRadius = '6px';
          moreEl.style.background = '#6b7280';
          moreEl.style.color = '#fff';
          moreEl.style.fontSize = '12px';
          frag.appendChild(moreEl);
        }
        td.appendChild(frag);
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}
// Patch avanzata per Prof Availability Modal
// Funzionalità aggiunte:
// - Ordina docenti per ore rimanenti + preferenza per assegnazioni adiacenti (semplice R10)
// - Filtri: laboratorio + materia (se disponibili nei dati)
// - Badge cliccabili per assegnamento immediato (confirm + scelta attività/classe)
// - Tooltip con disponibilità originaria e assegnazioni
// Inserire questo codice dopo il codice del modal (usa gli stessi DOM refs).

(function(){
  // Dom references (adattare se nomi diversi)
  const labFilterEl = document.getElementById('profAvailabilityLabFilter');
  const materiaFilterEl = document.getElementById('profAvailabilityMateriaFilter');
  const selectProf = document.getElementById('profAvailabilitySelect');
  const startEl = document.getElementById('profAvailabilityStart');
  const daysEl = document.getElementById('profAvailabilityDays');
  const fromEl = document.getElementById('profAvailabilityFrom');
  const toEl = document.getElementById('profAvailabilityTo');
  const slotEl = document.getElementById('profAvailabilitySlotMin');
  const container = document.getElementById('profAvailabilityContainer');
  const subtitle = document.getElementById('profAvailabilitySubtitle');

  // Fallback helpers (usiamo H dal file originale se esiste)
  const _H = window.H || {
    normalizeDateStr: typeof normalizeDateStr === 'function' ? normalizeDateStr : (d => (d||'').split('T')[0]),
    timeToMin: typeof timeToMin === 'function' ? timeToMin : (t => { const [h,m]=String(t||'00:00').split(':').map(Number); return h*60 + (m||0); }),
    minToTime: (m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'))
  };

  // populate lab/materia filters once (and when modal is opened)
  function populateLabMateriaFilters() {
    if (!labFilterEl || !materiaFilterEl) return;
    // collect labs from state.laboratori and from disponibilita entries (field laboratorio)
    const labsSet = new Set();
    (state.laboratori || []).forEach(l => { if (l && l.nome) labsSet.add(l.nome); });
    (state.disponibilita || []).forEach(d => { if (d && d.Laboratorio) labsSet.add(d.Laboratorio); if (d && d.laboratorio) labsSet.add(d.laboratorio); });
    // build options preserving selection
    const prevLab = labFilterEl.value;
    labFilterEl.innerHTML = '<option value="">— Tutti lab —</option>';
    Array.from(labsSet).sort().forEach(name => {
      const opt = document.createElement('option'); opt.value = name; opt.textContent = name; labFilterEl.appendChild(opt);
    });
    if (prevLab) labFilterEl.value = prevLab;

    // materia: try to gather from state.progetti.nome or state.classActivities maybe have materia field
    const materiaSet = new Set();
    (state.progetti || []).forEach(p => { if (p && p.materia) materiaSet.add(p.materia); if (p && p.nome && p.materia) materiaSet.add(p.materia); });
    (state.classActivities || []).forEach(a => { if (a && a.materia) materiaSet.add(a.materia); });
    const prevMat = materiaFilterEl.value;
    materiaFilterEl.innerHTML = '<option value="">— Tutte le materie —</option>';
    Array.from(materiaSet).sort().forEach(m => {
      const opt = document.createElement('option'); opt.value = m; opt.textContent = m; materiaFilterEl.appendChild(opt);
    });
    if (prevMat) materiaFilterEl.value = prevMat;
  }

  // compute remaining hours for a professor (daily and weekly used)
  function computeProfUsedHours(profName) {
    const res = { daily: {}, weeklyTotal: 0 };
    const weekMap = {}; // weekStartISO -> hours
    (state.risultato || []).forEach(r => {
      if (!r.professore) return;
      if ((r.professore||'').toLowerCase() !== (profName||'').toLowerCase()) return;
      const dayISO = _H.normalizeDateStr(r.giorno);
      const dur = (typeof r.durata === 'number' && r.durata>0) ? r.durata : 1;
      res.daily[dayISO] = (res.daily[dayISO] || 0) + dur;
      // week start (Mon)
      const d = new Date(dayISO + 'T00:00:00');
      const day = d.getDay();
      const diff = (day + 6) % 7;
      d.setDate(d.getDate() - diff);
      const ws = d.toISOString().split('T')[0];
      weekMap[ws] = (weekMap[ws] || 0) + dur;
    });
    // compute latest weekTotal for the current week of today - we will compute on demand in caller
    res.weekMap = weekMap;
    return res;
  }

  function profRemainingCapacity(profName, weekStartISO) {
    const profObj = (state.professori || []).find(p => (p.nome||'').toLowerCase() === (profName||'').toLowerCase());
    const maxDay = profObj ? (profObj.maxOreGiorno || rulesConfig && rulesConfig.rule1Value) : (rulesConfig && rulesConfig.rule1Value);
    const maxWeek = profObj ? (profObj.maxOreSettimana || rulesConfig && rulesConfig.rule2Value) : (rulesConfig && rulesConfig.rule2Value);
    const used = computeProfUsedHours(profName);
    const weekUsed = weekStartISO ? (used.weekMap[weekStartISO] || 0) : 0;
    return { remainingWeek: (maxWeek || 0) - weekUsed, remainingDay: (maxDay || 0) }; // day remaining computed per-day by caller
  }

  // compute availability for all profs with lab/materia filter and ordering
  function computeAvailabilityForAllProfsEnhanced(profFilterNames, daysArr, slotMin, fromMin, toMin, labFilter, materiaFilter) {
    // build full prof list (respect profFilterNames if provided)
    let profList = (profFilterNames && profFilterNames.length) ? profFilterNames.slice() : (state.professori || []).map(p => p.nome || '');
    profList = profList.map(s => s && s.trim()).filter(Boolean);

    // build disponibilita by prof with lab info if present
    const dispByProf = {};
    (state.disponibilita || []).forEach(d => {
      const name = (d.professore || d.Professore || '').toString().trim();
      if (!name) return;
      // if profFilterNames present and this prof not in it, skip
      if (profFilterNames && profFilterNames.length && profFilterNames.indexOf(name) === -1) return;
      dispByProf[name] = dispByProf[name] || {};
      const day = _H.normalizeDateStr(d.giorno);
      dispByProf[name][day] = dispByProf[name][day] || [];
      dispByProf[name][day].push({ start: d.oraInizio || d.Inizio || '00:00', end: d.oraFine || d.Fine || '00:00', laboratorio: d.laboratorio || d.Laboratorio || null, raw: d });
      // ensure profList contains name
      if (!profList.includes(name)) profList.push(name);
    });

    // build busy map from state.risultato
    const busyByProf = {};
    (state.risultato || []).forEach(r => {
      const name = (r.professore || r.prof || '').toString().trim();
      if (!name) return;
      busyByProf[name] = busyByProf[name] || {};
      const day = _H.normalizeDateStr(r.giorno);
      busyByProf[name][day] = busyByProf[name][day] || [];
      const startMin = _H.timeToMin(r.ora);
      const durMin = (r.durata && typeof r.durata === 'number') ? Math.round(r.durata*60) : 60;
      busyByProf[name][day].push({ start: startMin, end: startMin + durMin, raw: r });
      // ensure profList contains name
      if (!profList.includes(name)) profList.push(name);
    });

    // helper checks
    function availCovers(availStartStr, availEndStr, slotStart, slotMin) {
      const parse = s => { const [h,m]=String(s||'00:00').split(':').map(Number); return h*60+(m||0); };
      const aS = parse(availStartStr), aE = parse(availEndStr);
      return aS <= slotStart && aE >= (slotStart + slotMin);
    }
    function isBusy(busyArr, slotStart, slotMin) {
      if (!busyArr || !busyArr.length) return false;
      return busyArr.some(b => !(b.end <= slotStart || b.start >= (slotStart + slotMin)));
    }

    // slotStarts
    const slotStarts = [];
    for (let m = fromMin; m < toMin; m += slotMin) slotStarts.push(m);

    // build availMap day->slot->list of {name, matchedAvailEntries}
    const availMap = {};
    daysArr.forEach(d => {
      availMap[d] = {};
      slotStarts.forEach(s => availMap[d][s] = []);
    });

    profList.forEach(prof => {
      // filter by materia: if materiaFilter present and professor doesn't have materia field => skip
      if (materiaFilter) {
        const pObj = (state.professori || []).find(p=> (p.nome||'').toLowerCase() === (prof||'').toLowerCase());
        if (pObj) {
          if (!pObj.materia && !pObj.subject && !pObj.disciplina) {
            // no materia info -> skip if a materia filter is explicitly requested
            return;
          }
          const profMat = (pObj.materia || pObj.subject || pObj.disciplina || '').toString();
          if (profMat && profMat !== materiaFilter) return;
        } else {
          // unknown prof object, skip if materiaFilter set
          return;
        }
      }

      daysArr.forEach(d => {
        const profDispOnDay = (dispByProf[prof] && dispByProf[prof][d]) ? dispByProf[prof][d] : [];
        const profBusyOnDay = (busyByProf[prof] && busyByProf[prof][d]) ? busyByProf[prof][d] : [];

        slotStarts.forEach(s => {
          // find avail entries covering slot
          const matched = profDispOnDay.filter(a => availCovers(a.start,a.end,s,slotMin));
          if (!matched.length) return; // no availability
          // if labFilter set, ensure at least one matching availability entry has that lab (or availability entry's laboratorio === null and labFilter empty)
          if (labFilter) {
            const matchWithLab = matched.some(m => (m.laboratorio || '') === labFilter);
            if (!matchWithLab) return;
          }
          // check not busy
          if (isBusy(profBusyOnDay, s, slotMin)) return;
          // available: add with matched availability entries (for tooltip)
          availMap[d][s].push({ name: prof, matched: matched, busy: profBusyOnDay || [] });
        });
      });
    });

    // order available lists per slot using R10-ish metric:
    // for each slot, sort list by:
    //  1) adjacency preference: profs with assignment adjacent (previous or next slot) get slight boost (we prefer continuity)
    //  2) remaining weekly capacity (descending: prefer prof with more remaining capacity)
    function sortAvailLists() {
      // precompute week start(s) for days in daysArr
      const weekStartMap = {};
      daysArr.forEach(d => {
        const D = new Date(d + 'T00:00:00');
        const day = D.getDay();
        const diff = (day + 6) % 7;
        D.setDate(D.getDate() - diff);
        weekStartMap[d] = D.toISOString().split('T')[0];
      });
      daysArr.forEach(d => {
        slotStarts.forEach(s => {
          const list = availMap[d][s];
          if (!list || list.length <= 1) return;
          // compute sorting values per prof
          const enriched = list.map(item => {
            const prof = item.name;
            const used = computeProfUsedHours(prof);
            const weekStart = weekStartMap[d];
            const profObj = (state.professori || []).find(p => (p.nome||'').toLowerCase() === (prof||'').toLowerCase());
            const maxWeek = profObj ? (profObj.maxOreSettimana || (rulesConfig && rulesConfig.rule2Value) ) : (rulesConfig && rulesConfig.rule2Value);
            const weekUsed = used.weekMap[weekStart] || 0;
            const remainingWeek = (maxWeek || 0) - weekUsed;
            // adjacency: check if prof has assignment immediately before or after this slot
            const busyArr = item.busy || [];
            const adjBefore = busyArr.some(b => b.end === s); // ends exactly at slot start
            const adjAfter = busyArr.some(b => b.start === (s + slotMin));
            const adjacencyScore = (adjBefore || adjAfter) ? 1 : 0;
            return { item, remainingWeek, adjacencyScore };
          });
          enriched.sort((a,b) => {
            // prefer adjacency (descending), then remainingWeek descending
            if (a.adjacencyScore !== b.adjacencyScore) return b.adjacencyScore - a.adjacencyScore;
            return b.remainingWeek - a.remainingWeek;
          });
          availMap[d][s] = enriched.map(e => e.item);
        });
      });
    }
    sortAvailLists();

    return { slotStarts, availMap };
  }

  // assign prof to a slot (confirm + prompt to select activity/class if multiple possible)
  function assignProfToSlot(profName, dayISO, slotStart, slotMin, matchedAvailEntries) {
    // double-check availability
    const recomputed = computeAvailabilityForAllProfsEnhanced([profName], [dayISO], slotMin, slotStart, slotStart+slotMin, null, null);
    const cell = recomputed.availMap[dayISO] && recomputed.availMap[dayISO][slotStart];
    const isStillAvailable = cell && cell.length > 0;
    if (!isStillAvailable) return alert(`${profName} non è più disponibile per ${dayISO} ${_H.minToTime(slotStart)}.`);
    // check R1/R2 before assign
    const used = computeProfUsedHours(profName);
    const profObj = (state.professori || []).find(p => (p.nome||'').toLowerCase() === (profName||'').toLowerCase());
    const maxDay = profObj ? (profObj.maxOreGiorno || (rulesConfig && rulesConfig.rule1Value)) : (rulesConfig && rulesConfig.rule1Value);
    const maxWeek = profObj ? (profObj.maxOreSettimana || (rulesConfig && rulesConfig.rule2Value)) : (rulesConfig && rulesConfig.rule2Value);
    const dayUsed = used.daily[dayISO] || 0;
    const durHours = slotMin / 60;
    if (maxDay && (dayUsed + durHours) > maxDay) return alert(`${profName} supererebbe limite giornaliero: ${dayUsed + durHours}/${maxDay}`);
    // compute week start of the dayISO
    const D = new Date(dayISO + 'T00:00:00'); const day = D.getDay(); const diff = (day + 6) % 7; D.setDate(D.getDate()-diff); const weekStart = D.toISOString().split('T')[0];
    const weekUsed = used.weekMap[weekStart] || 0;
    if (maxWeek && (weekUsed + durHours) > maxWeek) return alert(`${profName} supererebbe limite settimanale: ${weekUsed + durHours}/${maxWeek}`);

    // choose activity/class to assign: find candidate classActivities matching day and start time
    const candidates = (state.classActivities || []).filter(a => _H.normalizeDateStr(a.giorno) === dayISO && a.oraInizio === _H.minToTime(slotStart));
    let chosenClass = null;
    let chosenActivityName = null;
    if (candidates.length === 1) {
      chosenClass = candidates[0].classe || '';
      chosenActivityName = candidates[0].nome || '';
    } else if (candidates.length > 1) {
      // ask user to pick from list
      const list = candidates.map((c,i)=> `${i+1}) ${c.classe} — ${c.nome}`).join('\n');
      const sel = prompt(`Scegli l'attività da assegnare:\n${list}\nInserisci il numero (o lascia vuoto per annullare):`);
      if (!sel) return;
      const idx = Number(sel) - 1;
      if (isNaN(idx) || idx < 0 || idx >= candidates.length) return alert('Selezione non valida');
      chosenClass = candidates[idx].classe || '';
      chosenActivityName = candidates[idx].nome || '';
    } else {
      // no existing candidate activity — ask manual input
      const manualAct = prompt(`Nessuna attività trovata in ${dayISO} ${_H.minToTime(slotStart)}. Inserisci nome attività (o annulla):`);
      if (!manualAct) return;
      const manualClass = prompt('Classe (opzionale):', '');
      chosenActivityName = manualAct;
      chosenClass = manualClass || '';
    }

    // final confirm
    if (!confirm(`Assegnare ${chosenActivityName} (${chosenClass}) a ${profName} il ${dayISO} ${_H.minToTime(slotStart)} per ${durHours} h ?`)) return;

    // create entry in state.risultato
    const newEntry = {
      giorno: dayISO,
      professore: profName,
      attivita: chosenActivityName,
      classe: chosenClass || null,
      ora: _H.minToTime(slotStart),
      durata: durHours,
      laboratorio: (matchedAvailEntries && matchedAvailEntries.length && matchedAvailEntries[0].laboratorio) ? matchedAvailEntries[0].laboratorio : null,
      locked: false
    };
    state.risultato = state.risultato || [];
    state.risultato.push(newEntry);
    persist && persist();
    if (typeof run === 'function') run(true);
    if (typeof generatePlanningView === 'function') generatePlanningView();
    if (typeof generateLabPlanningView === 'function') generateLabPlanningView();
    showToast(`Assegnato ${chosenActivityName} a ${profName} ${dayISO} ${_H.minToTime(slotStart)}`, 2500);
    // re-render modal to update availability
    renderProfAvailabilityGrid();
  }

  // replace renderProfAvailabilityGrid with enhanced version (uses filters & click-to-assign)
  function renderProfAvailabilityGrid() {
    if (!container) return;
    const selectedProf = selectProf.value;
    const start = startEl.value;
    const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const from = fromEl.value || '08:00';
    const to = toEl.value || '17:00';
    const slotMin = Math.max(15, Math.min(180, Number(slotEl.value || 60)));
    const labFilter = labFilterEl ? labFilterEl.value : null;
    const materiaFilter = materiaFilterEl ? materiaFilterEl.value : null;
    if (!start) return alert('Seleziona data di inizio');

    // days array
    const daysArr = [];
    for (let i=0;i<days;i++){ const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const fromMin = _H.timeToMin(from), toMin = _H.timeToMin(to);

    // compute availability
    const { slotStarts, availMap } = computeAvailabilityForAllProfsEnhanced(selectedProf ? [selectedProf] : null, daysArr, slotMin, fromMin, toMin, labFilter, materiaFilter);

    // build table
    container.innerHTML = '';
    const table = document.createElement('table');
    table.style.width='100%'; table.style.borderCollapse='collapse'; table.style.fontSize='13px';

    // header
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th style="position:sticky; left:0; background:var(--card-bg); z-index:3; min-width:160px">Orario / Giorno</th>`;
    daysArr.forEach(d => {
      const dt = new Date(d + 'T00:00:00');
      const label = dt.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'2-digit' });
      const th = document.createElement('th');
      th.textContent = label;
      th.style.textAlign='center'; th.style.padding='6px'; th.style.borderLeft='1px solid var(--border)';
      trh.appendChild(th);
    });
    thead.appendChild(trh); table.appendChild(thead);

    // body
    const tbody = document.createElement('tbody');
    slotStarts.forEach(s => {
      const tr = document.createElement('tr'); tr.style.borderTop='1px solid var(--border)';
      const left = document.createElement('td'); left.style.padding='6px'; left.style.minWidth='160px';
      left.textContent = _H.minToTime(s) + ' - ' + _H.minToTime(Math.min(s + slotMin, toMin));
      tr.appendChild(left);

      daysArr.forEach(d => {
        const td = document.createElement('td'); td.style.padding='6px'; td.style.borderLeft='1px solid var(--border)'; td.style.verticalAlign='top';
        const list = (availMap[d] && availMap[d][s]) ? availMap[d][s].slice() : [];

        if (!list.length) {
          td.innerHTML = `<div style="color:#9ca3af">— nessuno —</div>`;
        } else {
          // badges: show up to 6, clickable
          const max = 6;
          const show = list.slice(0, max);
          show.forEach(it => {
            const name = it.name;
            const badge = document.createElement('span');
            badge.textContent = name;
            badge.style.display='inline-block';
            badge.style.margin='3px';
            badge.style.padding='4px 6px';
            badge.style.borderRadius='6px';
            badge.style.background = (name === selectedProf) ? '#065f46' : '#0f172a';
            badge.style.color = '#fff';
            badge.style.fontSize = '12px';
            badge.style.cursor = 'pointer';

            // tooltip: availability ranges & assignments summary
            const availRanges = (it.matched || []).map(m => `${m.start}-${m.end}${m.laboratorio ? ' ['+m.laboratorio+']' : ''}`).join('; ');
            const busySummary = (it.busy || []).slice(0,3).map(b => `${_H.minToTime(b.start)}-${_H.minToTime(b.end)}`).join(', ');
            badge.title = `Disponibilità: ${availRanges}\nAssegnazioni: ${busySummary || 'nessuna'}`;

            // onclick assign
            badge.onclick = (ev) => {
              ev.stopPropagation();
              if (!confirm(`Assegnare lo slot ${d} ${_H.minToTime(s)} a ${name}?`)) return;
              assignProfToSlot(name, d, s, slotMin, it.matched || []);
            };
            td.appendChild(badge);
          });
          const more = Math.max(0, list.length - max);
          if (more > 0) {
            const moreEl = document.createElement('span');
            moreEl.textContent = `+${more} altri`;
            moreEl.style.display='inline-block';
            moreEl.style.margin='3px';
            moreEl.style.padding='4px 6px';
            moreEl.style.borderRadius='6px';
            moreEl.style.background='#6b7280';
            moreEl.style.color='#fff';
            moreEl.style.fontSize='12px';
            td.appendChild(moreEl);
          }
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  // wire-up: call populateLabMateriaFilters on open
  const origOpen = window.openProfAvailabilityModal;
  window.openProfAvailabilityModal = function(name) {
    populateLabMateriaFilters();
    if (origOpen) origOpen(name);
    else {
      // fallback: show modal and render
      if (typeof window.renderProfAvailabilityGrid === 'function') window.renderProfAvailabilityGrid();
    }
  };

  // expose for testing
  window._profAvail_computeEnhanced = computeAvailabilityForAllProfsEnhanced;
  window.renderProfAvailabilityGrid = renderProfAvailabilityGrid;

})();
  // Export CSV/XLSX (visible data)
  window.profAvailabilityExportCSV = function() {
    const prof = selectProf.value;
    const start = startEl.value; const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const fromMin = H.timeToMin(fromEl.value||'08:00'), toMin = H.timeToMin(toEl.value||'17:00');
    const slotMin = Math.max(15, Number(slotEl.value||60));
    const daysArr = []; for (let i=0;i<days;i++){ const d = new Date(start+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const rows = [['Professore','Giorno','Inizio','Fine','Stato']];
    if (!multiMode) {
      if (!prof) return alert('Seleziona un docente');
      const grid = computeGridForProf(prof, daysArr, slotMin, fromMin, toMin);
      daysArr.forEach(d => {
        grid.slots.forEach(s => {
          const st = grid.result[d] ? grid.result[d][s] : 'no-availability';
          rows.push([prof,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)),st]);
        });
      });
    } else {
      if (!selectedMultiple || selectedMultiple.length===0) return alert('Nessun docente specificato per export multi');
      selectedMultiple.forEach(p => {
        const grid = computeGridForProf(p, daysArr, slotMin, fromMin, toMin);
        daysArr.forEach(d => {
          grid.slots.forEach(s => {
            const st = grid.result[d] ? grid.result[d][s] : 'no-availability';
            rows.push([p,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)),st]);
          });
        });
      });
    }
    const csv = rows.map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'prof_availability.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window.profAvailabilityExportXLSX = function() {
    if (typeof XLSX === 'undefined') return alert('XLSX library non caricata. Riprova tra un secondo.');
    // reuse CSV logic to build rows
    const prof = selectProf.value;
    const start = startEl.value; const days = Math.max(1, Math.min(14, Number(daysEl.value || 5)));
    const fromMin = H.timeToMin(fromEl.value||'08:00'), toMin = H.timeToMin(toEl.value||'17:00');
    const slotMin = Math.max(15, Number(slotEl.value||60));
    const daysArr = []; for (let i=0;i<days;i++){ const d = new Date(start+'T00:00:00'); d.setDate(d.getDate()+i); daysArr.push(d.toISOString().split('T')[0]); }
    const rows = [['Professore','Giorno','Inizio','Fine','Stato']];
    if (!multiMode) {
      if (!prof) return alert('Seleziona un docente');
      const grid = computeGridForProf(prof, daysArr, slotMin, fromMin, toMin);
      daysArr.forEach(d => {
        grid.slots.forEach(s => rows.push([prof,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)), grid.result[d] ? grid.result[d][s] : 'no-availability']));
      });
    } else {
      if (!selectedMultiple || selectedMultiple.length===0) return alert('Nessun docente specificato per export multi');
      selectedMultiple.forEach(p => {
        const grid = computeGridForProf(p, daysArr, slotMin, fromMin, toMin);
        daysArr.forEach(d => { grid.slots.forEach(s => rows.push([p,d,H.minToTime(s),H.minToTime(Math.min(s+slotMin,toMin)), grid.result[d] ? grid.result[d][s] : 'no-availability'])); });
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Availability');
    const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'prof_availability.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Apply & Close: utile se vuoi confermare e chiudere
  window.profAvailabilityApplyAndClose = function() {
    // per ora solo ricalcola e chiude
    renderProfAvailabilityGrid();
    closeProfAvailabilityModal();
  };

  // Make modal draggable by header (store position in style left/top)
  (function makeDraggable(){
    if (!header || !content) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener('mousedown', function(e){
      dragging = true;
      const rect = content.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e){
      if (!dragging) return;
      let left = e.clientX - offsetX;
      let top = e.clientY - offsetY;
      // keep within window bounds
      left = Math.max(8, Math.min(left, window.innerWidth - content.offsetWidth - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - content.offsetHeight - 8));
      content.style.left = left + 'px';
      content.style.top = top + 'px';
    });
    document.addEventListener('mouseup', function(){
      dragging = false; document.body.style.userSelect = '';
    });
    // prevent clicks inside modal from closing (we don't close on outside clicks anyway)
    modal.addEventListener('click', function(e){ /* noop */ });
    // ensure content click does not close
    content.addEventListener('click', function(e){ e.stopPropagation(); });
  })();

  // re-populate professor select periodically in case state.professori changes
  // meno intrusivo: aggiorna ogni 10 secondi e salva l'id per poterlo cancellare
if (window._profSelectInterval) clearInterval(window._profSelectInterval);
window._profSelectInterval = setInterval(() => {
  try { populateProfSelect(); } catch(e){ /* silent */ }
}, 10000);

  // expose helpers for testing
  window._profAvailability_computeGridForProf = computeGridForProf;
})();
function renderProfActivityMatrix() {
  const start = document.getElementById('matrixStart').value;
  const days = Math.max(1, Math.min(14, Number(document.getElementById('matrixDays').value || 5)));
  const onlyNonZero = !!document.getElementById('matrixOnlyNonZero').checked;
  if (!start) return alert('Seleziona data di inizio');

  // compute matrix (reuse existing helper computeMatrix if present) or inline logic:
  const norm = (typeof normalizeDateStr === 'function') ? normalizeDateStr : (d => (d||'').split('T')[0]);
  const daySet = new Set();
  for (let i=0;i<days;i++){ const d=new Date(start+'T00:00:00'); d.setDate(d.getDate()+i); daySet.add(d.toISOString().split('T')[0]); }

  // collect activities and profs
  const activities = [];
  const actSet = new Set();
  (state.classActivities || []).forEach(a => { const g = norm(a.giorno); if (daySet.has(g)) { actSet.add(a.nome||'(senza nome)'); }});
  if (actSet.size === 0) {
    (state.risultato || []).forEach(r=> { const g = norm(r.giorno); if (daySet.has(g) && r.attivita) actSet.add(r.attivita); });
  }
  activities.push(...actSet);

  const profs = (state.professori || []).map(p => p.nome);
  // build matrix and totals
  const matrix = {};
  profs.forEach(p => { matrix[p] = {}; activities.forEach(a=>matrix[p][a]=0); });
  (state.risultato || []).forEach(r => {
    const g = norm(r.giorno);
    if (!daySet.has(g)) return;
    const prof = r.professore || '';
    const act = r.attivita || '';
    if (!act) return;
    if (!matrix[prof]) {
      profs.push(prof); matrix[prof] = {}; activities.forEach(a=>matrix[prof][a]=0);
    }
    if (!matrix[prof].hasOwnProperty(act)) {
      activities.push(act); profs.forEach(pp => { if (!matrix[pp]) matrix[pp]={}; matrix[pp][act] = matrix[pp][act]||0; });
    }
    const dur = (typeof r.durata === 'number' && r.durata>0) ? r.durata : 1;
    matrix[prof][act] = (matrix[prof][act] || 0) + dur;
  });

  // totals
  const rowTotals = {}; const colTotals = {};
  profs.forEach(p => { rowTotals[p]=0; });
  activities.forEach(a => { colTotals[a]=0; });
  profs.forEach(p => activities.forEach(a => { const v = matrix[p][a]||0; rowTotals[p]+=v; colTotals[a]+=v; }));

  const profsToShow = onlyNonZero ? profs.filter(p => rowTotals[p] > 0) : profs.slice();
  const activitiesToShow = onlyNonZero ? activities.filter(a => colTotals[a] > 0) : activities.slice();

  // render as before but using profsToShow / activitiesToShow
  const container = document.getElementById('profActivityMatrixContainer');
  container.innerHTML = '';
  if (profsToShow.length === 0 || activitiesToShow.length === 0) {
    container.innerHTML = '<div style="padding:10px;color:#9ca3af">Nessuna cella con ore > 0 nel range selezionato.</div>';
    return;
  }
  const tbl = document.createElement('table');
  tbl.style.width='100%'; tbl.style.borderCollapse='collapse'; tbl.style.fontSize='13px';
  const thead = document.createElement('thead'); const hdr = document.createElement('tr'); hdr.style.background='var(--card-bg)';
  hdr.innerHTML = `<th style="position:sticky; left:0; background:var(--card-bg); z-index:3; min-width:220px">Prof / Attività</th>`;
  activitiesToShow.forEach(a => {
    const th = document.createElement('th'); th.textContent=a; th.style.padding='6px'; th.style.borderLeft='1px solid var(--border)'; th.style.textAlign='center'; hdr.appendChild(th);
  });
  thead.appendChild(hdr); tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  profsToShow.forEach(p => {
    const tr = document.createElement('tr'); tr.style.borderTop='1px solid var(--border)';
    const left = document.createElement('td'); left.style.padding='6px'; left.style.verticalAlign='top'; left.style.minWidth='220px';
    left.innerHTML = `<strong>${p}</strong><div style="color:#9ca3af;font-size:12px">Totale: ${rowTotals[p]}</div>`; tr.appendChild(left);
    activitiesToShow.forEach(a => {
      const td = document.createElement('td'); td.style.padding='6px'; td.style.textAlign='center'; td.style.borderLeft='1px solid var(--border)';
      const val = matrix[p][a] || 0;
      td.textContent = val === 0 ? '' : String(val);
      if (val > 0) {
        td.style.background = 'linear-gradient(90deg,#0ea5a4,#0284c7)'; td.style.color = '#fff'; td.style.borderRadius = '4px'; td.style.padding='6px';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody); container.appendChild(tbl);
}

/* expose open modal function globally */
window.openActivitiesGridModalEnhanced = openActivitiesGridModalEnhanced;
window.closeActivitiesGridModalEnhanced = closeActivitiesGridModalEnhanced;
// expose to global
window.openSummaryModal = openSummaryModal;
window.closeSummaryModal = closeSummaryModal;
window.saveAllSummaryChanges = saveAllSummaryChanges;
window.deleteSummaryItem = deleteSummaryItem;
window.summaryAddNew = summaryAddNew;
// ====== SUMMARY MODAL: visualizza gruppi e permette edit inline ====== //

// ... rest of file (summary modal and other functions) remain unchanged ...
// (Due to message length, the remainder of parte2.js continues unchanged from the previous version,
// including summary modal code, export, render, etc., as provided earlier.)