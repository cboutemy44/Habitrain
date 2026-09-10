/* ============================================================
   HABITRAIN — Module serrures (Web Bluetooth) — MULTI-SERRURES
   Chaque serrure a : un nom, un identifiant (lockId), un secret,
   et ses propres conditions (fenêtres, délai, durée, quota, etc.).
   L'appli évalue les conditions puis commande l'ouverture.
   SÉCURITÉ : une clé de secours mécanique doit toujours exister.
   Expose window.HabitrainLock.
   ============================================================ */
(function () {
  const SERVICE_UUID  = 'hab10ck0-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_CMD_UUID = 'hab10ck1-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_ST_UUID  = 'hab10ck2-c0de-4a11-b0b0-1abe100dc001';

  const PILIERS = [9*60, 16*60, 22*60+30];

  // connexions actives, indexées par lockId
  const conns = {};   // lockId -> { device, charCmd, charSt, connected }
  let onStatusCb = null;

  function newLock(name) {
    return {
      id: 'lk' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      name: name || 'Nouvelle serrure',
      secret: 'CHANGE-MOI-' + Math.random().toString(36).slice(2,8).toUpperCase(),
      enabled: false,
      windowMin: 30,          // ± minutes autour des piliers
      requireChangeDone: true,
      blockDuringPause: true,
      delaySec: 120,          // délai imposé après demande
      openSec: 5,             // durée d'ouverture de la gâche
      dailyQuota: 4,
      useWindows: true        // si false : pas de contrainte horaire
    };
  }

  function supported() { return (typeof navigator !== 'undefined') && !!navigator.bluetooth; }
  function decode(dv) { try { return new TextDecoder('utf-8').decode(dv).trim(); } catch(e){ return ''; } }
  function todayKey() { return new Date().toISOString().slice(0,10); }

  // ---- persistance de la liste des serrures ----
  async function getLocks() {
    try {
      const r = await window.storage.get('locks:list');
      if (r && r.value) { const a = JSON.parse(r.value); if (Array.isArray(a)) return a; }
    } catch (e) {}
    return [];
  }
  async function saveLocks(list) {
    try { await window.storage.set('locks:list', JSON.stringify(list)); } catch (e) {}
  }
  async function addLock(name) {
    const list = await getLocks();
    const l = newLock(name);
    list.push(l);
    await saveLocks(list);
    return l;
  }
  async function updateLock(id, patch) {
    const list = await getLocks();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = Object.assign({}, list[i], patch);
    await saveLocks(list);
    return list[i];
  }
  async function removeLock(id) {
    let list = await getLocks();
    list = list.filter(x => x.id !== id);
    await saveLocks(list);
    try { if (conns[id]) { await disconnect(id); delete conns[id]; } } catch (e) {}
  }

  // ---- quota par serrure et par jour ----
  async function getOpensToday(lockId) {
    try { const r = await window.storage.get('lock:opens:'+lockId+':'+todayKey()); if (r && r.value) return JSON.parse(r.value); } catch(e) {}
    return 0;
  }
  async function incOpensToday(lockId) {
    const n = (await getOpensToday(lockId)) + 1;
    try { await window.storage.set('lock:opens:'+lockId+':'+todayKey(), JSON.stringify(n)); } catch(e) {}
    return n;
  }

  // ---- évaluation des conditions d'une serrure donnée ----
  // ctx : { paused:bool, lastPillarDone:bool }
  async function evaluate(lockId, ctx) {
    const list = await getLocks();
    const p = list.find(x => x.id === lockId);
    if (!p) return { ok:false, reason:'Serrure introuvable.' };
    if (!p.enabled) return { ok:false, reason:'« ' + p.name + ' » n\'est pas activée.' };

    if (p.blockDuringPause && ctx && ctx.paused) {
      return { ok:false, reason:'Programme en pause : « ' + p.name + ' » reste verrouillée.' };
    }
    if (p.useWindows) {
      const now = new Date();
      const nowMin = now.getHours()*60 + now.getMinutes();
      const inWindow = PILIERS.some(m => Math.abs(nowMin - m) <= p.windowMin);
      if (!inWindow) {
        const next = PILIERS.find(m => m > nowMin);
        const h = next != null ? Math.floor(next/60) + 'h' + (next%60 ? String(next%60).padStart(2,'0') : '') : '9h demain';
        return { ok:false, reason:'Hors fenêtre. Prochaine : ' + h + ' (± ' + p.windowMin + ' min).' };
      }
    }
    if (p.requireChangeDone && ctx && ctx.lastPillarDone === false) {
      return { ok:false, reason:'Ton change précédent n\'est pas validé. Boucle-le d\'abord.' };
    }
    const opens = await getOpensToday(lockId);
    if (opens >= p.dailyQuota) {
      return { ok:false, reason:'Quota atteint : ' + opens + '/' + p.dailyQuota + ' aujourd\'hui.' };
    }
    return { ok:true, lock:p, delaySec:p.delaySec, opens, quota:p.dailyQuota };
  }

  // ---- connexion BLE à une serrure précise ----
  async function connect(lockId) {
    if (!supported()) throw new Error('Web Bluetooth non supporté (Android/Chrome requis)');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    device.addEventListener('gattserverdisconnected', () => {
      if (conns[lockId]) conns[lockId].connected = false;
      if (onStatusCb) onStatusCb(lockId, 'DISCONNECTED');
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const charCmd = await service.getCharacteristic(CHAR_CMD_UUID);
    let charSt = null;
    try {
      charSt = await service.getCharacteristic(CHAR_ST_UUID);
      await charSt.startNotifications();
      charSt.addEventListener('characteristicvaluechanged', (ev) => {
        if (onStatusCb) onStatusCb(lockId, decode(ev.target.value));
      });
    } catch (e) {}
    conns[lockId] = { device, charCmd, charSt, connected: true };
    return true;
  }
  async function disconnect(lockId) {
    const c = conns[lockId];
    try { if (c && c.device && c.device.gatt.connected) c.device.gatt.disconnect(); } catch (e) {}
    if (c) c.connected = false;
  }
  function isConnected(lockId) { return !!(conns[lockId] && conns[lockId].connected); }

  // ---- ouverture (après evaluate OK + délai écoulé) ----
  async function open(lockId) {
    const c = conns[lockId];
    if (!c || !c.connected) throw new Error('Serrure non connectée');
    const list = await getLocks();
    const p = list.find(x => x.id === lockId);
    if (!p) throw new Error('Serrure introuvable');
    const ms = Math.max(1, (p.openSec || 5)) * 1000;
    // format : OPEN:<secret>:<dureeMs>
    await c.charCmd.writeValue(new TextEncoder().encode('OPEN:' + p.secret + ':' + ms));
    await incOpensToday(lockId);
    return true;
  }
  // Ouverture d'URGENCE : ignore toutes les conditions.
  // Toujours tracée par l'appli comme une entorse — c'est une soupape, pas une triche.
  async function emergencyOpen(lockId) {
    const c = conns[lockId];
    if (!c || !c.connected) throw new Error('Serrure non connectée');
    const list = await getLocks();
    const p = list.find(x => x.id === lockId);
    if (!p) throw new Error('Serrure introuvable');
    const ms = Math.max(1, (p.openSec || 5)) * 1000;
    await c.charCmd.writeValue(new TextEncoder().encode('OPEN:' + p.secret + ':' + ms));
    await incOpensToday(lockId);
    return true;
  }

  async function lockNow(lockId) {
    const c = conns[lockId];
    if (!c || !c.connected) return;
    await c.charCmd.writeValue(new TextEncoder().encode('LOCK'));
  }

  window.HabitrainLock = {
    supported, isConnected,
    getLocks, addLock, updateLock, removeLock,
    connect, disconnect, open, emergencyOpen, lock: lockNow,
    evaluate, getOpensToday,
    onStatus: (cb) => { onStatusCb = cb; }
  };
})();
