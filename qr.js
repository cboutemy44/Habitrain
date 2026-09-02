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
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    const ov = document.getElementById('qrScanOverlay');
    if (ov) ov.style.display = 'none';
  }
  // onResult(kind|null). expected = kind attendu ('unlock' ou une action) ou null (accepte tout)
  async function startScan(expected, onResult) {
    const ov = document.getElementById('qrScanOverlay');
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrScanCanvas');
    const hint = document.getElementById('qrScanHint');
    if (!ov || !video || !canvas) { onResult && onResult(null); return; }
    ov.style.display = 'flex';
    hint.textContent = 'Vise le QR code...';
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = scanStream; video.setAttribute('playsinline', 'true'); await video.play();
    } catch (e) {
      hint.textContent = 'Caméra indisponible. Vérifie l\'autorisation.';
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR ? window.jsQR(img.data, img.width, img.height) : null;
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
    payloadFor, drawQR, startScan, stopScan, getSecret
  };
})();
