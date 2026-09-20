/* ============================================================
   Capteur d'ouverture de tenue — Habitrain
   Un contact ILS (reed) et un aimant cousu dans la fermeture.
   Le module dort et ne se réveille QUE sur changement d'état,
   il horodate l'évènement et le garde jusqu'à la prochaine
   connexion de l'application.

   Ce qu'il prouve : la fermeture a été ouverte, et quand.
   Ce qu'il ne prouve pas : que tu portes encore la tenue.
   L'autorisation, elle, est jugée par l'application — voir
   l'analyse des fenêtres dans app.js.
   ============================================================ */
(function () {
  'use strict';

  const SERVICE_UUID   = 'habf0x10-c0de-4a11-b0b0-1abe100dc001';
  const CHAR_ETAT_UUID = 'habf0x11-c0de-4a11-b0b0-1abe100dc001'; // 'O' ouvert / 'F' fermé
  const CHAR_LOG_UUID  = 'habf0x12-c0de-4a11-b0b0-1abe100dc001'; // journal horodaté
  const CHAR_CTRL_UUID = 'habf0x13-c0de-4a11-b0b0-1abe100dc001'; // 'ACK' / 'SYNC:<epoch>'

  let device = null, server = null;
  let charEtat = null, charLog = null, charCtrl = null;
  let tampon = '';
  const abonnes = { etat: [], evenements: [], lien: [], vie: [] };

  function supported() { return (typeof navigator !== 'undefined') && !!navigator.bluetooth; }
  function decode(dv) { try { return new TextDecoder('utf-8').decode(dv).trim(); } catch (e) { return ''; } }
  function prevenir(liste, val) { liste.forEach(f => { try { f(val); } catch (e) {} }); }

  function surEtat(f) { abonnes.etat.push(f); }
  function surEvenements(f) { abonnes.evenements.push(f); }
  function surLien(f) { abonnes.lien.push(f); }
  function surVie(f) { abonnes.vie.push(f); }

  /* Journal reçu par morceaux. Format d'une ligne :
     <epoch>;<O|F>
     Fin de transmission : une ligne 'END' */
  function morceau(raw) {
    tampon += decode(raw);
    const fin = tampon.indexOf('END');
    if (fin === -1) return;
    const brut = tampon.slice(0, fin);
    tampon = '';
    livrer(brut);
  }

  function livrer(brut) {
    const evts = [];
    let vie = null;                                   // ligne de vie du module
    brut.split(/[\n\r]+/).forEach(ligne => {
      const l = ligne.trim();
      if (!l) return;
      const p = l.split(';');
      if (p.length < 2) return;
      const t = parseInt(p[0], 10);
      const code = p[1].toUpperCase();
      if (code === 'H') {                             // <date>;H;<nb de battements>
        vie = { dernier: (t || 0) * 1000, battements: parseInt(p[2] || '0', 10) || 0 };
        return;
      }
      if (!t || !isFinite(t)) return;
      evts.push({ t: t * 1000, ouvert: code === 'O' });
    });
    evts.sort((a, b) => a.t - b.t);
    if (vie) prevenir(abonnes.vie, vie);
    if (evts.length) prevenir(abonnes.evenements, evts);
    // on accuse réception : le module peut vider sa mémoire
    ackLog().catch(() => {});
  }

  async function ackLog() {
    if (!charCtrl) return;
    await charCtrl.writeValue(new TextEncoder().encode('ACK'));
  }
  // remet le module à l'heure du téléphone (il n'a pas de pile d'horloge)
  async function synchroniser() {
    if (!charCtrl) return;
    const s = 'SYNC:' + Math.floor(Date.now() / 1000);
    await charCtrl.writeValue(new TextEncoder().encode(s));
  }
  async function demanderJournal() {
    if (!charCtrl) return;
    await charCtrl.writeValue(new TextEncoder().encode('DUMP'));
  }

  async function connect() {
    if (!supported()) throw new Error('Bluetooth non disponible (Android/Chrome requis)');
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    device.addEventListener('gattserverdisconnected', () => {
      charEtat = charLog = charCtrl = null;
      prevenir(abonnes.lien, false);
    });
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    charEtat = await service.getCharacteristic(CHAR_ETAT_UUID);
    try {
      await charEtat.startNotifications();
      charEtat.addEventListener('characteristicvaluechanged', (e) => {
        const v = decode(e.target.value).toUpperCase();
        prevenir(abonnes.etat, { ouvert: v.charAt(0) === 'O', a: Date.now() });
      });
    } catch (e) {}

    try {
      charLog = await service.getCharacteristic(CHAR_LOG_UUID);
      await charLog.startNotifications();
      charLog.addEventListener('characteristicvaluechanged', (e) => morceau(e.target.value));
    } catch (e) {}

    try { charCtrl = await service.getCharacteristic(CHAR_CTRL_UUID); } catch (e) {}

    prevenir(abonnes.lien, true);
    // à chaque connexion : on remet à l'heure, puis on rapatrie ce qui s'est
    // passé pendant qu'on était absent
    try { await synchroniser(); } catch (e) {}
    try { await demanderJournal(); } catch (e) {}
    return true;
  }

  async function disconnect() {
    try { if (device && device.gatt && device.gatt.connected) device.gatt.disconnect(); } catch (e) {}
    device = server = charEtat = charLog = charCtrl = null;
    prevenir(abonnes.lien, false);
  }

  function connecte() { return !!(device && device.gatt && device.gatt.connected); }

  // lecture immédiate de l'état, quand on veut vérifier maintenant
  async function lireEtat() {
    if (!charEtat) return null;
    try {
      const v = await charEtat.readValue();
      return decode(v).toUpperCase().charAt(0) === 'O';
    } catch (e) { return null; }
  }

  window.HabitrainTenueSensor = {
    supported, connect, disconnect, connecte, lireEtat,
    synchroniser, demanderJournal,
    surEtat, surEvenements, surLien, surVie,
    UUIDS: { SERVICE_UUID, CHAR_ETAT_UUID, CHAR_LOG_UUID, CHAR_CTRL_UUID }
  };
})();
