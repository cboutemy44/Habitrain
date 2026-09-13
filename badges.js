/* ============================================================
   HABITRAIN — Hauts faits (badges de récompense)
   Catalogue organisé par palier d'habituation. Chaque badge se
   débloque automatiquement à partir des données réelles.
   Expose window.HabitrainBadges.
   ============================================================ */
(function () {

  // niveau : 0 Découverte · 1 Ça s'installe · 2 Automatisme · 3 Seconde nature · 9 intemporel
  // kind : type d'évaluation ; t : seuil
  const BADGES = [

    /* ---------- NIVEAU 0 — DÉCOUVERTE ---------- */
    { id:'b_premier',    n:'Premier pas',            d:'Ta toute première journée renseignée.',           ic:'🌱', lvl:0, kind:'days', t:1 },
    { id:'b_j3',         n:'Trois petits jours',     d:'3 journées de suivi.',                            ic:'📗', lvl:0, kind:'days', t:3 },
    { id:'b_premierwet', n:'Le premier lâcher',      d:'Ta première couche mouillée déclarée.',           ic:'💧', lvl:0, kind:'count', r:'etat_mouille', t:1 },
    { id:'b_nuit1',      n:'Première nuit',          d:'Un réveil avec une couche mouillée.',             ic:'🌙', lvl:0, kind:'count', r:'reveil_mouille', t:1 },
    { id:'b_change1',    n:'Change guidé',           d:'Ton premier change validé avec Foxy.',            ic:'🍼', lvl:0, kind:'count', r:'change_fait', t:1 },
    { id:'b_pilier1',    n:'Premier pilier',         d:'Un change obligatoire tenu dans les temps.',      ic:'🔑', lvl:0, kind:'pillars', t:1 },
    { id:'b_carnet1',    n:'Premiers mots',          d:'Une première entrée dans ton carnet.',            ic:'✍️', lvl:0, kind:'journal', t:1 },
    { id:'b_parle1',     n:'On se parle',            d:'Une première vraie discussion avec Foxy.',        ic:'💬', lvl:0, kind:'introspect', t:1 },
    { id:'b_tenue1',     n:'Bien habillé',           d:'Une tenue scannée pour la première fois.',        ic:'👕', lvl:0, kind:'worn', t:1 },
    { id:'b_serie3',     n:'Trois d\'affilée',       d:'3 jours consécutifs de suivi.',                   ic:'🔗', lvl:0, kind:'streak', t:3 },

    /* ---------- NIVEAU 1 — ÇA S'INSTALLE ---------- */
    { id:'b_j7',         n:'Une semaine',            d:'7 journées de suivi.',                            ic:'📘', lvl:1, kind:'days', t:7 },
    { id:'b_serie7',     n:'Semaine pleine',         d:'7 jours consécutifs sans interruption.',          ic:'⛓️', lvl:1, kind:'streak', t:7 },
    { id:'b_wet25',      n:'Ça vient tout seul',     d:'25 couches mouillées au total.',                  ic:'💦', lvl:1, kind:'count', r:'etat_mouille', t:25 },
    { id:'b_nuit5',      n:'Cinq nuits',             d:'5 réveils avec une couche mouillée.',             ic:'🌜', lvl:1, kind:'count', r:'reveil_mouille', t:5 },
    { id:'b_pilier20',   n:'Le cadre tient',         d:'20 piliers validés.',                             ic:'🗝️', lvl:1, kind:'pillars', t:20 },
    { id:'b_peau7',      n:'Peau impeccable',        d:'7 journées avec une peau au vert.',               ic:'✨', lvl:1, kind:'skin', t:7 },
    { id:'b_hydra7',     n:'Bien hydraté',           d:'7 jours avec tes 3 biberons.',                    ic:'🍶', lvl:1, kind:'hydra', t:7 },
    { id:'b_clean3',     n:'Sans faute',             d:'3 jours consécutifs sans aucune entorse.',        ic:'🎖️', lvl:1, kind:'cleanStreak', t:3 },
    { id:'b_carnet5',    n:'Mon journal',            d:'5 entrées dans ton carnet.',                      ic:'📓', lvl:1, kind:'journal', t:5 },
    { id:'b_confid5',    n:'Confidences',            d:'5 confidences de Foxy récoltées.',                ic:'💛', lvl:1, kind:'confid', t:5 },
    { id:'b_mission3',   n:'Missionnaire',           d:'3 missions de période accomplies.',               ic:'🎯', lvl:1, kind:'missions', t:3 },
    { id:'b_tenue10',    n:'Garde-robe assumée',     d:'10 tenues scannées.',                             ic:'🧥', lvl:1, kind:'worn', t:10 },

    /* ---------- NIVEAU 2 — AUTOMATISME ---------- */
    { id:'b_j14',        n:'Deux semaines',          d:'14 journées de suivi.',                           ic:'📙', lvl:2, kind:'days', t:14 },
    { id:'b_serie14',    n:'Quinzaine parfaite',     d:'14 jours consécutifs.',                           ic:'🔒', lvl:2, kind:'streak', t:14 },
    { id:'b_wet100',     n:'Centurion',              d:'100 couches mouillées au total.',                 ic:'🌊', lvl:2, kind:'count', r:'etat_mouille', t:100 },
    { id:'b_nuit15',     n:'Quinze nuits',           d:'15 réveils mouillés.',                            ic:'🌛', lvl:2, kind:'count', r:'reveil_mouille', t:15 },
    { id:'b_pilier60',   n:'Colonne vertébrale',     d:'60 piliers validés.',                             ic:'🏛️', lvl:2, kind:'pillars', t:60 },
    { id:'b_peau14',     n:'Peau de bébé',           d:'14 journées avec une peau au vert.',              ic:'🧴', lvl:2, kind:'skin', t:14 },
    { id:'b_clean7',     n:'Semaine irréprochable',  d:'7 jours consécutifs sans entorse.',               ic:'🏅', lvl:2, kind:'cleanStreak', t:7 },
    { id:'b_score80',    n:'Bien ancré',             d:'Atteindre 80 points d\'habituation.',             ic:'📈', lvl:2, kind:'score', t:80 },
    { id:'b_carnet15',   n:'Écrivain',               d:'15 entrées dans ton carnet.',                     ic:'📔', lvl:2, kind:'journal', t:15 },
    { id:'b_confid12',   n:'Intime',                 d:'12 confidences de Foxy.',                         ic:'🦊', lvl:2, kind:'confid', t:12 },
    { id:'b_mission6',   n:'Aventurier',             d:'6 missions de période accomplies.',               ic:'🗺️', lvl:2, kind:'missions', t:6 },
    { id:'b_hydra14',    n:'Source intarissable',    d:'14 jours avec tes 3 biberons.',                   ic:'💧', lvl:2, kind:'hydra', t:14 },
    { id:'b_tenue30',    n:'Toujours en tenue',      d:'30 tenues scannées.',                             ic:'👔', lvl:2, kind:'worn', t:30 },
    { id:'b_chap3',      n:'Le voyage avance',       d:'3 chapitres de l\'aventure débloqués.',           ic:'📖', lvl:2, kind:'chapters', t:3 },

    /* ---------- NIVEAU 3 — SECONDE NATURE ---------- */
    { id:'b_j30',        n:'Le mois',                d:'30 journées de suivi.',                           ic:'📕', lvl:3, kind:'days', t:30 },
    { id:'b_j60',        n:'Deux mois',              d:'60 journées de suivi.',                           ic:'📚', lvl:3, kind:'days', t:60 },
    { id:'b_serie30',    n:'Un mois d\'affilée',     d:'30 jours consécutifs sans interruption.',         ic:'⭐', lvl:3, kind:'streak', t:30 },
    { id:'b_wet300',     n:'Naturel',                d:'300 couches mouillées au total.',                 ic:'🏞️', lvl:3, kind:'count', r:'etat_mouille', t:300 },
    { id:'b_nuit30',     n:'Trente nuits',           d:'30 réveils mouillés.',                            ic:'🌌', lvl:3, kind:'count', r:'reveil_mouille', t:30 },
    { id:'b_pilier150',  n:'Inébranlable',           d:'150 piliers validés.',                            ic:'🏰', lvl:3, kind:'pillars', t:150 },
    { id:'b_clean14',    n:'Quinzaine sans faute',   d:'14 jours consécutifs sans entorse.',              ic:'🏆', lvl:3, kind:'cleanStreak', t:14 },
    { id:'b_score95',    n:'Excellence',             d:'Atteindre 95 points d\'habituation.',             ic:'💎', lvl:3, kind:'score', t:95 },
    { id:'b_chap4',      n:'Le voyage accompli',     d:'Les 4 chapitres de l\'aventure débloqués.',       ic:'🎊', lvl:3, kind:'chapters', t:4 },
    { id:'b_confid22',   n:'Tout savoir de Foxy',    d:'22 confidences récoltées.',                       ic:'💝', lvl:3, kind:'confid', t:22 },
    { id:'b_mission10',  n:'Grand explorateur',      d:'10 missions de période accomplies.',              ic:'🧭', lvl:3, kind:'missions', t:10 },
    { id:'b_carnet30',   n:'Mémorialiste',           d:'30 entrées dans ton carnet.',                     ic:'📜', lvl:3, kind:'journal', t:30 },
    { id:'b_peau30',     n:'Peau parfaite',          d:'30 journées avec une peau au vert.',              ic:'🌟', lvl:3, kind:'skin', t:30 },

    /* ---------- INTEMPORELS — situations particulières ---------- */
    { id:'b_nuitlongue', n:'Marathonien nocturne',   d:'Une nuit de 10h ou plus en couche.',              ic:'🛌', lvl:9, kind:'longNight', t:10 },
    { id:'b_matinal',    n:'Lève-tôt',               d:'Un change validé avant 7h du matin.',             ic:'🌅', lvl:9, kind:'earlyChange', t:1 },
    { id:'b_nocturne',   n:'Oiseau de nuit',         d:'Un change validé après minuit.',                  ic:'🦉', lvl:9, kind:'lateChange', t:1 },
    { id:'b_5jour',      n:'Journée chargée',        d:'5 changes ou plus en une seule journée.',         ic:'🔄', lvl:9, kind:'maxDay', t:5 },
    { id:'b_intensif',   n:'À la dure',              d:'Une journée complète en mode intensif.',          ic:'🔥', lvl:9, kind:'hardDay', t:1 },
    { id:'b_discipline', n:'Repris en main',         d:'Terminer une session de discipline.',             ic:'🔓', lvl:9, kind:'discDone', t:1 },
    { id:'b_surprise',   n:'Journée spéciale',       d:'Vivre une journée surprise.',                     ic:'🎁', lvl:9, kind:'surpriseDay', t:1 },
    { id:'b_weekend',    n:'Week-end complet',       d:'Samedi et dimanche suivis d\'affilée.',           ic:'🗓️', lvl:9, kind:'weekend', t:1 },
    { id:'b_retour',     n:'Le retour',              d:'Reprendre après une pause de plus d\'un jour.',   ic:'🏠', lvl:9, kind:'comeback', t:1 },
    { id:'b_perfect',    n:'Journée parfaite',       d:'Toutes tes missions du jour accomplies.',         ic:'✅', lvl:9, kind:'perfectDay', t:1 },
    { id:'b_scan50',     n:'Preuve à l\'appui',      d:'50 validations par scan.',                        ic:'📷', lvl:9, kind:'scans', t:50 },
    { id:'b_capteur',    n:'Connecté',               d:'Synchroniser ton capteur pour la première fois.', ic:'📡', lvl:9, kind:'sensor', t:1 }
  ];

  const NIVEAUX = [
    { lvl:0, nom:'Découverte',      ic:'🌱' },
    { lvl:1, nom:'Ça s\'installe',  ic:'🌿' },
    { lvl:2, nom:'Automatisme',     ic:'🌳' },
    { lvl:3, nom:'Seconde nature',  ic:'🏔️' },
    { lvl:9, nom:'Hauts faits',     ic:'🎖️' }
  ];

  async function getUnlocked() {
    try { const r = await window.storage.get('badges'); if (r && r.value) return JSON.parse(r.value); } catch (e) {}
    return {};
  }
  async function unlock(id) {
    const u = await getUnlocked();
    if (u[id]) return false;
    u[id] = new Date().toISOString();
    try { await window.storage.set('badges', JSON.stringify(u)); } catch (e) {}
    return true;
  }
  function byId(id) { return BADGES.find(b => b.id === id) || null; }

  /* ---------- Médaillons SVG ----------
     Une couleur et une forme par palier : bronze → argent → or → gemme.
     Le symbole (emoji) reste au centre pour la lisibilité. ---------- */
  const MEDAL_STYLES = {
    0: { nom:'bronze', c1:'#c98b52', c2:'#8a5a32', anneau:'#e0a874', pointes:8  },
    1: { nom:'argent', c1:'#cdd3da', c2:'#8b959f', anneau:'#e6ebf0', pointes:10 },
    2: { nom:'or',     c1:'#f0c95a', c2:'#c28f1e', anneau:'#ffe08a', pointes:12 },
    3: { nom:'gemme',  c1:'#9fd6e8', c2:'#4a8fb0', anneau:'#c9ecf7', pointes:14 },
    9: { nom:'rubis',  c1:'#e0857f', c2:'#a84a48', anneau:'#f2b3ae', pointes:6  }
  };

  // Génère le SVG d'un médaillon. ok=false → version verrouillée (grisée).
  function medalSVG(badge, ok, taille) {
    const t = taille || 64;
    const st = MEDAL_STYLES[badge.lvl] || MEDAL_STYLES[9];
    const c1 = ok ? st.c1 : '#cfcfcb';
    const c2 = ok ? st.c2 : '#a8a8a3';
    const an = ok ? st.anneau : '#dedede';
    const uid = 'g' + badge.id.replace(/[^a-z0-9]/gi,'');

    // couronne de pointes autour du médaillon
    let pointes = '';
    const R = 46, r = 38;
    for (let i = 0; i < st.pointes; i++) {
      const a = (i / st.pointes) * Math.PI * 2 - Math.PI/2;
      const x1 = 50 + Math.cos(a) * r, y1 = 50 + Math.sin(a) * r;
      const x2 = 50 + Math.cos(a) * R, y2 = 50 + Math.sin(a) * R;
      pointes += '<line x1="'+x1.toFixed(1)+'" y1="'+y1.toFixed(1)+'" x2="'+x2.toFixed(1)+'" y2="'+y2.toFixed(1)+
                 '" stroke="'+an+'" stroke-width="3.2" stroke-linecap="round" opacity="'+(ok?0.9:0.5)+'"/>';
    }

    return '<svg viewBox="0 0 100 100" width="'+t+'" height="'+t+'" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<radialGradient id="'+uid+'" cx="38%" cy="30%">' +
          '<stop offset="0%" stop-color="'+c1+'"/><stop offset="100%" stop-color="'+c2+'"/>' +
        '</radialGradient>' +
      '</defs>' +
      pointes +
      '<circle cx="50" cy="50" r="37" fill="url(#'+uid+')" stroke="'+an+'" stroke-width="2.5"/>' +
      '<circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.4"/>' +
      // reflet
      '<ellipse cx="40" cy="34" rx="14" ry="9" fill="rgba(255,255,255,'+(ok?0.3:0.15)+')"/>' +
      '<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="30"' +
        (ok ? '' : ' opacity="0.45" style="filter:grayscale(1)"') + '>' + badge.ic + '</text>' +
      (ok ? '' : '<text x="50" y="88" text-anchor="middle" font-size="16">🔒</text>') +
    '</svg>';
  }

  // Badges majeurs : ceux qui méritent une illustration de Foxy
  // (l'image est optionnelle — si le fichier manque, on retombe sur le médaillon)
  // --- Badges majeurs, planche « habillé » (constance, progression, aventure) ---
  const MAJEURS = {
    b_premier:0,   // premier pas
    b_serie7:1,    // coucou sept doigts
    b_serie14:2,   // podium
    b_serie30:3,   // couronne
    b_j30:4,       // calendrier
    b_score95:5,   // diamant
    b_chap4:6,     // livre refermé
    b_clean14:7,   // trophée
    b_pilier150:8, // château
    b_mission10:9, // explorateur
    b_confid22:10, // cœur
    b_j60:11,      // confettis
    b_score80:12, b_clean7:13, b_mission6:14, b_j14:15
  };

  // --- Badges majeurs, planche « en couche » (tout ce qui touche au port) ---
  const MAJEURS_COUCHE = {
    b_premierwet:0,  // fier de sa couche
    b_wet25:1,       // tapote sa couche, content
    b_wet100:2,      // assis, à l'aise
    b_wet300:3,      // sur le dos, jambes en l'air, joyeux
    b_change1:4,     // brandit une couche fraîche
    b_nuit1:5,       // s'étire au réveil
    b_pilier20:6,    // à quatre pattes, insouciant
    b_peau14:7,      // se serre dans ses bras, béat
    b_pilier60:8,    // bras croisés, fier
    b_hydra14:9,     // boit son biberon
    b_nuit15:10,     // endormi en boule
    b_nuit30:11,     // saute de joie
    b_tenue30:12, b_peau30:13, b_nuitlongue:14, b_5jour:15
  };

  function estMajeur(id) { return MAJEURS[id] !== undefined; }
  function foxyIndex(id) { return MAJEURS[id]; }
  function estMajeurCouche(id) { return MAJEURS_COUCHE[id] !== undefined; }
  function coucheIndex(id) { return MAJEURS_COUCHE[id]; }

  window.HabitrainBadges = {
    BADGES, NIVEAUX, getUnlocked, unlock, byId,
    medalSVG, estMajeur, foxyIndex, estMajeurCouche, coucheIndex, MEDAL_STYLES
  };
})();
