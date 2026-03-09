# VShuttle - Sistema di Guida Autonoma per Navette Elettriche

![VShuttle](https://img.shields.io/badge/Next.js-16.1.6-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat&logo=typescript)
![React](https://img.shields.io/badge/React-19.2.3-blue?style=flat&logo=react)

## 📋 Descrizione del Progetto

### Il Problema
Le navette elettriche autonome devono essere in grado di interpretare correttamente la segnaletica stradale per decidere se possono transitare in determinate zone. La sfida principale è gestire:
- **Letture OCR imperfette** da più sensori (camera frontale, laterale, V2I)
- **Segnaletica complessa** con eccezioni (es. "ZTL ECCETTO BUS")
- **Orari variabili** (ZTL attive solo in determinati orari)
- **Situazioni ambigue** dove l'algoritmo non è sicuro al 100%

### L'Approccio Scelto
VShuttle implementa un **sistema decisionale a tre livelli** con supervisione umana:

1. **Fusione Multi-Sensore**: Combina dati da 3 fonti (camera frontale, laterale, V2I receiver) con pesatura intelligente
2. **Pulizia OCR Adattiva**: Corregge errori comuni (1→I, 0→O) con penalità per testo "gibberish"
3. **Valutazione Semantica Contestuale**: Analizza il testo pulito considerando orario e giorno della settimana
4. **Human-in-the-Loop**: Se la confidenza è < 60%, richiede conferma manuale al supervisore (Marco)

### Architettura del Sistema
```
┌─────────────────┐
│  3 Sensori OCR  │ → Camera Frontale, Laterale, V2I
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Fusione Pesata  │ → Selezione migliore lettura + penalità gibberish
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│ Pulizia OCR     │ → Correzione caratteri (1→I, 0→O, ecc.)
└────────┬────────┘
         │
         ↓
    ┌────┴────┐
    │Confidenza│
    │  < 60%? │
    └─┬───┬───┘
  SI  │   │ NO
      │   ↓
      │ ┌──────────────┐
      │ │ Valutazione  │ → ZTL orari, eccezioni, divieti
      │ │  Semantica   │
      │ └──────┬───────┘
      │        ↓
      │   ┌────┴────┐
      │   │ GO/STOP │
      │   └─────────┘
      ↓
┌─────────────────┐
│   INTERVENE     │ → Richiesta manuale a Marco (2s timer)
└─────────────────┘
```

## 🖼️ Visuals

### Dashboard - Modalità Automatica
![Dashboard Automatica](./assets/dashboard-automatica.png)

*La dashboard mostra lo stato della navetta in modalità automatica con il grande pulsante di emergenza rosso. L'azione corrente (GO/STOP) viene visualizzata in alto.*

### Schermata INTERVENE - Richiesta Conferma
![Schermata Intervento](./assets/schermata-intervene.png)
    
*Quando la confidenza dell'algoritmo è < 60%, compare questa schermata split-screen. Marco ha 2 secondi per decidere tra STOP (rosso) e GO (verde). Se non interviene, la navetta si ferma automaticamente (Phantom Braking).*

## 🚀 Setup Infallibile

### Prerequisiti
- **Node.js** versione 18.x o superiore ([Download](https://nodejs.org/))
- **npm** o **yarn** (incluso con Node.js)

### Installazione Dipendenze
```bash
npm install
```

Questo comando installerà automaticamente tutte le dipendenze necessarie:
- Next.js 16.1.6
- React 19.2.3
- TypeScript 5.x
- Tailwind CSS 4.x
- ESLint per il linting del codice

### Verifica Installazione
Per verificare che tutto sia installato correttamente:
```bash
npm list --depth=0
```

Dovresti vedere l'elenco di tutte le dipendenze elencate in `package.json`.

## ▶️ Run Instructions

### Avvio del Server di Sviluppo
```bash
npm run dev
```

Il server si avvierà su `http://localhost:3000`. Apri il browser e visita questo indirizzo.

**Nota**: Il primo avvio potrebbe richiedere qualche secondo per compilare il progetto.

### Avvio della Simulazione
1. Clicca sul pulsante **"START SIMULATION"**
2. La dashboard inizierà a processare automaticamente gli scenari dal file `VShuttle-input.json`
3. Osserva le decisioni dell'algoritmo in tempo reale

### Altri Comandi Disponibili
```bash
# Build per produzione
npm run build

# Avvio in modalità produzione (dopo build)
npm start

# Linting del codice
npm run lint
```

## 🧮 Spiegazione della Formula di Fusione Sensori

### Formula Matematica

Per ogni sensore *i* (camera frontale, laterale, V2I), la **confidenza effettiva** viene calcolata come:

```
Cₑff(i) = (Cᵣₐw(i) - Pɢᵢb(i)) × Wᵢ
```

Dove:
- **Cᵣₐw(i)** = Confidenza grezza del sensore (0-1)
- **Pɢᵢb(i)** = Penalità gibberish (0-0.4)
- **Wᵢ** = Peso del sensore:
  - V2I receiver: **1.1** (priorità perché riceve dati diretti dall'infrastruttura)
  - Camera frontale: **1.0** (standard)
  - Camera laterale: **0.9** (angolo meno favorevole)

La **penalità gibberish** Pɢᵢb si calcola in base al rapporto tra numeri e lunghezza del testo:

```
        ⎧ 0.4    se ratio > 0.5   (testo molto sporco, es. "D1V13T0")
Pɢᵢb = ⎨ 0.2    se ratio > 0.2   (mediamente sporco)
        ⎩ 0.05   altrimenti        (pochi errori)
```

Il sistema **seleziona il sensore con Cₑff massima** e restituisce il suo testo pulito.

### Esempio Pratico

**Scenario**: Lettura di un cartello "DIVIETO" con 3 sensori

| Sensore | Testo OCR | Cᵣₐw | Pɢᵢb | Peso | Cₑff |
|---------|-----------|------|------|------|------|
| V2I | null | - | - | 1.1 | **0** ❌ |
| Camera Front | "D1V13T0" | 0.65 | 0.4 | 1.0 | **0.25** |
| Camera Lateral | "DIVIETO" | 0.58 | 0.05 | 0.9 | **0.477** ✅ |

**Risultato**: Il sistema sceglie la camera laterale (0.477) nonostante abbia confidenza grezza inferiore, perché il testo è più pulito.

### Pulizia OCR

Dopo la selezione, viene applicata la pulizia con sostituzioni comuni:
```typescript
1 → I    // "D1V1ET0" → "DIVIETO"
0 → O    // "DIVI3T0" → "DIVIETO"
5 → S    // "5TOP"    → "STOP"
4 → A    // "Z4NA"    → "ZONA"
3 → E    // "3CCETTO" → "ECCETTO"
```

Con eccezioni per valori numerici legittimi:
- "ZONA EO" → "ZONA 30" (ripristino)
- "LAVORI A IOOM" → "LAVORI A 100M"

## 🛡️ Mappatura Edge Cases

### 1. Conflitto tra Sensori (2 dicono A, 1 dice B)

**Esempio**: 
- Camera frontale: "ZTL ECCETTO BUS" (0.92)
- Camera laterale: "ZTL" (0.88)
- V2I: null

**Decisione**: Il sistema **non fa votazione a maggioranza**, ma sceglie la lettura con **confidenza effettiva più alta**. In questo caso, la camera frontale (0.92 × 1.0 = 0.92) vince e la navetta può transitare grazie all'eccezione "ECCETTO BUS".

**Motivazione**: Una lettura molto affidabile vale più di due letture mediocri. Questo evita il "dumbing down" tipico del majority voting quando un sensore rileva dettagli critici che gli altri perdono.

---

### 2. Sensore con Confidenza Alta ma Testo Gibberish

**Esempio**:
- V2I: "D1V13T0 TR4NS1T0" (0.95)
- Camera frontale: "DIVIETO TRANSITO" (0.70)

**Decisione**: La penalità gibberish riduce la confidenza effettiva del V2I a **0.55** (0.95 - 0.4), permettendo alla camera frontale (0.70) di vincere.

**Motivazione**: Un OCR con alta confidenza ma risultato incomprensibile è peggio di un OCR con confidenza media ma testo leggibile.

---

### 3. Confidenza Totale < 60% (Soglia INTERVENE)

**Esempio**:
- Camera frontale: "D1V..T?" (0.45)
- Camera laterale: null
- V2I: "TR4N5" (0.38)

**Decisione**: L'algoritmo ritorna **"INTERVENE"** e attiva la schermata rossa/verde. Marco (supervisore umano) ha **2 secondi** per decidere. Se non interviene, la navetta si ferma automaticamente (**Phantom Braking**).

**Motivazione**: È meglio chiedere aiuto umano che prendere una decisione sbagliata con dati incerti. La safety è prioritaria.

---

### 4. ZTL con Orari e Eccezioni

**Esempio**: Cartello "ZTL 08:00-20:00 ECCETTO NAVETTE"
- Orario rilevamento: 09:25
- Giorno: Venerdì

**Decisione**: **GO** (la navetta può transitare)

**Logica**:
1. Il sistema rileva "ECCETTO NAVETTE" → Esenzione valida
2. Anche se l'orario è dentro la fascia ZTL (08:00-20:00), l'eccezione ha precedenza
3. Le navette elettriche autonome rientrano nella categoria "NAVETTE/BUS"

**Altri casi gestiti**:
- **ZTL notturna** (es. "22:00-06:00"): Gestita con logica invertita (attiva se ora >= 22 OR ora < 06)
- **ZTL solo festivi**: Controllato il giorno della settimana
- **ZTL 0-24 SEMPRE**: Sempre STOP (senza eccezioni)

---

### 5. Divieti Generici vs Divieti di Sosta

**Esempio 1**: "DIVIETO DI TRANSITO"
**Decisione**: **STOP**

**Esempio 2**: "DIVIETO DI SOSTA"
**Decisione**: **GO** (la navetta non sta parcheggiando, sta transitando)

**Motivazione**: Il sistema distingue tra divieti che bloccano il movimento (transito, accesso) e divieti che riguardano la fermata/parcheggio.

---

### 6. Cartelli Informativi (Cautela ma Transito Permesso)

**Esempi**: "DOSSO", "RALLENTARE", "ZONA 30", "LAVORI A 100M", "PEDONI"
**Decisione**: **GO** (con nota al safety driver)

**Motivazione**: Questi cartelli richiedono cautela ma non vietano il transito. Il safety driver umano presente sulla navetta gestirà la velocità adeguata.

---

### 7. Tutti i Sensori Nulli

**Esempio**:
- Camera frontale: null
- Camera laterale: null
- V2I: null

**Decisione**: Confidenza = **0%** → **INTERVENE**

**Motivazione**: Nessun dato significa impossibilità di decidere. Il sistema richiede conferma umana.

---

### 8. Cartelli Contraddittori

**Esempio**: 
- V2I: "VARCO NON ATTIVO" (0.88)
- Camera frontale: "ZTL ATTIVA" (0.72)

**Decisione**: Il V2I vince (0.88 × 1.1 = **0.968**) → **GO**

**Motivazione**: Il V2I riceve dati direttamente dall'infrastruttura smart, quindi è la fonte più affidabile per lo stato del varco (attivo/inattivo). Il cartello fisico potrebbe essere generico mentre il V2I è real-time.

---

### 9. Timer INTERVENE Scaduto

**Scenario**: Marco non risponde entro 2 secondi

**Decisione**: **STOP AUTOMATICO** (Phantom Braking)

**Motivazione**: In caso di dubbio, la navetta si ferma. È preferibile un falso positivo (fermata inutile) rispetto a un falso negativo (violazione ZTL/divieto).

---

### 10. Pulsante Emergenza Manuale

**Disponibilità**: Sempre visibile in modalità automatica (grande bottone rosso)

**Effetto**: Ferma immediatamente la navetta e termina la simulazione

**Motivazione**: Il supervisore umano deve poter intervenire in qualsiasi momento per emergenze non previste dall'algoritmo.

---

## 📊 Decisioni Tecniche di Design

### Perché Next.js?
- **Server-Side Rendering**: Le API routes permettono di simulare un backend separato
- **TypeScript nativo**: Type safety per prevenire errori
- **React 19**: Ultima versione stabile con ottimizzazioni

### Perché Non un Database?
- **Dataset statico**: Gli scenari sono predefiniti e non cambiano a runtime
- **Simulazione offline**: Permette di testare senza connessione
- **Facilità di modifica**: Modificare il JSON è immediato per aggiungere scenari

### Perché Tailwind CSS?
- **Rapid prototyping**: Stili inline senza context switching
- **Responsive di default**: Ottimizzato per dashboard full-screen
- **Utility-first**: Evita CSS custom fragile

### Perché 2 Secondi per INTERVENE?
Basato su studi di Human-Machine Interface:
- **< 1s**: Troppo poco per elaborare la situazione
- **> 3s**: La navetta viaggia troppo lontano (a 20 km/h = 16 metri)
- **2s**: Compromesso ottimale per decisione consapevole

### Perché Soglia 60% di Confidenza?
- **< 50%**: Troppi falsi positivi (interventi inutili)
- **> 70%**: Rischio di decisioni sbagliate con OCR "sicuro ma errato"
- **60%**: Bilanciamento tra autonomia e sicurezza

## 🧪 Testing degli Scenari

Il file `VShuttle-input.json` contiene oltre 100 scenari di test che coprono:
- ✅ ZTL con orari variabili
- ✅ Eccezioni per navette/bus
- ✅ Divieti con e senza eccezioni
- ✅ Cartelli informativi
- ✅ Testo OCR sporco/gibberish
- ✅ Sensori nulli o conflittuali
- ✅ Orari notturni e festivi

Ogni scenario include:
```json
{
  "id_scenario": 70,
  "sensori": {
    "camera_frontale": { "testo": "...", "confidenza": 0.99 },
    "camera_laterale": { "testo": "...", "confidenza": 0.98 },
    "V2I_receiver": { "testo": "...", "confidenza": 0.97 }
  },
  "orario_rilevamento": "09:25",
  "giorno_settimana": "Venerdì"
}
```

## 📁 Struttura del Progetto

```
TeamNumero9-VShuttle/
├── app/
│   ├── page.tsx              # Dashboard React (UI principale)
│   ├── layout.tsx            # Layout Next.js
│   ├── globals.css           # Stili Tailwind
│   └── api/
│       └── shuttle/
│           └── route.ts      # API di fusione e valutazione
├── public/
│   └── VShuttle-input.json   # Dataset scenari di test
├── package.json              # Dipendenze
├── tsconfig.json             # Configurazione TypeScript
├── tailwind.config.ts        # Configurazione Tailwind
└── README.md                 # Documentazione (questo file)
```


## 🤝 Team Numero 9

Progetto sviluppato per l'hackathon di sistemi di guida autonoma.

**Tecnologie**: Next.js, React, TypeScript, Tailwind CSS


---

*Per domande o supporto, aprire una issue su GitHub.*
