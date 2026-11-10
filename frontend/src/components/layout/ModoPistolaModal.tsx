"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  getStockAgrupado,
  getPatentesStrict,
  moverSatoAVitrina,
  declararMermaRapida,
  StockAgrupadoFamilia,
  ProductoDetalleStock,
  LoteDetalleFEFO,
  Patente,
} from "@/services/api";

interface ProductoEncontrado extends ProductoDetalleStock {
  loteBodegaFefo?: LoteDetalleFEFO;
  patenteDestino?: string;
}

export function ModoPistolaModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [producto, setProducto] = useState<ProductoEncontrado | null>(null);
  const [cantidadAccion, setCantidadAccion] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const [cachedProductos, setCachedProductos] = useState<ProductoDetalleStock[]>([]);
  const [cachedPatentes, setCachedPatentes] = useState<Patente[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Cargar catálogo y patentes en memoria para respuesta instantánea (sub-segundo)
  const cargarCatalogos = useCallback(async () => {
    try {
      const [stockData, patentesData] = await Promise.all([
        getStockAgrupado(),
        getPatentesStrict().catch(() => [] as Patente[]),
      ]);
      const flat: ProductoDetalleStock[] = [];
      (stockData || []).forEach((fam: StockAgrupadoFamilia) => {
        (fam.sub_familias || []).forEach((sub) => {
          (sub.productos || []).forEach((p: ProductoDetalleStock) => flat.push(p));
        });
      });
      setCachedProductos(flat);
      setCachedPatentes(patentesData || []);
    } catch {
      // silencioso
    }
  }, []);

  // Escuchar F2 o evento global para abrir/cerrar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    const handleCustomOpen = () => {
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("bvcore:open-modo-pistola", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("bvcore:open-modo-pistola", handleCustomOpen);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      cargarCatalogos();
      setFeedbackMsg(null);
      setProducto(null);
      setScanCode("");
      setCantidadAccion(1);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen, cargarCatalogos]);

  // Buscar producto al ingresar código
  const handleBuscar = useCallback(
    (codigoRaw: string) => {
      const q = codigoRaw.trim().toLowerCase();
      if (!q) return;

      const found = cachedProductos.find(
        (p) =>
          p.sku.toLowerCase() === q ||
          (p.ean && p.ean.toLowerCase() === q) ||
          (p.dun14 && p.dun14.toLowerCase() === q) ||
          p.nombre.toLowerCase().includes(q)
      );

      if (!found) {
        setFeedbackMsg({
          text: `No se encontró producto con código: "${codigoRaw}". Revisa el catálogo.`,
          type: "error",
        });
        setProducto(null);
        return;
      }

      // Buscar lote más antiguo en Bodega (FEFO)
      const lotesBodega = (found.lotes || []).filter(
        (l) => l.stock > 0 && (l.ubicacion || "").toLowerCase().includes("bodega")
      );
      const loteFefo = lotesBodega[0] || (found.lotes || [])[0];

      // Determinar góndola/patente por defecto
      const patenteAsignada =
        cachedPatentes.find((pat) => (pat.productos_asignados || []).includes(found.sku))
          ?.id_patente ||
        cachedPatentes[0]?.id_patente ||
        "GOND-01";

      setProducto({
        ...found,
        loteBodegaFefo: loteFefo,
        patenteDestino: patenteAsignada,
      });
      setCantidadAccion(1);
      setFeedbackMsg(null);
    },
    [cachedProductos, cachedPatentes]
  );

  // Acción 1: Reponer a vitrina
  const handleReponerVitrina = async () => {
    if (!producto || isProcessing) return;
    if (!producto.loteBodegaFefo) {
      setFeedbackMsg({
        text: `"${producto.nombre}" no tiene lotes registrados en bodega para traspasar.`,
        type: "error",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const cant = Math.min(
        cantidadAccion,
        producto.loteBodegaFefo.stock || cantidadAccion
      );
      await moverSatoAVitrina(
        producto.loteBodegaFefo.sato_id,
        producto.patenteDestino || "GOND-01",
        1,
        1,
        cant
      );
      setFeedbackMsg({
        text: `✓ ¡Listo! Se repusieron ${cant} un de "${producto.nombre}" en Vitrina (${producto.patenteDestino || "Góndola"}).`,
        type: "success",
      });
      await cargarCatalogos();
      setProducto(null);
      setScanCode("");
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err: any) {
      setFeedbackMsg({
        text: err?.message || "No se pudo realizar el movimiento a vitrina.",
        type: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Acción 2: Registrar Merma
  const handleRegistrarMerma = async () => {
    if (!producto || isProcessing) return;
    setIsProcessing(true);
    try {
      const resp = await declararMermaRapida({
        sku: producto.sku,
        cantidad: cantidadAccion,
        motivo: "Merma en sala / pistola rápida",
        origen: "VITRINA",
      });
      setFeedbackMsg({
        text: `✓ Merma registrada: -${resp.cantidad_registrada} un de "${producto.nombre}" ($${resp.valor_merma_clp.toLocaleString("es-CL")} CLP).`,
        type: "success",
      });
      await cargarCatalogos();
      setProducto(null);
      setScanCode("");
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err: any) {
      setFeedbackMsg({
        text: err?.message || "Error al registrar la merma del producto.",
        type: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Acción 3: Confirmar conteo cíclico
  const handleConfirmarConteo = () => {
    if (!producto) return;
    setFeedbackMsg({
      text: `✓ Conteo OK: "${producto.nombre}" verificado (${producto.stock_individual} un totales).`,
      type: "success",
    });
    setProducto(null);
    setScanCode("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Atajos numéricos 1, 2, 3 cuando hay un producto seleccionado
  useEffect(() => {
    if (!isOpen || !producto) return;

    const handleActionKeys = (e: KeyboardEvent) => {
      // Ignorar si el foco está en el input de texto
      if (document.activeElement === inputRef.current && e.key !== "Enter") {
        return;
      }

      if (e.key === "1") {
        e.preventDefault();
        handleReponerVitrina();
      } else if (e.key === "2") {
        e.preventDefault();
        handleRegistrarMerma();
      } else if (e.key === "3") {
        e.preventDefault();
        handleConfirmarConteo();
      }
    };

    window.addEventListener("keydown", handleActionKeys);
    return () => window.removeEventListener("keydown", handleActionKeys);
  }, [isOpen, producto, cantidadAccion]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border-2 border-rose-300 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-rose-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-600 to-rose-500 text-white flex items-center justify-center font-black text-xs shadow-xs">
              ⚡
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                Modo Pistola · Reposición Rápida
              </h2>
              <span className="text-[11px] text-slate-400">
                Atajo <kbd className="font-mono font-bold bg-slate-100 px-1 rounded">F2</kbd> o pistola de código de barras
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-slate-400 hover:text-slate-700 text-xs font-bold px-2 py-1 rounded-lg transition"
          >
            ✕ Cerrar [Esc]
          </button>
        </div>

        {/* Input de Lectura Automática */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700">
            Escanea código de barras EAN o escribe SKU:
          </label>
          <input
            ref={inputRef}
            type="text"
            value={scanCode}
            onChange={(e) => {
              const val = e.target.value;
              setScanCode(val);
              handleBuscar(val);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleBuscar(scanCode);
              }
            }}
            placeholder="Pistolea código de barra aquí..."
            className="w-full bg-slate-50 border-2 border-rose-200 focus:border-rose-600 rounded-2xl px-4 py-3 text-sm font-mono font-bold text-slate-900 focus:outline-none focus:bg-white transition"
          />
        </div>

        {/* Mensajes de feedback */}
        {feedbackMsg && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold border ${
              feedbackMsg.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                : feedbackMsg.type === "error"
                ? "bg-rose-50 text-rose-800 border-rose-300"
                : "bg-slate-50 text-slate-700 border-slate-200"
            }`}
          >
            {feedbackMsg.text}
          </div>
        )}

        {/* Ficha del Producto Detectado */}
        {producto && (
          <div className="rounded-2xl bg-rose-50/50 border border-rose-200/90 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">{producto.nombre}</h3>
                <span className="text-xs text-slate-500 font-mono">
                  SKU: {producto.sku} {producto.ean ? `· EAN: ${producto.ean}` : ""}
                </span>
              </div>
              <span className="text-xs font-black bg-rose-600 text-white px-2.5 py-0.5 rounded-lg shrink-0">
                Total: {producto.stock_individual} un
              </span>
            </div>

            {/* Balances Vitrina vs Bodega */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white rounded-xl p-2.5 border border-slate-200/80">
                <span className="text-[11px] text-slate-400 block font-semibold">
                  En Vitrina (Sala)
                </span>
                <strong className="text-sm font-extrabold text-slate-900">
                  {producto.stock_vitrina ?? 0} un
                </strong>
              </div>
              <div className="bg-white rounded-xl p-2.5 border border-slate-200/80">
                <span className="text-[11px] text-slate-400 block font-semibold">
                  En Bodega (Trastienda)
                </span>
                <strong className="text-sm font-extrabold text-slate-900">
                  {producto.stock_bodega ?? 0} un
                </strong>
                {producto.loteBodegaFefo && (
                  <span className="text-[10px] text-rose-600 block mt-0.5 font-medium truncate">
                    Lote FEFO: {producto.loteBodegaFefo.id_lote}
                  </span>
                )}
              </div>
            </div>

            {/* Selector de cantidad para la acción */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-bold text-slate-600">Cantidad a procesar:</span>
              <div className="flex items-center gap-1.5">
                {[1, 6, 12].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCantidadAccion(c)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                      cantidadAccion === c
                        ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {c} un
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  value={cantidadAccion}
                  onChange={(e) =>
                    setCantidadAccion(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="w-14 px-2 py-1 rounded-lg text-xs font-bold text-center border border-slate-300 bg-white"
                />
              </div>
            </div>

            {/* 3 Botones de Acción Inmediata (Teclas [1], [2], [3]) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-rose-200/70">
              <button
                type="button"
                onClick={handleReponerVitrina}
                disabled={isProcessing}
                className="py-3 px-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-extrabold text-xs shadow-md shadow-emerald-200 transition flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-50"
              >
                <span>[1] Reponer a Vitrina</span>
                <span className="text-[10px] opacity-90 font-medium">
                  Bodega → Góndola
                </span>
              </button>

              <button
                type="button"
                onClick={handleRegistrarMerma}
                disabled={isProcessing}
                className="py-3 px-2 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white font-extrabold text-xs shadow-md shadow-rose-200 transition flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-50"
              >
                <span>[2] Dar de Baja</span>
                <span className="text-[10px] opacity-90 font-medium">
                  Merma / Vencimiento
                </span>
              </button>

              <button
                type="button"
                onClick={handleConfirmarConteo}
                disabled={isProcessing}
                className="py-3 px-2 rounded-2xl bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs shadow-md transition flex flex-col items-center justify-center gap-0.5 cursor-pointer disabled:opacity-50"
              >
                <span>[3] Conteo OK</span>
                <span className="text-[10px] text-slate-300 font-medium">
                  Verificar Stock
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
