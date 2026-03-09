import { NextResponse } from 'next/server';

// --- TIPI ---
type SensorData = { testo: string | null; confidenza: number | null };
type Scenario = {
  id_scenario: number;
  sensori: { camera_frontale: SensorData; camera_laterale: SensorData; V2I_receiver: SensorData; };
  orario_rilevamento: string;
  giorno_settimana: string;
};

const CONFIDENCE_THRESHOLD = 0.60;

export async function POST(request: Request) {
  try {
    const scenario: Scenario = await request.json();
    
    // 1. Fusione e Normalizzazione
    const { finalString, finalConfidence } = fuseSensors(scenario.sensori);

    // 2. Controllo Confidenza (Intervento di Marco)
    if (finalConfidence < CONFIDENCE_THRESHOLD) {
      return NextResponse.json({
        id_scenario: scenario.id_scenario,
        azione: "INTERVENE",
        testo_rilevato: finalString,
        confidenza: parseFloat(finalConfidence.toFixed(2)),
        dettagli: "Testo incomprensibile o confidenza troppo bassa. Richiesto OVERRIDE umano."
      });
    }

    // 3. Valutazione Semantica (STOP o GO)
    const action = evaluateSemantics(finalString, scenario.orario_rilevamento, scenario.giorno_settimana);

    return NextResponse.json({
      id_scenario: scenario.id_scenario,
      azione: action,
      testo_rilevato: finalString,
      confidenza: parseFloat(finalConfidence.toFixed(2)),
      dettagli: action === "GO" ? "Transito consentito o eccezione applicabile." : "Divieto rilevato o ZTL attiva."
    });

  } catch (error) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}

// --- LOGICA DI FUSIONE ---
function fuseSensors(sensori: Scenario['sensori']) {
  const readings = [
    { name: 'V2I', data: sensori.V2I_receiver, weight: 1.1 }, // Bonus per V2I (infrastruttura diretta)
    { name: 'Front', data: sensori.camera_frontale, weight: 1.0 },
    { name: 'Side', data: sensori.camera_laterale, weight: 0.9 }
  ].filter(s => s.data.testo !== null && s.data.confidenza !== null);

  if (readings.length === 0) return { finalString: "", finalConfidence: 0 };

  let bestReading = { finalString: "", finalConfidence: 0 };

  for (const reading of readings) {
    const rawText = reading.data.testo!;
    let baseConf = reading.data.confidenza!;
    
    // Calcolo della penalità "Gibberish"
    const gibberishPenalty = calculateGibberishPenalty(rawText);
    
    // Confidenza effettiva
    let effectiveConf = (baseConf - gibberishPenalty) * reading.weight;
    // Cap al 99% per realismo
    if (effectiveConf > 0.99) effectiveConf = 0.99; 

    if (effectiveConf > bestReading.finalConfidence) {
      bestReading = {
        finalString: cleanOcrText(rawText),
        finalConfidence: effectiveConf
      };
    }
  }

  return bestReading;
}

function calculateGibberishPenalty(text: string): number {
  // Conta i numeri in mezzo a lettere, che di solito indicano errori OCR
  const matches = text.match(/[0-9]/g);
  if (!matches) return 0;
  
  // Se ci sono numeri ma anche parole come "30" o orari "08:00", non è tutto gibberish.
  // Applichiamo una penalità lieve per ogni numero sospetto (es. D1V1ET0 ha 3 numeri).
  // Se la stringa ha una percentuale altissima di caratteri strani, la penalità sale.
  const alphanumericRatio = matches.length / text.length;
  
  if (alphanumericRatio > 0.5) return 0.4; // Molto sporco
  if (alphanumericRatio > 0.2) return 0.2; // Mediamente sporco
  return 0.05; // Pochi errori
}

function cleanOcrText(text: string): string {
  return text.toUpperCase()
    .replace(/1/g, 'I')
    .replace(/0/g, 'O')
    .replace(/5/g, 'S')
    .replace(/4/g, 'A')
    .replace(/3/g, 'E')
    // Ripristina eccezioni legittime che l'OCR cleaner potrebbe aver rotto
    .replace(/ZONA EO/g, 'ZONA 30')
    .replace(/LAVORI A IOOM/g, 'LAVORI A 100M')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- LOGICA SEMANTICA E ORARI ---
function evaluateSemantics(text: string, time: string, day: string): "GO" | "STOP" {
  // Sostituzioni per facilitare il parsing
  const isBusExempt = text.includes("ECCETTO BUS") || text.includes("ECCETTO NAVETTE") || 
                      text.includes("BUS TAXI OK") || text.includes("OK ELETTRICI") || 
                      text.includes("ECCETTO AUTORIZZATI") || text.includes("ECCETTO ELETTRICI");
  
  if (text.includes("VARCO NON ATTIVO") || text.includes("INATTIVO")) return "GO";

  // Gestione Divieti
  if (text.includes("DIVIETO") || text.includes("SENSO VIETATO") || text.includes("STRADA CHIUSA")) {
    if (text.includes("DIVIETO DI SOSTA") || text.includes("DIVIETO FERMATA")) return "GO"; // Non ci stiamo parcheggiando
    if (isBusExempt) return "GO";
    return "STOP";
  }

  // Gestione ZTL e orari
  if (text.includes("ZTL")) {
    if (isBusExempt) return "GO";
    
    // Estrazione orari es: "08:00 - 20:00" o "08-20" o "22-06"
    const timeMatch = text.match(/([0-9]{1,2})(?::[0-9]{2})?\s*(?:-|ALLE)\s*([0-9]{1,2})(?::[0-9]{2})?/);
    
    if (timeMatch) {
      const startHour = parseInt(timeMatch[1]);
      const endHour = parseInt(timeMatch[2]);
      const currentHour = parseInt(time.split(':')[0]);

      let isZtlActive = false;
      if (startHour < endHour) {
        // Es: 08:00 - 20:00
        isZtlActive = currentHour >= startHour && currentHour < endHour;
      } else {
        // Es: 22:00 - 06:00 (notturna)
        isZtlActive = currentHour >= startHour || currentHour < endHour;
      }

      return isZtlActive ? "STOP" : "GO";
    }

    // ZTL Sempre o Festivi
    if (text.includes("0-24") || text.includes("SEMPRE")) return "STOP";
    if (text.includes("FESTIVI") && day === "Domenica") return "STOP";
    if (text.includes("FESTIVI") && day !== "Domenica") return "GO";

    // Se c'è solo "ZTL" o "VARCO ATTIVO" senza esenzioni chiare
    return "STOP";
  }

  // Cartelli che indicano di proseguire con cautela (Safety Driver)
  const safeToProceed = ["DOSSO", "RALLENTARE", "ZONA 30", "LAVORI", "PEDONI", "STAZIONE", "PARCHEGGIO", "ROTATORIA", "MERCATO", "PIAZZA"];
  if (safeToProceed.some(keyword => text.includes(keyword))) {
    return "GO";
  }

  // Comportamento predefinito se non si rilevano minacce o divieti espliciti
  return "GO";
}