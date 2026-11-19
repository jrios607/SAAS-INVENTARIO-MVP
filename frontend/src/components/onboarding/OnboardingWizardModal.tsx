"use client";

import React, { useState, useEffect } from "react";
import {
  TenantSettingsResponse,
  updateTenantSettings,
} from "@/services/api";
import {
  Store,
  Building2,
  Webhook,
  FileSpreadsheet,
  Layers,
  CheckCircle2,
  Sparkles,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ScanBarcode,
  PackageCheck,
} from "lucide-react";

interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: TenantSettingsResponse | null;
  onSaved: (updated: TenantSettingsResponse) => void;
}

const OPTIONAL_MODULES_LIST = [
  { id: "plano_bodega", label: "Mapa de Bodega (Trastienda / Cámaras)" },
  { id: "trazabilidad", label: "Historial de Movimientos (Auditoría)" },
];

function computeDefaultModules(scale: "minimarket" | "supermercado"): string[] {
  const base = [
    "dashboard",
    "catalogo",
    "plano_supermercado",
    "recepcion_bodega",
    "ajustes_inventario",
    "ventas_externas",
  ];
  if (scale === "supermercado") {
    base.push("plano_bodega", "trazabilidad");
  }
  return base;
}

export function OnboardingWizardModal({
  isOpen,
  onClose,
  currentSettings,
  onSaved,
}: OnboardingWizardModalProps) {
  const [step, setStep] = useState<number>(1);
  const [nombreLocal, setNombreLocal] = useState<string>("Mi Local BVCore");
  const [scale, setScale] = useState<"minimarket" | "supermercado">("minimarket");
  const [posMode, setPosMode] = useState<"modern_pos" | "legacy_file_pos">("legacy_file_pos");
  const [externalProvider, setExternalProvider] = useState<string>("BSALE_POS");
  const [fallbackBodega, setFallbackBodega] = useState<boolean>(false);
  const [usesGs1Fefo, setUsesGs1Fefo] = useState<boolean>(false);
  const [enabledModules, setEnabledModules] = useState<string[]>(() =>
    computeDefaultModules("minimarket")
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (currentSettings && isOpen) {
      setNombreLocal(currentSettings.nombre_local || "Mi Local BVCore");
      setScale(currentSettings.business_profile.scale);
      setPosMode(
        currentSettings.pos_strategy.mode === "modern_pos"
          ? "modern_pos"
          : "legacy_file_pos"
      );
      setExternalProvider(currentSettings.pos_strategy.external_provider || "BSALE_POS");
      setFallbackBodega(Boolean(currentSettings.pos_strategy.fallback_to_warehouse_on_zero_shelf));
      setUsesGs1Fefo(Boolean(currentSettings.business_profile.uses_gs1_128_fefo));
      setEnabledModules(
        currentSettings.enabled_modules.filter(
          (m) => m !== "picking" && m !== "ordenes_compra" && m !== "pos_express"
        )
      );
      setStep(1);
      setErrorMsg(null);
    }
  }, [currentSettings, isOpen]);

  // Permitir cerrar con la tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleScaleSelect = (newScale: "minimarket" | "supermercado") => {
    setScale(newScale);
    setEnabledModules(computeDefaultModules(newScale));
    if (newScale === "minimarket") {
      setUsesGs1Fefo(false);
    }
  };

  const toggleOptionalModule = (modId: string) => {
    setEnabledModules((prev) =>
      prev.includes(modId) ? prev.filter((m) => m !== modId) : [...prev, modId]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const updated = await updateTenantSettings({
        nombre_local: nombreLocal.trim() || "Mi Local BVCore",
        onboarding_completed: true,
        business_profile: {
          scale,
          has_separate_warehouse_map: enabledModules.includes("plano_bodega"),
          uses_gs1_128_fefo: usesGs1Fefo,
        },
        pos_strategy: {
          mode: posMode,
          accepted_no_sii_disclaimer: false,
          external_provider: posMode === "modern_pos" ? externalProvider : null,
          fallback_to_warehouse_on_zero_shelf: fallbackBodega,
        },
        enabled_modules: enabledModules,
      });
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "No se pudo guardar la configuración del local.";
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configuración del negocio"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white border border-rose-200 rounded-3xl max-w-3xl w-full shadow-2xl overflow-hidden text-slate-800 my-auto">
        {/* Cabecera Pastel-Rose */}
        <div className="p-5 sm:p-6 border-b border-rose-100 flex items-center justify-between bg-rose-50/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-600 to-rose-500 flex items-center justify-center text-white shadow-sm shadow-rose-200 shrink-0">
              <Sparkles size={19} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-rose-600 font-extrabold">
                Configuración de tu tienda • Paso {step} de 4
              </div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Adapta BVCore a tu negocio
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-rose-100/70 transition-colors text-xs font-bold flex items-center gap-1 cursor-pointer"
            title="Cerrar asistente (Esc)"
          >
            <X size={16} />
            <span className="hidden sm:inline">Esc</span>
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="grid grid-cols-4 gap-1.5 bg-rose-50/40 px-6 pb-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-colors ${
                n <= step ? "bg-rose-600" : "bg-rose-200/70"
              }`}
            />
          ))}
        </div>

        {/* Cuerpo por paso */}
        <div className="p-5 sm:p-7 space-y-5 max-h-[68vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  1. ¿Cómo es el tamaño de tu tienda?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Ajustamos el menú lateral para que solo veas las pantallas que necesitas en el día a día.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Nombre de tu local o sucursal
                </label>
                <input
                  type="text"
                  value={nombreLocal}
                  onChange={(e) => setNombreLocal(e.target.value)}
                  placeholder="Ej: Minimarket Don Pedro / Almacén Central"
                  className="w-full bg-slate-50 border border-slate-200 focus:border-rose-500 focus:bg-white rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none transition"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleScaleSelect("minimarket")}
                  className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    scale === "minimarket"
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Store
                      size={24}
                      className={scale === "minimarket" ? "text-rose-600" : "text-slate-400"}
                    />
                    {scale === "minimarket" && (
                      <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-lg bg-rose-600 text-white">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="font-extrabold text-sm text-slate-900">
                    Minimarket / Almacén de Barrio
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    1 a 3 pasillos y trastienda pequeña. Mantiene una interfaz simple y directa para revisar en 10 minutos al día.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleScaleSelect("supermercado")}
                  className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    scale === "supermercado"
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Building2
                      size={24}
                      className={scale === "supermercado" ? "text-rose-600" : "text-slate-400"}
                    />
                    {scale === "supermercado" && (
                      <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-lg bg-rose-600 text-white">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="font-extrabold text-sm text-slate-900">
                    Supermercado / Bodega Amplia
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Varios pasillos, bodega independiente o cámaras de frío. Activa también el Mapa de Bodega y el Historial detallado.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  2. ¿Cómo registras las ventas en tu caja?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  BVCore se conecta a tu caja actual para descontar el stock vendido automáticamente (sin reemplazar tu boleta).
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setPosMode("modern_pos")}
                  className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-4 cursor-pointer ${
                    posMode === "modern_pos"
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <Webhook
                    size={22}
                    className={`shrink-0 mt-0.5 ${
                      posMode === "modern_pos" ? "text-rose-600" : "text-slate-400"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="font-extrabold text-sm text-slate-900">
                      Opción A: Tengo caja con conexión en vivo (Bsale, Loyverse, Fudo, Shopify)
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Cada venta en caja descuenta el inventario al instante de forma automática.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPosMode("legacy_file_pos")}
                  className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-4 cursor-pointer ${
                    posMode === "legacy_file_pos"
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <FileSpreadsheet
                    size={22}
                    className={`shrink-0 mt-0.5 ${
                      posMode === "legacy_file_pos" ? "text-rose-600" : "text-slate-400"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="font-extrabold text-sm text-slate-900">
                      Opción B: Subo mi reporte o planilla de ventas al final del día (.XLSX / .CSV / .TXT)
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Ideal para cajas tradicionales o facturadores: cargas el archivo de cierre y revisas antes de descontar.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  3. Si la vitrina figura en 0 unidades al vender, ¿qué hacemos?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Elige cómo cuidar la diferencia entre lo que está en góndola y lo que queda en bodega.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setFallbackBodega(false)}
                  className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    !fallbackBodega
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600">
                      Opción A • Recomendado
                    </span>
                    {!fallbackBodega && <CheckCircle2 size={18} className="text-rose-600" />}
                  </div>
                  <div className="font-extrabold text-sm text-slate-900">
                    Avisar falta de reposición en vitrina
                  </div>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    Descuenta solo de vitrina. Si se vende algo cuando el sistema marca 0 en sala, te crea una{" "}
                    <strong>alerta</strong> para recordar reponer desde bodega.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setFallbackBodega(true)}
                  className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    fallbackBodega
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      Opción B • Descuento continuo
                    </span>
                    {fallbackBodega && <CheckCircle2 size={18} className="text-rose-600" />}
                  </div>
                  <div className="font-extrabold text-sm text-slate-900">
                    Tomar automático desde bodega
                  </div>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    Si la vitrina llega a 0, descuenta automáticamente del lote más cercano a vencer en{" "}
                    <strong>bodega</strong> sin detener el conteo.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  4. Ingreso de mercadería y secciones del menú
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Elige si prefieres un ingreso rápido al recibir proveedores o etiquetas con lote detallado.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setUsesGs1Fefo(false)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    !usesGs1Fefo
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold text-sm text-slate-900">
                    <PackageCheck
                      size={18}
                      className={!usesGs1Fefo ? "text-rose-600" : "text-slate-400"}
                    />
                    Ingreso Rápido (Abarrotes y Bebidas)
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5">
                    Pide solo código de barra y cantidad recibida; el vencimiento es opcional.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setUsesGs1Fefo(true)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                    usesGs1Fefo
                      ? "bg-rose-50/70 border-rose-500 shadow-xs"
                      : "bg-white border-slate-200 hover:border-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold text-sm text-slate-900">
                    <ScanBarcode
                      size={18}
                      className={usesGs1Fefo ? "text-rose-600" : "text-slate-400"}
                    />
                    Control Estricto por Lote y Etiqueta
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5">
                    Activa lectura de etiquetas completas (cajas de frío / perecibles con fecha exacta).
                  </p>
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  <Layers size={14} className="text-rose-600" />
                  Vistas opcionales visibles en el menú lateral
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {OPTIONAL_MODULES_LIST.map((mod) => (
                    <label
                      key={mod.id}
                      className="flex items-center gap-2.5 p-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer hover:border-rose-300 transition"
                    >
                      <input
                        type="checkbox"
                        checked={enabledModules.includes(mod.id)}
                        onChange={() => toggleOptionalModule(mod.id)}
                        className="accent-rose-600 w-4 h-4"
                      />
                      <span>{mod.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-bold">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="p-5 sm:p-6 border-t border-rose-100 bg-rose-50/30 flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="px-4 py-2.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-2 shadow-2xs cursor-pointer transition"
            >
              <ArrowLeft size={15} />
              Anterior
            </button>
          ) : (
            <div className="text-xs text-slate-500">
              Puedes cambiar estas preferencias en cualquier momento.
            </div>
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setStep((s) => Math.min(4, s + 1));
              }}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-rose-200 transition cursor-pointer"
            >
              Siguiente
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-rose-200 transition cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  Guardar configuración
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
