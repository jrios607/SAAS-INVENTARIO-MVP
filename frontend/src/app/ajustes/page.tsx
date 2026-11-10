"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  getStockAgrupado,
  declararMermaRapida,
  getHistorialMermas,
  ProductoDetalleStock,
  MermaHistorialItem,
} from "@/services/api";

type MotivoMermaCodigo = "VENCIDO" | "ROTURA_DANO" | "DETERIORO_CADENA_FRIO";
type OrigenMermaCodigo = "AUTO" | "VITRINA" | "BODEGA";

const MOTIVOS_PRINCIPALES: Array<{
  codigo: MotivoMermaCodigo;
  titulo: string;
  subtitulo: string;
}> = [
  {
    codigo: "VENCIDO",
    titulo: "Fecha Vencida",
    subtitulo: "Retiro automático FEFO",
  },
  {
    codigo: "ROTURA_DANO",
    titulo: "Envase Dañado",
    subtitulo: "Golpe o sello roto",
  },
  {
    codigo: "DETERIORO_CADENA_FRIO",
    titulo: "Frío Perdido",
    subtitulo: "Temperatura alterada",
  },
];

const ORIGENES_DESCUENTO: Array<{
  codigo: OrigenMermaCodigo;
  label: string;
}> = [
  { codigo: "AUTO", label: "Automático (Vitrina→Bodega)" },
  { codigo: "VITRINA", label: "Solo Vitrina" },
  { codigo: "BODEGA", label: "Solo Bodega" },
];

const CANTIDADES_PRESET = [1, 2, 3, 5, 10];

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-step-1",
    title: "1. Selección del Producto",
    desc: "Escribe el nombre o código PLU/SKU del producto. El sistema detecta automáticamente el lote activo más próximo a vencer (FEFO) y su costo unitario.",
  },
  {
    targetId: "tour-step-2",
    title: "2. Cantidad y Origen",
    desc: "Elige un botón rápido (1, 2, 3, 5, 10) o ingresa otra cantidad en el recuadro. Abajo puedes definir si el descuento FEFO aplica en modo Automático (Vitrina→Bodega), Solo Vitrina o Solo Bodega.",
  },
  {
    targetId: "tour-step-3",
    title: "3. Motivo y Observación",
    desc: "Selecciona con un toque la causa principal de la merma (Fecha Vencida, Envase Dañado o Frío Perdido) y añade opcionalmente una observación breve.",
  },
  {
    targetId: "tour-step-confirm",
    title: "4. Confirmación de Baja",
    desc: "Pulsa aquí para descontar el stock del lote FEFO en tiempo real y registrar la baja en el inventario.",
  },
  {
    targetId: "tour-step-history",
    title: "5. Historial Reciente",
    desc: "Consulta en este panel lateral las bajas registradas hoy con el nombre del producto, el motivo aplicado y las unidades descontadas.",
  },
];

function formatMotivoHistorial(motivo: string): string {
  const m = (motivo || "").toUpperCase();
  if (m.includes("VENCID")) return "Fecha Vencida";
  if (m.includes("ROTURA") || m.includes("DANO") || m.includes("DAÑO")) return "Envase Dañado";
  if (m.includes("FRIO") || m.includes("FRÍO") || m.includes("CADENA")) return "Frío Perdido";
  return motivo || "Fecha Vencida";
}

export default function AjustesBodegaPage() {
  const [productosStock, setProductosStock] = useState<ProductoDetalleStock[]>([]);
  const [historialMermas, setHistorialMermas] = useState<MermaHistorialItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Paso 1: Producto o código
  const [queryProducto, setQueryProducto] = useState("");
  const [selectedProducto, setSelectedProducto] = useState<ProductoDetalleStock | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Paso 2: Cantidad y Origen
  const [cantidadMerma, setCantidadMerma] = useState<number>(2);
  const [customQtyValue, setCustomQtyValue] = useState<string>("2");
  const [isCustomQtyActive, setIsCustomQtyActive] = useState<boolean>(false);
  const [origenMerma, setOrigenMerma] = useState<OrigenMermaCodigo>("AUTO");

  // Paso 3: Motivo y Observación
  const [motivoMerma, setMotivoMerma] = useState<MotivoMermaCodigo>("VENCIDO");
  const [observacion, setObservacion] = useState("");

  // Estado de envío y modal de éxito
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mermaError, setMermaError] = useState<string | null>(null);
  const [isToastModalOpen, setIsToastModalOpen] = useState(false);

  // Estado del Tour Interactivo de Ayuda
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
  });

  const repositionTour = useCallback((stepIdx: number) => {
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;
    const targetEl = document.getElementById(step.targetId);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const padding = 8;

    setSpotlightStyle({
      top: `${rect.top - padding}px`,
      left: `${rect.left - padding}px`,
      width: `${rect.width + padding * 2}px`,
      height: `${rect.height + padding * 2}px`,
    });

    const tooltipWidth = 360;
    const tooltipHeight = 195;
    let tooltipTop = rect.bottom + padding + 12;
    let tooltipLeft = rect.left;

    if (step.targetId === "tour-step-history" && rect.left >= tooltipWidth + 32) {
      // En escritorio, la columna de Historial Reciente ocupa el alto completo a la derecha:
      // posicionamos el globo justo a su izquierda para que se vea limpio y completo.
      tooltipTop = Math.max(24, Math.min(rect.top + 16, window.innerHeight - tooltipHeight - 24));
      tooltipLeft = rect.left - padding - tooltipWidth - 16;
    } else {
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 210) {
        tooltipTop = Math.max(16, rect.top - padding - tooltipHeight);
      }
      if (tooltipLeft + tooltipWidth > window.innerWidth) {
        tooltipLeft = window.innerWidth - tooltipWidth - 16;
      }
      if (tooltipLeft < 16) {
        tooltipLeft = 16;
      }
    }

    setTooltipStyle({
      top: `${tooltipTop}px`,
      left: `${tooltipLeft}px`,
    });
  }, []);

  const updateTourStep = useCallback(
    (stepIdx: number) => {
      const step = TOUR_STEPS[stepIdx];
      if (!step) return;
      const targetEl = document.getElementById(step.targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      repositionTour(stepIdx);
      setTimeout(() => repositionTour(stepIdx), 180);
      setTimeout(() => repositionTour(stepIdx), 360);
    },
    [repositionTour]
  );

  const startTour = () => {
    setCurrentStepIndex(0);
    setIsTourActive(true);
    setTimeout(() => updateTourStep(0), 20);
  };

  const endTour = () => {
    setIsTourActive(false);
  };

  const nextTourStep = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      updateTourStep(nextIdx);
    } else {
      endTour();
    }
  };

  const prevTourStep = () => {
    if (currentStepIndex > 0) {
      const prevIdx = currentStepIndex - 1;
      setCurrentStepIndex(prevIdx);
      updateTourStep(prevIdx);
    }
  };

  useEffect(() => {
    if (!isTourActive) return;
    const handleReposition = () => repositionTour(currentStepIndex);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isTourActive, currentStepIndex, repositionTour]);

  const cargarDatos = useCallback(async () => {
    setIsLoading(true);
    try {
      const [agrupado, mermas] = await Promise.all([
        getStockAgrupado(),
        getHistorialMermas(50),
      ]);

      const flatProds: ProductoDetalleStock[] = [];
      for (const fam of agrupado || []) {
        for (const sub of fam.sub_familias || []) {
          for (const prod of sub.productos || []) {
            flatProds.push(prod);
          }
        }
      }
      setProductosStock(flatProds);
      setHistorialMermas(mermas || []);
      setSelectedProducto((prev) => {
        if (prev) {
          return flatProds.find((p) => p.sku === prev.sku) || prev;
        }
        const primeroConStock = flatProds.find((p) => (p.stock_individual || 0) > 0) || flatProds[0] || null;
        if (primeroConStock) {
          setQueryProducto(primeroConStock.nombre);
        }
        return primeroConStock;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Resolver automáticamente el producto cuando se escribe un código exacto (EAN / SKU / PLU) o nombre
  const productoDetectado = useMemo(() => {
    if (selectedProducto) return selectedProducto;
    const q = queryProducto.trim().toLowerCase();
    if (!q) return null;
    const exact = productosStock.find(
      (p) =>
        p.sku.toLowerCase() === q ||
        (p.ean || "").toLowerCase() === q ||
        p.nombre.toLowerCase() === q
    );
    if (exact) return exact;
    const partial = productosStock.find(
      (p) =>
        (p.stock_individual || 0) > 0 &&
        (p.nombre.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.ean || "").toLowerCase().includes(q))
    );
    return partial || null;
  }, [selectedProducto, queryProducto, productosStock]);

  // Sugerencias desplegables al escribir
  const sugerenciasProductos = useMemo(() => {
    const q = queryProducto.trim().toLowerCase();
    const conStock = productosStock.filter((p) => (p.stock_individual || 0) > 0);
    const base = conStock.length > 0 ? conStock : productosStock;
    if (!q) return base.slice(0, 6);
    return base
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.ean || "").toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [productosStock, queryProducto]);

  // Lote FEFO más próximo a vencer ordenado estrictamente por fecha de vencimiento ascendente
  const lotesOrdenadosFefo = useMemo(() => {
    if (!productoDetectado) return [];
    const activos = (productoDetectado.lotes || []).filter((l) => (l.stock || 0) > 0);
    return [...activos].sort((a, b) => {
      if (!a.fecha_vencimiento && !b.fecha_vencimiento) return 0;
      if (!a.fecha_vencimiento) return 1;
      if (!b.fecha_vencimiento) return -1;
      return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento);
    });
  }, [productoDetectado]);

  const infoLoteDetectado = useMemo(() => {
    if (!productoDetectado) {
      return {
        loteCodigo: "Automático FEFO",
        fechaVencimiento: null as string | null,
        ubicacion: null as string | null,
        stockLote: 0,
        costoUnitario: 0,
      };
    }
    const loteMasProximo = lotesOrdenadosFefo[0] || (productoDetectado.lotes || [])[0];
    return {
      loteCodigo: loteMasProximo?.id_lote || `FEFO-${productoDetectado.sku}`,
      fechaVencimiento: loteMasProximo?.fecha_vencimiento
        ? loteMasProximo.fecha_vencimiento.slice(0, 10)
        : null,
      ubicacion: loteMasProximo?.ubicacion || null,
      stockLote: loteMasProximo?.stock ?? (productoDetectado.stock_individual || 0),
      costoUnitario: productoDetectado.costo_unitario || 0,
    };
  }, [productoDetectado, lotesOrdenadosFefo]);

  // Cantidad de mermas registradas hoy
  const registrosHoyCount = useMemo(() => {
    const hoyStr = new Date().toISOString().slice(0, 10);
    const deHoy = historialMermas.filter((m) => String(m.fecha || "").slice(0, 10) === hoyStr);
    return deHoy.length > 0 ? deHoy.length : historialMermas.length;
  }, [historialMermas]);

  const handleSetQtyPreset = (val: number) => {
    setCantidadMerma(val);
    setCustomQtyValue(String(val));
    setIsCustomQtyActive(false);
  };

  const handleSetCustomQty = (rawVal: string) => {
    setCustomQtyValue(rawVal);
    const parsed = parseInt(rawVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      setCantidadMerma(parsed);
      setIsCustomQtyActive(true);
    } else {
      setIsCustomQtyActive(Boolean(rawVal));
    }
  };

  const handleSelectSuggestion = (prod: ProductoDetalleStock) => {
    setSelectedProducto(prod);
    setQueryProducto(prod.nombre);
    setShowSuggestions(false);
    setMermaError(null);
  };

  const handleConfirmMerma = async () => {
    setMermaError(null);
    const rawInput = queryProducto.trim();

    if (!productoDetectado && !rawInput) {
      setMermaError("Escribe el nombre o código PLU del producto.");
      return;
    }

    const qty = Number(cantidadMerma);
    if (!qty || qty <= 0) {
      setMermaError("Selecciona o ingresa una cantidad válida mayor a 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = productoDetectado
        ? {
            sku: productoDetectado.sku,
            cantidad: qty,
            motivo: motivoMerma,
            origen: origenMerma,
            comentarios: observacion.trim() || undefined,
          }
        : {
            sku: rawInput,
            ean: rawInput,
            cantidad: qty,
            motivo: motivoMerma,
            origen: origenMerma,
            comentarios: observacion.trim() || undefined,
          };

      await declararMermaRapida(payload);
      setIsToastModalOpen(true);
      await cargarDatos();
    } catch (err: any) {
      setMermaError(err?.message || "No se pudo registrar la baja de inventario.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    setIsToastModalOpen(false);
    setSelectedProducto(null);
    setQueryProducto("");
    setObservacion("");
    setCantidadMerma(2);
    setCustomQtyValue("2");
    setIsCustomQtyActive(false);
    setMermaError(null);
  };

  return (
    <div
      className="flex-1 min-h-full w-full flex flex-col text-slate-800 selection:bg-rose-100"
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        background: "linear-gradient(135deg, #fcecee 0%, #f7f8fc 50%, #edf1f7 100%)",
      }}
    >
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap");
        .card-soft {
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(226, 232, 240, 0.8);
          box-shadow: 0 10px 30px -5px rgba(200, 180, 180, 0.1);
        }
        /* Estilos del Tour Interactivo */
        #tourSpotlight {
          transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45);
        }
        #tourTooltip {
          transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
        }
        @keyframes subtlePulse {
          0%,
          100% {
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45), 0 0 0 4px rgba(244, 63, 94, 0.4);
          }
          50% {
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45), 0 0 0 8px rgba(244, 63, 94, 0.15);
          }
        }
        .tour-active-highlight {
          animation: subtlePulse 2s infinite;
        }
      `}</style>

      {/* Top Navigation Bar (Simplificado) */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div>
          <h1 className="font-bold text-slate-900 tracking-tight">Registro de Merma</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Botón de Ayuda / Tour Interactivo */}
          <button
            type="button"
            onClick={startTour}
            className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 px-3 py-2 rounded-full transition shadow-2xs cursor-pointer"
          >
            <span className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] font-bold">
              ?
            </span>
            Ayuda
          </button>
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-300 to-pink-400 flex items-center justify-center font-bold text-white text-sm shadow-sm">
            A
          </div>
        </div>
      </header>

      {/* Overlay del Tour Interactivo */}
      {isTourActive && (
        <div
          id="tourOverlay"
          className="fixed inset-0 z-50 pointer-events-auto overflow-hidden"
        >
          {/* Foco iluminado dinámico */}
          <div
            id="tourSpotlight"
            style={spotlightStyle}
            className="absolute rounded-3xl pointer-events-none tour-active-highlight"
          />

          {/* Globo de explicación */}
          <div
            id="tourTooltip"
            style={tooltipStyle}
            className="absolute bg-white border border-rose-100 rounded-3xl p-5 shadow-2xl w-[340px] sm:w-[360px] z-50 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span
                id="tourStepBadge"
                className="text-[11px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full"
              >
                Paso {currentStepIndex + 1} de {TOUR_STEPS.length}
              </span>
              <button
                type="button"
                onClick={endTour}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold cursor-pointer"
              >
                Saltar
              </button>
            </div>
            <h4 id="tourTitle" className="font-bold text-slate-900 text-sm">
              {TOUR_STEPS[currentStepIndex]?.title}
            </h4>
            <p id="tourDesc" className="text-xs text-slate-600 leading-relaxed">
              {TOUR_STEPS[currentStepIndex]?.desc}
            </p>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              {currentStepIndex > 0 ? (
                <button
                  type="button"
                  id="tourPrevBtn"
                  onClick={prevTourStep}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-xl transition cursor-pointer"
                >
                  Anterior
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                id="tourNextBtn"
                onClick={nextTourStep}
                className="ml-auto text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl transition shadow-md shadow-rose-500/20 cursor-pointer"
              >
                {currentStepIndex === TOUR_STEPS.length - 1 ? "¡Entendido!" : "Siguiente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Éxito Amigable */}
      {isToastModalOpen && (
        <div
          id="toastModal"
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-100 rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto text-xl font-bold">
              ✓
            </div>
            <h3 className="text-lg font-bold text-slate-900">¡Listo, registrado!</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              El inventario y el lote se actualizaron automáticamente sin complicaciones.
            </p>
            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-2xl transition shadow-md"
            >
              Registrar otro producto
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace (Diseño de página completa: Izquierda 3 Pasos / Derecha Historial Simplificado) */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Columna Izquierda: Pasos 1, 2 y 3 */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-5 flex flex-col">
          {/* Paso 1: Producto */}
          <div id="tour-step-1" className="card-glass card-soft rounded-3xl p-6 space-y-4 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600">
                1. Producto o código
              </span>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Escanea código de barras (EAN), SKU o escribe el nombre..."
                value={queryProducto}
                onFocus={(e) => {
                  e.currentTarget.select();
                  setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
                onChange={(e) => {
                  const val = e.target.value;
                  setQueryProducto(val);
                  setMermaError(null);
                  const clean = val.trim().toLowerCase();
                  // Pre-selección inteligente al escanear/escribir un EAN, SKU o código de lote exacto
                  const exactMatch =
                    clean.length >= 3
                      ? productosStock.find(
                          (p) =>
                            (p.ean && p.ean.toLowerCase() === clean) ||
                            p.sku.toLowerCase() === clean ||
                            (p.lotes || []).some(
                              (l) => l.id_lote && l.id_lote.toLowerCase() === clean
                            )
                        )
                      : undefined;
                  if (exactMatch) {
                    setSelectedProducto(exactMatch);
                    setShowSuggestions(false);
                  } else {
                    setSelectedProducto(null);
                    setShowSuggestions(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (productoDetectado) {
                      setSelectedProducto(productoDetectado);
                      setQueryProducto(productoDetectado.nombre);
                      setShowSuggestions(false);
                    }
                  }
                }}
                className="w-full bg-slate-50/80 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              />

              {showSuggestions && sugerenciasProductos.length > 0 && !selectedProducto && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200/90 rounded-2xl shadow-xl z-30 overflow-hidden divide-y divide-slate-100">
                  {sugerenciasProductos.map((prod) => (
                    <button
                      key={prod.sku}
                      type="button"
                      onMouseDown={() => handleSelectSuggestion(prod)}
                      className="w-full px-4 py-2.5 text-left hover:bg-rose-50/60 transition flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-800 block">{prod.nombre}</span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {prod.sku} • EAN: {prod.ean}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-rose-600 block">
                          ${(prod.costo_unitario || 0).toLocaleString("es-CL")} c/u
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Stock: {prod.stock_individual || 0} un
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Lote FEFO más próximo a vencer pre-seleccionado automáticamente */}
            <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-600">
                    Lote FEFO pre-seleccionado:{" "}
                    <strong className="text-slate-900 font-mono">
                      {infoLoteDetectado.loteCodigo}
                    </strong>
                  </span>
                  {productoDetectado && (
                    <span className="text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                      Auto-FEFO (Más próximo a vencer)
                    </span>
                  )}
                </div>
                {productoDetectado && (
                  <div className="text-[11px] text-slate-500">
                    Producto: <strong className="text-slate-700">{productoDetectado.nombre}</strong>
                    {infoLoteDetectado.fechaVencimiento
                      ? ` · Vence: ${infoLoteDetectado.fechaVencimiento}`
                      : ""}
                    {infoLoteDetectado.ubicacion
                      ? ` · Ubicación: ${infoLoteDetectado.ubicacion}`
                      : ""}
                  </div>
                )}
              </div>
              <span className="text-rose-600 font-bold shrink-0">
                ${infoLoteDetectado.costoUnitario.toLocaleString("es-CL")} c/u
              </span>
            </div>
          </div>

          {/* Paso 2: Cantidad */}
          <div id="tour-step-2" className="card-soft rounded-3xl p-6 space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-600 block">
              2. ¿Cuántas unidades?
            </span>

            <div className="grid grid-cols-6 gap-2">
              {CANTIDADES_PRESET.map((preset) => {
                const isSelected = !isCustomQtyActive && cantidadMerma === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSetQtyPreset(preset)}
                    className={
                      isSelected
                        ? "qty-btn bg-rose-600 text-white font-semibold py-3 rounded-2xl text-sm transition shadow-md shadow-rose-500/20"
                        : "qty-btn bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold py-3 rounded-2xl text-sm transition"
                    }
                  >
                    {preset}
                  </button>
                );
              })}
              <input
                type="number"
                id="customQtyInput"
                placeholder="Otra"
                min={1}
                value={customQtyValue}
                onChange={(e) => handleSetCustomQty(e.target.value)}
                className={
                  isCustomQtyActive
                    ? "bg-rose-600 text-white shadow-md shadow-rose-500/20 font-semibold py-3 px-2 rounded-2xl text-sm transition text-center focus:outline-none"
                    : "bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold py-3 px-2 rounded-2xl text-sm transition text-center focus:outline-none focus:border-rose-400 focus:bg-white"
                }
              />
            </div>

            {/* Origen del descuento FEFO */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="text-xs font-semibold text-slate-500 block">Origen del descuento</span>
              <div className="grid grid-cols-3 gap-2">
                {ORIGENES_DESCUENTO.map((orig) => {
                  const isSelected = origenMerma === orig.codigo;
                  return (
                    <button
                      key={orig.codigo}
                      type="button"
                      onClick={() => setOrigenMerma(orig.codigo)}
                      className={
                        isSelected
                          ? "origin-btn bg-rose-50 border border-rose-200 text-rose-700 font-medium py-2 px-3 rounded-xl text-xs transition"
                          : "origin-btn bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 font-medium py-2 px-3 rounded-xl text-xs transition"
                      }
                    >
                      {orig.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Paso 3: Motivo */}
          <div className="card-soft rounded-3xl p-6 space-y-4 flex-1 flex flex-col justify-between">
            <div id="tour-step-3" className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600 block">
                3. Motivo principal
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {MOTIVOS_PRINCIPALES.map((m) => {
                  const isSelected = motivoMerma === m.codigo;
                  return (
                    <div
                      key={m.codigo}
                      onClick={() => setMotivoMerma(m.codigo)}
                      className={
                        isSelected
                          ? "reason-card cursor-pointer border-2 border-rose-500 bg-rose-50/50 rounded-2xl p-4 transition space-y-1"
                          : "reason-card cursor-pointer border border-slate-200 bg-slate-50/50 hover:bg-white rounded-2xl p-4 transition space-y-1"
                      }
                    >
                      <h4
                        className={
                          isSelected
                            ? "font-bold text-sm text-slate-900"
                            : "font-bold text-sm text-slate-700"
                        }
                      >
                        {m.titulo}
                      </h4>
                      <p className={isSelected ? "text-xs text-slate-500" : "text-xs text-slate-400"}>
                        {m.subtitulo}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Observación breve opcional */}
              <div className="pt-1">
                <input
                  type="text"
                  placeholder="Observación breve (opcional)"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  className="w-full bg-slate-50/80 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:bg-white transition"
                />
              </div>

              {mermaError && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {mermaError}
                </div>
              )}
            </div>

            {/* Botón de Confirmación Principal */}
            <button
              id="tour-step-confirm"
              type="button"
              disabled={isSubmitting}
              onClick={handleConfirmMerma}
              className="w-full mt-4 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-60 text-white font-bold py-4 rounded-2xl shadow-lg shadow-rose-500/20 transition transform active:scale-98"
            >
              {isSubmitting ? "Registrando baja de inventario..." : "Confirmar baja de inventario"}
            </button>
          </div>
        </div>

        {/* Columna Derecha: Historial Simplificado de Página Completa */}
        <aside className="lg:col-span-5 xl:col-span-4 flex flex-col">
          <div id="tour-step-history" className="card-soft rounded-3xl p-6 flex-1 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Historial Reciente
              </span>
              <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full">
                {registrosHoyCount} {registrosHoyCount === 1 ? "hoy" : "hoy"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[calc(100vh-210px)]">
              {isLoading ? (
                [1, 2, 3, 4, 5].map((sk) => (
                  <div
                    key={sk}
                    className="bg-slate-50/80 border border-slate-200/60 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3 animate-pulse"
                  >
                    <div className="space-y-1.5 w-full">
                      <div className="h-3.5 w-36 bg-slate-200 rounded-md" />
                      <div className="h-2.5 w-24 bg-rose-100 rounded-md" />
                    </div>
                    <div className="h-4 w-10 bg-rose-100 rounded-md shrink-0" />
                  </div>
                ))
              ) : historialMermas.length === 0 ? (
                <div className="bg-slate-50/70 border border-slate-200/60 rounded-2xl p-6 text-center text-xs text-slate-400">
                  Sin bajas registradas hoy.
                </div>
              ) : (
                historialMermas.slice(0, 15).map((item) => (
                  <div
                    key={item.log_id}
                    className="bg-slate-50/80 border border-slate-200/60 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <strong className="text-slate-800 block truncate">
                        {item.nombre_producto}
                      </strong>
                      <p className="text-slate-400 text-[11px] truncate">
                        {formatMotivoHistorial(item.motivo)}
                      </p>
                    </div>
                    <span className="font-bold text-rose-600 shrink-0">
                      -{item.cantidad} un
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
