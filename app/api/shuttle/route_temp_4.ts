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
    // Rimuove i numeri legittimi e i pattern noti prima di contare i caratteri anomali
    const textWithoutValidNumbers = text.replace(/30|50|100|0-24|[0-9]{1,2}:[0-9]{2}|[0-9]{1,2}-[0-9]{1,2}/g, '');

    const matches = textWithoutValidNumbers.match(/[0-9]/g);
    if (!matches) return 0;

    // Calcola il rapporto sulla lunghezza originale per non falsare i pesi
    const alphanumericRatio = matches.length / text.length;

    if (alphanumericRatio > 0.5) return 0.4;
    if (alphanumericRatio > 0.2) return 0.2;
    return 0.05;
}

function cleanOcrText(text: string): string {
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
    // 1. Controlli "Salvavita" (Se il divieto è finito, inattivo o è solo un preavviso)
    if (text.includes("FINE") || text.includes("NON ATTIVA") || text.includes("INATTIVO") || text.includes("VARCO NON ATTIVO") || text.includes("PREAVVISO")) {
        return "GO";
    }

    // 2. Eccezioni Flessibili
    const isBusExempt = /ECCETTO.*BUS/.test(text) ||
        /ECCETTO.*NAVETTE/.test(text) ||
        /BUS.*OK/.test(text) ||
        /OK.*ELETTRICI/.test(text) ||
        text.includes("ECCETTO AUTORIZZATI") ||
        /ECCETTO.*ELETTRICI/.test(text) ||
        /ECCETTO.*TRASPORTO PUBBLICO/.test(text);

    // 3. Gestione Divieti Generici ed Eccezioni Implicite
    // Se c'è un divieto esplicito, oppure se c'è un "ECCETTO" (che implica un divieto per chi non è elencato)
    if (text.includes("DIVIETO") || text.includes("SENSO VIETATO") || text.includes("STRADA CHIUSA") || text.includes("ECCETTO")) {
        // Ignoriamo i divieti che non riguardano la marcia (es. sosta)
        if (text.includes("DIVIETO DI SOSTA") || text.includes("DIVIETO FERMATA") || text.includes("SCARICO") || text.includes("AFFISSIONE")) return "GO";

        // Se la navetta rientra nelle eccezioni, passa
        if (isBusExempt) return "GO";

        // Se c'è un divieto o un'eccezione per qualcun altro (es. MEZZI DI SOCCORSO, RESIDENTI), ci fermiamo
        return "STOP";
    }

    // 4. Gestione ZTL, Giorni e Orari
    if (text.includes("ZTL")) {
        if (isBusExempt) return "GO";

        // Controllo giorni festivi prioritario
        const isFestivo = day === "Domenica";
        if (text.includes("FESTIVI")) {
            if (!isFestivo) return "GO";
            // Se è Domenica, prosegue per vedere se ci sono orari specifici o se è 0-24
        }

        // Estrazione orari multipli (es: "08:00 - 12:00 E 14:00 - 18:00" o "08-12")
        const timeRegex = /([0-9]{1,2})(?::[0-9]{2})?\s*(?:-|ALLE)\s*([0-9]{1,2})(?::[0-9]{2})?/g;
        let match;
        let hasTimeRestrictions = false;
        let isActiveNow = false;
        const currentHour = parseInt(time.split(':')[0]);

        // Controlla tutte le fasce orarie trovate
        while ((match = timeRegex.exec(text)) !== null) {
            hasTimeRestrictions = true;
            const startHour = parseInt(match[1]);
            const endHour = parseInt(match[2]);

            if (startHour < endHour) {
                if (currentHour >= startHour && currentHour < endHour) isActiveNow = true;
            } else {
                if (currentHour >= startHour || currentHour < endHour) isActiveNow = true;
            }
        }

        if (hasTimeRestrictions) {
            return isActiveNow ? "STOP" : "GO";
        }

        if (text.includes("0-24") || text.includes("SEMPRE")) return "STOP";

        return "STOP";
    }

    // 5. Cartelli Informativi e di Cautela
    const safeToProceed = ["DOSSO", "RALLENTARE", "ZONA 30", "LAVORI", "PEDONI", "STAZIONE", "PARCHEGGIO", "ROTATORIA", "MERCATO", "PIAZZA"];
    if (safeToProceed.some(keyword => text.includes(keyword))) {
        return "GO";
    }

    return "GO";
}