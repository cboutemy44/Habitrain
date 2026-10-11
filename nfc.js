/* ============================================================
   HABITRAIN — Module NFC (Web NFC) — complément des QR
   Lit des tags NFC (NTAG213/215...) contenant le même identifiant
   que les QR : "HABITRAIN:<clé>:<secret>".
   Android/Chrome uniquement. Expose window.HabitrainNFC.
   ============================================================ */
(function () {
  /* UNE seule écoute, et trois consommateurs par ordre de priorité.
     Avant, l'écoute ne vivait que pendant une preuve : le reste du temps,
     aucun scan n'était actif, et Android reprenait la main sur le tag —
     il ouvrait son propre afficheur et on sortait de l'application. C'est
     la version navigateur du même défaut que le « foreground dispatch »
     côté natif. Maintenant l'écoute tourne en permanence :
       1. une lecture exclusive (programmation d'un tag) ;
       2. une écoute de preuve (une fenêtre attend un tag précis) ;
       3. l'écoute de fond, qui remet tout le reste à l'application. */
  let reader = null;
  let scanning = false;
  let onTagCb = null;        // la preuve en cours
  let fondCb = null;         // l'écoute de fond
  let exclusif = null;       // une lecture qui prend tout, le temps qu'elle dure
  let abortCtl = null;

  function supported() {
    return (typeof window !== 'undefined') && ('NDEFReader' in window);
  }

  // décode les enregistrements NDEF et retourne le texte utile
  function readRecords(message) {
    // le texte d'abord : c'est le payload nu, sans emballage
    for (const rec of message.records) {
      try {
        if (rec.recordType === 'text') {
          const dec = new TextDecoder(rec.encoding || 'utf-8');
          const t = dec.decode(rec.data).trim();
          if (t) return t;
        }
      } catch (e) {}
    }
    for (const rec of message.records) {
      try {
        if (rec.recordType === 'text') {
          const dec = new TextDecoder(rec.encoding || 'utf-8');
          return dec.decode(rec.data).trim();
        }
        if (rec.recordType === 'url') {
          return new TextDecoder().decode(rec.data).trim();
        }
        // fallback : tout ce qui est lisible
        const dec = new TextDecoder();
        const t = dec.decode(rec.data).trim();
        if (t) return t;
      } catch (e) {}
    }
    return '';
  }

  // allume l'écoute si elle ne tourne pas déjà
  async function allumer() {
    if (!supported()) throw new Error('Web NFC non supporté (Android/Chrome requis)');
    if (scanning) return true;
    reader = new NDEFReader();
    abortCtl = new AbortController();
    await reader.scan({ signal: abortCtl.signal });
    scanning = true;
    reader.onreading = (event) => {
      const payload = readRecords(event.message);
      const uid = event.serialNumber || null;
      /* Un tag vierge n'a pas de contenu, seulement un numéro de série. Il
         doit quand même arriver jusqu'à l'application : c'est elle qui dira
         « tag inconnu », et pas Android. */
      const quoi = payload || (uid ? 'uid:' + String(uid).replace(/:/g, '').toUpperCase() : '');
      if (!quoi) return;
      if (exclusif) { const f = exclusif; exclusif = null; try { f({ uid, payload }); } catch (e) {} return; }
      if (onTagCb) { try { onTagCb(quoi); } catch (e) {} return; }
      if (fondCb)  { try { fondCb(quoi); } catch (e) {} }
    };
    reader.onreadingerror = () => { /* tag illisible : on ignore, l'utilisateur réessaie */ };
    return true;
  }

  // Démarre l'écoute NFC. cb(payload) est appelé au scan d'un tag.
  async function startScan(cb) {
    onTagCb = cb;
    return allumer();
  }

  /* L'écoute de fond. Elle ne s'arrête jamais d'elle-même : c'est elle qui
     empêche un tag de repartir au système. */
  async function ecouteDeFond(cb) {
    fondCb = cb;
    try { return await allumer(); } catch (e) { return false; }
  }

  /* On ne coupe QUE la preuve. Couper l'écoute elle-même rendrait de
     nouveau la main à Android dès la fin de la première fenêtre. */
  function stopScan() {
    onTagCb = null;
    if (fondCb) return;                       // l'écoute de fond prend le relais
    try { if (abortCtl) abortCtl.abort(); } catch (e) {}
    scanning = false; reader = null; abortCtl = null;
  }

  /* Écrit un identifiant Habitrain sur un tag.
     DEUX enregistrements, dans cet ordre :
       1. un lien « habitrain://t/<payload> » — c'est celui qu'Android lit pour
          OUVRIR l'application toute seule quand le tag passe près du téléphone ;
       2. le texte brut — lu par tout le reste (Web NFC, autres lecteurs).
     Si le lien est refusé par le navigateur, on écrit le texte seul : le tag
     reste valable, il ne déclenchera simplement pas l'ouverture automatique. */
  async function writeTag(payload) {
    if (!supported()) throw new Error('Web NFC non supporté (Android/Chrome requis)');
    const w = new NDEFReader();
    const QR = window.HabitrainQR;
    const lien = (QR && QR.lienPour) ? QR.lienPour(payload) : null;
    if (lien) {
      try {
        await w.write({ records: [ { recordType:'url', data: lien }, { recordType:'text', data: payload } ] });
        return true;
      } catch (e) { /* lien refusé : on retombe sur le texte seul */ }
    }
    await w.write({ records: [{ recordType: 'text', data: payload }] });
    return true;
  }

  /* Lit UNE fois le tag présenté : son numéro de série (l'identité physique du
     tag, qui ne change jamais) et ce qu'il contient déjà. C'est ce qui permet
     de savoir qu'un tag est déjà affecté à autre chose AVANT de l'écraser.
     Renvoie {uid, payload} ou null si rien n'est venu dans le délai. */
  function readTag(timeoutMs) {
    if (!supported()) return Promise.reject(new Error('Web NFC non supporté (Android/Chrome requis)'));
    /* Elle passe par l'écoute commune, en exclusivité. Ouvrir un SECOND
       lecteur en parallèle de celui de fond faisait arriver le même tag
       deux fois : une fois ici, une fois dans « tag inconnu ». */
    return new Promise((res, rej) => {
      let fini = false, minuteur = null;
      const fin = (v) => { if (fini) return; fini = true;
        if (minuteur) clearTimeout(minuteur);
        if (exclusif === pris) exclusif = null;
        res(v); };
      const pris = (r) => fin({ uid: r.uid, payload: r.payload || '' });
      exclusif = pris;
      allumer().catch(e => { if (!fini) { fini = true; if (exclusif === pris) exclusif = null; rej(e); } });
      minuteur = setTimeout(() => fin(null), timeoutMs || 20000);
    });
  }

  window.HabitrainNFC = {
    supported,
    isScanning: () => scanning,
    startScan,
    ecouteDeFond,
    stopScan,
    writeTag,
    readTag
  };
})();
