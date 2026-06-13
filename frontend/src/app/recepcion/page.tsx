"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { Package, ScanBarcode, ArrowRight, CheckCircle2, Camera, X, Box, AlertCircle } from "lucide-react";
import { recepcionarPallet, recepcionarLpn } from "@/services/api";

const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner), { ssr: false });

interface GS1Data {
  ean: string;
  peso: string;
  vencimiento: string;
  lote: string;
}

interface LPNData {
  destino: string;
  lpn: string;
  tipo_carga: string;
}

type ParsedData = 
  | { type: "GS1"; data: GS1Data; original: string }
  | { type: "LPN"; data: LPNData; original: string };

export default function RecepcionBodegaPage() {
  const [scanInput, setScanInput] = useState("");
  const [parsedResult, setParsedResult] = useState<ParsedData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!parsedResult && inputRef.current && !isCameraOpen) {
      inputRef.current.focus();
    }
  }, [parsedResult, isCameraOpen]);

  const procesarCodigo = (rawString: string) => {
    const barcode = rawString.trim();
    if (!barcode) return;

    setErrorMsg("");
    setSuccessMsg("");

    // Caso A: Etiqueta de Pallet CD (Ejemplo: 3513=0000000008089962588SECO)
    if (barcode.includes("=")) {
      const parts = barcode.split("=");
      const destino = parts[0] || "";
      const rest = parts[1] || "";
      
      const lpnMatch = rest.match(/^0*(\d+)/);
      const lpn = lpnMatch ? lpnMatch[1] : "";
      
      const tipoCargaMatch = rest.match(/([A-Za-z]+)$/);
      const tipo_carga = tipoCargaMatch ? tipoCargaMatch[1].toUpperCase() : "";

      if (lpn) {
        setParsedResult({ type: "LPN", data: { destino, lpn, tipo_carga }, original: barcode });
        return;
      }
    }

    // Caso B: Lectura de LPN Directo (Si la cámara leyó el código de arriba por accidente)
    // Si son solo números y tiene entre 8 y 12 caracteres (Ej: 8089962588)
    if (/^\d{8,12}$/.test(barcode)) {
      setParsedResult({ 
        type: "LPN", 
        // Asignamos strings vacíos para forzar al operador a seleccionarlos en el UI
        data: { destino: "", lpn: barcode, tipo_carga: "" }, 
        original: barcode 
      });
      return;
    }

    // Caso C: Proveedor Directo GS1-128 (Ej: (01)1203253205...)
    let ean = "";
    let peso = "";
    let vencimiento = "";
    let lote = "";

    const eanMatch = barcode.match(/\(?01\)?(\d{14})/);
    if (eanMatch) {
      ean = eanMatch[1];
      
      const pesoMatch = barcode.match(/\(?3102\)?(\d{6})/);
      if (pesoMatch) {
        const rawPeso = pesoMatch[1];
        const intPart = parseInt(rawPeso.substring(0, 4), 10);
        const decPart = rawPeso.substring(4, 6);
        peso = `${intPart}.${decPart}`;
      }

      const vencMatch = barcode.match(/\(?15\)?(\d{6})/);
      if (vencMatch) {
        const rawVenc = vencMatch[1];
        const yy = rawVenc.substring(0, 2);
        const mm = rawVenc.substring(2, 4);
        const dd = rawVenc.substring(4, 6);
        vencimiento = `20${yy}-${mm}-${dd}`;
      }

      const loteMatch = barcode.match(/\(?10\)?([^()]+)/);
      if (loteMatch) lote = loteMatch[1];

      setParsedResult({ type: "GS1", data: { ean, peso, vencimiento, lote }, original: barcode });
      return;
    }

    // Si no cayó en ningún caso válido:
    setErrorMsg(`Formato no reconocido. Texto extraído: "${barcode}". Verifique el código.`);
    setScanInput("");
  };

  const [cameraFeedback, setCameraFeedback] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const data = scanInput.trim();
      
      // Filtro de Exclusión Activa para códigos "basura" o LPN cortos accidentales
      if (/^[0-9]{8,14}$/.test(data)) {
        setScanInput(""); // Limpiar el input para volver a leer
        return; // Ignorar silenciosamente
      }
      
      procesarCodigo(data);
    }
  };

  const rebuildBarcode = (data: GS1Data) => {
    const parts = data.peso.split(".");
    let intP = parts[0] || "0";
    let decP = parts[1] || "00";
    decP = decP.padEnd(2, "0").substring(0, 2);
    const rawPeso = intP.padStart(4, "0") + decP;

    const vParts = data.vencimiento.split("-");
    let rawVenc = "000000";
    if (vParts.length === 3) {
      rawVenc = `${vParts[0].substring(2, 4)}${vParts[1]}${vParts[2]}`;
    }

    return `(01)${data.ean}(3102)${rawPeso}(15)${rawVenc}(10)${data.lote}`;
  };

  const handleConfirm = async () => {
    if (!parsedResult) return;
    
    // Validación estricta final antes de enviar
    if (parsedResult.type === "LPN" && (!parsedResult.data.destino || !parsedResult.data.tipo_carga)) {
      setErrorMsg("Debe seleccionar un Destino y un Tipo de Carga válidos.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (parsedResult.type === "GS1") {
        const finalBarcode = rebuildBarcode(parsedResult.data);
        await recepcionarPallet(finalBarcode);
        setSuccessMsg(`Recepción exitosa de producto. EAN: ${parsedResult.data.ean}`);
      } else if (parsedResult.type === "LPN") {
        await recepcionarLpn({
          destino: parsedResult.data.destino,
          lpn: parsedResult.data.lpn,
          tipo_carga: parsedResult.data.tipo_carga,
          original_barcode: parsedResult.original
        });
        setSuccessMsg(`Recepción exitosa de consolidado. LPN: ${parsedResult.data.lpn}`);
      }
      setTimeout(() => handleReset(), 2500);
    } catch (err: any) {
      setErrorMsg(err.message || "Error al recepcionar en la bodega.");
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setParsedResult(null);
    setScanInput("");
    setIsSubmitting(false);
    setSuccessMsg("");
    setErrorMsg("");
    setCameraFeedback("");
    if (inputRef.current) inputRef.current.focus();
  };

  const isLpnConfirmDisabled = isSubmitting || 
    (parsedResult?.type === "LPN" && (!parsedResult.data.destino || !parsedResult.data.tipo_carga));

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="text-indigo-600" /> Recepción de Bodega
        </h1>
        <p className="text-slate-500 mt-1">Escanee la etiqueta del pallet o producto para registrar su ingreso.</p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
           <AlertCircle size={18} /> {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-medium flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
          <CheckCircle2 size={18} /> {successMsg}
        </div>
      )}

      {!parsedResult ? (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          
          {isCameraOpen ? (
            <div className="w-full max-w-lg mb-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-3">
                 <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <Camera size={20} className="text-indigo-600"/> Escáner de Cámara Activo
                 </h2>
                 <button onClick={() => setIsCameraOpen(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-2 rounded-full transition-colors">
                    <X size={20} />
                 </button>
              </div>
              <div className="rounded-xl overflow-hidden shadow-inner bg-black aspect-[4/3] flex items-center justify-center relative">
                <Scanner 
                  onScan={(result) => {
                    let code = "";
                    if (Array.isArray(result) && result.length > 0) {
                      code = result[0].rawValue;
                    } else if (typeof result === "string") {
                      code = result;
                    } else if (result && (result as any).rawValue) {
                      code = (result as any).rawValue;
                    }
                    
                    if (code) {
                      const data = code.trim();
                      
                      // Filtro de Exclusión Activa (Ignorar códigos cortos de 8 a 14 números)
                      if (/^[0-9]{8,14}$/.test(data)) {
                        setCameraFeedback("Buscando código principal...");
                        setTimeout(() => setCameraFeedback(""), 1500);
                        return; // Retorno silencioso, no apaga la cámara
                      }

                      // Solo si pasa el filtro (es decir, tiene "=" o "(01)" o es más largo/complejo)
                      setIsCameraOpen(false);
                      procesarCodigo(data);
                    }
                  }} 
                  components={{ finder: true }}
                />
              </div>
              <p className="text-sm text-slate-500 mt-4 animate-pulse font-medium">
                {cameraFeedback ? (
                  <span className="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{cameraFeedback}</span>
                ) : (
                  "Apuntando al código de barras..."
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="w-20 h-20 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-6">
                <ScanBarcode size={40} />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Esperando lectura...</h2>
              <p className="text-slate-500 text-sm mb-8 max-w-md">
                Utilice la pistola para escanear, o abra la cámara del dispositivo móvil.
              </p>
              
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full max-w-lg h-14 px-6 text-lg border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all text-center tracking-wider font-mono shadow-inner mb-6"
                placeholder="Escaneo manual o pistola..."
                autoFocus
              />
              
              <button
                onClick={() => setIsCameraOpen(true)}
                className="flex items-center justify-center gap-2 w-full max-w-lg px-6 py-4 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl font-semibold transition-all shadow-md hover:shadow-lg"
              >
                <Camera size={22} /> Abrir Cámara del Teléfono
              </button>
            </>
          )}
        </div>
      ) : parsedResult.type === "GS1" ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="text-emerald-500" size={20} /> Producto Directo (GS1-128)
            </h2>
          </div>

          <div className="px-6 py-4 bg-slate-900 flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Código Crudo Leído por Cámara:</span>
            <code className="font-mono text-[15px] text-emerald-400 break-all">{parsedResult.original}</code>
          </div>

          <div className="p-6">
            <p className="text-sm text-slate-500 mb-6 font-medium">Fase 2: Validación Humana. Edite los campos si la lectura automática falló.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">EAN / GTIN</label>
                <input
                  type="text"
                  value={parsedResult.data.ean}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, ean: e.target.value } })}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm bg-slate-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Lote</label>
                <input
                  type="text"
                  value={parsedResult.data.lote}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, lote: e.target.value } })}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm uppercase bg-slate-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Vencimiento</label>
                <input
                  type="date"
                  value={parsedResult.data.vencimiento}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, vencimiento: e.target.value } })}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-slate-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700">Peso (Kg)</label>
                <input
                  type="number"
                  step="0.01"
                  value={parsedResult.data.peso}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, peso: e.target.value } })}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm bg-slate-50"
                />
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3">
              <button
                onClick={handleReset}
                className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors"
                disabled={isSubmitting}
              >
                Cancelar / Volver a escanear
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {isSubmitting ? "Enviando al servidor..." : "Confirmar Recepción"}
                {!isSubmitting && <ArrowRight size={20} />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-indigo-800 flex items-center gap-2">
              <Box className="text-indigo-600" size={20} /> Pallet Consolidado (LPN)
            </h2>
          </div>

          <div className="px-6 py-4 bg-slate-900 flex flex-col gap-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Código Crudo Leído por Cámara:</span>
            <code className="font-mono text-[15px] text-emerald-400 break-all">{parsedResult.original}</code>
          </div>

          <div className="p-6">
            <p className="text-sm text-slate-500 mb-6 font-medium">Fase 2: Validación Humana. Por favor seleccione el destino y tipo si faltan datos.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-bold text-slate-700">LPN (Handling Unit)</label>
                <input
                  type="text"
                  value={parsedResult.data.lpn}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, lpn: e.target.value } })}
                  className="w-full h-12 px-4 border-2 border-slate-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-lg text-indigo-700 font-bold bg-slate-50"
                  readOnly
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-1">
                  Destino <span className="text-red-500">*</span>
                </label>
                <select
                  value={parsedResult.data.destino}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, destino: e.target.value } })}
                  className={`w-full h-12 px-4 border ${!parsedResult.data.destino ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50'} rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-base font-semibold cursor-pointer`}
                >
                  <option value="" disabled>-- Seleccione --</option>
                  <option value="3513">3513 - S10 San Joaquín</option>
                  <option value="3514">3514 - S11 La Florida</option>
                  {/* Si el código largo trajo un destino que no está en la lista (ej: 4000), lo inyectamos dinámicamente para que no se pierda */}
                  {parsedResult.data.destino && !["3513", "3514"].includes(parsedResult.data.destino) && (
                    <option value={parsedResult.data.destino}>{parsedResult.data.destino} - Otro</option>
                  )}
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-3">
                <label className="text-sm font-bold text-slate-700 flex items-center gap-1">
                  Tipo de Carga <span className="text-red-500">*</span>
                </label>
                <select
                  value={parsedResult.data.tipo_carga}
                  onChange={(e) => setParsedResult({ ...parsedResult, data: { ...parsedResult.data, tipo_carga: e.target.value } })}
                  className={`w-full h-11 px-4 border ${!parsedResult.data.tipo_carga ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50'} rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm font-semibold cursor-pointer`}
                >
                  <option value="" disabled>-- Seleccione Tipo --</option>
                  <option value="SECO">SECO</option>
                  <option value="FRIO">FRIO</option>
                  <option value="CONGELADO">CONGELADO</option>
                  {parsedResult.data.tipo_carga && !["SECO", "FRIO", "CONGELADO"].includes(parsedResult.data.tipo_carga) && (
                    <option value={parsedResult.data.tipo_carga}>{parsedResult.data.tipo_carga}</option>
                  )}
                </select>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3">
              <button
                onClick={handleReset}
                className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition-colors"
                disabled={isSubmitting}
              >
                Cancelar / Volver a escanear
              </button>
              <button
                onClick={handleConfirm}
                disabled={isLpnConfirmDisabled}
                className="w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-400 flex items-center justify-center gap-2"
                title={isLpnConfirmDisabled ? "Complete todos los campos obligatorios (*)" : "Confirmar Recepción"}
              >
                {isSubmitting ? "Enviando al servidor..." : "Confirmar Recepción"}
                {!isSubmitting && <ArrowRight size={20} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
