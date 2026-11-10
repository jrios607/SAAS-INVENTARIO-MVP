"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  importarArchivoVentasPos,
  dryRunArchivoVentasPos,
  importarVentasBatch,
  getHistorialVentasExternas,
  getOrphanSalesCodes,
  resolveOrphanSalesCode,
  getDetalleVentaExterna,
  revertirVentaExterna,
  getDashboardKpis,
  getProductos,
  ExternalSaleDryRunResponse,
  ExternalSaleHistoryItem,
  OrphanCodeGroupItem,
  ExternalSaleTicketDetailResponse,
  DashboardKpisResponse,
  Producto,
} from "@/services/api";

const POS_ORIGENES_ARCHIVO = [
  {
    value: "FACTURACION_CL",
    label: "Facturacion.cl (Reporte Excel / CSV)",
  },
  {
    value: "BSALE_POS",
    label: "Bsale POS (Reporte Excel / CSV)",
  },
  {
    value: "CAJA_TRADICIONAL_Z",
    label: "Caja Registradora Tradicional",
  },
  {
    value: "PLANILLA_LOCAL",
    label: "Planilla Excel Personalizada",
  },
];

interface TourStep {
  elementId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    elementId: "tour-kpis",
    title: "Métricas de Sincronización",
    desc: "Monitorea boletas procesadas hoy, unidades descontadas bajo el criterio FEFO y posibles incidencias de productos no registrados.",
  },
  {
    elementId: "tour-config",
    title: "Modalidades de Operación",
    desc: "Alterna entre subir el reporte diario de tu caja (Excel/CSV) o solicitar a BVCore la conexión automática en vivo con tu punto de venta.",
  },
  {
    elementId: "tour-history",
    title: "Historial de Transacciones",
    desc: "Revisa cada boleta sincronizada, consulta qué lotes se descontaron o anula una boleta si hubo una devolución en caja.",
  },
];

function formatShortTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const normalized =
      isoString.endsWith("Z") || isoString.includes("+") ? isoString : `${isoString}Z`;
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(normalized));
  } catch {
    return isoString;
  }
}

export default function VentasExternasPage() {
  const [modality, setModality] = useState<1 | 2>(1);
  const [dashboardKpis, setDashboardKpis] = useState<DashboardKpisResponse | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modalidad 1: Carga de Archivos + Dry-Run
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [posSource, setPosSource] = useState<string>("FACTURACION_CL");
  const [isDryRunning, setIsDryRunning] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<ExternalSaleDryRunResponse | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modalidad 2: Simulador de Boleta Rápida
  const [simTicketId, setSimTicketId] = useState<string>(
    () => `BOL-${Math.floor(1000 + Math.random() * 9000)}`
  );
  const [simPosSource, setSimPosSource] = useState<string>("BSALE_POS");
  const [simSelectedSku, setSimSelectedSku] = useState<string>("");
  const [simCantidad, setSimCantidad] = useState<number>(1);
  const [isSendingSim, setIsSendingSim] = useState<boolean>(false);

  // Catálogo e Incidencias (Códigos Huérfanos en Cuarentena)
  const [orphans, setOrphans] = useState<OrphanCodeGroupItem[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Producto[]>([]);
  const [resolvingOrphan, setResolvingOrphan] = useState<OrphanCodeGroupItem | null>(null);
  const [selectedTargetSku, setSelectedTargetSku] = useState<string>("");
  const [isResolvingOrphan, setIsResolvingOrphan] = useState<boolean>(false);

  // Historial + Detalle desplegable y Reversión
  const [history, setHistory] = useState<ExternalSaleHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [ticketDetail, setTicketDetail] = useState<ExternalSaleTicketDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isReverting, setIsReverting] = useState<boolean>(false);

  // Estado del Tour Guiado
  const [isTourActive, setIsTourActive] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
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

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const fetchAllData = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const [histData, orphanData, kpisData, prodsData] = await Promise.all([
        getHistorialVentasExternas(undefined, 50),
        getOrphanSalesCodes(),
        getDashboardKpis(),
        getProductos(),
      ]);
      setHistory(histData || []);
      setOrphans(orphanData || []);
      if (kpisData) setDashboardKpis(kpisData);
      const validProds = prodsData || [];
      setCatalogProducts(validProds);
      if (validProds.length > 0) {
        setSimSelectedSku((prev) => prev || validProds[0].sku);
        setSelectedTargetSku((prev) => prev || validProds[0].sku);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Posicionamiento del Tour Guiado
  const repositionTour = useCallback((stepIdx: number) => {
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;
    const targetEl = document.getElementById(step.elementId);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const padding = 8;

    setSpotlightStyle({
      top: `${rect.top - padding}px`,
      left: `${rect.left - padding}px`,
      width: `${rect.width + padding * 2}px`,
      height: `${rect.height + padding * 2}px`,
    });

    const tooltipHeight = 185;
    const spaceBelow = window.innerHeight - rect.bottom;
    let tooltipLeft = Math.max(16, rect.left + rect.width / 2 - 180);
    if (tooltipLeft + 360 > window.innerWidth) {
      tooltipLeft = window.innerWidth - 380;
    }

    let tooltipTop =
      spaceBelow > tooltipHeight || rect.top < 220
        ? rect.bottom + 15
        : rect.top - padding - tooltipHeight - 10;

    setTooltipStyle({
      top: `${Math.max(20, tooltipTop)}px`,
      left: `${Math.max(16, tooltipLeft)}px`,
    });
  }, []);

  const updateTourStep = useCallback(
    (stepIdx: number) => {
      const step = TOUR_STEPS[stepIdx];
      if (!step) return;
      const targetEl = document.getElementById(step.elementId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      repositionTour(stepIdx);
      setTimeout(() => repositionTour(stepIdx), 150);
      setTimeout(() => repositionTour(stepIdx), 350);
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

  // Acciones Modalidad 1: Archivo y Dry-Run
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setDryRunResult(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setDryRunResult(null);
    }
  };

  const handleDownloadTemplate = () => {
    const sample = [
      "ticket_id,ean,sku,cantidad,precio_unitario,timestamp",
      "BOL-1001,7802000000220,ACE-NAT-1L,2,1850,2026-11-09T10:15:00Z",
      "BOL-1002,7801505000037,ARR-TUC-1KG,1,1490,2026-11-09T10:18:00Z",
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_ventas_pos.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDryRunFile = async () => {
    if (!selectedFile) {
      showToast("Selecciona primero un archivo Excel (.xlsx) o .CSV de tu caja.");
      return;
    }
    setIsDryRunning(true);
    try {
      const preview = await dryRunArchivoVentasPos(selectedFile, posSource);
      setDryRunResult(preview);
      showToast("Pre-visualización lista. Revisa el resumen antes de confirmar.");
    } catch (err: any) {
      showToast(err?.message || "No se pudo analizar el archivo seleccionado.");
    } finally {
      setIsDryRunning(false);
    }
  };

  const handleConfirmUploadFile = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const res = await importarArchivoVentasPos(selectedFile, posSource, null, false);
      setDryRunResult(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      showToast(
        `¡Listo! ${res.tickets_procesados} boleta(s) procesadas y ${res.unidades_descontadas} unidades descontadas.`
      );
      await fetchAllData();
    } catch (err: any) {
      showToast(err?.message || "Error al descontar las ventas del archivo.");
    } finally {
      setIsUploading(false);
    }
  };

  // Acciones Modalidad 2: Simulador de Boleta Rápida
  const handleSendSimulation = async () => {
    const cleanTicket = simTicketId.trim();
    if (!cleanTicket) {
      showToast("Ingresa un número de Folio o ID de boleta.");
      return;
    }
    const targetSku = simSelectedSku || catalogProducts[0]?.sku;
    if (!targetSku) {
      showToast("Registra al menos un producto en el Catálogo para probar una boleta.");
      return;
    }

    setIsSendingSim(true);
    try {
      await importarVentasBatch({
        pos_source: simPosSource,
        modo_historico_abc: false,
        tickets: [
          {
            external_ticket_id: cleanTicket,
            pos_source: simPosSource,
            timestamp: new Date().toISOString(),
            items: [
              {
                sku: targetSku,
                cantidad: Math.max(1, Number(simCantidad) || 1),
              },
            ],
          },
        ],
      });
      showToast("Boleta procesada correctamente por el motor FEFO.");
      setSimTicketId(`BOL-${Math.floor(1000 + Math.random() * 9000)}`);
      await fetchAllData();
    } catch (err: any) {
      showToast(err?.message || "No se pudo procesar la boleta de prueba.");
    } finally {
      setIsSendingSim(false);
    }
  };

  // Resolución de Incidencias (Códigos Huérfanos)
  const handleResolveOrphan = async () => {
    if (!resolvingOrphan || !selectedTargetSku) return;
    setIsResolvingOrphan(true);
    try {
      const res = await resolveOrphanSalesCode({
        codigo_original: resolvingOrphan.codigo_original,
        accion: "VINCULAR_EXISTENTE",
        sku_existente: selectedTargetSku,
      });
      showToast(res.mensaje || "Código vinculado y stock descontado correctamente.");
      setResolvingOrphan(null);
      await fetchAllData();
    } catch (err: any) {
      showToast(err?.message || "No se pudo vincular el código.");
    } finally {
      setIsResolvingOrphan(false);
    }
  };

  // Detalle y Anulación de Boleta en el Historial
  const handleToggleTicketDetail = async (ventaId: number) => {
    if (selectedTicketId === ventaId) {
      setSelectedTicketId(null);
      setTicketDetail(null);
      return;
    }
    setSelectedTicketId(ventaId);
    setIsLoadingDetail(true);
    setTicketDetail(null);
    try {
      const detail = await getDetalleVentaExterna(ventaId);
      setTicketDetail(detail);
    } catch {
      showToast("No se pudo cargar el detalle de la boleta.");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleRevertTicket = async (ventaId: number) => {
    setIsReverting(true);
    try {
      await revertirVentaExterna(
        ventaId,
        "Anulación de boleta solicitada por el administrador del local"
      );
      const updatedDetail = await getDetalleVentaExterna(ventaId);
      setTicketDetail(updatedDetail);
      showToast("Boleta anulada: las unidades fueron devueltas a sus lotes originales.");
      await fetchAllData();
    } catch (err: any) {
      showToast(err?.message || "No se pudo anular la boleta.");
    } finally {
      setIsReverting(false);
    }
  };

  // KPIs
  const boletasHoy = dashboardKpis?.ventas_hoy_tickets ?? history.length;
  const unidadesHoy =
    dashboardKpis?.ventas_hoy_unidades ??
    history.reduce((acc, item) => acc + item.total_unidades, 0);
  const anomaliasAbiertas =
    dashboardKpis?.alertas_operativas?.anomalias_abiertas_count ?? 0;
  const totalIncidencias = orphans.length + anomaliasAbiertas;

  return (
    <div
      className="text-slate-800 min-h-full flex-1 flex flex-col selection:bg-rose-500 selection:text-white pb-12"
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 40%, #f8fafc 100%)",
      }}
    >
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");

        .card-soft {
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(254, 202, 202, 0.65);
          box-shadow: 0 10px 30px -5px rgba(239, 68, 68, 0.07);
        }

        .card-stat {
          background: #ffffff;
          border: 1px solid rgba(254, 205, 205, 0.6);
          box-shadow: 0 4px 15px -2px rgba(225, 29, 72, 0.05);
          transition: all 0.2s ease;
        }
        .card-stat:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px -4px rgba(225, 29, 72, 0.1);
        }

        #tourSpotlight {
          position: fixed;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75);
          border: 2px solid #ef4444;
          border-radius: 1.5rem;
          pointer-events: none;
          z-index: 100;
        }

        #tourTooltip {
          position: fixed;
          z-index: 101;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes subtlePulse {
          0%,
          100% {
            border-color: #ef4444;
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75), 0 0 20px rgba(239, 68, 68, 0.4);
          }
          50% {
            border-color: #f87171;
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75), 0 0 35px rgba(239, 68, 68, 0.7);
          }
        }
        .tour-active-highlight {
          animation: subtlePulse 2s infinite ease-in-out;
        }
      `}</style>

      {/* Overlay del Tour Guiado */}
      {isTourActive && (
        <div id="tourOverlay" className="fixed inset-0 z-50">
          <div
            id="tourSpotlight"
            style={spotlightStyle}
            className="tour-active-highlight"
          />
          <div
            id="tourTooltip"
            style={tooltipStyle}
            className="bg-white border border-rose-200 shadow-2xl rounded-2xl p-5 max-w-sm w-[90vw] text-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span
                id="tourStepBadge"
                className="text-[11px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md"
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
            <div>
              <h3 id="tourTitle" className="text-base font-bold text-slate-900">
                {TOUR_STEPS[currentStepIndex]?.title}
              </h3>
              <p id="tourDescription" className="text-xs text-slate-600 leading-relaxed mt-1">
                {TOUR_STEPS[currentStepIndex]?.desc}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                id="tourPrevBtn"
                onClick={prevTourStep}
                style={{ opacity: currentStepIndex === 0 ? 0 : 1 }}
                disabled={currentStepIndex === 0}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5 cursor-pointer"
              >
                Anterior
              </button>
              <button
                type="button"
                id="tourNextBtn"
                onClick={nextTourStep}
                className="bg-gradient-to-r from-rose-600 to-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow cursor-pointer"
              >
                {currentStepIndex === TOUR_STEPS.length - 1 ? "¡Listo!" : "Siguiente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Superior */}
      <header className="bg-white/90 backdrop-blur-md border-b border-rose-100 px-6 py-4 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Ventas Externas (POS)
            </h1>
            <p className="text-xs text-slate-500">
              Sincroniza tus ventas para actualizar el stock automáticamente.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={startTour}
              className="px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold shadow-sm cursor-pointer"
            >
              ¿Cómo funciona?
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetchAllData();
                showToast("Sincronización POS actualizada.");
              }}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold transition shadow-md shadow-rose-200 active:scale-98 cursor-pointer"
            >
              Actualizar
            </button>
            <div className="flex items-center pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-rose-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                A
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Fila de Tarjetas Métricas */}
        <div id="tour-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card-stat rounded-3xl p-5 space-y-2">
            <span className="text-xs font-semibold text-slate-500">Boletas hoy</span>
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {boletasHoy.toLocaleString("es-CL")}
            </div>
            <span className="text-[11px] text-slate-400 block">Registros del día</span>
          </div>

          <div className="card-stat rounded-3xl p-5 space-y-2">
            <span className="text-xs font-semibold text-slate-500">
              Unidades descontadas hoy
            </span>
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {unidadesHoy.toLocaleString("es-CL")}
            </div>
            <span className="text-[11px] text-slate-400 block">Total de salida</span>
          </div>

          <div className="card-stat rounded-3xl p-5 space-y-2">
            <span className="text-xs font-semibold text-slate-500">Incidencias</span>
            <div
              className={`text-3xl font-black tracking-tight ${
                totalIncidencias > 0 ? "text-rose-600" : "text-slate-900"
              }`}
            >
              {totalIncidencias}
            </div>
            <span className="text-[11px] text-slate-400 block">
              {totalIncidencias === 0
                ? "Todo en orden"
                : `${orphans.length} código(s) pendiente(s) de vincular`}
            </span>
          </div>
        </div>

        {/* Bandeja de Incidencias (Solo aparece si hay códigos vendidos en caja que no existen en el Catálogo) */}
        {orphans.length > 0 && (
          <div className="card-soft rounded-3xl p-5 space-y-3 border-amber-200 bg-amber-50/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Productos vendidos en caja pendientes de vincular ({orphans.length})
                </h3>
                <p className="text-xs text-slate-600">
                  Estos códigos se vendieron en tu POS pero aún no estaban asociados en tu Catálogo. Vincúlalos para descontar su stock.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {orphans.map((o) => (
                <div
                  key={o.codigo_original}
                  className="bg-white border border-amber-200/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <strong className="font-mono text-slate-900 block">
                      {o.codigo_original}
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      {o.unidades_pendientes} un en {o.boletas_afectadas} boleta(s)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResolvingOrphan(o);
                      if (catalogProducts.length > 0 && !selectedTargetSku) {
                        setSelectedTargetSku(catalogProducts[0].sku);
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] transition cursor-pointer"
                  >
                    Vincular
                  </button>
                </div>
              ))}
            </div>

            {resolvingOrphan && (
              <div className="bg-white border border-rose-200 rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
                <div className="flex-1 space-y-1">
                  <span className="font-bold text-slate-900 block">
                    Asociar código{" "}
                    <span className="font-mono text-rose-600">
                      {resolvingOrphan.codigo_original}
                    </span>{" "}
                    al producto:
                  </span>
                  <select
                    value={selectedTargetSku}
                    onChange={(e) => setSelectedTargetSku(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800"
                  >
                    {catalogProducts.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {p.nombre} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => setResolvingOrphan(null)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isResolvingOrphan}
                    onClick={handleResolveOrphan}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 text-white font-bold shadow-sm cursor-pointer"
                  >
                    {isResolvingOrphan ? "Vinculando..." : "Confirmar y descontar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selector de Modalidades POS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            onClick={() => setModality(1)}
            id="modBtn1"
            className={
              modality === 1
                ? "card-soft rounded-3xl p-5 cursor-pointer border-2 border-rose-500 bg-rose-50/40 transition space-y-2"
                : "card-soft rounded-3xl p-5 cursor-pointer border border-slate-200 bg-white hover:bg-slate-50 transition space-y-2"
            }
          >
            <div className="flex items-center justify-between">
              <span
                className={
                  modality === 1
                    ? "text-xs font-bold uppercase tracking-wider text-rose-600"
                    : "text-xs font-bold uppercase tracking-wider text-slate-500"
                }
              >
                Modalidad 1
              </span>
              <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                Reporte Excel / CSV
              </span>
            </div>
            <h3
              className={
                modality === 1
                  ? "font-bold text-slate-900 text-sm"
                  : "font-bold text-slate-700 text-sm"
              }
            >
              Carga de Reportes y Cierre de Turno
            </h3>
            <p className="text-xs text-slate-500">
              Ideal para Facturación.cl, cajas registradoras o planillas de caja.
            </p>
          </div>

          <div
            onClick={() => setModality(2)}
            id="modBtn2"
            className={
              modality === 2
                ? "card-soft rounded-3xl p-5 cursor-pointer border-2 border-rose-500 bg-rose-50/40 transition space-y-2"
                : "card-soft rounded-3xl p-5 cursor-pointer border border-slate-200 bg-white hover:bg-slate-50 transition space-y-2"
            }
          >
            <div className="flex items-center justify-between">
              <span
                className={
                  modality === 2
                    ? "text-xs font-bold uppercase tracking-wider text-rose-600"
                    : "text-xs font-bold uppercase tracking-wider text-slate-500"
                }
              >
                Modalidad 2
              </span>
              <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                Conexión en Vivo
              </span>
            </div>
            <h3
              className={
                modality === 2
                  ? "font-bold text-slate-900 text-sm"
                  : "font-bold text-slate-700 text-sm"
              }
            >
              Conexión Automática en Vivo
            </h3>
            <p className="text-xs text-slate-400">
              Integra Bsale, Loyverse, Shopify POS o ERPs en tiempo real.
            </p>
          </div>
        </div>

        {/* Contenedor Dinámico según Modalidad */}
        <div id="tour-config" className="card-soft rounded-3xl p-6 space-y-6">
          {modality === 1 ? (
            /* Vista Modalidad 1: Carga de Archivos */
            <div id="modality1View" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Sistema POS de Origen
                      </label>
                      <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 underline cursor-pointer"
                      >
                        Descargar plantilla de ejemplo
                      </button>
                    </div>
                    <select
                      value={posSource}
                      onChange={(e) => setPosSource(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 font-semibold focus:outline-none focus:border-rose-400 transition"
                    >
                      {POS_ORIGENES_ARCHIVO.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-1">
                    <span className="text-xs font-bold text-slate-700 block">
                      Política de Descuento del Local
                    </span>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Si un producto se agota en Vitrina, el sistema descuenta automáticamente el saldo restante desde los lotes de Bodega.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,.json,.xlsx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-rose-200 rounded-3xl p-8 text-center bg-rose-50/20 hover:bg-rose-50/40 transition flex flex-col items-center justify-center space-y-3 cursor-pointer"
                  >
                    <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center font-bold text-xl shadow-2xs">
                      ↑
                    </div>
                    <div className="space-y-1">
                      <strong className="text-slate-900 text-xs font-bold block">
                        {selectedFile
                          ? selectedFile.name
                          : "Arrastra tu reporte o haz clic para explorar"}
                      </strong>
                      <p className="text-[11px] text-slate-500">
                        {selectedFile
                          ? `${(selectedFile.size / 1024).toFixed(1)} KB listo para revisar — Haz clic para cambiar archivo`
                          : "Soporta Excel .XLSX y .CSV (máx. 5 MB)"}
                      </p>
                    </div>
                  </div>

                  {!dryRunResult ? (
                    <button
                      type="button"
                      disabled={isDryRunning}
                      onClick={handleDryRunFile}
                      className="w-full py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold text-xs transition shadow-md active:scale-98 cursor-pointer"
                    >
                      {isDryRunning
                        ? "Analizando archivo..."
                        : "Pre-visualizar Impacto antes de Descontar"}
                    </button>
                  ) : (
                    <div className="bg-rose-50/40 border border-rose-200 rounded-2xl p-4 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-900 font-bold">
                          Resumen previo al descuento
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {dryRunResult.archivo_nombre}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white border border-rose-100 rounded-xl p-2.5">
                          <span className="text-[10px] text-slate-400 block">
                            Boletas nuevas
                          </span>
                          <strong className="text-sm font-extrabold text-slate-900">
                            {dryRunResult.boletas_nuevas_a_procesar}
                          </strong>
                        </div>
                        <div className="bg-white border border-rose-100 rounded-xl p-2.5">
                          <span className="text-[10px] text-slate-400 block">
                            Unidades a descontar
                          </span>
                          <strong className="text-sm font-extrabold text-rose-600">
                            -{dryRunResult.unidades_a_descontar} un
                          </strong>
                        </div>
                        <div className="bg-white border border-rose-100 rounded-xl p-2.5">
                          <span className="text-[10px] text-slate-400 block">
                            Repetidas omitidas
                          </span>
                          <strong className="text-sm font-extrabold text-slate-600">
                            {dryRunResult.boletas_duplicadas_omitidas}
                          </strong>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setDryRunResult(null)}
                          className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-semibold text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={handleConfirmUploadFile}
                          className="flex-[2] py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-bold text-xs shadow-md shadow-rose-200 cursor-pointer"
                        >
                          {isUploading
                            ? "Descontando del inventario..."
                            : "Confirmar y descontar del inventario"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Vista Modalidad 2: Asistencia BVCore sin exponer credenciales ni tecnicismos */
            <div id="modality2View" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* Tarjeta Izquierda: Comunicación directa con BVCore */}
                <div className="bg-gradient-to-br from-rose-50/80 via-white to-amber-50/40 border border-rose-200/80 rounded-3xl p-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-2.5">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-100/80 px-2.5 py-1 rounded-full">
                      Configuración asistida
                    </span>
                    <h4 className="text-base font-bold text-slate-900">
                      Conecta tu Punto de Venta junto al equipo de BVCore
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Si utilizas <strong>Bsale</strong>, <strong>Loyverse</strong>,{" "}
                      <strong>Shopify POS</strong> u otro sistema en línea, comunícate con{" "}
                      <strong>BVCore</strong> para configurar tu punto de venta en conjunto con el sistema. Nosotros nos encargamos de toda la conexión de forma privada y segura por ti.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-rose-100 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Sin exponer claves ni configuraciones complejas en tu local</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Sincronización en vivo boleta a boleta con protección anti-duplicados</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      showToast(
                        "Solicitud registrada: el equipo de BVCore te asistirá en la conexión de tu POS."
                      )
                    }
                    className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition shadow-sm cursor-pointer"
                  >
                    Comunicarme con soporte BVCore para conectar mi POS
                  </button>
                </div>

                {/* Tarjeta Derecha: Simulador / Registro de Boleta Rápida */}
                <div className="space-y-4 bg-slate-50 border border-slate-200 p-5 rounded-3xl flex flex-col justify-between">
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        Simulador de Boleta Rápida
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Envía una boleta de prueba para verificar cómo se descuenta el lote más próximo a vencer.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Folio o ID
                        </label>
                        <input
                          type="text"
                          value={simTicketId}
                          onChange={(e) => setSimTicketId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-semibold focus:outline-none focus:border-rose-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Origen
                        </label>
                        <select
                          value={simPosSource}
                          onChange={(e) => setSimPosSource(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-semibold focus:outline-none focus:border-rose-400"
                        >
                          <option value="BSALE_POS">BSALE_POS</option>
                          <option value="SHOPIFY_POS">SHOPIFY_POS</option>
                          <option value="LOYVERSE">LOYVERSE</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Producto a descontar
                        </label>
                        <select
                          value={simSelectedSku}
                          onChange={(e) => setSimSelectedSku(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                        >
                          {catalogProducts.map((p) => (
                            <option key={p.sku} value={p.sku}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Unidades
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={simCantidad}
                          onChange={(e) =>
                            setSimCantidad(Math.max(1, parseInt(e.target.value, 10) || 1))
                          }
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-bold text-center focus:outline-none focus:border-rose-400"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSendingSim}
                    onClick={handleSendSimulation}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 disabled:opacity-60 text-white font-bold text-xs shadow-md shadow-rose-200 transition cursor-pointer"
                  >
                    {isSendingSim
                      ? "Procesando boleta..."
                      : "Enviar Boleta de Prueba al Motor de Stock"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Historial de Ventas Sincronizadas */}
        <div id="tour-history" className="card-soft rounded-3xl overflow-hidden space-y-3">
          <div className="px-6 py-4 border-b border-rose-100 flex items-center justify-between bg-white/60">
            <div>
              <h2 className="font-bold text-sm text-slate-900">
                Historial de ventas recientes
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Boletas sincronizadas en tiempo real.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-slate-400 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200/60">
                  <th className="py-3.5 px-4 pl-6">Folio</th>
                  <th className="py-3.5 px-4">Origen POS</th>
                  <th className="py-3.5 px-4">Estado</th>
                  <th className="py-3.5 px-4">Unidades</th>
                  <th className="py-3.5 px-4">Monto</th>
                  <th className="py-3.5 px-4">Hora</th>
                  <th className="py-3.5 px-4 pr-6 text-right">Opciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {isLoadingHistory ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400 text-xs">
                      Cargando historial de ventas...
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400 text-xs">
                      Aún no hay boletas sincronizadas hoy.
                    </td>
                  </tr>
                ) : (
                  history.map((item) => {
                    const isExpanded = selectedTicketId === item.id;
                    const isRevertida =
                      item.estado_procesamiento === "REVERTIDO" ||
                      item.estado_procesamiento === "REVERTIDA";
                    const isParcial = item.estado_procesamiento === "PARCIAL";

                    return (
                      <React.Fragment key={item.id}>
                        <tr className="hover:bg-rose-50/30 transition">
                          <td className="py-3.5 px-4 pl-6 font-mono font-bold text-slate-900">
                            {item.external_ticket_id}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-600">
                            {item.pos_source}
                          </td>
                          <td className="py-3.5 px-4">
                            {isRevertida ? (
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-bold text-[10px]">
                                ANULADA
                              </span>
                            ) : isParcial ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px]">
                                PARCIAL
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">
                                COMPLETO
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-rose-600">
                            -{item.total_unidades} un
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 font-mono">
                            ${(item.total_valorizado || 0).toLocaleString("es-CL")} CLP
                          </td>
                          <td className="py-3.5 px-4 text-slate-500">
                            {formatShortTime(item.fecha_recepcion || item.fecha_venta_origen)}
                          </td>
                          <td className="py-3.5 px-4 pr-6 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleTicketDetail(item.id)}
                              className={`px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition cursor-pointer ${
                                isExpanded
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                              }`}
                            >
                              {isExpanded ? "Ocultar" : "Más detalle"}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-rose-50/20 border-b border-rose-100/80">
                            <td colSpan={7} className="p-4 pl-6 pr-6">
                              <div className="bg-white border border-rose-100 rounded-2xl p-4 space-y-3 text-xs shadow-2xs">
                                {isLoadingDetail ? (
                                  <p className="text-slate-400">Cargando detalle de la boleta...</p>
                                ) : !ticketDetail ? (
                                  <p className="text-slate-400">
                                    No se encontró información adicional de esta boleta.
                                  </p>
                                ) : (
                                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="space-y-1.5 flex-1">
                                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                                        Productos descontados en esta boleta
                                      </span>
                                      <div className="space-y-1">
                                        {ticketDetail.descuentos_fefo.map((linea, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl"
                                          >
                                            <span className="text-slate-800 font-semibold">
                                              {linea.nombre_producto}{" "}
                                              <span className="font-mono text-slate-400 font-normal">
                                                ({linea.sku} • Lote {linea.lote || "FEFO"})
                                              </span>
                                            </span>
                                            <strong className="text-rose-600">
                                              -{linea.unidades_descontadas} un
                                            </strong>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {ticketDetail.puede_revertirse && (
                                      <div className="flex items-center md:justify-end border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-4">
                                        <button
                                          type="button"
                                          disabled={isReverting}
                                          onClick={() => handleRevertTicket(item.id)}
                                          className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] transition cursor-pointer"
                                        >
                                          {isReverting
                                            ? "Anulando..."
                                            : "Anular boleta y devolver stock"}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Toast */}
      {toastMessage && (
        <div
          id="toastNotification"
          className="fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-semibold py-3 px-4 rounded-2xl shadow-2xl z-50 flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span id="toastMessage">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
