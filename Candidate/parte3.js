// ====== PARTE 3: RUN, PLANNING, UI HELPERS (FILE COMPLETO AGGIORNATO) ====== //

// ====== RUN SINCRONIZZATO ====== //

function run(force = true) {
  if (force) {
    try { pianifica(); } catch (e) { console.warn('pianifica error', e); }
  }

  updateRule7Warnings();

  const summaryEl = document.getElementById('tblSummary');
  if (summaryEl) renderSummaryTable();

  const warningsList = document.getElementById('warningsList');
  if (warningsList) {
    warningsList.innerHTML = state.warnings
      .map(w => `<li style="color:${w.includes('✅') ? '#10b981' : w.includes('⛔') ? '#ef4444' : '#f59e0b'}">${w}</li>`)
      .join('');
  }

  updateMatrixOreDocente();
  refreshQuickAddForm();
  persist();
}

let matrixCache = { activities: [], rows: [] };
// Quick form: default CLOSED
let quickFormCollapsed = true;

function toggleQuickForm() {
  quickFormCollapsed = !quickFormCollapsed;
  const card = document.getElementById('quickFormCard');
  if (card) card.classList.toggle('collapsed', quickFormCollapsed);
}

function normalizeDateStr(dateStr) {
  if (!dateStr) return dateStr;
  if (dateStr.includes('/')) {
    const [dd, mm, yyyy] = dateStr.split('/');
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  return dateStr;
}

function syncQuickAlunniFromClass() {
  const classSelect = document.getElementById('quickClassSelect');
  const alunniInput = document.getElementById('quickAlunni');
  if (!classSelect || !alunniInput) return;
  const cls = state.classi.find(c => c.nome === classSelect.value);
  alunniInput.value = cls ? cls.alunni : '';
}

function refreshQuickAddForm() {
  const classSelect = document.getElementById('quickClassSelect');
  const activitySelect = document.getElementById('quickActivitySelect');

  if (classSelect) {
    classSelect.innerHTML = `<option value="">-- Classe --</option>` +
      state.classi.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
  }

  if (activitySelect) {
    const set = new Set();
    state.progetti.forEach(p => set.add(p.nome));
    state.laboratori.forEach(l => set.add(l.nome));
    state.classActivities.forEach(a => set.add(a.nome));
    activitySelect.innerHTML = `<option value="">-- Attività --</option>` +
      [...set].map(a => `<option value="${a}">${a}</option>`).join('');
  }

  syncQuickAlunniFromClass();
}

function quickAddClass() {
  const input = document.getElementById('quickNewClass');
  const alunniInput = document.getElementById('quickAlunni');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const alunni = Math.max(0, Number(alunniInput?.value) || 0);
  const existing = state.classi.find(c => c.nome === name);
  if (!existing) state.classi.push({ nome: name, alunni, bypassRule7: false });
  else existing.alunni = alunni;
  input.value = '';
  refreshQuickAddForm();
  const classSelect = document.getElementById('quickClassSelect');
  if (classSelect) classSelect.value = name;
  syncQuickAlunniFromClass();
  persist();
  run(false);
}

function quickAddActivity() {
  const classe = document.getElementById('quickClassSelect')?.value || '';
  const attivita = document.getElementById('quickActivitySelect')?.value || '';
  const giorno = document.getElementById('quickDay')?.value || '';
  let oraInizio = document.getElementById('quickStart')?.value || '';
  let oraFine = document.getElementById('quickEnd')?.value || '';
  const prof1 = document.getElementById('quickProf1')?.value || '';
  const prof2 = document.getElementById('quickProf2')?.value || '';
  const allowOverlap = document.getElementById('quickAllowOverlap')?.checked || false;
  const allowLabOverride = document.getElementById('quickAllowLabOverride')?.checked || false;

  if (!classe || !attivita || !giorno) return alert('Compila Classe, Attività e Giorno');
  if (!oraInizio) oraInizio = rulesConfig.rule9Start || '08:00';
  if (!oraFine) oraFine = rulesConfig.rule9End || '14:00';
  if (timeToMin(oraFine) <= timeToMin(oraInizio)) return alert('Orario non valido: "Alle" deve essere maggiore di "Dalle"');

  const giornoNorm = normalizeDateStr(giorno);

  if (hasActivityOverlap(classe, giornoNorm, oraInizio, oraFine)) {
    return alert('⚠️ Orario sovrapposto con un’altra attività della stessa classe e giorno');
  }

  if (hasLabOrActivityConflict({ classe, nome: attivita, giorno: giornoNorm, oraInizio, oraFine, allowOverlap })) {
    return alert('⚠️ Conflitto: stessa Attività o stesso Lab nello stesso orario/giorno (serve consenso su entrambe)');
  }

  // lab duration check (allow override via checkbox)
  const durataOre = (timeToMin(oraFine) - timeToMin(oraInizio)) / 60;
  let activityLab = null;
  const proj = state.progetti.find(p => p.nome === attivita);
  if (proj && proj.laboratorio) activityLab = proj.laboratorio;
  else if (state.laboratori.some(l => l.nome === attivita)) activityLab = attivita;

  if (activityLab && rulesConfig.rule3Enable) {
    const labItem = state.laboratori.find(l => l.nome === activityLab);
    if (labItem && typeof labItem.maxOreGiornoLab === 'number' && durataOre > labItem.maxOreGiornoLab && !allowLabOverride) {
      return alert(`❌ Il laboratorio "${activityLab}" ha max ${labItem.maxOreGiornoLab} ore/giorno. Seleziona "Bypass" per forzare.`);
    }
  }

  const alunni = Math.max(0, Number(document.getElementById('quickAlunni')?.value) || 0);
  const cls = state.classi.find(c => c.nome === classe);
  if (cls) cls.alunni = alunni;

  state.classActivities.push({
    classe,
    nome: attivita,
    giorno: giornoNorm,
    oraInizio,
    oraFine,
    prof1: prof1 || null,
    prof2: prof2 || null,
    allowOverlap,
    allowLabMaxOverride: !!allowLabOverride
  });

  persist();
  run(true);
  if (document.getElementById('planningWeekStart')?.value) {
    generatePlanningView();
    generateLabPlanningView();
  }
}

// ====== SUMMARY / MATRIX ====== //
function renderSummaryTable() {
  const term = (tableFilters?.summary || '').toLowerCase().trim();
  const rows = state.professori.filter(p => !term || p.nome.toLowerCase().includes(term));
  if (!rows.length) {
    document.getElementById('tblSummary').innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.5;">Nessun risultato</td></tr>';
    return;
  }
  const countsWeek = {};
  state.risultato.forEach(r => {
    if (!r.professore) return;
    countsWeek[r.professore] = (countsWeek[r.professore] || 0) + r.durata;
  });
  document.getElementById('tblSummary').innerHTML = rows.map(p => {
    const w = countsWeek[p.nome] || 0;
    const saldoW = p.maxOreSettimana - w;
    return `<tr>
      <td>${p.nome}</td>
      <td style="text-align:center">${p.maxOreGiorno}h</td>
      <td style="text-align:center">${p.maxOreSettimana}h</td>
      <td style="text-align:center; color:${saldoW < 0 ? '#ef4444' : '#10b981'}">-</td>
      <td style="text-align:center; color:${saldoW < 0 ? '#ef4444' : '#10b981'}">${saldoW}</td>
    </tr>`;
  }).join('');
}

function updateMatrixOreDocente() {
  const head = document.getElementById('matrixHead');
  const body = document.getElementById('matrixBody');

  if (!head || !body) return;

  if (!state.professori.length) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td style="padding:12px; opacity:0.5;">Nessun professore</td></tr>';
    return;
  }

  const term = (tableFilters?.matrix || '').toLowerCase().trim();
  const allActivities = new Set();

  state.classActivities.forEach(a => allActivities.add(a.nome));
  state.risultato.forEach(r => allActivities.add(r.attivita));

  let activities = Array.from(allActivities);

  if (term) {
    const actMatches = activities.filter(a => a.toLowerCase().includes(term));
    const profMatches = state.professori.filter(p => p.nome.toLowerCase().includes(term));

    if (actMatches.length) {
      activities = actMatches;
    } else if (profMatches.length) {
      activities = [];
    }
  }

  let profs = state.professori;
  if (term) {
    const profMatches = profs.filter(p => p.nome.toLowerCase().includes(term));
    if (profMatches.length) profs = profMatches;
  }

  if (!profs.length) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td style="padding:12px; opacity:0.5;">Nessun risultato</td></tr>';
    return;
  }

  const map = {};
  const weekUsage = {};
  const dayUsageMap = {};

  profs.forEach(p => {
    map[p.nome] = {};
    activities.forEach(act => (map[p.nome][act] = 0));
  });

  state.risultato.forEach(r => {
    if (!r.professore) return;

    if (map[r.professore] && map[r.professore].hasOwnProperty(r.attivita)) {
      map[r.professore][r.attivita] += r.durata;
    }

    weekUsage[r.professore] = (weekUsage[r.professore] || 0) + r.durata;
    const dayKey = `${r.professore}|${r.giorno}`;
    dayUsageMap[dayKey] = (dayUsageMap[dayKey] || 0) + r.durata;
  });

  const getMaxDayUsed = (profName) => {
    let max = 0;
    Object.keys(dayUsageMap).forEach(k => {
      if (k.startsWith(`${profName}|`)) {
        max = Math.max(max, dayUsageMap[k]);
      }
    });
    return max;
  };

  matrixCache.activities = activities;
  matrixCache.rows = profs.map(p => {
    const dayUsed = getMaxDayUsed(p.nome);
    const weekUsed = weekUsage[p.nome] || 0;
    return {
      nome: p.nome,
      maxOreGiorno: p.maxOreGiorno,
      maxOreSettimana: p.maxOreSettimana,
      saldoG: p.maxOreGiorno - dayUsed,
      saldoW: p.maxOreSettimana - weekUsed,
      ore: map[p.nome]
    };
  });

  head.innerHTML = `<tr>
    <th>Professore</th>
    <th>Giorno</th>
    <th>Week</th>
    <th>Saldo G</th>
    <th>Saldo W</th>
    ${activities.map(a => {
      const isLab = state.laboratori.some(l => l.nome === a);
      const icon = isLab ? '🔬' : '📚';
      return `<th style="min-width:80px; text-align:center;"><small>${icon}</small> ${a}</th>`;
    }).join('')}
  </tr>`;

  body.innerHTML = matrixCache.rows.map(r => `<tr>
    <td style="font-weight:600; color:var(--primary);">${r.nome}</td>
    <td style="text-align:center;">${r.maxOreGiorno}h</td>
    <td style="text-align:center;">${r.maxOreSettimana}h</td>
    <td style="text-align:center; color:${r.saldoG < 0 ? '#ef4444' : '#10b981'}">${r.saldoG}</td>
    <td style="text-align:center; color:${r.saldoW < 0 ? '#ef4444' : '#10b981'}">${r.saldoW}</td>
    ${activities.map(act => {
      const ore = r.ore[act] || 0;
      return `<td style="text-align:center; font-weight:bold; color:${ore > 0 ? '#10b981' : '#cbd5e1'}">${ore}h</td>`;
    }).join('')}
  </tr>`).join('');
}

// ====== REGOLE R7, UTILS ====== //
function needsSecondTeacherForClass(className) {
  const classInfo = state.classi.find(c => c.nome === className);
  return rulesConfig.rule7Enable && classInfo && !classInfo.bypassRule7 && classInfo.alunni > rulesConfig.rule7Value;
}

function updateRule7Warnings() {
  state.warnings = state.warnings.filter(w => !w.startsWith('⚠️ [R7]'));

  state.classActivities.forEach(activity => {
    if (!needsSecondTeacherForClass(activity.classe)) return;

    const slots = genSlots(activity.oraInizio, activity.oraFine);
    slots.forEach(s => {
      const assigned = [...new Set(state.risultato
        .filter(r =>
          r.giorno === activity.giorno &&
          r.ora === s.start &&
          r.classe === activity.classe &&
          r.attivita === activity.nome
        )
        .map(r => r.professore)
        .filter(Boolean)
      )];

      if (assigned.length < 2) {
        state.warnings.push(formatWarning(`⚠️ [R7] ${activity.classe} - ${activity.nome}: manca 2° docente`, activity, s.start));
      }
    });
  });
}

function isProfBusyAtSlot(profName, giorno, ora, exclude) {
  return state.risultato.some(r =>
    r.professore === profName &&
    r.giorno === giorno &&
    r.ora === ora &&
    !(exclude && r.classe === exclude.classe && r.attivita === exclude.attivita && r.giorno === exclude.giorno && r.ora === exclude.ora)
  );
}

function addPendingSlot(activity, slotTime, activityLab) {
  state.risultato.push({
    giorno: activity.giorno,
    professore: null,
    attivita: activity.nome,
    classe: activity.classe,
    ora: slotTime,
    durata: 1,
    laboratorio: activityLab || null
  });
}

function formatWarning(message, activity = null, slotTime = null) {
  let dateStr = null;
  let timeStr = null;

  if (activity) {
    dateStr = normalizeDateStr(activity.giorno) || activity.giorno || null;
    if (slotTime) timeStr = slotTime;
    else if (activity.oraInizio && activity.oraFine) timeStr = `${activity.oraInizio}-${activity.oraFine}`;
  }

  if (!dateStr || !timeStr) {
    const now = new Date();
    dateStr = dateStr || now.toISOString().split('T')[0];
    timeStr = timeStr || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return `${message} (${dateStr} ${timeStr})`;
}

function getOwnerLab(prof) {
  const lab = state.laboratori.find(l => l.owner === prof);
  return lab ? lab.nome : null;
}

// ====== CALCOLO ALGORITMO (pianifica) ====== //
// Full algorithm preserved (identical logic to original) with lab-bypass handling.
// Included fixes: assignToProf uses slotTime, consecutive block tries multiple candidates.
// Added debug exposures to window._last_sortedCandidates and window._last_candidateListOrdered.
function pianifica() {
  const locked = state.risultato.filter(r => r.locked);
  state.risultato = [...locked];
  state.warnings = [];

  const { professori: p, disponibilita: d, classActivities: ca, laboratori: lab } = state;

  if (!p.length || !d.length || !ca.length) {
    state.warnings.push(formatWarning("❌ Dati insufficienti"));
    return;
  }

  const oreSettimanaliUsate = {};
  const oreGiornaliereUsate = {};
  const attivitaGiornaliereProf = {};
  const oreLabGiornaliere = {};
  const lockedKeys = new Set(locked.map(r => `${r.giorno}|${r.ora}|${r.classe}|${r.attivita}`));

  p.forEach(prof => {
    oreSettimanaliUsate[prof.nome] = 0;
    attivitaGiornaliereProf[prof.nome] = {};
  });

  lab.forEach(labor => {
    oreLabGiornaliere[labor.nome] = {};
  });

  locked.forEach(r => {
    if (!r.professore) return;
    oreSettimanaliUsate[r.professore] = (oreSettimanaliUsate[r.professore] || 0) + 1;
    oreGiornaliereUsate[`${r.professore}-${r.giorno}`] = (oreGiornaliereUsate[`${r.professore}-${r.giorno}`] || 0) + 1;

    if (!attivitaGiornaliereProf[r.professore][r.giorno]) attivitaGiornaliereProf[r.professore][r.giorno] = [];
    const start = timeToMin(r.ora);
    attivitaGiornaliereProf[r.professore][r.giorno].push({ start, end: start + 60, attivita: r.attivita, classe: r.classe });

    if (r.laboratorio) {
      if (!oreLabGiornaliere[r.laboratorio][r.giorno]) oreLabGiornaliere[r.laboratorio][r.giorno] = 0;
      oreLabGiornaliere[r.laboratorio][r.giorno]++;
    }
  });

	const activitiesExpanded = ca.slice();

  const getSortedCandidates = (cands, day) => {
    return [...cands].sort((a,b) => {
      const aWeek = oreSettimanaliUsate[a] || 0;
      const bWeek = oreSettimanaliUsate[b] || 0;
      if (aWeek !== bWeek) return aWeek - bWeek;
      const aDay = oreGiornaliereUsate[`${a}-${day}`] || 0;
      const bDay = oreGiornaliereUsate[`${b}-${day}`] || 0;
      if (aDay !== bDay) return aDay - bDay;
      return a.localeCompare(b);
    });
  };

  const activityAllowsOverlap = (classe, attivita, giorno) => {
    const found = state.classActivities.find(a =>
      a.classe === classe && a.nome === attivita && normalizeDateStr(a.giorno) === normalizeDateStr(giorno)
    );
    return !!found?.allowOverlap;
  };

  const consecutiveRequired = (rulesConfig.rule10Enable ? Number(rulesConfig.rule10Value) || 0 : 0);

  activitiesExpanded.forEach(activity => {
    const classInfo = state.classi.find(c => c.nome === activity.classe);
    const needsSecondTeacher = rulesConfig.rule7Enable && classInfo && !classInfo.bypassRule7 && classInfo.alunni > rulesConfig.rule7Value;

    const lockedProf1 = activity.prof1 || null;
    const lockedProf2 = activity.prof2 || null;

    const requiredTeachers = lockedProf2 ? 2 : (needsSecondTeacher ? 2 : 1);

    let proj = state.progetti.find(pr => pr.nome === activity.nome);
    let labItem = null;

    if (!proj) {
      labItem = state.laboratori.find(l => l.nome === activity.nome);
      if (!labItem) return;
    }

    if (labItem && !labItem.owner) {
      state.warnings.push(formatWarning(`⛔ ${activity.classe} - ${activity.nome}: Lab senza owner assegnato`, activity));
      const slots = genSlots(activity.oraInizio, activity.oraFine);
      slots.forEach(s => addPendingSlot(activity, s.start, activity.nome));
      return;
    }

    if (proj && proj.laboratorio) {
      const labData = lab.find(l => l.nome === proj.laboratorio);
      if (labData && !labData.owner) {
        state.warnings.push(formatWarning(`⛔ ${activity.classe} - ${activity.nome}: Lab "${proj.laboratorio}" senza owner assegnato`, activity));
        const slots = genSlots(activity.oraInizio, activity.oraFine);
        slots.forEach(s => addPendingSlot(activity, s.start, proj.laboratorio));
        return;
      }
    }

    const activityLab = (proj && proj.laboratorio) ? proj.laboratorio : (labItem ? activity.nome : null);
    const ownerProf = labItem ? labItem.owner : (proj && proj.laboratorio ? lab.find(l => l.nome === proj.laboratorio)?.owner : null);

    const dispByDayAll = d.filter(x => x.giorno === activity.giorno);

    const profCandidates = [...new Set(dispByDayAll.map(x => x.professore))].filter(profName => {
      const ownerLab = getOwnerLab(profName);
      if (ownerLab && ownerLab !== activityLab) return false;

      const hasSlot = dispByDayAll.some(dd => {
        if (dd.professore !== profName) return false;
        if (dd.laboratorio && activityLab && dd.laboratorio !== activityLab) return false;
        if (dd.laboratorio && !activityLab) return false;
        const profStart = timeToMin(dd.oraInizio);
        const profEnd = timeToMin(dd.oraFine);
        const actStart = timeToMin(activity.oraInizio);
        const actEnd = timeToMin(activity.oraFine);
        return profEnd > actStart && profStart < actEnd;
      });

      if (!hasSlot) return false;

      if (rulesConfig.rule4Enable) {
        const actStart = timeToMin(activity.oraInizio);
        const actEnd = timeToMin(activity.oraFine);
        const tolerance = rulesConfig.rule4Value;

        const slots = attivitaGiornaliereProf[profName][activity.giorno] || [];
        for (let slot of slots) {
          if (slot.attivita === activity.nome && slot.classe === activity.classe) continue;
          if (actStart < slot.end + tolerance && actEnd > slot.start - tolerance) return false;
        }
      }

      return true;
    });

    const sortedCandidates = getSortedCandidates(profCandidates, activity.giorno);
    // expose for debug after computing sortedCandidates for this activity
    try { window._last_sortedCandidates = [...sortedCandidates]; } catch(e) {}
    console.debug('pianifica: sortedCandidates', sortedCandidates);

    let primaryProf = null;
    let secondaryProf = null;

    if (lockedProf1) {
      if (!profCandidates.includes(lockedProf1)) {
        state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Docente 1 bloccato non disponibile`, activity));
        const slots = genSlots(activity.oraInizio, activity.oraFine);
        slots.forEach(s => addPendingSlot(activity, s.start, activityLab));
        return;
      }
      primaryProf = lockedProf1;
    } else if (ownerProf) {
      if (!profCandidates.includes(ownerProf)) {
        state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Owner non disponibile`, activity));
        const slots = genSlots(activity.oraInizio, activity.oraFine);
        slots.forEach(s => addPendingSlot(activity, s.start, activityLab));
        return;
      }
      primaryProf = ownerProf;
    } else {
      primaryProf = sortedCandidates[0] || null;
    }

    if (profCandidates.length === 0) {
      state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome} (${activity.giorno}): Nessun prof`, activity));
      const slots = genSlots(activity.oraInizio, activity.oraFine);
      slots.forEach(s => addPendingSlot(activity, s.start, activityLab));
      return;
    }

    if (requiredTeachers === 2) {
      if (lockedProf2) {
        if (!profCandidates.includes(lockedProf2)) {
          state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Docente 2 bloccato non disponibile`, activity));
          secondaryProf = null;
        } else {
          secondaryProf = lockedProf2;
        }
      } else {
        secondaryProf = profCandidates.length > 1 ? profCandidates.find(pname => pname !== primaryProf) : null;
      }

      if (!secondaryProf) {
        state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Solo 1 docente disponibile (2 richiesti)`, activity));
      }
    }

    const slots = genSlots(activity.oraInizio, activity.oraFine);
    let primaryAssigned = 0;
    let secondaryAssigned = 0;

    // canAssignToProf now also checks lab daily limit (unless activity.allowLabMaxOverride is true)
    const canAssignToProf = (profName, slotTime, weekMap, dayMap) => {
      const profData = p.find(x => x.nome === profName);
      if (!profData) return false;

      const isAvailable = dispByDayAll.some(dd => {
        if (dd.professore !== profName) return false;
        if (dd.laboratorio && activityLab && dd.laboratorio !== activityLab) return false;
        if (dd.laboratorio && !activityLab) return false;
        const profStart = timeToMin(dd.oraInizio);
        const profEnd = timeToMin(dd.oraFine);
        const slotMin = timeToMin(slotTime);
        return slotMin >= profStart && slotMin < profEnd;
      });

      if (!isAvailable) return false;

      if (isProfBusyAtSlot(profName, activity.giorno, slotTime, { classe: activity.classe, attivita: activity.nome, giorno: activity.giorno, ora: slotTime })) {
        return false;
      }

      const conflict = state.risultato.some(r => {
        if (normalizeDateStr(r.giorno) !== normalizeDateStr(activity.giorno)) return false;
        if (r.ora !== slotTime) return false;
        if (r.classe === activity.classe && r.attivita === activity.nome) return false;
        const sameLab = activityLab && r.laboratorio && r.laboratorio === activityLab;
        const sameActivity = r.attivita === activity.nome;
        if (!sameLab && !sameActivity) return false;
        const otherAllows = activityAllowsOverlap(r.classe, r.attivita, r.giorno);
        return !(activity.allowOverlap && otherAllows);
      });
      if (conflict) return false;

      // check week/day rule for professor
      if (rulesConfig.rule2Enable && (weekMap[profName] || 0) >= profData.maxOreSettimana) return false;
      if (rulesConfig.rule1Enable) {
        const dayKey = `${profName}-${activity.giorno}`;
        if ((dayMap[dayKey] || 0) >= profData.maxOreGiorno) return false;
      }

      // check lab daily max (unless the activity requests bypass)
      if (rulesConfig.rule3Enable && activityLab && !activity.allowLabMaxOverride) {
        const labItemLocal = labItem; // closure variable
        if (labItemLocal && typeof labItemLocal.maxOreGiornoLab === 'number') {
          const currentLabCount = (oreLabGiornaliere[activityLab] && (oreLabGiornaliere[activityLab][activity.giorno] || 0)) || 0;
          if (currentLabCount >= labItemLocal.maxOreGiornoLab) return false;
        }
      }

      return true;
    };

    const canAssignBlock = (profName, startIdx, len) => {
      if (startIdx + len > slots.length) return false;
      const tempWeek = { ...oreSettimanaliUsate };
      const tempDay = { ...oreGiornaliereUsate };
      // temp lab counts for this activity simulation
      const tempLab = {};
      if (activityLab) {
        const existing = oreLabGiornaliere[activityLab] || {};
        Object.keys(existing).forEach(k => tempLab[k] = existing[k]);
      }

      for (let i = 0; i < len; i++) {
        const slotTime = slots[startIdx + i].start;
        const slotKey = `${activity.giorno}|${slotTime}|${activity.classe}|${activity.nome}`;
        if (lockedKeys.has(slotKey)) return false;

        // lab check simulation (if no bypass)
        if (rulesConfig.rule3Enable && activityLab && !activity.allowLabMaxOverride) {
          const labLimit = labItem && labItem.maxOreGiornoLab;
          if (typeof labLimit === 'number') {
            const current = tempLab[activity.giorno] || 0;
            if (current >= labLimit) return false;
          }
        }

        if (!canAssignToProf(profName, slotTime, tempWeek, tempDay)) return false;

        tempWeek[profName] = (tempWeek[profName] || 0) + 1;
        const dayKey = `${profName}-${activity.giorno}`;
        tempDay[dayKey] = (tempDay[dayKey] || 0) + 1;

        if (activityLab) {
          tempLab[activity.giorno] = (tempLab[activity.giorno] || 0) + 1;
        }
      }
      return true;
    };

    // assignToProf - updated to use slotTime for registrations (fix consecutive logic)
    const assignToProf = (profName, slotTime, lockedAssignment = false) => {
      const profData = p.find(x => x.nome === profName);
      if (!profData) return false;

      const isAvailable = dispByDayAll.some(dd => {
        if (dd.professore !== profName) return false;
        if (dd.laboratorio && activityLab && dd.laboratorio !== activityLab) return false;
        if (dd.laboratorio && !activityLab) return false;
        const profStart = timeToMin(dd.oraInizio);
        const profEnd = timeToMin(dd.oraFine);
        const slotMin = timeToMin(slotTime);
        return slotMin >= profStart && slotMin < profEnd;
      });

      if (!isAvailable) return false;

      if (isProfBusyAtSlot(profName, activity.giorno, slotTime, { classe: activity.classe, attivita: activity.nome, giorno: activity.giorno, ora: slotTime })) {
        return false;
      }

      const conflict = state.risultato.some(r => {
        if (normalizeDateStr(r.giorno) !== normalizeDateStr(activity.giorno)) return false;
        if (r.ora !== slotTime) return false;
        if (r.classe === activity.classe && r.attivita === activity.nome) return false;
        const sameLab = activityLab && r.laboratorio && r.laboratorio === activityLab;
        const sameActivity = r.attivita === activity.nome;
        if (!sameLab && !sameActivity) return false;
        const otherAllows = activityAllowsOverlap(r.classe, r.attivita, r.giorno);
        return !(activity.allowOverlap && otherAllows);
      });
      if (conflict) return false;

      if (rulesConfig.rule2Enable && oreSettimanaliUsate[profName] >= profData.maxOreSettimana) return false;

      if (rulesConfig.rule1Enable) {
        if (!oreGiornaliereUsate[`${profName}-${activity.giorno}`]) oreGiornaliereUsate[`${profName}-${activity.giorno}`] = 0;
        if (oreGiornaliereUsate[`${profName}-${activity.giorno}`] >= profData.maxOreGiorno) return false;
      }

      // LAB daily max check at assignment time (respect override flag)
      if (rulesConfig.rule3Enable && activityLab && !activity.allowLabMaxOverride) {
        const labLimit = labItem && labItem.maxOreGiornoLab;
        if (typeof labLimit === 'number') {
          if (!oreLabGiornaliere[activityLab][activity.giorno]) oreLabGiornaliere[activityLab][activity.giorno] = 0;
          if (oreLabGiornaliere[activityLab][activity.giorno] >= labLimit) {
            return false;
          }
        }
      }

      state.risultato.push({
        giorno: activity.giorno,
        professore: profName,
        attivita: activity.nome,
        classe: activity.classe,
        ora: slotTime,
        durata: 1,
        laboratorio: activityLab || null,
        locked: lockedAssignment || false
      });

      oreSettimanaliUsate[profName]++;
      if (rulesConfig.rule1Enable) oreGiornaliereUsate[`${profName}-${activity.giorno}`]++;

      if (!attivitaGiornaliereProf[profName][activity.giorno]) attivitaGiornaliereProf[profName][activity.giorno] = [];
      const slotStart = timeToMin(slotTime);
      attivitaGiornaliereProf[profName][activity.giorno].push({ start: slotStart, end: slotStart + 60, attivita: activity.nome, classe: activity.classe });

      // increment lab usage (only if lab present)
      if (activityLab) {
        if (!oreLabGiornaliere[activityLab][activity.giorno]) oreLabGiornaliere[activityLab][activity.giorno] = 0;
        oreLabGiornaliere[activityLab][activity.giorno]++;
      }

      return true;
    };

    // expose for debug if needed
    try { window._last_activity_processing = { activityName: activity.nome, day: activity.giorno, slots: slots.map(s=>s.start) }; } catch(e) {}

    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      const s = slots[slotIdx];
      const slotKey = `${activity.giorno}|${s.start}|${activity.classe}|${activity.nome}`;
      if (lockedKeys.has(slotKey)) {
        const lockedEntries = locked.filter(r =>
          r.giorno === activity.giorno && r.ora === s.start && r.classe === activity.classe && r.attivita === activity.nome && r.professore
        );

        const lockedProfs = [...new Set(lockedEntries.map(r => r.professore))];
        if (lockedProfs.length > 0) primaryAssigned++;

        if (requiredTeachers === 2) {
          if (lockedProfs.length >= 2) secondaryAssigned++;
          else {
            const secondaryPool = sortedCandidates.filter(c => !lockedProfs.includes(c));
            let assigned = false;
            for (const cand of secondaryPool) {
              if (assignToProf(cand, s.start, cand === lockedProf2)) {
                secondaryAssigned++; assigned = true; break;
              }
            }
            if (!assigned) addPendingSlot(activity, s.start, activityLab);
          }
        }

        continue;
      }

      let primaryAssignedThisSlot = false;
      let secondaryAssignedThisSlot = false;
      let primaryUsed = null;

      const primaryPool = lockedProf1 ? [lockedProf1] : (ownerProf ? [ownerProf] : sortedCandidates);
      const primaryCandidate = primaryPool[0];

      // ===== gestione block di ore consecutive: prova più candidati per il blocco =====
      if (consecutiveRequired > 1) {
        // costruisci lista candidati da provare (rispetta lock/owner se presenti) e rendila unica
        const candidateListOrdered = [];
        if (lockedProf1) candidateListOrdered.push(lockedProf1);
        else if (ownerProf) candidateListOrdered.push(ownerProf);
        // aggiungi sortedCandidates, evitando duplicati
        for (const c of sortedCandidates) if (!candidateListOrdered.includes(c)) candidateListOrdered.push(c);

        // debug exposure
        try { window._last_candidateListOrdered = [...candidateListOrdered]; } catch(e) {}
        console.debug('pianifica: candidateListOrdered', candidateListOrdered);

        let chosenPrimary = null;
        for (const cand of candidateListOrdered) {
          if (canAssignBlock(cand, slotIdx, consecutiveRequired)) {
            chosenPrimary = cand;
            break;
          }
        }

        if (chosenPrimary) {
          console.debug(`consecutive block: chosen primary ${chosenPrimary} for activity ${activity.nome} at ${activity.giorno} starting slotIdx ${slotIdx}`);
          // assegna il blocco al candidato scelto
          for (let i = 0; i < consecutiveRequired; i++) {
            const blockSlotTime = slots[slotIdx + i].start;
            const isLockedPrimary = chosenPrimary === lockedProf1;
            if (assignToProf(chosenPrimary, blockSlotTime, isLockedPrimary)) {
              primaryAssigned++;
              primaryAssignedThisSlot = true;
              primaryUsed = chosenPrimary;
            } else {
              // se non riesce ad assegnare un'ora del blocco, marca come pending
              console.debug(`consecutive block: failed assignToProf ${chosenPrimary} for slot ${blockSlotTime}`);
              addPendingSlot(activity, blockSlotTime, activityLab);
            }

            if (requiredTeachers === 2) {
              const secondaryPool = lockedProf2 ? [lockedProf2] : sortedCandidates.filter(c => c !== chosenPrimary);
              let secAssigned = false;
              for (const cand2 of secondaryPool) {
                if (assignToProf(cand2, blockSlotTime, cand2 === lockedProf2)) {
                  secondaryAssigned++;
                  secAssigned = true;
                  break;
                }
              }
              if (!secAssigned) {
                addPendingSlot(activity, blockSlotTime, activityLab);
              }
            }
          }

          // salta gli slot già gestiti dal blocco
          slotIdx += consecutiveRequired - 1;
          continue;
        }
      }
      // ===== fine gestione block =====

      for (const cand of primaryPool) {
        if (assignToProf(cand, s.start, cand === lockedProf1)) {
          primaryAssigned++; primaryAssignedThisSlot = true; primaryUsed = cand; break;
        }
      }

      if (requiredTeachers === 2) {
        const secondaryPool = lockedProf2 ? [lockedProf2] : sortedCandidates.filter(c => c !== primaryUsed);
        for (const cand of secondaryPool) {
          if (assignToProf(cand, s.start, cand === lockedProf2)) {
            secondaryAssigned++; secondaryAssignedThisSlot = true; break;
          }
        }
      }

      if (!primaryAssignedThisSlot) addPendingSlot(activity, s.start, activityLab);
      else if (requiredTeachers === 2 && !secondaryAssignedThisSlot) addPendingSlot(activity, s.start, activityLab);
    }

    if (primaryAssigned < slots.length) {
      state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Solo ${primaryAssigned}/${slots.length}h assegnate (docente 1)`, activity));
    }

    if (requiredTeachers === 2 && secondaryProf && secondaryAssigned < slots.length) {
      state.warnings.push(formatWarning(`⚠️ ${activity.classe} - ${activity.nome}: Solo ${secondaryAssigned}/${slots.length}h assegnate (docente 2)`, activity));
    }
  });

  if (state.warnings.length === 0) state.warnings.push(formatWarning("✅ Tutte le attività completamente assegnate"));
}

// ====== STICKY-LEFT HELPER ====== //
function setStickyLeftOffsets(tableId, leftOrder = ['col-day','col-time']) {
  const table = document.getElementById(tableId);
  if (!table) return;

  leftOrder.forEach(cls => {
    table.querySelectorAll('th.' + cls + ', td.' + cls).forEach(el => {
      el.classList.remove('sticky-left');
      el.style.left = '';
      el.style.zIndex = '';
    });
  });

  let cumulative = 0;
  for (let i = 0; i < leftOrder.length; i++) {
    const cls = leftOrder[i];
    const ref = table.querySelector('th.' + cls) || table.querySelector('td.' + cls);
    const width = ref ? Math.ceil(ref.getBoundingClientRect().width) : 0;

    const nodes = table.querySelectorAll('th.' + cls + ', td.' + cls);
    nodes.forEach(el => {
      el.classList.add('sticky-left');
      el.style.left = cumulative + 'px';
      if (el.tagName.toLowerCase() === 'th') el.style.zIndex = 3000 + (leftOrder.length - i);
      else el.style.zIndex = 2000 + (leftOrder.length - i);
    });

    if (ref) {
      if (!ref.style.minWidth) ref.style.minWidth = cls === 'col-day' ? '80px' : '70px';
      if (!ref.style.maxWidth) ref.style.maxWidth = cls === 'col-day' ? '260px' : '140px';
    }

    cumulative += Math.max(1, width);
  }
}

function ensurePlanningStickyLeft() {
  setTimeout(() => {
    setStickyLeftOffsets('planningTable', ['col-day','col-time']);
    setStickyLeftOffsets('labPlanningTable', ['col-day','col-time']);
  }, 40);
}

window.addEventListener('resize', () => {
  setStickyLeftOffsets('planningTable', ['col-day','col-time']);
  setStickyLeftOffsets('labPlanningTable', ['col-day','col-time']);
});

// ====== HELPERS: decide se una data ha attività nella settimana/periodo ====== //
function planningDayHasContent(dateStr) {
  const norm = normalizeDateStr(dateStr);
  const hasClassActivity = state.classActivities.some(a => normalizeDateStr(a.giorno) === norm && state.classi.some(c => c.nome === a.classe));
  const hasAssigned = state.risultato.some(r => normalizeDateStr(r.giorno) === norm && state.classi.some(c => c.nome === r.classe));
  return hasClassActivity || hasAssigned;
}

function labPlanningDayHasContent(dateStr) {
  const norm = normalizeDateStr(dateStr);
  const hasLabClassActivity = state.classActivities.some(a => {
    if (normalizeDateStr(a.giorno) !== norm) return false;
    if (state.laboratori.some(l => l.nome === a.nome)) return true;
    const proj = state.progetti.find(p => p.nome === a.nome);
    if (proj && proj.laboratorio) return true;
    return false;
  });
  const hasLabAssigned = state.risultato.some(r => normalizeDateStr(r.giorno) === norm && r.laboratorio);
  return hasLabClassActivity || hasLabAssigned;
}

// ====== WEEK DATES helper ====== //
function getWeekDatesForStart(startDateValue) {
  if (!startDateValue) return [];
  const dayNames = ['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
  const dayKeys = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const startDate = new Date(startDateValue);
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    if (rulesConfig.rule8Days.includes(dayKeys[i])) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      weekDates.push({ dateStr: d.toISOString().split('T')[0], dayName: dayNames[i], dayNum: i+1 });
    }
  }
  return weekDates;
}

// ====== ATTACH DELEGATED CLICK HANDLER (solves lost listeners after innerHTML) ====== //
function attachPlanningActivityDelegation() {
  const attachFor = (tableId) => {
    const table = document.getElementById(tableId);
    if (!table) return;
    if (table._planningClickHandler) table.removeEventListener('click', table._planningClickHandler);
    table._planningClickHandler = function (e) {
      const el = e.target.closest('.planning-activity');
      if (!el || !table.contains(el)) return;
      const data = el.dataset || {};
      openPlanningSwapModal(data);
    };
    table.addEventListener('click', table._planningClickHandler);
  };
  attachFor('planningTable');
  attachFor('labPlanningTable');
}

// ====== PLANNING GENERATION (days filtered by presence of activities) ====== //
let planningShowPendingOnly = false;
function togglePlanningPending(val) { planningShowPendingOnly = !!val; generatePlanningView(); }

function generatePlanningView() {
  const startDateValue = document.getElementById('planningWeekStart')?.value;
  if (!startDateValue) return alert('Seleziona una data');

  if (!state.classi || state.classi.length === 0) {
    document.getElementById('planningTable').innerHTML = '<tr><td style="padding:12px; opacity:0.6;">Nessuna classe presente</td></tr>';
    return;
  }

  const hours = [];
  for (let i = 8; i <= 17; i++) hours.push(`${String(i).padStart(2,'0')}:00`);

  let weekDates = getWeekDatesForStart(startDateValue);
  weekDates = weekDates.filter(wd => planningDayHasContent(wd.dateStr));

  if (weekDates.length === 0) {
    document.getElementById('planningTable').innerHTML = '<tr><td style="padding:12px; opacity:0.6;">Nessun giorno con attività</td></tr>';
    return;
  }

  let html = `<thead><tr>
    <th class="col-day" style="min-width:80px; max-width:260px;">Giorno</th>
    <th class="col-time" style="min-width:70px; max-width:140px;">Ora</th>
    ${state.classi.map(c => `<th style="text-align:center; min-width:120px; font-size:11px;"><strong>${c.nome}</strong></th>`).join('')}
  </tr></thead><tbody>`;

  weekDates.forEach((dayInfo, dayIdx) => {
    let firstHourOfDay = true;
    hours.forEach(hour => {
      html += `<tr>`;
      if (firstHourOfDay) {
        html += `<td class="col-day" rowspan="${hours.length}" style="font-weight:bold; text-align:center; vertical-align:middle; padding:8px;">
          <div style="font-size:13px; margin-bottom:8px; font-weight:bold;">${dayInfo.dayName}</div>
          <div style="font-size:9px; opacity:0.85;">${dayInfo.dateStr}</div>
        </td>`;
        firstHourOfDay = false;
      }

      html += `<td class="col-time" style="font-weight:bold; text-align:center; padding:6px; font-size:10px;">${hour}</td>`;

      state.classi.forEach(classe => {
        let cellActivities = state.risultato.filter(r =>
          normalizeDateStr(r.giorno) === dayInfo.dateStr && r.ora === hour && r.classe === classe.nome
        );

        if (planningShowPendingOnly) cellActivities = cellActivities.filter(r => !r.professore);

        if (cellActivities.length === 0) {
          html += `<td style="min-height:50px; padding:3px; background:rgba(0,0,0,0.02); border:1px solid var(--border);"></td>`;
        } else {
          const activityGroups = {};
          cellActivities.forEach(r => {
            if (!activityGroups[r.attivita]) activityGroups[r.attivita] = [];
            activityGroups[r.attivita].push(r);
          });

          const cellContent = Object.entries(activityGroups).map(([actName, activities]) => {
            const professionisti = [...new Set(activities.map(a => a.professore))].filter(Boolean);
            const waiting = professionisti.length === 0;
            const profLabel = waiting ? '⏳ In attesa' : professionisti.join(', ');
            const isLab = state.laboratori.some(l => l.nome === actName);
            const locked = activities.some(a => a.locked && a.professore);
            const requiresTwo = needsSecondTeacherForClass(classe.nome);
            const missingSecond = requiresTwo && professionisti.length < 2;
            const badge = waiting ? '<span class="planning-badge waiting">⏳</span>' : locked ? '<span class="planning-badge locked">🔒</span>' : '<span class="planning-badge ok">✅</span>';
            const warnBadge = missingSecond ? '<span class="planning-badge waiting">⚠️</span>' : '';
            return `<div class="planning-activity ${waiting ? 'waiting' : ''}" data-giorno="${dayInfo.dateStr}" data-ora="${hour}" data-classe="${classe.nome}" data-attivita="${actName}"
                      style="background: rgba(37,99,235,0.15); border-left:3px solid #2563eb; padding:3px; margin:2px 0; border-radius:2px; line-height:1.2; cursor:pointer;">
                      <strong style="font-size:12px; display:block; color:var(--primary); margin-bottom:2px;">${isLab ? '🔬' : '📚'} ${actName}${badge}${warnBadge}</strong>
                      <small style="font-size:10px; display:block; color:var(--text); opacity:0.8;">👨‍🏫 ${profLabel}</small>
                    </div>`;
          }).join('');
          html += `<td style="min-height:50px; padding:3px; background:rgba(16,185,129,0.05); font-size:8px; word-break:break-word; border:1px solid var(--border);">${cellContent}</td>`;
        }
      });

      html += `</tr>`;
    });

    if (dayIdx < weekDates.length - 1) html += `<tr style="height:2px;"><td colspan="${state.classi.length + 2}"></td></tr>`;
  });

  html += `</tbody>`;
  const tableEl = document.getElementById('planningTable');
  tableEl.innerHTML = html;

  // finalize sticky and attach delegated click handler
  ensurePlanningStickyLeft();
  attachPlanningActivityDelegation();
}

// ====== LAB PLANNING (days filtered) ====== //
function generateLabPlanningView() {
  const startDateValue = document.getElementById('labPlanningWeekStart')?.value;
  if (!startDateValue) return alert('Seleziona una data');

  if (!state.laboratori || state.laboratori.length === 0) {
    document.getElementById('labPlanningTable').innerHTML = '<tr><td style="padding:12px; opacity:0.6;">Nessun laboratorio presente</td></tr>';
    return;
  }

  const hours = [];
  for (let i = 8; i <= 17; i++) hours.push(`${String(i).padStart(2,'0')}:00`);

  let weekDates = getWeekDatesForStart(startDateValue);
  weekDates = weekDates.filter(wd => labPlanningDayHasContent(wd.dateStr));

  if (weekDates.length === 0) {
    document.getElementById('labPlanningTable').innerHTML = '<tr><td style="padding:12px; opacity:0.6;">Nessun giorno con attività laboratori</td></tr>';
    return;
  }

  let html = `<thead><tr>
    <th class="col-day" style="min-width:80px; max-width:260px;">Giorno</th>
    <th class="col-time" style="min-width:70px; max-width:140px;">Ora</th>
    ${state.laboratori.map(l => `<th style="text-align:center; min-width:140px; font-size:11px;"><strong>🔬 ${l.nome}</strong></th>`).join('')}
  </tr></thead><tbody>`;

  weekDates.forEach((dayInfo, dayIdx) => {
    let firstHourOfDay = true;
    hours.forEach(hour => {
      html += `<tr>`;
      if (firstHourOfDay) {
        html += `<td class="col-day" rowspan="${hours.length}" style="font-weight:bold; text-align:center; vertical-align:middle; padding:8px;">
          <div style="font-size:13px; margin-bottom:8px; font-weight:bold;">${dayInfo.dayName}</div>
          <div style="font-size:9px; opacity:0.85;">${dayInfo.dateStr}</div>
        </td>`;
        firstHourOfDay = false;
      }

      html += `<td class="col-time" style="font-weight:bold; text-align:center; padding:6px; font-size:10px;">${hour}</td>`;

      state.laboratori.forEach(lab => {
        const cellActivities = state.risultato.filter(r =>
          normalizeDateStr(r.giorno) === dayInfo.dateStr && r.ora === hour && r.laboratorio === lab.nome
        );

        if (cellActivities.length === 0) {
          html += `<td style="min-height:50px; padding:3px; background:rgba(0,0,0,0.02); border:1px solid var(--border);"></td>`;
        } else {
          const cellContent = cellActivities.map(r => {
            const waiting = !r.professore;
            const profLabel = waiting ? '⏳ In attesa' : r.professore;
            return `<div style="background: rgba(124,58,237,0.12); border-left:3px solid #7c3aed; padding:3px; margin:2px 0; border-radius:2px;">
              <strong style="font-size:11px;">${r.attivita}</strong>
              <small style="display:block; font-size:10px;">🏫 ${r.classe}</small>
              <small style="display:block; font-size:10px;">👨‍🏫 ${profLabel}</small>
            </div>`;
          }).join('');
          html += `<td style="min-height:50px; padding:3px; background:rgba(124,58,237,0.05); font-size:8px; word-break:break-word; border:1px solid var(--border);">${cellContent}</td>`;
        }
      });

      html += `</tr>`;
    });

    if (dayIdx < weekDates.length - 1) html += `<tr style="height:2px;"><td colspan="${state.laboratori.length + 2}"></td></tr>`;
  });

  html += `</tbody>`;
  const tableEl = document.getElementById('labPlanningTable');
  tableEl.innerHTML = html;

  ensurePlanningStickyLeft();
  attachPlanningActivityDelegation();
}

// ====== PLANNING: SWAP DOCENTE / MODAL ====== //
let planningSwapTarget = null;

function openPlanningSwapModal({ giorno, ora, classe, attivita }) {
  const entries = state.risultato.filter(r =>
    r.giorno === giorno && r.ora === ora && r.classe === classe && r.attivita === attivita
  );

  if (!entries.length) return alert('Nessuna attività selezionata');

  const lab = entries[0].laboratorio || null;
  planningSwapTarget = { giorno, ora, classe, attivita, lab };

  const info = `📅 ${giorno} | 🕐 ${ora} | 🏫 ${classe} | 📘 ${attivita}${lab ? ' | 🔬 ' + lab : ''}`;
  document.getElementById('planningSwapInfo').textContent = info;

  const requiresTwo = needsSecondTeacherForClass(classe);
  const selectRow = document.getElementById('planningProfSelect2Row');
  if (selectRow) selectRow.style.display = requiresTwo ? '' : 'none';

  // Variante: mostra tutti i professori ma disabilita quelli non selezionabili e mostra motivo
  function reasonForNonSelectable(profName) {
    // owner lab mismatch
    const ownerLab = getOwnerLab(profName);
    if (ownerLab && ownerLab !== lab) return `Owner di ${ownerLab} (non compatibile col lab richiesto)`;

    // availability
    if (!isProfAvailableForSlot(profName, giorno, ora, lab)) return 'Non disponibile in questa ora';

    // busy
    if (isProfBusyAtSlot(profName, giorno, ora, { classe, attivita, giorno, ora })) return 'Già impegnato a quest\'ora';

    // usage limits (escludendo entry corrente)
    const usage = getProfUsage(profName, { giorno, ora, classe, attivita });
    const profData = state.professori.find(p => p.nome === profName);
    if (!profData) return 'Dati docente mancanti';
    if (rulesConfig.rule2Enable && usage.weekUsed >= profData.maxOreSettimana) return 'Limite settimanale raggiunto';
    if (rulesConfig.rule1Enable && usage.dayUsed >= profData.maxOreGiorno) return 'Limite giornaliero raggiunto';

    // lab daily limit
    if (lab) {
      const labItem = state.laboratori.find(l => l.nome === lab);
      if (labItem && typeof labItem.maxOreGiornoLab === 'number') {
        const labCount = state.risultato.filter(r =>
          normalizeDateStr(r.giorno) === normalizeDateStr(giorno) &&
          r.laboratorio === lab &&
          !(r.classe === classe && r.attivita === attivita && r.ora === ora)
        ).length;
        if (labCount >= labItem.maxOreGiornoLab) return `Lab pieno (${labItem.maxOreGiornoLab}h/giorno)`;
      }
    }

    return null; // selezionabile
  }

  const opts = ['<option value="">— Nessun docente —</option>'];

  state.professori.forEach(p => {
    const reason = reasonForNonSelectable(p.nome);
    const ownerLab = getOwnerLab(p.nome);
    const ownerLabel = ownerLab ? ` (owner ${ownerLab})` : '';
    const remaining = getProfRemainingLabel(p.nome, { giorno, ora, classe, attivita });
    const display = reason ? `${p.nome} ${remaining} — (${reason})${ownerLabel}` : `${p.nome} ${remaining}${ownerLabel}`;
    const titleAttr = reason ? ` title="${reason}"` : '';
    const disabledAttr = reason ? ' disabled' : '';
    opts.push(`<option value="${p.nome}" data-reason="${reason || ''}"${titleAttr}${disabledAttr}>${display}</option>`);
  });

  const options = opts.join('');

  const select1 = document.getElementById('planningProfSelect');
  const select2 = document.getElementById('planningProfSelect2');

  if (select1) select1.innerHTML = options;
  if (select2) select2.innerHTML = options;

  const assigned = [...new Set(entries.map(r => r.professore).filter(Boolean))];
  if (select1) select1.value = assigned[0] || '';
  if (select2) select2.value = assigned[1] || '';

  document.getElementById('planningProfModal').classList.add('show');
}

function closePlanningSwapModal() {
  planningSwapTarget = null;
  document.getElementById('planningProfModal').classList.remove('show');
}

function getProfUsage(prof, exclude) {
  const weekUsed = state.risultato.filter(r =>
    r.professore === prof &&
    !(r.giorno === exclude.giorno && r.ora === exclude.ora && r.classe === exclude.classe && r.attivita === exclude.attivita)
  ).length;

  const dayUsed = state.risultato.filter(r =>
    r.professore === prof &&
    r.giorno === exclude.giorno &&
    !(r.ora === exclude.ora && r.classe === exclude.classe && r.attivita === exclude.attivita)
  ).length;

  return { weekUsed, dayUsed };
}

function getProfRemainingLabel(profName, exclude) {
  const prof = state.professori.find(p => p.nome === profName);
  if (!prof) return '';
  const usage = getProfUsage(profName, exclude);
  const weekLeft = prof.maxOreSettimana - usage.weekUsed;
  const dayLeft = prof.maxOreGiorno - usage.dayUsed;
  return `(W:${weekLeft} / D:${dayLeft})`;
}

function hasAvailabilityCovering(prof, giorno, ora, lab) {
  const t = timeToMin(ora);
  return state.disponibilita.some(d => {
    if (d.professore !== prof || d.giorno !== giorno) return false;
    if (lab && d.laboratorio && d.laboratorio !== lab) return false;
    const start = timeToMin(d.oraInizio);
    const end = timeToMin(d.oraFine);
    return t >= start && t < end;
  });
}

function addAvailabilityHour(prof, giorno, ora, lab) {
  if (!prof) return;
  const ownerLab = getOwnerLab(prof);
  if (ownerLab && ownerLab !== lab) return;
  if (hasAvailabilityCovering(prof, giorno, ora, lab)) return;
  const end = minToTime(timeToMin(ora) + 60);
  state.disponibilita.push({ giorno, oraInizio: ora, oraFine: end, professore: prof, laboratorio: lab || null });
}

function isProfAvailableForSlot(prof, giorno, ora, lab) {
  const ownerLab = getOwnerLab(prof);
  if (ownerLab && ownerLab !== lab) return false;
  const t = timeToMin(ora);
  return state.disponibilita.some(d => {
    if (d.professore !== prof || d.giorno !== giorno) return false;
    if (d.laboratorio && lab && d.laboratorio !== lab) return false;
    if (d.laboratorio && !lab) return false;
    const start = timeToMin(d.oraInizio);
    const end = timeToMin(d.oraFine);
    return t >= start && t < end;
  });
}

function applyPlanningProfSwap() {
  if (!planningSwapTarget) return;

  const { giorno, ora, classe, attivita, lab } = planningSwapTarget;
  const requiresTwo = needsSecondTeacherForClass(classe);

  const newProf1 = document.getElementById('planningProfSelect').value;
  const newProf2 = requiresTwo ? (document.getElementById('planningProfSelect2')?.value || '') : '';

  const newProfList = [newProf1, newProf2].filter(Boolean);

  if (new Set(newProfList).size !== newProfList.length) {
    alert('❌ I docenti devono essere diversi'); return;
  }

  const targetEntries = state.risultato.filter(r =>
    r.giorno === giorno && r.ora === ora && r.classe === classe && r.attivita === attivita
  );

  const oldProfs = [...new Set(targetEntries.map(r => r.professore).filter(Boolean))];

  if (newProfList.length === 0) {
    oldProfs.forEach(p => addAvailabilityHour(p, giorno, ora, lab));
    if (targetEntries.length === 0) {
      state.risultato.push({ giorno, professore: null, attivita, classe, ora, durata: 1, laboratorio: lab || null, locked: true });
    } else {
      targetEntries.forEach(r => { r.professore = null; r.locked = true; });
    }
    closePlanningSwapModal();
    run(false); generatePlanningView(); generateLabPlanningView(); return;
  }

  for (const prof of newProfList) {
    if (!isProfAvailableForSlot(prof, giorno, ora, lab)) { alert(`❌ ${prof} non è disponibile in quell’ora`); return; }
    if (isProfBusyAtSlot(prof, giorno, ora, { classe, attivita, giorno, ora })) { alert(`❌ ${prof} è già impegnato in un'altra attività a quest'ora`); return; }
  }

  oldProfs.filter(p => !newProfList.includes(p)).forEach(p => addAvailabilityHour(p, giorno, ora, lab));

  state.risultato = state.risultato.filter(r =>
    !(r.giorno === giorno && r.ora === ora && r.classe === classe && r.attivita === attivita)
  );

  newProfList.forEach(p => {
    state.risultato.push({ giorno, professore: p, attivita, classe, ora, durata: 1, laboratorio: lab || null, locked: true });
  });

  closePlanningSwapModal();
  run(false);
  generatePlanningView();
  generateLabPlanningView();
}

// ====== PRINT / EXPORT (respect filtered days) ====== //
function _getFilteredWeekDates(startDateValue, forLab = false) {
  if (!startDateValue) return [];
  const weekDates = getWeekDatesForStart(startDateValue);
  return forLab ? weekDates.filter(wd => labPlanningDayHasContent(wd.dateStr)) : weekDates.filter(wd => planningDayHasContent(wd.dateStr));
}

function exportPlanningCSV() {
  const startDateValue = document.getElementById('planningWeekStart')?.value;
  if (!startDateValue) return alert('Seleziona una data');
  const weekDates = _getFilteredWeekDates(startDateValue, false);
  if (!weekDates.length) return alert('Nessun giorno con attività nella settimana selezionata');

  const hours = []; for (let i = 8; i <= 17; i++) hours.push(`${String(i).padStart(2,'0')}:00`);

  const rows = [];
  weekDates.forEach(dinfo => {
    hours.forEach(hour => {
      state.classi.forEach(classe => {
        const cell = state.risultato.filter(r => normalizeDateStr(r.giorno) === dinfo.dateStr && r.ora === hour && r.classe === classe.nome);
        if (!cell.length) return;
        cell.forEach(r => {
          rows.push([
            dinfo.dateStr,
            hour,
            classe.nome,
            r.attivita || '',
            r.professore || '',
            r.laboratorio || ''
          ].map(field => `"${String(field).replace(/"/g,'""')}"`).join(','));
        });
      });
    });
  });

  if (!rows.length) return alert('Nessun dato da esportare');

  const csv = ['"Giorno","Ora","Classe","Attività","Professore","Lab"', ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'planning.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function printPlanning() {
  const startDateValue = document.getElementById('planningWeekStart')?.value;
  if (!startDateValue) return alert('Seleziona una data');

  const weekDates = _getFilteredWeekDates(startDateValue, false);
  if (!weekDates.length) return alert('Nessun giorno con attività nella settimana selezionata');

  const hours = []; for (let i = 8; i <= 17; i++) hours.push(`${String(i).padStart(2,'0')}:00`);

  let html = '<html><head><title>Planning</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left}th{background:#f3f4f6}</style></head><body>';
  html += '<h2>Planning</h2>';
  html += '<table><thead><tr><th>Giorno</th><th>Ora</th><th>Classe</th><th>Attività</th><th>Professore</th><th>Lab</th></tr></thead><tbody>';

  weekDates.forEach(dinfo => {
    hours.forEach(hour => {
      state.classi.forEach(classe => {
        const cell = state.risultato.filter(r => normalizeDateStr(r.giorno) === dinfo.dateStr && r.ora === hour && r.classe === classe.nome);
        if (!cell.length) return;
        cell.forEach(r => {
          html += `<tr><td>${dinfo.dateStr}</td><td>${hour}</td><td>${classe.nome}</td><td>${r.attivita || ''}</td><td>${r.professore || ''}</td><td>${r.laboratorio || ''}</td></tr>`;
        });
      });
    });
  });

  html += '</tbody></table></body></html>';

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 200);
}

// ====== UNLOCK ACTIVITY (sblocca assegnazioni bloccate) ====== //
function unlockPlanningActivity() {
  if (!planningSwapTarget) return alert('Nessuna attività selezionata da sbloccare.');

  const { giorno, ora, classe, attivita } = planningSwapTarget;
  let found = false;

  // debug info per la console (rimuovere in produzione se non serve)
  console.log('unlockPlanningActivity: target=', planningSwapTarget);
  console.log('unlockPlanningActivity: totale entries risultato=', state.risultato.length);

  state.risultato.forEach(r => {
    try {
      const rG = normalizeDateStr(r.giorno || '');
      const tG = normalizeDateStr(giorno || '');
      const rO = (r.ora || '').toString().trim();
      const tO = (ora || '').toString().trim();
      const rC = (r.classe || '').toString().trim();
      const tC = (classe || '').toString().trim();
      const rA = (r.attivita || '').toString().trim();
      const tA = (attivita || '').toString().trim();

      if (rG === tG && rO === tO && rC === tC && rA === tA) {
        if (r.locked) {
          r.locked = false;
          found = true;
          console.log('unlockPlanningActivity: sbloccata entry', r);
        } else {
          console.log('unlockPlanningActivity: entry trovata ma non era locked', r);
        }
      }
    } catch (err) {
      console.error('unlockPlanningActivity: errore confronto entry', err, r);
    }
  });

  if (!found) {
    // messaggio più informativo
    alert('Nessuna assegnazione bloccata trovata per questa attività. Controlla la console per dettagli diagnostici.');
    return;
  }

  persist();
  // rilancia l'algoritmo completo e aggiorna le viste
  run(true);
  if (typeof generatePlanningView === 'function') generatePlanningView();
  if (typeof generateLabPlanningView === 'function') generateLabPlanningView();

  showToast('Attività sbloccata e algoritmo ricalcolato.');
}
window.unlockPlanningActivity = unlockPlanningActivity;

// ====== EXPORT / PRINT: Matrice Professori × Attività ====== //
function exportMatrixCSV() {
  // assicurati che la matrice sia aggiornata
  updateMatrixOreDocente();
  const activities = matrixCache.activities || [];
  const rows = matrixCache.rows || [];

  if (!rows.length) return alert('Nessun dato da esportare');

  // header
  const header = ['Professore','MaxG','MaxW','SaldoG','SaldoW', ...activities];
  const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g,'""')}"`;

  const csvRows = [];
  csvRows.push(header.map(esc).join(','));

  rows.forEach(r => {
    const base = [r.nome, r.maxOreGiorno, r.maxOreSettimana, r.saldoG, r.saldoW];
    const activityVals = activities.map(a => r.ore[a] || 0);
    csvRows.push([...base, ...activityVals].map(esc).join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'matrice_professori_attivita.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function printMatrix() {
  updateMatrixOreDocente();
  const activities = matrixCache.activities || [];
  const rows = matrixCache.rows || [];
  if (!rows.length) return alert('Nessun dato da stampare');

  let html = '<html><head><title>Matrice Professori × Attività</title>';
  html += '<style>body{font-family:Arial,Helvetica,sans-serif;padding:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left}th{background:#f3f4f6}</style>';
  html += '</head><body>';
  html += '<h2>Matrice Professori × Attività</h2>';
  html += '<table><thead><tr>';
  html += `<th>Professore</th><th>MaxG</th><th>MaxW</th><th>SaldoG</th><th>SaldoW</th>`;
  activities.forEach(a => html += `<th>${a}</th>`);
  html += '</tr></thead><tbody>';

  rows.forEach(r => {
    html += '<tr>';
    html += `<td>${r.nome}</td><td>${r.maxOreGiorno}</td><td>${r.maxOreSettimana}</td><td>${r.saldoG}</td><td>${r.saldoW}</td>`;
    activities.forEach(a => html += `<td>${r.ore[a] || 0}</td>`);
    html += '</tr>';
  });

  html += '</tbody></table></body></html>';

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ====== INITIAL DOM adjustments ====== //
document.addEventListener('DOMContentLoaded', () => {
  // Ensure quick form is collapsed by default
  const card = document.getElementById('quickFormCard');
  if (card) card.classList.add('collapsed');

  // Attach delegated handlers in case tables existed earlier
  setTimeout(() => {
    ensurePlanningStickyLeft();
    attachPlanningActivityDelegation();
  }, 120);
});

// expose export/print
if (typeof exportMatrixCSV === 'function') window.exportMatrixCSV = exportMatrixCSV;
if (typeof printMatrix === 'function') window.printMatrix = printMatrix;
if (typeof exportPlanningCSV === 'function') window.exportPlanningCSV = exportPlanningCSV;