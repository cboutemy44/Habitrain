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
  async function payloadFor(kind) {
    const s = await getSecret();
    return 'HABITRAIN|' + s + '|' + kind;
  }
  async function parsePayload(text) {
    const s = await getSecret();
    const parts = (text || '').split('|');
    if (parts.length !== 3 || parts[0] !== 'HABITRAIN' || parts[1] !== s) return null;
    return parts[2]; // kind
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
  function drawQR(canvas, text, size) {
    size = size || 220;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.floor(size / (n + 2));
    const dim = cell * (n + 2);
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + 1) * cell, (r + 1) * cell, cell, cell);
      }
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
    if (ov) ov.style.display = 'none';
    try { if (window.HabitrainNFC && window.HabitrainNFC.isScanning()) window.HabitrainNFC.stopScan(); } catch (e) {}
  }
  // ---- Contrôles caméra : mise au point, zoom, lampe ----
  function setupCameraControls(video, hint) {
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
      zoom.step = caps.zoom.step || 0.1; zoom.value = caps.zoom.min;
      zoom.oninput = () => { track.applyConstraints({ advanced: [{ zoom: parseFloat(zoom.value) }] }).catch(()=>{}); };
    } else if (zoom) { zoom.style.display = 'none'; }

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
  async function startScan(expected, onResult) {
    const ov = document.getElementById('qrScanOverlay');
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrScanCanvas');
    const hint = document.getElementById('qrScanHint');
    if (!ov || !video || !canvas) { onResult && onResult(null); return; }
    ov.style.display = 'flex';
    const nfcOn = window.HabitrainNFC && window.HabitrainNFC.supported();
    hint.textContent = nfcOn ? 'Approche ton tag NFC, ou vise le QR code...' : 'Vise le QR code...';
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
      const contraintes = {
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
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
      setupCameraControls(video, hint);
    } catch (e) {
      hint.textContent = nfcOn
        ? 'Caméra indisponible — mais tu peux approcher ton tag NFC.'
        : 'Caméra indisponible. Vérifie l\'autorisation.';
      if (!nfcOn) return;
      return; // le NFC reste à l'écoute
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let code = window.jsQR ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' }) : null;
        // seconde passe sur le centre de l'image : aide beaucoup quand le QR est petit
        if (!code && window.jsQR) {
          const cw = Math.floor(canvas.width * 0.6), ch = Math.floor(canvas.height * 0.6);
          const cx = Math.floor((canvas.width - cw) / 2), cy = Math.floor((canvas.height - ch) / 2);
          try {
            const centre = ctx.getImageData(cx, cy, cw, ch);
            code = window.jsQR(centre.data, centre.width, centre.height, { inversionAttempts: 'attemptBoth' });
          } catch (e) {}
        }
        if (code && code.data) {
          const kind = await parsePayload(code.data);
          if (kind && (!expected || kind === expected)) {
            stopScan(); onResult && onResult(kind); return;
          } else if (code.data) {
            hint.textContent = 'QR non reconnu, réessaie...';
          }
        }
      }
      scanRAF = requestAnimationFrame(tick);
    };
    scanRAF = requestAnimationFrame(tick);
  }

  // expose l'API
  window.HabitrainQR = {
    QR_ACTIONS, getQrPrefs, saveQrPrefs, actionRequiresScan,
    payloadFor, drawQR, startScan, stopScan, getSecret, parsePayloadPublic: parsePayload
  };
})();
