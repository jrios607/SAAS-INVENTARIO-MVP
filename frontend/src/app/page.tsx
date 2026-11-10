"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  getDashboardKpis,
  getStockAgrupado,
  getAnomaliasStock,
  getOrphanSalesCodes,
  DashboardKpisResponse,
  DashboardRadarFefoItem,
  StockAgrupadoFamilia,
  ProductoDetalleStock,
  AnomaliaStockResponse,
  OrphanCodeGroupItem,
} from "@/services/api";

type AlertType = "fefo_7d" | "bajo_minimo" | "anomalias" | "orphans";

interface ProductoConFamilia extends ProductoDetalleStock {
  familia: string;
}

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-step-kpis",
    title: "1. Resumen Diario de tu Local",
    desc: "Revisa al instante cuánto has vendido hoy, el valor en riesgo por productos próximos a vencer en los siguientes 7 días y el total de unidades activas en Vitrina y Bodega.",
  },
  {
    targetId: "tour-step-chart",
    title: "2. Desempeño Operativo Mensual",
    desc: "Compara visualmente la evolución de tus ventas sincronizadas frente a las mermas valorizadas en los últimos meses para controlar la rentabilidad del local.",
  },
  {
    targetId: "tour-step-alerts",
    title: "3. Alertas y Consulta de Detalles",
    desc: "Haz clic en 'Consultar detalles' sobre cualquier alerta para desplegar la lista exacta de lotes por vencer, productos bajo stock mínimo, diferencias en vitrina o códigos POS sin vincular.",
  },
];

export default function CentroDeInformacionPage() {
  const [kpis, setKpis] = useState<DashboardKpisResponse | null>(null);
  const [familiasStock, setFamiliasStock] = useState<StockAgrupadoFamilia[]>([]);
  const [anomaliasList, setAnomaliasList] = useState<AnomaliaStockResponse[]>([]);
  const [orphansList, setOrphansList] = useState<OrphanCodeGroupItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Estado para consultar más detalles según el tipo de alerta
  const [selectedAlert, setSelectedAlert] = useState<AlertType | null>(null);

  // Controles de visualización del gráfico (2.1 Punto 3 + Selector Barras/Torta)
  const [chartPeriod, setChartPeriod] = useState<"6m" | "4w">("6m");
  const [chartType, setChartType] = useState<"barras" | "torta">("barras");

  // Estado para la Guía de Ayuda (Tour interactivo)
  const [isTourActive, setIsTourActive] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({});
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const loadAllData = useCallback(
    async (withToast = false) => {
      setIsLoading(true);
      try {
        const [kpisData, stockData, anomaliasData, orphansData] = await Promise.all([
          getDashboardKpis(),
          getStockAgrupado(),
          getAnomaliasStock(true, 50),
          getOrphanSalesCodes(),
        ]);
        if (kpisData) setKpis(kpisData);
        if (stockData) setFamiliasStock(stockData);
        if (anomaliasData) setAnomaliasList(anomaliasData);
        if (orphansData) setOrphansList(orphansData);
        if (withToast) {
          showToast("Datos actualizados con éxito");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadAllData(false);
  }, [loadAllData]);

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

    if (step.targetId === "tour-step-alerts" && rect.left >= tooltipWidth + 32) {
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

  // Métricas principales
  const ventasHoyClp = kpis?.ventas_hoy_clp ?? 0;
  const ventasHoyTickets = kpis?.ventas_hoy_tickets ?? 0;
  const ventasHoyUnidades = kpis?.ventas_hoy_unidades ?? 0;

  const perdidaProyectadaClp = kpis?.perdida_proyectada_clp ?? 0;
  const lotesRiesgoCount = kpis?.lotes_riesgo_vencimiento_count ?? 0;

  const stockTotal = kpis?.stock_total_unidades ?? 0;
  const stockVitrina = kpis?.stock_vitrina_unidades ?? 0;
  const stockBodega = kpis?.stock_bodega_unidades ?? 0;

  // Lista plana de productos desde getStockAgrupado()
  const todosLosProductos = useMemo<ProductoConFamilia[]>(() => {
    return familiasStock.flatMap((fam) =>
      (fam.sub_familias || []).flatMap((sub) =>
        (sub.productos || []).map((prod) => ({
          ...prod,
          familia: fam.familia,
        }))
      )
    );
  }, [familiasStock]);

  // Detalle de productos bajo stock mínimo
  const productosBajoMinimo = useMemo<ProductoConFamilia[]>(() => {
    return todosLosProductos.filter((p) => {
      const min = p.stock_minimo ?? 5;
      return p.stock_individual <= min;
    });
  }, [todosLosProductos]);

  // Lotes en riesgo FEFO (<= 7 días o vencidos)
  const radarFefo: DashboardRadarFefoItem[] = useMemo(() => {
    return kpis?.radar_fefo_items ?? [];
  }, [kpis]);

  // Conteos de alertas operativas
  const ops = kpis?.alertas_operativas;
  const countFefo7d = ops?.lotes_por_vencer_7d_count ?? radarFefo.length;
  const countBajoMinimo = ops?.productos_bajo_minimo_count ?? productosBajoMinimo.length;
  const countAnomalias = ops?.anomalias_abiertas_count ?? anomaliasList.length;
  const countOrphans = ops?.skus_huerfanos_pendientes_count ?? orphansList.length;

  // Definición de los 4 tipos de alerta con su resumen y severidad
  const alertCards: {
    id: AlertType;
    titulo: string;
    subtitulo: string;
    count: number;
    unidadLabel: string;
    severidad: "CRITICO" | "ALERTA" | "OK";
  }[] = [
    {
      id: "fefo_7d",
      titulo: "Vencimiento Crítico (≤ 7d)",
      subtitulo:
        countFefo7d > 0
          ? `${countFefo7d} lote(s) próximos a vencer o vencidos`
          : "Ningún lote vence en los próximos 7 días",
      count: countFefo7d,
      unidadLabel: "lotes",
      severidad: countFefo7d > 0 ? "CRITICO" : "OK",
    },
    {
      id: "bajo_minimo",
      titulo: "Stock Bajo Mínimo",
      subtitulo:
        countBajoMinimo > 0
          ? `${countBajoMinimo} producto(s) requieren reposición`
          : "Todos los productos cumplen su mínimo",
      count: countBajoMinimo,
      unidadLabel: "productos",
      severidad: countBajoMinimo > 0 ? "ALERTA" : "OK",
    },
    {
      id: "anomalias",
      titulo: "Diferencias en Vitrina",
      subtitulo:
        countAnomalias > 0
          ? `${countAnomalias} venta(s) sin stock suficiente en vitrina`
          : "Sin diferencias de inventario abiertas",
      count: countAnomalias,
      unidadLabel: "casos",
      severidad: countAnomalias > 0 ? "CRITICO" : "OK",
    },
    {
      id: "orphans",
      titulo: "Códigos POS sin Vincular",
      subtitulo:
        countOrphans > 0
          ? `${countOrphans} código(s) vendidos pendientes de asociar`
          : "Todos los códigos POS están vinculados",
      count: countOrphans,
      unidadLabel: "códigos",
      severidad: countOrphans > 0 ? "ALERTA" : "OK",
    },
  ];

  // Datos para el gráfico de Desempeño Operativo (Últimos 6 meses vs Últimas 4 semanas)
  const chartMonths = useMemo(() => {
    const rawMonths =
      kpis?.desempeno_mensual && kpis.desempeno_mensual.length > 0
        ? kpis.desempeno_mensual
        : [
            { mes: "Jun", Ganancias: 0, Perdidas: 0 },
            { mes: "Jul", Ganancias: 0, Perdidas: 0 },
            { mes: "Ago", Ganancias: 0, Perdidas: 0 },
            { mes: "Sep", Ganancias: 0, Perdidas: 0 },
            { mes: "Oct", Ganancias: 0, Perdidas: 0 },
            { mes: "Nov", Ganancias: ventasHoyClp, Perdidas: perdidaProyectadaClp },
          ];

    let raw = rawMonths;
    if (chartPeriod === "4w") {
      const currentMonth = rawMonths[rawMonths.length - 1] || {
        mes: "Actual",
        Ganancias: ventasHoyClp,
        Perdidas: perdidaProyectadaClp,
      };
      const prevMonth = rawMonths[rawMonths.length - 2] || {
        mes: "Previo",
        Ganancias: 0,
        Perdidas: 0,
      };
      const totalV = (currentMonth.Ganancias || 0) + Math.round((prevMonth.Ganancias || 0) * 0.25);
      const totalM = (currentMonth.Perdidas || 0) + Math.round((prevMonth.Perdidas || 0) * 0.25);
      raw = [
        {
          mes: "Sem 1",
          Ganancias: Math.round(totalV * 0.18),
          Perdidas: Math.round(totalM * 0.15),
        },
        {
          mes: "Sem 2",
          Ganancias: Math.round(totalV * 0.22),
          Perdidas: Math.round(totalM * 0.2),
        },
        {
          mes: "Sem 3",
          Ganancias: Math.round(totalV * 0.25),
          Perdidas: Math.round(totalM * 0.25),
        },
        {
          mes: "Sem 4 (Actual)",
          Ganancias: Math.max(ventasHoyClp, Math.round(totalV * 0.35)),
          Perdidas: Math.max(perdidaProyectadaClp, Math.round(totalM * 0.4)),
        },
      ];
    }

    const maxVal = Math.max(
      1,
      ...raw.map((m) => Math.max(m.Ganancias || 0, m.Perdidas || 0))
    );
    return raw.map((item, idx) => {
      const ventasPct =
        item.Ganancias > 0 ? Math.max(8, Math.round((item.Ganancias / maxVal) * 92)) : 3;
      const mermasPct =
        item.Perdidas > 0 ? Math.max(8, Math.round((item.Perdidas / maxVal) * 92)) : 3;
      return {
        ...item,
        ventasPct,
        mermasPct,
        isLast: idx === raw.length - 1,
      };
    });
  }, [kpis, ventasHoyClp, perdidaProyectadaClp, chartPeriod]);

  // Totales acumulados para el Gráfico de Torta (Anillo SVG)
  const pieSummary = useMemo(() => {
    const totalVentas = chartMonths.reduce((acc, m) => acc + (m.Ganancias || 0), 0);
    const totalMermas = chartMonths.reduce((acc, m) => acc + (m.Perdidas || 0), 0);
    const grandTotal = totalVentas + totalMermas;
    const ventasShare = grandTotal > 0 ? Math.round((totalVentas / grandTotal) * 100) : 50;
    const mermasShare = grandTotal > 0 ? 100 - ventasShare : 50;
    return {
      totalVentas,
      totalMermas,
      grandTotal,
      ventasShare,
      mermasShare,
    };
  }, [chartMonths]);

  const toggleAlertDetail = (type: AlertType) => {
    setSelectedAlert((prev) => (prev === type ? null : type));
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Overlay de la Guía de Ayuda (Tour Guiado) */}
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
              <p
                id="tourDescription"
                className="text-xs text-slate-600 leading-relaxed mt-1"
              >
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

      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-rose-100 px-6 py-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Centro de Información
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Resumen operativo y métricas esenciales de tu local.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={startTour}
              title="Ver explicación paso a paso"
              className="px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition active:scale-95 shadow-2xs cursor-pointer"
            >
              ¿Cómo funciona?
            </button>
            <button
              type="button"
              onClick={() => loadAllData(true)}
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

      {/* Main Workspace */}
      <main className="max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* KPIs Principales (con Skeleton Loaders en carga inicial) */}
        {isLoading && !kpis ? (
          <div id="tour-step-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="card-stat rounded-3xl p-5 space-y-3 animate-pulse"
              >
                <div className="h-3 w-32 bg-rose-100/80 rounded-lg" />
                <div className="h-7 w-44 bg-slate-200/80 rounded-xl" />
                <div className="h-2.5 w-36 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <div id="tour-step-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card-stat rounded-3xl p-5 space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Ventas de Hoy</span>
              <div className="text-2xl font-black text-slate-900">
                ${ventasHoyClp.toLocaleString("es-CL")}{" "}
                <span className="text-xs font-semibold text-slate-400">CLP</span>
              </div>
              <span className="text-[11px] text-slate-400 block">
                {ventasHoyTickets === 1
                  ? "1 boleta registrada"
                  : `${ventasHoyTickets} boletas registradas`}
                {ventasHoyUnidades > 0 ? ` · ${ventasHoyUnidades} unid.` : ""}
              </span>
            </div>

            <div
              onClick={() => toggleAlertDetail("fefo_7d")}
              className="card-stat rounded-3xl p-5 space-y-1.5 cursor-pointer"
              title="Haz clic para consultar el detalle de lotes próximos a vencer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Riesgo por Vencimiento (7d)
                </span>
                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                  Ver lotes
                </span>
              </div>
              <div className="text-2xl font-black text-rose-600">
                ${perdidaProyectadaClp.toLocaleString("es-CL")}{" "}
                <span className="text-xs font-semibold text-slate-400">CLP</span>
              </div>
              <span className="text-[11px] text-rose-500 font-medium block">
                {lotesRiesgoCount} lotes próximos a vencer
              </span>
            </div>

            <div className="card-stat rounded-3xl p-5 space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Stock Total Activo</span>
              <div className="text-2xl font-black text-slate-900">
                {stockTotal.toLocaleString("es-CL")}{" "}
                <span className="text-xs font-semibold text-slate-400">unidades</span>
              </div>
              <span className="text-[11px] text-slate-400 block">
                Vitrina ({stockVitrina.toLocaleString("es-CL")}) y Bodega (
                {stockBodega.toLocaleString("es-CL")})
              </span>
            </div>
          </div>
        )}

        {/* Fila Principal: Desempeño Operativo (2 col) + Alertas del Local (1 col) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Gráfico Desempeño Operativo con Selector de Período y Tipo (Barras / Torta) */}
          <div
            id="tour-step-chart"
            className="card-soft rounded-3xl p-6 space-y-4 lg:col-span-2 flex flex-col justify-between"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-bold text-sm text-slate-900">Desempeño Operativo</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {chartPeriod === "6m" ? "Últimos 6 meses" : "Últimas 4 semanas"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Selector de Período */}
                <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/70">
                  <button
                    type="button"
                    onClick={() => setChartPeriod("6m")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      chartPeriod === "6m"
                        ? "bg-white text-rose-600 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Últimos 6 meses
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartPeriod("4w")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      chartPeriod === "4w"
                        ? "bg-white text-rose-600 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Últimas 4 semanas
                  </button>
                </div>

                {/* Selector de Tipo de Gráfico (Barras / Torta) */}
                <div className="inline-flex rounded-xl bg-rose-50/80 p-1 border border-rose-200/70">
                  <button
                    type="button"
                    onClick={() => setChartType("barras")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      chartType === "barras"
                        ? "bg-rose-600 text-white shadow-2xs"
                        : "text-rose-700 hover:text-rose-900"
                    }`}
                  >
                    Barras
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartType("torta")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      chartType === "torta"
                        ? "bg-rose-600 text-white shadow-2xs"
                        : "text-rose-700 hover:text-rose-900"
                    }`}
                  >
                    Torta
                  </button>
                </div>
              </div>
            </div>

            {isLoading && !kpis ? (
              <div className="h-56 flex items-end gap-6 pt-6 px-4 border-b border-slate-100 animate-pulse">
                {[45, 65, 35, 80, 55, 90].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <div style={{ height: `${h}%` }} className="w-full bg-rose-100 rounded-t-xl" />
                    <div className="h-2.5 w-8 bg-slate-200 rounded" />
                  </div>
                ))}
              </div>
            ) : chartType === "barras" ? (
              <div className="h-56 flex items-end gap-4 sm:gap-6 pt-6 px-2 sm:px-4 border-b border-slate-100">
                {chartMonths.map((item) => (
                  <div
                    key={item.mes}
                    className="flex-1 flex flex-col items-center gap-2 h-full justify-end group relative"
                    title={`${item.mes} · Ventas: $${(item.Ganancias || 0).toLocaleString(
                      "es-CL"
                    )} CLP | Mermas: $${(item.Perdidas || 0).toLocaleString("es-CL")} CLP`}
                  >
                    <div className="w-full flex items-end justify-center gap-1.5 h-full">
                      <div
                        style={{ height: `${item.mermasPct}%` }}
                        className={`w-full rounded-t-xl transition-all ${
                          item.isLast ? "bg-rose-600" : "bg-rose-500"
                        }`}
                      />
                      {item.Ganancias > 0 && (
                        <div
                          style={{ height: `${item.ventasPct}%` }}
                          className="w-full bg-emerald-500 rounded-t-xl transition-all"
                        />
                      )}
                    </div>
                    <span
                      className={`text-[11px] ${
                        item.isLast ? "text-slate-700 font-bold" : "text-slate-400"
                      }`}
                    >
                      {item.mes}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              /* Gráfico de Torta / Anillo Comparativo */
              <div className="h-56 flex flex-col sm:flex-row items-center justify-center gap-8 py-4 px-4 border-b border-slate-100">
                <div className="relative w-40 h-40 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="transparent"
                      stroke="#e11d48"
                      strokeWidth="4.2"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="transparent"
                      stroke="#10b981"
                      strokeWidth="4.2"
                      strokeDasharray={`${pieSummary.ventasShare} ${100 - pieSummary.ventasShare}`}
                      strokeDashoffset="0"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                    <span className="text-[10px] font-bold uppercase text-slate-400">
                      Balance
                    </span>
                    <span className="text-sm font-black text-slate-900">
                      ${pieSummary.grandTotal.toLocaleString("es-CL")}
                    </span>
                    <span className="text-[10px] text-slate-400">CLP</span>
                  </div>
                </div>

                <div className="space-y-3 w-full max-w-xs">
                  <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200/80 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          Ventas Sincronizadas
                        </div>
                        <div className="text-[11px] text-slate-500">
                          ${pieSummary.totalVentas.toLocaleString("es-CL")} CLP
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-black text-emerald-700 bg-white px-2.5 py-1 rounded-xl border border-emerald-200">
                      {pieSummary.ventasShare}%
                    </span>
                  </div>

                  <div className="rounded-2xl bg-rose-50/70 border border-rose-200/80 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full bg-rose-600 shrink-0" />
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          Mermas Valorizadas
                        </div>
                        <div className="text-[11px] text-slate-500">
                          ${pieSummary.totalMermas.toLocaleString("es-CL")} CLP
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-black text-rose-700 bg-white px-2.5 py-1 rounded-xl border border-rose-200">
                      {pieSummary.mermasShare}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-6 text-xs pt-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-600" />
                <span className="text-slate-600 font-semibold">Mermas Valorizadas</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-slate-600 font-semibold">Ventas Sincronizadas</span>
              </div>
            </div>
          </div>

          {/* Alertas Operativas del Local (con opción de consultar más detalles según el tipo de alerta) */}
          <div
            id="tour-step-alerts"
            className="card-soft rounded-3xl p-6 space-y-3.5 flex flex-col justify-between"
          >
            <div>
              <h2 className="font-bold text-sm text-slate-900">Alertas del Local</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Selecciona una alerta para consultar más detalles según su tipo.
              </p>
            </div>

            <div className="space-y-2.5">
              {alertCards.map((alerta) => {
                const isSelected = selectedAlert === alerta.id;
                const badgeStyle =
                  alerta.severidad === "CRITICO"
                    ? "bg-rose-100 text-rose-700 border-rose-200"
                    : alerta.severidad === "ALERTA"
                    ? "bg-amber-100 text-amber-800 border-amber-200"
                    : "bg-emerald-100 text-emerald-700 border-emerald-200";

                const cardBorder = isSelected
                  ? "border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/40"
                  : alerta.severidad === "CRITICO"
                  ? "border-rose-200/90 bg-white hover:border-rose-300"
                  : alerta.severidad === "ALERTA"
                  ? "border-amber-200/90 bg-white hover:border-amber-300"
                  : "border-slate-200/80 bg-white hover:border-slate-300";

                return (
                  <div
                    key={alerta.id}
                    onClick={() => toggleAlertDetail(alerta.id)}
                    className={`rounded-2xl p-3.5 border transition cursor-pointer shadow-2xs ${cardBorder}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-900">
                        {alerta.titulo}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border shrink-0 ${badgeStyle}`}
                      >
                        {alerta.count} {alerta.unidadLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      {alerta.subtitulo}
                    </p>
                    <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-rose-600">
                        {isSelected ? "Ocultar detalles" : "Consultar más detalles"}
                      </span>
                      <span className="text-[11px] font-bold text-rose-600">
                        {isSelected ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Panel Desplegable de Detalle según el Tipo de Alerta Seleccionada */}
        {selectedAlert === "fefo_7d" && (
          <div className="card-soft rounded-3xl p-6 space-y-4 border-rose-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-rose-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
                  Detalle de Alerta · Vencimiento FEFO (≤ 7 días)
                </span>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Lotes próximos a vencer o caducados ({radarFefo.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/patentes"
                  className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold shadow-2xs transition"
                >
                  Ver en Mapa 2D
                </Link>
                <Link
                  href="/ajustes"
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition"
                >
                  Registrar Merma
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {radarFefo.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Excelente: no hay lotes activos que venzan dentro de los próximos 7 días.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
                {radarFefo.map((item) => {
                  const vencido = item.dias_restantes < 0;
                  const venceHoy = item.dias_restantes === 0;
                  return (
                    <div
                      key={item.sato_id}
                      className="bg-white rounded-2xl p-3.5 border border-rose-200/80 shadow-2xs flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            {item.nombre_producto}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            Lote: <span className="font-bold text-slate-700">{item.lote}</span> ·{" "}
                            {item.nombre_ubicacion}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border shrink-0 ${
                            vencido || venceHoy
                              ? "bg-rose-100 text-rose-700 border-rose-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }`}
                        >
                          {vencido
                            ? `Vencido (${Math.abs(item.dias_restantes)}d)`
                            : venceHoy
                            ? "Vence Hoy"
                            : `En ${item.dias_restantes} día(s)`}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">
                          Cantidad:{" "}
                          <strong className="text-slate-900">{item.cantidad} unid.</strong>
                        </span>
                        <span className="font-bold text-rose-600">
                          Riesgo: ${item.valor_riesgo_clp.toLocaleString("es-CL")} CLP
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {selectedAlert === "bajo_minimo" && (
          <div className="card-soft rounded-3xl p-6 space-y-4 border-amber-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-amber-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
                  Detalle de Alerta · Reposición de Inventario
                </span>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Productos bajo el stock mínimo configurado ({productosBajoMinimo.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/catalogo"
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition"
                >
                  Ir al Catálogo para Abastecer
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {productosBajoMinimo.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Todos los productos del catálogo superan su stock mínimo configurado.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
                {productosBajoMinimo.map((prod) => {
                  const minimo = prod.stock_minimo ?? 5;
                  const agotado = prod.stock_individual === 0;
                  return (
                    <div
                      key={prod.sku}
                      className="bg-white rounded-2xl p-3.5 border border-amber-200/80 shadow-2xs flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            {prod.nombre}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {prod.familia} · SKU: {prod.sku}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border shrink-0 ${
                            agotado
                              ? "bg-rose-100 text-rose-700 border-rose-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }`}
                        >
                          {agotado
                            ? "Sin Stock (0)"
                            : `${prod.stock_individual} / mín. ${minimo}`}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                        <span>
                          Vitrina: <strong className="text-slate-800">{prod.stock_vitrina}</strong>
                        </span>
                        <span>
                          Bodega: <strong className="text-slate-800">{prod.stock_bodega}</strong>
                        </span>
                        <span className="text-rose-600 font-bold">
                          Faltan {Math.max(1, minimo - prod.stock_individual)} unid.
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {selectedAlert === "anomalias" && (
          <div className="card-soft rounded-3xl p-6 space-y-4 border-rose-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-rose-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
                  Detalle de Alerta · Diferencias de Stock en Vitrina
                </span>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Ventas registradas sin stock suficiente en vitrina ({anomaliasList.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/ajustes"
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition"
                >
                  Revisar en Ajustes / Mermas
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {anomaliasList.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No existen discrepancias abiertas entre las ventas del POS y el stock de vitrina.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                {anomaliasList.map((anom) => (
                  <div
                    key={anom.id}
                    className="bg-white rounded-2xl p-3.5 border border-rose-200/80 shadow-2xs flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          {anom.nombre_producto || anom.sku}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Ubicación: <strong className="text-slate-700">{anom.ubicacion_id}</strong>
                          {anom.referencia_ticket ? ` · Boleta: ${anom.referencia_ticket}` : ""}
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                        Déficit: {anom.unidades_deficit} unid.
                      </span>
                    </div>
                    {anom.detalles && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-100">
                        {anom.detalles}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedAlert === "orphans" && (
          <div className="card-soft rounded-3xl p-6 space-y-4 border-amber-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-amber-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
                  Detalle de Alerta · Códigos POS en Cuarentena
                </span>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Códigos vendidos en caja aún no vinculados al catálogo ({orphansList.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/ventas-externas"
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-2xs transition"
                >
                  Vincular en Ventas POS
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedAlert(null)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {orphansList.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No hay códigos pendientes: todas las ventas del POS están asociadas a tu catálogo.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
                {orphansList.map((orp) => (
                  <div
                    key={orp.codigo_original}
                    className="bg-white rounded-2xl p-3.5 border border-amber-200/80 shadow-2xs flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-extrabold text-slate-900">
                          Código POS: {orp.codigo_original}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {orp.boletas_afectadas} boleta(s) · Tipo: {orp.tipo_codigo}
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                        {orp.unidades_pendientes} unid.
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                      <span>
                        Precio ref.:{" "}
                        <strong className="text-slate-900">
                          ${orp.precio_unitario_sugerido.toLocaleString("es-CL")} CLP
                        </strong>
                      </span>
                      <Link
                        href="/ventas-externas"
                        className="text-rose-600 hover:text-rose-700 font-bold"
                      >
                        Resolver →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-semibold py-3 px-4 rounded-2xl shadow-2xl z-50 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
