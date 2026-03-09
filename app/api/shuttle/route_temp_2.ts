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
        { name: 'V2I', data: sensori.V2I_receiver, weight: 1.1 },
        { name: 'Front', data: sensori.camera_frontale, weight: 1.0 },
        { name: 'Side', data: sensori.camera_laterale, weight: 0.9 }
    ].filter(s => s.data.testo !== null && s.data.confidenza !== null);

    if (readings.length === 0) return { finalString: "", finalConfidence: 0 };

    let bestReading = { finalString: "", finalConfidence: 0 };

    for (const reading of readings) {
        const rawText = reading.data.testo!;
        let baseConf = reading.data.confidenza!;

        const gibberishPenalty = calculateGibberishPenalty(rawText);

        let effectiveConf = (baseConf - gibberishPenalty) * reading.weight;
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
    const matches = text.match(/[0-9]/g);
    if (!matches) return 0;

    const alphanumericRatio = matches.length / text.length;

    if (alphanumericRatio > 0.5) return 0.4;
    if (alphanumericRatio > 0.2) return 0.2;
    return 0.05;
}

function cleanOcrText(text: string): string {
    // Pulizia selettiva: corregge il "leetspeak" degli errori OCR solo nelle parole chiave,
    // preservando così i numeri veri che ci servono per gli orari (es. 08:00)
    return text.toUpperCase()
        .replace(/D1V1ET0|D1V13T0/g, 'DIVIETO')
        .replace(/4CC3550/g, 'ACCESSO')
        .replace(/S3NS0/g, 'SENSO')
        .replace(/UN1C0/g, 'UNICO')
        .replace(/4LT3RN4T0/g, 'ALTERNATO')
        .replace(/5T4Z10N3/g, 'STAZIONE')
        .replace(/F3RR0V14R14/g, 'FERROVIARIA')
        .replace(/P3D0NAL3/g, 'PEDONALE')
        .replace(/Z0N4/g, 'ZONA')
        .replace(/D1/g, 'DI')
        .replace(/\s+/g, ' ')
        .trim();
}

// --- LOGICA SEMANTICA E ORARI ---
function evaluateSemantics(text: string, time: string, day: string): "GO" | "STOP" {
    // 1. Controlli "Salvavita" (Se il divieto è finito o inattivo)
    if (text.includes("FINE") || text.includes("NON ATTIVA") || text.includes("INATTIVO") || text.includes("VARCO NON ATTIVO")) {
        return "GO";
    }

    // 2. Eccezioni Flessibili (Regex per trovare "ECCETTO [qualsiasi cosa] BUS")
    const isBusExempt = /ECCETTO.*BUS/.test(text) ||
        /ECCETTO.*NAVETTE/.test(text) ||
        /BUS.*OK/.test(text) ||
        /OK.*ELETTRICI/.test(text) ||
        text.includes("ECCETTO AUTORIZZATI") ||
        /ECCETTO.*ELETTRICI/.test(text);

    // 3. Gestione Divieti
    if (text.includes("DIVIETO") || text.includes("SENSO VIETATO") || text.includes("STRADA CHIUSA")) {
        // Ignoriamo i divieti che non riguardano la marcia
        if (text.includes("DIVIETO DI SOSTA") || text.includes("DIVIETO FERMATA") || text.includes("SCARICO") || text.includes("AFFISSIONE")) return "GO";
        if (isBusExempt) return "GO";
        return "STOP";
    }

    // 4. Gestione ZTL e orari
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
                isZtlActive = currentHour >= startHour && currentHour < endHour;
            } else {
                isZtlActive = currentHour >= startHour || currentHour < endHour;
            }

            return isZtlActive ? "STOP" : "GO";
        }

        if (text.includes("0-24") || text.includes("SEMPRE")) return "STOP";
        if (text.includes("FESTIVI") && day === "Domenica") return "STOP";
        if (text.includes("FESTIVI") && day !== "Domenica") return "GO";

        return "STOP";
    }

    // 5. Cartelli Informativi
    const safeToProceed = ["DOSSO", "RALLENTARE", "ZONA 30", "LAVORI", "PEDONI", "STAZIONE", "PARCHEGGIO", "ROTATORIA", "MERCATO", "PIAZZA"];
    if (safeToProceed.some(keyword => text.includes(keyword))) {
        return "GO";
    }

    return "GO";
}