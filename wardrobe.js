/* ============================================================
   HABITRAIN — Garde-robe & stock de couches (personnalisables)
   - Vêtements et accessoires classés par catégorie, éditables.
   - Stock de couches par modèle, avec usage jour/nuit et
     décrément automatique à chaque change.
   Expose window.HabitrainWardrobe.
   ============================================================ */
(function () {

  // ---- Catégories de la garde-robe ----
  const CATEGORIES = [
    { id:'nuit',    label:'Tenues de nuit',   icon:'🌙' },
    { id:'jour',    label:'Tenues de jour',   icon:'☀️' },
    { id:'sieste',  label:'Tenues de sieste', icon:'😴' },
    { id:'access',  label:'Accessoires',      icon:'🧸' },
    { id:'contention', label:'Contention',    icon:'🎽' }
  ];

  // ---- Contenu par défaut (repris de ta garde-robe actuelle) ----
  const DEFAULT_ITEMS = {
    nuit: [
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine',
      'Grenouillère Seenin marine et bleue'
    ],
    jour: [
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine',
      'Grenouillère Seenin marine et bleue',
      'Romper Rearz Safari',
      'Romper Little keeper sleeper marine',
      'Romper marinière',
      'Romper Seenin rouge et marine',
      'Body blanc avion',
      'Body marine'
    ],
    sieste: [
      'Grenouillère polaire bleue (fermeture dorsale)',
      'Grenouillère blanche rayée jaune (fermeture devant)',
      'Little keeper sleeper rayée rouge/marine'
    ],
    access: [
      'Tétine',
      'Doudou',
      'Biberon 600 ml',
      'Cache-couche Rearz Safari'
    ],
    contention: [
      'Harnais fleece à sous-cutale',
      'Mittens',
      'Combinaison Seenin',
      'Culotte Segufix (supervisé uniquement)'
    ]
  };

  async function getWardrobe() {
    try {
      const r = await window.storage.get('wardrobe');
      if (r && r.value) {
        const w = JSON.parse(r.value);
        // complète les catégories manquantes
        CATEGORIES.forEach(c => { if (!Array.isArray(w[c.id])) w[c.id] = (DEFAULT_ITEMS[c.id]||[]).slice(); });
        return w;
      }
    } catch (e) {}
    const w = {};
    CATEGORIES.forEach(c => { w[c.id] = (DEFAULT_ITEMS[c.id]||[]).slice(); });
    return w;
  }
  async function saveWardrobe(w) {
    try { await window.storage.set('wardrobe', JSON.stringify(w)); } catch (e) {}
  }
  async function addItem(cat, name) {
    const w = await getWardrobe();
    if (!w[cat]) w[cat] = [];
    const n = (name || '').trim();
    if (!n || w[cat].includes(n)) return w;
    w[cat].push(n);
    await saveWardrobe(w);
    return w;
  }
  async function renameItem(cat, oldName, newName) {
    const w = await getWardrobe();
    const i = (w[cat] || []).indexOf(oldName);
    const n = (newName || '').trim();
    if (i < 0 || !n) return w;
    w[cat][i] = n;
    await saveWardrobe(w);
    return w;
  }
  async function removeItem(cat, name) {
    const w = await getWardrobe();
    w[cat] = (w[cat] || []).filter(x => x !== name);
    await saveWardrobe(w);
    return w;
  }

  /* ============================================================
     STOCK DE COUCHES — par modèle, avec usage jour / nuit
     ============================================================ */
  function newModel(name, usage, qty) {
    return {
      id: 'dp' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      name: name || 'Nouveau modèle',
      usage: usage || 'jour',   // 'jour' | 'nuit' | 'both'
      qty: qty || 0,
      alertAt: 5                // seuil d'alerte stock bas
    };
  }
  const DEFAULT_STOCK = [
    { id:'dp_crinklz', name:'Crinklz',            usage:'jour', qty:0, alertAt:5 },
    { id:'dp_safari',  name:'Rearz Safari',       usage:'nuit', qty:0, alertAt:3 },
    { id:'dp_kiddo',   name:'Kiddo Xtreme Night', usage:'nuit', qty:0, alertAt:3 },
    { id:'dp_kpn',     name:'Kiddo Premium Night',usage:'both', qty:0, alertAt:3 }
  ];

  // ---- Seuils d'alerte PAR CATÉGORIE (jour / nuit) ----
  const DEFAULT_THRESHOLDS = { jour: 6, nuit: 4 };
  async function getThresholds() {
    try {
      const r = await window.storage.get('stockthresholds');
      if (r && r.value) return Object.assign({}, DEFAULT_THRESHOLDS, JSON.parse(r.value));
    } catch (e) {}
    return Object.assign({}, DEFAULT_THRESHOLDS);
  }
  async function setThresholds(t) {
    try { await window.storage.set('stockthresholds', JSON.stringify(t)); } catch (e) {}
  }

  // Total disponible pour une période ('jour' | 'nuit'), en comptant les modèles 'both'
  async function totalFor(period) {
    const list = await getStock();
    return list
      .filter(m => m.usage === period || m.usage === 'both')
      .reduce((sum, m) => sum + (m.qty || 0), 0);
  }

  // État du stock par catégorie : { jour:{total,seuil,low,empty}, nuit:{...} }
  async function categoryStatus() {
    const th = await getThresholds();
    const out = {};
    for (const p of ['jour','nuit']) {
      const total = await totalFor(p);
      out[p] = { total, seuil: th[p], low: total <= th[p], empty: total === 0 };
    }
    return out;
  }

  async function getStock() {
    try {
      const r = await window.storage.get('diaperstock');
      if (r && r.value) { const a = JSON.parse(r.value); if (Array.isArray(a)) return a; }
    } catch (e) {}
    return DEFAULT_STOCK.slice();
  }
  async function saveStock(list) {
    try { await window.storage.set('diaperstock', JSON.stringify(list)); } catch (e) {}
  }
  async function addModel(name, usage, qty) {
    const list = await getStock();
    list.push(newModel(name, usage, qty));
    await saveStock(list);
    return list;
  }
  async function updateModel(id, patch) {
    const list = await getStock();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return list;
    list[i] = Object.assign({}, list[i], patch);
    await saveStock(list);
    return list;
  }
  async function removeModel(id) {
    let list = await getStock();
    list = list.filter(x => x.id !== id);
    await saveStock(list);
    return list;
  }

  // modèles utilisables à un moment donné ('jour' ou 'nuit')
  async function modelsFor(period) {
    const list = await getStock();
    return list.filter(m => m.usage === period || m.usage === 'both');
  }

  // Décrémente automatiquement le stock d'un modèle (à chaque change).
  // Si aucun modèle n'est précisé, prend le premier disponible de la période.
  async function consume(period, modelId) {
    const list = await getStock();
    let idx = -1;
    if (modelId) idx = list.findIndex(m => m.id === modelId);
    else idx = list.findIndex(m => (m.usage === period || m.usage === 'both') && m.qty > 0);
    if (idx < 0) return { ok:false, reason:'aucun modèle disponible' };
    if (list[idx].qty <= 0) return { ok:false, reason:'stock épuisé', model:list[idx] };
    list[idx].qty--;
    await saveStock(list);
    // l'alerte se juge au niveau de la CATÉGORIE, pas du modèle seul
    const th = await getThresholds();
    const total = list
      .filter(m => m.usage === period || m.usage === 'both')
      .reduce((sum, m) => sum + (m.qty || 0), 0);
    return {
      ok:true, model:list[idx], period,
      catTotal: total, catSeuil: th[period],
      low: total <= th[period], empty: total === 0
    };
  }

  // catégories en stock bas ou épuisé (remplace l'ancien calcul par modèle)
  async function lowStock() {
    const st = await categoryStatus();
    const out = [];
    ['jour','nuit'].forEach(p => { if (st[p].low) out.push(Object.assign({ period:p }, st[p])); });
    return out;
  }

  window.HabitrainWardrobe = {
    CATEGORIES, getWardrobe, saveWardrobe, addItem, renameItem, removeItem,
    getStock, saveStock, addModel, updateModel, removeModel,
    modelsFor, consume, lowStock, getThresholds, setThresholds, totalFor, categoryStatus
  };
})();
