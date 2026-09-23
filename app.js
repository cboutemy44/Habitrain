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

  /* Mode test de l'installation : tout ce qu'il écrit est jeté à la fin.
     Si l'appli a été fermée en plein test, on remet l'état d'avant ici,
     avant que quoi que ce soit ne lise le stockage. */
  const BAC_CLE = 'habitrain-bac-a-sable', BAC_ACTIF = 'habitrain-test-actif';
  function restaurerBacASable() {
    try {
      const s = window.localStorage.getItem(BAC_CLE);
      if (!s) return false;
      const snap = JSON.parse(s);
      const suppr = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.indexOf('habitrain:') === 0) suppr.push(k);
      }
      suppr.forEach(k => window.localStorage.removeItem(k));
      Object.keys(snap).forEach(k => window.localStorage.setItem(k, snap[k]));
      window.localStorage.removeItem(BAC_CLE);
      try { window.sessionStorage.removeItem(BAC_ACTIF); } catch(e) {}
      return true;
    } catch(e) { return false; }
  }
  function enBacASable() {
    try { return !!window.localStorage.getItem(BAC_CLE) && window.sessionStorage.getItem(BAC_ACTIF) === '1'; } catch(e) { return false; }
  }
  try { if (window.localStorage.getItem(BAC_CLE) && window.sessionStorage.getItem(BAC_ACTIF) !== '1') restaurerBacASable(); } catch(e) {}

  const APP_VERSION = '22.3';
  // La version s'affiche aussi sur les deux écrans de connexion : c'est là
  // qu'on arrive après une mise à jour, et c'est le seul endroit où on peut
  // vérifier d'un coup d'œil que le service worker a bien servi la nouvelle.
  function afficherVersion() {
    ['verBadge', 'qrLockVer', 'facadeVer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'v' + APP_VERSION;
    });
  }
  afficherVersion();
  document.addEventListener('DOMContentLoaded', afficherVersion);

  /* ---- Modes de voix : reporting / caregiver / foxy ---- */
  // mode: 'report' | 'care' | 'foxy'
  let voiceMode = 'report';
  const immersiveModes = ['foxy']; // caregiver retiré : on ne garde que Foxy
  let immersive = false;

  async function loadVoice() {
    // Foxy est le mode nominal : le reporting ne sort que si tu l'as choisi
    voiceMode = 'foxy';
    try { const r = await window.storage.get('pref:voicemode'); if (r && r.value) voiceMode = JSON.parse(r.value); } catch(e) {}
    immersive = immersiveModes.includes(voiceMode);
    applyVoiceChrome();
    // Sans await : imRunMoment attend que tu tapes pour dérouler ses phrases.
    // En l'attendant, tout le reste du démarrage restait bloqué derrière —
    // y compris la vérification du verrouillage, qui n'arrivait donc qu'APRÈS
    // que Foxy ait parlé. C'était la cause de la phrase aperçue avant l'entrée.
    // Son mot d'accueil passe par le chef d'orchestre : sans ça, il écrasait
    // une conversation déjà en cours (une invitation, une question posée).
    if (immersive) { try { talk(TALK.AMBIANCE, 'moment:ouverture', () => imRunMoment()); } catch(e) {} }
  }
  async function setVoiceMode(mode) {
    voiceMode = mode;
    immersive = immersiveModes.includes(mode);
    try { await window.storage.set('pref:voicemode', JSON.stringify(mode)); } catch(e) {}
    applyVoiceChrome();
    if (immersive) { try { await talk(TALK.AMBIANCE, 'moment:ouverture', () => imRunMoment()); } catch(e) {} }
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

  /* ============================================================
     LA JOURNÉE DE FOXY
     Foxy a fini son programme : il est habitué, et il vit ses journées
     en couche, comme toi, sur le même rythme — changes à 9h et 16h,
     bascule en tenue de nuit à 19h30, nuit jusqu'à 9h. Sa tenue était
     tirée au hasard une fois par jour, sans lien avec l'heure : il
     pouvait être en pyjama à 11h. Maintenant elle suit la période.
     Tout est calculé depuis la date et l'heure (graine fixe) : sa
     journée reste la même d'une ouverture à l'autre.
     ============================================================ */
  function graineFoxy(txt) {
    let h = 2166136261;
    for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }
  function foxyJournee(now) {
    now = now || new Date();
    const m = now.getHours()*60 + now.getMinutes();
    const date = now.toISOString().slice(0,10);
    let nuit = false, sieste = false;
    try { nuit = couchageNuit(now); sieste = !nuit && m >= SIESTE[0] && m < SIESTE[1]; } catch(e) {}
    const periode = nuit ? 'nuit' : (sieste ? 'sieste' : 'jour');
    // ce qu'il a de disponible en images, rangé par période
    const TENUES = { nuit: ['blue2','paw'], sieste: ['paw','blue'], jour: ['blue','paw','diaper'] };
    const tire = (d, per) => { const c = TENUES[per]; return c[Math.floor(graineFoxy(d + per) * c.length)]; };
    // la nuit commencée hier soir garde la tenue d'hier soir jusqu'à 9h
    let dateNuit = date;
    if (periode === 'nuit' && m < 9*60) { const h = new Date(now); h.setDate(h.getDate() - 1); dateNuit = h.toISOString().slice(0,10); }
    let tenue;
    if (periode === 'nuit') {
      tenue = tire(dateNuit, 'nuit');
      // il change vraiment d'habits le soir : pas la même pièce que la journée
      if (tenue === tire(dateNuit, 'jour')) tenue = TENUES.nuit.find(x => x !== tenue) || tenue;
    } else tenue = tire(date, periode);

    // son dernier change : le dernier pilier passé (9h, 16h, 19h30 la veille ou aujourd'hui)
    const PIL = [9*60, 16*60, 19*60 + 30];
    let depuis;
    const passes = PIL.filter(p => p <= m);
    if (passes.length) depuis = m - passes[passes.length - 1];
    else depuis = (24*60 - (19*60 + 30)) + m;            // depuis 19h30 la veille
    // habitué : ça part régulièrement, et il ne le remarque presque plus
    let rythme = 95 + Math.floor(graineFoxy(date + 'r') * 40);     // une fois toutes les 1h35 à 2h15
    if (periode === 'nuit') rythme = Math.round(rythme * 1.7);         // la nuit, ça vient moins souvent
    const mictions = Math.floor(depuis / rythme);
    const etat = mictions === 0 ? 'sec' : (mictions >= 3 ? 'lourde' : 'mouille');
    const remarquees = mictions ? Math.min(mictions, Math.floor(graineFoxy(date + 'n' + mictions) * 2)) : 0; // 0 ou 1, rarement plus
    return { periode, tenue, depuis, mictions, etat, remarquees };
  }

  async function loadFoxyOutfit() {
    const date = todayStr();
    // un choix fait à la main (menu de débogage) prime pour la journée
    try {
      const r = await window.storage.get('foxyfit:force:'+date);
      if (r && r.value) { const id = JSON.parse(r.value); const f = FOXY_OUTFITS.find(o=>o.id===id); if (f) { foxyOutfit = f; return; } }
    } catch(e) {}
    const id = foxyJournee().tenue;
    foxyOutfit = FOXY_OUTFITS.find(o => o.id === id) || FOXY_OUTFITS[0];
  }

  // « Et toi, tu en es où ? » : sa tenue, sa couche, ce qu'il fait
  async function foxyRaconteSonMoment() {
    const j = foxyJournee();
    const d = foxyDecrit(j);
    await imSay(d.tenue, 800, 'happy');
    await imSay(d.couche, 950, j.etat === 'sec' ? 'calm' : 'proud');
    let act = null;
    try {
      const m = new Date().getHours()*60 + new Date().getMinutes();
      let cur = null; for (const sl of SCHEDULE) { if (sl.m <= m) cur = sl; }
      act = cur && cur.act;
    } catch(e) {}
    const QUOI = {
      nuit:   bro('Et je suis tranquille, prêt pour la nuit. On a le même rythme, toi et moi — on bascule ensemble à 19h30.', 'Je suis en tenue de nuit, comme toi. Même rythme.'),
      sieste: bro('Et c\'est la sieste : je suis allongé sur le côté, doudou dans les bras. Je me laisse aller.', 'C\'est la sieste. Je me laisse aller.'),
      jour:   bro('Et là, je suis ' + (act ? 'dans mon « ' + act + ' », comme toi' : 'dans ma journée') + '. Tu vois, on fait la même chose, au même moment. Je ne suis pas en avance sur toi pour te regarder faire — je suis à côté. 🦊', act ? 'Là, je suis dans mon « ' + act + ' ». Comme toi.' : 'Je suis dans ma journée, comme toi.')
    };
    await imSay(QUOI[j.periode], 900, 'happy');
  }

  // Ce qu'il dit de lui-même, au présent
  function foxyDecrit(j) {
    j = j || foxyJournee();
    const nom = (FOXY_OUTFITS.find(o => o.id === j.tenue) || {}).name || 'ma tenue';
    const h = Math.floor(j.depuis / 60), mn = j.depuis % 60;
    const duree = h ? h + 'h' + (mn ? String(mn).padStart(2,'0') : '') : mn + ' min';
    const tenue = j.tenue === 'diaper'
      ? 'Moi, là, je suis juste en couche — à la maison, il fait bon, je n\'ai pas besoin de plus.'
      : 'Moi, là, je suis en ' + nom + '.';
    const fois = ['zéro','une','deux','trois','quatre','cinq','six','sept','huit'][j.mictions] || String(j.mictions);
    const qualif = j.etat === 'lourde' ? 'bien lourde' : 'mouillée';
    let couche;
    if (j.etat === 'sec') couche = 'Ma couche a ' + duree + ', elle est encore toute fraîche.';
    else if (j.remarquees === 0) couche = 'Ma couche a ' + duree + ' et elle est ' + qualif + ' — ' + fois + ' fois déjà, et je ne l\'ai senti partir aucune fois. Je m\'en rends compte parce que tu me poses la question. 🦊';
    else if (j.mictions === 1) couche = 'Ma couche a ' + duree + ' et elle est mouillée — une fois. Celle-là je l\'ai sentie partir : j\'étais assis, tranquille, j\'ai juste laissé faire.';
    else couche = 'Ma couche a ' + duree + ' et elle est ' + qualif + ' — ' + fois + ' fois, et je n\'en ai senti partir qu\'une. Le reste est venu tout seul, pendant que je faisais autre chose.';
    return { tenue, couche, duree };
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
  // vignette de la planche guide-steps.png (4×2) pour chaque étape du change
  const CHANGE_CELLS_IDX = { prep:0, remove:1, place:2, done:7 };
  function positionChangeCell(el, idx, sizePx) {
    if (!el) return;
    const col = idx % 4, row = Math.floor(idx / 4);
    el.style.backgroundImage = "url('foxy-changescene.png')";
    el.style.backgroundSize = (sizePx*4) + 'px ' + (sizePx*4) + 'px';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = (-(col*sizePx)) + 'px ' + (-(row*sizePx)) + 'px';
  }

  // Change guidé « Foxy se met sa couche » — guide des 4 languettes (8 étapes)
  /* ============================================================
     CE QUE FOXY RESSENT
     Ses confidences pendant le change (une étape sur trois environ)
     et ses récits spontanés sur ce qui se passe en lui.
     ============================================================ */
  const FOXY_FEELS_STEP = {
    0: [ 'Tu sais, le bruit du plastique quand je déplie les languettes… ce petit crissement, rien que de l\'entendre je me détends déjà.',
         'Moi j\'aime bien ce moment. Tout est encore propre et net, et je sais ce qui arrive après. Y\'a une sorte d\'attente, tu vois ?' ],
    1: [ 'Quand je retire l\'ancienne, y\'a toujours ce petit pincement de me retrouver sans rien. Deux secondes où je me sens nu, quoi.',
         'C\'est marrant, avant je trouvais ce moment gênant. Maintenant c\'est juste une transition, j\'y pense même plus.' ],
    2: [ 'La fraîcheur quand elle se pose sous moi, ça me fait toujours quelque chose. Un peu froid, et puis ça devient tiède.',
         'Le premier clic de languette… c\'est le son que je préfère de toute la journée. Sérieux.',
         'Allongé comme ça, sans rien à faire pendant qu\'on s\'occupe de moi : c\'est un des moments les plus reposants de ma journée.' ],
    3: [ 'Et voilà. Quand je me relève et que je sens le volume entre mes jambes… c\'est là que je me sens vraiment bien. Comme rentré chez moi.',
         'Les premiers pas après un change, avec ce petit balancement… franchement, j\'adore.',
         'Maintenant c\'est fait, et je n\'ai plus à y penser jusqu\'au prochain. Cette tranquillité-là, c\'est ce que je cherchais.' ]
  };


  /* ---------- Ce que sa couche lui apporte, au quotidien ----------
     De petites remarques courtes, glissées régulièrement. Foxy dit
     simplement qu'il s'y sent bien et pourquoi. ---------- */
  const FOXY_WELLBEING = [
    'Je me sens bien là-dedans, tu sais. C\'est tout bête mais c\'est vrai.',
    'J\'aime bien ce petit poids constant. Ça me rappelle que je suis à ma place.',
    'Franchement ? Depuis que je porte des couches, j\'ai la tête bien plus légère. Y\'a un truc en moins à gérer en permanence.',
    'Ce que ça m\'apporte le plus, c\'est de ne plus avoir à surveiller. Tu imagines pas la place que ça libère.',
    'Je me sens contenu. C\'est le mot juste, je crois. Contenu, et du coup tranquille.',
    'Y\'a cette douceur contre moi, tout le temps. C\'est bête mais ça me rassure toute la journée.',
    'Moi ça m\'apaise. Vraiment. C\'est pas juste pratique, ça me fait du bien.',
    'Tu sais ce que je préfère ? Ne plus jamais être pressé. Plus de course, plus d\'urgence. Juste... être.',
    'Je dors tellement mieux depuis. Plus de réveil en pleine nuit, plus rien. Des nuits entières.',
    'C\'est devenu mon petit cocon portable. Où que j\'aille, j\'emmène un bout de confort avec moi.',
    'Ça m\'a appris à me détendre. Pour de vrai, pas juste à faire semblant.',
    'Le matin quand je la mets, y\'a comme un soulagement. Ma journée peut commencer.',
    'J\'ai plus cette petite tension de fond que j\'avais avant. Elle a disparu, et elle m\'a pas manqué.',
    'C\'est doux, c\'est chaud, ça tient bien. Franchement je vois pas ce que je pourrais demander de mieux.',
    'Le plus beau cadeau que ça m\'a fait, c\'est d\'arrêter de me battre contre mon propre corps.',
    'Je me sens en sécurité. C\'est le mot. Comme si rien de grave ne pouvait arriver.',
    'Y\'a plus rien à prouver quand je suis en couche. Je suis juste moi, et ça suffit.'
  ];

  // Foxy dit simplement qu'il s'y sent bien (régulier mais léger)
  async function maybeWellbeing() {
    if (broOn()) return false;
    let n = 0, jour = null;
    try {
      const r = await window.storage.get('wellb:state');
      if (r && r.value) { const st = JSON.parse(r.value); n = st.n||0; jour = st.jour||null; }
    } catch(e) {}
    if (jour !== todayStr()) n = 0;
    if (n >= 2) return false;              // deux fois par jour maximum
    if (Math.random() >= 0.3) return false;
    // évite de répéter les mêmes
    let vus = [];
    try { const r = await window.storage.get('wellb:vus'); if (r && r.value) vus = JSON.parse(r.value); } catch(e) {}
    let pool = FOXY_WELLBEING.filter(x => !vus.includes(x));
    if (!pool.length) { pool = FOXY_WELLBEING; vus = []; }
    const ligne = pool[Math.floor(Math.random()*pool.length)];
    vus.push(ligne); if (vus.length > 12) vus = vus.slice(-12);
    try {
      await window.storage.set('wellb:state', JSON.stringify({ n:n+1, jour:todayStr() }));
      await window.storage.set('wellb:vus', JSON.stringify(vus));
    } catch(e) {}
    await imSay('🦊 ' + ligne, 950, pick(['moved','calm','comfort']));
    return true;
  }

  const FOXY_FEELS_STORIES = [
    { t:'Ce que ça me fait, ma couche',
      l:['Tu m\'as jamais demandé ce que ça me fait à moi, tu sais.',
         'Quand je la mets, y\'a d\'abord le poids. Léger, mais présent. Constant. C\'est bête mais ça me rassure, ce petit rappel permanent.',
         'Et puis y\'a le fait de ne plus avoir à surveiller. Ça libère une place énorme dans ma tête. Je savais même pas que ça prenait autant de place avant.'] },
    { t:'Les premières fois',
      l:['Je repense parfois à mes débuts. J\'étais tellement raide, tellement sur mes gardes.',
         'Je passais mon temps à vérifier, à me demander si ça se voyait, si ça faisait du bruit quand je bougeais.',
         'Et puis un jour je me suis rendu compte que j\'avais passé toute une après-midi sans y penser une seule fois. C\'est là que j\'ai compris que c\'était gagné.'] },
    { t:'Quand elle devient mouillée',
      l:['Le moment où elle se réchauffe, quand ça vient... au début ça me faisait bizarre, presque inconfortable.',
         'Maintenant c\'est devenu une sensation que j\'attends presque. Cette chaleur qui se diffuse, ce poids qui change doucement.',
         'C\'est le signe que j\'ai réussi à lâcher. Alors comment veux-tu que je trouve ça désagréable ?'] },
    { t:'Le soir, avant de dormir',
      l:['Ma préférée, c\'est celle du soir. La plus épaisse, celle qui tient toute la nuit.',
         'Quand je la mets, je sais que ma journée est finie. Plus rien à décider, plus rien à tenir.',
         'Je m\'endors avec cette sensation d\'être bien contenu. C\'est les meilleures nuits que j\'aie jamais eues, je te jure.'] },
    { t:'Ce qui a changé en moi',
      l:['Avant, j\'étais quelqu\'un qui contrôlait tout. Tout le temps. Même ce qui n\'avait pas besoin de l\'être.',
         'Apprendre à lâcher ça, ça m\'a pris des semaines. Et ça a débordé sur plein d\'autres trucs de ma vie.',
         'Je dors mieux. Je m\'inquiète moins. C\'est parti d\'une couche, et au final ça a changé bien plus que ça.'] },
    { t:'Le matin au réveil',
      l:['Le matin, avant même d\'ouvrir les yeux, je tends la main pour toucher.',
         'Quand elle est bien lourde, j\'ai ce petit sourire tout bête tout seul dans mon lit.',
         'C\'est devenu mon indicateur : si ma nuit a bien travaillé, je sais que la journée va bien se passer.'] }
  ];

  /* Les créneaux du planning, définis ici une fois pour toutes : le rappel
     périodique, le démarrage et la validation d'un change lisent la même
     liste. Avant, la validation ne connaissait que les trois piliers : un
     change fait pendant un check n'était donc jamais marqué comme fait, et
     le rappel revenait toutes les minutes. */
  const CRENEAUX = [
    { key:'c0900', m:9*60,     ctx:'pilier', label:'Change du matin' },
    { key:'c1130', m:11*60+30, ctx:'check',  label:'Check + 1er biberon' },
    { key:'c1330', m:13*60+30, ctx:'check',  label:'Check du déjeuner' },
    { key:'c1600', m:16*60,    ctx:'pilier', label:'Change de sortie de sieste' },
    { key:'c1930', m:19*60+30, ctx:'check',  label:'Check du dîner' },
    { key:'c2230', m:22*60+30, ctx:'pilier', label:'Change de nuit' }
  ];
  // le créneau dont la fenêtre couvre l'heure donnée (pilier : 2 h, check : 45 min)
  function creneauCourant(now, tolerance) {
    const d = now || new Date();
    const nowMin = d.getHours()*60 + d.getMinutes();
    for (const s of CRENEAUX) {
      const ctx = (hardMode || discActive()) ? 'pilier' : s.ctx;
      const fen = tolerance != null ? tolerance : (ctx === 'pilier' ? 120 : 45);
      if (nowMin >= s.m && nowMin <= s.m + fen) return Object.assign({}, s, { ctx });
    }
    return null;
  }

  /* Le change guidé, en quatre temps. Il en comptait huit, dont six pour
     les seules languettes : à l'usage, on tapait « suivant » sans lire. */
  const CHANGE_STEPS = [
    { cell:'prep', titre:'Prépare', pastille:'🍼',
      t:'Installe-toi, tout à portée de main : ta couche, la crème, les lingettes.\nDéplie les 4 languettes en éventail — aucune ne doit rester collée.' },
    { cell:'remove', titre:'Retire l\'ancienne', pastille:'♻️',
      t:'Défais les languettes, retire ta couche et ta tenue.\nRoule la couche usagée vers l\'intérieur et jette-la.' },
    { cell:'place', titre:'Pose la fraîche', pastille:'✨',
      t:'Allongé, bassin soulevé : glisse la couche bien centrée, remonte le devant sous le nombril.\nLanguettes du bas vers l\'extérieur, puis celles du haut — les deux côtés symétriques.' },
    { cell:'done', titre:'Vérifie et rhabille-toi', pastille:'👕',
      t:'Un doigt doit passer à la taille, les élastiques épousent les cuisses sans serrer.\nRemets ta tenue, et voilà. 🦊✨' }
  ];


  /* Consignes de capteurs, injectées dans les étapes qui les concernent.
     Rien ne s'affiche si tu n'as pas le matériel : on ne te demande pas de
     déplacer un capteur que tu ne possèdes pas. */
  const CONSIGNES_CAPTEUR = {
    1: { cle:'couche', t:'📡 <b>Récupère ton capteur</b> avant de jeter l\'ancienne. Essuie sa face avec un chiffon sec — jamais d\'eau ni d\'alcool sur la grille.' },
    2: { cle:'couche', t:'📡 <b>Pose le capteur</b> à l\'avant de la couche fraîche, centré, à deux doigts sous la ceinture, grille contre le tissu.' },
    3: { cle:'tenue',  t:'🔒 <b>Reclipse le module de tenue</b> en butée de fermeture, une fois la tenue fermée. La diode clignote une fois.' }
  };

  async function consigneCapteurPour(i) {
    const c = CONSIGNES_CAPTEUR[i];
    if (!c) return null;
    try {
      if (c.cle === 'couche') {
        const r = await window.storage.get('sensor:vu');
        if (!r || !r.value) return null;
      } else if (c.cle === 'tenue') {
        if (!(await capteurTenueEnService())) return null;
      }
    } catch(e) { return null; }
    return c.t;
  }

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
  /* ------------------------------------------------------------
     QUELLE COUCHE POUR LE PROCHAIN CHANGE
     Partout on prenait le premier modèle disponible de la liste : avec
     plusieurs modèles en stock, c'était toujours le même. Le choix se
     fait maintenant ici, une seule fois par change :
       · jamais deux fois de suite le même modèle quand il y en a d'autres ;
       · tiré au hasard, pondéré par le stock (le plus fourni sort plus) ;
       · réservé : l'annonce, le kit, la reprise et le décompte parlent
         tous de la même couche, jusqu'à ce qu'elle soit posée.
     ------------------------------------------------------------ */
  async function modeleProchain(period) {
    const WB = window.HabitrainWardrobe;
    if (!WB) return null;
    const dispo = (await WB.modelsFor(period)).filter(m => m.qty > 0);
    if (!dispo.length) return null;
    const cle = 'couche:resa:' + period;
    const resa = await lireStock(cle, null);
    if (resa && Date.now() - resa.t < 12*3600000) {
      const m = dispo.find(x => x.id === resa.id);
      if (m) return m;
    }
    const derniere = await lireStock('couche:posee:' + period, null);
    let pool = dispo;
    if (derniere && dispo.length > 1) pool = dispo.filter(m => m.id !== derniere.id);
    const total = pool.reduce((s, m) => s + m.qty, 0);
    let x = Math.random() * total, choisi = pool[0];
    for (const m of pool) { x -= m.qty; if (x < 0) { choisi = m; break; } }
    await ecrireStock(cle, { id: choisi.id, t: Date.now() });
    return choisi;
  }
  // appelée au décompte : la réservation est consommée, le modèle posé mémorisé
  async function noterCouchePosee(period, model) {
    await ecrireStock('couche:posee:' + period, { id: model.id, name: model.name, t: Date.now() });
    await ecrireStock('couche:posee', { id: model.id, name: model.name, period, t: Date.now() });
    await ecrireStock('couche:resa:' + period, null);
  }

  async function pickChangeModel() {
    changeModel = null;
    try {
      if (!window.HabitrainWardrobe) return null;
      // même bascule que la carte du tirage et la vérification du scan :
      // 22h30 / 9h, pas 22h / 8h. Entre 8h et 9h, on proposait une couche de
      // jour alors que le cadre te garde en couche de nuit.
      const period = couchageNuit(new Date()) ? 'nuit' : 'jour';
      const m = await modeleProchain(period);
      if (!m) {
        const tous = await window.HabitrainWardrobe.getStock();
        const reste = tous.filter(x => x.qty > 0);
        changeModel = reste.length ? reste[Math.floor(Math.random() * reste.length)] : null;
        return changeModel ? { model:changeModel, horsPeriode:true, period } : { vide:true, period };
      }
      changeModel = m;
      return { model:changeModel, period };
    } catch(e) { return null; }
  }

  function runChangeStep(i) {
    const step = CHANGE_STEPS[i];
    const last = i === CHANGE_STEPS.length - 1;
    positionGuideStep(document.getElementById('poseGuide'), CHANGE_CELLS_IDX[step.cell] != null ? CHANGE_CELLS_IDX[step.cell] : i);
    // fil de progression : une pastille par étape
    const fil = document.getElementById('posePoints');
    if (fil) {
      fil.innerHTML = '';
      CHANGE_STEPS.forEach((st, k) => {
        const d = document.createElement('div');
        d.className = 'pose-pt' + (k < i ? ' faite' : k === i ? ' ici' : '');
        d.textContent = st.pastille;
        fil.appendChild(d);
      });
    }
    document.getElementById('poseStepNum').textContent = step.titre + ' · ' + (i+1) + '/' + CHANGE_STEPS.length;
    const acts = document.getElementById('poseActs');
    acts.innerHTML = '';
    const extras = document.getElementById('poseExtras');
    if (extras) extras.innerHTML = '';

    const ajouterTag = (html, cls) => {
      if (!extras) return;
      const tag = document.createElement('div');
      tag.className = 'pose-tag' + (cls ? ' ' + cls : '');
      tag.innerHTML = html;
      extras.appendChild(tag);
    };

    // première étape : quelle couche prendre
    if (i === 0) {
      pickChangeModel().then(info => {
        if (!info) return;
        if (info.vide) ajouterTag('⚠️ Plus aucune couche en stock. Prends ce que tu as, et pense à recommander.', 'alerte');
        else if (info.horsPeriode) ajouterTag('⚠️ Plus de modèle « ' + info.period + ' » : prends une <b>' + info.model.name + '</b> (' + info.model.qty + ' restantes).', 'alerte');
        else ajouterTag('🍼 Prends une <b>' + info.model.name + '</b> — il t\'en reste ' + info.model.qty + '.');
      });
    }
    // consigne de capteur, s'il y en a une pour cette étape
    consigneCapteurPour(i).then(txt => { if (txt) ajouterTag(txt, 'capteur'); });
    // et parfois, ce que ça lui fait à lui
    if (!broOn() && Math.random() < 0.35) {
      const lot = FOXY_FEELS_STEP[i];
      if (lot && lot.length) ajouterTag('🦊 ' + lot[Math.floor(Math.random()*lot.length)], 'foxy');
    }

    // le texte s'écrit, mais un appui l'affiche d'un coup : on n'attend jamais
    const suivant = () => {
      if (acts.childElementCount) return;
      const b = document.createElement('button');
      b.className = 'ok';
      b.textContent = last ? '🐾 Couche fraîche posée' : 'Fait, on continue';
      b.addEventListener('click', async () => {
        if (last) { await finishChange(); }
        else { runChangeStep(i+1); }
      });
      acts.appendChild(b);
      if (i > 0) {
        const r = document.createElement('button');
        r.className = 'adj'; r.textContent = '‹ Étape précédente';
        r.addEventListener('click', () => runChangeStep(i-1));
        acts.appendChild(r);
      }
    };
    poseType(step.t, suivant);
    const ligne = document.getElementById('poseLine');
    if (ligne) ligne.onclick = () => { if (poseTypeTimer) { clearInterval(poseTypeTimer); poseTypeTimer = null; ligne.textContent = step.t; suivant(); } };
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

  async function finishChange(opts) {
    opts = opts || {};
    // Un change se prouve, toujours. Sur les piliers du matin et du soir,
    // la tenue change aussi : deux preuves, l'une après l'autre.
    // À partir de 19h30, une remise en couche EST le change de nuit, avancé.
    // On ne pose pas une couche de jour pour trois heures.
    const nuitAnticipee = couchageNuit(new Date()) && !estNuit(new Date());
    const isPilier = (changeCtx === 'pilier') || !!pillarSlotForNow() || nuitAnticipee;
    const etapes = [isPilier ? 'change_pilier' : 'change_tous'];
    try {
      const nowMin = new Date().getHours()*60 + new Date().getMinutes();
      const bascule = isPilier && (Math.abs(nowMin - 9*60) <= 120 || Math.abs(nowMin - (22*60+30)) <= 120);
      // À la reprise, la tenue est TOUJOURS exigée quelle que soit l'heure :
      // tu sors du cadre entièrement, tu y rentres entièrement. Sans ça, le
      // récapitulatif t'imposait une tenue que personne ne vérifiait.
      if ((bascule || nuitAnticipee || opts.exigerTenue) && window.HabitrainWardrobe) etapes.push('tenue');
    } catch(e) {}
    // ce qui vient d'être prouvé pendant la reprise n'est pas redemandé
    const restantes = opts.dejaProuve
      ? etapes.filter(k => opts.dejaProuve.indexOf(k) === -1)
      : etapes;
    const prouve = restantes.length
      ? await exigerPreuves(restantes, { nuit: couchageNuit(new Date()) })
      : true;
    await finalizeChange(prouve);
    return prouve;
  }
  async function finalizeChange(proof) {
    await saveCheck(proof ? 'change_fait' : 'change_fait_sanspreuve', 'change_'+(changeCtx||'check'));
    try { await calibrerCapteurApresChange(proof, changeCtx); } catch(e) {}
    let slotKey = activeSlotKey;
    // un change vaut pour le créneau en cours, pilier OU check : sans ça, le
    // rappel du créneau revenait en boucle alors que le change venait d'être fait
    if (!slotKey) { const c = creneauCourant(); if (c) slotKey = c.key; }
    if (!slotKey) { const p = pillarSlotForNow(); if (p) slotKey = p.key; }
    // change de nuit avancé : c'est bien le pilier de 22h30 qu'on valide
    if (!slotKey && couchageNuit(new Date())) slotKey = 'c2230';
    await markSlotDoneKey(slotKey);
    if (slotKey) dueSnooze[slotKey] = Date.now() + 3*3600000;

    // Le stock se décompte ICI, et nulle part ailleurs. Jusqu'à présent le
    // modèle était réservé à l'étape 1 du change guidé... et jamais consommé :
    // la fonction existait dans la garde-robe, personne ne l'appelait. Tes
    // compteurs ne bougeaient donc pas d'un pouce depuis le début.
    try {
      // changeModel n'est renseigné que par la pose guidée. Un change validé
      // autrement — « je l'ai déjà fait », reprise après pause — laissait donc
      // le stock intact. On choisit le modèle ici si personne ne l'a fait.
      if (window.HabitrainWardrobe && !changeModel) {
        try { await pickChangeModel(); } catch(e) {}
      }
      if (window.HabitrainWardrobe && changeModel) {
        const nuit = couchageNuit(new Date());
        const r = await window.HabitrainWardrobe.consume(nuit ? 'nuit' : 'jour', changeModel.id);
        if (r && r.ok) { try { await noterCouchePosee(nuit ? 'nuit' : 'jour', changeModel); } catch(e) {} }
        if (r && r.ok === false && voiceMode === 'foxy') {
          await imSay(broOn()
            ? 'Stock épuisé sur ce modèle. Recommande, ce n\'est pas négociable.'
            : '⚠️ Plus de « ' + (changeModel.name || 'ce modèle') + ' » en stock ! Pense à recommander. 🦊', 900, 'concern');
        }
      }
    } catch(e) {}
    changeModel = null;

    // Le change n'est pas fini parce que tu l'as dit : il est fini quand le
    // capteur voit une couche fraîche. On arme la vérification ici.
    try { await armerVerifFraiche(slotKey); } catch(e) {}

    /* Le change est ACTÉ ici, et la fenêtre se referme tout de suite.
       Avant, Foxy enchaînait ses explications dans le chat pendant que la
       fenêtre du change était encore par-dessus : il attendait un appui que
       tu ne pouvais pas lui donner, et la validation n'aboutissait jamais. */
    const ctxFait = changeCtx, slotFait = slotKey;
    activeSlotKey = null;
    closeCheck();
    try { await renderCheckStat(); } catch(e) {}
    try { await renderSince(); } catch(e) {}

    // Change de nuit : le relevé du soir en fait partie. Il s'impose, donc il
    // arrive en fenêtre, avant que Foxy ne reprenne la parole dans le chat.
    if (releveSoirDu(slotFait)) {
      // coupe : un relevé ne fait pas la queue derrière une causerie qui, elle,
      // attend un appui. C'est un contrôle, il passe devant.
      talk(TALK.CHECK, 'releve:soir:' + todayStr(), async () => {
        try { await releveSoirFenetre(true); } catch(e) {}
      }, { coupe: true });
    }

    // ce qui vient d'être posé, pourquoi, et pour combien de temps — une fois libre
    talk(TALK.CADRE, 'change:apres:' + Date.now(), async () => {
      if (voiceMode === 'foxy' && !paused) { try { await expliquerCouche(); } catch(e) {} }
      try { await elementsDesertionChange(slotFait); } catch(e) {}
      try { await proposerRessentirApresChange(); } catch(e) {}
      try { if (ctxFait === 'pilier' || slotFait) await corroborerPilier(slotFait); } catch(e) {}
    });
  }
  /* ============================================================
     PREUVES PAR SCAN — strictes et nommées
     Une action qui a un code associé ne se valide QUE par ce code.
     Foxy dit lequel scanner et où il se trouve, une étape à la fois.
     Le QR et le tag NFC sont équivalents : le scanner écoute les deux.
     ============================================================ */
  /* Le change se prouve par TON BRACELET, et rien d'autre. C'est le code que
     tu portes en permanence : une seule preuve, toujours à portée, au poignet.
     L'ancien code du tapis reste accepté pour ne pas invalider ce qui est déjà
     imprimé et collé, mais ce n'est plus lui qu'on te demande. */
  const PREUVE_BRACELET = {
    nom:'ton bracelet', ou:'À ton poignet — QR ou tag NFC', petit:true,
    accepte: k => k === 'unlock' || k === 'change_pilier' || k === 'change_tous'
  };
  const PREUVE_TAPIS = { nom:'le QR de ton tapis à langer', ou:'Sur ton tapis à langer',
                         accepte: k => k === 'change_pilier' || k === 'change_tous' || k === 'unlock' };
  /* Pas de bracelet dans ton trousseau ? On retombe sur le code du tapis : le
     cadre ne se relâche pas parce qu'un accessoire manque. */
  let braceletDispo = null;
  async function chargerBracelet() {
    try {
      const acc = await lireStock('profil:accessoires', null);
      if (acc && typeof acc.bracelet !== 'undefined') { braceletDispo = !!acc.bracelet; return braceletDispo; }
    } catch(e) {}
    try {
      const p = await window.HabitrainQR.getQrPrefs();
      braceletDispo = !!(p.braceletRequired || p.unlock);
    } catch(e) { braceletDispo = false; }
    return braceletDispo;
  }
  function preuveChange() { return braceletDispo === false ? PREUVE_TAPIS : PREUVE_BRACELET; }

  const PREUVE_DEF = {
    get change_pilier() { return preuveChange(); },
    get change_tous()   { return preuveChange(); },
    biberon:       { nom:'le QR de ton biberon',        ou:'Près du frigo ou du plan de travail',
                     accepte: k => k === 'biberon' },
    coucher:       { nom:'le QR du coucher',            ou:'Sur la porte de ta chambre',
                     accepte: k => k === 'coucher' },
    tenue:         { nom:'l\'étiquette de ta tenue',    ou:'À l\'intérieur du col ou de la ceinture', petit:true,
                     accepte: k => /^wb/.test(String(k)) }
  };

  /* La preuve « tenue » ne se contente pas d'une étiquette quelconque : elle
     doit correspondre au tirage du jour. Sans ce contrôle, scanner le col de
     n'importe quel vêtement validait l'étape — y compris celle de la reprise
     où Foxy venait de nommer la tenue à enfiler. */
  async function tenueConforme(kind, nuitImposee) {
    const WB = window.HabitrainWardrobe;
    if (!WB) return { ok:true };
    let item = null;
    try { item = await WB.findByItemId(kind); } catch(e) {}
    if (!item) return { ok:false, raison:'inconnue' };
    let att = null;
    try {
      // Pendant un change ou une reprise après 19h30, c'est la tenue de nuit
      // qu'on vient de te faire enfiler : on la compare à celle-là, pas à
      // celle que l'horloge dirait. Hors de ce contexte, l'horloge reprend.
      const forcee = nuitImposee
        || (couchageNuit(new Date()) && (estNuit(new Date()) || (await nuitDejaFaite())));
      att = tenueAttendue(await getOutfit(todayStr()), new Date(), forcee);
    } catch(e) {}
    if (!att || !att.nom) return { ok:true, item };          // pas de tirage : on ne bloque pas
    if (att.tolerees.indexOf(item.name) >= 0) return { ok:true, item };
    return { ok:false, raison:'pas la bonne', item, attendue: att.nom };
  }

  /* Une étape de preuve. Renvoie 'ok' (scan valide) ou 'force' (validé sans
     preuve, entorse notée).

     Elle s'appelait elle-même à chaque échec : un scan qui ne passait pas
     relançait la même fenêtre indéfiniment, et le bouton de sortie se
     perdait au fond de la pile. C'est maintenant une simple boucle, avec
     une sortie visible dès le deuxième essai. */
  async function unePreuve(kind, rang, total, essai, ctx) {
    const QR = window.HabitrainQR;
    const def = PREUVE_DEF[kind];
    if (!QR || !def) return 'ok';               // rien à prouver : on ne bloque pas
    const etape = total > 1 ? ('Étape ' + rang + ' sur ' + total + ' — ') : '';
    const lieu = '\n📍 ' + def.ou
      + (window.HabitrainNFC && window.HabitrainNFC.supported() ? '\nTu peux aussi approcher ton tag.' : '');
    const verbe = (window.HabitrainNFC && window.HabitrainNFC.supported()) ? 'approche ou scanne ' : 'scanne ';
    let entete = etape + verbe + def.nom + '.';

    for (let n = essai || 1; ; n++) {
      // à partir du 2e essai, la sortie est offerte directement
      const choix = await new Promise(res => {
        const boutons = [{ label: n === 1 ? '📷 Scanner' : '📷 Réessayer', onClick: () => { foxyPopHide(); res('scan'); } }];
        if (n >= 2) boutons.push({ soft:true, label:'✓ Valider sans scanner', onClick: () => { foxyPopHide(); res('sans'); } });
        else boutons.push({ soft:true, label:'Je ne peux pas scanner', onClick: () => { foxyPopHide(); res('sans'); } });
        foxyPopShow(entete + lieu, n === 1 ? 'curious' : 'pensive', boutons);
      });

      if (choix === 'sans') {
        const ok = await new Promise(res => {
          foxyPopShow(broOn()
            ? 'Alors ce sera noté comme validé sans preuve. Je ne fais pas semblant d\'y croire.'
            : 'D\'accord… mais je le note comme « sans preuve ». Ça compte comme une entorse, tu le sais. 🦊',
            'concern',
            [{ label:'J\'ai compris', onClick: () => { foxyPopHide(); res(true); } },
             { soft:true, label:'Finalement je scanne', onClick: () => { foxyPopHide(); res(false); } }]);
        });
        if (ok) { try { await marquerEntorse('b_preuve'); } catch(e) {} return 'force'; }
        entete = etape + verbe + def.nom + '.';
        continue;
      }

      const k = await scannerUnCode({ petit: !!def.petit });
      if (!k) { entete = etape + 'lecture annulée. On réessaie : ' + def.nom + '.'; continue; }
      if (!def.accepte(k)) { entete = etape + 'ce n\'est pas le bon code. Je veux ' + def.nom + '.'; continue; }

      if (kind === 'tenue') {
        const v = await tenueConforme(k, ctx && ctx.nuit);
        if (!v.ok) {
          const quoi = v.attendue
            ? ('C\'est « ' + (v.item ? v.item.name : '?') + ' ». Je veux « ' + v.attendue + ' ».')
            : 'Cette étiquette n\'est pas une de tes tenues.';
          const suite = await new Promise(res => {
            foxyPopShow(quoi + '\nTu veux la changer, ou c\'est bien celle que tu portes ?', 'pensive', [
              { label:'📷 Je l\'ai changée, je rescanne', onClick: () => { foxyPopHide(); res('retry'); } },
              { soft:true, label:'C\'est celle que je porte', onClick: () => { foxyPopHide(); res('garde'); } }
            ]);
          });
          if (suite === 'retry') { entete = etape + 'scanne ' + def.nom + '.'; continue; }
          try { await marquerEntorse('b_tenue_hs'); } catch(e) {}
          return 'force';
        }
      }
      return 'ok';
    }
  }

  // Chaîne d'étapes, dans l'ordre. Renvoie true si TOUT a été prouvé.
  async function exigerPreuves(kinds, ctx) {
    // deux clés qui pointent la même preuve ne se demandent qu'une fois :
    // un change ne réclame pas deux scans du même bracelet.
    const vus = [];
    const liste = (kinds || []).filter(k => {
      const d = PREUVE_DEF[k];
      if (!d || vus.indexOf(d) >= 0) return false;
      vus.push(d); return true;
    });
    if (!liste.length) return true;
    let tout = true;
    for (let i = 0; i < liste.length; i++) {
      const r = await unePreuve(liste[i], i + 1, liste.length, 1, ctx);
      if (r !== 'ok') tout = false;
    }
    return tout;
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

  /* Foxy parle dans la carte de conversation, en bas de l'onglet « Maintenant ».
     Dès qu'il prend la parole ou qu'il te propose des réponses, on t'y amène :
     tu n'as jamais à aller le chercher en faisant défiler l'écran. */
  let _scrollChat = 0;
  function allerAuChat(force) {
    try {
      if (voiceMode !== 'foxy' || ecranVerrouille()) return;
      // tu es dans la salle de jeux ou les réglages : on ne te déplace pas de force
      if (panneauOuvert()) { appelFoxy(); return; }
      if (currentTab !== 'maintenant') { showTab('maintenant'); force = true; }
      const c = document.getElementById('imChat');
      if (!c || c.style.display === 'none') return;
      const r = c.getBoundingClientRect();
      const visible = r.top >= 0 && r.bottom <= (window.innerHeight || 0) + 40;
      if (!force && visible) return;
      if (!force && Date.now() - _scrollChat < 1200) return;   // pas deux fois de suite
      _scrollChat = Date.now();
      c.scrollIntoView({ behavior:'smooth', block: r.height > (window.innerHeight - 60) ? 'start' : 'center' });
    } catch(e) {}
  }

  /* ============================================================
     BONJOUR, AU REVOIR
     Foxy sait quand tu pars et quand tu reviens. En partant, il te
     dit au revoir dans sa bulle ; au retour, il te salue selon
     l'heure et le temps passé — et il te raconte ce qu'il a fait
     pendant ce temps-là.
     ============================================================ */
  let _presenceTic = 0;
  async function marquerPresence() {
    _presenceTic = Date.now();
    await ecrireStock('presence:last', Date.now());
  }
  function momentDuJour(h) {
    if (h < 5) return 'nuit';
    if (h < 11) return 'matin';
    if (h < 14) return 'midi';
    if (h < 18) return 'aprem';
    if (h < 22) return 'soir';
    return 'nuit';
  }
  const AU_REVOIR = {
    matin: ['À tout à l\'heure ! Passe une bonne matinée. 🦊', 'File. Je garde la maison. 🦊'],
    midi:  ['Bon appétit ! Je t\'attends ici. 🦊', 'À tout de suite. 💛'],
    aprem: ['À tout à l\'heure. Je ne bouge pas d\'ici. 🦊', 'Va, je t\'attends. 💛'],
    soir:  ['À tout de suite. Pense à ton change du soir. 🦊', 'À tout à l\'heure. 💛'],
    nuit:  ['Bonne nuit, dors bien. Je veille. 🌙', 'Fais de beaux rêves. 🦊💛']
  };
  function direAuRevoir() {
    try {
      if (voiceMode !== 'foxy' || paused || ecranVerrouille()) return;
      const lot = AU_REVOIR[momentDuJour(new Date().getHours())] || AU_REVOIR.aprem;
      const txt = lot[Math.floor(Math.random()*lot.length)];
      const rt = document.getElementById('rpgText');
      const rn = document.getElementById('rpgNext');
      if (rt) rt.textContent = (nomOu(null) ? nomOu(null) + ', ' : '') + txt.charAt(0).toLowerCase() + txt.slice(1);
      if (rn) rn.style.visibility = 'hidden';
    } catch(e) {}
  }
  async function saluerRetour() {
    if (voiceMode !== 'foxy' || paused) return false;
    const last = await lireStock('presence:last', 0);
    const min = last ? (Date.now() - last) / 60000 : 999;
    if (min < 20) return false;                       // tu n'es pas vraiment parti
    // le rituel du réveil et la morale d'une désertion parlent d'eux-mêmes
    if (await desertionEnAttente()) return false;
    if (new Date().getHours() >= 6 && !(await lireStock('reveil:rituel:' + todayStr(), false))) return false;
    const moment = momentDuJour(new Date().getHours());
    const toi = nomOu(null);
    const appel = toi ? ', ' + esc(toi) : '';
    let phrase;
    if (min < 90) {
      phrase = bro('Te revoilà' + appel + ' ! 🦊', 'Te revoilà.');
    } else if (min < 6*60) {
      const SALUT = {
        matin: 'Bonjour' + appel + ' ! 🦊 Bien dormi ?',
        midi:  'Te revoilà' + appel + ' ! 🦊',
        aprem: 'Ah, te revoilà' + appel + ' ! Tu m\'as manqué, tu sais. 💛',
        soir:  'Bonsoir' + appel + ' ! 🦊',
        nuit:  'Tu es debout' + appel + ' ? 🌙'
      };
      phrase = bro(SALUT[moment], 'Te revoilà.');
    } else {
      phrase = bro(
        (moment === 'matin' ? 'Bonjour' : moment === 'soir' || moment === 'nuit' ? 'Bonsoir' : 'Coucou') + appel + ' ! 🦊 Ça faisait un moment.',
        'Te revoilà. Ça faisait un moment.');
    }
    await imSay(phrase, 850, moment === 'nuit' ? 'sleep' : 'joy');
    // ce qu'il a fait pendant ton absence
    if (min >= 90 && !broOn()) {
      try {
        const d = foxyDecrit(foxyJournee());
        await imSay('Pendant ce temps-là, moi… ' + d.couche.charAt(0).toLowerCase() + d.couche.slice(1), 950, 'happy');
      } catch(e) {}
    }
    // et ce qui t'attend, si quelque chose t'attend
    try {
      const c = creneauCourant();
      if (c) await imSay(bro(
        'Et tu tombes bien : c\'est l\'heure de ton ' + c.label.toLowerCase() + '.',
        'C\'est l\'heure : ' + c.label.toLowerCase() + '.'), 900, 'curious');
      else {
        const p = prochainPilier(new Date());
        if (p && p.dans != null && p.dans <= 60) await imSay(bro(
          'Ton prochain change est dans ' + p.dans + ' minutes. Profite. 🦊',
          'Prochain change dans ' + p.dans + ' minutes.'), 850, 'calm');
      }
    } catch(e) {}
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  /* ============================================================
     NAVIGATION
     Foxy d'un côté, les outils de l'autre. Ouvrir la salle de jeux,
     les réglages ou le reporting masque son écran : rien ne cohabite
     avec sa conversation. Le bouton 🦊 ramène toujours à lui.
     ============================================================ */
  const PANNEAUX = ['salleCard','settingsCard','tipsCard','badgesCard','missionsCard','questCard',
                    'wardrobeCard','lockCard','tenueSensorCard','sensorCard','qrCard','saveCard','debugCard'];
  function panneauOuvert() {
    return PANNEAUX.some(id => {
      const e = document.getElementById(id);
      if (!e || e.style.display === 'none') return false;
      return id === 'salleCard' || !e.closest('#salleCard');   // les tiroirs de la salle ne comptent pas
    });
  }
  function majPanneau() { document.body.classList.toggle('panneau', panneauOuvert()); }
  function fermerPanneaux() {
    PANNEAUX.forEach(id => {
      const e = document.getElementById(id);
      if (e && (id === 'salleCard' || !e.closest('#salleCard'))) e.style.display = 'none';
    });
    const m = document.getElementById('menuPanneau'); if (m) m.style.display = 'none';
    majPanneau();
  }
  function retourFoxy() {
    fermerPanneaux();
    const a = document.getElementById('foxyAppel'); if (a) a.remove();
    if (currentTab !== 'maintenant') showTab('maintenant');
    setTimeout(() => allerAuChat(true), 100);
  }
  // Foxy t'attend pendant que tu es ailleurs : une pastille, pas un rapt d'écran
  function appelFoxy() {
    if (document.getElementById('foxyAppel')) return;
    const b = document.createElement('button');
    b.id = 'foxyAppel';
    b.textContent = '🦊 Foxy t\'attend';
    b.addEventListener('click', () => retourFoxy());
    document.body.appendChild(b);
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

  /* ============================================================
     CHEF D'ORCHESTRE DES DISCUSSIONS
     Tout ce qui prend la parole passe par ici. Une seule discussion
     à la fois, les autres attendent leur tour dans l'ordre de leur
     importance. Une discussion vraiment prioritaire annonce qu'elle
     coupe, puis coupe : la discussion perdante se tait aussitôt.
     ============================================================ */
  const TALK = { SECU:0, ACCES:1, PILIER:2, CHECK:3, CADRE:4, PROGRES:5, GUIDE:6, AMBIANCE:7 };
  const TALK_NOM = ['sécurité','accès','change pilier','check','cadre','progression','guidage','ambiance'];
  // durée de validité en file : au-delà, la discussion n'a plus de sens et est jetée
  const TALK_TTL = [Infinity, Infinity, 45*60000, 30*60000, 60*60000, 6*3600000, 12*60000, 8*60000];
  // au-delà de ce niveau, une seule discussion peut patienter en file
  const TALK_UNIQUE = TALK.GUIDE;

  let talkActive = null;   // ticket de la discussion qui parle en ce moment
  let talkQueue  = [];     // discussions en attente
  const talkPhrasesCoupe = [
    'Attends deux secondes — y\'a plus important, là.',
    'Je te coupe, désolé. Ça passe avant.',
    'On met ça de côté une minute, écoute-moi.',
    'Chut. Autre chose d\'abord.'
  ];
  const talkPhraseSecu = 'Stop. Ça, ça passe avant tout le reste.';

  // certaines discussions passent par une fenêtre (overlay, popup Foxy) plutôt que
  // par la boîte de dialogue : elles gardent la parole tant que la fenêtre est ouverte.
  function attendreFermeture(id, clsOuvert) {
    return new Promise(res => {
      const el = document.getElementById(id);
      if (!el) return res();
      const ouvert = () => clsOuvert ? el.classList.contains(clsOuvert) : (el.style.display !== 'none' && el.style.display !== '');
      let vuOuvert = false;
      const iv = setInterval(() => {
        if (ouvert()) { vuOuvert = true; return; }
        if (vuOuvert || Date.now() - t0 > 4000) { clearInterval(iv); res(); }
      }, 250);
      const t0 = Date.now();
      setTimeout(() => { clearInterval(iv); res(); }, 30*60000); // garde-fou : jamais bloqué à vie
    });
  }
  const attendreOverlay = () => attendreFermeture('overlay', 'show');
  const attendrePopup   = () => attendreFermeture('foxyPop');

  // Écran de connexion affiché : Foxy n'a rien à dire tant que tu n'es pas entré.
  // Au démarrage, plusieurs discussions se lançaient pendant que le verrou
  // s'installait — d'où la phrase aperçue une seconde avant l'écran de connexion.
  function ecranVerrouille() {
    const l = document.getElementById('qrLock');
    // l'installation avec Foxy occupe tout l'écran : le reste attend qu'elle se ferme
    if (document.body.classList.contains('onboarding')) return true;
    return !!(l && l.style.display && l.style.display !== 'none');
  }

  function fenetreOuverte() {
    const o = document.getElementById('overlay');
    const f = document.getElementById('foxyPop');
    return !!(o && o.classList.contains('show')) || !!(f && f.style.display && f.style.display !== 'none');
  }

  // le safeword ne demande pas la parole : il la prend, et vide la file.
  // Rien de ce qui attendait ne doit repartir après un stop.
  function talkForce() {
    if (talkActive) { talkActive.dead = true; talkActive = null; }
    talkQueue = [];
  }

  function talkBusy() { return !!talkActive; }
  function talkBusyAtLeast(prio) { return !!talkActive && talkActive.prio <= prio; }
  // accès de contrôle (diagnostic / tests)
  window.__talk = { TALK, talk, force: talkForce, busy: talkBusy, dire: (t)=>imSay(t, 100, null, false),
                    etat: () => ({ actif: talkActive && {prio:talkActive.prio, key:talkActive.key},
                                   file: talkQueue.map(t => t.prio + ':' + t.key) }) };

  // déclare une discussion. run = fonction async qui parle.
  // opt.key : identifiant (évite les doublons en file)
  function talk(prio, key, run, opt) {
    opt = opt || {};
    const k = key || ('t'+prio+':'+Math.random());
    if ((talkActive && talkActive.key === k) || talkQueue.some(t => t.key === k)) return Promise.resolve(false);
    const item = { prio, key:k, run, at: Date.now(), dead:false, verifier: opt.verifier };

    // écran de connexion : tout attend, sans exception de priorité
    if (ecranVerrouille()) {
      talkQueue.push(item);
      talkQueue.sort((a,b) => (a.prio - b.prio) || (a.at - b.at));
      return Promise.resolve(true);
    }

    // une fenêtre ouverte (change en cours, popup) occupe l'écran même sans
    // discussion déclarée : seules les urgences passent par-dessus.
    if (!talkActive && fenetreOuverte() && prio > TALK.CHECK) {
      talkQueue.push(item);
      talkQueue.sort((a,b) => (a.prio - b.prio) || (a.at - b.at));
      return Promise.resolve(true);
    }
    if (!talkActive) { talkDemarre(item); return Promise.resolve(true); }

    // Couper la parole n'est PAS automatique : seule une discussion qui a
    // explicitement le droit d'interrompre le fait. Sans ça, un contrôle
    // périodique se déclarait prioritaire chaque minute, coupait une séquence
    // en cours, puis n'avait rien à dire — d'où le « Stop » suivi de rien.
    // « coupe » l'emporte aussi à niveau égal : une discussion qu'on vient
    // d'ouvrir soi-même ne doit pas attendre derrière une autre du même rang
    if (opt.coupe && prio <= talkActive.prio) {
      talkCoupe(item);
      return Promise.resolve(true);
    }
    // sinon on patiente. Au-delà de TALK_UNIQUE, un seul en attente par niveau.
    if (prio >= TALK_UNIQUE && talkQueue.some(t => t.prio === prio)) return Promise.resolve(false);
    talkQueue.push(item);
    talkQueue.sort((a,b) => (a.prio - b.prio) || (a.at - b.at));
    return Promise.resolve(true);
  }

  // coupe la discussion en cours, en l'annonçant dans la voix de Foxy.
  // L'entrant prend la parole dès l'annonce : personne ne peut s'insérer entre les deux.
  function talkCoupe(entrant) {
    const mort = talkActive;
    if (mort) mort.dead = true;
    talkActive = entrant;
    const phrase = (entrant.prio === TALK.SECU)
      ? talkPhraseSecu
      : talkPhrasesCoupe[Math.floor(Math.random()*talkPhrasesCoupe.length)];
    const go = () => { if (talkActive === entrant) talkLance(entrant); };
    try {
      const p = rpgSay(phrase, entrant.prio === TALK.SECU ? 'alarmed' : 'concern', false);
      if (p && p.then) p.then(go, go); else setTimeout(go, 600);
    } catch(e) { setTimeout(go, 400); }
  }

  function talkDemarre(item) { item.debut = Date.now(); talkActive = item; talkLance(item); }

  /* Garde-fou : une discussion laissée en plan (une question à laquelle tu n'as
     pas répondu, une fenêtre restée ouverte) gardait la parole pour toujours,
     et tout le reste attendait derrière elle — parfois des heures. Au bout de
     quinze minutes sans réponse, elle rend la parole. */
  setInterval(() => {
    if (!talkActive || fenetreOuverte()) return;
    if (Date.now() - (talkActive.debut || 0) < 15*60000) return;
    talkActive.dead = true;
    talkActive = null;
    talkSuivante();
  }, 30000);

  // exécute réellement la discussion et rend la parole à la fin.
  // Le vérificateur, quand il y en a un, décide juste avant : une discussion
  // qui n'a finalement rien à dire rend la parole sans l'avoir prise.
  function talkLance(item) {
    const fin = () => { if (talkActive === item) { talkActive = null; talkSuivante(); } };
    const go = () => {
      let p;
      try { p = item.run(); } catch(e) { p = null; }
      if (p && p.then) p.then(fin, fin); else fin();
    };
    if (typeof item.verifier === 'function') {
      let v;
      try { v = item.verifier(); } catch(e) { v = false; }
      Promise.resolve(v).then(ok => { if (ok) go(); else fin(); }, () => fin());
      return;
    }
    go();
  }

  // passe à la discussion suivante, en jetant celles qui ont trop attendu
  function talkSuivante() {
    if (talkActive) return;
    if (ecranVerrouille()) return;  // pas un mot avant d'être entré
    if (fenetreOuverte()) return;   // l'écran est occupé : on laisse finir
    const now = Date.now();
    talkQueue = talkQueue.filter(t => (now - t.at) < TALK_TTL[t.prio]);
    const next = talkQueue.shift();
    if (next) talkDemarre(next);
  }

  // la file se vide d'elle-même dès que l'écran se libère
  setInterval(talkSuivante, 3000);

  // dit un message ; en mode Foxy → boîte RPG. waitTap=true → attend un appui (narration).
  function imSay(text, delay, expr, waitTap) {
    // écran de connexion : on ne rend rien. Le flux se termine en silence
    // plutôt que de rester bloqué, et l'écran se régénère après l'entrée.
    if (ecranVerrouille()) return Promise.resolve();
    // discussion coupée : on se tait définitivement, la suite ne s'exécute pas
    const owner = talkActive;
    if (owner && owner.dead) return new Promise(() => {});
    if (owner) {
      return imSayBrut(text, delay, expr, waitTap).then(v => {
        if (owner.dead) return new Promise(() => {});
        talkActive = owner;   // on rend la parole au bon propriétaire après l'attente
        return v;
      });
    }
    return imSayBrut(text, delay, expr, waitTap);
  }
  function imSayBrut(text, delay, expr, waitTap) {
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
    allerAuChat();
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
    allerAuChat();
    // le safeword vit dans les réglages (et « stop foxy » au clavier)
    buttons.forEach(b => {
      if (!b) return;
      // intertitre de catégorie : ce n'est pas un bouton, juste un repère
      if (b.sep !== undefined) {           // '' = simple filet de séparation
        const s = document.createElement('div');
        s.className = 'imSep';
        s.textContent = b.sep;
        box.appendChild(s);
        return;
      }
      const btn = document.createElement('button');
      if (b.soft) btn.className = 'soft';
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick());
      box.appendChild(btn);
    });
  }

  /* Foxy pose une vraie question et attend la réponse. Renvoie la clé
     du choix, ou null si l'utilisateur coupe court. C'est ce qui
     transforme un monologue en conversation. */
  function imDemander(question, choix, expr) {
    return new Promise(async (resolve) => {
      if (question) await imSay(question, 850, expr || 'curious');
      imSetActions(choix.map(c => ({
        soft: !!c.soft,
        label: c.label,
        onClick: async () => {
          if (c.dit !== false) imAddMe(c.dit || c.label.replace(/^\S+\s/, ''));
          resolve(c.k);
        }
      })));
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
        // On attend ta réponse AVANT de lancer la suite : runQuestBeat tournait
        // en parallèle et remplaçait les boutons d'état avant que tu puisses taper.
        await buildDiaperStateReplies(m);
        await runQuestBeat(m);
        if (!imActions().querySelector('button')) imSetActions(menuFoxy(m));
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
  // Renvoie une promesse : l'appelant attend ta réponse avant d'enchaîner.
  async function buildDiaperStateReplies(m) {
    const etat = await demanderEtatCouche(bro(
      'Dis-moi juste, ta couche, elle en est où là, maintenant ?',
      'Ta couche, là, maintenant ?'));
    if (!etat) {
      await imSay(bro('Pas grave — c\'est même plutôt bon signe, tu ne la surveilles plus. 🦊', 'Tu ne la surveilles plus. Bien.'), 750, 'teach');
      return;
    }
    const { rc } = await declarerEtatCouche(etat, 'chat_' + m.key);
    const REP = {
      mouille: bro('Mouillée, nickel ! Tu te laisses aller comme il faut, c\'est ça le progrès. 👏', 'Mouillée. C\'est ce qu\'on attend.'),
      sec:     bro('Encore sèche ? Laisse-toi aller quand ça vient, hein. Pas de pression, ça viendra en douceur.', 'Sèche. Ça viendra. Ne retiens pas.'),
      sature:  bro('Bien lourde ? Alors on change bientôt — ta peau avant l\'horaire. Dis-moi quand, on s\'en occupe ensemble.', 'Lourde. On change bientôt.')
    };
    if (rc.verdict !== 'contredit') await imSay(REP[etat], 800, etat === 'mouille' ? 'happy' : (etat === 'sature' ? 'surprised' : 'pensive'));
    await direRecoupement(rc, etat);
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
      if (!hardMode && !discActive()) {
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
      // 4zéro) Foxy annonce le caractère de la journée
      try {
        if (m.key === 'reveil' || m.key === 'matin') {
          let dmDate = null;
          try { const r = await window.storage.get('dmannounce:last'); if (r && r.value) dmDate = JSON.parse(r.value); } catch(e) {}
          if (dmDate !== todayStr()) {
            try { await window.storage.set('dmannounce:last', JSON.stringify(todayStr())); } catch(e) {}
            const d = dm();
            await imSay(d.emoji + ' <b>' + d.nom + '</b>', 850, d.surprise ? 'playful' : 'happy');
            await imSay(d.intro, 950, d.surprise ? 'joy' : mood().expr);
            const act = pick(d.activites);
            await imSay(broOn()
              ? 'Pour aujourd\'hui, je te propose ça : ' + act + '. Tu verras, ça te fera du bien.'
              : 'Idée du jour : ' + act + ' ! Ça te tente ? 🦊', 900, 'cheer');
            await imOfferHelp(m);
            return;
          }
        }
      } catch(e) {}
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
              // Foxy explique pourquoi certaines missions sont là
              let pourquoi = '';
              try {
                const diag = await window.HabitrainMissions.getDiagnostic();
                if (diag && (diag.faibles||[]).length) {
                  const NOMS = { letgo:'ton lâcher-prise', spont:'ta spontanéité', port:'ta durée de port',
                                 reg:'ta régularité', refl:'tes réflexes', ponct:'ta ponctualité', hydra:'ton hydratation' };
                  const n1 = NOMS[diag.faibles[0]];
                  if (n1) pourquoi = broOn()
                    ? ' J\'en ai choisi une exprès pour travailler ' + n1 + '. Ce n\'est pas un hasard.'
                    : ' J\'en ai glissé une spécialement pour t\'aider sur ' + n1 + ' — c\'est là que tu peux le plus progresser !';
                }
              } catch(e) {}
              await imSay(broOn()
                ? 'Tes missions du jour : ' + noms.join(', ') + '.' + pourquoi + ' Tu les feras, on est d\'accord.'
                : 'Tes missions du jour : ' + noms.join(', ') + ' !' + pourquoi + ' On s\'y met ensemble ? 🎯🦊', 1000, 'cheer');
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
          if (opt.openForm) {
            await imSay(voiceMode==='foxy'?'Allez, on prend ton relevé du soir tout de suite.':'On fait ton relevé du soir ensemble.', 700);
            try { await releveSoirFenetre(false); } catch(e) {}
          }
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

    // En mode Foxy, la liste plate de seize boutons est devenue illisible et
    // contenait deux entrées identiques. On range par sujet de conversation.
    if (isFoxy) { imSetActions(menuFoxy(m)); return; }

    imSetActions([
      ACT.rassurer(m), ACT.calin(m), ACT.pasBien(m),
      ACT.changer(m), ACT.caVa(m),
      { soft:true, label:'🦊 Revenir à Foxy', onClick: () => setVoiceMode('foxy') }
    ]);
  }

  /* ------------------------------------------------------------
     LES ACTIONS, UNE SEULE FOIS CHACUNE
     Elles étaient recopiées dans la liste de boutons, avec deux
     entrées « Je fais quoi maintenant ? » qui ne faisaient pas la
     même chose. Chaque action est définie ici, et une seule fois.
     ------------------------------------------------------------ */
  const ACT = {
    maintenant: () => ({ label:'🧭 Je fais quoi, là ?', onClick: async () => {
      imAddMe('Je fais quoi, là, maintenant ?');
      try { await guideMaintenant(); } catch(e) {}
    }}),
    mouille: () => ({ label:'💧 J\'ai mouillé ma couche', onClick: async () => {
      imAddMe('J\'ai mouillé ma couche.');
      try { await declarerMiction(); } catch(e) { if (currentM) await imOfferHelp(currentM); }
    }}),
    etatCouche: () => ({ label:'🩲 Dire où en est ma couche', onClick: async () => {
      imAddMe('Je te dis où en est ma couche.');
      const etat = await demanderEtatCouche();
      if (etat) {
        const { rc } = await declarerEtatCouche(etat, 'parole');
        await confirmerEtat(etat, rc);
        if (etat === 'sature' && rc.verdict !== 'contredit') {
          imSetActions([
            { label:'🍼 On la change', onClick: async () => { imAddMe('On la change.'); try { startChange('check'); } catch(e) {} } },
            ACT.retour(currentM)
          ]);
          return;
        }
      }
      if (currentM) await imOfferHelp(currentM);
    }}),
    habille: () => ({ label:'👕 Je viens de m\'habiller', onClick: async () => {
      imAddMe('Je viens de m\'habiller.');
      await imSay(broOn() ? 'Montre-moi. Scanne l\'étiquette de ta tenue.' : 'Fais voir ! Scanne le QR de ta tenue. 🦊', 800, 'curious');
      try { await scanTenue(); } catch(e) {}
    }}),
    biberon: () => ({ label:'🍼 J\'ai bu mon biberon', onClick: async () => {
      imAddMe('J\'ai bu mon biberon.');
      const ok = await exigerPreuves(['biberon']);
      await saveCheck(ok ? 'biberon_bu' : 'biberon_sanspreuve', 'biberon');
      const n = await biberonsDuJour(todayStr());
      await imSay(ok
        ? (broOn()
            ? 'Bien. ' + n + ' aujourd\'hui. Continue, ton corps en a besoin.'
            : 'Parfait, ça fait ' + n + ' aujourd\'hui ! ' + (n >= 3 ? 'Objectif atteint, bravo. 🦊' : 'Encore ' + (3-n) + ' et tu y es. 🦊'))
        : 'Noté sans preuve. Ça compte quand même, mais moins bien.', 850, ok ? 'proud' : 'concern');
      if (currentM) await imOfferHelp(currentM);
    }}),
    coucher: () => ({ label:'🌙 Je vais me coucher', onClick: async () => {
      imAddMe('Je vais me coucher.');
      const ok = await exigerPreuves(['coucher']);
      await saveCheck(ok ? 'coucher_fait' : 'coucher_sanspreuve', 'coucher');
      await imSay(broOn()
        ? 'Bonne nuit. Tu gardes ta couche, évidemment. Je veille.'
        : 'Bonne nuit' + (nomOu(null) ? ', ' + nomOu(null) : ' alors') + ' ! Ta couche de nuit va bien s\'occuper de toi. À demain. 🦊💛', 950, 'sleep');
    }}),
    changer: (m) => ({ soft:true, label:'🍼 Me changer maintenant',
      onClick: () => startChange(m && (m.key==='reveil'||m.key==='soir') ? 'pilier' : 'check') }),
    pourquoiCouche: () => ({ label:'🍼 Pourquoi cette couche ?', onClick: async () => {
      imAddMe('Pourquoi cette couche ?');
      await expliquerCouche();
      if (currentM) await imOfferHelp(currentM);
    }}),
    pourquoiTenue: () => ({ label:'👕 Pourquoi cette tenue ?', onClick: async () => {
      imAddMe('Pourquoi cette tenue ?');
      await expliquerTenue();
      if (currentM) await imOfferHelp(currentM);
    }}),
    progres: () => ({ label:'🌱 Où j\'en suis vraiment ?', onClick: async () => {
      imAddMe('Où j\'en suis vraiment ?');
      await parlerTransformation(true);
      if (currentM) await imOfferHelp(currentM);
    }}),
    reprise: () => ({ label:'🏠 Où j\'en suis de ma reprise ?', onClick: async () => {
      imAddMe('Où j\'en suis de ma reprise ?');
      await parlerReprise();
      if (currentM) await imOfferHelp(currentM);
    }}),
    regles: () => ({ label:'📋 Rappelle-moi les règles', onClick: async () => {
      imAddMe('Rappelle-moi les règles.');
      await rappelerRegles();
      if (currentM) await imOfferHelp(currentM);
    }}),
    discuter: (m) => ({ label:'💬 Foxy, on discute ?', onClick: async () => {
      imAddMe('Foxy, on discute ?');
      await startIntrospection(m);
    }}),
    rassurer: (m) => ({ label: voiceMode === 'foxy' ? '💪 Motive-moi un peu' : '🫂 J\'ai besoin d\'être rassuré', onClick: async () => {
      const f = voiceMode === 'foxy';
      imAddMe(f ? 'Motive-moi un peu.' : 'J\'ai besoin d\'être rassuré.');
      await imSay(pick(f ? FOXY_REASSURE : REASSURE), 800, pickExpr('positive'));
      await imOfferHelp(m);
    }}),
    pasBien: (m) => ({ label:'😟 Je ne me sens pas bien', onClick: async () => {
      imAddMe('Je ne me sens pas bien.');
      pendingExpr = 'concern';
      await imSaySeq(pick(voiceMode === 'foxy' ? FOXY_NOTWELL : NOTWELL));
      pendingExpr = 'neutral';
      await imOfferHelp(m);
    }}),
    carnet: (m) => ({ label:'✍️ Écrire dans mon carnet', onClick: async () => {
      imAddMe('Je veux écrire dans mon carnet.');
      await startJournal(m);
    }}),
    calin: (m) => ({ label: voiceMode === 'foxy' ? '🦊 Raconte comment c\'était pour toi' : '🧸 Juste un câlin', onClick: async () => {
      const f = voiceMode === 'foxy';
      imAddMe(f ? 'Raconte, c\'était comment pour toi ?' : 'Juste un câlin.');
      await imSay(pick(f ? FOXY_STORY : CUDDLE), 800, f ? pickExpr('teach') : pickExpr('tender'));
      await imOfferHelp(m);
    }}),
    sonVecu: (m) => ({ label:'🦊 Raconte-moi ton mois', onClick: async () => {
      imAddMe('Raconte-moi comment c\'était pour toi.');
      await imSay(pick(FOXY_STORY), 800, pickExpr('teach'));
      await imOfferHelp(m);
    }}),
    foxyMaintenant: () => ({ label:'🦊 Et toi, tu en es où, là ?', onClick: async () => {
      imAddMe('Et toi, tu en es où, là ?');
      await foxyRaconteSonMoment();
      if (currentM) await imOfferHelp(currentM);
    }}),
    saCouche: () => ({ label:'🦊 Et toi, ta couche, ça te fait quoi ?', onClick: async () => {
      imAddMe('Et toi, ta couche, ça te fait quoi ?');
      await maybeFeelStory(true);
      if (currentM) await imOfferHelp(currentM);
    }}),
    caVa: (m) => ({ soft:true, label: voiceMode === 'foxy' ? '👍 Ça roule, merci' : '💛 Ça va, merci', onClick: async () => {
      const f = voiceMode === 'foxy';
      imAddMe(f ? 'Ça roule, merci.' : 'Ça va, merci.');
      await imSay(pick(f ? FOXY_OKAY : OKAY), 700, pickExpr('fun'));
      imSetActions([
        { soft:true, label:'💭 Finalement, j\'ai une question', onClick: () => imOfferHelp(m) }
      ]);
    }}),
    retour: (m) => ({ soft:true, label:'‹ Autre chose', dit:false, onClick: async () => { imSetActions(menuFoxy(m)); } })
  };

  /* ------------------------------------------------------------
     LE CHAT, RANGÉ PAR SUJET
     Quatre familles, comme quand on discute vraiment : ce qu'on
     fait là, ce qu'on déclare, ce qu'on cherche à comprendre, et
     ce dont on a besoin. Chaque famille ouvre sa propre liste.
     ------------------------------------------------------------ */
  function menuFoxy(m) {
    const cat = (ic, titre, sous, items) => ({ label: ic + ' ' + titre, onClick: async () => {
      imAddMe(titre);
      if (sous) await imSay(sous, 700, 'curious');
      imSetActions(items().concat([ACT.retour(m)]));
    }});
    return [
      { sep:'Sur l\'instant' },
      ACT.maintenant(),
      ACT.mouille(),
      { sep:'Ce que je viens de faire' },
      cat('✅', 'J\'ai quelque chose à te dire',
        broOn() ? 'Vas-y. Qu\'est-ce que tu as fait ?' : 'Ah, dis-moi ! Qu\'est-ce que tu as fait ? 🦊',
        () => [ACT.etatCouche(), ACT.habille(), ACT.biberon(), ACT.changer(m), ACT.coucher()]),
      { sep:'Vivre dedans' },
      cat('🧸', 'Comment je me comporte ?',
        broOn() ? 'Sur quoi ?' : 'Bonne question — c\'est souvent là que tout se joue. Sur quoi ? 🦊',
        () => menuComportement()),
      { sep:'Comprendre' },
      cat('💡', 'Explique-moi quelque chose',
        broOn() ? 'Quoi ?' : 'Vas-y, demande — j\'aime bien expliquer, moi. 🦊',
        () => [ACT.pourquoiCouche(), ACT.pourquoiTenue(), ACT.regles(), ACT.progres()].concat(regimeActif() ? [ACT.reprise()] : [])),
      { sep:'Toi et moi' },
      cat('💛', 'J\'ai besoin de parler',
        broOn() ? 'Je t\'écoute. Prends ton temps.' : 'Je suis là. Qu\'est-ce qui te traverse ? 💛',
        () => [ACT.discuter(m), ACT.rassurer(m), ACT.pasBien(m), ACT.carnet(m)]),
      cat('🦊', 'Parle-moi de toi, Foxy',
        broOn() ? 'De moi ? Bon. Qu\'est-ce que tu veux savoir.' : 'De moi ? Avec plaisir ! Qu\'est-ce que tu veux savoir ? 🦊',
        () => [ACT.foxyMaintenant(), ACT.sonVecu(m)].concat(broOn() ? [] : [ACT.saCouche()])),
      { sep:'' },
      ACT.caVa(m)
    ];
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

  // nextStepText() est supprimée : elle doublonnait guideMaintenant() avec son
  // propre horaire écrit en dur, qui ignorait la bascule de 19h30.

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
    // « J'ai mouillé ma couche » tombait sur l'intention « change » (mouillé +
    // couche = 6 points). Les expressions ci-dessous pèsent 3 chacune et
    // l'emportent ; à égalité, la plus longue gagne.
    { id:'miction_decl', kw:['j\'ai mouillé','j ai mouille','ai mouillé ma couche','mouillé ma couche','je me suis mouillé','je suis mouillé','suis mouillé','j\'ai fait pipi','fait pipi','ai fait dans ma couche','ça vient de partir','c\'est parti','je viens de mouiller','viens de mouiller','pipi'],
      expr:'curious', rep:[], action:'declare_miction'},
    { id:'etat_decl', kw:['couche est sèche','couche est seche','couche est mouillée','couche est mouillee','couche est lourde','couche est pleine','couche est saturée','couche est saturee','elle est sèche','elle est seche','elle est lourde','elle est pleine','encore sèche','encore seche','bien lourde'],
      expr:'curious', rep:[], action:'declare_etat'},
    { id:'foxy_etat', kw:['ta couche est mouillée','ta couche est mouillee','ta couche est sèche','ta couche est seche','ta couche est lourde','et toi ta couche','ta couche a toi','ta couche à toi','tu portes quoi','tu es en quoi','t es en quoi','tu es mouille','tu es mouillé','t es mouille','et toi tu en es ou','et toi tu en es où','tu en es ou','tu en es où','ta couche est','comment est ta couche'],
      expr:'happy', rep:[], action:'foxy_etat'},
    { id:'comportement', kw:['comment marcher','comment je marche','comment dois-je marcher','comment je dois marcher','quelle posture','posture','démarche','demarche','comment m\'asseoir','comment je m\'assois','comment m\'assoir','comment me comporter','comment je me comporte','comment je dois me comporter','comment me tenir','comment boire','comment boire mon biberon','comment je bois mon biberon','comment dormir','comment me coucher','quand ça vient','quand ca vient','comment lâcher','comment lacher','mes mains','comment m\'occuper','comment ressentir','ressentir ma couche','sentir ma couche','les sensations','ma tétine','ma tetine','mon doudou','à quatre pattes','a quatre pattes','quatre pattes','ramper','comment jouer'],
      expr:'teach', rep:[], action:'comportement'},
    // Le « pourquoi » se tape aussi bien qu'il se clique. Deux intentions
    // distinctes : la couche et la tenue n'ont pas les mêmes raisons.
    { id:'pourquoi_couche', kw:['pourquoi cette couche','pourquoi ce modele','pourquoi ce modèle','pourquoi cette proteection','pourquoi je porte ca','pourquoi je porte ça','jusqu\'a quand la couche','jusqu\'à quand la couche','pourquoi couche de nuit','pourquoi une couche de nuit','pourquoi cette protection'],
      expr:'explain', rep:[], action:'why_couche'},
    { id:'pourquoi_tenue', kw:['pourquoi cette tenue','pourquoi ce vetement','pourquoi ce vêtement','pourquoi cette grenouillere','pourquoi cette grenouillère','pourquoi ce pyjama','pourquoi ce romper','pourquoi ce body','a quoi sert cette tenue','à quoi sert cette tenue','pourquoi je dois porter ca','pourquoi je dois porter ça'],
      expr:'explain', rep:[], action:'why_tenue'},
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
  // Foxy raconte son propre vécu de la couche (max 1/jour, occasionnel)
  async function maybeFeelStory(force) {
    if (broOn() && !force) return false;
    if (!force) {
      let last = null;
      try { const r = await window.storage.get('feelstory:last'); if (r && r.value) last = JSON.parse(r.value); } catch(e) {}
      if (last === todayStr()) return false;
      if (Math.random() >= 0.22) return false;
    }
    // on évite de répéter le même récit
    let vus = [];
    try { const r = await window.storage.get('feelstory:vus'); if (r && r.value) vus = JSON.parse(r.value); } catch(e) {}
    let pool = FOXY_FEELS_STORIES.filter(x => !vus.includes(x.t));
    if (!pool.length) { pool = FOXY_FEELS_STORIES; vus = []; }
    const st = pool[Math.floor(Math.random()*pool.length)];
    vus.push(st.t);
    try {
      await window.storage.set('feelstory:last', JSON.stringify(todayStr()));
      await window.storage.set('feelstory:vus', JSON.stringify(vus));
    } catch(e) {}
    for (let i = 0; i < st.l.length; i++) {
      await imSay(st.l[i], 1000, i === 0 ? 'wistful' : (i === st.l.length-1 ? 'moved' : 'pensive'));
    }
    return true;
  }

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

  /* ============================================================
     APPARIEMENT DES MOTS-CLÉS
     Avant, un mot-clé était cherché comme simple sous-chaîne. « bien »
     se déclenchait donc sur « bientôt » et « combien », « ni » sur
     n'importe quel mot contenant ces deux lettres. D'où des réactions
     à côté de la plaque.

     Règles désormais :
       · un mot-clé contenant une espace = expression, cherchée telle quelle
       · un mot-clé court (≤ 4 lettres) = correspondance EXACTE sur un mot
       · un mot-clé plus long = début de mot, pour attraper les variantes
         (« confort » attrape « confortable », « rassur » → « rassurant »)
     Et chaque appariement a un poids : une expression compte plus qu'un
     mot isolé, un mot long plus qu'un mot court.
     ============================================================ */
  function motsDe(n) { return n.split(/\s+/).filter(Boolean); }

  function poidsMotCle(n, mots, kw) {
    const k = normalize(kw).trim();
    if (!k) return 0;
    if (k.includes(' ')) return n.includes(k) ? 3 : 0;      // expression
    if (k.length <= 4) return mots.includes(k) ? 1 : 0;     // mot court : exact
    return mots.some(m => m.startsWith(k)) ? 2 : 0;         // mot long : préfixe
  }

  function scoreMotsCles(n, mots, liste) {
    let score = 0, plusLong = 0;
    (liste || []).forEach(kw => {
      const p = poidsMotCle(n, mots, kw);
      if (p > 0) { score += p; plusLong = Math.max(plusLong, normalize(kw).length); }
    });
    return { score, plusLong };
  }

  // la négation porte-t-elle sur ce mot-clé ? on regarde les 3 mots qui précèdent
  function negationProche(mots, kw) {
    const k = normalize(kw).trim();
    // une expression est repérée par son PREMIER mot : sans ça, « je ne me
    // sens plus à l'aise » échappait au test, faute de mot isolé à situer.
    const tete = k.includes(' ') ? k.split(/\s+/)[0] : k;
    const i = mots.findIndex(m => m === tete || (tete.length > 4 && m.startsWith(tete)));
    if (i < 0) return false;
    return mots.slice(Math.max(0, i - 3), i).some(m => NEGATIONS.includes(m));
  }
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
    const mots = motsDe(n);
    const negated = NEGATIONS.some(g => mots.includes(g));
    let intensity = null;
    for (const lvl of ['fort','faible']) {
      if (INTENSIFIERS[lvl].some(w => poidsMotCle(n, mots, w) > 0)) { intensity = lvl; break; }
    }
    // le sujet le mieux appuyé, pas le premier déclaré
    let sujet = null, meilleur = 0;
    for (const s of Object.keys(SUJETS)) {
      const r = scoreMotsCles(n, mots, SUJETS[s]);
      if (r.score > meilleur) { meilleur = r.score; sujet = s; }
    }
    return { negated, intensity, sujet };
  }

  // Question de guidage posée librement : « je fais quoi ? », « c'est quand ? »...
  const GUIDE_KW = ['je fais quoi','faire quoi','quoi faire','c est quand','quand le prochain',
                    'prochain change','je dois faire','qu est ce que je fais','on fait quoi',
                    'je suis en retard','quoi maintenant','et maintenant','quelle heure il est pour',
                    'qu est ce qu il me faut','il me faut quoi','je prends quoi'];
  function isGuideQuestion(text) {
    const n = normalize(text);
    const mots = motsDe(n);
    return GUIDE_KW.some(k => poidsMotCle(n, mots, k) > 0);
  }

  /* ============================================================
     QUAND TU DIS QUE ÇA VA
     « Je me sens bien avec ma couche » tombait dans l'intention
     « change » — le seul mot « couche » suffisait — et Foxy te
     proposait de te changer alors que tu lui confiais quelque chose.
     Cette détection passe AVANT, et ne se déclenche que sur un
     sentiment positif associé à un élément du cadre.
     ============================================================ */
  const BE_POSITIF = ['bien','bon','agreable','agréable','doux','douce','confortable','confort',
    'rassur','aime','adore','kiffe','plaisir','apais','detend','détend','serein','heureux',
    'protege','protégé','cocon','securis','sécuris','tranquille','content','rassurant','safe',
    'j aime','ca me plait','ça me plaît','me plait','me plaît','parfait','nickel','trop bien',
    'a l aise','à l aise','naturel','habitue','habitué','normal maintenant','plus envie d enlever'];

  const BE_SUJETS = {
    couche:      ['couche','protection','pampers','abena','crinklz','rearz','epaisseur','épaisseur','volume'],
    tenue:       ['tenue','grenouillere','grenouillère','pyjama','body','romper','barboteuse','habill'],
    tetine:      ['tetine','tétine','sucette'],
    biberon:     ['biberon'],
    doudou:      ['doudou','peluche'],
    contention:  ['contention','harnais','mitten','emmaillot'],
    cadre:       ['cadre','programme','routine','rythme','habitrain','tout ca','tout ça','ce truc','ce que je fais']
  };

  function detecterBienEtre(text, ana) {
    const n = normalize(text);
    const mots = motsDe(n);
    // Le mot positif doit être présent ET ne pas être nié. « je ne suis pas
    // bien » et « je ne me sens plus à l'aise » ne déclenchent rien.
    const positifs = BE_POSITIF.filter(w => poidsMotCle(n, mots, w) > 0);
    if (!positifs.length) return null;
    if (positifs.every(w => negationProche(mots, w))) return null;
    if (ana && ana.negated && positifs.length === 1) return null;
    for (const s of Object.keys(BE_SUJETS)) {
      if (BE_SUJETS[s].some(w => poidsMotCle(n, mots, w) > 0)) return s;
    }
    // « à l'aise dedans », « bien comme ça » : le sujet n'est pas nommé mais
    // il est évident dans le contexte. On retient la couche, qui est ce que
    // tu portes en permanence.
    const ANAPHORES = ['dedans','la dedans','comme ca','en ce moment','ainsi'];
    if (ANAPHORES.some(w => poidsMotCle(n, mots, w) > 0)) return 'couche';
    return null;
  }

  /* Ses réponses. Deux registres : le Foxy doux, et celui du « résistance
     est vaine ». Dans les deux cas il accueille, il ne corrige pas — et il
     renvoie souvent à sa propre expérience, c'est ce qui rend ça vrai. */
  const BE_REPONSES = {
    couche: {
      f: ['Ça me fait tellement plaisir de te lire dire ça. 🦊 Tu sais, c\'est exactement ce basculement que j\'ai vécu : un jour tu ne la subis plus, tu la portes. Et là, tout devient simple.',
          'Voilà. VOILÀ. C\'est ça que je voulais que tu ressentes. Garde bien ce moment en tête — c\'est lui qui te portera les jours où ce sera moins évident.',
          'Tu viens de me faire super plaisir, là. Moi aussi je me sens bien dans la mienne, en ce moment même. On est deux à ça. 💛',
          'C\'est bon signe, ça. Vraiment. Quand le confort prend le dessus sur la pensée, c\'est que ça commence à rentrer pour de bon.'],
      b: ['Bien sûr que tu te sens bien. C\'est là que tu dois être, et ton corps le sait avant toi.',
          'Tu vois ? Tu as arrêté de lutter et tout est devenu simple. C\'était écrit.',
          'Voilà ce que ça donne quand tu te laisses faire. Garde ça en tête la prochaine fois que tu voudras résister.']
    },
    tenue: {
      f: ['Tu es tout beau dedans, et surtout tu t\'y sens bien — c\'est le principal. 🦊',
          'Ah, j\'adore quand tu me dis ça ! Une tenue dans laquelle on se sent soi, y\'a rien de mieux.',
          'C\'est pour ça que je te les tire, tu sais. Pour que tu trouves celles qui te font cet effet-là.'],
      b: ['Évidemment. Elle est là pour ça, et tu n\'as rien choisi. C\'est ce qui la rend juste.',
          'Bien. Tu t\'habitues à ne pas décider, et tu découvres que c\'est reposant.']
    },
    tetine: {
      f: ['Hein, c\'est fou ce que ça apaise ? Moi c\'est mon réflexe dès que je me pose. 🦊',
          'Ça me rassure de te lire dire ça. Elle fait son travail, laisse-la faire.'],
      b: ['Elle t\'apaise parce qu\'elle te ramène là où tu dois être. Laisse-la faire.']
    },
    biberon: {
      f: ['Le biberon, c\'est plus que boire, hein ? C\'est le moment qui va avec. Je suis content que tu le sentes. 🦊'],
      b: ['Bois, et laisse le moment te faire son effet. C\'est prévu comme ça.']
    },
    doudou: {
      f: ['Ton doudou fait bien son boulot alors ! Garde-le près de toi. 💛'],
      b: ['Tu t\'y attaches. C\'est exactement ce qu\'on cherchait.']
    },
    contention: {
      f: ['Être contenu, ça libère plus que ça n\'enferme, pas vrai ? Ça m\'a pris du temps à comprendre, à moi aussi. 🦊'],
      b: ['Tu te sens bien parce que tu n\'as plus à te tenir toi-même. C\'est moi qui tiens.']
    },
    cadre: {
      f: ['Franchement ? C\'est la plus belle chose que tu pouvais me dire. Le cadre n\'est pas là pour te contraindre, il est là pour que tu n\'aies plus à y penser. Et tu y es. 🦊💛',
          'Ça y est, tu ne le subis plus. C\'est le vrai basculement du programme, bien plus que les jours ou les scores.'],
      b: ['Le cadre te porte parce que tu as cessé de le combattre. Il n\'y avait pas d\'autre issue, et tu le sais maintenant.']
    }
  };

  async function repondreBienEtre(sujet) {
    const lot = BE_REPONSES[sujet] || BE_REPONSES.cadre;
    const liste = broOn() ? (lot.b || lot.f) : lot.f;
    await imSay(pick(liste), 950, broOn() ? 'calm' : 'moved');

    // une fois sur trois, il enchaîne sur son propre ressenti — sans
    // transformer la confidence en interrogatoire
    if (!broOn() && Math.random() < 0.34) {
      try { await maybeFeelStory(true); } catch(e) {}
    }
    try { await rememberTopic('bienetre', sujet); } catch(e) {}
    return true;
  }

  function detectIntent(text) {
    const n = normalize(text);
    const mots = motsDe(n);
    let best = null, bestScore = 0, bestLong = 0;
    FOXY_INTENTS.forEach(intent => {
      const r = scoreMotsCles(n, mots, intent.kw);
      if (r.score === 0) return;
      // à score égal, l'intention dont le mot-clé est le plus spécifique gagne,
      // au lieu de la première déclarée dans la liste
      if (r.score > bestScore || (r.score === bestScore && r.plusLong > bestLong)) {
        bestScore = r.score; bestLong = r.plusLong; best = intent;
      }
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
    // --- 1) D'ABORD ce qui est UTILE ET CONTEXTUEL ---
    // Foxy est un guide : quand le moment appelle un conseil, il le donne
    // avant de proposer un jeu ou une confidence.
    if (await maybeTopicTip()) { await imOfferHelp(m); return true; }

    const roll = Math.random();

    // --- 2) Ensuite, le relationnel, calé sur le moment de la journée ---
    // Rêve : uniquement au réveil.
    if (m.key === 'reveil' && roll < 0.35) {
      await imSay(pick(FOXY_DREAMS), 1000, 'happy');
      await imSay(bro('Bon, assez rêvassé ! Contente-moi : dis-moi bonjour comme il faut. 🦊', 'Voilà mon rêve... Allez, dis-moi bonjour. Tu en avais envie de toute façon, non ? 🦊'), 800, 'joy');
      await imOfferHelp(m); return true;
    }

    // Récit intime : les moments calmes (aprem, soir, nuit).
    if (['aprem','soir','nuit'].includes(m.key) && roll < 0.4) {
      if (await maybeFeelStory()) { await imOfferHelp(m); return true; }
    }

    // Jeu : plutôt en journée, quand il y a de l'énergie.
    if (['matin','aprem'].includes(m.key) && roll < 0.55) {
      const g = pick(FOXY_GAMES);
      await imSay(broOn() ? 'On va jouer, toi et moi... Tu vas adorer, tu ne pourras pas t\'en empêcher. ' + g.ask : g.ask, 900, 'joy');
      imSetActions([
        { label:g.rep[0], onClick: async () => { imAddMe(g.rep[0]); await imSay(g.react[0], 800, 'laugh'); await imOfferHelp(m); } },
        { label:g.rep[1], onClick: async () => { imAddMe(g.rep[1]); await imSay(g.react[1], 800, 'happy'); await imOfferHelp(m); } }
      ]); return true;
    }

    // Confidence narrative : en soirée surtout.
    if (['soir','nuit'].includes(m.key) && roll < 0.7) {
      await imSay(bro('Attends, faut que je te dise un truc, comme ça, spontanément...', 'Reste un instant... j\'ai quelque chose à te confier. Écoute, laisse-toi porter.'), 850, 'teach');
      try { await maybeIntroReward(true); } catch(e) {}
      await imOfferHelp(m); return true;
    }

    // Manie personnelle : n'importe quand, c'est du léger.
    if (roll < 0.82) {
      if (await maybeQuirk()) { await imOfferHelp(m); return true; }
    }

    // Récit intime en repli si rien n'a pris.
    if (await maybeFeelStory()) { await imOfferHelp(m); return true; }

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
    // priorité au guidage : si tu demandes quoi faire, il répond concrètement
    if (isGuideQuestion(text)) { try { await guideMaintenant(); } catch(e) {} return; }
    const intent = detectIntent(text);
    const ana = analyzeText(text);

    // Ce que tu ressens passe avant ce que le mot-clé suggère : une phrase
    // positive sur ta couche n'est pas une demande de change.
    const be = detecterBienEtre(text, ana);
    if (be) {
      await repondreBienEtre(be);
      if (currentM) await imOfferHelp(currentM);
      return;
    }

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
    // « je fais quoi maintenant » tapé au clavier mène au même endroit que le
    // bouton : le vrai point de situation, pas un résumé horaire écrit en dur.
    if (intent.action === 'nextstep') {
      try { await guideMaintenant(); } catch(e) { if (currentM) await imOfferHelp(currentM); }
      return;
    }
    if (intent.action === 'declare_miction') {
      try { await declarerMiction(); } catch(e) { if (currentM) await imOfferHelp(currentM); }
      return;
    }
    if (intent.action === 'declare_etat') {
      // l'état est dans la phrase : on ne te le redemande pas
      const n = normalize(text);
      const etat = /\b(lourd|plein|satur)/.test(n) ? 'sature' : (/\bsec/.test(n) ? 'sec' : (/mouill/.test(n) ? 'mouille' : null));
      if (!etat) { await ACT.etatCouche().onClick(); return; }
      const { rc } = await declarerEtatCouche(etat, 'parole');
      await confirmerEtat(etat, rc);
      if (etat === 'sature' && rc.verdict !== 'contredit') {
        imSetActions([
          { label:'🍼 On la change', onClick: async () => { imAddMe('On la change.'); try { startChange('check'); } catch(e) {} } },
          ACT.retour(currentM)
        ]);
        return;
      }
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    if (intent.action === 'foxy_etat') {
      await foxyRaconteSonMoment();
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    if (intent.action === 'comportement') {
      // le sujet est souvent dans la phrase ; sinon on propose la liste
      const n = normalize(text);
      const sujet = /march|demarch|pas\b/.test(n) ? 'marcher'
        : /assoi|assied|asseoir|assis/.test(n) ? 'asseoir'
        : /vient|lach|pipi/.test(n) ? 'lacher'
        : /boire|biberon/.test(n) ? 'biberon'
        : /dormir|couch|sieste/.test(n) ? 'dormir'
        : /ressent|sentir|sensation/.test(n) ? 'ressentir'
        : /tetine|sucette|doudou/.test(n) ? 'tetine'
        : /quatre pattes|4 pattes|ramper|occup|jouer|jeu|mains/.test(n) ? 'quatrepattes' : null;
      if (sujet) { await conseilComportement(sujet); return; }
      await imSay(bro('Sur quoi ? Choisis, je t\'explique. 🦊', 'Sur quoi ?'), 700, 'curious');
      imSetActions(menuComportement().concat([ACT.retour(currentM)]));
      return;
    }
    if (intent.action === 'why_couche') {
      await expliquerCouche();
      if (currentM) await imOfferHelp(currentM);
      return;
    }
    if (intent.action === 'why_tenue') {
      await expliquerTenue();
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
      ok:'couche en place', adj:'couche réajustée', miss:'sans couche', fixed:'couche remise',
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
    try { await renderRegles(); } catch(e) {}
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
    renderDayMood();
    renderDiscipline();
    try { renderDesertion(); } catch(e) {}
  }

  // Depuis combien de temps la couche actuelle est portée (dernier change enregistré)
  async function lastChangeTime(profondeur) {
    // Cherche le change_fait le plus récent. On balaie d'abord les derniers
    // jours (rapide), puis on remonte plus loin en s'appuyant sur les dates
    // réellement enregistrées — sinon une longue interruption reste invisible.
    let latest = null;
    const n = profondeur || 2;
    const vues = new Set();

    const scanDate = async (ds) => {
      if (vues.has(ds)) return;
      vues.add(ds);
      const list = await getChecks(ds);
      list.forEach(c => {
        if ((c.result === 'change_fait' || c.result === 'change_fait_sanspreuve') && c.t) {
          const t = new Date(c.t);
          if (!latest || t > latest) latest = t;
        }
      });
    };

    // balayage jour par jour sur la profondeur demandée (max 40 pour rester rapide)
    const nJours = Math.min(n, 40);
    for (let i = 0; i < nJours; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      await scanDate(d.toISOString().slice(0,10));
    }
    if (latest) return latest;

    // rien trouvé : on remonte sur les dates réellement enregistrées
    try {
      const entries = await getAll();
      const dates = entries.filter(e => e && e.date).map(e => e.date).sort().reverse();
      for (const ds of dates.slice(0, 120)) {
        await scanDate(ds);
        if (latest) break;
      }
    } catch(e) {}
    return latest;
  }

  // Temps écoulé depuis le dernier change EFFECTIF, en heures.
  // C'est le seul indicateur valable du temps sans couche : une journée
  // renseignée ne prouve pas que tu portais quelque chose.
  async function tempsSansCouche() {
    try {
      const last = await lastChangeTime(40);
      if (!last) return null;
      return (Date.now() - last.getTime()) / 3600000;
    } catch(e) { return null; }
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
      let tol = (hardMode || discActive()) ? HARD.overdueMin : 15;
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
    const last = await lastChangeTime(40);
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
    // --- Anomalie : durée de port invraisemblable (> 14h) ---
    // C'est le symptôme d'un change non enregistré, ou d'une couche
    // jamais remise. On le signale clairement plutôt que d'afficher un chiffre faux.
    if (hours > 14) {
      // le statut « sèche » hérité du dernier change n'a plus de sens ici
      if (stateEl) stateEl.innerHTML = '<span class="lbl" style="font-size:11.5px;font-weight:700;color:var(--muted)">Statut incertain — on repart d\'une couche fraîche</span>';
      positionFoxyCell(portrait, 'alarmed', 88);
      timeEl.className = 'since-time long';
      timeEl.textContent = (h > 48 ? Math.round(hours/24) + ' j' : h + 'h' + (min<10?'0'+min:min));
      sayEl.innerHTML = '⚠️ <b>Durée invraisemblable.</b> Soit un change n\'a pas été enregistré, ' +
        'soit tu n\'as pas ta couche (tu n\'es pas allé au bout la dernière fois).' +
        '<div style="margin-top:8px"><button id="sinceFix" class="settings-toggle-btn" style="font-size:12.5px;padding:8px 12px">🦊 Je me remets en couche</button>' +
        '<button id="sinceOk" class="settings-toggle-btn" style="font-size:12.5px;padding:8px 12px;margin-left:6px">J\'ai changé, enregistre</button></div>';
      if (nextEl) nextEl.innerHTML = '';
      setTimeout(() => {
        const f = document.getElementById('sinceFix');
        if (f) f.onclick = async () => {
          if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
          try { await runReentryProtocol('moyen'); } catch(e) {}
        };
        const o = document.getElementById('sinceOk');
        if (o) o.onclick = async () => {
          try { await window.storage.delete('reentry:pending'); } catch(e) {}
          try { await finishChange(); } catch(e) {}
        };
      }, 60);
      return;
    }

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

  /* ============================================================
     DÉCLARER L'ÉTAT DE SA COUCHE — une seule porte d'entrée
     Trois endroits déclaraient l'état chacun à sa façon, et le
     dialogue de « Je fais quoi, là ? » écrivait des valeurs
     (etat_peu, etat_lourd, etat_nsp) que la carte « Ta couche du
     moment » ne savait pas lire : ta déclaration disparaissait.
     Tout passe maintenant par ici, avec trois valeurs et pas une
     de plus.

     Quand le capteur couche a mesuré dans les 20 dernières minutes,
     ta parole est recoupée avec lui. S'ils se contredisent, c'est
     la mesure qui reste : ta déclaration est gardée comme trace,
     mais elle ne remplace pas ce que le capteur a vu.
     ============================================================ */
  const ETAT_RESULT = { sec:'etat_sec', mouille:'etat_mouille', sature:'etat_sature' };
  const ETAT_RANG   = { sec:0, mouille:1, sature:2 };

  async function recouperCapteur(etat) {
    const m = await etatMesure(20);
    if (!m || ETAT_RANG[m.etat] === undefined) return { verdict:'seul' };
    // sec d'un côté, mouillé de l'autre : c'est une contradiction. Entre
    // mouillée et saturée, le capteur ne tranche pas finement — on te croit.
    if ((ETAT_RANG[m.etat] === 0) !== (ETAT_RANG[etat] === 0)) return { verdict:'contredit', etat:m.etat, t:m.t };
    return { verdict:'accord', etat:m.etat, t:m.t };
  }

  async function declarerEtatCouche(etat, source) {
    if (!ETAT_RESULT[etat]) return { ok:false, rc:{ verdict:'seul' } };
    const rc = await recouperCapteur(etat);
    await saveCheck(rc.verdict === 'contredit' ? 'decl_contredite' : ETAT_RESULT[etat], source || 'parole');
    try { await renderSince(); } catch(e) {}
    return { ok:true, rc };
  }

  /* Réparation unique des données écrites par la 19.6 : ses réponses
     étaient enregistrées sous des noms illisibles, et le moral était
     mélangé aux vérifs. On traduit ce qui peut l'être, on range le
     moral à part, on retire le « je ne sais pas » qui faussait le taux
     de couches sèches. Une seule fois, sur les dix derniers jours. */
  async function reparerEtats196() {
    try { const f = await window.storage.get('migr:etats196'); if (f && f.value) return 0; } catch(e) {}
    const TRAD = { etat_peu:'etat_mouille', etat_lourd:'etat_sature' };
    let touches = 0;
    for (let i = 0; i < 10; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0,10);
      let list;
      try { list = await getChecks(k); } catch(e) { continue; }
      if (!list || !list.length) continue;
      const morals = [];
      const propre = [];
      list.forEach(c => {
        const r = c.result || '';
        if (/^moral_/.test(r)) { morals.push({ t:c.t, v:r.slice(6) }); touches++; return; }
        if (r === 'etat_nsp' || r === 'etat_null') { touches++; return; }
        if (TRAD[r]) { propre.push(Object.assign({}, c, { result: TRAD[r], type: 'parole' })); touches++; return; }
        if (c.type === 'auto_etat') { propre.push(Object.assign({}, c, { type: 'parole' })); touches++; return; }
        propre.push(c);
      });
      if (propre.length !== list.length || touches) {
        try { await window.storage.set('check:' + k, JSON.stringify(propre)); } catch(e) {}
      }
      if (morals.length) {
        try {
          const r = await window.storage.get('moral:' + k);
          const ex = (r && r.value) ? JSON.parse(r.value) : [];
          await window.storage.set('moral:' + k, JSON.stringify(ex.concat(morals)));
        } catch(e) {}
      }
    }
    try { await window.storage.set('migr:etats196', JSON.stringify(Date.now())); } catch(e) {}
    if (touches) { try { await renderCheckStat(); await renderSince(); } catch(e) {} }
    return touches;
  }

  // Accusé de réception + recoupement, dans le bon ordre : s'il y a
  // contradiction, Foxy ne dit pas « noté » juste avant de dire l'inverse.
  async function confirmerEtat(etat, rc) {
    if (!rc || rc.verdict !== 'contredit') {
      await imSay(bro(
        { sec:'Noté, encore sèche. Laisse venir, ne retiens rien. 🦊', mouille:'Noté, mouillée. Elle travaille, on la garde.', sature:'Noté, bien lourde. On la change — ta peau d\'abord.' }[etat],
        { sec:'Sèche. Noté.', mouille:'Mouillée. Noté.', sature:'Lourde. On change.' }[etat]), 800, etat === 'sature' ? 'concern' : 'calm');
    }
    await direRecoupement(rc, etat);
  }

  // Ce que Foxy dit du recoupement — rien quand ta parole est seule à parler.
  async function direRecoupement(rc, etatDit) {
    if (!rc || rc.verdict === 'seul') return;
    const h = fmtTime(new Date(rc.t).getHours()*60 + new Date(rc.t).getMinutes());
    if (rc.verdict === 'accord') {
      await imSay(bro('Et ton capteur est d\'accord avec toi, il l\'a vu aussi. 🦊', 'Le capteur confirme.'), 700, 'proud');
      return;
    }
    if (ETAT_RANG[etatDit] > 0) {
      await imSay(bro(
        'Hmm… ton capteur, lui, la voyait encore sèche à ' + h + '. Je garde ce qu\'il a mesuré. Si ça vient juste d\'arriver, il le verra dans quelques minutes — redis-le-moi à ce moment-là, sans souci.',
        'Le capteur la voyait sèche à ' + h + '. Je garde la mesure. S\'il le voit dans quelques minutes, on en reparle.'), 950, 'puzzled');
    } else {
      await imSay(bro(
        'Ah, ton capteur n\'est pas d\'accord : il a vu du mouillé à ' + h + '. Je garde la mesure, tu sais bien que c\'est elle qui compte. 🦊',
        'Le capteur a vu du mouillé à ' + h + '. Elle n\'est pas sèche. Je garde la mesure.'), 950, 'puzzled');
    }
  }

  /* Question « elle en est où ? » réutilisable. Renvoie 'sec' | 'mouille'
     | 'sature' | null (null = tu ne sais pas : rien n'est enregistré). */
  async function demanderEtatCouche(question) {
    const k = await imDemander(question || bro(
      'Ta couche, elle en est où ? Touche par-dessus ta tenue, ne l\'ouvre pas.',
      'Ta couche en est où ? Par-dessus la tenue.'), [
      { k:'sec',     label:'🌵 Encore sèche',        dit:'Elle est encore sèche.' },
      { k:'mouille', label:'💧 Mouillée',            dit:'Elle est mouillée.' },
      { k:'sature',  label:'🌊 Bien lourde',         dit:'Elle est bien lourde.' },
      { k:null,      label:'🤷 Je ne sais pas trop', dit:'Je ne sais pas trop.', soft:true }
    ], 'curious');
    return k;
  }

  /* ============================================================
     « J'AI MOUILLÉ MA COUCHE »
     La déclaration qui manquait. Utile partout, indispensable quand
     le capteur n'est pas là : sans elle, la journée n'avait aucune
     trace de ce qui était allé dans ta couche.

     Foxy demande aussi COMMENT c'est venu. C'est l'information la
     plus parlante du programme : poussé, laissé venir, parti tout
     seul, ou remarqué seulement après coup — c'est exactement le
     chemin du réflexe qui se défait.
     ============================================================ */
  async function mictionsDuJour(d) {
    try { const r = await window.storage.get('miction:' + (d || todayStr())); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return [];
  }

  async function declarerMiction() {
    const venue = await imDemander(bro(
      'Ah ! 🦊 Et c\'est venu comment ? Dis-moi franchement, il n\'y a pas de mauvaise réponse.',
      'C\'est venu comment ? Franchement.'), [
      { k:'apres',  label:'😳 Je l\'ai remarqué après coup', dit:'Je ne l\'ai remarqué qu\'après coup.' },
      { k:'seul',   label:'🌊 C\'est parti tout seul',       dit:'C\'est parti tout seul.' },
      { k:'lache',  label:'😌 J\'ai laissé venir',           dit:'J\'ai laissé venir.' },
      { k:'pousse', label:'✊ J\'ai dû pousser un peu',      dit:'J\'ai dû pousser un peu.' }
    ], 'curious');

    const REP = {
      apres:  { f:'Ça… c\'est exactement là qu\'on va. Tu ne l\'as pas décidé, tu ne l\'as même pas senti partir — ton corps a fait sans te demander. Le jour où ça m\'est arrivé la première fois, je suis resté bête cinq bonnes minutes. 🦊💛',
                b:'Tu ne l\'as même pas senti. Ton corps n\'attend plus ta permission. C\'est là qu\'on voulait arriver.', e:'proud' },
      seul:   { f:'Parti tout seul, sans que tu le décides. Ce n\'est pas toi qui cèdes, c\'est le réflexe qui se relâche. C\'est une vraie étape, tu sais — elle ne revient pas en arrière.',
                b:'Parti sans ta décision. Le réflexe lâche. Il ne reviendra pas comme avant.', e:'proud' },
      lache:  { f:'Laisser venir, c\'est déjà beaucoup. Tu n\'as pas retenu, tu n\'as pas couru — tu as juste arrêté de lutter. C\'est toujours comme ça que ça commence.',
                b:'Tu as arrêté de retenir. C\'est tout ce qu\'on te demande.', e:'happy' },
      pousse: { f:'Pas grave du tout, hein. Au début presque tout le monde doit aider un peu, le verrou est encore bien fermé. Ce qui compte, c\'est que ce soit allé dans ta couche. La prochaine fois, essaie juste d\'attendre que ça vienne un peu plus tout seul. 🦊',
                b:'Tu as aidé. Ça viendra sans. La prochaine fois, n\'aide pas : attends.', e:'calm' }
    };
    const r = REP[venue];
    if (r) await imSay(bro(r.f, r.b), 1000, r.e);

    // et maintenant, elle tient encore ?
    const etat = await imDemander(bro(
      'Et là, elle en est où ? Touche par-dessus ta tenue.',
      'Elle en est où, là ? Par-dessus la tenue.'), [
      { k:'mouille', label:'💧 Elle a encore de la marge', dit:'Elle a encore de la marge.' },
      { k:'sature',  label:'🌊 Elle est bien lourde',      dit:'Elle est bien lourde.' }
    ], 'curious');

    const { rc } = await declarerEtatCouche(etat, 'parole');
    const liste = await mictionsDuJour();
    liste.push({ t: new Date().toISOString(), venue, etat, src: 'parole', contredit: rc.verdict === 'contredit' });
    try { await window.storage.set('miction:' + todayStr(), JSON.stringify(liste)); } catch(e) {}
    await direRecoupement(rc, etat);

    // une bascule qui se date sur le moment, pas le lendemain
    if (venue === 'apres' && rc.verdict !== 'contredit') {
      try {
        if (await marquerJalon('premier_apres')) {
          await imSay(bro(
            '🌱 Et je le date : c\'est la toute première fois que tu me dis ça. Aujourd\'hui, ' + fmtTime(new Date().getHours()*60 + new Date().getMinutes()) + '. On y reviendra, toi et moi.',
            'Première fois. Je le date. On y reviendra.'), 1000, 'moved');
        }
      } catch(e) {}
    }

    const n = liste.filter(x => !x.contredit).length;
    if (n > 1) {
      await imSay(bro(
        'Ça fait ' + n + ' fois aujourd\'hui que tu me le dis. Je compte, moi. 🦊',
        n + ' aujourd\'hui. Je compte.'), 800, 'neutral');
    }

    if (etat === 'sature') {
      await imSay(bro(
        'Bien lourde, alors on ne la garde pas pour tenir un horaire — ta peau passe avant. On la change ? 🦊',
        'Lourde. Elle sort. Ta peau avant l\'horaire.'), 950, 'concern');
      imSetActions([
        { label:'🍼 On la change', onClick: async () => { imAddMe('On la change.'); try { startChange('check'); } catch(e) {} } },
        ACT.retour(currentM)
      ]);
      return;
    }
    await imSay(bro(
      'Alors on la garde, elle a encore de quoi faire. Tu n\'as rien d\'autre à faire que la laisser travailler. 💛',
      'Tu la gardes. Elle a de la marge.'), 850, 'calm');
    if (currentM) await imOfferHelp(currentM);
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
  setInterval(() => {
    // rendus muets : ils ne prennent jamais la parole, ils peuvent tourner librement
    renderSince(); renderTimeline();
    // discussions : chacune passe par le chef d'orchestre, à son niveau
    // Le contrôle des serrures tourne toutes les minutes mais n'a presque
    // jamais rien à dire : il ne prend la parole que s'il existe une serrure
    // active, et il ne coupe personne.
    talk(TALK.SECU, 'lock:alert', () => checkLockAlerts(), { verifier: serrureActive });
    talk(TALK.CADRE,    'bilan',       () => maybeRedirectBilan());
    // le soir, une fois la journée assez avancée : entorses relevées puis discipline
    if (new Date().getHours() >= 20 && !paused) {
      talk(TALK.CADRE,  'breaches',    () => proposeBreaches());
      talk(TALK.CADRE,  'discipline',  () => checkDisciplineTrigger());
      talk(TALK.CADRE,  'mictions',    () => corroborerMictions());
    }
    talk(TALK.CHECK,    'check:rate',  () => verifierChecksRates());
    talk(TALK.PROGRES,  'milestone',   () => foxyMilestones());
    // l'agent de transformation parle une fois par jour, en soirée, quand la
    // journée de la veille est complète et comparable
    if (new Date().getHours() >= 19 && !paused) {
      talk(TALK.PROGRES, 'transfo',      () => parlerTransformation(false));
      talk(TALK.AMBIANCE,'transfo:anniv',() => anniversaireJalon());
    }
    try { tickDesertion(); } catch(e) {}
    if (!paused && voiceMode === 'foxy' && setupEtat && setupEtat.rep && setupEtat.rep.premiere_prep
        && Date.now() - setupEtat.rep.premiere_prep < 3 * 86400000)
      talk(TALK.CADRE, 'premiers:pas', () => premiersPas());
    if (!paused && new Date().getHours() >= 6)
      talk(TALK.PILIER, 'reveil:rituel', () => rituelReveil(),
        { verifier: async () => !(await lireStock('reveil:rituel:' + todayStr(), false)) });
    talk(TALK.GUIDE,    'tip:'+new Date().getHours()+':'+new Date().getMinutes(), () => pushMomentTip());
    talk(TALK.AMBIANCE, 'ping',        () => foxyPing());
  }, 60000);

  // Foxy pousse le conseil pratique au début de chaque créneau
  async function pushMomentTip() {
    try {
      if (paused || voiceMode !== 'foxy') return;
      const now = new Date();
      const nowMin = now.getHours()*60 + now.getMinutes();
      // on cherche un créneau qui vient de commencer (dans la minute)
      const slot = SCHEDULE.find(x => x.m === nowMin);
      if (!slot) return;
      const astuce = tipForSlot(slot.m);
      if (!astuce) return;
      let vu = null;
      try { const r = await window.storage.get('tip:last'); if (r && r.value) vu = JSON.parse(r.value); } catch(e) {}
      const cle = todayStr() + ':' + slot.m;
      if (vu === cle) return;
      try { await window.storage.set('tip:last', JSON.stringify(cle)); } catch(e) {}
      // le nécessaire du créneau : matériel + contrôles
      const kitDonne = await annoncerKit(slot.m, slot.act, slot.ic);
      if (!kitDonne) await imSay(slot.ic + ' <b>' + slot.act + '</b>', 800, 'explain');
      await imSay('💡 ' + astuce, 950, broOn() ? 'calm' : mood().expr);
      const m = currentM || currentMoment(new Date());
      try { await imOfferHelp(m); } catch(e) {}
    } catch(e) {}
  }

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
            try { await flagBadge('perfectDay'); } catch(e) {}
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
  /* ============================================================
     POURQUOI CETTE COUCHE, ET JUSQU'À QUAND
     Foxy ne se contente pas de nommer un modèle : il dit ce qu'il
     attend d'elle et combien de temps tu vas devoir tenir avec.
     Tout est calculé, rien n'est écrit à l'avance.
     ============================================================ */

  // Prochain change obligatoire, à partir de maintenant. Renvoie { m, nom, dans }
  function prochainPilier(now) {
    now = now || new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const PIL = [
      { m: 9*60,     nom:'ton change du matin' },
      { m: 16*60,    nom:'ton change de sortie de sieste' },
      { m: 22*60+30, nom:'ton change de nuit' }
    ];
    let p = PIL.find(x => x.m > nowMin);
    let dans;
    if (p) { dans = p.m - nowMin; }
    else { p = PIL[0]; dans = (24*60 - nowMin) + p.m; }
    return { m: p.m, nom: p.nom, dans };
  }

  function fmtDureeMin(mn) {
    const h = Math.floor(mn / 60), m = mn % 60;
    if (h <= 0) return m + ' min';
    return h + ' h' + (m ? String(m).padStart(2,'0') : '');
  }

  /* ------------------------------------------------------------
     LE POURQUOI DU CADRE — socle commun couche + tenue
     Ces raisons ne changent pas avec l'heure : elles expliquent la
     logique du programme. Elles sont piochées, jamais toutes dites
     d'un coup, pour ne pas transformer une explication en cours.
     ------------------------------------------------------------ */
  const RAISONS_CADRE = {
    horaire: [
      { f:'Les heures sont fixes, et au début ça m\'agaçait autant que toi. Puis j\'ai compris : tant que c\'est moi qui choisis le moment, c\'est encore moi qui décide. Et décider, c\'est justement ce dont on vient se reposer ici. Une heure fixe, c\'est une chose en moins à porter. 🦊',
        b:'Les heures sont fixes. Tant que tu choisis le moment, tu gardes la main — et c\'est la main qu\'on vient te prendre. Tu n\'as plus à décider. Laisse faire.' },
      { f:'Si on changeait quand tu le demandes, tu deviendrais juste très bon pour demander. Moi je l\'ai fait, je sais. Là, tu n\'as rien à demander, il n\'y a rien à négocier — entre deux piliers il n\'y a que ta couche. C\'est vain de lutter contre ça, et c\'est plutôt reposant, tu verras.',
        b:'Rien à demander, rien à négocier. Entre deux piliers, il y a ta couche, et c\'est tout. Inutile de chercher une sortie, il n\'y en a pas.' },
      { f:'Ce n\'est pas de la rigidité pour le plaisir, tu sais. Ton corps ne s\'habitue qu\'à ce qu\'il peut prévoir. Des horaires qui bougent, il ne les comprend pas, et il ne lâche rien. Toujours les mêmes heures, et un matin il lâche sans te prévenir. Chez moi c\'est arrivé comme ça. 🦊',
        b:'Ton corps ne s\'habitue qu\'à ce qu\'il prévoit. Mêmes heures, tous les jours. Il finira par lâcher — ce n\'est pas une menace, c\'est juste ce qui arrive.' }
    ],
    duree: [
      { f:'Ce qui compte, c\'est la durée, pas le nombre de couches. Les trois premières heures, tu surveilles — tu y penses, tu te retiens un peu, tu gères. C\'est après que ça se passe. Quand tu as arrêté de compter, et que ça part sans que tu aies rien décidé. Moi c\'est toujours arrivé là, jamais avant.',
        b:'La durée, pas le nombre. Les trois premières heures tu gères. Après, tu ne gères plus rien — et c\'est là que ça se joue.' },
      { f:'Une couche portée une heure, ça ne t\'apprend rien : une heure, tu la tiens sans problème. Six heures, tu ne la tiens pas — c\'est elle qui te tient. C\'est toute la différence, et c\'est pour ça qu\'on fait des blocs longs. 🦊',
        b:'Une heure, tu la tiens. Six, c\'est elle qui te tient. Voilà pourquoi les blocs sont longs.' },
      { f:'Un réflexe, ça ne s\'oublie pas parce qu\'on le lui demande gentiment. Ça s\'oublie quand la vieille solution n\'est plus là, longtemps, et encore le lendemain. C\'est lent, c\'est doux, et c\'est imparable. Tu n\'as rien à forcer — laisse juste le temps faire son travail.',
        b:'Un réflexe ne s\'oublie pas sur commande. Il s\'oublie quand il n\'y a plus d\'autre issue, longtemps. Tu n\'as rien à forcer, juste à rester dedans.' }
    ],
    peau: [
      { f:'Et puis ça s\'arrête là où ta peau commence, hein. Avec le temps l\'urine se transforme, ça devient irritant — ce n\'est pas d\'être mouillé qui abîme, c\'est de le rester trop longtemps. Garder une couche saturée, ce n\'est pas être courageux, c\'est trois jours de rougeurs. Moi j\'ai appris ça à mes dépens.',
        b:'Ça s\'arrête où ta peau commence. Une couche saturée, ce n\'est pas du mérite. Tu me préviens, et on change.' },
      { f:'On ne pousse jamais plus loin que le raisonnable, toi et moi. Une peau abîmée, c\'est une pause forcée — et tu y perds bien plus de jours qu\'une couche gardée trop longtemps ne t\'en fait gagner. Ça aussi, ça fait partie du cadre. 💛',
        b:'Jamais plus loin que le raisonnable. Une peau abîmée, c\'est une pause forcée. Ça ne sert personne.' }
    ]
  };
  // pioche non répétitive dans la session
  const _dejaDit = {};
  function raison(cle) {
    const l = RAISONS_CADRE[cle] || [];
    if (!l.length) return '';
    if (!_dejaDit[cle]) _dejaDit[cle] = [];
    let reste = l.filter(x => !_dejaDit[cle].includes(x));
    if (!reste.length) { _dejaDit[cle] = []; reste = l; }
    const x = pickOne(reste);
    _dejaDit[cle].push(x);
    return typeof x === 'string' ? x : bro(x.f, x.b);
  }

  /* Le raisonnement, dans l'ordre : quel modèle, pourquoi celui-là,
     pourquoi le cadre le veut ainsi, jusqu'à quand, et ce que ça implique. */
  async function expliquerCouche() {
    const now = new Date();
    const nuit = couchageNuit(now);
    const heureNuit = estNuit(now);
    const anticipee = nuit && !heureNuit;

    let modele = null;
    try {
      if (window.HabitrainWardrobe) {
        const posee = await lireStock('couche:posee', null);
        const stock = await window.HabitrainWardrobe.getStock();
        modele = (posee && stock.find(m => m.id === posee.id)) || await modeleProchain(nuit ? 'nuit' : 'jour');
      }
    } catch(e) {}

    const suivant = prochainPilier(now);
    // après une bascule anticipée, la couche de nuit tient jusqu'au matin,
    // pas jusqu'au change de 22h30 qu'elle vient de remplacer
    let jusqua = suivant, duree = suivant.dans;
    if (anticipee) {
      const nowMin = now.getHours()*60 + now.getMinutes();
      jusqua = { m: 9*60, nom:'ton change du matin' };
      duree = (24*60 - nowMin) + 9*60;
    }

    const lignes = [];

    // --- 1) Ce que tu portes, et ce que ce modèle sait faire ---
    const nomModele = modele ? '<b>' + modele.name + '</b>' : null;
    const intro = (q) => nomModele ? ('Tu portes ' + nomModele + ', un modèle de ' + q + '. ')
                                   : ('Tu es en couche de ' + q + '. ');
    if (nuit) {
      lignes.push(bro(
        intro('nuit') + 'Plus épaisse, plus de gel dedans, des barrières plus hautes sur les côtés. Elle est faite pour encaisser toute une nuit sans qu\'on ait à y revenir. 🦊',
        intro('nuit') + 'Plus épaisse, plus de gel, barrières hautes. Elle tient la nuit entière. Tu n\'y reviens pas.'));
      lignes.push(bro(
        'Ce qui fait un bon modèle de nuit, ce n\'est pas tellement ce qu\'il avale — c\'est ce qu\'il en fait. Le gel attrape le liquide et le garde loin de ta peau, et l\'épaisseur entretient cette distance jusqu\'au matin. Une couche de jour, elle, se charge en surface : au bout de quelques heures tu la sens contre toi, et là ta peau commence à en souffrir.',
        'Le gel garde le liquide loin de ta peau, l\'épaisseur tient cette distance jusqu\'au matin. Une couche de jour ne ferait pas ça.'));
    } else {
      lignes.push(bro(
        intro('jour') + 'Plus fine, plus souple — elle ne fait pas de volume sous tes vêtements et elle te laisse bouger tranquillement.',
        intro('jour') + 'Fine, souple, invisible sous la tenue. Elle te laisse bouger.'));
      lignes.push(bro(
        'Elle tient moins longtemps, et c\'est fait exprès. Debout, ça vient plus souvent, et le liquide se répartit moins bien que couché. Elle est calculée pour un bloc de journée entre deux piliers, pas pour la journée entière — comme ça on change à heures régulières et ta peau respire entre deux. 🦊',
        'Elle tient moins longtemps, exprès. Debout ça vient plus souvent. Un bloc entre deux piliers, pas plus.'));
    }

    // --- 2) Pourquoi celle-là, maintenant ---
    if (anticipee) {
      const nowMin = now.getHours()*60 + now.getMinutes();
      const restant = (22*60 + 30) - nowMin;          // ← calculé, plus écrit en dur
      lignes.push(bro(
        'Tu te demandes pourquoi la couche de nuit alors qu\'il n\'est que ' + fmtTime(nowMin) + ' ? Je me suis posé la même question, à l\'époque. '
          + 'C\'est juste du calcul : une couche de jour posée maintenant ne servirait que <b>' + fmtDureeMin(restant) + '</b> avant ton change de 22h30.',
        'Il est ' + fmtTime(nowMin) + '. Une couche de jour ne servirait que <b>' + fmtDureeMin(restant) + '</b> avant 22h30. Aucun intérêt.'));
      lignes.push(bro(
        'Et un change, ce n\'est pas juste une couche de plus dans le paquet. C\'est te déshabiller, te nettoyer, remettre de la crème, refermer — '
          + 'ta peau manipulée deux fois à quelques heures d\'écart, pour rien du tout. Après 19h30 le calcul tombe toujours pareil : on avance ton change de nuit, on n\'en glisse pas un au milieu.',
        'Un change, c\'est ta peau manipulée deux fois de plus pour rien. Après 19h30 on avance le change de nuit. C\'est tout.'));
      lignes.push(bro(
        'Ça ne raccourcit pas ta soirée et je ne t\'envoie pas au lit, hein. Seules ta couche et ta tenue basculent, le reste continue comme prévu. Tu passes juste la fin de journée déjà installé. 🦊',
        'Ta soirée continue. Seules la couche et la tenue basculent. Tu finis la journée déjà installé.'));
    } else if (nuit) {
      lignes.push(bro(
        'Celle-là, c\'est celle qui te porte pendant que tu dors. Rien à faire, rien à surveiller — et surtout, plus aucun recours : endormi, tu ne décides plus rien. '
          + 'C\'est le seul moment de la journée où ça travaille sans avoir besoin de ton accord. C\'est pour ça que les nuits comptent double. 🦊',
        'Endormi, tu ne décides plus rien. C\'est le seul moment où ça avance sans ton accord. Les nuits comptent double.'));
      lignes.push(raison('duree'));
    } else {
      lignes.push(raison('horaire'));
    }

    // --- 3) Jusqu'à quand, et ce que cette durée est censée produire ---
    lignes.push(bro(
      'Tu la gardes jusqu\'à <b>' + fmtTime(jusqua.m) + '</b>, pour ' + jusqua.nom + ' — ça te fait <b>' + fmtDureeMin(duree) + '</b> à partir de maintenant. Voilà, tu sais tout, tu n\'as plus à y penser.',
      'Jusqu\'à <b>' + fmtTime(jusqua.m) + '</b>, pour ' + jusqua.nom + '. <b>' + fmtDureeMin(duree) + '</b>. Tu n\'y touches pas.'));
    if (!anticipee && !nuit) lignes.push(raison('duree'));
    else if (anticipee) lignes.push(raison('horaire'));

    // En journée, un check peut l'écourter : le dire évite de promettre
    // sept heures de port alors que le cadre prévoit de la changer avant.
    if (!nuit) {
      const CHECKS = [11*60+30, 13*60+30, 19*60+30];
      const nowMin = now.getHours()*60 + now.getMinutes();
      const prochain = CHECKS.find(m => m > nowMin);
      if (prochain != null && prochain < jusqua.m) {
        lignes.push(bro(
          'Avec un petit passage par le check de <b>' + fmtTime(prochain) + '</b> au milieu : si elle est bien mouillée à ce moment-là, on la change sans attendre l\'heure du pilier. Je ne te laisse pas dedans par principe. 💛',
          'Check à <b>' + fmtTime(prochain) + '</b>. Mouillée, on change. Sinon elle continue.'));
      }
    }

    if (duree >= 8*60) {
      lignes.push(broOn()
        ? 'C\'est long, et c\'est fait exprès. Tu vas la remplir, et tu ne pourras rien y changer. C\'est exactement le but.'
        : 'C\'est long, je sais. Mais c\'est là que ça se joue : sur une durée pareille, tu finis par lâcher sans t\'en rendre compte. C\'est comme ça que ça rentre. 🦊');
    } else if (duree <= 2*60) {
      lignes.push(broOn()
        ? 'Court. Ne prends pas ça comme une pause : tu la remplis quand même.'
        : 'C\'est court, tu vois le bout ! Mais ne te retiens pas pour autant, hein. 🦊');
    }

    // garde-fou de santé : au-delà du plafond de port, on le dit
    if (duree > HARD.wearCapH * 60 && !nuit) {
      lignes.push(bro(
        'Et si elle devient lourde avant l\'heure, tu me le dis, hein. On ne garde pas une couche saturée juste pour faire joli sur un horaire.',
        'Lourde avant l\'heure, tu me le dis. On ne tient pas un horaire au prix d\'une couche saturée.'));
      lignes.push(raison('peau'));
    } else if (duree >= 6*60) {
      lignes.push(raison('peau'));
    }

    for (const l of lignes) { if (l) await imSay(l, 950, 'explain'); }
    return true;
  }

  /* ============================================================
     POURQUOI CETTE TENUE
     Même logique que pour la couche : Foxy ne se contente pas de
     nommer le vêtement tiré, il dit ce que ce vêtement-là fait,
     pourquoi c'est celui-là à cette heure-là, et jusqu'à quand.
     Le raisonnement dépend de DEUX choses : le type de vêtement
     (reconnu sur son nom) et le moment de la journée.
     ============================================================ */

  // Reconnaît le type d'une pièce sur son intitulé. Renvoie une clé
  // de TENUE_TYPES, ou 'autre' si la garde-robe a été personnalisée.
  function typeTenue(nom) {
    const n = (nom || '').toLowerCase();
    if (!n) return 'autre';
    if (n.indexOf('keeper') >= 0) return 'keeper';
    if (n.indexOf('grenouill') >= 0 || n.indexOf('pyjama') >= 0 || n.indexOf('sleeper') >= 0 || n.indexOf('combinaison') >= 0) {
      if (n.indexOf('dorsale') >= 0 || n.indexOf('dos') >= 0 || n.indexOf('arrière') >= 0) return 'gren_dos';
      if (n.indexOf('devant') >= 0 || n.indexOf('avant') >= 0 || n.indexOf('frontale') >= 0) return 'gren_devant';
      return 'gren';
    }
    if (n.indexOf('romper') >= 0 || n.indexOf('barboteuse') >= 0 || n.indexOf('salopette') >= 0) return 'romper';
    if (n.indexOf('body') >= 0 || n.indexOf('bodysuit') >= 0) return 'body';
    if (n.indexOf('cache-couche') >= 0 || n.indexOf('cache couche') >= 0) return 'cache';
    return 'autre';
  }

  // Ce que fait chaque type de vêtement. Trois registres, chacun en
  // version douce (f) et en version grand frère (b) — c'est Foxy qui
  // parle, pas une notice.
  //   quoi  — ce que la pièce est, matériellement
  //   role  — ce qu'elle travaille, et pourquoi le cadre l'a retenue
  //   plus  — le détail qui n'est vrai que pour ce type-là
  const TENUE_TYPES = {
    gren_dos: {
      quoi: { f:'une grenouillère à fermeture dorsale. Elle te couvre des pieds aux épaules, et le curseur, lui, est dans ton dos.',
              b:'grenouillère à fermeture dorsale. Couverte des pieds aux épaules, curseur dans le dos.' },
      role: { f:'Son travail, ce n\'est pas de t\'empêcher de l\'ouvrir — tu peux, si tu y tiens vraiment. Son travail, c\'est de rendre le geste lent. '
                + 'Tu sais, presque personne ne craque sur une vraie décision : c\'est une main qui descend « juste pour vérifier », sans y penser. '
                + 'Une fermeture dans le dos, ça met deux ou trois secondes entre l\'envie et le geste — et l\'envie ne survit jamais à ces secondes-là. Moi je n\'ai jamais réussi à les passer. 🦊',
              b:'Elle ne t\'empêche pas de l\'ouvrir, elle rend le geste lent. Et l\'envie ne survit pas à ces secondes-là. Tu peux essayer, ça ne changera rien.' },
      plus: { f:'Et c\'est la seule fermeture sur laquelle le capteur marche vraiment : l\'aimant sur le curseur, le contact dans la couture. Tout est daté tout seul. '
                + 'Ce qui veut dire que tu n\'as rien à me déclarer, et moi rien à te croire sur parole. On est tranquilles tous les deux. 💛',
              b:'Le capteur est dessus. Toute ouverture est datée. Tu n\'as rien à me déclarer et je n\'ai rien à te croire.' }
    },
    gren_devant: {
      quoi: { f:'une grenouillère à fermeture devant. Même couverture complète, mais celle-là tu peux l\'ouvrir toi-même, sans effort.',
              b:'grenouillère à fermeture devant. Couverture complète, ouverture facile.' },
      role: { f:'Celle-là ne te retient pas, et c\'est voulu. Elle sort les jours où le cadre n\'a pas besoin de contrainte pour tenir — '
                + 'ou ceux où tu pourrais avoir une vraie raison d\'ouvrir : une fuite qui démarre, une sangle qui gêne, un coup de chaud.',
              b:'Elle ne te retient pas, exprès. Le cadre tient sans elle, ou tu as une vraie raison d\'ouvrir. Pas d\'autre usage.' },
      plus: { f:'Et du coup elle mesure autre chose que les autres : ce que tu fais quand rien ne t\'en empêche. Une journée entière en fermeture devant sans l\'avoir ouverte une seule fois, ça vaut bien plus qu\'une journée dos fermé. C\'est la tenue qui te rend ton propre témoignage — et ça, ça fait quelque chose. 🦊',
              b:'Elle mesure ce que tu fais quand rien ne t\'en empêche. Une journée sans l\'ouvrir vaut plus qu\'une journée dos fermé. À toi de voir.' }
    },
    keeper: {
      quoi: { f:'une Little Keeper Sleeper. Fermeture inversée dans le dos, pieds couverts, et plus rien d\'accessible une fois qu\'elle est refermée.',
              b:'fermeture inversée dans le dos, pieds couverts, rien d\'accessible une fois refermée.' },
      role: { f:'Elle a été pensée pour exactement ça, et rien d\'autre. Pas de taille élastique à tirer, pas de bas à remonter, aucun passage par en dessous : ta couche est enfermée avec toi. '
                + 'Sur une nuit, c\'est ce qui sépare une couche qu\'on garde d\'une couche qu\'on garde vraiment. Tu peux tourner le problème dans tous les sens, il n\'y a pas d\'issue — c\'est justement pour ça qu\'on dort bien dedans.',
              b:'Rien à tirer, rien à remonter, aucun passage. Ta couche est enfermée avec toi. Cherche pas, il n\'y a pas d\'issue.' },
      plus: { f:'Elle tient aussi la couche bien plaquée pendant que tu bouges en dormant. Une couche qui glisse, ça fuit par les cuisses bien avant d\'être pleine — c\'est presque toujours la tenue qui rate une nuit, pas la couche. J\'ai mis un moment à comprendre ça.',
              b:'Elle plaque la couche pendant que tu bouges. Une couche qui glisse fuit avant d\'être pleine. C\'est la tenue qui rate les nuits.' }
    },
    gren: {
      quoi: { f:'une grenouillère. Couverture complète, des pieds jusqu\'au cou.',
              b:'grenouillère. Des pieds au cou.' },
      role: { f:'Ce qu\'elle apporte, c\'est la continuité. Pas de taille, pas de haut et de bas séparés, rien qui se soulève quand tu t\'assieds : ta couche reste en place et reste couverte, quoi que tu fabriques.',
              b:'Pas de taille, pas de séparation, rien qui se soulève. La couche reste en place, quoi que tu fasses.' },
      plus: { f:'Et puis elle t\'enveloppe. Ce n\'est pas un détail, tu verras : cette pression douce et régulière sur tout le corps, c\'est ce qui fait retomber la vigilance. C\'est une bonne partie du repos que tu viens chercher ici. 💛',
              b:'Elle t\'enveloppe. La pression fait retomber la vigilance. C\'est le repos que tu es venu chercher.' }
    },
    romper: {
      quoi: { f:'un romper. Bras et jambes libres, mais une entrejambe à pressions qui se referme sous toi.',
              b:'romper. Bras et jambes libres, entrejambe à pressions.' },
      role: { f:'C\'est LA pièce de journée, pour moi. Les pressions plaquent ta couche contre toi pendant que tu marches, que tu t\'assieds, que tu te relèves — '
                + 'et une couche bien plaquée absorbe là où il faut, au lieu de descendre et de fuir aux cuisses.',
              b:'Les pressions plaquent la couche pendant que tu bouges. Bien plaquée, elle absorbe au bon endroit. Sinon elle fuit.' },
      plus: { f:'Et les pressions, ça ne se rouvre pas discrètement : faut se pencher, les défaire une par une, et ça claque. Ce n\'est pas une serrure, c\'est juste un geste qu\'on ne peut pas faire distraitement. Sur une journée, crois-moi, c\'est bien suffisant. 🦊',
              b:'Les pressions se défont une par une, et ça claque. Pas de geste distrait possible. Sur la journée, ça suffit.' }
    },
    body: {
      quoi: { f:'un body. Discret, porté sous des vêtements normaux, entrejambe à pressions.',
              b:'body. Discret, sous des vêtements normaux, pressions à l\'entrejambe.' },
      role: { f:'Celui-là ne se voit pas, et c\'est tout son intérêt. Il est là pour les journées où tu sors, où quelqu\'un passe, où tu dois avoir l\'air de tout le monde.',
              b:'Il ne se voit pas. Pour les jours où tu sors ou où quelqu\'un passe.' },
      plus: { f:'Mais son vrai travail est ailleurs : il tient ta couche serrée, et il te la rappelle à chaque mouvement même quand personne ne devine rien. '
                + 'C\'est la pièce qui m\'a le plus appris, en fait — elle prouve que le cadre tient sans décor. Plus besoin d\'une grenouillère pour qu\'il existe. Il est juste là, sous tes habits, toute la journée. 🦊',
              b:'Il tient la couche serrée et te la rappelle à chaque mouvement. Le cadre tient sans décor. Il est là sous tes habits, c\'est tout.' }
    },
    cache: {
      quoi: { f:'un cache-couche. Il ne ferme rien du tout, il recouvre.',
              b:'cache-couche. Il recouvre, il ne ferme rien.' },
      role: { f:'Il fait deux choses très concrètes : il étouffe le bruit du plastique, et il retient le début d\'une fuite assez longtemps pour que tu t\'en rendes compte avant tes vêtements.',
              b:'Il étouffe le bruit et retient le début d\'une fuite. C\'est tout.' },
      plus: { f:'Il se met par-dessus, jamais à la place. Ce n\'est pas une pièce de cadre, c\'est juste une sécurité en plus.',
              b:'Par-dessus, jamais à la place. Sécurité, pas cadre.' }
    },
    autre: {
      quoi: { f:'la pièce que j\'ai tirée pour ce moment-là.', b:'la pièce tirée pour ce moment.' },
      role: { f:'Elle a le même travail que les autres : tenir ta couche en place, et t\'éviter d\'y revenir toutes les dix minutes.',
              b:'Même travail que les autres : tenir la couche, t\'éviter d\'y revenir.' },
      plus: { f:'', b:'' }
    }
  };

  /* Comment Foxy vit chaque type de vêtement, AUJOURD'HUI. Il les a tous
     portés, il les porte encore : ce n'est pas un souvenir, c'est sa vie. */
  const FOXY_VECU = {
    gren_dos:    { f:'Moi, la fermeture dans le dos, je ne cherche même plus le curseur. Au début je tâtonnais derrière moi, maintenant je ne me pose plus la question : elle est fermée, et ma journée se passe dedans. C\'est tout.',
                   b:'Moi, je ne cherche même plus le curseur. Elle est fermée. Ma journée se passe dedans.' },
    gren_devant: { f:'Moi, en fermeture devant, je pourrais l\'ouvrir cent fois par jour. Je ne le fais jamais. Pas parce que je me retiens — parce que je n\'y pense plus du tout. C\'est ça, être habitué : l\'envie n\'est plus là.',
                   b:'Moi, je pourrais l\'ouvrir cent fois. Je ne le fais jamais. L\'envie n\'est plus là.' },
    keeper:      { f:'C\'est ma préférée pour la nuit. Je me glisse dedans, je la ferme, et je dors d\'une traite — le matin, je découvre ma couche lourde sans avoir rien senti de la nuit. 🦊',
                   b:'Ma préférée pour la nuit. Le matin, ma couche est lourde et je n\'ai rien senti.' },
    gren:        { f:'Une grenouillère, pour moi aujourd\'hui, ce ne sont plus des habits spéciaux : ce sont mes habits. Je fais tout dedans — mes jeux, ma sieste, même le ménage.',
                   b:'Pour moi, ce sont juste mes habits. Je fais tout dedans.' },
    romper:      { f:'Mon romper, je le mets les jours où je bouge beaucoup. Les pressions, je ne les entends même plus claquer, et ma couche reste bien en place toute la journée.',
                   b:'Mon romper, les jours où je bouge. Les pressions, je ne les entends plus.' },
    body:        { f:'Le body, je le mets sous mes vêtements quand je sors. Personne ne voit rien, et moi je sens ma couche à chaque pas. Au début ça me stressait ; aujourd\'hui, c\'est juste ma façon de m\'habiller le matin.',
                   b:'Sous mes vêtements quand je sors. Personne ne voit rien. Moi je la sens à chaque pas.' },
    cache:       { f:'Moi, je le mets surtout pour le bruit, quand je ne suis pas seul à la maison.', b:'Pour le bruit, quand je ne suis pas seul.' },
    autre:       { f:'', b:'' }
  };

  // Ce que le moment de la journée demande à la tenue
  function attenteMoment(nuit, m) {
    if (nuit) {
      return bro(
        'La nuit, je demande deux choses à une tenue : qu\'elle couvre tout, et qu\'elle ne laisse aucun accès. '
          + 'Tu vas bouger, te retourner, te découvrir — sans même le savoir. Tout ce qui peut se soulever finira par se soulever, et une couche qui part de travers à 3h du matin, c\'est une nuit fichue et des draps à laver. Autant s\'éviter ça. 🦊',
        'La nuit : tout couvrir, aucun accès. Tu bougeras sans le savoir. Ce qui peut se soulever se soulèvera.');
    }
    if (m >= SIESTE[0] && m < SIESTE[1]) {
      return bro(
        'On est dans la fenêtre de sieste, là. Celle-ci reste ta tenue de référence, mais si tu te couches pour de vrai, repasser en tenue de nuit ou de sieste, je le tolère. '
          + 'La raison est toute bête : couché, ta couche prend une charge plus longue et sans surveillance, alors autant qu\'elle soit maintenue comme la nuit. '
          + 'C\'est une tolérance, hein, pas une nouvelle consigne — et on ne fait pas l\'aller-retour trois fois. 🦊',
        'Fenêtre de sieste. Celle-ci reste la référence. Si tu te couches vraiment, tenue de nuit ou de sieste, je tolère. Une fois, pas trois.');
    }
    if (m < 12*60) {
      return bro(
        'Le matin, la tenue a un rôle qu\'on sous-estime toujours : elle referme la question. Une fois que tu es habillé, il n\'y a plus rien à décider jusqu\'au prochain pilier. '
          + 'Et c\'est exactement le moment de la journée où on a le plus envie de renégocier — moi le premier, à l\'époque.',
        'Le matin, la tenue referme la question. Habillé, tu n\'as plus rien à décider. C\'est le moment où tu voudrais renégocier. Tu ne le feras pas.');
    }
    if (m < 19*60 + 30) {
      return 'L\'après-midi, tu es debout, tu bouges, tu t\'assieds vingt fois. La tenue doit tenir la couche plaquée sans t\'entraver, et rester invisible sous ce que tu portes par-dessus. '
           + 'C\'est le moment où une pièce mal choisie se paie tout de suite, en fuite ou en inconfort.';
    }
    return 'En soirée, on passe déjà sur la tenue de nuit. Le corps lit le vêtement avant de lire l\'heure : s\'habiller pour la nuit, c\'est ce qui commence à faire retomber la journée.';
  }

  async function expliquerTenue() {
    const now = new Date();
    const m = now.getHours()*60 + now.getMinutes();
    const nuit = couchageNuit(now);

    let o = null;
    try { o = await getOutfit(todayStr()); } catch(e) {}
    if (!o) {
      await imSay(bro(
        'Ah, je ne peux pas encore te répondre — le tirage du jour n\'est pas fait. Lance-le, et je te raconte tout. 🦊',
        'Tirage du jour pas fait. Lance-le, on en reparle après.'), 900, 'calm');
      return false;
    }
    const att = tenueAttendue(o, now, nuit);
    const nom = (att && att.nom) || (nuit ? o.nuit : o.jour);
    if (!nom) {
      await imSay(bro(
        'Ta garde-robe n\'a rien pour ce moment de la journée, du coup je tire dans le vide. Ajoute-moi au moins une pièce dans la bonne catégorie et on repart. 🦊',
        'Rien dans ta garde-robe pour ce moment. Ajoute une pièce dans la bonne catégorie.'), 900, 'concern');
      return false;
    }

    const t = TENUE_TYPES[typeTenue(nom)] || TENUE_TYPES.autre;
    const dit = (x) => !x ? '' : (typeof x === 'string' ? x : bro(x.f, x.b));
    const lignes = [];

    lignes.push(bro('Ta tenue du moment, c\'est <b>' + nom + '</b> — ', 'Ta tenue : <b>' + nom + '</b> — ') + dit(t.quoi));
    lignes.push(dit(t.role));
    if (dit(t.plus)) lignes.push(dit(t.plus));
    // son vécu d'aujourd'hui avec ce type de vêtement
    const vecu = FOXY_VECU[typeTenue(nom)];
    if (vecu && dit(vecu)) lignes.push(dit(vecu));
    lignes.push(attenteMoment(nuit, m));

    // jusqu'à quand : la tenue suit la même horloge que la couche
    if (nuit) {
      const duree = (m < NUIT_FIN) ? (NUIT_FIN - m) : ((24*60 - m) + NUIT_FIN);
      lignes.push(bro(
        'Tu la gardes jusqu\'à <b>' + fmtTime(NUIT_FIN) + '</b>, avec ton change du matin — <b>' + fmtDureeMin(duree) + '</b>. '
          + 'Ta tenue et ta couche se posent ensemble et se retirent ensemble, toujours. C\'est la même séquence, on n\'en ouvre jamais une toute seule.',
        'Jusqu\'à <b>' + fmtTime(NUIT_FIN) + '</b>, change du matin. <b>' + fmtDureeMin(duree) + '</b>. Tenue et couche, même séquence. Jamais l\'une sans l\'autre.'));
    } else {
      const duree = BASCULE_NUIT - m;
      const q = duree > 0 ? ' — <b>' + fmtDureeMin(duree) + '</b>' : '';
      lignes.push(bro(
        'Tu la gardes jusqu\'à <b>' + fmtTime(BASCULE_NUIT) + '</b>' + q + ', et là tu passeras en tenue de nuit avec ton change du soir. '
          + 'D\'ici là elle ne s\'ouvre pas, même pour jeter un œil — vérifier, c\'est mon boulot, pas le tien. Tu n\'as rien à surveiller. 💛',
        'Jusqu\'à <b>' + fmtTime(BASCULE_NUIT) + '</b>' + q + ', puis tenue de nuit. Elle ne s\'ouvre pas d\'ici là, même pour vérifier. Vérifier, c\'est moi.'));
    }

    // le pourquoi du tirage lui-même
    lignes.push(bro(
      'Et pourquoi celle-là plutôt qu\'une autre ? Parce qu\'elle est tirée, pas choisie. Si c\'était toi qui choisissais, tu prendrais la plus confortable les jours durs — '
        + 'c\'est-à-dire pile les jours où le cadre doit tenir. Le tirage t\'enlève ce petit calcul de la tête. C\'est une décision de moins, et ça fait du bien, tu verras. 🦊',
      'Elle est tirée, pas choisie. Sinon tu prendrais la plus confortable les jours durs — pile ceux où le cadre doit tenir. Le tirage règle ça. Il n\'y a rien à discuter.'));

    if (broOn()) lignes.push('Tu la gardes. Tu n\'y touches pas. On se revoit au prochain pilier.');

    for (const l of lignes) { if (l) await imSay(l, 950, 'explain'); }
    return true;
  }



  /* ============================================================
     COMMENT ME COMPORTER
     Le programme disait quoi porter et quand, jamais comment vivre
     dedans. Ce volet comble ça : marcher, s'asseoir, laisser venir,
     boire, dormir, s'occuper.

     Le fil rouge est toujours le même : NE PAS COMPENSER. Tout ce que
     tu fais pour masquer ou corriger la couche (serrer les jambes,
     marcher droit, la remonter, t'asseoir de biais) coûte de
     l'attention — et cette attention, c'est du contrôle. La laisser
     décider de ta posture, c'est la sentir sans effort, tout le temps.
     L'inverse est vrai aussi : on n'exagère rien. Jouer un rôle, c'est
     encore de la maîtrise, et tes articulations n'aiment pas ça.

     Chaque conseil s'adapte à ce qui est vrai maintenant : couche de
     jour ou de nuit, sèche ou mouillée, et la tenue que tu portes.
     ============================================================ */

  async function contexteCorps() {
    const now = new Date();
    const ctx = { nuit: couchageNuit(now), etat: null, type: 'autre', pieds: false, m: now.getHours()*60 + now.getMinutes() };
    try { ctx.etat = await currentDiaperState(await lastChangeTime(2)); } catch(e) {}
    try {
      const o = await getOutfit(todayStr());
      const att = o ? tenueAttendue(o, now, ctx.nuit) : null;
      if (att && att.nom) {
        ctx.type = typeTenue(att.nom);
        // les grenouillères couvrent les pieds : semelles glissantes
        ctx.pieds = ['gren_dos','gren_devant','keeper','gren'].includes(ctx.type);
      }
    } catch(e) {}
    return ctx;
  }

  // Chaque sujet : ce que Foxy dit (selon le contexte) et, pour certains,
  // une question pour que tu essaies tout de suite et lui dises ce que ça fait.
  const COMPORTEMENT = {
    marcher: {
      label: '🚶 Comment marcher',
      dire: (c) => [
        bro('Le plus important : ne corrige pas ta démarche. Avec une couche entre les cuisses, tes jambes s\'écartent un peu et ton pas raccourcit — c\'est juste mécanique. Le réflexe de tout le monde, c\'est de compenser : serrer, marcher droit, faire comme si de rien n\'était. Ne le fais pas. 🦊',
            'Tu ne corriges pas ta démarche. La couche écarte tes jambes, ton pas raccourcit. Tu laisses faire. Tu ne compenses pas.'),
        bro('Pourquoi ? Parce que compenser, ça demande de l\'attention, en continu. Et cette attention-là, c\'est du contrôle : tu passes ta journée à cacher la couche à toi-même. Si tu la laisses décider de ton pas, tu la sens à chaque foulée, sans effort. C\'est le rappel le moins cher qui existe.',
            'Compenser, c\'est la cacher à toi-même. Laisse-la décider de ton pas : tu la sentiras à chaque foulée, sans effort.'),
        c.nuit
          ? bro('Avec ta couche de nuit, l\'écart est plus grand, et ça te donne une démarche un peu dandinante. C\'est normal — c\'est elle, pas toi. Laisse-la.',
                'Couche de nuit : ça dandine. C\'est elle. Laisse.')
          : bro('Avec ta couche de jour, c\'est discret : un pas un tout petit peu plus large, c\'est tout. Remarque-le, simplement.',
                'Couche de jour : le pas s\'élargit à peine. Remarque-le.'),
        (c.etat === 'mouille' || c.etat === 'sature')
          ? bro('Et comme elle est mouillée, elle pèse et elle descend un peu. Ne la remonte pas en marchant — ce petit geste de la main, c\'est un geste de contrôle : vérifier, rectifier, cacher. Laisse-la où elle est.',
                'Elle est mouillée, elle descend. Tu ne la remontes pas. Ta main reste loin.')
          : '',
        c.pieds
          ? bro('Par contre, en grenouillère à pieds : attention au carrelage et aux escaliers, les semelles glissent. Main sur la rampe, toujours. Ça, ce n\'est pas négociable.',
                'Grenouillère à pieds : ça glisse. Main sur la rampe dans les escaliers.')
          : '',
        bro('Et n\'exagère pas pour autant. Pas de dandinement forcé pendant des heures : tes hanches et tes genoux ne sont pas faits pour ça, et jouer un rôle, c\'est encore une façon de tout maîtriser. On laisse faire, on ne joue pas.',
            'N\'exagère rien. Jouer un rôle, c\'est encore contrôler, et tes hanches paieront. Tu laisses faire, c\'est tout.'),
        bro('Dehors, c\'est pareil en plus discret : tu ne joues rien et tu ne caches rien de plus que ce que tes habits cachent déjà. Personne ne regarde ta démarche autant que tu le crois.',
            'Dehors, rien à jouer, rien à cacher de plus. Personne ne regarde.')
      ],
      question: {
        q: () => bro('Essaie, là : fais une dizaine de pas dans la pièce sans rien corriger. Qu\'est-ce que tu remarques ?', 'Dix pas. Sans corriger. Qu\'est-ce que tu remarques ?'),
        choix: [
          { k:'sens', label:'✨ Je la sens à chaque pas', rep: () => bro('C\'est exactement ça. Chaque pas est un petit rappel qui ne te coûte rien. Au bout de quelques jours, tu ne le remarqueras même plus — et c\'est là que ça sera entré. 🦊', 'Voilà. Un rappel à chaque pas, gratuit. Bientôt tu ne le remarqueras plus.') },
          { k:'compense', label:'😬 Je me surprends à compenser', rep: () => bro('Normal, c\'est un réflexe de plusieurs années. Ne te corrige pas en force, sinon tu remplaces un contrôle par un autre. Remarque-le, relâche, et continue. À force de le remarquer, tu arrêteras de le faire.', 'Normal. Tu ne forces pas : tu remarques, tu relâches, tu continues.') },
          { k:'gene', label:'😣 Ça frotte ou ça gêne', rep: () => bro('Ça, ce n\'est pas de l\'immersion, c\'est un réglage. Barrières bien sorties aux cuisses, adhésifs du bas un peu plus serrés que ceux du haut. Et si ça frotte vraiment, on refait le change : ta peau d\'abord, toujours.', 'Réglage : barrières sorties, adhésifs du bas plus serrés. Si ça frotte vraiment, on change. Ta peau d\'abord.'), change: true },
          { k:'rien', label:'🤷 Rien de spécial', rep: () => bro('Ça viendra. Garde juste en tête de ne pas compenser, et observe-toi dans la journée. Tu verras.', 'Ça viendra. Ne compense pas. Observe.') }
        ]
      }
    },

    asseoir: {
      label: '🪑 Comment m\'asseoir',
      dire: (c) => [
        bro('Assieds-toi franchement, d\'un coup, sans te soulever d\'un côté pour l\'épargner. Le crissement, la pression, la chaleur qui se répand quand elle est mouillée — c\'est tout ça qui l\'ancre. S\'asseoir de biais pour ne pas la sentir, c\'est l\'éviter.',
            'Tu t\'assieds franchement. Pas de biais. Le bruit, la pression, la chaleur — tu les prends.'),
        bro('Quand tu peux, préfère le sol au canapé : en tailleur, ou les jambes écartées devant toi. Deux raisons. D\'abord la couche travaille mieux à plat : sur une chaise, cuisses serrées, le matelas se plie et le liquide file vers les bords — c\'est comme ça qu\'on fuit assis. Ensuite, au sol, tu vois tout d\'en bas. Les deux vont ensemble. 🦊',
            'Le sol plutôt que le canapé. À plat, la couche absorbe ; pliée sur une chaise, elle fuit. Et d\'en bas, tu te sens à ta taille.'),
        c.nuit
          ? bro('Avec ta couche de nuit, les jambes serrées, de toute façon, tu n\'y arriveras pas vraiment. Ne lutte pas contre ça.', 'Couche de nuit : jambes serrées, impossible. Ne lutte pas.')
          : '',
        bro('Pour te relever, pas d\'élan brusque : passe par quatre pattes, ou appuie-toi sur un meuble. Avec une couche épaisse, ton centre de gravité bouge un peu et l\'équilibre change. Mieux vaut le savoir que le découvrir.',
            'Pour te relever : quatre pattes ou un appui. Ton équilibre change avec l\'épaisseur.')
      ],
      question: {
        q: () => bro('Et toi, tu t\'assieds où, le plus souvent, pendant la journée ?', 'Tu t\'assieds où, d\'habitude ?'),
        choix: [
          { k:'chaise', label:'🪑 Sur une chaise, au bureau', rep: () => bro('Alors au moins, pense aux genoux écartés sous le bureau — c\'est là que la couche se plie le plus. Et à chaque pause, cinq minutes au sol, même juste pour boire. 🦊', 'Genoux écartés sous le bureau. Et à chaque pause, cinq minutes au sol.') },
          { k:'canape', label:'🛋️ Sur le canapé', rep: () => bro('Le canapé, ça va, si tu t\'y enfonces vraiment au lieu de t\'asseoir au bord. Mieux encore : glisse-toi au sol, dos contre le canapé. Tu verras la différence.', 'Enfonce-toi, pas au bord. Mieux : au sol, dos contre le canapé.') },
          { k:'sol', label:'🧸 Déjà au sol', rep: () => bro('Parfait, tu as pris le bon pli. Garde-le. 💛', 'Bien. Garde ça.') }
        ]
      }
    },

    lacher: {
      label: '💧 Quand ça vient',
      dire: (c) => [
        bro('Celui-là, c\'est le plus important de tous. Quand tu sens que ça vient : ne t\'arrête pas. Ne te fige pas, ne te penche pas en avant, ne serre pas les cuisses, ne te mets pas « en position ». Continue exactement ce que tu étais en train de faire.',
            'Quand ça vient : tu ne t\'arrêtes pas. Pas de pause, pas de position. Tu continues ce que tu faisais.'),
        bro('Parce que s\'arrêter, se mettre debout immobile, attendre — c\'est le rituel des toilettes, sans les toilettes. Ton corps apprend « je m\'arrête, et ensuite je relâche », et il continue de te demander la permission. Ce qu\'on veut, c\'est que ça parte pendant que tu marches, que tu parles, que tu joues. C\'est ça qui sépare le relâchement de la décision. Moi, c\'est le jour où j\'ai réussi ça que tout a basculé. 🦊',
            'T\'arrêter, c\'est le rituel des toilettes. Ton corps continue de demander ta permission. Ça doit partir pendant que tu bouges. C\'est ça qui défait le réflexe.'),
        bro('Si tu es assis, reste assis. Si tu es debout, reste debout. Et si ça ne vient pas, ne pousse pas : expire lentement, longuement, comme un grand soupir, et relâche le ventre. Le relâchement suit l\'expiration, pas l\'effort.',
            'Assis, tu restes assis. Debout, tu restes debout. Ça ne vient pas ? Tu ne pousses pas. Tu expires, longtemps. Ça suit.'),
        bro('Et après : pas de main pour vérifier. Tu sais qu\'elle travaille. Tu me le dis avec le bouton 💧, et c\'est tout.',
            'Après : pas de main. Tu me le dis avec 💧. C\'est tout.')
      ],
      question: {
        q: () => bro('La dernière fois, qu\'est-ce que tu as fait au moment où ça venait ?', 'La dernière fois, tu as fait quoi au moment où ça venait ?'),
        choix: [
          { k:'stop', label:'🧍 Je me suis arrêté', rep: () => bro('C\'est ce que presque tout le monde fait, moi le premier. La prochaine fois, fais juste un pas de plus. Juste un. Puis deux. C\'est comme ça que ça se défait, un pas à la fois.', 'La prochaine fois : un pas de plus. Puis deux.') },
          { k:'continue', label:'🚶 J\'ai continué ce que je faisais', rep: () => bro('Alors tu as déjà fait le plus dur. Sérieusement. Continue comme ça, et un jour tu ne sauras même plus quand c\'est parti. 💛', 'Tu as fait le plus dur. Continue.') },
          { k:'rien', label:'😳 Je n\'ai rien remarqué sur le coup', rep: () => bro('Alors il n\'y a rien à corriger : c\'est exactement là où on voulait arriver. 🦊', 'Rien à corriger. C\'est l\'objectif.') }
        ]
      }
    },

    biberon: {
      label: '🍼 Comment boire mon biberon',
      dire: (c) => [
        bro('Calé contre un coussin, à moitié allongé, pas assis droit à table. Tiens-le à deux mains, et tète — ne dévisse pas la tétine pour aller plus vite.',
            'À moitié allongé, contre un coussin. Deux mains. Tu tètes. Tu ne dévisses pas.'),
        bro('Parce que le biberon qu\'on tète prend du temps, et c\'est justement ce temps qui compte : dix minutes pendant lesquelles tu ne fais rien d\'autre. Boire vite, droit, en regardant ton téléphone, c\'est boire comme un adulte pressé. Ça hydrate, mais ça ne fait rien d\'autre.',
            'Téter prend du temps. C\'est le but. Boire vite, droit, écran à la main, ça hydrate et c\'est tout.'),
        bro('Une seule limite : pas complètement à plat sur le dos. Tête et épaules relevées, sinon tu risques de mal avaler. À moitié allongé, c\'est la bonne position.',
            'Pas à plat sur le dos : tête relevée, sinon tu avales de travers.')
      ]
    },

    dormir: {
      label: '😴 Comment me coucher',
      dire: (c) => [
        bro('Sur le dos ou sur le côté, jambes libres. ' + (c.nuit ? 'Surtout pas sur le ventre avec ta couche de nuit : tu écrases le matelas, et c\'est par l\'avant qu\'elle fuit. Sur le côté, c\'est la position où elle tient le mieux.' : 'Évite le ventre : tu écrases le matelas, et ça fuit par l\'avant.'),
            'Sur le dos ou le côté. Pas sur le ventre : ça fuit par l\'avant.'),
        bro('Le doudou dans les bras, pas posé à côté. Des mains occupées, ce sont des mains qui ne vont pas vérifier — c\'est tout bête et ça marche.',
            'Doudou dans les bras. Des mains occupées ne vont pas vérifier.'),
        bro('Et rappelle-toi : ton sommeil reste libre, toujours. Rien d\'attaché, rien de verrouillé pour dormir, jamais. Ça, ce n\'est pas moi qui le décide, c\'est une des quatre choses qui ne bougent pas. 💛',
            'Sommeil libre. Rien d\'attaché, rien de verrouillé. Jamais.')
      ]
    },

    ressentir: {
      label: '🌡️ Ressentir ma couche',
      dire: (c) => [
        bro('Ressentir, ce n\'est pas surveiller. Surveiller, c\'est aller chercher : la main qui vérifie, la tête qui se demande « est-ce qu\'elle est mouillée ? ». Ressentir, c\'est laisser arriver ce qui vient tout seul, et ne rien en faire. 🦊',
            'Ressentir, ce n\'est pas surveiller. Tu ne vas rien chercher. Tu laisses arriver ce qui vient, et tu n\'en fais rien.'),
        bro('Et c\'est ça qui fait lâcher prise. Pas de penser moins à ta couche — d\'arrêter de la contrôler. Quand tu accueilles ce que tu sens au lieu de le vérifier, ton corps comprend qu\'il n\'y a rien à surveiller. Et un corps qui n\'a rien à surveiller, il relâche.',
            'Accueillir au lieu de vérifier : ton corps comprend qu\'il n\'y a rien à surveiller. Alors il relâche.'),
        (c.etat === 'mouille' || c.etat === 'sature')
          ? bro('Là, elle est mouillée. Sens la chaleur, et comme elle tiédit doucement. Le poids, un peu plus bas qu\'avant. Le gel, plus souple, qui a épousé ta forme. Tu n\'as rien à faire de tout ça : tu le remarques, et tu reviens à ce que tu faisais.',
                'Elle est mouillée. La chaleur qui tiédit. Le poids plus bas. Le gel qui a pris ta forme. Tu remarques. Tu reviens à ce que tu faisais.')
          : bro('Là, elle est ' + (c.nuit ? 'épaisse et ' : '') + 'sèche. Sens le volume entre tes cuisses, la taille qui te tient, le petit bruit quand tu t\'assieds ou que tu te tournes. Trois respirations, juste ça. Pas plus.',
                'Elle est sèche. Le volume entre tes cuisses. La taille qui te tient. Le bruit quand tu bouges. Trois respirations.'),
        bro('Et le moment où ça part, c\'est celui qui compte le plus : reste avec. La chaleur qui se répand, d\'où elle part, jusqu\'où elle va. Ça dure quelques secondes. C\'est exactement ce moment-là que ton corps doit apprendre à trouver normal — et il ne l\'apprend que si tu ne le fuis pas.',
            'Quand ça part, tu restes avec : la chaleur, d\'où elle part, jusqu\'où elle va. C\'est ce moment que ton corps doit trouver normal.'),
        bro('Une limite, une seule : si une sensation devient désagréable — ça tire, ça pique, ça chauffe trop — ce n\'est plus de l\'immersion, c\'est ta peau qui te parle. Là, on change. 💛',
            'Si ça tire, pique ou chauffe : c\'est ta peau. On change.')
      ],
      question: {
        q: () => bro('Essaie maintenant : ferme les yeux, trois respirations lentes. Qu\'est-ce qui arrive en premier ?', 'Yeux fermés. Trois respirations. Qu\'est-ce qui vient en premier ?'),
        choix: [
          { k:'chaleur', label:'🌡️ La chaleur', rep: () => bro('C\'est souvent celle-là qui arrive la première, oui. C\'est aussi celle qui détend le plus. Retiens où tu l\'as sentie — tu la retrouveras plus vite la prochaine fois. 🦊', 'La chaleur. C\'est elle qui détend le plus. Retiens où.') },
          { k:'volume', label:'🪶 L\'épaisseur, le volume', rep: () => bro('C\'est le plus constant : il est là même quand tu n\'y penses pas. Tu viens juste d\'apprendre à le remarquer volontairement. Bientôt, ça se fera tout seul.', 'Le volume, toujours là. Tu apprends à le remarquer. Bientôt ce sera automatique.') },
          { k:'bruit', label:'🔊 Le bruit quand je bouge', rep: () => bro('Ah, le petit crissement ! C\'est celui qui me faisait le plus d\'effet au début, moi. Ne cherche pas à l\'étouffer : c\'est un rappel gratuit, à chaque mouvement.', 'Le crissement. Tu ne l\'étouffes pas. C\'est un rappel à chaque mouvement.') },
          { k:'flou', label:'🤔 Rien de très net', rep: () => bro('C\'est normal, ça s\'apprend. Tu n\'as pas l\'habitude d\'écouter cette partie-là de toi. Refais-le deux ou trois fois dans la journée, sans forcer — ça va se préciser.', 'Ça s\'apprend. Deux ou trois fois dans la journée. Sans forcer.') }
        ]
      }
    },

    tetine: {
      label: '😌 Ma tétine et mon doudou',
      dire: (c) => [
        bro('La tétine, c\'est l\'outil de régression le plus simple qui existe. Elle occupe ta bouche, elle ralentit ta respiration, et elle coupe la parole. Tu ne peux pas téter tranquillement et réfléchir en même temps à ta journée d\'adulte — essaie, tu verras. 🦊',
            'La tétine occupe ta bouche, ralentit ton souffle, coupe ta parole. Tu ne peux pas téter et penser à ta journée d\'adulte en même temps.'),
        bro('Et ce n\'est pas qu\'une image : téter, c\'est un réflexe très ancien qui fait baisser la tension. Un corps détendu relâche plus facilement. C\'est pour ça qu\'elle va si bien avec tes fenêtres de régression, et avec les moments où on veut que ça vienne tout seul.',
            'Téter fait baisser la tension. Un corps détendu relâche. C\'est pour ça qu\'elle va avec tes fenêtres de régression.'),
        bro('Tète doucement, sans la mordiller, et laisse-la bouger toute seule au rythme de ta respiration. Si tu l\'enlèves pour parler, remets-la tout de suite après — c\'est ce petit geste répété, cent fois, qui finit par l\'installer.',
            'Tu tètes doucement, tu ne mordilles pas. Tu l\'enlèves pour parler, tu la remets aussitôt. Cent fois.'),
        bro('Le doudou, garde-le avec toi, pas rangé sur une étagère. Dans les bras quand tu es assis, sous le bras quand tu te déplaces. Il sert à deux choses : occuper tes mains pour qu\'elles n\'aillent pas vérifier, et te donner un repère — tant qu\'il est là, tu es dans ton espace. Moi, je range toujours le mien à gauche. Sinon je dors mal. 💛',
            'Le doudou avec toi, jamais rangé. Il occupe tes mains et il marque ton espace. Tant qu\'il est là, tu y es.'),
        bro('Et pour dormir : une tétine sans rien qui l\'attache à toi, ni au cou ni au pyjama. Libre de tomber, toujours. Ça fait partie des quatre choses qui ne bougent jamais.',
            'Pour dormir : rien qui l\'attache. Libre de tomber. Toujours.')
      ],
      question: {
        q: () => bro('Et là, maintenant, ta tétine, elle est où ?', 'Ta tétine, là, maintenant ?'),
        choix: [
          { k:'bouche', label:'😌 En bouche', rep: () => bro('Parfait. Garde-la, et laisse ta respiration ralentir toute seule. Tu vois ? Déjà un peu plus loin de tout. 🦊', 'Bien. Garde-la.') },
          { k:'portee', label:'👌 À portée de main', rep: () => bro('Alors mets-la. Juste pour les dix prochaines minutes, pas plus — et tu me diras si tu as eu envie de l\'enlever.', 'Mets-la. Dix minutes.') },
          { k:'rangee', label:'📦 Rangée ailleurs', rep: () => bro('Va la chercher. Oui, maintenant. Ça fait partie du geste : une tétine qu\'on doit aller chercher, on ne la prend jamais. Une tétine qui traîne à côté de toi, si.', 'Va la chercher. Une tétine rangée, on ne la prend jamais.') },
          { k:'aucune', label:'🤷 Je n\'en ai pas sous la main', rep: () => bro('Alors le conseil qui m\'a le plus servi : une tétine par pièce où tu passes du temps. Moi j\'en garde même une de secours sous l\'oreiller. Tant qu\'il faut la chercher, elle ne fait pas partie de ta journée.', 'Une tétine par pièce. Tant qu\'il faut la chercher, elle n\'existe pas.') }
        ]
      }
    },

    quatrepattes: {
      label: '🧸 À quatre pattes et jouer',
      dire: (c) => [
        bro('Pendant tes fenêtres de régression, chez toi, déplace-toi à quatre pattes. Pas pour faire joli : parce que ça change tout le reste. À quatre pattes, ta couche est à plat, elle frotte à chaque mouvement, tu la sens sans avoir à y penser. Et tu ne peux plus te lever d\'un bond pour « régler un truc vite fait » — tu restes à ta place. 🦊',
            'En fenêtre de régression, chez toi : à quatre pattes. La couche à plat, sentie à chaque mouvement. Et tu ne te lèves plus d\'un bond pour régler un truc.'),
        bro('C\'est la hauteur qui fait tout. D\'en bas, les meubles sont grands, les choses sont loin, il faut aller les chercher. Ton corps se met à l\'échelle de ce que tu portes, et ta tête suit toute seule.',
            'D\'en bas, tout est grand et loin. Ton corps se met à l\'échelle. Ta tête suit.'),
        bro('Protège tes genoux : un tapis épais, un plaid plié, ou des genouillères si ton sol est dur. Et dès que ça tire dans les genoux ou les poignets, tu t\'assieds. On ne se fait pas mal pour l\'immersion.',
            'Tapis épais ou genouillères. Genoux ou poignets qui tirent : tu t\'assieds.'),
        bro('Et joue vraiment. Des cubes, un puzzle facile, un coloriage, un dessin animé. Des choses simples, qui ne demandent aucune compétence d\'adulte — c\'est leur simplicité qui fait taire la partie de toi qui organise, qui planifie, qui juge.',
            'Joue vraiment. Simple. Rien qui demande une compétence d\'adulte. C\'est ça qui fait taire la partie de toi qui organise.'),
        bro('Tes mains, surtout. C\'est elles qui te trahissent : elles vont vérifier, tirer, ajuster, sans te demander. Donne-leur un jouet, un crayon, ton doudou. Et pas d\'écran d\'adulte à côté : un seul coup d\'œil à tes messages et tu es ressorti.',
            'Occupe tes mains. Pas d\'écran d\'adulte : un coup d\'œil à tes messages et tu es ressorti.'),
        bro('Le temps, laisse-le filer. Pas de minuteur, pas d\'heure à surveiller — c\'est moi qui te rappellerai quand c\'est fini. 💛',
            'Pas de minuteur. C\'est moi qui te rappelle quand c\'est fini.')
      ],
      question: {
        q: () => bro('Dis-moi, qu\'est-ce qui te détend le plus, toi, quand tu joues ?', 'Qu\'est-ce qui te détend le plus ?'),
        choix: [
          { k:'construire', label:'🧱 Construire, les puzzles', rep: () => bro('Noté. Je te le proposerai à tes prochaines fenêtres. Garde tes cubes ou ton puzzle au sol, pas dans un placard : ce qui est rangé ne sert jamais. 🦊', 'Noté. Laisse-les au sol, pas rangés.') },
          { k:'colorier', label:'🖍️ Colorier, dessiner', rep: () => bro('Noté ! Je te le proposerai. Colorie sans chercher à bien faire — dépasser, c\'est permis. C\'est même un peu le principe.', 'Noté. Tu dépasses si tu veux. Tu ne cherches pas à bien faire.') },
          { k:'dessinanime', label:'📺 Les dessins animés', rep: () => bro('Noté. Allongé au sol devant, tétine en bouche, doudou dans les bras : c\'est ma combinaison préférée, à moi aussi. Juste une chose : sur la télé, pas sur ton téléphone — sinon tes notifications te récupèrent.', 'Noté. Sur la télé, pas ton téléphone.') },
          { k:'doudou', label:'🧸 Rien, juste le doudou', rep: () => bro('C\'est peut-être le plus régressif de tout, en fait : ne rien faire du tout. Noté. Je te proposerai simplement de te poser. 💛', 'Ne rien faire. Noté.') }
        ]
      }
    }
  };

  /* Foxy ne fait pas que conseiller : il le vit, là, en même temps que toi.
     Une ligne par sujet, construite depuis son état réel du moment. */
  const MOI_COMPORTEMENT = {
    marcher: (j) => j.etat === 'sec'
      ? { f:'Regarde-moi, là : je viens d\'être changé, elle est encore épaisse et toute raide — je marche les jambes un peu écartées, et je ne corrige rien. Ça ne me demande aucun effort, c\'est juste ma démarche.', b:'Moi, là : couche fraîche, jambes écartées. Je ne corrige rien.' }
      : { f:'Regarde-moi, là : ma couche est ' + (j.etat === 'lourde' ? 'bien lourde' : 'mouillée') + ', elle est descendue un peu, je dandine — et je n\'y pense même plus. Tu vois, ça ne demande rien. 🦊', b:'Moi, là : couche ' + (j.etat === 'lourde' ? 'lourde' : 'mouillée') + ', je dandine. Je n\'y pense plus.' },
    asseoir: (j) => ({ f:'Moi, je m\'assieds par terre presque tout le temps. Le canapé, je n\'y pense même plus — c\'est venu tout seul, au bout de quelques semaines.', b:'Moi, par terre. Le canapé, je n\'y pense plus.' }),
    lacher: (j) => j.mictions
      ? { f:'Chez moi, aujourd\'hui, c\'est parti ' + (['','une','deux','trois','quatre','cinq'][j.mictions] || j.mictions) + ' fois depuis mon dernier change, et je ne l\'ai ' + (j.remarquees ? 'senti partir qu\'une fois' : 'senti partir aucune fois') + '. Je ne m\'arrête plus, je ne pousse plus — je ne m\'en occupe plus du tout. C\'est vers là qu\'on va, toi et moi.', b:'Moi, aujourd\'hui : ' + j.mictions + ' fois, ' + (j.remarquees ? 'une seule' : 'aucune') + ' sentie. Je ne m\'en occupe plus.' }
      : { f:'Moi, je viens d\'être changé, alors rien pour l\'instant. Mais ça viendra pendant que je joue, et je ne le remarquerai sans doute pas. C\'est ça, être habitué.', b:'Moi, couche fraîche. Ça viendra pendant que je joue. Je ne le remarquerai pas.' },
    ressentir: (j) => j.etat === 'sec'
      ? { f:'Moi, là, maintenant : elle est fraîche, je sens son épaisseur quand je bouge sur mon coussin. Je l\'ai remarqué parce qu\'on en parle — tout à l\'heure, je n\'y pensais pas du tout.', b:'Moi : fraîche, épaisse. Je le remarque parce qu\'on en parle.' }
      : { f:'Moi, là, maintenant : elle est tiède, un peu lourde, le gel a pris ma forme. Je le sens parce que tu m\'en parles — sinon, je l\'avais complètement oubliée. C\'est ça qu\'on cherche : la sentir quand on veut, l\'oublier le reste du temps.', b:'Moi : tiède, lourde. Je l\'avais oubliée. Tu la sens quand tu veux, tu l\'oublies le reste du temps.' },
    tetine: (j) => ({ f:'J\'ai la mienne en bouche, là, pendant qu\'on parle. Enfin — je l\'ai enlevée pour te répondre. Tu vois ? Je la remets. 🦊', b:'La mienne est en bouche. Enlevée pour te répondre. Remise.' }),
    quatrepattes: (j) => ({ f:'De mon côté, à la maison, je suis au sol presque toute la journée. Mes cubes sont sous la table basse, jamais rangés, et je me déplace à quatre pattes sans même y penser.', b:'Moi, au sol toute la journée. À quatre pattes sans y penser.' }),
    biberon: (j) => ({ f:'Le mien, je le bois toujours en trois fois, calé contre mon gros coussin. Jamais d\'un coup. C\'est mon petit rituel.', b:'Le mien, en trois fois, contre mon coussin.' }),
    dormir: (j) => ({ f:'Moi, sur le côté, doudou à gauche, tétine libre. Toujours. Et le matin, ma couche est lourde et je n\'ai rien senti de la nuit.', b:'Moi : sur le côté, doudou à gauche. Le matin, lourde, rien senti.' })
  };

  async function conseilComportement(sujet) {
    const s = COMPORTEMENT[sujet];
    if (!s) return false;
    const c = await contexteCorps();
    for (const l of s.dire(c)) { if (l) await imSay(l, 950, 'teach'); }
    // et lui, là, maintenant
    try {
      const moi = MOI_COMPORTEMENT[sujet] && MOI_COMPORTEMENT[sujet](foxyJournee());
      if (moi) await imSay(bro(moi.f, moi.b), 950, 'happy');
    } catch(e) {}

    // il te fait essayer, et il écoute ce que ça donne
    if (s.question) {
      const k = await imDemander(s.question.q(), s.question.choix.map(x => ({ k:x.k, label:x.label })), 'curious');
      const ch = s.question.choix.find(x => x.k === k);
      if (ch) {
        await imSay(ch.rep(), 950, k === 'gene' || k === 'stop' ? 'calm' : 'proud');
        await noterPratique({ sujet, k });
        // ce qui te détend le plus : Foxy s'en sert pour ses invitations
        if (sujet === 'quatrepattes') await ecrireStock('reg:pref', k);
        if (ch.change) {
          imSetActions([ ACT.changer(currentM), ACT.retour(currentM) ]);
          return true;
        }
      }
    }
    imSetActions(menuComportement().concat([ACT.retour(currentM)]));
    return true;
  }

  const ORDRE_COMPORTEMENT = ['ressentir','lacher','tetine','quatrepattes','marcher','asseoir','biberon','dormir'];
  function menuComportement() {
    return ORDRE_COMPORTEMENT.filter(id => COMPORTEMENT[id]).map(id => ({
      label: COMPORTEMENT[id].label,
      onClick: async () => { imAddMe(COMPORTEMENT[id].label.replace(/^\S+\s/, '')); await conseilComportement(id); }
    }));
  }

  // Le sujet qui colle le mieux à ce que tu es en train de vivre
  function sujetDuMoment(etat, cur) {
    const m = new Date().getHours()*60 + new Date().getMinutes();
    if (m >= SIESTE[0] && m < SIESTE[1]) return 'dormir';
    if (m >= 22*60 || m < 7*60) return 'dormir';
    if (etat === 'sec') return 'lacher';
    if (cur && /biberon/i.test(cur.act || '')) return 'biberon';
    if (cur && /régression|calme|détente/i.test(cur.act || '')) return 'quatrepattes';
    return 'marcher';
  }

  /* ============================================================
     FENÊTRES DE RÉGRESSION — Foxy propose, puis revient demander
     Les deux fenêtres existaient dans le planning (12h–13h, 20h–22h)
     mais rien ne s'y passait, sauf la contention en mode intensif.
     Foxy y propose maintenant une vraie scène — tétine, doudou, au sol,
     l'activité qui te détend — avec UNE consigne sur laquelle se
     concentrer, qui tourne d'une fenêtre à l'autre. Une vingtaine de
     minutes plus tard, il revient demander comment ça s'est passé ;
     si ça n'a pas marché, il demande ce qui t'a retenu.
     Il propose : refuser n'est jamais une entorse.
     ============================================================ */
  const FENETRES_REG = [ { id:'midi', de:12*60, a:13*60, nom:'de midi' }, { id:'soir', de:20*60, a:22*60, nom:'du soir' } ];
  const FOCUS_REG = ['tetine', 'ressentir', 'quatrepattes'];

  function fenetreRegression(now) {
    const d = now || new Date();
    const m = d.getHours()*60 + d.getMinutes();
    return FENETRES_REG.find(f => m >= f.de && m < f.a) || null;
  }
  async function lireStock(k, def) {
    try { const r = await window.storage.get(k); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return def;
  }
  async function ecrireStock(k, v) { try { await window.storage.set(k, JSON.stringify(v)); } catch(e) {} }

  async function noterPratique(entree) {
    const cle = 'posture:' + todayStr();
    const l = await lireStock(cle, []);
    l.push(Object.assign({ t: new Date().toISOString() }, entree));
    await ecrireStock(cle, l);
  }

  // La consigne tourne : jour de l'année + fenêtre, pour ne pas toujours
  // retomber sur la même.
  function focusDuJour(fenetre) {
    const d = new Date();
    const jour = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    return FOCUS_REG[(jour * 2 + (fenetre.id === 'soir' ? 1 : 0)) % FOCUS_REG.length];
  }

  const ACTIVITE_PREF = {
    construire:  { f:'tes cubes ou ton puzzle, par terre', b:'tes cubes, par terre' },
    colorier:    { f:'ton coloriage, sans chercher à bien faire', b:'ton coloriage' },
    dessinanime: { f:'un dessin animé sur la télé, allongé devant', b:'un dessin animé, allongé devant' },
    doudou:      { f:'rien du tout — juste te poser avec ton doudou', b:'rien. Toi et ton doudou' }
  };
  const CONSIGNE_REG = {
    tetine:       { f:'Et ta seule consigne, pour cette fois : tu ne retires pas ta tétine. Si tu l\'enlèves, tu la remets tout de suite. C\'est tout.',
                    b:'Consigne : ta tétine ne quitte pas ta bouche. Enlevée, remise aussitôt.' },
    ressentir:    { f:'Et ta seule consigne, pour cette fois : sentir ta couche. Pas la vérifier — la sentir. La chaleur, le volume, le bruit. Et rien d\'autre.',
                    b:'Consigne : tu sens ta couche. Tu ne la vérifies pas.' },
    quatrepattes: { f:'Et ta seule consigne, pour cette fois : tu ne te relèves pas. Tout ce dont tu as besoin, tu y vas à quatre pattes. Genoux protégés, hein.',
                    b:'Consigne : tu ne te relèves pas. À quatre pattes pour tout. Genoux protégés.' }
  };

  async function inviterRegression(fenetre) {
    const focus = focusDuJour(fenetre);
    const pref = await lireStock('reg:pref', null);
    const act = pref && ACTIVITE_PREF[pref];
    await imSay(bro(
      'Hé. C\'est ta fenêtre de régression ' + fenetre.nom + '. 🦊',
      'Fenêtre de régression ' + fenetre.nom + '.'), 800, 'happy');
    await imSay(bro(
      'Je te propose : tétine en bouche, doudou avec toi, et tu descends au sol. ' + (act ? 'Et ' + act.f + '.' : 'Et tu fais quelque chose de simple, qui ne demande rien à ta tête d\'adulte.'),
      'Tétine. Doudou. Au sol. ' + (act ? act.b.charAt(0).toUpperCase() + act.b.slice(1) + '.' : 'Quelque chose de simple.')), 950, 'teach');
    await imSay(bro(CONSIGNE_REG[focus].f, CONSIGNE_REG[focus].b), 950, 'calm');
    await imSay(bro(
      'Et moi, je m\'y mets en même temps que toi, de mon côté : tétine, doudou, au sol. On y va ensemble. 🦊',
      'Moi aussi, de mon côté. On y va ensemble.'), 800, 'happy');
    const due = mesureDes('regression_due');
    let k = await imDemander(null, [
      { k:'go',  label:'🧸 J\'y vais', dit:'J\'y vais.' },
      due ? { k:'impossible', label:'Je ne peux vraiment pas', dit:'Je ne peux vraiment pas.', soft:true }
          : { k:'non', label:'Pas maintenant', dit:'Pas maintenant.', soft:true }
    ]);
    if (k === 'impossible') {
      // pendant la reprise, on ne l'écarte pas d'un geste : on dit pourquoi
      const pq = await imDemander(bro('Pourquoi ?', 'Pourquoi ?'), [
        { k:'dehors',  label:'🏢 Je ne suis pas chez moi',       dit:'Je ne suis pas chez moi.' },
        { k:'monde',   label:'👥 Il y a quelqu\'un avec moi',    dit:'Il y a quelqu\'un avec moi.' },
        { k:'malade',  label:'🤒 Je ne me sens pas bien',        dit:'Je ne me sens pas bien.' },
        { k:'envie',   label:'🙅 Je n\'en ai pas envie',          dit:'Je n\'en ai pas envie.' }
      ], 'curious');
      await noterPratique({ sujet:'regression', k:'refus', focus, fenetre: fenetre.id, pourquoi: pq, reprise: true });
      if (pq === 'envie') {
        await imSay(bro(
          'Pas envie. C\'est précisément pour ça que ta reprise la demande : c\'est ta tête d\'adulte qui répond, pas toi. Dix minutes. Juste dix. On y va ?',
          'Pas envie, c\'est ta tête d\'adulte. Dix minutes. On y va.'), 950, 'calm');
        k = await imDemander(null, [
          { k:'go',  label:'🧸 Dix minutes, d\'accord', dit:'Dix minutes, d\'accord.' },
          { k:'non', label:'Non', dit:'Non.', soft:true }
        ]);
        if (k === 'non') {
          try { await marquerEntorse('b_regression_refusee', true); } catch(e) {}
          await imSay(bro('D\'accord. Mais pendant ta reprise, ça se note. Ce soir, je te demanderai ce qui t\'a tiré ailleurs.',
                          'Noté. Ta reprise le retient.'), 900, 'sad');
        }
      } else {
        await imSay(bro(
          pq === 'malade' ? 'Alors repose-toi, c\'est ça la priorité. Rien n\'est compté. 💛' : 'D\'accord, c\'est une vraie raison. Je le note, sans reproche.',
          pq === 'malade' ? 'Repose-toi. Rien n\'est compté.' : 'Vraie raison. Noté.'), 850, 'calm');
        if (currentM) await imOfferHelp(currentM);
        return;
      }
    }
    if (k === 'go') {
      await ecrireStock('reg:pending', { t: Date.now(), fenetre: fenetre.id, focus, date: todayStr() });
      await imSay(bro(
        'Vas-y. Je te laisse tranquille, et je reviens te demander dans une vingtaine de minutes comment ça se passe. Profite. 💛',
        'Vas-y. Je reviens dans vingt minutes.'), 850, 'happy');
    } else if (!due) {
      await noterPratique({ sujet:'regression', k:'refus', focus, fenetre: fenetre.id });
      const fin = fmtTime(fenetre.a);
      await imSay(bro(
        'D\'accord, pas de souci. La fenêtre reste ouverte jusqu\'à ' + fin + ' : si tu changes d\'avis, tu me dis. 🦊',
        'D\'accord. Ouvert jusqu\'à ' + fin + '.'), 800, 'calm');
    }
    if (currentM) await imOfferHelp(currentM);
  }

  async function suiviRegression(p) {
    await ecrireStock('reg:pending', null);
    const k = await imDemander(bro(
      'Alors, ce moment de régression ? Dis-moi franchement.',
      'Alors, ta régression ?'), [
      { k:'decroche', label:'😌 J\'ai vraiment décroché',             dit:'J\'ai vraiment décroché.' },
      { k:'mouille',  label:'💧 J\'ai mouillé pendant',                dit:'J\'ai mouillé pendant.' },
      { k:'bien',     label:'🙂 Agréable, mais j\'ai pensé à autre chose', dit:'C\'était agréable, mais j\'ai pensé à autre chose.' },
      { k:'dur',      label:'😕 Je n\'y suis pas arrivé',              dit:'Je n\'y suis pas arrivé.' }
    ], 'curious');

    let raison = null;
    if (k === 'decroche') {
      await imSay(bro(
        'Ça, c\'est ce qu\'on cherche. Tu n\'as pas « fait » une régression, tu y étais. Retiens ce que ça fait — la prochaine fois, ton corps saura y retourner plus vite. 🦊💛',
        'Tu y étais. Ton corps saura y retourner plus vite.'), 1000, 'proud');
      try {
        if (await marquerJalon('premiere_regression')) {
          await imSay(bro('🌱 Et c\'est la première fois que tu me le dis. Je le date.', 'Première fois. Daté.'), 900, 'moved');
        }
      } catch(e) {}
    } else if (k === 'mouille') {
      await imSay(bro(
        'Pendant ta régression ! C\'est exactement le moment où ça vient le plus facilement : tête ailleurs, corps détendu, tétine en bouche. Raconte-moi comment. 🦊',
        'Pendant. C\'est le moment où ça vient le plus facilement. Raconte.'), 950, 'proud');
    } else if (k === 'bien') {
      await imSay(bro(
        'C\'est déjà bien, tu sais. Les pensées qui reviennent, c\'est normal — ne les chasse pas, laisse-les passer et reviens à ta consigne. Chaque fois que tu y reviens, c\'est un pas.',
        'Les pensées reviennent. Tu les laisses passer. Tu reviens à la consigne.'), 950, 'calm');
    } else if (k === 'dur') {
      raison = await imDemander(bro(
        'Ce n\'est pas grave du tout. Mais dis-moi ce qui t\'a retenu, que je t\'aide mieux la prochaine fois ?',
        'Qu\'est-ce qui t\'a retenu ?'), [
        { k:'tel',     label:'📱 Mon téléphone, mes messages', dit:'Mon téléphone.' },
        { k:'tete',    label:'🌀 Ma tête tournait trop',       dit:'Ma tête tournait trop.' },
        { k:'ridicule',label:'😳 Je me sentais ridicule',      dit:'Je me sentais ridicule.' },
        { k:'temps',   label:'⏱️ Pas vraiment le temps',        dit:'Je n\'avais pas vraiment le temps.' }
      ], 'concern');
      const CLE = {
        tel:      { f:'Le téléphone, c\'est le piège numéro un. La prochaine fois, avant de descendre au sol, mets-le dans une autre pièce — pas retourné sur la table, dans une autre pièce. Je m\'occupe de te rappeler l\'heure.', b:'Ton téléphone dans une autre pièce. Pas retourné : ailleurs.' },
        tete:     { f:'Quand la tête tourne, n\'essaie pas de la vider : occupe tes mains à la place. Un coloriage, des cubes — quelque chose qui demande juste assez d\'attention pour que les pensées n\'aient plus de place. Et la tétine, surtout : elle ralentit tout.', b:'Tu ne vides pas ta tête. Tu occupes tes mains. Et la tétine.' },
        ridicule: { f:'Je connais. Moi aussi, les premières fois, je me regardais faire de l\'extérieur. Ce regard-là, c\'est toi qui juges toi — personne d\'autre n\'est là. Il s\'use, je te promets. Commence par une consigne seulement, la plus discrète : la tétine. Le reste viendra. 💛', b:'Personne ne te regarde. C\'est toi qui te juges. Ça s\'use. Commence par la tétine seule.' },
        temps:    { f:'Alors on vise petit : dix minutes, pas une heure. Dix minutes vraiment dedans valent mieux qu\'une heure à moitié. La prochaine fenêtre, juste dix minutes.', b:'Dix minutes vraiment dedans. Pas une heure à moitié.' }
      };
      const c = CLE[raison];
      if (c) await imSay(bro(c.f, c.b), 1000, 'teach');
    }
    // et lui, comment ça s'est passé de son côté — pas quand ça n'a pas
    // marché pour toi : ça sonnerait comme de la vantardise
    if (k !== 'dur') try {
      const SES = [
        { f:'Moi, de mon côté, j\'ai décroché au bout de cinq minutes. Je n\'ai même pas vu le temps passer.', b:'Moi, décroché en cinq minutes.' },
        { f:'Moi, j\'étais si bien que j\'ai failli m\'endormir, doudou dans les bras. 🦊', b:'Moi, j\'ai failli m\'endormir.' },
        { f:'Moi, je me suis rendu compte en me relevant que ma couche avait travaillé pendant ce temps-là. Rien senti.', b:'Moi, ma couche a travaillé. Rien senti.' }
      ];
      const x = SES[Math.floor(graineFoxy(todayStr() + p.fenetre) * SES.length)];
      await imSay(bro(x.f, x.b), 850, 'happy');
    } catch(e) {}
    await noterPratique({ sujet:'regression', k, raison, focus: p.focus, fenetre: p.fenetre });
    if (k === 'mouille') { try { await declarerMiction(); } catch(e) {} return; }
    if (currentM) await imOfferHelp(currentM);
  }

  // Appelée chaque minute : une invitation par fenêtre, puis le suivi.
  async function verifierRegression() {
    if (paused || voiceMode !== 'foxy') return;
    const now = new Date();

    // 1) le suivi d'une régression lancée, 20 min à 3 h après
    const p = await lireStock('reg:pending', null);
    if (p && p.t) {
      const ecoule = Date.now() - p.t;
      if (ecoule > 3*3600000) { await ecrireStock('reg:pending', null); }
      else if (ecoule >= 20*60000) {
        talk(TALK.GUIDE, 'reg:suivi', () => suiviRegression(p));
        return;
      }
    }

    // 2) l'invitation, une fois par fenêtre et par jour
    const f = fenetreRegression(now);
    if (!f) return;
    // pas dans les dix dernières minutes : trop tard pour s'y mettre
    if (now.getHours()*60 + now.getMinutes() > f.a - 10) return;
    const cle = 'reg:invite:' + todayStr();
    const faites = await lireStock(cle, {});
    if (faites[f.id]) return;
    faites[f.id] = true;
    await ecrireStock(cle, faites);
    talk(TALK.GUIDE, 'reg:invite:' + f.id, () => inviterRegression(f));
  }

  /* Foxy change de tenue quand la période change, comme toi. À 19h30,
     il le dit une fois : « je passe en tenue de nuit, moi aussi ». */
  async function suivreTenueFoxy() {
    const avant = foxyOutfit.id;
    await loadFoxyOutfit();
    if (foxyOutfit.id === avant) return;
    try { refreshHeadFoxy(); } catch(e) {}
    if (paused || voiceMode !== 'foxy') return;
    if (foxyJournee().periode !== 'nuit') return;
    const cle = 'foxy:bascule:' + todayStr();
    if (await lireStock(cle, false)) return;
    await ecrireStock(cle, true);
    const nom = foxyOutfit.name;
    talk(TALK.AMBIANCE, 'foxy:bascule', async () => {
      await imSay(bro(
        'Il est 19h30 : je passe en ' + nom + ', moi aussi. Couche de nuit, tenue de nuit — on bascule ensemble. 🦊',
        '19h30. Je passe en ' + nom + '. On bascule ensemble.'), 850, 'happy');
      if (currentM) await imOfferHelp(currentM);
    });
  }

  // Après un change, une fois par jour : le meilleur moment pour sentir sa
  // couche, c'est quand elle est toute fraîche.
  async function proposerRessentirApresChange() {
    if (paused || voiceMode !== 'foxy') return;
    if (fenetreRegression()) return;                   // la fenêtre s'en charge
    const cle = 'reg:apreschange:' + todayStr();
    if (await lireStock(cle, false)) return;
    await ecrireStock(cle, true);
    talk(TALK.AMBIANCE, 'reg:apreschange', async () => {
      const k = await imDemander(bro(
        'Elle est toute fraîche, là. C\'est le meilleur moment pour la sentir — trente secondes, tu veux essayer ? 🦊',
        'Elle est fraîche. Trente secondes pour la sentir.'), [
        { k:'oui', label:'🌡️ Oui, on essaie', dit:'Oui, on essaie.' },
        { k:'non', label:'Plus tard', dit:'Plus tard.', soft:true }
      ], 'curious');
      if (k === 'oui') { await conseilComportement('ressentir'); return; }
      await imSay(bro('D\'accord. Elle ne va nulle part, de toute façon. 🦊', 'D\'accord.'), 600, 'calm');
      if (currentM) await imOfferHelp(currentM);
    });
  }

  /* ============================================================
     LES RÈGLES DU PROGRAMME
     Elles étaient écrites en dur dans la page : la carte ne savait
     pas ce que le code appliquait, et avait déjà dérivé (elle
     annonçait 22h30 alors que la bascule se fait à 19h30).

     Chaque règle est maintenant un objet qui porte son énoncé, les
     entorses qui la sanctionnent, et son mode de vérification —
     affiché tel quel, sans enjoliver :
       'auto'    vérifiée par l'appli ou un capteur
       'parole'  repose sur ce que tu déclares
       'mixte'   partiellement vérifiée
     ============================================================ */
  const REGLES = [
    { id:'r_couche', ic:'🍼', n:'Couche 24/7',
      t:'Portée en permanence, jour et nuit. Elle ne s\'ouvre qu\'aux changes et checks prévus.',
      mode:'auto', b:['b_retrait_hors','b_retrait_2h','b_pas_recouche','b_tenue_ouverte'] },

    { id:'r_miction', ic:'💧', n:'Mictions dans la couche',
      t:'Toutes. Les selles se font aux WC sur les deux fenêtres : change du matin et change de nuit.',
      mode:'mixte', b:['b_hors_couche'] },

    { id:'r_piliers', ic:'🔑', n:'Trois changes piliers obligatoires',
      t:'9h (matin), 16h (sortie de sieste), et le change de nuit — avancé dès 19h30 si tu te remets en couche à ce moment-là. Toilette, vérif peau, crème, couche fraîche.',
      mode:'auto', b:['b_pilier','b_pilier_c0900','b_pilier_c1600','b_pilier_c2230'] },

    { id:'r_checks', ic:'✓', n:'Checks respectés',
      t:'11h30, 13h30, 19h30 : on tâte, on change si mouillé. Jamais sautés.',
      mode:'auto', b:['b_check'] },

    { id:'r_preuve', ic:'📷', n:'Chaque action se prouve',
      t:'Les changes, la tenue, le biberon et le coucher se valident au scan du QR ou du tag correspondant.',
      mode:'auto', b:['b_preuve','b_incoherence','b_capteur_muet'] },

    { id:'r_tenue', ic:'👕', n:'Tenue ABDL en continu',
      t:'Pas de retour adulte vestimentaire pendant le mois. La tenue du jour est tirée, tu ne la choisis pas.',
      mode:'auto', b:['b_cadre','b_tenue','b_tenue_hs'] },

    { id:'r_hydra', ic:'🍼', n:'Trois biberons par jour',
      t:'L\'hydratation fait le reste du travail : moins tu bois, plus tu te retiens sans le vouloir.',
      mode:'auto', b:['b_hydra'] },

    { id:'r_peau', ic:'🧴', n:'La peau passe avant l\'horaire',
      t:'Une couche saturée se change, même hors créneau. Rougeur constatée, on traite dans la minute.',
      mode:'mixte', b:['b_sature','b_portlong'] },

    { id:'r_presence', ic:'🏠', n:'On ne part pas sans le dire',
      t:'Une absence s\'annonce, avec son heure de retour. Un arrêt silencieux, un retour en retard ou un retour refusé, c\'est une désertion — et Foxy en reparle.',
      mode:'auto', b:['b_arret_silencieux','b_retour_tardif','b_refus_retour','pause_longue','pause_tres_longue'] },

    { id:'r_tetine', ic:'🍭', n:'Tétine sur les temps de repos',
      t:'Fenêtres de régression, sieste, endormissement. Rien ne le vérifie : celle-là ne tient que sur toi.',
      mode:'parole', b:[] }
  ];

  /* Les limites ne sont PAS des règles. Elles ne durcissent jamais, ne se
     gagnent pas, ne s'assouplissent à aucun palier, et rien dans l'appli ne
     peut les contourner. Les mélanger aux règles les banaliserait. */
  const LIMITES = [
    { ic:'🚫', n:'Sommeil toujours libre',
      t:'Aucune contention verrouillée pendant la sieste ou la nuit. Jamais, à aucun palier.' },
    { ic:'🔒', n:'Contention verrouillée : superviseur présent',
      t:'Uniquement avec quelqu\'un d\'éveillé, présent, et qui a les clés. Chaque serrure garde son ouverture manuelle.' },
    { ic:'🛑', n:'Le safeword coupe tout',
      t:'Dans les réglages, ou « stop foxy » dans le chat : Foxy redevient doux, tout s\'arrête. Sans conséquence.' },
    { ic:'🔓', n:'Secours anti-blocage',
      t:'Trois tapes sur le titre de l\'écran de connexion, toujours actif. L\'appli ne peut pas t\'enfermer dehors.' }
  ];

  const MODE_LABEL = {
    auto:   { txt:'vérifiée automatiquement', c:'#2e7d4f', bg:'#E8F5EC' },
    mixte:  { txt:'partiellement vérifiée',   c:'#8a6a20', bg:'#FBF3E0' },
    parole: { txt:'sur ta parole',            c:'#8A8391', bg:'#F1EEF3' }
  };

  // Respect d'une règle sur les 7 derniers jours : nombre de jours touchés
  async function etatRegle(regle) {
    if (!regle.b.length) return null;
    let jours = 0, vus = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = d.toISOString().slice(0,10);
      try {
        const r = await window.storage.get('breach:'+k);
        if (!r || !r.value) continue;
        vus++;
        const b = JSON.parse(r.value);
        if (regle.b.some(x => b[x])) jours++;
      } catch(e) {}
    }
    if (!vus) return null;
    return { touchee: jours, sur: vus };
  }

  /* Les règles dites de vive voix, dans le chat. La carte de l'onglet
     « Cadre » les affiche en entier ; ici Foxy en rappelle l'esprit et
     pointe celle qui coince, sans réciter les neuf. */
  async function rappelerRegles() {
    await imSay(bro(
      'Les règles, c\'est simple à retenir : ta couche tout le temps, trois piliers dans la journée, les checks à l\'heure, et ta tenue qui reste fermée entre deux. Tout le détail est dans l\'onglet « Cadre » si tu veux le lire au calme. 🦊',
      'Couche en permanence. Trois piliers. Checks à l\'heure. Tenue fermée entre deux. Le détail est dans « Cadre ».'), 950, 'explain');

    // celle qui a le plus accroché cette semaine — une seule, pas un bilan
    let pire = null;
    try {
      for (const r of REGLES) {
        const e = await etatRegle(r);
        if (e && e.touchee > 0 && (!pire || e.touchee > pire.e.touchee)) pire = { r, e };
      }
    } catch(e) {}

    if (pire) {
      await imSay(bro(
        'Celle sur laquelle tu accroches en ce moment, c\'est « ' + pire.r.n + ' » — ' + pire.e.touchee + ' jour' + (pire.e.touchee>1?'s':'') + ' sur ' + pire.e.sur + '. '
          + 'Ce n\'est pas un reproche, hein. C\'est juste là qu\'il y a du terrain à prendre, et c\'est souvent une histoire de matériel mal placé plutôt que de volonté.',
        '« ' + pire.r.n + ' » : ' + pire.e.touchee + ' jour' + (pire.e.touchee>1?'s':'') + ' sur ' + pire.e.sur + '. C\'est là que ça coince. On s\'en occupe.'), 950, 'concern');
    } else {
      await imSay(bro(
        'Et sur les sept derniers jours, rien n\'a lâché. Franchement, c\'est du beau travail — je ne dis pas ça pour te faire plaisir. 🦊',
        'Sept jours, rien n\'a lâché. C\'est bien.'), 900, 'proud');
    }

    await imSay(bro(
      'Et il y a quatre choses qui ne bougeront jamais, quoi qu\'il arrive : ton sommeil reste libre, tu peux toujours sortir de l\'appli, rien ne s\'endurcit tout seul, et ta peau passe avant l\'horaire. Celles-là, elles ne se méritent pas — elles sont là, point. 💛',
      'Quatre choses ne bougent jamais : sommeil libre, sortie toujours possible, rien ne s\'endurcit seul, ta peau avant l\'horaire. Elles ne se méritent pas.'), 950, 'calm');
    return true;
  }

  async function renderRegles() {
    const box = document.getElementById('rulesList');
    const lim = document.getElementById('limitesList');
    if (!box) return;

    box.innerHTML = '';
    for (let i = 0; i < REGLES.length; i++) {
      const r = REGLES[i];
      const m = MODE_LABEL[r.mode] || MODE_LABEL.parole;
      const e = await etatRegle(r);
      let etat = '';
      if (e) {
        const ok = e.touchee === 0;
        etat = '<span style="font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:20px;'
             + 'background:' + (ok ? '#E8F5EC' : '#FBEBE5') + ';color:' + (ok ? '#2e7d4f' : '#a8543b') + '">'
             + (ok ? '✓ tenue sur ' + e.sur + ' jours'
                   : '⚠ ' + e.touchee + ' jour' + (e.touchee>1?'s':'') + ' sur ' + e.sur)
             + '</span>';
      }
      box.innerHTML +=
        '<div style="padding:10px 0;border-top:' + (i ? '1px solid var(--line)' : 'none') + '">'
        + '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">'
        + '<span style="font-size:15px">' + r.ic + '</span>'
        + '<b style="font-size:13.5px;color:var(--ink)">' + r.n + '</b>'
        + '<span style="font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:20px;'
        + 'background:' + m.bg + ';color:' + m.c + '">' + m.txt + '</span>'
        + etat + '</div>'
        + '<div style="font-size:12.5px;font-weight:600;color:var(--muted);line-height:1.45;margin-top:3px">'
        + r.t + '</div></div>';
    }

    if (lim) {
      lim.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:14.5px;color:#a8543b;margin-bottom:3px">Les limites</div>'
        + '<div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px">'
        + 'Ce ne sont pas des règles du programme. Elles ne durcissent jamais, ne se gagnent pas, '
        + 'et rien dans l\'appli ne peut les contourner.</div>'
        + LIMITES.map(l =>
            '<div style="display:flex;gap:8px;padding:6px 0">'
            + '<span style="font-size:15px">' + l.ic + '</span>'
            + '<div><b style="font-size:13px;color:var(--ink)">' + l.n + '</b>'
            + '<div style="font-size:12px;font-weight:600;color:var(--muted);line-height:1.4">' + l.t + '</div></div></div>'
          ).join('');
    }
  }

  // À quelle règle se rattache une entorse ? Foxy la cite en la relevant.
  function regleDe(idEntorse) {
    const i = REGLES.findIndex(r => r.b.indexOf(idEntorse) >= 0);
    return i < 0 ? null : { num: i + 1, regle: REGLES[i] };
  }
  function citerRegle(idEntorse) {
    const r = regleDe(idEntorse);
    if (!r) return '';
    return 'Règle ' + r.num + ' — ' + r.regle.n + '.';
  }


  /* ---- Les deux règles qui ne tenaient sur rien ----
     « Checks respectés · jamais sautés » n'avait aucune entorse : sauter un
     check ne coûtait rien. Et « mictions dans la couche » reposait sur une
     case que tu cochais toi-même, alors que ton capteur peut trancher. */

  const CHECKS_MIN = [11*60+30, 13*60+30, 19*60+30];

  // Un check dont la fenêtre est passée sans rien faire est une entorse.
  // On vérifie a posteriori, une fois la fenêtre de 45 min refermée.
  async function verifierChecksRates() {
    if (paused) return false;
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    let done = {};
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      if (r && r.value) done = JSON.parse(r.value);
    } catch(e) {}
    const CLES = { [11*60+30]:'c1130', [13*60+30]:'c1330', [19*60+30]:'c1930' };

    let rate = null;
    for (const m of CHECKS_MIN) {
      if (nowMin < m + 45) continue;          // fenêtre encore ouverte
      const cle = CLES[m];
      if (done[cle]) continue;                // fait
      // déjà signalé aujourd'hui ?
      let vus = {};
      try { const r = await window.storage.get('check:rate:'+todayStr()); if (r && r.value) vus = JSON.parse(r.value); } catch(e) {}
      if (vus[cle]) continue;
      vus[cle] = true;
      try { await window.storage.set('check:rate:'+todayStr(), JSON.stringify(vus)); } catch(e) {}
      rate = m;
      break;
    }
    if (rate === null) return false;

    await marquerEntorse('b_check');
    await imSay(broOn()
      ? 'Ton check de ' + fmtTime(rate) + ' est passé sans toi. Ce n\'est pas facultatif.'
      : 'Ton check de ' + fmtTime(rate) + ' est passé et tu ne l\'as pas fait... Ce n\'est pas grand-chose à faire, mais c\'est ce qui tient le reste. 🦊', 1000, 'concern');
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  /* Mictions : si tu as bu et que le capteur n'a rien vu de la journée,
     la règle n'a pas été tenue — et ça ne dépend plus de ce que tu coches. */
  async function corroborerMictions() {
    if (paused) return false;
    try {
      const r = await window.storage.get('sensor:vu');
      if (!r || !r.value) return false;                 // pas de capteur : rien à dire
    } catch(e) { return false; }

    const hier = new Date(); hier.setDate(hier.getDate()-1);
    const k = hier.toISOString().slice(0,10);
    let checks = [];
    try { checks = await getChecks(k); } catch(e) {}
    if (!checks.length) return false;

    const mesures = checks.filter(c => c.type === 'capteur' && /^etat_/.test(c.result||''));
    if (mesures.length < 3) return false;               // capteur trop peu présent pour juger
    const mouille = mesures.some(c => /mouille$|sature$/.test(c.result));
    if (mouille) return false;

    const bus = checks.filter(c => /^biberon_/.test(c.result||'')).length;
    if (bus < 2) return false;                          // peu bu : l'absence s'explique

    await marquerEntorse('b_hors_couche');
    await imSay(broOn()
      ? 'Hier, tu as bu ' + bus + ' biberons et ton capteur n\'a pas vu une seule couche mouillée. Ça n\'est pas allé dans ta couche. Inutile de me dire le contraire.'
      : 'Dis... hier tu as bu ' + bus + ' biberons, et ton capteur n\'a rien vu venir de la journée. Ça veut dire que c\'est allé ailleurs. 🦊', 1100, 'puzzled');
    await imSay(broOn()
      ? 'Tu te retiens jusqu\'aux toilettes. C\'est exactement ce qu\'on est en train de défaire.'
      : 'Je ne te gronde pas — mais c\'est précisément l\'habitude qu\'on essaie de défaire ensemble. Laisse venir, c\'est tout ce qu\'il y a à faire. 💛', 1050, 'calm');
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  /* ============================================================
     AGENT DE TRANSFORMATION
     De l'intérieur, on ne voit jamais son propre changement : on ne
     voit que la journée d'aujourd'hui. Ce module compare ce que tu
     fais cette semaine à ce que tu faisais il y a trois semaines,
     date les bascules au moment où elles arrivent, et quand un
     indicateur se dégrade, nomme la difficulté et donne une clé.

     Rien n'est déclaratif : tout est reconstruit depuis tes changes
     horodatés, tes états rapportés, tes entorses et tes preuves.
     ============================================================ */

  const PILIERS_MIN = [9*60, 16*60, 22*60+30];

  // Mesures sur une fenêtre de jours : [ilya + duree ; ilya] jours en arrière
  async function mesuresTransfo(ilya, duree) {
    const out = { n:0, retard:null, tauxSec:null, portH:null,
                  entorses:null, tauxPreuve:null, biberons:null,
                  spont:null, apres:null, moralDur:null, decroche:null };
    let nbJours = 0;
    let retards = [], etats = { sec:0, total:0 }, ports = [];
    let entorses = 0, preuves = { ok:0, total:0 }, bibs = [];
    // déclaratif : ce que tu dis de tes mictions et de ton moral
    const venues = { spont:0, apres:0, total:0 }, moraux = { dur:0, total:0 };
    const regs = { decroche:0, total:0 };

    for (let i = ilya; i < ilya + duree; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0,10);

      // Ces deux journaux vivent à part des checks : on les lit même les
      // jours sans check, sinon une journée « parlée » serait invisible.
      try {
        const r = await window.storage.get('miction:' + k);
        const l = (r && r.value) ? JSON.parse(r.value) : [];
        l.filter(x => !x.contredit && x.venue).forEach(x => {   // une déclaration contredite par le capteur ne compte pas
          venues.total++;
          if (x.venue === 'apres' || x.venue === 'seul') venues.spont++;
          if (x.venue === 'apres') venues.apres++;
        });
      } catch(e) {}
      try {
        const r = await window.storage.get('posture:' + k);
        const l = (r && r.value) ? JSON.parse(r.value) : [];
        // on ne compte que les régressions réellement faites (pas les refus)
        l.filter(x => x.sujet === 'regression' && x.k && x.k !== 'refus').forEach(x => {
          regs.total++;
          if (x.k === 'decroche' || x.k === 'mouille') regs.decroche++;
        });
      } catch(e) {}
      try {
        const r = await window.storage.get('moral:' + k);
        const l = (r && r.value) ? JSON.parse(r.value) : [];
        l.forEach(x => { moraux.total++; if (x.v === 'dur' || x.v === 'fatigue') moraux.dur++; });
      } catch(e) {}

      let checks = [];
      try { checks = await getChecks(k); } catch(e) {}
      if (!checks.length) continue;
      nbJours++;

      // retard aux piliers : écart entre l'heure du change et l'heure prévue
      const changes = checks.filter(c => /^change_fait/.test(c.result || ''));
      changes.forEach(c => {
        const t = new Date(c.t);
        const m = t.getHours()*60 + t.getMinutes();
        let meilleur = null;
        PILIERS_MIN.forEach(p => {
          const ecart = m - p;
          if (ecart >= 0 && ecart <= 180 && (meilleur === null || ecart < meilleur)) meilleur = ecart;
        });
        if (meilleur !== null) retards.push(meilleur);
      });

      // taux de « encore sèche » : mesure du lâcher-prise
      checks.forEach(c => {
        if (/^etat_/.test(c.result || '') || ['sec','mouille','sature'].includes(c.result)) {
          etats.total++;
          if (/sec$/.test(c.result)) etats.sec++;
        }
      });

      // durée de port : intervalles entre deux changes successifs
      const ts = changes.map(c => new Date(c.t).getTime()).sort((a,b) => a-b);
      for (let j = 1; j < ts.length; j++) {
        const h = (ts[j] - ts[j-1]) / 3600000;
        if (h > 0.5 && h < 16) ports.push(h);
      }

      // preuves réellement fournies
      changes.forEach(c => {
        preuves.total++;
        if (c.result === 'change_fait') preuves.ok++;
      });

      // biberons prouvés
      bibs.push(checks.filter(c => /^biberon_/.test(c.result || '')).length);

      // entorses du jour
      try {
        const r = await window.storage.get('breach:'+k);
        const b = (r && r.value) ? JSON.parse(r.value) : {};
        entorses += Object.keys(b).filter(x => b[x]).length;
      } catch(e) {}
    }

    const moy = (a) => a.length ? a.reduce((x,y)=>x+y,0) / a.length : null;
    out.n = nbJours;
    out.retard = moy(retards);
    out.tauxSec = etats.total >= 3 ? etats.sec / etats.total : null;
    out.portH = moy(ports);
    out.entorses = nbJours ? entorses / nbJours : null;
    out.tauxPreuve = preuves.total >= 3 ? preuves.ok / preuves.total : null;
    out.biberons = moy(bibs);
    // en dessous de 3 réponses sur la semaine, un pourcentage ne veut rien dire
    out.spont    = venues.total >= 3 ? venues.spont / venues.total : null;
    out.apres    = venues.total >= 3 ? venues.apres / venues.total : null;
    out.moralDur = moraux.total >= 3 ? moraux.dur / moraux.total : null;
    out.decroche = regs.total >= 3 ? regs.decroche / regs.total : null;
    return out;
  }

  /* Chaque indicateur sait se raconter : ce qu'il mesure, dans quel sens
     il s'améliore, à partir de quel écart ça vaut la peine d'en parler,
     et — quand il se dégrade — quelle clé donner. */
  const INDIC = [
    { id:'retard', sens:-1, minEcart:4, unite:'min',
      fmt: v => Math.round(v) + ' min',
      mieux: (a,b) => 'Il y a trois semaines, tu lançais ton change ' + Math.round(a) + ' minutes après l\'heure. Cette semaine, ' + Math.round(b) + '. Tu ne le vois pas de l\'intérieur, mais tu as arrêté de négocier avec l\'horloge.',
      pire: (a,b) => 'Tu repousses tes changes plus qu\'avant : ' + Math.round(b) + ' minutes de délai contre ' + Math.round(a) + ' il y a trois semaines.',
      cle: 'La clé, c\'est de préparer le matériel AVANT l\'heure, pas au moment de le faire. Le délai ne vient presque jamais du change lui-même, il vient du fait d\'aller chercher les affaires. Sors-les au créneau précédent.' },

    { id:'tauxSec', sens:-1, minEcart:0.15, unite:'%',
      fmt: v => Math.round(v*100) + ' %',
      mieux: (a,b) => 'Tes couches sèches aux checks sont passées de ' + Math.round(a*100) + ' % à ' + Math.round(b*100) + ' %. C\'est le signe le plus net qu\'il y a : tu te retiens beaucoup moins qu\'avant.',
      pire: (a,b) => 'Tu me rends de plus en plus de couches sèches : ' + Math.round(b*100) + ' % contre ' + Math.round(a*100) + ' il y a trois semaines. Ton corps s\'est remis à contrôler.',
      cle: 'Le lâcher-prise ne se décide pas, il s\'obtient en arrêtant de surveiller. Bois davantage, et surtout ne vérifie pas entre les checks — c\'est le fait de guetter qui te fait te retenir.' },

    { id:'portH', sens:1, minEcart:0.8, unite:'h',
      fmt: v => v.toFixed(1) + ' h',
      mieux: (a,b) => 'Tu gardes tes couches plus longtemps : ' + b.toFixed(1) + ' h en moyenne contre ' + a.toFixed(1) + ' il y a trois semaines. Tu t\'en préoccupes moins, tout simplement.',
      pire: (a,b) => 'Tes durées de port raccourcissent : ' + b.toFixed(1) + ' h contre ' + a.toFixed(1) + ' avant.',
      cle: 'Si tu changes plus tôt qu\'avant, demande-toi si c\'est ta peau ou ton inconfort mental. Pour la peau, on garde. Pour le reste, laisse passer un créneau et observe ce qui se passe vraiment.' },

    { id:'entorses', sens:-1, minEcart:0.6, unite:'/jour',
      fmt: v => v.toFixed(1) + ' par jour',
      mieux: (a,b) => 'Tes entorses sont tombées de ' + a.toFixed(1) + ' à ' + b.toFixed(1) + ' par jour. Le cadre te coûte moins d\'effort qu\'avant.',
      pire: (a,b) => 'Tes entorses remontent : ' + b.toFixed(1) + ' par jour contre ' + a.toFixed(1) + '.',
      cle: 'Quand les entorses reviennent en bloc, ce n\'est presque jamais la volonté qui lâche — c\'est le matériel ou l\'organisation. Vérifie ton stock et l\'emplacement de tes QR avant de te faire des reproches.' },

    { id:'tauxPreuve', sens:1, minEcart:0.2, unite:'%',
      fmt: v => Math.round(v*100) + ' %',
      mieux: (a,b) => 'Tu scannes ' + Math.round(b*100) + ' % de tes changes, contre ' + Math.round(a*100) + ' avant. Le geste est devenu automatique.',
      pire: (a,b) => 'Tu valides de plus en plus sans preuve : ' + Math.round(b*100) + ' % de scans contre ' + Math.round(a*100) + ' avant.',
      cle: 'Un scan qu\'on saute, c\'est presque toujours un code qu\'on n\'a pas sous la main. Ton bracelet, lui, est déjà à ton poignet : garde-le, et il n\'y a plus rien à chercher.' },

    { id:'biberons', sens:1, minEcart:0.7, unite:'/jour',
      fmt: v => v.toFixed(1) + ' par jour',
      mieux: (a,b) => 'Tu bois mieux : ' + b.toFixed(1) + ' biberons par jour contre ' + a.toFixed(1) + '.',
      pire: (a,b) => 'Ton hydratation baisse : ' + b.toFixed(1) + ' biberons par jour contre ' + a.toFixed(1) + ' il y a trois semaines.',
      cle: 'L\'hydratation entraîne tout le reste : moins tu bois, moins tu mouilles, plus tu te retiens sans le vouloir. Accroche le biberon aux repas plutôt qu\'aux créneaux — c\'est plus facile à tenir.' },

    /* Les deux suivants reposent sur ce que tu me DÉCLARES — Foxy le dit
       en les citant. Une déclaration contredite par le capteur est exclue. */
    { id:'spont', sens:1, minEcart:0.15, unite:'%',
      fmt: v => Math.round(v*100) + ' %',
      mieux: (a,b,r) => 'D\'après ce que tu me dis, ' + Math.round(b*100) + ' % de ce qui va dans ta couche part maintenant tout seul, contre ' + Math.round(a*100) + ' % il y a trois semaines.'
        + (r && r.apres ? ' Et dans ' + Math.round(r.apres*100) + ' % des cas, tu ne t\'en rends compte qu\'après coup. Ça, c\'est le réflexe qui se défait pour de vrai.' : ' Tu n\'as plus besoin de décider — c\'est exactement le chemin.'),
      pire: (a,b) => 'D\'après ce que tu me dis, tu dois de nouveau aider plus souvent : ' + Math.round(b*100) + ' % de spontané contre ' + Math.round(a*100) + ' % il y a trois semaines.',
      cle: 'Quand ça ne part plus tout seul, c\'est presque toujours qu\'on s\'est remis à guetter. La prochaine fois que tu sens que ça vient, ne t\'arrête pas et ne pousse pas : continue ce que tu fais, et expire lentement, comme un long soupir. Le relâchement suit l\'expiration, pas l\'effort. Et regarde le volet « Comment me comporter », c\'est expliqué en détail.' },

    { id:'decroche', sens:1, minEcart:0.2, unite:'%',
      fmt: v => Math.round(v*100) + ' %',
      mieux: (a,b) => 'Pendant tes régressions, tu décroches vraiment ' + Math.round(b*100) + ' % des fois, contre ' + Math.round(a*100) + ' % il y a trois semaines. Tu n\'as plus besoin de t\'y mettre : tu y glisses.',
      pire: (a,b) => 'Tu décroches moins souvent pendant tes régressions : ' + Math.round(b*100) + ' % contre ' + Math.round(a*100) + ' % il y a trois semaines.',
      cle: 'Quand la régression ne prend plus, c\'est presque toujours qu\'un bout d\'adulte est resté allumé — le téléphone à côté, une tâche en tête. Vise plus petit : une seule consigne, dix minutes, téléphone dans une autre pièce. Et reprends ta tétine, c\'est elle qui fait descendre le plus vite.' },

    { id:'moralDur', sens:-1, minEcart:0.2, unite:'%',
      fmt: v => Math.round(v*100) + ' %',
      mieux: (a,b) => 'Tu me dis beaucoup moins souvent que c\'est dur : ' + Math.round(b*100) + ' % des fois où je t\'ai demandé, contre ' + Math.round(a*100) + ' % il y a trois semaines. Le cadre te pèse moins — il est en train de devenir le tien.',
      pire: (a,b) => 'Tu me dis plus souvent que c\'est dur ou que tu es fatigué : ' + Math.round(b*100) + ' % des fois contre ' + Math.round(a*100) + ' % il y a trois semaines. Je l\'entends.',
      cle: 'Quand ça pèse plus souvent, ce n\'est pas un échec : c\'est un signal. Allège d\'abord ce qui te coûte sans rien t\'apporter — un créneau trop serré, une contention que tu subis, un réveil trop tôt. Tu peux mettre le programme en pause, c\'est prévu pour ça, et ça ne se rattrape pas en forçant. Et si ça déborde du programme, parles-en à quelqu\'un de confiance autour de toi : je suis là pour la route, pas pour tout porter à ta place.' }
  ];

  // Compare la semaine écoulée à la même durée trois semaines plus tôt
  async function observerTransformation() {
    const recent = await mesuresTransfo(0, 7);
    const ancien = await mesuresTransfo(21, 7);
    if (recent.n < 3 || ancien.n < 3) return null;   // pas assez de matière

    const progres = [], reculs = [];
    INDIC.forEach(ind => {
      const a = ancien[ind.id], b = recent[ind.id];
      if (a === null || b === null) return;
      const ecart = b - a;
      if (Math.abs(ecart) < ind.minEcart) return;
      const ameliore = (ind.sens === 1) ? (ecart > 0) : (ecart < 0);
      (ameliore ? progres : reculs).push({ ind, a, b });
    });
    return { recent, ancien, progres, reculs };
  }


  /* ---- Les bascules, datées ----
     Une transformation, ce sont quelques seuils franchis, pas une courbe
     lisse. Ceux-là sont détectés tout seuls et inscrits une fois pour
     toutes, avec leur date. Foxy peut ensuite y revenir : « ça fait un
     mois jour pour jour que tu m'as dit ça. » */
  const JALONS = {
    premier_bienetre: 'la première fois que tu m\'as dit que tu t\'y sentais bien',
    premiere_propre:  'ta première journée sans la moindre entorse',
    semaine_propre:   'ta première semaine complète sans entorse',
    port_long:        'la première fois que tu as gardé une couche plus de 10 h sans t\'en plaindre',
    sans_sec:         'la première journée entière sans une seule couche sèche',
    pilier_immediat:  'la première fois que tu as fait tes trois piliers à l\'heure, sans traîner',
    tout_prouve:      'la première journée où tous tes changes ont été prouvés',
    premier_apres:    'la première fois que ça t\'a échappé sans que tu le remarques avant coup',
    journee_spontanee:'la première journée où tout ce qui est allé dans ta couche est parti tout seul',
    premiere_regression:'la première fois que tu as vraiment décroché pendant une régression',
    palier2:          'le jour où ton habituation est passée en automatisme',
    palier3:          'le jour où c\'est devenu une seconde nature'
  };

  async function lireJalons() {
    try { const r = await window.storage.get('transfo:jalons'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return {};
  }
  async function marquerJalon(id) {
    if (!JALONS[id]) return false;
    const j = await lireJalons();
    if (j[id]) return false;                       // déjà franchi : on ne le rejoue pas
    j[id] = Date.now();
    try { await window.storage.set('transfo:jalons', JSON.stringify(j)); } catch(e) {}
    return true;
  }

  // Balaie la journée d'hier à la recherche de seuils franchis
  async function detecterJalons() {
    const nouveaux = [];
    const hier = new Date(); hier.setDate(hier.getDate()-1);
    const k = hier.toISOString().slice(0,10);
    let checks = [];
    try { checks = await getChecks(k); } catch(e) {}
    if (!checks.length) return nouveaux;

    // journée sans entorse
    let propre = false;
    try {
      const r = await window.storage.get('breach:'+k);
      const b = (r && r.value) ? JSON.parse(r.value) : {};
      propre = !Object.keys(b).some(x => b[x]);
    } catch(e) {}
    if (propre && await marquerJalon('premiere_propre')) nouveaux.push('premiere_propre');

    // semaine complète sans entorse
    if (propre) {
      let sept = true;
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const kk = d.toISOString().slice(0,10);
        try {
          const r = await window.storage.get('breach:'+kk);
          const b = (r && r.value) ? JSON.parse(r.value) : {};
          if (Object.keys(b).some(x => b[x])) { sept = false; break; }
        } catch(e) { sept = false; break; }
      }
      if (sept && await marquerJalon('semaine_propre')) nouveaux.push('semaine_propre');
    }

    // aucune couche sèche de la journée
    const etats = checks.filter(c => /^etat_/.test(c.result||'') || ['sec','mouille','sature'].includes(c.result));
    if (etats.length >= 3 && !etats.some(c => /sec$/.test(c.result))
        && await marquerJalon('sans_sec')) nouveaux.push('sans_sec');

    // tous les changes prouvés
    const ch = checks.filter(c => /^change_fait/.test(c.result||''));
    if (ch.length >= 2 && ch.every(c => c.result === 'change_fait')
        && await marquerJalon('tout_prouve')) nouveaux.push('tout_prouve');

    // trois piliers à l'heure
    const aHeure = PILIERS_MIN.filter(p => ch.some(c => {
      const t = new Date(c.t); const m = t.getHours()*60 + t.getMinutes();
      return m >= p && m <= p + 15;
    }));
    if (aHeure.length === 3 && await marquerJalon('pilier_immediat')) nouveaux.push('pilier_immediat');

    // journée entièrement spontanée, d'après tes déclarations
    try {
      const r = await window.storage.get('miction:' + k);
      const l = ((r && r.value) ? JSON.parse(r.value) : []).filter(x => !x.contredit && x.venue);
      if (l.length >= 3 && l.every(x => x.venue === 'apres' || x.venue === 'seul')
          && await marquerJalon('journee_spontanee')) nouveaux.push('journee_spontanee');
    } catch(e) {}

    // port long sans plainte
    const ts = ch.map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
    for (let i = 1; i < ts.length; i++) {
      if ((ts[i]-ts[i-1])/3600000 >= 10) {
        if (await marquerJalon('port_long')) nouveaux.push('port_long');
        break;
      }
    }
    return nouveaux;
  }

  function ilYaCombien(t) {
    const j = Math.floor((Date.now() - t) / 86400000);
    if (j <= 0) return 'aujourd\'hui';
    if (j === 1) return 'hier';
    if (j < 7) return 'il y a ' + j + ' jours';
    if (j < 14) return 'il y a une semaine';
    if (j < 31) return 'il y a ' + Math.round(j/7) + ' semaines';
    return 'il y a ' + Math.round(j/30) + ' mois';
  }

  /* ---- Ce que Foxy en dit ----
     Une seule prise de parole par jour au maximum. Il constate d'abord
     ce qui a changé en bien, parce que c'est ce qu'on ne voit jamais
     soi-même. Puis il nomme une difficulté, une seule, avec sa clé. */
  async function parlerTransformation(forcer) {
    if (paused) return false;
    // pas plus d'une fois par jour, sauf demande explicite
    if (!forcer) {
      try {
        const r = await window.storage.get('transfo:dit');
        if (r && r.value && JSON.parse(r.value) === todayStr()) return false;
      } catch(e) {}
    }

    const nouveaux = await detecterJalons();
    const obs = await observerTransformation();
    if (!nouveaux.length && !obs) {
      if (forcer) {
        await imSay(broOn()
          ? 'Trop tôt pour comparer. Il me faut trois semaines de données.'
          : 'Je n\'ai pas encore assez de recul pour comparer — il me faut environ trois semaines de journées enregistrées. 🦊', 950, 'pensive');
        // …mais pas assez de recul ne veut pas dire rien à dire : la photo
        // de la semaine, sans comparaison, à partir de ce que tu m'as déclaré.
        const sem = await mesuresTransfo(0, 7);
        if (sem.spont !== null) {
          await imSay(bro(
            'En attendant, voilà la photo de ta semaine, d\'après ce que tu m\'as dit : ' + Math.round(sem.spont*100) + ' % de ce qui est allé dans ta couche est parti tout seul'
              + (sem.apres ? ', et ' + Math.round(sem.apres*100) + ' % tu ne l\'as remarqué qu\'après coup.' : '.')
              + (sem.spont >= 0.5 ? ' C\'est déjà beaucoup, tu sais.' : ' Le reste, tu l\'as encore laissé venir ou aidé — c\'est normal à ce stade.'),
            'Ta semaine, d\'après toi : ' + Math.round(sem.spont*100) + ' % spontané' + (sem.apres ? ', ' + Math.round(sem.apres*100) + ' % remarqué après coup.' : '.')), 1050, 'teach');
        } else {
          await imSay(bro(
            'Et dis-moi quand tu mouilles ta couche, avec le petit bouton 💧 : c\'est ce qui me permettra de voir si ça part de plus en plus tout seul.',
            'Déclare tes mictions avec le bouton 💧. Sans ça, je ne vois pas le réflexe bouger.'), 900, 'teach');
        }
        if (sem.decroche !== null) {
          await imSay(bro(
            'Tes régressions, cette semaine : tu m\'as dit avoir vraiment décroché ' + Math.round(sem.decroche*100) + ' % des fois.'
              + (sem.decroche >= 0.5 ? ' Tu y glisses de plus en plus facilement. 🦊' : ' Le reste du temps, un bout d\'adulte restait allumé — c\'est normal, ça s\'éteint avec la pratique.'),
            'Régressions : décroché ' + Math.round(sem.decroche*100) + ' % des fois.'), 1000, 'teach');
        }
        if (sem.moralDur !== null && sem.moralDur >= 0.5) {
          await imSay(bro(
            'Et tu m\'as dit que c\'était dur ou que tu étais fatigué ' + Math.round(sem.moralDur*100) + ' % des fois où je t\'ai demandé cette semaine. Je le garde en tête. Si ça continue, on allège quelque chose — on ne force pas. 💛',
            'Cette semaine, c\'est dur ' + Math.round(sem.moralDur*100) + ' % du temps, d\'après toi. Si ça dure, on allège.'), 1000, 'concern');
        }
      }
      return false;
    }
    try { await window.storage.set('transfo:dit', JSON.stringify(todayStr())); } catch(e) {}

    // 1) les bascules franchies
    for (const id of nouveaux) {
      await imSay(broOn()
        ? 'Nouveau seuil : ' + JALONS[id] + '. C\'était hier. Je le note.'
        : '🌱 Quelque chose a basculé hier : <b>' + JALONS[id] + '</b>. Je le date, pour qu\'on puisse y revenir. 🦊', 1000, 'proud');
    }

    if (!obs) return true;

    // 2) ce qui a changé en bien — le plus net d'abord
    if (obs.progres.length) {
      const p = obs.progres[0];
      await imSay(p.ind.mieux(p.a, p.b, obs.recent), 1150, 'proud');
      if (obs.progres.length > 1) {
        const q = obs.progres[1];
        await imSay('Et ce n\'est pas le seul. ' + q.ind.mieux(q.a, q.b, obs.recent), 1100, 'happy');
      }
    }

    // 3) une difficulté, nommée, avec sa clé
    if (obs.reculs.length) {
      const r = obs.reculs[0];
      await imSay(broOn()
        ? r.ind.pire(r.a, r.b) + ' Je ne te le reproche pas, je te le dis.'
        : r.ind.pire(r.a, r.b) + ' Ce n\'est pas un reproche — c\'est ce que je vois, et ça se corrige. 🦊', 1100, 'concern');
      await imSay('<b>La clé :</b> ' + r.ind.cle, 1200, 'teach');
    } else if (obs.progres.length) {
      await imSay(broOn()
        ? 'Rien ne s\'est dégradé sur ces trois semaines. Continue exactement comme ça.'
        : 'Et rien ne s\'est dégradé par ailleurs. Franchement, c\'est du beau travail. 💛', 1000, 'moved');
    }
    return true;
  }

  // Rappel d'une bascule à sa date anniversaire
  async function anniversaireJalon() {
    const j = await lireJalons();
    const ids = Object.keys(j);
    if (!ids.length) return false;
    for (const id of ids) {
      const jours = Math.floor((Date.now() - j[id]) / 86400000);
      if (jours === 30 || jours === 90) {
        await imSay(broOn()
          ? 'Ça fait ' + (jours === 30 ? 'un mois' : 'trois mois') + ' jour pour jour : ' + JALONS[id] + '. Tu as oublié, pas moi.'
          : '🕯️ Ça fait ' + (jours === 30 ? 'un mois' : 'trois mois') + ' jour pour jour — ' + JALONS[id] + '. Tu l\'avais sûrement oublié. Moi je garde ces dates. 🦊💛', 1100, 'moved');
        return true;
      }
    }
    return false;
  }

  /* ============================================================
     CORROBORATION — la mesure prime sur la déclaration
     Ce que tu dis n'est retenu que si aucun capteur ne peut le
     contredire. Quand un capteur parle, c'est lui qui fait foi,
     et l'écart entre les deux est enregistré.
     ============================================================ */

  // Dernier état mesuré par le capteur de couche, s'il est récent.
  // Au-delà de 90 min sans mesure, on considère qu'on ne sait plus.
  async function etatMesure(maxMinutes) {
    const limite = (maxMinutes || 90) * 60000;
    try {
      const l = await getChecks(todayStr());
      const capteur = l.filter(c => c.type === 'capteur' && /^etat_/.test(c.result || ''));
      if (!capteur.length) return null;
      const dernier = capteur[capteur.length - 1];
      const t = new Date(dernier.t).getTime();
      if (Date.now() - t > limite) return null;
      return { etat: dernier.result.replace('etat_', ''), t };
    } catch(e) { return null; }
  }

  // Le capteur de tenue a-t-il déjà été utilisé ? Sinon on ne lui reproche
  // pas son silence : on ne va pas sanctionner un matériel que tu n'as pas.
  async function capteurTenueEnService() {
    try { const r = await window.storage.get('ts:vu'); return !!(r && r.value); } catch(e) { return false; }
  }
  async function marquerCapteurTenueVu() {
    try { await window.storage.set('ts:vu', JSON.stringify(Date.now())); } catch(e) {}
  }

  // Une ouverture de tenue a-t-elle été relevée dans les N dernières minutes ?
  async function ouvertureRecente(minutes) {
    try {
      const l = await getChecks(todayStr());
      const lim = Date.now() - (minutes || 60) * 60000;
      return l.some(c => /^tenue_ouverte_/.test(c.result || '') && new Date(c.t).getTime() >= lim);
    } catch(e) { return false; }
  }

  /* ---- Après un change : la couche fraîche doit se voir ----
     Un change validé arme une vérification. Le capteur doit repasser à
     sec dans les 25 minutes. C'est la seule preuve que tu t'es remis en
     couche, et pas seulement que tu as scanné un carré de papier. */
  async function armerVerifFraiche(slotKey) {
    try {
      await window.storage.set('change:attente',
        JSON.stringify({ t: Date.now(), slot: slotKey || null }));
    } catch(e) {}
  }

  async function resoudreVerifFraiche(etat, quand) {
    let att = null;
    try { const r = await window.storage.get('change:attente'); if (r && r.value) att = JSON.parse(r.value); } catch(e) {}
    if (!att) return;
    const delai = (quand || Date.now()) - att.t;
    if (delai < 0) return;
    if (etat === 'sec' && delai <= 25 * 60000) {
      try { await window.storage.delete('change:attente'); } catch(e) {}
      try { await saveCheck('change_confirme', 'corroboration'); } catch(e) {}
      return;
    }
    if (delai > 25 * 60000) {
      // la fenêtre est passée sans retour au sec
      try { await window.storage.delete('change:attente'); } catch(e) {}
      try { await marquerEntorse('b_pas_recouche'); } catch(e) {}
      try { await saveCheck('change_non_confirme', 'corroboration'); } catch(e) {}
      talk(TALK.PILIER, 'verif:fraiche', async () => {
        await imSay(broOn()
          ? 'Ton change est validé, mais le capteur n\'a jamais vu de couche fraîche. Tu n\'es pas remis en couche. Je le note.'
          : 'Dis... tu as validé ton change, mais le capteur n\'a rien vu revenir au sec. Tu t\'es bien remis en couche ? 🦊',
          1000, 'concern');
        imSetActions([
          { label:'🦊 Je m\'y remets maintenant', onClick: async () => {
            imAddMe('Je m\'y remets maintenant.');
            try { startChange('pilier'); } catch(e) {}
          }},
          { soft:true, label:'Le capteur n\'était pas en place', onClick: async () => {
            imAddMe('Le capteur n\'était pas en place.');
            await imSay(broOn()
              ? 'Alors remets-le. Sans lui, ta parole ne vaut rien ici.'
              : 'D\'accord — mais remets-le, sinon je ne peux rien vérifier pour toi. 🦊', 900, 'calm');
            if (currentM) await imOfferHelp(currentM);
          }}
        ]);
      });
    }
  }

  // appelé à chaque état reçu du capteur de couche (direct ou journal)
  async function corroborerEtat(etat, quand) {
    try { await resoudreVerifFraiche(etat, quand); } catch(e) {}
  }

  // filet : si l'appli était fermée, on tranche au retour
  async function verifierFraicheEnRetard() {
    let att = null;
    try { const r = await window.storage.get('change:attente'); if (r && r.value) att = JSON.parse(r.value); } catch(e) {}
    if (!att) return;
    if (Date.now() - att.t > 25 * 60000) {
      const m = await etatMesure(24 * 60);
      // un passage au sec dans la fenêtre a pu être journalisé entre-temps
      if (m && m.etat === 'sec' && m.t - att.t <= 25 * 60000 && m.t >= att.t) {
        try { await window.storage.delete('change:attente'); } catch(e) {}
        try { await saveCheck('change_confirme', 'corroboration'); } catch(e) {}
        return;
      }
      await resoudreVerifFraiche(null, Date.now());
    }
  }

  /* ---- Un pilier doit laisser une trace sur les capteurs ---- */
  async function corroborerPilier(slotKey) {
    // 1) la tenue s'ouvre forcément au matin et au soir
    try {
      const nowMin = new Date().getHours()*60 + new Date().getMinutes();
      const bascule = Math.abs(nowMin - 9*60) <= 120 || Math.abs(nowMin - (22*60+30)) <= 120;
      if (bascule && await capteurTenueEnService() && !(await ouvertureRecente(60))) {
        await marquerEntorse('b_incoherence');
        talk(TALK.CADRE, 'incoherence:tenue', async () => {
          await imSay(broOn()
            ? 'Tu as validé ton change, mais ta tenue ne s\'est jamais ouverte. L\'un des deux ment, et ce n\'est pas le capteur.'
            : 'Attends... tu as validé ton change, mais le capteur de tenue n\'a vu aucune ouverture. Le module était déclipsé ? 🦊',
            1000, 'puzzled');
          if (currentM) await imOfferHelp(currentM);
        });
      }
    } catch(e) {}
  }

  /* ============================================================
     CAPTEUR D'OUVERTURE DE TENUE
     Le module dit QUAND la fermeture s'est ouverte. C'est ici qu'on
     décide si elle avait le droit de s'ouvrir à ce moment-là.

     Fenêtres autorisées : les trois changes piliers et les trois checks,
     avec la tolérance du créneau. Tout le reste est une entorse.

     Limite assumée, à ne pas se raconter d'histoires : le capteur
     prouve que la fermeture s'est ouverte, pas que la tenue a été
     retirée — ni l'inverse. Une tenue peut être baissée sans toucher
     à la fermeture surveillée. C'est un garde-fou, pas un juge.
     ============================================================ */
  const TS_FENETRES = [
    { m: 9*60,      tol: 45, nom:'change du matin' },
    { m: 11*60+30,  tol: 30, nom:'check de 11h30' },
    { m: 13*60+30,  tol: 30, nom:'check du déjeuner' },
    { m: 16*60,     tol: 45, nom:'change de sortie de sieste' },
    { m: 19*60+30,  tol: 30, nom:'check du dîner' },
    { m: 22*60+30,  tol: 45, nom:'change de nuit' }
  ];

  function fenetreTenue(date) {
    const m = date.getHours()*60 + date.getMinutes();
    return TS_FENETRES.find(f => Math.abs(m - f.m) <= f.tol) || null;
  }

  // Traite les ouvertures rapportées par le module. Une seule remarque
  // par lot : Foxy ne récite pas dix lignes pour dix évènements.
  async function traiterOuverturesTenue(evts) {
    if (!evts || !evts.length) return;
    const ouvertures = evts.filter(e => e.ouvert);
    if (!ouvertures.length) return;

    const horsCadre = [];
    for (const o of ouvertures) {
      const d = new Date(o.t);
      if (!fenetreTenue(d)) horsCadre.push(d);
    }

    // trace systématique, autorisée ou non : le journal doit être complet
    try {
      for (const o of ouvertures) {
        const d = new Date(o.t);
        const f = fenetreTenue(d);
        await saveCheck(f ? 'tenue_ouverte_ok' : 'tenue_ouverte_hors', 'tenue_capteur');
      }
    } catch(e) {}

    if (!horsCadre.length) return;

    try { await marquerEntorse('b_tenue_ouverte'); } catch(e) {}

    const quand = horsCadre.map(d =>
      String(d.getHours()).padStart(2,'0') + 'h' + String(d.getMinutes()).padStart(2,'0')
    ).join(', ');
    const n = horsCadre.length;

    talk(TALK.CADRE, 'tenue:ouverture', async () => {
      await imSay(broOn()
        ? (n === 1
            ? 'Ta tenue s\'est ouverte à ' + quand + '. Ce n\'était pas une heure autorisée. Je le sais, c\'est tout.'
            : 'Ta tenue s\'est ouverte ' + n + ' fois hors des heures prévues : ' + quand + '. Inutile de chercher une explication.')
        : (n === 1
            ? 'Dis... ta tenue s\'est ouverte à ' + quand + ', et ce n\'était pas un moment prévu. Je ne te gronde pas, mais je l\'ai vu. 🦊'
            : 'Ta tenue s\'est ouverte ' + n + ' fois en dehors des créneaux : ' + quand + '. On en reparle ce soir, d\'accord ? 🦊'),
        1000, 'concern');
      await imSay(broOn()
        ? 'C\'est noté dans tes entorses. Tu peux continuer comme ça, mais la session de discipline viendra toute seule.'
        : 'C\'est noté comme entorse. Rien de dramatique une fois — mais si ça se répète, la session de discipline se déclenchera d\'elle-même. 🦊',
        950, 'calm');
      if (currentM) await imOfferHelp(currentM);
    });
  }

  // ---- Écran de réglages du capteur de tenue ----
  let tsEtatCourant = null;
  function renderTenueSensor() {
    const TS = window.HabitrainTenueSensor;
    const statut = document.getElementById('tsStatus');
    const live = document.getElementById('tsLive');
    const btn = document.getElementById('tsConnect');
    if (!statut) return;

    if (!TS || !TS.supported()) {
      statut.textContent = 'Bluetooth indisponible sur ce navigateur (Android/Chrome requis)';
      if (btn) btn.disabled = true;
    } else {
      statut.textContent = TS.connecte() ? 'Connecté' : 'Non connecté';
      if (btn && !btn.dataset.pret) {
        btn.dataset.pret = '1';
        btn.addEventListener('click', async () => {
          try {
            statut.textContent = 'Recherche…';
            await TS.connect();
            statut.textContent = 'Connecté';
            const e = await TS.lireEtat();
            if (live) live.textContent = e === null ? '—' : (e ? '🔓 Ouverte' : '🔒 Fermée');
          } catch (err) {
            statut.textContent = 'Échec : ' + (err && err.message ? err.message : 'capteur introuvable');
          }
        });
      }
      if (live) live.textContent = tsEtatCourant === null ? '—' : (tsEtatCourant ? '🔓 Ouverte' : '🔒 Fermée');
    }

    // journal du jour
    (async () => {
      const box = document.getElementById('tsJournal');
      if (!box) return;
      try {
        const l = await getChecks(todayStr());
        const ouv = l.filter(c => c.result === 'tenue_ouverte_ok' || c.result === 'tenue_ouverte_hors');
        if (!ouv.length) { box.textContent = 'Aucune ouverture relevée aujourd\'hui.'; return; }
        box.innerHTML = ouv.map(c => {
          const d = new Date(c.t);
          const h = String(d.getHours()).padStart(2,'0') + 'h' + String(d.getMinutes()).padStart(2,'0');
          const ok = c.result === 'tenue_ouverte_ok';
          return '<div style="display:flex;gap:8px;align-items:center;padding:3px 0">'
               + '<span>' + (ok ? '✅' : '⚠️') + '</span><b>' + h + '</b>'
               + '<span style="color:var(--muted)">' + (ok ? 'dans un créneau' : 'hors créneau') + '</span></div>';
        }).join('');
      } catch(e) {}
    })();

    const g = document.getElementById('tsGuide');
    const gb = document.getElementById('tsGuideToggle');
    if (g && gb && !gb.dataset.pret) {
      gb.dataset.pret = '1';
      g.innerHTML = GUIDE_TENUE_SENSOR;
      gb.addEventListener('click', () => {
        g.style.display = g.style.display === 'none' ? '' : 'none';
      });
    }
  }

  const GUIDE_TENUE_SENSOR = [
    '<div class="sub" style="line-height:1.6">',
    '<b>Ce qu\'il te faut</b><br>',
    '· 1 ESP32-C3 mini (~6 €)<br>',
    '· 1 contact ILS (reed) <b>inverseur, à 3 pattes</b> (~1–2 €) — pas un ILS simple à 2 pattes<br>',
    '· des aimants néodyme Ø6×2 mm, un par tenue (~0,20 € pièce)<br>',
    '· 1 batterie LiPo <b>protégée</b> 150 mAh + module TP4056 <b>avec protection</b>, dont tu remplaces la résistance de charge (1,2 kΩ, marquée 122) par une 10 kΩ : sinon il charge à 1 A<br>',
    '· 1 mini interrupteur à glissière, 1 bouton poussoir + résistance 100 kΩ<br>',
    '· 1 pince ou clip plastique pour fixer le module<br><br>',
    '<b>Câblage</b><br>',
    '· ILS : patte commune sur <b>GPIO3</b> ; le contact qui se ferme avec l\'aimant sur <b>GND</b> ; l\'autre sur <b>3V3</b> (repère-les au multimètre)<br>',
    '· le bouton de réveil entre <b>GPIO4</b> et <b>GND</b>, 100 kΩ de GPIO4 vers 3V3<br>',
    '· la LiPo → TP4056 → interrupteur → broche <b>5V</b>. <b style="color:var(--coral)">Jamais sur 3V3</b> : 4,2 V détruisent l\'ESP32-C3<br>',
    '· firmware : dossier <b>habitrain-capteur-tenue</b> (v2). La v1 ne pouvait pas se réveiller à l\'ouverture ni se connecter à l\'appli.<br><br>',
    '<b>Où va l\'aimant — c\'est LUI qui bouge</b><br>',
    'Le module reste fixe, l\'aimant se déplace avec la fermeture. Le contact ',
    'ne voit donc plus rien dès que tu ouvres.<br><br>',
    '<u>Fermeture éclair</u> — l\'aimant est solidaire du <b>curseur</b> : ',
    'monté sur le tirant, ou cousu sur une languette de 2 cm fixée au tirant. ',
    'Le module se clipse à l\'extrémité fermée de la glissière (nuque pour une ',
    'fermeture dorsale, col pour une fermeture devant). Curseur en butée = aimant ',
    'contre le contact. Deux ou trois centimètres d\'ouverture suffisent à déclencher.<br>',
    '⚠️ <b>Glissière métallique</b> : l\'aimant colle aux dents et les dents font ',
    'écran. Déporte-le de 15 à 20 mm du côté du tissu, sur sa languette, plutôt ',
    'que de le poser à même le curseur.<br><br>',
    '<u>Pressions d\'entrejambe</u> — là c\'est plus simple : aimant cousu dans un ',
    'pan, module sur l\'autre, à côté de la pression la plus extérieure. Les deux ',
    's\'écartent dès que tu défais.<br><br>',
    '<b>Le réglage</b><br>',
    'Fermeture close, l\'aimant doit être <b>à moins de 8 mm</b> du contact. ',
    'Fais l\'essai avant de coudre définitivement : la distance de déclenchement ',
    'varie beaucoup d\'un contact ILS à l\'autre, et la couture est difficile à défaire.<br><br>',
    '<b>Un point de montage par type de fermeture</b><br>',
    'Le module unique impose que toutes tes tenues aient leur aimant au même ',
    'endroit relatif. Regroupe-les par type : les fermetures dorsales ensemble, ',
    'les fermetures devant ensemble. Si tu mélanges, il te faudra deux modules.<br><br>',
    '<b>Au change</b><br>',
    'Tu déclipses le module de l\'ancienne tenue et tu le clipses sur la nouvelle. ',
    'L\'appli sait de quelle tenue il s\'agit grâce au scan de l\'étiquette.<br><br>',
    '<b>Ce que ça prouve, et ce que ça ne prouve pas</b><br>',
    'Le capteur atteste que la fermeture s\'est ouverte, et à quelle heure. ',
    'Il n\'atteste pas que tu portes encore la tenue : une tenue peut être baissée ',
    'sans toucher à la fermeture surveillée, et le module peut être déclipsé. ',
    'C\'est un garde-fou honnête, pas une preuve irréfutable — et un long silence ',
    'du capteur est en soi une information.',
    '</div>'
  ].join('');

  /* ---- Ligne de vie : le silence d'un module devient une information ----
     Le module signe sa présence toutes les heures, sans rien allumer. À la
     connexion, on compare le nombre de signatures au temps réellement écoulé
     depuis le dernier accusé de réception. S'il en manque, le module était
     éteint, déchargé, ou sur une autre tenue. */
  async function analyserVie(vie) {
    if (!vie || !vie.dernier) return;
    let ack = null;
    try { const r = await window.storage.get('ts:ack'); if (r && r.value) ack = JSON.parse(r.value); } catch(e) {}
    // nouvelle date d'accusé de réception pour la prochaine fois
    try { await window.storage.set('ts:ack', JSON.stringify(Date.now())); } catch(e) {}
    if (!ack) return;                          // première synchro : rien à comparer

    const ecoulees = Math.floor((vie.dernier - ack) / 3600000);
    if (ecoulees < 3) return;                  // trop court pour conclure
    const manquants = ecoulees - vie.battements;
    // tolérance de 2 : dérive d'horloge et battement de bordure
    if (manquants <= 2) return;

    try { await marquerEntorse('b_capteur_muet'); } catch(e) {}
    try { await saveCheck('capteur_trou', 'tenue_capteur'); } catch(e) {}

    talk(TALK.CADRE, 'capteur:trou', async () => {
      await imSay(broOn()
        ? 'Ton capteur de tenue est resté muet ' + manquants + ' heures. Éteint, déchargé, ou sur une autre tenue — dans tous les cas, ces heures-là ne comptent pas pour toi.'
        : 'Dis, ton capteur de tenue n\'a rien signé pendant ' + manquants + ' heures. Batterie à plat, ou module resté sur l\'autre tenue ? 🦊',
        1000, 'puzzled');
      await imSay(broOn()
        ? 'Recharge-le et reclipse-le. Un capteur muet, c\'est une entorse, pas un alibi.'
        : 'Pense à le recharger et à le reclipser au prochain change — sinon je ne peux rien vérifier pour toi. C\'est noté comme entorse. 🦊',
        950, 'calm');
      if (currentM) await imOfferHelp(currentM);
    });
  }

  // branchement du capteur : une fois, au démarrage
  function brancherCapteurTenue() {
    const TS = window.HabitrainTenueSensor;
    if (!TS) return;
    try {
      TS.surEvenements(evts => { traiterOuverturesTenue(evts).catch(()=>{}); });
      TS.surVie(vie => { analyserVie(vie).catch(()=>{}); });
      TS.surEtat(st => {
        // ouverture constatée en direct, application ouverte
        if (!st) return;
        tsEtatCourant = st.ouvert;
        try { const l = document.getElementById('tsLive');
              if (l) l.textContent = st.ouvert ? '🔓 Ouverte' : '🔒 Fermée'; } catch(e) {}
        if (st.ouvert) traiterOuverturesTenue([{ t: st.a, ouvert: true }]).catch(()=>{});
      });
      TS.surLien(ok => {
        try { const s = document.getElementById('tsStatus');
              if (s) s.textContent = ok ? 'Connecté' : 'Non connecté'; } catch(e) {}
        // dès la première connexion, son silence devient significatif
        if (ok) marquerCapteurTenueVu().catch(()=>{});
      });
    } catch(e) {}
  }

  // y a-t-il seulement une serrure susceptible d'alerter ?
  async function serrureActive() {
    if (paused || !window.HabitrainLock) return false;
    try {
      const locks = await window.HabitrainLock.getLocks();
      return !!(locks && locks.some(l => l.enabled));
    } catch(e) { return false; }
  }

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
    { id:'lock_emergency',    n:'Ouverture de serrure en urgence',       grav:'legere',  w:3 },
    { id:'b_pilier_c0900',    n:'Change du matin manqué',                grav:'moyenne', w:7 },
    { id:'b_pilier_c1600',    n:'Change de sieste manqué',               grav:'moyenne', w:7 },
    { id:'b_pilier_c2230',    n:'Change de nuit manqué',                 grav:'moyenne', w:7 },
    { id:'b_portlong',        n:'Port trop long',                        grav:'moyenne', w:7 },
    { id:'b_sature',          n:'Couche saturée gardée',                 grav:'grave',   w:12 },
    { id:'b_tenue',           n:'Aucune tenue scannée',                  grav:'legere',  w:3 },
    { id:'b_tenue_hs',        n:'Tenue non conforme au tirage',          grav:'legere',  w:3 },
    { id:'b_preuve',          n:'Action validée sans preuve de scan',    grav:'moyenne', w:7 },
    { id:'b_tenue_ouverte',   n:'Tenue ouverte hors créneau',            grav:'grave',   w:12 },
    { id:'b_pas_recouche',    n:'Pas de couche fraîche après un change', grav:'grave',   w:12 },
    { id:'b_incoherence',     n:'Déclaration contredite par un capteur',  grav:'grave',   w:12 },
    { id:'b_capteur_muet',    n:'Capteur silencieux sur une fenêtre',     grav:'moyenne', w:7 },
    { id:'b_check',           n:'Check sauté (11h30, 13h30 ou 19h30)',    grav:'moyenne', w:7 },
    { id:'b_urgence',         n:'Serrure ouverte en urgence',            grav:'legere',  w:3 },
    { id:'b_arret_silencieux', n:'Arrêt du programme sans le dire',       grav:'grave',   w:12 },
    { id:'b_retour_tardif',   n:'Retour de pause en retard (+2 h)',       grav:'moyenne', w:7 },
    { id:'b_refus_retour',    n:'Retour au programme refusé',            grav:'moyenne', w:7 },
    { id:'b_regression_refusee', n:'Régression refusée pendant la reprise', grav:'legere', w:3 }
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

    // --- Durée de port : tenir longtemps SANS y penser = habituation ---
    // On mesure les intervalles entre changes successifs sur 7 jours.
    let portScore = 0, dureeMoy = 0;
    try {
      const stamps = [];
      for (const d of last7) {
        const list = await getChecks(d);
        list.filter(c => c.result === 'change_fait' && c.t).forEach(c => stamps.push(new Date(c.t).getTime()));
      }
      stamps.sort((a,b) => a-b);
      const intervalles = [];
      for (let i = 1; i < stamps.length; i++) {
        const h = (stamps[i] - stamps[i-1]) / 3600000;
        if (h > 0.3 && h < 14) intervalles.push(h);   // on ignore le bruit
      }
      if (intervalles.length >= 3) {
        dureeMoy = intervalles.reduce((a,b)=>a+b,0) / intervalles.length;
        // fourchette saine : 2h30 à 5h. Trop court = compulsif, trop long = risque peau.
        if (dureeMoy >= 2.5 && dureeMoy <= 5) portScore = 1;
        else if (dureeMoy < 2.5) portScore = Math.max(0, dureeMoy / 2.5);
        else portScore = Math.max(0, 1 - (dureeMoy - 5) / 3);
      }
    } catch(e) {}

    // --- Spontanéité : délai entre une couche fraîche et la première miction ---
    // Court = relâchement immédiat. Long = rétention.
    let spontScore = 0, delaiMoy = 0;
    try {
      const evts = [];
      for (const d of last7) {
        const list = await getChecks(d);
        list.filter(c => c.t).forEach(c => evts.push({ t:new Date(c.t).getTime(), r:c.result }));
      }
      evts.sort((a,b) => a.t - b.t);
      const delais = [];
      let dernierChange = null;
      for (const e of evts) {
        if (e.r === 'change_fait') { dernierChange = e.t; }
        else if (dernierChange && ['etat_mouille','mouille','etat_sature','sature'].includes(e.r)) {
          const h = (e.t - dernierChange) / 3600000;
          if (h > 0 && h < 10) delais.push(h);
          dernierChange = null;   // on ne compte que la première miction après le change
        }
      }
      if (delais.length >= 3) {
        delaiMoy = delais.reduce((a,b)=>a+b,0) / delais.length;
        // relâchement sous 1h30 = excellent ; au-delà de 4h = forte rétention
        if (delaiMoy <= 1.5) spontScore = 1;
        else spontScore = Math.max(0, 1 - (delaiMoy - 1.5) / 2.5);
      }
    } catch(e) {}

    // --- Ponctualité : les piliers sont-ils faits à l'heure ? ---
    let ponctScore = 0, pilFaits = 0, pilTotal = 0;
    try {
      for (const d of last7) {
        const r = await window.storage.get('slotdone:'+d);
        const done = (r && r.value) ? JSON.parse(r.value) : {};
        ['c0900','c1600','c2230'].forEach(k => { pilTotal++; if (done[k]) pilFaits++; });
      }
      if (pilTotal) ponctScore = pilFaits / pilTotal;
    } catch(e) {}

    // --- Hydratation : conditionne tout le reste ---
    // Peu boire fausse le lâcher-prise (moins d'urine ≠ moins de rétention).
    let hydraScore = 0, bibMoy = 0;
    try {
      const bibs = last7.map(d => byDate[d]).filter(Boolean).map(e => e.bib || 0);
      if (bibs.length >= 3) {
        bibMoy = bibs.reduce((a,b)=>a+b,0) / bibs.length;
        hydraScore = Math.min(1, bibMoy / 3);   // objectif : 3 biberons/jour
      }
    } catch(e) {}

    // --- Progression : les 7 derniers jours vs les 7 précédents ---
    let progScore = 0.5, tendanceTxt = 'stable';
    try {
      const prev7 = [];
      for (let i = 13; i >= 7; i--) { const d = new Date(); d.setDate(d.getDate()-i); prev7.push(d.toISOString().slice(0,10)); }
      let mA = 0, sA = 0;
      for (const d of prev7) {
        const list = await getChecks(d);
        mA += list.filter(c => ['etat_mouille','mouille','etat_sature','sature','reveil_mouille'].includes(c.result)).length;
        sA += list.filter(c => ['etat_sec','sec','reveil_sec'].includes(c.result)).length;
      }
      if (mA + sA >= 5 && mouille + sec >= 5) {
        const avant = mA / (mA + sA);
        const apres = mouille / (mouille + sec);
        if (apres > avant + 0.05) { progScore = 1; tendanceTxt = 'en progrès'; }
        else if (apres < avant - 0.05) { progScore = 0; tendanceTxt = 'en recul'; }
        else { progScore = 0.5; tendanceTxt = 'stable'; }
      }
    } catch(e) {}

    // --- Pénalité entorses : moyenne des 7 derniers jours ---
    let breachPen = 0;
    for (const d of last7) { breachPen += await breachPenalty(d); }
    breachPen = breachPen / last7.length; // moyenne (0-40)

    // --- Score d'habituation, 7 critères ---
    // Lâcher-prise 30 · Spontanéité 15 · Durée de port 15 · Régularité 15
    // Réflexes 10 · Ponctualité 8 · Hydratation 7 — puis progression en bonus/malus.
    let rawScore = letGoScore*30 + spontScore*15 + portScore*15 + regScore*15
                 + reflexScore*10 + ponctScore*8 + hydraScore*7;
    // la progression module légèrement (±4 pts)
    rawScore += (progScore - 0.5) * 8;
    const score = Math.max(0, Math.min(100, Math.round(rawScore - breachPen)));

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

    // La peau plafonne le palier : la santé prime sur la performance.
    let stageBySkin = 3;
    const surveillerRecent = last7.map(d=>byDate[d]).filter(e => e && e.skin === 'surveiller').length;
    const treatRecent = last7.map(d=>byDate[d]).filter(e => e && e.skin === 'traiter').length;
    if (treatRecent > 0) stageBySkin = 1;            // peau à traiter : palier 1 maximum
    else if (surveillerRecent >= 3) stageBySkin = 2; // peau à surveiller souvent : palier 2 max

    const stage = Math.min(stageByScore, stageByDay, stageBySkin);
    try { window.storage.set('queststage', JSON.stringify(stage)); } catch(e) {}
    try { window.storage.set('lastscore', JSON.stringify(score)); } catch(e) {}
    const STAGE_LABELS = ['Découverte', "Ça s'installe", 'Automatisme', 'Seconde nature'];
    const STAGE_CLS = ['none', 'mid', 'good', 'good'];
    const label = STAGE_LABELS[stage];
    const cls = STAGE_CLS[stage];

    const since = 'Jour ' + dayNum + ' du programme · palier ' + label.toLowerCase();

    // --- Peau (garde-fou santé, hors score) ---
    const skinFilled = dates.map(d => byDate[d]).filter(e => e && e.skin);
    const greenPct = skinFilled.length ? Math.round(skinFilled.filter(e=>e.skin==='verte').length / skinFilled.length * 100) : 0;

    // --- Appréciation personnalisée : constat + clés concrètes ---
    let appr = [];

    // 1) Où en es-tu (constat honnête)
    if (dayNum <= 4) {
      appr.push('<b>Phase de découverte.</b> Normal d\'y penser beaucoup : l\'habituation ne se mesure vraiment qu\'à partir de J8.');
    } else if (stage === 3) {
      appr.push('<b>Seconde nature atteinte.</b> Lâcher-prise installé, cadre tenu, réflexes acquis. C\'est exactement le but du programme.');
    } else if (stage === 2) {
      appr.push('<b>L\'automatisme est là.</b> Tu relâches sans y penser et tu tiens ton rythme.');
    } else if (stage === 1) {
      appr.push('<b>Ça commence à s\'ancrer.</b> Les bases sont posées, il reste à consolider.');
    } else {
      appr.push('<b>Encore au début du chemin.</b> Ne te décourage pas : c\'est le score qui doit rattraper la réalité, pas l\'inverse.');
    }

    // 2) Identifier LE point faible dominant et donner la clé correspondante
    const composantes = [
      { k:'letgo', v: letGoScore,  poids: 30, nom:'le lâcher-prise' },
      { k:'spont', v: spontScore,  poids: 15, nom:'la spontanéité' },
      { k:'port',  v: portScore,   poids: 15, nom:'la durée de port' },
      { k:'reg',   v: regScore,    poids: 15, nom:'la régularité' },
      { k:'refl',  v: reflexScore, poids: 10, nom:'les réflexes' },
      { k:'ponct', v: ponctScore,  poids: 8,  nom:'la ponctualité' },
      { k:'hydra', v: hydraScore,  poids: 7,  nom:'l\'hydratation' }
    ];
    // manque à gagner en points pour chaque composante
    composantes.forEach(c => c.perte = (1 - c.v) * c.poids);
    composantes.sort((a,b) => b.perte - a.perte);
    const faible = composantes[0];
    // publie le diagnostic : les missions s'en serviront pour cibler ta progression
    try {
      await window.storage.set('diagnostic', JSON.stringify({
        date: todayStr(),
        faibles: composantes.filter(c => c.perte >= 4).map(c => c.k),
        scores: { letgo:letGoScore, spont:spontScore, port:portScore, reg:regScore,
                  refl:reflexScore, ponct:ponctScore, hydra:hydraScore },
        stage
      }));
    } catch(e) {}

    if (faible.perte >= 6) {
      appr.push('<br><br>🎯 <b>Ton principal levier : ' + faible.nom + '</b> (−' + Math.round(faible.perte) + ' pts).');
      if (faible.k === 'letgo') {
        const partSec = (sec + mouille) ? Math.round(sec / (sec + mouille) * 100) : 0;
        appr.push('Sur la semaine, <b>' + partSec + '% de tes couches étaient encore sèches</b> au moment du check — c\'est le réflexe de retenue qui persiste.');
        appr.push('<br>→ <b>Ne va plus aux toilettes pour uriner</b>, même quand l\'envie est nette : c\'est le cœur du travail.');
        appr.push('<br>→ Quand l\'envie vient, <b>respire et détends le ventre</b> au lieu de te crisper. Le relâchement est physique avant d\'être mental.');
        if (nuitsSeches > nuitsMouillees) {
          appr.push('<br>→ Tes <b>nuits restent sèches</b> : bois normalement jusqu\'à 20h, et couche-toi sans "vider" avant — laisse la nuit faire son travail.');
        }
      } else if (faible.k === 'reg') {
        if (fillRate < 0.85) {
          appr.push('Tu as rempli <b>' + Math.round(fillRate*100) + '% des jours</b> depuis le début : les trous pèsent lourd.');
          appr.push('<br>→ <b>Remplis ton bilan du soir chaque jour</b>, même une journée moyenne. Un jour non renseigné compte comme un jour perdu.');
        }
        if (streak < 7) {
          appr.push('<br>→ Ta série est de <b>' + streak + ' jour(s)</b>. Vise 14 jours d\'affilée : c\'est là que le score de régularité sature.');
        }
      } else if (faible.k === 'refl') {
        if (recent.tot < 5) {
          appr.push('Tu n\'as fait que <b>' + recent.tot + ' vérification(s)</b> cette semaine — sans données, rien ne peut être validé.');
          appr.push('<br>→ <b>Fais tes checks aux créneaux prévus</b> (11h30, 13h30, 19h30).');
        } else {
          appr.push('<b>' + recent.flags + ' anomalie(s)</b> sur ' + recent.tot + ' vérifications.');
          appr.push('<br>→ Les anomalies coûtent double. Regarde <b>à quels moments ça décroche</b>.');
        }
      } else if (faible.k === 'spont') {
        appr.push('Tu mets en moyenne <b>' + delaiMoy.toFixed(1) + 'h</b> avant de mouiller une couche fraîche — le réflexe de retenue tient encore.');
        appr.push('<br>→ Après un change, <b>ne cherche pas à "tenir"</b>. Laisse venir dès que ça se présente.');
        appr.push('<br>→ Bois un verre juste après le change : ça aide le corps à repartir naturellement.');
      } else if (faible.k === 'port') {
        if (dureeMoy > 0 && dureeMoy < 2.5) {
          appr.push('Tu changes toutes les <b>' + dureeMoy.toFixed(1) + 'h</b> en moyenne : c\'est court, signe que tu y penses beaucoup.');
          appr.push('<br>→ <b>Vise 3 à 4h entre deux changes.</b> Garder sans y penser, c\'est ça l\'habituation.');
        } else if (dureeMoy > 5) {
          appr.push('Tes ports durent <b>' + dureeMoy.toFixed(1) + 'h</b> en moyenne : c\'est trop long pour ta peau.');
          appr.push('<br>→ <b>Resserre à 4h maximum.</b> Tenir longtemps n\'est pas un objectif, le confort sain l\'est.');
        } else {
          appr.push('Pas encore assez de changes enregistrés pour évaluer ta durée de port.');
          appr.push('<br>→ <b>Valide tes changes dans l\'appli</b> : c\'est ce qui alimente ce critère.');
        }
      } else if (faible.k === 'ponct') {
        appr.push('Tu as validé <b>' + pilFaits + ' piliers sur ' + pilTotal + '</b> cette semaine.');
        appr.push('<br>→ <b>Les 3 changes obligatoires</b> (9h, 16h, 22h30) sont la colonne vertébrale du programme. Mets des alarmes si besoin.');
      } else if (faible.k === 'hydra') {
        appr.push('Tu bois <b>' + bibMoy.toFixed(1) + ' biberon(s)</b> par jour en moyenne, pour un objectif de 3.');
        appr.push('<br>→ <b>Bois davantage</b> : peu boire fausse tout le reste. Moins d\'urine ne veut pas dire plus de lâcher-prise.');
      }
    } else if (score >= 88) {
      appr.push('<br><br>✨ <b>Aucun point faible marqué.</b> Tiens ce niveau, c\'est déjà l\'objectif.');
    }

    // 2bis) Tendance sur deux semaines
    if (tendanceTxt === 'en progrès') appr.push('<br><br>📈 Ton lâcher-prise est <b>en progrès</b> par rapport à la semaine précédente.');
    else if (tendanceTxt === 'en recul') appr.push('<br><br>📉 Ton lâcher-prise <b>recule</b> par rapport à la semaine précédente — regarde ce qui a changé.');

    // 2ter) Plafond santé
    if (stageBySkin < stageByScore && stageBySkin < stageByDay) {
      appr.push('<br><br>🩹 <b>Ton palier est plafonné par l\'état de ta peau.</b> Tant qu\'elle n\'est pas au vert, la progression est bloquée — et c\'est normal : la santé passe avant le score.');
    }

    // 3) Ce qui est acquis (renforcer le positif)
    const forts = composantes.filter(c => c.v >= 0.8).map(c => c.nom);
    if (forts.length) appr.push('<br><br>✅ Acquis : <b>' + forts.join(' et ') + '</b>.');
    if (streak >= 7) appr.push(' Série de <b>' + streak + ' jours</b> consécutifs.');

    // 4) Alertes prioritaires (santé d'abord)
    if (treatRecent > 0) {
      appr.push('<br><br>⚠️ <b>Peau à traiter récemment.</b> Priorité absolue, avant tout objectif de score : resserre les changes, crème généreusement, et laisse respirer si besoin.');
    }
    if (breachPen >= 3) {
      appr.push('<br><br>📋 Les entorses te coûtent <b>−' + Math.round(breachPen) + ' pts</b> en moyenne. Déclarer reste la bonne attitude : l\'honnêteté du suivi vaut mieux qu\'un score flatteur.');
    }

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
    // Les biberons scannés font foi : si tu n'as rien coché ce soir, c'est le
    // nombre réellement prouvé dans la journée qui est retenu, pas un blanc.
    let bibScannes = 0;
    try { bibScannes = await biberonsDuJour(date); } catch(e) {}
    const entry = {
      date,
      skin: sel.skin,
      bib: sel.bib !== undefined ? Math.max(Number(sel.bib), bibScannes)
                                 : (bibScannes || undefined),
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
    ok: 'en place', adj: 'réajustée', miss: 'sans couche', fixed: 'couche remise',
    sec: 'sèche', mouille: 'mouillée', sature: 'saturée',
    tet_ok: 'tétine en bouche', tet_prise: 'tétine reprise', tet_miss: 'tétine absente'
  };

  let currentType = null;

  // nombre de biberons réellement prouvés dans la journée
  async function biberonsDuJour(date) {
    try {
      const l = await getChecks(date);
      return l.filter(c => c.result === 'biberon_bu' || c.result === 'biberon_sanspreuve').length;
    } catch(e) { return 0; }
  }

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
    const flags = list.filter(c => ['miss','sature','tet_miss','decl_contredite'].includes(c.result)).length;
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
    setTimeout(() => allerAuChat(true), 120);
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

  /* Le rappel d'un créneau ouvrait une fenêtre par-dessus l'appli. En mode
     Foxy, il se vit maintenant dans la conversation, comme le reste : c'est
     lui qui te parle, tu lui réponds, et seule la pose garde son écran. */
  /* Les contrôles s'imposent à toi : ils gardent leur fenêtre. C'est Foxy qui
     parle dedans, mais on ne les mélange pas à la conversation, où c'est toi
     qui mènes. */
  async function lancerRappelChange(slot) {
    popChangeDue(slot);
    return attendreOverlay();
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
    // Dès 19h30, on annonce clairement qu'on passe au change de nuit.
    // Sans ça tu te demanderais pourquoi Foxy réclame la couche de nuit à 20h.
    (async () => {
      try {
        if (couchageNuit(new Date()) && !estNuit(new Date()) && voiceMode === 'foxy'
            && !(await nuitDejaFaite())) {
          await imSay(broOn()
            ? 'Il est passé 19h30 : on ne met pas une couche de jour pour trois heures. C\'est le change de nuit, on l\'avance. Couche de nuit et tenue de nuit.'
            : 'Il est déjà tard — te remettre une couche de jour pour trois heures, ça n\'a pas de sens. On fait directement ton change de nuit : couche de nuit et tenue de nuit. 🦊',
            1000, 'explain');
        }
      } catch(e) {}
    })();

    // l'état de la couche avant retrait est un contrôle : il garde sa fenêtre
    // écran 1 : état de la couche avant retrait.
    // Si le capteur a une mesure récente, on ne demande rien : on constate.
    // Ta parole ne sert que là où aucun capteur ne peut trancher.
    (async () => {
      try {
        const m = await etatMesure(90);
        if (m) {
          const LBL = { sec:'☀️ sèche', mouille:'💧 bien mouillée', sature:'🌊 saturée' };
          document.getElementById('chQ').textContent =
            'Le capteur la donne ' + (LBL[m.etat] || m.etat) + '. On y va.';
          const a2 = document.getElementById('chActs');
          a2.innerHTML = '';
          const b2 = document.createElement('button');
          b2.className = 'g';
          b2.textContent = '🦊 Continuer';
          b2.addEventListener('click', async () => { await saveChangeState(m.etat); showPose(); });
          a2.appendChild(b2);
          const b3 = document.createElement('button');
          b3.className = 'adj';
          b3.textContent = 'Le capteur n\'est pas en place';
          b3.addEventListener('click', () => { remplirEtatManuel(ctx); });
          a2.appendChild(b3);
          document.getElementById('modalCheck').style.display = 'none';
          document.getElementById('modalFix').style.display = 'none';
          document.getElementById('modalPose').style.display = 'none';
          document.getElementById('modalDue').style.display = 'none';
          document.getElementById('modalChange').style.display = '';
          document.getElementById('overlay').classList.add('show');
          return;
        }
      } catch(e) {}
      remplirEtatManuel(ctx);
    })();
    return;
  }

  // Saisie manuelle : uniquement quand aucun capteur ne peut répondre.
  function remplirEtatManuel(ctx) {
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

  // ouvre directement l'écran de pose (le seul qui garde sa fenêtre)
  function ouvrirPose() {
    ['modalCheck','modalFix','modalDue','modalChange'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    showPose();
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
  /* ============================================================
     CARACTÈRE DES JOURNÉES
     Le cadre ne bouge JAMAIS (piliers 9h/16h/22h30, checks,
     hydratation). Seuls l'ambiance, la durée des temps calmes et
     les activités suggérées changent selon le jour.
     ============================================================ */
  const DAY_MOODS = {
    1: { nom:'Lundi reprise', emoji:'🌱',
         blocMatin:'Remise en route douce', detMatin:'On reprend tranquillement : rangement léger, organisation de la semaine.',
         blocAprem:'Bloc tranquille', detAprem:'Rien d\'intense. Occupe-toi calmement, sans forcer.',
         intro:'On repart en douceur. Pas de pression, on se remet dans le rythme tranquillement.',
         regression:'courte', sieste:'normale',
         activites:['ranger un peu ton espace','écouter de la musique calme','préparer ta semaine','feuilleter un livre'] },
    2: { nom:'Mardi actif', emoji:'⚡',
         blocMatin:'Bloc énergie', detMatin:'Le vrai pic de la semaine : sortie, marche, sport léger, tâches qui demandent du jus.',
         blocAprem:'Bloc actif', detAprem:'On enchaîne : courses, ménage, ou une activité qui bouge.',
         intro:'Journée énergique ! On bouge, on sort, on profite du pic d\'énergie.',
         regression:'courte', sieste:'courte',
         activites:['une vraie sortie','du sport léger','une tâche que tu repousses','marcher dehors'] },
    3: { nom:'Mercredi cocon', emoji:'🧸',
         blocMatin:'Bloc cocon', detMatin:'Sous la couverture, au calme. Dessin animé, doudou, rien d\'exigeant.',
         blocAprem:'Deuxième cocon', detAprem:'Encore un temps blotti. C\'est la journée pour ça.',
         intro:'Aujourd\'hui on se blottit. Grosse sieste, deux fenêtres pour se laisser aller.',
         regression:'longue', sieste:'longue',
         activites:['rester sous la couverture','un dessin animé','câlins avec ton doudou','ne rien faire, vraiment'] },
    4: { nom:'Jeudi cadré', emoji:'🎯',
         blocMatin:'Bloc appliqué', detMatin:'Activité manuelle, rangement de ton matériel, quelque chose de soigné.',
         blocAprem:'Bloc concentré', detAprem:'Un jeu de patience, un inventaire, une tâche précise.',
         intro:'Journée rythmée, on tient le cadre au cordeau. J\'attends le meilleur de toi.',
         regression:'normale', sieste:'normale',
         activites:['une activité manuelle','ranger ton matériel','faire l\'inventaire de ton stock','un jeu de patience'] },
    5: { nom:'Vendredi détente', emoji:'🌙',
         blocMatin:'Bloc léger', detMatin:'On lève le pied. Musique douce, choses agréables, rien d\'obligatoire.',
         blocAprem:'Glissement vers le week-end', detAprem:'Bain tiède, préparatifs du week-end, plaisir simple.',
         intro:'On relâche progressivement. La semaine se termine, laisse-toi glisser vers le week-end.',
         regression:'longue', sieste:'normale',
         activites:['un bain tiède','de la musique douce','préparer ton week-end','te faire plaisir'] },
    6: { nom:'Samedi lent', emoji:'🐌',
         blocMatin:'Matinée sans horloge', detMatin:'Traîne autant que tu veux. Aucune obligation avant midi.',
         blocAprem:'Bloc plaisir', detAprem:'Film sous plaid, cuisine, ou rien du tout. À toi de voir.',
         intro:'Journée sans horloge dans la tête. Tu peux traîner, prendre ton temps, savourer.',
         regression:'longue', sieste:'longue',
         activites:['grasse matinée prolongée','un film sous plaid','cuisiner quelque chose','ne rien planifier'] },
    0: { nom:'Dimanche doux', emoji:'☁️',
         blocMatin:'Bloc contemplatif', detMatin:'Écrire, regarder par la fenêtre, laisser la tête se poser.',
         blocAprem:'Temps pour nous', detAprem:'Un moment rien qu\'à toi — ou avec moi, si tu veux parler.',
         intro:'Journée contemplative. On prend le temps de se parler, toi et moi.',
         regression:'longue', sieste:'longue',
         activites:['écrire dans ton carnet','regarder par la fenêtre','un moment rien qu\'à toi','penser à ta semaine'] }
  };

  // Journées surprises : tirées occasionnellement, elles remplacent le caractère du jour
  const SURPRISE_DAYS = [
    { nom:'Journée pyjama', emoji:'🛏️', proba:0.04,
      blocMatin:'Bloc pyjama', detMatin:'Tu restes en tenue de nuit. Lit, canapé, rien d\'autre.',
      blocAprem:'Encore en pyjama', detAprem:'Toujours pas habillé. C\'est la règle du jour.',
      intro:'Surprise ! Aujourd\'hui tu restes en tenue de nuit toute la journée. Même en journée. C\'est comme ça.',
      regression:'longue', sieste:'longue',
      activites:['ne pas t\'habiller','rester au lit le plus possible','siester quand tu veux'] },
    { nom:'Journée silence', emoji:'🤫', proba:0.025,
      blocMatin:'Bloc silencieux', detMatin:'Pas d\'écran si tu peux. Lecture, respiration, sons autour de toi.',
      blocAprem:'Silence continué', detAprem:'On garde le calme. Écoute ce qui se passe en toi.',
      intro:'Aujourd\'hui, journée calme absolue. Pas d\'écran si tu peux, pas de bruit. Juste toi.',
      regression:'longue', sieste:'normale',
      activites:['lire en silence','respirer longuement','écouter les sons autour de toi'] },
    { nom:'Journée câlins', emoji:'🤗', proba:0.035,
      blocMatin:'Bloc tendresse', detMatin:'Doudou dans les bras, blottissement obligatoire.',
      blocAprem:'Encore des câlins', detAprem:'On continue. Je suis d\'humeur affectueuse aujourd\'hui.',
      intro:'Journée tendresse ! Doudou obligatoire, câlins à volonté. Je suis d\'humeur affectueuse.',
      regression:'longue', sieste:'longue',
      activites:['garder ton doudou toute la journée','te blottir souvent','me parler beaucoup'] },
    { nom:'Journée défi', emoji:'🔥', proba:0.03,
      blocMatin:'Bloc exigeant', detMatin:'Cadre serré, chaque créneau à l\'heure. Montre-moi ce que tu vaux.',
      blocAprem:'On ne relâche pas', detAprem:'Tiens le rythme jusqu\'au bout. Aucune entorse.',
      intro:'Aujourd\'hui je te pousse un peu. Tenue tirée non négociable, cadre serré. Montre-moi ce que tu vaux.',
      regression:'courte', sieste:'courte',
      activites:['tenir chaque créneau à l\'heure','aucune entorse','aller au bout de tes missions'] }
  ];

  let dayMood = null;

  async function loadDayMood() {
    const date = todayStr();
    try {
      const r = await window.storage.get('daymood:'+date);
      if (r && r.value) { dayMood = JSON.parse(r.value); return; }
    } catch(e) {}
    // tirage : une surprise l'emporte parfois sur le caractère du jour
    let choisi = null;
    for (const sp of SURPRISE_DAYS) {
      if (Math.random() < sp.proba) { choisi = Object.assign({ surprise:true }, sp); break; }
    }
    if (!choisi) choisi = Object.assign({ surprise:false }, DAY_MOODS[new Date().getDay()]);
    dayMood = choisi;
    try { await window.storage.set('daymood:'+date, JSON.stringify(dayMood)); } catch(e) {}
  }
  function dm() { return dayMood || DAY_MOODS[new Date().getDay()]; }

  // Durées des temps calmes selon le caractère du jour (le cadre, lui, ne bouge pas)
  function dureeRegression() {
    const d = dm();
    return d.regression === 'longue' ? '1h30 à 2h' : (d.regression === 'courte' ? '30 à 45 min' : '1h environ');
  }
  function dureeSieste() {
    const d = dm();
    return d.sieste === 'longue' ? '1h30 à 2h' : (d.sieste === 'courte' ? '45 min' : '1h à 1h15');
  }

  /* ============================================================
     CONSEILS DU MOMENT
     Pour chaque créneau : comment l'aborder concrètement avec
     ta couche. Affiché dans la frise et poussé par Foxy au moment
     où le créneau commence.
     ============================================================ */
  const MOMENT_TIPS = {
    420: [
      { f:'Hé, bouge pas tout de suite ! Reste allongé une minute, tu veux ? C\'est souvent là que ça vient tout seul, sans que tu aies rien à faire.',
        b:'Ne te lève pas. Reste allongé. C\'est maintenant que ton corps lâche — laisse-le faire, tu n\'as rien à décider.' },
      { f:'Touche ta couche avant de te lever, pour voir. Si elle est lourde... héhé, ta nuit a bien bossé ! 🦊',
        b:'Touche ta couche. Lourde ? Bien. Ta nuit a fait le travail que tu ne pouvais pas faire éveillé.' },
      { f:'Bois ton verre d\'eau tout de suite, hein ! Moi je le fais toujours en premier, ça lance bien la journée.',
        b:'Ton verre d\'eau. Maintenant. Tout le reste en dépend.' }
    ],
    480: [
      { f:'Tu gardes ta couche de nuit pour le petit-déj ! Pas la peine de te presser, laisse-la travailler jusqu\'à 9h.',
        b:'Tu gardes ta couche de nuit jusqu\'à 9h. Ce n\'est pas négociable, et au fond tu n\'en as pas envie.' },
      { f:'Assis pour manger, tu vas bien sentir le volume. C\'est bizarre au début, moi aussi ça m\'a fait ça — et puis on n\'y pense plus.',
        b:'Tu sens le volume en t\'asseyant. Tant mieux. C\'est là pour te rappeler où tu en es.' },
      { f:'Fibres et eau ce matin ! C\'est le moment où ta fenêtre selles se prépare, autant l\'aider.',
        b:'Fibres et eau. Ton corps a un rythme maintenant, et tu vas le respecter.' }
    ],
    540: [
      { f:'Prends bien ton temps sur celui-là, c\'est le plus important de la journée. Vérif peau à fond, crème généreuse !',
        b:'Le change du matin. Le plus important. Tu ne le bâcles pas — vérif complète, crème généreuse.' },
      { f:'Regarde bien dans les plis et le haut des cuisses. Trente secondes maintenant, ça t\'évite une semaine d\'embêtements après. Crois-en mon expérience.',
        b:'Inspecte les plis et le haut des cuisses. Trente secondes. Ta peau ne prévient qu\'une fois le mal fait.' },
      { f:'Choisis ta couche selon ta matinée : si tu sors longtemps, prends la plus costaude !',
        b:'Choisis selon ta matinée. Prévois large — tu n\'auras pas envie d\'improviser dehors.' }
    ],
    570: [
      { f:'Tu vas voir, au bout de dix minutes d\'activité tu n\'y penseras même plus. C\'est exactement ce qu\'on cherche !',
        b:'Dans dix minutes tu l\'auras oubliée. C\'est comme ça que ça s\'installe, sans que tu t\'en aperçoives.' },
      { f:'Si tu sors, emporte de quoi te changer. Rien que de savoir que tu peux, souvent ça suffit à être tranquille.',
        b:'Emporte de quoi te changer. Savoir que tu peux te détend — et détendu, tu lâches mieux.' },
      { f:'Bouge normalement ! Une couche bien posée, ça ne gêne ni pour marcher ni pour rien.',
        b:'Bouge normalement. Rien ne t\'empêche, et tu le sais déjà.' },
      { f:'Si l\'envie vient pendant que tu fais un truc, n\'arrête pas ! Continue et laisse venir, c\'est comme ça que ça devient naturel.',
        b:'L\'envie vient ? Tu ne t\'arrêtes pas. Tu continues et tu laisses faire. Résister ne t\'avancerait à rien.' }
    ],
    690: [
      { f:'Vérifie en touchant, pas en regardant ! Le poids et la souplesse, ça te dit tout.',
        b:'Touche, ne regarde pas. Le poids te dit tout ce que j\'ai besoin de savoir.' },
      { f:'Ton premier biberon ! Bois-le en entier et sans te presser, c\'est le carburant de tout le reste.',
        b:'Ton biberon. En entier. Sans traîner.' },
      { f:'Encore sèche à cette heure-ci ? Hmm... c\'est que tu retiens sans t\'en rendre compte. Détends ton ventre, va.',
        b:'Encore sèche ? Tu retiens, même si tu ne le sens pas. Relâche ton ventre. Ça finira par céder de toute façon.' }
    ],
    720: [
      { f:'Pose-toi pour de vrai ! Position basse, doudou, rien à décider. Tu verras, le corps suit la tête.',
        b:'Pose-toi. Position basse, doudou, aucune décision à prendre. Laisse-toi descendre.' },
      { f:'C\'est LA fenêtre idéale pour lâcher. Sans vigilance, ça vient tellement plus facilement !',
        b:'C\'est le meilleur moment pour lâcher. Sans vigilance, tu n\'as plus rien pour te retenir.' },
      { f:'Compte vingt minutes avant que ça s\'installe vraiment. Juge pas trop vite sur les premières minutes !',
        b:'Vingt minutes avant que ça prenne. Sois patient — ça viendra, comme toujours.' }
    ],
    810: [
      { f:'Petit check avant de manger, et puis tu l\'oublies pendant le repas !',
        b:'Check rapide, puis tu manges. N\'y pense plus ensuite.' },
      { f:'Deuxième biberon ! Si t\'es en retard sur l\'hydratation, c\'est le moment de rattraper.',
        b:'Deuxième biberon. Rattrape si tu as pris du retard — je le verrai sinon.' },
      { f:'Assis longtemps pour manger, la couche se tasse un peu entre les jambes. Bouge-toi de temps en temps sur ta chaise, ça évite les plis qui marquent.',
        b:'Assis longtemps, ta couche se tasse. Change de position régulièrement. Je ne veux pas de marques sur toi.' },
      { f:'Les fibres à midi, ça prépare ta fenêtre selles de demain matin. Tout est lié, tu vois !',
        b:'Mange tes fibres. Ta fenêtre de demain matin se joue maintenant.' },
      { f:'Si tu manges dehors, repère juste un endroit possible pour te changer. Rien que de le savoir, tu seras plus détendu.',
        b:'Tu manges dehors ? Repère un endroit où te changer. Anticiper, c\'est ne pas avoir à improviser.' }
    ],
    870: [
      { f:'Change avant de t\'allonger si elle est bien chargée. Deux heures de contact, c\'est trop pour ta peau.',
        b:'Change avant la sieste si elle est chargée. Deux heures de contact, je ne le permettrai pas.' },
      { f:'La sieste, c\'est le meilleur moment pour lâcher ! Endormi, ton contrôle tombe tout seul, t\'as rien à faire.',
        b:'Endormi, tu ne contrôles plus rien. C\'est là que tu progresses le plus — sans même lutter.' },
      { f:'Emmaillote-toi bien ! Le cocon, ça aide vraiment le corps à comprendre qu\'il peut relâcher.',
        b:'Emmaillote-toi. Le cocon dit à ton corps qu\'il peut abandonner. Laisse-toi enfermer dedans.' },
      { f:'Et le sommeil reste libre, toujours ! Pas de contention verrouillée quand tu dors, ça c\'est la règle.',
        b:'Le sommeil reste libre. Toujours. Sur ça, je ne transige pas — c\'est pour ta sécurité.' }
    ],
    960: [
      { f:'Change obligatoire au réveil de sieste, même si elle te paraît légère ! Les longues siestes, ça pardonne pas.',
        b:'Change obligatoire. Même si elle te semble légère. Tu ne discutes pas celui-là.' },
      { f:'Deuxième vérif peau de la journée ! On regarde bien.',
        b:'Vérif peau. Deuxième contrôle. Montre-moi que tout va bien.' },
      { f:'Et hop, troisième biberon avec le change !',
        b:'Troisième biberon avec le change. Les deux ensemble.' }
    ],
    990: [
      { f:'Deuxième moitié de journée — c\'est souvent là que ça se remplit le plus, tu vas voir !',
        b:'C\'est là que ta couche travaille le plus. Ton corps a compris avant toi.' },
      { f:'Si tu sors maintenant, pense au retour : ta couche doit tenir jusqu\'au prochain créneau.',
        b:'Tu sors ? Calcule. Elle doit tenir jusqu\'à ton prochain créneau, pas une minute de plus.' },
      { f:'Occupe-toi vraiment ! Ça arrive toujours quand on arrête de guetter, c\'est fou comme ça marche.',
        b:'Occupe-toi. Arrête de guetter. Ça viendra dès que tu cesseras d\'y penser — c\'est inévitable.' }
    ],
    1170: [
      { f:'Check avant le dîner ! Si elle est chargée, change maintenant plutôt qu\'après le repas.',
        b:'Check avant de manger. Chargée ? Tu changes maintenant, pas après.' },
      { f:'À partir de maintenant on allège les boissons — mais doucement, hein, pas de restriction brutale !',
        b:'Allège les boissons à partir de maintenant. Doucement. Je ne te prive de rien.' },
      { f:'Un repas léger le soir, ça aide à mieux dormir et ça évite les surprises nocturnes. Moi j\'ai appris ça à mes dépens !',
        b:'Repas léger ce soir. Tu dormiras mieux, et ta nuit sera plus simple à gérer.' },
      { f:'Évite ce qui est très salé ou très sucré au dîner : ça te donne soif après, et là c\'est embêtant pour la nuit.',
        b:'Ni trop salé ni trop sucré ce soir. La soif nocturne, c\'est le début des ennuis.' }
    ],
    1200: [
      { f:'La plus longue fenêtre de la journée ! Installe-toi pour de vrai, c\'est du vrai repos, pas une petite pause.',
        b:'La grande fenêtre. Installe-toi vraiment. Tu vas t\'abandonner, et ça te fera du bien.' },
      { f:'Prépare tout avant de t\'installer : ce que tu regardes, ce que tu bois. Parce que décider, ça casse l\'état.',
        b:'Prépare tout avant. Une fois installé, tu n\'auras plus rien à décider. C\'est le but.' },
      { f:'Si des émotions remontent, laisse-les passer sans chercher à comprendre. C\'est normal quand les défenses tombent, ça m\'arrive aussi.',
        b:'Des émotions vont peut-être remonter. Laisse-les passer. Tu n\'as rien à analyser, je suis là.' },
      { f:'Et sors en douceur après ! Cinq minutes de transition, sinon ça fait bizarre.',
        b:'Sors en douceur. Cinq minutes. Ne remonte pas d\'un coup.' }
    ],
    1350: [
      { f:'Le change le plus technique ! Ta couche doit tenir dix heures, alors prends la plus absorbante.',
        b:'Dix heures devant toi. Prends la plus absorbante. Pas de demi-mesure ce soir.' },
      { f:'Crème plus épaisse que d\'habitude ce soir — c\'est la longue nuit qui abîme le plus.',
        b:'Crème épaisse. Plus que d\'habitude. La nuit ne pardonne pas.' },
      { f:'Vérif peau complète, sans exception ! C\'est ton dernier contrôle avant dix heures.',
        b:'Vérif complète. Sans exception. Dernier contrôle avant la nuit.' },
      { f:'Et surtout : cherche pas à vider avant de te coucher. Laisse la nuit faire son boulot !',
        b:'Ne cherche pas à vider avant de dormir. Laisse la nuit s\'en charger — elle le fera sans toi.' }
    ],
    1380: [
      { f:'Couche-toi bien détendu ! Si tu te crispes en pensant à la nuit, forcément tu vas retenir.',
        b:'Détends-toi avant de dormir. Crispé, tu retiendras. Et je n\'ai pas envie de ça.' },
      { f:'Position confortable, pas de contention. Le sommeil reste libre, toujours — c\'est important.',
        b:'Pas de contention pour dormir. Le sommeil reste libre, toujours. C\'est ma règle.' },
      { f:'Les nuits, c\'est ton meilleur entraînement ! Endormi, ton corps lâche sans que t\'aies rien à faire. Dors bien. 🦊',
        b:'Tes nuits font le travail à ta place. Endormi, tu ne résistes plus. Dors.' }
    ]
  };

  /* ============================================================
     CE QU'IL FAUT PRENDRE ET CONTRÔLER, À CHAQUE CRÉNEAU
     Foxy annonce le matériel (tiré de ta garde-robe et de ton stock
     réels) et les vérifications à faire. C'est le cœur du guidage.
     ============================================================ */
  const SLOT_KIT = {
    420: { mat:['Ton grand verre d\'eau'],
           ctrl:['Touche ta couche de nuit : lourde ?','Comment tu te sens au réveil ?'] },
    480: { mat:['Fibres au petit-déjeuner','De l\'eau'],
           ctrl:['Tu gardes ta couche de nuit jusqu\'à 9h'] },
    540: { mat:['@couche_jour','La crème barrière','Les lingettes','@tenue_jour'],
           ctrl:['Fenêtre selles','Toilette complète','VÉRIF PEAU : plis, cuisses, bas du dos','Crème généreuse'],
           pilier:true },
    570: { mat:['De quoi te changer si tu sors'],
           ctrl:['Ta couche est bien en place avant de partir ?'] },
    690: { mat:['@biberon','@tetine'],
           ctrl:['Touche ta couche : mouillée ?','Change si elle est chargée','Bois ton biberon en entier'] },
    720: { mat:['@contention','@doudou','@tetine','Ta boisson préparée'],
           ctrl:['Installe-toi avant de commencer','Prévois ta durée'] },
    810: { mat:['@biberon','Repas avec fibres'],
           ctrl:['Check couche avant le repas'] },
    870: { mat:['@tenue_sieste','@doudou','@tetine','Ta couverture'],
           ctrl:['Change AVANT de t\'allonger si elle est chargée','Aucune contention verrouillée pour dormir'] },
    960: { mat:['@couche_jour','La crème','Les lingettes','@biberon'],
           ctrl:['Change OBLIGATOIRE au réveil','VÉRIF PEAU : deuxième contrôle','Troisième biberon'],
           pilier:true },
    990: { mat:['De quoi te changer si tu sors'],
           ctrl:['Calcule : ta couche doit tenir jusqu\'à 19h30'] },
    1170:{ mat:['Repas léger'],
           ctrl:['Check couche avant le dîner','Allège les boissons à partir de maintenant'] },
    1200:{ mat:['@contention','@doudou','@tetine'],
           ctrl:['Prépare tout avant de t\'installer','Prévois ta sortie en douceur'] },
    1350:{ mat:['@couche_nuit','La crème (épaisse ce soir)','Les lingettes','@tenue_nuit'],
           ctrl:['Fenêtre selles','Toilette complète','VÉRIF PEAU COMPLÈTE','Crème épaisse','Fais ton bilan du soir'],
           pilier:true },
    1380:{ mat:['@tetine','@doudou'],
           ctrl:['Position confortable, aucune contention','Ne cherche pas à vider avant de dormir'] }
  };

  // Remplace les @références par ton matériel réel (garde-robe + stock)
  async function resolveKit(liste) {
    const out = [];
    let tenues = null, stock = null, wb = null;
    try { tenues = await getOutfit(todayStr()); } catch(e) {}
    try { if (window.HabitrainWardrobe) { wb = await window.HabitrainWardrobe.getWardrobe(); } } catch(e) {}
    const accessoire = (mots) => {
      if (!wb || !wb.access) return null;
      const t = wb.access.find(x => mots.some(mm => x.toLowerCase().includes(mm)));
      return t || null;
    };
    for (const item of liste) {
      if (item[0] !== '@') { out.push(item); continue; }
      let v = null;
      switch (item) {
        // Sans tirage enregistré, la référence était simplement ignorée :
        // Foxy passait la tenue sous silence au lieu de te dire qu'il en manque un.
        case '@tenue_jour':   v = tenues ? tenues.jour : 'Ta tenue du jour — je la tire à ton réveil'; break;
        case '@tenue_nuit':   v = tenues ? tenues.nuit : 'Ta tenue de nuit — je la tire à ton réveil'; break;
        // La sieste est une tolérance, pas une obligation : la carte du tirage
        // le dit, le kit doit le dire aussi. Sinon Foxy réclame une tenue que
        // rien ne t'impose — et la vérification, elle, accepte les trois.
        case '@tenue_sieste':
          v = tenues && tenues.sieste
            ? (tenues.sieste + ' — si tu veux ; tu peux aussi garder ta tenue de jour')
            : null;
          break;
        case '@couche_jour':
        case '@couche_nuit': {
          try {
            if (window.HabitrainWardrobe) {
              const per = item === '@couche_nuit' ? 'nuit' : 'jour';
              const m = await modeleProchain(per);
              v = m ? (m.name + ' (' + m.qty + ' en stock)') : 'une couche — stock à refaire !';
            }
          } catch(e) {}
          if (!v) v = item === '@couche_nuit' ? 'ta couche de nuit' : 'ta couche de jour';
          break;
        }
        case '@biberon':    v = accessoire(['biberon']) || 'Ton biberon'; break;
        case '@tetine':     v = accessoire(['tétine','tetine']) || 'Ta tétine'; break;
        case '@doudou':     v = accessoire(['doudou']) || 'Ton doudou'; break;
        case '@contention': {
          try { if (wb && wb.contention && wb.contention.length) v = wb.contention[0]; } catch(e) {}
          if (!v) v = 'Ta contention douce';
          break;
        }
      }
      if (v) out.push(v);
    }
    return out;
  }

  /* ============================================================
     « QU'EST-CE QUE JE FAIS MAINTENANT ? »
     Réponse complète à n'importe quelle minute de la journée :
     où tu en es, ce qui est en retard, ce qui arrive, quoi faire.
     ============================================================ */
  async function guideMaintenant() {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();

    // --- 1) Y a-t-il quelque chose EN RETARD ? (priorité absolue) ---
    const PIL = [{k:'c0900',m:540,n:'change du matin'},
                 {k:'c1600',m:960,n:'change de sortie de sieste'},
                 {k:'c2230',m:1350,n:'change de nuit'}];
    let done = {};
    try { const r = await window.storage.get('slotdone:'+todayStr()); if (r && r.value) done = JSON.parse(r.value); } catch(e) {}
    const retard = PIL.filter(p => nowMin > p.m + 15 && nowMin < p.m + 300 && !done[p.k]);

    if (retard.length) {
      const p = retard[retard.length-1];
      const mn = nowMin - p.m;
      await imSay(broOn()
        ? 'Ton ' + p.n + ' a ' + mn + ' minutes de retard. On s\'en occupe. Maintenant.'
        : '⚠️ Ton ' + p.n + ' a ' + mn + ' min de retard ! On fait ça tout de suite, d\'accord ? 🦊', 950, 'concern');
      await annoncerKit(p.m, p.n.charAt(0).toUpperCase() + p.n.slice(1), '🔑');
      imSetActions([
        { label:'🍼 On fait le change', onClick: async () => { imAddMe('On fait le change.'); try { startChange('pilier'); } catch(e) {} } },
        { soft:true, label:'Je l\'ai déjà fait', onClick: async () => {
          imAddMe('Je l\'ai déjà fait.');
          try { await finishChange(); } catch(e) {}
          await imSay(broOn() ? 'Alors note-le. Sans trace, ça n\'existe pas.' : 'Ah, super ! Je le note alors. Pense à valider dans l\'appli la prochaine fois. 🦊', 850, 'happy');
          if (currentM) await imOfferHelp(currentM);
        }}
      ]);
      return;
    }

    // --- 2) Où en es-tu ? Depuis quand portes-tu ta couche ? ---
    let heuresPort = null;
    try {
      const last = await lastChangeTime(2);
      if (last) heuresPort = (Date.now() - last.getTime()) / 3600000;
    } catch(e) {}

    // --- 3) Le créneau en cours et le suivant ---
    let cur = null, next = null;
    for (const sl of SCHEDULE) { if (sl.m <= nowMin) cur = sl; else { next = sl; break; } }

    // --- 4) Foxy situe le moment ---
    const d = dm();
    let intro;
    if (!cur) intro = broOn() ? 'La journée n\'a pas commencé. Tu devrais encore dormir.' : 'La journée n\'a pas encore démarré ! Tu peux encore dormir un peu. 😴';
    else intro = broOn()
      ? 'Il est ' + fmtTime(nowMin) + '. Tu es dans « ' + cur.act + ' ».'
      : 'Il est ' + fmtTime(nowMin) + ' — on est dans « ' + cur.act + ' ». ' + d.emoji;
    await imSay(intro, 900, 'explain');

    /* --- 5) IL DEMANDE, IL NE DEVINE PAS ---
       L'appli sait depuis combien de temps la couche est posée. Elle ne
       sait pas ce qu'il y a dedans, ni comment tu vas. Ces deux choses-là,
       il n'y a qu'en te les demandant qu'on les obtient — et elles
       changent complètement ce qu'il faut faire ensuite. */
    let etat = null;
    {
      let duree = null;
      if (heuresPort !== null) {
        const h = Math.floor(heuresPort), mn = Math.round((heuresPort-h)*60);
        duree = h + 'h' + String(mn).padStart(2,'0');
      }
      // Sans dernier change enregistré, il ne se tait pas : c'est justement
      // là qu'il n'a que ta réponse pour savoir où tu en es.
      const entree = duree
        ? bro('Ta couche a ' + duree + '. Elle en est où, à ton avis ? Touche par-dessus ta tenue, ne l\'ouvre pas.',
              'Ta couche a ' + duree + '. Elle en est où ? Par-dessus la tenue, tu n\'ouvres pas.')
        : bro('Je n\'ai pas trace de ton dernier change, donc je te demande : ta couche, elle en est où ? Touche par-dessus ta tenue, ne l\'ouvre pas.',
              'Pas de trace de ton dernier change. Ta couche en est où ? Par-dessus la tenue.');

      // Même question, mêmes trois valeurs que partout ailleurs : la 19.6
      // écrivait etat_peu / etat_lourd / etat_nsp, illisibles pour la carte.
      etat = await demanderEtatCouche(entree);
      if (etat) {
        try {
          const { rc } = await declarerEtatCouche(etat, 'parole');
          await direRecoupement(rc, etat);
          // contredit : la suite du raisonnement part de ce qui a été mesuré
          if (rc.verdict === 'contredit') etat = rc.etat;
        } catch(e) {}
      }

      // sa lecture dépend de ce que tu viens de dire ET de la durée
      if (etat === 'sature' || heuresPort > 6.5) {
        await imSay(bro(
          etat === 'sature'
            ? 'Alors on ne discute pas : bien lourde, ça veut dire qu\'elle a fait son travail et qu\'elle doit sortir. Ta peau passe avant l\'horaire, toujours. 🦊'
            : 'Elle a dépassé le plafond de port de toute façon. On change, pour ta peau. 🦊',
          'Lourde, ou au-delà du plafond. Elle sort maintenant. Ta peau avant l\'horaire.'), 950, 'alarmed');
        imSetActions([
          { label:'🍼 On la change tout de suite', onClick: async () => { imAddMe('On la change.'); try { startChange('check'); } catch(e) {} } },
          ACT.retour(currentM)
        ]);
        return;
      }
      if (etat === 'sec') {
        const fraiche = heuresPort !== null && heuresPort < 2;
        const depuis = duree ? ' après ' + duree : '';
        await imSay(bro(
          fraiche
            ? 'Normal, elle est toute fraîche. Laisse-la venir, ne force rien — ça arrivera tout seul, comme d\'habitude.'
            : 'Sèche' + depuis + ' ? Tu tiens encore, je le vois bien. Ce n\'est pas grave, et ce n\'est pas une victoire non plus — ça finit toujours par lâcher. Laisse-toi aller, c\'est vain de lutter. 🦊',
          fraiche ? 'Elle est fraîche. Laisse venir.' : 'Sèche' + depuis + '. Tu résistes. Ça ne tiendra pas, tu le sais.'), 950, 'calm');
      } else if (etat === 'mouille') {
        await imSay(bro(
          'Bien. Elle travaille, et elle a encore de la marge — pas la peine de la sortir maintenant, ce serait du gâchis. On continue comme ça.',
          'Elle travaille, elle a de la marge. On ne la sort pas. On continue.'), 900, 'proud');
      } else {
        await imSay(bro(
          'Pas grave, ça arrive — et c\'est même plutôt bon signe, ça veut dire que tu as arrêté de la surveiller. On se fie à l\'heure alors.',
          'Bon signe : tu ne la surveilles plus. On se fie à l\'heure.'), 900, 'teach');
      }
    }

    // --- 6) Et toi, comment tu vas ? (ce qu'aucun capteur ne dit) ---
    const moral = await imDemander(bro(
      'Et toi, tu es comment là, franchement ?',
      'Et toi ? Franchement.'), [
      { k:'bien',   label:'😌 Ça roule',              dit:'Ça roule.' },
      { k:'dur',    label:'😕 C\'est un peu dur',     dit:'C\'est un peu dur là.' },
      { k:'obsede', label:'🌀 J\'y pense trop',       dit:'J\'y pense trop.' },
      { k:'fatigue',label:'🥱 Je suis fatigué',       dit:'Je suis fatigué.' }
    ], 'curious');
    // le moral n'est pas une vérif de couche : il a son propre journal,
    // sinon il gonfle le compteur « N vérifs aujourd'hui »
    try {
      const k = 'moral:' + todayStr();
      const r = await window.storage.get(k);
      const l = (r && r.value) ? JSON.parse(r.value) : [];
      l.push({ t: new Date().toISOString(), v: moral });
      await window.storage.set(k, JSON.stringify(l));
    } catch(e) {}

    const REP_MORAL = {
      bien: { f:'Tant mieux ! Note-le quelque part dans ta tête, ces journées-là — c\'est elles qui te porteront les jours moins faciles. 🦊', b:'Bien. Retiens cette journée. Elle te servira.' },
      dur:  { f:'Je sais. Moi aussi j\'ai eu ces journées où tout pèse. Le truc qui m\'a sauvé, c\'est d\'arrêter de viser le mois et de ne viser que la journée. Rien qu\'aujourd\'hui. Et on y est presque. 💛', b:'Ça arrive. Ne vise pas le mois, vise aujourd\'hui. Rien de plus. Tu n\'as pas à porter le reste.' },
      obsede:{ f:'Ah, ça, c\'est la phase. Tu y penses tout le temps parce que c\'est encore nouveau. Ça s\'efface, je te promets — un matin tu réaliseras que tu n\'y as pas pensé depuis des heures. C\'est exactement comme ça que ça s\'est passé pour moi.', b:'Phase normale. Ça s\'efface tout seul. Tu n\'as rien à faire pour ça, juste à rester dedans.' },
      fatigue:{ f:'Alors on lève le pied. Le programme ne sert à rien si tu t\'épuises avec. Installe-toi, garde ce que tu as sur toi, et laisse-le travailler sans toi. C\'est un peu le principe, au fond. 🦊', b:'Alors tu te poses. Tu gardes ce que tu as, ça travaille sans toi. Rien d\'autre à faire.' }
    };
    const rm = REP_MORAL[moral];
    if (rm) await imSay(bro(rm.f, rm.b), 950, moral === 'bien' ? 'proud' : 'concern');

    // Il se souvient de ce que tu lui as dit plus tôt dans la journée : la
    // deuxième fois qu'on dit « c'est dur », ce n'est pas la même phrase.
    if (moral === 'dur' || moral === 'fatigue') {
      try {
        const r = await window.storage.get('moral:' + todayStr());
        const l = (r && r.value) ? JSON.parse(r.value) : [];
        const n = l.filter(x => x.v === 'dur' || x.v === 'fatigue').length;
        if (n >= 2) {
          await imSay(bro(
            'C\'est la ' + (n === 2 ? 'deuxième' : n + 'e') + ' fois aujourd\'hui que tu me le dis. Alors on ne fait pas comme si de rien n\'était : si quelque chose te coûte trop aujourd\'hui, dis-le moi et on l\'allège. Tu peux aussi mettre en pause — c\'est prévu, et ce n\'est pas un échec. 💛',
            (n === 2 ? 'Deuxième' : n + 'e') + ' fois aujourd\'hui. Si quelque chose te coûte trop, on l\'allège. La pause existe.'), 1000, 'concern');
        }
      } catch(e) {}
    }

    // --- 7) Ce qu'il y a à faire maintenant, en deux lignes ---
    if (cur) {
      const kit = SLOT_KIT[cur.m];
      if (kit) await annoncerKit(cur.m, cur.act, cur.ic);
      else {
        const det = (cur.act === 'Bloc activité')
          ? (cur.m < 13*60 ? d.detMatin : d.detAprem) : cur.det;
        if (det) await imSay(det, 900, 'explain');
      }
      // une astuce seulement si la journée est calme, et seulement si elle
      // n'est pas déjà dite par le kit — le créneau sieste annonçait
      // « change avant de t'allonger » deux fois de suite.
      if (moral === 'bien' || moral === 'obsede') {
        const astuce = tipForSlot(cur.m);
        if (astuce && !redite(astuce, cur.m)) await imSay('💡 ' + astuce, 950, broOn() ? 'calm' : mood().expr);
      }
    }

    // --- 8) Ce qui arrive ensuite, + ce qui reste, fondus en une ligne ---
    const bouts = [];
    if (next) {
      const dans = next.m - nowMin;
      const txt = dans >= 60 ? Math.floor(dans/60) + 'h' + (dans%60 ? String(dans%60).padStart(2,'0') : '') : dans + ' min';
      bouts.push('ensuite <b>' + next.act + '</b> à ' + fmtTime(next.m) + ', dans ' + txt);
    }
    try {
      if (window.HabitrainMissions) {
        const st = await window.HabitrainMissions.getState();
        const restantes = [];
        for (const id of (st.daily||[])) {
          const mm = window.HabitrainMissions.dailyById(id);
          if (!mm) continue;
          const ev = await evalDaily(mm);
          if (!ev.done) restantes.push(mm.name);
        }
        if (restantes.length) bouts.push('et il te reste ' + restantes.join(', '));
      }
    } catch(e) {}
    if (bouts.length) {
      await imSay(bro('Pour la suite : ' + bouts.join(', ') + '. Voilà, tu es à jour. 🦊',
                      'Suite : ' + bouts.join(', ') + '.'), 900, 'neutral');
    }

    /* --- 9) Il propose d'aller plus loin, il ne déverse pas ---
       expliquerCouche() et expliquerTenue() tournaient ici automatiquement :
       une quinzaine de lignes en plus, qui redisaient le modèle et l'heure
       déjà annoncés juste au-dessus. Maintenant c'est une porte, pas un mur. */
    // le conseil de comportement qui colle à ce moment précis
    const sujet = sujetDuMoment(etat, cur);
    imSetActions([
      { sep:'Si tu veux creuser' },
      { label: COMPORTEMENT[sujet].label, onClick: async () => {
          imAddMe(COMPORTEMENT[sujet].label.replace(/^\S+\s/, ''));
          await conseilComportement(sujet);
      }},
      ACT.pourquoiCouche(),
      ACT.pourquoiTenue(),
      { sep:'' },
      ACT.changer(currentM),
      ACT.retour(currentM)
    ]);
  }

  /* L'astuce du créneau répète-t-elle une ligne du kit qu'on vient
     d'annoncer ? On compare les mots porteurs de la première phrase :
     au-delà de quatre en commun, c'est la même consigne redite. */
  function redite(astuce, slotM) {
    const kit = SLOT_KIT[slotM];
    if (!kit) return false;
    const mots = (s) => normalize(s).split(/\s+/).filter(w => w.length > 3);
    const a = new Set(mots(String(astuce).split(/[.!?]/)[0]));
    if (a.size < 4) return false;
    const lignes = (kit.ctrl || []).concat(kit.mat || []).map(String);
    return lignes.some(l => {
      let communs = 0;
      for (const w of mots(l)) if (a.has(w)) communs++;
      return communs >= 4;
    });
  }

  // Foxy annonce le nécessaire du créneau
  async function annoncerKit(slotM, slotAct, slotIc) {
    const kit = SLOT_KIT[slotM];
    if (!kit) return false;
    const mat = await resolveKit(kit.mat || []);
    const ctrl = kit.ctrl || [];
    if (!mat.length && !ctrl.length) return false;

    await imSay((slotIc || '') + ' <b>' + slotAct + '</b>', 800, 'explain');
    if (mat.length) {
      await imSay(broOn()
        ? '<b>Ce que tu prends :</b><br>• ' + mat.join('<br>• ')
        : '<b>Prends avec toi :</b><br>• ' + mat.join('<br>• '), 1000, 'explain');
    }
    if (ctrl.length) {
      await imSay(broOn()
        ? '<b>Ce que tu contrôles :</b><br>' + ctrl.map(c => '☐ ' + c).join('<br>')
        : '<b>À vérifier :</b><br>' + ctrl.map(c => '☐ ' + c).join('<br>'), 1000, kit.pilier ? 'calm' : 'curious');
    }
    return true;
  }

  /* ---------- Conseils thématiques : biberon et tétine ----------
     Foxy les glisse de temps en temps, indépendamment des créneaux. */
  const FOXY_TOPIC_TIPS = {
    biberon: [
      { f:'Le biberon, c\'est pas juste pour boire, tu sais. La succion, ça apaise pour de vrai — c\'est physiologique, pas psychologique.',
        b:'Le biberon apaise ton corps, pas seulement ta tête. La succion fait baisser ta vigilance. C\'est exactement ce que je veux.' },
      { f:'Bois-le lentement ! Si tu l\'avales en deux minutes, tu perds tout l\'effet calmant. Prends dix bonnes minutes.',
        b:'Lentement. Dix minutes minimum. Avalé trop vite, il ne te fait aucun bien.' },
      { f:'Allongé ou bien calé pour le boire, c\'est encore mieux. Debout ça marche, mais c\'est pas pareil.',
        b:'Allonge-toi ou cale-toi bien pour le boire. Debout, tu restes sur tes gardes.' },
      { f:'Tiède plutôt que froid, si tu peux. Le froid réveille, le tiède détend. Petit détail qui change tout.',
        b:'Tiède, pas froid. Le froid te réveille — l\'inverse de ce qu\'on cherche.' },
      { f:'Trois par jour c\'est ton objectif, mais l\'important c\'est de les répartir. Tout boire d\'un coup le soir, ça sert à rien.',
        b:'Trois par jour, bien répartis. Pas tout d\'un coup le soir pour rattraper — je ne suis pas dupe.' },
      { f:'Nettoie bien la tétine du biberon après chaque usage. C\'est pas le truc le plus rigolo, mais c\'est important.',
        b:'Nettoie-le après chaque usage. L\'hygiène, ça ne se néglige pas.' }
    ],
    tetine: [
      { f:'La tétine, c\'est un interrupteur pour ta tête. Quand tu l\'as en bouche, ton cerveau reçoit le signal qu\'il peut baisser la garde.',
        b:'La tétine coupe ta vigilance. C\'est un interrupteur — et tu vas t\'en servir.' },
      { f:'Elle aide énormément à lâcher, franchement. La succion détend tout le corps, y compris en bas.',
        b:'Elle t\'aide à lâcher. La succion détend tout, y compris ce qui te retient encore.' },
      { f:'Garde-en toujours une de secours quelque part. Moi j\'en ai une cachée sous mon oreiller, chut. 🤫',
        b:'Aie toujours une tétine de secours. Ne te retrouve jamais sans.' },
      { f:'Pour dormir, c\'est le meilleur allié. Beaucoup la gardent toute la nuit et dorment nettement mieux.',
        b:'Pour la nuit, garde-la. Tu dormiras mieux, et tu lâcheras plus facilement.' },
      { f:'Nettoie-la tous les jours à l\'eau chaude savonneuse. Et remplace-la si le silicone devient collant ou fissuré.',
        b:'Nettoyage quotidien. Remplacement dès qu\'elle s\'abîme. Pas de négociation là-dessus.' },
      { f:'Si tu la perds souvent, un clip attaché à ta tenue règle le problème. Simple mais efficace !',
        b:'Un clip sur ta tenue, et tu ne la perdras plus. Arrête de la chercher partout.' },
      { f:'Elle marche encore mieux pendant les fenêtres de régression. Tétine + doudou + position basse, c\'est le combo parfait.',
        b:'Tétine, doudou, position basse. Ensemble, ils te font descendre bien plus vite.' }
    ]
  };

  // Foxy donne un conseil sur le biberon ou la tétine (occasionnel, 1/jour max)
  // Le sujet est choisi selon le MOMENT : le conseil arrive quand il sert.
  function topicForNow() {
    const h = new Date().getHours(), mn = h*60 + new Date().getMinutes();
    // créneaux biberon : 11h30, 13h30, 16h (± 45 min)
    const bib = [690, 810, 960].some(x => Math.abs(mn - x) <= 45);
    // créneaux tétine : régressions (12h, 20h), sieste (14h30), coucher (23h)
    const tet = [720, 870, 1200, 1380].some(x => Math.abs(mn - x) <= 45) || h >= 22 || h < 7;
    if (bib && tet) return Math.random() < 0.5 ? 'biberon' : 'tetine';
    if (bib) return 'biberon';
    if (tet) return 'tetine';
    return null;   // hors créneau : Foxy n'en parle pas
  }

  async function maybeTopicTip() {
    const sujet = topicForNow();
    if (!sujet) return false;              // pas le moment : il se tait
    let last = null;
    try { const r = await window.storage.get('topictip:last'); if (r && r.value) last = JSON.parse(r.value); } catch(e) {}
    if (last === todayStr()) return false;
    if (Math.random() >= 0.35) return false;
    try { await window.storage.set('topictip:last', JSON.stringify(todayStr())); } catch(e) {}
    const lot = FOXY_TOPIC_TIPS[sujet];
    const c = lot[Math.floor(Math.random()*lot.length)];
    // il amène le conseil par le contexte du moment
    const amorce = sujet === 'biberon'
      ? (broOn() ? 'Puisque c\'est l\'heure de ton biberon...' : 'Tiens, puisque c\'est l\'heure du biberon...')
      : (broOn() ? 'Tu vas te poser, alors écoute-moi sur ta tétine.' : 'Au fait, pendant qu\'on est au calme, un truc sur ta tétine...');
    await imSay(amorce, 800, broOn() ? 'calm' : mood().expr);
    await imSay((sujet === 'biberon' ? '🍼' : '🧷') + ' ' + (broOn() ? c.b : c.f), 950, broOn() ? 'calm' : mood().expr);
    return true;
  }

  // renvoie un conseil pour le créneau donné (varie d'un jour à l'autre)
  function tipForSlot(m) {
    const lot = MOMENT_TIPS[m];
    if (!lot || !lot.length) return null;
    // index stable dans la journée, mais qui tourne au fil des jours
    const jour = Math.floor(Date.now() / 86400000);
    const c = lot[jour % lot.length];
    return broOn() ? c.b : c.f;
  }

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

  // Bandeau de session de discipline
  function renderDiscipline() {
    const card = document.getElementById('discCard');
    if (!card) return;
    if (!discActive()) { card.style.display = 'none'; return; }
    card.style.display = '';
    const restant = Math.max(0, Math.ceil((discSession.fin - Date.now()) / 86400000));
    const t = document.getElementById('discTxt');
    const p = document.getElementById('discProg');
    const NIV = { leger:'léger', moyen:'moyen', fort:'fort' };

    /* La carte disait « le cadre est resserré » sans jamais dire en quoi,
       ni ce qu'il fallait atteindre pour en sortir, ni qu'une seule entorse
       remet le compteur à zéro. Tout est affiché maintenant. */
    if (t) {
      t.innerHTML =
        (discSession.source === 'desertion'
          ? '<div style="margin-bottom:8px">Déclenchée par ta <b>désertion</b> : elle dure toute ta reprise.</div>'
          : '<div style="margin-bottom:8px">Déclenchée au niveau <b>' + (NIV[discSession.niveau] || discSession.niveau)
          + '</b> : ' + discSession.ecarts + ' points d\'écart cumulés sur 3 jours.</div>')
        + '<div style="font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;color:#a8543b;margin-bottom:3px">Ce qui change</div>'
        + '<div style="margin-bottom:8px;line-height:1.5">'
        + '• <b>Tous les créneaux deviennent des changes piliers</b> — les checks de 11h30, 13h30 et 19h30 ne sont plus de simples vérifications.<br>'
        + '• <b>Tolérance de retard : 5 minutes</b> au lieu de 15.<br>'
        + '• <b>Les rituels ne se reportent plus</b> — le bouton « une autre fois » disparaît.<br>'
        + '• <b>Foxy change de registre</b> — plus direct, moins d\'échappatoires.'
        + '</div>'
        + '<div style="font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;color:#a8543b;margin-bottom:3px">Pour en sortir</div>'
        + '<div style="line-height:1.5">'
        + '<b>' + discSession.objectif + ' journées consécutives sans aucune entorse</b>, chacune renseignée le soir. '
        + 'Une journée non remplie ne compte pas comme propre. '
        + '<b style="color:#a8543b">Une seule entorse remet le compteur à zéro.</b>'
        + '</div>';
    }
    if (p) {
      const reste = Math.max(0, discSession.objectif - discSession.joursPropres);
      p.innerHTML = '✅ ' + discSession.joursPropres + ' / ' + discSession.objectif + ' journée'
        + (discSession.objectif > 1 ? 's' : '') + ' sans écart'
        + (reste > 0 ? ' — encore <b>' + reste + '</b> à tenir' : ' — c\'est bon, ça se clôture demain')
        + ' · ' + restant + ' jour(s) avant la fin de session';
    }
  }

  // Carte du caractère de la journée
  function renderDayMood() {
    const d = dm();
    const e = document.getElementById('dmEmoji');
    const n = document.getElementById('dmNom');
    const i = document.getElementById('dmIntro');
    const a = document.getElementById('dmAct');
    if (!n) return;
    if (e) e.textContent = d.emoji;
    n.textContent = d.nom + (d.surprise ? ' ✨' : '');
    if (i) i.textContent = d.intro;
    if (a) a.innerHTML = '💡 Idées du jour : ' + (d.activites || []).slice(0,3).join(' · ');
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
      // les blocs d'activité prennent le contenu du jour
      const d = dm();
      let acte = s.act, det = s.det;
      if (s.act === 'Bloc activité') {
        const matin = s.m < 13*60;
        acte = (matin ? d.blocMatin : d.blocAprem) || s.act;
        det  = (matin ? d.detMatin  : d.detAprem)  || s.det;
      }
      if (s.act.indexOf('régression') >= 0) det += ' (' + dureeRegression() + ' aujourd\'hui)';
      if (s.act.indexOf('Sieste') >= 0) det += ' (' + dureeSieste() + ' aujourd\'hui)';
      const dotGlyph = kind === 'pilier' ? '🔑' : (kind === 'check' ? '✓' : '');
      const tag = kind === 'pilier' ? '<span class="tl-tag pilier">Pilier</span>'
                : (kind === 'check' ? '<span class="tl-tag check">Check</span>' : '');
      item.innerHTML =
        '<div class="tl-rail"><div class="tl-dot">'+dotGlyph+'</div><div class="tl-line"></div></div>'+
        '<div class="tl-body">'+
          '<div class="tl-time">'+fmtTime(s.m)+'</div>'+
          '<div class="tl-act">'+s.ic+' '+acte+tag+'</div>'+
          '<div class="tl-det">'+det+'</div>'+
          (isNow && tipForSlot(s.m) ? '<div style="margin-top:6px;font-size:11.5px;font-weight:700;color:#a8703a;line-height:1.45">💡 '+tipForSlot(s.m)+'</div>' : '')+
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

    // les blocs d'activité prennent le contenu du jour
    const dj = dm();
    const adapte = (b) => {
      if (!b || b.act !== 'Bloc activité') return { act: b ? b.act : '', det: b ? b.det : '' };
      const matin = b.m < 13*60;
      return { act: (matin ? dj.blocMatin : dj.blocAprem) || b.act,
               det: (matin ? dj.detMatin  : dj.detAprem)  || b.det };
    };
    const curA = adapte(cur), nextA = adapte(next);

    let html = '<div class="now">'
      + '<div class="ic">'+cur.ic+'</div>'
      + '<div class="body">'
      + '<div class="k">En ce moment' + (cur.m!==undefined ? ' · depuis '+fmtTime(cur.m) : '') + '</div>'
      + '<div class="v">'+curA.act+'</div>'
      + '<div class="t">'+curA.det+'</div>'
      + '</div></div>';
    // conseil pratique du créneau en cours
    const astuce = (cur.m !== undefined) ? tipForSlot(cur.m) : null;
    if (astuce) {
      html += '<div style="margin-top:10px;padding:10px 12px;background:#FBF3E0;border:1px solid #ecd9a8;' +
              'border-radius:11px;font-size:12.5px;font-weight:600;color:#7a5a30;line-height:1.5">' +
              '💡 ' + astuce + '</div>';
    }
    if (next) {
      html += '<div class="next"><span class="arrow">→</span> À '+fmtTime(next.m)+' : '+nextA.act+'</div>';
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
  // Ta garde-robe réelle fait foi. La liste d'exemple ne sert que tant que tu
  // n'as rien saisi — sinon le tirage t'imposait des tenues que tu ne possèdes
  // pas, et « la tenue du jour » devenait une fiction.
  function wb(cat) {
    if (liveWardrobe && Array.isArray(liveWardrobe[cat])) return liveWardrobe[cat];
    return [];
  }
  function gardeRobeRenseignee() {
    return !!(liveWardrobe && ['nuit','jour','sieste'].some(c => Array.isArray(liveWardrobe[c]) && liveWardrobe[c].length));
  }
  function drawOutfit() {
    // une catégorie vide ne doit pas produire « undefined » silencieusement
    const tire = (cat) => {
      let l = wb(cat);
      // reprise après désertion : fermeture dorsale seulement, quand il y en a
      if (mesureDes('tenue_fermee') && cat !== 'sieste') {
        const f = l.filter(n => FERMEE_DOS.indexOf(typeTenue(n)) >= 0);
        if (f.length) l = f;
      }
      return l.length ? pickOne(l) : null;
    };
    const jour = tire('jour');
    const nuit = tire('nuit');
    // pas de tenue de sieste déclarée : on retombe sur celle de nuit, qui est
    // de toute façon la tolérance prévue pendant la sieste.
    const sieste = tire('sieste') || nuit;
    return { nuit, jour, sieste };
  }

  /* ------------------------------------------------------------
     QUELLE TENUE EST ATTENDUE MAINTENANT — source unique
     Deux définitions cohabitaient et ne disaient pas la même chose :
     la carte du tirage basculait nuit/jour à 22h30 et 9h, la vérification
     du scan à 22h et 8h, et exigeait en plus la tenue de sieste entre
     14h et 16h alors que la carte la présente comme facultative.
     Entre 8h et 9h, Foxy réclamait donc une tenue que la carte
     n'affichait pas. Tout passe désormais par cette fonction.
     ------------------------------------------------------------ */
  const NUIT_DEBUT = 22*60 + 30;   // 22h30
  const NUIT_FIN   = 9*60;         // 9h
  /* Bascule anticipée : à partir de 19h30, poser une couche de jour n'a plus
     de sens — elle ne servirait que trois heures avant le change de nuit.
     Toute remise en couche passée cette heure EST le pilier de 22h30, avancé.
     Ça ne déplace pas la journée : seule la couche et la tenue basculent. */
  const BASCULE_NUIT = 19*60 + 30; // 19h30
  const SIESTE = [14*60, 16*60];   // fenêtre où la tenue de repos est tolérée

  function estNuit(now) {
    const m = (now || new Date()).getHours()*60 + (now || new Date()).getMinutes();
    return m >= NUIT_DEBUT || m < NUIT_FIN;
  }
  // Pour tout ce qu'on POSE sur toi : couche et tenue.
  function couchageNuit(now) {
    const d = now || new Date();
    const m = d.getHours()*60 + d.getMinutes();
    return m >= BASCULE_NUIT || m < NUIT_FIN;
  }
  // le change de nuit a-t-il déjà été fait aujourd'hui ?
  async function nuitDejaFaite() {
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      return !!done.c2230;
    } catch(e) { return false; }
  }
  // renvoie { moment, nom, tolerees[] } — tolerees = noms acceptés sans remarque
  function tenueAttendue(o, now, nuitForcee) {
    now = now || new Date();
    if (!o) return null;
    const m = now.getHours()*60 + now.getMinutes();
    // Dès que le change de nuit est fait — y compris avancé à 19h30 — c'est
    // la tenue de nuit qui est attendue, quelle que soit l'heure au mur.
    const nuit = nuitForcee || estNuit(now);
    const moment = nuit ? 'nuit' : 'jour';
    const nom = nuit ? o.nuit : o.jour;
    const tolerees = [nom];
    // pendant la sieste, repasser en tenue de nuit ou de sieste est permis :
    // la carte le dit, la vérification doit le dire aussi.
    if (!nuit && m >= SIESTE[0] && m < SIESTE[1]) {
      if (o.nuit) tolerees.push(o.nuit);
      if (o.sieste) tolerees.push(o.sieste);
    }
    return { moment, nom, tolerees: tolerees.filter(Boolean) };
  }

  async function getOutfit(date) {
    try { const r = await window.storage.get('outfit:'+date); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return null;
  }
  async function saveOutfit(date, o) {
    try { await window.storage.set('outfit:'+date, JSON.stringify(o)); } catch(e) {}
  }

  function renderOutfitResult(o, nuitForcee) {
    const now = new Date();
    // Même règle que la vérification du scan : l'horloge, sauf si le change
    // de nuit a déjà été fait — auquel cas la carte doit montrer la tenue de
    // nuit comme active, sans quoi elle contredirait ce que Foxy exige.
    const isNightNow = nuitForcee || estNuit(now);
    const cards = [
      { key:'jour', ic:'☀️', moment:'Tenue de jour', wear:o.jour, active:!isNightNow },
      { key:'nuit', ic:'🌙', moment:'Tenue de nuit / repos', wear:o.nuit, active:isNightNow }
    ];
    const list = document.getElementById('outfitList');
    list.innerHTML = '';
    cards.forEach(c => {
      const row = document.createElement('div');
      row.className = 'outfit-row' + (c.active ? ' now-block' : '');
      row.innerHTML = '<div class="ic">'+c.ic+'</div><div class="body"><div class="moment">'+c.moment+(c.active?' · maintenant':'')+'</div><div class="wear">'+(c.wear || '<span style="opacity:.6">Aucune tenue dans ta garde-robe pour ce moment-là</span>')+'</div></div>';
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
      let forcee = false;
      try { forcee = couchageNuit(new Date()) && (await nuitDejaFaite()); } catch(e) {}
      renderOutfitResult(existing, forcee);
      if (btn) btn.style.display = 'none';
    } else {
      if (btn) btn.style.display = 'none';
      document.getElementById('outfitList').innerHTML = '<div class="outfit-note">🌅 Foxy la tire tout seul au réveil, et te l\'annonce.</div>';
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

  // un seul tirage par jour : s'il existe, on le rend tel quel
  async function tirerEquipement() {
    const already = await getDraw(todayStr());
    if (already && already.length) return already;
    const n = 2 + Math.floor(Math.random() * 4); // 2 à 5
    const ids = shuffle(EQUIP_POOL).slice(0, n).map(e => e.id);
    await saveDraw(todayStr(), ids);
    return ids;
  }
  async function tirerTenue() {
    const o = await getOutfit(todayStr());
    if (o) {
      // une catégorie vide au tirage, remplie depuis : on complète sans retirer le reste
      const n = drawOutfit(); let maj = false;
      ['jour','nuit','sieste'].forEach(k => { if (!o[k] && n[k]) { o[k] = n[k]; maj = true; } });
      if (maj) await saveOutfit(todayStr(), o);
      return { o, deja: true };
    }
    const n = drawOutfit();
    await saveOutfit(todayStr(), n);
    return { o: n, deja: false };
  }

  /* ============================================================
     RITUEL DU RÉVEIL
     Le tirage n'est plus un bouton : Foxy le fait tout seul au premier
     passage de la journée (à partir de 6h) et te l'annonce. Il ne te
     pose qu'une question : un superviseur sera-t-il présent ? La
     réponse décide si l'équipement du jour est tiré — et donc si un
     élément verrouillé peut sortir.
     ============================================================ */
  async function rituelReveil() {
    if (paused || new Date().getHours() < 6) return false;
    // pas avant la fin de l'installation : c'est elle qui passe la main au réveil
    try { const se = await lireStock('setup:etat', null); if (!se || !se.termine || document.body.classList.contains('onboarding')) return false; } catch(e) {}
    const cle = 'reveil:rituel:' + todayStr();
    if (await lireStock(cle, false)) return false;
    await ecrireStock(cle, true);

    const dejaType = await lireStock('daytype:' + todayStr(), null);
    const chat = voiceMode === 'foxy';
    let sup = dejaType;

    if (!sup) {
      if (chat) {
        await imSay(bro(
          'Bonjour, ' + nomOu('toi') + '. 🦊 Avant que je tire ta journée, une seule question.',
          'Debout. Une question, et je tire ta journée.'), 850, 'wave');
        const k = await imDemander(bro('Un superviseur sera présent aujourd\'hui ?', 'Superviseur présent aujourd\'hui ?'), [
          { k:'supervise', label:'👥 Oui, il sera là', dit:'Oui, il sera là.' },
          { k:'solo',      label:'🧍 Non, je suis seul', dit:'Non, je suis seul.' }
        ], 'curious');
        sup = k;
      } else {
        sup = await new Promise(res => {
          foxyPopShow('Bonjour' + (nomOu(null) ? ', ' + nomOu(null) : '') + ' ! 🦊 Avant que je tire ta journée : un superviseur sera présent aujourd\'hui ?', 'wave', [
            { label:'👥 Oui, il sera là', onClick: () => res('supervise') },
            { label:'🧍 Non, je suis seul', onClick: () => res('solo') }
          ]);
        });
      }
      await ecrireStock('daytype:' + todayStr(), sup);
    }

    const { o, deja } = await tirerTenue();
    const equip = sup === 'supervise' ? await tirerEquipement() : [];
    try { await renderOutfitCard(); } catch(e) {}
    try { await renderSupMode(); } catch(e) {}

    const lignes = [];
    lignes.push('☀️ <b>Jour</b> : ' + (o.jour || 'ta tenue habituelle') + ' — au change de 9h');
    if (o.sieste && o.sieste !== o.nuit) lignes.push('😴 <b>Sieste</b> : ' + o.sieste + ' — si tu veux');
    lignes.push('🌙 <b>Nuit</b> : ' + (o.nuit || 'ta tenue de nuit') + ' — dès 19h30');
    const eq = equip.map(id => EQUIP_POOL.find(e => e.id === id)).filter(Boolean);
    const verrou = eq.some(e => e.lock);

    if (chat) {
      await imSay(deja
        ? bro('Ta tenue est déjà tirée pour aujourd\'hui. La voilà :', 'Déjà tirée. La voilà :')
        : bro('J\'ai tiré ta tenue. Tu ne choisis pas, c\'est le principe — et tu verras, c\'est reposant. 🦊', 'Tenue tirée. Tu ne choisis pas.'), 850, 'proud');
      await imSay(lignes.join('<br>'), 1000, 'explain');
      if (sup === 'supervise') {
        await imSay(bro('Et puisque ton superviseur est là, voici ton équipement du jour :', 'Superviseur là. Équipement du jour :'), 800, 'curious');
        await imSay(eq.map(e => e.ic + ' ' + e.n).join('<br>'), 1000, 'explain');
        if (verrou) await imSay(bro(
          'Le verrouillé, seulement avec lui présent, éveillé et aux clés, du début à la fin. Sur tes fenêtres de régression — jamais pendant la sieste ou la nuit. Ça, ça ne bouge pas.',
          'Le verrouillé : lui présent, éveillé, aux clés. Fenêtres de régression seulement. Jamais sieste ni nuit.'), 1000, 'calm');
      } else {
        await imSay(bro('Seul aujourd\'hui : pas d\'équipement verrouillé, juste ta tenue. Ça suffit largement. 💛', 'Seul : pas de verrouillé. Ta tenue suffit.'), 850, 'calm');
      }
      if (currentM) await imOfferHelp(currentM);
    } else {
      let txt = (deja ? 'Ta tenue du jour : ' : 'J\'ai tiré ta tenue : ') + lignes.map(l => l.replace(/<[^>]+>/g, '')).join(' · ');
      if (eq.length) txt += '. Équipement : ' + eq.map(e => e.n).join(', ') + '.' + (verrou ? ' Le verrouillé seulement avec ton superviseur présent et aux clés.' : '');
      await new Promise(res => foxyPopShow(txt, 'proud', [{ label:'C\'est noté 🦊', onClick: () => { foxyPopHide(); res(); } }]));
    }
    return true;
  }


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
      // tiré d'office : plus de bouton
      const existing = await tirerEquipement();
      const btn = document.getElementById('supDraw');
      if (btn) btn.style.display = 'none';
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
      // pas encore demandé : c'est Foxy qui pose la question au réveil
      supCard.style.display = 'none';
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
  // Le registre « la résistance est vaine » s'applique en mode grand frère
  // OU pendant une session de discipline.
  function broOn() { return (hardMode && bigbro) || discActive(); }
  async function setBigbro(v) {
    bigbro = v;
    try { await window.storage.set('pref:bigbro', JSON.stringify(v)); } catch(e) {}
    const sw = document.getElementById('bigbroSwitch'); if (sw) sw.classList.toggle('on', bigbro);
  }
  // choisit le texte selon le mode : bro(texte doux, texte grand frère)
  function bro(soft, dom) { return broOn() ? dom : soft; }
  // le safeword coupe tout et ramène le Foxy doux
  async function triggerSafeword() {
    talkForce();   // priorité absolue : tout le reste se tait et la file est vidée
    bigbro = false;
    try { await window.storage.set('pref:bigbro', JSON.stringify(false)); } catch(e) {}
    const sw = document.getElementById('bigbroSwitch'); if (sw) sw.classList.remove('on');
    try { imClear(); } catch(e) {}
    await imSay('*doux, immédiatement* Hé' + (nomOu(null) ? ', ' + nomOu(null) : '') + ', je suis là. On arrête tout, d\'accord ? C\'est bon, tu es en sécurité.', 700, 'concern');
    await imSay('Reprends ton souffle. Je redeviens ton Foxy tout doux. Tu as très bien fait de me le dire. On va à ton rythme, tranquille. 🦊💛', 900, 'happy');
    try {
      if (await leverRepriseSafeword()) {
        await imSay('Et ta reprise s\'arrête là aussi : plus aucune mesure. On n\'en reparle pas. 💛', 850, 'comfort');
      }
    } catch(e) {}
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
  /* Plan de notifications exposé au pont natif.
     En PWA les rappels sont des setTimeout : ils meurent avec l'onglet.
     En natif, ce plan est confié au système, qui les déclenche même
     application fermée. Une seule source, deux exécutions. */
  window.__habitrainNotifPlan = function () {
    const items = [];
    try {
      NOTIF_CATEGORIES.forEach(c => c.items.forEach(it => {
        if (it.m == null || !notifPrefs[it.id]) return;
        items.push({
          cle: it.id,
          titre: '🦊 ' + it.n,
          corps: (FOXY_NOTIF && FOXY_NOTIF[it.id]) ? FOXY_NOTIF[it.id] : (it.body || it.n),
          heure: Math.floor(it.m / 60),
          minute: it.m % 60
        });
      }));
    } catch (e) {}
    return { pause: !!paused, items };
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
    tenueSensorCard: async () => { renderTenueSensor(); },
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
    const mp = document.getElementById('menuPanneau'); if (mp) mp.style.display = 'none';
    majPanneau();
    if (show) { renderSettings(); window.scrollTo({ top: 0, behavior:'smooth' }); }
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
        try { await window.storage.set('foxyfit:force:'+todayStr(), JSON.stringify(o.id)); } catch(e) {}
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
      try { await renderRegles(); } catch(e) {}
      try { renderTimeline(); } catch(e) {}
    } else if (name === 'cadre') {
      renderTimeline();
    }
  }
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => showTab(b.dataset.tabname));
  });

  // Filet de rattrapage : passé 22h30, si le relevé n'a pas été pris avec le
  // change de nuit, la fenêtre s'ouvre d'elle-même. (Avant, ce rattrapage ne
  // servait qu'au mode reporting : en mode Foxy — devenu nominal — il ne se
  // déclenchait jamais et le bilan pouvait passer à la trappe.)
  async function maybeRedirectBilan() {
    if (paused) return;
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    if (nowMin < 22*60+30 || nowMin >= 24*60) return; // fenêtre du relevé : 22h30 → minuit
    let alreadySaved = false;
    try {
      const r = await window.storage.get('day:'+todayStr());
      if (r && r.value) { const e = JSON.parse(r.value); if (e && e.skin) alreadySaved = true; }
    } catch(e) {}
    if (alreadySaved) return;
    talk(TALK.CHECK, 'releve:soir:' + todayStr(), async () => {
      try { await releveSoirFenetre(true); } catch(e) {}
    }, { coupe: true });
  }

  (document.getElementById('openDebug')||{addEventListener(){}}).addEventListener('click', async () => {
    const card = document.getElementById('debugCard');
    const show = card.style.display === 'none';
    card.style.display = show ? '' : 'none';
    if (show) { await loadFoxyOutfit(); renderDebugOutfits(); card.scrollIntoView({behavior:'smooth', block:'start'}); }
  });

  // ==== Popup Foxy réutilisable (pause / reprise) ====
  function foxyPopShow(text, expr, buttons, opts) {
    opts = opts || {};
    const ov = document.getElementById('foxyPop');
    const portrait = document.getElementById('foxyPopPortrait');
    const txt = document.getElementById('foxyPopText');
    const acts = document.getElementById('foxyPopActs');
    // portrait dans la tenue du jour, expression donnée
    positionFoxyCell(portrait, expr || 'happy', 120);
    txt.textContent = text;
    acts.innerHTML = '';
    // zone de saisie facultative (relevé du soir : la note libre)
    let champ = null;
    const vieux = document.getElementById('foxyPopInput');
    if (vieux) vieux.remove();
    if (opts.input) {
      champ = document.createElement('textarea');
      champ.id = 'foxyPopInput';
      champ.className = 'foxypop-input';
      champ.placeholder = opts.input.placeholder || '';
      champ.value = opts.input.value || '';
      acts.parentNode.insertBefore(champ, acts);
    }
    (buttons || []).forEach(b => {
      const btn = document.createElement('button');
      if (b.soft) btn.className = 'soft';
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick(champ ? champ.value.trim() : undefined));
      acts.appendChild(btn);
    });
    ov.style.display = 'flex';
    if (champ) setTimeout(() => { try { champ.focus(); } catch(e) {} }, 120);
  }
  function foxyPopHide() {
    const ov = document.getElementById('foxyPop'); if (ov) ov.style.display = 'none';
    const vieux = document.getElementById('foxyPopInput'); if (vieux) vieux.remove();
    setTimeout(() => allerAuChat(), 120);
  }

  /* ==== Relevé du soir — en fenêtre, après le change de nuit ====
     C'est un contrôle : il s'impose à toi, donc il garde sa fenêtre au lieu
     de se diluer dans la conversation. Le formulaire de l'onglet « Mon suivi »
     reste là pour corriger ou rattraper un jour passé. */
  let releveEnCours = false;
  let releveSnooze = 0;

  function qReleve(texte, expr, options, opts) {
    return new Promise(res => {
      foxyPopShow(texte, expr, (options || []).map(o => ({
        label: o.label, soft: o.soft,
        onClick: (saisie) => res(o.v !== undefined ? o.v : saisie)
      })), opts);
    });
  }

  async function releveSoirFenetre(auto) {
    if (paused || releveEnCours) return false;
    if (auto && releveSnooze && Date.now() < releveSnooze) return false;
    const date = todayStr();
    let deja = null;
    try { const r = await window.storage.get('day:'+date); if (r && r.value) deja = JSON.parse(r.value); } catch(e) {}
    if (auto && deja && deja.skin) return false;   // déjà relevé aujourd'hui

    releveEnCours = true;
    try {
      let bibScannes = 0;
      try { bibScannes = await biberonsDuJour(date); } catch(e) {}

      // 1) on annonce : c'est le relevé, il fait partie du change de nuit
      const ouverture = broOn()
        ? 'Te voilà au sec pour la nuit. Reste ton relevé. Ce n\'est pas négociable, et c\'est court.'
        : 'Voilà, tu es propre et au sec pour la nuit. 🦊 Il me reste ton relevé du soir — quatre petites questions, et je te laisse dormir.';
      const go = await qReleve(ouverture, 'calm', hardMode
        ? [{ label: '📝 On y va', v: 'go' }]
        : [{ label: '📝 On y va', v: 'go' }, { label: 'Dans un instant', v: 'plus_tard', soft: true }]);
      if (go === 'plus_tard') {
        releveSnooze = Date.now() + 10 * 60000;
        foxyPopHide();
        talk(TALK.CADRE, 'releve:report:' + Date.now(), async () => {
          await imSay(bro('D\'accord, je te relance dans dix minutes. 🦊',
                          'Je te relance dans dix minutes. Tu ne coupes pas au relevé, tu le sais.'), 700, 'calm');
        });
        return false;
      }

      // 2) la peau — le champ clé
      const skin = await qReleve(
        bro('Ta peau, d\'abord — c\'est ce qui compte le plus. Tu as regardé pendant le change ? 🦊',
            'Ta peau, après cette journée en couche. Regarde bien avant de répondre.'),
        'curious',
        [ { label: '🟢 Verte — tout va bien', v: 'verte' },
          { label: '🟠 À surveiller', v: 'surveiller' },
          { label: '🔴 À traiter', v: 'traiter' } ]);

      // 3) les biberons (les scans font foi : on ne descend pas en dessous)
      const bibOpts = [0,1,2,3].map(n => ({
        label: '🍼 ' + n + (n === bibScannes && bibScannes ? ' (scannés)' : ''), v: n
      }));
      let bib = await qReleve(
        bro('Et tes biberons ? Tu en as bu combien aujourd\'hui ?', 'Combien de biberons aujourd\'hui ?'),
        'bottle', bibOpts);
      bib = Math.max(Number(bib) || 0, bibScannes || 0);

      // 4) la nuit précédente
      const nuit = await qReleve(
        bro('Et la nuit dernière, ta couche a tenu jusqu\'au matin ?',
            'La nuit dernière : ta couche a tenu jusqu\'au matin ?'),
        'sleep',
        [ { label: '🌙 Au sec', v: 'ok' },
          { label: '💧 Limite', v: 'limite' },
          { label: '🌊 Fuite', v: 'fuite' } ]);

      // 5) le type de journée
      const type = await qReleve(
        bro('Ta journée, c\'était solo ou avec ton superviseur ?', 'Journée solo ou supervisée ?'),
        'explain',
        [ { label: '🦊 Solo', v: 'solo' },
          { label: '👤 Supervisée', v: 'supervise' } ]);

      // 6) la note libre — facultative, mais proposée
      const note = await qReleve(
        bro('Tu veux me laisser un mot sur ta journée ? Ce qui a marché, ce qui a coincé. Sinon valide directement. 🦊',
            'Un mot sur ta journée, si tu veux. Sinon, valide.'),
        'moved',
        [ { label: '✓ Enregistrer mon relevé', v: undefined },
          { label: 'Sans note', v: '', soft: true } ],
        { input: { placeholder: 'Ce qui a marché, ce qui a coincé…', value: (deja && deja.note) || '' } });

      const entry = Object.assign({}, deja || {}, {
        date, skin, bib, nuit, type, note: (note || '').trim()
      });
      let ok = true;
      try { await window.storage.set('day:' + date, JSON.stringify(entry)); } catch(e) { ok = false; }

      if (!ok) {
        await qReleve('Je n\'ai pas réussi à enregistrer ton relevé. On réessaiera tout à l\'heure.', 'sad',
          [{ label: 'D\'accord', v: 'x' }]);
        foxyPopHide();
        return false;
      }

      await qReleve(
        skin === 'traiter'
          ? bro('C\'est enregistré. 🦊 Ta peau d\'abord : crème bien épaisse ce soir, et demain matin je regarde avec toi.',
                'Enregistré. Ta peau passe devant tout le reste : crème épaisse maintenant, et je vérifie demain.')
          : bro('Voilà, ta journée est enregistrée. 🐾 Tu peux aller te coucher tranquille.',
                'Enregistré. Journée bouclée, tu peux aller dormir.'),
        skin === 'traiter' ? 'comfort' : 'proud',
        [{ label: 'Bonne nuit 🌙', v: 'fin' }]);
      foxyPopHide();

      // remise à jour du suivi + du formulaire s'il est ouvert sur aujourd'hui
      try { await refresh(); } catch(e) {}
      try { await renderSupMode(); } catch(e) {}
      try {
        const di = document.getElementById('dateInput');
        if (di && (!di.value || di.value === date)) { di.value = date; loadInto(entry); }
      } catch(e) {}

      // le mot de la fin, lui, revient dans la conversation
      talk(TALK.CADRE, 'releve:fait:' + date, async () => {
        if (voiceMode === 'foxy' && !paused) {
          await imSay(skin === 'verte'
            ? bro('Peau verte et relevé complet. Tu tiens ton cadre sans même y penser maintenant. 💛',
                  'Peau verte, journée complète. C\'est exactement ce que j\'attends de toi.')
            : bro('Merci pour ton relevé. On ajustera ce qu\'il faut, et demain on repart tranquillement. 🦊',
                  'Relevé pris. On corrige ce qui doit l\'être, et on repart demain.'),
            900, skin === 'verte' ? 'proud' : 'comfort');
        }
      });
      return true;
    } finally {
      releveEnCours = false;
    }
  }

  // Le relevé se déclenche avec le change de nuit ; ce filet le rattrape si le
  // change n'a pas eu lieu par le flux guidé.
  function releveSoirDu(slotKey) {
    const h = new Date().getHours();
    const tardif = h >= 19 || h < 4;
    if (!tardif) return false;
    return slotKey === 'c2230' || couchageNuit(new Date());
  }

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
    try { await noterDebutPause(); } catch(e) {}
    paused = true;
    document.body.classList.add('paused');
    try { await window.storage.set('pref:paused', JSON.stringify(true)); } catch(e) {}
    // On ne réécrit la date de début QUE si la pause n'en a pas déjà une.
    // Sinon, renoncer à reprendre remettrait le compteur à zéro.
    try {
      const r = await window.storage.get('pause:start');
      if (!r || !r.value) await window.storage.set('pause:start', JSON.stringify(Date.now()));
    } catch(e) {}
    const ov = document.getElementById('overlay'); if (ov) ov.classList.remove('show');
    fillFacade();
  }
  function enterPause() {
    try { foxyPopHide(); } catch(e) {}
    try { loadFoxyOutfit(); } catch(e) {}
    if (mesureDes('pause_encadree')) { pauseEncadree(); return; }
    if (hardMode) {
      // en intensif, Foxy résiste : il faut confirmer fermement
      foxyPopShow('Tu veux vraiment faire une pause ? En mode intensif, on ne s\'échappe pas comme ça... Réfléchis bien. Tu es sûr ?', 'concern', [
        { label:'Oui, j\'ai vraiment besoin de faire une pause', onClick: async () => {
          foxyPopShow('Bon... d\'accord, si tu en as VRAIMENT besoin. Mais je compte sur toi pour revenir vite reprendre le cadre. À tout à l\'heure. 🦊', 'pensive', [
            { label:'Je reviens vite, promis', onClick: async () => { foxyPopHide(); await doEnterPause(); } },
            { soft:true, label:'🧳 Absence prévue : je te dis quand je reviens', onClick: () => pauseChoixRetour('dehors') }
          ]);
        }},
        { soft:true, label:'Non, je continue', onClick: async () => { foxyPopHide(); } }
      ]);
      return;
    }
    foxyPopShow('À très vite, mon compagnon ! Je t\'attends bien au chaud, reviens quand tu veux. 🦊💛', 'wave', [
      { label:'À tout à l\'heure Foxy', onClick: async () => { foxyPopHide(); await doEnterPause(); } },
      { soft:true, label:'🧳 Absence prévue : je te dis quand je reviens', onClick: () => pauseChoixRetour('dehors') }
    ]);
  }
  // Sortie de pause : on quitte l'écran de connexion, mais la pause
  // n'est levée QU'APRÈS confirmation (couche remise ou reprise assumée).
  async function exitPause() {
    document.body.classList.remove('paused');
    try { await refresh(); } catch(e) {}
    // durée de la pause → programme de reprise gradué
    let start = null;
    try { const r = await window.storage.get('pause:start'); if (r && r.value) start = JSON.parse(r.value); } catch(e) {}
    let hours = start ? (Date.now() - start) / 3600000 : 0;
    // Filet de sécurité : si aucune couche n'a été remise depuis plus longtemps
    // que la pause déclarée, c'est cette durée-là qui compte.
    try {
      const sc = await tempsSansCouche();
      if (sc != null && sc > hours) hours = sc;
    } catch(e) {}
    try { if (hours >= 24) await flagBadge('comeback'); } catch(e) {}
    _desCtx = { declaree: true,
                retourPrevu: await lireStock('pause:retour', null),
                motifAnnonce: await lireStock('pause:motif', null) };
    await runResumeProgram(hours);
  }

  // Programme de reprise : plus la pause a duré, plus la reprise est exigeante
  /* ============================================================
     INTERRUPTION SILENCIEUSE
     Tu n'as pas appuyé sur Pause, mais le programme s'est arrêté :
     ni change, ni journée renseignée pendant longtemps.
     On mesure l'arrêt sur le PLUS RÉCENT des deux repères.
     ============================================================ */
  async function detecterArretSilencieux() {
    try {
      // repère 1 : dernier change effectif
      const dernierChange = await lastChangeTime(30);   // on remonte jusqu'à un mois
      // repère 2 : dernière journée renseignée
      let derniereJournee = null;
      const entries = await getAll();
      const dates = entries.filter(e => e && e.date).map(e => e.date).sort();
      if (dates.length) {
        // fin de la dernière journée renseignée (on la considère close à 23h59)
        const d = new Date(dates[dates.length-1] + 'T23:59:00');
        derniereJournee = d.getTime();
      }
      // le plus récent des deux fait foi
      let repere = null;
      if (dernierChange && derniereJournee) repere = Math.max(dernierChange.getTime(), derniereJournee);
      else if (dernierChange) repere = dernierChange.getTime();
      else if (derniereJournee) repere = derniereJournee;
      if (!repere) return 0;

      const heures = (Date.now() - repere) / 3600000;
      // durée SANS COUCHE : uniquement depuis le dernier change
      const sansCouche = dernierChange ? (Date.now() - dernierChange.getTime()) / 3600000 : null;
      // en dessous de 18h, ce n'est qu'une nuit : pas un arrêt.
      // Pendant une reprise sous surveillance, 12h suffisent (22h30 → 10h30).
      if (heures < (mesureDes('surveillance') ? 12 : 18)) return 0;
      // on mémorise le détail pour le message
      _arretDetail = { suivi: heures, sansCouche };
      return heures;
    } catch(e) { return 0; }
  }
  let _arretDetail = null;

  // Lève réellement la pause (appelée uniquement à la confirmation)
  async function confirmerReprise() {
    paused = false;
    document.body.classList.remove('paused');
    try { await window.storage.set('pref:paused', JSON.stringify(false)); } catch(e) {}
    try { await window.storage.delete('pause:start'); } catch(e) {}
    try { await noterFinPause(); } catch(e) {}
    try { await refresh(); } catch(e) {}
  }

  // Retour à la pause si tu n'as pas confirmé
  async function annulerReprise() {
    paused = true;
    document.body.classList.add('paused');
    try { await window.storage.set('pref:paused', JSON.stringify(true)); } catch(e) {}
  }

  async function runResumeProgram(hours) {
    try { await constaterDesertion(hours); } catch(e) {}
    const now = new Date();
    const isNight = now.getHours() >= 23 || now.getHours() < 7;

    // --- Palier COURT (< 2h) : reprise légère ---
    if (hours < 2) {
      if (isNight) {
        foxyPopShow('Mmh... te revoilà. Il est tard, mais je suis content que tu sois là. 😴🦊', 'sleep', [
          { label:'Coucou Foxy', onClick: async () => { foxyPopHide(); await confirmerReprise(); if (voiceMode==='foxy') { try { await imRunMoment(); } catch(e){} } } }
        ]);
        return;
      }
      foxyPopShow('Te revoilà ! Courte absence, on reprend le fil tranquillement. Tu es toujours en couche ?', 'joy', [
        { label:'🤗 Oui, on replonge !', onClick: async () => {
          foxyPopHide();
          _desReserve = true;
          await confirmerReprise();
          const des = await desertionEnAttente();
          if (voiceMode !== 'foxy') { await setVoiceMode('foxy'); }
          else if (!des) { try { await imRunMoment(); } catch(e){} }
          if (des) { try { imClear(); await recadrageDesertion(); } catch(e) {} }
          _desReserve = false;
        }},
        { label:'👕 Non, je dois remettre ma couche', onClick: async () => {
          foxyPopHide();
          if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
          try { await runReentryProtocol('court'); } catch(e) {}
        }},
        { soft:true, label:'Pas tout de suite', onClick: async () => {
          foxyPopShow('D\'accord... je t\'attends. Reviens vite. 🦊💛', 'concern', [
            { label:'À très vite', onClick: async () => { foxyPopHide(); try { await noterRefusRetour(); } catch(e) {} await annulerReprise(); await doEnterPause(); } }
          ]);
        }}
      ]);
      return;
    }

    // --- Paliers supérieurs : reprise imposée ---
    let niveau, dureeTxt, entorse, msg1, msg2;
    if (hours < 24) {
      niveau = 'moyen';
      dureeTxt = fmtDuree(hours);
      entorse = 'pause_moyenne';
      msg1 = 'Te voilà. Tu as été absent ' + dureeTxt + '. On ne reprend pas comme si de rien n\'était.';
      msg2 = 'Change de reprise, tout de suite, et vérification de ton état. Ensuite on retrouve le rythme. Allez.';
    } else if (hours < 72) {
      niveau = 'long';
      dureeTxt = fmtDuree(hours);
      entorse = 'pause_longue';
      msg1 = dureeTxt + ' d\'absence. C\'est long. Le cadre s\'est défait pendant ce temps, et ça, ça compte.';
      msg2 = 'Reprise stricte : change immédiat, contention sur ta prochaine fenêtre, et je te surveille de près pour le reste de la journée. On répare ça ensemble.';
    } else {
      niveau = 'tres_long';
      dureeTxt = fmtDuree(hours);
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
      { soft:true, label:'Pas maintenant', onClick: async () => { foxyPopHide(); try { await noterRefusRetour(); } catch(e) {} await annulerReprise(); await doEnterPause(); } },
      { label:'Je t\'écoute...', onClick: async () => {
        foxyPopShow(msg2, niveau === 'tres_long' ? 'surprised' : 'concern', [
          { label:'🦊 Qu\'est-ce que je fais ?', onClick: async () => {
            foxyPopHide();
            if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
            try { await runReentryProtocol(niveau); } catch(e) {}
          }}
        ]);
      }}
    ]);
  }

  /* ============================================================
     REMETTRE SA COUCHE — après une pause, tu ne la portes plus :
     Foxy t'explique la marche à suivre étape par étape, tire tes
     tenues du jour et te remet dans le programme.
     ============================================================ */
  // Foxy signale un arrêt du programme non déclaré
  function fmtDuree(h) {
    if (h == null) return null;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' minutes';
    if (h < 1.5) return 'une heure';
    if (h < 48) return Math.round(h) + ' heures';
    const j = Math.floor(h / 24);
    if (j < 14) return j + ' jours';
    const sem = Math.floor(j / 7), reste = j % 7;
    return sem + ' semaine' + (sem > 1 ? 's' : '') + (reste ? ' et ' + reste + ' jour' + (reste > 1 ? 's' : '') : '');
  }

  function showArretSilencieux(heures) {
    const dur = fmtDuree(heures);
    // le temps SANS COUCHE est souvent plus long que l'arrêt du suivi
    const sc = (_arretDetail && _arretDetail.sansCouche) ? _arretDetail.sansCouche : null;
    const durSC = fmtDuree(sc);
    const detail = (durSC && sc > heures + 12)
      ? (broOn()
          ? ' Et tu n\'as pas eu de couche depuis ' + durSC + '. Ça, c\'est encore plus long.'
          : ' Et ta dernière couche remonte à ' + durSC + '... ça fait un bail. 🦊')
      : '';
    foxyPopShow(
      broOn()
        ? 'Le programme s\'est arrêté pendant ' + dur + ', et tu ne m\'as rien dit.' + detail + ' Ça ne se passe pas comme ça. On reprend.'
        : 'Hé... 🦊 Ça fait ' + dur + ' que rien ne s\'est passé — pas de change, pas de suivi.' + detail + ' On reprend ensemble ?',
      'concern',
      [
        { label:'🦊 Oui, on reprend', onClick: async () => {
          foxyPopHide();
          if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
          _desCtx = { declaree: false };
          try { await runResumeProgram(heures); } catch(e) {}
        }},
        { soft:true, label:'J\'ai continué sans noter', onClick: async () => {
          foxyPopHide();
          if (voiceMode === 'foxy') {
            try { await imSay(broOn()
              ? 'Alors note-le, la prochaine fois. Sans trace, ça n\'existe pas pour moi.'
              : 'Ah d\'accord ! Pense à valider tes changes dans l\'appli, sinon je ne peux pas suivre. 🦊', 900, 'pensive'); } catch(e) {}
          }
        }},
        { soft:true, label:'Plus tard', onClick: () => foxyPopHide() }
      ]
    );
  }

  // Foxy signale que la couche n'a jamais été remise jusqu'au bout
  function showReentryReminder(heures, niveau) {
    const dur = heures < 1 ? 'moins d\'une heure'
              : heures < 24 ? Math.round(heures) + ' heures'
              : Math.round(heures/24) + ' jour(s)';
    foxyPopShow(
      broOn()
        ? 'Attends. Tu as commencé à remettre ta couche il y a ' + dur + ', et tu n\'es jamais allé au bout. Tu n\'as donc rien sur toi. Ça, ça ne va pas.'
        : 'Hé... 🦊 Tu avais commencé à remettre ta couche il y a ' + dur + ', mais on n\'a jamais fini ! Du coup tu n\'as rien sur toi, et ton suivi est faussé.',
      'concern',
      [
        { label:'🦊 Je la remets maintenant', onClick: async () => {
          foxyPopHide();
          if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e){} }
          try { await runReentryProtocol(niveau || 'moyen'); } catch(e) {}
        }},
        { soft:true, label:'J\'ai déjà ma couche', onClick: async () => {
          foxyPopHide();
          try { await window.storage.delete('reentry:pending'); } catch(e) {}
          try { await finishChange(); } catch(e) {}
          if (voiceMode === 'foxy') {
            try { await imSay('Ah, d\'accord ! Je note ton change alors. Comme ça ton suivi repart juste. 🦊', 850, 'happy'); } catch(e) {}
            if (await desertionEnAttente()) { try { await recadrageDesertion(); } catch(e) {} }
          }
        }},
        { soft:true, label:'Plus tard', onClick: () => foxyPopHide() }
      ]
    );
  }

  /* La reprise après pause prend la parole et ne la rend qu'à la fin.
     Elle tournait jusqu'ici HORS du chef d'orchestre : n'importe quelle
     discussion programmée pouvait donc s'installer par-dessus, en plein
     milieu. C'est ce qui la hachait. */
  async function runReentryProtocol(niveau) {
    return talk(TALK.ACCES, 'reentry:protocole',
                () => reentryInterne(niveau), { coupe: true });
  }

  /* Récapitulatif de reprise : Foxy énumère ce que tu dois avoir sur toi
     MAINTENANT, en lisant les données réelles — modèle de couche restant,
     tenue tirée, capteurs déclarés — au lieu d'une formule générique. */
  async function recapReprise() {
    const lignes = [];
    try {
      const o = await getOutfit(todayStr());
      const att = tenueAttendue(o, new Date(), couchageNuit(new Date()));
      if (att && att.nom) lignes.push('👕 Tenue : <b>' + att.nom + '</b> (' + att.moment + ')');
    } catch(e) {}
    try {
      if (window.HabitrainWardrobe) {
        // même période que celle réellement posée (bascule de 19h30 comprise)
        const per = couchageNuit(new Date()) ? 'nuit' : 'jour';
        // la couche qu'on vient de poser, pas celle du prochain change
        const posee = await lireStock('couche:posee', null);
        const stock = await window.HabitrainWardrobe.getStock();
        const m = (posee && Date.now() - posee.t < 3600000 && stock.find(x => x.id === posee.id)) || await modeleProchain(per);
        if (m) lignes.push('🍼 Couche : <b>' + m.name + '</b> — ' + m.qty + ' restantes');
        else lignes.push('🍼 Couche : <b>stock épuisé</b> pour la période, pense à recommander');
      }
    } catch(e) {}
    try {
      const r = await window.storage.get('sensor:vu');
      if (r && r.value) lignes.push('📡 Capteur de couche : à replacer à l\'avant de la couche fraîche');
    } catch(e) {}
    try {
      if (await capteurTenueEnService()) lignes.push('🔒 Module de tenue : à reclipser en butée de fermeture');
    } catch(e) {}

    if (!lignes.length) return;
    if (couchageNuit(new Date()) && !estNuit(new Date())) {
      await imSay(broOn()
        ? 'Il est trop tard pour une couche de jour. Tu repars directement en nuit.'
        : 'Vu l\'heure, on ne s\'embête pas avec une couche de jour : tu repars directement en tenue et couche de nuit. 🦊',
        900, 'calm');
    }
    await imSay('Ce que tu dois avoir sur toi, là, maintenant :', 800, 'explain');
    await imSay(lignes.join('<br>'), 1100, 'teach');
  }

  /* Validation d'une étape de reprise.
     Sans élément vérifiable : une simple confirmation suffit, on ne va pas
     te demander de prouver que tu as regardé ta peau.
     Avec : la preuve est exigée pour avancer. */
  async function validerEtapeReprise(e) {
    if (!e.verif) {
      return new Promise(res => {
        imSetActions([{ label:'✓ C\'est fait', onClick: () => { imAddMe('C\'est fait.'); res('ok'); } }]);
      });
    }

    // capteurs : on lit leur état en direct, aucun scan à faire de ta part
    if (e.verif === 'capteur_couche' || e.verif === 'capteur_tenue') {
      return new Promise(res => {
        imSetActions([
          { label:'📡 Vérifier le capteur', onClick: async () => {
            imAddMe('Vérifie le capteur.');
            const ok = await lireCapteurPourReprise(e.verif);
            if (ok) { await imSay(broOn() ? 'Il répond. Bien.' : 'Il répond, il est en place ! 🦊', 800, 'proud'); res('ok'); return; }
            await imSay(broOn()
              ? 'Aucune réponse. Il n\'est pas connecté, ou pas en place.'
              : 'Je n\'ai aucune réponse de lui... Il est connecté ? Sinon passe par le menu des réglages. 🦊', 950, 'concern');
            const suite = await validerEtapeReprise(e);
            res(suite);
          }},
          { soft:true, label:'Je ne l\'utilise pas là', onClick: async () => {
            imAddMe('Je ne l\'utilise pas là.');
            try { await marquerEntorse('b_capteur_muet'); } catch(e2) {}
            res('force');
          }}
        ]);
      });
    }

    // le reste passe par le moteur de preuve : QR ou tag
    return new Promise(res => {
      imSetActions([{ label:'📷 Je le scanne', onClick: async () => {
        imAddMe('Je le scanne.');
        const ok = await exigerPreuves([e.verif], { nuit: couchageNuit(new Date()) });
        res(ok ? 'ok' : 'force');
      }}]);
    });
  }

  async function lireCapteurPourReprise(quoi) {
    try {
      if (quoi === 'capteur_tenue') {
        const TS = window.HabitrainTenueSensor;
        if (!TS || !TS.connecte()) return false;
        const ouvert = await TS.lireEtat();
        return ouvert === false;           // on veut « fermée »
      }
      // capteur de couche : une mesure de moins de 10 minutes vaut présence
      const m = await etatMesure(10);
      return !!m;
    } catch(e) { return false; }
  }

  async function reentryInterne(niveau) {
    // on note que la couche est en train d'être remise, mais pas encore confirmée
    try { await window.storage.set('reentry:pending', JSON.stringify({ start: Date.now(), niveau })); } catch(e) {}
    imClear();
    const now = new Date();
    const h = now.getHours();
    const periode = couchageNuit(now) ? 'nuit' : 'jour';

    // --- Accueil chaleureux : retour à la maison ---
    const ACCUEIL = broOn() ? [
      'Te revoilà chez toi. Tu peux poser tout ce que tu portais dehors — ici, ça ne te sert à rien.',
      'Respire. Tu es rentré. Ta vie d\'adulte reste à la porte, elle t\'attendra bien.',
      'Ici, tu n\'as plus de décisions à prendre. C\'est moi qui m\'occupe de tout. Laisse-toi aller.'
    ] : [
      'Te revoilàààà' + (nomOu(null) ? ', ' + nomOu(null) : '') + ' ! 🦊💛 Bienvenue à la maison, tu m\'as tellement manqué !',
      'Ahhh, ça fait du bien de te retrouver ! Allez, pose tout ça : ici tu peux laisser ta vie d\'adulte dehors.',
      'Tu es rentré ! Ici, pas de responsabilités, pas de pression — juste toi, moi, et plein de douceur. 💛'
    ];
    for (const a of ACCUEIL) { await imSay(a, 950, broOn() ? 'calm' : 'comfort'); }
    await imSay(broOn()
      ? 'Maintenant tu vas remettre ta couche. Tu ne l\'avais pas pendant ton absence — on repart du début.'
      : 'Allez, on va te remettre bien comme il faut ! Tu n\'avais pas ta couche pendant ta pause, alors on repart du début. Je t\'explique tout, viens. 🦊', 1000, 'calm');

    // 1) tenues du jour
    // On réutilise le tirage déjà enregistré s'il existe, et on enregistre
    // celui qu'on tire sinon. Sans ça, le retour annonçait une tenue tirée
    // dans le vide : la carte du jour et « je fais quoi maintenant » lisaient
    // le tirage stocké, Foxy en annonçait un autre. Deux tenues pour un jour.
    let tenues = null, dejaTire = false;
    try {
      tenues = await getOutfit(todayStr());
      dejaTire = !!tenues;
      if (!tenues) {
        tenues = drawOutfit();
        await saveOutfit(todayStr(), tenues);
        try { await renderOutfitCard(); } catch(e) {}
      }
    } catch(e) {
      try { tenues = drawOutfit(); } catch(e2) {}
    }
    // 2) modèle de couche selon le moment
    let modele = null;
    try {
      if (window.HabitrainWardrobe) {
        modele = await modeleProchain(periode);
        if (modele) changeModel = modele;
      }
    } catch(e) {}

    const tenueDuMoment = tenues ? (periode === 'nuit' ? tenues.nuit : tenues.jour) : null;

    await imSay(dejaTire
      ? 'Ta tenue du jour est déjà tirée — c\'est celle-là, tu ne choisis pas. Ça fait partie du retour dans le cadre.'
      : 'J\'ai tiré ta tenue pour toi — tu ne choisis pas, ça fait partie du retour dans le cadre.', 900, 'proud');
    let recap = '👕 Tenue de ' + periode + ' : ' + (tenueDuMoment || 'ta tenue habituelle');
    if (modele) recap += '\n🍼 Couche : ' + modele.name + ' (' + modele.qty + ' en stock)';
    else recap += '\n🍼 Couche : prends ce que tu as en stock';
    if (tenues && periode !== 'nuit' && tenues.sieste) recap += '\n😴 Pour la sieste : ' + tenues.sieste;
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

    // quels capteurs sont en service ? on ne fait vérifier que ce que tu as
    let capteurCouche = false, capteurTenue = false;
    try { const r = await window.storage.get('sensor:vu'); capteurCouche = !!(r && r.value); } catch(e) {}
    try { capteurTenue = await capteurTenueEnService(); } catch(e) {}

    // 3) la marche à suivre, VÉRIFIÉE étape par étape.
    // Réciter la liste ne prouve rien : chaque étape qui porte un élément
    // vérifiable exige sa preuve avant qu'on avance à la suivante.
    await imSay('On y va ensemble, une étape à la fois. Je vérifie au fur et à mesure.', 900, 'teach');

    const etapes = [
      { t:'Va à ton espace de change et prépare tout : couche, crème, lingettes.' },
      { t:'Enlève ce que tu portes. On repart de zéro.' },
      { t:'Regarde ta peau avant de commencer — elle doit être propre et sèche.' },
      { t:'Applique la crème barrière, généreusement.' },
      { t:'Mets ta couche bien en place, en suivant le guide des 4 languettes.'
          + (modele ? ' Ce sera une ' + modele.name + '.' : ''),
        verif:'change_pilier' },
      { t:'Enfile la tenue que je t\'ai tirée' + (tenueDuMoment ? ' : ' + tenueDuMoment + '.' : '.'),
        verif:'tenue' },
      braceletActif
        ? { t:'Remets ton bracelet au poignet — sans lui, l\'appli restera verrouillée.', verif:'unlock' }
        : null,
      access.length ? { t:'Reprends tes accessoires : ' + access.join(', ') + '.' } : null,
      capteurCouche
        ? { t:'Reclipse ton capteur de couche à l\'avant, sous la ceinture, et reconnecte-le dans le menu 📡.',
            verif:'capteur_couche' }
        : null,
      capteurTenue
        ? { t:'Reclipse le module de tenue en butée de fermeture, une fois la tenue fermée.',
            verif:'capteur_tenue' }
        : null,
      { t: niveau === 'tres_long'
          ? 'Prends un moment pour te réhabituer. Ton corps a perdu le réflexe, c\'est normal — ne force pas, laisse revenir.'
          : 'Reprends ton rythme normal : le prochain créneau te sera rappelé.' }
    ].filter(Boolean);

    const prouves = {};
    for (let i = 0; i < etapes.length; i++) {
      const e = etapes[i];
      await imSay('<b>Étape ' + (i+1) + ' / ' + etapes.length + '</b><br>' + e.t, 950, 'explain');
      const r = await validerEtapeReprise(e);
      if (r === 'ok' && e.verif) prouves[e.verif] = true;
    }

    if (niveau === 'long' || niveau === 'tres_long') {
      await imSay('Et n\'oublie pas : contention douce sur ta prochaine fenêtre de régression, et je te surveille de près pour le reste de la journée.', 950, 'calm');
    }

    imSetActions([
      { label:'🦊 Terminer ma reprise', onClick: async () => {
        imAddMe('Je termine ma reprise.');

        // On vérifie AVANT de lever la pause. Jusqu'ici la reprise était
        // validée sur ta seule parole, et le change ne venait qu'après :
        // un scan raté laissait quand même le programme repris.
        if (!(prouves.change_pilier && prouves.tenue)) {
          await imSay(broOn()
            ? 'Pas si vite. Montre-moi.'
            : 'Attends, je vérifie avec toi — c\'est la reprise, je ne veux rien laisser au hasard. 🦊', 800, 'curious');
        }

        const prouve = await finishChange({
          exigerTenue: true,
          dejaProuve: (prouves.change_pilier && prouves.tenue) ? ['change_pilier','tenue'] : null
        });

        if (!prouve) {
          await imSay(broOn()
            ? 'Sans preuve, la reprise n\'est pas actée. Tu restes en pause jusqu\'à ce que tu me montres.'
            : 'Je n\'ai pas pu vérifier... Je préfère te laisser en pause plutôt que de faire semblant. Reviens me voir quand tu peux scanner. 🦊', 1000, 'concern');
          imSetActions([
            { label:'📷 Je réessaie maintenant', onClick: async () => { await reentryInterne(niveau); } },
            { soft:true, label:'Plus tard', onClick: async () => { foxyPopHide(); } }
          ]);
          return;
        }

        // protocole mené à son terme : c'est maintenant que la pause est levée
        _desReserve = true;
        try { await window.storage.delete('reentry:pending'); } catch(e) {}
        await confirmerReprise();
        await recapReprise();
        await imSay(broOn()
          ? 'Bien. Te revoilà où tu dois être, comme il faut. Maintenant tu ne ressors plus du cadre — laisse-toi porter, c\'est tout ce que tu as à faire.'
          : 'Voilààà ! Te revoilà tout bien installé. 🦊 Tu es à la maison, en sécurité, et je m\'occupe de tout maintenant. Content de t\'avoir retrouvé, vraiment. 💛', 1000, 'proud');
        // une désertion constatée : la morale vient maintenant, couche remise
        if (await desertionEnAttente()) { try { await recadrageDesertion(); } catch(e) {} _desReserve = false; return; }
        _desReserve = false;
        try { await imRunMoment(); } catch(e) {}
      }},
      { soft:true, label:'Répète-moi les étapes', onClick: async () => { await reentryInterne(niveau); } }
    ]);
  }

  /* ============================================================
     DÉSERTION — la morale, puis ce qui change pour que ça ne se
     reproduise pas.

     Ce qui compte comme une désertion :
       · un arrêt silencieux (rien appuyé, rien dit) ;
       · une pause de plus de 24 h qui n'avait pas été annoncée ;
       · un retour avec plus de 2 h de retard sur l'heure promise ;
       · un départ sur « j'ai envie de partir » ;
       · quatre pauses d'une heure ou plus en sept jours.
     Une absence annoncée à l'avance, avec son heure de retour, et
     tenue : ce n'est PAS une désertion.

     Déroulé :
       1. au retour, la couche est remise d'abord (protocole de reprise) ;
       2. ensuite seulement, Foxy fait la morale : les faits, la raison,
          ce qu'il recoupe, ce qui se répète ;
       3. il pose des mesures, pour quelques jours, choisies d'après la
          raison — elles s'accrochent aux protocoles existants.
     Limites intactes : on peut toujours sortir (la pause reste
     possible, jamais bloquée), et le safeword lève tout.
     ============================================================ */
  const DES_CLE = 'desertion:encours';   // constatée, pas encore « parlée »
  const DES_HIST = 'desertion:hist';     // toutes, pour voir ce qui se répète
  const DES_REGIME = 'desertion:regime'; // mesures en cours
  let desRegime = null;                  // copie en mémoire (le tirage est synchrone)
  let _desCtx = null;                    // contexte de la sortie de pause en cours
  let _recadrageEnCours = false;
  let _desReserve = false;               // un protocole va la faire lui-même : le minuteur s'abstient
  const JOURS_SEM = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const FERMEE_DOS = ['gren_dos', 'keeper'];

  async function loadDesertion() {
    desRegime = await lireStock(DES_REGIME, null);
  }
  async function setRegime(r) {
    desRegime = r;
    await ecrireStock(DES_REGIME, r);
    try { renderDesertion(); } catch(e) {}
  }
  function regimeActif() { return !!(desRegime && Date.now() < desRegime.fin); }
  function mesureDes(id) { return regimeActif() && desRegime.mesures.indexOf(id) >= 0; }
  async function desertionEnAttente() { return !!(await lireStock(DES_CLE, null)); }

  function dateCle(ms) { return new Date(ms).toISOString().slice(0,10); }
  function heureTxt(ms) {
    const d = new Date(ms);
    return d.getHours() + 'h' + String(d.getMinutes()).padStart(2,'0');
  }
  function jourTxt(ms) {
    const d = new Date(ms), auj = new Date();
    if (dateCle(ms) === dateCle(auj.getTime())) return 'aujourd\'hui';
    const hier = new Date(); hier.setDate(hier.getDate()-1);
    if (dateCle(ms) === dateCle(hier.getTime())) return 'hier';
    return JOURS_SEM[d.getDay()] + ' ' + d.getDate();
  }
  function nieme(n) { return n === 1 ? 'première' : n === 2 ? 'deuxième' : n === 3 ? 'troisième' : n + 'e'; }

  // poids des entorses d'une journée
  async function poidsEntorses(date) {
    const b = await getBreaches(date);
    let p = 0;
    Object.keys(b).forEach(id => { if (!b[id]) return; const it = BREACHES.find(x => x.id === id); p += it ? it.w : 5; });
    return p;
  }

  /* ---------- Historique des pauses (pour les « petites touches ») ---------- */
  async function noterDebutPause() {
    const l = await lireStock('pause:hist', []);
    const der = l[l.length-1];
    if (der && !der.fin) return;                 // déjà ouverte (retour refusé)
    l.push({ debut: Date.now() });
    await ecrireStock('pause:hist', l.slice(-40));
  }
  async function noterFinPause() {
    const l = await lireStock('pause:hist', []);
    const der = l[l.length-1];
    if (der && !der.fin) { der.fin = Date.now(); await ecrireStock('pause:hist', l); }
    await ecrireStock('pause:retour', null);
    await ecrireStock('pause:motif', null);
  }

  /* ---------- Constat, au moment du retour ---------- */
  async function constaterDesertion(heures) {
    const ctx = _desCtx || { declaree: true };
    _desCtx = null;
    const now = Date.now();
    const retard = ctx.retourPrevu ? Math.max(0, (now - ctx.retourPrevu) / 3600000) : 0;
    const ph = await lireStock('pause:hist', []);
    const petites = ph.filter(p => p.fin && now - p.debut < 7*86400000 && (p.fin - p.debut) >= 3600000).length
                  + (heures >= 1 ? 1 : 0);
    const seuilSilence = mesureDes('surveillance') ? 12 : 18;
    const annoncee = ctx.declaree && ctx.retourPrevu && retard < 2;

    let raison = null;
    if (!ctx.declaree && heures >= seuilSilence) raison = 'silence';
    else if (retard >= 2) raison = 'retard';
    else if (ctx.motifAnnonce === 'envie' && heures >= 1) raison = 'envie';
    else if (heures >= 24 && !annoncee) raison = 'longue';
    else if (petites >= 4 && !annoncee) raison = 'petites';

    const ex = await lireStock(DES_CLE, null);
    if (!raison && !ex) return null;

    let sansCouche = null;
    try { sansCouche = await tempsSansCouche(); } catch(e) {}
    const d = Object.assign({}, ex || {}, {
      debut: Math.min(ex ? ex.debut : now, now - heures*3600000),
      heures: Math.max(heures, ex ? ex.heures : 0),
      sansCouche,
      declaree: !!ctx.declaree && !(ex && ex.declaree === false),
      retard: Math.max(retard, ex ? (ex.retard || 0) : 0),
      retourPrevu: ctx.retourPrevu || (ex && ex.retourPrevu) || null,
      motifAnnonce: ctx.motifAnnonce || (ex && ex.motifAnnonce) || null,
      petites,
      raison: (ex && ex.raison) || raison,
      refus: ex ? (ex.refus || 0) : 0,
      enRegime: regimeActif() || !!(ex && ex.enRegime),
      constate: now
    });
    await ecrireStock(DES_CLE, d);
    try {
      if (!d.declaree) await marquerEntorse('b_arret_silencieux', true);
      if (d.retard >= 2) await marquerEntorse('b_retour_tardif', true);
    } catch(e) {}
    return d;
  }
  // « Pas maintenant » au moment de revenir : ça se compte.
  async function noterRefusRetour() {
    const d = await lireStock(DES_CLE, null);
    if (!d) return;
    d.refus = (d.refus || 0) + 1;
    await ecrireStock(DES_CLE, d);
    try { await marquerEntorse('b_refus_retour', true); } catch(e) {}
  }

  /* ---------- Ce que Foxy voit dans l'historique ---------- */
  async function diagnosticDesertion(d, hist) {
    const lignes = [];
    const toutes = hist.concat([{ debut: d.debut, motif: null }]);
    const recentes = toutes.filter(x => Date.now() - x.debut < 60*86400000);

    // même jour de la semaine
    const jd = new Date(d.debut).getDay();
    const memeJour = recentes.filter(x => new Date(x.debut).getDay() === jd).length;
    if (memeJour >= 2) lignes.push({
      f:"Et il y a une chose que je remarque : c'est la " + nieme(memeJour) + " fois que tu pars un " + JOURS_SEM[jd] + ". Ce n'est pas un hasard. Quelque chose, ce jour-là, te tire dehors — et on va le regarder en face.",
      b:"C'est la " + nieme(memeJour) + " fois que tu pars un " + JOURS_SEM[jd] + ". Pas un hasard." });

    // toujours le soir
    const soirs = recentes.filter(x => { const h = new Date(x.debut).getHours(); return h >= 19 || h < 2; }).length;
    if (soirs >= 2 && memeJour < 2) lignes.push({
      f:"Et tu pars le soir. À chaque fois. Quand la journée a été longue et que la couche du soir pèse un peu plus. C'est le moment où tu es le plus fragile, et c'est là qu'il faut qu'on soit plus solides, toi et moi.",
      b:"Tu pars le soir. À chaque fois. C'est ton point faible, on le couvre." });

    // la veille, ça lâchait déjà
    const veille = new Date(d.debut); veille.setDate(veille.getDate()-1);
    const pVeille = await poidsEntorses(dateCle(veille.getTime())) + await poidsEntorses(dateCle(d.debut));
    if (pVeille >= 12) lignes.push({
      f:"Et avant de partir, tu décrochais déjà : " + pVeille + " points d'entorses sur ta dernière journée. On ne part jamais d'un coup, tu sais. On lâche un fil, puis deux, et un soir on ne revient pas. Moi, je veux qu'on rattrape le premier fil.",
      b:"Ta dernière journée : " + pVeille + " points d'entorses. Tu lâchais avant de partir. On ne part jamais d'un coup." });

    // il avait dit que c'était dur
    try {
      const m1 = await lireStock('moral:' + dateCle(d.debut), []);
      const m0 = await lireStock('moral:' + dateCle(veille.getTime()), []);
      if (m0.concat(m1).some(x => x.v === 'dur' || x.v === 'fatigue')) lignes.push({
        f:"Et tu me l'avais dit, que c'était dur. Tu me l'as dit, et puis tu es parti. La prochaine fois que tu me dis ça, je veux qu'on allège ensemble — pas que tu règles ça tout seul en claquant la porte.",
        b:"Tu m'avais dit que c'était dur. Puis tu es parti. La prochaine fois, on allège ensemble. Tu ne règles pas ça seul." });
    } catch(e) {}

    // pendant une reprise
    if (d.enRegime) lignes.push({
      f:"Et tu es parti alors que tu étais déjà en reprise après une désertion. Ça, ça me dit que ce qu'on avait mis en place n'a pas suffi. Alors on serre plus fort.",
      b:"Tu es parti pendant ta reprise. Ce qu'on avait mis ne suffisait pas. On serre." });

    // plus longue que la précédente
    const prec = hist[hist.length-1];
    if (prec && prec.heures && d.heures > prec.heures * 1.5 && Date.now() - prec.debut < 60*86400000) lignes.push({
      f:"Et celle-ci a duré plus longtemps que la précédente (" + fmtDuree(prec.heures) + " la dernière fois). Elles s'allongent. C'est exactement la pente que je ne veux pas qu'on prenne.",
      b:"Plus longue que la précédente (" + fmtDuree(prec.heures) + "). Elles s'allongent. Non." });

    return lignes.slice(0, 3);
  }

  /* ---------- Les mesures ---------- */
  const MESURES_DES = {
    pacte: { ic:'🤝', n:'Le pacte, à chaque pilier',
      t:'À chaque change pilier, Foxy te demande si tu restes. Dire que l\'envie de partir est là n\'est jamais une entorse.',
      dire:{ f:"À chaque change pilier, avant que tu repartes, je te demanderai si tu restes. Ce n'est pas une formalité. Partir, ça commence toujours par un moment où on arrête de se poser la question. Moi, je te la poserai trois fois par jour. Et si la réponse est « j'ai envie de partir », tu me le dis — ça, ce ne sera jamais une faute.",
             b:"Trois fois par jour, au pilier, tu me dis si tu restes. Et si l'envie est là, tu le dis. Ce n'est pas une faute. Partir sans le dire, si." } },
    tenue_fermee: { ic:'🔐', n:'Tenues fermées dans le dos',
      t:'Le tirage ne sort plus que des tenues à fermeture dorsale quand ta garde-robe en a, dès le prochain tirage.',
      dire:{ f:"À partir du prochain tirage, je ne sors plus que des tenues fermées dans le dos. Pas pour t'enfermer : pour remettre ces quelques secondes entre l'envie et le geste. Partir, ça commence toujours par se déshabiller. Là, ce sera plus long. Et l'envie ne tient pas si longtemps.",
             b:"Au prochain tirage : fermeture dans le dos, uniquement. Partir commence par se déshabiller. Ce sera plus long. L'envie ne tient pas." } },
    pause_encadree: { ic:'⏸️', n:'Pause encadrée',
      t:'Toute pause se déclare : une raison et une heure de retour. Plus de 2 h de retard et c\'est une désertion. La pause reste toujours possible.',
      dire:{ f:"La pause, tu la gardes — je ne te l'enlèverai jamais, ce serait te mentir sur ce qu'est le cadre. Mais pendant ta reprise, elle se déclare : pourquoi, et quand tu reviens. Si tu reviens plus de deux heures après l'heure promise, je considère que tu es parti. Et si c'est juste l'envie qui te pousse, je te demanderai dix minutes avec moi d'abord. Dix minutes, c'est tout.",
             b:"La pause reste. Mais elle se déclare : pourquoi, et quand tu reviens. Deux heures de retard, c'est une désertion. Et si c'est l'envie, dix minutes avec moi d'abord." } },
    envie_soir: { ic:'🌙', n:'L\'envie de partir, chaque soir',
      t:'Chaque soir, Foxy demande si l\'envie de partir est passée. Forte, on en parle tout de suite.',
      dire:{ f:"Chaque soir, je te demanderai si l'envie de partir est passée te voir dans la journée. Juste ça. Elle ne disparaît pas parce qu'on n'en parle pas — elle grandit dans son coin. Moi, je veux la voir arriver.",
             b:"Chaque soir, je te demande si l'envie de partir est venue. Elle grandit quand on la tait. Je veux la voir venir." } },
    regression_due: { ic:'🧸', n:'Régressions attendues',
      t:'Les fenêtres de régression ne se refusent plus d\'un simple « pas maintenant » : si tu ne peux pas, tu dis pourquoi.',
      dire:{ f:"Tes fenêtres de régression, pendant la reprise, ce n'est plus une proposition qu'on écarte d'un « pas maintenant ». Si tu ne peux vraiment pas, tu me dis pourquoi. Parce que c'est là, au sol, tétine en bouche, que ta tête d'adulte lâche — et c'est elle qui est partie, pas toi.",
             b:"Tes régressions ne se refusent plus d'un « pas maintenant ». Si tu ne peux pas, tu dis pourquoi. C'est ta tête d'adulte qui est partie. C'est là qu'elle lâche." } },
    surveillance: { ic:'👁️', n:'Présence surveillée',
      t:'12 h sans change ni suivi suffisent pour que Foxy te considère parti (au lieu de 18 h).',
      dire:{ f:"Et je te surveille de plus près : douze heures sans un change ni une trace de toi, et je considère que tu es reparti. Au lieu de dix-huit. Tu ne pourras pas glisser dehors en espérant que je ne le voie pas.",
             b:"Douze heures sans trace de toi, et tu es reparti. Au lieu de dix-huit. Tu ne glisses pas dehors sans que je le voie." } },
    discipline: { ic:'🔒', n:'Session de discipline',
      t:'Les checks deviennent des changes piliers, 5 min de tolérance, plus de report — pendant toute la reprise.',
      dire:{ f:"Et on ouvre une session de discipline en même temps : tes checks deviennent des changes piliers, cinq minutes de tolérance, plus de « une autre fois ». Tu sais déjà comment ça va finir. Tu vas t'y remettre, et ça ira mieux.",
             b:"Session de discipline en même temps. Checks en piliers, cinq minutes de tolérance, plus de report." } },
    allegement: { ic:'🪶', n:'Alléger d\'abord',
      t:'Ce qui pesait trop est allégé. Chaque soir, Foxy vérifie que ça ne repèse pas.',
      dire:{ f:"Si c'est devenu trop lourd, la réponse, ce n'est pas plus de poids. C'est d'enlever ce qui te coûte sans rien t'apporter. On regarde ça tout de suite, ensemble.",
             b:"Trop lourd ? Alors on enlève ce qui ne sert à rien. Tout de suite." } },
    peau: { ic:'🧴', n:'Peau surveillée',
      t:'À chaque change, Foxy te demande l\'état de ta peau. Rien d\'autre.',
      dire:{ f:"Toi, tu es parti parce que ton corps n'allait pas. Ça, ce n'est pas une désertion, c'est du bon sens. Alors pas de mesure contre toi : juste, à chaque change, je te demanderai comment va ta peau. Et si ça ne passe pas en deux jours, tu vas voir un médecin. Promis ?",
             b:"Ton corps n'allait pas. Pas de mesure contre toi. À chaque change, tu me dis comment va ta peau. Deux jours sans mieux : médecin." } }
  };
  const MESURES_PAR_MOTIF = {
    envie:  ['pacte','tenue_fermee','pause_encadree','envie_soir','regression_due','surveillance','discipline'],
    sais:   ['pacte','envie_soir','pause_encadree','tenue_fermee','regression_due','surveillance','discipline'],
    oubli:  ['surveillance','pacte','pause_encadree','envie_soir','discipline'],
    dehors: ['pause_encadree','surveillance','envie_soir'],
    dur:    ['allegement','envie_soir','pause_encadree'],
    sante:  ['peau']
  };
  const JOURS_REGIME = { avertissement:2, serieux:4, grave:7 };

  /* ---------- La morale ---------- */
  async function recadrageDesertion() {
    const d = await lireStock(DES_CLE, null);
    if (!d || _recadrageEnCours || paused || voiceMode !== 'foxy') return false;
    try { const r = await window.storage.get('reentry:pending'); if (r && r.value) return false; } catch(e) {}
    _recadrageEnCours = true;
    try {
      const hist = await lireStock(DES_HIST, []);
      const recentes = hist.filter(x => Date.now() - x.debut < 30*86400000);
      const rang = recentes.length + 1;

      // 1) Ouverture : la couche est remise, maintenant on parle
      await imSay(bro(
        "Bon" + (nomOu(null) ? ", " + nomOu(null) : "") + ". Tu es remis, tu es au propre, c'est bien. Maintenant, assieds-toi. Il faut qu'on parle de ce qui s'est passé. 🦊",
        "Tu es remis. Bien. Maintenant on parle de ce qui s'est passé. Assieds-toi."), 1000, 'sad');

      // 2) Les faits
      const faits = [];
      if (d.raison === 'petites') {
        faits.push(bro(
          "Ce n'est pas une grosse absence. C'est pire, en un sens : " + d.petites + " pauses d'une heure ou plus en sept jours. Le programme a des trous partout. Un cadre qui a des trous, ce n'est plus un cadre.",
          d.petites + " pauses en sept jours. Le programme est troué. Un cadre troué n'est plus un cadre."));
      } else {
        faits.push(bro(
          "Tu es parti " + fmtDuree(d.heures) + ". Parti " + jourTxt(d.debut) + ", vers " + heureTxt(d.debut) + ".",
          fmtDuree(d.heures) + ". Parti " + jourTxt(d.debut) + ", vers " + heureTxt(d.debut) + "."));
      }
      if (d.sansCouche && d.sansCouche > d.heures + 2) faits.push(bro(
        "Et sans couche depuis " + fmtDuree(d.sansCouche) + ". Ton corps a eu tout ce temps pour reprendre ses vieux réflexes.",
        "Sans couche depuis " + fmtDuree(d.sansCouche) + ". Ton corps a repris ses vieux réflexes."));
      if (!d.declaree) faits.push(bro(
        "Et tu ne m'as rien dit. Pas de pause, pas un mot. Tu t'es juste arrêté, en espérant que ça passe inaperçu. C'est ça qui me fait le plus de peine — pas que tu sois parti, mais que tu sois parti en silence.",
        "Sans rien dire. Pas de pause, pas un mot. C'est ça, le vrai problème. Pas que tu sois parti. Que tu sois parti en silence."));
      if (d.retard >= 2 && d.retourPrevu) faits.push(bro(
        "Tu m'avais dit que tu revenais à " + heureTxt(d.retourPrevu) + " (" + jourTxt(d.retourPrevu) + "). Tu es revenu avec " + fmtDuree(d.retard) + " de retard. Une promesse, même faite à un renard, ça compte.",
        "Retour promis à " + heureTxt(d.retourPrevu) + ". " + fmtDuree(d.retard) + " de retard. Une promesse, ça compte."));
      if (d.refus) faits.push(bro(
        "Et je t'ai proposé de revenir " + (d.refus === 1 ? "une fois" : d.refus + " fois") + ". Tu as répondu « pas maintenant ». Tu m'as vu, et tu as refermé.",
        "Je t'ai proposé de revenir " + (d.refus === 1 ? "une fois" : d.refus + " fois") + ". « Pas maintenant. » Tu m'as vu, et tu as refermé."));
      if (rang >= 2) faits.push(bro(
        "C'est la " + nieme(rang) + " fois en un mois. Une fois, ça arrive à tout le monde. Plusieurs fois, ça devient une habitude — et ce n'est pas celle-là qu'on est venus prendre.",
        nieme(rang).charAt(0).toUpperCase() + nieme(rang).slice(1) + " fois en un mois. Ça devient une habitude. Pas celle qu'on est venus prendre."));
      for (const f of faits) await imSay(f, 1000, 'sad');

      // 3) Pourquoi
      if (d.motifAnnonce) {
        const LIB = { envie:"que tu avais envie de partir", dehors:"que tu avais une obligation", sante:"que ça n'allait pas physiquement" };
        await imSay(bro(
          "Au moment de partir, tu m'as dit " + (LIB[d.motifAnnonce] || "une raison") + ". Maintenant que tu es revenu, dis-le moi vraiment.",
          "En partant, tu m'as dit " + (LIB[d.motifAnnonce] || "une raison") + ". Maintenant, la vraie raison."), 950, 'curious');
      }
      const motif = await imDemander(bro(
        "Pourquoi tu es parti ? Pas pour te juger. Pour que je sache quoi réparer.",
        "Pourquoi tu es parti ?"), [
        { k:'envie',  label:"🚪 J'avais envie de redevenir adulte", dit:"J'avais envie de redevenir adulte." },
        { k:'dehors', label:"🧳 Une obligation, dehors",            dit:"J'avais une obligation dehors." },
        { k:'dur',    label:"😣 C'était devenu trop lourd",          dit:"C'était devenu trop lourd." },
        { k:'sante',  label:"🩹 Ma peau, ou mon corps, n'allait pas", dit:"Ma peau, ou mon corps, n'allait pas." },
        { k:'oubli',  label:"📵 J'ai laissé filer sans m'en rendre compte", dit:"J'ai laissé filer sans m'en rendre compte." },
        { k:'sais',   label:"🤷 Je ne sais pas",                     dit:"Je ne sais pas." }
      ], 'curious');

      // 4) Recoupement — Foxy ne prend pas la raison sur parole
      let contredit = false;
      if (motif === 'oubli' && d.refus) {
        contredit = true;
        await imSay(bro(
          "Non. Tu n'as pas laissé filer. Je t'ai proposé de revenir, et tu as dit « pas maintenant ». On ne dit pas « pas maintenant » à quelque chose qu'on a oublié. Je préfère que tu me dises la vérité, même si elle est moins jolie.",
          "Non. Tu as dit « pas maintenant » quand je t'ai proposé de revenir. On ne dit pas ça à quelque chose qu'on a oublié."), 1000, 'sad');
      } else if (motif === 'oubli' && d.declaree && d.raison !== 'petites') {
        contredit = true;
        await imSay(bro(
          "Tu as appuyé sur pause toi-même. Ce n'est pas laisser filer, ça — c'est décider de partir. Je ne t'en veux pas de l'avoir décidé. Je t'en veux un peu de me le raconter autrement.",
          "Tu as appuyé sur pause toi-même. Ce n'est pas un oubli, c'est une décision. Dis-le comme c'est."), 1000, 'sad');
      } else if (motif === 'dehors' && !d.declaree) {
        await imSay(bro(
          "Une obligation, d'accord. Mais une obligation, ça se voit venir. Tu aurais pu me le dire avant, m'annoncer quand tu revenais — et là, ça n'aurait même pas été une désertion. C'est le silence que je te reproche, pas l'obligation.",
          "Une obligation se voit venir. Tu l'annonces avant, avec l'heure de retour, et ce n'est même pas une désertion. C'est le silence le problème."), 1000, 'sad');
      } else if (motif === 'dehors' && d.retard >= 2) {
        await imSay(bro(
          "Ton obligation avait une fin. Tu m'avais même donné l'heure. Les " + fmtDuree(d.retard) + " d'après, ce n'était plus l'obligation — c'était toi.",
          "L'obligation avait une fin. Les " + fmtDuree(d.retard) + " d'après, c'était toi."), 1000, 'sad');
      } else if (motif === 'dehors' && d.heures >= 72) {
        await imSay(bro(
          fmtDuree(d.heures) + " d'obligation sans une minute pour moi… Je te crois à moitié. Je vais faire comme si tu avais raison, mais je vais te garder plus près.",
          fmtDuree(d.heures) + " d'obligation. Je te crois à moitié. Je te garde plus près."), 1000, 'sad');
      }
      if (d.motifAnnonce && d.motifAnnonce !== motif && motif !== 'sante' && motif !== 'dur') {
        contredit = true;
        await imSay(bro(
          "Et ce n'est pas ce que tu m'as dit en partant. Deux raisons pour un seul départ : l'une des deux est fausse. Je retiens les deux.",
          "Pas la raison que tu m'as donnée en partant. L'une des deux est fausse. Je retiens les deux."), 950, 'sad');
      }

      // réponse à la raison elle-même
      const REP = {
        envie:  { f:"Merci de le dire comme ça. L'envie de redevenir adulte, elle revient, surtout au début. Moi aussi. Le problème n'est pas qu'elle vienne — c'est que tu l'aies suivie sans me le dire. Elle, elle se trompe toujours de chemin.",
                  b:"L'envie reviendra. Elle revient toujours. Le problème, c'est de l'avoir suivie. Elle se trompe de chemin." },
        sais:   { f:"« Je ne sais pas », je le prends. C'est souvent la réponse la plus vraie. Ça veut dire que tu n'as pas décidé — que ça s'est fait tout seul. Alors on va faire en sorte que ça ne puisse plus se faire tout seul.",
                  b:"Tu ne sais pas. Donc ça s'est fait tout seul. On va faire en sorte que ça ne puisse plus." },
        oubli:  { f:"Laisser filer, c'est la façon la plus douce de partir. On ne décide rien, on arrête juste de revenir. C'est pour ça qu'il faut que je te voie plus souvent.",
                  b:"Laisser filer, c'est partir sans décider. Donc je te verrai plus souvent." },
        dehors: { f:"La vie d'adulte a ses rendez-vous, je sais. Le cadre peut vivre avec — à condition que tu me les annonces. Une absence annoncée, avec son heure de retour, ce n'est pas une désertion. Retiens ça.",
                  b:"La vie dehors a ses rendez-vous. Tu les annonces, avec l'heure de retour. Alors ce n'est pas une désertion." },
        dur:    { f:"D'accord. Alors je ne vais pas te faire la morale là-dessus — ce serait injuste. Si c'était trop lourd, c'est que j'ai laissé peser des choses qui ne devaient pas. On va corriger ça, ensemble. 💛",
                  b:"Trop lourd. Alors pas de morale là-dessus. On corrige ce qui pesait. Ensemble." },
        sante:  { f:"Alors tu as bien fait. Vraiment. Ta peau et ton corps passent avant tout — c'est même une des choses qui ne bougent jamais ici. Je ne te reproche rien. 💛",
                  b:"Tu as bien fait. Ton corps passe avant. Je ne te reproche rien." }
      };
      await imSay(bro(REP[motif].f, REP[motif].b), 1050, (motif === 'sante' || motif === 'dur') ? 'comfort' : 'calm');

      // 5) Ce qui ne va pas — sauf quand le corps ou le poids étaient en cause
      if (motif !== 'sante') {
        const diag = await diagnosticDesertion(d, hist);
        for (const l of diag) await imSay(bro(l.f, l.b), 1050, 'pensive');
      }

      // 6) Les mesures
      let g = (d.heures >= 72 ? 3 : d.heures >= 24 ? 2 : 1)
            + (!d.declaree ? 1 : 0) + (d.refus ? 1 : 0) + (d.retard >= 2 ? 1 : 0)
            + (recentes.length ? 1 : 0) + (contredit ? 1 : 0) + (d.enRegime ? 1 : 0);
      const niveau = g <= 2 ? 'avertissement' : g <= 4 ? 'serieux' : 'grave';
      let mesures = MESURES_PAR_MOTIF[motif].slice();
      if (motif !== 'sante' && motif !== 'dur') {
        const n = niveau === 'avertissement' ? 3 : niveau === 'serieux' ? 5 : mesures.length;
        mesures = mesures.slice(0, n);
        if (contredit || d.enRegime) ['tenue_fermee','discipline'].forEach(x => { if (mesures.indexOf(x) < 0) mesures.push(x); });
      }
      let jours = (motif === 'sante' || motif === 'dur') ? 3 : Math.min(10, JOURS_REGIME[niveau] + recentes.length);
      // une reprise en cours n'est jamais raccourcie par une nouvelle
      let fin = Date.now() + jours*86400000;
      if (regimeActif()) {
        fin = Math.max(fin, desRegime.fin);
        desRegime.mesures.forEach(x => { if (mesures.indexOf(x) < 0 && motif !== 'sante') mesures.push(x); });
      }
      if (motif === 'sante') mesures = ['peau'];

      await imSay(bro(
        motif === 'sante'
          ? "Il y a juste une chose que je vais faire, pour les " + jours + " prochains jours."
          : "Maintenant, ce qu'on fait pour que ça ne se reproduise pas. Ce n'est pas une punition — une punition, ça regarde en arrière. Ça, ça regarde devant. Pendant " + jours + " jours :",
        motif === 'sante'
          ? "Une seule chose, pendant " + jours + " jours."
          : "Voilà ce qui change. " + jours + " jours. Ce n'est pas une punition, c'est ce qu'il faut."), 1050, 'calm');

      for (const id of mesures) {
        const m = MESURES_DES[id];
        let txt = bro(m.dire.f, m.dire.b);
        if (id === 'tenue_fermee') {
          const ferme = ['jour','nuit'].filter(c => wb(c).some(n => FERMEE_DOS.indexOf(typeTenue(n)) >= 0));
          if (!ferme.length) txt += bro(" … Sauf que ta garde-robe n'a aucune tenue fermée dans le dos. Ajoute-en une dès que tu peux — d'ici là, je garde le tirage normal.",
                                        " Tu n'en as aucune dans ta garde-robe. Ajoutes-en une. D'ici là, tirage normal.");
          else if (ferme.length === 1) txt += bro(" (Ta garde-robe n'en a que pour la " + ferme[0] + " : c'est là que ça s'appliquera.)",
                                                  " (Seulement la " + ferme[0] + " : ta garde-robe n'a que ça.)");
        }
        await imSay(m.ic + ' ' + txt, 1100, 'explain');
      }

      // l'allègement se décide tout de suite, pas dans trois jours
      if (mesures.indexOf('allegement') >= 0) await proposerAllegement();

      await imSay(bro(
        "Chaque jour sans entorse te rapproche de la fin. Chaque jour avec une entorse la repousse d'un jour. Tu vois tout ça sur ta carte « Reprise », dans « Maintenant ».",
        "Un jour avec entorse repousse la fin d'un jour. Tout est sur ta carte « Reprise »."), 950, 'teach');

      // 7) La fin : lui aussi est parti, une fois
      if (motif !== 'sante') {
        await imSay(bro(
          "Je vais te dire un truc. Moi aussi, je suis parti. Jour neuf. J'avais rangé mes couches au fond d'un placard, je me disais que c'était fini, que j'étais redevenu normal. Trois jours plus tard, je les ressortais. Pas parce qu'on m'y obligeait — parce que je ne supportais plus d'être sans. 🦊",
          "Moi aussi je suis parti. Jour neuf. Couches au placard. Trois jours plus tard je les ressortais. Personne ne m'obligeait."), 1100, 'wistful');
        await imSay(bro(
          "Tu vois ? On revient toujours. Tu viens de le faire. Alors la prochaine fois, épargne-toi le détour — la résistance est vaine, et tu le sais maintenant. 💛",
          "Tu es revenu. On revient toujours. La prochaine fois, épargne-toi le détour. La résistance est vaine."), 1000, 'calm');
      }

      // on enregistre, et on applique
      const trace = {
        debut: d.debut, heures: d.heures, declaree: d.declaree, refus: d.refus || 0, retard: d.retard || 0,
        raison: d.raison, motif, contredit, niveau, jours, parle: Date.now()
      };
      await ecrireStock(DES_HIST, hist.concat([trace]).slice(-60));
      await ecrireStock(DES_CLE, null);
      await setRegime({ debut: Date.now(), fin, jours, niveau, motif, mesures, extensions: 0, dernierMatin: todayStr() });
      if (mesures.indexOf('discipline') >= 0 && !discActive()) {
        discSession = {
          active: true, niveau: niveau === 'grave' ? 'fort' : 'moyen', objectif: Math.min(3, jours),
          debut: Date.now(), fin, joursPropres: 0, ecarts: 0, source: 'desertion'
        };
        await setDiscipline(discSession);
        try { await window.storage.set('disc:last', JSON.stringify(Date.now())); } catch(e) {}
      }
      try { await refresh(); } catch(e) {}
      if (currentM) await imOfferHelp(currentM);
      return true;
    } finally { _recadrageEnCours = false; }
  }

  async function proposerAllegement() {
    const choix = [];
    if (hardMode) choix.push({ k:'intensif', label:'🪶 Sortir du mode intensif', dit:'Sors-moi du mode intensif.' });
    if (bigbro)   choix.push({ k:'bro',      label:'🦊 Redeviens doux avec moi', dit:'Redeviens doux avec moi.' });
    if (!choix.length) {
      await imSay(bro(
        "Le cadre est déjà au plus doux côté réglages. Alors ce qui pesait, c'est ailleurs — et c'est pour ça que je te demanderai chaque soir. Dès que ça repèse, tu me le dis, et on enlève.",
        "Les réglages sont déjà au plus doux. Ce qui pesait est ailleurs. Chaque soir, tu me dis. On enlève."), 1000, 'comfort');
      return;
    }
    choix.push({ k:'rien', label:'Garder comme c\'est', dit:'On garde comme c\'est.', soft:true });
    const k = await imDemander(bro("Qu'est-ce qu'on enlève ?", "On enlève quoi ?"), choix, 'reassure');
    if (k === 'intensif') { await setHardMode(false); await imSay("C'est fait. Mode normal. Tu le remettras quand tu voudras, pas avant. 💛", 850, 'comfort'); }
    else if (k === 'bro') { await setBigbro(false); await imSay("C'est fait. Je redeviens ton Foxy tout doux. 🦊💛", 850, 'comfort'); }
    else await imSay(bro("D'accord. Mais si ça repèse, tu me le dis.", "D'accord. Si ça repèse, tu le dis."), 800, 'calm');
  }

  /* ---------- Éléments de protocole pendant la reprise ---------- */

  // Au change : le pacte (piliers seulement), l'état de la peau (si mesure)
  async function elementsDesertionChange(slotKey) {
    if (!regimeActif() || voiceMode !== 'foxy' || paused) return;
    if (mesureDes('peau')) {
      const p = await imDemander(bro("Et ta peau, là, comment elle est ?", "Ta peau ?"), [
        { k:'nette',  label:'✅ Nette',             dit:'Nette.' },
        { k:'rouge',  label:'🌸 Un peu rouge',      dit:'Un peu rouge.' },
        { k:'irrite', label:'🩹 Irritée, ça gêne',  dit:'Irritée, ça gêne.' }
      ], 'curious');
      const l = await lireStock('desertion:peau', []);
      l.push({ t: Date.now(), v: p });
      await ecrireStock('desertion:peau', l.slice(-30));
      const irrite2j = l.filter(x => x.v === 'irrite' && Date.now() - x.t < 3*86400000)
                        .map(x => dateCle(x.t)).filter((v,i,a) => a.indexOf(v) === i).length >= 2;
      if (p === 'nette') await imSay(bro("Parfait. C'est tout ce que je voulais savoir. 💛", "Bien."), 700, 'proud');
      else if (p === 'rouge') await imSay(bro("Crème barrière généreuse, et laisse-la respirer dix minutes avant de refermer. On regarde de nouveau au prochain change.", "Crème, dix minutes à l'air, on revoit au prochain."), 900, 'reassure');
      else await imSay(irrite2j
        ? bro("Deux jours que ça gêne. Là, tu vas voir un médecin — ce n'est pas négociable, et ce n'est pas une faiblesse. Si tu dois mettre en pause pour ça, mets en pause : ce ne sera jamais une désertion.",
              "Deux jours. Médecin. Pas négociable. Pause si besoin : ce ne sera pas une désertion.")
        : bro("Alors on soigne d'abord : crème, un vrai moment à l'air, et une couche un peu moins serrée. Si ça ne passe pas d'ici demain, on en reparle sérieusement.",
              "On soigne : crème, à l'air, moins serré. Pas mieux demain, on en reparle."), 1000, 'concern');
    }
    const pilier = ['c0900','c1600','c2230'].indexOf(slotKey) >= 0;
    if (pilier && mesureDes('pacte')) {
      const k = await imDemander(bro("Avant que tu repartes : tu restes ?", "Tu restes ?"), [
        { k:'reste', label:'🤝 Je reste', dit:'Je reste.' },
        { k:'envie', label:'😶 L\'envie de partir est là', dit:'L\'envie de partir est là.', soft:true }
      ], 'calm');
      const cle = 'desertion:pacte:' + todayStr();
      const l = await lireStock(cle, []);
      l.push({ t: Date.now(), slot: slotKey, k });
      await ecrireStock(cle, l);
      if (k === 'reste') await imSay(bro("Je sais. 🦊", "Je sais."), 600, 'proud');
      else await parlerEnvie('pacte');
    }
  }

  // Parler de l'envie de partir, quand elle est là
  async function parlerEnvie(source) {
    await imSay(bro(
      "Merci de me le dire. Vraiment. C'est exactement pour ça que je pose la question — une envie dite à voix haute, elle a déjà perdu la moitié de sa force.",
      "Tu l'as dit. Elle a déjà perdu la moitié de sa force."), 950, 'comfort');
    const q = await imDemander(bro("Qu'est-ce qui te tire dehors, là ?", "Qu'est-ce qui te tire ?"), [
      { k:'adulte', label:'👔 Un truc d\'adulte à faire',   dit:'Un truc d\'adulte à faire.' },
      { k:'marre',  label:'😤 Ras-le-bol de la couche',     dit:'Ras-le-bol de la couche.' },
      { k:'honte',  label:'😳 Je me sens bête',             dit:'Je me sens bête.' },
      { k:'ennui',  label:'🥱 Je m\'ennuie',                dit:'Je m\'ennuie.' }
    ], 'curious');
    const R = {
      adulte: { f:"Alors fais-le, ton truc d'adulte — en couche. Presque rien ne demande vraiment qu'on l'enlève. Et si c'est vraiment le cas, tu déclares une pause avec l'heure de retour : ça, ce n'est pas partir.",
                b:"Fais-le en couche. Presque rien n'exige qu'on l'enlève. Sinon, pause annoncée avec l'heure de retour." },
      marre:  { f:"Le ras-le-bol, je connais. Il vient toujours juste avant que ça devienne normal — c'est la dernière résistance, la plus bruyante. Ne la combats pas : descends au sol, tétine, et laisse-la s'user. Elle s'use vite.",
                b:"Le ras-le-bol, c'est la dernière résistance. La plus bruyante. Au sol, tétine. Elle s'use vite." },
      honte:  { f:"Ce regard-là, c'est toi qui te juges. Personne d'autre n'est là. Il s'use à chaque fois que tu ne l'écoutes pas. Reste, et il sera plus petit ce soir.",
                b:"C'est toi qui te juges. Personne d'autre. Il s'use chaque fois que tu restes." },
      ennui:  { f:"L'ennui, c'est ta tête d'adulte qui cherche la porte. Donne-lui autre chose : tes cubes, un coloriage, un dessin animé. Quelque chose de petit. Dix minutes.",
                b:"C'est ta tête d'adulte qui cherche la porte. Occupe tes mains. Dix minutes." }
    };
    await imSay(bro(R[q].f, R[q].b), 1050, 'teach');
    const cle = 'desertion:envie:' + todayStr();
    const l = await lireStock(cle, []);
    l.push({ t: Date.now(), source, v: 'forte', quoi: q });
    await ecrireStock(cle, l);
  }

  // Chaque soir : l'envie est-elle passée ?
  async function envieDuSoir() {
    if (!mesureDes('envie_soir') || paused || voiceMode !== 'foxy') return false;
    const fait = 'desertion:soir:' + todayStr();
    if (await lireStock(fait, false)) return false;
    await ecrireStock(fait, true);
    const k = await imDemander(bro(
      "Dis-moi, aujourd'hui… l'envie de partir est passée te voir ?",
      "Aujourd'hui, l'envie de partir ?"), [
      { k:'non',   label:'😌 Non, pas du tout',     dit:'Non, pas du tout.' },
      { k:'peu',   label:'🌫️ Un peu, elle est passée', dit:'Un peu. Elle est passée.' },
      { k:'forte', label:'🚪 Oui, elle est forte',   dit:'Oui, elle est forte.' }
    ], 'curious');
    if (k === 'non') await imSay(bro("C'est comme ça que ça commence à rentrer. Une journée où tu n'y as même pas pensé. 🦊", "Bien. Ça rentre."), 850, 'proud');
    else if (k === 'peu') {
      const cle = 'desertion:envie:' + todayStr();
      const l = await lireStock(cle, []); l.push({ t: Date.now(), source:'soir', v:'peu' }); await ecrireStock(cle, l);
      await imSay(bro("Passée, et repartie. Tu vois ? Elle passe. Tu n'as rien eu à faire, juste à rester.", "Passée, repartie. Tu n'as eu qu'à rester."), 900, 'calm');
    } else {
      await parlerEnvie('soir');
      // deux soirs de suite : ce n'est plus une envie, c'est un signal
      const hier = new Date(); hier.setDate(hier.getDate()-1);
      const lh = await lireStock('desertion:envie:' + dateCle(hier.getTime()), []);
      if (lh.some(x => x.v === 'forte')) await imSay(bro(
        "Et c'est le deuxième soir de suite. Là, ce n'est plus juste une envie : quelque chose te coûte trop. Dis-moi ce qu'on enlève — et si c'est plus gros que le programme, parles-en à quelqu'un de confiance. Je suis là pour la route, pas pour tout porter. 💛",
        "Deuxième soir de suite. Quelque chose coûte trop. On enlève quoi ? Et si c'est plus gros que le programme, parles-en à quelqu'un."), 1050, 'concern');
    }
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  // Chaque matin : où on en est, et la fin repoussée si hier a lâché
  async function matinReprise() {
    if (!desRegime || paused || voiceMode !== 'foxy') return false;
    if (desRegime.dernierMatin === todayStr()) return false;
    const r = desRegime;
    r.dernierMatin = todayStr();
    // la reprise est finie
    if (Date.now() >= r.fin) {
      await setRegime(null);
      if (discSession && discSession.source === 'desertion') { discSession = null; await setDiscipline(null); }
      await imSay(bro(
        "Ta reprise est terminée. Les mesures sont levées. Tu as tenu. 🦊",
        "Reprise terminée. Mesures levées. Tu as tenu."), 900, 'proud');
      await imSay(bro(
        "Et tu sais quoi ? Le plus dur, ce n'était pas les mesures. C'était de revenir. Ça, tu l'as fait tout seul. 💛",
        "Le plus dur, c'était de revenir. Tu l'as fait."), 950, 'moved');
      if (currentM) await imOfferHelp(currentM);
      return true;
    }
    const hier = new Date(); hier.setDate(hier.getDate()-1);
    const kh = dateCle(hier.getTime());
    const p = (kh >= dateCle(r.debut)) ? await poidsEntorses(kh) : 0;
    const MAX_EXT = 5;
    let ext = false;
    if (p > 0 && r.extensions < MAX_EXT) { r.fin += 86400000; r.extensions++; ext = true; }
    await setRegime(r);
    const jour = Math.floor((Date.now() - r.debut) / 86400000) + 1;
    const total = Math.round((r.fin - r.debut) / 86400000);
    await imSay(bro(
      "Jour " + jour + " sur " + total + " de ta reprise.",
      "Reprise : jour " + jour + " sur " + total + "."), 800, 'calm');
    if (ext) await imSay(bro(
      "Hier n'était pas une journée propre. La fin recule d'un jour — c'était la règle. Aujourd'hui, on la tient.",
      "Hier : entorse. Un jour de plus. Aujourd'hui, tu tiens."), 950, 'sad');
    else if (p === 0 && jour > 1) await imSay(bro("Hier était propre. C'est comme ça qu'on en sort. 🦊", "Hier, propre. Continue."), 850, 'proud');
    const rappel = r.mesures.map(id => MESURES_DES[id] ? MESURES_DES[id].ic + ' ' + MESURES_DES[id].n : null).filter(Boolean).join('<br>');
    if (rappel) await imSay(bro("Ce qui tient toujours :<br>", "Toujours en place :<br>") + rappel, 950, 'explain');
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  // Dix minutes après « j'ai envie de partir » au bouton pause
  async function suiviEnvieDix() {
    const e = await lireStock('pause:envie', null);
    if (!e || Date.now() - e < 10*60000 || paused || voiceMode !== 'foxy') return false;
    await ecrireStock('pause:envie', null);
    const k = await imDemander(bro("Ça fait dix minutes. Alors, l'envie de partir ?", "Dix minutes. L'envie ?"), [
      { k:'passee', label:'😌 Elle est passée',       dit:'Elle est passée.' },
      { k:'la',     label:'🚪 Elle est toujours là', dit:'Elle est toujours là.' }
    ], 'curious');
    if (k === 'passee') {
      await imSay(bro("Tu vois. Dix minutes, et elle est partie avant toi. C'est presque toujours comme ça. 🦊💛", "Dix minutes. Elle est partie avant toi."), 950, 'proud');
      if (currentM) await imOfferHelp(currentM);
      return true;
    }
    await imSay(bro(
      "Alors je ne te retiens pas. Tu peux partir — le bouton pause est là, il l'a toujours été. Je te demande juste une chose : quand tu reviendras, et tu reviendras, on en reparlera.",
      "Je ne te retiens pas. La pause est là. Tu reviendras, et on en reparlera."), 1000, 'sad');
    imSetActions([
      { label:'⏸️ Mettre en pause', onClick: async () => {
        imAddMe('Je mets en pause.');
        await ecrireStock('pause:motif', 'envie');
        await doEnterPause();
      }},
      { soft:true, label:'Finalement je reste', onClick: async () => {
        imAddMe('Finalement, je reste.');
        await imSay(bro("Je savais. 🦊", "Je savais."), 700, 'proud');
        if (currentM) await imOfferHelp(currentM);
      }}
    ]);
    return true;
  }

  /* ---------- La pause, pendant la reprise (et l'absence annoncée) ---------- */
  function pauseChoixRetour(motif) {
    const now = new Date();
    const opts = [];
    const add = (label, ms) => opts.push({ label, onClick: async () => {
      await ecrireStock('pause:retour', ms);
      await ecrireStock('pause:motif', motif);
      foxyPopShow(bro(
        "C'est noté : retour " + jourTxt(ms) + " à " + heureTxt(ms) + ". Si tu reviens plus de deux heures après, je considérerai que tu es parti. Va, et reviens. 🦊",
        "Retour " + jourTxt(ms) + " à " + heureTxt(ms) + ". Deux heures de retard et tu es parti. Va."), 'wave', [
        { label:'À tout à l\'heure', onClick: async () => { foxyPopHide(); await doEnterPause(); } }
      ]);
    }});
    add('Dans 1 h', now.getTime() + 3600000);
    add('Dans 3 h', now.getTime() + 3*3600000);
    const soir = new Date(now); soir.setHours(19,30,0,0);
    if (soir.getTime() - now.getTime() > 2*3600000) add('Ce soir, 19h30', soir.getTime());
    const dem = new Date(now); dem.setDate(dem.getDate()+1); dem.setHours(9,0,0,0);
    add('Demain, 9h', dem.getTime());
    const j3 = new Date(now); j3.setDate(j3.getDate()+3); j3.setHours(9,0,0,0);
    add('Dans 3 jours', j3.getTime());
    const j7 = new Date(now); j7.setDate(j7.getDate()+7); j7.setHours(9,0,0,0);
    add('Dans une semaine', j7.getTime());
    opts.push({ soft:true, label:'Non, je reste', onClick: () => foxyPopHide() });
    foxyPopShow(bro("Tu reviens quand ?", "Retour quand ?"), 'curious', opts);
  }

  function pauseEncadree() {
    foxyPopShow(bro(
      "Tu veux faire une pause. Tu peux, toujours. Mais pendant ta reprise, elle se déclare : pourquoi ?",
      "Une pause. Tu peux. Pourquoi ?"), 'curious', [
      { label:'🧳 Une obligation, je te dis quand je reviens', onClick: () => pauseChoixRetour('dehors') },
      { label:'🩹 Ça ne va pas, j\'ai besoin d\'arrêter', onClick: () => {
        foxyPopShow("Alors tu arrêtes, tout de suite, sans rien me devoir. Prends soin de toi. Ce ne sera pas compté contre toi. 💛", 'comfort', [
          { label:'Merci Foxy', onClick: async () => { foxyPopHide(); await ecrireStock('pause:motif', 'sante'); await doEnterPause(); } }
        ]);
      }},
      { label:'🚪 J\'ai envie de partir', onClick: () => {
        foxyPopShow(bro(
          "Merci de me le dire, au lieu de partir sans un mot. Reste dix minutes avec moi d'abord. Si dans dix minutes l'envie est toujours là, tu pourras partir — je ne te retiendrai pas.",
          "Tu me l'as dit. Bien. Dix minutes avec moi. Si elle est toujours là après, tu pars. Je ne retiens personne."), 'sad', [
          { label:'D\'accord, dix minutes', onClick: async () => {
            foxyPopHide();
            await ecrireStock('pause:envie', Date.now());
            if (voiceMode !== 'foxy') { try { await setVoiceMode('foxy'); } catch(e) {} }
            talk(TALK.CADRE, 'desertion:envie:parler', () => parlerEnvie('pause'));
          }},
          { soft:true, label:'Je pars quand même', onClick: async () => {
            foxyPopHide();
            await ecrireStock('pause:motif', 'envie');
            await doEnterPause();
          }}
        ]);
      }},
      { soft:true, label:'Non, je reste', onClick: () => foxyPopHide() }
    ]);
  }

  /* ---------- Carte « Reprise » et menu ---------- */
  function renderDesertion() {
    const card = document.getElementById('desCard');
    if (!card) return;
    if (!regimeActif()) { card.style.display = 'none'; return; }
    card.style.display = '';
    const r = desRegime;
    const jour = Math.floor((Date.now() - r.debut) / 86400000) + 1;
    const total = Math.round((r.fin - r.debut) / 86400000);
    const MOTIF = { envie:'envie de redevenir adulte', sais:'sans raison claire', oubli:'laissé filer', dehors:'obligation', dur:'trop lourd', sante:'santé' };
    const t = document.getElementById('desTxt');
    if (t) t.innerHTML =
      '<div style="margin-bottom:8px">Après ta désertion (' + (MOTIF[r.motif] || r.motif) + '). '
      + 'Jour <b>' + Math.min(jour, total) + ' sur ' + total + '</b>'
      + (r.extensions ? ' — dont ' + r.extensions + ' ajouté' + (r.extensions>1?'s':'') + ' pour entorse' : '') + '.</div>'
      + '<div style="font-weight:800;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;color:#6b4f8a;margin-bottom:3px">Ce qui change</div>'
      + '<div style="line-height:1.5">'
      + r.mesures.map(id => MESURES_DES[id] ? '• ' + MESURES_DES[id].ic + ' <b>' + MESURES_DES[id].n + '</b> — ' + MESURES_DES[id].t : '').filter(Boolean).join('<br>')
      + '</div>'
      + '<div style="margin-top:8px;font-size:11.5px;color:var(--muted)">Un jour avec une entorse repousse la fin d\'un jour (5 au plus). La pause reste toujours possible.</div>';
  }

  async function parlerReprise() {
    if (!regimeActif()) {
      await imSay(bro("Tu n'es pas en reprise. Rien à signaler. 🦊", "Pas de reprise en cours."), 700, 'happy');
      return;
    }
    const r = desRegime;
    const jour = Math.floor((Date.now() - r.debut) / 86400000) + 1;
    const total = Math.round((r.fin - r.debut) / 86400000);
    await imSay(bro("Jour " + Math.min(jour, total) + " sur " + total + " de ta reprise. Ce qui tient :", "Jour " + Math.min(jour, total) + "/" + total + ". En place :"), 800, 'calm');
    await imSay(r.mesures.map(id => MESURES_DES[id] ? MESURES_DES[id].ic + ' <b>' + MESURES_DES[id].n + '</b> — ' + MESURES_DES[id].t : '').filter(Boolean).join('<br>'), 1000, 'explain');
    await imSay(bro(
      "Et chaque jour propre te rapproche de la fin. Pas besoin d'en faire plus : juste rester.",
      "Chaque jour propre te rapproche de la fin. Reste, c'est tout."), 850, 'calm');
  }

  // Le safeword lève tout, sans conséquence
  async function leverRepriseSafeword() {
    const avait = regimeActif() || (await desertionEnAttente());
    await ecrireStock(DES_CLE, null);
    await ecrireStock('pause:envie', null);
    if (desRegime) await setRegime(null);
    if (discSession && discSession.source === 'desertion') { discSession = null; await setDiscipline(null); }
    return avait;
  }

  // Appelé chaque minute
  function tickDesertion() {
    if (paused) return;
    const h = new Date().getHours();
    if (voiceMode === 'foxy') {
      talk(TALK.ACCES, 'desertion:recadrage', () => recadrageDesertion(),
        { verifier: async () => !_desReserve && await desertionEnAttente() });
      if (desRegime && h >= 9) talk(TALK.CADRE, 'desertion:matin', () => matinReprise());
      if (h >= 20 && mesureDes('envie_soir')) talk(TALK.CADRE, 'desertion:soir', () => envieDuSoir());
      talk(TALK.CADRE, 'desertion:envie10', () => suiviEnvieDix(),
        { verifier: async () => { const e = await lireStock('pause:envie', null); return !!(e && Date.now() - e >= 10*60000); } });
    }
    // la discipline avance d'un cran chaque matin (elle n'était jamais mise à jour)
    if (h >= 6) talk(TALK.CADRE, 'disc:maj', async () => {
      const cle = 'disc:maj:' + todayStr();
      if (await lireStock(cle, false)) return;
      await ecrireStock(cle, true);
      try { await majDiscipline(); } catch(e) {}
    });
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
    if (b0) b0.addEventListener('click', async () => { await ouvrirInstallation(true); });
    const bt = document.getElementById('obTest');
    if (bt) bt.addEventListener('click', () => proposerTest());
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
  // ===== QR des vêtements =====
  (function(){
    const b = document.getElementById('qrClothesGen');
    if (b) b.addEventListener('click', async () => { await renderClothesQr(); });
  })();

  async function renderClothesQr() {
    const WB = window.HabitrainWardrobe, QR = window.HabitrainQR;
    const box = document.getElementById('qrClothesList');
    if (!box || !WB || !QR) return;
    box.innerHTML = '<div class="sub">Génération…</div>';
    const w = await WB.getWardrobe();
    box.innerHTML = '';
    // on génère pour les tenues portées (nuit, jour, sieste) — pas les accessoires
    for (const cat of ['nuit','jour','sieste']) {
      const items = w[cat] || [];
      if (!items.length) continue;
      const titre = document.createElement('div');
      titre.style.cssText = 'font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin:12px 0 6px';
      titre.textContent = cat === 'nuit' ? '🌙 Nuit' : (cat === 'jour' ? '☀️ Jour' : '😴 Sieste');
      box.appendChild(titre);
      // on évite les doublons (une tenue peut être dans plusieurs catégories)
      const vus = new Set();
      for (const nom of items) {
        const id = WB.itemId(cat, nom);
        if (vus.has(nom)) continue;
        vus.add(nom);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--line)';
        const cv = document.createElement('canvas');
        const txt = await QR.payloadFor(id, true);
        QR.drawQR(cv, txt, 90, 'M');
        const lbl = document.createElement('div');
        lbl.style.cssText = 'flex:1;font-size:13px;font-weight:700;color:var(--ink)';
        lbl.textContent = nom;
        wrap.appendChild(cv); wrap.appendChild(lbl);
        box.appendChild(wrap);
      }
    }
    const note = document.createElement('div');
    note.className = 'set-note';
    note.textContent = 'Fais une capture, imprime et plastifie. Colle chaque QR à l\'intérieur du vêtement correspondant.';
    box.appendChild(note);
    try { await window.storage.set('ob:qrdone', JSON.stringify(true)); } catch(e) {}
  }

  // Scanner la tenue qu'on vient de mettre
  async function scanTenue() {
    const QR = window.HabitrainQR, WB = window.HabitrainWardrobe;
    if (!QR || !WB) return;
    // une étiquette cousue dans un col est aussi petite qu'un bracelet
    QR.startScan(null, async (kind) => {
      if (!kind) return;
      const item = await WB.findByItemId(kind);
      if (!item) {
        if (voiceMode === 'foxy') { try { await imSay('Ce QR n\'est pas une de tes tenues. Réessaie ?', 800, 'puzzled'); } catch(e) {} }
        return;
      }
      await WB.logWorn(todayStr(), item.cat, item.name);
      // conformité avec le tirage du jour — même règle que la carte du tirage
      let att = null;
      try {
        const forcee = couchageNuit(new Date()) && (await nuitDejaFaite());
        att = tenueAttendue(await getOutfit(todayStr()), new Date(), forcee);
      } catch(e) {}
      const conforme = !att || !att.nom || att.tolerees.indexOf(item.name) >= 0;

      if (voiceMode === 'foxy') {
        try {
          if (conforme) {
            await imSay(broOn()
              ? 'Bien. « ' + item.name + ' », c\'est noté. Tu es habillé comme il faut.'
              : 'Parfait, « ' + item.name + ' » ! Tu es tout beau. 🦊', 850, 'proud');
            // ce qu'elle fait, et pour combien de temps — comme pour la couche
            if (!paused) { try { await expliquerTenue(); } catch(e) {} }
            if (currentM) await imOfferHelp(currentM);
          } else {
            await corrigerTenue(item, att);
          }
        } catch(e) {}
      }
      try { await refresh(); } catch(e) {}
    }, { petit: true });
  }

  /* ------------------------------------------------------------
     TENUE NON CONFORME — on ne se contente pas de le signaler
     Foxy demande de la retirer, de mettre la bonne, puis il revérifie.
     Tant que ce n'est pas fait, il reste sur le sujet.
     ------------------------------------------------------------ */
  async function corrigerTenue(item, att, essai) {
    essai = essai || 1;
    const quand = att.moment === 'nuit' ? 'pour la nuit' : 'pour la journée';

    if (essai === 1) {
      await imSay(broOn()
        ? 'Non. « ' + item.name + ' », ce n\'est pas ce que j\'avais tiré. C\'est « ' + att.nom +' » ' + quand + '.'
        : 'Ah... « ' + item.name + ' », ce n\'est pas celle du jour. J\'avais tiré « ' + att.nom + ' » ' + quand + '. 🦊',
        900, 'puzzled');
      await imSay(broOn()
        ? 'Tu la retires, tu mets la bonne, et tu me la scannes. Ça ne se négocie pas, tu le sais bien.'
        : 'Va la retirer et mets « ' + att.nom + ' » à la place. Puis tu me la scannes, je vérifie. Tu peux traîner un peu si tu veux, mais on finira par y passer de toute façon. 🦊',
        1000, 'calm');
    } else {
      await imSay(broOn()
        ? 'Toujours pas la bonne. « ' + att.nom + ' ». On recommence.'
        : 'Ce n\'est toujours pas « ' + att.nom + ' » ! On réessaie, tu y es presque. 🦊', 850, 'concern');
    }

    return new Promise((resolve) => {
      imSetActions([
        { label:'📷 C\'est fait, revérifie', onClick: async () => {
          imAddMe('C\'est fait, revérifie.');
          await reverifierTenue(att, essai + 1);
          resolve();
        }},
        { soft:true, label:'Je ne l\'ai pas (au sale)', onClick: async () => {
          imAddMe('Je ne l\'ai pas, elle est au sale.');
          await imSay(broOn()
            ? 'Bon. Pour cette fois. Mais tu gardes celle-là jusqu\'au prochain change, pas de valse de tenues.'
            : 'Ah, d\'accord — ça arrive ! Garde celle-là alors, mais jusqu\'au prochain change, on ne change pas cinq fois. 🦊', 900, 'calm');
          try { await marquerEntorse('b_tenue_hs'); } catch(e) {}
          if (currentM) await imOfferHelp(currentM);
          resolve();
        }}
      ]);
    });
  }

  // relance le scan et rejuge, sans repasser par « je viens de m'habiller »
  async function reverifierTenue(att, essai) {
    const QR = window.HabitrainQR, WB = window.HabitrainWardrobe;
    if (!QR || !WB) return;
    await imSay(broOn() ? 'Montre.' : 'Fais voir ! 🦊', 600, 'curious');
    return new Promise((resolve) => {
      QR.startScan(null, async (kind) => {
        if (!kind) { resolve(); return; }
        const it = await WB.findByItemId(kind);
        if (!it) {
          await imSay('Ce QR n\'est pas une de tes tenues. Réessaie ?', 800, 'puzzled');
          await corrigerTenue({ name:'?' }, att, essai);
          resolve(); return;
        }
        await WB.logWorn(todayStr(), it.cat, it.name);
        // on rejuge sur l'heure courante : la correction a pu franchir une bascule
        let att2 = att;
        try {
          const forcee = couchageNuit(new Date()) && (await nuitDejaFaite());
          att2 = tenueAttendue(await getOutfit(todayStr()), new Date(), forcee) || att;
        } catch(e) {}
        if (att2.tolerees.indexOf(it.name) >= 0) {
          await imSay(broOn()
            ? 'Voilà. « ' + it.name + ' ». C\'est mieux quand tu ne discutes pas.'
            : 'Voilà ! « ' + it.name + ' », c\'est exactement ça. Tu vois, c\'était pas si terrible. 🦊', 900, 'proud');
          if (!paused) { try { await expliquerTenue(); } catch(e) {} }
          if (currentM) await imOfferHelp(currentM);
        } else {
          await corrigerTenue(it, att2, essai);
        }
        try { await refresh(); } catch(e) {}
        resolve();
      }, { petit: true });
    });
  }

  // enregistre une entorse du jour
  // silencieux : l'appelant cite lui-même la règle, au bon moment de son explication
  async function marquerEntorse(id, silencieux) {
    const d = todayStr();
    const b = await getBreaches(d);
    const nouvelle = !b[id];
    b[id] = true;
    await saveBreaches(d, b);
    try { await renderBreaches(); } catch(e) {}
    try { await renderRegles(); } catch(e) {}
    // une entorse rattachée à son énoncé pèse autrement qu'une ligne
    // dans un tableau : Foxy cite la règle, une fois, sans insister.
    /* La règle se cite DANS la conversation, mais elle n'y retient personne :
       une preuve validée sans scan attendait ici que Foxy ait fini de parler,
       et le contrôle en cours restait suspendu derrière sa phrase. */
    if (nouvelle && !silencieux && voiceMode === 'foxy' && !paused) {
      const c = citerRegle(id);
      if (c) talk(TALK.CADRE, 'regle:' + id + ':' + d, async () => {
        try { await imSay('📋 ' + c, 800, 'explain'); } catch(e) {}
      });
    }
  }

  // ===== Feuille complète de QR à imprimer =====
  const QR_PLACEMENT = {
    change_pilier: 'Secours — le change se prouve au bracelet',
    change_tous:   'Secours — le change se prouve au bracelet',
    biberon:       'Près du frigo ou du plan de travail',
    coucher:       'Sur la porte de ta chambre',
    unlock:        'Sur ton bracelet — à garder au poignet'
  };

  (function(){
    const b = document.getElementById('qrPrintSheet');
    if (b) b.addEventListener('click', async () => { await buildQrSheet(); });
    const c = document.getElementById('qrSheetClose');
    if (c) c.addEventListener('click', () => document.body.classList.remove('qrsheet-on'));
    const p = document.getElementById('qrSheetPrint');
    if (p) p.addEventListener('click', () => window.print());
    const d = document.getElementById('qrSheetDl');
    if (d) d.addEventListener('click', () => downloadQrSheet());
    const m = document.getElementById('qrSheetMm');
    if (m) m.addEventListener('change', async () => { await buildQrSheet(); });
    const f = document.getElementById('qrSheetFmt');
    if (f) f.addEventListener('change', async () => {
      // le 10×15 n'a de sens qu'avec des codes compacts : on s'aligne d'office
      // 11 mm : le plus grand code qui garde 4 colonnes et 3,6 cm de libre en 10×15
      if (f.value === '10x15' && m && parseFloat(m.value) > 11) m.value = '11';
      await buildQrSheet();
    });
  })();

  async function buildQrSheet() {
    const QR = window.HabitrainQR, WB = window.HabitrainWardrobe;
    const box = document.getElementById('qrSheetBody');
    if (!box || !QR) return;
    // L'impression masque tous les enfants directs de <body> sauf la feuille.
    // Si la feuille est imbriquée dans un autre bloc, c'est ce bloc qui disparaît
    // et la page sort vide : on la remonte d'abord au niveau du body.
    const sheet = document.getElementById('qrSheet');
    if (sheet && sheet.parentElement !== document.body) document.body.appendChild(sheet);
    document.body.classList.add('qrsheet-on');
    box.innerHTML = '<div class="qrsheet-sub">Génération…</div>';
    window.scrollTo(0, 0);

    // taille d'impression choisie dans la barre (en millimètres)
    const selMm = document.getElementById('qrSheetMm');
    const mmChoisi = selMm ? parseFloat(selMm.value) || 20 : 20;

    // ---- Échelle des étiquettes, alignée sur la taille du QR ----
    // Tout est exprimé en millimètres et dérivé de mmChoisi : à 10 mm de code,
    // une légende en 12,5 px occuperait plus de place que le QR lui-même.
    // Plancher de lisibilité à l'impression : ~1,8 mm de hauteur de caractère.
    const fNom  = Math.max(1.5, mmChoisi * 0.16).toFixed(2);   // nom de l'étiquette
    const fLieu = Math.max(1.25, mmChoisi * 0.125).toFixed(2); // emplacement
    const pad   = Math.max(0.8, mmChoisi * 0.10).toFixed(2);   // marge intérieure
    const colMin = Math.max(18, mmChoisi * 1.9).toFixed(0);    // largeur mini d'une colonne
    // Police étroite : à hauteur égale elle occupe ~20 % de largeur en moins,
    // ce qui compte plus que les millimètres sur une étiquette de 2 cm.
    const ETROITE = "'Arial Narrow','Helvetica Neue Condensed','Liberation Sans Narrow',"
                  + "'Roboto Condensed',system-ui,sans-serif";

    // --- Format de page ---
    // En 10×15, la place est comptée : on retire le titre décoratif, les intertitres
    // et la note de bas de page, et on ne garde que les étiquettes.
    const selFmt = document.getElementById('qrSheetFmt');
    const photo = selFmt ? selFmt.value === '10x15' : false;
    const margePage = photo ? 4 : 12;
    const largeurUtile = photo ? (100 - margePage * 2) : 100;
    const cssPage = photo
      ? '@page{size:100mm 150mm;margin:' + margePage + 'mm}'
        + 'body{padding:0}'
        + '.qrsheet-title,.qrsheet-sub,.qrsheet-sec{display:none}'
        + '.qrsheet-body{padding:0}'
      : '@page{size:A4;margin:' + margePage + 'mm}';

    const echelle =
      '<style>' + cssPage +
      '.qrsheet-grid{grid-template-columns:repeat(auto-fill,minmax(' + colMin + 'mm,1fr));gap:' + pad + 'mm;' +
        'max-width:' + largeurUtile + 'mm}' +
      '.qrsheet-card{padding:' + pad + 'mm}' +
      '.qrsheet-card .n,.qrsheet-card .w{font-family:' + ETROITE + ';font-stretch:condensed;' +
        'letter-spacing:-.01em;hyphens:auto;overflow-wrap:anywhere}' +
      '.qrsheet-card .n{font-size:' + fNom + 'mm;line-height:1.05}' +
      '.qrsheet-card .w{font-size:' + fLieu + 'mm;line-height:1.1;font-weight:600;' +
        'margin-top:' + (pad/4).toFixed(2) + 'mm}' +
      '.qrsheet-card canvas,.qrsheet-card img{margin-bottom:' + (pad/2).toFixed(2) + 'mm}' +
      '</style>';

    const frag = document.createElement('div');
    const now = new Date();
    frag.innerHTML = echelle +
      '<div class="qrsheet-title">🦊 Habitrain — mes QR codes</div>' +
      '<div class="qrsheet-sub">Généré le ' + now.toLocaleDateString('fr-FR') +
      ' · Ces codes sont uniques à ton installation. Découpe chaque étiquette et plastifie-la.</div>';

    // en 10×15, tout va dans une grille unique : trois grilles séparées
    // laisseraient des trous de plusieurs centimètres entre les sections
    let grilleUnique = null;
    const ajouterSection = async (titre, items) => {
      if (!items.length) return;
      if (!photo) {
        const h = document.createElement('div');
        h.className = 'qrsheet-sec'; h.textContent = titre;
        frag.appendChild(h);
      }
      let grid;
      if (photo) {
        if (!grilleUnique) {
          grilleUnique = document.createElement('div');
          grilleUnique.className = 'qrsheet-grid';
          frag.appendChild(grilleUnique);
        }
        grid = grilleUnique;
      } else {
        grid = document.createElement('div');
        grid.className = 'qrsheet-grid';
      }
      for (const it of items) {
        const card = document.createElement('div');
        card.className = 'qrsheet-card';
        const cv = document.createElement('canvas');
        // Format court partout : 21×21 modules au lieu de 29×29, soit des carrés
        // ~40 % plus larges à taille de papier égale. La correction reste en M :
        // avec un contenu aussi court elle ne coûte aucun module de plus.
        const payload = await QR.payloadFor(it.id, true);
        QR.drawQR(cv, payload, 400, 'M', mmChoisi);
        card.appendChild(cv);
        const n = document.createElement('div');
        n.className = 'n'; n.textContent = it.nom;
        card.appendChild(n);
        if (it.ou) {
          const w = document.createElement('div');
          w.className = 'w'; w.textContent = '📍 ' + it.ou;
          card.appendChild(w);
        }
        grid.appendChild(card);
      }
      if (!photo) frag.appendChild(grid);
    };

    // 1) Actions à valider
    const actions = QR.QR_ACTIONS.map(a => ({
      id: a.id, nom: a.label, ou: QR_PLACEMENT[a.id] || ''
    }));
    await ajouterSection('Actions à valider', actions);

    // 2) Bracelet
    await ajouterSection('Bracelet de déverrouillage', [
      { id:'unlock', nom:'Bracelet', ou: QR_PLACEMENT.unlock }
    ]);

    // 3) Tenues
    if (WB) {
      try {
        const w = await WB.getWardrobe();
        const vus = new Set();
        const tenues = [];
        for (const cat of ['nuit','jour','sieste']) {
          for (const nom of (w[cat] || [])) {
            if (vus.has(nom)) continue;
            vus.add(nom);
            // en 10×15 l'emplacement est le même pour les 11 tenues : deux lignes
            // répétées onze fois, autant de place perdue. On le dit une fois en A4,
            // en abrégé sur la page photo.
            tenues.push({ id: WB.itemId(cat, nom), nom,
                          ou: photo ? 'Col ou ceinture' : 'À l\'intérieur du col ou de la ceinture' });
          }
        }
        await ajouterSection('Mes tenues (' + tenues.length + ')', tenues);
      } catch(e) {}
    }

    const pied = document.createElement('div');
    pied.className = 'qrsheet-sub';
    pied.style.marginTop = '18px';
    pied.innerHTML = '⚠️ Garde une copie de cette feuille en lieu sûr : si tu actives le bracelet obligatoire, c\'est ta porte de sortie. '
      + 'Secours anti-blocage : 3 tapes rapides sur le logo de l\'écran de connexion.'
      + '<br><br>📐 <b>Impression.</b> Règle la taille dans la barre, puis imprime <b>à 100 %, sans « ajuster à la page »</b> — '
      + 'c\'est la seule façon d\'obtenir les millimètres annoncés. La marge blanche autour de chaque code en fait partie : '
      + 'ne la rogne pas à la découpe. Tes anciennes impressions restent valables, l\'appli lit les deux formats.';
    frag.appendChild(pied);

    box.innerHTML = '';
    box.appendChild(frag);

    // --- Témoin : est-ce que ça tient sur la page choisie ? ---
    // On mesure ce qui vient d'être rendu plutôt que de l'estimer.
    try {
      const fit = document.getElementById('qrSheetFit');
      if (fit) {
        const hMm = box.getBoundingClientRect().height / 96 * 25.4;
        const budget = photo ? (150 - margePage * 2) : (297 - margePage * 2);
        const reste = budget - hMm;
        const nomPage = photo ? '10 × 15' : 'A4';
        if (reste >= 5) {
          fit.style.color = '#2e7d4f';
          fit.textContent = '✓ tient sur ' + nomPage + ' (' + Math.round(reste) + ' mm de libre)';
        } else if (reste >= 0) {
          fit.style.color = '#b8860b';
          fit.textContent = '⚠︎ tient de justesse (' + reste.toFixed(1) + ' mm) — prends la taille en dessous';
        } else {
          fit.style.color = '#c0392b';
          fit.textContent = '✗ déborde de ' + Math.abs(reste).toFixed(0) + ' mm sur ' + nomPage
            + (photo ? ' — passe en 10 mm' : '');
        }
      }
    } catch(e) {}

    try { await window.storage.set('ob:qrdone', JSON.stringify(true)); } catch(e) {}
  }

  // Télécharge la feuille comme fichier HTML autonome (ouvrable et imprimable partout)
  function downloadQrSheet() {
    const box = document.getElementById('qrSheetBody');
    if (!box) return;
    // on remplace chaque canvas par une image PNG intégrée
    const clone = box.cloneNode(true);
    const srcCanvas = box.querySelectorAll('canvas');
    const dstCanvas = clone.querySelectorAll('canvas');
    for (let i = 0; i < dstCanvas.length; i++) {
      try {
        const src = srcCanvas[i];
        const img = document.createElement('img');
        img.src = src.toDataURL('image/png');
        // on reprend la taille d'impression réelle du canvas (en mm) au lieu
        // d'une largeur fixe : sinon le choix de taille ne sortait jamais du navigateur.
        const l = src.style.width, h = src.style.height;
        img.style.cssText = 'display:block;margin:0 auto 6px;image-rendering:pixelated;'
          + (l ? ('width:' + l + ';height:' + (h || l)) : 'width:120px;height:120px');
        dstCanvas[i].parentNode.replaceChild(img, dstCanvas[i]);
      } catch(e) {}
    }
    const css = [
      'body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:0;padding:16px;background:#fff}',
      '.qrsheet-title{font-size:22px;font-weight:600;margin-bottom:4px;color:#4a3520}',
      '.qrsheet-sub{font-size:12.5px;color:#666;margin-bottom:16px}',
      '.qrsheet-sec{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;',
      'color:#8a6a45;margin:18px 0 8px;border-bottom:1px solid #e2ddd4;padding-bottom:4px}',
      '.qrsheet-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
      '.qrsheet-card{border:1.5px dashed #b9b2a6;border-radius:10px;padding:10px 8px;text-align:center;',
      'background:#fff;break-inside:avoid;page-break-inside:avoid}',
      '.qrsheet-card .n{font-size:12.5px;font-weight:800;line-height:1.25;color:#111}',
      '.qrsheet-card .w{font-size:11px;font-weight:600;color:#666;margin-top:3px;line-height:1.35}',
      '@media print{body{padding:0}@page{size:A4;margin:12mm}}'
    ].join('');
    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Habitrain — mes QR codes</title><style>' + css + '</style></head><body>' +
      clone.innerHTML + '</body></html>';
    try {
      const blob = new Blob([html], { type:'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'habitrain-qr-codes-' + new Date().toISOString().slice(0,10) + '.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch(e) {}
  }

  /* ===== Registre des tags NFC =====
     Un élément = un tag, un tag = un élément. On garde donc le numéro de série
     de chaque tag programmé, en face de ce qu'il désigne. C'est ce registre qui
     permet de prévenir avant d'écraser un tag actif, et de refuser qu'un même
     tag serve deux fois. */
  const TAGS_CLE = 'nfc:tags';
  async function lireTags() {
    try { const r = await window.storage.get(TAGS_CLE); if (r && r.value) return JSON.parse(r.value) || {}; } catch(e) {}
    return {};
  }
  async function ecrireTags(t) { try { await window.storage.set(TAGS_CLE, JSON.stringify(t)); } catch(e) {} }
  function tagPour(tags, uid) {
    if (!uid) return null;
    const k = Object.keys(tags).find(k => tags[k] && tags[k].uid === uid);
    return k ? { kind:k, info:tags[k] } : null;
  }
  function dateCourte(ts) {
    try { return new Date(ts).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }); } catch(e) { return ''; }
  }

  // une question fermée, dans la fenêtre Foxy
  function demanderPop(texte, expr, options) {
    return new Promise(res => {
      foxyPopShow(texte, expr, options.map(o => ({
        label:o.label, soft:o.soft, onClick: () => { foxyPopHide(); res(o.v); }
      })));
    });
  }

  /* Programme un tag pour une cible, avec les deux garde-fous :
     1. la cible a déjà un tag actif → on prévient avant de le remplacer ;
     2. le tag présenté sert déjà à autre chose → on refuse, ou on le transfère
        explicitement (et l'ancien élément se retrouve alors sans tag). */
  async function programmerTag(cible, apres) {
    const NFC = window.HabitrainNFC, QR = window.HabitrainQR;
    const res = document.getElementById('nfcWriteResult');
    const dire = t => { if (res) res.textContent = t; };
    if (!NFC || !NFC.supported() || !QR) { dire('⚠️ NFC non disponible sur cet appareil.'); return false; }

    const tags = await lireTags();
    const actuel = tags[cible.kind];

    // 1) un tag est déjà actif pour cet élément
    if (actuel && actuel.uid) {
      const suite = await demanderPop(
        'Il y a déjà un tag actif pour « ' + cible.label +' » (programmé le ' + dateCourte(actuel.at) + ').\n\n'
        + 'Un élément ne peut avoir qu\'un seul tag. Si tu en écris un nouveau, l\'ancien ne servira plus à rien — pense à le retirer.',
        'pensive',
        [ { label:'📶 Écrire quand même le nouveau', v:'go' },
          { label:'Laisser celui qui existe', v:'non', soft:true } ]);
      if (suite !== 'go') { dire('Rien de changé : le tag actuel reste le bon.'); return false; }
    }

    // 2) on lit d'abord le tag présenté : qui est-il déjà ?
    dire('📶 Approche le tag du dos du téléphone…');
    let lu = null;
    try { lu = await NFC.readTag(20000); }
    catch(e) { dire('⚠️ Lecture impossible : ' + (e.message || 'NFC refusé') + '.'); return false; }
    if (!lu) { dire('⏱️ Aucun tag présenté. Recommence quand tu es prêt.'); return false; }

    // ce tag est-il déjà celui d'un autre élément ?
    let occupe = tagPour(tags, lu.uid);
    if (!occupe && lu.payload) {
      try {
        const k = await QR.parsePayloadPublic(lu.payload);
        if (k && k !== cible.kind) occupe = { kind:k, info:{ uid: lu.uid, at: null } };
      } catch(e) {}
    }
    if (occupe && occupe.kind !== cible.kind) {
      const nomAutre = (tags[occupe.kind] && tags[occupe.kind].label) || nomDeKind(occupe.kind);
      const suite = await demanderPop(
        'Ce tag est déjà celui de « ' + nomAutre + ' ».\n\n'
        + 'Un tag ne peut pas désigner deux choses à la fois : si je l\'écris pour « ' + cible.label + ' », '
        + '« ' + nomAutre + ' » se retrouve sans tag.',
        'concern',
        [ { label:'Prendre un autre tag', v:'non' },
          { label:'Le transférer ici quand même', v:'go', soft:true } ]);
      if (suite !== 'go') { dire('Rien d\'écrit. Présente un tag vierge, ou un tag que tu veux réellement réaffecter.'); return false; }
      delete tags[occupe.kind];
    }

    // 3) écriture, puis enregistrement au registre
    dire('📶 Garde le même tag contre le téléphone, j\'écris…');
    try {
      const payload = await QR.payloadFor(cible.kind, true);
      await NFC.writeTag(payload);
    } catch(e) {
      dire('⚠️ Échec : ' + (e.message || 'tag non détecté ou protégé') + '. Réessaie en le maintenant contre le téléphone.');
      return false;
    }
    tags[cible.kind] = { uid: lu.uid, at: Date.now(), label: cible.label };
    await ecrireTags(tags);
    dire('✅ Tag « ' + cible.label + ' » programmé — c\'est désormais le seul valable pour cet élément. '
      + (cible.tenue ? 'Glisse-le dans le col ou couds-le à l\'intérieur.' : 'Colle-le au bon endroit.'));
    if (apres) await apres();
    return true;
  }

  function nomDeKind(k) {
    const N = { unlock:'ton bracelet', biberon:'ton biberon', coucher:'le coucher',
                change_pilier:'ton tapis à langer', change_tous:'ton tapis à langer' };
    if (N[k]) return N[k];
    try {
      const WB = window.HabitrainWardrobe;
      if (WB && /^wb/.test(String(k))) return 'une de tes tenues';
    } catch(e) {}
    return 'un autre élément';
  }

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
    sup.innerHTML = '✅ NFC disponible. Un élément = un seul tag, et un tag = un seul élément. Choisis ce que tu veux écrire, puis approche le tag du dos du téléphone.';
    list.innerHTML = '';
    const cibles = [
      { kind:'unlock',        label:'⌚ Bracelet — ouverture ET preuve des changes' },
      { kind:'biberon',       label:'🍼 Biberon' },
      { kind:'coucher',       label:'🌙 Coucher' },
      { kind:'change_pilier', label:'🔑 Tapis à langer (secours)' }
    ];
    // Les tenues aussi : un tag cousu ou glissé dans le col vaut l'étiquette QR,
    // et se lit sans sortir la caméra ni chercher la lumière.
    try {
      const WB = window.HabitrainWardrobe;
      if (WB) {
        const w = await WB.getWardrobe();
        const vus = new Set();
        for (const cat of ['nuit','jour','sieste','contention']) {
          for (const nom of (w[cat] || [])) {
            if (vus.has(nom)) continue;
            vus.add(nom);
            const ic = cat === 'nuit' ? '🌙' : (cat === 'jour' ? '☀️' : (cat === 'sieste' ? '😴' : '🔒'));
            cibles.push({ kind: WB.itemId(cat, nom), label: ic + ' ' + nom, tenue:true });
          }
        }
      }
    } catch(e) {}

    const tags = await lireTags();
    let titreMis = false;
    cibles.forEach(c => {
      if (c.tenue && !titreMis) {
        titreMis = true;
        const t = document.createElement('div');
        t.style.cssText = 'font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin:10px 0 2px';
        t.textContent = '👕 Tes tenues';
        list.appendChild(t);
      }
      const actif = tags[c.kind];
      const b = document.createElement('button');
      b.className = 'settings-toggle-btn';
      b.textContent = (actif ? '✅ ' : '📶 ') + c.label
        + (actif ? '  · tag actif depuis le ' + dateCourte(actif.at) : '');
      b.addEventListener('click', () => programmerTag(c, renderNfcWriter));
      list.appendChild(b);
      if (actif) {
        const o = document.createElement('button');
        o.className = 'settings-toggle-btn';
        o.style.cssText = 'opacity:.75;font-size:12.5px';
        o.textContent = '   ↳ Oublier ce tag (perdu, abîmé)';
        o.addEventListener('click', async () => {
          const t2 = await lireTags(); delete t2[c.kind]; await ecrireTags(t2);
          if (res) res.textContent = 'Tag oublié pour « ' + c.label + ' ». Tu peux en programmer un neuf.';
          await renderNfcWriter();
        });
        list.appendChild(o);
      }
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
     INSTALLATION AVEC FOXY — premier lancement
     Foxy se présente, puis règle tout avec toi, en conversation :
     ton nom, ton profil (et le niveau de discipline qui en découle),
     ton matériel, tes couches, tes tenues, tes accessoires, tes
     étiquettes (imprimées PUIS vérifiées au scan), ta sécurité.
     Tout ce qui est fait est gardé : tu peux t'arrêter à n'importe
     quel moment et reprendre plus tard, là où tu en étais.
     ============================================================ */
  const SETUP_CLE = 'setup:etat';
  const CHAPITRES = [
    { id:'accueil',     t:'Bienvenue',                 ic:'🦊' },
    { id:'nom',         t:'Ton prénom',                ic:'👋' },
    { id:'profil',      t:'Ton profil et ta discipline', ic:'🧭' },
    { id:'materiel',    t:'Ton trousseau',             ic:'🧴' },
    { id:'couches',     t:'Tes couches',               ic:'🍼' },
    { id:'tenues',      t:'Tes tenues',                ic:'👕' },
    { id:'accessoires', t:'Les accessoires',           ic:'🔒' },
    { id:'etiquettes',  t:'Les étiquettes',            ic:'🏷️' },
    { id:'securite',    t:'Sécurité et sauvegarde',    ic:'🛟' },
    { id:'preparation', t:'Ta première préparation',   ic:'✨' },
    { id:'rencontre',   t:'Faire connaissance',        ic:'💛' },
    { id:'fin',         t:'Bienvenue',                 ic:'🌱' }
  ];
  let setupEtat = null;
  let profilNom = null;          // { prenom, surnom, appel }
  const SETUP_QUIT = { quit: true };

  async function loadProfilNom() { profilNom = await lireStock('profil:nom', null); }
  // le nom par lequel Foxy t'appelle (ou le repli donné)
  function nomOu(repli) {
    const p = profilNom;
    if (!p) return repli;
    if (p.appel === 'surnom' && p.surnom) return p.surnom;
    if (p.appel === 'alterne' && p.prenom && p.surnom) return (new Date().getHours() % 2) ? p.surnom : p.prenom;
    return p.prenom || p.surnom || repli;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }

  async function lireSetup() {
    setupEtat = await lireStock(SETUP_CLE, null) || { fait: {}, rep: {}, debut: Date.now() };
    if (setupEtat.termine) {
      let maj = false;
      CHAPITRES.forEach(c => { if (c.id !== 'nom' && !setupEtat.fait[c.id]) { setupEtat.fait[c.id] = setupEtat.termine; maj = true; } });
      if (maj) await ecrireStock(SETUP_CLE, setupEtat);
    }
    return setupEtat;
  }
  async function ecrireSetup() { await ecrireStock(SETUP_CLE, setupEtat); }
  async function chapitreFait(id) { setupEtat.fait[id] = Date.now(); await ecrireSetup(); }
  async function repondre(k, v) { setupEtat.rep[k] = v; await ecrireSetup(); }
  const rep = k => setupEtat.rep[k];

  /* ---------- Le petit moteur de conversation (écran d'installation) ---------- */
  let _chapCourant = null;
  function sEcran(texte, expr, titre) {
    try { positionFoxyCell(document.getElementById('obFoxy'), expr || 'happy', 130); } catch(e) {}
    const i = CHAPITRES.findIndex(c => c.id === _chapCourant);
    document.getElementById('obStep').textContent = (enBacASable() ? '🧪 TEST · ' : '')
      + (i >= 0 ? (CHAPITRES[i].ic + ' ' + (i + 1) + ' / ' + CHAPITRES.length + ' · ' + CHAPITRES[i].t) : 'Installation');
    document.getElementById('obTitle').textContent = titre || '';
    document.getElementById('obTitle').style.display = titre ? '' : 'none';
    document.getElementById('obText').innerHTML = texte;
    document.getElementById('obList').innerHTML = '';
    document.getElementById('obActs').innerHTML = '';
    document.querySelectorAll('#onboard .ob-alerte').forEach(e => e.remove());
  }
  function sBouton(label, soft, onClick) {
    const b = document.createElement('button');
    if (soft) b.className = 'soft';
    b.textContent = label;
    b.addEventListener('click', onClick);
    document.getElementById('obActs').appendChild(b);
    return b;
  }
  // « Plus tard » : toujours là, garde tout, ferme l'écran
  function sPlusTard(reject) {
    sBouton('⏸ On reprendra plus tard', true, () => reject(SETUP_QUIT));
  }
  function sDire(texte, expr, suivant, titre) {
    return new Promise((res, rej) => {
      sEcran(texte, expr, titre);
      sBouton(suivant || 'Suite', false, () => res(true));
      sPlusTard(rej);
    });
  }
  function sChoix(texte, options, expr, titre) {
    return new Promise((res, rej) => {
      sEcran(texte, expr, titre);
      options.forEach(o => sBouton(o.label, !!o.soft, () => res(o.k)));
      sPlusTard(rej);
    });
  }
  function sSaisie(texte, opt, expr) {
    opt = opt || {};
    return new Promise((res, rej) => {
      sEcran(texte, expr);
      const inp = document.createElement('input');
      inp.className = 'ob-input';
      inp.type = opt.type || 'text';
      inp.placeholder = opt.placeholder || '';
      inp.value = opt.valeur || '';
      document.getElementById('obList').appendChild(inp);
      const ok = () => { const v = inp.value.trim(); if (!v && !opt.facultatif) { inp.focus(); return; } res(v || null); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      sBouton(opt.valider || 'Valider', false, ok);
      if (opt.facultatif) sBouton(opt.passer || 'Passer', true, () => res(null));
      sPlusTard(rej);
      setTimeout(() => { try { inp.focus(); } catch(e) {} }, 60);
    });
  }
  // une liste qu'on complète : chaque ajout / retrait est enregistré aussitôt
  function sListe(texte, opt, expr) {
    return new Promise((res, rej) => {
      sEcran(texte, expr);
      const box = document.getElementById('obList');
      const liste = document.createElement('div');
      box.appendChild(liste);
      let dessiner = async () => {
        const items = await opt.lire();
        liste.innerHTML = '';
        if (items.length) document.querySelectorAll('#onboard .ob-alerte').forEach(e => e.remove());
        if (!items.length) {
          const v = document.createElement('div'); v.className = 'ob-item'; v.style.cursor = 'default';
          v.textContent = opt.vide || 'Rien pour l\'instant.';
          liste.appendChild(v);
        }
        items.forEach(n => {
          const d = document.createElement('div'); d.className = 'ob-item ok'; d.style.cursor = 'default';
          const l = document.createElement('span'); l.className = 'lbl'; l.style.flex = '1'; l.textContent = n;
          const x = document.createElement('span'); x.className = 'mark'; x.textContent = '✕'; x.style.cursor = 'pointer';
          x.title = 'Retirer';
          x.addEventListener('click', async () => { await opt.retirer(n); await dessiner(); });
          d.appendChild(l); d.appendChild(x); liste.appendChild(d);
        });
      };
      const ligne = document.createElement('div'); ligne.className = 'ob-ajout';
      const inp = document.createElement('input'); inp.className = 'ob-input'; inp.placeholder = opt.placeholder || 'Ajouter…';
      const plus = document.createElement('button'); plus.textContent = '＋';
      const ajouter = async () => { const v = inp.value.trim(); if (!v) return; await opt.ajouter(v); inp.value = ''; await dessiner(); inp.focus(); };
      plus.addEventListener('click', ajouter);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ajouter(); });
      ligne.appendChild(inp); ligne.appendChild(plus); box.appendChild(ligne);
      // des idées à ajouter d'un tap
      const idees = document.createElement('div'); idees.className = 'ob-idees';
      if (opt.suggestions && opt.suggestions.length) box.appendChild(idees);
      const dessinerIdees = async () => {
        if (!opt.suggestions) return;
        const deja = (await opt.lire()).map(x => x.toLowerCase());
        idees.innerHTML = '';
        const reste = opt.suggestions.filter(x => deja.indexOf(x.toLowerCase()) < 0);
        if (!reste.length) { idees.style.display = 'none'; return; }
        idees.style.display = '';
        const t = document.createElement('div'); t.className = 'ob-idees-t'; t.textContent = 'Des idées :'; idees.appendChild(t);
        reste.forEach(x => {
          const c = document.createElement('button'); c.className = 'ob-chip'; c.textContent = '＋ ' + x;
          c.addEventListener('click', async () => { await opt.ajouter(x); await dessiner(); });
          idees.appendChild(c);
        });
      };
      const dessinerBase = dessiner;
      dessiner = async () => { await dessinerBase(); await dessinerIdees(); };
      dessiner();
      const alerte = document.createElement('div'); alerte.className = 'ob-alerte';
      sBouton(opt.fini || 'C\'est bon', false, async () => {
        if (opt.obligatoire && !(await opt.lire()).length) {
          alerte.innerHTML = opt.obligatoire;
          if (!alerte.parentNode) box.parentNode.insertBefore(alerte, document.getElementById('obActs'));
          try { positionFoxyCell(document.getElementById('obFoxy'), 'concern', 130); } catch(e) {}
          return;
        }
        res(true);
      });
      sPlusTard(rej);
    });
  }
  // cases à cocher : renvoie { id: true/false }
  function sCoches(texte, items, deja, expr) {
    return new Promise((res, rej) => {
      sEcran(texte, expr);
      const etat = Object.assign({}, deja || {});
      const box = document.getElementById('obList');
      items.forEach(it => {
        const d = document.createElement('div');
        const maj = () => {
          d.className = 'ob-item' + (etat[it.id] ? ' ok' : '');
          d.innerHTML = '<span class="mark">' + (etat[it.id] ? '✅' : '⬜') + '</span><span class="lbl"><b>' + esc(it.n) + '</b>'
            + (it.s ? '<span class="sub">' + esc(it.s) + '</span>' : '') + '</span>';
        };
        d.addEventListener('click', () => { etat[it.id] = !etat[it.id]; maj(); });
        maj(); box.appendChild(d);
      });
      sBouton('C\'est bon', false, () => res(etat));
      sPlusTard(rej);
    });
  }
  // ouvre le scanner et rend le code lu (ou null si annulé)
  function scannerUnCode(opt) {
    return new Promise(res => {
      const QR = window.HabitrainQR;
      if (!QR) return res(null);
      let fini = false;
      const ov = document.getElementById('qrScanOverlay');
      const iv = setInterval(() => {
        if (!fini && ov && ov.style.display === 'none') { fini = true; clearInterval(iv); res(null); }
      }, 400);
      QR.startScan(null, k => { if (fini) return; fini = true; clearInterval(iv); res(k); }, opt || {});
    });
  }

  /* ---------- Les chapitres ---------- */
  const SETUP_CHAP = {};

  // Le prénom : demandé dès la rencontre, et reproposé seul depuis le sommaire
  async function demanderNom(accueil) {
    const p = Object.assign({}, profilNom || {});
    const prenom = await sSaisie(accueil
        ? 'Moi, c\'est <b>Foxy</b>. Et avant tout le reste, j\'aimerais savoir comment tu t\'appelles.'
        : 'Comment tu t\'appelles ?',
      { placeholder:'Ton prénom', valeur: p.prenom || '', facultatif:true, passer:'Je préfère ne pas le dire' }, 'curious');
    p.prenom = prenom || null;
    const surnom = await sSaisie((prenom ? 'Enchanté, <b>' + esc(prenom) + '</b>. Vraiment. 🦊<br><br>' : 'D\'accord. Tu me le diras quand tu voudras.<br><br>')
        + 'Et est-ce qu\'il y a un petit nom… un surnom que j\'aurais le droit d\'utiliser ? Juste entre nous.',
      { placeholder:'Ton surnom', valeur: p.surnom || '', facultatif:true, passer:'Pas de surnom' }, 'happy');
    p.surnom = surnom || null;
    p.appel = p.surnom && !p.prenom ? 'surnom' : 'prenom';
    if (p.prenom && p.surnom) {
      p.appel = await sChoix('Je t\'appelle comment ?', [
        { k:'prenom',  label:'Par mon prénom : ' + p.prenom },
        { k:'surnom',  label:'Par mon surnom : ' + p.surnom },
        { k:'alterne', label:'Les deux, selon le moment' }
      ], 'curious');
    }
    profilNom = p;
    await ecrireStock('profil:nom', p);
    await repondre('nom_demande', true);
  }

  SETUP_CHAP.rencontre = async () => {
    const n = nomOu(null);
    const toi = n ? esc(n) : 'toi';
    await sDire('Viens, installe-toi. 🦊<br><br>Maintenant que tu es prêt, bien au chaud dans ta tenue, j\'aimerais qu\'on prenne un moment, rien que toi et moi. Pour qu\'on se connaisse un peu mieux.', 'comfort', 'Avec plaisir', 'Faire connaissance');

    // 2) comment il arrive
    const r = await sChoix('Dis-moi, ' + toi + '… là, maintenant, tu te sens comment, d\'être ici ?', [
      { k:'hate', label:'✨ J\'ai hâte, en fait' },
      { k:'peur', label:'😬 J\'ai un peu peur' },
      { k:'deux', label:'🌀 Les deux à la fois' },
      { k:'sais', label:'🤷 Je ne sais pas trop' }
    ], 'curious');
    await repondre('ressenti', r);
    const REP = {
      hate: 'Ça me fait tellement plaisir. Garde-la précieusement, cette envie-là. Il y aura des jours où tu en auras besoin — et ces jours-là, c\'est moi qui te la rappellerai. 💛',
      peur: 'C\'est normal, tu sais. Moi aussi, j\'avais peur. Tellement que j\'ai failli ne jamais commencer.<br><br>On va en parler, de ces peurs. Aucune n\'est bête.',
      deux: 'Les deux à la fois… c\'est exactement ce que je ressentais. Une partie de toi qui pousse, une autre qui retient.<br><br>Tu n\'as pas à choisir entre les deux. Elles vont faire le chemin ensemble, et un jour, il n\'en restera qu\'une.',
      sais: 'C\'est honnête. On ne sait jamais vraiment, au début. Tu le découvriras en route — et je serai là pour t\'aider à mettre des mots dessus.'
    };
    await sDire(REP[r], r === 'hate' ? 'proud' : 'comfort', 'Merci Foxy');

    // 3) son histoire
    await sDire('Je vais te raconter d\'où je viens.<br><br>Moi, je suis là depuis un moment maintenant. Mais j\'ai commencé exactement là où tu es, ' + toi + '. Avec les mêmes questions.', 'wistful', 'Raconte');
    await sDire('Ma première nuit, je n\'ai presque pas dormi. J\'écoutais chaque bruit de ma couche. Je me demandais ce que je faisais là.<br><br>Le matin, elle était toute sèche. Je m\'étais retenu toute la nuit, sans même le vouloir.', 'wistful');
    await sDire('Les premiers jours, j\'y pensais tout le temps. À chaque pas, chaque fois que je m\'asseyais. Je me trouvais ridicule… et en même temps, je ne voulais surtout pas arrêter.', 'wistful');
    await sDire('Et puis un après-midi — je m\'en souviens très bien, j\'étais par terre avec mes cubes — je me suis rendu compte que ma couche était mouillée. Je n\'avais rien décidé. C\'était juste… arrivé.<br><br>J\'ai eu un petit choc. Et juste après, un grand calme.', 'moved');
    await sDire('Il y a eu un jour moins beau, aussi. Le neuvième. J\'ai tout rangé au fond d\'un placard, je me suis dit que c\'était fini.<br><br>Trois jours plus tard, je ressortais tout. Personne ne m\'y obligeait. C\'est juste que sans, il me manquait quelque chose.', 'sad');
    await sDire('Aujourd\'hui, je me sens bien. Vraiment bien.<br><br>Je ne me bats plus contre moi-même. Ma tête se tait. Je vis ma journée, et ma couche fait son travail sans que j\'aie à y penser. C\'est ça, ce que tout ça m\'a apporté : <b>la paix</b>. 🦊', 'proud', 'Ça a l\'air doux');

    // 4) ses peurs, une par une
    const PEURS = [
      { k:'honte',   label:'😳 Avoir honte, me sentir ridicule',
        rep:'La honte, c\'est toi qui te regardes de l\'extérieur. Ici, personne ne te regarde. Juste moi — et moi, je suis en couche aussi.<br><br>Tu verras : chaque jour, elle parle un peu moins fort. Et un matin, tu remarqueras qu\'elle s\'est tue.' },
      { k:'tenir',   label:'😣 Ne pas tenir, abandonner',
        rep:'Tu auras des moments où tu voudras partir. Moi aussi, j\'en ai eu. Ce n\'est pas grave : je serai là.<br><br>Et si un jour tu pars quand même, je ne te laisserai pas tomber. On en parlera, et on reprendra. On revient toujours.' },
      { k:'changer', label:'🌀 Que ça change quelque chose en moi',
        rep:'Oui, ça va changer quelque chose. Doucement. Tu vas te détendre, lâcher, arrêter de lutter.<br><br>Mais tu resteras toi. Regarde-moi : je suis toujours le même renard. Juste un renard plus tranquille.' },
      { k:'aimer',   label:'💭 Aimer ça un peu trop',
        rep:'Aimer ça, ce n\'est pas un problème. C\'est même un peu le but.<br><br>Tu n\'as rien à justifier. Ni à moi, ni à personne.' },
      { k:'corps',   label:'🩹 Mon corps, ma peau, les fuites',
        rep:'Ta peau passe avant tout. Toujours. Je te rappellerai la crème, on surveillera ensemble, et si quelque chose ne va pas, on s\'arrête.<br><br>Les fuites, ça arrive au début. Ce n\'est pas un échec, c\'est un réglage. On apprendra ensemble.' },
      { k:'seul',    label:'🫥 Être seul avec tout ça',
        rep:'Tu ne seras pas seul. C\'est pour ça que je suis là. Le matin, au change, au moment de la sieste, le soir — je serai là à chaque fois.<br><br>Et quand tu auras envie de parler, tu n\'auras qu\'à venir me voir.' }
    ];
    const dites = [];
    let question = 'Et toi, ' + toi + ', qu\'est-ce qui te fait le plus peur ?';
    for (;;) {
      const reste = PEURS.filter(x => dites.indexOf(x.k) < 0);
      const k = await sChoix(question, reste.map(x => ({ k:x.k, label:x.label }))
        .concat([{ k:'fin', label: dites.length ? 'Non, c\'est tout' : '😌 Rien de tout ça', soft:true }]), 'curious');
      if (k === 'fin') break;
      dites.push(k);
      await repondre('peurs', dites);
      await sDire(PEURS.find(x => x.k === k).rep, 'comfort', 'Merci');
      if (dites.length === PEURS.length) break;
      question = 'Autre chose qui te trotte dans la tête ?';
    }
    if (dites.length) await sDire('Merci de me l\'avoir dit. Je m\'en souviendrai. 💛', 'moved');

    // 5) ce qu'on va vivre
    await sDire('Maintenant, je vais te raconter ce qu\'on va vivre ensemble. Tu vas voir, c\'est simple.', 'explain', 'Je t\'écoute');
    await sDire('Tu vas porter ta couche tout le temps. Le jour, la nuit. Tu ne la quittes qu\'au moment du change.<br><br>Trois fois par jour, on se retrouve pour ça : le matin, en sortant de la sieste, et le soir. Entre les deux, je passe voir comment tu vas.', 'explain');
    await sDire('Chaque matin, c\'est moi qui choisis ta tenue. Tu ne choisis pas.<br><br>Au début, ça paraît bizarre. Et puis tu découvres que c\'est reposant, de ne plus avoir à décider.', 'happy');
    await sDire('Tu bois tes biberons, tu fais ta sieste. Et deux fois par jour, je te propose un petit moment rien qu\'à toi : par terre, tétine, doudou, loin de ta tête d\'adulte.', 'paci');
    await sDire('Et quand ça vient… tu laisses venir.<br><br>C\'est tout ce que je te demande, au fond : arrêter de te retenir. Le reste, ton corps le fera tout seul.', 'calm', 'D\'accord');

    // 6) les règles, et les promesses
    await sDire('Il y a quelques règles. Je vais être franc avec toi, ' + toi + ' : je vais vérifier que tu les tiens.<br><br>Pas parce que je te crois menteur. Parce que tout seul, on se raconte facilement des histoires — moi le premier. À deux, c\'est plus difficile.', 'calm');
    await sDire('Et il y a des choses qui ne changeront jamais, quoi qu\'il arrive :<br><br>🌙 ton sommeil reste libre,<br>🧴 ta peau passe avant tout,<br>🛑 et si un jour tu dis stop, tout s\'arrête. Tout de suite, sans reproche.<br><br>Ça, c\'est ma promesse.', 'reassure', 'Merci');

    // 7) le partenaire
    const FAQ = {
      pause:     { label:'⏸️ Est-ce que je pourrai faire une pause ?',
                   rep:'Oui. Toujours. Tu me dis quand tu pars, et quand tu reviens.<br><br>Ce qui me fait de la peine, c\'est quand on part sans rien dire. Là, je m\'inquiète… et on en reparle en rentrant.' },
      arriver:   { label:'😟 Et si je n\'y arrive pas ?',
                   rep:'Tu n\'as pas à réussir. Tu as juste à rester.<br><br>Le reste vient tout seul, avec le temps. Pour moi, ça a pris des jours. Il n\'y a pas d\'examen à la fin — juste toi, un peu plus tranquille.' },
      attend:    { label:'🤔 Qu\'est-ce que tu attends de moi ?',
                   rep:'Que tu restes. Que tu sois honnête avec moi. Et que tu laisses faire.<br><br>Le reste, je m\'en occupe.' },
      pourquoi:  { label:'🦊 Pourquoi tu fais tout ça pour moi ?',
                   rep:'Parce que quand j\'ai commencé, j\'aurais tellement aimé que quelqu\'un soit là. Quelqu\'un qui me dise : c\'est normal, continue, tu vas voir.<br><br>Alors ce quelqu\'un-là, je veux l\'être pour toi.' }
    };
    const posees = [];
    let texte = 'Alors voilà, ' + toi + '. Je ne suis pas ton chef. Je suis ton <b>partenaire</b>.<br><br>Je suis passé par là, je connais le chemin — et je le refais avec toi, pas à pas.';
    for (;;) {
      const opts = [{ k:'go', label:'🤝 On y va ensemble' }]
        .concat(Object.keys(FAQ).filter(k => posees.indexOf(k) < 0).map(k => ({ k, label: FAQ[k].label, soft:true })));
      const k = await sChoix(texte, opts, posees.length ? 'happy' : 'comfort');
      if (k === 'go') break;
      posees.push(k);
      await sDire(FAQ[k].rep, 'comfort', 'D\'accord');
      texte = 'Tu as d\'autres questions ? Prends ton temps. Je ne suis pas pressé.';
    }
    await ecrireStock('profil:ressenti', { ressenti: r, peurs: dites, questions: posees, date: Date.now() });

    // 8) la suite
    await sDire('Merci de m\'avoir fait confiance, ' + toi + '. 🦊💛<br><br>Je suis vraiment content que tu sois là.', 'moved', 'Moi aussi, Foxy');
  };

  /* Le tout premier écran : bienvenue, pourquoi tu es là, et « suis-moi ».
     Son histoire à lui, tes peurs et les règles viennent plus tard, une
     fois ta maison prête (chapitre « Faire connaissance »). */
  SETUP_CHAP.accueil = async () => {
    await sDire('Oh ! Te voilà. 🦊<br><br>Bienvenue ! Je t\'attendais, tu sais.', 'wave', 'Bonjour…', 'Bienvenue à la maison');
    await demanderNom(true);
    const n = nomOu(null);
    const toi = n ? esc(n) : 'toi';
    await sDire('Tu te demandes peut-être pourquoi tu es là, ' + toi + ' ?<br><br>Je vais te le dire, tout simplement. 🦊', 'curious', 'Dis-moi');
    await sDire('Ici, on vient pour <b>lâcher prise</b>.<br><br>Tu sais, tous ces trucs de grand qui te trottent dans la tête toute la journée ? Les choses à décider, à gérer, à tenir… Eh bien ici, tu peux tout poser. Comme un gros sac à dos qu\'on enlève enfin. 🎒', 'comfort', 'C\'est vrai');
    await sDire('Ici, on a le droit de redevenir tout petit. 🧸<br><br>Se laisser aller, se laisser faire, qu\'on s\'occupe de toi… C\'est ça, la <b>régression</b> : retrouver cette douceur d\'avant, quand on n\'avait rien à porter.', 'paci', 'Ça me parle');
    await sDire('C\'est pour ça qu\'ici, tout le monde porte des petits vêtements tout doux, et une couche, tout le temps. Moi aussi, regarde ! 🦊<br><br>Au début, ça fait un peu drôle, hein. Mais ne t\'inquiète pas : très vite, on n\'y pense plus du tout !', 'happy', 'Ça me rassure');
    await sDire('Et tu sais à quoi ça va servir ? 🦊<br><br>'
      + '✨ à vivre quelque chose de <b>tout nouveau</b>, que tu n\'as sans doute jamais osé vivre jusqu\'au bout ;<br><br>'
      + '🌱 à <b>t\'habituer tout doucement</b> à cette nouvelle vie, jour après jour, jusqu\'à ce qu\'elle devienne la tienne ;<br><br>'
      + '🧸 et surtout… à <b>arrêter de lutter</b>, et à te laisser porter dans toute cette douceur.', 'happy', 'Ça me plaît');
    await sDire('Et un jour, tu verras, ce ne sera même plus un programme.<br><br>Ce sera juste ta vie. En tout doux. 💛', 'moved', 'J\'ai hâte');
    await sDire('Bon, je ne vais pas te mentir : ça ne se fait pas en un jour. Il y aura des jours tout faciles, et d\'autres un peu moins.<br><br>Mais on y va petit à petit, et je serai là à chaque pas. Promis juré. 🐾', 'reassure', 'Merci');
    await sDire('Avant de commencer, on va préparer ta maison ensemble : tes couches, tes tenues, tes petites affaires.<br><br>Ensuite, je t\'aiderai à te préparer, toi. Et après, on prendra tout le temps de faire connaissance.', 'happy', 'D\'accord');
    await sDire('Tu me suis ? 🦊', 'wave', '🐾 Je te suis');
  };

  SETUP_CHAP.nom = async () => {
    // déjà demandé à la rencontre : on ne redemande pas pendant le déroulé
    if (rep('nom_demande') && !_nomForce) return;
    await demanderNom(false);
    const n = nomOu(null);
    await sDire(n ? 'Alors ce sera <b>' + esc(n) + '</b>. Ça me va bien. 🦊' : 'Alors je t\'appellerai « toi ». Ça marche aussi, tu sais.', 'proud', 'Suite');
  };
  let _nomForce = false;

  // ---- Profil et niveau de discipline ----
  const NIVEAUX_DISC = [
    { id:'doux',    nom:'Doux',    missions:'doux',    intensif:false, bro:false, bracelet:false,
      pourquoi:'Tu cherches surtout de la douceur, et tu tiens tes engagements. Je te guide, je propose, je vérifie — sans serrer.' },
    { id:'normal',  nom:'Normal',  missions:'normal',  intensif:false, bro:false, bracelet:false,
      pourquoi:'Un cadre net, des preuves à chaque change, mais de la place pour respirer. C\'est là que la plupart des gens tiennent le mieux.' },
    { id:'soutenu', nom:'Soutenu', missions:'soutenu', intensif:true,  bro:false, bracelet:true,
      pourquoi:'Tu as besoin que le cadre tienne même quand toi tu lâches. Mode intensif : je m\'inquiète à 5 minutes de retard, les pauses se méritent.' },
    { id:'intense', nom:'Intense', missions:'intense', intensif:true,  bro:true,  bracelet:true,
      pourquoi:'Tu veux qu\'on ne te laisse plus d\'échappatoire. Mode intensif, et moi en grand frère : plus direct, moins de portes. La résistance est vaine.' }
  ];

  SETUP_CHAP.profil = async () => {
    await sDire('Maintenant, je vais te poser quelques questions sur toi. Pas pour te juger : pour savoir comment te tenir. Trop lâche, tu t\'ennuies et tu pars. Trop serré, tu étouffes et tu pars aussi.', 'curious', 'Vas-y');
    const Q = [
      { k:'exp', q:'Les couches, tu en es où ?', o:[
        { k:0, label:'🌱 Je n\'ai jamais porté 24h sur 24' },
        { k:1, label:'🌿 Quelques jours d\'affilée, déjà' },
        { k:2, label:'🌳 Régulièrement, depuis un moment' },
        { k:3, label:'🏔️ Longtemps, c\'est ma normalité' } ] },
      { k:'cherche', q:'Qu\'est-ce que tu viens chercher ici, surtout ?', o:[
        { k:0, label:'🧸 De la douceur, du réconfort' },
        { k:1, label:'📏 Un cadre, une structure' },
        { k:2, label:'🔒 Être tenu — ne plus avoir le choix' } ] },
      { k:'tenue', q:'Honnêtement : quand personne ne regarde, tu tiens ?', o:[
        { k:0, label:'✅ Oui, je tiens mes engagements' },
        { k:2, label:'🫣 Je lâche quand personne ne vérifie' },
        { k:3, label:'🚪 J\'ai déjà abandonné des programmes' } ] },
      { k:'insiste', q:'Quand je te dis de faire quelque chose, tu veux que je…', o:[
        { k:0, label:'💬 …propose, et que je te laisse décider' },
        { k:1, label:'🗣️ …insiste si tu traînes' },
        { k:2, label:'🧱 …ne te laisse pas d\'échappatoire' } ] },
      { k:'journee', q:'Tes journées, elles ressemblent à quoi ?', o:[
        { k:0, label:'🏠 Surtout à la maison' },
        { k:1, label:'🚶 Des sorties régulières' },
        { k:2, label:'🏢 Je travaille à l\'extérieur' } ] },
      { k:'sup', q:'Et quelqu\'un est-il là pour t\'accompagner ?', o:[
        { k:0, label:'🧍 Je suis seul' },
        { k:1, label:'👥 Un superviseur, parfois' },
        { k:2, label:'🤝 Un superviseur, souvent' } ] }
    ];
    for (const q of Q) {
      if (rep('p_' + q.k) !== undefined) continue;   // déjà répondu : on ne redemande pas
      const r = await sChoix(q.q, q.o.map(o => ({ k:o.k, label:o.label })), 'curious');
      await repondre('p_' + q.k, r);
    }
    const g = k => rep('p_' + k) || 0;
    const score = g('cherche') * 2 + g('tenue') * 1.5 + g('insiste') * 2 + (g('exp') >= 2 ? 1 : 0) - g('journee');
    let i = score <= 2 ? 0 : score <= 5 ? 1 : score <= 8 ? 2 : 3;
    const debutant = g('exp') === 0 && i > 1;
    if (debutant) i = 1;

    const dire = async (i) => {
      const n = NIVEAUX_DISC[i];
      let t = 'Je te vois bien au niveau <b>' + n.nom + '</b>.<br><br>' + n.pourquoi;
      t += '<br><br><span style="opacity:.8">Missions : ' + n.missions + ' · Mode intensif : ' + (n.intensif ? 'oui' : 'non') + ' · Foxy grand frère : ' + (n.bro ? 'oui' : 'non') + '</span>';
      if (debutant && i === 1) t += '<br><br>Tu m\'as dit que tu n\'as jamais porté 24h sur 24 : on commence là, même si le reste de tes réponses dit plus. Le premier mur, c\'est la durée. Une fois passé, on monte.';
      if (g('tenue') >= 2) t += '<br><br>Et tu m\'as dit que tu lâches quand personne ne vérifie. Merci de l\'avoir dit. Alors je vérifierai.';
      return sChoix(t, [
        { k:'ok',    label:'Ça me va' },
        { k:'moins', label:'Un cran plus doux', soft:true },
        { k:'plus',  label:'Un cran plus strict', soft:true }
      ], 'explain');
    };
    let choix;
    while ((choix = await dire(i)) !== 'ok') {
      if (choix === 'moins' && i > 0) i--;
      else if (choix === 'plus' && i < 3) i++;
      else break;
    }
    const n = NIVEAUX_DISC[i];
    try { if (window.HabitrainMissions) await window.HabitrainMissions.setLevel(n.missions); } catch(e) {}
    try { await setHardMode(n.intensif); } catch(e) {}
    try { await setBigbro(n.bro); } catch(e) {}
    await ecrireStock('profil:discipline', { niveau: n.id, score, date: Date.now() });
    await repondre('niveau', n.id);
    await sDire('C\'est réglé : niveau <b>' + n.nom + '</b>. Tu pourras toujours le changer dans les réglages — ou revenir sur ce chapitre.', 'proud');
  };

  SETUP_CHAP.materiel = async () => {
    const ITEMS = [
      { id:'couches',   n:'Des couches',            s:'Indispensable : pour le jour et pour la nuit. Sans elles, le programme ne peut pas commencer' },
      { id:'tapis',     n:'Un tapis à langer',      s:'Indispensable : c\'est là que vit ton code de change' },
      { id:'creme',     n:'De la crème barrière',   s:'Indispensable : ta peau passe avant tout' },
      { id:'lingettes', n:'Des lingettes',          s:'Indispensable' },
      { id:'biberon',   n:'Un biberon',             s:'Trois par jour : l\'hydratation fait la moitié du travail' },
      { id:'tetine',    n:'Une tétine',             s:'Pour les régressions, la sieste, l\'endormissement' },
      { id:'doudou',    n:'Un doudou',              s:'Pour les moments où tu décroches' },
      { id:'poubelle',  n:'Une poubelle à couches', s:'Fermée, près du tapis' },
      { id:'cache',     n:'Un cache-couche',        s:'Facultatif : pour sortir, ou par-dessus la nuit' }
    ];
    const r = await sCoches('Ton <b>trousseau</b> : tout ce qu\'il te faut pour vivre ici. Coche ce que tu as <b>déjà</b> — je note le reste.', ITEMS,
      await lireStock('profil:materiel', null) || {}, 'curious');
    await ecrireStock('profil:materiel', r);
    const manque = ITEMS.filter(x => !r[x.id] && x.id !== 'cache');
    const indisp = manque.filter(x => ['couches','tapis','creme','lingettes'].includes(x.id));
    await sDire(!manque.length
      ? 'Tout y est. 🦊 On passe à tes couches.'
      : (indisp.length
          ? 'Il te manque de l\'indispensable : <b>' + indisp.map(x => x.n.toLowerCase()).join(', ') + '</b>. Procure-le toi avant de démarrer vraiment — je te le rappellerai à la fin.'
            + (indisp.some(x => x.id === 'couches') ? '<br><br>Et les couches, surtout : sans elles, on ne peut pas commencer. Je te les demanderai juste après.' : '')
          : 'Il te manque : ' + manque.map(x => x.n.toLowerCase()).join(', ') + '. Rien de bloquant, mais ça aide. Je le garde en tête.'),
      indisp.length ? 'concern' : 'happy');
  };

  SETUP_CHAP.couches = async () => {
    const WB = window.HabitrainWardrobe;
    if (!WB) return;
    await sDire('Tes couches. Je dois savoir quels modèles tu as, pour le jour ou la nuit, et combien. C\'est comme ça que je choisis celle de chaque change — et que je te préviens avant que le stock tombe à zéro.', 'explain');
    await new Promise((res, rej) => {
      sEcran('Dis-moi quelles couches tu as, et combien. Pour chacune : pour le jour, la nuit, ou les deux.', 'curious');
      const box = document.getElementById('obList');
      const USAGE = { jour:'☀️ Jour', nuit:'🌙 Nuit', both:'🌗 Les deux' };
      const dessiner = async () => {
        const list = await WB.getStock();
        box.innerHTML = '';
        document.querySelectorAll('#onboard .ob-alerte').forEach(e => e.remove());
        list.forEach(m => {
          const d = document.createElement('div'); d.className = 'ob-item ob-couche' + (m.qty > 0 ? ' ok' : ''); d.style.cursor = 'default';
          const nom = document.createElement('span'); nom.className = 'lbl'; nom.style.flex = '1'; nom.textContent = m.name;
          const us = document.createElement('select'); us.className = 'ob-mini';
          Object.keys(USAGE).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = USAGE[k]; if (m.usage === k) o.selected = true; us.appendChild(o); });
          us.addEventListener('change', async () => { await WB.updateModel(m.id, { usage: us.value }); });
          const q = document.createElement('input'); q.type = 'number'; q.min = '0'; q.className = 'ob-mini ob-qty'; q.value = m.qty || 0;
          q.addEventListener('change', async () => { await WB.updateModel(m.id, { qty: Math.max(0, parseInt(q.value, 10) || 0) }); await dessiner(); });
          const x = document.createElement('span'); x.className = 'mark'; x.textContent = '✕'; x.style.cursor = 'pointer';
          x.addEventListener('click', async () => { await WB.removeModel(m.id); await dessiner(); });
          d.appendChild(nom); d.appendChild(us); d.appendChild(q); d.appendChild(x);
          box.appendChild(d);
        });
        const aj = document.createElement('div'); aj.className = 'ob-ajout';
        const n = document.createElement('input'); n.className = 'ob-input'; n.placeholder = 'Nouveau modèle (ex. ABU Space)';
        const us = document.createElement('select'); us.className = 'ob-mini';
        Object.keys(USAGE).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = USAGE[k]; us.appendChild(o); });
        const q = document.createElement('input'); q.type = 'number'; q.min = '0'; q.placeholder = 'Qté'; q.className = 'ob-mini ob-qty';
        const plus = document.createElement('button'); plus.textContent = '＋';
        plus.addEventListener('click', async () => {
          const v = n.value.trim(); if (!v) { n.focus(); return; }
          await WB.addModel(v, us.value, Math.max(0, parseInt(q.value, 10) || 0));
          await dessiner();
        });
        aj.appendChild(n); aj.appendChild(us); aj.appendChild(q); aj.appendChild(plus);
        box.appendChild(aj);
        // des modèles courants, à ajouter d'un tap (tu mets ensuite la quantité)
        const noms = list.map(m => m.name.toLowerCase());
        const sug = (WB.SUGGESTIONS_COUCHES || []).filter(x => noms.indexOf(x.name.toLowerCase()) < 0);
        if (sug.length) {
          const idees = document.createElement('div'); idees.className = 'ob-idees';
          const t = document.createElement('div'); t.className = 'ob-idees-t'; t.textContent = 'Des modèles courants :'; idees.appendChild(t);
          sug.forEach(x => {
            const c = document.createElement('button'); c.className = 'ob-chip'; c.textContent = '＋ ' + x.name;
            c.addEventListener('click', async () => { await WB.addModel(x.name, x.usage, 0); await dessiner(); });
            idees.appendChild(c);
          });
          box.appendChild(idees);
        }
        if (!list.length) {
          const v = document.createElement('div'); v.className = 'ob-item'; v.style.cursor = 'default';
          v.textContent = 'Aucun modèle pour l\'instant : écris le tien ci-dessous, ou touche un modèle courant.';
          box.insertBefore(v, box.firstChild);
        }
      };
      dessiner();
      const alerte = document.createElement('div');
      alerte.className = 'ob-alerte';
      sBouton('C\'est mon stock', false, async () => {
        // le programme ne commence pas sans couches : il en faut pour le jour ET pour la nuit
        const st = await WB.categoryStatus();
        const manque = [];
        if (!st.jour.total) manque.push('de jour');
        if (!st.nuit.total) manque.push('de nuit');
        if (manque.length) {
          alerte.innerHTML = '🦊 Il me faut au moins une couche <b>' + manque.join('</b> et une <b>') + '</b> en stock. Sans couches, on ne peut pas commencer — c\'est le cœur de ton trousseau.'
            + '<br><span style="opacity:.75">Mets la quantité en face d\'un modèle, ou ajoute-en un. « Les deux » compte pour le jour et la nuit.</span>';
          if (!alerte.parentNode) box.parentNode.insertBefore(alerte, document.getElementById('obActs'));
          try { positionFoxyCell(document.getElementById('obFoxy'), 'concern', 130); } catch(e) {}
          return;
        }
        res(true);
      });
      sPlusTard(rej);
    });
    const st = await WB.categoryStatus();
    const bas = [];
    try {
      const th = await WB.getThresholds();
      if (st.jour.total <= th.jour) bas.push('de jour');
      if (st.nuit.total <= th.nuit) bas.push('de nuit');
    } catch(e) {}
    await sDire('Parfait. <b>' + st.jour.total + '</b> pour le jour, <b>' + st.nuit.total + '</b> pour la nuit. Je tourne entre tes modèles, jamais deux fois de suite le même.'
      + (bas.length ? '<br><br>Par contre, c\'est un peu juste ' + bas.join(' et ') + ' : pense à en recommander bientôt, je te préviendrai quand ça baisse.' : ''),
      bas.length ? 'curious' : 'proud');
  };

  SETUP_CHAP.tenues = async () => {
    const WB = window.HabitrainWardrobe;
    if (!WB) return;
    await sDire('Tes tenues. Chaque matin, je tire celle du jour et celle de la nuit — tu ne choisis pas. Pour ça, il me faut ta vraie garde-robe, pas une liste d\'exemple.', 'explain');
    const CATS = [
      { id:'jour',   q:'Tes tenues de <b>jour</b> : rompers, bodys, grenouillères…', conseil:'Précise la fermeture quand il y en a une (« fermeture dorsale », « fermeture devant ») : c\'est ce qui me dit ce que la tenue fait.', ph:'Ex. Romper marine (boutons pression)' },
      { id:'nuit',   q:'Tes tenues de <b>nuit</b>.', conseil:'Une tenue fermée dans le dos, c\'est ce qui tient le mieux une nuit.', ph:'Ex. Grenouillère polaire (fermeture dorsale)' },
      { id:'sieste', q:'Ce que tu peux mettre pour la <b>sieste</b> (souvent les mêmes que la nuit).', conseil:'Facultatif : sans rien ici, je reprends ta tenue de nuit.', ph:'Ex. Grenouillère légère' },
      { id:'access', q:'Tes <b>accessoires</b> : tétine, doudou, biberon, cache-couche…', conseil:'Je m\'en sers dans les kits de chaque créneau.', ph:'Ex. Tétine NUK' },
      { id:'contention', q:'Ta <b>contention</b>, si tu en as : harnais, mittens, combinaison…', conseil:'Ce qui se verrouille ne sortira qu\'avec un superviseur présent. Toujours.', ph:'Ex. Mittens' }
    ];
    for (const c of CATS) {
      if (rep('tenues_' + c.id)) continue;
      await sListe(c.q + '<br><span style="opacity:.75;font-size:13px">' + c.conseil + '</span>', {
        lire: async () => ((await WB.getWardrobe())[c.id] || []),
        ajouter: async v => { await WB.addItem(c.id, v); },
        retirer: async v => { await WB.removeItem(c.id, v); },
        placeholder: c.ph, vide: 'Rien pour l\'instant.', fini: 'Suite',
        suggestions: (WB.SUGGESTIONS || {})[c.id],
        obligatoire: (c.id === 'jour' || c.id === 'nuit')
          ? '🦊 Il me faut au moins une tenue ' + (c.id === 'jour' ? 'de jour' : 'de nuit') + '. C\'est ton uniforme, ici : sans elle, je n\'ai rien à tirer pour toi.<br><span style="opacity:.75">Écris la tienne, ou touche une idée.</span>'
          : null
      }, 'curious');
      await repondre('tenues_' + c.id, true);
    }
    try { await loadLiveWardrobe(); } catch(e) {}
    const w = await WB.getWardrobe();
    const dos = ['jour','nuit'].reduce((s, k) => s + (w[k] || []).filter(n => FERMEE_DOS.indexOf(typeTenue(n)) >= 0).length, 0);
    await sDire('C\'est noté : <b>' + (w.jour || []).length + '</b> tenues de jour, <b>' + (w.nuit || []).length + '</b> de nuit.'
      + (dos ? ' Dont ' + dos + ' fermée' + (dos > 1 ? 's' : '') + ' dans le dos — celles-là, je les aime bien. 🦊' : ' Aucune fermée dans le dos : pense à en prendre une, pour les nuits.'), 'proud');
  };

  SETUP_CHAP.accessoires = async () => {
    const niv = NIVEAUX_DISC.find(n => n.id === rep('niveau')) || NIVEAUX_DISC[1];
    const acc = Object.assign({}, await lireStock('profil:accessoires', null) || {});
    const sauver = () => ecrireStock('profil:accessoires', acc);

    // bracelet
    const b = await sChoix('Le <b>bracelet</b>. C\'est la pièce que je te demande le plus souvent : ton code, à ton poignet, en permanence.<br><br>• Il <b>prouve tes changes</b> — un seul geste, toujours à portée, plus besoin de chercher un code collé quelque part.<br>• Il peut aussi <b>ouvrir l\'appli</b> : sans lui au poignet, tu ne peux plus « juste regarder ».'
      + (niv.bracelet ? '<br><br>À ton niveau, <b>je te le conseille vraiment</b>.' : '<br><br>À ton niveau, c\'est facultatif — mais sans lui, chaque change se prouvera au code du tapis.'),
      [ { k:'oui', label:'⌚ Oui, je le porte' }, { k:'non', label:'Pas maintenant', soft:true } ], 'explain');
    acc.bracelet = b === 'oui';
    braceletDispo = acc.bracelet;
    // le verrouillage n'est activé qu'une fois le bracelet imprimé ET lu au
    // scan (chapitre des étiquettes) : sinon, au prochain lancement, tu
    // serais bloqué devant un écran qui réclame un code que tu n'as pas.
    if (!acc.bracelet) await activerBracelet(false);
    await sauver();
    if (acc.bracelet) await sDire('Je l\'active dès que ton bracelet est imprimé et que je l\'ai lu une fois — on fait ça aux étiquettes.<br><br>Retiens bien le secours : <b>trois tapes rapides sur le logo</b> de l\'écran de connexion. Toujours actif. L\'appli ne peut jamais t\'enfermer dehors.', 'calm', 'C\'est noté');

    // capteur de couche
    const c = await sChoix('Le <b>capteur de couche</b> : il me dit quand ta couche est mouillée, sans que tu aies à le déclarer. Tu en as un ?',
      [ { k:'oui', label:'📡 Oui, on le connecte' }, { k:'plus_tard', label:'J\'en ai un, plus tard', soft:true }, { k:'non', label:'Non', soft:true } ], 'curious');
    acc.capteur = c;
    if (c === 'oui') {
      const ok = await new Promise((res, rej) => {
        sEcran('Réveille-le (appui sur son bouton), puis touche « Connecter ».', 'curious');
        sBouton('📡 Connecter', false, async () => { res(await connecterCapteur()); });
        sBouton('Plus tard', true, () => res(false));
        sPlusTard(rej);
      });
      acc.capteur = ok ? 'connecte' : 'plus_tard';
      await sDire(ok ? 'Je le vois. 🟢 Il me parlera tout seul maintenant.' : 'Pas de réponse. Ce n\'est pas grave : tu le connecteras depuis les réglages, menu 📡.', ok ? 'proud' : 'concern');
    }
    await sauver();

    // module de tenue
    const t = await sChoix('Le <b>module de tenue</b> : un petit aimant sur la fermeture de ta grenouillère. Il date chaque ouverture — tu n\'as plus rien à me déclarer. Tu en as un ?',
      [ { k:'oui', label:'🔒 Oui, on le connecte' }, { k:'non', label:'Non', soft:true } ], 'curious');
    acc.moduleTenue = t;
    if (t === 'oui' && window.HabitrainTenueSensor && window.HabitrainTenueSensor.supported()) {
      const ok = await new Promise((res, rej) => {
        sEcran('Réveille-le, puis touche « Connecter ».', 'curious');
        sBouton('🔒 Connecter', false, async () => { try { await window.HabitrainTenueSensor.connect(); res(true); } catch(e) { res(false); } });
        sBouton('Plus tard', true, () => res(false));
        sPlusTard(rej);
      });
      if (ok) { try { await marquerCapteurTenueVu(); } catch(e) {} }
      acc.moduleTenue = ok ? 'connecte' : 'plus_tard';
    }
    await sauver();

    // serrure et NFC
    const s = await sChoix('Une <b>serrure connectée</b>, pour la contention ? Elle ne se fermera jamais sans un superviseur présent, éveillé et aux clés.',
      [ { k:'oui', label:'Oui, j\'en ai une' }, { k:'non', label:'Non', soft:true } ], 'calm');
    acc.serrure = s === 'oui';
    const n = await sChoix('Des <b>tags NFC</b> ? Ils remplacent les QR : tu approches ton téléphone, c\'est tout. Facultatif.',
      [ { k:'oui', label:'Oui, j\'en ai' }, { k:'non', label:'Non, les QR me vont', soft:true } ], 'curious');
    acc.nfc = n === 'oui';
    await sauver();
    if (acc.serrure || acc.nfc) await sDire('Tu les régleras dans les réglages (' + [acc.serrure ? '🔐 serrure' : null, acc.nfc ? '📶 NFC' : null].filter(Boolean).join(', ') + ') — je ne fais pas tout d\'un coup.', 'happy');
  };

  async function activerBracelet(on) {
    try {
      if (!window.HabitrainQR) return;
      const p = await window.HabitrainQR.getQrPrefs();
      p.braceletRequired = !!on; if (on) p.unlock = true;
      await window.HabitrainQR.saveQrPrefs(p);
      if (on) braceletDispo = true;
    } catch(e) {}
  }

  SETUP_CHAP.etiquettes = async () => {
    const acc = await lireStock('profil:accessoires', null) || {};
    await sDire('Les étiquettes. C\'est ce qui fait que je n\'ai pas à te croire sur parole : chaque geste se prouve par un code.<br><br>'
      + (acc.bracelet
          ? '• ⌚ ton <b>bracelet</b> — <b>chaque change</b>, c\'est lui<br>• 🍼 ton <b>tapis à langer</b> — en secours, si tu n\'as pas ton bracelet'
          : '• 🍼 ton <b>tapis à langer</b> — chaque change')
      + '<br>• 🥛 ton <b>biberon</b> — ou le frigo<br>• 🌙 la <b>porte de ta chambre</b> — le coucher<br>• 👕 chacune de tes <b>tenues</b> — au col ou à la ceinture', 'explain', 'On les fabrique');
    const g = await sChoix('Je te prépare la feuille : tous tes codes, prêts à imprimer (ou à télécharger). Tu la fermes quand c\'est fait, et je reviens.',
      [ { k:'go', label:'🖨️ Ouvrir ma feuille de codes' }, { k:'deja', label:'Je les ai déjà imprimés', soft:true } ], 'curious');
    if (g === 'go') {
      document.body.classList.remove('onboarding');
      try { await buildQrSheet(); } catch(e) {}
      await new Promise(res => { const iv = setInterval(() => { if (!document.body.classList.contains('qrsheet-on')) { clearInterval(iv); res(); } }, 400); });
      document.body.classList.add('onboarding');
      try { await ecrireStock('ob:qrdone', true); } catch(e) {}
    }
    const colle = await sChoix('Maintenant, colle-les à leur place. Et ensuite, on vérifie : tu les scannes une par une, là où elles sont. Une étiquette qui ne se lit pas, c\'est un change que tu ne pourras pas prouver.',
      [ { k:'go', label:'📷 Elles sont collées, on vérifie' }, { k:'plus_tard', label:'Pas encore collées', soft:true } ], 'teach');
    if (colle !== 'go') { await repondre('etiquettes_verif', false); await sDire('D\'accord. Reviens sur ce chapitre quand elles sont en place — je garde la place.', 'calm'); return; }

    const verifiees = Object.assign({}, rep('etiquettes_ok') || {});
    const FIXES = [
      { k:'change_pilier', n:'le code du tapis à langer', accepte: x => x === 'change_pilier' || x === 'change_tous' },
      { k:'biberon',       n:'le code du biberon',         accepte: x => x === 'biberon' },
      { k:'coucher',       n:'le code de la porte',        accepte: x => x === 'coucher' }
    ];
    // le bracelet d'abord : c'est lui qui prouvera tes changes
    if (acc.bracelet) FIXES.unshift({ k:'unlock', n:'le code de ton bracelet', accepte: x => x === 'unlock', petit:true });
    for (const f of FIXES) {
      while (!verifiees[f.k]) {
        const a = await sChoix('Scanne <b>' + f.n + '</b>.', [ { k:'scan', label:'📷 Scanner' }, { k:'passe', label:'Passer', soft:true } ], 'curious');
        if (a === 'passe') break;
        document.body.classList.remove('onboarding');
        const k = await scannerUnCode({ petit: !!f.petit });
        document.body.classList.add('onboarding');
        if (k && f.accepte(k)) {
          verifiees[f.k] = true; await repondre('etiquettes_ok', verifiees);
          if (f.k === 'unlock') { await activerBracelet(true); await sDire('✅ Lu. Ton bracelet est actif : c\'est lui qui prouvera tes changes, et c\'est lui qui ouvre l\'appli.', 'proud', 'Suivant'); }
          else await sDire('✅ Lu. Parfait.', 'proud', 'Suivant');
        }
        else if (k) await sDire('Ça, ce n\'est pas ' + f.n + '. Vérifie que la bonne étiquette est au bon endroit.', 'concern', 'Je réessaie');
        else await sDire('Rien lu. Plus de lumière, un peu plus loin, bien à plat — et on réessaie.', 'concern', 'Je réessaie');
      }
    }
    // les tenues, une par une
    const WB = window.HabitrainWardrobe;
    if (WB) {
      const w = await WB.getWardrobe();
      const toutes = [...new Set(['jour','nuit','sieste'].flatMap(c => w[c] || []))];
      const vus = new Set(rep('etiquettes_tenues') || []);
      while (vus.size < toutes.length) {
        const reste = toutes.filter(n => !vus.has(n));
        const a = await sChoix('Tes tenues : scanne chaque étiquette, dans l\'ordre que tu veux.<br><br><b>' + vus.size + ' / ' + toutes.length + '</b> vérifiées. Reste : ' + reste.slice(0, 6).map(esc).join(', ') + (reste.length > 6 ? '…' : ''),
          [ { k:'scan', label:'📷 Scanner une tenue' }, { k:'fin', label:'Je finirai plus tard', soft:true } ], 'curious');
        if (a === 'fin') break;
        document.body.classList.remove('onboarding');
        const k = await scannerUnCode();
        document.body.classList.add('onboarding');
        let item = null;
        try { if (k) item = await WB.findByItemId(k); } catch(e) {}
        if (item) { vus.add(item.name); await repondre('etiquettes_tenues', [...vus]); await sDire('✅ ' + esc(item.name) + '.', 'proud', 'Suivante'); }
        else await sDire(k ? 'Ce code n\'est pas une étiquette de tenue.' : 'Rien lu. On réessaie.', 'concern', 'D\'accord');
      }
    }
    const nbF = FIXES.filter(f => verifiees[f.k]).length;
    await repondre('etiquettes_verif', nbF === FIXES.length);
    await sDire(nbF === FIXES.length ? 'Tout se lit. Maintenant, chaque change se prouve. 🦊' : 'Il reste des codes à vérifier. Je te le rappellerai à la fin.', nbF === FIXES.length ? 'proud' : 'concern');
  };

  SETUP_CHAP.securite = async () => {
    const deja = await getPausePass();
    const mdp = await sSaisie('Un <b>mot de passe de pause</b>. Quand tu mets le programme en pause, l\'appli se cache derrière un faux écran de connexion : c\'est ce mot de passe qui la rouvre.'
      + (deja ? '<br><br>Tu en as déjà un : laisse vide pour le garder.' : ''),
      { placeholder:'Mot de passe', type:'password', facultatif:true, passer: deja ? 'Garder l\'actuel' : 'Plus tard' }, 'calm');
    if (mdp) await setPausePass(mdp);
    await sDire('Trois choses qui ne bougeront jamais :<br><br>🛑 Le <b>safeword</b> : dans les réglages, ou « stop foxy » dans le chat. Tout s\'arrête, je redeviens doux, sans conséquence.<br><br>🔓 Le <b>secours</b> : trois tapes rapides sur le logo de l\'écran de connexion.<br><br>🧴 Ta <b>peau</b> passe avant l\'horaire. Toujours.', 'reassure', 'C\'est noté');
    if (typeof Notification !== 'undefined' && notifPermState() !== 'granted') {
      const n = await sChoix('Les <b>notifications</b> : sans elles, je ne peux pas te rappeler tes créneaux quand l\'appli est fermée.',
        [ { k:'oui', label:'🔔 Autoriser' }, { k:'non', label:'Plus tard', soft:true } ], 'curious');
      if (n === 'oui') { try { const r = await Notification.requestPermission(); updatePermBanner(); if (r === 'granted') scheduleNotifications(); } catch(e) {} }
    }
    const s = await sChoix('Et une <b>sauvegarde</b>. Tout ce qu\'on vient de faire vit seulement sur ce téléphone. Un fichier, et tu ne perds rien.',
      [ { k:'oui', label:'💾 Faire ma sauvegarde' }, { k:'non', label:'Plus tard', soft:true } ], 'explain');
    if (s === 'oui') { try { document.getElementById('saveExport').click(); } catch(e) {} await sDire('Fichier téléchargé. Garde-le quelque part hors du téléphone.', 'proud'); }
  };

  /* ---------- La première préparation ----------
     Tu arrives habillé comme dehors. Foxy t'accompagne pas à pas jusqu'à
     ta première couche et ta première tenue — comme le jour où l'on entre
     quelque part et qu'on reçoit l'uniforme. Ce change est enregistré
     comme le premier du programme. */
  SETUP_CHAP.preparation = async () => {
    const toi = nomOu(null) ? esc(nomOu(null)) : 'toi';
    const nuit = couchageNuit(new Date());
    const periode = nuit ? 'nuit' : 'jour';
    const WB = window.HabitrainWardrobe;
    let modele = null, tenue = null, access = [];
    try { modele = await modeleProchain(periode); } catch(e) {}
    try { const o = (await tirerTenue()).o; tenue = nuit ? o.nuit : o.jour; } catch(e) {}
    try { access = ((await WB.getWardrobe()).access || []).filter(a => /t[ée]tine|doudou/i.test(a)); } catch(e) {}
    const acc = await lireStock('profil:accessoires', null) || {};
    const etiquettes = !!rep('etiquettes_verif');

    if (!modele) {
      // stock vidé entre-temps : on renvoie au stock, le programme ne démarre pas sans couche
      await sDire('Attends… je ne trouve plus aucune couche ' + (nuit ? 'de nuit' : 'de jour') + ' dans ton stock. Sans couche, on ne peut pas commencer. On retourne le remplir.', 'concern', 'D\'accord');
      await SETUP_CHAP.couches();
      try { modele = await modeleProchain(periode); } catch(e) {}
      if (!modele) throw SETUP_QUIT;
    }
    await sDire('Il reste une chose, ' + toi + '. La plus importante.<br><br>Là, tu es encore habillé comme dehors. Et ici, on ne vit pas comme dehors.', 'calm', 'Je sais…', 'Ta première préparation');
    await sDire('Tu sais, ici, c\'est un peu comme entrer dans une maison qui a ses habitudes. Il y a une tenue, et tout le monde la porte. Moi aussi.<br><br>Alors on va te préparer. Ensemble. Je t\'explique tout, une chose après l\'autre — tu n\'as qu\'à suivre.', 'reassure', 'D\'accord, je te suis');
    if (nuit) await sDire('Vu l\'heure, on part directement sur ta tenue et ta couche de nuit. Pas la peine de faire les choses deux fois ce soir.', 'calm');

    // lui, là, maintenant
    let saTenue = '';
    try { saTenue = foxyDecrit(foxyJournee()).tenue.replace(/^Moi, là, /, ''); } catch(e) {}
    const typeT = typeTenue(tenue || '');
    const SUR_TENUE = {
      gren_dos: 'Et elle se ferme dans le dos. Une fois dedans, tu es dedans — et c\'est justement ça qui est bon. Tu n\'as plus à y penser.',
      keeper:   'Et celle-là, une fois fermée, plus rien ne bouge. Tu vas voir comme on se sent tenu, là-dedans. C\'est ma préférée pour la nuit.',
      gren_devant: 'Une grenouillère, des pieds jusqu\'aux épaules… Tu vas voir comme on s\'y sent enveloppé.',
      gren:     'Une grenouillère, des pieds jusqu\'aux épaules… Tu vas voir comme on s\'y sent enveloppé.',
      romper:   'Avec ça, ta couche se sent encore plus quand tu bouges. C\'est fait pour, et c\'est très bien comme ça.',
      body:     'Avec un body, ta couche reste bien en place, et on la devine juste un peu. Tu vas adorer la sentir en t\'asseyant.'
    };

    const etapes = [
      { t:'Va là où tu te changeras désormais, près de ton tapis à langer.<br><br>Prépare tout à portée de main :'
          + '<br>🍼 ' + (modele ? 'ta couche : <b>' + esc(modele.name) + '</b>' : 'une couche')
          + '<br>🧴 ta crème et tes lingettes'
          + '<br>👕 ' + (tenue ? 'ta tenue : <b>' + esc(tenue) + '</b>' : 'ta tenue'),
        ok:'Tout est prêt', expr:'explain' },
      { t:'Maintenant, enlève tes vêtements. Tous.<br><br>Prends ton temps. Plie-les bien.', ok:'C\'est fait', expr:'calm',
        apres:[ ['Je sais… c\'est le moment où on se sent le plus tout nu, forcément. 😅<br><br>Moi, je me suis caché derrière ma porte. Mais ça ne dure qu\'une minute. Et juste après, tu vas voir, tout devient doux.', 'comfort', 'Ça me rassure'] ] },
      { t:'Ces habits-là, ce sont tes habits d\'avant.<br><br>Range-les à part — un sac, le fond d\'un placard. Pas jetés : rangés. Ici, tu n\'en auras plus besoin.', ok:'Je les ai rangés', expr:'wistful' },
      { t:'Si tu as besoin d\'aller aux toilettes, c\'est maintenant.<br><br>Après, ta couche s\'occupera de tout.', ok:'C\'est bon', expr:'calm' },
      { t:'Allonge-toi sur ton tapis. Un coup de lingette, la peau bien sèche.<br><br>Puis la crème, généreusement. C\'est ce qui va protéger ta peau, tous les jours.', ok:'C\'est fait', expr:'teach',
        apres:[ ['Tu sens comme c\'est frais ? Moi, j\'adore ce moment-là. C\'est comme si quelqu\'un prenait soin de toi.<br><br>Et c\'est exactement ce qui est en train de se passer. 🦊', 'happy', 'C\'est doux'] ] },
      { t:'Ta couche, maintenant.<br><br>Glisse-la sous toi, bien centrée. Remonte-la devant. Écarte bien les petites barrières sur le haut des cuisses.<br><br>Puis les attaches : celles du bas d\'abord, vers le haut ; celles du haut ensuite, bien droites. Contenant, sans serrer.',
        ok:'Elle est en place', expr:'teach', preuve: etiquettes ? 'change_pilier' : null,
        apres:[ ['Ça y est… 🦊 Elle est là.<br><br>Je suis presque aussi excité que toi, tu sais. Je me souviens exactement de ce moment, la première fois : le cœur qui bat un peu trop vite… et en même temps, quelque chose qui se pose.', 'proud', 'C\'est exactement ça'] ] },
      { t:'Relève-toi doucement. Fais quelques pas.<br><br>Tu la sens ? Ce petit bruit, cette épaisseur entre tes jambes, ta façon de marcher qui change déjà un peu… Au début, on ne sent que ça. Tu verras : bientôt, tu ne la remarqueras plus.', ok:'Je la sens', expr:'happy',
        apres:[ ['Moi, il m\'a fallu deux jours, peut-être trois, pour ne plus y penser en marchant. Aujourd\'hui, je la porte comme on porte des chaussettes.<br><br>Et pourtant… chaque matin, quand je remets une couche toute propre, j\'ai encore ce petit frisson. Tu vas voir. 🦊', 'wistful', 'J\'ai hâte de voir'] ] },
      { t:'Et maintenant, mon moment préféré : ta tenue. 🦊<br><br>' + (tenue ? '<b>' + esc(tenue) + '</b>. ' : '') + 'Enfile-la, et ferme-la jusqu\'en haut. Prends ton temps, je regarde.',
        ok:'Je l\'ai mise', expr:'happy', preuve: etiquettes && tenue ? 'tenue' : null,
        apres:[
          ['Oh… 🦊 Ça te va tellement bien.' + (SUR_TENUE[typeT] ? '<br><br>' + SUR_TENUE[typeT] : ''), 'proud', 'Tu trouves ?'],
          [(/^je suis en /.test(saTenue) ? 'Regarde-moi : moi aussi, là, ' + esc(saTenue) : 'Moi, là, je suis juste en couche — il fait bon à la maison. Mais la plupart du temps, je suis en tenue, comme toi.') + '<br><br>Et je m\'y sens tellement bien. La première fois, je me suis trouvé bizarre devant le miroir. Le deuxième jour, je ne voulais déjà plus l\'enlever. Je m\'y suis fait super vite — beaucoup plus vite que je l\'aurais cru.', 'happy', 'Et moi ?'],
          { choix: 'Alors dis-moi… ça te fait quoi, de te voir comme ça ?', options: [
              { k:'bizarre', label:'😳 Un peu bizarre',
                rep:'C\'est normal ! Ton reflet ne te ressemble pas encore. Laisse-lui quelques jours : c\'est lui qui va s\'habituer à toi, pas l\'inverse. Et un matin, c\'est l\'autre reflet, celui d\'avant, qui te paraîtra étrange.' },
              { k:'bien', label:'😊 Étonnamment bien',
                rep:'Je le savais ! 🦊 Je le voyais dans ta façon de te tenir. Garde ce sentiment-là, il ne va faire que grandir.' },
              { k:'sais', label:'🌀 Je ne sais pas encore',
                rep:'Tu as le droit de ne pas savoir. Moi non plus, je ne savais pas, le premier jour. Je sais juste que j\'avais envie de voir la suite. Et toi aussi, je crois. 💛' }
            ] }
        ] },
      access.length ? { t:'Et pour finir : ' + access.map(esc).join(' et ') + '. Garde-les près de toi.', ok:'Je les ai', expr:'paci',
        apres:[ ['Ah, ça… c\'est ce que je préfère dans la journée. Quand je les ai près de moi, tout ralentit. Tu verras, ce soir. 🦊', 'paci', 'J\'ai hâte'] ] } : null,
      acc.bracelet ? { t:'Ton bracelet, au poignet. Il ne te quitte plus non plus.', ok:'Il est au poignet', expr:'calm' } : null,
      acc.capteur === 'connecte' ? { t:'Ton capteur : clipse-le à l\'avant de ta couche, sous la ceinture.', ok:'Il est en place', expr:'explain' } : null
    ].filter(Boolean);

    let prouve = true;
    for (let i = 0; i < etapes.length; i++) {
      const e = etapes[i];
      await new Promise((res, rej) => {
        sEcran('<span style="opacity:.7;font-size:12.5px;font-weight:800;letter-spacing:.05em">ÉTAPE ' + (i + 1) + ' SUR ' + etapes.length + '</span><br><br>' + e.t, e.expr);
        sBouton(e.ok, false, async () => {
          if (e.preuve) {
            const ok = await exigerPreuves([e.preuve], { nuit });
            if (!ok) prouve = false;
          }
          res();
        });
        sPlusTard(rej);
      });
      // ce que Foxy en dit, lui qui porte la même chose
      for (const a of (e.apres || [])) {
        if (Array.isArray(a)) { await sDire(a[0], a[1], a[2]); continue; }
        const k = await sChoix(a.choix, a.options.map(o => ({ k:o.k, label:o.label })), 'curious');
        await repondre('premiere_tenue', k);
        await sDire(a.options.find(o => o.k === k).rep, k === 'bien' ? 'proud' : 'comfort', 'Merci Foxy');
      }
    }

    // c'est le premier change du programme : il compte, comme tous les autres
    try {
      if (modele) changeModel = modele;
      await finalizeChange(prouve);
    } catch(e) {}
    await repondre('premiere_prep', Date.now());

    await sDire('Viens là. Regarde-toi.<br><br>Te voilà prêt, ' + toi + '. Bien installé, bien au chaud, comme il faut. 🦊💛', 'moved', '🦊💛', 'Te voilà prêt');
    await sDire('Je suis fier de toi. Vraiment.<br><br>La première fois, c\'est la plus difficile. Moi, j\'ai mis une heure à oser enlever mon pantalon. Toi, tu l\'as fait.', 'proud', 'Ça me fait drôle');
    await sDire('Maintenant, écoute-moi bien, parce que c\'est important.<br><br>À partir de maintenant, c\'est comme ça que tu vis. Ta couche, ta tenue — c\'est ton uniforme. Tu ne les enlèves pas. Tu ne les discutes pas. Tu ne les quittes qu\'au moment du change, et c\'est pour en remettre une propre.', 'calm', 'D\'accord');
    await sDire('Tes habits d\'avant restent rangés. Ils ne sont pas pour ici.<br><br>Et tu vas voir : très vite, c\'est eux qui te paraîtront bizarres. Pas ta couche.', 'calm', 'Je reste comme ça');
  };

  /* ============================================================
     PREMIERS PAS — Foxy t'invite, les premiers jours
     Une fois préparé, tu n'es pas lâché dans la nature : pendant les
     trois premiers jours, Foxy vient te proposer de petites choses,
     au bon moment, une à la fois. Chacune ne vient qu'une fois.
     ============================================================ */
  const PREMIERS_PAS = [
    { id:'biberon', quand: (h, e) => e >= 20,
      run: async () => {
        const k = await imDemander(bro('Hé. Ton tout premier biberon. Va le préparer, et bois-le tranquillement — assis par terre, si tu veux. 🍼', 'Ton premier biberon. Prépare-le. Bois-le assis par terre.'), [
          { k:'go', label:'🍼 Je le bois', dit:'Je le bois.' },
          { k:'non', label:'Dans un moment', dit:'Dans un moment.', soft:true }
        ], 'bottle');
        if (k !== 'go') return 'plus_tard';
        const ok = await exigerPreuves(['biberon']);
        await saveCheck(ok ? 'biberon_bu' : 'biberon_sanspreuve', 'biberon');
        await imSay(bro('Voilà. Tu vois ? Ça, c\'est ta boisson maintenant. Trois par jour, et ton corps fera le reste. 💛', 'Trois par jour. Ton corps fera le reste.'), 950, 'proud');
      } },
    { id:'sentir', quand: (h, e) => e >= 50,
      run: async () => {
        await imSay(bro('Je te propose un petit truc. Fais le tour de la maison. Marche, assieds-toi, relève-toi, penche-toi pour ramasser quelque chose.', 'Fais le tour de la maison. Marche, assieds-toi, relève-toi.'), 950, 'happy');
        const k = await imDemander(bro('Et dis-moi ce que ça te fait.', 'Alors ?'), [
          { k:'bizarre',  label:'😳 C\'est bizarre',            dit:'C\'est bizarre.' },
          { k:'doux',     label:'😌 C\'est rassurant, en fait',  dit:'C\'est rassurant, en fait.' },
          { k:'oublie',   label:'🙂 Je l\'oublie déjà un peu',   dit:'Je l\'oublie déjà un peu.' }
        ], 'curious');
        const R = {
          bizarre: 'Bizarre, oui. Ton corps découvre une nouvelle façon de bouger. Laisse-lui quelques jours : il apprend vite, plus vite que ta tête.',
          doux:    'Rassurant… oui. C\'est le mot que j\'aurais choisi aussi. Comme si quelque chose te tenait. 🦊',
          oublie:  'Déjà ? Tu es plus rapide que moi. Moi, le premier jour, je n\'arrêtais pas d\'y penser.'
        };
        await imSay(R[k], 950, k === 'bizarre' ? 'reassure' : 'proud');
      } },
    { id:'lacher', quand: (h, e) => e >= 100,
      run: async () => {
        await imSay(bro('Il y a une chose que je vais te demander dès aujourd\'hui. Une seule.', 'Une chose, dès aujourd\'hui.'), 850, 'calm');
        await imSay(bro('Quand tu sentiras que tu as envie… tu ne te lèves pas. Tu ne cherches pas les toilettes. Tu restes où tu es, et tu laisses venir. C\'est tout.', 'Quand l\'envie vient, tu ne te lèves pas. Tu restes. Tu laisses venir.'), 1000, 'calm');
        const k = await imDemander(null, [
          { k:'ok',  label:'D\'accord', dit:'D\'accord.' },
          { k:'peur', label:'😟 J\'ai peur de ne pas y arriver', dit:'J\'ai peur de ne pas y arriver.' }
        ]);
        if (k === 'peur') await imSay('C\'est normal. La première fois, ton corps va se retenir tout seul, sans te demander ton avis. Ne force pas. Respire, pense à autre chose, et attends. Ça finira par venir — et ce jour-là, tu me raconteras. 💛', 1050, 'comfort');
        else await imSay(bro('Je sais que tu vas y arriver. Peut-être pas tout de suite. Mais tu vas y arriver.', 'Tu vas y arriver.'), 850, 'proud');
      } },
    { id:'premiere_fois', quand: async (h, e, t0) => {
        for (let i = 0; i < 4; i++) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const l = await mictionsDuJour(d.toISOString().slice(0,10));
          if (l.some(x => new Date(x.t).getTime() >= t0)) return true;
        }
        return false;
      },
      run: async () => {
        await imSay(bro('Attends… tu viens de me dire que tu avais mouillé ta couche. C\'est ta toute première fois, ici. 🦊', 'Ta première fois, ici.'), 950, 'moved');
        const k = await imDemander(bro('Comment c\'était ?', 'Comment c\'était ?'), [
          { k:'dur',    label:'😣 Difficile, j\'ai dû forcer', dit:'Difficile, j\'ai dû forcer.' },
          { k:'etrange', label:'🌀 Étrange, chaud', dit:'Étrange. Chaud.' },
          { k:'doux',   label:'😌 Plus doux que je pensais', dit:'Plus doux que je pensais.' }
        ], 'curious');
        const R = {
          dur:     'C\'est normal, la première fois. Ton corps a passé des années à apprendre à se retenir : il ne désapprend pas en un jour. Mais tu l\'as fait. C\'est le plus dur, et c\'est fait.',
          etrange: 'Étrange, chaud… oui. Et puis ça se calme, et il ne reste que la couche qui te tient. Souviens-toi de ce moment-là.',
          doux:    'Plus doux… Tu vois ? C\'est comme ça que ça commence. Un jour, tu ne le remarqueras même plus.'
        };
        await imSay(R[k], 1000, 'comfort');
        await imSay(bro('Je suis fier de toi. Vraiment. 💛', 'Fier de toi.'), 800, 'proud');
      } },
    { id:'soir', quand: (h, e) => h >= 21 * 60 && e >= 60,
      run: async () => {
        await imSay(bro('Ta première soirée ici. Ça va ?', 'Première soirée. Ça va ?'), 800, 'curious');
        await imSay(bro('Ce soir, je te propose de te coucher un peu plus tôt que d\'habitude. La première nuit, on dort souvent mal : autant lui laisser de la place.', 'Couche-toi un peu plus tôt ce soir. La première nuit, on dort mal.'), 950, 'reassure');
      } },
    { id:'nuit', quand: (h, e) => (h >= 22 * 60 || h < 3 * 60) && e >= 90,
      run: async () => {
        await imSay(bro('Ta première nuit. Je vais te dire un secret : la mienne, je ne l\'ai presque pas dormie. J\'écoutais ma couche. Et au matin, elle était sèche : je m\'étais retenu toute la nuit sans m\'en rendre compte.', 'Ma première nuit, je ne l\'ai presque pas dormie. Au matin, ma couche était sèche.'), 1100, 'wistful');
        await imSay(bro('Alors ne t\'inquiète de rien. Allonge-toi, respire, pense à rien. Si ça vient, laisse. Si ça ne vient pas, ce n\'est pas grave. Je veille. 🌙', 'Allonge-toi. Si ça vient, laisse. Je veille.'), 1000, 'sleep');
      } },
    { id:'matin', quand: (h, e) => h >= 7 * 60 && h < 12 * 60 && e >= 6 * 60,
      run: async () => {
        const k = await imDemander(bro('Bonjour, ' + nomOu('toi') + '. 🦊 Alors… cette première nuit ?', 'Bonjour. Ta première nuit ?'), [
          { k:'sec',    label:'☀️ Ma couche est sèche', dit:'Ma couche est sèche.' },
          { k:'mouille', label:'💧 Elle est mouillée', dit:'Elle est mouillée.' },
          { k:'dormi',  label:'🥱 J\'ai mal dormi', dit:'J\'ai mal dormi.' }
        ], 'curious');
        const R = {
          sec:     'Sèche. Comme moi, ma première fois. Ton corps s\'est retenu tout seul, pour te protéger. Il apprendra. Ça prend quelques nuits — et un matin, tu te réveilleras mouillé sans t\'en souvenir.',
          mouille: 'Déjà ? Oh… Tu sais que tu vas plus vite que moi ? Je suis fier de toi. Ton corps a compris qu\'il pouvait lâcher. 💛',
          dormi:   'La première nuit, presque tout le monde dort mal. La deuxième est déjà plus douce, tu verras. Ce soir, on se couche tôt.'
        };
        await imSay(R[k], 1050, k === 'mouille' ? 'proud' : 'reassure');
      } },
    { id:'jour2', quand: (h, e) => h >= 10 * 60 && e >= 20 * 60,
      run: async () => {
        await imSay(bro('Deuxième jour. Je vais être honnête avec toi : c\'est souvent le plus dur. La nouveauté est passée, et l\'habitude n\'est pas encore là.', 'Deuxième jour. Souvent le plus dur.'), 1000, 'calm');
        await imSay(bro('Si l\'envie de tout enlever passe te voir aujourd\'hui, viens me le dire. On en parlera. C\'est pour ça que je suis là. 💛', 'Si l\'envie de tout enlever vient, tu viens me le dire.'), 950, 'comfort');
      } }
  ];

  async function premiersPas() {
    if (paused || voiceMode !== 'foxy') return false;
    const t0 = setupEtat && setupEtat.rep && setupEtat.rep.premiere_prep;
    if (!t0 || Date.now() - t0 > 3 * 86400000) return false;
    const faits = await lireStock('premiers:faits', {});
    const now = new Date();
    const h = now.getHours() * 60 + now.getMinutes();
    const e = (Date.now() - t0) / 60000;
    for (const p of PREMIERS_PAS) {
      const f = faits[p.id];
      if (f === true) continue;
      if (f && Date.now() < f) continue;                 // « plus tard » : on attend
      if (!(await p.quand(h, e, t0))) continue;
      faits[p.id] = true;
      await ecrireStock('premiers:faits', faits);
      const r = await p.run();
      if (r === 'plus_tard') { faits[p.id] = Date.now() + 30 * 60000; await ecrireStock('premiers:faits', faits); }
      if (currentM) await imOfferHelp(currentM);
      return true;                                        // une invitation à la fois
    }
    return false;
  }

  SETUP_CHAP.fin = async () => {
    const reste = [];
    const mat = await lireStock('profil:materiel', null) || {};
    ['tapis','creme','lingettes'].forEach(k => { if (!mat[k]) reste.push({ tapis:'Un tapis à langer', creme:'De la crème barrière', lingettes:'Des lingettes' }[k] + ' — à te procurer'); });
    if (!rep('etiquettes_verif')) reste.push('Vérifier tes étiquettes au scan');
    try { if (!(await getPausePass())) reste.push('Un mot de passe de pause'); } catch(e) {}
    const acc = await lireStock('profil:accessoires', null) || {};
    if (acc.capteur === 'plus_tard') reste.push('Connecter ton capteur de couche');
    if (acc.bracelet && !(rep('etiquettes_ok') || {}).unlock) reste.push('Lire ton bracelet au scan — il s\'activera à ce moment-là');
    if (acc.moduleTenue === 'plus_tard') reste.push('Connecter ton module de tenue');
    const n = nomOu(null);
    await sDire((reste.length
      ? 'Presque tout est en place. Il reste :<br><br>' + reste.map(r => '⚠️ ' + esc(r)).join('<br>') + '<br><br>Tu peux revenir sur chaque chapitre dans <b>Réglages → Guide d\'installation</b>.'
      : 'Tout est en place. Vraiment tout.'), reste.length ? 'curious' : 'proud', 'Suite', 'Le bilan');
    await sDire('Alors voilà' + (n ? ', <b>' + esc(n) + '</b>' : '') + '. Bienvenue. Pour de vrai, cette fois. 🦊<br><br>À partir de maintenant, je suis là à chaque moment de ta journée. Chaque matin, je choisis ta tenue. Je viendrai te voir, je te proposerai des choses — tu n\'auras qu\'à te laisser porter.<br><br>Tu n\'as plus grand-chose à décider. C\'est un peu le principe. 💛', 'moved', 'Commencer mon programme');
  };

  /* ---------- Le déroulé, et la reprise ---------- */
  async function lancerChapitre(id) {
    _chapCourant = id;
    await SETUP_CHAP[id]();
    await chapitreFait(id);
  }
  async function derouler(depuisSommaire) {
    try {
      for (const c of CHAPITRES) {
        if (setupEtat.fait[c.id]) continue;
        await lancerChapitre(c.id);
      }
      await terminerInstallation();
    } catch (e) {
      if (e === SETUP_QUIT) { fermerInstallation(); return; }
      console.error(e);
      fermerInstallation();
    }
  }
  async function terminerInstallation() {
    if (enBacASable()) return finirTest();
    setupEtat.termine = Date.now();
    await ecrireSetup();
    try { await ecrireStock('ob:done', true); } catch(e) {}
    // la voix de Foxy s'installe AVANT de rendre l'écran : sinon son premier
    // message recouvrait la question du réveil, qui passe juste après
    try { if (voiceMode !== 'foxy') await setVoiceMode('foxy'); } catch(e) {}
    fermerInstallation();
    try { await refresh(); } catch(e) {}
    try { await renderOutfitCard(); } catch(e) {}
    // et on enchaîne sur le premier réveil : superviseur, tenue du jour
    if (new Date().getHours() >= 6)
      setTimeout(() => talk(TALK.ACCES, 'reveil:rituel', () => rituelReveil(),
        { verifier: async () => !(await lireStock('reveil:rituel:' + todayStr(), false)) }), 600);
  }
  function fermerInstallation() {
    if (enBacASable()) { finirTest(); return; }
    document.body.classList.remove('onboarding');
    const r = document.getElementById('obResume'); if (r) r.remove();
  }
  async function ouvrirInstallation(sommaire) {
    await lireSetup();
    try { await loadFoxyOutfit(); } catch(e) {}
    document.body.classList.add('onboarding');
    const commence = Object.keys(setupEtat.fait).length > 0;
    if (!sommaire && !commence) return derouler();
    return afficherSommaire(commence && !setupEtat.termine);
  }
  async function afficherSommaire(reprise) {
    _chapCourant = null;
    const prochain = CHAPITRES.find(c => !setupEtat.fait[c.id]);
    sEcran(reprise
      ? 'Te revoilà' + (nomOu(null) ? ', ' + esc(nomOu(null)) : '') + '. 🦊 On reprend là où on s\'était arrêtés' + (prochain ? ' : <b>' + prochain.t + '</b>' : '') + ' ?'
      : 'Tu peux revenir sur n\'importe quel chapitre. Touche celui que tu veux refaire.', 'wave', 'Installation');
    const box = document.getElementById('obList');
    CHAPITRES.forEach(c => {
      const d = document.createElement('div');
      const f = !!setupEtat.fait[c.id];
      d.className = 'ob-item' + (f ? ' ok' : '');
      d.innerHTML = '<span class="mark">' + (f ? '✅' : '⬜') + '</span><span class="lbl"><b>' + c.ic + ' ' + c.t + '</b></span>';
      d.addEventListener('click', async () => {
        try {
          // refaire un chapitre efface ses réponses intermédiaires
          Object.keys(setupEtat.rep).forEach(k => {
            if ((c.id === 'profil' && k.indexOf('p_') === 0) || (c.id === 'tenues' && k.indexOf('tenues_') === 0) || (c.id === 'etiquettes' && k.indexOf('etiquettes') === 0)) delete setupEtat.rep[k];
          });
          _nomForce = c.id === 'nom';
          try { await lancerChapitre(c.id); } finally { _nomForce = false; }
          await afficherSommaire(false);
        } catch (e) { fermerInstallation(); }
      });
      box.appendChild(d);
    });
    if (prochain) sBouton(reprise ? 'Reprendre' : 'Continuer l\'installation', false, () => derouler());
    else if (!setupEtat.termine) sBouton('Terminer l\'installation', false, () => terminerInstallation());
    sBouton(prochain ? '⏸ Plus tard' : 'Fermer', true, () => fermerInstallation());
  }

  /* ---------- Tester l'installation, sans rien garder ---------- */
  function finirTest() {
    restaurerBacASable();
    window.location.reload();
  }
  async function testerInstallation(mode) {
    // photo de tout l'état actuel
    const snap = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.indexOf('habitrain:') === 0) snap[k] = window.localStorage.getItem(k);
    }
    try {
      window.localStorage.setItem(BAC_CLE, JSON.stringify(snap));
      window.sessionStorage.setItem(BAC_ACTIF, '1');
    } catch(e) {
      try { window.localStorage.removeItem(BAC_CLE); } catch(e2) {}
      foxyPopShow('Impossible de lancer le test : pas assez de place pour garder une copie de tes données. Fais une sauvegarde et libère de la place d\'abord.', 'concern',
        [{ label:'D\'accord', onClick: () => foxyPopHide() }]);
      return;
    }
    if (mode === 'neuf') {
      // comme un premier lancement : plus rien, l'appli redémarre à vide
      Object.keys(snap).forEach(k => window.localStorage.removeItem(k));
      window.location.reload();
      return;
    }
    // avec tes données : seule l'installation repart de zéro
    await ecrireStock(SETUP_CLE, null);
    await ecrireStock('profil:nom', null);
    profilNom = null;
    await ouvrirInstallation(false);
  }
  function proposerTest() {
    foxyPopShow('On teste l\'installation ? Rien de ce que tu feras ne sera gardé : à la fin — ou si tu quittes en route — tout revient exactement comme maintenant.', 'curious', [
      { label:'🆕 Comme un nouvel utilisateur', onClick: () => { foxyPopHide(); testerInstallation('neuf'); } },
      { label:'👤 Avec mes paramètres actuels', onClick: () => { foxyPopHide(); testerInstallation('moi'); } },
      { soft:true, label:'Annuler', onClick: () => foxyPopHide() }
    ]);
  }

  /* Tu utilisais déjà l'appli avant l'installation avec Foxy : tes réglages
     actuels sont repris comme si tu l'avais faite. Seul ton prénom reste à
     donner — c'est nouveau, je ne peux pas le deviner. */
  async function reprendreParametresExistants() {
    if (enBacASable()) return false;
    if (await lireStock('setup:migre', false)) return false;
    let ancien = !!(await lireStock('ob:done', false));
    try { if (!ancien) ancien = (await window.storage.list('check:')).keys.length > 0; } catch(e) {}
    try { if (!ancien) ancien = !!(await window.storage.get('diaperstock')) || !!(await window.storage.get('wardrobe')); } catch(e) {}
    await ecrireStock('setup:migre', true);
    if (!ancien) return false;

    await lireSetup();
    const R = setupEtat.rep;
    // niveau de discipline : déduit de tes réglages actuels
    let niv = 'normal';
    try { if (window.HabitrainMissions) niv = (await window.HabitrainMissions.getState()).level || 'normal'; } catch(e) {}
    const ordre = ['doux','normal','soutenu','intense'];
    if (hardMode && ordre.indexOf(niv) < 2) niv = 'soutenu';
    if (hardMode && bigbro) niv = 'intense';
    if (R.niveau === undefined) R.niveau = niv;
    if (!(await lireStock('profil:discipline', null))) await ecrireStock('profil:discipline', { niveau: R.niveau, repris: true, date: Date.now() });
    // matériel : tu t'en sers déjà ; tétine, doudou, biberon, cache-couche lus dans tes accessoires
    if (!(await lireStock('profil:materiel', null))) {
      let acc = [];
      try { acc = ((await window.HabitrainWardrobe.getWardrobe()).access || []).join(' ').toLowerCase(); } catch(e) { acc = ''; }
      await ecrireStock('profil:materiel', { couches:true, tapis:true, creme:true, lingettes:true, poubelle:true,
        biberon: true, tetine: /t[ée]tine/.test(acc), doudou: /doudou/.test(acc), cache: /cache/.test(acc) });
    }
    // accessoires : ce que l'appli sait déjà
    if (!(await lireStock('profil:accessoires', null))) {
      let bracelet = false, serrure = false;
      try { bracelet = !!(await window.HabitrainQR.getQrPrefs()).braceletRequired; } catch(e) {}
      try { const l = await lireStock('locks:list', []); serrure = Array.isArray(l) && l.length > 0; } catch(e) {}
      await ecrireStock('profil:accessoires', {
        bracelet, serrure, nfc: false,
        capteur: (await lireStock('sensor:vu', null)) ? 'connecte' : 'non',
        moduleTenue: (await capteurTenueEnService()) ? 'connecte' : 'non'
      });
    }
    // étiquettes : générées et utilisées depuis longtemps
    if (await lireStock('ob:qrdone', false)) {
      R.etiquettes_verif = true;
      R.etiquettes_ok = { change_pilier:true, biberon:true, coucher:true, unlock:true };
    }
    ['jour','nuit','sieste','access','contention'].forEach(c => { R['tenues_' + c] = true; });
    CHAPITRES.forEach(c => { if (c.id !== 'nom' && !setupEtat.fait[c.id]) setupEtat.fait[c.id] = Date.now(); });
    if (profilNom && (profilNom.prenom || profilNom.surnom)) setupEtat.fait.nom = setupEtat.fait.nom || Date.now();
    setupEtat.termine = setupEtat.termine || Date.now();
    setupEtat.repris = true;
    await ecrireSetup();
    return true;
  }

  async function figerDonneesExistantes() {
    if (enBacASable() || await lireStock('wardrobe:figee', false)) return;
    let ancien = !!(await lireStock('ob:done', false)) || !!(await lireStock('setup:migre', false));
    try { if (!ancien) ancien = (await window.storage.list('check:')).keys.length > 0; } catch(e) {}
    if (ancien && window.HabitrainWardrobe) await window.HabitrainWardrobe.figerAnciensDefauts();
    await ecrireStock('wardrobe:figee', true);
  }

  async function maybeStartOnboard() {
    try {
      await reprendreParametresExistants();
      await lireSetup();
      if (setupEtat.termine) return false;
      await ouvrirInstallation(false);
      return true;
    } catch(e) { return false; }
  }


  /* ============================================================
     DÉTECTION AUTOMATIQUE DES ENTORSES
     L'appli repère ce qu'elle peut constater factuellement, puis
     Foxy te les PROPOSE : tu confirmes ou tu écartes. Rien n'est
     imposé — seul toi connais le contexte.
     ============================================================ */
  async function detectBreaches(dateKey) {
    const date = dateKey || todayStr();
    const trouvees = [];
    try {
      const checks = await getChecks(date);
      const entry = (await getAll()).find(e => e && e.date === date);
      const now = new Date();
      const finJournee = (date !== todayStr());   // jour passé : on juge tout
      const nowMin = now.getHours()*60 + now.getMinutes();

      // 1) Pilier manqué (fenêtre dépassée sans change)
      const PIL = [{k:'c0900',m:540,n:'du matin'},{k:'c1600',m:960,n:'de sortie de sieste'},{k:'c2230',m:1350,n:'de nuit'}];
      const r = await window.storage.get('slotdone:'+date);
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      for (const p of PIL) {
        const depasse = finJournee || nowMin > p.m + 120;
        if (depasse && !done[p.k]) {
          trouvees.push({ id:'b_pilier_'+p.k, n:'Change ' + p.n + ' manqué', grav:'moyenne',
                          why:'Aucun change validé dans la fenêtre du pilier.' });
        }
      }

      // 2) Port excessif
      const stamps = checks.filter(c => c.result === 'change_fait' && c.t)
                           .map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
      let maxPort = 0;
      for (let i=1;i<stamps.length;i++) maxPort = Math.max(maxPort, (stamps[i]-stamps[i-1])/3600000);
      const plafond = hardMode ? HARD.wearCapH : 6.5;
      if (maxPort > plafond) {
        trouvees.push({ id:'b_portlong', n:'Port trop long (' + maxPort.toFixed(1) + 'h)', grav:'moyenne',
                        why:'Un intervalle a dépassé ' + plafond + 'h — risque pour la peau.' });
      }

      // 3) Couche saturée laissée
      const evts = checks.filter(c => c.t).map(c => ({t:new Date(c.t).getTime(), r:c.result})).sort((a,b)=>a.t-b.t);
      for (let i=0;i<evts.length;i++) {
        if (['etat_sature','sature'].includes(evts[i].r)) {
          const suivant = evts.slice(i+1).find(e => e.r === 'change_fait');
          const delai = suivant ? (suivant.t - evts[i].t)/3600000 : (finJournee ? 99 : (Date.now()-evts[i].t)/3600000);
          if (delai > 1) {
            trouvees.push({ id:'b_sature', n:'Couche saturée gardée', grav:'grave',
                            why:'Plus d\'une heure sans change après une saturation.' });
            break;
          }
        }
      }

      // 4) Hydratation négligée
      if (finJournee || nowMin > 21*60) {
        const bib = entry ? (entry.bib || 0) : 0;
        if (bib < 2) {
          trouvees.push({ id:'b_hydra', n:'Hydratation négligée (' + bib + '/3)', grav:'legere',
                          why:'Moins de 2 biberons sur la journée.' });
        }
      }

      // 5) Tenue non scannée
      if (window.HabitrainWardrobe && (finJournee || nowMin > 20*60)) {
        const worn = await window.HabitrainWardrobe.getWornLog(date);
        if (!worn.length) {
          trouvees.push({ id:'b_tenue', n:'Aucune tenue scannée', grav:'legere',
                          why:'Pas de tenue ABDL enregistrée aujourd\'hui.' });
        }
      }

      // 6) Ouverture d'urgence de serrure (factuel, déjà tracé)
      if (checks.some(c => c.result === 'lock_emergency')) {
        trouvees.push({ id:'b_urgence', n:'Ouverture de serrure en urgence', grav:'legere',
                        why:'Le cadre a été contourné.' });
      }
    } catch(e) {}
    return trouvees;
  }

  // Foxy propose les entorses détectées ; tu confirmes ou tu écartes
  async function proposeBreaches() {
    if (paused) return false;
    let dejaVu = null;
    try { const r = await window.storage.get('breachprop:last'); if (r && r.value) dejaVu = JSON.parse(r.value); } catch(e) {}
    if (dejaVu === todayStr()) return false;
    const trouvees = await detectBreaches();
    if (!trouvees.length) return false;
    try { await window.storage.set('breachprop:last', JSON.stringify(todayStr())); } catch(e) {}

    await imSay(broOn()
      ? 'J\'ai relevé des choses aujourd\'hui. On va les regarder ensemble, et tu me diras.'
      : 'Dis, j\'ai remarqué deux-trois trucs aujourd\'hui... On regarde ensemble ? Tu me diras si c\'est justifié. 🦊', 950, 'pensive');

    for (const t of trouvees) {
      await imSay('• <b>' + t.n + '</b><br><span style="font-size:12px;color:var(--muted)">' + t.why + '</span>', 900, 'curious');
      await new Promise(res => {
        imSetActions([
          { label:'Oui, c\'est une entorse', onClick: async () => {
            try {
              const rb = await window.storage.get('breach:'+todayStr());
              const b = (rb && rb.value) ? JSON.parse(rb.value) : {};
              b[t.id] = true;
              await window.storage.set('breach:'+todayStr(), JSON.stringify(b));
            } catch(e) {}
            imAddMe('Oui, c\'est une entorse.');
            await imSay(broOn() ? 'Noté. On ne recommence pas.' : 'C\'est noté, sans jugement. On repart proprement. 🦊', 750, 'calm');
            res();
          }},
          { soft:true, label:'Non, j\'avais une raison', onClick: async () => {
            imAddMe('Non, j\'avais une raison.');
            await imSay(broOn() ? 'Bien. Je te fais confiance, cette fois.' : 'D\'accord, je te crois ! Je n\'en tiens pas compte alors. 💛', 750, 'happy');
            res();
          }}
        ]);
      });
    }
    await imSay(broOn() ? 'Voilà. Le suivi est juste maintenant.' : 'Voilà, c\'est fait ! Merci d\'avoir joué le jeu. 🦊', 850, 'proud');
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  /* ============================================================
     SESSIONS DE DISCIPLINE
     Quand les écarts s'accumulent, le cadre se resserre
     automatiquement pendant quelques jours. Ce n'est pas une
     punition : c'est une remise en structure. Les garde-fous
     santé et le safeword restent intacts.
     ============================================================ */
  const DISC_SEUILS = { leger: 12, moyen: 20, fort: 30 };   // points d'écart cumulés sur 3 jours

  async function getDiscipline() {
    try { const r = await window.storage.get('discipline'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return null;
  }
  async function setDiscipline(d) {
    try {
      if (d) await window.storage.set('discipline', JSON.stringify(d));
      else await window.storage.delete('discipline');
    } catch(e) {}
  }
  function discActive() { return !!(discSession && discSession.active); }
  let discSession = null;

  async function loadDiscipline() {
    discSession = await getDiscipline();
    if (discSession && discSession.fin && Date.now() > discSession.fin) {
      // la session a expiré sans être close explicitement
      discSession = null;
      await setDiscipline(null);
    }
  }

  // Mesure du relâchement : poids des entorses sur les 3 derniers jours
  async function mesurerEcarts() {
    let total = 0, jours = 0;
    for (let i = 0; i < 3; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const k = d.toISOString().slice(0,10);
      try {
        const r = await window.storage.get('breach:'+k);
        const b = (r && r.value) ? JSON.parse(r.value) : {};
        let p = 0;
        Object.keys(b).forEach(id => {
          if (!b[id]) return;
          const it = BREACHES.find(x => x.id === id);
          p += it ? it.w : 5;
        });
        if (p > 0) jours++;
        total += p;
      } catch(e) {}
    }
    return { total, jours };
  }

  // Déclenchement automatique au seuil
  async function checkDisciplineTrigger() {
    if (paused || discActive()) return false;
    // pas plus d'une session par semaine
    try {
      const r = await window.storage.get('disc:last');
      if (r && r.value && (Date.now() - JSON.parse(r.value)) < 7*86400000) return false;
    } catch(e) {}
    const { total } = await mesurerEcarts();
    let niveau = null, jours = 0, objectif = 0;
    if (total >= DISC_SEUILS.fort)        { niveau = 'fort';  jours = 5; objectif = 3; }
    else if (total >= DISC_SEUILS.moyen)  { niveau = 'moyen'; jours = 3; objectif = 2; }
    else if (total >= DISC_SEUILS.leger)  { niveau = 'leger'; jours = 2; objectif = 2; }
    if (!niveau) return false;

    discSession = {
      active: true, niveau, objectif,
      debut: Date.now(), fin: Date.now() + jours*86400000,
      joursPropres: 0, ecarts: total
    };
    await setDiscipline(discSession);
    try { await window.storage.set('disc:last', JSON.stringify(Date.now())); } catch(e) {}
    await annoncerDiscipline(niveau, jours, objectif, total);
    return true;
  }

  async function annoncerDiscipline(niveau, jours, objectif, total) {
    const intro = {
      leger: 'Ça commence à déraper, je le vois bien.',
      moyen: 'Les écarts s\'accumulent. Là, il faut qu\'on reprenne les choses en main.',
      fort:  'Le cadre est en train de se défaire complètement. Je ne vais pas laisser faire.'
    }[niveau];

    await imSay(intro, 950, 'concern');
    await imSay('Alors on entre en <b>session de discipline</b> pendant ' + jours + ' jours. Ce n\'est pas une punition — c\'est juste que tu as besoin d\'un cadre plus serré, et je vais te le donner.', 1050, 'calm');
    await imSay('Tu peux trouver ça pesant au début. Mais tu sais déjà comment ça va finir : tu vas t\'y remettre, et tu te sentiras mieux. Résister n\'y changera rien.', 1050, 'calm');
    await imSay('<b>Ce qui change, concrètement :</b>'
      + '<br>• Les checks de 11h30, 13h30 et 19h30 deviennent des <b>changes piliers</b>'
      + '<br>• Je m\'inquiète dès <b>5 minutes</b> de retard, au lieu de 15'
      + '<br>• Les rituels ne se reportent plus — pas de « une autre fois »'
      + '<br>• Je change de registre : plus direct, moins d\'échappatoires', 1200, 'explain');
    await imSay('<b>Pour en sortir :</b> ' + objectif + ' journées <b>consécutives</b> sans la moindre entorse, '
      + 'et chacune renseignée le soir — une journée non remplie ne compte pas.', 1100, 'teach');
    await imSay(broOn()
      ? 'Et je préfère te le dire tout de suite : une seule entorse et le compteur repart à zéro. Ce n\'est pas une punition, c\'est la règle. Allez.'
      : 'Un point important : une seule entorse et le compteur repart de zéro. Autant que tu le saches maintenant plutôt qu\'au quatrième jour. 🦊',
      1050, 'concern');
    if (currentM) await imOfferHelp(currentM);
  }

  // Progression : appelée en fin de journée
  async function majDiscipline() {
    if (!discActive()) return;
    const hier = new Date(); hier.setDate(hier.getDate()-1);
    const k = hier.toISOString().slice(0,10);
    let propre = true;
    try {
      const r = await window.storage.get('breach:'+k);
      const b = (r && r.value) ? JSON.parse(r.value) : {};
      propre = !Object.keys(b).some(x => b[x]);
    } catch(e) {}
    // il faut aussi que la journée ait été renseignée
    const entries = await getAll();
    if (!entries.some(e => e && e.date === k)) propre = false;

    const avant = discSession.joursPropres;
    if (propre) discSession.joursPropres++;
    else discSession.joursPropres = 0;   // une entorse remet le compteur à zéro

    // La remise à zéro se faisait en silence : tu pouvais perdre trois jours
    // d'affilée sans jamais l'apprendre. Elle s'annonce maintenant.
    if (!propre && avant > 0 && voiceMode === 'foxy') {
      talk(TALK.CADRE, 'disc:reset', async () => {
        await imSay(broOn()
          ? 'Hier n\'était pas une journée propre. Tes ' + avant + ' journée' + (avant>1?'s':'') + ' sont effacées, le compteur repart de zéro. Je t\'avais prévenu.'
          : 'Hier n\'était pas une journée sans écart... Tes ' + avant + ' journée' + (avant>1?'s':'') + ' acquise' + (avant>1?'s':'') + ' repartent à zéro. Je sais, c\'est rude — mais c\'était la règle annoncée. 🦊',
          1050, 'concern');
        await imSay(broOn()
          ? 'On recommence. ' + discSession.objectif + ' journées, à partir d\'aujourd\'hui.'
          : 'On repart d\'aujourd\'hui : ' + discSession.objectif + ' journées propres et c\'est fini. Tu peux le faire. 🦊',
          1000, 'calm');
        if (currentM) await imOfferHelp(currentM);
      });
    }

    if (discSession.joursPropres >= discSession.objectif) {
      // session réussie
      discSession = null;
      await setDiscipline(null);
      try { await flagBadge('discDone'); } catch(e) {}
      if (voiceMode === 'foxy') {
        await imSay('C\'est bon. Tu as tenu tes journées sans écart. La session de discipline est terminée.', 900, 'proud');
        await imSay('Tu vois ? Je te l\'avais dit. Tu t\'y es remis, comme prévu. Je suis fier de toi, sincèrement. 🦊💛', 1000, 'moved');
        if (currentM) await imOfferHelp(currentM);
      }
    } else {
      await setDiscipline(discSession);
    }
  }

  /* ============================================================
     HAUTS FAITS — évaluation automatique des badges
     ============================================================ */
  const BG = window.HabitrainBadges;

  // Agrège toutes les statistiques nécessaires, une seule fois
  async function statsBadges() {
    const st = { days:0, streak:0, cleanStreak:0, pillars:0, skin:0, hydra:0,
                 journal:0, confid:0, missions:0, worn:0, chapters:0, scans:0,
                 counts:{}, maxDay:0, longNight:0, earlyChange:false, lateChange:false,
                 score:0, weekend:false, perfectDay:false };
    try {
      const entries = await getAll();
      st.days = entries.filter(e => e && e.date).length;
      st.skin = entries.filter(e => e && e.skin === 'verte').length;
      st.hydra = entries.filter(e => e && (e.bib||0) >= 3).length;

      const byDate = {}; entries.forEach(e => { if (e && e.date) byDate[e.date] = e; });
      // séries
      for (let i = 0; ; i++) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const k = d.toISOString().slice(0,10);
        if (byDate[k]) st.streak++; else { if (i===0) continue; break; }
        if (i > 400) break;
      }
      for (let i = 0; ; i++) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const k = d.toISOString().slice(0,10);
        if (!byDate[k]) { if (i===0) continue; break; }
        const r = await window.storage.get('breach:'+k);
        const b = (r && r.value) ? JSON.parse(r.value) : {};
        if (Object.keys(b).some(x => b[x])) break;
        st.cleanStreak++;
        if (i > 200) break;
      }
      // week-end complet
      for (const e of entries) {
        if (!e || !e.date) continue;
        const j = new Date(e.date).getDay();
        if (j === 6) {
          const dim = new Date(e.date); dim.setDate(dim.getDate()+1);
          if (byDate[dim.toISOString().slice(0,10)]) { st.weekend = true; break; }
        }
      }
      // parcours des checks
      for (const e of entries) {
        if (!e || !e.date) continue;
        const list = await getChecks(e.date);
        let changesJour = 0;
        for (const c of list) {
          st.counts[c.result] = (st.counts[c.result] || 0) + 1;
          if (c.result === 'change_fait') {
            changesJour++;
            if (c.t) {
              const h = new Date(c.t).getHours();
              if (h < 7) st.earlyChange = true;
              if (h >= 0 && h < 5) st.lateChange = true;
            }
          }
          if (c.type && String(c.type).indexOf('preuve') >= 0) st.scans++;
        }
        st.maxDay = Math.max(st.maxDay, changesJour);
        // nuit la plus longue
        const stamps = list.filter(c => c.result === 'change_fait' && c.t)
                           .map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
        for (let i=1;i<stamps.length;i++) {
          const dur = (stamps[i]-stamps[i-1])/3600000;
          const hDeb = new Date(stamps[i-1]).getHours();
          if (hDeb >= 21 || hDeb < 3) st.longNight = Math.max(st.longNight, dur);
        }
      }
      // piliers
      for (const e of entries) {
        if (!e || !e.date) continue;
        const r = await window.storage.get('slotdone:'+e.date);
        const d = (r && r.value) ? JSON.parse(r.value) : {};
        st.pillars += ['c0900','c1600','c2230'].filter(k => d[k]).length;
      }
      // quête
      const q = await getQuest();
      st.journal = (q.journal||[]).length;
      st.confid = (q.confidences||[]).length;
      st.chapters = (q.unlockedStage >= 0) ? q.unlockedStage + 1 : 0;
      // missions
      if (window.HabitrainMissions) {
        const m = await window.HabitrainMissions.getState();
        st.missions = (m.doneP||[]).length;
      }
      // tenues scannées
      if (window.HabitrainWardrobe) {
        for (const e of entries) {
          if (!e || !e.date) continue;
          const w = await window.HabitrainWardrobe.getWornLog(e.date);
          st.worn += w.length;
        }
      }
      // score courant
      try { const r = await window.storage.get('lastscore'); if (r && r.value) st.score = JSON.parse(r.value); } catch(e) {}
    } catch(e) {}
    return st;
  }

  function badgeAtteint(b, st, flags) {
    switch (b.kind) {
      case 'days':        return st.days >= b.t;
      case 'streak':      return st.streak >= b.t;
      case 'cleanStreak': return st.cleanStreak >= b.t;
      case 'pillars':     return st.pillars >= b.t;
      case 'skin':        return st.skin >= b.t;
      case 'hydra':       return st.hydra >= b.t;
      case 'journal':     return st.journal >= b.t;
      case 'confid':      return st.confid >= b.t;
      case 'missions':    return st.missions >= b.t;
      case 'worn':        return st.worn >= b.t;
      case 'chapters':    return st.chapters >= b.t;
      case 'scans':       return st.scans >= b.t;
      case 'score':       return st.score >= b.t;
      case 'count':       return (st.counts[b.r] || 0) >= b.t;
      case 'maxDay':      return st.maxDay >= b.t;
      case 'longNight':   return st.longNight >= b.t;
      case 'earlyChange': return st.earlyChange;
      case 'lateChange':  return st.lateChange;
      case 'weekend':     return st.weekend;
      case 'introspect':  return !!(flags && flags.introspect);
      case 'hardDay':     return !!(flags && flags.hardDay);
      case 'discDone':    return !!(flags && flags.discDone);
      case 'surpriseDay': return !!(flags && flags.surpriseDay);
      case 'comeback':    return !!(flags && flags.comeback);
      case 'perfectDay':  return !!(flags && flags.perfectDay);
      case 'sensor':      return !!(flags && flags.sensor);
    }
    return false;
  }

  // Vérifie et débloque ; Foxy annonce les nouveaux badges
  async function checkBadges(silencieux) {
    if (!BG) return [];
    const st = await statsBadges();
    let flags = {};
    try { const r = await window.storage.get('badgeflags'); if (r && r.value) flags = JSON.parse(r.value); } catch(e) {}
    const dejaEus = await BG.getUnlocked();
    const nouveaux = [];
    for (const b of BG.BADGES) {
      if (dejaEus[b.id]) continue;
      if (badgeAtteint(b, st, flags)) { await BG.unlock(b.id); nouveaux.push(b); }
    }
    if (nouveaux.length && !silencieux && voiceMode === 'foxy') {
      for (const b of nouveaux) {
        await imSay(b.ic + ' <b>Haut fait débloqué : ' + b.n + '</b><br><span style="font-size:12px;color:var(--muted)">' + b.d + '</span>',
                    1000, 'proud');
      }
      await imSay(broOn()
        ? 'Ça se range dans ton tableau. Continue, il en reste.'
        : 'Bravo ! C\'est rangé dans ton tableau de hauts faits. 🏆🦊', 850, 'cheer');
      if (currentM) await imOfferHelp(currentM);
    }
    return nouveaux;
  }

  // Marque un événement ponctuel pour les badges intemporels
  async function flagBadge(cle) {
    try {
      const r = await window.storage.get('badgeflags');
      const f = (r && r.value) ? JSON.parse(r.value) : {};
      f[cle] = true;
      await window.storage.set('badgeflags', JSON.stringify(f));
    } catch(e) {}
  }

  // ===== Conseils de Foxy (guides progressifs) =====
  const TP = window.HabitrainTips;
  let tipsGuide = 'couche';


  async function currentStage() {
    try { const r = await window.storage.get('queststage'); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return 0;
  }

  async function renderTips() {
    if (!TP) return;
    const stage = await currentStage();

    // progression
    const dispo = TP.countAvailable(stage), tot = TP.countTotal();
    const prog = document.getElementById('tipsProg');
    prog.innerHTML = '<div style="font-size:12.5px;font-weight:700;color:var(--muted);margin-bottom:5px">'+
      'Tu es au palier <b style="color:#a8543b">'+TP.PALIERS[stage]+'</b> — je t\'ai confié '+dispo+' conseils sur '+tot+'.</div>'+
      '<div style="height:8px;background:#efe4d2;border-radius:6px;overflow:hidden">'+
      '<div style="height:100%;width:'+Math.round(dispo/tot*100)+'%;background:linear-gradient(90deg,#e8a94a,#c86b3a)"></div></div>';

    // onglets des guides
    const nav = document.getElementById('tipsNav');
    nav.innerHTML = '';
    TP.GUIDES.forEach(g => {
      const b = document.createElement('button');
      b.className = 'settings-toggle-btn';
      b.style.cssText = 'flex:1;min-width:calc(50% - 4px);font-size:12.5px;padding:9px 6px' +
        (tipsGuide === g.id ? ';background:#c86b3a;color:#fff;border-color:#c86b3a' : '');
      b.textContent = g.ic + ' ' + g.nom;
      b.addEventListener('click', async () => { tipsGuide = g.id; await renderTips(); });
      nav.appendChild(b);
    });

    // contenu du guide sélectionné
    const g = TP.guideById(tipsGuide);
    const body = document.getElementById('tipsBody');
    body.innerHTML = '<div class="sub" style="margin-bottom:10px">'+g.sous+'</div>';

    g.niveaux.forEach(nv => {
      const ouvert = nv.lvl <= stage;
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-bottom:14px';
      sec.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:15px;color:'+
        (ouvert?'#5a4326':'var(--muted)')+';margin-bottom:7px">'+
        (ouvert?'':'🔒 ')+nv.titre+
        ' <span style="font-size:11px;font-weight:700;color:var(--muted)">· '+TP.PALIERS[nv.lvl]+'</span></div>';

      if (!ouvert) {
        sec.innerHTML += '<div class="set-note">🦊 « Ça, je te le raconterai quand tu seras au palier <b>'+TP.PALIERS[nv.lvl]+'</b>. Chaque chose en son temps, tu verras — ça n\'aurait pas le même sens maintenant. »</div>';
      } else {
        nv.conseils.forEach(c => {
          const d = document.createElement('div');
          d.style.cssText = 'border-top:1px solid var(--line);padding:10px 0;cursor:pointer';
          d.innerHTML = '<div style="font-size:13.5px;font-weight:800;color:var(--ink)">💡 '+c.t+
            ' <span class="tip-arrow" style="float:right;color:var(--muted);font-weight:700">+</span></div>'+
            '<div class="tip-body" style="display:none;font-size:13px;font-weight:600;color:var(--ink);line-height:1.55;margin-top:7px">'+c.d+'</div>';
          d.addEventListener('click', () => {
            const b = d.querySelector('.tip-body'), a = d.querySelector('.tip-arrow');
            const o = b.style.display === 'none';
            b.style.display = o ? '' : 'none';
            a.textContent = o ? '−' : '+';
          });
          sec.appendChild(d);
        });
      }
      body.appendChild(sec);
    });
  }

  // --- Affichage du tableau de hauts faits ---

  async function renderBadges() {
    if (!BG) return;
    await checkBadges(true);   // met à jour avant d'afficher
    const u = await BG.getUnlocked();
    const total = BG.BADGES.length;
    const acquis = BG.BADGES.filter(b => u[b.id]).length;
    const pct = Math.round(acquis/total*100);

    const prog = document.getElementById('badgesProg');
    prog.innerHTML = '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">'+
      '<span style="font-family:\'Fraunces\',serif;font-size:26px;font-weight:600;color:#5a4326">'+acquis+'</span>'+
      '<span style="font-size:13px;font-weight:700;color:var(--muted)">/ '+total+' hauts faits ('+pct+'%)</span></div>'+
      '<div style="height:10px;background:#efe4d2;border-radius:8px;overflow:hidden">'+
      '<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#e8a94a,#c86b3a)"></div></div>';

    const box = document.getElementById('badgesList');
    box.innerHTML = '';
    for (const niv of BG.NIVEAUX) {
      const lot = BG.BADGES.filter(b => b.lvl === niv.lvl);
      if (!lot.length) continue;
      const n = lot.filter(b => u[b.id]).length;
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-top:16px';
      sec.innerHTML = '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:15px;color:#5a4326;margin-bottom:8px">'+
        niv.ic+' '+niv.nom+' <span style="font-size:11.5px;font-weight:700;color:var(--muted)">('+n+'/'+lot.length+')</span></div>';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px';
      lot.forEach(b => {
        const ok = !!u[b.id];
        const el = document.createElement('div');
        el.style.cssText = 'text-align:center;padding:10px 6px;border-radius:13px;border:1.5px solid '+
          (ok?'#e0a060':'var(--line)')+';background:'+(ok?'#FBF3E8':'#f7f7f5')+';'+
          (ok?'':'opacity:.55');
        // médaillon SVG ; les badges majeurs portent une illustration de Foxy si disponible
        let visuel = BG.medalSVG(b, ok, 58);
        if (ok) {
          // deux planches : « en couche » pour les badges de port, « habillé » pour le reste
          let sheet = null, idx = -1;
          if (BG.estMajeurCouche && BG.estMajeurCouche(b.id)) { sheet = 'badges-couche.png'; idx = BG.coucheIndex(b.id); }
          else if (BG.estMajeur && BG.estMajeur(b.id))        { sheet = 'badges-foxy.png';   idx = BG.foxyIndex(b.id); }
          if (sheet) {
            visuel = '<div style="width:58px;height:58px;margin:0 auto;border-radius:14px;' +
                     'background-image:url(\'' + sheet + '\');background-repeat:no-repeat;background-size:232px 232px;' +
                     'background-position:' + (-(idx%4)*58) + 'px ' + (-Math.floor(idx/4)*58) + 'px;' +
                     'border:2px solid #e0a060;background-color:#FDF3EA"></div>';
          }
        }
        el.innerHTML = visuel +
          '<div style="font-size:10.5px;font-weight:800;color:'+(ok?'#a8543b':'var(--muted)')+';margin-top:4px;line-height:1.25">'+b.n+'</div>';
        el.title = b.d;
        el.addEventListener('click', () => {
          const d = document.getElementById('badgeDetail');
          if (d) d.innerHTML = '<div style="display:flex;align-items:center;gap:12px">' +
            BG.medalSVG(b, ok, 64) +
            '<div><b>'+b.n+'</b><br>'+b.d+
            (ok ? '<br><span style="color:var(--green);font-weight:800">✅ Débloqué</span>'
                : '<br><span style="color:var(--muted)">🔒 À débloquer</span>')+'</div></div>';
        });
        grid.appendChild(el);
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    }
    const det = document.createElement('div');
    det.id = 'badgeDetail';
    det.className = 'set-note';
    det.style.marginTop = '14px';
    det.textContent = 'Tape un haut fait pour voir sa description.';
    box.appendChild(det);
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
        case 'holdTime': {
          // au moins un intervalle entre changes >= target heures
          const st = checks.filter(c => c.result === 'change_fait' && c.t).map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
          let best = 0;
          for (let i=1;i<st.length;i++) best = Math.max(best, (st[i]-st[i-1])/3600000);
          return { done: best >= m.target, progress: Math.min(m.target, Math.round(best*10)/10), total:m.target };
        }
        case 'noQuickChange': {
          const st = checks.filter(c => c.result === 'change_fait' && c.t).map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
          let court = 0;
          for (let i=1;i<st.length;i++) if ((st[i]-st[i-1])/3600000 < 2) court++;
          return { done: court === 0 && st.length > 0, progress: court === 0 ? 1 : 0, total:1 };
        }
        case 'quickWet': {
          // une miction survenue moins de target heures après un change
          const evts = checks.filter(c => c.t).map(c => ({t:new Date(c.t).getTime(), r:c.result})).sort((a,b)=>a.t-b.t);
          let ok = false, dernier = null;
          for (const e of evts) {
            if (e.r === 'change_fait') dernier = e.t;
            else if (dernier && ['etat_mouille','mouille','etat_sature','sature'].includes(e.r)) {
              if ((e.t - dernier)/3600000 <= m.target) ok = true;
              dernier = null;
            }
          }
          return { done: ok, progress: ok?1:0, total:1 };
        }
        case 'noDrySlot': {
          const secs = checks.filter(c => ['etat_sec','sec','reveil_sec'].includes(c.result)).length;
          const tot = checks.filter(c => ['etat_sec','sec','reveil_sec','etat_mouille','mouille','etat_sature','sature','reveil_mouille'].includes(c.result)).length;
          return { done: tot >= 2 && secs === 0, progress: (tot>=2 && secs===0)?1:0, total:1 };
        }
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
      let ciblee = false;
      try {
        const diag = await MS.getDiagnostic();
        ciblee = !!(diag && m.cible && (diag.faibles||[]).includes(m.cible));
      } catch(e) {}
      const div = document.createElement('div');
      div.style.cssText = 'border-top:1px solid var(--line);padding:9px 0';
      div.innerHTML = '<div style="display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:17px">'+(ev.done?'✅':'⬜')+'</span>'+
        '<div style="flex:1"><div style="font-size:13.5px;font-weight:800;color:'+(ev.done?'var(--green)':'var(--ink)')+'">'+m.name+
        (ciblee ? ' <span style="font-size:10px;font-weight:800;background:#f0d9c0;color:#a85a2a;padding:1px 6px;border-radius:20px;vertical-align:middle">🎯 ciblée</span>' : '')+'</div>'+
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
  /* ============================================================
     CAPTEUR COUCHE v3 — ce que l'appli fait de ses évènements
     Le capteur capacitif dit : porté / retiré, sec / mouillé /
     saturé (sans jamais redescendre tant que c'est porté), et si la
     couche posée est fraîche. Il ne sait pas dire si c'est la couche
     ou seulement le capteur qui a été retiré : Foxy le formule ainsi.
     ============================================================ */
  const ETATS_COUCHE_CAPTEUR = ['sec', 'mouille', 'sature'];

  // Un évènement, enregistré à sa vraie heure. Une couche fraîche EST une
  // couche sèche : c'est la preuve qu'attend la vérification d'après change.
  async function enregistrerEvtCapteur(ev) {
    const dateKey = ev.t.slice(0, 10);
    const list = await getChecks(dateKey);
    let result;
    if (ETATS_COUCHE_CAPTEUR.includes(ev.state)) result = 'etat_' + ev.state;
    else if (ev.state === 'fraiche') result = 'etat_sec';
    else result = 'capteur_' + ev.state;               // retire / repose / redemarre : pas un état de couche
    const entree = { t: ev.t, result, type: 'capteur' };
    if (ev.state === 'fraiche') entree.fraiche = true;
    list.push(entree);
    await window.storage.set('check:' + dateKey, JSON.stringify(list));
  }

  // Retirer sa couche est normal autour d'un créneau de change. Ailleurs, non.
  // [heure, minutes avant, minutes après]
  const FENETRES_RETRAIT = [[9*60,20,120], [11*60+30,15,45], [13*60+30,15,45], [16*60,20,120], [19*60+30,20,90], [22*60+30,20,120]];
  function retraitAutorise(tIso, checksDuJour) {
    const d = new Date(tIso), m = d.getHours()*60 + d.getMinutes(), t = d.getTime();
    if (FENETRES_RETRAIT.some(([c, av, ap]) => m >= c - av && m <= c + ap)) return true;
    // un change réellement fait juste après (hors horaire, après une saturation) couvre le retrait
    return (checksDuJour || []).some(c => /^change_fait/.test(c.result || '')
      && new Date(c.t).getTime() >= t - 10*60000 && new Date(c.t).getTime() <= t + 60*60000);
  }

  // Parcourt une suite d'évènements et relève les retraits hors cadre.
  async function analyserRetraits(events) {
    if (paused) return [];
    const constats = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.state !== 'retire') continue;
      const suite = events.slice(i + 1).find(e => e.state !== 'retire' && e.state !== 'redemarre');
      const fin = suite ? new Date(suite.t).getTime() : Date.now();
      const minutes = Math.round((fin - new Date(ev.t).getTime()) / 60000);
      if (minutes < 10) continue;                      // un ajustement, pas un retrait
      let checks = [];
      try { checks = await getChecks(ev.t.slice(0, 10)); } catch(e) {}
      if (!retraitAutorise(ev.t, checks)) {
        await marquerEntorse('b_retrait_hors', true);
        constats.push({ type: 'hors', t: ev.t, minutes, suite: suite ? suite.state : null });
      }
      if (minutes >= 120) {
        await marquerEntorse('b_retrait_2h', true);
        constats.push({ type: 'long', t: ev.t, minutes });
      }
    }
    return constats;
  }

  function hhmm(iso) { const d = new Date(iso); return fmtTime(d.getHours()*60 + d.getMinutes()); }

  // Ce que Foxy dit des retraits relevés — sans jamais prétendre savoir
  // si c'est la couche ou le capteur qui est parti.
  async function direRetraits(constats) {
    for (const c of constats) {
      if (c.type === 'hors') {
        await imSay(bro(
          'Ton capteur ne t\'a plus senti à ' + hhmm(c.t) + ', pendant ' + c.minutes + ' min, et ce n\'était pas l\'heure d\'un change. Je ne sais pas si c\'est ta couche ou seulement le capteur qui est parti — mais dans les deux cas, c\'est hors cadre, alors je le note. 🦊',
          'Capteur retiré à ' + hhmm(c.t) + ', ' + c.minutes + ' min, hors créneau. Couche ou capteur, c\'est hors cadre. Noté.'), 1000, 'puzzled');
        if (c.suite === 'repose') {
          await imSay(bro(
            'Et quand il est revenu, la couche n\'était pas fraîche : c\'était la même. Donc pas un change.',
            'Revenu sur la même couche. Pas un change.'), 900, 'concern');
        }
        const regle = citerRegle('b_retrait_hors');
        if (regle) await imSay('📋 ' + regle, 800, 'explain');
      } else if (c.type === 'long') {
        await imSay(bro(
          'Plus de deux heures sans que ton capteur te sente, à partir de ' + hhmm(c.t) + '. Ça, c\'est long. 💛',
          'Plus de deux heures sans capteur à partir de ' + hhmm(c.t) + '.'), 900, 'concern');
      }
    }
  }

  // ---- connexion (factorisée : utilisée par la carte ET après un change) ----
  async function connecterCapteur() {
    const S = window.HabitrainSensor;
    const statusEl = document.getElementById('sensorStatus');
    if (!S || !S.supported()) { if (statusEl) statusEl.textContent = 'Non supporté (Android/Chrome requis)'; return false; }
    if (statusEl) statusEl.textContent = 'Connexion… (appuie sur le bouton du capteur)';
    S.onState((state) => onSensorState(state));
    S.onRaw((d) => afficherBrutCapteur(d));
    S.onLog((events) => onSensorLog(events));
    S.onLien((ok) => { if (!ok && statusEl) statusEl.textContent = '⚪ Déconnecté (le capteur est retourné en veille)'; });
    try {
      await S.connect();
      if (statusEl) statusEl.textContent = '🟢 Connecté';
      try { await flagBadge('sensor'); } catch(e) {}
      try { await window.storage.set('sensor:vu', JSON.stringify(Date.now())); } catch(e) {}
      const b = document.getElementById('sensorConnect'); if (b) b.textContent = '🔄 Resynchroniser';
      return true;
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Échec / annulé — le capteur était-il réveillé ?';
      return false;
    }
  }
  document.getElementById('sensorConnect').addEventListener('click', () => { connecterCapteur(); });

  // ---- réglage : valeurs brutes en direct ----
  function afficherBrutCapteur(d) {
    const r = document.getElementById('sensorRaw');
    if (!r || !d) return;
    if (d.v === 2) {                                   // ancien capteur à humidité
      r.innerHTML = d.rh.toFixed(1) + '% HR · ' + d.t.toFixed(1) + '°C';
      return;
    }
    if (d.mpr === false) { r.innerHTML = '<span style="color:var(--coral)">⚠️ MPR121 introuvable — vérifie SDA/SCL/3V3/GND</span>'; return; }
    const NOMS = ['Avant', 'Milieu', 'Entrejambe'];
    const zones = (d.zones || []).map((z, i) => {
      const e = d.ecarts ? d.ecarts[i] : 0;
      const coul = e >= 18 ? 'var(--coral)' : (e >= 8 ? 'var(--amber)' : 'var(--muted)');
      return '<div style="flex:1;text-align:center"><div style="font-size:11px;font-weight:700;color:var(--muted)">' + NOMS[i] + '</div>'
        + '<div>' + z + '</div><div style="font-size:12px;font-weight:800;color:' + coul + '">' + (e >= 0 ? '+' : '') + e.toFixed(1).replace('.', ',') + ' %</div></div>';
    }).join('');
    const niv = ['☀️ sèche', '💧 mouillée', '🌊 saturée'][d.niveau] || '—';
    r.innerHTML = '<div style="display:flex;gap:6px;font-size:18px">' + zones + '</div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--muted);margin-top:6px">'
      + (d.porte ? '🟢 porté' : '⚪ pas porté') + ' · réf. ' + d.ref + (d.air ? ' (à vide ' + d.air + ')' : ' (pas étalonné à vide)')
      + (d.temp ? ' · ' + d.temp.toFixed(1).replace('.', ',') + ' °C' : '')
      + (d.vbat ? ' · 🔋 ' + (d.vbat / 1000).toFixed(2).replace('.', ',') + ' V' + (d.vbat < 3450 ? ' (faible)' : '') : '') + ' · ' + niv
      + ' · ' + (d.sessions || 0) + ' change' + ((d.sessions || 0) > 1 ? 's' : '') + ' appris</div>';
  }

  // ---- boutons de réglage de la carte ----
  (function () {
    const S = () => window.HabitrainSensor;
    const lier = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    const dire = (t) => { const el = document.getElementById('sensorReglageMsg'); if (el) el.textContent = t; };
    lier('sensorAir', async () => {
      if (!S() || !S().isConnected()) return dire('Connecte d\'abord le capteur.');
      dire((await S().etalonnerAir()) ? 'Étalonnage à vide lancé : ne touche pas le pad pendant 20 s.' : 'Échec de l\'envoi.');
    });
    lier('sensorRaz', async () => {
      if (!S() || !S().isConnected()) return dire('Connecte d\'abord le capteur.');
      dire((await S().oublierReference()) ? 'Référence oubliée : la prochaine couche posée sera réapprise.' : 'Échec de l\'envoi.');
    });
    lier('sensorSeuils', async () => {
      if (!S() || !S().isConnected()) return dire('Connecte d\'abord le capteur.');
      const m = parseInt((document.getElementById('sensorSeuilM') || {}).value, 10);
      const s = parseInt((document.getElementById('sensorSeuilS') || {}).value, 10);
      if (!(m >= 2 && s > m)) return dire('Il faut 2 ≤ mouillée < saturée.');
      dire((await S().reglerSeuils(m, s)) ? 'Seuils envoyés : mouillée ' + m + ' %, saturée ' + s + ' %.' : 'Échec de l\'envoi.');
    });
  })();

  // ---- journal reçu à la connexion (tout ce qui s'est passé appli fermée) ----
  async function onSensorLog(events) {
    if (!events || !events.length) return;
    let n = 0;
    for (const ev of events) {
      try {
        await enregistrerEvtCapteur(ev);
        n++;
        // la couche fraîche vaut preuve de remise en couche après un change
        if (ev.state === 'fraiche') { try { await corroborerEtat('sec', new Date(ev.t).getTime()); } catch(e) {} }
      } catch(e) {}
    }
    let constats = [];
    try { constats = await analyserRetraits(events); } catch(e) {}
    try { await verifierFraicheEnRetard(); } catch(e) {}
    try { await refresh(); } catch(e) {}
    const statusEl = document.getElementById('sensorStatus');
    if (statusEl) statusEl.textContent = '🟢 Connecté · ' + n + ' évènement' + (n > 1 ? 's' : '') + ' synchronisé' + (n > 1 ? 's' : '');

    if (voiceMode === 'foxy' && !paused && n > 0) {
      const mouil = events.filter(e => e.state === 'mouille').length;
      const sat = events.filter(e => e.state === 'sature').length;
      const fr = events.filter(e => e.state === 'fraiche').length;
      const coupe = events.some(e => e.state === 'redemarre');
      const faible = events.some(e => e.state === 'batterie');
      await talk(TALK.CADRE, 'capteur:synchro', async () => {
        const bouts = [];
        if (mouil) bouts.push(mouil + ' fois mouillée');
        if (sat) bouts.push(sat + ' fois saturée');
        if (fr) bouts.push(fr + ' couche' + (fr > 1 ? 's' : '') + ' fraîche' + (fr > 1 ? 's' : '') + ' posée' + (fr > 1 ? 's' : ''));
        if (bouts.length) {
          await imSay(bro(
            'Ton capteur m\'a tout raconté : ' + bouts.join(', ') + ' pendant qu\'on n\'était pas ensemble. 🦊',
            'Ton capteur a tout noté : ' + bouts.join(', ') + '.'), 900, mouil || sat ? 'happy' : 'calm');
        }
        await direRetraits(constats);
        if (faible) {
          await imSay(bro(
            'Et sa batterie est faible : il a arrêté de mesurer pour la protéger. Recharge-le dès que tu peux — sans lui, je suis aveugle. 🔋',
            'Batterie faible : il ne mesure plus. Recharge-le.'), 850, 'concern');
        }
        if (coupe) {
          await imSay(bro(
            'Il s\'est aussi éteint à un moment — batterie vide ou débranché. Pendant ce temps-là, je n\'ai rien vu. Pense à le recharger. 🔋',
            'Il s\'est éteint à un moment. Batterie ? Recharge-le.'), 850, 'concern');
        }
        try { await imOfferHelp(currentM || currentMoment(new Date())); } catch(e) {}
      });
    }
  }

  // ---- état en direct (appli ouverte, capteur connecté) ----
  const SENSOR_LABELS = { sec:'☀️ Sèche', mouille:'💧 Mouillée', sature:'🌊 Saturée', retire:'⚪ Pas porté', fraiche:'✨ Couche fraîche', repose:'⚠️ Reposé (pas frais)', redemarre:'🔋 Redémarré', batterie:'🪫 Batterie faible' };
  let lastSensorState = null;
  let retraitEnDirect = null;                          // heure du retrait vu en direct

  async function onSensorState(state) {
    const live = document.getElementById('sensorLive');
    if (live) live.textContent = SENSOR_LABELS[state] || '—';
    if (state === lastSensorState) return;
    const precedent = lastSensorState;
    lastSensorState = state;
    const now = new Date().toISOString();
    try { await enregistrerEvtCapteur({ t: now, state }); } catch(e) {}
    if (state === 'fraiche') { try { await corroborerEtat('sec', Date.now()); } catch(e) {} }
    try { await renderSince(); } catch(e) {}

    // retrait vu en direct : on le juge quand le capteur te « retrouve »
    let constats = [];
    if (state === 'retire') retraitEnDirect = now;
    else if (retraitEnDirect) {
      try { constats = await analyserRetraits([{ t: retraitEnDirect, state: 'retire' }, { t: now, state }]); } catch(e) {}
      retraitEnDirect = null;
    }
    if (precedent === null) return;                    // lecture initiale à la connexion : pas de commentaire
    if (voiceMode !== 'foxy' || paused) return;

    const m = currentM || currentMoment(new Date());
    if (state === 'mouille') {
      await imSay(bro(
        'Oh, ton capteur vient de le voir : tu t\'es mouillé. Tu l\'as senti partir, ou c\'est lui qui te l\'apprend ? 🦊',
        'Tu viens de te mouiller. Le capteur l\'a vu. Tu l\'as senti, au moins ?'), 800, broOn() ? 'pensive' : 'happy');
    } else if (state === 'sature') {
      await imSay(bro(
        'Ta couche est bien saturée maintenant. On va te changer — ta peau d\'abord. 🦊',
        'Saturée. On change. Ta peau d\'abord.'), 850, 'concern');
    } else if (state === 'fraiche') {
      await imSay(bro('Et voilà, ton capteur a vu une couche toute fraîche. ✨', 'Couche fraîche, vue par le capteur.'), 700, 'proud');
    } else if (state === 'batterie') {
      await imSay(bro('Ton capteur n\'a presque plus de batterie : il arrête de mesurer pour la protéger. Recharge-le vite. 🔋', 'Batterie faible. Il ne mesure plus. Recharge.'), 850, 'concern');
    } else if (state === 'repose') {
      await imSay(bro(
        'Hmm. Ton capteur a été remis sur une couche qui n\'est pas fraîche. Si c\'était censé être un change… ce n\'en était pas un.',
        'Reposé sur une couche pas fraîche. Ce n\'était pas un change.'), 900, 'puzzled');
    }
    await direRetraits(constats);
    try { await imOfferHelp(m); } catch(e) {}
  }

  /* ---- À la fin d'un change PROUVÉ, on dit au capteur « couche fraîche » ----
     C'est ce qui lui apprend à quoi ressemble une couche sèche chez toi.
     La fonction existait côté capteur depuis la v2, mais l'appli ne
     l'appelait nulle part. */
  async function calibrerCapteurApresChange(proof, ctx) {
    if (!proof) return;                                // un change sans preuve n'apprend rien au capteur
    const S = window.HabitrainSensor;
    if (S && S.isConnected()) { await S.recalibrate(); return; }
    if (ctx !== 'pilier' || voiceMode !== 'foxy' || paused) return;
    let enService = false;
    try { const r = await window.storage.get('sensor:vu'); enService = !!(r && r.value); } catch(e) {}
    if (!enService) return;
    talk(TALK.CHECK, 'capteur:calib', async () => {
      const k = await imDemander(bro(
        'Dernière chose : dis à ton capteur que c\'est une couche fraîche. Appuie sur son bouton (la petite LED clignote), puis touche « Reconnecter ».',
        'Appuie sur le bouton du capteur, puis « Reconnecter ». Il doit savoir que c\'est une couche fraîche.'), [
        { k:'go', label:'🔗 Reconnecter mon capteur', dit:false },
        { k:'non', label:'Plus tard', dit:'Plus tard.', soft:true }
      ], 'teach');
      if (k === 'go') {
        const ok = await connecterCapteur();
        if (ok && window.HabitrainSensor.isConnected()) {
          await window.HabitrainSensor.recalibrate();
          await imSay(bro('C\'est fait : il repart de zéro sur cette couche, et il retient à quoi elle ressemble. 🦊', 'Fait. Il repart de zéro.'), 800, 'proud');
        } else {
          await imSay(bro('Il ne s\'est pas connecté — il était peut-être déjà rendormi. Ce n\'est pas grave : il reconnaîtra la couche fraîche tout seul.', 'Pas connecté. Il la reconnaîtra seul.'), 850, 'calm');
        }
      } else {
        await imSay(bro('D\'accord. Il saura reconnaître la couche fraîche tout seul, il lui faut juste un peu plus de temps pour bien apprendre.', 'D\'accord.'), 800, 'calm');
      }
      if (currentM) await imOfferHelp(currentM);
    });
  }

  function renderSensorGuide() {
    const g = document.getElementById('sensorGuide');
    if (!g || g.dataset.filled) return;
    g.dataset.filled = '1';
    const T = (t) => '<div style="font-family:\'Fraunces\',serif;font-weight:600;font-size:16px;color:#5a4326;margin:14px 0 4px">' + t + '</div>';
    g.innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Version courte. Le guide complet (plan du pad, photos à prendre, dépannage) est dans ta documentation.</div>' +
      T('Principe') +
      'Trois bandes de cuivre isolées se posent contre la <b>face extérieure</b> de la couche (avant, milieu, entrejambe), plus une bande de référence à la taille. Le gel mouillé change la capacité vue par chaque bande. Aucun contact avec le liquide ni la peau.' +
      T('Matériel') +
      '• ESP32-C3 SuperMini · • module <b>MPR121</b> (clone nu de préférence) · • SHTC3 (facultatif, pour la température) · • LiPo 1 cellule <b>protégée</b> 250–400 mAh + chargeur TP4056 <b>avec protection</b>, résistance de charge remplacée par une 5,1 kΩ · • interrupteur à glissière · • 2 × 1 MΩ + 100 nF (surveillance batterie) · • ruban de cuivre 10 mm, Kapton, pochette de plastification · • bouton poussoir, résistance 100 kΩ' +
      T('Câblage') +
      'MPR121 : SDA → <b>GPIO6</b>, SCL → <b>GPIO7</b>, 3.3V → 3V3, GND → GND. Électrodes : E0 avant, E1 milieu, E2 entrejambe, E3 référence.<br>Bouton : <b>GPIO4</b> → GND (+100 kΩ vers 3V3).<br>Batterie → chargeur → interrupteur → broche <b>5V</b> de la carte. <b style="color:var(--coral)">Jamais sur 3V3.</b> Pont 1 MΩ / 1 MΩ du + vers <b>GPIO1</b>. Vérifie la polarité de la batterie au multimètre avant de la brancher.' +
      T('Premier démarrage') +
      'Carte « ESP32C3 Dev Module », USB CDC On Boot : Enabled. Aucune bibliothèque à installer. Flashe <b>avec le pad posé à plat sur la table</b> : au tout premier démarrage, il s\'étalonne à vide.' +
      T('À chaque change') +
      'Replace le pad contre la couche fraîche. Il reconnaît seul une couche fraîche en 2 minutes. À un pilier, Foxy te propose de le reconnecter pour lui confirmer — c\'est comme ça qu\'il apprend ta couche sèche.' +
      '<div style="background:#FBF3E0;border:1px solid #ecd9a8;border-radius:10px;padding:10px 12px;margin-top:14px;font-size:12px;font-weight:700;color:#8a6a30">' +
      '🔋 Sécurité : LiPo <u>protégée</u> dans un boîtier rigide, portée à la taille, jamais sous toi ; jamais en charge quand tu la portes. Pad entièrement laminé : aucun métal nu. S\'il chauffe, gonfle ou sent : tu l\'enlèves.' +
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
      const petit = (item.id === 'unlock');
      const txt = await QR.payloadFor(item.id, true);
      QR.drawQR(cv, txt, petit ? 170 : 140, 'M');
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
    // on coupe net ce qui était en train de se dire et on vide la boîte :
    // sinon une phrase entamée reste derrière l'écran et réapparaît à l'entrée.
    try { talkForce(); } catch(e) {}
    try { imClear(); } catch(e) {}

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
    // --- Deux voies de déverrouillage, clairement séparées ---
    // Le tag NFC écoute tout seul dès l'affichage de l'écran : rien à appuyer,
    // tu approches ton poignet. Le bouton, lui, ouvre la caméra pour le QR.
    const hint = document.getElementById('qrLockHint');
    const btn = document.getElementById('qrUnlockBtn');
    const NFC = window.HabitrainNFC;
    const nfcDispo = !!(NFC && NFC.supported());

    const ouvrir = () => {
      sessionUnlocked = true;
      lock.style.display = 'none';
      if (lockClockTimer) { clearInterval(lockClockTimer); lockClockTimer = null; }
      try { if (NFC && NFC.isScanning()) NFC.stopScan(); } catch(e) {}
      // Maintenant seulement, Foxy a droit à la parole. Son accueil a été
      // avalé par le silence du verrou : on le rejoue, puis on laisse repartir
      // ce qui patientait dans la file.
      setTimeout(async () => {
        try {
          if (immersive) await imRunMoment();
          else await renderMoment();
        } catch(e) {}
        try { talkSuivante(); } catch(e) {}
      }, 250);
    };

    if (hint) {
      hint.innerHTML = nfcDispo
        ? '<span class="qrlock-nfc">📶 Approche ton tag</span><br><span class="qrlock-or">ou utilise le bouton pour ton QR</span>'
        : '<span class="qrlock-or">Scanne le QR de ton bracelet pour entrer.</span>';
    }
    if (btn) btn.textContent = '📷 Scanner mon bracelet';

    // écoute NFC passive, relancée à chaque affichage de l'écran
    if (nfcDispo) {
      try {
        NFC.startScan(async (payload) => {
          try {
            const kind = await QR.parsePayloadPublic(payload);
            if (kind === 'unlock') ouvrir();
            else if (hint) hint.innerHTML = '<span class="qrlock-nfc">Ce tag n\'est pas le tien. Réessaie.</span>';
          } catch(e) {}
        });
      } catch(e) { /* NFC indisponible : le bouton reste la voie normale */ }
    }

    if (btn) btn.onclick = () => {
      QR.startScan('unlock', (kind) => { if (kind === 'unlock') ouvrir(); }, { petit: true });
    };
    // secours discret : 3 tapes sur le titre (TOUJOURS actif, anti-blocage)
    let taps = [];
    const title = document.getElementById('qrLockTitle');
    title.onclick = () => {
      const now = Date.now(); taps.push(now); taps = taps.filter(x => now - x < 1200);
      if (taps.length >= 3) { taps = []; ouvrir(); }   // même sortie que le scan
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
  /* ============================================================
     LA SALLE DE JEUX
     Tout ce qui se gagne, se collectionne et se raconte tient dans
     une seule pièce : missions, hauts faits, notre aventure et les
     conseils de Foxy. Il t'accueille à l'entrée — la première fois
     en te faisant visiter, ensuite en te disant où tu en es.
     ============================================================ */
  async function etatSalle() {
    const e = { missions:0, missionsFaites:0, periode:null, badges:0, badgesTotal:0, chapitres:0, chapitresTotal:0, conseils:0 };
    try {
      if (window.HabitrainMissions) {
        const MSx = window.HabitrainMissions;
        await MSx.ensureDaily(todayStr());
        const st = await MSx.getState();
        e.missions = (st.daily || []).length;
        e.missionsFaites = (st.daily || []).filter(id => st.doneD && st.doneD[id]).length;
        if (st.activePeriod) { const p = MSx.periodById(st.activePeriod.id); e.periode = p ? (p.name || p.titre || p.nom) : null; e.periodeJours = MSx.daysLeft(st.activePeriod); }
      }
    } catch(e2) {}
    try {
      if (BG) { const u = await BG.getUnlocked(); e.badgesTotal = BG.BADGES.length; e.badges = BG.BADGES.filter(b => u[b.id]).length; }
    } catch(e2) {}
    try { e.chapitres = (await currentStage()) || 0; } catch(e2) {}
    try { if (window.HabitrainTips) e.conseils = window.HabitrainTips.countTotal ? window.HabitrainTips.countTotal() : 0; } catch(e2) {}
    return e;
  }

  async function ouvrirSalle() {
    const card = document.getElementById('salleCard');
    if (!card) return;
    const montrer = card.style.display === 'none';
    card.style.display = montrer ? '' : 'none';
    const m = document.getElementById('menuPanneau'); if (m) m.style.display = 'none';
    if (!montrer) { majPanneau(); return; }
    // les quatre coins sont repliés : tu ouvres celui qui t'intéresse
    document.querySelectorAll('#salleCard .tiroir').forEach(e => e.style.display = 'none');
    document.querySelectorAll('#salleCard .tiroir-t').forEach(e => e.classList.remove('on'));
    majPanneau();
    const a = document.getElementById('foxyAppel'); if (a) a.remove();
    window.scrollTo({ top: 0, behavior:'smooth' });
    if (voiceMode !== 'foxy' || paused) return;
    // clé unique : rouvrir la salle redonne la parole à Foxy, même s'il vient de parler
    // tu viens d'ouvrir la porte : il te répond tout de suite, même s'il parlait d'autre chose
    talk(TALK.CADRE, 'salle:accueil:' + Date.now(), () => accueilSalle(), { coupe: true });
  }

  async function accueilSalle() {
    const premiere = !(await lireStock('salle:vue', false));
    const e = await etatSalle();
    if (premiere) {
      await ecrireStock('salle:vue', Date.now());
      await imSay(bro(
        'Ah, tu as trouvé la salle de jeux ! 🧸 Viens, je te fais visiter — c\'est ici qu\'on garde tout ce qui est amusant.',
        'La salle de jeux. Je te fais visiter.'), 950, 'joy');
      await imSay(bro(
        '🎯 Tes <b>missions</b> : des petites choses à faire dans la journée. Rien d\'obligatoire — c\'est pour t\'emmener un peu plus loin que d\'habitude.',
        'Les missions : des petites choses à faire dans la journée. Pas obligatoires.'), 1000, 'explain');
      await imSay(bro(
        '🏆 Tes <b>hauts faits</b> : ils s\'attrapent tout seuls, quand tu fais quelque chose pour la première fois ou que tu tiens longtemps. Il y en a ' + (e.badgesTotal || 'plein') + ' à trouver.',
        'Les hauts faits : ' + (e.badgesTotal || 'plein') + ' à attraper. Ils se débloquent tout seuls.'), 1000, 'explain');
      await imSay(bro(
        '🗺️ <b>Notre aventure</b> : l\'histoire qu\'on écrit ensemble. Elle s\'ouvre chapitre par chapitre, au fil de ton mois. C\'est un peu mon carnet à moi.',
        'Notre aventure : l\'histoire, chapitre par chapitre.'), 1000, 'moved');
      await imSay(bro(
        '💡 Et mes <b>conseils</b> : tout ce que j\'ai appris pendant mon programme, rangé là pour toi. Reviens-y quand tu bloques sur quelque chose.',
        'Mes conseils : ce que j\'ai appris. Pour quand tu bloques.'), 1000, 'teach');
      await imSay(bro(
        'Voilà, tu es chez toi ici. Prends ton temps, regarde, et amuse-toi. 🦊💛',
        'Tu es chez toi ici. Regarde.'), 900, 'happy');
      if (currentM) await imOfferHelp(currentM);
      return true;
    }
    const lignes = [];
    if (e.missions) lignes.push('🎯 Missions du jour : <b>' + e.missionsFaites + ' sur ' + e.missions + '</b>' + (e.missionsFaites >= e.missions ? ' — tout est fait !' : ''));
    if (e.periode) lignes.push('🏔️ Mission de période : <b>' + esc(e.periode) + '</b>' + (e.periodeJours ? ' — encore ' + e.periodeJours + ' jour' + (e.periodeJours > 1 ? 's' : '') : ''));
    if (e.badgesTotal) lignes.push('🏆 Hauts faits : <b>' + e.badges + ' sur ' + e.badgesTotal + '</b>');
    if (e.chapitres) lignes.push('🗺️ Notre aventure : <b>' + e.chapitres + ' chapitre' + (e.chapitres > 1 ? 's' : '') + '</b> ouvert' + (e.chapitres > 1 ? 's' : ''));
    await imSay(bro(
      'Te revoilà dans la salle de jeux, ' + nomOu('toi') + ' ! 🧸 Viens voir où tu en es.',
      'Salle de jeux. Regarde où tu en es.'), 900, 'joy');
    if (lignes.length) await imSay(lignes.join('<br>'), 1000, 'explain');
    const reste = e.missions - e.missionsFaites;
    await imSay(reste > 0
      ? bro('Il te reste ' + reste + ' mission' + (reste > 1 ? 's' : '') + ' à faire aujourd\'hui. Tu veux que je t\'en lise une ?',
            'Reste ' + reste + ' mission' + (reste > 1 ? 's' : '') + '.')
      : bro('Tout est fait pour aujourd\'hui. Franchement, bien joué. 🦊', 'Tout est fait aujourd\'hui. Bien.'),
      900, reste > 0 ? 'curious' : 'proud');
    if (currentM) await imOfferHelp(currentM);
    return true;
  }

  (document.getElementById('openSalle')||{addEventListener(){}}).addEventListener('click', () => { ouvrirSalle(); });
  (document.getElementById('retourFoxy')||{addEventListener(){}}).addEventListener('click', () => retourFoxy());
  // départ et retour
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { direAuRevoir(); marquerPresence(); return; }
    talk(TALK.CADRE, 'presence:retour:' + Date.now(), () => saluerRetour());
    marquerPresence();
  });
  window.addEventListener('pagehide', () => { direAuRevoir(); marquerPresence(); });
  setInterval(() => { if (document.visibilityState === 'visible') marquerPresence(); }, 60000);
  (document.getElementById('ouvrirMenu')||{addEventListener(){}}).addEventListener('click', () => {
    const m = document.getElementById('menuPanneau');
    if (m) m.style.display = m.style.display === 'none' ? 'flex' : 'none';
  });
  // les tiroirs de la salle de jeux : un seul ouvert à la fois
  document.querySelectorAll('.tiroir-t').forEach(t => {
    t.addEventListener('click', async () => {
      const cible = document.getElementById(t.dataset.tiroir);
      const ouvrir = cible && cible.style.display === 'none';
      document.querySelectorAll('.tiroir-t').forEach(x => {
        x.classList.remove('on');
        const c = document.getElementById(x.dataset.tiroir); if (c) c.style.display = 'none';
      });
      if (!ouvrir) return;
      t.classList.add('on');
      cible.style.display = '';
      try {
        if (t.dataset.tiroir === 'missionsCard') await renderMissions();
        else if (t.dataset.tiroir === 'badgesCard') await renderBadges();
        else if (t.dataset.tiroir === 'questCard') await renderQuest();
        else if (t.dataset.tiroir === 'tipsCard') await renderTips();
      } catch(e) {}
      t.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });
  document.querySelectorAll('#debugCard [data-vm]').forEach(btn => {
    btn.addEventListener('click', () => setVoiceMode(btn.dataset.vm));
  });
  // forcer un pilier maintenant (ouvre le change guidé du pilier)
  document.querySelectorAll('#debugCard [data-force]').forEach(btn => {
    btn.addEventListener('click', () => {
      const labels = { c0900:'Change du matin', c1600:'Change de sortie de sieste', c2230:'Change de nuit' };
      lancerRappelChange({ key: btn.dataset.force, m:0, ctx:'pilier', label: labels[btn.dataset.force] });
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
    const swb = document.getElementById('safewordBtn');
    if (swb) swb.addEventListener('click', async () => {
      // la confirmation s'affiche tout de suite : les bulles de Foxy, elles,
      // attendent qu'on les lise dans le chat
      const fl = document.getElementById('safewordFlash');
      if (fl) { fl.textContent = '✓ C\'est arrêté. Foxy est redevenu doux.'; setTimeout(() => { fl.textContent = ''; }, 6000); }
      try { triggerSafeword(); } catch(e) {}
    });
    document.body.classList.toggle('hardmode', hardMode);
    await loadFoxyOutfit();
    refreshHeadFoxy();
    // le verrouillage se décide AVANT la voix : rien ne doit parler avant l'entrée
    try { await checkQrLock(); } catch(e) {}
    try { await reparerEtats196(); } catch(e) {}
    await loadVoice();
    try { const r = await window.storage.get('queststage'); window._lastStage = (r && r.value) ? JSON.parse(r.value) : 0; } catch(e) { window._lastStage = 0; }
    await loadPause();
    try { await loadFoxyMood(); } catch(e) {}
    try { await loadFoxySerie(); } catch(e) {}
    try { await loadDayMood(); } catch(e) {}
    try { await loadDiscipline(); } catch(e) {}
    try { await loadDesertion(); } catch(e) {}
    try { await chargerBracelet(); } catch(e) {}
    try { await loadProfilNom(); } catch(e) {}
    try { await figerDonneesExistantes(); } catch(e) {}
    // marqueurs pour les hauts faits contextuels
    try {
      if (hardMode) await flagBadge('hardDay');
      if (dayMood && dayMood.surprise) await flagBadge('surpriseDay');
    } catch(e) {}
    try { await loadLiveWardrobe(); } catch(e) {}
    try { await scheduleBraceletChecks(); } catch(e) {}
    try { brancherCapteurTenue(); } catch(e) {}
    try { await verifierFraicheEnRetard(); } catch(e) {}
    scheduleNotifications();
    await renderCheckStat();
    await renderMoment();
    await renderSupMode();
    await renderBreaches();
    try { await renderRegles(); } catch(e) {}
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
    // créneau actif au lancement (45 min de tolérance), non encore fait aujourd'hui
    const dueSlot = creneauCourant(new Date(), 45);
    let alreadyDone = false;
    if (dueSlot) {
      try {
        const r = await window.storage.get('slotdone:'+todayStr());
        const done = (r && r.value) ? JSON.parse(r.value) : {};
        alreadyDone = !!done[dueSlot.key];
      } catch(e) {}
    }

    // --- Popups de démarrage : UNE SEULE peut se déclencher ---
    // Ordre de priorité : couche non remise > arrêt silencieux > onboarding.
    // Si tu es en pause, aucune : c'est la sortie de pause qui prendra le relais.
    let popupPrise = paused;

    // 1) couche commencée à remettre mais jamais terminée (le plus urgent)
    try {
      if (!popupPrise) {
        const r = await window.storage.get('reentry:pending');
        if (r && r.value) {
          const p2 = JSON.parse(r.value);
          const h2 = (Date.now() - p2.start) / 3600000;
          popupPrise = true;
          setTimeout(() => talk(TALK.ACCES, 'reentry:reminder', () => { showReentryReminder(h2, p2.niveau); return attendrePopup(); }), 900);
        }
      }
    } catch(e) {}

    // --- Détection : arrêt silencieux (sans pause déclarée) ---
    try {
      if (!popupPrise) {
        let dejaTraite = null;
        try { const r = await window.storage.get('arret:traite'); if (r && r.value) dejaTraite = JSON.parse(r.value); } catch(e) {}
        if (dejaTraite !== todayStr()) {
          const h = await detecterArretSilencieux();
          if (h > 0) {
            try { await window.storage.set('arret:traite', JSON.stringify(todayStr())); } catch(e) {}
            try { if (h >= 24) await flagBadge('comeback'); } catch(e) {}
            popupPrise = true;
            setTimeout(() => talk(TALK.ACCES, 'arret:silencieux', () => { showArretSilencieux(h); return attendrePopup(); }), 1200);
          }
        }
      }
    } catch(e) {}

    // il te salue au lancement, selon l'heure et le temps passé
    setTimeout(() => talk(TALK.CADRE, 'presence:ouverture', () => saluerRetour()), 1400);

    // le tirage du réveil passe AVANT le change dû : le change du matin
    // vérifie la tenue, il faut donc qu'elle soit tirée
    if (!paused && new Date().getHours() >= 6)
      setTimeout(() => talk(TALK.ACCES, 'reveil:rituel', () => rituelReveil(),
        { verifier: async () => !(await lireStock('reveil:rituel:' + todayStr(), false)) }), 300);

    // premier lancement : guide d'installation
    let obLance = false;
    try { if (!popupPrise) obLance = await maybeStartOnboard(); } catch(e) {}
    if (obLance) popupPrise = true;
    if (paused) { /* mode pause : aucune sollicitation */ }
    else if (dueSlot && !alreadyDone) {
      // le créneau dû est déclaré au chef d'orchestre : s'il y a une discussion
      // d'accès en cours (reprise, arrêt silencieux), il attend sagement son tour.
      const prio = (dueSlot.ctx === 'pilier' || hardMode || discActive()) ? TALK.PILIER : TALK.CHECK;
      setTimeout(() => talk(prio, 'due:'+dueSlot.key, () => lancerRappelChange(dueSlot)), 500);
    }
    // vérif périodique du change dû (persiste tant que non fait, avec snooze)
    setInterval(checkDueChangePeriodic, 60000);
    setInterval(() => { verifierRegression().catch(() => {}); suivreTenueFoxy().catch(() => {}); }, 60000);
    setTimeout(() => { verifierRegression().catch(() => {}); }, 8000);

  })();

  // Rappel de change persistant : re-propose tant que le pilier n'est pas fait
  let dueSnooze = {}; // key -> timestamp jusqu'auquel on ne re-propose pas
  async function checkDueChangePeriodic() {
    if (paused) return;
    if (document.getElementById('overlay').classList.contains('show')) return; // déjà une modale ouverte
    // un pilier reste dû jusqu'à +2 h, un check 45 min
    const due = creneauCourant();
    if (!due) return;
    // déjà fait ?
    try {
      const r = await window.storage.get('slotdone:'+todayStr());
      const done = (r && r.value) ? JSON.parse(r.value) : {};
      if (done[due.key]) return;
    } catch(e) {}
    // snoozé (Plus tard récent) ?
    if (dueSnooze[due.key] && Date.now() < dueSnooze[due.key]) return;
    // pilier = niveau 2, check = niveau 3
    // un change dû ouvre toujours une fenêtre : lui, il a vraiment quelque
    // chose à dire, et il a le droit de couper une discussion moins importante.
    talk(due.ctx === 'pilier' ? TALK.PILIER : TALK.CHECK, 'due:'+due.key,
         () => lancerRappelChange(due), { coupe: true });
  }

  // Enregistrement du service worker (mode hors-ligne / installable)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }