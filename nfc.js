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

  window.HabitrainNFC = {
    supported,
    isScanning: () => scanning,
    startScan,
    stopScan,
    writeTag
  };
})();
