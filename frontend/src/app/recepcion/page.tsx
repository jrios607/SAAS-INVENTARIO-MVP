"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { Package, ScanBarcode, ArrowRight, CheckCircle2, RotateCcw, Camera, X } from "lucide-react";
import { recepcionarPallet } from "@/services/api";

const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner), { ssr: false });

interface GS1Data {
  ean: string;
  peso: string; // Se mantiene como string para el input
  vencimiento: string; // YYYY-MM-DD
  lote: string;
}

export default function RecepcionBodegaPage() {
  const [scanInput, setScanInput] = useState("");
  const [parsedData, setParsedData] = useState<GS1Data | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Hacer focus automáticamente en el input principal
  useEffect(() => {
    if (!parsedData && inputRef.current) {
      inputRef.current.focus();
    }
  }, [parsedData]);

  const parseGS1 = (barcode: string) => {
    // Ejemplo: (01)12032532050005(3102)001051(15)260614(10)3989791(21)0259241
    let ean = "";
    let peso = "";
    let vencimiento = "";
    let lote = "";

    // (01): 14 dígitos
    const eanMatch = barcode.match(/\(01\)(\d{14})/);
    if (eanMatch) ean = eanMatch[1];

    // (3102): 6 dígitos
    const pesoMatch = barcode.match(/\(3102\)(\d{6})/);
    if (pesoMatch) {
      const rawPeso = pesoMatch[1];
      // Ej: 001051 -> 10.51
      const intPart = parseInt(rawPeso.substring(0, 4), 10);
      const decPart = rawPeso.substring(4, 6);
      peso = `${intPart}.${decPart}`;
    }

    // (15): 6 dígitos (YYMMDD)
    const vencMatch = barcode.match(/\(15\)(\d{6})/);
    if (vencMatch) {
      const rawVenc = vencMatch[1];
      const yy = rawVenc.substring(0, 2);
      const mm = rawVenc.substring(2, 4);
      const dd = rawVenc.substring(4, 6);
      vencimiento = `20${yy}-${mm}-${dd}`;
    }

    // (10): Hasta el siguiente paréntesis o fin del string
    const loteMatch = barcode.match(/\(10\)([^()]+)/);
    if (loteMatch) lote = loteMatch[1];

    if (!ean) {
      setErrorMsg("No se pudo extraer el EAN (01) del código de barras. Verifique el formato.");
      setScanInput("");
      return;
    }

    setParsedData({ ean, peso, vencimiento, lote });
    setErrorMsg("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (scanInput.trim()) {
        parseGS1(scanInput.trim());
      }
    }
  };

  const rebuildBarcode = (data: GS1Data) => {
    // Reconstruye el código GS1 para enviarlo al backend, incluyendo cualquier corrección manual
    // Peso: 10.51 -> 001051
    const parts = data.peso.split(".");
    let intP = parts[0] || "0";
    let decP = parts[1] || "00";
    decP = decP.padEnd(2, "0").substring(0, 2);
    const rawPeso = intP.padStart(4, "0") + decP;

    // Vencimiento: 2026-06-14 -> 260614
    const vParts = data.vencimiento.split("-");
    let rawVenc = "000000";
    if (vParts.length === 3) {
      rawVenc = `${vParts[0].substring(2, 4)}${vParts[1]}${vParts[2]}`;
    }

    return `(01)${data.ean}(3102)${rawPeso}(15)${rawVenc}(10)${data.lote}`;
  };

  const handleConfirm = async () => {
    if (!parsedData) return;
    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    const finalBarcode = rebuildBarcode(parsedData);

    try {
      await recepcionarPallet(finalBarcode);
      setSuccessMsg(`Recepción exitosa del pallet. EAN: ${parsedData.ean}`);
      // Ocultar formulario, volver al scan y limpiar en 2 segundos
      setTimeout(() => handleReset(), 2500);
    } catch (err: any) {
      setErrorMsg(err.message || "Error al recepcionar el pallet en la bodega.");
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setParsedData(null);
    setScanInput("");
    setIsSubmitting(false);
    // Remover mensaje de éxito si es que se resetea manual
    if (successMsg && isSubmitting === false) setSuccessMsg("");
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="text-indigo-600" /> Recepción de Bodega
        </h1>
        <p className="text-slate-500 mt-1">Escanee la etiqueta del pallet (GS1-128) para registrar el ingreso de perecibles.</p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium flex items-center gap-2">
           {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-medium flex items-center gap-2">
          <CheckCircle2 size={18} /> {successMsg}
        </div>
      )}

      {!parsedData ? (
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-6">
            <ScanBarcode size={40} />
          </div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Esperando lectura...</h2>
          <p className="text-slate-500 text-sm mb-8 max-w-md">
            Utilice la pistola para escanear el código de barras de la caja. El sistema detectará automáticamente los datos cuando finalice la lectura.
          </p>
          <input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full max-w-lg h-14 px-6 text-lg border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all text-center tracking-wider font-mono shadow-inner mb-6"
            placeholder="Ej: (01)12032532050005..."
            autoFocus
          />
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 font-medium">o también puede</span>
            <button
              onClick={() => setIsCameraOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl font-semibold transition-all shadow-sm"
            >
              <Camera size={18} /> Escanear con Cámara
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="text-emerald-500" size={20} /> Etiqueta Validada
            </h2>
            <button
              onClick={() => { setSuccessMsg(""); handleReset(); }}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <RotateCcw size={14} /> Escanear otro
            </button>
          </div>

          <div className="p-6">
            <p className="text-sm text-slate-500 mb-6">Verifique los datos extraídos. Puede hacer correcciones manuales si la etiqueta está dañada antes de confirmar.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">EAN / GTIN (01)</label>
                <input
                  type="text"
                  value={parsedData.ean}
                  onChange={(e) => setParsedData({ ...parsedData, ean: e.target.value })}
                  className="w-full h-10 px-3 border border-slate-300 rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Lote (10)</label>
                <input
                  type="text"
                  value={parsedData.lote}
                  onChange={(e) => setParsedData({ ...parsedData, lote: e.target.value })}
                  className="w-full h-10 px-3 border border-slate-300 rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Fecha de Vencimiento (15)</label>
                <input
                  type="date"
                  value={parsedData.vencimiento}
                  onChange={(e) => setParsedData({ ...parsedData, vencimiento: e.target.value })}
                  className="w-full h-10 px-3 border border-slate-300 rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Peso Neto KG (3102)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={parsedData.peso}
                    onChange={(e) => setParsedData({ ...parsedData, peso: e.target.value })}
                    className="w-full h-10 pl-3 pr-10 border border-slate-300 rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm"
                  />
                  <span className="absolute right-3 top-2.5 text-sm text-slate-400 font-medium pointer-events-none">kg</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => { setSuccessMsg(""); handleReset(); }}
                className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                disabled={isSubmitting}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Procesando..." : "Confirmar Recepción"}
                {!isSubmitting && <ArrowRight size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Camera size={20} className="text-indigo-600" />
                Escanear Etiqueta
              </h3>
              <button 
                onClick={() => setIsCameraOpen(false)} 
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 bg-white rounded-full hover:bg-slate-200"
              >
                <X size={20} />
              </button>
            </div>
            <div className="bg-slate-100 p-4">
              <div className="rounded-xl overflow-hidden shadow-inner bg-black aspect-square flex items-center justify-center relative">
                <Scanner 
                  onScan={(result) => {
                    if (Array.isArray(result) && result.length > 0) {
                      const code = result[0].rawValue;
                      setIsCameraOpen(false);
                      parseGS1(code);
                    } else if (typeof result === "string") {
                      setIsCameraOpen(false);
                      parseGS1(result);
                    } else if (result && (result as any).rawValue) {
                      setIsCameraOpen(false);
                      parseGS1((result as any).rawValue);
                    }
                  }} 
                  components={{ audio: false, finder: true }}
                />
              </div>
              <p className="text-center text-sm font-medium text-slate-500 mt-4">
                Enfoque el código de barras dentro del recuadro
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
