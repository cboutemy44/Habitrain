/* ============================================================
   HABITRAIN — Module capteur de couche (Web Bluetooth) — v3
   Capteur capacitif (ESP32-C3 + MPR121) posé contre la face extérieure
   de la couche. Il tient un journal horodaté en autonomie ; à la
   connexion, l'appli demande la synchro, recale les heures sur celle du
   téléphone, intègre les évènements, puis confirme (ACK).

   Codes du journal
     0 sec · 1 mouillée · 2 saturée          (identiques à la v2)
     3 capteur retiré (il ne voit plus de corps)
     4 couche fraîche (jugée à la pose, ou CALIB après un change prouvé)
     5 reposé sur une couche qui n'est PAS fraîche
     6 redémarrage (alimentation coupée entre-temps)
     7 batterie faible (le capteur arrête de mesurer pour la protéger)

   Les notifications arrivent en morceaux à la taille du MTU négocié :
   '+' = suite, '.' = dernier (journal ET valeurs brutes).

   Hors-ligne, Android/Chrome. Expose window.HabitrainSensor.
   ============================================================ */
(function () {
  const SERVICE_UUID    = '4ab1c000-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_STATE_UUID = '4ab1c001-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_RAW_UUID   = '4ab1c002-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_LOG_UUID   = '4ab1c003-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_CTRL_UUID  = '4ab1c004-c0de-4a11-b0b0-1abe100dc001';

  let device = null, charState = null, charRaw = null, charLog = null, charCtrl = null;
  let onStateCb = null, onRawCb = null, onLogCb = null, onLienCb = null;
  let connected = false;
  let logBuffer = '', rawBuffer = '';

  const MAP = { '0':'sec', '1':'mouille', '2':'sature', '3':'retire', '4':'fraiche', '5':'repose', '6':'redemarre', '7':'batterie' };

  function supported() { return (typeof navigator !== 'undefined') && !!navigator.bluetooth; }
  function decode(dv) { try { return new TextDecoder('utf-8').decode(dv).trim(); } catch (e) { return ''; } }

  // Journal par morceaux : '+' = suite, '.' = dernier
  function handleLogChunk(raw) {
    if (!raw) return;
    const flag = raw[0];
    logBuffer += raw.slice(1);
    if (flag === '.') { const full = logBuffer; logBuffer = ''; parseAndDeliver(full); }
  }

  // "NOW=<ms>;<t>,<code>;..." — t et NOW sont sur l'horloge du capteur
  function parseAndDeliver(full) {
    const parts = full.split(';').filter(Boolean);
    if (!parts.length || parts[0].indexOf('NOW=') !== 0) { if (onLogCb) onLogCb([]); return; }
    const now = parseInt(parts[0].slice(4), 10);
    const realNow = Date.now();
    const events = [];
    for (let i = 1; i < parts.length; i++) {
      const kv = parts[i].split(',');
      if (kv.length !== 2) continue;
      const tRel = parseInt(kv[0], 10);
      const etat = MAP[kv[1]];
      if (isNaN(tRel) || !etat) continue;
      events.push({ t: new Date(realNow - (now - tRel)).toISOString(), state: etat });
    }
    if (onLogCb) onLogCb(events);
    ackLog();
  }

  /* Valeurs brutes, pour le réglage.
     v3 : "R;z=a,b,c;r=ref;b=a,b,c,ref;e=x,y,z;p=1;n=0;t=33.4;cal=2;air=760;mpr=1"
     v2 (ancien capteur à humidité) : "RH|T|baseRH|baseT" — gardé lisible */
  function parseRaw(s) {
    if (s.indexOf('R;') === 0) {
      const o = { v: 3 };
      s.slice(2).split(';').forEach(kv => {
        const i = kv.indexOf('='); if (i < 0) return;
        const k = kv.slice(0, i), val = kv.slice(i + 1);
        const nums = val.split(',').map(Number);
        if (k === 'z') o.zones = nums;
        else if (k === 'b') o.base = nums;
        else if (k === 'e') o.ecarts = nums;
        else if (k === 'r') o.ref = nums[0];
        else if (k === 'p') o.porte = nums[0] === 1;
        else if (k === 'n') o.niveau = nums[0];
        else if (k === 't') o.temp = nums[0] || null;
        else if (k === 'cal') o.sessions = nums[0];
        else if (k === 'air') o.air = nums[0];
        else if (k === 'mpr') o.mpr = nums[0] === 1;
        else if (k === 'v') o.vbat = nums[0] || null;         // mV, 0 si pas de pont diviseur
      });
      return o;
    }
    const p = s.split('|').map(parseFloat);
    if (p.length >= 2) return { v: 2, rh: p[0], t: p[1], baseRH: p[2], baseT: p[3] };
    return null;
  }

  // v3 : en morceaux ('+' suite, '.' fin) ; v2 : d'un seul tenant
  function handleRawChunk(v) {
    let complet = v;
    if (v[0] === '+' || v[0] === '.') {
      rawBuffer += v.slice(1);
      if (v[0] === '+') return;
      complet = rawBuffer; rawBuffer = '';
    }
    const o = parseRaw(complet);
    if (o && onRawCb) onRawCb(o);
  }

  async function envoyer(cmd) {
    if (!charCtrl) return false;
    try { await charCtrl.writeValue(new TextEncoder().encode(cmd)); return true; } catch (e) { return false; }
  }
  const ackLog      = () => envoyer('ACK');
  const requestSync = () => envoyer('SYNC');
  // À la fin d'un change PROUVÉ : « c'est une couche fraîche, fais-moi confiance »
  const recalibrate = () => envoyer('CALIB');
  // Pad posé à plat sur une table, personne ne le touche
  const etalonnerAir = () => envoyer('AIR');
  // Oublie la référence « couche sèche » apprise (en cas de changement de modèle de couche)
  const oublierReference = () => envoyer('RAZ');
  const reglerSeuils = (mouille, sature) => envoyer('SEUIL:' + Math.round(mouille) + ',' + Math.round(sature));
  const veille = () => envoyer('VEILLE');

  async function connect() {
    if (!supported()) throw new Error('Web Bluetooth non supporté (Android/Chrome requis)');
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    device.addEventListener('gattserverdisconnected', () => { connected = false; if (onLienCb) onLienCb(false); });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    charState = await service.getCharacteristic(CHAR_STATE_UUID);
    await charState.startNotifications();
    charState.addEventListener('characteristicvaluechanged', (ev) => {
      const st = MAP[(decode(ev.target.value).split(';')[0] || '').trim()];
      if (st && onStateCb) onStateCb(st);
    });

    try {
      charRaw = await service.getCharacteristic(CHAR_RAW_UUID);
      await charRaw.startNotifications();
      charRaw.addEventListener('characteristicvaluechanged', (ev) => handleRawChunk(decode(ev.target.value)));
    } catch (e) {}

    try {
      charLog = await service.getCharacteristic(CHAR_LOG_UUID);
      await charLog.startNotifications();
      charLog.addEventListener('characteristicvaluechanged', (ev) => handleLogChunk(decode(ev.target.value)));
    } catch (e) {}

    try { charCtrl = await service.getCharacteristic(CHAR_CTRL_UUID); } catch (e) {}

    connected = true;
    if (onLienCb) onLienCb(true);
    // état courant tout de suite, sans attendre la prochaine notification
    try {
      const v = decode(await charState.readValue());
      const st = MAP[(v.split(';')[0] || '').trim()];
      if (st && onStateCb) onStateCb(st);
    } catch (e) {}
    logBuffer = ''; rawBuffer = '';
    await requestSync();
    return true;
  }

  async function disconnect() {
    try { if (device && device.gatt.connected) device.gatt.disconnect(); } catch (e) {}
    connected = false;
  }

  window.HabitrainSensor = {
    supported,
    isConnected: () => connected,
    connect, disconnect,
    sync: requestSync,
    recalibrate, etalonnerAir, oublierReference, reglerSeuils, veille,
    onState: (cb) => { onStateCb = cb; },   // état temps réel (appli ouverte)
    onRaw:   (cb) => { onRawCb = cb; },     // valeurs brutes (réglage)
    onLog:   (cb) => { onLogCb = cb; },     // journal recalé [{t: ISO, state}]
    onLien:  (cb) => { onLienCb = cb; },    // connexion / déconnexion
    _parseRaw: parseRaw, _parseLog: parseAndDeliver, _morceauLog: handleLogChunk, _morceauRaw: handleRawChunk   // pour les tests
  };
})();
