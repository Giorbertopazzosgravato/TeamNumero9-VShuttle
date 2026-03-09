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

        const { finalString, finalConfidence } = fuseSensors(scenario.sensori);

        if (finalConfidence < CONFIDENCE_THRESHOLD) {
            return NextResponse.json({
                id_scenario: scenario.id_scenario,
                azione: "INTERVENE",
                testo_rilevato: finalString,
                confidenza: parseFloat(finalConfidence.toFixed(2)),
                dettagli: "Testo incomprensibile o confidenza troppo bassa. Richiesto OVERRIDE."
            });
        }

        const action = evaluateSemantics(finalString, scenario.orario_rilevamento, scenario.giorno_settimana);

        return NextResponse.json({
            id_scenario: scenario.id_scenario,
            azione: action,
            testo_rilevato: finalString,
            confidenza: parseFloat(finalConfidence.toFixed(2)),
            dettagli: action === "GO" ? "Transito consentito o eccezione applicabile." : "Divieto o ostacolo rilevato."
        });

    } catch (error) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
}

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
    const textWithoutValidNumbers = text.replace(/30|50|100|0-24|[0-9]{1,2}:[0-9]{2}|[0-9]{1,2}-[0-9]{1,2}/g, '');
    const matches = textWithoutValidNumbers.match(/[0-9]/g);
    if (!matches) return 0;

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
    // 1. Controlli "Salvavita"
    if (text.includes("FINE") || text.includes("NON ATTIVA") || text.includes("INATTIVO") || text.includes("VARCO NON ATTIVO") || text.includes("PREAVVISO")) {
        return "GO";
    }

    // 2. Eccezioni Flessibili per la navetta
    const isBusExempt = /ECCETTO.*BUS/.test(text) ||
        /ECCETTO.*NAVETTE/.test(text) ||
        /BUS.*OK/.test(text) ||
        /L4.*OK/.test(text) ||
        text.includes("ECCETTO AUTORIZZATI") ||
        /ECCETTO.*TRASPORTO PUBBLICO/.test(text);

    // 3. Gestione Divieti Generici, Eccezioni Implicite e Arresto Obbligatorio (STOP/ALT)
    if (text.includes("DIVIETO") || text.includes("SENSO VIETATO") || text.includes("STRADA CHIUSA") || text.includes("ECCETTO") || text.includes("STOP") || text.includes("ALT")) {
        if (text.includes("DIVIETO DI SOSTA") || text.includes("DIVIETO FERMATA") || text.includes("SCARICO") || text.includes("AFFISSIONE")) return "GO";
        if (isBusExempt) return "GO";
        return "STOP";
    }

    // 4. Gestione ZTL (Accesso Libero Sempre)
    if (text.includes("ZTL")) {
        return "GO";
    }

    // 4.5 Gestione MERCATO (Ostacolo fisico a tempo)
    if (text.includes("MERCATO")) {
        const normalizedDay = day.toUpperCase().replace(/[ÀÁ]/g,"A").replace(/[ÈÉ]/g,"E").replace(/[ÌÍ]/g,"I").replace(/[ÒÓ]/g,"O").replace(/[ÙÚ]/g,"U");
        const giorni = ["LUNEDI", "MARTEDI", "MERCOLEDI", "GIOVEDI", "VENERDI", "SABATO", "DOMENICA"];
        const citaUnGiorno = giorni.some(g => text.includes(g));

        if (text.includes(normalizedDay) || !citaUnGiorno) {
            const timeRegex = /([0-9]{1,2})(?::[0-9]{2})?\s*(?:-|ALLE)\s*([0-9]{1,2})(?::[0-9]{2})?/g;
            let match;
            let hasTimeRestrictions = false;
            let isActiveNow = false;
            const currentHour = parseInt(time.split(':')[0]);

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

            if (hasTimeRestrictions && isActiveNow) return "STOP";
            if (!hasTimeRestrictions) return "STOP";
        }
    }

    // 5. Cartelli Informativi e di Cautela
    const safeToProceed = ["DOSSO", "RALLENTARE", "ZONA 30", "LAVORI", "PEDONI", "STAZIONE", "PARCHEGGIO", "ROTATORIA", "PIAZZA"];
    if (safeToProceed.some(keyword => text.includes(keyword))) {
        return "GO";
    }

    return "GO";
}