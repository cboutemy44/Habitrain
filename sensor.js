/* ============================================================
   HABITRAIN — Module capteur de couche (Web Bluetooth) — v2
   Enregistreur autonome : le capteur garde un journal horodaté (temps
   relatif). À la connexion, l'appli demande la synchro, recale les
   horodatages sur l'heure réelle du téléphone, intègre les événements,
   puis confirme (ACK) pour vider le journal du capteur.
   Hors-ligne, Android/Chrome. Expose window.HabitrainSensor.
   ============================================================ */
(function () {
  const SERVICE_UUID    = 'habf0x00-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_STATE_UUID = 'habf0x01-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_RAW_UUID   = 'habf0x02-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_LOG_UUID   = 'habf0x03-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_CTRL_UUID  = 'habf0x04-c0de-4a11-b0b0-1abe100dc001';

  let device = null, charState = null, charRaw = null, charLog = null, charCtrl = null;
  let onStateCb = null, onRawCb = null, onLogCb = null;
  let connected = false;
  let logBuffer = '';

  const MAP = { '0': 'sec', '1': 'mouille', '2': 'sature' };

  function supported() { return (typeof navigator !== 'undefined') && !!navigator.bluetooth; }
  function decode(dv) { try { return new TextDecoder('utf-8').decode(dv).trim(); } catch (e) { return ''; } }

  // Reçoit les morceaux du journal ('+' = suite, '.' = dernier), reconstitue,
  // parse "NOW=<now>;<tRel>,<etat>;..." et recale sur l'heure réelle.
  function handleLogChunk(raw) {
    if (!raw) return;
    const flag = raw[0];
    const body = raw.slice(1);
    logBuffer += body;
    if (flag === '.') {
      const full = logBuffer; logBuffer = '';
      parseAndDeliver(full);
    }
  }

  function parseAndDeliver(full) {
    // full = "NOW=123456;tRel,etat;tRel,etat;..."
    const parts = full.split(';').filter(Boolean);
    if (!parts.length || parts[0].indexOf('NOW=') !== 0) { if (onLogCb) onLogCb([]); return; }
    const now = parseInt(parts[0].slice(4), 10);       // temps relatif "maintenant" du capteur
    const realNow = Date.now();                        // heure réelle du téléphone
    const events = [];
    for (let i = 1; i < parts.length; i++) {
      const kv = parts[i].split(',');
      if (kv.length !== 2) continue;
      const tRel = parseInt(kv[0], 10);
      const etat = MAP[kv[1]];
      if (isNaN(tRel) || !etat) continue;
      // recalage : l'événement s'est produit (now - tRel) ms avant maintenant
      const realTime = realNow - (now - tRel);
      events.push({ t: new Date(realTime).toISOString(), state: etat });
    }
    if (onLogCb) onLogCb(events);
    // confirme réception pour vider le journal du capteur
    ackLog();
  }

  async function ackLog() {
    try { if (charCtrl) await charCtrl.writeValue(new TextEncoder().encode('ACK')); } catch (e) {}
  }
  // Signale un change au capteur : il refait sa ligne de base.
  async function recalibrate() {
    try { if (charCtrl) await charCtrl.writeValue(new TextEncoder().encode('CALIB')); } catch (e) {}
  }
  async function requestSync() {
    try { if (charCtrl) await charCtrl.writeValue(new TextEncoder().encode('SYNC')); } catch (e) {}
  }

  async function connect() {
    if (!supported()) throw new Error('Web Bluetooth non supporté (Android/Chrome requis)');
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    device.addEventListener('gattserverdisconnected', () => { connected = false; });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    // état courant
    charState = await service.getCharacteristic(CHAR_STATE_UUID);
    await charState.startNotifications();
    charState.addEventListener('characteristicvaluechanged', (ev) => {
      const v = decode(ev.target.value);            // "etat;now"
      const st = MAP[(v.split(';')[0] || '').trim()];
      if (st && onStateCb) onStateCb(st);
    });

    // valeur brute (calibration)
    try {
      charRaw = await service.getCharacteristic(CHAR_RAW_UUID);
      await charRaw.startNotifications();
      charRaw.addEventListener('characteristicvaluechanged', (ev) => {
        // format SHTC3 : "RH|T|baseRH|baseT"
        const parts = decode(ev.target.value).split('|').map(parseFloat);
        if (parts.length >= 2 && onRawCb) {
          onRawCb({ rh: parts[0], t: parts[1], baseRH: parts[2], baseT: parts[3] });
        }
      });
    } catch (e) {}

    // journal (synchro)
    try {
      charLog = await service.getCharacteristic(CHAR_LOG_UUID);
      await charLog.startNotifications();
      charLog.addEventListener('characteristicvaluechanged', (ev) => {
        handleLogChunk(decode(ev.target.value));
      });
    } catch (e) {}

    // contrôle (SYNC / ACK)
    try { charCtrl = await service.getCharacteristic(CHAR_CTRL_UUID); } catch (e) {}

    connected = true;
    // demande la synchro du journal accumulé pendant que l'appli était fermée
    logBuffer = '';
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
    connect,
    disconnect,
    sync: requestSync,
    recalibrate,
    onState: (cb) => { onStateCb = cb; },   // état temps réel (appli ouverte)
    onRaw:   (cb) => { onRawCb = cb; },      // valeur brute (calibration)
    onLog:   (cb) => { onLogCb = cb; }       // journal recalé [{t: ISO, state}]
  };
})();
