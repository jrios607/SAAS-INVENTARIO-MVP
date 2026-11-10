"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  recepcionarPallet,
  recepcionarLpn,
  getPatentesBodega,
  getProductos,
  getCachedTenantSettings,
  getTenantSettings,
  BodegaPatente,
  Producto,
} from "@/services/api";

const Scanner = dynamic(
  () => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner),
  { ssr: false }
);

interface GS1Data {
  ean: string;
  peso: string;
  vencimiento: string;
  lote: string;
  modo_ingreso?: "AUTO" | "CAJAS" | "UNIDADES";
  cantidad_recibida?: number;
  ubicacion_id: string;
}

interface LPNData {
  destino: string;
  lpn: string;
  tipo_carga: string;
  ubicacion_id: string;
}

type ParsedData =
  | { type: "GS1"; data: GS1Data; original: string }
  | { type: "LPN"; data: LPNData; original: string };

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-recepcion-scanner",
    title: "1. Escanea o Escribe el Código",
    desc: "Usa tu pistola lectora, la cámara de tu teléfono o escribe el código de barras (EAN, caja DUN-14, etiqueta GS1 o SKU) para identificar la mercadería que llega.",
  },
  {
    targetId: "tour-recepcion-quickpick",
    title: "2. Selección Rápida del Catálogo",
    desc: "Si una caja no trae etiqueta legible, también puedes elegir directamente el producto de tu catálogo con un clic para registrar su entrada a bodega.",
  },
];

export default function RecepcionBodegaPage() {
  const [scanInput, setScanInput] = useState("");
  const [parsedResult, setParsedResult] = useState<ParsedData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [zonasBodega, setZonasBodega] = useState<BodegaPatente[]>([]);
  const [productosCatalogo, setProductosCatalogo] = useState<Producto[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [usesGs1Fefo, setUsesGs1Fefo] = useState<boolean>(false);

  const [cameraFeedback, setCameraFeedback] = useState("");
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  // Guía de ayuda (Tour)
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({});
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsLoadingCatalog(true);
    Promise.all([
      getPatentesBodega().then(setZonasBodega).catch(() => {}),
      getProductos().then(setProductosCatalogo).catch(() => {}),
    ]).finally(() => setIsLoadingCatalog(false));

    const cached = getCachedTenantSettings();
    if (cached) {
      setUsesGs1Fefo(Boolean(cached.business_profile.uses_gs1_128_fefo));
    }
    getTenantSettings().then((s) => {
      if (s) setUsesGs1Fefo(Boolean(s.business_profile.uses_gs1_128_fefo));
    });
  }, []);

  useEffect(() => {
    if (!parsedResult && inputRef.current && !isCameraOpen) {
      inputRef.current.focus();
    }
  }, [parsedResult, isCameraOpen]);

  // Obtener la lista de cámaras al abrir
  useEffect(() => {
    if (isCameraOpen && navigator?.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const cameras = devices.filter((device) => device.kind === "videoinput");
          setVideoDevices(cameras);
          if (cameras.length > 0 && !selectedDeviceId) {
            const backCamera = cameras.find(
              (c) =>
                c.label.toLowerCase().includes("back") ||
                c.label.toLowerCase().includes("trasera")
            );
            setSelectedDeviceId(backCamera ? backCamera.deviceId : cameras[0].deviceId);
          }
        })
        .catch(() => {});
    }
  }, [isCameraOpen, selectedDeviceId]);

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
        setParsedResult({
          type: "LPN",
          data: { destino, lpn, tipo_carga, ubicacion_id: "" },
          original: barcode,
        });
        return;
      }
    }

    // Caso Previo: Coincidencia con EAN-13, DUN-14 o SKU del Catálogo
    const matchedProd = productosCatalogo.find(
      (p) =>
        p.dun14 === barcode ||
        p.ean === barcode ||
        (barcode.length === 14 && barcode.startsWith("0") && p.ean === barcode.slice(1)) ||
        p.sku.toLowerCase() === barcode.toLowerCase()
    );
    if (matchedProd && !barcode.includes("(")) {
      const esCaja = matchedProd.dun14 === barcode;
      const diasVida =
        matchedProd.dias_vida_util && matchedProd.dias_vida_util > 0
          ? matchedProd.dias_vida_util
          : null;
      const fechaCalculada = diasVida
        ? new Date(Date.now() + diasVida * 86400000).toISOString().slice(0, 10)
        : "";
      setParsedResult({
        type: "GS1",
        data: {
          ean: esCaja ? matchedProd.dun14 || barcode : matchedProd.ean,
          peso: "1.00",
          vencimiento: fechaCalculada,
          lote: `L-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}`,
          ubicacion_id: "",
          modo_ingreso: esCaja ? "CAJAS" : "AUTO",
          cantidad_recibida: 1,
        },
        original: barcode,
      });
      return;
    }

    // Caso B: Lectura de LPN Directo
    if (/^\d{6,25}$/.test(barcode)) {
      setParsedResult({
        type: "LPN",
        data: { destino: "", lpn: barcode, tipo_carga: "", ubicacion_id: "" },
        original: barcode,
      });
      return;
    }

    // Caso C: Proveedor Directo GS1-128
    let ean = "";
    let peso = "";
    let vencimiento = "";
    let lote = "";
    let tempBarcode = barcode;

    const eanMatch = tempBarcode.match(/(?:^|[^0-9])?\(?01\)?(\d{14})/);
    if (eanMatch || tempBarcode.length > 30) {
      if (eanMatch) {
        ean = eanMatch[1];
        tempBarcode = tempBarcode.replace(/(?:^|[^0-9])?\(?01\)?\d{14}/, " ");
      } else {
        const fallbackEanMatch = tempBarcode.match(/^(\d{10,14})/);
        if (fallbackEanMatch) {
          ean = fallbackEanMatch[1].padStart(14, "0");
          tempBarcode = tempBarcode.replace(/^(\d{10,14})/, " ");
        }
      }

      const pesoMatch = tempBarcode.match(/\(?310[0-5]\)?(\d{6})/);
      if (pesoMatch) {
        const rawPeso = pesoMatch[1];
        const intPart = parseInt(rawPeso.substring(0, 4), 10);
        const decPart = rawPeso.substring(4, 6);
        peso = `${intPart}.${decPart}`;
        tempBarcode = tempBarcode.replace(/\(?310[0-5]\)?\d{6}/, " ");
      }

      const vencMatch = tempBarcode.match(/\(?15\)?(\d{6})/);
      if (vencMatch) {
        const rawVenc = vencMatch[1];
        const yy = rawVenc.substring(0, 2);
        const mm = rawVenc.substring(2, 4);
        const dd = rawVenc.substring(4, 6);
        vencimiento = `20${yy}-${mm}-${dd}`;
        tempBarcode = tempBarcode.replace(/\(?15\)?\d{6}/, " ");
      }

      const loteMatch = tempBarcode.match(
        /\(?10\)?([A-Za-z0-9]{1,20}?)(?:\(?21\)?|\(?30\)?|$)/
      );
      if (loteMatch) lote = loteMatch[1];

      if (vencimiento && ean) {
        setParsedResult({
          type: "GS1",
          data: {
            ean,
            peso: peso || "1.00",
            vencimiento,
            lote,
            ubicacion_id: "",
            modo_ingreso: "AUTO",
            cantidad_recibida: 1,
          },
          original: barcode,
        });
        return;
      }
    }

    setErrorMsg(
      `No se reconoció el código "${barcode}". Verifica que el producto exista en tu catálogo o intenta seleccionarlo abajo.`
    );
    setScanInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "}") {
      e.preventDefault();
      let data = inputRef.current ? inputRef.current.value.trim() : scanInput.trim();
      if (data.endsWith("}")) {
        data = data.slice(0, -1);
      }
      procesarCodigo(data);
    }
  };

  const rebuildBarcode = (data: GS1Data) => {
    const parts = (data.peso || "1.00").split(".");
    const intP = parts[0] || "0";
    let decP = parts[1] || "00";
    decP = decP.padEnd(2, "0").substring(0, 2);
    const rawPeso = intP.padStart(4, "0") + decP;

    const vParts = (data.vencimiento || "").split("-");
    let rawVenc = "000000";
    if (vParts.length === 3) {
      rawVenc = `${vParts[0].substring(2, 4)}${vParts[1]}${vParts[2]}`;
    }

    const gtin14 = /^\d{13}$/.test(data.ean.trim())
      ? data.ean.trim().padStart(14, "0")
      : data.ean.trim();
    return `(01)${gtin14}(3102)${rawPeso}(17)${rawVenc}(10)${data.lote}`;
  };

  const handleConfirm = async () => {
    if (!parsedResult) return;

    if (
      parsedResult.type === "LPN" &&
      (!parsedResult.data.destino || !parsedResult.data.tipo_carga)
    ) {
      setErrorMsg("Por favor selecciona el Destino y el Tipo de Carga antes de confirmar.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (parsedResult.type === "GS1") {
        const finalBarcode = rebuildBarcode(parsedResult.data);
        const resp = await recepcionarPallet(
          finalBarcode,
          parsedResult.data.ubicacion_id || undefined,
          parsedResult.data.modo_ingreso || "AUTO",
          parsedResult.data.cantidad_recibida || 1
        );
        const warnFrio = resp.advertencia_temperatura
          ? ` (${resp.advertencia_temperatura})`
          : "";
        setSuccessMsg(
          `${resp.mensaje || `Ingreso registrado para EAN ${parsedResult.data.ean}`}${warnFrio}`
        );
      } else if (parsedResult.type === "LPN") {
        await recepcionarLpn({
          destino: parsedResult.data.destino,
          lpn: parsedResult.data.lpn,
          tipo_carga: parsedResult.data.tipo_carga,
          original_barcode: parsedResult.original,
          ubicacion_id: parsedResult.data.ubicacion_id || undefined,
        });
        setSuccessMsg(`Pallet consolidado registrado con éxito (LPN: ${parsedResult.data.lpn}).`);
      }
      setTimeout(() => handleReset(), 2500);
    } catch (err: any) {
      setErrorMsg(err.message || "Error al registrar la recepción en bodega.");
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

  const productoSeleccionadoInfo = useMemo(() => {
    if (!parsedResult || parsedResult.type !== "GS1") return null;
    const raw = parsedResult.data.ean;
    return (
      productosCatalogo.find(
        (p) =>
          p.ean === raw ||
          p.dun14 === raw ||
          (raw.length === 14 && raw.startsWith("0") && p.ean === raw.slice(1))
      ) || null
    );
  }, [parsedResult, productosCatalogo]);

  const isLpnConfirmDisabled =
    isSubmitting ||
    (parsedResult?.type === "LPN" &&
      (!parsedResult.data.destino || !parsedResult.data.tipo_carga));

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
              Recepción de Mercadería
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Registra la llegada de cajas, productos o pallets a tu bodega de forma rápida y segura.
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
              onClick={() => setUsesGs1Fefo((prev) => !prev)}
              className="px-3.5 py-2 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold transition shadow-2xs cursor-pointer"
              title="Cambiar entre modo simple y modo etiqueta completa"
            >
              {usesGs1Fefo ? "Modo Etiqueta Completa" : "Modo Rápido (Simple)"}
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
      <main className="max-w-5xl w-full mx-auto p-6 space-y-6">
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold">
            {successMsg}
          </div>
        )}

        {!parsedResult ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Paso 1: Escáner / Pistola / Cámara */}
            <div
              id="tour-recepcion-scanner"
              className="card-soft rounded-3xl p-6 space-y-5 lg:col-span-7"
            >
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600">
                  Paso 1 · Lectura de Código
                </span>
                <h2 className="text-lg font-extrabold text-slate-900 mt-0.5">
                  Escanea o escribe el código del bulto
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Puedes usar tu lector de código de barras USB, la cámara del celular o escribir el EAN / SKU y presionar Enter.
                </p>
              </div>

              {isCameraOpen ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-600">
                      Cámara activa — apunta al código de barras
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCameraOpen(false)}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      Cerrar cámara
                    </button>
                  </div>

                  {videoDevices.length > 1 && (
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-2xl p-2.5"
                    >
                      {videoDevices.map((device, idx) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Cámara ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="rounded-2xl overflow-hidden bg-slate-900 aspect-[4/3] flex items-center justify-center relative border border-rose-200">
                    <Scanner
                      key={selectedDeviceId || "default-scanner"}
                      constraints={
                        selectedDeviceId
                          ? {
                              deviceId: selectedDeviceId,
                              width: { ideal: 1920 },
                              height: { ideal: 1080 },
                            }
                          : {
                              facingMode: "environment",
                              width: { ideal: 1920 },
                              height: { ideal: 1080 },
                            }
                      }
                      formats={["code_128", "code_39", "itf", "ean_13"]}
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
                          setIsCameraOpen(false);
                          procesarCodigo(data);
                        }
                      }}
                      components={{ finder: false }}
                    />
                  </div>

                  {cameraFeedback && (
                    <p className="text-xs text-center text-rose-600 font-semibold">
                      {cameraFeedback}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Escanea con la pistola o escribe EAN / SKU..."
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-rose-500 focus:bg-white font-mono transition"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => procesarCodigo(scanInput)}
                      className="px-5 py-3.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white text-xs font-bold shadow-md shadow-rose-200 transition cursor-pointer shrink-0"
                    >
                      Validar
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsCameraOpen(true)}
                    className="w-full py-3.5 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition cursor-pointer"
                  >
                    Abrir Cámara del Teléfono / Dispositivo
                  </button>
                </div>
              )}
            </div>

            {/* Selección Rápida desde el Catálogo */}
            <div
              id="tour-recepcion-quickpick"
              className="card-soft rounded-3xl p-6 space-y-4 lg:col-span-5"
            >
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  Alternativa sin Pistola
                </span>
                <h3 className="text-sm font-extrabold text-slate-900 mt-0.5">
                  Seleccionar Producto del Catálogo
                </h3>
                <p className="text-xs text-slate-500">
                  Haz clic en un producto para preparar su ingreso a bodega.
                </p>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {isLoadingCatalog ? (
                  [1, 2, 3, 4].map((sk) => (
                    <div
                      key={sk}
                      className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3 space-y-1.5 animate-pulse"
                    >
                      <div className="h-3.5 w-40 bg-slate-200 rounded" />
                      <div className="h-2.5 w-24 bg-rose-100 rounded" />
                    </div>
                  ))
                ) : productosCatalogo.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No hay productos registrados en el catálogo.
                  </p>
                ) : (
                  productosCatalogo.slice(0, 12).map((prod) => (
                    <button
                      key={prod.sku}
                      type="button"
                      onClick={() => procesarCodigo(prod.ean || prod.sku)}
                      className="w-full text-left rounded-2xl bg-white hover:bg-rose-50/50 border border-slate-200/80 hover:border-rose-200 p-3 transition flex items-center justify-between gap-2 cursor-pointer shadow-2xs"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-900 truncate">
                          {prod.nombre}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          {prod.sku} {prod.ean ? `· EAN: ${prod.ean}` : ""}
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-rose-600 shrink-0">
                        Recibir →
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : parsedResult.type === "GS1" ? (
          /* Paso 2: Confirmación de Producto / Caja */
          <div className="card-soft rounded-3xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-rose-100 pb-4">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600">
                  Paso 2 · Confirmar Datos de Ingreso
                </span>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {productoSeleccionadoInfo
                    ? productoSeleccionadoInfo.nombre
                    : "Ingreso de Mercadería a Bodega"}
                </h2>
                <p className="text-xs text-slate-500">
                  Código leído: <strong className="font-mono">{parsedResult.original}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                ← Escanear otro código
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Código de Barras (EAN / GTIN)
                </label>
                <input
                  type="text"
                  value={parsedResult.data.ean}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, ean: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono text-slate-900 focus:outline-none focus:border-rose-400"
                />
              </div>

              {usesGs1Fefo && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Código de Lote
                  </label>
                  <input
                    type="text"
                    value={parsedResult.data.lote}
                    onChange={(e) =>
                      setParsedResult({
                        ...parsedResult,
                        data: { ...parsedResult.data, lote: e.target.value },
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono uppercase text-slate-900 focus:outline-none focus:border-rose-400"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Fecha de Vencimiento
                </label>
                <input
                  type="date"
                  value={parsedResult.data.vencimiento}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, vencimiento: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-900 focus:outline-none focus:border-rose-400"
                />
              </div>

              {usesGs1Fefo && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Peso Referencial (Kg)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={parsedResult.data.peso}
                    onChange={(e) =>
                      setParsedResult({
                        ...parsedResult,
                        data: { ...parsedResult.data, peso: e.target.value },
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono text-slate-900 focus:outline-none focus:border-rose-400"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Formato de Entrada
                </label>
                <select
                  value={parsedResult.data.modo_ingreso || "AUTO"}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: {
                        ...parsedResult.data,
                        modo_ingreso: e.target.value as "AUTO" | "CAJAS" | "UNIDADES",
                      },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                >
                  <option value="AUTO">Automático (Detecta Caja vs Unidad)</option>
                  <option value="CAJAS">Cajas Cerradas (Multiplica por Unid/Caja)</option>
                  <option value="UNIDADES">Unidades Sueltas</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Cantidad Recibida
                </label>
                <input
                  type="number"
                  min={1}
                  value={parsedResult.data.cantidad_recibida ?? 1}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: {
                        ...parsedResult.data,
                        cantidad_recibida: Math.max(1, parseInt(e.target.value, 10) || 1),
                      },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-900 focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Zona de Bodega Destino
                </label>
                <select
                  value={parsedResult.data.ubicacion_id}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, ubicacion_id: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                >
                  <option value="">Dejar en zona general de recepción</option>
                  {zonasBodega.map((z) => (
                    <option key={z.id_patente} value={z.id_patente}>
                      {z.area_pasillo} ({z.tipo_ubicacion.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={handleReset}
                disabled={isSubmitting}
                className="px-5 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white text-xs font-bold shadow-md shadow-rose-200 transition disabled:opacity-60 cursor-pointer"
              >
                {isSubmitting ? "Registrando ingreso..." : "Confirmar Ingreso a Bodega"}
              </button>
            </div>
          </div>
        ) : (
          /* Paso 2 Alternativo: Pallet Consolidado (LPN) */
          <div className="card-soft rounded-3xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-rose-100 pb-4">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600">
                  Paso 2 · Pallet Consolidado
                </span>
                <h2 className="text-lg font-extrabold text-slate-900">
                  Confirmar Recepción de Pallet (LPN)
                </h2>
                <p className="text-xs text-slate-500">
                  Código leído: <strong className="font-mono">{parsedResult.original}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                ← Escanear otro código
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Código del Pallet (LPN)
                </label>
                <input
                  type="text"
                  value={parsedResult.data.lpn}
                  readOnly
                  className="w-full bg-slate-100 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Local / Destino *
                </label>
                <select
                  value={parsedResult.data.destino}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, destino: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                >
                  <option value="" disabled>
                    -- Selecciona destino --
                  </option>
                  <option value="3513">3513 - S10 San Joaquín</option>
                  <option value="3514">3514 - S11 La Florida</option>
                  {parsedResult.data.destino &&
                    !["3513", "3514"].includes(parsedResult.data.destino) && (
                      <option value={parsedResult.data.destino}>
                        {parsedResult.data.destino} - Local Asignado
                      </option>
                    )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Temperatura de Carga *
                </label>
                <select
                  value={parsedResult.data.tipo_carga}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, tipo_carga: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                >
                  <option value="" disabled>
                    -- Selecciona tipo --
                  </option>
                  <option value="SECO">Ambiente Seco</option>
                  <option value="FRIO">Refrigerado (Frío)</option>
                  <option value="CONGELADO">Congelado</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Zona de Bodega Destino
                </label>
                <select
                  value={parsedResult.data.ubicacion_id}
                  onChange={(e) =>
                    setParsedResult({
                      ...parsedResult,
                      data: { ...parsedResult.data, ubicacion_id: e.target.value },
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-rose-400"
                >
                  <option value="">Dejar en zona general de recepción</option>
                  {zonasBodega.map((z) => (
                    <option key={z.id_patente} value={z.id_patente}>
                      {z.area_pasillo} ({z.tipo_ubicacion.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={handleReset}
                disabled={isSubmitting}
                className="px-5 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isLpnConfirmDisabled}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white text-xs font-bold shadow-md shadow-rose-200 transition disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? "Registrando pallet..." : "Confirmar Recepción de Pallet"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
