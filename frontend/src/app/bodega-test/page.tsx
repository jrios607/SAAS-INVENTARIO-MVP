"use client";

import { useState, useRef } from "react";
import { recepcionarPallet } from "@/services/api";
import { HybridInput } from "@/components/HybridInput";
import { CheckCircle2, AlertCircle, Loader2, RotateCcw, PackageSearch } from "lucide-react";

type ScanState = "idle" | "scanning" | "processing" | "success" | "error";

interface Result {
  sato_id: string;
  ean_leido: string;
  mensaje: string;
}

export default function BodegaRecepcionPage() {
  const [state, setState] = useState<ScanState>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastCode, setLastCode] = useState("");
  const cooldownRef = useRef(false);

  const handleScan = async (code: string) => {
    // Debounce: evitar doble-disparo en lectura rápida
    if (cooldownRef.current) return;
    cooldownRef.current = true;

    setLastCode(code);
    setState("processing");
    setResult(null);
    setErrorMsg("");

    try {
      const res = await recepcionarPallet(code);
      setResult(res);
      setState("success");
    } catch (e: any) {
      setErrorMsg(e.message || "Error desconocido.");
      setState("error");
    } finally {
      setTimeout(() => { cooldownRef.current = false; }, 2000);
    }
  };

  const handleReset = () => {
    setState("scanning");
    setResult(null);
    setErrorMsg("");
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Cabecera */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Recepción de Bodega</h1>
        <p className="text-slate-500 text-sm mt-1">
          Escanea el código GS1-128 del pallet con la cámara. El sistema lo procesa automáticamente.
        </p>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6">
        {/* ── Panel izquierdo: Escáner ── */}
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 rounded-2xl p-6 min-h-[480px] relative overflow-hidden">
          {/* Grid decorativo de fondo */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(circle, #6ee7b7 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-sm">
            {/* Idle / Input state */}
            {(state === "idle" || state === "scanning") && (
              <>
                <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-2">
                  <PackageSearch size={28} className="text-emerald-400" />
                </div>
                <div className="text-center mb-4 w-full">
                  <p className="text-white font-semibold text-lg">Recepción de Pallet</p>
                  <p className="text-slate-400 text-sm mt-1">
                    Usa la pistola láser, la cámara, o escribe el código manualmente.
                  </p>
                </div>
                <div className="w-full">
                  <HybridInput
                    value={lastCode}
                    onChange={(val) => setLastCode(val)}
                    onEnter={(val) => {
                      if (val.trim()) handleScan(val);
                    }}
                    placeholder="Escanear GS1-128..."
                    autoFocus={true}
                  />
                </div>
                <button
                  onClick={() => { if (lastCode.trim()) handleScan(lastCode); }}
                  disabled={!lastCode.trim()}
                  className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-5 py-3 rounded-xl font-semibold text-sm transition-all"
                >
                  Procesar Recepción
                </button>
              </>
            )}

            {/* Procesando */}
            {state === "processing" && (
              <div className="flex flex-col items-center gap-4">
                <Loader2 size={48} className="animate-spin text-emerald-400" />
                <div className="text-center">
                  <p className="text-white font-semibold">Procesando en servidor...</p>
                  <p className="text-slate-400 text-xs mt-1 font-mono break-all max-w-xs">{lastCode}</p>
                </div>
              </div>
            )}

            {/* Éxito */}
            {state === "success" && result && (
              <div className="flex flex-col items-center gap-4 w-full">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center animate-bounce-once">
                  <CheckCircle2 size={40} className="text-green-400" />
                </div>
                <div className="text-center">
                  <p className="text-green-400 font-bold text-lg">¡Pallet Recepcionado!</p>
                  <p className="text-slate-400 text-sm mt-1">{result.mensaje}</p>
                </div>
                <div className="bg-slate-800 rounded-xl p-4 w-full space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-400 flex-shrink-0">SATO UUID</span>
                    <code className="font-mono text-emerald-400 text-xs break-all text-right">{result.sato_id}</code>
                  </div>
                  <div className="border-t border-slate-700 pt-2 flex items-center justify-between">
                    <span className="text-slate-400">EAN Leído</span>
                    <code className="font-mono text-slate-300">{result.ean_leido}</code>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:scale-105"
                >
                  <RotateCcw size={15} /> Escanear otro pallet
                </button>
              </div>
            )}

            {/* Error */}
            {state === "error" && (
              <div className="flex flex-col items-center gap-4 w-full">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertCircle size={40} className="text-red-400" />
                </div>
                <div className="text-center">
                  <p className="text-red-400 font-bold text-lg">Error de recepción</p>
                  <p className="text-slate-300 text-sm mt-1 px-4">{errorMsg}</p>
                </div>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                >
                  <RotateCcw size={15} /> Intentar de nuevo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Panel derecho: Instrucciones ── */}
        <div className="lg:w-72 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">¿Cómo funciona?</h3>
            <ol className="space-y-3 text-sm text-slate-600">
              {[
                "Conecta tu escáner USB/Bluetooth y dispara al código GS1-128.",
                "O presiona el icono de cámara para usar la cámara del dispositivo.",
                "El sistema extrae el EAN, lote, vencimiento y cantidad automáticamente.",
                "Se crea un SATO en el sistema y verás el UUID generado.",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-800 font-semibold mb-1">Requisito previo</p>
            <p className="text-xs text-amber-700">
              El EAN del producto debe estar registrado en el{" "}
              <a href="/catalogo" className="underline font-medium">Catálogo de Productos</a>{" "}
              antes de recepcionar el pallet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
