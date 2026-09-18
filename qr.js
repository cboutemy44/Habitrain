/* ============================================================
   Module QR — Habitrain
   - Génère des QR propres à l'installation (code secret local)
   - Scanne pour VALIDER une action (preuve physique)
   - Verrouillage par bracelet-QR, secours = 3 tapes discrètes
   Dépend de : jsQR (lecture), qrcode (génération), window.storage
   ============================================================ */
(function () {
  'use strict';

  // Actions possibles à valider par QR (l'utilisateur choisit lesquelles en config)
  const QR_ACTIONS = [
    { id: 'change_pilier', label: 'Changes piliers (obligatoires)' },
    { id: 'change_tous',   label: 'Tous les changes' },
    { id: 'biberon',       label: 'Biberons' },
    { id: 'coucher',       label: 'Coucher' }
  ];

  // ---- Secret d'installation : rend TES QR uniques ----
  async function getSecret() {
    try {
      const r = await window.storage.get('qr:secret');
      if (r && r.value) return JSON.parse(r.value);
    } catch (e) {}
    // génère un secret aléatoire une fois
    const s = 'HTX-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    try { await window.storage.set('qr:secret', JSON.stringify(s)); } catch (e) {}
    return s;
  }
  // payload d'un QR : "HABITRAIN|<secret>|<kind>" (kind = id action ou 'unlock')
  //
  // Format COMPACT pour les supports minuscules (bracelet) : "H|<8 car>|<1 lettre>".
  // Moins de caractères = moins de modules dans le QR = des carrés plus gros
  // à taille de papier égale. C'est ce qui rend un QR de bracelet lisible.
  // Le format court va plus loin que raccourcir le texte : en restant sur
  // MAJUSCULES + CHIFFRES + tiret, on reste dans le jeu de caractères
  // « alphanumérique » du standard QR, encodé sur 5,5 bits au lieu de 8.
  // Même contenu, nettement moins de modules.
  const KIND_CODE = { change_pilier:'P', change_tous:'T', biberon:'B', coucher:'C', unlock:'U' };
  const CODE_KIND = { P:'change_pilier', T:'change_tous', B:'biberon', C:'coucher', U:'unlock' };
  function secretCourt(s) { return String(s).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase(); }
  // les tenues et accessoires ont un identifiant libre (wb…) : il passe tel quel,
  // en majuscules, et redescend en minuscules à la lecture.
  function codePour(kind) { return KIND_CODE[kind] || String(kind).toUpperCase(); }

  async function payloadFor(kind, compact) {
    const s = await getSecret();
    if (compact) return 'H-' + secretCourt(s) + '-' + codePour(kind);
    return 'HABITRAIN|' + s + '|' + kind;
  }
  async function parsePayload(text) {
    const s = await getSecret();
    const t = text || '';
    // format court actuel : H-<SECRET>-<CODE>
    if (t.charAt(0) === 'H' && t.charAt(1) === '-') {
      const p = t.split('-');
      if (p.length === 3 && p[1] === secretCourt(s)) {
        return CODE_KIND[p[2]] || p[2].toLowerCase();
      }
      return null;
    }
    const parts = t.split('|');
    if (parts.length !== 3) return null;
    // format complet (impressions d'origine)
    if (parts[0] === 'HABITRAIN' && parts[1] === s) return parts[2];
    // format court intermédiaire (v16.1) : H|<secret>|<CODE>
    if (parts[0] === 'H' && parts[1].toUpperCase() === secretCourt(s)) {
      return CODE_KIND[parts[2]] || parts[2].toLowerCase();
    }
    return null;
  }

  // ---- Préférences : quelles actions demandent un scan ----
  async function getQrPrefs() {
    try { const r = await window.storage.get('qr:prefs'); if (r && r.value) return JSON.parse(r.value); } catch (e) {}
    return { enabled: {}, unlock: false };
  }
  async function saveQrPrefs(p) { try { await window.storage.set('qr:prefs', JSON.stringify(p)); } catch (e) {} }
  // API publique : telle action requiert-elle un scan ?
  async function actionRequiresScan(actionKind) {
    const p = await getQrPrefs();
    if (p.enabled[actionKind]) return true;
    // 'change_tous' couvre aussi les piliers
    if (actionKind === 'change_pilier' && p.enabled['change_tous']) return true;
    return false;
  }

  // ---- Génération : dessine un QR dans un canvas ----
  // ecc : 'M' par défaut, 'L' pour les tout petits supports (moins de modules)
  // jeu de caractères du mode « alphanumérique » du standard QR
  const ALNUM_QR = /^[0-9A-Z $%*+\-.\/:]+$/;
  // mm : largeur d'impression souhaitée du code (hors marge), pour la feuille papier
  function drawQR(canvas, text, size, ecc, mm) {
    size = size || 220;
    const qr = qrcode(0, ecc || 'M');
    // encodage dense quand le contenu s'y prête : 5,5 bits par caractère au lieu
    // de 8. C'est ce qui ramène les QR de tenues de 25×25 à 21×21 modules.
    if (ALNUM_QR.test(text)) {
      try { qr.addData(text, 'Alphanumeric'); } catch (e) { qr.addData(text); }
    } else {
      qr.addData(text);
    }
    qr.make();
    const n = qr.getModuleCount();
    // Marge blanche (« quiet zone ») : la norme en exige 4 modules. J'en mettais 1.
    // Sur un grand QR ça passe ; à 1 cm de côté, le lecteur ne retrouve plus les
    // trois carrés de repère si un bord de plastification les touche.
    const MARGE = 4;
    const total = n + MARGE * 2;
    // cellule entière et jamais trop fine : des bords nets valent mieux qu'une
    // taille exacte, l'impression se règle ensuite en millimètres.
    const cell = Math.max(4, Math.floor(size / total));
    const dim = cell * total;
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + MARGE) * cell, (r + MARGE) * cell, cell, cell);
      }
    }
    // taille d'impression réelle, marge comprise
    if (mm) {
      const mmTotal = mm * (total / n);   // le mm demandé porte sur le code lui-même
      canvas.style.width = mmTotal.toFixed(2) + 'mm';
      canvas.style.height = mmTotal.toFixed(2) + 'mm';
    }
  }

  // ---- Scanner : ouvre la caméra et lit un QR ----
  let scanStream = null, scanRAF = null;
  function stopScan() {
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
    if (scanStream) {
      try { scanStream.getVideoTracks().forEach(t => t.applyConstraints({ advanced: [{ torch: false }] }).catch(()=>{})); } catch(e) {}
      scanStream.getTracks().forEach(t => t.stop()); scanStream = null;
    }
    const bt = document.getElementById('qrTorch'); if (bt) bt.classList.remove('on');
    const vz = document.getElementById('qrVideo'); if (vz) vz.onclick = null;
    const ov = document.getElementById('qrScanOverlay');
    if (ov) { ov.style.display = 'none'; ov.classList.remove('petit'); }
    try { if (window.HabitrainNFC && window.HabitrainNFC.isScanning()) window.HabitrainNFC.stopScan(); } catch (e) {}
  }
  /* ------------------------------------------------------------
     Lecture des PETITS QR (bracelet, étiquette de vêtement)
     Un QR de 1,5 cm vu à 20 cm ne fait qu'une poignée de pixels par
     module. On l'aide de trois façons :
       1. on ne lit que le centre de l'image, recadré de plus en plus serré
       2. on agrandit ce recadrage avant de le décoder (modules plus francs)
       3. on étire le contraste quand la première lecture échoue
     ------------------------------------------------------------ */
  let workCv = null, workCtx = null;
  function zoneDeTravail() {
    if (!workCv) {
      workCv = document.createElement('canvas');
      workCtx = workCv.getContext('2d', { willReadFrequently: true });
    }
    return workCtx;
  }
  // étire le contraste : utile sur un QR imprimé petit, gris ou plastifié
  function etirerContraste(img) {
    const d = img.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 16) {          // échantillonnage : assez précis, peu coûteux
      const l = (d[i]*299 + d[i+1]*587 + d[i+2]*114) / 1000;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    const ecart = max - min;
    if (ecart < 12 || ecart > 200) return false;      // déjà contrasté, ou image vide
    const k = 255 / ecart;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.max(0, Math.min(255, (d[i]   - min) * k));
      d[i+1] = Math.max(0, Math.min(255, (d[i+1] - min) * k));
      d[i+2] = Math.max(0, Math.min(255, (d[i+2] - min) * k));
    }
    return true;
  }
  // lit une zone de l'image vidéo, agrandie à ~700 px de large
  function lireZone(video, sx, sy, sw, sh) {
    if (!window.jsQR || sw < 8 || sh < 8) return null;
    const ctx = zoneDeTravail();
    const f = Math.max(1, Math.min(4, 700 / sw));
    workCv.width  = Math.round(sw * f);
    workCv.height = Math.round(sh * f);
    ctx.imageSmoothingEnabled = false;                 // bords de modules nets plutôt que flous
    try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, workCv.width, workCv.height); }
    catch (e) { return null; }
    let img;
    try { img = ctx.getImageData(0, 0, workCv.width, workCv.height); } catch (e) { return null; }
    let code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (code) return code;
    if (etirerContraste(img)) {
      code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    }
    return code;
  }
  // recadrages successifs, du plus large au plus serré
  const RECADRAGES = [1, 0.6, 0.4, 0.26, 0.17];
  function chercherQR(video, tour) {
    const W = video.videoWidth || video.width, H = video.videoHeight || video.height;
    if (!W || !H) return null;
    // à chaque tour on essaie l'image entière + deux recadrages (alternés),
    // pour garder l'aperçu fluide sans sacrifier les petits codes
    const ordre = [0, 1 + (tour % 2), 3 + (tour % 2)];
    for (const i of ordre) {
      const r = RECADRAGES[i];
      if (r === undefined) continue;
      const sw = Math.floor(W * r), sh = Math.floor(H * r);
      const code = lireZone(video, Math.floor((W-sw)/2), Math.floor((H-sh)/2), sw, sh);
      if (code && code.data) return code;
    }
    return null;
  }

  // ---- Contrôles caméra : mise au point, zoom, lampe ----
  function setupCameraControls(video, hint, petit) {
    const track = scanStream && scanStream.getVideoTracks ? scanStream.getVideoTracks()[0] : null;
    if (!track) return;
    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}

    // Relance la mise au point : on bascule brièvement en manuel puis en continu,
    // ce qui force l'appareil à refaire son autofocus.
    const relancerFocus = async () => {
      if (!caps.focusMode) return false;
      try {
        if (caps.focusMode.includes('single-shot')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
          setTimeout(() => {
            if (caps.focusMode.includes('continuous')) {
              track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
            }
          }, 900);
        } else if (caps.focusMode.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(()=>{});
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
        return true;
      } catch (e) { return false; }
    };

    // bouton dédié + tap n'importe où sur l'image
    const btnFocus = document.getElementById('qrFocus');
    const faireFocus = async () => {
      const ok = await relancerFocus();
      if (hint) {
        hint.textContent = ok ? 'Mise au point…' : 'Éloigne un peu le téléphone (15-20 cm).';
        setTimeout(() => { if (hint) hint.textContent = 'Vise le QR code...'; }, 1600);
      }
    };
    if (btnFocus) btnFocus.onclick = faireFocus;
    video.onclick = faireFocus;

    // zoom optique/numérique si l'appareil le propose
    const zoom = document.getElementById('qrZoom');
    if (zoom && caps.zoom) {
      zoom.style.display = '';
      zoom.min = caps.zoom.min; zoom.max = Math.min(caps.zoom.max, caps.zoom.min + 4);
      zoom.step = caps.zoom.step || 0.1;
      // Petit QR : on zoome d'office. L'objectif ne sait pas faire le point à 5 cm,
      // donc on recule et c'est le zoom qui ramène le code à la bonne taille.
      const depart = petit
        ? Math.min(parseFloat(zoom.max), caps.zoom.min + (caps.zoom.max - caps.zoom.min) * 0.5)
        : caps.zoom.min;
      zoom.value = depart;
      track.applyConstraints({ advanced: [{ zoom: depart }] }).catch(()=>{});
      zoom.oninput = () => { track.applyConstraints({ advanced: [{ zoom: parseFloat(zoom.value) }] }).catch(()=>{}); };
    } else if (zoom) { zoom.style.display = 'none'; }

    // distance de mise au point minimale, quand l'appareil l'expose (macro)
    if (petit && caps.focusDistance) {
      track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: caps.focusDistance.min }] })
        .catch(() => {});
    }

    // lampe
    const btnTorch = document.getElementById('qrTorch');
    if (btnTorch) {
      if (caps.torch) {
        btnTorch.style.display = '';
        let on = false;
        btnTorch.onclick = async () => {
          on = !on;
          try { await track.applyConstraints({ advanced: [{ torch: on }] }); btnTorch.classList.toggle('on', on); }
          catch (e) { on = false; }
        };
      } else { btnTorch.style.display = 'none'; }
    }

    // premier autofocus au lancement
    setTimeout(relancerFocus, 500);
  }

  // onResult(kind|null). expected = kind attendu ('unlock' ou une action) ou null (accepte tout)
  // opt.petit = true : le QR visé est minuscule (bracelet). Déduit pour 'unlock'.
  async function startScan(expected, onResult, opt) {
    opt = opt || {};
    const petit = (opt.petit !== undefined) ? opt.petit : (expected === 'unlock');
    const ov = document.getElementById('qrScanOverlay');
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrScanCanvas');
    const hint = document.getElementById('qrScanHint');
    if (!ov || !video || !canvas) { onResult && onResult(null); return; }
    ov.style.display = 'flex';
    ov.classList.toggle('petit', !!petit);   // affiche le viseur resserré
    const nfcOn = window.HabitrainNFC && window.HabitrainNFC.supported();
    const conseil = petit
      ? 'Petit QR : tiens-le à 15-20 cm dans le carré, bien à plat.'
      : 'Vise le QR code...';
    hint.textContent = nfcOn ? ('Approche ton tag NFC, ou vise le QR code...') : conseil;
    hint.dataset.base = conseil;
    // ---- écoute NFC en parallèle (hybride) : le premier qui répond gagne ----
    if (nfcOn) {
      try {
        window.HabitrainNFC.startScan(async (payload) => {
          const kind = await parsePayload(payload);
          if (kind && (!expected || kind === expected)) {
            stopScan(); onResult && onResult(kind);
          } else {
            hint.textContent = 'Tag NFC non reconnu, réessaie...';
          }
        });
      } catch (e) { /* NFC indisponible : on continue en QR seul */ }
    }
    try {
      // Haute résolution + autofocus continu : indispensable pour lire un petit QR.
      // Sans ça, beaucoup de téléphones restent flous à courte distance.
      // pour un petit QR, chaque pixel compte : on demande le maximum de définition
      const contraintes = {
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: petit ? 2560 : 1920 },
          height: { ideal: petit ? 1440 : 1080 },
          advanced: [{ focusMode: 'continuous' }]
        }
      };
      try {
        scanStream = await navigator.mediaDevices.getUserMedia(contraintes);
      } catch (e1) {
        // certains appareils refusent les contraintes avancées : on retombe au simple
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      }
      video.srcObject = scanStream; video.setAttribute('playsinline', 'true'); await video.play();
      setupCameraControls(video, hint, petit);
    } catch (e) {
      hint.textContent = nfcOn
        ? 'Caméra indisponible — mais tu peux approcher ton tag NFC.'
        : 'Caméra indisponible. Vérifie l\'autorisation.';
      if (!nfcOn) return;
      return; // le NFC reste à l'écoute
    }
    let tour = 0, depuis = Date.now(), relance = 0;
    const tick = async () => {
      if (!scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const code = chercherQR(video, tour++);
        if (code && code.data) {
          const kind = await parsePayload(code.data);
          if (kind && (!expected || kind === expected)) {
            stopScan(); onResult && onResult(kind); return;
          }
          hint.textContent = 'QR non reconnu, réessaie...';
        }
        // rien trouvé depuis un moment : on relance la mise au point toute seule,
        // et on remonte un conseil au lieu de laisser l'écran muet.
        if (petit && Date.now() - depuis > 4000) {
          depuis = Date.now();
          relance++;
          try { const b = document.getElementById('qrFocus'); if (b && b.onclick) b.onclick(); } catch (e) {}
          const conseils = [
            'Recule un peu et laisse le zoom faire le travail.',
            'Cherche une lumière plus douce — les reflets brouillent le code.',
            'Bien à plat dans le carré : un bracelet courbé se lit mal.'
          ];
          hint.textContent = conseils[relance % conseils.length];
        }
      }
      scanRAF = requestAnimationFrame(tick);
    };
    scanRAF = requestAnimationFrame(tick);
  }

  // expose l'API
  window.HabitrainQR = {
    QR_ACTIONS, getQrPrefs, saveQrPrefs, actionRequiresScan,
    payloadFor, drawQR, startScan, stopScan, getSecret, parsePayloadPublic: parsePayload,
    // diagnostic : rejoue la chaîne de lecture sur une image fixe
    testerLecture: (source, tours) => {
      for (let t = 0; t < (tours || 6); t++) {
        const c = chercherQR(source, t);
        if (c && c.data) return c.data;
      }
      return null;
    }
  };
})();
