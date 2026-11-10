"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  getLogsTrazabilidad,
  getArbolSato,
  TrazabilidadLogItem,
  SatoArbolNode,
} from "@/services/api";

interface ActionMeta {
  label: string;
  badgeClass: string;
}

const ACTION_META: Record<string, ActionMeta> = {
  CREACION_INGRESO_BODEGA: {
    label: "Ingreso a Bodega",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  CREACION_INGRESO_LPN: {
    label: "Recepción de Pallet",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  INGRESO_STOCK_CATALOGO: {
    label: "Ingreso desde Catálogo",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  MOVIMIENTO_A_VITRINA: {
    label: "Reposición a Vitrina",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
  },
  DESCUENTO_FRACCIONAMIENTO: {
    label: "Apertura de Caja (Bodega)",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
  },
  CREACION_HIJO_VITRINA: {
    label: "Unidades en Góndola",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  VENTA_EXTERNA_POS: {
    label: "Venta en Caja POS",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
  },
  REVERSION_VENTA_EXTERNA: {
    label: "Anulación de Boleta POS",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
  DECLARACION_MERMA: {
    label: "Merma Registrada",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
  AJUSTE_INVENTARIO: {
    label: "Ajuste de Stock",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
  AJUSTE_LOTE_CATALOGO: {
    label: "Ajuste de Lote",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
  CONTEO_CICLICO_SIN_DIFERENCIA: {
    label: "Conteo Verificado OK",
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
  },
  DISCREPANCIA_VITRINA: {
    label: "Diferencia en Vitrina",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
  },
  PICKING_OUTBOUND: {
    label: "Salida por Picking",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
};

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-trazabilidad-filters",
    title: "1. Busca por Producto, Lote o Fecha",
    desc: "Filtra rápidamente cualquier movimiento escribiendo el código SKU, lote o eligiendo el tipo de operación (ventas POS, ingresos a bodega, reposiciones o mermas).",
  },
  {
    targetId: "tour-trazabilidad-table",
    title: "2. Bitácora Cronológica Clara",
    desc: "Revisa fecha, hora, producto afectado, qué ocurrió en lenguaje simple y quién lo realizó. Además puedes ver el historial completo de un lote desde que entró a bodega hasta la góndola.",
  },
];

export default function TrazabilidadPage() {
  const [page, setPage] = useState(1);
  const limit = 20;

  // Filtros
  const [searchQuery, setSearchQuery] = useState("");
  const [accionFilter, setAccionFilter] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  // Datos principales
  const [logs, setLogs] = useState<TrazabilidadLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado Modal Árbol SATO
  const [selectedSatoId, setSelectedSatoId] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<SatoArbolNode | null>(null);
  const [isLoadingTree, setIsLoadingTree] = useState(false);

  // Guía de ayuda (Tour)
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({});
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const cargarLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * limit;
      const res = await getLogsTrazabilidad({
        q: searchQuery.trim() || undefined,
        accion: accionFilter || undefined,
        fecha_inicio: fechaInicio || undefined,
        fecha_fin: fechaFin || undefined,
        limit,
        offset,
      });
      setLogs(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err?.message || "Error al cargar el historial de movimientos.");
    } finally {
      setIsLoading(false);
    }
  }, [page, searchQuery, accionFilter, fechaInicio, fechaFin]);

  useEffect(() => {
    cargarLogs();
  }, [cargarLogs]);

  useEffect(() => {
    if (!selectedSatoId) {
      setTreeData(null);
      return;
    }
    setIsLoadingTree(true);
    getArbolSato(selectedSatoId)
      .then((node) => setTreeData(node))
      .catch(() => setTreeData(null))
      .finally(() => setIsLoadingTree(false));
  }, [selectedSatoId]);

  // Posicionamiento del Tour Guiado
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
    const tooltipHeight = 190;
    let tooltipTop = rect.bottom + padding + 14;
    let tooltipLeft = rect.left;

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

  const endTour = () => setIsTourActive(false);

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

  const totalPages = Math.ceil(total / limit) || 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    cargarLogs();
  };

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat("es-CL", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return isoString;
    }
  };

  const getActionMeta = (accion: string): ActionMeta => {
    return (
      ACTION_META[accion] || {
        label: accion.replace(/_/g, " "),
        badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
      }
    );
  };

  const renderTree = (node: SatoArbolNode) => {
    const isContainer = node.tipo_sato === "CONTENEDOR";
    return (
      <div key={node.sato_id} className="mt-3">
        <div
          className={`p-3.5 rounded-2xl border ${
            isContainer
              ? "bg-emerald-50/70 border-emerald-200"
              : "bg-slate-50 border-slate-200"
          } flex items-center justify-between gap-3`}
        >
          <div>
            <p className="font-extrabold text-xs text-slate-900">
              {isContainer ? `Contenedor / Pallet: ${node.lpn}` : `Producto SKU: ${node.sku}`}
            </p>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Estado: <strong className="text-slate-700">{node.estado}</strong> · Lote ID:{" "}
              {node.sato_id.slice(0, 8)}…
            </p>
          </div>
          {!isContainer && (
            <span className="bg-white text-rose-600 text-xs px-3 py-1 rounded-xl border border-rose-200 font-extrabold shadow-2xs">
              {node.cantidad ?? 0} unid.
            </span>
          )}
        </div>
        {node.hijos && node.hijos.length > 0 && (
          <div className="border-l-2 border-rose-200 ml-5 pl-4 space-y-2 mt-2">
            {node.hijos.map(renderTree)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 pb-12">
      {/* Overlay de la Guía de Ayuda */}
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
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
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
              <h3 className="text-base font-bold text-slate-900">
                {TOUR_STEPS[currentStepIndex]?.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                {TOUR_STEPS[currentStepIndex]?.desc}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={prevTourStep}
                style={{ opacity: currentStepIndex === 0 ? 0 : 1 }}
                disabled={currentStepIndex === 0}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5 cursor-pointer"
              >
                Anterior
              </button>
              <button
                type="button"
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
      <header className="bg-white/90 backdrop-blur-md border-b border-rose-100 px-6 py-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Historial de Movimientos
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Bitácora cronológica de ingresos de mercadería, reposiciones a vitrina, ventas POS y mermas.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={startTour}
              className="px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition shadow-2xs cursor-pointer"
            >
              ¿Cómo funciona?
            </button>
            <button
              type="button"
              onClick={cargarLogs}
              disabled={isLoading}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold shadow-md shadow-rose-200 transition disabled:opacity-60 cursor-pointer"
            >
              {isLoading ? "Actualizando..." : "Actualizar"}
            </button>
            <div className="flex items-center pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-600 to-rose-500 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                A
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Filtros */}
        <div
          id="tour-trazabilidad-filters"
          className="card-soft rounded-3xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-end"
        >
          <form onSubmit={handleSearchSubmit} className="lg:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Buscar por Producto, SKU o Contenedor
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full py-2.5 px-4 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              placeholder="Ej: SKU-LECHE-1L, PLU-0001 o LPN..."
            />
          </form>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Tipo de Movimiento
            </label>
            <select
              value={accionFilter}
              onChange={(e) => {
                setAccionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
            >
              <option value="">Todos los movimientos</option>
              <option value="VENTA_EXTERNA_POS">Venta en Caja POS</option>
              <option value="REVERSION_VENTA_EXTERNA">Anulación de Boleta POS</option>
              <option value="DECLARACION_MERMA">Merma Registrada</option>
              <option value="CREACION_INGRESO_BODEGA">Ingreso a Bodega</option>
              <option value="CREACION_INGRESO_LPN">Recepción de Pallet</option>
              <option value="INGRESO_STOCK_CATALOGO">Ingreso desde Catálogo</option>
              <option value="MOVIMIENTO_A_VITRINA">Reposición a Vitrina</option>
              <option value="AJUSTE_LOTE_CATALOGO">Ajuste de Lote</option>
              <option value="CONTEO_CICLICO_SIN_DIFERENCIA">Conteo Verificado OK</option>
              <option value="DISCREPANCIA_VITRINA">Diferencia en Vitrina</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Desde
            </label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => {
                setFechaInicio(e.target.value);
                setPage(1);
              }}
              className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Hasta
            </label>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => {
                setFechaFin(e.target.value);
                setPage(1);
              }}
              className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
            />
          </div>
        </div>

        {/* Tabla de Movimientos */}
        <div
          id="tour-trazabilidad-table"
          className="card-soft rounded-3xl overflow-hidden flex flex-col"
        >
          <div className="px-6 py-4 border-b border-rose-100 flex items-center justify-between bg-white/60">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-slate-900">Registro de Eventos</h2>
              <span className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full">
                {total.toLocaleString("es-CL")} movimientos
              </span>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-slate-400 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200/60">
                  <th className="py-3.5 px-4 pl-6">Fecha y Hora</th>
                  <th className="py-3.5 px-4">Producto / Código</th>
                  <th className="py-3.5 px-4">Movimiento</th>
                  <th className="py-3.5 px-4">Detalle</th>
                  <th className="py-3.5 px-4 pr-6 text-right">Responsable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {isLoading ? (
                  [1, 2, 3, 4, 5, 6].map((sk) => (
                    <tr key={sk} className="animate-pulse">
                      <td className="py-4 px-4 pl-6">
                        <div className="h-3.5 w-32 bg-slate-200 rounded" />
                      </td>
                      <td className="py-4 px-4">
                        <div className="h-4 w-36 bg-slate-200 rounded mb-1" />
                      </td>
                      <td className="py-4 px-4">
                        <div className="h-5 w-28 bg-rose-100 rounded-full" />
                      </td>
                      <td className="py-4 px-4">
                        <div className="h-3.5 w-64 bg-slate-100 rounded" />
                      </td>
                      <td className="py-4 px-4 pr-6 text-right">
                        <div className="h-3.5 w-20 bg-slate-100 rounded ml-auto" />
                      </td>
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                      No se encontraron movimientos para los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const meta = getActionMeta(log.accion);
                    return (
                      <tr key={log.id} className="hover:bg-rose-50/30 transition">
                        <td className="py-4 px-4 pl-6 whitespace-nowrap text-xs text-slate-500">
                          {formatDateTime(log.fecha_hora)}
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {log.lpn_sku_afectado || "General"}
                            </span>
                            {log.sato_id && (
                              <button
                                type="button"
                                onClick={() => setSelectedSatoId(log.sato_id)}
                                title="Ver recorrido del lote (Bodega → Vitrina)"
                                className="px-2 py-0.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold transition cursor-pointer"
                              >
                                Ver lote
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-xl text-[11px] font-bold border ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td
                          className="py-4 px-4 text-xs text-slate-600 max-w-md truncate"
                          title={log.detalles || ""}
                        >
                          {log.detalles || "—"}
                        </td>
                        <td className="py-4 px-4 pr-6 whitespace-nowrap text-xs text-slate-500 text-right">
                          {log.usuario}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="bg-slate-50/70 px-6 py-3.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs text-slate-500">
              Mostrando{" "}
              <strong className="text-slate-800">
                {total === 0 ? 0 : Math.min((page - 1) * limit + 1, total)}
              </strong>{" "}
              a <strong className="text-slate-800">{Math.min(page * limit, total)}</strong> de{" "}
              <strong className="text-slate-800">{total}</strong> movimientos
            </p>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              <span className="px-2 text-xs font-bold text-slate-700">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || total === 0}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>

        {/* Modal Recorrido del Lote (Bodega → Vitrina) */}
        {selectedSatoId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white border border-rose-200 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-rose-100 flex items-center justify-between bg-rose-50/40">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
                    Trazabilidad de Lote
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Recorrido del Lote (Bodega → Vitrina)
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSatoId(null)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold cursor-pointer"
                >
                  Cerrar
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                {isLoadingTree ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-14 bg-slate-100 rounded-2xl" />
                    <div className="h-14 bg-rose-50 rounded-2xl ml-6" />
                  </div>
                ) : treeData ? (
                  <div>{renderTree(treeData)}</div>
                ) : (
                  <p className="text-center text-slate-400 py-8 text-xs">
                    No se encontró información adicional para este lote.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
