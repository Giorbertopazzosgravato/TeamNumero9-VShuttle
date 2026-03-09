"use client";

import { useState, useEffect, useRef } from "react";

type Scenario = {
  id_scenario: number;
  sensori: any;
  orario_rilevamento: string;
  giorno_settimana: string;
};

type ApiResult = {
  id_scenario: number;
  azione: "GO" | "STOP" | "INTERVENE";
  testo_rilevato: string;
  confidenza: number;
  dettagli: string;
};

export default function Dashboard() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  
  const loopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const interveneTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Caricamento del JSON dalla cartella public
  useEffect(() => {
    fetch('/VShuttle-input.json')
      .then((res) => res.json())
      .then((data) => setScenarios(data))
      .catch((err) => console.error("Errore nel caricamento del JSON:", err));
  }, []);

  // Motore di valutazione che scatta a ogni cambio di indice
  useEffect(() => {
    if (!isRunning || currentIndex < 0 || currentIndex >= scenarios.length) return;

    const processScenario = async () => {
      const currentScenario = scenarios[currentIndex];
      
      try {
        const res = await fetch("/api/shuttle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(currentScenario),
        });
        const data: ApiResult = await res.json();
        console.log("🤖 Decisione API per lo scenario", currentScenario.id_scenario, ":", data);
        setApiResult(data);

        // Se l'algoritmo non è sicuro, ferma il loop e avvia il timer di Marco
        if (data.azione === "INTERVENE") {
          setTimeLeft(2);
        } else {
          // Se è sicuro (GO o STOP), aspetta 4 secondi e passa al prossimo
          loopTimerRef.current = setTimeout(() => {
            setCurrentIndex((prev) => prev + 1);
          }, 4000);
        }
      } catch (error) {
        console.error("Errore API", error);
      }
    };

    processScenario();

    return () => {
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    };
  }, [currentIndex, isRunning, scenarios]);

  // Gestione del timer di Marco (2 secondi)
  useEffect(() => {
    if (timeLeft === null) return;

    if (timeLeft > 0) {
      interveneTimerRef.current = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    } else {
      // Tempo scaduto: Phantom Braking automatico e via al prossimo
      handleMarcoDecision("STOP_AUTOMATICO_TEMPO_SCADUTO");
    }

    return () => {
      if (interveneTimerRef.current) clearTimeout(interveneTimerRef.current);
    };
  }, [timeLeft]);

  const startSimulation = () => {
    if (scenarios.length === 0) {
      alert("JSON non ancora caricato o vuoto.");
      return;
    }
    setIsRunning(true);
    setCurrentIndex(0);
  };

  const handleMarcoDecision = (decision: string) => {
    console.log(`Decisione: ${decision}`);
    setTimeLeft(null);
    setCurrentIndex((prev) => prev + 1); // Passa subito al prossimo
  };

  const handleEmergencyStop = () => {
    setIsRunning(false);
    if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    if (interveneTimerRef.current) clearTimeout(interveneTimerRef.current);
    alert("NAVETTA FERMATA MANUALMENTE.");
  };

  // --- RENDERING ---

  if (!isRunning) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900">
        <button
          onClick={startSimulation}
          className="rounded-xl bg-blue-600 px-10 py-6 text-4xl font-bold text-white shadow-lg hover:bg-blue-500"
        >
          START SIMULATION
        </button>
      </div>
    );
  }

  // Schermata INTERVENE (Rosso/Verde)
  if (apiResult?.azione === "INTERVENE") {
    return (
      <div className="relative flex h-screen w-screen">
        <div className="absolute top-10 left-0 right-0 z-10 text-center text-white drop-shadow-md">
          <h1 className="text-3xl font-bold">ATTENZIONE: CONFERMA RICHIESTA</h1>
          <p className="text-xl mt-2">Timer: {timeLeft}s</p>
        </div>
        <button
          onClick={() => handleMarcoDecision("STOP_MANUALE")}
          className="flex-1 bg-red-600 text-6xl font-bold text-white hover:bg-red-500"
        >
          STOP
        </button>
        <button
          onClick={() => handleMarcoDecision("GO_MANUALE")}
          className="flex-1 bg-green-600 text-6xl font-bold text-white hover:bg-green-500"
        >
          GO
        </button>
      </div>
    );
  }

  // Schermata Normale (Grigia con fungo rosso)
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-gray-700">
      <div className="absolute top-10 text-center text-gray-300">
        <h2 className="text-2xl font-semibold">Stato Navetta: Automatica</h2>
        <p className="text-lg">
          Azione in corso:{" "}
          <span className={apiResult?.azione === "STOP" ? "text-red-400 font-bold" : "text-green-400 font-bold"}>
            {apiResult?.azione || "ATTESA"}
          </span>
        </p>
      </div>
      <button
        onClick={handleEmergencyStop}
        className="h-80 w-80 rounded-full border-8 border-red-800 bg-red-600 text-5xl font-extrabold text-white shadow-2xl hover:bg-red-500 active:scale-95 transition-transform"
      >
        STOP
      </button>
      <p className="mt-8 text-xl text-gray-400 font-medium">EMERGENZA MANUALE</p>
    </div>
  );
}