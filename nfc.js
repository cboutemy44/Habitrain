/* ============================================================
   HABITRAIN — Module NFC (Web NFC) — complément des QR
   Lit des tags NFC (NTAG213/215...) contenant le même identifiant
   que les QR : "HABITRAIN:<clé>:<secret>".
   Android/Chrome uniquement. Expose window.HabitrainNFC.
   ============================================================ */
(function () {
  let reader = null;
  let scanning = false;
  let onTagCb = null;
  let abortCtl = null;

  function supported() {
    return (typeof window !== 'undefined') && ('NDEFReader' in window);
  }

  // décode les enregistrements NDEF et retourne le texte utile
  function readRecords(message) {
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

  // Démarre l'écoute NFC. cb(payload) est appelé au scan d'un tag.
  async function startScan(cb) {
    if (!supported()) throw new Error('Web NFC non supporté (Android/Chrome requis)');
    onTagCb = cb;
    if (scanning) return true;
    reader = new NDEFReader();
    abortCtl = new AbortController();
    await reader.scan({ signal: abortCtl.signal });
    scanning = true;
    reader.onreading = (event) => {
      const payload = readRecords(event.message);
      if (payload && onTagCb) onTagCb(payload);
    };
    reader.onreadingerror = () => { /* tag illisible : on ignore, l'utilisateur réessaie */ };
    return true;
  }

  function stopScan() {
    try { if (abortCtl) abortCtl.abort(); } catch (e) {}
    scanning = false; reader = null; abortCtl = null; onTagCb = null;
  }

  // Écrit un identifiant Habitrain sur un tag vierge (programmation des tags)
  async function writeTag(payload) {
    if (!supported()) throw new Error('Web NFC non supporté (Android/Chrome requis)');
    const w = new NDEFReader();
    await w.write({ records: [{ recordType: 'text', data: payload }] });
    return true;
  }

  /* Lit UNE fois le tag présenté : son numéro de série (l'identité physique du
     tag, qui ne change jamais) et ce qu'il contient déjà. C'est ce qui permet
     de savoir qu'un tag est déjà affecté à autre chose AVANT de l'écraser.
     Renvoie {uid, payload} ou null si rien n'est venu dans le délai. */
  function readTag(timeoutMs) {
    if (!supported()) return Promise.reject(new Error('Web NFC non supporté (Android/Chrome requis)'));
    return new Promise((res, rej) => {
      let fini = false, lecteur = null, ctl = null, minuteur = null;
      const stop = () => { try { if (ctl) ctl.abort(); } catch(e) {} if (minuteur) clearTimeout(minuteur); };
      try {
        lecteur = new NDEFReader();
        ctl = new AbortController();
        lecteur.scan({ signal: ctl.signal }).then(() => {
          lecteur.onreading = (ev) => {
            if (fini) return; fini = true; stop();
            res({ uid: ev.serialNumber || null, payload: readRecords(ev.message) || '' });
          };
          lecteur.onreadingerror = () => { /* tag illisible : on laisse réessayer */ };
        }).catch(e => { if (!fini) { fini = true; stop(); rej(e); } });
      } catch(e) { rej(e); return; }
      minuteur = setTimeout(() => { if (!fini) { fini = true; stop(); res(null); } }, timeoutMs || 20000);
    });
  }

  window.HabitrainNFC = {
    supported,
    isScanning: () => scanning,
    startScan,
    stopScan,
    writeTag,
    readTag
  };
})();
