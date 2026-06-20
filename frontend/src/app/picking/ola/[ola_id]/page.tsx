"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { CheckCircle2, AlertCircle, Camera, X, Box, MapPin, ArrowRight, PackageX } from "lucide-react";
import { getTareasOla, completarTarea, reportarFaltanteTarea, TareaPicking, OlaPickingResponse } from "@/services/api";
import { useOfflineSync } from "@/hooks/useOfflineSync";

const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner), { ssr: false });

export default function DirectedPickingPage() {
  const params = useParams();
  const router = useRouter();
  const olaId = Number(params?.ola_id);

  const { isOnline, syncQueueSize, registerAction } = useOfflineSync(
    'pickingSyncQueue', 
    async (payload: { tarea_id: number, ean: string }) => {
      return await completarTarea(payload.tarea_id, payload.ean);
    }
  );

  const [olaData, setOlaData] = useState<OlaPickingResponse | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [scanInput, setScanInput] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (olaId) {
      cargarTareas();
    }
  }, [olaId]);

  useEffect(() => {
    if (!isCameraOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentTaskIndex, isCameraOpen]);

  const cargarTareas = async () => {
    const data = await getTareasOla(olaId);
    if (data) {
      // Filtrar solo las tareas PENDIENTES
      const pendientes = data.tareas.filter((t) => t.estado === "PENDIENTE");
      setOlaData({ ...data, tareas: pendientes });
      setCurrentTaskIndex(0);
    } else {
      setErrorMsg("No se pudo cargar la ola de picking.");
    }
  };

  const handleScan = async (ean: string) => {
    if (!olaData || !olaData.tareas[currentTaskIndex] || isSubmitting) return;
    
    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    
    try {
      const currentTask = olaData.tareas[currentTaskIndex];
      const res = await registerAction({ tarea_id: currentTask.tarea_id, ean });
      
      setSuccessMsg(res.offline ? `[OFFLINE] ${currentTask.nombre_producto} guardado en cola.` : `¡${currentTask.nombre_producto} recolectado!`);
      setScanInput("");
      
      setTimeout(() => {
        setSuccessMsg("");
        
        const isLastTask = currentTaskIndex + 1 >= olaData.tareas.length;
        const isServerCompleted = res.result && res.result.ola_completada;
        
        if (isServerCompleted || isLastTask) {
          setOlaData((prev) => prev ? { ...prev, estado: "COMPLETADA" } : null);
        } else {
          setCurrentTaskIndex((prev) => prev + 1);
        }
        setIsSubmitting(false);
      }, 1500);

    } catch (err: any) {
      setErrorMsg(err.message || "EAN incorrecto o error de servidor.");
      setScanInput("");
      setIsSubmitting(false);
    }
  };

  const handleFaltante = async () => {
    if (!olaData || !olaData.tareas[currentTaskIndex] || isSubmitting) return;
    
    const confirm = window.confirm("¿Seguro que no encuentras el producto en sala? Esto marcará un quiebre de stock físico.");
    if (!confirm) return;

    setIsSubmitting(true);
    setErrorMsg("");
    
    try {
      const currentTask = olaData.tareas[currentTaskIndex];
      await reportarFaltanteTarea(currentTask.tarea_id);
      
      setSuccessMsg("Faltante reportado. Buscando siguiente tarea...");
      
      setTimeout(() => {
        setSuccessMsg("");
        if (currentTaskIndex + 1 >= olaData.tareas.length) {
          setOlaData((prev) => prev ? { ...prev, estado: "COMPLETADA" } : null);
        } else {
          setCurrentTaskIndex((prev) => prev + 1);
        }
        setIsSubmitting(false);
      }, 1500);

    } catch (err: any) {
      setErrorMsg(err.message || "Error al reportar faltante.");
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && scanInput.trim()) {
      e.preventDefault();
      
      // Intentar extraer el EAN si se escaneó un código GS1 completo en vez de solo el EAN
      let ean = scanInput.trim();
      const eanMatch = ean.match(/\(?01\)?(\d{14})/);
      if (eanMatch) {
        ean = eanMatch[1]; // Extraer solo el EAN
      }

      handleScan(ean);
    }
  };

  if (!olaData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (olaData.estado === "COMPLETADA" || olaData.tareas.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 size={48} />
        </div>
        <h1 className="text-3xl font-bold text-slate-800 mb-2">¡Ola Completada!</h1>
        <p className="text-slate-500 mb-8 max-w-sm">Has terminado todas las tareas de recolección para esta ola.</p>
        <button 
          onClick={() => router.push("/picking")}
          className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl shadow-md hover:bg-indigo-700 transition-colors"
        >
          Volver a Inicio
        </button>
      </div>
    );
  }

  const currentTask = olaData.tareas[currentTaskIndex];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header Sticky */}
      <div className="bg-indigo-600 text-white sticky top-0 z-10 shadow-md">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-indigo-200 font-semibold uppercase tracking-wider">Ola #{olaId}</span>
            <span className="font-bold">Tarea {currentTaskIndex + 1} de {olaData.tareas.length}</span>
          </div>
          <div className="bg-white/20 px-3 py-1 rounded-full text-sm font-mono font-bold">
            {Math.round((currentTaskIndex / olaData.tareas.length) * 100)}%
          </div>
        </div>
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-indigo-900/50">
          <div 
            className="h-full bg-emerald-400 transition-all duration-500 ease-out" 
            style={{ width: `${(currentTaskIndex / olaData.tareas.length) * 100}%` }}
          />
        </div>
      </div>

      {(!isOnline || syncQueueSize > 0) && (
        <div className={`px-4 py-2 text-center text-sm font-bold text-white shadow-inner ${isOnline ? 'bg-amber-500' : 'bg-red-500'}`}>
          {isOnline 
            ? `Sincronizando ${syncQueueSize} items pendientes...` 
            : `Sin conexión. Scans en cola: ${syncQueueSize}`
          }
        </div>
      )}

      <div className="p-4 max-w-md mx-auto space-y-4 mt-2">
        
        {/* Alertas */}
        {errorMsg && (
          <div className="p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded shadow-sm flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <span className="font-medium text-sm">{errorMsg}</span>
          </div>
        )}
        
        {successMsg && (
          <div className="p-4 bg-emerald-100 border-l-4 border-emerald-500 text-emerald-700 rounded shadow-sm flex items-center gap-3 animate-in slide-in-from-top-2">
            <CheckCircle2 size={20} />
            <span className="font-bold text-sm">{successMsg}</span>
          </div>
        )}

        {/* Tarjeta de Ubicación (GIGANTE para el operario) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-800 px-4 py-3 flex items-center gap-2">
            <MapPin className="text-amber-400" size={20} />
            <span className="text-slate-100 font-semibold text-sm uppercase tracking-widest">Dirígete a</span>
          </div>
          <div className="p-6 text-center">
            <h2 className="text-5xl font-black text-slate-800 tracking-tighter mb-2">
              {currentTask.area_pasillo}
            </h2>
            <div className="flex justify-center items-center gap-4 text-slate-500 font-medium">
              <span className="bg-slate-100 px-3 py-1 rounded-lg text-lg">Mueble: <strong className="text-slate-800">{currentTask.id_patente}</strong></span>
              <span className="bg-slate-100 px-3 py-1 rounded-lg text-lg">Nivel: <strong className="text-slate-800">{currentTask.nivel_estante}</strong></span>
            </div>
          </div>
        </div>

        {/* Tarjeta de Producto a Extraer */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-center gap-4">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-2xl font-black">{currentTask.cantidad_a_extraer}x</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 leading-tight mb-1">{currentTask.nombre_producto}</h3>
            <p className="text-slate-500 font-mono text-xs">SKU: {currentTask.sku}</p>
          </div>
        </div>

        {/* Zona de Escaneo */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mt-6">
          <h4 className="text-sm font-bold text-slate-700 mb-4 text-center uppercase tracking-widest">Verificar Extracción</h4>
          
          {isCameraOpen ? (
             <div className="mb-4 animate-in fade-in zoom-in-95 duration-200">
               <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-indigo-600 flex items-center gap-1"><Camera size={14}/> Cámara Activa</span>
                  <button onClick={() => setIsCameraOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 bg-slate-100 rounded-full">
                     <X size={16} />
                  </button>
               </div>
               <div className="rounded-xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
                 <Scanner 
                   onScan={(result) => {
                     let code = "";
                     if (Array.isArray(result) && result.length > 0) code = result[0].rawValue;
                     else if (typeof result === "string") code = result;
                     else if (result && (result as any).rawValue) code = (result as any).rawValue;
                     
                     if (code) {
                       setIsCameraOpen(false);
                       handleScan(code.trim());
                     }
                   }} 
                 />
               </div>
             </div>
          ) : (
            <div className="space-y-3">
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="w-full h-14 px-4 text-center text-lg font-mono border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all"
                placeholder="Escanea el EAN..."
              />
              <button
                onClick={() => setIsCameraOpen(true)}
                disabled={isSubmitting}
                className="w-full h-12 flex items-center justify-center gap-2 bg-indigo-50 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 transition-colors"
              >
                <Camera size={20} /> Usar Cámara
              </button>
            </div>
          )}
        </div>

        {/* Botón de Excepción (Faltante) */}
        <button
          onClick={handleFaltante}
          disabled={isSubmitting}
          className="w-full mt-4 flex items-center justify-center gap-2 py-4 text-slate-500 font-semibold hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
        >
          <PackageX size={18} /> No encuentro el producto (Short-Pick)
        </button>

      </div>
    </div>
  );
}
