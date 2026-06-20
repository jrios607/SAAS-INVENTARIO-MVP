"use client";

import React, { useState, useEffect, useRef } from "react";
import { posScan, posCheckout, PosScanResponse } from "@/services/api";
import { Scanner, IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { Terminal, ShoppingCart, ScanLine, X, AlertCircle, CheckCircle2, Loader2, Camera, RefreshCcw } from "lucide-react";

interface TicketItem extends PosScanResponse {
  cantidad: number;
  ean: string;
}

export default function PosPage() {
  const [ticket, setTicket] = useState<TicketItem[]>([]);
  const [barcodeBuffer, setBarcodeBuffer] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Escuchar teclado para escáner físico
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      if (isInput) return;

      if (e.key === "Enter") {
        setBarcodeBuffer((prev) => {
          if (prev.length > 0) handleScan(prev);
          return "";
        });
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setBarcodeBuffer((prev) => prev + e.key);
      } else if (e.key === "Escape") {
        setBarcodeBuffer("");
        setShowCamera(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // <-- SIN DEPENDENCIAS, ESTO EVITA EL RE-RENDER LOOP EN CADA TECLA

  useEffect(() => {
    if (barcodeBuffer.length > 0) {
      const timeout = setTimeout(() => {
        setBarcodeBuffer("");
      }, 5000); // 5000ms para permitir tipeo manual (en produccion con laser puede ser 100ms)
      return () => clearTimeout(timeout);
    }
  }, [barcodeBuffer]);

  const handleScan = async (ean: string) => {
    if (isScanning || isCheckingOut) return;
    setIsScanning(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const response = await posScan({ ean });
      
      setTicket((prev) => {
        const idx = prev.findIndex((item) => item.sku === response.sku);
        if (idx !== -1) {
          const currentQty = prev[idx].cantidad;
          if (currentQty + 1 > response.cantidad_disponible) {
             setError(`Sin stock en vitrina para: ${response.nombre}`);
             return prev;
          }
          const newTicket = [...prev];
          newTicket[idx].cantidad += 1;
          const item = newTicket.splice(idx, 1)[0];
          return [item, ...newTicket];
        } else {
          return [{ ...response, cantidad: 1, ean }, ...prev];
        }
      });
    } catch (err: any) {
      setError(err.message || `Código no encontrado: ${ean}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemove = (sku: string) => {
    setTicket((prev) => prev.filter((item) => item.sku !== sku));
  };

  const handleCheckout = async () => {
    if (ticket.length === 0 || isCheckingOut) return;
    setIsCheckingOut(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const items = ticket.map((item) => ({
        ean: item.ean,
        cantidad: item.cantidad,
      }));
      
      if (!navigator.onLine) {
        // MODO OFFLINE: Guardar ticket en LocalStorage
        const offlineQueue = JSON.parse(localStorage.getItem("pos_offline_queue") || "[]");
        const newTicket = {
          id_ticket: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          items: items
        };
        offlineQueue.push(newTicket);
        localStorage.setItem("pos_offline_queue", JSON.stringify(offlineQueue));
        
        setSuccessMsg(`[OFFLINE] Venta guardada localmente. Pendiente de sincronización.`);
        setTicket([]);
      } else {
        // MODO ONLINE: Procesar inmediatamente
        const res = await posCheckout({ items });
        setSuccessMsg(res.mensaje);
        setTicket([]);
      }
    } catch (err: any) {
      setError(err.message || "Error al procesar el pago");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const syncOfflineTickets = async () => {
    try {
      const offlineQueue = JSON.parse(localStorage.getItem("pos_offline_queue") || "[]");
      if (offlineQueue.length === 0) {
        setSuccessMsg("No hay tickets pendientes de sincronizar.");
        return;
      }
      
      const { posSyncOffline } = await import('@/services/api');
      const res = await posSyncOffline({ tickets: offlineQueue });
      
      localStorage.removeItem("pos_offline_queue");
      setSuccessMsg(`Sincronización completada. Procesados: ${res.tickets_procesados}. Fallidos: ${res.tickets_fallidos}`);
    } catch (err: any) {
      setError("Error sincronizando: " + err.message);
    }
  };

  const total = ticket.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);
  const totalItems = ticket.reduce((acc, item) => acc + item.cantidad, 0);

  return (
    <div className="h-screen w-full bg-slate-900 text-slate-100 flex overflow-hidden font-mono">
      {/* PANEL IZQUIERDO / CENTRAL - BOLETA */}
      <div className="flex-1 flex flex-col border-r border-slate-700 bg-slate-800">
        <div className="p-6 bg-slate-900 border-b border-slate-700 flex justify-between items-center shadow-md z-10">
          <div className="flex items-center gap-3">
            <Terminal className="w-8 h-8 text-blue-400" />
            <h1 className="text-2xl font-bold tracking-widest text-slate-100">POS TERMINAL</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={syncOfflineTickets}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 flex items-center gap-2 transition-colors"
              title="Sincronizar Tickets Offline"
            >
              <RefreshCcw className="w-4 h-4" />
              <span>Sync</span>
            </button>
            <div className="text-sm text-slate-400">
              Cajero: <span className="text-slate-200 font-bold">OP-01</span>
            </div>
          </div>
        </div>

        {/* Notificaciones */}
        {error && (
          <div className="m-4 p-4 bg-red-900/50 border border-red-500 rounded flex items-center gap-3 text-red-200 shadow-lg animate-in slide-in-from-top-2">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <span className="text-lg font-bold">{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="m-4 p-4 bg-emerald-900/50 border border-emerald-500 rounded flex items-center gap-3 text-emerald-200 shadow-lg animate-in slide-in-from-top-2">
            <CheckCircle2 className="w-6 h-6 shrink-0" />
            <span className="text-lg font-bold">{successMsg}</span>
          </div>
        )}

        {/* Lista de Boleta */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {ticket.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
              <ScanLine className="w-24 h-24 mb-4" />
              <p className="text-2xl">ESPERANDO ESCANEO...</p>
            </div>
          ) : (
            ticket.map((item, idx) => (
              <div 
                key={item.sku} 
                className={`p-4 rounded border ${idx === 0 ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/50 border-slate-700'} flex items-center gap-4 transition-colors`}
              >
                <div className="flex-1">
                  <div className="text-2xl font-bold text-white mb-1">{item.nombre}</div>
                  <div className="text-slate-400 text-sm">SKU: {item.sku} | EAN: {item.ean}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg text-slate-300">{item.cantidad} x ${item.precio.toLocaleString()}</div>
                  <div className="text-3xl font-bold text-blue-400">${(item.precio * item.cantidad).toLocaleString()}</div>
                </div>
                <button 
                  onClick={() => handleRemove(item.sku)}
                  className="ml-4 p-3 hover:bg-red-500/20 text-red-400 rounded-full transition-colors"
                >
                  <X className="w-8 h-8" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PANEL DERECHO - TOTALES Y CHECKOUT */}
      <div className="w-[450px] bg-slate-900 flex flex-col">
        <div className="flex-1 p-8 flex flex-col justify-center">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl mb-8">
            <div className="text-slate-400 text-xl mb-2 uppercase tracking-widest">Total a Pagar</div>
            <div className="text-7xl font-bold text-emerald-400 tracking-tighter">
              ${total.toLocaleString()}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700 text-slate-300 text-lg">
              Artículos: <span className="font-bold text-white">{totalItems}</span>
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={ticket.length === 0 || isCheckingOut}
            className={`w-full py-8 rounded-xl text-3xl font-bold uppercase tracking-widest flex items-center justify-center gap-4 transition-all shadow-xl
              ${ticket.length === 0 
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-500 text-white hover:scale-[1.02] active:scale-95'}`}
          >
            {isCheckingOut ? (
              <><Loader2 className="w-10 h-10 animate-spin" /> PROCESANDO...</>
            ) : (
              <><ShoppingCart className="w-10 h-10" /> PAGAR AHORA</>
            )}
          </button>
        </div>

        {/* Scanner de Cámara Opional */}
        <div className="p-6 border-t border-slate-800">
          {!showCamera ? (
            <button 
              onClick={() => setShowCamera(true)}
              className="w-full py-4 border border-slate-700 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors flex items-center justify-center gap-3 text-lg"
            >
              <Camera className="w-6 h-6" />
              ACTIVAR CÁMARA (SIMULADOR)
            </button>
          ) : (
            <div className="bg-black p-2 rounded-lg border border-blue-500 relative">
              <button 
                onClick={() => setShowCamera(false)}
                className="absolute top-4 right-4 z-10 bg-black/50 p-2 rounded-full hover:bg-red-500/50 text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <Scanner
                onScan={(detectedCodes: IDetectedBarcode[]) => {
                  if (detectedCodes.length > 0) {
                    handleScan(detectedCodes[0].rawValue);
                    setShowCamera(false);
                  }
                }}
                formats={["ean_13", "ean_8", "code_128", "upc_a", "qr_code"]}
              />
              <div className="text-center text-slate-400 text-sm mt-2 font-sans">
                Apunta el código de barras a la cámara
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

