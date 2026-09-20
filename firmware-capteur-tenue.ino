/* ============================================================
   Habitrain — capteur d'ouverture de tenue
   ESP32-C3 + contact ILS (reed) + aimant cousu dans la fermeture

   Principe : le module dort en permanence. Il ne se réveille QUE
   lorsque le contact change d'état, horodate l'évènement, et se
   rendort. Il n'allume le Bluetooth que si on le lui demande, ou
   pendant une courte fenêtre après un évènement hors créneau.

   Consommation : ~10 µA en sommeil profond. Sur une LiPo 150 mAh,
   plusieurs mois si tu ne t'ouvres pas la tenue toutes les heures.

   ---- CÂBLAGE ----
     Contact ILS : une patte sur GPIO3, l'autre sur GND
                   (la résistance de tirage interne suffit)
     Aimant      : néodyme Ø6×2 mm, cousu en face du contact
     LiPo        : via TP4056, sortie sur 3V3 et GND
     Bouton      : GPIO9 vers GND — appui = réveil + Bluetooth 60 s

   ILS FERMÉ (aimant en face)   = tenue FERMÉE  → GPIO à 0
   ILS OUVERT (aimant éloigné)  = tenue OUVERTE → GPIO à 1

   ---- BIBLIOTHÈQUES ----
     NimBLE-Arduino (gestionnaire de bibliothèques Arduino)
   ---- CARTE ----
     ESP32C3 Dev Module · USB CDC On Boot : activé
   ============================================================ */

#include <NimBLEDevice.h>
#include <Preferences.h>
#include <esp_sleep.h>

#define PIN_ILS     3      // contact reed
#define PIN_BOUTON  9      // réveil manuel

// Battement : le module se réveille à intervalle régulier pour signer sa
// présence, sans allumer le Bluetooth. Un trou dans la série trahit un
// module éteint, déchargé ou laissé sur une autre tenue — et ce silence
// devient une entorse côté application.
#define BATTEMENT_S  3600  // une signature par heure

#define SERVICE_UUID   "habf0x10-c0de-4a11-b0b0-1abe100dc001"
#define CHAR_ETAT_UUID "habf0x11-c0de-4a11-b0b0-1abe100dc001"
#define CHAR_LOG_UUID  "habf0x12-c0de-4a11-b0b0-1abe100dc001"
#define CHAR_CTRL_UUID "habf0x13-c0de-4a11-b0b0-1abe100dc001"

// L'ESP32 n'a pas de pile d'horloge : l'heure vient du téléphone à chaque
// connexion, et on compte le temps écoulé depuis avec l'horloge interne.
RTC_DATA_ATTR static uint32_t epochBase   = 0;   // heure reçue (secondes)
RTC_DATA_ATTR static uint64_t usBase      = 0;   // µs écoulés au moment de la réception
RTC_DATA_ATTR static bool     dernierEtat = false;

// Journal conservé en mémoire RTC : il survit au sommeil profond.
#define MAX_EVTS 64
RTC_DATA_ATTR static uint32_t evtT[MAX_EVTS];
RTC_DATA_ATTR static uint8_t  evtO[MAX_EVTS];
RTC_DATA_ATTR static uint16_t nbEvts = 0;

// Compteur de battements depuis le dernier accusé de réception. L'application
// compare ce nombre au temps écoulé : s'il en manque, le module a été éteint,
// déchargé, ou laissé sur une autre tenue.
RTC_DATA_ATTR static uint32_t nbBattements = 0;
RTC_DATA_ATTR static uint32_t tDernierBattement = 0;

NimBLECharacteristic *cEtat = nullptr, *cLog = nullptr, *cCtrl = nullptr;
static bool bleActif = false;
static uint32_t bleJusqua = 0;

// --- horloge ---
uint32_t maintenant() {
  if (epochBase == 0) return 0;                        // jamais synchronisé
  uint64_t d = esp_timer_get_time() - usBase;
  return epochBase + (uint32_t)(d / 1000000ULL);
}

void noterEvenement(bool ouvert) {
  uint32_t t = maintenant();
  if (t == 0) t = 1;                                   // horodatage inconnu, mais l'ordre est gardé
  if (nbEvts >= MAX_EVTS) {                            // journal plein : on jette le plus ancien
    for (uint16_t i = 1; i < MAX_EVTS; i++) { evtT[i-1] = evtT[i]; evtO[i-1] = evtO[i]; }
    nbEvts = MAX_EVTS - 1;
  }
  evtT[nbEvts] = t;
  evtO[nbEvts] = ouvert ? 1 : 0;
  nbEvts++;
}

bool lireILS() {
  // contact fermé (aimant présent) → LOW → tenue fermée
  return digitalRead(PIN_ILS) == HIGH;
}

// --- Bluetooth ---
void envoyerJournal() {
  if (!cLog) return;
  String bloc;
  for (uint16_t i = 0; i < nbEvts; i++) {
    char code = (evtO[i] == 2) ? 'H' : (evtO[i] ? 'O' : 'F');
    bloc += String(evtT[i]); bloc += ';'; bloc += code; bloc += '\n';
    if (bloc.length() > 160) {                          // on reste sous la MTU
      cLog->setValue(bloc.c_str()); cLog->notify();
      bloc = ""; delay(30);
    }
  }
  // ligne de vie, toujours en dernier : <date du dernier battement>;H;<nombre>
  bloc += String(tDernierBattement); bloc += ";H;"; bloc += String(nbBattements); bloc += '\n';
  bloc += "END";
  cLog->setValue(bloc.c_str());
  cLog->notify();
}

class CtrlCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    std::string v = c->getValue();
    String s(v.c_str());
    s.trim();
    if (s.startsWith("SYNC:")) {
      epochBase = (uint32_t) s.substring(5).toInt();
      usBase = esp_timer_get_time();
    } else if (s == "DUMP") {
      envoyerJournal();
    } else if (s == "ACK") {
      nbEvts = 0;                                       // l'appli a tout reçu
      nbBattements = 0;                                 // le compteur repart de zéro
    }
    bleJusqua = millis() + 60000;                       // on prolonge la fenêtre
  }
};

void demarrerBLE() {
  if (bleActif) return;
  NimBLEDevice::init("Habitrain-Tenue");
  NimBLEDevice::setPower(ESP_PWR_LVL_P3);               // portée réduite = moins de courant
  NimBLEServer *srv = NimBLEDevice::createServer();
  NimBLEService *svc = srv->createService(SERVICE_UUID);

  cEtat = svc->createCharacteristic(CHAR_ETAT_UUID,
            NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  cLog  = svc->createCharacteristic(CHAR_LOG_UUID,  NIMBLE_PROPERTY::NOTIFY);
  cCtrl = svc->createCharacteristic(CHAR_CTRL_UUID, NIMBLE_PROPERTY::WRITE);
  cCtrl->setCallbacks(new CtrlCB());

  cEtat->setValue(lireILS() ? "O" : "F");
  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();

  bleActif = true;
  bleJusqua = millis() + 60000;
}

void dormir() {
  if (bleActif) { NimBLEDevice::deinit(true); bleActif = false; }
  // réveil sur changement d'état du contact, dans un sens comme dans l'autre
  bool etat = lireILS();
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_ILS,
      etat ? ESP_GPIO_WAKEUP_GPIO_LOW : ESP_GPIO_WAKEUP_GPIO_HIGH);
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_BOUTON, ESP_GPIO_WAKEUP_GPIO_LOW);
  // …et réveil programmé pour le battement
  esp_sleep_enable_timer_wakeup((uint64_t)BATTEMENT_S * 1000000ULL);
  esp_deep_sleep_start();
}

// Le battement ne remplit pas le journal : on incrémente un compteur et on
// retient la date du dernier. L'application en déduit les réveils manquants.
void noterBattement() {
  uint32_t t = maintenant();
  if (t == 0) return;                       // pas encore à l'heure : inutile
  nbBattements++;
  tDernierBattement = t;
}

void setup() {
  pinMode(PIN_ILS, INPUT_PULLUP);
  pinMode(PIN_BOUTON, INPUT_PULLUP);
  delay(40);                                            // anti-rebond du contact

  bool etat = lireILS();
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();

  if (cause == ESP_SLEEP_WAKEUP_TIMER) {
    // réveil de battement : on signe et on se rendort sans rien allumer
    if (etat != dernierEtat) { dernierEtat = etat; noterEvenement(etat); }
    noterBattement();
    dormir();
  }

  if (cause == ESP_SLEEP_WAKEUP_GPIO) {
    if (etat != dernierEtat) {
      dernierEtat = etat;
      noterEvenement(etat);
      if (etat) {
        // Ouverture : on se montre une minute. Si le téléphone est à portée,
        // l'appli reçoit l'évènement tout de suite ; sinon il attend dans le
        // journal, et rien n'est perdu.
        demarrerBLE();
      }
    }
    if (digitalRead(PIN_BOUTON) == LOW) demarrerBLE();   // réveil manuel
  } else {
    // premier démarrage ou reset
    dernierEtat = etat;
    demarrerBLE();
  }

  if (!bleActif) dormir();
}

void loop() {
  // état suivi en continu tant que le Bluetooth est allumé
  static bool dernierPublie = !dernierEtat;
  bool etat = lireILS();
  if (etat != dernierPublie) {
    dernierPublie = etat;
    if (etat != dernierEtat) { dernierEtat = etat; noterEvenement(etat); }
    if (cEtat) { cEtat->setValue(etat ? "O" : "F"); cEtat->notify(); }
  }
  if (millis() > bleJusqua) dormir();
  delay(120);
}
