/* ============================================================
   Module QR — Habitrain
   - Génère des QR propres à l'installation (code secret local)
   - Scanne pour VALIDER une action (preuve physique)
   - Verrouillage par bracelet-QR, secours = 3 tapes discrètes
   Dépend de : window.storage. Plus aucune caméra : les tags NFC sont la seule voie.
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
  const KIND_CODE = { change_pilier:'P', change_tous:'T', biberon:'B', coucher:'C', unlock:'U', tetine:'S' };
  const CODE_KIND = { P:'change_pilier', T:'change_tous', B:'biberon', C:'coucher', U:'unlock', S:'tetine' };
  function secretCourt(s) { return String(s).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase(); }
  // les tenues et accessoires ont un identifiant libre (wb…) : il passe tel quel,
  // en majuscules, et redescend en minuscules à la lecture.
  function codePour(kind) { return KIND_CODE[kind] || String(kind).toUpperCase(); }

  /* Repartir de zéro. Le secret est ce qui rend tes codes valables : tant
     qu'il ne change pas, un vieux tag écrit avec lui continue d'ouvrir
     l'appli, même si l'appli l'a oublié. En le remplaçant, TOUT ce qui a été
     écrit avant devient illisible — tags comme QR imprimés. */
  async function rotateSecret() {
    const s = 'HTX-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    try { await window.storage.set('qr:secret', JSON.stringify(s)); } catch (e) {}
    return s;
  }

  async function payloadFor(kind, compact) {
    const s = await getSecret();
    if (compact) return 'H-' + secretCourt(s) + '-' + codePour(kind);
    return 'HABITRAIN|' + s + '|' + kind;
  }
  /* Un tag NFC porte aussi un lien « habitrain://t/<payload> » : c'est lui qui
     fait ouvrir l'application toute seule quand tu approches ton bracelet.
     À la lecture, on retire l'emballage et on retrouve le payload habituel. */
  const LIEN_PREFIXE = 'habitrain://t/';
  function lienPour(payload) { return LIEN_PREFIXE + encodeURIComponent(payload); }
  function payloadDuLien(t) {
    const s = String(t || '').trim();
    if (s.toLowerCase().indexOf(LIEN_PREFIXE) === 0) {
      try { return decodeURIComponent(s.slice(LIEN_PREFIXE.length)); } catch(e) { return s.slice(LIEN_PREFIXE.length); }
    }
    // variante web, si un tag a été écrit avec une adresse https
    const m = s.match(/[?&]h=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch(e) { return m[1]; } }
    return s;
  }

  async function parsePayload(text) {
    const s = await getSecret();
    const t = payloadDuLien(text || '');
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
  /* La caméra, le dessin des QR et leur lecture ont été retirés : tout passe
     désormais par les tags NFC. Ce module ne garde que ce qui fait l'identité
     d'un support — le secret, le format du payload et sa relecture. */


  window.HabitrainQR = {
    QR_ACTIONS, getQrPrefs, saveQrPrefs, actionRequiresScan,
    payloadFor, getSecret, parsePayloadPublic: parsePayload,
    lienPour, payloadDuLien, rotateSecret
  };
})();
