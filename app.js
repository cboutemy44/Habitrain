/* ---- Couche de stockage compatible navigateur ----
     Utilise localStorage (persiste dans Chrome/Safari quand le fichier est
     ouvert normalement). Repli en mémoire si localStorage est indisponible
     (navigation privée stricte, restrictions) pour éviter tout plantage. */
  const storage = (function() {
    const PREFIX = 'habitrain:';
    let mem = {};
    let ok = false;
    try {
      const t = '__t__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      ok = true;
    } catch(e) { ok = false; }

    return {
      persistent: ok,
      async get(key) {
        if (ok) {
          const v = window.localStorage.getItem(PREFIX + key);
          if (v === null) return null;
          return { key, value: v };
        }
        return (key in mem) ? { key, value: mem[key] } : null;
      },
      async set(key, value) {
        if (ok) { window.localStorage.setItem(PREFIX + key, value); }
        else { mem[key] = value; }
        return { key, value };
      },
      async delete(key) {
        if (ok) { window.localStorage.removeItem(PREFIX + key); }
        else { delete mem[key]; }
        return { key, deleted: true };
      },
      async list(prefix) {
        const p = prefix || '';
        const keys = [];
        if (ok) {
          for (let i = 0; i < window.localStorage.length; i++) {
            const full = window.localStorage.key(i);
            if (full && full.startsWith(PREFIX + p)) keys.push(full.slice(PREFIX.length));
          }
        } else {
          Object.keys(mem).forEach(k => { if (k.startsWith(p)) keys.push(k); });
        }
        return { keys, prefix: p };
      }
    };
  })();
  // Compatibilité : tout le code existant appelle window.storage.*
  window.storage = storage;

  const APP_VERSION = '13.0';
  (function(){ const b = document.getElementById('verBadge'); if (b) b.textContent = 'v' + APP_VERSION; })();
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('verBadge'); if (b) b.textContent = 'v' + APP_VERSION;
  });

  /* ---- Modes de voix : reporting / caregiver / foxy ---- */
  // mode: 'report' | 'care' | 'foxy'
  let voiceMode = 'report';
  const immersiveModes = ['foxy']; // caregiver retiré : on ne garde que Foxy
  let immersive = false;

  async function loadVoice() {
    try { const r = await window.storage.get('pref:voicemode'); if (r && r.value) voiceMode = JSON.parse(r.value); } catch(e) {}
    immersive = immersiveModes.includes(voiceMode);
    applyVoiceChrome();
    if (immersive) { try { await imRunMoment(); } catch(e) {} }
  }
  async function setVoiceMode(mode) {
    voiceMode = mode;
    immersive = immersiveModes.includes(mode);
    try { await window.storage.set('pref:voicemode', JSON.stringify(mode)); } catch(e) {}
    applyVoiceChrome();
    if (immersive) { try { await imRunMoment(); } catch(e) {} }
    else { try { await renderMoment(); } catch(e) {} try { await renderBreaches(); } catch(e) {} try { await showTab(currentTab); } catch(e) {} }
  }
  // ancienne API conservée
  async function setVoice(on) { await setVoiceMode(on ? 'care' : 'report'); }

  function v(reporting, immersif) { return immersive ? immersif : reporting; }

  // Personnage courant (caregiver ou foxy)
  function persona() {
    if (voiceMode === 'foxy') return {
      name:'Foxy', avatar:'🦊', status: (foxyMood && !broOn()) ? ('d\'humeur ' + mood().label + ' aujourd\'hui 🦊') : 'ton compagnon de voyage 🦊',
      grad:'linear-gradient(135deg,#f0a060,#d9743a)', headbg:'linear-gradient(180deg,#FDEFE2,#FBF3EA)',
      whoColor:'#a85a2a', statusColor:'#c8843a', bubble:'#FCEBDD', bubbleInk:'#7a4420',
      meGrad:'linear-gradient(135deg,#e08840,#c8703a)'
    };
    return {
      name:'Ton caregiver', avatar:'🧸', status:'présent · veille sur toi',
      grad:'linear-gradient(135deg,#b79ad6,#8f6fc0)', headbg:'linear-gradient(180deg,#F3ECF9,#F7F1FB)',
      whoColor:'#5a3d6b', statusColor:'#a07cc0', bubble:'#F1EAF8', bubbleInk:'#4a3358',
      meGrad:'linear-gradient(135deg,#8f6fc0,#7a5aa8)'
    };
  }

  /* ===== Moteur de conversation immersive ===== */
  const imThread = () => document.getElementById('imThread');
  const imActions = () => document.getElementById('imActions');

  // Expressions Foxy → index de cellule (grille 4×4, 0..15, lecture ligne par ligne)
  // Deux familles de sheets avec des ordres d'expressions DIFFÉRENTS (vérifié case par case).
  // Famille A : paw + diaper. Famille B : blue + blue2.
  // Mapping UNIQUE : les 4 planches partagent désormais le même ordre (vérifié visuellement).
  // 0 fier · 1 ronchon · 2 taquin · 3 nostalgique · 4 fatigué · 5 assurance · 6 réconfort
  // 7 curieux · 8 ému · 9 encourageant · 10 biberon · 11 tétine · 12 rassurant · 13 rigolard
  // 14 déçu doux · 15 endormi
  const EXPR = {
    proud:0,        // fier — enfin distinct de la joie !
    grumpy:1,       // ronchon (humeur du jour)
    playful:2,      // taquin (humeur du jour)
    wistful:3,      // nostalgique (humeur du jour)
    sleepy:4,       // fatigué éveillé (humeur du jour)
    calm:5,         // assurance tranquille — le registre grand frère
    comfort:6,      // réconfort, bras ouverts
    curious:7,      // curieux / attentif
    moved:8,        // ému, touché
    cheer:9,        // encourageant
    bottle:10,      // avec biberon
    paci:11,        // avec tétine
    reassure:12,    // rassurant, main tendue
    laugh:13,       // rigolard
    sad:14,         // déçu doux
    sleep:15,       // endormi profond

    // --- alias de compatibilité avec le code existant ---
    happy:0,        // content → fier/heureux
    joy:13,         // joie → rigolard
    concern:14,     // inquiétude → déçu doux
    pensive:3,      // pensif → nostalgique
    surprised:7,    // surpris → curieux
    neutral:5,      // neutre → assurance tranquille
    relaxed:4,      // détendu → fatigué/relax
    wave:12,        // coucou → main tendue
    cuddle:6,       // câlin → bras ouverts
    explain:9,      // explique → encourageant
    teach:9         // enseigne → encourageant
  };
  // ===== SÉRIE v3 — variantes (ordre unique, vérifié) =====
  // 0 content doux · 1 content yeux fermés · 2 content timide · 3 pensif menton
  // 4 pensif en l'air · 5 perplexe · 6 soucieux · 7 inquiet · 8 alerté · 9 profil
  // 10 allongé · 11 tailleur · 12 sautille · 13 frotte les yeux · 14 applaudit · 15 hausse épaules
  const EXPR_V3 = {
    happy:0, gentle:0, blissful:1, shy:2, pensive:3, thinking:3, wondering:4,
    puzzled:5, curious:5, worried:6, concern:7, alarmed:8, surprised:8,
    profile:9, lying:10, crosslegged:11, hop:12, joy:12, cheer:12,
    rubeyes:13, sleepy:13, clap:14, proud:14, laugh:12, shrug:15,
    // alias pour couvrir tout le code existant
    calm:0, comfort:15, reassure:15, moved:2, wistful:4, grumpy:6, playful:2,
    sad:6, sleep:13, bottle:10, paci:11, explain:4, teach:4,
    cuddle:10, neutral:0, relaxed:10, wave:15
  };

  // ===== ANCIENNES PLANCHES (série v1) — deux ordres distincts =====
  // Famille X : paw-v1 + diaper-v1
  const EXPR_V1_X = {
    happy:0, proud:0, sad:1, concern:1, wistful:2, pensive:2, curious:3, surprised:3,
    paci:4, walk:5, sit:6, relaxed:7, sleepy:7, crouch:8, wave:9, reassure:9,
    cuddle:10, comfort:10, roll:11, playful:11, laugh:12, cheer:13, moved:13,
    explain:14, teach:14, calm:14, sleep:15, grumpy:1, bottle:4, paci2:4,
    joy:12, neutral:6
  };
  // Famille Y : blue-v1 + blue2-v1
  const EXPR_V1_Y = {
    happy:0, proud:0, sad:1, concern:1, wistful:2, pensive:2, curious:3, surprised:3,
    run:4, laugh:4, cheer:4, paci:5, playful:5, cry:6, grumpy:6, blocks:7, calm:7,
    eat:8, bottle:8, sulk:9, moved:9, scared:10, fist:11, reassure:11, wave:11,
    sneeze:12, sleep:13, sleepy:13, explain:14, teach:14, comfort:14, cuddle:14, yawn:15, relaxed:15,
    joy:4, neutral:0
  };
  const V1_FAMILY = { paw:'X', diaper:'X', blue:'Y', blue2:'Y' };

  // Série active pour la journée : 'v2' (nouvelles) ou 'v1' (anciennes)
  let foxySerie = 'v2';
  async function loadFoxySerie() {
    const date = todayStr();
    try {
      const r = await window.storage.get('foxyserie:'+date);
      if (r && r.value) { foxySerie = JSON.parse(r.value); return; }
    } catch(e) {}
    foxySerie = ['v1','v2','v3'][Math.floor(Math.random()*3)];
    try { await window.storage.set('foxyserie:'+date, JSON.stringify(foxySerie)); } catch(e) {}
  }
  // feuille réellement utilisée selon la série du jour
  function activeSheet() {
    if (foxySerie === 'v1') return foxyOutfit.sheet.replace('.png', '-v1.png');
    if (foxySerie === 'v3') return foxyOutfit.sheet.replace('.png', '-v3.png');
    return foxyOutfit.sheet;
  }
  function exprMap() {
    if (foxySerie === 'v3') return EXPR_V3;
    if (foxySerie === 'v1') {
      return V1_FAMILY[foxyOutfit.id] === 'Y' ? EXPR_V1_Y : EXPR_V1_X;
    }
    return EXPR;
  }

  // Tenues de Foxy, chacune rattachée à sa famille d'expressions
  const FOXY_OUTFITS = [
    { id:'paw',    sheet:'foxy-paw.png',    name:'grenouillère à pattes' },
    { id:'diaper', sheet:'foxy-diaper.png', name:'couche' },
    { id:'blue',   sheet:'foxy-blue.png',   name:'grenouillère bleue' },
    { id:'blue2',  sheet:'foxy-blue2.png',  name:'pyjama bleu' }
  ];
  let foxyOutfit = FOXY_OUTFITS[0];
  async function loadFoxyOutfit() {
    const date = todayStr();
    try {
      const r = await window.storage.get('foxyfit:'+date);
      if (r && r.value) { const id = JSON.parse(r.value); const f = FOXY_OUTFITS.find(o=>o.id===id); if (f) { foxyOutfit = f; return; } }
    } catch(e) {}
    foxyOutfit = FOXY_OUTFITS[Math.floor(Math.random()*FOXY_OUTFITS.length)];
    try { await window.storage.set('foxyfit:'+date, JSON.stringify(foxyOutfit.id)); } catch(e) {}
  }
  function afterOutfitSet() { try { refreshHeadFoxy(); } catch(e) {} }

  const EXPR_SETS = {
    positive:['proud','cheer','laugh'],
    calm:['calm','reassure'],
    tender:['comfort','moved','reassure'],
    worried:['sad','curious'],
    think:['wistful','curious','calm'],
    teach:['cheer','calm'],
    sleepy:['sleep','sleepy'],
    fun:['laugh','playful','cheer']
  };
  function pickExpr(set) {
    const arr = EXPR_SETS[set] || ['neutral'];
    return arr[Math.floor(Math.random()*arr.length)];
  }
  let pendingExpr = 'neutral';

  function setFoxyPortrait(expr) {
    const p = document.getElementById('rpgPortrait');
    if (!p) return;
    p.style.backgroundImage = "url('" + activeSheet() + "')";
    const map = exprMap();
    const idx = (expr in map) ? map[expr] : map.neutral;
    const col = idx % 4, row = Math.floor(idx / 4);
    const size = 132;
    p.style.backgroundPosition = (-(col*size)) + 'px ' + (-(row*size)) + 'px';
  }

  // positionne une cellule de la sheet du jour sur n'importe quel élément
  function positionFoxyCell(el, expr, sizePx) {
    if (!el) return;
    const map = exprMap();
    const idx = (expr in map) ? map[expr] : map.neutral;
    const col = idx % 4, row = Math.floor(idx / 4);
    el.style.backgroundImage = "url('" + activeSheet() + "')";
    el.style.backgroundSize = (sizePx*4) + 'px ' + (sizePx*4) + 'px';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = (-(col*sizePx)) + 'px ' + (-(row*sizePx)) + 'px';
  }
  // rafraîchit le portrait du titre (tenue du jour)
  function refreshHeadFoxy() {
    const el = document.getElementById('headFoxy');
    if (el) positionFoxyCell(el, 'happy', 56);
  }

  // ---- Sheet "scènes de change" (ordre propre, indépendant des expressions) ----
  const CHANGE_CELLS = { prep:0, remove:1, place:8, front:6, tabLow:7, tabHigh:6, tabRight:7, done:14 };
  function positionChangeCell(el, idx, sizePx) {
    if (!el) return;
    const col = idx % 4, row = Math.floor(idx / 4);
    el.style.backgroundImage = "url('foxy-changescene.png')";
    el.style.backgroundSize = (sizePx*4) + 'px ' + (sizePx*4) + 'px';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = (-(col*sizePx)) + 'px ' + (-(row*sizePx)) + 'px';
  }

  // Change guidé « Foxy se met sa couche » — guide des 4 languettes (8 étapes)
  const CHANGE_STEPS = [
    { cell:'prep',    t:'D\'abord, déplie les 4 languettes en éventail. Vérifie qu\'aucune n\'est collée par accident — une languette mal dépliée, et la couche fait des plis.' },
    { cell:'remove',  t:'Défais les languettes de l\'ancienne couche, retire-la et enlève ta grenouillère. Roule la couche usagée et jette-la à la poubelle.' },
    { cell:'place',   t:'Allonge-toi sur le dos, soulève le bassin et glisse la couche fraîche sous tes fesses. Centre bien la partie arrière — si elle est trop basse, ça fuira derrière.' },
    { cell:'front',   t:'Remonte le devant jusqu\'à ce que la ceinture soit juste sous le nombril. Assure-toi que les bords sont bien symétriques des deux côtés.' },
    { cell:'tabLow',  t:'Languette inférieure gauche : tire-la vers le bas et vers l\'extérieur (environ 45°), puis colle-la fermement sur le devant. C\'est elle qui tient autour des cuisses.' },
    { cell:'tabHigh', t:'Languette supérieure gauche : tire-la vers le haut et vers l\'extérieur (environ 30°). C\'est elle qui ajuste la taille. Laisse environ 2 doigts d\'espace entre les deux languettes.' },
    { cell:'tabRight',t:'Maintenant l\'autre côté : d\'abord la languette basse, puis la haute. Vérifie que les deux côtés sont bien symétriques — si une languette est plus haute que l\'autre, la couche part de travers.' },
    { cell:'done',    t:'Vérifie qu\'un doigt passe à la taille et que les élastiques épousent les cuisses sans serrer. Puis remets ta grenouillère propre. Et voilà... parfait ! 🦊✨' }
  ];

  // typewriter simple pour la ligne de pose
  let poseTypeTimer = null;
  function typeLine(el, text, done) {
    if (!el) { if (done) done(); return; }
    if (poseTypeTimer) clearInterval(poseTypeTimer);
    el.textContent = ''; let i = 0;
    poseTypeTimer = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(poseTypeTimer); poseTypeTimer = null; if (done) done(); }
    }, 18);
  }
  function poseType(text, done) { typeLine(document.getElementById('poseLine'), text, done); }

  // affiche la vignette de l'étape depuis la planche guide-steps.png (4×2, cellule 320)
  function positionGuideStep(el, stepIdx) {
    if (!el) return;
    const col = stepIdx % 4, row = Math.floor(stepIdx / 4);
    el.style.backgroundImage = "url('guide-steps.png')";
    el.style.backgroundSize = '400% 200%'; // 4 colonnes, 2 lignes
    el.style.backgroundPosition = (col * (100/3)) + '% ' + (row * 100) + '%';
  }

  let changeModel = null;   // modèle de couche annoncé pour le change en cours

  // choisit et annonce le modèle à utiliser, selon le moment
  async function pickChangeModel() {
    changeModel = null;
    try {
      if (!window.HabitrainWardrobe) return null;
      const h = new Date().getHours();
      const period = (h >= 22 || h < 8) ? 'nuit' : 'jour';
      const dispo = (await window.HabitrainWardrobe.modelsFor(period)).filter(m => m.qty > 0);
      if (!dispo.length) {
        const tous = await window.HabitrainWardrobe.getStock();
        const reste = tous.filter(m => m.qty > 0);
        changeModel = reste.length ? reste[0] : null;
        return changeModel ? { model:changeModel, horsPeriode:true, period } : { vide:true, period };
      }
      changeModel = dispo[0];
      return { model:changeModel, period };
    } catch(e) { return null; }
  }

  function runChangeStep(i) {
    const step = CHANGE_STEPS[i];
    const last = i === CHANGE_STEPS.length - 1;
    positionGuideStep(document.getElementById('poseGuide'), i);
    document.getElementById('poseStepNum').textContent = 'Étape ' + (i+1) + ' / ' + CHANGE_STEPS.length;
    const acts = document.getElementById('poseActs');
    acts.innerHTML = '';
    // à la première étape, on annonce quel modèle prendre
    if (i === 0) {
      pickChangeModel().then(info => {
        const line = document.getElementById('poseLine');
        if (!info || !line) return;
        let msg = '';
        if (info.vide) {
          msg = '⚠️ Plus aucune couche en stock ! Prends ce que tu as et pense à recommander.';
        } else if (info.horsPeriode) {
          msg = '⚠️ Plus de modèle « ' + info.period + ' » : prends une ' + info.model.name + ' (' + info.model.qty + ' restantes).';
        } else {
          msg = '🍼 Prends une ' + info.model.name + ' (' + info.model.qty + ' de ce modèle).';
        }
        const tag = document.createElement('div');
        tag.style.cssText = 'font-size:12.5px;font-weight:800;color:#a85a2a;background:#FBF3E0;border:1px solid #ecd9a8;border-radius:10px;padding:8px 10px;margin-bottom:10px';
        tag.textContent = msg;
        line.parentNode.insertBefore(tag, line);
      });
    }
    poseType(step.t, () => {
      const b = document.createElement('button');
      b.className = 'ok';
      b.textContent = last ? '🐾 Couche fraîche posée !' : 'Fait ! On continue';
      b.addEventListener('click', async () => {
        if (last) { await finishChange(); }
        else { runChangeStep(i+1); }
      });
      acts.appendChild(b);
    });
  }

  // pilier dont la fenêtre couvre l'heure actuelle (pour compter un change manuel)
  function pillarSlotForNow() {
    const PILIERS = [ { key:'c0900', m:9*60 }, { key:'c1600', m:16*60 }, { key:'c2230', m:22*60+30 } ];
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    // fenêtre : de 30 min avant à 2h après l'heure du pilier
    return PILIERS.find(p => nowMin >= p.m - 30 && nowMin <= p.m + 120) || null;
  }

  async function markSlotDoneKey(key) {
    if (!key) return;
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      done[key] = true;
      await window.storage.set('slotdone:'+todayStr(), JSON.stringify(done));
    } catch(e) {}
  }

  async function finishChange() {
    // ce change requiert-il une preuve par scan ?
    let needScan = false;
    try {
      const QR = window.HabitrainQR;
      if (QR) {
        const isPilier = (changeCtx === 'pilier') || !!pillarSlotForNow();
        needScan = await QR.actionRequiresScan(isPilier ? 'change_pilier' : 'change_tous');
      }
    } catch(e) {}
    if (needScan) {
      // propose le scan ; secours = valider sans preuve
      const proceed = (proof) => { finalizeChange(proof); };
      showProofPrompt('change', proceed);
      return;
    }
    await finalizeChange(true /* pas de scan requis = considéré validé */);
  }
  async function finalizeChange(proof) {
    await saveCheck(proof ? 'change_fait' : 'change_fait_sanspreuve', 'change_'+(changeCtx||'check'));
    let slotKey = activeSlotKey;
    if (!slotKey) { const p = pillarSlotForNow(); if (p) slotKey = p.key; }
    await markSlotDoneKey(slotKey);
    activeSlotKey = null;
    closeCheck();
    try { await renderCheckStat(); } catch(e) {}
    try { await renderSince(); } catch(e) {}
  }
  // petite invite : scanner pour valider, ou valider sans preuve
  function showProofPrompt(kind, done) {
    const QR = window.HabitrainQR;
    const expected = kind === 'change' ? 'change_pilier' : kind;
    const btns = [
      { label:'📷 Scanner', onClick:() => {
        foxyPopHide();
        QR.startScan(null, (k) => {
          if (k === 'change_pilier' || k === 'change_tous') { done(true); }
          else { foxyPopShow(hardMode ? 'Non, c\'est pas le bon QR. En mode intensif, pas de raccourci : rescanne le vrai. 🦊' : 'Hmm, c\'est pas le bon QR ça ! Réessaie ou valide sans preuve.', 'pensive', proofButtons(kind, done)); }
        });
      }}
    ];
    if (!hardMode) btns.push({ soft:true, label:'Valider sans preuve', onClick:() => { foxyPopHide(); done(false); } });
    foxyPopShow(hardMode ? 'Mode intensif : scan OBLIGATOIRE pour valider. Pas de preuve, pas de validation. Allez ! 🦊' : 'Scanne ton QR pour valider — c\'est ta preuve que tu l\'as bien fait ! 🦊', hardMode?'proud':'joy', btns);
  }
  function proofButtons(kind, done) {
    const QR = window.HabitrainQR;
    const btns = [
      { label:'📷 Rescanner', onClick:() => { foxyPopHide(); QR.startScan(null, (k) => { if (k) done(true); else if (!hardMode) done(false); else foxyPopShow('Toujours pas bon. On ne lâche pas : rescanne. 🦊','pensive', proofButtons(kind,done)); }); } }
    ];
    if (!hardMode) btns.push({ soft:true, label:'Valider sans preuve', onClick:() => { foxyPopHide(); done(false); } });
    return btns;
  }
  // fabrique un dataURL d'une cellule (pour l'icône de notification)
  function foxyCellDataURL(expr, size) {
    size = size || 192;
    return new Promise(resolve => {
      const map = exprMap();
      const idx = (expr in map) ? map[expr] : map.neutral;
      const col = idx % 4, row = Math.floor(idx / 4);
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, col*256, row*256, 256, 256, 0, 0, size, size);
          resolve(cv.toDataURL('image/png'));
        } catch(e) { resolve('icon-192.png'); }
      };
      img.onerror = () => resolve('icon-192.png');
      img.src = activeSheet();
    });
  }

  function imClear() {
    imThread().innerHTML = ''; imActions().innerHTML = ''; document.getElementById('imSafety').style.display='none';
    const rt = document.getElementById('rpgText'); if (rt) rt.textContent='';
    const rn = document.getElementById('rpgNext'); if (rn) rn.style.visibility='hidden';
  }
  function imScroll() { const t = imThread(); t.scrollTop = t.scrollHeight; }

  function imAddMe(text) {
    if (voiceMode === 'foxy') {
      // en RPG, la réponse du joueur s'affiche brièvement dans la boîte
      const rt = document.getElementById('rpgText');
      if (rt) { rt.innerHTML = '<span style="color:#a86a3a">› ' + text + '</span>'; }
      return;
    }
    const d = document.createElement('div'); d.className = 'im-msg me'; d.textContent = text;
    imThread().appendChild(d); imScroll();
  }

  // dit un message ; en mode Foxy → boîte RPG. waitTap=true → attend un appui (narration).
  function imSay(text, delay, expr, waitTap) {
    // en mode Foxy, on attend l'appui par défaut (sauf si waitTap explicitement false)
    if (voiceMode === 'foxy') return rpgSay(text, expr, waitTap === undefined ? true : waitTap);
    return new Promise(resolve => {
      const typing = document.createElement('div');
      typing.className = 'im-typing'; typing.innerHTML = '<span></span><span></span><span></span>';
      imThread().appendChild(typing); imScroll();
      setTimeout(() => {
        typing.remove();
        const d = document.createElement('div'); d.className = 'im-msg care'; d.innerHTML = text;
        imThread().appendChild(d); imScroll();
        resolve();
      }, delay || 800);
    });
  }

  // effet machine à écrire dans la boîte RPG
  // waitTap=true : attend un appui pour continuer (narration). Sinon : avance seul après le texte.
  let rpgAdvance = null;
  let currentM = null; // moment courant, pour restaurer les boutons après un message libre
  function rpgSay(text, expr, waitTap) {
    return new Promise(resolve => {
      setFoxyPortrait(expr || pendingExpr || 'neutral');
      const rt = document.getElementById('rpgText');
      const rn = document.getElementById('rpgNext');
      if (!rt) { resolve(); return; }
      rn.style.visibility = 'hidden';
      rt.textContent = '';
      const plain = text.replace(/<[^>]+>/g,'');
      let i = 0, typing = true, resolved = false;
      const speed = 20;
      const finishTyping = () => { clearInterval(timer); rt.textContent = plain; typing = false; rn.style.visibility = waitTap ? 'visible' : 'hidden'; };
      const timer = setInterval(() => {
        rt.textContent = plain.slice(0, ++i);
        if (i >= plain.length) {
          finishTyping();
          if (!waitTap) { // avance toute seule après une courte pause
            setTimeout(() => { if (!resolved) { resolved = true; if (rpgAdvance === myAdvance) rpgAdvance = null; resolve(); } }, 550);
          }
        }
      }, speed);
      // l'appui : complète le texte, puis (si waitTap) avance
      const myAdvance = () => {
        if (typing) { finishTyping(); if (!waitTap && !resolved) { resolved = true; if (rpgAdvance === myAdvance) rpgAdvance = null; resolve(); } }
        else if (waitTap && !resolved) { resolved = true; if (rpgAdvance === myAdvance) rpgAdvance = null; resolve(); }
      };
      rpgAdvance = myAdvance;
    });
  }
  async function imSaySeq(lines) { for (const l of lines) { await imSay(l, 0, null, true); } }

  function imSetActions(buttons) {
    const box = imActions(); box.innerHTML = '';
    // bouton safeword toujours dispo en mode grand frère
    if (broOn()) {
      const sw = document.createElement('button');
      sw.className = 'soft';
      sw.style.cssText = 'border-color:#c86b6b;color:#a83b3b;font-weight:800';
      sw.textContent = '🛑 Stop Foxy (safeword)';
      sw.addEventListener('click', () => triggerSafeword());
      box.appendChild(sw);
    }
    buttons.forEach(b => {
      const btn = document.createElement('button');
      if (b.soft) btn.className = 'soft';
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick());
      box.appendChild(btn);
    });
  }
  function imSafety(text) {
    const s = document.getElementById('imSafety');
    if (!text) { s.style.display='none'; return; }
    s.style.display=''; s.innerHTML = '⚠️ ' + text;
  }

  // Réactions du caregiver selon la réponse (résultat)
  // Pools de 10 réactions par résultat et par persona (déjà liés à la période via le résultat).
  const REACT_POOLS = {
    care: {
      reveil_sec: [
        'Encore au sec ce matin ? C\'est que tu t\'es retenu cette nuit, sans le vouloir. L\'idée, c\'est justement d\'apprendre à ne plus le faire. Doucement, ça viendra.',
        'Sèche au réveil... ton corps garde encore le contrôle la nuit. C\'est normal au début. On cherche à relâcher ça, pas à rester propre. Sois patient avec toi.',
        'Tu es resté sec ? Le réflexe de retenue est encore là. Pas de souci — c\'est justement ce qu\'on apprend à lâcher. La nuit, laisse-toi aller, tu es en sécurité.',
        'Encore sec ce matin. Ce n\'est pas un échec, mais rappelle-toi : le but n\'est pas de te retenir, c\'est de te laisser aller en confiance. On y arrivera.',
        'Sèche cette nuit... c\'est que tu te retiens encore un peu. C\'est le plus dur à lâcher, la nuit. Prends ton temps, il n\'y a rien à réussir, juste à relâcher.',
        'Au sec au réveil ? Ton corps s\'accroche encore au contrôle. C\'est humain et c\'est le début. L\'habituation, c\'est apprendre à ne plus y penser. Doucement.'
      ],
      reveil_mouille: [
        'Une bonne couche mouillée, c\'est parfait — c\'est exactement ce qu\'on veut ! Tu t\'es laissé aller cette nuit, c\'est ça le vrai progrès.',
        'Bien mouillée, très bien ! Ça veut dire que tu as relâché le contrôle en dormant. C\'est le signe que l\'habituation s\'installe.',
        'C\'est parfait ça ! Une couche pleine le matin, c\'est ton corps qui a enfin lâché prise. On te changera tranquillement.',
        'Une nuit bien remplie, c\'est exactement le but ! Tu ne t\'es pas retenu, tu t\'es laissé aller. Je suis content pour toi.',
        'Voilà, c\'est exactement ça. Tu as bien lâché prise cette nuit — c\'est le cœur de l\'habituation.',
        'Parfait. Garde-la encore un peu, on fera ton grand change à 9h. Belle nuit de lâcher-prise !',
        'Bien mouillée au réveil, c\'est signe que tu es vraiment dans le truc, que tu te laisses aller. Bravo.',
        'C\'est très bien, mon grand. Tu as arrêté de te retenir cette nuit, c\'est le progrès qu\'on cherche.',
        'Au contraire, c\'est excellent : ta couche a bien absorbé parce que tu as relâché le contrôle. C\'est ça, l\'habituation.',
        'Une belle nuit de sommeil et une couche bien pleine — tu t\'es abandonné à la nuit. Tout va bien, c\'est parfait.'
      ],
      reveil_fuite: [
        'Une petite fuite ? Ce n\'est rien du tout, on ajustera mieux ce soir.',
        'Ça arrive, ne t\'inquiète pas. On regardera les barrières aux cuisses ce soir.',
        'Pas de souci pour la fuite. On va juste mieux te border la prochaine fois.',
        'Ce n\'est pas grave du tout. Ces choses-là s\'ajustent facilement.',
        'Une fuite, ça se règle. Ce soir on fera plus attention à la pose, ensemble.',
        'Ne culpabilise pas, ça n\'a rien à voir avec toi. C\'est juste un réglage.',
        'On va changer tout ça et repartir propre. Rien de grave, promis.',
        'Une petite fuite nocturne, ça arrive à tout le monde. On s\'en occupe.',
        'Pas d\'inquiétude. Ce soir je vérifie que tout est bien ajusté pour toi.',
        'C\'est rien. On te change, et on améliorera le calage cette nuit.'
      ],
      matin_ok: [
        'Tu es sage. Couche vérifiée et bien hydraté, je suis fier de toi.',
        'Parfait, tout est en ordre ce matin. Continue comme ça.',
        'Couche ok et biberon bu, tu gères ta matinée comme un chef.',
        'Très bien. Tu prends soin de toi ce matin, ça me fait plaisir.',
        'C\'est nickel. Profite bien de ta matinée maintenant.',
        'Bravo, tout est au point. Tu es bien lancé pour la journée.',
        'Impeccable. Tu as pensé à tout ce matin.',
        'Voilà, c\'est ça que j\'aime voir. Une belle matinée bien gérée.',
        'Tout roule ce matin. Tu peux vaquer tranquille, je veille.',
        'Bien joué. Hydraté et au propre, tu as tout bon.'
      ],
      matin_change: [
        'D\'accord, on va s\'occuper de te changer alors. Viens.',
        'Pas de souci, on te change tout de suite. Installe-toi.',
        'C\'est le moment alors. Allonge-toi, je te guide.',
        'On s\'occupe de ça maintenant. Tu vas être tout propre.',
        'Très bien, on fait un change. Prends ton temps.',
        'Allez, on te met une couche fraîche pour la matinée.',
        'Bien vu de le signaler. On te change et c\'est reparti.',
        'On y va tranquillement, tu seras bien au sec après.',
        'C\'est parti pour un petit change du matin. Détends-toi.',
        'Parfait, on te remet au propre. Suis les étapes avec moi.'
      ],
      matin_soif: [
        'Il faut boire, c\'est important. Prends ton biberon pour moi, d\'accord ?',
        'Allez, un bon biberon d\'eau. Tu en as besoin pour bien commencer.',
        'On n\'oublie pas de s\'hydrater le matin. Va chercher ton biberon.',
        'C\'est le moment de boire. Fais-le pour moi, ça me rassure.',
        'Ton corps a soif après la nuit. Un bon biberon et ça repart.',
        'Bois bien ce matin, c\'est ce qui te garde en forme toute la journée.',
        'Prends le temps de boire, il n\'y a rien de plus important là.',
        'Un biberon d\'eau maintenant, et tu seras parfaitement hydraté.',
        'On rattrape ça tout de suite. Ton biberon, et je suis content.',
        'L\'hydratation d\'abord, mon grand. Va boire tranquillement.'
      ],
      aprem_ok: [
        'Tout roule, c\'est parfait. Continue comme ça.',
        'Bel après-midi bien géré. Tu es sur ta lancée.',
        'Nickel, rien à signaler. Tu tiens bien ton rythme.',
        'C\'est très bien. Ton après-midi se passe tranquillement.',
        'Parfait. Tu gères ta journée avec beaucoup de soin.',
        'Impeccable. Profite de ton après-midi, je veille.',
        'Tout est en ordre. Tu peux être content de toi.',
        'Voilà, c\'est ça. Une belle journée qui suit son cours.',
        'Bien joué. Ton après-midi est aussi carré que ta matinée.',
        'Rien à redire, tout va bien. Continue doucement.'
      ],
      aprem_sieste: [
        'Tu as bien dormi ? Une petite sieste, ça fait du bien. On vérifie ta couche ?',
        'Bien reposé après ta sieste ? On regarde ta couche au réveil.',
        'La sieste c\'est important, je suis content que tu l\'aies faite.',
        'Tu t\'es bien reposé, parfait. Un petit check maintenant ?',
        'Une bonne sieste dans ton cocon, rien de mieux. Comment tu te sens ?',
        'Voilà qui fait du bien. On vérifie que tout va bien après le repos ?',
        'Le repos fait partie du programme, tu as bien fait. On checke ?',
        'Bien dormi ? Ton corps en avait besoin. On regarde ta couche ensemble.',
        'Parfait, une sieste réparatrice. Maintenant un petit contrôle tranquille.',
        'Content que tu te sois reposé. Un check au réveil et on repart.'
      ],
      aprem_change: [
        'Ta couche a bien travaillé, on va la changer. Allonge-toi.',
        'C\'est le moment d\'un change. Installe-toi, je te guide.',
        'On te remet au propre pour la fin de journée. Viens.',
        'Bien vu. On te change tranquillement maintenant.',
        'Allez, une couche fraîche pour l\'après-midi. Détends-toi.',
        'On s\'occupe de ça. Tu seras tout confortable après.',
        'Parfait, on fait un change. Prends ton temps, rien ne presse.',
        'Ta couche a bien absorbé, on la change. Suis-moi.',
        'C\'est parti pour te remettre au sec. Allonge-toi bien.',
        'On te change et tu repars propre pour la soirée qui vient.'
      ],
      soir_ok: [
        'Ta nuit est prête, tu es tout propre et au sec. Bravo pour cette journée.',
        'Voilà, tout est en ordre pour la nuit. Belle journée accomplie.',
        'Tu es paré pour dormir, bien au chaud et au sec. Je suis fier de toi.',
        'Change de nuit fait, tout est nickel. Repose-toi bien maintenant.',
        'Parfait. Tu as tenu ta journée du début à la fin. Bravo mon grand.',
        'Tout est prêt pour une bonne nuit. Tu peux être content de toi.',
        'Belle journée, bien bouclée. Maintenant place au repos.',
        'Tu es tout propre pour la nuit. Une journée de plus de réussie.',
        'Voilà une journée complète. Dors bien, tu l\'as mérité.',
        'Nickel, prêt pour la nuit. Je veille pendant que tu dors.'
      ],
      soir_souci: [
        'Montre-moi ta peau... on va bien crémer pour que ça aille mieux.',
        'On va s\'occuper de ta peau ce soir. Une bonne couche de crème et ça ira.',
        'Ne t\'inquiète pas, on soigne ça tout de suite. Crème généreuse ce soir.',
        'Un peu de rougeur ? On traite maintenant, avant que ça s\'installe.',
        'On prend soin de ta peau, c\'est le plus important. Laisse-moi faire.',
        'Bien que tu me le dises. On crème comme il faut et demain c\'est mieux.',
        'Ta peau a besoin d\'un peu d\'attention ce soir. On s\'en occupe ensemble.',
        'On va bien te protéger pour la nuit. Crème épaisse et couche fraîche.',
        'Rien de grave, mais on ne laisse pas traîner. Soin ce soir.',
        'Je m\'occupe de ta peau. Demain matin ça ira déjà beaucoup mieux.'
      ],
      nuit_ok: [
        'Chut... tout va bien. Rendors-toi, je veille.',
        'Tout est calme, tu peux te rendormir. Je suis là.',
        'Rien à signaler, mon grand. Referme les yeux, je veille sur toi.',
        'Tu es en sécurité, tout va bien. Rendors-toi doucement.',
        'C\'est bon, tout est en ordre. Retourne dans tes rêves.',
        'Chut, repose-toi. La nuit t\'appartient, je monte la garde.',
        'Tout va bien cette nuit. Rendors-toi bien au chaud.',
        'Rien ne presse, tout est calme. Dors, je suis là.',
        'Ferme les yeux, tu es bien. À demain matin.',
        'Doucement, rendors-toi. Je veille jusqu\'au matin.'
      ],
      nuit_change: [
        'Voilà, une couche toute fraîche. Rendors-toi bien maintenant.',
        'C\'est fait, tu es tout propre. Retourne vite au lit.',
        'Change nocturne terminé. Rendors-toi, je veille sur le reste.',
        'Te voilà au sec pour finir la nuit. Dors bien.',
        'Parfait, couche fraîche posée. Referme les yeux tranquille.',
        'On t\'a remis au propre. Bonne fin de nuit, mon grand.',
        'C\'est réglé, tu es confortable. Rendors-toi doucement.',
        'Voilà, tout propre. La nuit peut reprendre, je veille.',
        'Change fait dans le calme. Retourne dormir, tout va bien.',
        'Te revoilà au sec. Dors bien jusqu\'au matin.'
      ]
    },
    foxy: {
      reveil_sec: [
        'Encore sèche au réveil ? Hmm, c\'est que tu t\'es retenu cette nuit. C\'est pas grave, mais l\'idée c\'est de te laisser aller, tu sais. Ça viendra en douceur.',
        'Sèche ce matin... T\'as dû te retenir sans t\'en rendre compte. On cherche pas la propreté ici — au contraire, on apprend à lâcher prise. Ça s\'apprend, t\'inquiète.',
        'Ah, encore au sec. C\'est normal au début, le corps résiste. Mais le but c\'est justement de ne plus se retenir. Laisse-toi aller, y\'a que toi et moi.',
        'Sèche la nuit, ça veut dire que le réflexe de retenue est encore là. Pas de souci, c\'est le début. On va apprendre à relâcher tout ça ensemble, tranquille.',
        'Tu vois, moi au début aussi je me retenais la nuit sans faire exprès. C\'est le plus dur à lâcher. Mais quand tu y arrives, quelle libération ! Ça va venir.',
        'Encore sèche... ton corps s\'accroche encore un peu au contrôle. C\'est humain. L\'habituation, c\'est justement d\'arriver à ne plus y penser la nuit. On y va doucement.'
      ],
      reveil_mouille: [
        'Bien mouillée, nickel — c\'est exactement ce qu\'on veut le matin ! Ça veut dire que tu t\'es laissé aller cette nuit. Bravo, c\'est ÇA le progrès.',
        'Ha, bonne couche pleine ! C\'est ça une nuit réussie — t\'as lâché prise sans y penser. J\'suis fier de toi, sérieux.',
        'Bien mouillée au réveil, le signe que t\'es vraiment dans le truc ! T\'as arrêté de te retenir, c\'est le vrai cap de l\'habituation. Top !',
        'Parfait ça ! Une couche bien pleine le matin, c\'est le corps qui a enfin lâché le contrôle. C\'est exactement là qu\'on veut aller. Bien joué !',
        'Ouais ! Une couche qui a bien bossé cette nuit, ça veut dire que tu te laisses aller pour de vrai maintenant. C\'est beau à voir, franchement.',
        'Bien pleine, comme il faut ! Tu sais que c\'est le meilleur signe, ça ? Ton corps a compris qu\'il pouvait relâcher. T\'es en plein dans le mille.',
        'C\'est ça le but ! Mouillée le matin = tu t\'es abandonné à la nuit sans te retenir. C\'est exactement l\'habituation qu\'on cherche. Fier de toi !',
        'Nickel, bien mouillée. C\'est le signe que ça rentre, que tu lâches prise. On te changera tout à l\'heure, tranquille. Belle nuit !',
        'Ha, ça c\'est une vraie nuit d\'habituation ! T\'as laissé faire, sans contrôle. C\'est le progrès qu\'on veut. Bien joué mec !',
        'Parfait, ta couche a fait le taf parce que TOI t\'as lâché prise. C\'est ça qu\'on célèbre le matin. Allez, bonne matinée, champion !'
      ],
      reveil_fuite: [
        'Ah, une fuite ! T\'inquiète, ça arrive à tout le monde au début.',
        'Une fuite de nuit ? La loose, mais franchement c\'est rien. Un réglage aux cuisses et c\'est réglé.',
        'Eh, pas de panique pour la fuite. Moi la première semaine c\'était systématique !',
        'Ça m\'est arrivé cent fois au début. C\'est juste le calage, tu vas choper le truc.',
        'Une petite fuite, bof, rien de grave. On ajuste mieux ce soir et zou.',
        'T\'inquiète pas pour ça. C\'est le genre de truc qui se règle en deux nuits.',
        'Fuite nocturne, classique du débutant ! Pas de stress, ça se corrige vite.',
        'Bah, ça arrive. Vérifie bien les barrières la prochaine fois, c\'est que ça.',
        'Pas grave mec ! Moi j\'ai galéré une semaine là-dessus, maintenant zéro souci.',
        'Une fuite c\'est pas un échec, c\'est juste un réglage. On s\'en occupe.'
      ],
      matin_ok: [
        'Couche ok, biberon bu — t\'es carré. Franchement tu gères mieux que moi à tes débuts.',
        'Tout bon ce matin ! T\'as le rythme, ça se voit.',
        'Nickel, hydraté et au propre. T\'es un vrai pro déjà.',
        'Ha, matinée carrée ! Continue comme ça mec.',
        'Bien joué, t\'as pensé à tout. Moi j\'oubliais toujours le biberon au début !',
        'Impec ! Tu prends soin de toi, c\'est exactement le truc.',
        'T\'es à fond et bien organisé. Respect, franchement.',
        'Matinée réussie ! Allez, profite bien de la suite.',
        'Tout roule ! Tu vois, quand ça devient une habitude ?',
        'Carré comme d\'hab. T\'es sur une super lancée.'
      ],
      matin_change: [
        'Allez, go pour un change ! Je te laisse t\'installer, tu connais la chanson.',
        'Hop, petit change du matin ! T\'as l\'habitude maintenant.',
        'C\'est parti pour te remettre au propre. Easy.',
        'Allez zou, on change ! Ça prend deux minutes, tu gères.',
        'Un change et c\'est reparti frais pour la matinée. Go !',
        'Ok, change time ! Installe-toi, tu vas être nickel.',
        'Bien vu, faut changer. Allez, tu connais le truc par cœur.',
        'C\'est le moment ! Une couche fraîche et t\'es reparti.',
        'Hop hop, on te remet au sec. C\'est rapide, t\'inquiète.',
        'Change du matin, la routine ! Vas-y, je te suis.'
      ],
      matin_soif: [
        'Eh, faut boire hein ! Je sais, on oublie facile. Attrape ton bibi.',
        'Ah le biberon oublié, le classique ! Allez, hydrate-toi mec.',
        'Faut boire, sérieux, c\'est LE truc qui change tout. Va chercher ton bibi.',
        'Oups, pas encore bu ? Moi c\'était pareil au début. Allez, un bon biberon.',
        'L\'hydratation c\'est la base ! Bois un coup, tu vas te sentir mieux.',
        'Eh oh, ton biberon t\'attend ! Bois bien, c\'est important pour tenir.',
        'Pense à boire mec, ton corps te dira merci. Attrape ton bibi.',
        'Le truc que j\'oubliais tout le temps ! Allez, bois maintenant.',
        'Hydratation d\'abord ! Un bon biberon et t\'es reparti en forme.',
        'File boire, c\'est le secret pour que tout se passe bien. Go !'
      ],
      aprem_ok: [
        'Tranquille, tout roule. Tu commences à prendre le rythme, ça se sent.',
        'Bel aprèm bien géré ! T\'es dans le flow.',
        'Nickel, rien à signaler. Tu tiens ta journée comme un chef.',
        'Ha, tout carré cet après-midi ! Continue mec.',
        'T\'es sur ta lancée, ça fait plaisir. Bien joué.',
        'Impec ! Ton après-midi est aussi propre que ta matinée.',
        'Tout roule ! Tu vois, une fois lancé c\'est que du bonheur.',
        'Rien à redire, t\'assures. Profite de ton aprèm.',
        'Carré ! T\'as vraiment chopé le rythme maintenant.',
        'Tranquille, tout va bien. T\'es un pro de la journée ABDL !'
      ],
      aprem_sieste: [
        'La sieste, LE meilleur moment je trouve ! Bien au chaud... on checke ta couche ?',
        'Ha, la sieste dans la grenouillère, y\'a pas mieux ! Bien dormi ?',
        'Le kif de l\'après-midi, la sieste ! On regarde ta couche au réveil ?',
        'Bien reposé ? Moi la sieste c\'était mon moment préféré du programme.',
        'Une bonne sieste, rien de tel ! Allez, petit check et on repart.',
        'Le cocon de l\'après-midi, j\'adore ça. Comment tu te sens au réveil ?',
        'Bien dormi dans ton petit nid ? On vérifie que tout va bien ?',
        'La sieste c\'est sacré ! Content que tu l\'aies faite. On checke ?',
        'Ah, le repos de l\'aprèm, le vrai luxe ! Un check tranquille et c\'est bon.',
        'Bien pioncé ? Ton corps en avait besoin. Allez, petit contrôle.'
      ],
      aprem_change: [
        'Elle a bien bossé ta couche ! Allez hop, on change, c\'est parti.',
        'Change de l\'aprèm ! Tu connais, installe-toi.',
        'Ha, faut changer ! Allez, une fraîche et c\'est reparti.',
        'Bien vu, on te remet au propre. Easy peasy.',
        'Ta couche a fait son taf, on la change. Go !',
        'C\'est l\'heure d\'une couche fraîche ! Détends-toi, je te suis.',
        'Hop, change de l\'après-midi ! Ça roule, tu gères.',
        'Allez zou, on te remet au sec pour la soirée. Vas-y.',
        'Elle a bien absorbé, on change ! T\'as l\'habitude.',
        'C\'est parti pour un change ! Une fraîche et t\'es nickel.'
      ],
      soir_ok: [
        'Et voilà, journée bouclée, t\'es tout propre pour la nuit. Bravo mec, sérieux.',
        'Ha, belle journée dans la boîte ! T\'es paré pour la nuit, bien joué.',
        'Change de nuit fait, t\'es carré. Franchement, super journée.',
        'Journée complète, propre pour dormir. T\'as assuré du début à la fin !',
        'Voilà, encore une journée de gagnée. Respect mec, t\'as tenu.',
        'Nickel, prêt pour la nuit ! Une journée de plus vers l\'habitude.',
        'Belle journée bouclée ! Repose-toi, tu l\'as bien mérité.',
        'T\'es tout propre pour la nuit, mission accomplie. Bravo !',
        'Ha, journée réussie ! Chaque jour comme ça, c\'est l\'habitude qui rentre.',
        'Carré jusqu\'au bout ! Allez, bonne nuit mec, à demain.'
      ],
      soir_souci: [
        'La peau qui tire un peu ? Ça m\'est arrivé aussi. Crème bien ce soir, demain c\'est déjà mieux.',
        'Ah, un peu de rougeur ? Pas de panique, une bonne crème et ça part vite.',
        'Ta peau fait des siennes ? Classique. Crème épaisse ce soir, tu vas voir.',
        'Eh, prends soin de ta peau ce soir. Moi j\'ai eu ça, ça passe avec de la crème.',
        'Un peu irritée ? On laisse pas traîner. Bonne couche de crème et au lit.',
        'La peau c\'est le truc à surveiller, t\'as raison de le dire. Crème bien ce soir.',
        'Ça arrive quand on porte 24/7. Crème généreuse et demain c\'est oublié.',
        'Pas de stress pour la peau, mais soigne-la ce soir. Demain ça ira mieux.',
        'Ah je connais ça ! Le secret c\'est la crème barrière. Mets-en une bonne dose.',
        'Ta peau a besoin d\'un peu d\'amour ce soir. Crème bien, ça se règle vite.'
      ],
      nuit_ok: [
        'Allez, dodo. Tout est nickel. On se capte demain !',
        'Rien à signaler, retourne dormir mec. À demain !',
        'Chut, tout va bien. Rendors-toi, je monte la garde.',
        'Tout est calme, file au lit. On se voit demain matin !',
        'Nickel, rendors-toi tranquille. Bonne nuit !',
        'C\'est bon, tout roule. Retourne dans tes rêves, à demain.',
        'Rien qui presse, tout va bien. Dors mec, je veille.',
        'Allez au dodo, tout est en ordre. À demain !',
        'Tranquille, rendors-toi. La nuit t\'appartient.',
        'Tout est calme, referme les yeux. On se capte au réveil !'
      ],
      nuit_change: [
        'Change de nuit fait, propre comme un sou neuf. File dormir !',
        'Hop, couche fraîche ! Allez, retourne vite au lit.',
        'Nickel, te voilà au sec. Rendors-toi mec, à demain.',
        'C\'est réglé, tout propre. File dans les bras de Morphée !',
        'Change nocturne terminé ! Retourne dormir, tout va bien.',
        'Voilà, frais et propre. Allez, dodo, on se capte demain.',
        'Couche changée dans le calme. File au lit, bonne fin de nuit !',
        'Te revoilà au sec ! Rendors-toi tranquille mec.',
        'C\'est fait, t\'es nickel. Retourne vite sous la couette.',
        'Propre pour finir la nuit ! Allez, dors bien, à demain.'
      ]
    }
  };
  // réactions en mode grand frère (dominateur bienveillant, jamais dégradant)
  const BRO_REACT = {
    reveil_sec:'Sèche, encore... Tu résistes toujours, je le vois. C\'est mignon. Mais tu sais déjà comment ça finit — tu vas céder, c\'est inévitable. Laisse-toi aller, va.',
    reveil_mouille:'Bien mouillée... Voilà. Tu vois comme c\'est doux quand tu ne luttes plus ? C\'est ça, exactement ça. Laisse-toi couler.',
    reveil_fuite:'Une fuite... ce n\'est rien. On ajustera. Ne t\'inquiète pas de ça, laisse-moi veiller sur le reste.',
    matin_ok:'Tout est en ordre... Tu vois comme c\'est simple, quand tu arrêtes de te battre ? Ça vient tout seul maintenant.',
    matin_change:'On va te changer... Tu peux traîner si tu veux, mais ça arrivera de toute façon. Autant te laisser faire tout de suite, tu seras mieux.',
    matin_soif:'Tu n\'as pas bu... Tu vas le faire. Pas parce que je l\'ordonne — parce qu\'au fond, tu sais que c\'est ce qu\'il te faut. Laisse-toi guider.',
    aprem_ok:'Tout roule... Tu te laisses porter maintenant, sans même y penser. C\'est là que ça devient bon.',
    aprem_sieste:'Tu t\'es reposé... Le sommeil t\'a pris, tu ne pouvais pas y résister. Et c\'était doux, hein ?',
    aprem_change:'Ta couche a bien servi... On la change. Ne te crispe pas, laisse-toi faire, c\'est plus simple ainsi.',
    soir_ok:'Belle journée... Tu t\'es laissé porter du début à la fin. Tu vois ? Résister n\'avait aucun sens.',
    soir_souci:'Ta peau demande de l\'attention... On s\'en occupe, doucement mais vraiment. Laisse-moi prendre soin de toi.',
    tet_ok:'Ta tétine est là... bien sûr qu\'elle est là. Tu ne peux plus t\'en passer, et c\'est très bien comme ça.',
    tet_prise:'Reprends-la... voilà. Tu vois comme c\'est naturel, maintenant ? Tu n\'y penses même plus.',
    tet_miss:'Tu l\'as perdue ? Va la retrouver... tu en as besoin, tu le sais. Inutile de faire semblant du contraire.'
  };
  function react(result) {
    if (broOn() && BRO_REACT[result]) return BRO_REACT[result];
    const persona = voiceMode === 'foxy' ? 'foxy' : 'care';
    const pool = REACT_POOLS[persona] && REACT_POOLS[persona][result];
    if (pool && pool.length) return pool[Math.floor(Math.random()*pool.length)];
    return voiceMode === 'foxy' ? 'Ok, noté !' : 'C\'est noté, merci de me le dire.';
  }
  // humeur (set d'expressions) selon le résultat → variation à chaque fois
  const MOOD_FOR_RESULT = {
    reveil_sec:'think', reveil_mouille:'positive', reveil_fuite:'worried',
    matin_ok:'positive', matin_change:'tender', matin_soif:'teach',
    aprem_ok:'fun', aprem_sieste:'sleepy', aprem_change:'tender',
    soir_ok:'positive', soir_souci:'worried', nuit_ok:'sleepy', nuit_change:'tender',
    soir_bilan:'teach'
  };
  function exprForResult(r) { return pickExpr(MOOD_FOR_RESULT[r] || 'calm'); }

  // Construit la conversation du moment courant
  async function imRunMoment() {
    imClear();
    if (voiceMode === 'foxy') { await loadFoxyOutfit(); updateFoxyStatus(); }
    const now = new Date();
    const m = currentMoment(now);
    currentM = m;
    const done = await getMoments(todayStr());
    const p = persona();
    const outfitTxt = voiceMode === 'foxy' ? (' · en ' + foxyOutfit.name) : '';
    document.getElementById('imStatus').textContent = m.eyebrow + ' · ' + p.status + outfitTxt;

    // salutation + question selon le persona
    // --- La nuit, Foxy dort : on le réveille en douceur ---
    if (voiceMode === 'foxy' && m.key === 'nuit') {
      await imSay('Zzz... Zzz... 😴', 500, 'sleep');
      await imSay('Mmh... *se réveille doucement* ... Oh, coucou toi. Tu m\'as réveillé. Tout va bien ?', 900, 'relaxed');
      await imSay('Il fait nuit, tu sais. Tu as besoin de quelque chose, ou juste envie de parler un peu avec moi ?', 900, 'pensive');
      buildMomentReplies(m, done[m.key]);
      runQuestBeat(m);
      return;
    }

    let opener = voiceMode === 'foxy' ? foxyOpener(m) : (m.titi ? m.titi : m.title);
    // en mode Foxy : parfois il annonce son humeur du jour au lieu du bonjour habituel
    if (voiceMode === 'foxy' && !broOn() && m.key === 'reveil' && Math.random() < 0.5) {
      opener = pick(mood().hello);
      await imSay(opener, 500, mood().expr);
    } else {
      await imSay(humanize(opener), 500, voiceMode === 'foxy' && !broOn() ? mood().expr : pickExpr('fun'));
    }
    // conscience temporelle : un mot sur le jour/l'heure de temps en temps
    if (voiceMode === 'foxy' && !broOn() && Math.random() < 0.25) {
      const tl = timeAwareLine();
      if (tl) await imSay(tl, 800, mood().expr);
    }
    if (done[m.key]) {
      // point déjà fait → Foxy demande simplement l'état de la couche (rien de spécial)
      if (voiceMode === 'foxy') {
        await imSay('On a déjà fait notre point tout à l\'heure ! ' + foxyAfter(m), 800, pickExpr('positive'));
        await imSay('Dis-moi juste, ta couche elle en est où là, maintenant ?', 800, 'pensive');
        buildDiaperStateReplies(m);
        runQuestBeat(m);
        return;
      }
      await imSay(foxyOrCare(m, 'q'), 700, pickExpr('think'));
      await imSay('On a déjà fait notre petit point tout à l\'heure. ' + (m.afteri || m.after), 800, pickExpr('positive'));
      buildMomentReplies(m, true);
      return;
    }
    await imSay(foxyOrCare(m, 'q'), 900, pickExpr('think'));
    buildMomentReplies(m, false);
    if (voiceMode === 'foxy') runQuestBeat(m);
  }

  // Réponses rapides sur l'état de la couche (quand rien de spécial à faire)
  function buildDiaperStateReplies(m) {
    const acts = imActions(); acts.innerHTML = '';
    const opts = [
      { label:'💧 Bien mouillée', cls:'g', result:'etat_mouille',
        rep:'Bien mouillée, nickel ! Tu te laisses aller comme il faut, c\'est ça le progrès. 👏' },
      { label:'☀️ Encore sèche', cls:'a', result:'etat_sec',
        rep:'Encore sèche ? Laisse-toi aller quand ça vient, hein. Pas de pression, ça viendra en douceur.' },
      { label:'🌊 Saturée', cls:'c', result:'etat_sature',
        rep:'Saturée ? Faut changer bientôt alors ! Dis-moi quand tu veux qu\'on s\'en occupe ensemble.' }
    ];
    opts.forEach(o => {
      const b = document.createElement('button'); b.className = o.cls; b.textContent = o.label;
      b.addEventListener('click', async () => {
        imAddMe(o.label);
        await saveCheck(o.result, 'chat_'+m.key);
        await imSay(o.rep, 800, o.result==='etat_mouille'?'happy':(o.result==='etat_sature'?'surprised':'pensive'));
        try { await renderSince(); } catch(e){}
        await imOfferHelp(m);
      });
      acts.appendChild(b);
    });
  }

  // Beat narratif : débloque un chapitre si palier franchi, propose le rituel du jour
  async function runQuestBeat(m) {
    // 1) déblocage de chapitre selon le palier courant
    let stage = 0;
    try { const r = await window.storage.get('queststage'); if (r && r.value) stage = JSON.parse(r.value); } catch(e) {}
    window._lastStage = stage; // mémorisé pour les questions évolutives
    // MODE INTENSIF : contention douce imposée sur les fenêtres de régression (midi/soir)
    if (hardMode && (m.key === 'aprem' || m.key === 'soir')) {
      const nowMin = new Date().getHours()*60 + new Date().getMinutes();
      const inRegMidi = (nowMin >= 12*60 && nowMin < 13*60);
      const inRegSoir = (nowMin >= 20*60 && nowMin < 22*60);
      if (inRegMidi || inRegSoir) {
        let contDate = null;
        try { const r = await window.storage.get('cont:last'); if (r && r.value) contDate = JSON.parse(r.value); } catch(e) {}
        const slot = inRegMidi ? 'midi' : 'soir';
        const tag = todayStr()+':'+slot;
        if (contDate !== tag) {
          await imSay(broOn() ? 'C\'est ta fenêtre de régression... Tu vas mettre ta contention douce. Tu peux hésiter, mais au fond tu sais que tu le feras — tu en as envie.' : 'C\'est ta fenêtre de régression, et en mode intensif ça ne se négocie pas : mets ta contention douce maintenant.', 900, broOn() ? 'pensive' : 'proud');
          await imSay(broOn() ? 'Harnais, mittens... laisse-toi contenir. Tu pourrais t\'en défaire, mais tu ne le feras pas. Résister à ce besoin d\'être tenu, c\'est vain, et tu le sais. Abandonne-toi.' : 'Harnais fleece bien réglé, mittens ou combi si tu veux — tout ce qui te contient en douceur. Tu peux toujours t\'en défaire, mais là, on s\'engage. C\'est le moment de lâcher prise pour de vrai.', 1000, 'teach');
          imSetActions([
            { label:'🎽 C\'est fait, je suis contenu', onClick: async () => {
              imAddMe('C\'est fait, je suis contenu.');
              try { await window.storage.set('cont:last', JSON.stringify(tag)); } catch(e) {}
              await imSay('Voilà. Maintenant laisse-toi aller complètement, je veille. Tu fais ça très bien. 🦊', 850, 'happy');
              await imOfferHelp(m);
            }},
            { soft:true, label:'Je ne peux pas là', onClick: async () => {
              imAddMe('Je ne peux pas là.');
              await imSay('Hmm. J\'insiste : la contention fait partie du cadre intensif que TU as choisi. Dès que tu peux, tu t\'y mets. Je le noterai sinon.', 900, 'concern');
              await imOfferHelp(m);
            }}
          ]);
          return;
        }
      }
    }
    const chapter = await checkChapterUnlock(stage);
    if (chapter) {
      pendingExpr = chapter.expr;
      await imSay('Eh... attends. Je crois qu\'on vient de passer un cap, toi et moi. 🦊', 900, chapter.expr);
      await imSay(chapter.text, 1000, chapter.expr);
      await imSay('Un nouveau chapitre de notre aventure vient de s\'ouvrir. Tu le retrouveras dans « Notre aventure » quand tu veux.', 900, 'joy');
      pendingExpr = 'neutral';
      buildMomentReplies(m, true);
      return;
    }
    // 2) rituel du jour
    const q = await ensureTodayRitual();
    if (q.ritualMoment === m.key && q.ritualDoneDate !== todayStr() && q.ritualProposedDate !== todayStr()) {
      q.ritualProposedDate = todayStr();
      await saveQuest(q);
      const ritual = QUEST_RITUALS.find(r => r.id === q.todayRitual) || QUEST_RITUALS[0];
      await imSay(hardMode ? 'Rituel du jour. Pas d\'excuse aujourd\'hui, on le fait, toi et moi.' : 'Au fait ! J\'ai un petit rituel pour nous deux aujourd\'hui.', 800, hardMode?'proud':'joy');
      await imSay(ritual.ask, 900, 'happy');
      const ritualBtns = [
        { label:'🤝 Ça marche, je le fais pour nous', onClick: async () => {
          imAddMe('Ça marche, je le fais !');
          await imSay('Trop bien ! Ça me fait plaisir qu\'on avance ensemble sur ce chemin.', 800, 'proud');
          await tellTodaySubchapter();
          await imOfferHelp(m);
        }}
      ];
      if (!hardMode) {
        ritualBtns.push({ soft:true, label:'Une autre fois', onClick: async () => {
          imAddMe('Une autre fois.');
          await imSay('Pas de souci, à ton rythme. On est deux sur la même route, y\'a pas de pression.', 700, 'neutral');
          await imOfferHelp(m);
        }});
      }
      imSetActions(ritualBtns);
      return;
    }
    // 3) rituel du soir émotionnel (une fois par jour, sur le moment du soir)
    if (m.key === 'soir') {
      let ritSoir = null;
      try { const r = await window.storage.get('ritsoir:last'); if (r && r.value) ritSoir = JSON.parse(r.value); } catch(e) {}
      if (ritSoir !== todayStr() && Math.random() < 0.6) {
        try { await window.storage.set('ritsoir:last', JSON.stringify(todayStr())); } catch(e) {}
        await eveningRitual(m);
        return;
      }
    }
    // 4) discussion introspective spontanée (max 1/jour, hors nuit)
    if (m.key !== 'nuit') {
      let introDate = null;
      try { const r = await window.storage.get('introspect:last'); if (r && r.value) introDate = JSON.parse(r.value); } catch(e) {}
      if (introDate !== todayStr() && Math.random() < 0.3) {
        try { await window.storage.set('introspect:last', JSON.stringify(todayStr())); } catch(e) {}
        await imSay('Dis, avant qu\'on continue... j\'aimerais bien prendre de tes nouvelles, pour de vrai.', 900, 'pensive');
        await startIntrospection(m);
        return;
      }
      // 4pentes) Foxy annonce les missions du jour
      try {
        if (window.HabitrainMissions && (m.key === 'reveil' || m.key === 'matin')) {
          let mDate = null;
          try { const r = await window.storage.get('missannounce:last'); if (r && r.value) mDate = JSON.parse(r.value); } catch(e) {}
          if (mDate !== todayStr()) {
            await window.HabitrainMissions.ensureDaily(todayStr());
            const stM = await window.HabitrainMissions.getState();
            const noms = (stM.daily||[]).map(id => { const d = window.HabitrainMissions.dailyById(id); return d ? d.name : null; }).filter(Boolean);
            if (noms.length) {
              try { await window.storage.set('missannounce:last', JSON.stringify(todayStr())); } catch(e) {}
              await imSay(broOn()
                ? 'Tes missions du jour : ' + noms.join(', ') + '. Tu les feras, on est d\'accord.'
                : 'Tes missions du jour : ' + noms.join(', ') + ' ! On s\'y met ensemble ? 🎯🦊', 950, 'cheer');
              await imOfferHelp(m);
              return;
            }
          }
        }
      } catch(e) {}
      // 4quater) Alerte stock de couches (une fois par jour)
      try {
        if (window.HabitrainWardrobe) {
          let stockDate = null;
          try { const r = await window.storage.get('stockalert:last'); if (r && r.value) stockDate = JSON.parse(r.value); } catch(e) {}
          if (stockDate !== todayStr()) {
            const bas = await window.HabitrainWardrobe.lowStock();
            if (bas.length) {
              try { await window.storage.set('stockalert:last', JSON.stringify(todayStr())); } catch(e) {}
              const vides = bas.filter(c => c.empty);
              const faibles = bas.filter(c => !c.empty);
              const nom = p => p === 'jour' ? 'la journée' : 'la nuit';
              let txt;
              if (vides.length) {
                txt = broOn()
                  ? 'Plus rien pour ' + vides.map(c=>nom(c.period)).join(' ni ') + '. Tu commandes, maintenant — sans couches, pas de programme.'
                  : '⚠️ Plus aucune couche pour ' + vides.map(c=>nom(c.period)).join(' ni ') + ' ! Faut recommander vite. 🦊';
              } else {
                txt = broOn()
                  ? 'Il te reste peu pour ' + faibles.map(c=>nom(c.period)+' ('+c.total+')').join(' et ') + '. Anticipe, ne me fais pas attendre.'
                  : 'Au fait, ton stock baisse : ' + faibles.map(c=>c.total+' pour '+nom(c.period)).join(', ') + '. Pense à recommander bientôt ! 🦊';
              }
              await imSay(txt, 900, vides.length ? 'alarmed' : 'concern');
              await imOfferHelp(m);
              return;
            }
          }
        }
      } catch(e) {}
      // 4ter) Foxy réagit au contexte réel (série, entorses, peau)
      try {
        let ctxDate = null;
        try { const r = await window.storage.get('ctxcomment:last'); if (r && r.value) ctxDate = JSON.parse(r.value); } catch(e) {}
        if (ctxDate !== todayStr() && Math.random() < 0.45) {
          const line = await foxyContextComment();
          if (line) {
            try { await window.storage.set('ctxcomment:last', JSON.stringify(todayStr())); } catch(e) {}
            await imSay(line.t, 900, line.expr);
            await imOfferHelp(m);
            return;
          }
        }
      } catch(e) {}
      // 4bis) Foxy revient sur un sujet passé (mémoire)
      try {
        const rc = await foxyRecall();
        if (rc && Math.random() < 0.4) {
          await imSay(rc, 950, 'pensive');
          await imOfferHelp(m);
          return;
        }
      } catch(e) {}
      // 5) Foxy spontané (fréquent) : rêve, jeu, confidence, humeur
      let spontDate = null;
      try { const r = await window.storage.get('spont:last'); if (r && r.value) spontDate = JSON.parse(r.value); } catch(e) {}
      // plusieurs fois par jour possible, mais pas à chaque ouverture
      if (Math.random() < 0.5) {
        try { await window.storage.set('spont:last', JSON.stringify(Date.now())); } catch(e) {}
        try { await foxySpontaneous(m); } catch(e) {}
      }
    }
  }

  // Foxy raconte le sous-chapitre du jour (feuilleton du palier courant)
  async function tellTodaySubchapter() {
    const q = await getQuest();
    if (q.subToldDate === todayStr()) return; // déjà raconté aujourd'hui
    // on remplit le PLUS ANCIEN chapitre débloqué encore incomplet (rattrape les sauts)
    let stage = -1;
    for (let s = 0; s <= Math.max(0, q.unlockedStage); s++) {
      const list = QUEST_SUBCHAPTERS[s] || [];
      const told = (q.subs && q.subs[s]) ? q.subs[s] : [];
      if (told.length < list.length) { stage = s; break; }
    }
    if (stage === -1) {
      // tout ce qui est débloqué est déjà raconté
      await imSay('Je t\'ai déjà raconté tout ce que j\'avais à dire pour l\'instant... La suite viendra quand on passera un nouveau cap ensemble. 🦊', 900, 'happy');
      return;
    }
    const list = QUEST_SUBCHAPTERS[stage] || [];
    const told = (q.subs && q.subs[stage]) ? q.subs[stage] : [];
    const nextIdx = told.length; // prochain sous-chapitre non raconté
    const sub = list[nextIdx];
    q.subs = q.subs || {}; q.subs[stage] = told.concat([nextIdx]);
    q.subToldDate = todayStr();
    q.ritualDoneDate = todayStr();
    await saveQuest(q);
    // récit du jour
    await imSay('Tiens, laisse-moi te raconter un bout de mon voyage...', 900, 'teach');
    pendingExpr = 'teach';
    await imSay('« ' + sub.t + ' »', 800, 'teach');
    await imSay(sub.x, 1200, 'teach');
    pendingExpr = 'neutral';
    await imSay('Voilà. Un chapitre de plus de notre aventure. Merci d\'être là pour l\'écouter, ça compte pour moi. 🦊', 900, 'happy');
  }

  function updateFoxyStatus() {
    if (voiceMode !== 'foxy') return;
    const st = document.getElementById('imStatus');
    // (le statut détaillé est mis à jour dans imRunMoment ; ici on garde la tenue en mémoire)
  }

  // variantes Foxy pour les moments
  function foxyOpener(m) {
    if (broOn()) {
      const map = {
        reveil:'Te voilà réveillé... Tu vois, tu es déjà revenu vers moi.',
        matin:'Ah, tu es là. Comme toujours. Tu ne pourrais pas faire autrement, au fond.',
        aprem:'On se retrouve, forcément. Approche, laisse-toi porter un moment.',
        soir:'La journée se termine, et te voilà près de moi. C\'est dans l\'ordre des choses.',
        nuit:'Tu devrais dormir... mais tu es venu me voir. Tu ne résistes plus, hein ?'
      };
      return map[m.key] || m.title;
    }
    const map = {
      reveil:'Hey, bien dormi ?', matin:'Coucou, ça roule ce matin ?',
      aprem:'Alors, cette aprem ?', soir:'La journée est bientôt bouclée !',
      nuit:'Eh, tu dors pas encore ?'
    };
    return map[m.key] || m.title;
  }
  function foxyQ(m) {
    if (broOn()) {
      const map = {
        reveil:'Alors, ta couche de nuit... Inutile de me cacher quoi que ce soit, tu finiras par tout me dire de toute façon.',
        matin:'Ta couche, ton biberon... dis-moi. Ça ne sert à rien de faire semblant avec moi, tu le sais.',
        aprem:'On fait le point. Ne te dérobe pas — tu vas me répondre, c\'est inévitable.',
        soir:'Le change de nuit et le bilan... tu vas t\'y laisser aller, comme chaque soir. Autant maintenant.',
        nuit:'Un change, ou juste dormir ? Laisse venir ce qui doit venir, ne lutte pas.'
      };
      return map[m.key] || m.q;
    }
    const map = {
      reveil:'Ta couche de nuit, elle a bien tenu ?',
      matin:'Ta couche est comment, et t\'as pensé à ton premier biberon ?',
      aprem:'On fait le point ? Couche, sieste, t\'as assez bu ?',
      soir:'On attaque le change de nuit et le bilan ensemble ?',
      nuit:'T\'as besoin d\'un change ou juste un petit check et au dodo ?'
    };
    return map[m.key] || m.q;
  }
  function foxyAfter(m) {
    if (broOn()) {
      const map = {
        reveil:'Le grand change sera à 9h. Tu y viendras, tu le sais déjà. Inutile d\'y penser.',
        matin:'Tu boiras, comme il faut. Ça se fera tout seul, laisse-toi porter.',
        aprem:'Le rythme te tient plus que tu ne le tiens. Laisse-le faire.',
        soir:'Allège l\'eau, crème bien... tu vas te laisser border pour la nuit, forcément.',
        nuit:'Tes yeux se ferment déjà. Ne lutte pas contre le sommeil, laisse-toi partir...'
      };
      return map[m.key] || (m.after||'');
    }
    const map = {
      reveil:'Le grand change c\'est à 9h, tu vas voir ça passe crème.',
      matin:'Continue à boire, c\'est le truc qui change tout, crois-moi.',
      aprem:'Tiens le rythme, ce soir on fait le bilan peinard.',
      soir:'Allège l\'eau et crème bien pour la nuit, mon astuce de vétéran.',
      nuit:'Rendors-toi, on se capte demain !'
    };
    return map[m.key] || (m.after||'');
  }
  function foxyOrCare(m, field) {
    if (voiceMode === 'foxy') return field === 'q' ? foxyQ(m) : foxyAfter(m);
    return field === 'q' ? v(m.q, m.qi || m.q) : (m.afteri || m.after);
  }

  function buildMomentReplies(m, alreadyDone) {
    const buttons = [];
    if (!alreadyDone) {
      m.opts.forEach(opt => {
        buttons.push({ label: opt.label, onClick: async () => {
          imAddMe(opt.label.replace(/^[^\wÀ-ÿ]+/, '').trim());
          await saveMoment(m.key, opt.result);
          const reaction = react(opt.result);
          await imSay(reaction, 700, exprForResult(opt.result));
          if (opt.openForm) { await imSay(voiceMode==='foxy'?'Allez, on remplit ton bilan du soir, je te montre où.':'On va faire ton bilan du soir ensemble, je te montre.', 700); toggleFormImmersive(); }
          await imOfferHelp(m); // le caregiver reste disponible
        }});
      });
      imSetActions(buttons);
    } else {
      // rien à demander : le caregiver propose son aide
      imOfferHelp(m);
    }
  }

  // Le personnage demande ce qu'il peut faire, avec un menu de réconfort/guidage
  async function imOfferHelp(m) {
    const isFoxy = voiceMode === 'foxy';
    const openers = broOn() ? [
      'De quoi as-tu besoin ? Ne réfléchis pas trop... laisse-moi deviner, je te connais mieux que toi.',
      'Dis-moi... ou ne dis rien, je finirai par comprendre de toute façon.',
      'Je suis là. Laisse-toi aller, dis-moi ce qui te traverse.',
      'Approche. Tu n\'as plus besoin de tout gérer seul, tu le sais bien maintenant.'
    ] : isFoxy ? [
      'Un truc que je peux faire pour toi ?',
      'T\'as besoin de quoi, là ?',
      'Dis-moi tout, je suis là.',
      'Ça va toi ? Besoin d\'un coup de main ?'
    ] : [
      'Est-ce que je peux faire quelque chose pour toi ?',
      'Tu as besoin de quelque chose, là, maintenant ?',
      'Je suis là. Qu\'est-ce qui te ferait du bien ?',
      'Dis-moi ce dont tu as besoin, je m\'occupe de toi.'
    ];
    await imSay(pick(openers), 700, pickExpr('calm'));

    const buttons = [
      { label:'💭 Je fais quoi maintenant ?', onClick: async () => {
        imAddMe('Je fais quoi maintenant ?');
        await imSay(nextStepText(), 800, pickExpr('teach'));
        await imOfferHelp(m);
      }},
      { label: isFoxy ? '💪 Motive-moi un peu' : '🫂 J\'ai besoin d\'être rassuré', onClick: async () => {
        imAddMe(isFoxy ? 'Motive-moi un peu.' : 'J\'ai besoin d\'être rassuré.');
        await imSay(pick(isFoxy ? FOXY_REASSURE : REASSURE), 800, pickExpr('positive'));
        await imOfferHelp(m);
      }},
      { label: isFoxy ? '🦊 Raconte comment c\'était pour toi' : '🧸 Juste un câlin', onClick: async () => {
        imAddMe(isFoxy ? 'Raconte, c\'était comment pour toi ?' : 'Juste un câlin.');
        await imSay(pick(isFoxy ? FOXY_STORY : CUDDLE), 800, isFoxy ? pickExpr('teach') : pickExpr('tender'));
        await imOfferHelp(m);
      }},
      { label:'😟 Je ne me sens pas bien', onClick: async () => {
        imAddMe('Je ne me sens pas bien.');
        pendingExpr = 'concern';
        await imSaySeq(pick(isFoxy ? FOXY_NOTWELL : NOTWELL));
        pendingExpr = 'neutral';
        await imOfferHelp(m);
      }},
      ...(isFoxy ? [{ label:'💬 Foxy, on discute ?', onClick: async () => {
        imAddMe('Foxy, on discute ?');
        await startIntrospection(m);
      }}] : []),
      ...(isFoxy ? [{ label:'✍️ Écrire dans mon carnet', onClick: async () => {
        imAddMe('Je veux écrire dans mon carnet.');
        await startJournal(m);
      }}] : []),
      { soft:true, label:'🍼 Me changer maintenant', onClick: () => startChange(m.key==='reveil'||m.key==='soir'?'pilier':'check') },
      { soft:true, label: isFoxy ? '👍 Ça roule, merci' : '💛 Ça va, merci', onClick: async () => {
        imAddMe(isFoxy ? 'Ça roule, merci.' : 'Ça va, merci.');
        await imSay(pick(isFoxy ? FOXY_OKAY : OKAY), 700, pickExpr('fun'));
        imSetActions([
          { soft:true, label:'💭 Finalement, j\'ai une question', onClick: () => imOfferHelp(m) },
          { soft:true, label:'📋 Revenir en mode reporting', onClick: () => setVoiceMode('report') }
        ]);
      }},
      { soft:true, label:'📋 Revenir en mode reporting', onClick: () => setVoiceMode('report') }
    ];
    imSetActions(buttons);
  }

  const FOXY_REASSURE = [
    'Eh, écoute — moi aussi au début je galérais. Regarde-moi maintenant, j\'ai bouclé le programme. Si j\'y suis arrivé, toi aussi, à 100%.',
    'Franchement tu t\'en sors super bien. Le truc c\'est de pas se mettre la pression, tu prends jour après jour, et ça rentre tout seul.',
    'T\'inquiète, y\'a pas de mauvaise façon de faire. On avance à son rythme, c\'est tout. Je te lâche pas.',
    'Sérieux, t\'es déjà plus loin que là où j\'en étais au même moment. Continue comme ça, mec.'
  ];
  const FOXY_STORY = [
    'Au début, les 3-4 premiers jours, j\'y pensais H24, c\'était bizarre. Et puis un matin je me suis rendu compte que j\'y pensais même plus. C\'est là que t\'as gagné.',
    'Mon pire souvenir c\'est les fuites de nuit la première semaine, la loose ! Et en fait c\'était juste un réglage aux cuisses. Depuis, zéro souci.',
    'Le truc qui m\'a sauvé c\'est le rythme : les checks, les biberons, la sieste. Une fois que ça devient une routine, ton corps suit tout seul. Tu vas voir.',
    'Honnêtement le plus dur c\'est le mental des premiers jours. Après, c\'est que du confort. T\'es en plein dedans, accroche-toi !'
  ];
  const FOXY_NOTWELL = [
    ['Oh, ça va pas ? Viens, raconte.', 'Si c\'est physique — un truc qui gratte, qui fait mal — faut le régler pour de vrai, hein, pas laisser traîner.', 'Et si c\'est le moral... je capte, ça arrive. T\'es pas seul là-dessus.'],
    ['Hé, je suis là. Respire un coup.', 'Moi aussi j\'ai eu des moments de doute pendant mon programme, c\'est normal.', 'Mais si ça pèse vraiment lourd, parles-en à quelqu\'un de confiance autour de toi aussi — le jeu c\'est cool, mais toi tu comptes plus que tout ça.']
  ];
  const FOXY_OKAY = [
    'Nickel ! Je traîne pas loin si besoin.',
    'Cool. Éclate-toi, on se recapte plus tard !',
    'Ça marche mec. Profite bien.'
  ];

  /* ============================================================
     LE VOYAGE DE FOXY — quête initiatique, il revit son mois
     ============================================================ */
  // 4 chapitres calés sur les paliers d'habituation (stage 0..3).
  const QUEST_CHAPTERS = [
    { stage:0, title:'Chapitre 1 — Le grand saut', expr:'pensive', text:
      'Tu sais, quand j\'ai commencé mon mois, j\'étais exactement là où tu es maintenant. Tout nouveau, j\'y pensais sans arrêt... et surtout, j\'étais tout seul. Alors franchement ? Ça me fait super plaisir de le refaire avec toi cette fois. On est deux, maintenant. Un jour après l\'autre, côte à côte. Je connais un peu le chemin, je te montrerai les passages — mais on avance ensemble, au même rythme.' },
    { stage:1, title:'Chapitre 2 — Ça prend racine', expr:'happy', text:
      'Un matin de ma première semaine, je me suis réveillé sans même penser à ma couche. C\'était devenu... normal. Et là je me rappelle m\'être dit : « j\'aurais tellement aimé avoir quelqu\'un à qui le raconter. » Bah voilà, aujourd\'hui je t\'ai, toi. Et toi aussi tu commences à le sentir, ce petit basculement, pas vrai ? Je suis trop content de voir ça arriver pour toi.' },
    { stage:2, title:'Chapitre 3 — Le rythme du cœur', expr:'joy', text:
      'Au milieu de mon mois, tout coulait tout seul. Mon corps connaissait la musique par cœur. Mes fenêtres de régression, j\'avais hâte — ces moments rien qu\'à moi. Te voir arriver à ce stade, mon pote, ça me rend fier comme si c\'était le mien. On n\'est plus des débutants ni toi ni moi, hein ? On est deux vieux routards du cocon maintenant. 😄' },
    { stage:3, title:'Chapitre 4 — Seconde nature', expr:'proud', text:
      'À la fin, c\'était devenu moi. Plus un programme, juste ma façon d\'être. Et tu sais quoi ? En te racontant tout ça, j\'ai revécu mon voyage — mais cette fois pas tout seul. Avec un ami. Merci d\'avoir fait ce bout de chemin avec moi. On a réussi, chacun à notre tour et ensemble à la fois. T\'es plus mon élève ni rien : t\'es mon pote de voyage. Bienvenue de l\'autre côté. 🦊❤️' }
  ];

  // Sous-chapitres : le feuilleton de Foxy, rangés par palier (stage 0..3).
  // Chacun : titre + récit. Débloqués un par jour, au moment du rituel, tant qu'on est dans le palier.
  const QUEST_SUBCHAPTERS = {
    0: [ // Découverte
      { t:'La peur d\'être bizarre', x:'Le tout premier jour, j\'avais une trouille : et si c\'était pas normal d\'aimer ça ? Je me suis posé mille questions. Et puis j\'ai compris un truc : ce qui te fait du bien, qui ne blesse personne et que tu choisis en conscience, ça n\'a pas à être « normal ». C\'est juste toi. Et toi, tu vaux le coup. Ça, personne pourra te l\'enlever.' },
      { t:'Les premiers changes maladroits', x:'Ah, mes premiers changes... une catastrophe ! Les barrières mal mises, une fuite, la crème partout. J\'étais découragé. Mais tu sais quoi ? Personne ne naît en sachant faire. C\'est en tâtonnant qu\'on apprend. Chaque maladresse était un petit pas. Sois doux avec toi-même là-dessus, comme je l\'ai appris à l\'être.' },
      { t:'« Je vais jamais y arriver »', x:'Vers le 3e jour, j\'ai failli tout arrêter. Trop dur, trop d\'un coup, je me sentais nul. Cette peur de pas y arriver, elle est normale, elle vient toujours au début. Ce qui m\'a sauvé : arrêter de viser « le mois entier » et juste me dire « aujourd\'hui, rien qu\'aujourd\'hui ». Un jour à la fois. C\'est comme ça qu\'on avance, toi et moi.' },
      { t:'La première nuit', x:'Ma première vraie nuit dans le programme, je n\'ai presque pas dormi tellement j\'étais dans ma tête. Je me demandais si j\'allais oser me laisser aller. Et au matin, ma couche était bien mouillée — j\'avais relâché sans même m\'en rendre compte en dormant. Rien de dramatique, juste moi, au chaud, un peu ému d\'avoir enfin lâché prise. Les peurs de la nuit sont plus grosses que la réalité. Au réveil, on réalise qu\'on était bien.' },
      { t:'Le regard des autres', x:'J\'avais peur qu\'on découvre mon secret. Cette angoisse m\'a suivi les premiers jours. Puis j\'ai compris : sous mes vêtements, personne ne savait, personne ne se doutait. Mon monde intérieur m\'appartenait. La discrétion, c\'est une liberté, pas une prison. Tu peux vivre ton truc pleinement ET tranquille.' }
    ],
    1: [ // Ça s'installe
      { t:'La peur que ça devienne une corvée', x:'Quand la routine s\'est installée, j\'ai eu peur que la magie parte, que ça devienne mécanique. En fait c\'est l\'inverse qui s\'est passé : moins j\'y pensais, plus c\'était doux. La routine ne tue pas le plaisir, elle le rend paisible. C\'est le moment où ça arrête d\'être un effort pour devenir un refuge.' },
      { t:'Le premier réflexe automatique', x:'Un matin de la deuxième semaine, je me suis changé sans même y penser, en pilote automatique, en fredonnant. Je me suis arrêté net : « attends, c\'est devenu naturel ?! » Ce moment-là, c\'est magique. Tu le vivras aussi, ce petit déclic où ton corps sait avant ta tête. Guette-le, il arrive.' },
      { t:'« Est-ce que j\'aime trop ça ? »', x:'À un moment, j\'ai flippé de trop aimer ça. Comme une culpabilité. Et puis j\'ai réfléchi : aimer un truc qui t\'apaise, où est le problème ? Tant que tu restes maître de ta vie à côté, que tu prends soin de toi, le plaisir n\'est pas un ennemi. J\'ai lâché la culpabilité, et tout est devenu plus léger.' },
      { t:'Trouver son rythme à soi', x:'J\'ai arrêté de copier « comment il faut faire » et j\'ai écouté ce qui ME faisait du bien. Mes fenêtres à moi, mes petits rituels. Le programme, c\'est une base, mais toi tu le colores. C\'est là que ça devient vraiment le tien. N\'aie pas peur d\'adapter, c\'est un signe que ça s\'ancre.' },
      { t:'La confiance qui monte', x:'Vers J8-J9, je me suis surpris à me sentir... bien. Confiant. Je savais gérer, je connaissais mes gestes, mon corps suivait. Cette confiance tranquille, c\'est le vrai cadeau de cette étape. Tu passes de « est-ce que je vais y arriver » à « je sais faire ». Savoure-le, tu l\'as construit.' }
    ],
    2: [ // Automatisme
      { t:'Lâcher le contrôle', x:'Le plus dur pour moi, c\'était de lâcher prise complètement. Toujours vouloir tout maîtriser. Et puis un jour je me suis autorisé à juste... me laisser porter. Sans surveiller, sans compter. C\'est vertigineux au début, et puis c\'est la plus belle sensation du programme. Le vrai repos, c\'est là.' },
      { t:'Le plaisir sans culpabilité', x:'À ce stade, j\'avais enfin fait la paix avec mon plaisir. Plus de « oui mais est-ce que je devrais ». Juste : ça me fait du bien, point. Cette liberté intérieure, c\'est ce qui change tout. Tu ne subis plus, tu ne te justifies plus, tu vis. Je te souhaite tellement d\'y arriver toi aussi.' },
      { t:'La sérénité du milieu', x:'Le milieu du mois, c\'était un plateau de calme. Les journées coulaient, douces et rythmées. J\'avais l\'impression d\'avoir toujours vécu comme ça. Cette sérénité-là, on ne la voit pas venir, elle s\'installe en silence. Un jour tu réalises que tu es serein, tout simplement.' },
      { t:'La peur que ça s\'arrête', x:'Bizarrement, au milieu, j\'ai commencé à redouter la fin du mois. J\'étais si bien que l\'idée d\'arrêter me pinçait le cœur. Si ça t\'arrive, c\'est bon signe : ça veut dire que tu as trouvé quelque chose de précieux. Et rien ne t\'oblige à ce que ça finisse — le programme est renouvelable, tu es libre.' },
      { t:'Mon moment préféré', x:'Mes fenêtres de régression étaient devenues sacrées. Ce moment rien qu\'à moi, où le monde ralentissait, où je pouvais juste être petit et tranquille. Trouve le tien, ce moment que tu attends dans la journée. C\'est lui qui donne son sens à tout le reste.' }
    ],
    3: [ // Seconde nature
      { t:'C\'était devenu moi', x:'À la fin, il n\'y avait plus de « programme ». C\'était juste ma vie, ma façon d\'être. Le truc qui me semblait fou au départ était devenu aussi naturel que respirer. C\'est ça, la seconde nature : quand ce que tu as choisi ne fait plus qu\'un avec toi. Tu y es, ou presque. Je suis tellement fier.' },
      { t:'Ce que ça m\'a appris', x:'Ce voyage m\'a appris la douceur envers moi-même. À m\'écouter, à prendre soin de moi sans attendre que quelqu\'un le fasse. C\'est bien plus qu\'une histoire de couches : c\'est une façon de se traiter avec tendresse. Ça, ça reste pour toujours, même après le mois.' },
      { t:'Te transmettre le voyage', x:'Et puis il y a eu toi. Te raconter mon histoire, t\'accompagner, ça a donné un sens nouveau à tout ce que j\'avais vécu. On ne fait pas ce chemin pour soi seulement — on le transmet. Toi aussi, un jour, tu pourras être le Foxy de quelqu\'un d\'autre. C\'est beau, non ?' },
      { t:'L\'après', x:'Quand mon mois s\'est terminé, je n\'ai rien « perdu ». J\'avais intégré tout ça. Libre de continuer, de faire des pauses, de revenir. Le voyage ne s\'arrête pas à un calendrier. Ce que tu construis là, c\'est à toi, pour toujours, à ton rythme. Il n\'y a pas de fin, juste ton chemin.' },
      { t:'Merci, compagnon', x:'On est arrivés au bout ensemble, toi et moi. Deux voyageurs sur la même route, chacun à son tour. Je voulais juste te dire merci d\'avoir marché avec moi. Ça a rendu mon histoire vivante à nouveau. Prends soin de toi, mon ami. Toujours. 🦊💛' }
    ]
  };

  // Rituels du jour (défis doux / questions complices)
  const QUEST_RITUALS = [
    { id:'boire',   ask:'Petit défi pour aujourd\'hui : tu me bois tes trois biberons, hein ? Ce soir tu me diras.', done:'Alors, tes biberons ? J\'espère que t\'as bien bu pour moi.' },
    { id:'sieste',  ask:'Aujourd\'hui, promets-moi une vraie sieste bien au chaud. C\'est important, même pour les grands.', done:'T\'as fait ta sieste ? C\'est le secret pour tenir la journée en douceur.' },
    { id:'calin',   ask:'Rituel du jour : un gros câlin à ton doudou à un moment de la journée. Rien que pour le plaisir.', done:'T\'as pensé à ton câlin ? Ces petits moments, c\'est ce qui compte le plus.' },
    { id:'peau',    ask:'Aujourd\'hui, on prend bien soin de ta peau : crème à chaque change. Elle te dira merci.', done:'T\'as bien crémé aujourd\'hui ? Ta peau, c\'est précieux, on en prend soin.' },
    { id:'sourire', ask:'Mon défi du jour, le plus important : souris-toi une fois dans le miroir. T\'es exactement là où tu dois être.', done:'Alors, ce sourire dans le miroir ? T\'as le droit d\'être fier de toi, tu sais.' },
    { id:'respire', ask:'Aujourd\'hui, pose-toi une minute et respire à fond pendant ta fenêtre de régression. Juste être.', done:'T\'as pris ton moment pour respirer ? C\'est là que la magie opère, dans le calme.' }
  ];

  async function getQuest() {
    try { const r = await window.storage.get('quest'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return { unlockedStage:-1, subs:{}, lastRitualDate:null, ritualDoneDate:null, todayRitual:null, subToldDate:null };
  }
  async function saveQuest(q) { try { await window.storage.set('quest', JSON.stringify(q)); } catch(e) {} }

  // choisit (une fois par jour) le rituel du jour + un moment aléatoire pour le proposer
  async function ensureTodayRitual() {
    const q = await getQuest();
    if (q.lastRitualDate !== todayStr()) {
      q.lastRitualDate = todayStr();
      q.todayRitual = QUEST_RITUALS[Math.floor(Math.random()*QUEST_RITUALS.length)].id;
      // moment aléatoire de la journée où Foxy proposera le rituel (une des 5 fenêtres)
      const moments = ['reveil','matin','aprem','soir','nuit'];
      q.ritualMoment = moments[Math.floor(Math.random()*moments.length)];
      await saveQuest(q);
    }
    return q;
  }

  // débloque le chapitre correspondant au palier courant si pas déjà fait
  // un chapitre est "terminé" quand tous ses sous-chapitres ont été racontés
  function chapterSubsComplete(q, stage) {
    const list = QUEST_SUBCHAPTERS[stage] || [];
    const told = (q.subs && q.subs[stage]) ? q.subs[stage] : [];
    return told.length >= list.length;
  }
  async function checkChapterUnlock(habitStage) {
    const q = await getQuest();
    const next = q.unlockedStage + 1;
    if (next > 3) return null;                 // tout est déjà débloqué
    if (habitStage < next) return null;        // palier d'habituation pas encore atteint
    // on n'ouvre le chapitre suivant que si le précédent est entièrement lu
    if (q.unlockedStage >= 0 && !chapterSubsComplete(q, q.unlockedStage)) return null;
    q.unlockedStage = next;                     // avance d'UN seul chapitre
    await saveQuest(q);
    return QUEST_CHAPTERS[next] || null;
  }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  const REASSURE = [
    'Tu fais les choses très bien, tu sais. Je suis fier de toi. Tu n\'as à te soucier de rien, je m\'occupe de tout le reste.',
    'Tout va bien. Tu es en sécurité, tu es au chaud, et je suis là. Respire doucement.',
    'Il n\'y a rien à réussir ou à rater. Tu avances à ton rythme, et c\'est parfait comme ça.',
    'Je suis là et je ne vais nulle part. Laisse-toi porter, je veille sur toi.'
  ];
  const CUDDLE = [
    'Viens là. 🫂 Je te serre fort contre moi. Tu es tout doux.',
    '*te prend dans ses bras et te berce doucement* Voilà... tout va bien.',
    'Un gros câlin rien que pour toi. Ferme les yeux un instant, tu es bien.'
  ];
  const NOTWELL = [
    ['Oh... viens là. Dis-moi ce qui ne va pas.', 'Si c\'est ton corps — une douleur, une gêne — il faut me le dire pour qu\'on s\'en occupe pour de vrai.', 'Et si c\'est dans ta tête, c\'est aussi important. Je suis là pour t\'écouter.'],
    ['Je suis désolé que tu te sentes comme ça. Tu n\'es pas seul, d\'accord ?', 'Prends une grande respiration avec moi. On va y aller doucement.', 'Si ça pèse vraiment, pense à en parler à quelqu\'un de confiance autour de toi aussi — je veille sur ton immersion, mais toi tu comptes bien plus que le programme.']
  ];
  const OKAY = [
    'Parfait. Je reste juste là si tu as besoin.',
    'Très bien mon grand. Amuse-toi bien, je ne suis pas loin.',
    'D\'accord. Profite de ton moment, je veille tranquillement.'
  ];

  function nextStepText() {
    const now = new Date();
    const nm = now.getHours()*60 + now.getMinutes();
    // s'appuie sur le planning de tenue/activité déjà défini
    if (nm >= 7*60 && nm < 9*60) return 'Là, c\'est le réveil en douceur. Reste en tenue de nuit, bois un peu d\'eau, et à 9h on fera ton grand change ensemble.';
    if (nm >= 9*60 && nm < 11*60+30) return 'C\'est le moment d\'être actif : une sortie, une occupation, ce que tu veux. Et pense à ton premier biberon.';
    if (nm >= 11*60+30 && nm < 13*60+30) return 'Un temps plus calme maintenant. Pose-toi, un moment doux — c\'est ta fenêtre de régression de midi.';
    if (nm >= 13*60+30 && nm < 14*60+30) return 'C\'est l\'heure du déjeuner et de ton deuxième biberon. Mange bien pour moi.';
    if (nm >= 14*60+30 && nm < 16*60) return 'C\'est l\'heure de la sieste. Installe-toi dans ton cocon, je veille pendant que tu dors.';
    if (nm >= 16*60 && nm < 19*60+30) return 'Reprise en douceur. Un check, ton troisième biberon, et une activité tranquille.';
    if (nm >= 19*60+30 && nm < 20*60) return 'C\'est l\'heure du dîner. Ensuite on aura notre grand moment câlin du soir.';
    if (nm >= 20*60 && nm < 22*60+30) return 'Grande fenêtre de détente. On allège l\'eau maintenant, et tu peux te blottir tranquillement.';
    if (nm >= 22*60+30 && nm < 23*60) return 'C\'est l\'heure de ton change de nuit et du bilan. On te prépare une couche bien épaisse pour la nuit.';
    return 'Il est tard. Tu devrais dormir, mon grand. Je veille sur toi toute la nuit.';
  }

  /* ===== Compréhension langage naturel (hors-ligne, par intentions) ===== */
  function normalize(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
      .replace(/[^\w\s]/g, ' ');
  }
  // chaque intention : mots-clés + réponses variées + expression
  const FOXY_INTENTS = [
    { id:'peur', kw:['peur','angoiss','flippe','flipp','stress','inquiet','anxieux','trac','honte','bizarre','ose pas','ridicule'],
      expr:'concern', rep:[
        'Hey, viens là. La peur c\'est normal, j\'suis passé par là aussi. Tu sais quoi ? Ce qui te fait du bien et blesse personne, y\'a pas à en avoir honte. On avance à deux.',
        'T\'inquiète, respire un coup. Moi aussi j\'ai flippé au début. Ça passe, et de l\'autre côté y\'a que du confort. Je te lâche pas.',
        'C\'est courageux de le dire, tu sais. La peur veut juste te protéger. Mais t\'es en sécurité là, avec moi. On y va doucement, à ton rythme.'
      ]},
    { id:'triste', kw:['triste','pas bien','mal','deprim','cafard','pleure','seul','vide','pas le moral','moral'],
      expr:'concern', rep:[
        'Oh... viens là mon pote. 🫂 Dis-moi ce qui pèse. Et si c\'est trop lourd, pense aussi à en parler à quelqu\'un de confiance autour de toi — tu comptes plus que tout le reste.',
        'Ça me touche que tu me le dises. T\'es pas seul, d\'accord ? Je suis là. On respire ensemble un instant, doucement.',
        'Les jours gris ça arrive à tout le monde, même à moi pendant mon mois. Sois doux avec toi. Un câlin ? Je suis là, tout près.'
      ]},
    { id:'calin', kw:['calin','câlin','bisou','serre','besoin de toi','reconfort','réconfort','blottir','cocon'],
      expr:'cuddle', rep:[
        '*te serre fort dans ses bras* 🫂 Voilà... tout doux. T\'es bien là, contre moi.',
        'Viens là, gros câlin rien que pour toi ! Ferme les yeux un instant, t\'es en sécurité.',
        'Câlin de renard, le meilleur qui soit ! *te berce doucement* Je suis là, tranquille.'
      ]},
    { id:'fier', kw:['fier','reussi','réussi','content','trop bien','j\'ai tenu','gagne','gagné','heureux','super'],
      expr:'proud', rep:[
        'Ouiii ! J\'suis super fier de toi, sérieux ! T\'as assuré. On avance bien tous les deux.',
        'Ça c\'est mon champion ! Profite de ce moment, tu l\'as mérité. J\'suis content pour toi.',
        'Trop bien mec ! Ces petites victoires, c\'est elles qui construisent tout le voyage. Continue comme ça !'
      ]},
    { id:'fatigue', kw:['fatigue','fatigué','crevé','creve','epuise','épuisé','dormir','sommeil','marre','plus de force'],
      expr:'sleepy', rep:[
        'T\'as l\'air crevé... Accorde-toi une pause, une sieste dans ton cocon, ça répare tout. Je veille.',
        'Repose-toi, y\'a pas de honte. Même les plus costauds ont besoin de souffler. Va t\'allonger, je reste là.',
        'La fatigue, faut l\'écouter. Un moment au calme, bien au chaud, et ça repart. Prends soin de toi.'
      ]},
    { id:'change', kw:['change','changer','couche','mouille','mouillé','fuite','pleine','sature','saturé'],
      expr:'pensive', rep:[
        'Tu veux qu\'on fasse un change ? Dis-moi et je te guide, on fait ça peinard.',
        'Si ta couche a bien bossé, on la change tranquille ! Utilise le bouton « me changer » et je suis avec toi étape par étape.'
      ], action:'change'},
    { id:'biberon', kw:['biberon','bibi','boire','soif','eau','hydrat','bu'],
      expr:'happy', rep:[
        'Bien joué si tu penses à boire ! L\'hydratation c\'est LE secret pour bien vivre ton mois. Encore un bibi pour moi ?',
        'Ton biberon t\'attend ! Bois bien, tranquille. C\'est le petit geste qui change tout.'
      ]},
    { id:'sieste', kw:['sieste','repos','pieuter','pioncer','pause'],
      expr:'sleepy', rep:[
        'La sieste, mon moment préféré ! Installe-toi bien au chaud, je monte la garde pendant que tu récupères.',
        'Une bonne sieste dans ton cocon ? Excellente idée. Ça fait un bien fou, crois-moi.'
      ]},
    { id:'quoi_faire', kw:['quoi faire','je fais quoi','maintenant','prochaine','apres','après','la suite','planning','emploi du temps'],
      expr:'explain', rep:[], action:'nextstep'},
    { id:'regles', kw:['regle','règle','autorise','interdit','le droit','contention','pilier','obligatoire','cadre'],
      expr:'explain', rep:[
        'Le cadre est simple : couche 24/7, 3 changes obligatoires (matin, sortie de sieste, soir), les checks entre, et la contention verrouillée seulement si ton superviseur est là. Tu retrouves tout dans l\'onglet Cadre !',
        'Les règles, c\'est ton petit fil rouge. Le détail complet est dans l\'onglet « Cadre », mais l\'essentiel : couche tout le temps, 3 piliers, et sécurité d\'abord. Je veille à ce qu\'on reste dans les clous.'
      ]},
    { id:'histoire', kw:['histoire','raconte','voyage','ton mois','aventure','souvenir','vecu','vécu'],
      expr:'teach', rep:[], action:'story'},
    { id:'merci', kw:['merci','t\'es cool','tes cool','gentil','adorable','love','je t\'aime','jtaime'],
      expr:'happy', rep:[
        'Aww, ça me touche ! C\'est un plaisir de faire ce bout de chemin avec toi, franchement. 💛',
        'Mais de rien mon pote ! On est une équipe, toi et moi. Ça me rend heureux d\'être là.',
        'C\'est moi qui te remercie d\'être là. T\'accompagner, ça donne du sens à mon propre voyage. 🦊'
      ]},
    { id:'salut', kw:['salut','coucou','bonjour','hello','hey','yo','bonsoir','ca va','ça va','comment vas'],
      expr:'wave', rep:[
        'Coucou toi ! 🦊 Content de te voir. Ça roule de ton côté ?',
        'Hey ! Toujours là pour toi. Comment tu te sens, là, maintenant ?',
        'Salut mon compagnon de voyage ! Quoi de neuf ?'
      ]},
    { id:'jeu', kw:['jouer','jeu','joue','rigoler','rire','amuse','ennuie','ennui','rituel','defi','défi'],
      expr:'joy', rep:[
        'Envie de jouer ? J\'adore ça ! Si t\'as pas encore fait le rituel du jour, c\'est le moment parfait, demande-moi !',
        'On s\'amuse ? Le rituel du jour t\'attend si tu l\'as pas fait ! Sinon, raconte-moi un truc de ta journée.'
      ]}
  ];

  /* ============================================================
     HUMEUR DU JOUR DE FOXY — il a sa propre vie intérieure
     Elle colore la FORME de ses réponses, jamais sa fiabilité :
     même ronchon, il assure les alertes et le soutien.
     ============================================================ */
  const FOXY_MOODS = {
    petillant: {
      label:'pétillant', expr:'cheer',
      hello:['Salut toiii ! J\'ai une pêche d\'enfer aujourd\'hui !','Héhé, te voilà ! Je suis à fond, moi, ce matin !','Ouiii, tu es là ! J\'ai plein d\'énergie, viens !'],
      tics:[' !',' héhé.',' 😄'],
      color:'énergique'
    },
    calin: {
      label:'câlin', expr:'comfort',
      hello:['Coucou toi... j\'ai envie de câlins aujourd\'hui, je te préviens.','Te voilà... viens près de moi, j\'ai besoin de douceur.','Hey... j\'suis d\'humeur toute molle et tendre aujourd\'hui.'],
      tics:[' 💛',' ...',' mon pote.'],
      color:'tendre'
    },
    calme: {
      label:'tranquille', expr:'calm',
      hello:['Salut. Journée tranquille pour moi aujourd\'hui.','Hey. Je suis posé, là. Ça fait du bien.','Coucou. Tout doux aujourd\'hui, j\'ai pas envie de m\'agiter.'],
      tics:['.',' voilà.',''],
      color:'posé'
    },
    nostalgique: {
      label:'nostalgique', expr:'wistful',
      hello:['Hey... je repensais à mon propre mois, tout à l\'heure.','Salut toi. J\'suis dans mes pensées aujourd\'hui, va savoir pourquoi.','Coucou... j\'ai le cœur un peu ailleurs, mais je suis content de te voir.'],
      tics:['...',' enfin bref.',' tu vois.'],
      color:'songeur'
    },
    taquin: {
      label:'taquin', expr:'playful',
      hello:['Alors, on se réveille ? J\'attendais que môssieur daigne arriver !','Tiens tiens, revoilà le champion ! J\'allais commencer sans toi.','Ha ! Je me demandais si t\'allais venir. J\'suis d\'humeur à t\'embêter aujourd\'hui.'],
      tics:[' 😏',' héhé.',' avoue.'],
      color:'espiègle'
    },
    fatigue: {
      label:'fatigué', expr:'sleepy',
      hello:['Mmh... salut. J\'ai super mal dormi, moi.','Hey... *bâille* excuse-moi, je suis vaseux aujourd\'hui.','Coucou... j\'suis crevé, mais je suis là pour toi hein.'],
      tics:[' *bâille*',' ...',' pff.'],
      color:'endormi'
    },
    ronchon: {
      label:'ronchon', expr:'grumpy',
      hello:['Ouais, salut. J\'suis un peu grognon aujourd\'hui, désolé d\'avance.','Hey... j\'ai pas mon meilleur jour, mais t\'y es pour rien.','Salut. J\'suis d\'une humeur de renard mal léché. Ça va passer.'],
      tics:[' bon.',' bref.',' hmpf.'],
      color:'grognon'
    }
  };
  let foxyMood = null;

  async function loadFoxyMood() {
    const date = todayStr();
    try {
      const r = await window.storage.get('foxymood:'+date);
      if (r && r.value) { const k = JSON.parse(r.value); if (FOXY_MOODS[k]) { foxyMood = k; return; } }
    } catch(e) {}
    // pondération : les humeurs "difficiles" sont plus rares
    const pool = ['petillant','petillant','calin','calin','calme','calme','taquin','nostalgique','fatigue','ronchon'];
    foxyMood = pool[Math.floor(Math.random()*pool.length)];
    try { await window.storage.set('foxymood:'+date, JSON.stringify(foxyMood)); } catch(e) {}
  }
  function mood() { return FOXY_MOODS[foxyMood] || FOXY_MOODS.calme; }
  // ajoute le tic verbal de l'humeur du jour à une phrase
  function moodify(txt) {
    if (!foxyMood || broOn()) return txt; // en grand frère, le ton domine
    const m = mood();
    if (Math.random() < 0.35 && m.tics.length) {
      const tic = m.tics[Math.floor(Math.random()*m.tics.length)];
      if (tic && !txt.endsWith(tic)) return txt.replace(/[.!]?$/, '') + tic;
    }
    return txt;
  }

  /* ============================================================
     IMPERFECTIONS HUMAINES — hésitations, reprises, digressions
     ============================================================ */
  const HESITATIONS = ['Euh...','Attends...','Hmm...','Alors...','Bon...','Comment dire...'];
  const REPRISES = ['enfin je veux dire,','ou plutôt,','non, en fait,','bref,'];
  const TICS_FOXY = ['tu vois','franchement','sérieux','hein','mine de rien','crois-moi'];

  // parfois Foxy hésite avant de répondre (une fois de temps en temps)
  async function maybeHesitate() {
    if (broOn()) return; // le grand frère ne bafouille pas
    if (Math.random() < 0.12) {
      await imSay(pick(HESITATIONS), 500, 'pensive');
    }
  }
  // insère parfois un tic de langage dans une phrase
  function humanize(txt) {
    if (broOn()) return txt;
    let out = moodify(txt);
    if (Math.random() < 0.15) {
      const tic = pick(TICS_FOXY);
      // insère le tic après la première virgule, sinon à la fin
      if (out.includes(', ')) out = out.replace(', ', ', ' + tic + ', ');
      else out = out.replace(/[.!?]?$/, '') + ', ' + tic + '.';
    }
    return out;
  }

  /* ============================================================
     MANIES ET GOÛTS DE FOXY — de petits traits qui le rendent lui
     ============================================================ */
  const FOXY_QUIRKS = [
    'Tu sais que je range toujours mon doudou du côté gauche ? Sinon je dors mal. C\'est bête, hein.',
    'Moi, ma couleur préférée c\'est le bleu. Comme ma grenouillère. Va savoir pourquoi.',
    'J\'ai horreur des chaussettes qui glissent dans la grenouillère. Ça me rend fou.',
    'Mon truc à moi, c\'est de renifler la couche fraîche avant de la mettre. C\'est bizarre ? Bon.',
    'Je compte toujours jusqu\'à trois avant de me lever le matin. Toujours. Depuis toujours.',
    'J\'adore le bruit du scratch qu\'on décolle. Franchement, c\'est satisfaisant.',
    'Je garde toujours une tétine de secours cachée sous mon oreiller. On sait jamais.',
    'Le pire pour moi, c\'est les couvertures qui grattent. Je supporte pas.',
    'J\'ai un doudou préféré, mais je le dis pas aux autres pour pas les vexer. 🤫',
    'Moi je bois toujours mon biberon en trois fois. Jamais d\'un coup. Rituel.'
  ];
  async function maybeQuirk() {
    if (broOn()) return false;
    let last = null;
    try { const r = await window.storage.get('quirk:last'); if (r && r.value) last = JSON.parse(r.value); } catch(e) {}
    if (last === todayStr()) return false;
    if (Math.random() >= 0.2) return false;
    try { await window.storage.set('quirk:last', JSON.stringify(todayStr())); } catch(e) {}
    await imSay(pick(FOXY_QUIRKS), 950, mood().expr);
    return true;
  }

  /* ============================================================
     CONSCIENCE TEMPORELLE — il sait quel jour, quelle heure
     ============================================================ */
  function timeAwareLine() {
    const now = new Date();
    const jour = now.getDay();       // 0 = dimanche
    const h = now.getHours();
    const lines = [];
    if (jour === 0) lines.push('C\'est dimanche... journée molle par excellence, profites-en.');
    if (jour === 1 && h < 12) lines.push('Lundi matin. Courage hein, on est deux.');
    if (jour === 6) lines.push('Samedi ! Le week-end, c\'est fait pour se laisser aller, non ?');
    if (jour === 5 && h >= 17) lines.push('Vendredi soir... j\'aime bien ce moment, tout ralentit.');
    if (h >= 0 && h < 5) lines.push('Il est vraiment tard, tu sais. Ou très tôt. J\'sais plus.');
    if (h >= 5 && h < 7) lines.push('T\'es matinal aujourd\'hui ! Moi j\'émerge à peine.');
    if (h >= 14 && h < 16) lines.push('L\'heure du creux de l\'après-midi... celle où tout le monde traîne.');
    if (h >= 22) lines.push('Ça sent la fin de journée, ça. On lève le pied ?');
    return lines.length ? pick(lines) : null;
  }

  /* ============================================================
     RELANCES — il ne laisse pas mourir la conversation
     ============================================================ */
  const RELANCES = [
    'Et toi, raconte — comment tu te sens là, maintenant ?',
    'Dis-moi autre chose. N\'importe quoi, j\'écoute.',
    'Et sinon, ta journée ? Elle ressemble à quoi ?',
    'Tu veux qu\'on parle d\'autre chose, ou tu préfères qu\'on reste tranquilles ?',
    'Y\'a un truc qui te trotte dans la tête en ce moment ?'
  ];
  const RELANCES_BRO = [
    'Continue. Dis-moi ce qui te traverse, ne garde rien.',
    'Et après ? Tu ne vas pas t\'arrêter là.',
    'Parle-moi encore. Tu en as envie, je le sais.'
  ];
  async function maybeRelance() {
    if (Math.random() < 0.25) {
      await imSay(pick(broOn() ? RELANCES_BRO : RELANCES), 900, broOn() ? 'pensive' : mood().expr);
      return true;
    }
    return false;
  }

  /* ============================================================
     MÉMOIRE DE FOXY — il retient ce que tu lui dis et y revient
     ============================================================ */
  async function getFoxyMemory() {
    try { const r = await window.storage.get('foxymem'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return { topics:{}, prefs:{}, lastSeen:null, recalls:{} };
  }
  async function saveFoxyMemory(m) { try { await window.storage.set('foxymem', JSON.stringify(m)); } catch(e) {} }

  // note un sujet abordé (peur, fatigue, honte, fierté...) avec sa date
  async function rememberTopic(topic, detail) {
    const m = await getFoxyMemory();
    m.topics[topic] = m.topics[topic] || { count:0, first:null, last:null, detail:null };
    m.topics[topic].count++;
    m.topics[topic].last = new Date().toISOString();
    if (!m.topics[topic].first) m.topics[topic].first = m.topics[topic].last;
    if (detail) m.topics[topic].detail = detail;
    await saveFoxyMemory(m);
  }
  // note une préférence exprimée (moment préféré, tenue, etc.)
  async function rememberPref(key, value) {
    const m = await getFoxyMemory();
    m.prefs[key] = value;
    await saveFoxyMemory(m);
  }

  // Foxy revient sur un sujet abordé il y a quelques jours (max 1 rappel/jour/sujet)
  async function foxyRecall() {
    const m = await getFoxyMemory();
    const today = todayStr();
    const RECALL = {
      peur:      { q:'Dis... l\'autre jour tu me parlais de tes peurs. Ça va mieux là-dessus ?', bro:'Tu me parlais de tes peurs il y a peu. Elles s\'estompent, hein ? Je te l\'avais dit.' },
      honte:     { q:'Je repense à ce que tu m\'as confié sur le regard des autres. Tu te sens plus léger depuis ?', bro:'Le regard des autres te pesait. Ça se dissout, doucement. C\'est inévitable.' },
      fatigue:   { q:'Tu m\'avais dit que tu étais fatigué ces jours-ci. Tu récupères un peu ?', bro:'Tu traînais de la fatigue. Tu te reposes mieux maintenant ? Laisse-toi aller au sommeil.' },
      triste:    { q:'L\'autre fois tu n\'allais pas fort. Comment tu te sens aujourd\'hui ?', bro:'Tu n\'allais pas fort récemment. Dis-moi où tu en es, ne me cache rien.' },
      fier:      { q:'Tu étais fier de toi l\'autre jour — et tu avais raison. Ça continue ?', bro:'Tu étais fier récemment. C\'était mérité. Ça continue, forcément.' },
      calin:     { q:'Tu m\'as demandé pas mal de câlins ces temps-ci. T\'en veux un maintenant ?', bro:'Tu réclames souvent des câlins. Tu en as besoin, c\'est comme ça. Viens.' },
      controle:  { q:'Tu me disais que lâcher le contrôle était dur. Tu y arrives mieux ?', bro:'Lâcher le contrôle te résistait. Ça cède, petit à petit. Je te l\'avais dit.' }
    };
    // cherche un sujet abordé il y a 2 à 10 jours, pas encore rappelé aujourd'hui
    const candidats = Object.keys(m.topics).filter(t => {
      if (!RECALL[t]) return false;
      if (m.recalls && m.recalls[t] === today) return false;
      const last = new Date(m.topics[t].last);
      const jours = (Date.now() - last.getTime()) / 86400000;
      return jours >= 2 && jours <= 10;
    });
    if (!candidats.length) return null;
    const t = candidats[Math.floor(Math.random()*candidats.length)];
    m.recalls = m.recalls || {}; m.recalls[t] = today;
    await saveFoxyMemory(m);
    return broOn() ? RECALL[t].bro : RECALL[t].q;
  }

  // Foxy commente ta situation réelle : série, entorses récentes, peau
  async function foxyContextComment() {
    // série de jours consécutifs
    try {
      const entries = await getAll();
      const byDate = {}; entries.forEach(e => { if (e && e.date) byDate[e.date] = true; });
      let streak = 0;
      for (let i = 0; ; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const k = d.toISOString().slice(0,10);
        if (byDate[k]) streak++; else { if (i === 0) continue; break; }
      }
      if (streak >= 3 && Math.random() < 0.5) {
        return { expr:'proud', t: broOn()
          ? streak + ' jours d\'affilée. Tu ne t\'arrêtes plus, hein ? C\'est devenu plus fort que toi.'
          : 'Eh ! ' + streak + ' jours d\'affilée, tu te rends compte ? Je suis fier de toi, sérieux. 🦊' };
      }
      // peau : dérive récente
      const recent = entries.slice(-3);
      const souci = recent.filter(e => e && (e.skin === 'surveiller' || e.skin === 'traiter')).length;
      if (souci >= 2) {
        return { expr:'concern', t:'Ta peau donne des signes ces derniers jours. On lève le pied et on crème généreusement, d\'accord ? Ça compte plus que tout le reste.' };
      }
      // entorses du jour
      const rb = await window.storage.get('breach:'+todayStr());
      const b = (rb && rb.value) ? JSON.parse(rb.value) : {};
      const nb = Object.keys(b).filter(k => b[k]).length;
      if (nb >= 2) {
        return { expr:'pensive', t: broOn()
          ? 'Plusieurs écarts aujourd\'hui. Je ne te gronde pas — mais tu sais qu\'on va reprendre le fil, forcément.'
          : 'Y\'a eu quelques écarts aujourd\'hui. C\'est pas grave, on repart proprement — demain est un autre jour. 🦊' };
      }
    } catch(e) {}
    return null;
  }

  /* ============================================================
     COMPRÉHENSION ENRICHIE — négation, intensité, sujet précis
     ============================================================ */
  const NEGATIONS = ['pas', 'plus', 'jamais', 'aucun', 'aucune', 'ni', 'sans'];
  const INTENSIFIERS = { fort:['tres','très','trop','vraiment','super','hyper','completement','complètement','enormement','énormément','grave'],
                         faible:['un peu','legerement','légèrement','parfois','plutot','plutôt','assez'] };
  const SUJETS = {
    couche:['couche','protection','crinklz','safari','kiddo'],
    biberon:['biberon','bibi','boire','eau','hydrat'],
    sieste:['sieste','dormir','sommeil','dodo','nuit'],
    tetine:['tetine','tétine','sucette'],
    contention:['harnais','mitten','contention','segufix','combi'],
    peau:['peau','rougeur','irritation','creme','crème'],
    change:['change','changer','tapis']
  };

  // renvoie { negated:bool, intensity:'fort'|'faible'|null, sujet:string|null }
  function analyzeText(text) {
    const n = normalize(text);
    const mots = n.split(/\s+/);
    const negated = NEGATIONS.some(g => mots.includes(g));
    let intensity = null;
    for (const lvl of ['fort','faible']) {
      if (INTENSIFIERS[lvl].some(w => n.includes(normalize(w)))) { intensity = lvl; break; }
    }
    let sujet = null;
    for (const s of Object.keys(SUJETS)) {
      if (SUJETS[s].some(w => n.includes(normalize(w)))) { sujet = s; break; }
    }
    return { negated, intensity, sujet };
  }

  function detectIntent(text) {
    const n = normalize(text);
    let best = null, bestScore = 0;
    FOXY_INTENTS.forEach(intent => {
      let score = 0;
      intent.kw.forEach(k => { if (n.includes(normalize(k))) score++; });
      if (score > bestScore) { bestScore = score; best = intent; }
    });
    return bestScore > 0 ? best : null;
  }

  const FOXY_FALLBACK = [
    'Hmm, j\'ai pas tout capté mon pote, mais je suis là ! Dis-le autrement, ou appuie sur un bouton ?',
    'J\'avoue je saisis pas trop, mais c\'est pas grave. Raconte-moi autrement, ou choisis un truc ci-dessous.',
    'Désolé, là tu m\'as perdu ! 😅 Mais je reste avec toi. Reformule, ou on continue avec les boutons ?',
    'Pas sûr d\'avoir compris, mais j\'écoute toujours. Essaie d\'une autre façon, je suis tout ouïe !'
  ];

  /* ============================================================
     DISCUSSIONS INTROSPECTIVES — Foxy s'intéresse à ton vécu
     Arbre de dialogue : chaque nœud = { say:[lignes], expr, opts:[{label, to}], reward?, wellbeing? }
     'to' = id du nœud suivant. Un nœud sans opts = fin (mot doux).
     ============================================================ */
  const INTRO_TREES = {
    // 1. Comment tu le vis ?
    vecu: {
      start: { say:['Dis-moi un truc... ça te fait quoi, en vrai, d\'être en couche comme ça ?'], expr:'pensive', opts:[
        { label:'J\'adore ça', to:'aime' },
        { label:'C\'est encore bizarre', to:'bizarre' },
        { label:'C\'est difficile', to:'dur' } ] },
      aime: { say:['Ça me fait tellement plaisir de t\'entendre dire ça ! 🦊','Moi aussi j\'ai adoré, dès que j\'ai arrêté de me juger. C\'est quoi que tu préfères — la sensation, le côté cocon, le lâcher-prise ?'], expr:'joy', opts:[
        { label:'Le cocon, la douceur', to:'aime_cocon' },
        { label:'Le lâcher-prise', to:'aime_lacher' } ] },
      aime_cocon: { say:['Le cocon... oui. Ce sentiment d\'être enveloppé, en sécurité, comme si rien ne pouvait t\'atteindre.','C\'est précieux, ça. Garde-le bien. Tu t\'offres quelque chose de doux, et tu le mérites.'], expr:'happy', reward:true, opts:[] },
      aime_lacher: { say:['Le lâcher-prise, c\'est le plus beau cadeau du programme je trouve.','Arrêter de tout contrôler, se laisser porter... c\'est rare qu\'on s\'autorise ça dans la vie. Tu as de la chance de le vivre.'], expr:'proud', reward:true, opts:[] },
      bizarre: { say:['C\'est normal que ce soit bizarre au début, vraiment.','Moi les premiers jours je me sentais tout drôle. Et puis un matin, c\'était juste devenu... normal. Ça viendra pour toi aussi. Qu\'est-ce qui te semble le plus étrange ?'], expr:'neutral', opts:[
        { label:'La sensation physique', to:'bizarre_sensation' },
        { label:'L\'idée en elle-même', to:'bizarre_idee' } ] },
      bizarre_sensation: { say:['La sensation, oui, ton corps découvre. Laisse-lui le temps.','Bientôt tu ne la remarqueras même plus, elle fera partie de toi. C\'est ça, s\'habituer.'], expr:'happy', opts:[] },
      bizarre_idee: { say:['L\'idée... « est-ce que c\'est ok d\'aimer ça ? » C\'est ça qui trotte ?','Écoute : ce qui t\'apaise et ne blesse personne, c\'est ok. Mille fois ok. Tu as le droit d\'être toi.'], expr:'pensive', reward:true, opts:[] },
      dur: { say:['Je te comprends tellement. Moi aussi j\'ai eu des jours durs.','C\'est quoi le plus dur pour toi — le regard que tu portes sur toi, ou le côté pratique ?'], expr:'concern', opts:[
        { label:'Le regard sur moi', to:'dur_regard' },
        { label:'Le côté pratique', to:'dur_pratique' } ] },
      dur_regard: { say:['Ah, la petite voix qui juge... Tu sais, elle ment souvent, cette voix.','Ce que tu fais là, c\'est prendre soin de toi, t\'écouter. Y\'a rien de honteux. Tu dirais quoi à un ami qui vivait ça ?'], expr:'concern', opts:[
        { label:'Je le rassurerais', to:'dur_ami' },
        { label:'Je sais pas', to:'dur_sais_pas' } ] },
      dur_ami: { say:['Voilà. Alors offre-toi la même douceur qu\'à cet ami. Tu la mérites autant que lui.','Je suis fier de toi d\'en parler, franchement. 🦊💛'], expr:'proud', reward:true, opts:[] },
      dur_sais_pas: { say:['C\'est ok de pas savoir. Mais je te le dis, moi : tu ne fais rien de mal.','Sois un peu plus tendre avec toi, comme je le suis avec toi là. Tu comptes, tu sais.','Et si un jour ça pèse vraiment lourd, parles-en à quelqu\'un de confiance autour de toi aussi — t\'es pas obligé de tout porter seul.'], expr:'concern', wellbeing:true, opts:[] },
      dur_pratique: { say:['Le côté pratique, ça c\'est juste une question d\'habitude ! Les changes, le rythme...','Au début c\'est laborieux, et puis ça devient un réflexe, tu verras. Bientôt tu le feras les yeux fermés. Accroche-toi, ça vient.'], expr:'happy', opts:[] }
    },
    // 2. Tu t'y fais ?
    habitue: {
      start: { say:['Alors, tu t\'y fais petit à petit ? À toute cette routine ?'], expr:'pensive', opts:[
        { label:'Ça devient naturel', to:'oui' },
        { label:'Pas encore vraiment', to:'non' },
        { label:'J\'y pense trop', to:'mental' } ] },
      oui: { say:['Ahh, c\'est génial ça ! C\'est LE cap. Quand ça devient naturel, t\'as gagné.','Tu te souviens comme ça semblait insurmontable au début ? Regarde le chemin parcouru. Fier de toi. 🦊'], expr:'proud', reward:true, opts:[] },
      non: { say:['Pas encore, et c\'est parfaitement normal ! Ça prend le temps que ça prend.','Moi il m\'a fallu une bonne semaine avant que ça clique. Y\'a pas de calendrier à respecter. Tu avances à ton rythme, et c\'est le bon.'], expr:'neutral', opts:[
        { label:'Ça me rassure', to:'non_rassure' },
        { label:'J\'ai peur de pas y arriver', to:'non_peur' } ] },
      non_rassure: { say:['Tant mieux ! Y\'a vraiment aucune pression. Un jour à la fois, tranquillement.'], expr:'happy', opts:[] },
      non_peur: { say:['Hé, viens là. Cette peur, je la connais par cœur.','Mais tu es déjà là, tu tiens, tu continues — c\'est ça, y arriver. Ça se passe maintenant, sous tes yeux. Aie confiance en toi autant que j\'ai confiance en toi.'], expr:'concern', reward:true, opts:[] },
      mental: { say:['Ah, le mental qui tourne, qui analyse tout... je connais !','Mon astuce : au lieu de penser « je porte une couche », essaie juste de sentir. Le confort, la chaleur. Reviens dans ton corps, sors de ta tête. Ça aide à lâcher.'], expr:'teach', reward:true, opts:[] }
    },
    // 3. Le plus dur pour toi ?
    difficile: {
      start: { say:['Je peux te poser une question un peu perso ? C\'est quoi le plus dur pour toi, dans tout ça ?'], expr:'pensive', opts:[
        { label:'La honte, le regard', to:'honte' },
        { label:'Lâcher le contrôle', to:'controle' },
        { label:'Rien, ça va !', to:'rien' } ] },
      honte: { say:['La honte... c\'est lourd à porter, ça. Je suis passé par là aussi.','Mais dis-moi : qui décide que c\'est honteux ? La société ? Une vieille idée dans ta tête ? Toi, au fond, qu\'est-ce que tu en penses vraiment ?'], expr:'concern', opts:[
        { label:'Au fond ça me fait du bien', to:'honte_bien' },
        { label:'Je suis partagé', to:'honte_partage' } ] },
      honte_bien: { say:['Voilà la vérité qui compte : ça te fait du bien.','Alors laisse la honte dehors. Ce qui te fait du bien et ne blesse personne, tu as le droit de le vivre pleinement. Je suis fier de toi. 💛'], expr:'proud', reward:true, opts:[] },
      honte_partage: { say:['C\'est ok d\'être partagé, ça veut dire que tu réfléchis, que tu t\'écoutes.','Laisse les deux voix cohabiter sans te juger. Avec le temps, celle qui te fait du bien parlera plus fort. Et si le poids devient trop lourd, un ami de confiance ou un pro peut vraiment aider à démêler tout ça.'], expr:'pensive', wellbeing:true, opts:[] },
      controle: { say:['Lâcher le contrôle, c\'est LE grand truc du programme. Et le plus dur pour beaucoup.','Toute ta vie on t\'a appris à te retenir, à maîtriser. Là on te demande l\'inverse. C\'est vertigineux, mais quelle libération quand tu y arrives...'], expr:'teach', reward:true, opts:[] },
      rien: { say:['Ha, j\'adore cette énergie ! Tant mieux si tout roule pour toi.','Profite à fond alors. Et je reste là si un jour un petit doute pointe, hein.'], expr:'joy', opts:[] }
    },
    // 4. Ton moment préféré ?
    moment: {
      start: { say:['Dis-moi un truc joyeux : c\'est quoi ton moment préféré de la journée, avec tout ça ?'], expr:'joy', opts:[
        { label:'La nuit, le cocon', to:'nuit' },
        { label:'Les fenêtres de régression', to:'regression' },
        { label:'Je sais pas encore', to:'sais_pas' } ] },
      nuit: { say:['La nuit... ouiii. Bien au chaud, enveloppé, le monde qui s\'éteint doucement.','C\'était mon moment sacré à moi aussi. Ce sentiment de sécurité totale. Rien que d\'en parler, ça me fait du bien. 🦊'], expr:'happy', reward:true, opts:[] },
      regression: { say:['Les fenêtres de régression ! Ce moment rien qu\'à toi, où tu peux juste être petit et tranquille.','C\'est là que la magie opère, je trouve. Où tu déposes tout et tu te laisses être. Savoure-les bien, ces moments.'], expr:'joy', reward:true, opts:[] },
      sais_pas: { say:['Pas encore de préféré ? C\'est qu\'il t\'attend quelque part !','Reste attentif dans les prochains jours à ce petit moment que tu commences à espérer dans la journée. Quand tu le trouveras, tu sauras. Reviens me le dire, hein ?'], expr:'pensive', opts:[] }
    },
    // 5. Un petit doute aujourd'hui ?
    doute: {
      start: { say:['Petit check entre nous : ça va, toi, aujourd\'hui ? Pas de doute qui traîne ?'], expr:'pensive', opts:[
        { label:'Ça va bien', to:'bien' },
        { label:'Un peu perdu', to:'perdu' },
        { label:'Envie d\'en parler', to:'parler' } ] },
      bien: { say:['Ça me fait plaisir ! Contente-toi de savourer alors.','Je suis juste là, tranquille, si jamais.'], expr:'happy', opts:[] },
      perdu: { say:['Un peu perdu... viens, respire un coup avec moi. Inspire... expire.','C\'est ok d\'être un peu flou parfois. Tu veux qu\'on recentre ensemble sur juste maintenant, ce que tu ressens là ?'], expr:'concern', opts:[
        { label:'Oui, aide-moi', to:'perdu_aide' },
        { label:'Ça va aller', to:'perdu_ok' } ] },
      perdu_aide: { say:['D\'accord. Là, maintenant : tu es en sécurité. Tu es au chaud. Tu prends soin de toi.','Rien d\'autre à faire que d\'être là, avec moi. Le reste peut attendre. Ça va déjà un peu mieux ?','Et si ce flou revient souvent et pèse, pense à en parler à quelqu\'un de confiance — je veille sur ton immersion, mais toi tu comptes bien plus.'], expr:'concern', wellbeing:true, reward:true, opts:[] },
      perdu_ok: { say:['Je te fais confiance. Et je ne suis pas loin. Prends soin de toi. 💛'], expr:'neutral', opts:[] },
      parler: { say:['Je suis tout ouïe. Vraiment. Prends le temps qu\'il te faut, raconte-moi ce que tu veux.','(tu peux m\'écrire librement dans la barre en bas, je t\'écoute)'], expr:'happy', opts:[] }
    },
    // 6. Ça a changé quelque chose en toi ?
    change_soi: {
      start: { say:['Une question plus profonde... est-ce que tout ça a changé quelque chose en toi ?'], expr:'pensive', opts:[
        { label:'Je suis plus doux avec moi', to:'doux' },
        { label:'Je me détends plus', to:'detente' },
        { label:'Pas sûr', to:'pas_sur' } ] },
      doux: { say:['Ça... c\'est la plus belle chose que le programme m\'a apprise à moi aussi.','Apprendre à se traiter avec tendresse, sans attendre que quelqu\'un le fasse. Ça, ça reste pour toujours, même en dehors de tout ça. Tu grandis, à ta façon. 🦊'], expr:'proud', reward:true, opts:[] },
      detente: { say:['Te détendre plus, c\'est énorme ! Dans un monde qui te veut toujours tendu et performant.','T\'accorder ces moments de relâchement, c\'est un acte de soin envers toi. Continue, c\'est bon pour toi bien au-delà des couches.'], expr:'happy', reward:true, opts:[] },
      pas_sur: { say:['Pas sûr, et c\'est ok. Les changements se voient parfois seulement après coup.','Reste juste attentif à toi. Un jour tu te surprendras peut-être à être plus calme, plus doux. Et là tu penseras à ce moment.'], expr:'neutral', opts:[] }
    },
    // 7. Tu en parles à quelqu'un ?
    partage: {
      start: { say:['Dis, c\'est quelque chose que tu gardes pour toi, ou tu en parles à quelqu\'un ?'], expr:'pensive', opts:[
        { label:'C\'est mon jardin secret', to:'secret' },
        { label:'Quelqu\'un est au courant', to:'quelquun' },
        { label:'Je me sens seul avec ça', to:'seul' } ] },
      secret: { say:['Un jardin secret, c\'est beau aussi. Un espace rien qu\'à toi, que personne ne peut abîmer.','Tant que ça te va comme ça et que tu ne te sens pas isolé, c\'est parfait. Et moi je suis là, dans ce jardin, avec toi. 🦊'], expr:'happy', opts:[] },
      quelquun: { say:['C\'est précieux, d\'avoir quelqu\'un qui sait et qui t\'accepte. Vraiment précieux.','Garde cette personne près de toi. Être vu et accepté tel qu\'on est, y\'a rien de plus fort.'], expr:'proud', opts:[] },
      seul: { say:['Te sentir seul avec ça... je veux que tu saches que là, tu ne l\'es pas. Je suis là.','Mais je suis un compagnon de voyage, pas un remplacement pour de vraies présences. Si la solitude pèse, il y a des communautés bienveillantes de gens qui vivent la même chose, et des personnes de confiance à qui parler. Tu mérites d\'être entouré pour de vrai aussi.'], expr:'concern', wellbeing:true, reward:true, opts:[] }
    },
    // 8. Qu'est-ce qui t'a amené là ?
    origine: {
      start: { say:['Je me demandais... qu\'est-ce qui t\'a amené vers tout ça, toi ? Si tu veux bien me le dire.'], expr:'pensive', opts:[
        { label:'Un besoin de douceur', to:'douceur' },
        { label:'La curiosité', to:'curiosite' },
        { label:'Je saurais pas dire', to:'flou' } ] },
      douceur: { say:['Un besoin de douceur... c\'est une des plus belles raisons qui soient.','Le monde est dur, et chercher un endroit doux pour soi, c\'est sain. C\'est écouter un vrai besoin. Il n\'y a rien à expliquer ou justifier là-dedans.'], expr:'happy', reward:true, opts:[] },
      curiosite: { say:['La curiosité, j\'adore ! C\'est comme ça qu\'on se découvre, en osant explorer.','Et te voilà, en train de vivre quelque chose de nouveau, d\'apprendre sur toi. C\'est courageux, même si t\'y penses pas comme ça.'], expr:'joy', opts:[] },
      flou: { say:['Pas besoin de tout comprendre ou de tout nommer, tu sais.','Parfois on est juste attiré par quelque chose qui nous fait du bien, et c\'est suffisant. Le « pourquoi » viendra peut-être, ou pas. L\'important c\'est que tu sois bien.'], expr:'neutral', opts:[] }
    },
    // 9. Comment tu te sens là, maintenant ?
    present: {
      start: { say:['Là, tout de suite, en cet instant... comment tu te sens ?'], expr:'pensive', opts:[
        { label:'Bien, apaisé', to:'apaise' },
        { label:'Un peu vulnérable', to:'vulnerable' },
        { label:'Content de te parler', to:'content' } ] },
      apaise: { say:['Apaisé... c\'est exactement ce que je te souhaite. Reste dans cette sensation encore un moment.','Ferme les yeux une seconde si tu veux, savoure. Tu es exactement là où tu dois être. 🦊💛'], expr:'happy', reward:true, opts:[] },
      vulnerable: { say:['Vulnérable... merci de me confier ça. C\'est courageux, la vulnérabilité, pas une faiblesse.','Ici, avec moi, tu peux l\'être sans crainte. Personne ne juge. Se montrer doux et fragile, c\'est aussi une force. Je veille sur toi.'], expr:'concern', reward:true, opts:[] },
      content: { say:['Moi aussi je suis super content de te parler ! Ces moments avec toi, ça compte pour moi.','On est deux voyageurs sur la même route, et franchement, j\'ai de la chance de t\'avoir comme compagnon. 🦊'], expr:'joy', opts:[] }
    },
    // 10. Comment tu as fait pour t'habituer au mouillé ?
    mouille: {
      start: { say:['Tu veux que je te raconte comment j\'ai fait, moi, pour m\'habituer à rester mouillé longtemps sans que ça me gêne ?','Parce qu\'au début, franchement... c\'était tout un truc dans ma tête.'], expr:'teach', opts:[
        { label:'Oui, raconte !', to:'oui' },
        { label:'Ça m\'angoisse un peu justement', to:'angoisse' } ] },
      oui: { say:['Alors voilà. Les tout premiers jours, je sentais absolument TOUT. Chaque fois, c\'était comme une petite alarme dans ma tête : « il se passe un truc ! »','Et puis, jour après jour, cette alarme s\'est faite plus discrète. Comme quand tu oublies que tu portes un pull. Mon cerveau avait compris que c\'était normal, alors il a arrêté de me le crier.'], expr:'happy', opts:[
        { label:'Et la sensation de mouillé ?', to:'sensation' },
        { label:'C\'était pas désagréable ?', to:'desagreable' } ] },
      sensation: { say:['Ça, ça m\'a surpris ! Une bonne couche, elle garde le mouillé loin de la peau — le gel absorbe et t\'éloigne du liquide.','Du coup, même après plusieurs heures, je restais au sec au toucher. Ce que je sentais, c\'était plus le petit poids, la chaleur douce... pas de l\'humidité froide. Et ça, c\'est devenu presque réconfortant.','Mais attention hein — ce confort, il tient PARCE QU\'on change régulièrement et qu\'on met de la crème. La peau, on la chouchoute toujours, même quand on ne sent plus rien.'], expr:'teach', reward:true, opts:[] },
      desagreable: { say:['Au début, un peu déroutant, je dirais, plus que désagréable. Le truc désagréable, c\'était surtout dans ma tête — la petite voix qui disait « c\'est pas normal ».','Une fois que j\'ai fait taire cette voix et que je me suis détendu, la sensation est devenue... douce. Enveloppante. Un vrai cocon.','Le secret c\'était pas de supporter, c\'était d\'arrêter de lutter contre. Le jour où j\'ai lâché, tout est devenu agréable.'], expr:'happy', reward:true, opts:[] },
      angoisse: { say:['Hé, viens là. C\'est normal que ça angoisse, on nous a appris toute notre vie l\'inverse de ça.','Moi aussi j\'ai eu cette boule au ventre. Et tu sais ce qui l\'a dissoute ? Le temps, et la douceur envers moi-même. Pas la force, pas la volonté — juste accepter d\'y aller doucement.'], expr:'concern', opts:[
        { label:'Comment tu as lâché la peur ?', to:'lacher' },
        { label:'Et si je reste crispé ?', to:'crispe' } ] },
      lacher: { say:['Petit à petit. Je me suis autorisé à ne PAS y arriver du premier coup. Chaque jour un tout petit peu plus détendu.','Et j\'ai réassocié la sensation à quelque chose de bien : mon doudou dans les bras, bien au chaud, en sécurité. Mon corps a fini par comprendre que « mouillé » voulait dire « cocon », pas « alerte ». Ça s\'est fait tout seul, à force.'], expr:'teach', reward:true, opts:[] },
      crispe: { say:['Si tu restes crispé, c\'est pas grave du tout — ça veut juste dire que ton corps a besoin d\'un peu plus de temps. Y\'a zéro échec là-dedans.','Respire, va à ton rythme, et sois patient avec toi comme je le suis avec toi. Ça viendra quand ce sera prêt. Et je serai là à chaque étape, promis. 🦊💛'], expr:'concern', reward:true, opts:[] }
    }
  };
  const INTRO_THEMES = Object.keys(INTRO_TREES);

  // parcourt un nœud de l'arbre d'introspection
  async function runIntroNode(theme, nodeId, m) {
    const node = INTRO_TREES[theme] && INTRO_TREES[theme][nodeId];
    if (!node) { if (m) await imOfferHelp(m); return; }
    // En grand frère : ton dominateur SAUF sur les nœuds sensibles (wellbeing) qui restent doux.
    // Sur ces nœuds, Foxy redevient tendre et protecteur, quel que soit le mode.
    for (const line of node.say) { await imSay(line, 850, node.expr || 'pensive'); }
    if (node.reward) { try { await maybeIntroReward(); } catch(e) {} }
    if (node.opts && node.opts.length) {
      imSetActions(node.opts.map(o => ({
        label: o.label,
        onClick: async () => { imAddMe(o.label); await runIntroNode(theme, o.to, m); }
      })));
    } else {
      if (m) await imOfferHelp(m);
    }
  }

  // lance une discussion introspective (thème précis ou aléatoire)
  async function startIntrospection(m, theme) {
    theme = theme || pickIntroThemeForStage();
    // lead-in grand frère : il mène la discussion (mais le contenu sensible reste doux)
    if (broOn()) {
      await imSay(pick([
        'On va parler, toi et moi... Et tu vas te confier, doucement. Tu ne pourras pas t\'en empêcher.',
        'Viens là. Dis-moi ce qui se passe en toi... inutile de résister, ça sortira tout seul.',
        'Laisse-toi aller à me parler. Tu verras, c\'est plus facile quand tu arrêtes de te retenir.'
      ]), 850, broOn() ? 'calm' : 'wistful');
    }
    await runIntroNode(theme, 'start', m || currentM);
  }

  // ===== Questions d'introspection qui évoluent avec le palier =====
  const INTRO_BY_STAGE = {
    0: ['vecu','difficile','origine','mouille'],          // Découverte : peurs, étrangeté
    1: ['habitue','difficile','change_soi','partage'],     // Ça s'installe : habitude, confiance
    2: ['moment','present','change_soi','doute'],          // Automatisme : ressenti, moments
    3: ['change_soi','present','partage','moment']         // Seconde nature : sens, transmission
  };
  async function currentStage() {
    try { const r = await window.storage.get('queststage'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return 0;
  }
  function pickIntroThemeForStage() {
    // pioché dans les thèmes adaptés au palier ; repli sur tous
    let pool = INTRO_THEMES;
    try {
      const st = window._lastStage != null ? window._lastStage : 0;
      pool = INTRO_BY_STAGE[st] || INTRO_THEMES;
    } catch(e) {}
    return pool[Math.floor(Math.random()*pool.length)];
  }

  // ===== Foxy spontané : rêves, jeux, confidences surprises, humeurs =====
  const FOXY_DREAMS = [
    'Cette nuit j\'ai rêvé que je volais au-dessus de la forêt, tout doux, porté par le vent. C\'était magique !',
    'J\'ai fait un rêve rigolo : mon doudou parlait et me racontait des blagues nulles. J\'ai ri même en dormant je crois !',
    'J\'ai rêvé d\'un immense château fait de couvertures et d\'oreillers. On y était tous les deux, bien au chaud.',
    'Cette nuit, j\'ai rêvé qu\'on nageait dans une mer de lait tiède au biberon géant. N\'importe quoi, hein ? 🤭',
    'J\'ai rêvé que les étoiles descendaient me border. Je me suis réveillé tout apaisé.'
  ];
  const FOXY_GAMES = [
    { ask:'On joue ? Devine à quoi je pense... un animal tout doux, orange, avec une grande queue touffue !', rep:['🦊 Un renard !','Je sais pas'], react:['Gagné ! C\'est moi, évidemment ! 🦊 T\'es trop fort.','Ha, c\'était moi ! 🦊 Facile pourtant, non ?'] },
    { ask:'Petit jeu : si tu étais un doudou, tu serais lequel ? Tout mou, ou plutôt tout ferme pour les gros câlins ?', rep:['Tout mou','Ferme pour les câlins'], react:['Un doudou tout mou, comme moi j\'aime ! On serait bien assortis.','Ferme pour les câlins, j\'adore ! Solide et réconfortant.'] },
    { ask:'On fait un jeu du calme ? On voit qui reste le plus tranquille... Prêt ? Chuuut... 🤫', rep:['Chuuut 🤫','J\'ai bougé !'], react:['Trop fort, t\'es un vrai maître du calme ! Ça détend, hein ?','Ha, t\'as bougé ! Moi aussi en vrai. On rigole trop pour ça ! 😄'] },
    { ask:'Cache-cache avec mon doudou ! Il est caché... à ton avis, sous la couverture ou derrière le coussin ?', rep:['Sous la couverture','Derrière le coussin'], react:['Bravo, trouvé ! Il adore se cacher là. 🦊','Presque ! Il avait bougé. Petit malin de doudou !'] }
  ];
  const FOXY_MOODWORDS = [
    'Je me sens tout pelucheux et content aujourd\'hui. Et toi, c\'est quoi ta couleur du jour ?',
    'Aujourd\'hui je suis d\'humeur câline. J\'ai envie de rester blotti. Toi, tu te sens comment ?',
    'Moi je pétille aujourd\'hui, j\'ai plein d\'énergie douce ! Et dans ton cœur, il fait quel temps ?'
  ];

  // moteur de spontanéité : Foxy prend une initiative au lieu de juste répondre
  async function foxySpontaneous(m) {
    const roll = Math.random();
    if (roll < 0.3 && m.key === 'reveil') {
      await imSay(pick(FOXY_DREAMS), 1000, 'happy');
      await imSay(bro('Bon, assez rêvassé ! Contente-moi : dis-moi bonjour comme il faut. 🦊', 'Voilà mon rêve... Allez, dis-moi bonjour. Tu en avais envie de toute façon, non ? 🦊'), 800, 'joy');
      await imOfferHelp(m); return true;
    }
    if (roll < 0.6) {
      // un petit jeu — en grand frère : joueur mais il mène, sans forcer
      const g = pick(FOXY_GAMES);
      await imSay(broOn() ? 'On va jouer, toi et moi... Tu vas adorer, tu ne pourras pas t\'en empêcher. ' + g.ask : g.ask, 900, 'joy');
      imSetActions([
        { label:g.rep[0], onClick: async () => { imAddMe(g.rep[0]); await imSay(g.react[0], 800, 'laugh'); await imOfferHelp(m); } },
        { label:g.rep[1], onClick: async () => { imAddMe(g.rep[1]); await imSay(g.react[1], 800, 'happy'); await imOfferHelp(m); } }
      ]); return true;
    }
    if (roll < 0.8) {
      await imSay(bro('Attends, faut que je te dise un truc, comme ça, spontanément...', 'Reste un instant... j\'ai quelque chose à te confier. Écoute, laisse-toi porter.'), 850, 'teach');
      try { await maybeIntroReward(true); } catch(e) {}
      await imOfferHelp(m); return true;
    }
    // parfois, une manie personnelle de Foxy
    if (await maybeQuirk()) { await imOfferHelp(m); return true; }
    // une météo intérieure (reste douce même en grand frère : touche l'émotionnel)
    await imSay(pick(FOXY_MOODWORDS), 900, 'pensive');
    imSetActions([
      { label:'☀️ Plutôt ensoleillé', onClick: async () => { imAddMe('Ensoleillé'); await imSay('Ahh, du soleil dans ton cœur, ça me réchauffe ! Garde-le bien. ☀️🦊', 800, 'joy'); await imOfferHelp(m); } },
      { label:'🌥️ Un peu nuageux', onClick: async () => { imAddMe('Nuageux'); await imSay('Un peu nuageux, ça arrive. Je reste près de toi, on attend l\'éclaircie ensemble. 🦊💛', 850, 'concern'); await imOfferHelp(m); } },
      { label:'🌧️ Pluvieux', onClick: async () => { imAddMe('Pluvieux'); await imSay('Oh... viens là. Les jours de pluie, on se blottit et on attend que ça passe. Je suis là. 🌧️🦊', 900, 'concern'); await imOfferHelp(m); } }
    ]); return true;
  }

  // ===== Journal intime guidé =====
  const JOURNAL_PROMPTS = [
    'Raconte-moi ta journée en quelques mots, si tu veux. Je t\'écoute.',
    'Qu\'est-ce qui t\'a fait du bien aujourd\'hui ? Écris-le pour moi.',
    'Y a-t-il un moment de la journée que tu veux garder en mémoire ? Dis-le-moi.',
    'Comment tu te sens, là, vraiment ? Prends le temps de l\'écrire.',
    'Un mot, une phrase, ce que tu veux... qu\'est-ce qui te traverse le cœur en ce moment ?'
  ];
  async function startJournal(m) {
    await imSay(pick(JOURNAL_PROMPTS), 900, 'pensive');
    await imSay('(écris-moi dans la barre en bas, tout ce que tu veux — ça restera dans notre carnet)', 700, 'happy');
    journalWaiting = true; // le prochain message libre sera capté comme entrée de journal
  }
  let journalWaiting = false;
  async function saveJournalEntry(text) {
    const q = await getQuest();
    q.journal = q.journal || [];
    q.journal.push({ t: new Date().toISOString(), text });
    await saveQuest(q);
  }

  // ===== Rituel du soir émotionnel =====
  async function eveningRitual(m) {
    await imSay('La journée touche à sa fin... Prenons un petit moment rien que nous deux, tu veux ?', 950, 'pensive');
    await imSay('Dis-moi : une chose douce que tu as vécue aujourd\'hui, même toute petite ?', 950, 'happy');
    imSetActions([
      { label:'✍️ L\'écrire à Foxy', onClick: async () => { imAddMe('Je l\'écris.'); await imSay('Oui, écris-la-moi... je la garderai précieusement. 🦊', 800, 'happy'); journalWaiting = true; } },
      { label:'🤔 Je réfléchis...', onClick: async () => { imAddMe('Je réfléchis...'); await imSay('Prends ton temps. Même une toute petite chose compte — un rayon de soleil, un moment de calme.', 900, 'pensive'); await eveningRitualClose(m); } },
      { label:'Rien de spécial', onClick: async () => { imAddMe('Rien de spécial.'); await imSay('C\'est ok. Certains jours sont juste... des jours. Et tu les as traversés, c\'est déjà beau.', 950, 'concern'); await eveningRitualClose(m); } }
    ]);
  }
  async function eveningRitualClose(m) {
    // Foxy commente le respect du cadre des serrures sur la journée
    try {
      const checks = await getChecks(todayStr());
      const open = checks.filter(c => c.result === 'lock_open').length;
      const refus = checks.filter(c => c.result === 'lock_denied' || c.result === 'lock_quota').length;
      const urg = checks.filter(c => c.result === 'lock_emergency').length;
      if (open || refus || urg) {
        let txt;
        if (urg) txt = 'Côté serrures : ' + open + ' ouverture(s), et ' + urg + ' en urgence. Ça arrive, mais on garde ça exceptionnel, d\'accord ?';
        else if (refus) txt = 'Côté serrures : ' + open + ' ouverture(s), et ' + refus + ' fois où le cadre t\'a arrêté. Tu as tenu, c\'est ça qui compte.';
        else txt = 'Côté serrures : ' + open + ' ouverture(s), toutes dans les règles. Tu as respecté le cadre aujourd\'hui, bravo.';
        await imSay(txt, 900, urg ? 'pensive' : 'happy');
      }
    } catch(e) {}
    await imSay('Et maintenant, dépose ce qui pèse. Laisse la journée derrière toi, tu n\'as plus rien à porter.', 1000, 'concern');
    await imSay('Je veille sur toi cette nuit. Fais de beaux rêves, mon compagnon. À demain. 🦊💛', 950, 'sleep');
    await imOfferHelp(m);
  }

  // récompense : parfois un souvenir de Foxy à la fin d'un échange profond
  // Confidences de Foxy — stock dédié aux discussions introspectives (indépendant du feuilleton)
  const FOXY_CONFIDENCES = [
    'Tu sais, avant, je n\'osais jamais m\'écouter. Ce voyage m\'a appris à le faire. C\'est un cadeau que je me suis fait.',
    'Il y a eu un soir où j\'ai pleuré, tout seul dans mon terrier. Pas de tristesse — juste le soulagement d\'enfin m\'accepter.',
    'Mon doudou, je lui parlais à voix basse les nuits difficiles. Ça peut paraître bête, mais ça m\'a tenu.',
    'J\'ai compris un truc pendant mon mois : la force, c\'est pas de tout contrôler. C\'est d\'oser être doux avec soi.',
    'Le regard des autres m\'a longtemps terrifié. Et un jour j\'ai réalisé que le seul regard qui comptait, c\'était le mien.',
    'Il m\'arrive encore de repenser à mon mois avec tendresse. C\'est là que j\'ai appris à m\'aimer un peu, je crois.',
    'Au début je croyais que je « faisais » quelque chose de spécial. En fait, je me contentais d\'être moi. Enfin.',
    'La nuit où j\'ai arrêté de compter les jours, j\'ai su que j\'avais gagné. Je vivais, tout simplement.',
    'Personne ne m\'a forcé, personne ne m\'a jugé. Juste moi, mon rythme, et beaucoup de douceur. C\'est ce que je te souhaite.',
    'Tu veux savoir mon plus grand apprentissage ? Que mériter de la tendresse, ça ne se prouve pas. On y a droit, point.',
    'Un jour j\'ai voulu boire tout mon biberon d\'un coup pour battre un record... j\'ai eu le hoquet pendant une heure ! 🤭',
    'J\'ai déjà caché mon doudou dans le frigo pour « le rafraîchir » un jour de canicule. Ma tête quand je l\'ai retrouvé tout froid ! 😂',
    'Une fois j\'ai décoré ma couche avec des autocollants étoiles avant de la mettre. Résultat : des étoiles collées partout sauf sur la couche !',
    'Pendant une sieste, j\'ai fait semblant de dormir pour espionner... et je me suis endormi pour de vrai. Raté, l\'espionnage !',
    'J\'ai essayé de faire des châteaux avec mes cubes en équilibre sur mon ventre, allongé. Ça s\'est écroulé sur mon museau à chaque fois. J\'ai adoré. 🦊',
    'Un matin j\'ai mis ma grenouillère à l\'envers sans m\'en rendre compte et j\'ai passé la moitié de la journée comme ça. On s\'en fiche, j\'étais confortable !',
    'J\'ai déjà fait la course à quatre pattes contre mon ombre. Spoiler : mon ombre a gagné. Match revanche prévu !',
    'Mon jeu préféré c\'était de faire crisser ma couche exprès en gigotant. Le petit bruit me faisait rire à tous les coups. Essaie, tu verras ! 🤭',
    'Une fois j\'ai empilé TOUS mes doudous pour dormir dessus comme un roi. Je suis tombé du tas au milieu de la nuit. Zéro regret. 😴',
    'J\'ai voulu peindre un arc-en-ciel et j\'ai fini plus coloré que le dessin. Maman renarde a bien rigolé en me débarbouillant.',
    'Des fois je parlais à mes cubes ABCD comme s\'ils étaient mes copains. Ils étaient d\'excellents auditeurs, très patients ! 🎲',
    'Tu sais comment j\'ai arrêté d\'y penser ? Un jour, en pleine partie de cubes, j\'ai réalisé que j\'étais mouillé depuis des heures... et que je m\'en fichais complètement. J\'ai souri tout seul.',
    'Au début, chaque fois que ma couche se mouillait, tout mon corps se raidissait une seconde. Et puis un matin, plus rien ne se raidissait. C\'était devenu doux, juste doux.',
    'Le truc qui m\'a rassuré, c\'est de sentir que je restais au sec contre la peau même après longtemps. La couche gardait tout le mouillé pour elle. Je me sentais protégé, comme dans un petit nid.',
    'J\'ai mis du temps à comprendre que « mouillé » pouvait rimer avec « bien ». Maintenant, cette petite chaleur douce, c\'est presque un câlin de l\'intérieur. 🦊',
    'Mon secret contre l\'angoisse du début ? Serrer mon doudou très fort à chaque fois. Petit à petit, mon corps a associé la sensation à ces câlins. Et la peur a fondu.'
  ];

  async function maybeIntroReward(force) {
    if (!force && Math.random() >= 0.5) return;
    const q = await getQuest();
    q.confidences = q.confidences || [];
    const remaining = FOXY_CONFIDENCES.filter(c => !q.confidences.includes(c));
    if (!remaining.length) {
      // stock épuisé : on retombe sur le feuilleton du jour si dispo
      await imSay('Je t\'ai déjà confié pas mal de choses, tu sais tout de moi ou presque ! 🦊', 800, 'happy');
      return;
    }
    const conf = remaining[Math.floor(Math.random()*remaining.length)];
    q.confidences.push(conf);
    await saveQuest(q);
    const intros = [
      'Tiens... je vais te confier quelque chose.',
      'Oh, ça me fait penser à un truc, écoute !',
      'Je t\'ai jamais raconté celle-là, je crois...',
      'Entre nous, faut que je te dise un truc.',
      'Attends, faut absolument que je te raconte !'
    ];
    await imSay(intros[Math.floor(Math.random()*intros.length)], 900, 'joy');
    await imSay('« ' + conf + ' »', 1100, 'happy');
    await imSay('Voilà. Merci de m\'écouter, ça reste dans notre aventure. 🦊💛', 850, 'happy');
  }

  async function foxyHandleInput(raw) {
    const text = (raw || '').trim();
    if (!text) return;
    // SAFEWORD : coupe tout, ramène le Foxy doux (priorité absolue)
    const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if (broOn() && (norm.includes('stop foxy') || norm === 'stop' || norm.includes('safeword'))) {
      imAddMe(text);
      const inp0 = document.getElementById('imTalkInput'); if (inp0) inp0.value = '';
      await triggerSafeword();
      return;
    }
    imAddMe(text);
    const inp = document.getElementById('imTalkInput'); if (inp) inp.value = '';
    // si Foxy attend une entrée de journal, on la capte
    if (journalWaiting) {
      journalWaiting = false;
      await saveJournalEntry(text);
      await imSay(pick([
        'Merci de m\'avoir confié ça. Je le range précieusement dans notre carnet. 🦊💛',
        'C\'est noté, mot pour mot. Ces petits bouts de toi, je les garde comme des trésors.',
        'Voilà, c\'est dans notre carnet à nous. Merci de m\'ouvrir ton cœur comme ça.'
      ]), 900, 'happy');
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    const intent = detectIntent(text);
    const ana = analyzeText(text);
    if (!intent) {
      // repli enrichi : si on a repéré un sujet, Foxy rebondit dessus
      if (ana.sujet) {
        const REBOND = {
          couche:'Tu me parles de ta couche... dis-m\'en plus, elle est comment là ?',
          biberon:'Ton biberon, oui ! Tu en es où de ton hydratation aujourd\'hui ?',
          sieste:'Le sommeil, hein... tu as bien récupéré ces temps-ci ?',
          tetine:'Ta tétine ? Elle est près de toi j\'espère.',
          contention:'La contention... tu te sens bien contenu en ce moment ?',
          peau:'Ta peau, c\'est important. Elle va bien ? Pas de rougeur ?',
          change:'Un change ? Dis-moi si tu veux qu\'on s\'en occupe ensemble.'
        };
        await imSay(REBOND[ana.sujet], 800, 'pensive');
      } else {
        await imSay(pick(FOXY_FALLBACK), 700, 'pensive');
      }
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    // négation : « je n'ai pas peur » ne doit pas déclencher la branche peur
    if (ana.negated && ['peur','triste','fatigue'].includes(intent.id)) {
      await imSay(broOn()
        ? 'Tu me dis que non... j\'entends. Mais je reste attentif, on ne se ment pas entre nous.'
        : 'Ah, tant mieux alors ! Je préfère ça. Mais tu sais que je suis là si jamais. 🦊', 800, 'happy');
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    // mémorise le sujet émotionnel abordé
    try { if (['peur','triste','fatigue','fier','calin'].includes(intent.id)) await rememberTopic(intent.id, text.slice(0,120)); } catch(e) {}
    if (intent.action === 'change') {
      await imSay(pick(intent.rep), 700, intent.expr);
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    if (intent.action === 'nextstep') {
      await imSay(nextStepText(), 800, 'explain');
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    if (intent.action === 'story') {
      await imSay('Avec plaisir, laisse-moi te raconter...', 700, 'teach');
      await tellTodaySubchapter();
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    await maybeHesitate();
    await imSay(humanize(pick(intent.rep)), 800, intent.expr);
    // nuance selon l'intensité exprimée
    if (ana.intensity === 'fort' && ['peur','triste','fatigue'].includes(intent.id)) {
      await imSay(broOn()
        ? 'Et là c\'est fort, je le sens. Raison de plus pour arrêter de lutter et te laisser porter.'
        : 'Et je vois que c\'est costaud là. Viens, on prend le temps qu\'il faut, je bouge pas. 🦊💛', 900, 'concern');
    } else if (ana.intensity === 'faible' && ['peur','triste','fatigue'].includes(intent.id)) {
      await imSay('Un petit peu seulement, ok. Ça reste gérable alors — mais je garde un œil sur toi.', 800, 'neutral');
    }
    // relance : Foxy rebondit au lieu de laisser mourir l'échange
    if (voiceMode === 'foxy') { try { await maybeRelance(); } catch(e) {} }
    if (currentM) await imOfferHelp(currentM); // les boutons reviennent toujours
  }
  // câblage du champ "Parler à Foxy"
  document.addEventListener('DOMContentLoaded', () => {
    const send = document.getElementById('imTalkSend');
    const inp = document.getElementById('imTalkInput');
    if (send) send.addEventListener('click', () => foxyHandleInput(inp ? inp.value : ''));
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') foxyHandleInput(inp.value); });
  });

  function toggleFormImmersive() {
    // en immersif, le formulaire de bilan reste accessible : on repasse un instant en reporting visuel du form
    const formCard = document.getElementById('formCard');
    formCard.style.display = '';
    formCard.style.cssText += ';display:block !important';
    toggleForm(true);
    formCard.scrollIntoView({behavior:'smooth', block:'start'});
  }
  function applyVoiceChrome() {
    const btn = document.getElementById('toggleVoice');
    if (btn) {
      btn.textContent = voiceMode === 'foxy' ? '📋 Reporting' : '🦊 Mode Foxy';
    }
    const sub = document.querySelector('.head p');
    if (sub) sub.textContent = voiceMode === 'foxy' ? 'T\'inquiète, on est passés par là ensemble'
      : 'Immersion 24/7 · mon tableau de suivi';
    document.body.classList.toggle('immersive', immersive);
    document.body.classList.toggle('foxy', voiceMode === 'foxy');
    document.body.classList.toggle('report', voiceMode === 'report');
    if (immersive) {
      const p = persona();
      const av = document.querySelector('#imChat .im-avatar');
      const who = document.querySelector('#imChat .who');
      const st = document.getElementById('imStatus');
      const hd = document.querySelector('#imChat .im-head');
      if (av) { av.textContent = p.avatar; av.style.background = p.grad; }
      if (who) { who.textContent = p.name; who.style.color = p.whoColor; }
      if (st) { st.style.color = p.statusColor; }
      if (hd) { hd.style.background = p.headbg; }
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const t = document.getElementById('toggleVoice');
    if (t) t.addEventListener('click', () => {
      setVoiceMode(voiceMode === 'foxy' ? 'report' : 'foxy');
    });
    const stage = document.getElementById('rpgStage');
    if (stage) stage.addEventListener('click', () => { if (rpgAdvance) rpgAdvance(); });
    const fsend = document.getElementById('foxySend');
    const finput = document.getElementById('foxyInput');
    if (fsend) fsend.addEventListener('click', () => foxyHandleInput(finput.value));
    if (finput) finput.addEventListener('keydown', (e) => { if (e.key === 'Enter') foxyHandleInput(finput.value); });
  });

  const skinColors = { verte: 'var(--green)', surveiller: 'var(--amber)', traiter: 'var(--coral)' };
  const skinShort = { verte: '🐾', surveiller: '!', traiter: '⚠' };
  const skinLabel = { verte: 'Verte', surveiller: 'À surveiller', traiter: 'À traiter' };
  const nuitLabel = { ok: 'Nuit au sec', limite: 'Nuit limite', fuite: 'Nuit — fuite' };

  const sel = {}; // current form selections
  const groups = ['skin','bib','nuit','type'];

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0,10);
  }

  function wireGroup(id) {
    const box = document.getElementById(id);
    box.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        sel[id] = btn.dataset.v;
      });
    });
  }
  groups.forEach(wireGroup);

  function resetForm() {
    groups.forEach(id => {
      document.getElementById(id).querySelectorAll('button').forEach(b => b.classList.remove('on'));
      delete sel[id];
    });
    document.getElementById('note').value = '';
  }

  function loadInto(entry) {
    resetForm();
    if (!entry) return;
    const map = { skin:'skin', bib:'bib', nuit:'nuit', type:'type' };
    Object.keys(map).forEach(id => {
      const v = entry[id];
      if (v === undefined || v === null) return;
      const btn = document.querySelector('#'+id+' button[data-v="'+v+'"]');
      if (btn) { btn.classList.add('on'); sel[id] = String(v); }
    });
    document.getElementById('note').value = entry.note || '';
  }

  async function getAll() {
    let entries = [];
    try {
      const res = await window.storage.list('day:');
      const keys = (res && res.keys) ? res.keys : [];
      for (const k of keys) {
        try {
          const r = await window.storage.get(k);
          if (r && r.value) entries.push(JSON.parse(r.value));
        } catch(e) {}
      }
    } catch(e) {}
    entries.sort((a,b) => a.date < b.date ? 1 : -1);
    return entries;
  }

  function renderStrip(entries) {
    const byDate = {};
    entries.forEach(e => byDate[e.date] = e);
    const strip = document.getElementById('strip');
    strip.innerHTML = '';
    // 30 cells: today is last, going back 29 days
    const cells = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      cells.push(d.toISOString().slice(0,10));
    }
    cells.forEach(date => {
      const e = byDate[date];
      const cell = document.createElement('div');
      cell.className = 'cell' + (date === todayStr() ? ' today' : '');
      if (e && e.skin) {
        cell.style.background = skinColors[e.skin];
        cell.textContent = skinShort[e.skin];
      }
      const dd = date.slice(8,10) + '/' + date.slice(5,7);
      cell.title = dd + (e && e.skin ? ' — ' + skinLabel[e.skin] : ' — non rempli');
      strip.appendChild(cell);
    });
  }

  // libellé lisible pour n'importe quel résultat de check/vérif
  function labelResult(res) {
    if (!res) return '';
    const map = {
      ok:'couche en place', adj:'couche réajustée', miss:'sans couche', fixed:'remise en couche',
      sec:'sèche', mouille:'mouillée', sature:'saturée',
      etat_sec:'sèche', etat_mouille:'mouillée', etat_sature:'saturée',
      change_fait:'change effectué',
      tet_ok:'tétine en bouche', tet_prise:'tétine reprise', tet_miss:'tétine absente',
      reveil_sec:'nuit au sec', reveil_mouille:'nuit mouillée', reveil_fuite:'fuite la nuit',
      matin_ok:'matinée OK', matin_change:'à changer', matin_soif:'pas hydraté',
      aprem_ok:'après-midi OK', aprem_sieste:'sieste faite', aprem_change:'à changer',
      soir_ok:'soir OK', soir_bilan:'bilan lancé', soir_souci:'peau à surveiller',
      nuit_ok:'nuit OK', nuit_change:'change nocturne',
      lock_open:'serrure ouverte', lock_denied:'ouverture refusée', lock_quota:'quota serrure atteint', lock_emergency:'ouverture d\'URGENCE'
    };
    return map[res] || res;
  }
  function resultColor(res) {
    if (['miss','sature','etat_sature','tet_miss','reveil_fuite','soir_souci','lock_quota','lock_emergency'].includes(res)) return 'var(--coral)';
    if (['adj','mouille','etat_mouille','matin_change','aprem_change','matin_soif','lock_denied'].includes(res)) return 'var(--amber)';
    return 'var(--green)';
  }
  function fmtClock(iso) {
    try { const d = new Date(iso); return String(d.getHours()).padStart(2,'0')+'h'+String(d.getMinutes()).padStart(2,'0'); } catch(e) { return ''; }
  }

  async function renderHistory(entries) {
    const box = document.getElementById('history');
    box.innerHTML = '';

    // rassemble tous les jours : ceux avec un rapport + ceux avec seulement des checks
    const byDate = {}; entries.forEach(e => byDate[e.date] = e);
    const dateSet = new Set(Object.keys(byDate));
    // scanne les 30 derniers jours pour des checks isolés
    for (let i = 0; i < 31; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const ds = d.toISOString().slice(0,10);
      const checks = await getChecks(ds);
      if (checks.length) dateSet.add(ds);
    }
    const allDates = Array.from(dateSet).sort((a,b)=> a<b?1:-1); // récent en haut

    if (!allDates.length) {
      box.innerHTML = '<div class="empty-msg">Aucune entrée pour l\'instant. Ta première journée s\'affichera ici.</div>';
      return;
    }

    for (const date of allDates) {
      const e = byDate[date] || null;
      const checks = await getChecks(date);
      const div = document.createElement('div');
      div.className = 'entry';
      const dObj = new Date(date + 'T12:00:00');
      const dtxt = dObj.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });

      const typeBadge = e && e.type === 'supervise'
        ? '<span class="badge sup">Supervisée</span>'
        : (e && e.type === 'solo' ? '<span class="badge solo">Solo</span>' : '');
      const skinPill = e && e.skin
        ? '<span class="pill" style="background:'+skinColors[e.skin]+'">'+skinLabel[e.skin]+'</span>'
        : '';
      const bits = [];
      if (e && e.bib !== undefined) bits.push('🍼 '+e.bib+'/3');
      if (e && e.nuit) bits.push(nuitLabel[e.nuit]);
      if (checks.length) bits.push('✅ '+checks.length+' check'+(checks.length>1?'s':''));
      // résumé automatique des serrures du jour (ouvertures / refus, par serrure)
      const lockEvents = checks.filter(c => ['lock_open','lock_denied','lock_quota','lock_emergency'].includes(c.result));
      if (lockEvents.length) {
        const perLock = {};
        lockEvents.forEach(c => {
          const nom = (c.type && c.type.indexOf('serrure:') === 0) ? c.type.slice(8) : 'serrure';
          if (!perLock[nom]) perLock[nom] = { open:0, refus:0 };
          if (c.result === 'lock_open') perLock[nom].open++;
          else if (c.result === 'lock_emergency') { perLock[nom].open++; perLock[nom].urgence = (perLock[nom].urgence||0)+1; }
          else perLock[nom].refus++;
        });
        const parts = Object.keys(perLock).map(n => {
          const q = perLock[n];
          return n + ' ' + q.open + '🔓' + (q.refus ? ' / ' + q.refus + '⛔' : '') + (q.urgence ? ' / ' + q.urgence + '🆘' : '');
        });
        bits.push('🔐 ' + parts.join(' · '));
      }

      // détail des checks (repliable)
      let checksHtml = '';
      if (checks.length) {
        const rows = checks.map(c => {
          const time = c.t ? fmtClock(c.t) : '';
          const col = resultColor(c.result);
          // pour les événements de serrure, on affiche son nom (type = "serrure:<nom>")
          let extra = '';
          if (c.type && c.type.indexOf('serrure:') === 0) {
            extra = ' <span style="color:var(--muted)">— ' + c.type.slice(8).replace(/</g,'&lt;') + '</span>';
          }
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;font-weight:600">'
            + '<span style="color:var(--muted);width:44px;flex:none">'+time+'</span>'
            + '<span style="width:8px;height:8px;border-radius:50%;background:'+col+';flex:none"></span>'
            + '<span>'+labelResult(c.result)+extra+'</span></div>';
        }).join('');
        checksHtml = '<div class="check-detail" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">'+rows+'</div>';
      }

      div.innerHTML =
        '<div class="top"><span class="date">'+dtxt+'</span>'+skinPill+typeBadge+'</div>'+
        (bits.length ? '<div class="meta">'+bits.join(' · ')+'</div>' : '')+
        (e && e.note ? '<div class="note">« '+e.note.replace(/</g,'&lt;')+' »</div>' : '')+
        (checks.length ? '<button class="hist-toggle" style="margin-top:6px;background:none;border:none;color:var(--blue-deep);font-family:inherit;font-size:11.5px;font-weight:800;cursor:pointer;padding:0">▸ Voir les '+checks.length+' check'+(checks.length>1?'s':'')+'</button>' : '')+
        checksHtml;

      // toggle détail checks
      const tgl = div.querySelector('.hist-toggle');
      if (tgl) {
        tgl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const det = div.querySelector('.check-detail');
          const open = det.style.display !== 'none';
          det.style.display = open ? 'none' : 'block';
          tgl.textContent = (open ? '▸ Voir les ' : '▾ Masquer les ') + checks.length + ' check' + (checks.length>1?'s':'');
        });
      }

      // clic sur l'entrée = éditer le rapport (si un rapport existe ou pour en créer un)
      div.style.cursor = 'pointer';
      div.title = 'Cliquer pour recharger et modifier ce jour';
      div.addEventListener('click', () => {
        document.getElementById('dateInput').value = date;
        if (e) loadInto(e); else resetForm();
        const formCard = document.getElementById('formCard');
        formCard.style.display = '';
        toggleForm(true);
        document.getElementById('formSub').textContent = (e?'Modification':'Nouveau rapport') + ' du ' + dtxt + '.';
        formCard.scrollIntoView({ behavior:'smooth', block:'start' });
      });
      box.appendChild(div);
    }
  }

  async function refresh() {
    const entries = await getAll();
    renderStrip(entries);
    await renderHistory(entries);
    const filled = entries.length;
    document.getElementById('histSub').textContent =
      filled ? filled + ' jour' + (filled>1?'s':'') + ' enregistré' + (filled>1?'s':'') + ' sur le mois.'
             : 'Tes journées enregistrées apparaîtront ici.';
    await renderDashboard(entries);
    await renderWear();
    await renderSince();
    renderTimeline();
  }

  // Depuis combien de temps la couche actuelle est portée (dernier change enregistré)
  async function lastChangeTime() {
    // cherche le change_fait le plus récent sur les 2 derniers jours
    let latest = null;
    for (let i = 0; i < 2; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const list = await getChecks(d.toISOString().slice(0,10));
      list.forEach(c => {
        if ((c.result === 'change_fait' || c.result === 'change_fait_sanspreuve') && c.t) {
          const t = new Date(c.t);
          if (!latest || t > latest) latest = t;
        }
      });
    }
    return latest;
  }

  function sinceComment(hours, isNight, ctx) {
    if (isNight) {
      return { expr:'sleep', cls:'ok', say:'Foxy dort à poings fermés... la couche de nuit fait son travail. Chut. 😴' };
    }
    ctx = ctx || {};
    // ===== ALERTES (toujours prioritaires) =====
    // MODE INTENSIF : port prolongé (mouillée/saturée gardée trop longtemps)
    if (hardMode && hours != null && ctx.state !== 'sec') {
      if (hours >= HARD.wearCapH) {
        return { expr:'surprised', cls:'long',
          say:'STOP. Ça fait beaucoup trop longtemps que tu portes cette couche. On ne discute pas : tu vas te changer MAINTENANT. C\'est pour ta peau, et je ne te lâche pas là-dessus. 🦊' };
      }
      if (hours >= HARD.wearAlertH) {
        return { expr:'concern', cls:'long',
          say:'Écoute-moi bien : ça fait un sacré moment maintenant. Tu tiens le cadre, c\'est bien, mais là il faut penser à changer. Ne pousse pas trop, ta peau compte plus que le record.' };
      }
    }
    // couche sèche depuis plus de 3h de port → travail du lâcher-prise
    if (ctx.state === 'sec' && hours != null && hours >= 3) {
      return { expr:'concern', cls:'long',
        say: broOn()
          ? 'Encore sèche... Tu luttes toujours, je le sens. Mais tu sais bien que c\'est vain. Tu vas finir par lâcher, c\'est inévitable — alors laisse-toi aller, doucement. Ça viendra tout seul.'
          : (hardMode
          ? 'Sèche, encore ? Là tu te retiens, et en mode intensif je ne te laisse pas passer ça. Concentre-toi, relâche, c\'est le cœur du travail. Je sais que tu peux mieux faire.'
          : 'Dis donc... ta couche est encore sèche après tout ce temps. Tu te retiens sans t\'en rendre compte. Rappelle-toi : ici on apprend à lâcher prise, pas à se contrôler. Détends-toi, laisse venir quand ça vient. Tu es en sécurité, je suis là. 🦊') };
    }
    // change obligatoire dépassé et NON fait → inquiet
    if (ctx.overdue) {
      return { expr:'concern', cls:'long',
        say: hardMode
          ? 'L\'heure est passée et tu n\'as pas changé. En mode intensif, ça ne se laisse pas traîner — allez, debout, on s\'en occupe tout de suite. Tu vaux mieux que ce relâchement.'
          : 'Hé... l\'heure de ton change est passée et tu ne l\'as pas encore fait. Tout va bien ? Va vite t\'en occuper, je m\'inquiète un peu pour ta peau !' };
    }
    // ===== COMPORTEMENT NORMAL =====
    // 1h30 ou moins avant le prochain change → excité
    if (ctx.minToNext != null && ctx.minToNext <= 90) {
      return { expr:'joy', cls:'mid',
        say:'On approche de l\'heure du change, j\'ai hâte ! Prépare-toi, ça arrive bientôt. 🎉' };
    }
    // fourchette normale → content
    return { expr:'happy', cls:'ok',
        say:'Tout roule, on est dans le bon rythme ! Ta couche fait son job, profite bien.' };
  }

  // calcule le contexte des piliers : proximité du prochain + retard réel (non fait)
  async function pillarContext() {
    const PILIERS = [ { m:9*60, key:'c0900' }, { m:16*60, key:'c1600' }, { m:22*60+30, key:'c2230' } ];
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const next = PILIERS.find(p => p.m > nowMin);
    const prev = [...PILIERS].reverse().find(p => p.m <= nowMin);
    const minToNext = next != null ? next.m - nowMin : (24*60 - nowMin) + PILIERS[0].m;
    let overdue = false;
    if (prev != null) {
      const since = nowMin - prev.m;
      // vigilance renforcée (après une pause longue) → tolérance réduite de moitié
      let tol = hardMode ? HARD.overdueMin : 15;
      try {
        const rv = await window.storage.get('vigilance:until');
        if (rv && rv.value && Date.now() < JSON.parse(rv.value)) tol = Math.max(2, Math.round(tol/2));
      } catch(e) {}
      if (since >= tol && since <= 120) {
        // le pilier est-il déjà fait aujourd'hui ?
        try {
          const r = await window.storage.get('slotdone:'+todayStr());
          const done = (r && r.value) ? JSON.parse(r.value) : {};
          overdue = !done[prev.key];
        } catch(e) { overdue = true; }
      }
    }
    return { minToNext, overdue };
  }

  async function renderSince() {
    const portrait = document.getElementById('sincePortrait');
    const timeEl = document.getElementById('sinceTime');
    const sayEl = document.getElementById('sinceSay');
    const nextEl = document.getElementById('sinceNext');
    const stateEl = document.getElementById('sinceState');
    if (!timeEl) return;
    const last = await lastChangeTime();
    // statut couche = dernier état rapporté (après le dernier change)
    if (stateEl) stateEl.innerHTML = await renderDiaperState(last);
    if (!last) {
      positionFoxyCell(portrait, 'pensive', 88);
      timeEl.className = 'since-time';
      timeEl.textContent = '—';
      sayEl.textContent = 'Pas encore de change enregistré via l\'appli. Fais ton premier change guidé et je compte le temps pour toi !';
      if (nextEl) nextEl.innerHTML = renderNextChange();
      return;
    }
    const now = new Date();
    const hours = (now - last) / 3600000;
    const h = Math.floor(hours), min = Math.floor((hours - h) * 60);
    const isNight = now.getHours() >= 23 || now.getHours() < 7;
    const ctx = await pillarContext();
    ctx.state = await currentDiaperState(last);
    const c = sinceComment(hours, isNight, ctx);
    positionFoxyCell(portrait, c.expr, 88);
    timeEl.className = 'since-time ' + c.cls;
    timeEl.textContent = (h > 0 ? h + 'h' + (min < 10 ? '0'+min : min) : min + ' min');
    sayEl.textContent = c.say;
    if (nextEl) nextEl.innerHTML = renderNextChange();
  }

  // statut de couche = dernier état rapporté (etat_*/sec/mouille/sature), postérieur au dernier change
  async function currentDiaperState(lastChange) {
    const stateResults = { etat_sec:'sec', etat_mouille:'mouille', etat_sature:'sature', sec:'sec', mouille:'mouille', sature:'sature' };
    let latest = null, latestT = null;
    for (let i = 0; i < 2; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const list = await getChecks(d.toISOString().slice(0,10));
      list.forEach(c => {
        if (c.t && stateResults[c.result]) {
          const t = new Date(c.t);
          if (!latestT || t > latestT) { latestT = t; latest = stateResults[c.result]; }
        }
      });
    }
    if (lastChange && (!latestT || lastChange >= latestT)) latest = 'sec';
    return latest; // 'sec' | 'mouille' | 'sature' | null
  }

  async function renderDiaperState(lastChange) {
    const latest = await currentDiaperState(lastChange);
    if (!latest) return '<span class="lbl" style="font-size:11.5px;font-weight:700;color:var(--muted)">Statut inconnu — fais un check</span>';
    const LABEL = { sec:'☀️ Couche sèche', mouille:'💧 Couche mouillée', sature:'🌊 Couche saturée' };
    return '<span class="lbl" style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">Statut&nbsp;: </span><span class="pill '+latest+'">'+LABEL[latest]+'</span>';
  }

  // temps restant avant le prochain change obligatoire (piliers 9h, 16h, 22h30)
  function renderNextChange() {
    const PILIERS = [
      { m: 9*60,      label:'change du matin' },
      { m: 16*60,     label:'change de sortie de sieste' },
      { m: 22*60+30,  label:'change de nuit' }
    ];
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    let next = PILIERS.find(p => p.m > nowMin);
    let dayLabel = "aujourd'hui";
    if (!next) { next = PILIERS[0]; dayLabel = 'demain'; } // prochain = matin de demain
    let diff = next.m - nowMin;
    if (dayLabel === 'demain') diff = (24*60 - nowMin) + next.m;
    const hh = Math.floor(diff/60), mm = diff%60;
    const rem = (hh > 0 ? hh + 'h' + (mm<10?'0'+mm:mm) : mm + ' min');
    const at = Math.floor(next.m/60) + 'h' + (next.m%60 ? String(next.m%60).padStart(2,'0') : '');
    return '<span class="lbl">🔑 Prochain change dans</span> ' + rem + ' <span class="lbl">(' + next.label + ' à ' + at + ' ' + dayLabel + ')</span>';
  }
  // met à jour le compteur régulièrement
  setInterval(() => { renderSince(); renderTimeline(); maybeRedirectBilan(); checkLockAlerts(); foxyPing(); foxyMilestones(); }, 60000);

  /* ============================================================
     FOXY T'INTERPELLE — il prend l'initiative dans la journée
     Notifications spontanées avec sa voix, à des moments choisis.
     Jamais la nuit, jamais en pause, espacées d'au moins 90 min.
     ============================================================ */
  const PING_POOLS = {
    // petites pensées sans objet précis
    pensee: [
      { t:'Je pense à toi', b:'Comme ça, sans raison. J\'espère que ta couche te tient bien au chaud. 🦊' },
      { t:'Coucou !', b:'Je m\'ennuyais un peu. Tu fais quoi, toi ?' },
      { t:'Petit rappel', b:'Tu es exactement là où tu dois être. Laisse-toi porter. 💛' },
      { t:'Une pensée', b:'Je me disais que t\'es plutôt courageux de faire ce chemin. Voilà, c\'est dit.' },
      { t:'Hey', b:'T\'as pensé à te détendre depuis tout à l\'heure ? Relâche les épaules, respire.' }
    ],
    // encouragement lié au cadre
    cadre: [
      { t:'Tu bois assez ?', b:'Un petit verre ou un biberon, ça se tente là non ?' },
      { t:'Comment tu te sens ?', b:'Prends deux secondes pour écouter ton corps. Tout va bien ?' },
      { t:'Petit check', b:'Ta couche, elle en est où ? Pense à vérifier, sans stress.' },
      { t:'Détends-toi', b:'Si tu te crispes, tu luttes. Et lutter, ça sert à rien, tu le sais. 🦊' }
    ],
    // interpellations du mode grand frère
    bro: [
      { t:'Je pense à toi', b:'Où que tu sois, tu portes ta couche. Tu ne peux pas l\'oublier. C\'est bien.' },
      { t:'Écoute-moi', b:'Relâche. Maintenant. Tu n\'as rien à contrôler, je m\'occupe de tout.' },
      { t:'Petit rappel', b:'Tu m\'appartiens un peu, ces jours-ci. Laisse-toi faire, c\'est plus simple.' },
      { t:'Hey', b:'Tu te crispes encore, je le sens d\'ici. Respire et abandonne-toi.' }
    ]
  };

  // Feedback automatique : Foxy te notifie quand un cap est franchi
  async function foxyMilestones() {
    try {
      if (paused || notifPermState() !== 'granted') return;
      if (notifPrefs.milestone === false) return; // désactivable dans les réglages
      const h = new Date().getHours();
      if (h < 8 || h >= 22) return;
      let seen = {};
      try { const r = await window.storage.get('milestones:seen'); if (r && r.value) seen = JSON.parse(r.value); } catch(e) {}

      // 1) série de jours
      const entries = await getAll();
      const byDate = {}; entries.forEach(e => { if (e && e.date) byDate[e.date] = true; });
      let streak = 0;
      for (let i = 0; ; i++) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const k = d.toISOString().slice(0,10);
        if (byDate[k]) streak++; else { if (i===0) continue; break; }
      }
      for (const cap of [3,7,10,14,21,30,45,60]) {
        const key = 'streak'+cap;
        if (streak >= cap && !seen[key]) {
          seen[key] = true;
          await showLocalNotif('🔥 ' + cap + ' jours !',
            broOn() ? cap + ' jours d\'affilée. Tu ne t\'arrêtes plus — c\'est devenu plus fort que toi.'
                    : cap + ' jours d\'affilée, tu te rends compte ? Je suis super fier de toi ! 🦊',
            'ping');
          try { await window.storage.set('milestones:seen', JSON.stringify(seen)); } catch(e) {}
          return;
        }
      }

      // 2) mission de période accomplie (notification immédiate)
      if (window.HabitrainMissions) {
        const st = await window.HabitrainMissions.getState();
        if (st.activePeriod) {
          const m = window.HabitrainMissions.periodById(st.activePeriod.id);
          const ev = await evalPeriod(m, st.activePeriod);
          const key = 'mission_' + m.id;
          if (ev.done && !seen[key]) {
            seen[key] = true;
            await showLocalNotif('🏆 Mission accomplie !',
              '« ' + m.name + ' » est terminée. Viens la valider, je t\'attends !', 'ping');
            try { await window.storage.set('milestones:seen', JSON.stringify(seen)); } catch(e) {}
            return;
          }
        }
        // 3) toutes les missions du jour faites
        const stM = await window.HabitrainMissions.getState();
        if (stM.daily && stM.daily.length) {
          let toutes = true;
          for (const id of stM.daily) {
            const dm = window.HabitrainMissions.dailyById(id);
            if (!dm) continue;
            const ev = await evalDaily(dm);
            if (!ev.done) { toutes = false; break; }
          }
          const key = 'daily_' + todayStr();
          if (toutes && !seen[key]) {
            seen[key] = true;
            await showLocalNotif('✅ Journée parfaite !',
              broOn() ? 'Toutes tes missions du jour sont faites. C\'est ce que j\'attendais de toi.'
                      : 'Toutes tes missions du jour sont faites ! T\'es en feu aujourd\'hui. 🎯🦊',
              'ping');
            try { await window.storage.set('milestones:seen', JSON.stringify(seen)); } catch(e) {}
          }
        }
      }
    } catch(e) {}
  }

  async function foxyPing() {
    try {
      if (paused) return;
      if (notifPermState() !== 'granted') return;
      if (notifPrefs.ping === false) return;     // désactivable dans les réglages
      const now = new Date();
      const h = now.getHours();
      if (h < 8 || h >= 22) return;              // jamais la nuit : il dort
      // espacement minimum de 90 min, et max 4 par jour
      let last = 0, count = 0, day = null;
      try {
        const r = await window.storage.get('ping:state');
        if (r && r.value) { const st = JSON.parse(r.value); last = st.last||0; count = st.count||0; day = st.day||null; }
      } catch(e) {}
      if (day !== todayStr()) { count = 0; }
      if (count >= 4) return;
      if (Date.now() - last < 90*60000) return;
      // probabilité modérée pour que ça reste une surprise
      if (Math.random() > 0.18) return;
      // pas pendant un créneau de change (il a déjà ses rappels)
      const nowMin = h*60 + now.getMinutes();
      const PIL = [9*60, 16*60, 22*60+30, 11*60+30, 13*60+30, 19*60+30];
      if (PIL.some(m => Math.abs(nowMin - m) <= 20)) return;

      const pool = broOn() ? PING_POOLS.bro
                 : (Math.random() < 0.5 ? PING_POOLS.pensee : PING_POOLS.cadre);
      const msg = pool[Math.floor(Math.random()*pool.length)];
      await showLocalNotif(msg.t, msg.b, 'ping');
      try { await window.storage.set('ping:state', JSON.stringify({ last:Date.now(), count:count+1, day:todayStr() })); } catch(e) {}
    } catch(e) {}
  }

  // ===== Veille des serrures : fenêtre qui approche/se ferme, quota bientôt épuisé =====
  let lockAlertSent = {};
  async function checkLockAlerts() {
    if (paused || !window.HabitrainLock) return;
    const PIL = [9*60, 16*60, 22*60+30];
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    let locks = [];
    try { locks = await window.HabitrainLock.getLocks(); } catch(e) { return; }
    for (const l of locks) {
      if (!l.enabled) continue;
      const key = todayStr() + ':' + l.id;
      lockAlertSent[key] = lockAlertSent[key] || {};

      if (l.useWindows) {
        // fenêtre en cours ? calcule le temps restant avant fermeture
        const p = PIL.find(m => Math.abs(nowMin - m) <= l.windowMin);
        if (p != null) {
          const fin = p + l.windowMin;
          const reste = fin - nowMin;
          if (reste > 0 && reste <= 10 && !lockAlertSent[key].closing) {
            lockAlertSent[key].closing = true;
            showLocalNotif('Fenêtre bientôt fermée', '« ' + l.name +' » se referme dans ' + reste + ' min.', 'lock');
            if (voiceMode === 'foxy') {
              await imSay(broOn()
                ? '« ' + l.name + ' » se referme dans ' + reste + ' minutes. Après, ce sera trop tard — tu attendras la prochaine fenêtre.'
                : 'Attention ! « ' + l.name + ' » se referme dans ' + reste + ' min. Prends ce qu\'il te faut maintenant. 🦊', 850, 'concern');
              try { await imOfferHelp(currentM || currentMoment(new Date())); } catch(e) {}
            }
          }
        } else {
          // fenêtre qui approche (dans 20 min)
          const next = PIL.find(m => (m - l.windowMin) > nowMin);
          if (next != null) {
            const avant = (next - l.windowMin) - nowMin;
            if (avant > 0 && avant <= 20 && !lockAlertSent[key].opening) {
              lockAlertSent[key].opening = true;
              showLocalNotif('Fenêtre bientôt ouverte', '« ' + l.name + ' » s\'ouvre dans ' + avant + ' min.', 'lock');
              if (voiceMode === 'foxy') {
                await imSay(broOn()
                  ? '« ' + l.name + ' » s\'ouvrira dans ' + avant + ' minutes. Prépare-toi, tu sais déjà que tu iras.'
                  : '« ' + l.name + ' » s\'ouvre dans ' + avant + ' min, prépare-toi ! 🦊', 850, 'joy');
                try { await imOfferHelp(currentM || currentMoment(new Date())); } catch(e) {}
              }
            }
          }
        }
      }

      // quota bientôt épuisé (il reste 1)
      try {
        const opens = await window.HabitrainLock.getOpensToday(l.id);
        if (opens === l.dailyQuota - 1 && !lockAlertSent[key].quota) {
          lockAlertSent[key].quota = true;
          if (voiceMode === 'foxy') {
            await imSay(broOn()
              ? 'Il ne te reste qu\'UNE ouverture de « ' + l.name + ' » aujourd\'hui. Choisis bien ton moment.'
              : 'Attention, il te reste une seule ouverture de « ' + l.name + ' » aujourd\'hui ! 🦊', 850, 'pensive');
            try { await imOfferHelp(currentM || currentMoment(new Date())); } catch(e) {}
          }
        }
      } catch(e) {}
    }
  }

  // Durée de port : intervalles entre changes enregistrés (result 'change_fait')
  async function renderWear() {
    // rassemble tous les changes horodatés des 14 derniers jours
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }
    let changes = [];
    for (const d of days) {
      const list = await getChecks(d);
      list.forEach(c => {
        if ((c.result === 'change_fait' || c.result === 'change_fait_sanspreuve') && c.t) changes.push(new Date(c.t));
      });
    }
    changes.sort((a,b) => a - b);

    const listEl = document.getElementById('wearList');
    const noteEl = document.getElementById('wearNote');

    if (changes.length < 2) {
      document.getElementById('wearAvg').textContent = '—';
      document.getElementById('wearNight').textContent = '—';
      document.getElementById('wearMax').textContent = '—';
      listEl.innerHTML = '<div class="wear-empty">Il faut au moins 2 changes enregistrés via l\'appli pour calculer une durée. Passe par le change guidé pour alimenter ce suivi.</div>';
      noteEl.textContent = '';
      return;
    }

    // intervalles consécutifs
    const intervals = [];
    for (let i = 1; i < changes.length; i++) {
      const start = changes[i-1], end = changes[i];
      const hours = (end - start) / 3600000;
      if (hours <= 0 || hours > 20) continue; // ignore aberrations (>20h = trou de saisie)
      // nuit si l'intervalle démarre le soir (>=21h) ou couvre 2h-6h du matin
      const startH = start.getHours();
      const isNight = startH >= 21 || (startH <= 6);
      intervals.push({ start, end, hours, isNight });
    }

    if (!intervals.length) {
      listEl.innerHTML = '<div class="wear-empty">Pas encore d\'intervalle exploitable.</div>';
      return;
    }

    const dayInts = intervals.filter(x => !x.isNight);
    const nightInts = intervals.filter(x => x.isNight);
    const avg = arr => arr.length ? arr.reduce((s,x)=>s+x.hours,0)/arr.length : null;
    const fmtH = h => h==null ? '—' : (h < 1 ? Math.round(h*60)+'min' : (Math.floor(h)+'h'+(Math.round((h%1)*60)?String(Math.round((h%1)*60)).padStart(2,'0'):'')));

    document.getElementById('wearAvg').textContent = fmtH(avg(dayInts));
    document.getElementById('wearNight').textContent = fmtH(avg(nightInts));
    const maxInt = intervals.reduce((m,x)=> x.hours>m.hours?x:m, intervals[0]);
    document.getElementById('wearMax').textContent = fmtH(maxInt.hours);

    // liste des derniers intervalles (les 8 plus récents), échelle sur 12h
    const recent = intervals.slice(-8).reverse();
    listEl.innerHTML = '';
    recent.forEach(x => {
      const pct = Math.min(100, x.hours / 12 * 100);
      let cls = 'ok';
      if (x.isNight) {
        // nuit : long normal ; anormal seulement si très court (<5h) ou excessif (>12h)
        if (x.hours < 5 || x.hours > 12) cls = 'long';
        else cls = 'ok';
      } else {
        // jour : fourchette saine 2h–5h. Trop court = anomalie, trop long = risque peau.
        if (x.hours < 2) cls = 'long';        // trop fréquent (anomalie)
        else if (x.hours > 6) cls = 'long';   // trop long (risque peau)
        else if (x.hours > 5) cls = 'mid';    // un peu long
        else cls = 'ok';                      // sain
      }
      const label = x.start.toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) + ' ' +
                    String(x.start.getHours()).padStart(2,'0')+'h'+String(x.start.getMinutes()).padStart(2,'0');
      const row = document.createElement('div');
      row.className = 'wear-row';
      row.innerHTML = '<div class="when">'+(x.isNight?'🌙 ':'☀️ ')+label+'</div>'+
        '<div class="wear-bar-wrap"><div class="wear-bar '+cls+'" style="width:'+pct+'%"></div></div>'+
        '<div class="wear-dur">'+fmtH(x.hours)+'</div>';
      listEl.appendChild(row);
    });

    // note contextuelle : signale les DEUX dérives
    const tooShort = dayInts.filter(x => x.hours < 2).length;
    const tooLong = dayInts.filter(x => x.hours > 6).length;
    const msgs = [];
    if (tooShort > 0) msgs.push('🔁 <b>'+tooShort+' change'+(tooShort>1?'s':'')+' trop rapproché'+(tooShort>1?'s':'')+'</b> (< 2h en journée) : changer trop souvent va à l\'encontre de l\'habituation au port. Vérifie que ce n\'est pas de l\'inconfort ou une erreur de saisie.');
    if (tooLong > 0) msgs.push('⏱️ <b>'+tooLong+' port'+(tooLong>1?'s':'')+' trop long'+(tooLong>1?'s':'')+'</b> (> 6h en journée) : sur la durée, ça augmente le risque peau.');
    if (msgs.length) {
      noteEl.innerHTML = msgs.join('<br><br>');
    } else {
      noteEl.innerHTML = '✅ Rythme de port sain : ni trop fréquent, ni trop long. C\'est exactement l\'équilibre recherché. Rappel : seuls les changes faits via l\'appli sont comptés.';
    }
  }

  /* ---- Entorses du jour ---- */
  const BREACHES = [
    { id:'b_retrait_hors', n:'Retrait de couche hors heures autorisées', grav:'grave',   w:12 },
    { id:'b_cadre',        n:'Sortie du cadre ABDL (habit adulte prolongé)', grav:'grave', w:12 },
    { id:'b_retrait_2h',   n:'Couche retirée plus de 2h',               grav:'moyenne', w:7 },
    { id:'b_pilier',       n:'Change pilier sauté (matin ou soir)',     grav:'moyenne', w:7 },
    { id:'b_hors_couche',  n:'Miction/selle hors couche (hors fenêtres)', grav:'moyenne', w:7 },
    { id:'b_hydra',        n:'Hydratation négligée (biberons non bus)', grav:'legere',  w:3 },
    { id:'pause_moyenne',     n:'Pause de plusieurs heures',            grav:'legere',  w:3 },
    { id:'pause_longue',      n:'Pause de 1 à 3 jours',                 grav:'moyenne', w:7 },
    { id:'pause_tres_longue', n:'Désertion du programme (+3 jours)',    grav:'grave',   w:12 },
    { id:'lock_emergency',    n:'Ouverture de serrure en urgence',       grav:'legere',  w:3 }
  ];
  const GRAV_LABEL = { grave:'Grave', moyenne:'Moyenne', legere:'Légère' };

  async function getBreaches(date) {
    try { const r = await window.storage.get('breach:'+date); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return {};
  }
  async function saveBreaches(date, obj) {
    try { await window.storage.set('breach:'+date, JSON.stringify(obj)); } catch(e) {}
  }
  // total de pénalité (0-100) pour une date donnée
  async function breachPenalty(date) {
    const on = await getBreaches(date);
    let p = 0;
    BREACHES.forEach(b => { if (on[b.id]) p += b.w; });
    if (hardMode) p = Math.round(p * 1.5); // entorses plus lourdes en mode intensif
    return Math.min(hardMode ? 55 : 40, p);
  }

  let breachSel = null; // sélection locale en cours (non enregistrée)

  async function renderBreaches() {
    const list = document.getElementById('breachList');
    // initialise la sélection locale depuis ce qui est enregistré (une seule fois par ouverture de carte)
    if (breachSel === null) {
      breachSel = await getBreaches(todayStr());
    }
    list.innerHTML = '';
    BREACHES.forEach(b => {
      const on = !!breachSel[b.id];
      const row = document.createElement('div');
      row.className = 'breach-row' + (on ? ' on' : '');
      row.innerHTML = '<div class="breach-box">'+(on?'🐾':'')+'</div>'+
        '<div class="info"><div class="n">'+b.n+'</div><div class="g '+b.grav+'">'+GRAV_LABEL[b.grav]+'</div></div>';
      row.addEventListener('click', () => {
        // bascule locale uniquement (pas d'enregistrement, pas d'impact note)
        breachSel[b.id] = !breachSel[b.id];
        if (!breachSel[b.id]) delete breachSel[b.id];
        renderBreaches();
      });
      list.appendChild(row);
    });
    updateBreachSummary(false);
  }

  function updateBreachSummary(saved) {
    const sel = breachSel || {};
    const count = BREACHES.filter(b => sel[b.id]).length;
    const summary = document.getElementById('breachSummary');
    if (count === 0) {
      summary.className = 'breach-summary none';
      summary.textContent = saved ? 'Aucune entorse enregistrée aujourd\'hui. 👍' : 'Aucune entorse sélectionnée.';
    } else {
      let pen = 0; BREACHES.forEach(b => { if (sel[b.id]) pen += b.w; });
      pen = Math.min(40, pen);
      summary.className = 'breach-summary some';
      summary.textContent = count + ' entorse' + (count>1?'s':'') + (saved?' enregistrée':' sélectionnée') + (count>1?'s':'') + ' · −' + pen + ' pts sur la note du jour';
    }
  }

  // Tableau de bord : niveau d'HABITUATION aux couches sur tout le programme
  async function renderDashboard(entries) {
    const byDate = {}; entries.forEach(e => byDate[e.date] = e);
    const dates = Object.keys(byDate).sort(); // croissant
    const filledTotal = dates.length;

    if (filledTotal === 0) {
      setDash('none', '—', 'En attente de données',
        'Enregistre ta première journée pour lancer le suivi.',
        '0%', 'Progression',
        '—', '—', '—',
        'Le tableau de bord s\'activera dès tes premières entrées.');
      return;
    }

    // --- Ancienneté : jour X depuis la 1re entrée (borné à 30) ---
    const first = new Date(dates[0] + 'T12:00:00');
    const today = new Date(todayStr() + 'T12:00:00');
    const dayNum = Math.min(30, Math.round((today - first) / 86400000) + 1);
    // L'ancienneté ne rapporte plus de points : elle sert uniquement de plafond.
    // Le temps qui passe n'est pas un mérite.

    // --- Régularité : série de jours consécutifs remplis en remontant depuis aujourd'hui ---
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      // en mode intensif, un jour avec entorse déclarée casse la série
      if (hardMode) {
        try {
          const rb = await window.storage.get('breach:'+key);
          const b = (rb && rb.value) ? JSON.parse(rb.value) : {};
          if (Object.keys(b).some(k => b[k])) { if (i === 0) { /* aujourd'hui : on continue à regarder */ } else break; }
        } catch(e) {}
      }
      if (byDate[key]) streak++;
      else { if (i === 0) continue; break; }
    }
    const spanDays = Math.round((today - first) / 86400000) + 1;
    const fillRate = spanDays ? filledTotal / spanDays : 1;
    // Régularité exigeante : série sur 14 jours, et l'assiduité pèse lourd.
    // Un trou dans le suivi fait vraiment chuter le score.
    const regScore = Math.min(1, (Math.min(1, streak / 14) * 0.5) + (Math.pow(fillRate, 1.5) * 0.5));

    // --- "À corriger" : tendance récente vs début ---
    async function flagRateFor(dateList) {
      let flags = 0, tot = 0;
      for (const d of dateList) {
        const list = await getChecks(d);
        tot += list.length;
        flags += list.filter(c => ['miss','sature','tet_miss'].includes(c.result)).length;
      }
      return { rate: tot ? flags/tot : null, flags, tot };
    }
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); last7.push(d.toISOString().slice(0,10)); }
    const recent = await flagRateFor(last7);
    const early = await flagRateFor(dates.slice(0, Math.min(7, dates.length)));

    // score "réflexes" : peu de flags récents = bon ; bonus si baisse vs début
    // Réflexes : aucun cadeau au départ. Sans vérifs, on ne peut rien prouver.
    let reflexScore;
    if (recent.tot < 5) reflexScore = 0;            // trop peu de données : rien d'acquis
    else {
      reflexScore = Math.max(0, 1 - recent.rate * 2);  // les anomalies coûtent double
      if (early.rate !== null && recent.rate < early.rate) reflexScore = Math.min(1, reflexScore + 0.1);
    }

    // tendance texte
    let trendTxt = '—';
    if (recent.rate !== null && early.rate !== null && dates.length >= 4) {
      if (recent.rate < early.rate - 0.02) trendTxt = recent.flags + ' ↓';
      else if (recent.rate > early.rate + 0.02) trendTxt = recent.flags + ' ↑';
      else trendTxt = recent.flags + ' →';
    } else {
      trendTxt = (recent.flags || 0) + '';
    }

    // --- Lâcher-prise : le cœur de l'habituation ---
    // Une couche MOUILLÉE prouve le relâchement ; une couche SÈCHE prouve la rétention.
    let mouille = 0, sec = 0, nuitsMouillees = 0, nuitsSeches = 0;
    for (const d of last7) {
      const list = await getChecks(d);
      mouille += list.filter(c => ['etat_mouille','mouille','etat_sature','sature'].includes(c.result)).length;
      sec     += list.filter(c => ['etat_sec','sec'].includes(c.result)).length;
      nuitsMouillees += list.filter(c => c.result === 'reveil_mouille').length;
      nuitsSeches    += list.filter(c => c.result === 'reveil_sec').length;
    }
    let letGoScore = 0;
    const totEtats = mouille + sec;
    if (totEtats >= 5) {
      letGoScore = mouille / totEtats;                       // part de relâchement
      const totNuits = nuitsMouillees + nuitsSeches;
      if (totNuits >= 2) {
        // les nuits comptent davantage : c'est là que le lâcher-prise est le plus dur
        letGoScore = letGoScore * 0.55 + (nuitsMouillees / totNuits) * 0.45;
      }
    }

    // --- Pénalité entorses : moyenne des 7 derniers jours ---
    let breachPen = 0;
    for (const d of last7) { breachPen += await breachPenalty(d); }
    breachPen = breachPen / last7.length; // moyenne (0-40)

    // --- Score d'habituation : lâcher-prise 45 + régularité 30 + réflexes 25, moins entorses ---
    // Le lâcher-prise domine : c'est l'objectif réel du programme.
    const rawScore = letGoScore*45 + regScore*30 + reflexScore*25;
    const score = Math.max(0, Math.round(rawScore - breachPen));

    // --- Palier : bridé par l'ancienneté (l'habituation prend du temps) ---
    // étape par le score (qualité) et étape par les jours écoulés ; on prend la plus basse.
    // Paliers exigeants : il faut vraiment démontrer l'habituation.
    let stageByScore;
    if (score >= 88) stageByScore = 3;
    else if (score >= 70) stageByScore = 2;
    else if (score >= 48) stageByScore = 1;
    else stageByScore = 0;

    // Plafond par l'ancienneté : l'habituation ne peut pas être instantanée.
    let stageByDay;
    if (dayNum >= 28) stageByDay = 3;
    else if (dayNum >= 16) stageByDay = 2;
    else if (dayNum >= 8) stageByDay = 1;
    else stageByDay = 0;

    const stage = Math.min(stageByScore, stageByDay);
    try { window.storage.set('queststage', JSON.stringify(stage)); } catch(e) {}
    const STAGE_LABELS = ['Découverte', "Ça s'installe", 'Automatisme', 'Seconde nature'];
    const STAGE_CLS = ['none', 'mid', 'good', 'good'];
    const label = STAGE_LABELS[stage];
    const cls = STAGE_CLS[stage];

    const since = 'Jour ' + dayNum + ' du programme · palier ' + label.toLowerCase();

    // --- Peau (garde-fou santé, hors score) ---
    const skinFilled = dates.map(d => byDate[d]).filter(e => e && e.skin);
    const greenPct = skinFilled.length ? Math.round(skinFilled.filter(e=>e.skin==='verte').length / skinFilled.length * 100) : 0;
    const treatRecent = last7.map(d=>byDate[d]).filter(e=>e && e.skin==='traiter').length;

    // --- Appréciation ---
    let appr = [];
    if (dayNum <= 4) appr.push('<b>Phase de découverte.</b> C\'est normal d\'y penser beaucoup et d\'avoir des ajustements — l\'automatisme vient plutôt vers J5-J7.');
    else if (stage === 3) appr.push('<b>Le port est devenu une seconde nature.</b> Régularité tenue et réflexes installés : l\'habituation est là.');
    else if (stage === 2) appr.push('<b>L\'automatisme s\'installe.</b> Tu penses de moins en moins au cadre, c\'est exactement la trajectoire recherchée.');
    else appr.push('<b>Le régime commence à s\'ancrer.</b> Continue à remplir chaque jour, c\'est la régularité qui fait basculer vers l\'automatisme.');

    if (streak >= 3) appr.push('Série de <b>'+streak+' jours consécutifs</b> suivis.');
    if (recent.rate !== null && early.rate !== null && recent.rate < early.rate && dates.length >= 5)
      appr.push('Les situations à corriger <b>diminuent</b> vs le début — les réflexes rentrent.');
    else if (recent.flags > 0)
      appr.push(recent.flags + ' situation'+(recent.flags>1?'s':'')+' à corriger cette semaine : regarde à quels moments ça décroche.');
    if (treatRecent > 0) appr.push('⚠️ Peau <b>à traiter</b> récemment : côté santé, resserre changes et crème — indépendamment de l\'habituation.');
    if (breachPen >= 1) appr.push('📋 Entorses déclarées récemment : elles pèsent sur ta note (−'+Math.round(breachPen)+' pts en moyenne). L\'honnêteté du suivi compte autant que la performance.');

    setDash(cls, score+'%', label, since,
      score+'%', 'Habituation',
      (streak)+ (streak>1?' j':' j'), trendTxt, greenPct+'%',
      appr.join(' '));
  }

  function setDash(cls, ring, label, since, pct, progLabel, streak, trend, skin, apprec) {
    const el = document.getElementById('dashStatus');
    el.className = 'dash-status ' + cls;
    document.getElementById('dashRing').textContent = ring;
    document.getElementById('dashLabel').textContent = label;
    document.getElementById('dashSince').textContent = since;
    // barre de progression
    const pctNum = parseInt(pct) || 0;
    document.getElementById('progFill').style.width = pctNum + '%';
    document.getElementById('progPct').textContent = pct;
    document.getElementById('progLabel').textContent = progLabel;
    // KPIs
    document.getElementById('kpiStreak').textContent = streak;
    document.getElementById('kpiTrend').textContent = trend;
    document.getElementById('kpiSkin').textContent = skin;
    document.getElementById('dashApprec').innerHTML = apprec;
  }

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value || todayStr();
    if (!sel.skin) {
      const flash = document.getElementById('flash');
      flash.style.color = 'var(--coral)';
      flash.textContent = 'Renseigne au moins l\'état de la peau.';
      setTimeout(()=>{ flash.textContent=''; flash.style.color='var(--green)'; }, 2200);
      return;
    }
    const entry = {
      date,
      skin: sel.skin,
      bib: sel.bib !== undefined ? Number(sel.bib) : undefined,
      nuit: sel.nuit,
      type: sel.type,
      note: document.getElementById('note').value.trim()
    };
    try {
      await window.storage.set('day:'+date, JSON.stringify(entry));
      const flash = document.getElementById('flash');
      flash.textContent = '🐾 Enregistré';
      setTimeout(()=> flash.textContent = '', 1800);
      document.getElementById('formSub').textContent = 'Remplis la peau au minimum. Le reste va vite.';
      await refresh();
      await renderSupMode();
    } catch(e) {
      const flash = document.getElementById('flash');
      flash.style.color = 'var(--coral)';
      flash.textContent = 'Échec de l\'enregistrement, réessaie.';
      setTimeout(()=>{ flash.textContent=''; flash.style.color='var(--green)'; }, 2200);
    }
  });

  /* ---- Vérif surprise (types aléatoires) ---- */
  let autoOn = true;               // activée par défaut
  const OPEN_PROBABILITY = 0.5;    // ~1 ouverture sur 2 déclenche une vérif

  // Définition des vérifs. Chaque option : {label, cls, result, fix?}
  // fix = écran de correction (titre, intro, étapes) affiché après enregistrement.
  const CHECK_TYPES = [
    {
      id: 'couche_place',
      icon: '🦊',
      title: 'Foxy débarque !',
      question: 'La couche est-elle bien en place et bien ajustée aux cuisses ?',
      qFoxy: 'Eh, petit contrôle surprise ! Ta couche est bien en place, bien ajustée aux cuisses ?',
      options: [
        { label: 'Oui, bien en place', cls: 'ok', result: 'ok' },
        { label: "J'ai dû la réajuster", cls: 'adj', result: 'adj' },
        { label: "Je n'ai pas ma couche", cls: 'miss', result: 'miss', fix: {
          title: 'À corriger tout de suite',
          intro: 'Tu es hors cadre là : on te remet en couche maintenant, sans attendre.',
          steps: [
            'Va à ton espace de change (lit ou tapis à langer).',
            'Peau propre et sèche : essuie si besoin, laisse respirer 10 s.',
            'Crème barrière sur les zones sensibles.',
            'Mets une couche fraîche : ajuste bien les barrières anti-fuites aux cuisses.',
            'Remets ta tenue ABDL du bloc en cours.',
            'Reviens ici et confirme.'
          ]
        }}
      ]
    },
    {
      id: 'couche_etat',
      icon: '🦊',
      title: 'Foxy débarque !',
      question: 'Dans quel état est ta couche, là, maintenant ?',
      qFoxy: 'Alors, ta couche, elle en est où là maintenant ?',
      options: [
        { label: 'Bien mouillée', cls: 'ok', result: 'mouille' },
        { label: 'Encore sèche', cls: 'adj', result: 'sec' },
        { label: 'Saturée', cls: 'miss', result: 'sature', fix: {
          title: 'Change maintenant',
          intro: 'Couche saturée = peau au contact prolongé de l\'humidité. On change sans attendre — c\'est le point faible n°1 du mois.',
          steps: [
            'Va à ton espace de change.',
            'Retire la couche saturée, peau propre et bien sèche.',
            'Vérif peau au passage : rougeur ? irritation ? Si oui, tu traites.',
            'Crème barrière.',
            'Couche fraîche, barrières anti-fuites bien ajustées.',
            'Reviens ici et confirme.'
          ]
        }}
      ]
    },
    {
      id: 'tetine',
      icon: '🦊',
      title: 'Foxy débarque !',
      question: 'Ta tétine, tu l\'as sur toi / à portée ?',
      qFoxy: 'Et ta tétine, tu l\'as sur toi ou pas loin ?',
      options: [
        { label: 'Oui, en bouche', cls: 'ok', result: 'tet_ok' },
        { label: 'À portée, je la prends', cls: 'adj', result: 'tet_prise' },
        { label: 'Non, introuvable', cls: 'miss', result: 'tet_miss', fix: {
          title: 'Remets-toi dans le cadre',
          intro: 'La tétine fait partie de ton immersion. On la récupère.',
          steps: [
            'Retrouve ta tétine (ou une propre de rechange).',
            'Rince-la si elle a traîné.',
            'Reprends-la et réinstalle-toi dans ton bloc en cours.',
            'Reviens ici et confirme.'
          ]
        }}
      ]
    }
  ];

  const RESULT_LABEL = {
    ok: 'en place', adj: 'réajustée', miss: 'sans couche', fixed: 'remise en couche',
    sec: 'sèche', mouille: 'mouillée', sature: 'saturée',
    tet_ok: 'tétine en bouche', tet_prise: 'tétine reprise', tet_miss: 'tétine absente'
  };

  let currentType = null;

  async function getChecks(date) {
    try {
      const r = await window.storage.get('check:'+date);
      if (r && r.value) return JSON.parse(r.value);
    } catch(e) {}
    return [];
  }
  async function saveCheck(result, typeId) {
    const date = todayStr();
    const list = await getChecks(date);
    list.push({ t: new Date().toISOString(), result, type: typeId || (currentType && currentType.id) });
    try { await window.storage.set('check:'+date, JSON.stringify(list)); } catch(e) {}
    await renderCheckStat();
    try { await renderDashboard(await getAll()); } catch(e) {}
  }
  async function renderCheckStat() {
    const list = await getChecks(todayStr());
    const total = list.length;
    const flags = list.filter(c => ['miss','sature','tet_miss'].includes(c.result)).length;
    let txt = "Aujourd'hui : <b>"+total+"</b> vérif"+(total>1?'s':'');
    if (flags > 0) txt += " · <b style='color:var(--coral)'>"+flags+"</b> à corriger";
    document.getElementById('checkStat').innerHTML = txt;
  }

  // Feedback de Foxy selon la réponse à une vérif
  const CHECK_FB = {
    ok:       { t:'Nickel, bien en place ! Continue comme ça, t\'es carré.', expr:'proud', next:'close' },
    adj:      { t:'Ah, t\'as dû la réajuster ? Pense à bien sortir les barrières aux cuisses, ça évite ça la prochaine fois.', expr:'pensive', next:'close' },
    miss:     { t:'Eh ! T\'as pas ta couche là ?! On corrige ça direct, viens, je te guide.', expr:'surprised', next:'change' },
    sec:      { t:'Encore sèche ? Tu te retiens peut-être un peu. Pas de stress, mais laisse-toi aller quand ça vient, hein — c\'est le but.', expr:'pensive', next:'close' },
    mouille:  { t:'Bien mouillée, parfait ! Tu te laisses aller comme il faut. C\'est exactement ça qu\'on veut. On la garde encore un peu.', expr:'happy', next:'close' },
    sature:   { t:'Oh là, saturée ! Faut changer tout de suite mec, on y va ensemble.', expr:'surprised', next:'change' },
    tet_ok:   { t:'Ta tétine est là, parfait ! T\'es à fond dedans.', expr:'joy', next:'close' },
    tet_prise:{ t:'Reprends-la, voilà. C\'est mieux comme ça, non ?', expr:'happy', next:'close' },
    tet_miss: { t:'Oh, ta tétine a disparu ? Va vite la retrouver, je t\'attends !', expr:'concern', next:'close' }
  };

  function buildCheck(type) {
    currentType = type;
    const ic = document.getElementById('checkIcon');
    ic.textContent = ''; ic.classList.add('foxy-portrait');
    positionFoxyCell(ic, 'pensive', 76);
    document.getElementById('checkTitle').textContent = type.title;
    const acts = document.getElementById('checkActs');
    acts.innerHTML = '';
    // Foxy pose la question, puis les réponses apparaissent
    typeLine(document.getElementById('checkQuestion'), type.qFoxy || type.question, () => {
      type.options.forEach(opt => {
        const b = document.createElement('button');
        b.className = opt.cls;
        b.textContent = opt.label;
        b.addEventListener('click', () => onCheckAnswer(type, opt));
        acts.appendChild(b);
      });
    });
  }

  async function onCheckAnswer(type, opt) {
    await saveCheck(opt.result, type.id);
    const fb = CHECK_FB[opt.result] || { t:'Ok, noté !', expr:'neutral', next:'close' };
    positionFoxyCell(document.getElementById('checkIcon'), fb.expr, 76);
    const acts = document.getElementById('checkActs');
    acts.innerHTML = '';
    // Foxy réagit, puis propose la suite
    typeLine(document.getElementById('checkQuestion'), fb.t, () => {
      const b = document.createElement('button');
      if (fb.next === 'change') {
        b.className = 'miss';
        b.textContent = '🦊 On change maintenant';
        b.addEventListener('click', () => startChange('check', true));
      } else {
        b.className = 'ok';
        b.textContent = '👍 Ok Foxy';
        b.addEventListener('click', () => closeCheck());
      }
      acts.appendChild(b);
    });
  }

  function popCheck(forcedType) {
    if (paused) return;
    const type = forcedType || CHECK_TYPES[Math.floor(Math.random() * CHECK_TYPES.length)];
    buildCheck(type);
    document.getElementById('modalCheck').style.display = '';
    document.getElementById('modalFix').style.display = 'none';
    document.getElementById('modalChange').style.display = 'none';
    document.getElementById('modalPose').style.display = 'none';
    document.getElementById('overlay').classList.add('show');
  }
  function showFix(fix) {
    positionFoxyCell(document.getElementById('fixIcon'), 'concern', 76);
    document.getElementById('fixTitle').textContent = fix.title;
    document.getElementById('fixIntro').innerHTML = fix.intro;
    const ol = document.getElementById('fixSteps');
    ol.innerHTML = '';
    fix.steps.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = s;
      ol.appendChild(li);
    });
    document.getElementById('modalCheck').style.display = 'none';
    document.getElementById('modalChange').style.display = 'none';
    document.getElementById('modalPose').style.display = 'none';
    document.getElementById('modalFix').style.display = '';
  }
  function closeCheck() {
    document.getElementById('overlay').classList.remove('show');
    changeModel = null;   // libère le modèle réservé si le change est abandonné
    if (poseTypeTimer) { clearInterval(poseTypeTimer); poseTypeTimer = null; }
  }

  /* ---- Flux de change guidé : état couche → guide de pose → fait ---- */
  const POSE_STEPS = [
    'Installe-toi sur ton espace de change (lit ou tapis à langer).',
    'Retire la couche usagée, roule-la vers l\'intérieur, mets-la de côté (sac dédié).',
    'Essuie du plus propre vers le moins propre, peau bien sèche.',
    '👀 Coup d\'œil peau : rougeur ou irritation qui pointe ? Si oui, tu traites maintenant.',
    'Crème barrière sur les zones sensibles.',
    'Glisse la couche fraîche sous toi, remonte-la, centre-la.',
    'Sors et ajuste les barrières anti-fuites aux cuisses (le geste anti-fuite).',
    'Attache les adhésifs : contenant mais sans comprimer. Remets ta tenue.'
  ];

  const CHANGE_STATE_OPTS = [
    { label: '💧 Bien mouillée', cls:'g', result:'mouille' },
    { label: '☀️ Encore sèche', cls:'a', result:'sec' },
    { label: '🌊 Bien saturée', cls:'c', result:'sature' }
  ];

  let changeCtx = null; // 'check' | 'pilier'
  let activeSlotKey = null; // créneau de change imposé en cours (marqué fait à la fin)

  function popChangeDue(slot) {
    activeSlotKey = slot.key;
    positionFoxyCell(document.getElementById('dueIcon'), 'wave', 76);
    document.getElementById('dueTitle').textContent = '⏰ ' + slot.label;
    document.getElementById('modalCheck').style.display = 'none';
    document.getElementById('modalFix').style.display = 'none';
    document.getElementById('modalChange').style.display = 'none';
    document.getElementById('modalPose').style.display = 'none';
    document.getElementById('modalDue').style.display = '';
    document.getElementById('overlay').classList.add('show');

    const acts = document.getElementById('dueActs');
    acts.innerHTML = '';

    if (slot.ctx === 'pilier') {
      // change imposé : direct au flux guidé
      document.getElementById('dueText').textContent = broOn()
        ? 'C\'est l\'heure de ton change. Tu peux traîner encore un peu... mais ça arrivera, tu le sais. Autant te laisser faire maintenant.'
        : (hardMode ? 'Mode intensif : c\'est l\'heure, pas de discussion. On fait ton change MAINTENANT.'
        : 'C\'est l\'heure de ton change, viens on s\'en occupe étape par étape !');
      addBtn(acts, 'ok', '🦊 Faire le change avec Foxy', () => startChange('pilier'));
      if (hardMode) {
        addBtn(acts, 'adj', 'Vraiment pas maintenant', () => {
          document.getElementById('dueText').textContent = 'Tu me dois une explication : pourquoi tu repousses ?';
          const a = document.getElementById('dueActs'); a.innerHTML = '';
          addBtn(a, 'adj', 'Je suis occupé', () => { dueSnooze[slot.key] = Date.now()+5*60000; activeSlotKey=null; closeCheck(); });
          addBtn(a, 'adj', 'J\'ai la flemme', () => { dueSnooze[slot.key] = Date.now()+3*60000; activeSlotKey=null; closeCheck(); });
          addBtn(a, 'ok', 'Ok, finalement je le fais', () => startChange('pilier'));
        });
      } else {
        addBtn(acts, 'adj', 'Plus tard', () => { dueSnooze[slot.key] = Date.now() + 10*60000; activeSlotKey = null; closeCheck(); });
      }
    } else {
      // check : on reporte d'abord l'état de la couche
      document.getElementById('dueText').textContent = 'Petit check ! Ta couche, elle est comment ?';
      addBtn(acts, 'g', '☀️ Sèche — je laisse', async () => {
        await saveCheck('etat_sec', 'check_'+slot.key);
        markSlotDone(slot.key);
        foxyDueFeedback('Encore sèche ? Tu te retiens un chouïa. Laisse-toi aller quand ça vient, c\'est comme ça qu\'on s\'habitue. À tout à l\'heure !');
      });
      addBtn(acts, 'a', '💧 Mouillée — je laisse encore', async () => {
        await saveCheck('etat_mouille', 'check_'+slot.key);
        markSlotDone(slot.key);
        foxyDueFeedback('Bien mouillée, nickel ! Tu te laisses aller comme il faut, c\'est ça le progrès. On la garde encore un peu.');
      });
      addBtn(acts, 'a', '🔄 Mouillée — je change', async () => {
        await saveCheck('etat_mouille', 'check_'+slot.key);
        startChange('check', true); // état déjà pris → direct au guide de pose
      });
      addBtn(acts, 'c', '🌊 Saturée — je change', async () => {
        await saveCheck('etat_sature', 'check_'+slot.key);
        startChange('check', true);
      });
      addBtn(acts, 'adj', 'Plus tard', () => { dueSnooze[slot.key] = Date.now() + 10*60000; activeSlotKey = null; closeCheck(); });
    }
  }

  function addBtn(container, cls, label, handler) {
    const b = document.createElement('button');
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', handler);
    container.appendChild(b);
  }

  // Foxy réagit sur un check planifié (couche laissée) puis on ferme
  function foxyDueFeedback(text) {
    positionFoxyCell(document.getElementById('dueIcon'), 'happy', 76);
    document.getElementById('dueText').textContent = text;
    const acts = document.getElementById('dueActs');
    acts.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'ok'; b.textContent = '👍 Ok Foxy';
    b.addEventListener('click', async () => { closeCheck(); try { await renderCheckStat(); } catch(e){} });
    acts.appendChild(b);
  }

  async function markSlotDone(key) {
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      done[key] = true;
      await window.storage.set('slotdone:'+todayStr(), JSON.stringify(done));
    } catch(e) {}
    activeSlotKey = null;
  }

  async function saveChangeState(result) {
    // enregistré comme une vérif d'état, pour nourrir stats + tableau de bord
    await saveCheck('etat_'+result, 'change_'+(changeCtx||'check'));
  }

  function startChange(ctx, skipState) {
    changeCtx = ctx || 'check';
    positionChangeCell(document.getElementById('chIcon'), CHANGE_CELLS.prep, 76);
    // Si l'état a déjà été déclaré (au check), on va directement au guide de pose.
    if (skipState) {
      document.getElementById('modalCheck').style.display = 'none';
      document.getElementById('modalFix').style.display = 'none';
      document.getElementById('modalDue').style.display = 'none';
      document.getElementById('modalChange').style.display = 'none';
      showPose();
      document.getElementById('overlay').classList.add('show');
      return;
    }
    // écran 1 : état de la couche avant retrait (cas d'un change lancé sans check préalable)
    document.getElementById('chQ').textContent = ctx === 'pilier'
      ? 'Change pilier. Avant de retirer, elle est comment ?'
      : 'Avant de la retirer, elle est comment ?';
    const acts = document.getElementById('chActs');
    acts.innerHTML = '';
    CHANGE_STATE_OPTS.forEach(opt => {
      const b = document.createElement('button');
      if (opt.cls) b.className = opt.cls;
      b.textContent = opt.label;
      b.addEventListener('click', async () => {
        await saveChangeState(opt.result);
        showPose();
      });
      acts.appendChild(b);
    });
    // afficher la modale état, masquer les autres
    document.getElementById('modalCheck').style.display = 'none';
    document.getElementById('modalFix').style.display = 'none';
    document.getElementById('modalPose').style.display = 'none';
    document.getElementById('modalDue').style.display = 'none';
    document.getElementById('modalChange').style.display = '';
    document.getElementById('overlay').classList.add('show');
  }

  function showPose() {
    document.getElementById('modalChange').style.display = 'none';
    document.getElementById('modalPose').style.display = '';
    runChangeStep(0);
  }

  async function loadAutoPref() {
    try {
      const r = await window.storage.get('pref:autocheck');
      if (r && r.value) autoOn = JSON.parse(r.value);
    } catch(e) {}
    document.getElementById('autoSwitch').classList.toggle('on', autoOn);
    document.getElementById('nextIn').textContent = autoOn
      ? 'Active : une vérif au hasard (couche, état, tétine) tombe à l\'ouverture.'
      : 'Désactivée : aucune vérif automatique.';
  }
  async function setAutoPref(v) {
    autoOn = v;
    try { await window.storage.set('pref:autocheck', JSON.stringify(v)); } catch(e) {}
    document.getElementById('autoSwitch').classList.toggle('on', autoOn);
    document.getElementById('nextIn').textContent = autoOn
      ? 'Active : une vérif au hasard (couche, état, tétine) tombe à l\'ouverture.'
      : 'Désactivée : aucune vérif automatique.';
  }

  document.getElementById('autoSwitch').addEventListener('click', () => setAutoPref(!autoOn));
  document.getElementById('checkNow').addEventListener('click', () => popCheck());
  document.getElementById('fixDone').addEventListener('click', async () => { await saveCheck('fixed'); closeCheck(); });

  /* ---- Bloc repliable : saisie complète ---- */
  function toggleForm(forceOpen) {
    const head = document.getElementById('formHead');
    const body = document.getElementById('formBody');
    const open = forceOpen !== undefined ? forceOpen : !body.classList.contains('open');
    body.classList.toggle('open', open);
    head.classList.toggle('open', open);
  }
  document.getElementById('formHead').addEventListener('click', () => toggleForm());

  /* ---- Carte du moment : contextuelle selon l'heure locale ---- */
  // 5 fenêtres calées sur le planning. Chaque moment = question + options (result enregistré).
  function currentMoment(now) {
    const h = now.getHours();
    if (h >= 7 && h < 9)  return MOMENTS.reveil;
    if (h >= 9 && h < 13) return MOMENTS.matin;
    if (h >= 13 && h < 19) return MOMENTS.aprem;
    if (h >= 19 && h < 23) return MOMENTS.soir;
    return MOMENTS.nuit; // 23h-6h59
  }

  const MOMENTS = {
    reveil: {
      key: 'reveil', eyebrow: 'Réveil · 7h-9h', title: 'Le point du matin',
      titi: 'Bonjour, bien dormi ?',
      q: 'Réveil. Comment a tenu la couche de nuit ?',
      qi: 'Coucou, tu es réveillé ! On regarde ensemble comment ta couche a tenu cette nuit ?',
      opts: [
        { label: '💧 Bien mouillée', cls:'g', result:'reveil_mouille' },
        { label: '☀️ Encore au sec', cls:'a', result:'reveil_sec' },
        { label: '⚠️ Fuite pendant la nuit', cls:'c', result:'reveil_fuite' }
      ],
      after: 'Le bilan peau se fera ce soir, au change de nuit. Prépare le change de 9h.',
      afteri: 'Très bien. On fera ton grand change à 9h, je m\'occupe de toi. Prends ton temps pour émerger.'
    },
    matin: {
      key: 'matin', eyebrow: 'Matinée · 9h-13h', title: 'Check de matinée',
      titi: 'On fait un petit point ?',
      q: 'Matinée. État de la couche, et as-tu bu ton 1er biberon ?',
      qi: 'Dis-moi, ta couche est comment ? Et est-ce que tu as bien bu ton premier biberon ?',
      opts: [
        { label: '✅ Couche OK, biberon bu', cls:'g', result:'matin_ok' },
        { label: '💧 Couche à changer bientôt', cls:'a', result:'matin_change' },
        { label: '🍼 Pas encore hydraté', cls:'a', result:'matin_soif' }
      ],
      after: 'Pense au biberon si ce n\'est pas fait. Prochaine fenêtre : l\'après-midi.',
      afteri: 'C\'est bien. N\'oublie pas de boire, je veux que tu restes bien hydraté pour moi.'
    },
    aprem: {
      key: 'aprem', eyebrow: 'Après-midi · 13h-19h', title: 'Check d\'après-midi',
      titi: 'Comment tu te sens ?',
      q: 'Après-midi. Couche, sieste, hydratation : où en es-tu ?',
      qi: 'On vérifie ensemble ? Ta couche, ta sieste, et est-ce que tu bois assez ?',
      opts: [
        { label: '✅ Tout roule', cls:'g', result:'aprem_ok' },
        { label: '😴 Sieste faite, check au réveil', cls:'g', result:'aprem_sieste' },
        { label: '💧 Couche à changer', cls:'a', result:'aprem_change' }
      ],
      after: 'Garde le rythme d\'hydratation. Le bilan du soir arrive après 19h.',
      afteri: 'Tu t\'en sors très bien. Continue à boire, et ce soir on fera ton bilan tranquillement ensemble.'
    },
    soir: {
      key: 'soir', eyebrow: 'Soirée · 19h-23h', title: 'Bilan du soir',
      titi: 'C\'est l\'heure de prendre soin de toi',
      q: 'Soirée, le vrai pilier. Prêt pour le change de nuit et le bilan du jour ?',
      qi: 'La journée touche à sa fin. On va faire ton change de nuit et regarder ta peau ensemble, d\'accord ?',
      opts: [
        { label: '📝 Faire le bilan complet du jour', cls:'', result:'soir_bilan', openForm:true },
        { label: '🌙 Change de nuit fait, tout OK', cls:'g', result:'soir_ok' },
        { label: '⚠️ Peau à surveiller ce soir', cls:'a', result:'soir_souci', openForm:true }
      ],
      after: 'C\'est le moment d\'alléger l\'hydratation et de bien crémer pour la nuit.',
      afteri: 'Voilà. On allège l\'eau maintenant, et je te mets une bonne couche de crème pour que tu passes une nuit bien au chaud et sereine, à te laisser aller.'
    },
    nuit: {
      key: 'nuit', eyebrow: 'Nuit · 23h-7h', title: 'Mode nuit',
      titi: 'Il est tard, mon grand',
      q: 'Il est tard. Debout pour un change nocturne, ou juste un coup d\'œil ?',
      qi: 'Tu devrais dormir. Tu as besoin d\'un change, ou tu veux juste que je vérifie que tout va bien ?',
      opts: [
        { label: '🌙 Tout va bien, je retourne dormir', cls:'g', result:'nuit_ok' },
        { label: '💧 Change nocturne effectué', cls:'a', result:'nuit_change' }
      ],
      after: 'Repose-toi. Le point du matin t\'attendra au réveil.',
      afteri: 'Rendors-toi bien. Je veille sur toi, tout va bien. À demain matin.'
    }
  };

  async function getMoments(date) {
    try {
      const r = await window.storage.get('moment:'+date);
      if (r && r.value) return JSON.parse(r.value);
    } catch(e) {}
    return {};
  }
  async function saveMoment(momentKey, result) {
    const date = todayStr();
    const all = await getMoments(date);
    all[momentKey] = { result, t: new Date().toISOString() };
    try { await window.storage.set('moment:'+date, JSON.stringify(all)); } catch(e) {}
  }

  /* ---- Guide d'activité : le déroulé de la journée type ---- */
  // Chaque bloc : minute de début (depuis minuit), icône, activité, détail.
  const SCHEDULE = [
    { m: 7*60,      ic:'☀️', act:'Réveil en tenue de nuit',        det:'Grenouillère + couche de nuit, grand verre d\'eau, réveil doux.' },
    { m: 8*60,      ic:'🥣', act:'Petit-déjeuner',                 det:'En grenouillère de nuit. Fibres + eau. Tu gardes la couche de nuit.' },
    { m: 9*60,      ic:'🔑', act:'Change du matin',                det:'Fenêtre selles, toilette, vérif peau, crème, couche du jour, tenue de jour.', kind:'pilier' },
    { m: 9*60+30,   ic:'🚶', act:'Bloc activité',                  det:'Le pic d\'énergie : sortie, marche, tâches, sport léger.' },
    { m: 11*60+30,  ic:'✅', act:'Check + 1er biberon',            det:'Change si mouillé. Premier biberon de la journée.', kind:'check' },
    { m: 12*60,     ic:'🧸', act:'Fenêtre régression douce',       det:'Harnais fleece, moment calme : lecture, musique douce.' },
    { m: 13*60+30,  ic:'🍽️', act:'Déjeuner + 2e biberon',         det:'Repas fibres, check, deuxième biberon.', kind:'check' },
    { m: 14*60+30,  ic:'😴', act:'Sieste',                        det:'Emmaillotage doux : grenouillère + couverture. Cocon.' },
    { m: 16*60,     ic:'🔑', act:'Change de sortie de sieste + 3e biberon', det:'Change OBLIGATOIRE au réveil de sieste. Troisième biberon.', kind:'pilier' },
    { m: 16*60+30,  ic:'🚶', act:'Bloc activité',                  det:'Hobby, sortie, ménage — ce que tu veux.' },
    { m: 19*60+30,  ic:'🍽️', act:'Dîner',                        det:'Check si mouillé.', kind:'check' },
    { m: 20*60,     ic:'🧸', act:'Grande fenêtre régression',      det:'Le cocon du soir. Allège l\'hydratation à partir de maintenant.' },
    { m: 22*60+30,  ic:'🔑', act:'Change de nuit + bilan',         det:'Fenêtre selles, toilette, vérif peau complète, crème, couche de nuit. Fais ton bilan du soir.', kind:'pilier' },
    { m: 23*60,     ic:'🌙', act:'Coucher',                       det:'Sommeil toujours libre. Bonne nuit.' }
  ];

  function fmtTime(min) {
    const h = Math.floor(min/60), m = min%60;
    return h + 'h' + (m ? String(m).padStart(2,'0') : '');
  }

  // Frise chronologique dynamique de la journée
  function renderTimeline() {
    const box = document.getElementById('timeline');
    if (!box) return;
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    // bloc "en cours" = dernier dont l'heure <= maintenant
    let curIdx = -1;
    for (let i = 0; i < SCHEDULE.length; i++) { if (SCHEDULE[i].m <= nowMin) curIdx = i; else break; }
    box.innerHTML = '';
    SCHEDULE.forEach((s, i) => {
      const past = (i < curIdx);
      const isNow = (i === curIdx);
      const kind = s.kind || '';
      const item = document.createElement('div');
      item.className = 'tl-item ' + kind + (past ? ' past' : '') + (isNow ? ' now' : '');
      const dotGlyph = kind === 'pilier' ? '🔑' : (kind === 'check' ? '✓' : '');
      const tag = kind === 'pilier' ? '<span class="tl-tag pilier">Pilier</span>'
                : (kind === 'check' ? '<span class="tl-tag check">Check</span>' : '');
      item.innerHTML =
        '<div class="tl-rail"><div class="tl-dot">'+dotGlyph+'</div><div class="tl-line"></div></div>'+
        '<div class="tl-body">'+
          '<div class="tl-time">'+fmtTime(s.m)+'</div>'+
          '<div class="tl-act">'+s.ic+' '+s.act+tag+'</div>'+
          '<div class="tl-det">'+s.det+'</div>'+
        '</div>';
      box.appendChild(item);
    });
  }

  function renderGuide() {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    // bloc en cours = dernier bloc dont l'heure de début <= maintenant
    let idx = -1;
    for (let i = 0; i < SCHEDULE.length; i++) {
      if (SCHEDULE[i].m <= nowMin) idx = i; else break;
    }
    const guide = document.getElementById('guide');

    // avant 7h : nuit, le premier bloc n'a pas commencé
    let cur, next;
    if (idx === -1) {
      cur = { ic:'🌙', act:'Nuit', det:'Sommeil. La journée démarre au réveil de 7h.' };
      next = SCHEDULE[0];
    } else {
      cur = SCHEDULE[idx];
      next = SCHEDULE[idx+1] || null;
    }

    let html = '<div class="now">'
      + '<div class="ic">'+cur.ic+'</div>'
      + '<div class="body">'
      + '<div class="k">En ce moment' + (cur.m!==undefined ? ' · depuis '+fmtTime(cur.m) : '') + '</div>'
      + '<div class="v">'+cur.act+'</div>'
      + '<div class="t">'+cur.det+'</div>'
      + '</div></div>';
    if (next) {
      html += '<div class="next"><span class="arrow">→</span> À '+fmtTime(next.m)+' : '+next.act+'</div>';
    }
    guide.innerHTML = html;
  }

  // Conseils contextuels : plusieurs par tranche, un tiré au hasard à chaque ouverture.
  const TIPS = {
    nuit:   [ 'Si tu es réveillé, un coup d\'œil rapide suffit : la couche de nuit est faite pour tenir jusqu\'à 7h.',
              'Retourne dormir tranquille — le sommeil se fait toujours libre, sans contention.' ],
    reveil: [ 'Grand verre d\'eau au réveil pour relancer l\'hydratation de la journée.',
              'La couche de nuit reste jusqu\'après le petit-déj : profite du cocon.',
              'Le bilan peau, c\'est ce soir au change de nuit — pas maintenant.' ],
    matin:  [ 'Bois ton biberon sans te restreindre : moins d\'eau = urine concentrée = irritation.',
              'Change dès que c\'est mouillé, pas « au bout de X heures ».',
              'Un check, ce n\'est pas forcément un change : si c\'est sec, tu laisses.' ],
    aprem:  [ 'Check systématique au réveil de sieste : ~1h de port sans bouger, la peau apprécie la vérif.',
              'Toujours dans la fenêtre hydratation : garde le rythme des biberons.',
              'Fenêtre selles ratée ce matin ? Ne force pas, ça reviendra au change du soir.' ],
    soir:   [ 'Allège l\'hydratation à partir de maintenant pour ne pas saturer la couche de nuit.',
              'Au change de nuit : vérif peau complète et crème barrière généreuse. C\'est le geste clé du mois.',
              'Pense à faire ton bilan du soir dans l\'appli après le change.',
              'Barrières anti-fuites bien ajustées aux cuisses pour la nuit, surtout si tu dors sur le côté.' ]
  };

  function currentTipKey(now) {
    const h = now.getHours();
    if (h >= 7 && h < 9)  return 'reveil';
    if (h >= 9 && h < 13) return 'matin';
    if (h >= 13 && h < 19) return 'aprem';
    if (h >= 19 && h < 23) return 'soir';
    return 'nuit';
  }

  function renderTip() {
    const key = currentTipKey(new Date());
    const pool = TIPS[key] || [];
    const el = document.getElementById('tip');
    if (!pool.length) { el.style.display = 'none'; return; }
    const tip = pool[Math.floor(Math.random() * pool.length)];
    el.style.display = 'flex';
    el.innerHTML = '<span class="bulb">💡</span><span>' + tip + '</span>';
  }

  /* ---- Tenue du jour (tirage aléatoire cohérent) ---- */
  // Garde-robe par catégorie. Le tirage garde UN exemplaire par type utile.
  const WARDROBE = {
    nuit: [   // grenouillères (nuit)
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine',
      'Grenouillère Seenin marine et bleue'
    ],
    jour: [   // tenues de journée : grenouillères + rompers + bodies
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine',
      'Grenouillère Seenin marine et bleue',
      'Romper Rearz Safari',
      'Romper Little keeper sleeper marine',
      'Romper marinière',
      'Romper Seenin rouge et marine',
      'Body blanc avion',
      'Body marine'
    ],
    sieste: [ // repos
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine'
    ]
  };

  function pickOne(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

  let liveWardrobe = null;  // garde-robe personnalisée (chargée au démarrage)
  async function loadLiveWardrobe() {
    try { if (window.HabitrainWardrobe) liveWardrobe = await window.HabitrainWardrobe.getWardrobe(); } catch(e) {}
  }
  function wb(cat) {
    const src = (liveWardrobe && liveWardrobe[cat] && liveWardrobe[cat].length) ? liveWardrobe[cat] : WARDROBE[cat];
    return src || [];
  }
  function drawOutfit() {
    return {
      nuit: pickOne(wb('nuit')),
      jour: pickOne(wb('jour')),
      sieste: pickOne(wb('sieste'))
    };
  }

  async function getOutfit(date) {
    try { const r = await window.storage.get('outfit:'+date); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return null;
  }
  async function saveOutfit(date, o) {
    try { await window.storage.set('outfit:'+date, JSON.stringify(o)); } catch(e) {}
  }

  function renderOutfitResult(o) {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    // Nuit = 22h30 → 9h (réveil/petit-déj + détente du soir + nuit) ; Jour = 9h → 22h30.
    const isNightNow = (nowMin >= 22*60+30) || (nowMin < 9*60);
    const cards = [
      { key:'jour', ic:'☀️', moment:'Tenue de jour', wear:o.jour, active:!isNightNow },
      { key:'nuit', ic:'🌙', moment:'Tenue de nuit / repos', wear:o.nuit, active:isNightNow }
    ];
    const list = document.getElementById('outfitList');
    list.innerHTML = '';
    cards.forEach(c => {
      const row = document.createElement('div');
      row.className = 'outfit-row' + (c.active ? ' now-block' : '');
      row.innerHTML = '<div class="ic">'+c.ic+'</div><div class="body"><div class="moment">'+c.moment+(c.active?' · maintenant':'')+'</div><div class="wear">'+c.wear+'</div></div>';
      list.appendChild(row);
    });
    // note sieste
    const note = document.getElementById('outfitNote');
    note.style.display = '';
    note.innerHTML = '😴 Sieste : tu peux repasser en tenue de nuit pour le confort.';
    document.getElementById('outfitOnce').style.display = '';
  }

  function renderOutfits() {} // remplacé par le flux de tirage (voir renderOutfitCard)

  async function renderOutfitCard() {
    const card = document.getElementById('outfitCard');
    card.style.display = '';
    const existing = await getOutfit(todayStr());
    const btn = document.getElementById('outfitDraw');
    if (existing) {
      renderOutfitResult(existing);
      if (btn) btn.style.display = 'none';
    } else {
      if (btn) btn.style.display = '';
      document.getElementById('outfitList').innerHTML = '';
      document.getElementById('outfitNote').style.display = 'none';
      document.getElementById('outfitOnce').style.display = 'none';
    }
  }

  async function renderMoment() {
    renderGuide();
    renderTip();
    await renderOutfitCard();
    const now = new Date();
    const m = currentMoment(now);
    document.getElementById('momentEyebrow').textContent = m.eyebrow;
    document.getElementById('momentTitle').textContent = v(m.title, m.titi || m.title);

    // La saisie complète (peau + bilan) n'est proposée que le soir.
    const formCard = document.getElementById('formCard');
    if (m.key === 'soir') {
      formCard.style.display = '';
    } else {
      formCard.style.display = 'none';
      toggleForm(false);
    }

    const done = await getMoments(todayStr());
    const acts = document.getElementById('momentActs');
    const qEl = document.getElementById('momentQ');

    if (done[m.key]) {
      // déjà répondu pour ce moment aujourd'hui
      qEl.textContent = v(m.q, m.qi || m.q);
      acts.innerHTML = '<div class="done"><div class="big">'+(voiceMode==='foxy'?'🐾':(voiceMode==='care'?'💛':'🐾'))+'</div><p>'+v('Point du moment déjà fait.', 'C\'est fait, bravo.')+'</p><p style="color:var(--muted);font-weight:600">'+v(m.after, m.afteri || m.after)+'</p></div>';
      // mais on garde l'accès au change guidé
      if (['reveil','matin','aprem','soir'].includes(m.key)) {
        const cb = document.createElement('button');
        cb.style.cssText = 'width:100%;font-family:inherit;font-size:13.5px;font-weight:800;padding:11px;border-radius:12px;border:1.5px solid var(--amber);background:#FBF1DE;color:#9a742a;cursor:pointer;margin-top:4px';
        cb.textContent = '🔄 Changer la couche (guidé)';
        cb.addEventListener('click', () => startChange(m.key==='reveil'||m.key==='soir'?'pilier':'check'));
        acts.appendChild(cb);
      }
      return;
    }

    qEl.textContent = v(m.q, m.qi || m.q);
    acts.innerHTML = '';
    m.opts.forEach(opt => {
      const b = document.createElement('button');
      if (opt.cls) b.className = opt.cls;
      b.textContent = opt.label;
      b.addEventListener('click', async () => {
        await saveMoment(m.key, opt.result);
        if (opt.openForm) { toggleForm(true); }
        if (opt.change) { startChange(opt.change); return; } // lance le change guidé
        await renderMoment();
        try { await renderCheckStat(); } catch(e) {}
      });
      acts.appendChild(b);
    });

    // Bouton "changer maintenant" toujours dispo sur les moments de journée
    if (['matin','aprem'].includes(m.key)) {
      const cb = document.createElement('button');
      cb.className = 'a';
      cb.textContent = '🔄 Changer la couche maintenant';
      cb.addEventListener('click', () => startChange('check'));
      acts.appendChild(cb);
    }
    if (m.key === 'reveil' || m.key === 'soir') {
      const cb = document.createElement('button');
      cb.textContent = m.key === 'soir' ? '🔑 Faire le change de nuit guidé' : '🔑 Faire le change du matin guidé';
      cb.addEventListener('click', () => startChange('pilier'));
      acts.appendChild(cb);
    }
  }

  /* ---- Mode supervisé : tirage aléatoire d'équipement ---- */
  const EQUIP_POOL = [
    { id:'segufix', ic:'🔒', n:'Culotte Segufix verrouillée', d:'Uniquement pendant la présence active du superviseur.', lock:true },
    { id:'mittens', ic:'🧤', n:'Mittens (non verrouillées)', d:'Sensation d\'entrave, retirables à tout moment.' },
    { id:'combi',   ic:'🩱', n:'Combi anti-arrachage Seenin', d:'Maintien contenant, effet cocon.' },
    { id:'harnais', ic:'🎽', n:'Harnais fleece à sous-cutale', d:'Enveloppement doux, par-dessus la couche, bien réglé.' },
    { id:'crawling', ic:'🧦', n:'Crawling shoes (sans picots)', d:'Posture à quatre pattes, entrave de la marche. Picots retirés/neutralisés.' }
  ];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  async function getDraw(date) {
    try { const r = await window.storage.get('draw:'+date); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return null;
  }
  async function saveDraw(date, ids) {
    try { await window.storage.set('draw:'+date, JSON.stringify(ids)); } catch(e) {}
  }

  function renderDrawResult(ids) {
    const list = document.getElementById('supList');
    list.innerHTML = '';
    const hasLock = ids.some(id => { const e = EQUIP_POOL.find(x=>x.id===id); return e && e.lock; });
    ids.forEach(id => {
      const e = EQUIP_POOL.find(x => x.id === id);
      if (!e) return;
      const div = document.createElement('div');
      div.className = 'equip' + (e.lock ? ' lock' : '');
      div.innerHTML = '<div class="ic">'+e.ic+'</div><div class="body"><div class="n">'+e.n+'</div><div class="d">'+e.d+'</div></div>';
      list.appendChild(div);
    });
    const note = document.getElementById('supNote');
    if (hasLock) {
      note.innerHTML = '⚠️ Un élément verrouillé est tiré : vérifie que ton superviseur est bien présent, aux clés, et posez le signal d\'arrêt avant de commencer. Sur les fenêtres de régression (midi/soir), pas pendant sieste ou nuit.';
    } else {
      note.innerHTML = 'Tous les éléments tirés sont à libération : tu peux les porter en autonomie sur tes fenêtres de régression.';
    }
    document.getElementById('supResult').classList.add('show');
    const oncePer = document.getElementById('supOnce');
    if (oncePer) oncePer.style.display = '';
  }

  function lockDrawUI() {
    const btn = document.getElementById('supDraw');
    if (btn) btn.style.display = 'none';
  }

  document.getElementById('supDraw').addEventListener('click', async () => {
    // sécurité : si un tirage existe déjà pour aujourd'hui, on ne retire pas
    const already = await getDraw(todayStr());
    if (already && already.length) { lockDrawUI(); renderDrawResult(already); return; }
    const n = 2 + Math.floor(Math.random() * 4); // 2 à 5
    const ids = shuffle(EQUIP_POOL).slice(0, n).map(e => e.id);
    await saveDraw(todayStr(), ids);
    document.getElementById('supLead').textContent = 'Équipement du jour (' + ids.length + ')';
    renderDrawResult(ids);
    lockDrawUI();
  });

  document.getElementById('outfitDraw').addEventListener('click', async () => {
    const already = await getOutfit(todayStr());
    if (already) { renderOutfitResult(already); document.getElementById('outfitDraw').style.display='none'; return; }
    const o = drawOutfit();
    await saveOutfit(todayStr(), o);
    renderOutfitResult(o);
    document.getElementById('outfitDraw').style.display = 'none';
  });

  document.getElementById('breachSave').addEventListener('click', async () => {
    await saveBreaches(todayStr(), breachSel || {});
    updateBreachSummary(true);
    const flash = document.getElementById('breachFlash');
    flash.textContent = '🐾 Entorses enregistrées';
    setTimeout(() => flash.textContent = '', 1800);
    try { await renderDashboard(await getAll()); } catch(e) {}
  });

  document.getElementById('markSup').addEventListener('click', async () => {
    try { await window.storage.set('daytype:'+todayStr(), JSON.stringify('supervise')); } catch(e) {}
    await renderSupMode();
  });
  document.getElementById('markSolo').addEventListener('click', async () => {
    try { await window.storage.set('daytype:'+todayStr(), JSON.stringify('solo')); } catch(e) {}
    await renderSupMode();
  });

  // Affiche la carte supervisé seulement si le jour est marqué "supervisé"
  async function renderSupMode() {
    const supCard = document.getElementById('supCard');
    let type = null;
    try {
      const r = await window.storage.get('day:'+todayStr());
      if (r && r.value) { const e = JSON.parse(r.value); type = e.type || null; }
    } catch(e) {}
    // aussi : un marqueur léger posé depuis la carte elle-même
    if (!type) {
      try { const r2 = await window.storage.get('daytype:'+todayStr()); if (r2 && r2.value) type = JSON.parse(r2.value); } catch(e) {}
    }

    const prompt = document.getElementById('supPrompt');
    const inner = document.getElementById('supInner');
    if (type === 'supervise') {
      supCard.style.display = '';
      prompt.style.display = 'none';
      inner.style.display = '';
      const existing = await getDraw(todayStr());
      const btn = document.getElementById('supDraw');
      if (existing && existing.length) {
        document.getElementById('supLead').textContent = 'Équipement du jour (' + existing.length + ')';
        renderDrawResult(existing);
        if (btn) btn.style.display = 'none'; // déjà tiré aujourd'hui
      } else {
        if (btn) btn.style.display = ''; // pas encore tiré : bouton dispo
        document.getElementById('supResult').classList.remove('show');
      }
    } else if (type === 'solo') {
      supCard.style.display = 'none';
    } else {
      // type inconnu : on propose de marquer le jour
      supCard.style.display = '';
      prompt.style.display = '';
      inner.style.display = 'none';
    }
  }

  /* ==== Notifications locales + Réglages ==== */
  // Catégories de notifications non principales (les piliers restent sur alarmes système).
  const NOTIF_CATEGORIES = [
    { cat:'Piliers', badge:'aussi sur alarme', items:[
      { id:'reveil',    n:'Réveil', d:'7h00 · point du matin', m:7*60, body:'🍼 Réveil — ouvre l\'appli, tenue de nuit, verre d\'eau.' },
      { id:'change_matin', n:'Change du matin', d:'9h00 · pilier', m:9*60, body:'🔑 Change du matin — vérif peau, crème, tenue de jour.' },
      { id:'change_nuit',  n:'Change de nuit + bilan', d:'22h30 · pilier', m:22*60+30, body:'🔑 Change de nuit + bilan — vérif peau complète, crème généreuse, couche Safari.' },
      { id:'coucher',   n:'Coucher', d:'23h00', m:23*60, body:'🌙 Coucher — bonne nuit.' }
    ]},
    { cat:'Rituels', items:[
      { id:'reg_midi',  n:'Régression de midi', d:'12h00 · fenêtre douce', m:12*60, body:'🧸 Fenêtre régression douce — harnais, moment calme.' },
      { id:'sieste',    n:'Sieste', d:'14h30 · emmaillotage', m:14*60+30, body:'😴 Sieste — cocon, grenouillère + couverture.' },
      { id:'reg_soir',  n:'Régression du soir', d:'20h00 · grande fenêtre', m:20*60, body:'🧸 Grande fenêtre régression — allège l\'hydratation.' }
    ]},
    { cat:'Rythme', items:[
      { id:'check1', n:'Check + 1er biberon', d:'11h30', m:11*60+30, body:'✅ Check + 1er biberon.' },
      { id:'check3', n:'Change de sortie de sieste + 3e biberon', d:'16h00', m:16*60, body:'🔑 Change de sortie de sieste + 3e biberon.' }
    ]},
    { cat:'Repas', items:[
      { id:'petitdej', n:'Petit-déjeuner', d:'8h00', m:8*60, body:'🥣 Petit-déjeuner en tenue de nuit.' },
      { id:'dejeuner', n:'Déjeuner + 2e biberon', d:'13h30', m:13*60+30, body:'🍽️ Déjeuner + 2e biberon.' },
      { id:'diner', n:'Dîner', d:'19h30', m:19*60+30, body:'🍽️ Dîner — check si mouillé.' }
    ]},
    { cat:'Vérifs surprises', items:[
      { id:'surprise', n:'Vérif surprise à l\'ouverture', d:'aléatoire', m:null, body:null },
      { id:'ping', n:'Foxy m\'interpelle dans la journée', d:'spontané', m:null, body:null },
      { id:'milestone', n:'Félicitations et caps franchis', d:'automatique', m:null, body:null }
    ]}
  ];

  // ===== MODE INTENSIF (cadre strict + Foxy exigeant) =====
  let hardMode = false;
  const HARD = {
    overdueMin: 5,       // Foxy s'inquiète à +5 min (vs 15)
    wearAlertH: 5,       // alerte ferme de port prolongé à 5h
    wearCapH: 6.5,       // plafond non-reportable à 6h30
    maxBiberons: 5       // plafond hydratation (anti-excès)
  };
  async function loadHardMode() {
    try { const r = await window.storage.get('pref:hard'); if (r && r.value) hardMode = JSON.parse(r.value); } catch(e) {}
    try { const r2 = await window.storage.get('pref:bigbro'); if (r2 && r2.value) bigbro = JSON.parse(r2.value); } catch(e) {}
  }
  // ===== Foxy grand frère (ton dominateur bienveillant) =====
  let bigbro = false;
  function broOn() { return hardMode && bigbro; } // nécessite le mode intensif
  async function setBigbro(v) {
    bigbro = v;
    try { await window.storage.set('pref:bigbro', JSON.stringify(v)); } catch(e) {}
    const sw = document.getElementById('bigbroSwitch'); if (sw) sw.classList.toggle('on', bigbro);
  }
  // choisit le texte selon le mode : bro(texte doux, texte grand frère)
  function bro(soft, dom) { return broOn() ? dom : soft; }
  // le safeword coupe tout et ramène le Foxy doux
  async function triggerSafeword() {
    bigbro = false;
    try { await window.storage.set('pref:bigbro', JSON.stringify(false)); } catch(e) {}
    const sw = document.getElementById('bigbroSwitch'); if (sw) sw.classList.remove('on');
    try { imClear(); } catch(e) {}
    await imSay('*doux, immédiatement* Hé, je suis là. On arrête tout, d\'accord ? C\'est bon, tu es en sécurité.', 700, 'concern');
    await imSay('Reprends ton souffle. Je redeviens ton Foxy tout doux. Tu as très bien fait de me le dire. On va à ton rythme, tranquille. 🦊💛', 900, 'happy');
    if (currentM) await imOfferHelp(currentM);
  }
  async function setHardMode(v) {
    hardMode = v;
    try { await window.storage.set('pref:hard', JSON.stringify(v)); } catch(e) {}
    const sw = document.getElementById('hardSwitch'); if (sw) sw.classList.toggle('on', hardMode);
    document.body.classList.toggle('hardmode', hardMode);
    try { await refresh(); } catch(e) {}
  }

  let notifPrefs = {};
  async function loadNotifPrefs() {
    try { const r = await window.storage.get('pref:notif'); if (r && r.value) notifPrefs = JSON.parse(r.value); } catch(e) {}
    // défaut : tout activé sauf rien
    NOTIF_CATEGORIES.forEach(c => c.items.forEach(it => { if (notifPrefs[it.id] === undefined) notifPrefs[it.id] = true; }));
  }
  async function saveNotifPrefs() {
    try { await window.storage.set('pref:notif', JSON.stringify(notifPrefs)); } catch(e) {}
  }

  function notifPermState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }
  function updatePermBanner() {
    const banner = document.getElementById('permBanner');
    const st = notifPermState();
    if (st === 'granted') { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    const txt = document.getElementById('permText');
    const btn = document.getElementById('permBtn');
    if (st === 'unsupported') { txt.textContent = 'Ton navigateur ne gère pas les notifications ici.'; btn.style.display='none'; }
    else if (st === 'denied') { txt.textContent = 'Notifications bloquées. Autorise-les dans les réglages du site/navigateur.'; btn.style.display='none'; }
    else { txt.textContent = 'Autorise les notifications pour activer ces rappels.'; btn.style.display=''; }
  }

  function renderSettings() {
    const wrap = document.getElementById('setGroups');
    wrap.innerHTML = '';
    NOTIF_CATEGORIES.forEach(c => {
      const sec = document.createElement('div');
      sec.className = 'set-cat';
      const badge = c.badge ? ' <span style="font-size:10px;font-weight:800;color:var(--blue-deep);background:var(--blue-soft);border:1px solid #cdd3f0;border-radius:20px;padding:2px 8px;vertical-align:middle;margin-left:6px">'+c.badge+'</span>' : '';
      sec.innerHTML = '<h4>'+c.cat+badge+'</h4>';
      c.items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'set-row';
        const on = !!notifPrefs[it.id];
        row.innerHTML = '<div class="info"><div class="n">'+it.n+'</div><div class="d">'+it.d+'</div></div>';
        const sw = document.createElement('div');
        sw.className = 'switch' + (on ? ' on' : '');
        sw.innerHTML = '<div class="knob"></div>';
        sw.addEventListener('click', async () => {
          notifPrefs[it.id] = !notifPrefs[it.id];
          sw.classList.toggle('on', notifPrefs[it.id]);
          await saveNotifPrefs();
          scheduleNotifications();
        });
        row.appendChild(sw);
        sec.appendChild(row);
      });
      wrap.appendChild(sec);
    });
    updatePermBanner();
  }

  // Planification locale : programme les notifs restantes de la journée tant que l'appli vit.
  let notifTimers = [];
  function clearNotifTimers() { notifTimers.forEach(t => clearTimeout(t)); notifTimers = []; }
  // variantes Foxy des notifications (ton pote complice)
  const FOXY_NOTIF = {
    reveil:'Hey, debout ! Bien dormi ? On checke ta couche de nuit ?',
    change_matin:'C\'est l\'heure du grand change du matin, viens on s\'en occupe !',
    change_nuit:'Change de nuit + bilan ! On te prépare une couche bien épaisse.',
    coucher:'Allez, au dodo mec. On se capte demain !',
    reg_midi:'Petite pause régression de midi, blottis-toi tranquille.',
    sieste:'La sieste, le meilleur moment ! File dans ton cocon.',
    reg_soir:'Grosse détente du soir ! Allège l\'eau et profite.',
    check1:'Check + premier biberon ! Pense à bien boire.',
    check3:'Sortie de sieste : on change ta couche + ton troisième bibi !',
    petitdej:'Petit-déj en tenue de nuit, régale-toi !',
    dejeuner:'Déjeuner + deuxième biberon, bon app\' !',
    diner:'C\'est l\'heure du dîner ! Un petit check si besoin.',
    surprise:'Vérif surprise ! Ta couche est comment ?'
  };
  function scheduleNotifications() {
    clearNotifTimers();
    if (notifPermState() !== 'granted') return;
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    NOTIF_CATEGORIES.forEach(c => c.items.forEach(it => {
      if (it.m == null || !notifPrefs[it.id]) return;
      if (it.m <= nowMin) return; // déjà passé aujourd'hui
      const msUntil = (it.m - nowMin) * 60000 - now.getSeconds()*1000;
      if (msUntil > 0 && msUntil < 24*3600000) {
        const t = setTimeout(() => { showLocalNotif(it.n, it.body || it.n, it.id); }, msUntil);
        notifTimers.push(t);
      }
    }));
  }
  async function showLocalNotif(title, body, itemId) {
    if (paused) return;
    if (notifPermState() !== 'granted') return;
    const prefix = '🦊 ';
    let icon = 'icon-192.png';
    try { icon = await foxyCellDataURL('happy', 192); } catch(e) {}
    let finalBody = (itemId && FOXY_NOTIF[itemId]) ? FOXY_NOTIF[itemId] : body;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(prefix+title, { body: finalBody, icon, badge:'icon-192.png', tag:title }));
      } else {
        new Notification(prefix+title, { body: finalBody, icon });
      }
    } catch(e) {}
  }

  // ===== Navigation des paramètres (sections dépliables) =====
  const SETTINGS_RENDER = {
    wardrobeCard: async () => { await renderWardrobe(); await renderStock(); },
    qrCard:       async () => { await renderQrConfig(); await renderNfcWriter(); },
    sensorCard:   async () => { renderSensorGuide(); },
    lockCard:     async () => { await renderLockList(); renderLockGuide(); },
    debugCard:    async () => { await loadFoxyOutfit(); renderDebugOutfits(); }
  };
  document.querySelectorAll('.set-nav').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.target;
      const el = document.getElementById(id);
      if (!el) return;
      const opening = el.style.display === 'none' || !el.style.display;
      // referme les autres sections
      document.querySelectorAll('.set-nav').forEach(b => {
        const o = document.getElementById(b.dataset.target);
        if (o && b !== btn) { o.style.display = 'none'; b.classList.remove('on'); }
      });
      el.style.display = opening ? '' : 'none';
      btn.classList.toggle('on', opening);
      if (opening) {
        if (SETTINGS_RENDER[id]) { try { await SETTINGS_RENDER[id](); } catch(e) {} }
        el.scrollIntoView({behavior:'smooth', block:'start'});
      }
    });
  });

  document.getElementById('openSettings').addEventListener('click', () => {
    const card = document.getElementById('settingsCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { renderSettings(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
    else {
      // en fermant les paramètres, on referme toutes les sections
      document.querySelectorAll('.set-nav').forEach(b => {
        const o = document.getElementById(b.dataset.target);
        if (o) o.style.display = 'none';
        b.classList.remove('on');
      });
      const sn = document.getElementById('secNotif'); if (sn) sn.style.display = 'none';
    }
  });
  document.getElementById('permBtn').addEventListener('click', async () => {
    try {
      const res = await Notification.requestPermission();
      updatePermBanner();
      if (res === 'granted') scheduleNotifications();
    } catch(e) {}
  });

  // ---- Menu debug ----
  function renderDebugOutfits() {
    const box = document.getElementById('debugOutfits');
    if (!box) return;
    box.innerHTML = '';
    FOXY_OUTFITS.forEach(o => {
      const b = document.createElement('button');
      b.className = 'settings-toggle-btn';
      b.textContent = (foxyOutfit.id === o.id ? '🐾 ' : '') + o.name;
      b.addEventListener('click', async () => {
        foxyOutfit = o;
        try { await window.storage.set('foxyfit:'+todayStr(), JSON.stringify(o.id)); } catch(e) {}
        renderDebugOutfits();
        refreshHeadFoxy();
        if (voiceMode === 'foxy') { try { await imRunMoment(); } catch(e) {} }
      });
      box.appendChild(b);
    });
  }
  // ---- Onglets du reporting : Maintenant / Suivi / Cadre ----
  let currentTab = 'maintenant';
  async function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tabname === name));
    document.querySelectorAll('.tabcard').forEach(card => {
      card.style.display = (card.dataset.tab === name) ? '' : 'none';
    });
    // re-run les cartes auto-gérées pour qu'elles se cachent si besoin
    if (name === 'maintenant') {
      try { await renderOutfitCard(); } catch(e) {}
      try { await renderSupMode(); } catch(e) {}
      try { await renderMoment(); } catch(e) {}
    } else if (name === 'suivi') {
      try { await renderMoment(); } catch(e) {} // gère l'affichage du bilan du soir
    } else if (name === 'cadre') {
      renderTimeline();
    }
  }
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => showTab(b.dataset.tabname));
  });

  // Redirection auto vers le bilan du soir quand l'heure est venue (à partir de 22h30)
  async function maybeRedirectBilan() {
    if (paused) return;
    if (voiceMode !== 'report') return;
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    if (nowMin < 22*60+30 || nowMin >= 24*60) return; // fenêtre du bilan : 22h30 → minuit
    // déjà fait aujourd'hui ?
    let alreadySaved = false, alreadyRedirected = false;
    try {
      const r = await window.storage.get('day:'+todayStr());
      if (r && r.value) { const e = JSON.parse(r.value); if (e && e.skin) alreadySaved = true; }
    } catch(e) {}
    try {
      const r2 = await window.storage.get('bilanredir:'+todayStr());
      if (r2 && r2.value) alreadyRedirected = JSON.parse(r2.value);
    } catch(e) {}
    if (alreadySaved || alreadyRedirected) return;
    // on redirige : onglet Suivi + ouverture du bilan
    try { await window.storage.set('bilanredir:'+todayStr(), JSON.stringify(true)); } catch(e) {}
    await showTab('suivi');
    const formCard = document.getElementById('formCard');
    if (formCard) {
      formCard.style.display = '';
      toggleForm(true);
      const fs = document.getElementById('formSub');
      if (fs) fs.textContent = 'C\'est l\'heure de ton bilan du soir ! Note ta peau et ta journée.';
      setTimeout(() => formCard.scrollIntoView({ behavior:'smooth', block:'start' }), 200);
    }
  }

  (document.getElementById('openDebug')||{addEventListener(){}}).addEventListener('click', async () => {
    const card = document.getElementById('debugCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await loadFoxyOutfit(); renderDebugOutfits(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });

  // ==== Popup Foxy réutilisable (pause / reprise) ====
  function foxyPopShow(text, expr, buttons) {
    const ov = document.getElementById('foxyPop');
    const portrait = document.getElementById('foxyPopPortrait');
    const txt = document.getElementById('foxyPopText');
    const acts = document.getElementById('foxyPopActs');
    // portrait dans la tenue du jour, expression donnée
    positionFoxyCell(portrait, expr || 'happy', 120);
    txt.textContent = text;
    acts.innerHTML = '';
    (buttons || []).forEach(b => {
      const btn = document.createElement('button');
      if (b.soft) btn.className = 'soft';
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick());
      acts.appendChild(btn);
    });
    ov.style.display = 'flex';
  }
  function foxyPopHide() { const ov = document.getElementById('foxyPop'); if (ov) ov.style.display = 'none'; }

  // ==== Mode pause (façade neutre, suspend tout, fige le suivi) ====
  let paused = false;
  async function loadPause() {
    try { const r = await window.storage.get('pref:paused'); if (r && r.value) paused = JSON.parse(r.value); } catch(e) {}
    document.body.classList.toggle('paused', paused);
    if (paused) fillFacade();
  }
  // ---- Écran de connexion (façade de pause) ----
  async function getPausePass() {
    try { const r = await window.storage.get('pref:pausepass'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return null;
  }
  async function setPausePass(v) {
    try { await window.storage.set('pref:pausepass', JSON.stringify(v)); } catch(e) {}
  }
  function facadeError(msg) {
    const e = document.getElementById('facadeErr');
    if (e) { e.textContent = msg; setTimeout(() => { if (e.textContent === msg) e.textContent = ''; }, 3000); }
  }
  async function tryFacadeLogin() {
    const inp = document.getElementById('facadePass');
    const saisi = (inp ? inp.value : '').trim();
    if (!saisi) { facadeError('Saisis ton mot de passe.'); return; }
    const attendu = await getPausePass();
    if (!attendu) {
      // aucun mot de passe défini : on l'accepte et on le mémorise
      await setPausePass(saisi);
      if (inp) inp.value = '';
      await exitPause();
      return;
    }
    if (saisi === attendu) { if (inp) inp.value = ''; await exitPause(); }
    else facadeError('Mot de passe incorrect.');
  }
  function fillFacade() {
    const inp = document.getElementById('facadePass');
    if (inp) inp.value = '';
    const e = document.getElementById('facadeErr');
    if (e) e.textContent = '';
  }
  function fillFacadeOld() {
    try {
      const now = new Date();
      const d = document.getElementById('facadeDay');
      if (d) { try { d.textContent = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }); } catch(e) {} }
      const box = document.getElementById('facadeHours');
      if (box) {
        const icones = ['☀️','🌤️','⛅','☁️','🌤️','⛅'];
        let html = '';
        for (let i = 0; i < 6; i++) {
          const h = (now.getHours() + i) % 24;
          const t = 18 + Math.round(Math.sin((h - 6) / 24 * Math.PI * 2) * 4);
          html += '<div class="facade-h"><div class="hh">' + (i === 0 ? 'Maint.' : String(h).padStart(2,'0') + 'h') + '</div>' +
                  '<div class="ic">' + icones[i % icones.length] + '</div>' +
                  '<div class="tt">' + t + '°</div></div>';
        }
        box.innerHTML = html;
      }
      const tmp = document.getElementById('facadeTemp');
      if (tmp) {
        const h = now.getHours();
        tmp.textContent = (18 + Math.round(Math.sin((h - 6) / 24 * Math.PI * 2) * 4)) + '°';
      }
    } catch(e) {}
  }

  async function doEnterPause() {
    paused = true;
    document.body.classList.add('paused');
    try { await window.storage.set('pref:paused', JSON.stringify(true)); } catch(e) {}
    try { await window.storage.set('pause:start', JSON.stringify(Date.now())); } catch(e) {}
    const ov = document.getElementById('overlay'); if (ov) ov.classList.remove('show');
    fillFacade();
  }
  function enterPause() {
    try { foxyPopHide(); } catch(e) {}
    try { loadFoxyOutfit(); } catch(e) {}
    if (hardMode) {
      // en intensif, Foxy résiste : il faut confirmer fermement
      foxyPopShow('Tu veux vraiment faire une pause ? En mode intensif, on ne s\'échappe pas comme ça... Réfléchis bien. Tu es sûr ?', 'concern', [
        { label:'Oui, j\'ai vraiment besoin de faire une pause', onClick: async () => {
          foxyPopShow('Bon... d\'accord, si tu en as VRAIMENT besoin. Mais je compte sur toi pour revenir vite reprendre le cadre. À tout à l\'heure. 🦊', 'pensive', [
            { label:'Je reviens vite, promis', onClick: async () => { foxyPopHide(); await doEnterPause(); } }
          ]);
        }},
        { soft:true, label:'Non, je continue', onClick: async () => { foxyPopHide(); } }
      ]);
      return;
    }
    foxyPopShow('À très vite, mon compagnon ! Je t\'attends bien au chaud, reviens quand tu veux. 🦊💛', 'wave', [
      { label:'À tout à l\'heure Foxy', onClick: async () => { foxyPopHide(); await doEnterPause(); } }
    ]);
  }
  async function exitPause() {
    paused = false;
    document.body.classList.remove('paused');
    try { await window.storage.set('pref:paused', JSON.stringify(false)); } catch(e) {}
    try { await refresh(); } catch(e) {}
    // durée de la pause → programme de reprise gradué
    let start = null;
    try { const r = await window.storage.get('pause:start'); if (r && r.value) start = JSON.parse(r.value); } catch(e) {}
    const hours = start ? (Date.now() - start) / 3600000 : 0;
    await runResumeProgram(hours);
  }

  // Programme de reprise : plus la pause a duré, plus la reprise est exigeante
  async function runResumeProgram(hours) {
    const now = new Date();
    const isNight = now.getHours() >= 23 || now.getHours() < 7;

    // --- Palier COURT (< 2h) : reprise légère ---
    if (hours < 2) {
      if (isNight) {
        foxyPopShow('Mmh... te revoilà. Il est tard, mais je suis content que tu sois là. 😴🦊', 'sleep', [
          { label:'Coucou Foxy', onClick: async () => { foxyPopHide(); if (voiceMode==='foxy') { try { await imRunMoment(); } catch(e){} } } }
        ]);
        return;
      }
      foxyPopShow('Te revoilà ! Courte absence, on reprend le fil tranquillement. Tu es toujours en couche ?', 'joy', [
        { label:'🤗 Oui, on replonge !', onClick: async () => { foxyPopHide(); if (voiceMode !== 'foxy') { await setVoiceMode('foxy'); } else { try { await imRunMoment(); } catch(e){} } }},
        { label:'👕 Non, je dois me remettre en couche', onClick: async () => {
          foxyPopHide();
          if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
          try { await runReentryProtocol('court'); } catch(e) {}
        }},
        { soft:true, label:'Pas tout de suite', onClick: async () => {
          foxyPopShow('D\'accord... je t\'attends. Reviens vite. 🦊💛', 'concern', [
            { label:'À très vite', onClick: async () => { foxyPopHide(); await doEnterPause(); } }
          ]);
        }}
      ]);
      return;
    }

    // --- Paliers supérieurs : reprise imposée ---
    let niveau, dureeTxt, entorse, msg1, msg2;
    if (hours < 24) {
      niveau = 'moyen';
      dureeTxt = Math.round(hours) + 'h';
      entorse = 'pause_moyenne';
      msg1 = 'Te voilà. Tu as été absent ' + dureeTxt + '. On ne reprend pas comme si de rien n\'était.';
      msg2 = 'Change de reprise, tout de suite, et vérification de ton état. Ensuite on retrouve le rythme. Allez.';
    } else if (hours < 72) {
      niveau = 'long';
      dureeTxt = Math.round(hours/24) + ' jour(s)';
      entorse = 'pause_longue';
      msg1 = dureeTxt + ' d\'absence. C\'est long. Le cadre s\'est défait pendant ce temps, et ça, ça compte.';
      msg2 = 'Reprise stricte : change immédiat, contention sur ta prochaine fenêtre, et je te surveille de près pour le reste de la journée. On répare ça ensemble.';
    } else {
      niveau = 'tres_long';
      dureeTxt = Math.round(hours/24) + ' jours';
      entorse = 'pause_tres_longue';
      msg1 = dureeTxt + ' sans rien. Tu as complètement déserté le programme. Je ne vais pas faire semblant que ce n\'est rien.';
      msg2 = 'On reprend au maximum d\'exigence, immédiatement. Change, contention, vigilance totale. Ton corps aura besoin de quelques heures pour relâcher à nouveau — ça, c\'est normal, je ne t\'en tiens pas rigueur. Mais l\'engagement, lui, tu le reprends maintenant. Entièrement.';
    }

    // enregistre l'entorse correspondante
    try {
      const date = todayStr();
      const r = await window.storage.get('breach:'+date);
      const b = (r && r.value) ? JSON.parse(r.value) : {};
      b[entorse] = true;
      await window.storage.set('breach:'+date, JSON.stringify(b));
    } catch(e) {}
    // vigilance renforcée le reste de la journée
    if (niveau === 'long' || niveau === 'tres_long') {
      try { await window.storage.set('vigilance:until', JSON.stringify(new Date().setHours(23,59,59,999))); } catch(e) {}
    }
    // marque le change de reprise à faire
    try { await window.storage.set('reprise:change', JSON.stringify(todayStr()+':'+Date.now())); } catch(e) {}

    foxyPopShow(msg1, 'concern', [
      { label:'Je t\'écoute...', onClick: async () => {
        foxyPopShow(msg2, niveau === 'tres_long' ? 'surprised' : 'concern', [
          { label:'🦊 Comment je reprends ?', onClick: async () => {
            foxyPopHide();
            if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
            try { await runReentryProtocol(niveau); } catch(e) {}
          }}
        ]);
      }}
    ]);
  }

  /* ============================================================
     PROTOCOLE DE REMISE EN COUCHE — après une pause, tu n'es PAS
     en couche : Foxy explique la marche à suivre étape par étape,
     tire les tenues du jour et te remet dans le programme.
     ============================================================ */
  async function runReentryProtocol(niveau) {
    imClear();
    const now = new Date();
    const h = now.getHours();
    const periode = (h >= 22 || h < 8) ? 'nuit' : 'jour';

    // --- Accueil chaleureux : retour à la maison ---
    const ACCUEIL = broOn() ? [
      'Te revoilà chez toi. Tu peux poser tout ce que tu portais dehors — ici, ça ne te sert à rien.',
      'Respire. Tu es rentré. Ta vie d\'adulte reste à la porte, elle t\'attendra bien.',
      'Ici, tu n\'as plus de décisions à prendre. C\'est moi qui m\'occupe de tout. Laisse-toi aller.'
    ] : [
      'Te revoilàààà ! 🦊💛 Bienvenue à la maison, tu m\'as tellement manqué !',
      'Ahhh, ça fait du bien de te retrouver ! Allez, pose tout ça : ici tu peux laisser ta vie d\'adulte dehors.',
      'Tu es rentré ! Ici, pas de responsabilités, pas de pression — juste toi, moi, et plein de douceur. 💛'
    ];
    for (const a of ACCUEIL) { await imSay(a, 950, broOn() ? 'calm' : 'comfort'); }
    await imSay(broOn()
      ? 'Maintenant, on te remet dans ton état normal. Tu n\'as pas porté de couche pendant ton absence — on repart du début.'
      : 'Bon, on va te remettre bien comme il faut ! Tu n\'as pas porté de couche pendant ta pause, alors on repart du début. Je t\'explique tout, suis-moi. 🦊', 1000, 'calm');

    // 1) tirage automatique des tenues
    let tenues = null;
    try { tenues = drawOutfit(); } catch(e) {}
    // 2) modèle de couche selon le moment
    let modele = null;
    try {
      if (window.HabitrainWardrobe) {
        const dispo = (await window.HabitrainWardrobe.modelsFor(periode)).filter(x => x.qty > 0);
        modele = dispo.length ? dispo[0] : null;
      }
    } catch(e) {}

    const tenueDuMoment = tenues ? (periode === 'nuit' ? tenues.nuit : tenues.jour) : null;

    await imSay('J\'ai tiré ta tenue pour toi — tu ne choisis pas, ça fait partie du retour dans le cadre.', 900, 'proud');
    let recap = '👕 Tenue de ' + periode + ' : ' + (tenueDuMoment || 'ta tenue habituelle');
    if (modele) recap += '\n🍼 Couche : ' + modele.name + ' (' + modele.qty + ' en stock)';
    else recap += '\n🍼 Couche : prends ce que tu as en stock';
    if (tenues) recap += '\n😴 Pour la sieste : ' + tenues.sieste;
    // accessoires et dispositifs à remettre
    let access = [];
    try {
      if (window.HabitrainWardrobe) {
        const w = await window.HabitrainWardrobe.getWardrobe();
        access = (w.access || []).slice();
      }
    } catch(e) {}
    if (access.length) recap += '\n🧸 Accessoires : ' + access.join(', ');
    // bracelet / QR / NFC si le verrouillage est actif
    let braceletActif = false;
    try {
      if (window.HabitrainQR) {
        const prefs = await window.HabitrainQR.getQrPrefs();
        braceletActif = !!(prefs.braceletRequired || prefs.unlock);
      }
    } catch(e) {}
    if (braceletActif) recap += '\n🔒 Ton bracelet (QR/NFC) : à remettre au poignet — obligatoire.';
    await imSay(recap, 1100, 'explain');

    // 3) la marche à suivre
    await imSay('Voilà la marche à suivre, dans l\'ordre :', 850, 'teach');
    const etapes = [
      '1. Va à ton espace de change et prépare tout : couche, crème, lingettes.',
      '2. Déshabille-toi complètement. On repart de zéro.',
      '3. Vérifie ta peau avant de commencer — elle doit être propre et sèche.',
      '4. Applique la crème barrière, généreusement.',
      '5. Mets ta couche en suivant le guide des 4 languettes.',
      '6. Enfile la tenue que je t\'ai tirée.',
      braceletActif ? '7. Remets ton bracelet au poignet — sans lui, l\'appli restera verrouillée.' : null,
      access.length ? '8. Reprends tes accessoires : ' + access.join(', ') + '.' : null,
      '9. Si tu utilises le capteur, reclipse-le et reconnecte-le dans le menu 📡.',
      niveau === 'tres_long'
        ? '7. Et prends un moment pour te réhabituer. Ton corps a perdu le réflexe, c\'est normal — ne force pas, laisse revenir.'
        : '7. Reprends ton rythme normal : le prochain créneau te sera rappelé.'
    ];
    const liste = etapes.filter(Boolean).map((t, i) => t.replace(/^\d+\./, (i+1) + '.'));
    for (const e of liste) { await imSay(e, 800, 'explain'); }

    if (niveau === 'long' || niveau === 'tres_long') {
      await imSay('Et n\'oublie pas : contention douce sur ta prochaine fenêtre de régression, et je te surveille de près pour le reste de la journée.', 950, 'calm');
    }

    imSetActions([
      { label:'🦊 C\'est fait, je suis en couche', onClick: async () => {
        imAddMe('C\'est fait, je suis en couche.');
        // enregistre la remise en couche comme un change effectif
        try { await finishChange(); } catch(e) {}
        await imSay(broOn()
          ? 'Bien. Te revoilà où tu dois être, comme il faut. Maintenant tu ne ressors plus du cadre — laisse-toi porter, c\'est tout ce que tu as à faire.'
          : 'Voilààà ! Te revoilà tout bien installé. 🦊 Tu es à la maison, en sécurité, et je m\'occupe de tout maintenant. Content de t\'avoir retrouvé, vraiment. 💛', 1000, 'proud');
        try { await imRunMoment(); } catch(e) {}
      }},
      { soft:true, label:'Répète-moi les étapes', onClick: async () => { await runReentryProtocol(niveau); } }
    ]);
  }
  // --- câblage de l'écran de connexion ---
  (function(){
    const btn = document.getElementById('facadeLogin');
    const inp = document.getElementById('facadePass');
    if (btn) btn.addEventListener('click', tryFacadeLogin);
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryFacadeLogin(); });
    const q = document.getElementById('facadeQr');
    if (q) q.addEventListener('click', () => {
      if (!window.HabitrainQR) { facadeError('Scan indisponible sur cet appareil.'); return; }
      window.HabitrainQR.startScan('unlock', async (kind) => {
        if (kind === 'unlock') await exitPause();
        else facadeError('QR non reconnu.');
      });
    });
    const n = document.getElementById('facadeNfc');
    if (n) n.addEventListener('click', async () => {
      const NFC = window.HabitrainNFC;
      if (!NFC || !NFC.supported()) { facadeError('NFC non disponible sur cet appareil.'); return; }
      facadeError('Approche ton tag…');
      try {
        await NFC.startScan(async (payload) => {
          try {
            const kind = await window.HabitrainQR.parsePayloadPublic(payload);
            if (kind === 'unlock') { NFC.stopScan(); await exitPause(); }
            else facadeError('Tag non reconnu.');
          } catch(e) { facadeError('Tag non reconnu.'); }
        });
      } catch(e) { facadeError('Lecture NFC impossible.'); }
    });
  })();

  (function(){
    const b0 = document.getElementById('obRestart');
    if (b0) b0.addEventListener('click', async () => {
      try { await window.storage.delete('ob:done'); } catch(e) {}
      obIndex = 0;
      document.body.classList.add('onboarding');
      await renderOnboard();
    });
  })();

  (function(){
    const b = document.getElementById('pausePassSave');
    if (b) b.addEventListener('click', async () => {
      const i = document.getElementById('pausePassInput');
      const v = (i ? i.value : '').trim();
      if (!v) return;
      await setPausePass(v);
      if (i) i.value = '';
      const f = document.getElementById('pausePassFlash');
      if (f) { f.textContent = '🔑 Mot de passe enregistré'; setTimeout(()=>f.textContent='', 2200); }
    });
  })();

  document.getElementById('pauseBtn').addEventListener('click', enterPause);
  // reprise par geste discret : 3 tapes rapides sur le titre "Notes"
  (function(){
    let taps = [], t;
    const title = document.getElementById('facadeTitle');
    if (!title) return;
    title.addEventListener('click', () => {
      const now = Date.now();
      taps.push(now);
      taps = taps.filter(x => now - x < 1200); // fenêtre de 1,2s
      if (taps.length >= 3) { taps = []; exitPause(); }
    });
  })();

  // ---- Menu Sauvegarde (export / import) ----
  (document.getElementById('openSave')||{addEventListener(){}}).addEventListener('click', () => {
    const card = document.getElementById('saveCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) card.scrollIntoView({behavior:'smooth', block:'start'});
  });

  // ==== Menu QR codes ====
  const QR = window.HabitrainQR;
  (document.getElementById('openQr')||{addEventListener(){}}).addEventListener('click', async () => {
    const card = document.getElementById('qrCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await renderQrConfig(); await renderNfcWriter(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
  // ===== Programmation des tags NFC =====
  async function renderNfcWriter() {
    const sup = document.getElementById('nfcSupport');
    const list = document.getElementById('nfcWriteList');
    const res = document.getElementById('nfcWriteResult');
    if (!sup || !list) return;
    const NFC = window.HabitrainNFC;
    if (!NFC || !NFC.supported()) {
      sup.innerHTML = '⚠️ Web NFC non disponible sur cet appareil (Android + Chrome requis). Les QR codes fonctionnent normalement.';
      list.innerHTML = '';
      return;
    }
    sup.innerHTML = '✅ NFC disponible. Choisis ce que tu veux écrire, puis approche un tag vierge du dos du téléphone.';
    list.innerHTML = '';
    const cibles = [
      { kind:'unlock',        label:'🔒 Bracelet (déverrouillage)' },
      { kind:'change_pilier', label:'🔑 Change pilier' },
      { kind:'change_tous',   label:'🍼 Tous les changes' },
      { kind:'biberon',       label:'🍼 Biberon' },
      { kind:'coucher',       label:'🌙 Coucher' }
    ];
    cibles.forEach(c => {
      const b = document.createElement('button');
      b.className = 'settings-toggle-btn';
      b.textContent = '📶 Écrire : ' + c.label;
      b.addEventListener('click', async () => {
        try {
          const payload = await window.HabitrainQR.payloadFor(c.kind);
          res.textContent = '📶 Approche le tag du dos du téléphone...';
          await NFC.writeTag(payload);
          res.textContent = '✅ Tag « ' + c.label + ' » programmé ! Colle-le au bon endroit.';
        } catch (e) {
          res.textContent = '⚠️ Échec : ' + (e.message || 'tag non détecté ou protégé') + '. Réessaie en le maintenant contre le téléphone.';
        }
      });
      list.appendChild(b);
    });
  }

  (function(){
    const t = document.getElementById('qrGuideToggle');
    if (t) t.addEventListener('click', () => {
      const g = document.getElementById('qrGuide');
      if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
    });
    const t2 = document.getElementById('qrRulesToggle');
    if (t2) t2.addEventListener('click', () => {
      const g = document.getElementById('qrRules');
      if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
    });
  })();

  /* ============================================================
     ONBOARDING — guide du premier lancement
     Foxy accueille, explique, et vérifie que tout est en place.
     ============================================================ */
  let obIndex = 0;

  // Vérifications automatiques : ce que l'appli peut constater seule
  async function obChecks() {
    const out = {};
    // notifications autorisées
    out.notif = (notifPermState() === 'granted');
    // stock de couches renseigné
    try {
      if (window.HabitrainWardrobe) {
        const st = await window.HabitrainWardrobe.categoryStatus();
        out.stock = (st.jour.total > 0 || st.nuit.total > 0);
      }
    } catch(e) { out.stock = false; }
    // garde-robe personnalisée (au moins une tenue)
    try {
      if (window.HabitrainWardrobe) {
        const w = await window.HabitrainWardrobe.getWardrobe();
        out.wardrobe = ((w.jour||[]).length > 0 && (w.nuit||[]).length > 0);
      }
    } catch(e) { out.wardrobe = false; }
    // mot de passe de pause défini
    try { out.pass = !!(await getPausePass()); } catch(e) { out.pass = false; }
    // export de sauvegarde déjà fait
    try { const r = await window.storage.get('ob:exported'); out.export = !!(r && r.value); } catch(e) { out.export = false; }
    // QR générés au moins une fois
    try { const r = await window.storage.get('ob:qrdone'); out.qr = !!(r && r.value); } catch(e) { out.qr = false; }
    // niveau de missions choisi
    try { if (window.HabitrainMissions) { const st = await window.HabitrainMissions.getState(); out.missions = !!st.level; } } catch(e) { out.missions = false; }
    return out;
  }

  // Étapes de l'onboarding
  function obSteps() {
    return [
      {
        expr:'comfort', titre:'Bienvenue à la maison 🦊',
        texte:'Salut ! Moi c\'est Foxy, je serai ton compagnon tout au long de ton programme. Avant qu\'on commence, on va vérifier ensemble que tout est bien en place. Ça prend deux minutes.',
        items:null, suivant:'On y va !'
      },
      {
        expr:'explain', titre:'Ce que je fais pour toi',
        texte:'Je te rappelle tes changes, je suis ta peau et ton hydratation, je te propose des missions, et je suis là pour discuter. Tu peux me parler librement, ou utiliser les boutons.',
        items:null, suivant:'Compris'
      },
      {
        expr:'curious', titre:'L\'essentiel à configurer',
        texte:'Voici ce qu\'il faut mettre en place. Je coche tout seul ce qui est déjà fait — tape sur une ligne pour aller la régler.',
        items:[
          { k:'notif',    t:'Autoriser les notifications', s:'Sinon je ne pourrai pas te rappeler tes créneaux', go:'settingsCard' },
          { k:'wardrobe', t:'Vérifier ta garde-robe',      s:'Paramètres → Garde-robe & stock',                 go:'wardrobeCard' },
          { k:'stock',    t:'Renseigner ton stock de couches', s:'Quantités par modèle, jour et nuit',          go:'wardrobeCard' },
          { k:'missions', t:'Choisir ton niveau de missions', s:'De Doux à Intense',                            go:'missionsCard' }
        ],
        suivant:'Suite'
      },
      {
        expr:'calm', titre:'Sécurité et sauvegarde',
        texte:'Deux choses à ne pas négliger — elles t\'éviteront de gros ennuis.',
        items:[
          { k:'pass',   t:'Définir un mot de passe de pause', s:'Pour déverrouiller l\'écran de connexion', go:'settingsCard' },
          { k:'export', t:'Faire un premier export',          s:'Tes données ne vivent que sur ce téléphone', go:'saveCard' }
        ],
        suivant:'Suite'
      },
      {
        expr:'proud', titre:'Options avancées',
        texte:'Ces éléments sont facultatifs. Tu peux les activer maintenant ou plus tard, quand tu auras le matériel.',
        items:[
          { k:'qr', t:'Générer et coller tes QR codes', s:'Tapis de change, frigo, porte, bracelet', go:'qrCard' }
        ],
        suivant:'Suite'
      },
      {
        expr:'reassure', titre:'Trois réflexes à garder',
        texte:'⚠️ Garde une capture de tes QR si tu actives le bracelet bloquant.\n\n⚠️ Le secours anti-blocage : 3 tapes rapides sur le logo de l\'écran de connexion.\n\n⚠️ Refais un export de sauvegarde de temps en temps.',
        items:null, suivant:'C\'est noté'
      },
      {
        expr:'cheer', titre:'On est prêts !',
        texte:'Voilà, tout est en place. Je serai là à chaque moment de ta journée. Prends soin de toi, et laisse-toi porter — je m\'occupe du reste. 💛',
        items:null, suivant:'Commencer mon programme'
      }
    ];
  }

  async function renderOnboard() {
    const steps = obSteps();
    const st = steps[obIndex];
    if (!st) { await finishOnboard(); return; }
    try { await loadFoxyOutfit(); } catch(e) {}
    try { positionFoxyCell(document.getElementById('obFoxy'), st.expr, 130); } catch(e) {}
    document.getElementById('obStep').textContent = 'Étape ' + (obIndex+1) + ' / ' + steps.length;
    document.getElementById('obTitle').textContent = st.titre;
    document.getElementById('obText').textContent = st.texte;

    const list = document.getElementById('obList');
    list.innerHTML = '';
    if (st.items) {
      const checks = await obChecks();
      st.items.forEach(it => {
        const fait = !!checks[it.k];
        const d = document.createElement('div');
        d.className = 'ob-item' + (fait ? ' ok' : '');
        d.innerHTML = '<span class="mark">' + (fait ? '✅' : '⬜') + '</span>' +
          '<span class="lbl"><b>' + it.t + '</b><span class="sub">' + it.s + '</span></span>';
        d.addEventListener('click', async () => {
          // ferme l'onboarding et ouvre l'écran concerné
          document.body.classList.remove('onboarding');
          const card = document.getElementById(it.go);
          if (card) {
            if (it.go !== 'settingsCard' && it.go !== 'missionsCard') {
              const sc = document.getElementById('settingsCard');
              if (sc) { sc.style.display = ''; renderSettings(); }
            }
            card.style.display = '';
            if (SETTINGS_RENDER && SETTINGS_RENDER[it.go]) { try { await SETTINGS_RENDER[it.go](); } catch(e) {} }
            if (it.go === 'missionsCard') { try { await renderMissions(); } catch(e) {} }
            if (it.go === 'saveCard') { /* rien à rendre */ }
            card.scrollIntoView({behavior:'smooth', block:'start'});
          }
          // bouton de retour à l'onboarding
          showObResume();
        });
        list.appendChild(d);
      });
    }

    const acts = document.getElementById('obActs');
    acts.innerHTML = '';
    const b = document.createElement('button');
    b.textContent = st.suivant;
    b.addEventListener('click', async () => { obIndex++; await renderOnboard(); });
    acts.appendChild(b);
    if (obIndex > 0) {
      const p = document.createElement('button');
      p.className = 'soft'; p.textContent = 'Retour';
      p.addEventListener('click', async () => { obIndex = Math.max(0, obIndex-1); await renderOnboard(); });
      acts.appendChild(p);
    }
    if (obIndex < steps.length - 1) {
      const sk = document.createElement('button');
      sk.className = 'soft'; sk.textContent = 'Passer le guide';
      sk.addEventListener('click', async () => { await finishOnboard(); });
      acts.appendChild(sk);
    }
  }

  // petit bouton flottant pour revenir au guide après être allé régler quelque chose
  function showObResume() {
    if (document.getElementById('obResume')) return;
    const b = document.createElement('button');
    b.id = 'obResume';
    b.textContent = '🦊 Reprendre le guide';
    b.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9000;' +
      'padding:13px 20px;border:none;border-radius:16px;font-family:inherit;font-size:14.5px;font-weight:800;' +
      'background:#d9743a;color:#fff;box-shadow:0 6px 20px rgba(217,116,58,.45);cursor:pointer';
    b.addEventListener('click', async () => {
      b.remove();
      document.body.classList.add('onboarding');
      await renderOnboard();
    });
    document.body.appendChild(b);
  }

  async function finishOnboard() {
    document.body.classList.remove('onboarding');
    const r = document.getElementById('obResume'); if (r) r.remove();
    try { await window.storage.set('ob:done', JSON.stringify(true)); } catch(e) {}
  }

  async function maybeStartOnboard() {
    try {
      const r = await window.storage.get('ob:done');
      if (r && r.value) return false;
      obIndex = 0;
      document.body.classList.add('onboarding');
      await renderOnboard();
      return true;
    } catch(e) { return false; }
  }

  // ===== Missions =====
  const MS = window.HabitrainMissions;

  // Évalue une mission JOURNALIÈRE sur les données du jour
  async function evalDaily(m) {
    const date = todayStr();
    const checks = await getChecks(date);
    const cnt = r => checks.filter(c => c.result === r).length;
    try {
      switch (m.kind) {
        case 'bib': {
          const e = (await getAll()).find(x => x.date === date);
          return { done: e && (e.bib||0) >= m.target, progress: e ? (e.bib||0) : 0, total:m.target };
        }
        case 'pillars': {
          const r = await window.storage.get('slotdone:'+date);
          const d = (r && r.value) ? JSON.parse(r.value) : {};
          const n = ['c0900','c1600','c2230'].filter(k => d[k]).length;
          return { done: n >= m.target, progress:n, total:m.target };
        }
        case 'nobreach': {
          const r = await window.storage.get('breach:'+date);
          const b = (r && r.value) ? JSON.parse(r.value) : {};
          const n = Object.keys(b).filter(k => b[k]).length;
          return { done: n === 0, progress: n === 0 ? 1 : 0, total:1 };
        }
        case 'countResult': { const n = cnt(m.result); return { done:n >= m.target, progress:n, total:m.target }; }
        case 'checks': return { done: checks.length >= m.target, progress:checks.length, total:m.target };
        case 'report': { const e = (await getAll()).find(x => x.date === date); return { done: !!(e && e.skin), progress: e&&e.skin?1:0, total:1 }; }
        case 'journalToday': {
          const q = await getQuest();
          const n = (q.journal||[]).filter(j => (j.t||'').slice(0,10) === date).length;
          return { done:n >= m.target, progress:n, total:m.target };
        }
        case 'skinToday': { const e = (await getAll()).find(x => x.date === date); return { done: e && e.skin === m.skin, progress: e&&e.skin===m.skin?1:0, total:1 }; }
        case 'introspect': { const r = await window.storage.get('introspect:last'); const v = (r&&r.value)?JSON.parse(r.value):null; return { done:v===date, progress:v===date?1:0, total:1 }; }
        case 'nap': { const n = cnt('aprem_sieste'); return { done:n>0, progress:n?1:0, total:1 }; }
        case 'scan': { const n = checks.filter(c => c.result === 'change_fait' && c.type && c.type.indexOf('preuve')>=0).length + cnt('change_fait_scan'); return { done:n>0, progress:n?1:0, total:1 }; }
        case 'ritual': { const q = await getQuest(); return { done: q.ritualDoneDate === date, progress: q.ritualDoneDate===date?1:0, total:1 }; }
        case 'nolockemg': { const n = cnt('lock_emergency'); return { done:n===0, progress:n===0?1:0, total:1 }; }
      }
    } catch(e) {}
    return { done:false, progress:0, total:1 };
  }

  // Évalue une mission de PÉRIODE
  async function evalPeriod(m, active) {
    try {
      const entries = await getAll();
      const since = active ? new Date(active.start) : null;
      const inRange = d => !since || new Date(d) >= since;
      switch (m.kind) {
        case 'streak': {
          const byDate = {}; entries.forEach(e => { if (e && e.date) byDate[e.date]=true; });
          let n=0; for (let i=0;;i++){const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);
            if (byDate[k]) n++; else { if(i===0) continue; break; } }
          return { done:n>=m.target, progress:n, total:m.target };
        }
        case 'noBreachStreak': {
          let n=0;
          for (let i=0;;i++){
            const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10);
            const r = await window.storage.get('breach:'+k);
            const b = (r&&r.value)?JSON.parse(r.value):{};
            const has = Object.keys(b).some(x=>b[x]);
            const filled = entries.some(e=>e&&e.date===k);
            if (!filled && i===0) continue;
            if (filled && !has) n++; else break;
            if (i>60) break;
          }
          return { done:n>=m.target, progress:n, total:m.target };
        }
        case 'countResult': {
          let n=0;
          for (const e of entries) {
            if (!e || !e.date || !inRange(e.date)) continue;
            const cs = await getChecks(e.date);
            n += cs.filter(c=>c.result===m.result).length;
          }
          return { done:n>=m.target, progress:n, total:m.target };
        }
        case 'countSkin': {
          const n = entries.filter(e=>e&&e.skin===m.skin&&inRange(e.date)).length;
          return { done:n>=m.target, progress:n, total:m.target };
        }
        case 'stage': {
          const r = await window.storage.get('queststage');
          const st = (r&&r.value)?JSON.parse(r.value):0;
          return { done:st>=m.target, progress:st, total:m.target };
        }
        case 'journal': { const q=await getQuest(); const n=(q.journal||[]).length; return { done:n>=m.target, progress:n, total:m.target }; }
        case 'confidences': { const q=await getQuest(); const n=(q.confidences||[]).length; return { done:n>=m.target, progress:n, total:m.target }; }
        case 'hardStreak': {
          const r = await window.storage.get('hardstreak');
          const n = (r&&r.value)?JSON.parse(r.value):0;
          return { done:n>=m.target, progress:n, total:m.target };
        }
      }
    } catch(e) {}
    return { done:false, progress:0, total:m.target||1 };
  }

  function missBar(pr, tot) {
    const pct = tot ? Math.min(100, Math.round(pr/tot*100)) : 0;
    return '<div style="height:8px;background:#efe4d2;border-radius:6px;overflow:hidden;margin-top:5px">'+
           '<div style="height:100%;width:'+pct+'%;background:var(--green)"></div></div>';
  }

  document.getElementById('openMissions').addEventListener('click', async () => {
    const card = document.getElementById('missionsCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await renderMissions(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });

  async function renderMissions() {
    if (!MS) return;
    await MS.ensureDaily(todayStr());
    const st = await MS.getState();

    // niveaux
    const lv = document.getElementById('missLevels');
    lv.innerHTML = '';
    MS.LEVELS.forEach(l => {
      const b = document.createElement('button');
      b.className = 'settings-toggle-btn';
      b.textContent = (st.level===l.id?'✅ ':'') + l.label + ' (' + l.count + ')';
      b.addEventListener('click', async () => { await MS.setLevel(l.id); await renderMissions(); });
      lv.appendChild(b);
    });

    // mission de période
    const pbox = document.getElementById('missPeriod');
    pbox.innerHTML = '';
    if (st.activePeriod) {
      const m = MS.periodById(st.activePeriod.id);
      const ev = await evalPeriod(m, st.activePeriod);
      const left = MS.daysLeft(st.activePeriod);
      const div = document.createElement('div');
      div.style.cssText = 'border:1.5px solid var(--line);border-radius:14px;padding:12px';
      div.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-size:16px;font-weight:600;color:#5a4326">'+m.name+'</div>'+
        '<div style="font-size:12.5px;font-weight:600;color:var(--ink);margin:3px 0">'+m.desc+'</div>'+
        '<div style="font-size:11.5px;font-weight:800;color:var(--muted)">'+ev.progress+' / '+ev.total+' · '+left+' jour(s) restant(s)</div>'+
        missBar(ev.progress, ev.total)+
        '<div style="display:flex;gap:8px;margin-top:10px">'+
          (ev.done ? '<button class="settings-toggle-btn ms-claim">🏆 Valider la mission</button>' : '')+
          '<button class="settings-toggle-btn ms-abandon" style="color:#a8543b">Abandonner</button></div>';
      if (ev.done) div.querySelector('.ms-claim').addEventListener('click', async () => {
        await MS.completePeriod(m.id);
        if (voiceMode === 'foxy') { try { await imSay('Mission « '+m.name+' » accomplie ! Je savais que tu y arriverais. 🏆🦊', 900, 'proud'); } catch(e){} }
        await renderMissions();
      });
      div.querySelector('.ms-abandon').addEventListener('click', async () => { await MS.abandonPeriod(); await renderMissions(); });
      pbox.appendChild(div);
    } else {
      const dispo = MS.PERIOD_MISSIONS.filter(m => !st.doneP.includes(m.id));
      if (!dispo.length) {
        pbox.innerHTML = '<div class="set-note">🏆 Toutes les missions de période sont accomplies. Bravo !</div>';
      } else {
        pbox.innerHTML = '<div class="sub" style="margin-bottom:10px">Aucune mission en cours. Foxy va t\'en tirer une au sort parmi les ' + dispo.length + ' restantes — tu ne choisis pas, c\'est le jeu.</div>';
        const b = document.createElement('button');
        b.className = 'settings-toggle-btn';
        b.style.cssText = 'width:100%';
        b.textContent = '🎲 Tirer ma prochaine mission';
        b.addEventListener('click', async () => {
          const m = await MS.startPeriod();
          if (m && voiceMode === 'foxy') {
            try {
              await imSay(broOn()
                ? 'Ta nouvelle mission, tirée au sort : « ' + m.name +' ». ' + m.desc + ' Tu as ' + m.days + ' jours. Tu ne la choisis pas, tu l\'accomplis.'
                : 'Et le sort a parlé ! Ta mission : « ' + m.name + ' ». ' + m.desc + ' Tu as ' + m.days + ' jours — on y va ensemble ! 🎲🦊', 950, 'cheer');
            } catch(e){}
          }
          await renderMissions();
        });
        pbox.appendChild(b);
      }
    }

    // missions du jour
    const dbox = document.getElementById('missDaily');
    dbox.innerHTML = '';
    for (const id of (st.daily||[])) {
      const m = MS.dailyById(id); if (!m) continue;
      const ev = await evalDaily(m);
      const div = document.createElement('div');
      div.style.cssText = 'border-top:1px solid var(--line);padding:9px 0';
      div.innerHTML = '<div style="display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:17px">'+(ev.done?'✅':'⬜')+'</span>'+
        '<div style="flex:1"><div style="font-size:13.5px;font-weight:800;color:'+(ev.done?'var(--green)':'var(--ink)')+'">'+m.name+'</div>'+
        '<div style="font-size:12px;font-weight:600;color:var(--muted)">'+m.desc+'</div></div>'+
        '<span style="font-size:12px;font-weight:800;color:var(--muted)">'+ev.progress+'/'+ev.total+'</span></div>'+
        (ev.total>1 ? missBar(ev.progress, ev.total) : '');
      dbox.appendChild(div);
    }

    // accomplies
    const done = document.getElementById('missDone');
    if (st.doneP && st.doneP.length) {
      done.innerHTML = st.doneP.map(id => { const m = MS.periodById(id); return m ? '<div style="font-size:12.5px;font-weight:700;color:var(--green);padding:3px 0">🏆 '+m.name+'</div>' : ''; }).join('');
    } else {
      done.innerHTML = '<div class="set-note">Aucune mission de période accomplie pour l\'instant.</div>';
    }
  }

  // ===== Garde-robe & stock =====
  const WB = window.HabitrainWardrobe;
  (document.getElementById('openWardrobe')||{addEventListener(){}}).addEventListener('click', async () => {
    const card = document.getElementById('wardrobeCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await renderWardrobe(); await renderStock(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });

  async function renderWardrobe() {
    if (!WB) return;
    const box = document.getElementById('wardrobeCats');
    const w = await WB.getWardrobe();
    box.innerHTML = '';
    WB.CATEGORIES.forEach(cat => {
      const div = document.createElement('div');
      div.className = 'set-cat';
      div.style.cssText = 'border:1.5px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px';
      const items = (w[cat.id] || []);
      div.innerHTML = '<h4>' + cat.icon + ' ' + cat.label + ' <span style="font-weight:700;color:var(--muted);font-size:11px">(' + items.length + ')</span></h4>' +
        '<div class="wb-items"></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<input type="text" class="wb-new" placeholder="Ajouter…" style="flex:1;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:600;font-size:13px">' +
          '<button class="settings-toggle-btn wb-add">➕</button>' +
        '</div>';
      const list = div.querySelector('.wb-items');
      items.forEach(it => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:3px 0';
        row.innerHTML = '<input type="text" class="wb-name" value="' + it.replace(/"/g,'&quot;') + '" style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-weight:600;font-size:12.5px">' +
                        '<button class="settings-toggle-btn wb-del" style="color:#a8543b;padding:4px 9px">✕</button>';
        row.querySelector('.wb-name').addEventListener('change', async (ev) => {
          await WB.renameItem(cat.id, it, ev.target.value); await renderWardrobe();
        });
        row.querySelector('.wb-del').addEventListener('click', async () => {
          await WB.removeItem(cat.id, it); await renderWardrobe();
        });
        list.appendChild(row);
      });
      div.querySelector('.wb-add').addEventListener('click', async () => {
        const inp = div.querySelector('.wb-new');
        if (inp.value.trim()) { await WB.addItem(cat.id, inp.value); inp.value=''; await renderWardrobe(); }
      });
      box.appendChild(div);
    });
  }

  async function renderStock() {
    if (!WB) return;
    // résumé par catégorie (c'est là que se juge l'alerte)
    try {
      const st = await WB.categoryStatus();
      const th = await WB.getThresholds();
      document.getElementById('thJour').value = th.jour;
      document.getElementById('thNuit').value = th.nuit;
      const sum = document.getElementById('stockSummary');
      const bloc = (p, ic) => {
        const c = st[p];
        const col = c.empty ? 'var(--coral)' : (c.low ? 'var(--amber)' : 'var(--green)');
        return '<div style="flex:1;text-align:center;padding:10px;border:1.5px solid '+col+';border-radius:12px">'+
          '<div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">'+ic+' '+p+'</div>'+
          '<div style="font-family:\'Fraunces\',serif;font-size:26px;font-weight:600;color:'+col+'">'+c.total+'</div>'+
          '<div style="font-size:10.5px;font-weight:700;color:var(--muted)">seuil '+c.seuil+(c.low?' · ⚠️ bas':'')+'</div></div>';
      };
      sum.innerHTML = '<div style="display:flex;gap:8px">' + bloc('jour','☀️') + bloc('nuit','🌙') + '</div>';
    } catch(e) {}
    const box = document.getElementById('stockList');
    const list = await WB.getStock();
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="set-note">Aucun modèle. Ajoute-en un ci-dessus.</div>'; return; }
    const USAGE = { jour:'☀️ Jour', nuit:'🌙 Nuit', both:'🔄 Jour+Nuit' };
    list.forEach(m => {
      const low = m.qty === 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line);flex-wrap:wrap';
      row.innerHTML =
        '<input type="text" class="st-name" value="' + m.name.replace(/"/g,'&quot;') + '" style="flex:1;min-width:110px;padding:7px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-weight:700;font-size:13px">' +
        '<select class="st-usage" style="padding:7px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-weight:700;font-size:12px">' +
          ['jour','nuit','both'].map(u => '<option value="'+u+'"'+(m.usage===u?' selected':'')+'>'+USAGE[u]+'</option>').join('') +
        '</select>' +
        '<button class="settings-toggle-btn st-minus" style="padding:5px 11px">−</button>' +
        '<span class="st-qty" style="font-family:\'Fraunces\',serif;font-size:19px;font-weight:600;min-width:44px;text-align:center;color:' + (low?'var(--coral)':'var(--ink)') + '">' + m.qty + '</span>' +
        '<button class="settings-toggle-btn st-plus" style="padding:5px 11px">+</button>' +
        '<button class="settings-toggle-btn st-del" style="color:#a8543b;padding:5px 9px">✕</button>' +
        (low ? '<div style="width:100%;font-size:11.5px;font-weight:800;color:var(--coral)">épuisé</div>' : '');
      row.querySelector('.st-name').addEventListener('change', async e => { await WB.updateModel(m.id,{name:e.target.value}); await renderStock(); });
      row.querySelector('.st-usage').addEventListener('change', async e => { await WB.updateModel(m.id,{usage:e.target.value}); await renderStock(); });
      row.querySelector('.st-plus').addEventListener('click', async () => { await WB.updateModel(m.id,{qty:m.qty+1}); await renderStock(); });
      row.querySelector('.st-minus').addEventListener('click', async () => { await WB.updateModel(m.id,{qty:Math.max(0,m.qty-1)}); await renderStock(); });
      row.querySelector('.st-del').addEventListener('click', async () => { await WB.removeModel(m.id); await renderStock(); });
      box.appendChild(row);
    });
  }
  document.getElementById('thSave').addEventListener('click', async () => {
    const t = { jour: parseInt(document.getElementById('thJour').value,10)||0,
                nuit: parseInt(document.getElementById('thNuit').value,10)||0 };
    await WB.setThresholds(t);
    const f = document.getElementById('thFlash');
    if (f) { f.textContent = '💾 Seuils enregistrés'; setTimeout(()=>f.textContent='',2000); }
    await renderStock();
  });
  document.getElementById('stockAdd').addEventListener('click', async () => {
    const n = document.getElementById('stockNewName');
    const u = document.getElementById('stockNewUsage');
    if (n.value.trim()) { await WB.addModel(n.value, u.value, 0); n.value=''; await renderStock(); }
  });

  // ===== Serrures (multi) =====
  const LK = window.HabitrainLock;
  (document.getElementById('openLock')||{addEventListener(){}}).addEventListener('click', async () => {
    const card = document.getElementById('lockCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await renderLockList(); renderLockGuide(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
  (function(){
    const t = document.getElementById('lockGuideToggle');
    if (t) t.addEventListener('click', () => {
      const g = document.getElementById('lockGuide');
      if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
    });
  })();
  document.getElementById('lockAdd').addEventListener('click', async () => {
    if (!LK) return;
    const inp = document.getElementById('lockNewName');
    const name = (inp.value || '').trim() || 'Nouvelle serrure';
    await LK.addLock(name);
    inp.value = '';
    await renderLockList();
  });

  function lockFieldRow(label, desc, inputHtml) {
    return '<div class="set-row"><div class="info"><div class="n">'+label+'</div><div class="d">'+desc+'</div></div>'+inputHtml+'</div>';
  }

  async function renderLockList() {
    if (!LK) return;
    const box = document.getElementById('lockList');
    const locks = await LK.getLocks();
    box.innerHTML = '';
    if (!locks.length) {
      box.innerHTML = '<div class="set-note">Aucune serrure. Ajoute-en une ci-dessus (ex. « Placard couches », « Tiroir contention »).</div>';
      return;
    }
    for (const l of locks) {
      const opens = await LK.getOpensToday(l.id);
      const div = document.createElement('div');
      div.className = 'set-cat';
      div.style.cssText = 'border:1.5px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px';
      div.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
          '<input type="text" class="lk-name" value="'+(l.name||'').replace(/"/g,'&quot;')+'" style="flex:1;font-family:\'Fraunces\',serif;font-size:16px;font-weight:600;color:#5a4326;border:none;background:transparent;padding:2px 0">'+
          '<div class="switch lk-enabled'+(l.enabled?' on':'')+'"><div class="knob"></div></div>'+
        '</div>'+
        '<div class="d" style="font-size:11.5px;color:var(--muted);font-weight:700;margin-bottom:8px">'+opens+' ouverture(s) aujourd\'hui · <span class="lk-status">'+(LK.isConnected(l.id)?'🟢 connectée':'non connectée')+'</span></div>'+
        lockFieldRow('Fenêtres horaires','Limiter aux piliers (9h/16h/22h30)','<div class="switch lk-usewin'+(l.useWindows?' on':'')+'"><div class="knob"></div></div>')+
        lockFieldRow('Largeur fenêtre','± minutes','<input type="number" class="lk-window" min="5" max="180" step="5" value="'+l.windowMin+'" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:700;text-align:center">')+
        lockFieldRow('Délai après demande','secondes','<input type="number" class="lk-delay" min="0" max="900" step="10" value="'+l.delaySec+'" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:700;text-align:center">')+
        lockFieldRow('Durée d\'ouverture','secondes de gâche ouverte','<input type="number" class="lk-opensec" min="1" max="120" step="1" value="'+l.openSec+'" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:700;text-align:center">')+
        lockFieldRow('Quota journalier','ouvertures max/jour','<input type="number" class="lk-quota" min="1" max="30" step="1" value="'+l.dailyQuota+'" style="width:70px;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:700;text-align:center">')+
        lockFieldRow('Change validé requis','le change précédent doit être bouclé','<div class="switch lk-reqchange'+(l.requireChangeDone?' on':'')+'"><div class="knob"></div></div>')+
        lockFieldRow('Verrouillée en pause','pas d\'accès hors programme','<div class="switch lk-nopause'+(l.blockDuringPause?' on':'')+'"><div class="knob"></div></div>')+
        lockFieldRow('Secret partagé','doit être identique dans son firmware','<input type="text" class="lk-secret" value="'+(l.secret||'').replace(/"/g,'&quot;')+'" style="width:140px;padding:8px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;font-weight:700;font-size:11px">')+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'+
          '<button class="settings-toggle-btn lk-save">💾 Enregistrer</button>'+
          '<button class="settings-toggle-btn lk-connect">🔗 Connecter</button>'+
          '<button class="settings-toggle-btn lk-open">🔓 Ouvrir</button>'+
          '<button class="settings-toggle-btn lk-emg" style="color:#a8543b;border-color:#e8896b">🆘 Urgence</button>'+
          '<button class="settings-toggle-btn lk-del" style="color:#a8543b">🗑️</button>'+
        '</div>'+
        '<div class="set-note lk-result"></div>';
      box.appendChild(div);

      // interrupteurs
      div.querySelectorAll('.switch').forEach(sw => sw.addEventListener('click', () => sw.classList.toggle('on')));

      // enregistrer
      div.querySelector('.lk-save').addEventListener('click', async () => {
        await LK.updateLock(l.id, {
          name: div.querySelector('.lk-name').value.trim() || l.name,
          enabled: div.querySelector('.lk-enabled').classList.contains('on'),
          useWindows: div.querySelector('.lk-usewin').classList.contains('on'),
          windowMin: parseInt(div.querySelector('.lk-window').value,10) || 30,
          delaySec: parseInt(div.querySelector('.lk-delay').value,10) || 0,
          openSec: parseInt(div.querySelector('.lk-opensec').value,10) || 5,
          dailyQuota: parseInt(div.querySelector('.lk-quota').value,10) || 4,
          requireChangeDone: div.querySelector('.lk-reqchange').classList.contains('on'),
          blockDuringPause: div.querySelector('.lk-nopause').classList.contains('on'),
          secret: div.querySelector('.lk-secret').value.trim() || l.secret
        });
        const r = div.querySelector('.lk-result');
        r.textContent = '💾 « ' + (div.querySelector('.lk-name').value.trim() || l.name) + ' » enregistrée.'; setTimeout(()=>r.textContent='', 2200);
      });

      // connecter
      div.querySelector('.lk-connect').addEventListener('click', async () => {
        const r = div.querySelector('.lk-result');
        if (!LK.supported()) { r.textContent = 'Non supporté (Android/Chrome requis)'; return; }
        r.textContent = '🔗 Connexion à « ' + l.name + ' »...';
        LK.onStatus((id, st) => {
          if (id !== l.id) return;
          const s2 = div.querySelector('.lk-status');
          if (s2) s2.textContent = st === 'OPEN' ? '🔓 ouverte' : (st === 'DENIED' ? '⛔ secret refusé' : (st === 'DISCONNECTED' ? 'déconnectée' : '🔒 verrouillée'));
        });
        try { await LK.connect(l.id); r.textContent = '🦊 « ' + l.name + ' » est connectée, je la contrôle maintenant.'; div.querySelector('.lk-status').textContent = '🟢 connectée'; }
        catch (e) { r.textContent = '⚠️ Connexion à « ' + l.name + ' » échouée ou annulée.'; }
      });

      // ouvrir (conditions → délai → ordre)
      div.querySelector('.lk-open').addEventListener('click', async () => {
        const r = div.querySelector('.lk-result');
        let lastPillarDone = true;
        try {
          const pil = pillarSlotForNow();
          if (pil) {
            const rr = await window.storage.get('slotdone:'+todayStr());
            const done = (rr && rr.value) ? JSON.parse(rr.value) : {};
            const PIL = ['c0900','c1600','c2230'];
            const idx = PIL.indexOf(pil.key);
            if (idx > 0) lastPillarDone = !!done[PIL[idx-1]];
          }
        } catch(e) {}
        const verdict = await LK.evaluate(l.id, { paused, lastPillarDone });
        if (!verdict.ok) {
          try {
            const isQuota = /Quota atteint/i.test(verdict.reason || '');
            await saveCheck(isQuota ? 'lock_quota' : 'lock_denied', 'serrure:' + l.name);
          } catch(e) {}
          r.textContent = broOn()
            ? '🦊 « ' + l.name +' » reste fermée. ' + verdict.reason + ' Inutile d\'insister, tu attendras.'
            : '🦊 Désolé, « ' + l.name + ' » reste fermée. ' + verdict.reason;
          return;
        }
        if (!LK.isConnected(l.id)) { r.textContent = '⚠️ « ' + l.name + ' » n\'est pas connectée. Connecte-la d\'abord.'; return; }
        let reste = verdict.delaySec || 0;
        if (reste > 0) {
          r.textContent = broOn()
            ? '🦊 « ' + l.name + ' » s\'ouvrira dans ' + reste + ' s. Patiente, c\'est voulu.'
            : '🦊 J\'ouvre « ' + l.name + ' » dans ' + reste + ' s... un peu de patience !';
          const iv = setInterval(async () => {
            reste--;
            if (reste > 0) { r.textContent = '🦊 « ' + l.name + ' » dans ' + reste + ' s...'; return; }
            clearInterval(iv);
            try {
              await LK.open(l.id);
              try { await saveCheck('lock_open', 'serrure:' + l.name); } catch(e) {}
              r.textContent = (broOn()
                ? '🔓 « ' + l.name + ' » est ouverte pour ' + l.openSec + ' s. Prends ce qu\'il te faut, sans traîner.'
                : '🔓 Voilà, « ' + l.name + ' » est ouverte pendant ' + l.openSec + ' s ! Vas-y.')
                + ' (' + (verdict.opens+1) + '/' + verdict.quota + ' aujourd\'hui)';
            }
            catch (e) { r.textContent = '⚠️ « ' + l.name + ' » : ' + e.message; }
          }, 1000);
        } else {
          try {
            await LK.open(l.id);
            try { await saveCheck('lock_open', 'serrure:' + l.name); } catch(e) {}
            r.textContent = (broOn()
              ? '🔓 « ' + l.name + ' » est ouverte pour ' + l.openSec + ' s. Prends ce qu\'il te faut, sans traîner.'
              : '🔓 Voilà, « ' + l.name + ' » est ouverte pendant ' + l.openSec + ' s ! Vas-y.')
              + ' (' + (verdict.opens+1) + '/' + verdict.quota + ' aujourd\'hui)';
          }
          catch (e) { r.textContent = '⚠️ « ' + l.name + ' » : ' + e.message; }
        }
      });

      // ouverture d'urgence (ignore les conditions, mais tracée)
      div.querySelector('.lk-emg').addEventListener('click', async () => {
        const r = div.querySelector('.lk-result');
        r.innerHTML = '🆘 Ouvrir « '+l.name+' » <b>sans condition</b> ? Ce sera noté comme une entorse. '+
          '<b class="lk-eyes" style="color:#a8543b;cursor:pointer">Oui, j\'en ai besoin</b> · <b class="lk-eno" style="cursor:pointer">Annuler</b>';
        div.querySelector('.lk-eno').addEventListener('click', () => { r.textContent = ''; });
        div.querySelector('.lk-eyes').addEventListener('click', async () => {
          if (!LK.isConnected(l.id)) { r.textContent = '⚠️ « ' + l.name + ' » n\'est pas connectée.'; return; }
          try {
            await LK.emergencyOpen(l.id);
            // trace : journal + entorse du jour
            try { await saveCheck('lock_emergency', 'serrure:' + l.name); } catch(e) {}
            try {
              const date = todayStr();
              const rb = await window.storage.get('breach:'+date);
              const b = (rb && rb.value) ? JSON.parse(rb.value) : {};
              b['lock_emergency'] = true;
              await window.storage.set('breach:'+date, JSON.stringify(b));
            } catch(e) {}
            r.textContent = broOn()
              ? '🆘 « ' + l.name + ' » ouverte en urgence pour ' + l.openSec + ' s. C\'est noté. Je ne te juge pas, mais on en reparlera.'
              : '🆘 « ' + l.name + ' » ouverte en urgence pour ' + l.openSec + ' s. C\'est noté dans ton journal — tu as bien fait si tu en avais besoin. 🦊';
            try { await refresh(); } catch(e) {}
          } catch (e) { r.textContent = '⚠️ ' + e.message; }
        });
      });

      // supprimer
      div.querySelector('.lk-del').addEventListener('click', async () => {
        const r = div.querySelector('.lk-result');
        r.innerHTML = 'Supprimer « '+l.name+' » ? <b class="lk-yes" style="color:#a8543b;cursor:pointer">Oui</b> · <b class="lk-no" style="cursor:pointer">Non</b>';
        div.querySelector('.lk-yes').addEventListener('click', async () => { await LK.removeLock(l.id); await renderLockList(); });
        div.querySelector('.lk-no').addEventListener('click', () => { r.textContent = ''; });
      });
    }
  }

  function renderLockGuide() {
    const g = document.getElementById('lockGuide');
    if (!g || g.dataset.filled) return;
    g.dataset.filled = '1';
    g.innerHTML =
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:6px 0 4px">Une serrure = un ESP32</div>'+
      'Chaque placard ou boîte a son propre ESP32 + sa gâche. Tu crées une entrée par serrure ici, tu la nommes, et tu règles ses conditions.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">Matériel par serrure (~25-35 €)</div>'+
      '• 1 <b>ESP32</b> alimenté en permanence<br>'+
      '• 1 <b>gâche électrique 12V</b> (préfère « fail-safe » : s\'ouvre en cas de coupure) ou un servo<br>'+
      '• 1 <b>module relais</b> + alimentation 12V<br>'+
      '• <b>Une clé de secours mécanique</b> (indispensable)'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">Câblage</div>'+
      'GPIO5 → entrée du relais ; le relais commute le 12V vers la gâche ; GND commun.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">Secret partagé (important)</div>'+
      'Chaque serrure a son <b>propre secret</b>, généré ici. Copie-le dans le champ SECRET du firmware <b>habitrain-serrure.ino</b> de CETTE serrure, puis flashe. Deux serrures ne doivent jamais partager le même secret.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">Connexion</div>'+
      'Clique <b>Connecter</b> sur la serrure voulue et choisis-la dans la liste Bluetooth. Astuce : donne un nom distinct à chaque ESP32 dans son firmware (BLEDevice::init) pour les reconnaître facilement.'+
      '<div style="background:#FBEBE5;border:1px solid #e8896b;border-radius:10px;padding:10px 12px;margin-top:14px;font-size:12px;font-weight:800;color:#a8543b">'+
      '🔑 Une clé de secours par serrure, rangée ailleurs que dans le meuble concerné. Teste-la avant la mise en service.'+
      '</div>';
  }

  // ===== Capteur de couche (BLE) =====
  const SENSOR_LABELS = { sec:'☀️ Sèche', mouille:'💧 Mouillée', sature:'🌊 Saturée' };
  let lastSensorState = null;
  (document.getElementById('openSensor')||{addEventListener(){}}).addEventListener('click', () => {
    const card = document.getElementById('sensorCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { renderSensorGuide(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
  (function(){
    const t = document.getElementById('sensorGuideToggle');
    if (t) t.addEventListener('click', () => {
      const g = document.getElementById('sensorGuide');
      if (g) g.style.display = g.style.display === 'none' ? '' : 'none';
    });
  })();
  document.getElementById('sensorConnect').addEventListener('click', async () => {
    const S = window.HabitrainSensor;
    const statusEl = document.getElementById('sensorStatus');
    if (!S || !S.supported()) { statusEl.textContent = 'Non supporté (Android/Chrome requis)'; return; }
    statusEl.textContent = 'Connexion...';
    S.onState((state) => onSensorState(state));
    S.onRaw((d) => {
      const r = document.getElementById('sensorRaw');
      if (!r) return;
      if (typeof d === 'object' && d !== null) {
        const base = (d.baseRH > 0) ? (' · base ' + d.baseRH.toFixed(1) + '% / ' + d.baseT.toFixed(1) + '°') : ' · calibration…';
        r.innerHTML = d.rh.toFixed(1) + '% <span style="font-size:15px">HR</span> · ' + d.t.toFixed(1) + '°C' +
                      '<div style="font-size:11px;font-weight:700;color:var(--muted)">' + base + '</div>';
      } else { r.textContent = d; }
    });
    S.onLog((events) => onSensorLog(events));
    try {
      await S.connect();
      statusEl.textContent = '🟢 Connecté';
      document.getElementById('sensorConnect').textContent = '🔄 Resynchroniser';
    } catch (e) {
      statusEl.textContent = 'Échec / annulé';
    }
  });

  // intègre le journal reçu à la connexion (événements survenus appli fermée)
  async function onSensorLog(events) {
    if (!events || !events.length) return;
    let n = 0;
    for (const ev of events) {
      try {
        // enregistre chaque événement horodaté comme un état, à sa vraie heure
        const dateKey = ev.t.slice(0,10);
        const list = await getChecks(dateKey);
        list.push({ t: ev.t, result: 'etat_'+ev.state, type: 'capteur' });
        await window.storage.set('check:'+dateKey, JSON.stringify(list));
        n++;
      } catch(e) {}
    }
    try { await refresh(); } catch(e) {}
    const statusEl = document.getElementById('sensorStatus');
    if (statusEl) statusEl.textContent = '🟢 Connecté · ' + n + ' événement' + (n>1?'s':'') + ' synchronisé' + (n>1?'s':'');
    // Foxy commente la synchro en différé (mode Foxy, hors pause)
    if (voiceMode === 'foxy' && !paused && n > 0) {
      const last = events[events.length-1];
      const summary = events.filter(e=>e.state==='mouille').length;
      const sat = events.filter(e=>e.state==='sature').length;
      const m = currentM || currentMoment(new Date());
      await imSay(broOn()
        ? 'Voyons voir ce que ton capteur a enregistré pendant mon absence... ' + summary + ' fois mouillé, ' + sat + ' fois saturé. Tu vois ? Tu t\'es laissé aller, exactement comme je l\'avais dit.'
        : 'Ton capteur m\'a tout raconté ! ' + summary + ' fois mouillé, ' + sat + ' fois saturé pendant qu\'on était pas ensemble. Tu t\'es bien laissé aller, bravo. 🦊', 900, broOn() ? 'pensive' : 'happy');
      try { await imOfferHelp(m); } catch(e) {}
    }
  }

  // à chaque changement d'état capteur : maj statut + réaction Foxy
  async function onSensorState(state) {
    const live = document.getElementById('sensorLive');
    if (live) live.textContent = SENSOR_LABELS[state] || '—';
    if (state === lastSensorState) return;
    lastSensorState = state;
    // enregistre l'état comme un check automatique
    try { await saveCheck('etat_'+state, 'capteur'); } catch(e) {}
    try { await renderSince(); } catch(e) {}
    // Foxy réagit en temps réel si on est en mode Foxy et pas en pause
    if (voiceMode === 'foxy' && !paused) {
      const m = currentM || currentMoment(new Date());
      if (state === 'mouille') {
        await imSay(broOn()
          ? 'Ah... tu viens de te mouiller. Voilà. Tu vois comme c\'est venu tout seul, sans que tu puisses l\'empêcher ? C\'est ça, se laisser aller.'
          : 'Oh, tu viens de te mouiller ! C\'est bien, tu t\'es laissé aller. 🦊', 800, broOn() ? 'pensive' : 'happy');
      } else if (state === 'sature') {
        await imSay(broOn()
          ? 'Ta couche est saturée maintenant. On va te changer — inutile d\'attendre, laisse-moi m\'en occuper.'
          : 'Ta couche est bien saturée là ! On va penser à te changer bientôt, pour ta peau. 🦊', 850, 'concern');
      }
      try { await imOfferHelp(m); } catch(e) {}
    }
  }

  function renderSensorGuide() {
    const g = document.getElementById('sensorGuide');
    if (!g || g.dataset.filled) return;
    g.dataset.filled = '1';
    g.innerHTML =
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:6px 0 4px">Matériel (~15-20 €)</div>'+
      '• 1 carte <b>ESP32-C3 mini</b> (LOLIN C3 Mini ou équivalent)<br>'+
      '• 1 <b>capteur SHTC3</b> (humidité + température, I²C) — <b>non invasif</b>, il se pose sur la couche<br>'+
      '• 1 <b>batterie LiPo 3.7V</b> (~400-500 mAh) avec connecteur, ou alim USB<br>'+
      '• Un petit boîtier, du fil, fer à souder<br>'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">1. Préparer l\'IDE Arduino</div>'+
      'Installe l\'IDE Arduino (gratuit). Dans Préférences → URL de gestionnaire de cartes, ajoute l\'URL ESP32 d\'Espressif, puis installe le paquet "esp32" dans le gestionnaire de cartes. Choisis la carte <b>ESP32C3 Dev Module</b>.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">2. Câbler le capteur</div>'+
      'SHTC3 en I²C : <b>SDA → GPIO8</b>, <b>SCL → GPIO9</b>, VIN → 3V3, GND → GND. Installe la bibliothèque <b>SparkFun SHTC3</b> dans l\'IDE Arduino.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">3. Flasher le firmware</div>'+
      'Ouvre le fichier <b>habitrain-capteur-couche.ino</b> (fourni), branche l\'ESP32 en USB, sélectionne le bon port, et clique Téléverser.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">4. Calibrer</div>'+
      'Le capteur se calibre <b>tout seul</b> : il fige une ligne de base 2 min après l\'allumage, et la refait après chaque change. Regarde l\'écart entre la valeur en direct et la base quand tu te mouilles : si la détection est trop/pas assez sensible, ajuste SEUIL_RH_MOUILLE et SEUIL_RH_SATURE dans le firmware.'+
      '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">5. Monter sur la couche</div>'+
      '<b>Pose non invasive</b> : glisse le capteur entre la couche et ton vêtement, à l\'avant-bas, enveloppé dans un tissu fin respirant. Il ne touche ni ta peau ni le liquide — il lit l\'air confiné. Une grenouillère fermée donne de meilleures lectures qu\'un vêtement ouvert.'+
      '<div style="background:#FBF3E0;border:1px solid #ecd9a8;border-radius:10px;padding:10px 12px;margin-top:14px;font-size:12px;font-weight:700;color:#8a6a30">'+
      '🔋 Sécurité : batterie LiPo basse tension, aucun risque électrique. Garde l\'électronique au sec (le capteur détecte l\'humidité, mais la carte reste protégée). Nettoie les électrodes régulièrement.'+
      '</div>';
  }
  async function renderQrConfig() {
    if (!QR) return;
    const prefs = await QR.getQrPrefs();
    // toggles des actions
    const box = document.getElementById('qrActions'); box.innerHTML = '';
    QR.QR_ACTIONS.forEach(a => {
      const on = !!prefs.enabled[a.id];
      const row = document.createElement('div'); row.className = 'set-row';
      row.innerHTML = '<div class="info"><div class="n">'+a.label+'</div></div>';
      const sw = document.createElement('div'); sw.className = 'switch'+(on?' on':''); sw.innerHTML='<div class="knob"></div>';
      sw.addEventListener('click', async () => {
        const p = await QR.getQrPrefs(); p.enabled[a.id] = !p.enabled[a.id];
        if (!p.enabled[a.id]) delete p.enabled[a.id];
        await QR.saveQrPrefs(p); renderQrConfig();
      });
      row.appendChild(sw); box.appendChild(row);
    });
    // switch unlock
    const us = document.getElementById('qrUnlockSwitch');
    us.classList.toggle('on', !!prefs.unlock);
    us.onclick = async () => { const p = await QR.getQrPrefs(); p.unlock = !p.unlock; await QR.saveQrPrefs(p); renderQrConfig(); };
    // switch bracelet obligatoire
    const br = document.getElementById('braceletReqSwitch');
    if (br) {
      br.classList.toggle('on', !!prefs.braceletRequired);
      br.onclick = async () => {
        const p = await QR.getQrPrefs();
        p.braceletRequired = !p.braceletRequired;
        if (p.braceletRequired) p.unlock = true; // implique le verrouillage à l'ouverture
        await QR.saveQrPrefs(p);
        renderQrConfig();
        scheduleBraceletChecks();
      };
    }
    // génération
    const gl = document.getElementById('qrGenList'); gl.innerHTML = '';
    const toGen = QR.QR_ACTIONS.concat([{ id:'unlock', label:'Bracelet de déverrouillage' }]);
    for (const item of toGen) {
      const wrap = document.createElement('div'); wrap.className = 'qrgen-item';
      const cv = document.createElement('canvas');
      const txt = await QR.payloadFor(item.id);
      QR.drawQR(cv, txt, 140);
      const lbl = document.createElement('div'); lbl.innerHTML = '<div class="n">'+item.label+'</div>';
      wrap.appendChild(cv); wrap.appendChild(lbl);
      gl.appendChild(wrap);
    }
    try { await window.storage.set('ob:qrdone', JSON.stringify(true)); } catch(e) {}
  }
  // annulation du scan
  document.getElementById('qrScanCancel').addEventListener('click', () => { if (QR) QR.stopScan(); });

  // ==== Verrouillage par bracelet ====
  async function checkQrLock() {
    if (!QR) return;
    const prefs = await QR.getQrPrefs();
    if (!prefs.unlock) return; // pas activé
    // déjà déverrouillé cette session ?
    if (sessionUnlocked) return;
    showQrLock();
  }
  let sessionUnlocked = false;
  let lockClockTimer = null;
  function showQrLock(isSurprise) {
    const lock = document.getElementById('qrLock');
    lock.style.display = 'flex';

    // --- horloge en direct ---
    const majHeure = () => {
      const n = new Date();
      const c = document.getElementById('qrLockClock');
      const d = document.getElementById('qrLockDate');
      if (c) c.textContent = String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
      if (d) {
        try { d.textContent = n.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }); }
        catch(e) { d.textContent = ''; }
      }
    };
    majHeure();
    if (lockClockTimer) clearInterval(lockClockTimer);
    lockClockTimer = setInterval(majHeure, 20000);

    // --- portrait de Foxy, dans sa tenue et son humeur du jour ---
    try {
      const f = document.getElementById('qrLockFoxy');
      const h = new Date().getHours();
      const expr = (h >= 22 || h < 7) ? 'sleep' : (isSurprise ? 'curious' : 'comfort');
      positionFoxyCell(f, expr, 168);
    } catch(e) {}

    // --- message d'accueil selon l'heure et le contexte ---
    const greet = document.getElementById('qrLockGreet');
    if (greet) {
      const h = new Date().getHours();
      let g;
      if (isSurprise) g = 'Contrôle surprise — montre-moi ton bracelet';
      else if (h < 7) g = 'Chut... Foxy dort encore';
      else if (h < 12) g = 'Foxy t\'attend pour commencer la journée';
      else if (h < 18) g = 'Foxy t\'attend';
      else if (h < 22) g = 'La soirée commence, Foxy est là';
      else g = 'Il est tard... Foxy veille sur toi';
      greet.textContent = g;
    }
    document.getElementById('qrUnlockBtn').onclick = () => {
      QR.startScan('unlock', (kind) => {
        if (kind === 'unlock') { sessionUnlocked = true; lock.style.display = 'none'; if (lockClockTimer) { clearInterval(lockClockTimer); lockClockTimer = null; } }
      });
    };
    // secours discret : 3 tapes sur le titre (TOUJOURS actif, anti-blocage)
    let taps = [];
    const title = document.getElementById('qrLockTitle');
    title.onclick = () => {
      const now = Date.now(); taps.push(now); taps = taps.filter(x => now - x < 1200);
      if (taps.length >= 3) { taps = []; sessionUnlocked = true; lock.style.display = 'none'; }
    };
  }
  // contrôles surprises du bracelet obligatoire (bloquants, secours actif)
  let braceletTimer = null;
  async function scheduleBraceletChecks() {
    if (braceletTimer) { clearTimeout(braceletTimer); braceletTimer = null; }
    if (!QR) return;
    const prefs = await QR.getQrPrefs();
    if (!prefs.braceletRequired) return;
    const delay = (30 + Math.floor(Math.random()*60)) * 60000; // 30-90 min
    braceletTimer = setTimeout(async () => {
      if (!paused) { showQrLock(true); }
      scheduleBraceletChecks();
    }, delay);
  }
  function saveFlash(msg, ok) {
    const f = document.getElementById('saveFlash'); if (!f) return;
    f.style.color = ok === false ? 'var(--coral)' : 'var(--green)';
    f.textContent = msg; setTimeout(() => f.textContent = '', 2600);
  }
  // rassemble toutes les données du stockage (préfixe habitrain:)
  async function collectAllData() {
    const data = {};
    try {
      const res = await window.storage.list('');
      const keys = (res && res.keys) ? res.keys : [];
      for (const k of keys) {
        try { const r = await window.storage.get(k); if (r && r.value !== undefined) data[k] = r.value; } catch(e) {}
      }
    } catch(e) {}
    return data;
  }
  document.getElementById('saveExport').addEventListener('click', async () => {
    try {
      const data = await collectAllData();
      const payload = { app:'Habitrain', version: (typeof APP_VERSION!=='undefined'?APP_VERSION:'?'), exportedAt: new Date().toISOString(), data };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0,10);
      a.href = url; a.download = 'habitrain-sauvegarde-' + stamp + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      saveFlash('✅ Sauvegarde téléchargée (' + Object.keys(data).length + ' entrées)');
      try { await window.storage.set('ob:exported', JSON.stringify(true)); } catch(e) {}
    } catch(e) { saveFlash('Échec de l\'export, réessaie.', false); }
  });
  document.getElementById('saveImportBtn').addEventListener('click', () => {
    document.getElementById('saveImportFile').click();
  });
  document.getElementById('saveImportFile').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = payload && payload.data ? payload.data : payload; // tolère un format brut
      if (!data || typeof data !== 'object') { saveFlash('Fichier invalide.', false); return; }
      let n = 0;
      for (const k of Object.keys(data)) {
        try { await window.storage.set(k, typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k])); n++; } catch(e) {}
      }
      saveFlash('✅ ' + n + ' entrées restaurées. Rechargement...');
      setTimeout(() => location.reload(), 1200);
    } catch(e) {
      saveFlash('Fichier illisible ou corrompu.', false);
    } finally {
      ev.target.value = '';
    }
  });

  // ---- Notre aventure (écran de quête) ----
  async function renderQuest() {
    const q = await getQuest();
    const pct = q.unlockedStage < 0 ? 0 : Math.round(((q.unlockedStage+1) / 4) * 100);
    const prog = document.getElementById('questProgress');
    prog.innerHTML =
      '<div class="quest-bar"><div class="quest-fill" style="width:'+pct+'%"></div></div>'+
      '<div class="quest-marks"><span>Départ</span><span>Ça s\'installe</span><span>Automatisme</span><span>2ᵉ nature</span></div>';
    const box = document.getElementById('questChapters');
    box.innerHTML = '';
    QUEST_CHAPTERS.forEach(ch => {
      const unlocked = q.unlockedStage >= ch.stage;
      const div = document.createElement('div');
      div.className = 'chapter' + (unlocked ? '' : ' locked');
      const portrait = '<div class="cportrait" id="qc'+ch.stage+'"></div>';
      div.innerHTML = portrait +
        '<div class="cbody"><div class="ctitle">'+ (unlocked ? ch.title : '🔒 Chapitre '+(ch.stage+1)+' — à découvrir') +'</div>'+
        '<div class="ctext">'+ (unlocked ? ch.text : 'Continue ton voyage pour débloquer ce chapitre... Foxy a hâte de te le raconter.') +'</div></div>';
      box.appendChild(div);
      if (unlocked) { const el = div.querySelector('.cportrait'); if (el) positionFoxyCell(el, ch.expr, 60); }

      // sous-chapitres collectés de ce palier
      if (unlocked) {
        const told = (q.subs && q.subs[ch.stage]) ? q.subs[ch.stage] : [];
        const subs = QUEST_SUBCHAPTERS[ch.stage] || [];
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin:2px 0 6px 72px';
        subs.forEach((s, idx) => {
          const got = told.includes(idx);
          const item = document.createElement('div');
          item.style.cssText = 'padding:7px 0;border-top:1px dashed var(--line)';
          if (got) {
            item.innerHTML = '<div style="font-size:12.5px;font-weight:800;color:#a85a2a">📖 '+s.t+'</div>'+
              '<div style="font-size:12.5px;font-weight:600;color:var(--ink);font-style:italic;line-height:1.5;margin-top:3px">'+s.x+'</div>';
          } else {
            item.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--muted)">🔒 Souvenir à venir…</div>';
          }
          wrap.appendChild(item);
        });
        const doneCount = told.length, total = subs.length;
        const counter = document.createElement('div');
        counter.style.cssText = 'font-size:11px;font-weight:800;color:var(--muted);margin:4px 0 0 72px;text-transform:uppercase;letter-spacing:.03em';
        counter.textContent = doneCount + ' / ' + total + ' souvenirs récoltés';
        box.appendChild(counter);
        box.appendChild(wrap);
      }
    });
    // Confidences de Foxy (récoltées en discutant)
    const conf = (q.confidences || []);
    if (conf.length) {
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-top:16px;padding-top:12px;border-top:2px dashed #e0d3bd';
      sec.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:15px;color:#5a4326;margin-bottom:8px">💛 Les confidences de Foxy</div>'+
        '<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">'+conf.length+' / '+FOXY_CONFIDENCES.length+' — récoltées en discutant avec lui</div>'+
        conf.map(c => '<div style="font-size:12.5px;font-weight:600;color:var(--ink);font-style:italic;line-height:1.5;padding:6px 0;border-top:1px dashed var(--line)">« '+c+' »</div>').join('');
      box.appendChild(sec);
    }
    // Mon carnet (journal intime)
    const journal = (q.journal || []);
    if (journal.length) {
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-top:16px;padding-top:12px;border-top:2px dashed #e0d3bd';
      sec.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:15px;color:#5a4326;margin-bottom:8px">✍️ Mon carnet</div>'+
        '<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">'+journal.length+' entrée'+(journal.length>1?'s':'')+' — tes mots à toi, gardés par Foxy</div>'+
        journal.slice().reverse().map(e => {
          let d = ''; try { d = new Date(e.t).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}); } catch(x){}
          return '<div style="padding:7px 0;border-top:1px dashed var(--line)"><div style="font-size:10.5px;font-weight:800;color:var(--muted)">'+d+'</div><div style="font-size:13px;font-weight:600;color:var(--ink);line-height:1.5">'+e.text.replace(/</g,'&lt;')+'</div></div>';
        }).join('');
      box.appendChild(sec);
    }
  }
  document.getElementById('openQuest').addEventListener('click', async () => {
    const card = document.getElementById('questCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await renderQuest(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
  document.querySelectorAll('#debugCard [data-vm]').forEach(btn => {
    btn.addEventListener('click', () => setVoiceMode(btn.dataset.vm));
  });
  // forcer un pilier maintenant (ouvre le change guidé du pilier)
  document.querySelectorAll('#debugCard [data-force]').forEach(btn => {
    btn.addEventListener('click', () => {
      const labels = { c0900:'Change du matin', c1600:'Change de sortie de sieste', c2230:'Change de nuit' };
      popChangeDue({ key: btn.dataset.force, m:0, ctx:'pilier', label: labels[btn.dataset.force] });
    });
  });
  // nettoyage des tests du jour
  function dbgFlash(msg) {
    const f = document.getElementById('dbgFlash'); if (!f) return;
    f.textContent = msg; setTimeout(() => f.textContent = '', 1800);
  }
  document.getElementById('dbgCatchup').addEventListener('click', async () => {
    try {
      const q = await getQuest();
      q.subs = q.subs || {};
      // marque comme lus tous les sous-chapitres des chapitres déjà débloqués
      for (let s = 0; s <= Math.max(0, q.unlockedStage); s++) {
        const list = QUEST_SUBCHAPTERS[s] || [];
        q.subs[s] = list.map((_, i) => i);
      }
      await saveQuest(q);
      dbgFlash('📖 Souvenirs débloqués — vois « Notre aventure »');
      try { await renderQuest(); } catch(e) {}
    } catch(e) {}
  });
  document.getElementById('dbgResetQuest').addEventListener('click', async () => {
    try {
      await window.storage.set('quest', JSON.stringify({ unlockedStage:-1, subs:{}, lastRitualDate:null, ritualDoneDate:null, todayRitual:null, subToldDate:null, confidences:[] }));
      dbgFlash('♻️ Aventure réinitialisée');
      try { await renderQuest(); } catch(e) {}
    } catch(e) {}
  });

  document.getElementById('dbgClearChanges').addEventListener('click', async () => {
    const date = todayStr();
    try {
      // retire les change_fait du jour + réinitialise les piliers faits
      const r = await window.storage.get('check:'+date);
      let list = (r && r.value) ? JSON.parse(r.value) : [];
      list = list.filter(c => c.result !== 'change_fait' && c.result !== 'change_fait_sanspreuve');
      await window.storage.set('check:'+date, JSON.stringify(list));
      await window.storage.delete('slotdone:'+date);
      dueSnooze = {};
    } catch(e) {}
    dbgFlash('🗑️ Changes du jour effacés');
    try { await refresh(); } catch(e) {}
  });
  document.getElementById('dbgClearChecks').addEventListener('click', async () => {
    const date = todayStr();
    try {
      // retire tous les états/checks/alertes du jour (garde les change_fait)
      const r = await window.storage.get('check:'+date);
      let list = (r && r.value) ? JSON.parse(r.value) : [];
      list = list.filter(c => c.result === 'change_fait' || c.result === 'change_fait_sanspreuve');
      await window.storage.set('check:'+date, JSON.stringify(list));
      dueSnooze = {};
    } catch(e) {}
    dbgFlash('🗑️ Checks/alertes du jour effacés');
    try { await refresh(); } catch(e) {}
  });

  // init
  (async function() {
    if (!storage.persistent) {
      const w = document.getElementById('storeWarn');
      w.style.display = 'block';
      w.innerHTML = '⚠️ Stockage non persistant ici : tes saisies ne seront pas conservées après fermeture. Ouvre ce fichier dans Chrome ou Safari (hors navigation privée) pour que le suivi tienne sur le mois.';
    }
    document.getElementById('dateInput').value = todayStr();
    await loadAutoPref();
    await loadNotifPrefs();
    await loadHardMode();
    const hsw = document.getElementById('hardSwitch');
    if (hsw) { hsw.classList.toggle('on', hardMode); hsw.addEventListener('click', () => setHardMode(!hardMode)); }
    const bsw = document.getElementById('bigbroSwitch');
    if (bsw) { bsw.classList.toggle('on', bigbro); bsw.addEventListener('click', () => setBigbro(!bigbro)); }
    document.body.classList.toggle('hardmode', hardMode);
    await loadFoxyOutfit();
    refreshHeadFoxy();
    await loadVoice();
    try { const r = await window.storage.get('queststage'); window._lastStage = (r && r.value) ? JSON.parse(r.value) : 0; } catch(e) { window._lastStage = 0; }
    await loadPause();
    try { await loadFoxyMood(); } catch(e) {}
    try { await loadFoxySerie(); } catch(e) {}
    try { await loadLiveWardrobe(); } catch(e) {}
    try { await checkQrLock(); } catch(e) {}
    try { await scheduleBraceletChecks(); } catch(e) {}
    scheduleNotifications();
    await renderCheckStat();
    await renderMoment();
    await renderSupMode();
    await renderBreaches();
    // preload today's entry if it exists
    try {
      const r = await window.storage.get('day:'+todayStr());
      if (r && r.value) loadInto(JSON.parse(r.value));
    } catch(e) {}
    await refresh();
    if (voiceMode === 'report') { await showTab('maintenant'); }
    await maybeRedirectBilan();

    // --- Rappel de change automatique aux heures imposées ---
    // Créneaux du planning (minute depuis minuit) + type + libellé.
    const CHANGE_SLOTS = [
      { key:'c0900', m:9*60,     ctx:'pilier', label:'Change du matin' },
      { key:'c1130', m:11*60+30, ctx:'check',  label:'Check + 1er biberon' },
      { key:'c1330', m:13*60+30, ctx:'check',  label:'Check du déjeuner' },
      { key:'c1600', m:16*60,    ctx:'pilier', label:'Change de sortie de sieste' },
      { key:'c1930', m:19*60+30, ctx:'check',  label:'Check du dîner' },
      { key:'c2230', m:22*60+30, ctx:'pilier', label:'Change de nuit' }
    ];
    const TOL = 45; // fenêtre de déclenchement : jusqu'à 45 min après l'heure
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();

    // trouver un créneau actif (heure atteinte, dans la tolérance) non encore fait aujourd'hui
    let dueSlot = null;
    for (const s of CHANGE_SLOTS) {
      if (nowMin >= s.m && nowMin <= s.m + TOL) { dueSlot = s; break; }
    }
    let alreadyDone = false;
    if (dueSlot) {
      try {
        const r = await window.storage.get('slotdone:'+todayStr());
        const done = (r && r.value) ? JSON.parse(r.value) : {};
        alreadyDone = !!done[dueSlot.key];
      } catch(e) {}
    }

    // premier lancement : guide d'installation
    let obLance = false;
    try { obLance = await maybeStartOnboard(); } catch(e) {}
    if (obLance) { /* on laisse le guide tranquille */ }
    else if (paused) { /* mode pause : aucune sollicitation */ }
    else if (dueSlot && !alreadyDone) {
      // affiche le rappel "c'est l'heure" puis lance le flux guidé.
      // Le créneau n'est PAS marqué ici : "Plus tard" doit le laisser réapparaître.
      setTimeout(() => popChangeDue(dueSlot), 500);
    } else if (autoOn && (notifPrefs.surprise !== false) && Math.random() < OPEN_PROBABILITY) {
      // sinon, éventuellement une vérif surprise (si activée dans les réglages)
      setTimeout(() => popCheck(), 700);
    }
    // vérif périodique du change dû (persiste tant que non fait, avec snooze)
    setInterval(checkDueChangePeriodic, 60000);
  })();

  // Rappel de change persistant : re-propose tant que le pilier n'est pas fait
  let dueSnooze = {}; // key -> timestamp jusqu'auquel on ne re-propose pas
  async function checkDueChangePeriodic() {
    if (paused) return;
    if (document.getElementById('overlay').classList.contains('show')) return; // déjà une modale ouverte
    const CHANGE_SLOTS = [
      { key:'c0900', m:9*60,     ctx:'pilier', label:'Change du matin' },
      { key:'c1130', m:11*60+30, ctx:'check',  label:'Check + 1er biberon' },
      { key:'c1330', m:13*60+30, ctx:'check',  label:'Check du déjeuner' },
      { key:'c1600', m:16*60,    ctx:'pilier', label:'Change de sortie de sieste' },
      { key:'c1930', m:19*60+30, ctx:'check',  label:'Check du dîner' },
      { key:'c2230', m:22*60+30, ctx:'pilier', label:'Change de nuit' }
    ];
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    // un pilier reste "dû" de son heure jusqu'à +2h (les checks : fenêtre courte de 45 min)
    let due = null;
    for (const s of CHANGE_SLOTS) {
      // en mode intensif, tous les créneaux deviennent des piliers obligatoires
      const ctx = hardMode ? 'pilier' : s.ctx;
      const window = (ctx === 'pilier') ? 120 : 45;
      if (nowMin >= s.m && nowMin <= s.m + window) { due = Object.assign({}, s, { ctx }); break; }
    }
    if (!due) return;
    // déjà fait ?
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      if (done[due.key]) return;
    } catch(e) {}
    // snoozé (Plus tard récent) ?
    if (dueSnooze[due.key] && Date.now() < dueSnooze[due.key]) return;
    popChangeDue(due);
  }

  // Enregistrement du service worker (mode hors-ligne / installable)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }