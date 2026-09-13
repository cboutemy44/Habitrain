/* ============================================================
   HABITRAIN — QR des tenues & détection d'entorses
   - Un QR par vêtement de ta garde-robe : tu scannes en t'habillant.
   - L'appli vérifie la conformité avec la tenue tirée du jour.
   - Détection automatique des entorses, proposées à ta confirmation.
   Expose window.HabitrainOutfit.
   ============================================================ */
(function () {

  // identifiant QR d'une tenue : "tenue:<nom>"
  function kindFor(nom) { return 'tenue:' + nom; }
  function nomFromKind(kind) {
    return (kind && kind.indexOf('tenue:') === 0) ? kind.slice(6) : null;
  }

  // ---- Journal des tenues portées ----
  async function getWorn(date) {
    try {
      const r = await window.storage.get('worn:' + date);
      if (r && r.value) { const a = JSON.parse(r.value); if (Array.isArray(a)) return a; }
    } catch (e) {}
    return [];
  }
  // enregistre un habillage : { t, nom, moment }
  async function logWorn(date, nom, moment) {
    const list = await getWorn(date);
    list.push({ t: new Date().toISOString(), nom, moment });
    try { await window.storage.set('worn:' + date, JSON.stringify(list)); } catch (e) {}
    return list;
  }
  // dernière tenue scannée du jour
  async function currentWorn(date) {
    const list = await getWorn(date);
    return list.length ? list[list.length - 1] : null;
  }

  /* ============================================================
     DÉTECTION AUTOMATIQUE DES ENTORSES
     Chaque détection renvoie { id, label, detail, grav }.
     Elles sont PROPOSÉES : l'utilisateur confirme ou écarte.
     ============================================================ */
  const PILIERS = [
    { key:'c0900', m:9*60,     nom:'du matin' },
    { key:'c1600', m:16*60,    nom:'de sortie de sieste' },
    { key:'c2230', m:22*60+30, nom:'de nuit' }
  ];

  // ctx fourni par l'appli : { checks, entry, slotdone, hardMode, tenueDuJour }
  async function detect(date, ctx) {
    const out = [];
    const checks = ctx.checks || [];
    const now = new Date();
    const estAujourdhui = (date === now.toISOString().slice(0,10));
    const nowMin = now.getHours()*60 + now.getMinutes();

    // 1) Pilier manqué : fenêtre passée sans change validé
    for (const p of PILIERS) {
      const fenetreFinie = !estAujourdhui || nowMin > p.m + 120;
      if (fenetreFinie && !(ctx.slotdone || {})[p.key]) {
        out.push({ id:'auto_pilier_'+p.key, label:'Change ' + p.nom + ' manqué',
                   detail:'Aucun change validé dans la fenêtre de ' + Math.floor(p.m/60) + 'h.', grav:'moyenne' });
      }
    }

    // 2) Port excessif : un intervalle au-delà du plafond
    const stamps = checks.filter(c => c.result === 'change_fait' && c.t)
                         .map(c => new Date(c.t).getTime()).sort((a,b)=>a-b);
    const plafond = ctx.hardMode ? 6.5 : 7;
    let maxInt = 0;
    for (let i = 1; i < stamps.length; i++) {
      maxInt = Math.max(maxInt, (stamps[i]-stamps[i-1]) / 3600000);
    }
    if (maxInt > plafond) {
      out.push({ id:'auto_port', label:'Port trop long',
                 detail:'Un intervalle de ' + maxInt.toFixed(1) + 'h entre deux changes (plafond ' + plafond + 'h).', grav:'moyenne' });
    }

    // 3) Couche saturée laissée sans change dans l'heure
    const evts = checks.filter(c => c.t).map(c => ({ t:new Date(c.t).getTime(), r:c.result }))
                       .sort((a,b)=>a.t-b.t);
    for (let i = 0; i < evts.length; i++) {
      if (['etat_sature','sature'].includes(evts[i].r)) {
        const suite = evts.slice(i+1).find(e => e.r === 'change_fait');
        const delai = suite ? (suite.t - evts[i].t)/3600000 : 99;
        if (delai > 1) {
          out.push({ id:'auto_sature', label:'Couche saturée gardée',
                     detail:'Saturée signalée sans change dans l\'heure qui a suivi.', grav:'grave' });
          break;
        }
      }
    }

    // 4) Hydratation négligée
    const bib = ctx.entry ? (ctx.entry.bib || 0) : 0;
    if (ctx.entry && bib < 2) {
      out.push({ id:'auto_hydra', label:'Hydratation négligée',
                 detail: bib + ' biberon(s) sur la journée, pour un objectif de 3.', grav:'legere' });
    }

    // 5) Jour non renseigné (uniquement pour un jour passé)
    if (!estAujourdhui && !ctx.entry && checks.length === 0) {
      out.push({ id:'auto_vide', label:'Journée non suivie',
                 detail:'Aucune donnée enregistrée ce jour-là.', grav:'moyenne' });
    }

    // 6) Tenue : absente ou non conforme
    const worn = await getWorn(date);
    if (!worn.length && (!estAujourdhui || nowMin > 11*60)) {
      out.push({ id:'auto_tenue_absente', label:'Aucune tenue scannée',
                 detail:'Tu n\'as scanné aucun vêtement ABDL aujourd\'hui.', grav:'moyenne' });
    } else if (worn.length && ctx.tenueDuJour) {
      const portees = worn.map(w => w.nom);
      const attendues = [ctx.tenueDuJour.jour, ctx.tenueDuJour.nuit, ctx.tenueDuJour.sieste].filter(Boolean);
      const horsTirage = portees.filter(n => !attendues.includes(n));
      if (horsTirage.length) {
        out.push({ id:'auto_tenue_autre', label:'Tenue non conforme',
                   detail:'Porté « ' + horsTirage[0] + ' » au lieu de la tenue tirée.', grav:'legere' });
      }
    }

    // 7) Ouverture de serrure en urgence (déjà tracée)
    if (checks.some(c => c.result === 'lock_emergency')) {
      out.push({ id:'auto_lock', label:'Serrure ouverte en urgence',
                 detail:'Une ouverture sans condition a été effectuée.', grav:'legere' });
    }

    return out;
  }

  // entorses déjà traitées (confirmées ou écartées) pour ne pas les reproposer
  async function getHandled(date) {
    try {
      const r = await window.storage.get('autobreach:' + date);
      if (r && r.value) return JSON.parse(r.value);
    } catch (e) {}
    return {};
  }
  async function markHandled(date, id, confirmed) {
    const h = await getHandled(date);
    h[id] = confirmed ? 'ok' : 'no';
    try { await window.storage.set('autobreach:' + date, JSON.stringify(h)); } catch (e) {}
  }

  window.HabitrainOutfit = {
    kindFor, nomFromKind, getWorn, logWorn, currentWorn,
    detect, getHandled, markHandled
  };
})();
