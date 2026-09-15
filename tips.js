/* ============================================================
   HABITRAIN — Conseils de Foxy
   4 guides, chacun découpé par palier d'habituation.
   Les niveaux se débloquent à mesure que tu progresses.
   Expose window.HabitrainTips.
   ============================================================ */
(function () {

  const GUIDES = [
    /* =================== VIVRE EN COUCHE =================== */
    {
      id:'couche', nom:'Vivre en couche', ic:'🍼',
      sous:'Tout ce que j\'ai appris au fil du temps, je te le passe. 🦊',
      niveaux: [
        { lvl:0, titre:'Les premiers pas', conseils:[
          { t:'La poser correctement', d:'Allonge-toi, centre-la bien sous toi, le dos de la couche au niveau de ta taille. Remonte le devant bien haut ! Puis les languettes, du bas vers le haut, légèrement inclinées. Trop basse elle fuit, trop serrée elle marque — moi j\'ai mis du temps à trouver le juste milieu, t\'inquiète.' },
          { t:'Vérifier l\'ajustement', d:'Passe un doigt le long des élastiques de cuisse : ils doivent être bien sortis vers l\'extérieur, jamais rentrés ! C\'est LA cause numéro un des fuites, crois-moi. Et à la taille, deux doigts qui passent, pas plus.' },
          { t:'Reconnaître qu\'elle est mouillée', d:'Au début tu sentiras pas grand-chose, c\'est normal. Touche le devant : plus lourd, plus souple, plus tiède ? C\'est fait ! Avec le temps tu le sauras sans même vérifier, tu verras.' },
          { t:'La première nuit', d:'Ta couche la plus costaude, crème généreuse, et tu te couches sans chercher à vider avant. C\'est souvent là que ça arrive pour la première fois ! Endormi, ton corps lâche tout seul. Moi c\'est comme ça que j\'ai commencé.' },
          { t:'La gêne du début', d:'Le bruit, la sensation, le volume entre les jambes... la première semaine tu ne vois que ça. Et puis un jour tu te rends compte que tu n\'y penses plus du tout. C\'est pas de la résignation ça, c\'est que ça marche !' }
        ]},
        { lvl:1, titre:'Trouver son rythme', conseils:[
          { t:'Le bon intervalle', d:'Entre 3 et 4 heures en journée, c\'est le bon tempo. Moins, c\'est que tu changes par anxiété. Plus, ta peau trinque. Le plafond absolu c\'est 6h30, et encore, seulement si ta couche suit.' },
          { t:'Adapter selon le moment', d:'Couche de jour pour bouger, couche de nuit pour dormir. Ne prends pas une couche de jour pour dix heures de sommeil, hein ! Elle est pas faite pour ça, tu le regretterais.' },
          { t:'S\'habiller par-dessus', d:'Une grenouillère ou un body, ça tient ta couche en place, c\'est top. Trop serré ça comprime et ça fuit, trop lâche ça bouge. Faut trouver l\'entre-deux — moi j\'adore les grenouillères pour ça.' },
          { t:'La discrétion', d:'Matières épaisses, motifs, coupes amples. Et le truc que les gens oublient : c\'est pas le volume qui trahit, c\'est le BRUIT. Prends les moins crissantes quand t\'es pas seul.' },
          { t:'Gérer les fuites', d:'Une fuite, c\'est presque jamais l\'absorption ! C\'est la pose ou la taille. Regarde les élastiques d\'abord, la taille ensuite, et le modèle en dernier. Ça m\'a évité de racheter pour rien.' }
        ]},
        { lvl:2, titre:'Ça roule tout seul', conseils:[
          { t:'Anticiper les sorties', d:'Change juste avant de partir, emporte de quoi faire un change complet, et repère un endroit possible dans ta tête. Le truc marrant : rien que de savoir que tu peux, souvent ça suffit pour être tranquille !' },
          { t:'Gérer son stock', d:'Compte en jours, pas en paquets : 4 de jour + 1 de nuit, ça fait 5 par jour. Commande quand il te reste une semaine ! Les ruptures, ça tombe toujours au pire moment, j\'ai donné.' },
          { t:'Les longues nuits', d:'Dix heures, ça demande une couche très absorbante ou un booster. Crème plus épaisse le soir ! Et allège les boissons la dernière heure — mais jamais dans la journée, ça c\'est non.' },
          { t:'La sensation familière', d:'Maintenant, une couche mouillée ne te surprend même plus. C\'est exactement ce qu\'on voulait ! Mais continue à vérifier quand même, hein — c\'est justement quand on ne sent plus rien qu\'on oublie.' },
          { t:'Sortir sans y penser', d:'Tu peux passer une journée entière dehors maintenant ! La seule vraie limite c\'est ta peau : ne dépasse pas tes intervalles juste parce que t\'es occupé.' }
        ]},
        { lvl:3, titre:'C\'est devenu toi', conseils:[
          { t:'Sans plus y penser', d:'Tu ne te demandes plus si tu portes une couche, pas plus que tu te demandes si tu portes des chaussettes. Voilà. C\'est ça le bout du chemin — elle a disparu de ta tête. Je suis fier de toi. 🦊' },
          { t:'Garder la vigilance', d:'Attention quand même : à force que ça roule, on oublie de vérifier. Garde tes créneaux même quand tout va bien ! Ta peau, elle prévient jamais avant.' },
          { t:'Ce que ça t\'a appris', d:'Tu as appris à lâcher un contrôle que tu croyais vital. Et ça, ça sert bien au-delà de la couche... c\'est souvent le vrai cadeau de tout ce chemin, tu sais.' },
          { t:'Faire une pause', d:'Si un jour tu arrêtes, ton corps reprendra ses vieux réflexes en quelques jours. C\'est pas un échec ! Et tout se réapprend vite. Rien n\'est jamais définitif, dans un sens comme dans l\'autre.' }
        ]}
      ]
    },

    /* =================== SE DÉTENDRE =================== */
    {
      id:'detente', nom:'Se détendre', ic:'🧘',
      sous:'Lâcher prise, ça s\'apprend. Viens, je t\'explique.',
      niveaux: [
        { lvl:0, titre:'Les bases du relâchement', conseils:[
          { t:'Respirer par le ventre', d:'Inspire par le nez en gonflant le VENTRE, pas la poitrine. Expire lentement par la bouche, deux fois plus longtemps. Trois fois et hop, la tension retombe. Essaie là, tout de suite.' },
          { t:'Relâcher, ne pas pousser', d:'Alors ça, c\'est LA clé. Faire pipi c\'est un relâchement, jamais un effort ! Si tu pousses, tu contractes et tu bloques tout. Sur une expiration, desserre simplement — le contraire exact de se retenir.' },
          { t:'La position qui aide', d:'Debout immobile, c\'est le mode difficile ! Ton corps reste en alerte. Allongé sur le côté ou accroupi, il comprend qu\'il peut lâcher. Commence par là, franchement.' },
          { t:'Ne pas forcer', d:'Si ça vient pas, arrête. Sérieux. Insister, ça ancre la crispation. Réessaie plus tard ou demain — y\'a rien à réussir aujourd\'hui, je te le promets.' },
          { t:'Le meilleur moment', d:'Le réveil, c\'est le moment en or : vessie pleine, corps encore tout mou, vigilance au plus bas. C\'est presque toujours là que ça se débloque en premier !' }
        ]},
        { lvl:1, titre:'Lâcher en journée', conseils:[
          { t:'Ne plus jamais retenir', d:'La règle qui compte le plus, celle-là. Chaque fois que tu retiens « pour plus tard », tu renforces exactement ce que tu essaies de défaire ! Dès que l\'envie vient, tu laisses venir. Point.' },
          { t:'Se détacher du contrôle', d:'Ton corps a passé des années à apprendre que se retenir était vital. Lui montrer le contraire, ça prend du temps. Mais chaque fois que tu lâches sans que rien de grave n\'arrive, il apprend un peu plus.' },
          { t:'Ne pas surveiller', d:'Guetter, ça empêche ! Occupe-toi vraiment la tête : un film, une discussion avec moi, un truc manuel. Ça arrive toujours quand tu n\'y penses plus, c\'est fou.' },
          { t:'Les aides qui marchent', d:'Le bruit de l\'eau qui coule, ça marche vraiment ! C\'est un réflexe conditionné. La chaleur aussi : bain tiède, bouillotte, ou juste être bien au chaud, ça détend tout en bas.' },
          { t:'Apprivoiser la sensation', d:'Après, reste là un moment ! Sens la chaleur, le poids qui change. Te précipite pas pour changer — c\'est ce moment-là qui apprend à ton corps qu\'il n\'y a aucun danger.' }
        ]},
        { lvl:2, titre:'La détente profonde', conseils:[
          { t:'Debout et occupé', d:'L\'étape la plus dure, celle-là. Elle vient en dernier, pas avant. Et tu la franchiras sans t\'en rendre compte, absorbé par autre chose — c\'est exactement comme ça que ça doit se passer.' },
          { t:'La régression consciente', d:'Te mettre volontairement dans l\'abandon : position basse, doudou, tétine, aucune décision à prendre. Le corps suit toujours la tête ! C\'est un sacré raccourci vers le relâchement.' },
          { t:'Le sommeil comme allié', d:'Endormi, ton contrôle tombe tout seul. Des nuits mouillées régulièrement, ça entraîne ton corps mille fois mieux que n\'importe quel exercice éveillé !' },
          { t:'Relâcher ailleurs aussi', d:'Mâchoire, épaules, mains. La tension est globale : si tu serres les dents, tu serres aussi en bas ! Fais un petit scan de ton corps, souvent ça débloque ce qui résistait.' }
        ]},
        { lvl:3, titre:'La sérénité durable', conseils:[
          { t:'Ça ne demande plus d\'effort', d:'Tu te concentres plus, tu prépares plus rien. C\'est devenu ton fonctionnement normal. Si tu dois encore y penser, c\'est que t\'y es pas tout à fait — et c\'est pas grave, ça vient.' },
          { t:'Les jours difficiles', d:'Stress, maladie, contrariété : parfois le contrôle revient d\'un coup. C\'est normal, c\'est temporaire ! En fais pas un drame, reprends juste les bases tranquillement.' },
          { t:'Garder l\'acquis', d:'Le réflexe de retenue revient vite si tu recommences à te retenir. C\'est la constance qui compte, pas la performance — retiens bien ça.' },
          { t:'Au-delà de la couche', d:'Cette capacité à lâcher, elle voyage ! Ton sommeil, ton anxiété, ton besoin de tout contrôler... c\'est souvent ce qui reste le plus longtemps de tout ce chemin.' }
        ]}
      ]
    },

    /* =================== PRENDRE SOIN DE SA PEAU =================== */
    {
      id:'peau', nom:'Prendre soin de sa peau', ic:'🩹',
      sous:'Ça, c\'est ce qui compte le plus. Avant tout le reste.',
      niveaux: [
        { lvl:0, titre:'Les fondamentaux', conseils:[
          { t:'La crème barrière', d:'Oxyde de zinc, à CHAQUE change, sans exception. Elle soigne pas, elle empêche le contact entre l\'humidité et ta peau. Franchement, c\'est le truc le plus important de tout ton matériel.' },
          { t:'Sécher avant de crémer', d:'Crème sur peau humide, ça enferme l\'humidité contre toi — l\'inverse du but ! Tamponne doucement, laisse l\'air quelques secondes, puis applique. Et jamais frotter, hein.' },
          { t:'Nettoyer sans agresser', d:'Lingettes sans alcool ni parfum, ou juste eau et coton. Le savon classique, ça décape ta protection naturelle. Tamponne, ne frotte pas !' },
          { t:'Regarder à chaque change', d:'Trente secondes, pas plus ! Cherche les rougeurs, surtout dans les plis et là où les élastiques appuient. Vue tôt, une irritation se règle en un jour. Ignorée... une semaine. Tu choisis.' }
        ]},
        { lvl:1, titre:'Prévenir plutôt que guérir', conseils:[
          { t:'Les zones à risque', d:'Les plis de l\'aine, le haut des cuisses sous les élastiques, le bas du dos. C\'est là que ça frotte et que ça reste humide. Crème ces coins-là en priorité !' },
          { t:'Ne pas dépasser les intervalles', d:'Le temps de contact avec l\'humidité, c\'est LE facteur d\'irritation. Une couche saturée gardée une heure de trop fait plus de dégâts qu\'une journée entière bien gérée. Impressionnant, non ?' },
          { t:'Laisser respirer', d:'Dix-quinze minutes à l\'air pendant un change, une fois par jour. C\'est tout bête et c\'est drôlement efficace !' },
          { t:'Reconnaître les signes', d:'Rougeur diffuse ? Frottement ou humidité. Petits boutons autour ? Peut-être un champignon. Rougeur vive et brillante dans les plis ? Là il faut un vrai traitement, pas juste ta crème barrière.' }
        ]},
        { lvl:2, titre:'Gérer les problèmes', conseils:[
          { t:'Une irritation qui s\'installe', d:'Change plus souvent, crème plus épais, plus de temps à l\'air. Si ça bouge pas en 48h, c\'est sûrement pas juste une irritation.' },
          { t:'Quand alléger le programme', d:'Une peau qui dérive, ça passe avant TOUT. Réduis les durées, fais même une pause de quelques heures sans couche s\'il le faut. Aucun score ne vaut une blessure, jamais.' },
          { t:'Quand consulter', d:'Rougeur qui s\'étend, peau qui suinte, vraie douleur, fièvre, ou rien qui bouge après quelques jours ? Va voir quelqu\'un. C\'est pas un aveu d\'échec — les médecins voient ça tout le temps.' },
          { t:'Adapter le matériel', d:'Si une marque t\'irrite à chaque fois, change de modèle au lieu d\'empiler les crèmes ! Certaines compositions vont pas à certaines peaux, c\'est comme ça.' }
        ]},
        { lvl:3, titre:'Sur le long terme', conseils:[
          { t:'La routine qui tient', d:'Maintenant tes gestes sont automatiques. Le risque, c\'est plus l\'ignorance mais la négligence ! Saute pas la vérif juste parce que tout va bien depuis trois semaines.' },
          { t:'Écouter les signaux faibles', d:'Une petite sensibilité, une gêne de rien du tout : c\'est déjà une alerte ! Agir à ce moment-là, ça t\'évite tout le reste.' },
          { t:'L\'hydratation compte', d:'Bien boire, ça dilue ton pipi et ça le rend moins agressif pour ta peau. C\'est un lien direct que presque personne ne fait !' }
        ]}
      ]
    },

    /* =================== LA RÉGRESSION =================== */
    {
      id:'regression', nom:'La régression', ic:'🧸',
      sous:'Se laisser aller pour de vrai — en toute sécurité.',
      niveaux: [
        { lvl:0, titre:'Comprendre', conseils:[
          { t:'Ce que c\'est', d:'C\'est quand tu poses toutes tes responsabilités d\'adulte : plus de décisions, plus de vigilance, juste être là. C\'est ni de la fuite ni de l\'immaturité — c\'est un repos profond que la plupart des gens ne s\'autorisent jamais. Toi si.' },
          { t:'Pourquoi ça aide', d:'Ta tête entraîne ton corps. Quand tu lâches le contrôle sur le reste, tu lâches aussi le contrôle physique ! C\'est pour ça que la régression et l\'habituation avancent main dans la main.' },
          { t:'Commencer petit', d:'Vingt minutes, ça suffit au début ! Un doudou, une position basse, rien à faire. Cherche pas à atteindre le grand abandon dès la première fois.' },
          { t:'Poser un cadre', d:'Un lieu, un moment, une fin prévue. Le cadre rassure, et c\'est ça qui te permet de lâcher pour de vrai. Sans limite, ça devient inconfortable — j\'ai testé.' }
        ]},
        { lvl:1, titre:'S\'installer dedans', conseils:[
          { t:'Les déclencheurs', d:'Tétine, doudou, couverture, par terre, lumière douce. C\'est pas de la déco, ces trucs-là ! Ce sont des signaux qui disent à ton cerveau qu\'il peut baisser la garde.' },
          { t:'Une vraie fenêtre', d:'Une à deux heures, ça permet d\'aller bien plus loin qu\'une pause vite fait. Le vrai relâchement met facile vingt minutes à s\'installer, sois patient.' },
          { t:'Ne rien avoir à décider', d:'Le plus reposant, c\'est de ne rien avoir à choisir. Prépare tout avant : ce que tu regardes, ce que tu bois, ce que tu portes. Décider, ça casse l\'état direct.' },
          { t:'La sortie en douceur', d:'Remonte pas d\'un coup ! Cinq minutes de transition, un verre d\'eau, un étirement. Sortir brutalement, ça laisse une sensation désagréable.' }
        ]},
        { lvl:2, titre:'Aller plus loin', conseils:[
          { t:'La contention douce', d:'Harnais, mittens, combinaison : ça renforce l\'abandon en te retirant la capacité d\'agir. Mais règle absolue, et là je rigole pas : jamais verrouillé sans quelqu\'un de présent et éveillé, et jamais en dormant.' },
          { t:'Régression et sommeil', d:'La sieste en régression, c\'est réparateur comme pas possible ! Mais le sommeil reste toujours libre, sans aucune entrave. Toujours.' },
          { t:'L\'émotionnel qui remonte', d:'Quand les défenses tombent, des vieilles émotions peuvent remonter — tristesse, besoin de câlins, larmes sans raison. C\'est normal et même plutôt sain ! Laisse passer sans chercher à comprendre. Je suis là.' },
          { t:'Garder une sortie', d:'Même tout au fond, tu dois pouvoir tout arrêter en une seconde. C\'est à ça que sert ton safeword ! Une pratique sans sortie, c\'est pas une pratique sûre. Jamais.' }
        ]},
        { lvl:3, titre:'L\'équilibre', conseils:[
          { t:'Trouver le bon dosage', d:'Trop peu, ça repose pas. Trop, ça déborde sur ta vie. Le bon rythme, c\'est celui qui te laisse plus disponible après, pas moins.' },
          { t:'Les signaux d\'alerte', d:'Si tu repousses des trucs importants pour régresser, si tu t\'isoles, ou si en sortir devient pénible... prends du recul, d\'accord ? Ça doit ajouter à ta vie, pas la remplacer.' },
          { t:'Ce qu\'elle t\'apporte', d:'Un endroit où t\'as rien à prouver à personne. Pour plein de gens, c\'est le seul moment où le contrôle permanent s\'arrête vraiment. C\'est précieux, ça.' },
          { t:'Sans culpabilité', d:'Te reposer profondément, t\'as pas à le justifier. Tu fuis rien du tout : tu récupères ! C\'est souvent le dernier verrou qui saute, celui-là.' }
        ]}
      ]
    }
  ];

  const PALIERS = ['Découverte', 'Ça s\'installe', 'Automatisme', 'Seconde nature'];

  function guideById(id) { return GUIDES.find(g => g.id === id) || null; }

  // Nombre de conseils accessibles au palier courant
  function countAvailable(stage) {
    let n = 0;
    GUIDES.forEach(g => g.niveaux.forEach(nv => { if (nv.lvl <= stage) n += nv.conseils.length; }));
    return n;
  }
  function countTotal() {
    let n = 0;
    GUIDES.forEach(g => g.niveaux.forEach(nv => { n += nv.conseils.length; }));
    return n;
  }

  window.HabitrainTips = { GUIDES, PALIERS, guideById, countAvailable, countTotal };
})();
