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
  const [stopNotice, setStopNotice] = useState<string | null>(null);
  
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
    setStopNotice(null);
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
    setStopNotice("Navetta fermata manualmente. Simulazione interrotta in sicurezza.");
  };

  // --- RENDERING ---

  if (!isRunning) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <div className="flex flex-col items-center gap-10">
          <div className="text-center text-slate-100">
            <p className="text-xs font-medium uppercase tracking-[0.35em] text-sky-400/80">
              V-SHUTTLE CONTROL PANEL
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Simulation Environment
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Avvia la sequenza di scenari per testare il comportamento della navetta autonoma.
            </p>
          </div>
          <button
            onClick={startSimulation}
            className="group relative inline-flex items-center justify-center rounded-full bg-sky-500 px-16 py-5 text-2xl font-semibold text-slate-950 shadow-[0_0_55px_rgba(56,189,248,0.6)] ring-1 ring-sky-300/70 transition-all duration-300 hover:bg-sky-400 hover:shadow-[0_0_80px_rgba(56,189,248,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.99]"
          >
            <span className="tracking-[0.22em]">
              START SIMULATION
            </span>
          </button>
        </div>
        {stopNotice && (
          <div className="pointer-events-none fixed bottom-6 right-6 z-20">
            <div className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-2xl ring-1 ring-rose-500/60">
              <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/60">
                !
              </div>
              <div className="flex-1">
                <p className="font-semibold text-rose-200">Simulazione fermata</p>
                <p className="mt-0.5 text-xs text-slate-300">
                  {stopNotice}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Schermata INTERVENE (Rosso/Verde)
  if (apiResult?.azione === "INTERVENE") {
    const confidencePercent = Math.round(apiResult.confidenza * 100);
    const clampedWidth = Math.max(0, Math.min(100, confidencePercent));

    return (
      <div className="relative flex h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <div className="absolute top-10 left-0 right-0 z-10 flex flex-col items-center gap-3 text-slate-50 drop-shadow-md">
          <h1 className="text-3xl font-semibold tracking-tight">
            ATTENZIONE: CONFERMA RICHIESTA
          </h1>
          <p className="rounded-full bg-slate-900/70 px-6 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700/80">
            Timer decisione manuale:{" "}
            <span className="tabular-nums text-sky-400">{timeLeft}s</span>
          </p>
        </div>
        {apiResult && (
          <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 flex justify-center">
            <div className="w-3/4 max-w-4xl rounded-xl bg-slate-900/90 p-5 shadow-2xl ring-1 ring-slate-700/80">
              <div className="mb-2 flex items-center justify-between text-sm text-slate-200">
                <span className="font-semibold uppercase tracking-wide text-slate-100">
                  {apiResult.testo_rilevato || "N/D"}
                </span>
                <span className="font-semibold tabular-nums">
                  {confidencePercent}%
                </span>
              </div>
              <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    confidencePercent >= 80
                      ? "bg-emerald-500"
                      : confidencePercent >= 50
                      ? "bg-amber-400"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${clampedWidth}%` }}
                />
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => handleMarcoDecision("STOP_MANUALE")}
          className="flex-1 bg-gradient-to-br from-rose-600 to-red-700 text-6xl font-semibold text-slate-50 shadow-inner shadow-black/40 transition-colors duration-150 hover:from-rose-500 hover:to-red-600"
        >
          STOP
        </button>
        <button
          onClick={() => handleMarcoDecision("GO_MANUALE")}
          className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-700 text-6xl font-semibold text-slate-50 shadow-inner shadow-black/40 transition-colors duration-150 hover:from-emerald-400 hover:to-emerald-600"
        >
          GO
        </button>
        {stopNotice && (
          <div className="pointer-events-none fixed bottom-6 right-6 z-20">
            <div className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-2xl ring-1 ring-rose-500/60">
              <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/60">
                !
              </div>
              <div className="flex-1">
                <p className="font-semibold text-rose-200">Simulazione fermata</p>
                <p className="mt-0.5 text-xs text-slate-300">
                  {stopNotice}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Schermata Normale (Grigia con fungo rosso)
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
      <div className="absolute top-10 flex w-full flex-col items-center gap-4 text-center text-slate-200">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Stato Navetta: Automatica</h2>
          <p className="text-lg">
            Azione in corso:{" "}
            <span
              className={
                apiResult?.azione === "STOP"
                  ? "text-rose-400 font-semibold"
                  : "text-emerald-400 font-semibold"
              }
            >
              {apiResult?.azione || "ATTESA"}
            </span>
          </p>
        </div>
      </div>
      {apiResult && (() => {
        const confidencePercent = Math.round(apiResult.confidenza * 100);
        const clampedWidth = Math.max(0, Math.min(100, confidencePercent));

        return (
          <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center">
            <div className="w-3/4 max-w-4xl rounded-xl bg-slate-900/90 p-5 shadow-2xl ring-1 ring-slate-800">
              <div className="mb-2 flex items-center justify-between text-lg text-slate-100">
                <span className="font-semibold uppercase tracking-wide text-slate-200">
                  {apiResult.testo_rilevato || "N/D"}
                </span>
                <span className="font-bold text-2xl tabular-nums">
                  {confidencePercent}%
                </span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    confidencePercent >= 80
                      ? "bg-emerald-500"
                      : confidencePercent >= 50
                      ? "bg-amber-400"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${clampedWidth}%` }}
                />
              </div>
            </div>
          </div>
        );
      })()}
      <button
        onClick={handleEmergencyStop}
        className="h-80 w-80 rounded-full border-[10px] border-rose-700 bg-gradient-to-br from-rose-500 to-red-700 text-5xl font-extrabold text-slate-50 shadow-[0_0_80px_rgba(248,113,113,0.55)] transition-transform duration-200 hover:from-rose-400 hover:to-red-600 active:scale-95"
      >
        STOP
      </button>
      <p className="mt-8 text-xl text-slate-400 font-medium tracking-wide">
        EMERGENZA MANUALE
      </p>
      {stopNotice && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-20">
          <div className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-2xl ring-1 ring-rose-500/60">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/60">
              !
            </div>
            <div className="flex-1">
              <p className="font-semibold text-rose-200">Simulazione fermata</p>
              <p className="mt-0.5 text-xs text-slate-300">
                {stopNotice}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}