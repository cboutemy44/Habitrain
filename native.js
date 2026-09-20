/* ============================================================
   Pont natif — Habitrain
   Ne fait strictement rien dans un navigateur : le fichier est chargé
   dans les deux cas, et se désactive tout seul s'il n'y a pas de couche
   native sous lui.

   Ce qu'il apporte dans l'application Android :
     · les rappels sont confiés au système, donc ils sonnent même
       application fermée (en PWA ce sont des minuteurs qui meurent
       avec l'onglet)
     · le plan de rappels est relu à chaque retour au premier plan
     · le bouton retour d'Android ferme d'abord ce qui est ouvert
       (scanner, feuille de QR, fenêtre) au lieu de quitter l'appli
   ============================================================ */
(function () {
  'use strict';

  const Cap = window.Capacitor;
  const natif = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (!natif) { window.HabitrainNatif = { actif: false }; return; }

  const P = Cap.Plugins || {};
  const Notifs = P.LocalNotifications;
  const App = P.App;

  // identifiant numérique stable par rappel (le plugin veut un entier)
  function idPour(cle) {
    let h = 0;
    for (let i = 0; i < cle.length; i++) h = ((h << 5) - h + cle.charCodeAt(i)) | 0;
    return Math.abs(h) % 100000 + 1;
  }

  let dernierPlan = '';

  async function replanifier(forcer) {
    if (!Notifs || typeof window.__habitrainNotifPlan !== 'function') return;
    let plan;
    try { plan = window.__habitrainNotifPlan(); } catch (e) { return; }

    // rien n'a bougé : on ne touche pas au système pour rien
    const signature = JSON.stringify(plan);
    if (!forcer && signature === dernierPlan) return;
    dernierPlan = signature;

    // on repart d'une ardoise propre : c'est le seul moyen fiable de
    // refléter une case décochée dans les réglages
    try {
      const enCours = await Notifs.getPending();
      if (enCours && enCours.notifications && enCours.notifications.length) {
        await Notifs.cancel({ notifications: enCours.notifications.map(n => ({ id: n.id })) });
      }
    } catch (e) {}

    // en pause, Foxy se tait aussi côté système
    if (plan.pause || !plan.items.length) return;

    const aPlanifier = plan.items.map(it => ({
      id: idPour(it.cle),
      title: it.titre,
      body: it.corps,
      schedule: { on: { hour: it.heure, minute: it.minute }, allowWhileIdle: true },
      smallIcon: 'ic_stat_icon',
      iconColor: '#c86b3a'
    }));

    try { await Notifs.schedule({ notifications: aPlanifier }); } catch (e) {}
  }

  async function demarrer() {
    if (Notifs) {
      try {
        let perm = await Notifs.checkPermissions();
        if (perm.display !== 'granted') perm = await Notifs.requestPermissions();
        if (perm.display === 'granted') await replanifier(true);
      } catch (e) {}
    }

    // Le bouton retour d'Android : il ferme ce qui est ouvert, dans l'ordre
    // où les écrans se sont empilés. Il ne quitte l'application que
    // s'il n'y a plus rien à fermer.
    if (App) {
      try {
        App.addListener('backButton', () => {
          const scan = document.getElementById('qrScanOverlay');
          if (scan && scan.style.display && scan.style.display !== 'none') {
            try { window.HabitrainQR.stopScan(); } catch (e) {}
            return;
          }
          if (document.body.classList.contains('qrsheet-on')) {
            document.body.classList.remove('qrsheet-on');
            return;
          }
          const pop = document.getElementById('foxyPop');
          if (pop && pop.style.display && pop.style.display !== 'none') {
            pop.style.display = 'none';
            return;
          }
          const ov = document.getElementById('overlay');
          if (ov && ov.classList.contains('show')) {
            ov.classList.remove('show');
            return;
          }
          try { App.minimizeApp(); } catch (e) { /* on ne tue pas l'appli */ }
        });

        // au retour au premier plan : le plan a pu changer sur un autre écran,
        // et une journée a pu se terminer entre-temps
        App.addListener('appStateChange', (etat) => {
          if (etat && etat.isActive) replanifier(false);
        });
      } catch (e) {}
    }

    // filet : on revérifie le plan toutes les dix minutes tant que l'appli vit
    setInterval(() => replanifier(false), 600000);
  }

  window.HabitrainNatif = {
    actif: true,
    replanifier: () => replanifier(true)
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(demarrer, 1200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(demarrer, 1200));
  }
})();
