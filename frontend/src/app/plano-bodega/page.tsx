"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  getPatentesBodega,
  getStockBodegaZona,
  BodegaPatente,
  BodegaStockSato,
} from "@/services/api";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.locale("es");

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-bodega-kpis",
    title: "1. Capacidad de tu Bodega",
    desc: "Visualiza de un vistazo cuántas zonas tienes activas, cuántos pallets o contenedores están guardados y el total de unidades almacenadas en bodega.",
  },
  {
    targetId: "tour-bodega-map",
    title: "2. Plano 2D por Temperatura",
    desc: "Cada bloque representa un estante o cámara (Seco, Refrigerado o Congelado). Haz clic sobre cualquier zona para inspeccionar qué lotes tiene guardados.",
  },
  {
    targetId: "tour-bodega-panel",
    title: "3. Detalle de Lotes (Orden FEFO)",
    desc: "Al tocar una zona, aquí verás los lotes ordenados por prioridad de salida (primero el que vence antes) para facilitar la reposición hacia la vitrina.",
  },
];

export default function PlanoBodegaPage() {
  const [zonas, setZonas] = useState<BodegaPatente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Zona seleccionada y su stock
  const [selectedPatente, setSelectedPatente] = useState<BodegaPatente | null>(null);
  const [stockZone, setStockZone] = useState<BodegaStockSato[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);

  // Filtro de tipo de zona
  const [tempFilter, setTempFilter] = useState<"ALL" | "SECO" | "FRIO">("ALL");

  // Guía de ayuda (Tour)
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({});
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const handleZoneClick = useCallback(async (zona: BodegaPatente) => {
    setSelectedPatente(zona);
    setLoadingStock(true);
    try {
      const data = await getStockBodegaZona(zona.id_patente);
      setStockZone(data || []);
    } catch {
      setStockZone([]);
    } finally {
      setLoadingStock(false);
    }
  }, []);

  const fetchZonas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPatentesBodega();
      setZonas(data || []);
      if (data && data.length > 0 && !selectedPatente) {
        handleZoneClick(data[0]);
      }
    } catch (err: any) {
      setError(err.message || "Error al cargar el mapa de bodega");
    } finally {
      setLoading(false);
    }
  }, [handleZoneClick, selectedPatente]);

  useEffect(() => {
    fetchZonas();
  }, [fetchZonas]);

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

    if (step.targetId === "tour-bodega-panel" && rect.left >= tooltipWidth + 32) {
      tooltipTop = Math.max(
        24,
        Math.min(rect.top + 16, window.innerHeight - tooltipHeight - 24)
      );
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

  const totalPallets = useMemo(
    () => zonas.reduce((acc, z) => acc + (z.pallets || 0), 0),
    [zonas]
  );
  const totalUnidades = useMemo(
    () => zonas.reduce((acc, z) => acc + (z.unidades || 0), 0),
    [zonas]
  );

  const zonasFiltradas = useMemo(() => {
    if (tempFilter === "ALL") return zonas;
    if (tempFilter === "FRIO") {
      return zonas.filter(
        (z) =>
          z.tipo_ubicacion === "CAMARA_FRIO" || z.tipo_ubicacion === "CAMARA_CONGELADOS"
      );
    }
    return zonas.filter(
      (z) =>
        z.tipo_ubicacion !== "CAMARA_FRIO" && z.tipo_ubicacion !== "CAMARA_CONGELADOS"
    );
  }, [zonas, tempFilter]);

  const formatZoneType = (tipo: string) => {
    if (tipo === "CAMARA_CONGELADOS") return "Cámara Congelados (-18°C)";
    if (tipo === "CAMARA_FRIO") return "Cámara Refrigerada (0° a 5°C)";
    return "Estantería Ambiente Seco";
  };

  const getZoneBadgeStyle = (tipo: string) => {
    if (tipo === "CAMARA_CONGELADOS") {
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    }
    if (tipo === "CAMARA_FRIO") {
      return "bg-sky-50 text-sky-700 border-sky-200";
    }
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const getZoneCardStyle = (zona: BodegaPatente) => {
    const isSelected = selectedPatente?.id_patente === zona.id_patente;
    if (isSelected) {
      return "bg-rose-50/70 border-rose-500 ring-2 ring-rose-500/20 shadow-md";
    }
    if (zona.tipo_ubicacion === "CAMARA_CONGELADOS") {
      return "bg-indigo-50/40 hover:bg-indigo-50/80 border-indigo-200";
    }
    if (zona.tipo_ubicacion === "CAMARA_FRIO") {
      return "bg-sky-50/40 hover:bg-sky-50/80 border-sky-200";
    }
    return "bg-white hover:bg-rose-50/30 border-slate-200/90";
  };

  const maxCols = Math.max(10, ...zonas.map((z) => z.coordenada_x + z.ancho - 1));
  const maxRows = Math.max(8, ...zonas.map((z) => z.coordenada_y + z.largo - 1));

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
              Mapa de Bodega
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Revisa tus zonas de almacenamiento, cámaras de frío y lotes guardados en bodega.
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
              onClick={fetchZonas}
              disabled={loading}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold shadow-md shadow-rose-200 transition disabled:opacity-60 cursor-pointer"
            >
              {loading ? "Actualizando..." : "Actualizar"}
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
        {error && (
          <div className="p-4 bg-rose-50 text-rose-700 border border-rose-200 rounded-2xl text-xs font-semibold">
            {error}
          </div>
        )}

        {/* KPIs de Bodega (con Skeleton Loaders) */}
        {loading ? (
          <div id="tour-bodega-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((sk) => (
              <div key={sk} className="card-stat rounded-3xl p-5 space-y-3 animate-pulse">
                <div className="h-3 w-28 bg-rose-100 rounded-md" />
                <div className="h-7 w-36 bg-slate-200 rounded-xl" />
                <div className="h-2.5 w-32 bg-slate-100 rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <div id="tour-bodega-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card-stat rounded-3xl p-5 space-y-1">
              <span className="text-xs font-semibold text-slate-500">Zonas Activas</span>
              <div className="text-2xl font-black text-slate-900">
                {zonas.length}{" "}
                <span className="text-xs font-semibold text-slate-400">sectores</span>
              </div>
              <span className="text-[11px] text-slate-400 block">
                Estanterías secas y cámaras de frío
              </span>
            </div>

            <div className="card-stat rounded-3xl p-5 space-y-1">
              <span className="text-xs font-semibold text-slate-500">
                Pallets y Contenedores
              </span>
              <div className="text-2xl font-black text-rose-600">
                {totalPallets.toLocaleString("es-CL")}{" "}
                <span className="text-xs font-semibold text-slate-400">bultos</span>
              </div>
              <span className="text-[11px] text-slate-400 block">
                Contenedores registrados en bodega
              </span>
            </div>

            <div className="card-stat rounded-3xl p-5 space-y-1">
              <span className="text-xs font-semibold text-slate-500">
                Respaldo Total en Bodega
              </span>
              <div className="text-2xl font-black text-slate-900">
                {totalUnidades.toLocaleString("es-CL")}{" "}
                <span className="text-xs font-semibold text-slate-400">unidades</span>
              </div>
              <span className="text-[11px] text-slate-400 block">
                Listas para reponer a vitrina
              </span>
            </div>
          </div>
        )}

        {/* Grilla Principal: Plano 2D (2 col) + Inspector de Zona (1 col) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Lienzo 2D de Bodega */}
          <div
            id="tour-bodega-map"
            className="card-soft rounded-3xl p-6 space-y-4 lg:col-span-2"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-bold text-sm text-slate-900">
                  Distribución Física de Bodega
                </h2>
                <p className="text-xs text-slate-500">
                  Toca cualquier estante o cámara para consultar los lotes almacenados.
                </p>
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/70 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setTempFilter("ALL")}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    tempFilter === "ALL"
                      ? "bg-white text-rose-600 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setTempFilter("SECO")}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    tempFilter === "SECO"
                      ? "bg-white text-rose-600 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Seco
                </button>
                <button
                  type="button"
                  onClick={() => setTempFilter("FRIO")}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    tempFilter === "FRIO"
                      ? "bg-white text-rose-600 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Frío / Congelado
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 floor-blueprint p-5">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 min-h-[380px] animate-pulse">
                  {[1, 2, 3, 4, 5, 6].map((sk) => (
                    <div
                      key={sk}
                      className="rounded-2xl bg-slate-100/90 border border-slate-200 p-4 h-36"
                    />
                  ))}
                </div>
              ) : zonasFiltradas.length === 0 ? (
                <div className="min-h-[320px] flex items-center justify-center text-xs text-slate-400">
                  No hay zonas registradas para este filtro.
                </div>
              ) : (
                <div
                  className="grid gap-3.5 min-w-[640px] min-h-[380px]"
                  style={{
                    gridTemplateColumns: `repeat(${maxCols}, minmax(64px, 1fr))`,
                    gridTemplateRows: `repeat(${maxRows}, minmax(64px, 1fr))`,
                  }}
                >
                  {zonasFiltradas.map((zona) => (
                    <div
                      key={zona.id_patente}
                      onClick={() => handleZoneClick(zona)}
                      style={{
                        gridColumn: `${zona.coordenada_x} / span ${zona.ancho}`,
                        gridRow: `${zona.coordenada_y} / span ${zona.largo}`,
                      }}
                      className={`rounded-2xl p-4 border-2 transition cursor-pointer flex flex-col justify-between ${getZoneCardStyle(
                        zona
                      )}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-extrabold text-sm text-slate-900 leading-snug">
                            {zona.area_pasillo}
                          </h3>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shrink-0 ${getZoneBadgeStyle(
                              zona.tipo_ubicacion
                            )}`}
                          >
                            {zona.tipo_ubicacion === "CAMARA_CONGELADOS"
                              ? "Congelado"
                              : zona.tipo_ubicacion === "CAMARA_FRIO"
                              ? "Refrigerado"
                              : "Seco"}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono block">
                          {zona.id_patente}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-600">
                          {zona.pallets} bultos
                        </span>
                        <span className="font-extrabold text-rose-600">
                          {zona.unidades.toLocaleString("es-CL")} unid.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Panel Inspector de la Zona Seleccionada */}
          <aside
            id="tour-bodega-panel"
            className="card-soft rounded-3xl p-6 space-y-4 lg:col-span-1"
          >
            {selectedPatente ? (
              <>
                <div className="border-b border-rose-100 pb-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
                      Zona Seleccionada
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${getZoneBadgeStyle(
                        selectedPatente.tipo_ubicacion
                      )}`}
                    >
                      {formatZoneType(selectedPatente.tipo_ubicacion)}
                    </span>
                  </div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    {selectedPatente.area_pasillo}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Código: <strong className="font-mono">{selectedPatente.id_patente}</strong> ·{" "}
                    {selectedPatente.unidades} unidades en {selectedPatente.pallets} bulto(s)
                  </p>
                </div>

                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {loadingStock ? (
                    [1, 2, 3].map((sk) => (
                      <div
                        key={sk}
                        className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3.5 space-y-2 animate-pulse"
                      >
                        <div className="h-3.5 w-40 bg-slate-200 rounded" />
                        <div className="h-3 w-28 bg-rose-100 rounded" />
                      </div>
                    ))
                  ) : stockZone.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                      Esta zona no tiene lotes almacenados actualmente.
                    </div>
                  ) : (
                    stockZone.map((sato, index) => {
                      const isVencido =
                        sato.fecha_vencimiento &&
                        dayjs(sato.fecha_vencimiento).isBefore(dayjs(), "day");
                      const isProximo =
                        sato.fecha_vencimiento &&
                        !isVencido &&
                        dayjs(sato.fecha_vencimiento).isBefore(dayjs().add(7, "day"), "day");

                      return (
                        <div
                          key={sato.sato_id}
                          className={`rounded-2xl p-3.5 border shadow-2xs space-y-2 ${
                            isVencido
                              ? "bg-rose-50/60 border-rose-200"
                              : isProximo
                              ? "bg-amber-50/60 border-amber-200"
                              : "bg-white border-slate-200/80"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[10px] font-extrabold text-rose-600 uppercase">
                                Prioridad FEFO #{index + 1}
                              </span>
                              <h4 className="text-xs font-extrabold text-slate-900">
                                {sato.nombre}
                              </h4>
                              <span className="text-[11px] text-slate-500 font-mono">
                                SKU: {sato.sku} · Contenedor: {sato.lpn}
                              </span>
                            </div>
                            <span className="text-xs font-black text-slate-900 bg-slate-100 px-2.5 py-1 rounded-xl shrink-0">
                              {sato.cantidad} unid.
                            </span>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                            <span className="text-slate-500">Vencimiento:</span>
                            {sato.fecha_vencimiento ? (
                              <span
                                className={`font-bold ${
                                  isVencido
                                    ? "text-rose-600"
                                    : isProximo
                                    ? "text-amber-700"
                                    : "text-emerald-700"
                                }`}
                              >
                                {dayjs(sato.fecha_vencimiento).format("DD/MM/YYYY")} (
                                {dayjs(sato.fecha_vencimiento).fromNow()})
                              </span>
                            ) : (
                              <span className="text-slate-400">No aplica</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Selecciona una zona del mapa para ver sus lotes almacenados.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
