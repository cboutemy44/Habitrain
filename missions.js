/* ============================================================
   HABITRAIN — Missions (périodes + journalières)
   - Missions de PÉRIODE : objectifs de fond, durée variable.
   - Missions JOURNALIÈRES : tirées chaque jour, nombre variable
     selon le niveau de difficulté choisi.
   Expose window.HabitrainMissions.
   ============================================================ */
(function () {

  // ---------- MISSIONS DE PÉRIODE ----------
  // days : durée en jours ; check(ctx) : renvoie {done, progress, total}
  const PERIOD_MISSIONS = [
    { id:'p_start',    name:'Les premiers pas',        days:4,  desc:'Tenir 4 jours de suite en remplissant ton suivi.',
      kind:'streak', target:4 },
    { id:'p_clean7',   name:'Une semaine sans faute',  days:7,  desc:'7 jours consécutifs sans aucune entorse.',
      kind:'noBreachStreak', target:7 },
    { id:'p_night10',  name:'Dix nuits de lâcher-prise', days:14, desc:'10 nuits où ta couche est bien mouillée au réveil.',
      kind:'countResult', result:'reveil_mouille', target:10 },
    { id:'p_stage2',   name:'Que ça devienne naturel', days:21, desc:'Atteindre le palier « Automatisme ».',
      kind:'stage', target:2 },
    { id:'p_skin14',   name:'Peau impeccable',         days:14, desc:'14 jours avec une peau au vert.',
      kind:'countSkin', skin:'verte', target:14 },
    { id:'p_pillars30',name:'Le cadre tenu',           days:10, desc:'30 changes piliers validés dans les temps.',
      kind:'countResult', result:'change_fait', target:30 },
    { id:'p_stage3',   name:'Seconde nature',          days:30, desc:'Atteindre le palier ultime « Seconde nature ».',
      kind:'stage', target:3 },
    { id:'p_intense7', name:'À la dure',               days:7,  desc:'7 jours consécutifs en mode intensif.',
      kind:'hardStreak', target:7 },
    { id:'p_journal10',name:'Mes mots à moi',          days:14, desc:'Écrire 10 entrées dans ton carnet.',
      kind:'journal', target:10 },
    { id:'p_confid',   name:'Tout savoir de Foxy',     days:30, desc:'Récolter 15 confidences de Foxy.',
      kind:'confidences', target:15 }
  ];

  // ---------- MISSIONS JOURNALIÈRES ----------
  // check se fait sur les données du jour
  // 'cible' = critère du tableau de bord que la mission fait progresser
  const DAILY_MISSIONS = [
    { id:'d_bib',     name:'Bien s\'hydrater',      desc:'Boire tes 3 biberons.',            kind:'bib', target:3, cible:'hydra' },
    { id:'d_pillars', name:'Les trois piliers',     desc:'Faire tes 3 changes obligatoires.', kind:'pillars', target:3, cible:'ponct' },
    { id:'d_nobreach',name:'Journée sans faute',    desc:'Zéro entorse aujourd\'hui.',        kind:'nobreach', cible:'refl' },
    { id:'d_wet',     name:'Se laisser aller',      desc:'Au moins 3 couches mouillées.',     kind:'countResult', result:'etat_mouille', target:3, cible:'letgo' },
    { id:'d_nightwet',name:'Nuit relâchée',         desc:'Réveil avec une couche bien mouillée.', kind:'countResult', result:'reveil_mouille', target:1, cible:'letgo' },
    { id:'d_report',  name:'Le bilan du soir',      desc:'Remplir ton rapport du soir.',      kind:'report', cible:'reg' },
    { id:'d_journal', name:'Un mot pour Foxy',      desc:'Écrire une entrée dans ton carnet.', kind:'journalToday', target:1, cible:'reg' },
    { id:'d_skin',    name:'Peau au vert',          desc:'Terminer la journée avec une peau saine.', kind:'skinToday', skin:'verte', cible:'peau' },
    { id:'d_checks',  name:'Vigilance',             desc:'Faire au moins 5 checks.',          kind:'checks', target:5, cible:'refl' },
    { id:'d_talk',    name:'Prendre le temps',      desc:'Avoir une discussion avec Foxy.',   kind:'introspect', cible:null },
    { id:'d_nap',     name:'La vraie sieste',       desc:'Faire ta sieste de l\'après-midi.', kind:'nap', cible:null },
    { id:'d_scan',    name:'Preuve à l\'appui',     desc:'Valider un change par scan.',       kind:'scan', cible:'ponct' },
    { id:'d_ritual',  name:'Notre rituel',          desc:'Accepter le rituel du jour de Foxy.', kind:'ritual', cible:null },
    { id:'d_lock',    name:'Respecter le cadre',    desc:'Aucune ouverture de serrure en urgence.', kind:'nolockemg', cible:'refl' },
    // --- missions ciblées sur les critères récemment ajoutés ---
    { id:'d_hold',    name:'Tenir sans y penser',   desc:'Garder une couche au moins 3h avant de changer.', kind:'holdTime', target:3, cible:'port' },
    { id:'d_nocompul',name:'Pas de change compulsif', desc:'Aucun change avant 2h de port.',  kind:'noQuickChange', cible:'port' },
    { id:'d_spont',   name:'Relâcher vite',         desc:'Mouiller ta couche dans les 2h après un change.', kind:'quickWet', target:2, cible:'spont' },
    { id:'d_nowc',    name:'Aucun passage aux WC',  desc:'Toutes tes mictions dans la couche aujourd\'hui.', kind:'noDrySlot', cible:'letgo' },
    { id:'d_hydra4',  name:'Hydratation renforcée', desc:'Boire 4 biberons aujourd\'hui.',    kind:'bib', target:4, cible:'hydra' }
  ];

  // ---------- Niveaux de difficulté ----------
  const LEVELS = [
    { id:'doux',    label:'Doux',     count:1, desc:'1 mission par jour' },
    { id:'normal',  label:'Normal',   count:2, desc:'2 missions par jour' },
    { id:'soutenu', label:'Soutenu',  count:3, desc:'3 missions par jour' },
    { id:'intense', label:'Intense',  count:5, desc:'5 missions par jour' }
  ];

  async function getState() {
    try {
      const r = await window.storage.get('missions');
      if (r && r.value) return JSON.parse(r.value);
    } catch (e) {}
    return { level:'normal', activePeriod:null, doneP:[], dailyDate:null, daily:[], doneD:{}, history:[] };
  }
  async function saveState(st) {
    try { await window.storage.set('missions', JSON.stringify(st)); } catch (e) {}
  }

  function levelCount(id) {
    const l = LEVELS.find(x => x.id === id);
    return l ? l.count : 2;
  }

  // tire les missions du jour selon le niveau
  // Lit le diagnostic publié par le tableau de bord (points faibles du moment)
  async function getDiagnostic() {
    try {
      const r = await window.storage.get('diagnostic');
      if (r && r.value) return JSON.parse(r.value);
    } catch (e) {}
    return null;
  }

  async function ensureDaily(todayKey) {
    const st = await getState();
    if (st.dailyDate === todayKey && Array.isArray(st.daily) && st.daily.length) return st;
    const n = levelCount(st.level);
    const pool = DAILY_MISSIONS.slice();
    const picked = [];

    // --- Missions CIBLÉES sur tes points faibles (progression dirigée) ---
    // On en garantit une (deux si le niveau le permet), le reste reste aléatoire
    // pour conserver la variété.
    const diag = await getDiagnostic();
    if (diag && Array.isArray(diag.faibles) && diag.faibles.length) {
      const nbCiblees = Math.min(n <= 2 ? 1 : 2, diag.faibles.length);
      for (let i = 0; i < nbCiblees; i++) {
        const critere = diag.faibles[i];
        const candidates = pool.filter(m => m.cible === critere);
        if (candidates.length) {
          const choisi = candidates[Math.floor(Math.random()*candidates.length)];
          picked.push(choisi.id);
          const idx = pool.findIndex(m => m.id === choisi.id);
          if (idx >= 0) pool.splice(idx, 1);
        }
      }
    }

    // --- Le reste au hasard ---
    while (picked.length < n && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random()*pool.length), 1)[0].id);
    }
    st.dailyDate = todayKey;
    st.daily = picked;
    st.doneD = {};
    await saveState(st);
    return st;
  }

  // démarre une mission de période (la prochaine non faite, ou choisie)
  // Tire une mission de période AU HASARD parmi celles non accomplies.
  // (id n'est utilisé que par le debug ; l'usage normal est aléatoire)
  async function startPeriod(id) {
    const st = await getState();
    const pool = PERIOD_MISSIONS.filter(m => !st.doneP.includes(m.id));
    const m = id ? PERIOD_MISSIONS.find(x => x.id === id)
                 : (pool.length ? pool[Math.floor(Math.random()*pool.length)] : null);
    if (!m) return null;
    st.activePeriod = { id:m.id, start:new Date().toISOString(), days:m.days };
    await saveState(st);
    return m;
  }
  async function abandonPeriod() {
    const st = await getState();
    st.activePeriod = null;
    await saveState(st);
  }
  async function completePeriod(id) {
    const st = await getState();
    if (!st.doneP.includes(id)) st.doneP.push(id);
    st.history.push({ id, at:new Date().toISOString() });
    st.activePeriod = null;
    await saveState(st);
  }
  async function setLevel(id) {
    const st = await getState();
    st.level = id;
    st.dailyDate = null;  // re-tirage au prochain passage
    await saveState(st);
  }
  async function markDailyDone(id) {
    const st = await getState();
    st.doneD = st.doneD || {};
    st.doneD[id] = true;
    await saveState(st);
  }

  function periodById(id) { return PERIOD_MISSIONS.find(m => m.id === id) || null; }
  function dailyById(id) { return DAILY_MISSIONS.find(m => m.id === id) || null; }
  function daysLeft(active) {
    if (!active) return 0;
    const passed = (Date.now() - new Date(active.start).getTime()) / 86400000;
    return Math.max(0, Math.ceil(active.days - passed));
  }

  window.HabitrainMissions = {
    PERIOD_MISSIONS, DAILY_MISSIONS, LEVELS,
    getState, saveState, ensureDaily, startPeriod, abandonPeriod, completePeriod,
    setLevel, markDailyDone, periodById, dailyById, daysLeft, levelCount, getDiagnostic
  };
})();
