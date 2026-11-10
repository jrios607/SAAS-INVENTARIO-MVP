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
  Camera,
  ShieldAlert,
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
  { id: "plano_bodega", label: "Plano Bodega (Trastienda / Cámaras)" },
  { id: "ordenes_compra", label: "Órdenes de Compra (ASN)" },
  { id: "picking", label: "Preparación de Pedidos (Picking)" },
  { id: "pos_express", label: "POS Express (Cámara — Modo Demo)" },
];

function computeDefaultModules(
  scale: "minimarket" | "supermercado",
  posMode: "modern_pos" | "legacy_file_pos" | "reference_pos"
): string[] {
  const base = [
    "dashboard",
    "catalogo",
    "plano_supermercado",
    "recepcion_bodega",
    "ajustes_inventario",
    "ventas_externas",
    "trazabilidad",
  ];
  if (scale === "supermercado") {
    base.push("plano_bodega", "ordenes_compra", "picking");
  }
  if (posMode === "reference_pos") {
    base.push("pos_express");
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
  const [posMode, setPosMode] = useState<"modern_pos" | "legacy_file_pos" | "reference_pos">("legacy_file_pos");
  const [externalProvider, setExternalProvider] = useState<string>("BSALE_POS");
  const [acceptedSiiDisclaimer, setAcceptedSiiDisclaimer] = useState<boolean>(false);
  const [fallbackBodega, setFallbackBodega] = useState<boolean>(false);
  const [usesGs1Fefo, setUsesGs1Fefo] = useState<boolean>(true);
  const [enabledModules, setEnabledModules] = useState<string[]>(() =>
    computeDefaultModules("minimarket", "legacy_file_pos")
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (currentSettings && isOpen) {
      setNombreLocal(currentSettings.nombre_local || "Mi Local BVCore");
      setScale(currentSettings.business_profile.scale);
      setPosMode(currentSettings.pos_strategy.mode);
      setExternalProvider(currentSettings.pos_strategy.external_provider || "BSALE_POS");
      setAcceptedSiiDisclaimer(Boolean(currentSettings.pos_strategy.accepted_no_sii_disclaimer));
      setFallbackBodega(Boolean(currentSettings.pos_strategy.fallback_to_warehouse_on_zero_shelf));
      setUsesGs1Fefo(Boolean(currentSettings.business_profile.uses_gs1_128_fefo));
      setEnabledModules(currentSettings.enabled_modules);
      setStep(1);
      setErrorMsg(null);
    }
  }, [currentSettings, isOpen]);

  if (!isOpen) return null;

  const handleScaleSelect = (newScale: "minimarket" | "supermercado") => {
    setScale(newScale);
    setEnabledModules(computeDefaultModules(newScale, posMode));
  };

  const handlePosModeSelect = (newMode: "modern_pos" | "legacy_file_pos" | "reference_pos") => {
    setPosMode(newMode);
    setEnabledModules(computeDefaultModules(scale, newMode));
  };

  const toggleOptionalModule = (modId: string) => {
    setEnabledModules((prev) =>
      prev.includes(modId) ? prev.filter((m) => m !== modId) : [...prev, modId]
    );
  };

  const handleSave = async () => {
    if (posMode === "reference_pos" && !acceptedSiiDisclaimer) {
      setErrorMsg("Debes confirmar la lectura del aviso sobre el Modo Demo de POS Express.");
      return;
    }
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
          accepted_no_sii_disclaimer: acceptedSiiDisclaimer,
          external_provider: posMode === "modern_pos" ? externalProvider : null,
          fallback_to_warehouse_on_zero_shelf: fallbackBodega,
        },
        enabled_modules: enabledModules,
      });
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar la configuración del local.";
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0e0e0e] border border-[#262626] rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden text-gray-200">
        {/* Cabecera */}
        <div className="p-6 border-b border-[#1f1f1f] flex items-center justify-between bg-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-emerald-400 font-bold">
                Perfilamiento Adaptativo • Paso {step} de 4
              </div>
              <h2 className="text-xl font-bold text-white">Configura tu Cerebro Logístico</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition-colors"
            title="Cerrar asistente"
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="grid grid-cols-4 gap-1 bg-[#0a0a0a] px-6 pb-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-colors ${
                n <= step ? "bg-emerald-500" : "bg-[#222]"
              }`}
            />
          ))}
        </div>

        {/* Cuerpo por paso */}
        <div className="p-6 md:p-8 space-y-6">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-white">
                  1. ¿Cuál describe mejor la operación física de tu negocio?
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  BVCore adapta la barra lateral para mostrar únicamente las herramientas que tu equipo necesita.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Nombre de tu Local o Sucursal
                </label>
                <input
                  type="text"
                  value={nombreLocal}
                  onChange={(e) => setNombreLocal(e.target.value)}
                  placeholder="Ej: Minimarket Don Pedro / Supermercado Central"
                  className="w-full bg-[#070707] border border-[#262626] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleScaleSelect("minimarket")}
                  className={`p-5 rounded-2xl border text-left transition-all ${
                    scale === "minimarket"
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Store size={24} className={scale === "minimarket" ? "text-emerald-400" : "text-gray-400"} />
                    {scale === "minimarket" && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-black">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-base">Minimarket / Almacén de Barrio</div>
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                    1 a 3 pasillos, trastienda pequeña o integrada. Oculta por defecto módulos industriales como
                    Picking por Olas y Plano de Bodega separado.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleScaleSelect("supermercado")}
                  className={`p-5 rounded-2xl border text-left transition-all ${
                    scale === "supermercado"
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Building2 size={24} className={scale === "supermercado" ? "text-emerald-400" : "text-gray-400"} />
                    {scale === "supermercado" && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-black">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-base">Supermercado / Distribuidora</div>
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                    Múltiples pasillos, bodega independiente o cámaras de frío. Desbloquea vista dual (Plano Sala +
                    Plano Bodega), Órdenes de Compra y Preparación (Picking).
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-white">
                  2. ¿Cómo registras las ventas en caja actualmente?
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Configura el canal predeterminado con el que BVCore descontará el stock vendido bajo FEFO.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => handlePosModeSelect("modern_pos")}
                  className={`w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-4 ${
                    posMode === "modern_pos"
                      ? "bg-blue-500/10 border-blue-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <Webhook size={22} className="text-blue-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-bold text-sm">
                      Opción A: Ya cuento con un Punto de Venta moderno (Bsale, Loyverse, Fudo, Shopify, ERP)
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Abre Ventas Externas directamente en <strong>Conexión Automática en Vivo (API Key)</strong> y
                      deja la subida de archivos como respaldo secundario.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handlePosModeSelect("legacy_file_pos")}
                  className={`w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-4 ${
                    posMode === "legacy_file_pos"
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <FileSpreadsheet size={22} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-bold text-sm">
                      Opción B: Uso caja tradicional o facturador con reporte de cierre (.XLSX / .CSV / .TXT)
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Abre Ventas Externas enfocado en la <strong>Carga de Archivos Cierre Z con Pre-visualización Segura (Dry-Run)</strong>.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handlePosModeSelect("reference_pos")}
                  className={`w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-4 ${
                    posMode === "reference_pos"
                      ? "bg-amber-500/10 border-amber-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <Camera size={22} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">
                        Opción C: Habilitar vista POS Express (Cámara)
                      </span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        Modo Demo
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Muestra en el menú lateral el módulo demostrativo de escaneo por cámara o pistola láser.
                    </p>
                  </div>
                </button>
              </div>

              {posMode === "reference_pos" && (
                <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Aviso Importante (Modo Demo / Sin Validez SII):</strong> &ldquo;POS Express&rdquo; es una
                      vista referencial de demostración para lectura por cámara o pistola láser. No emite boletas ni
                      facturas electrónicas válidas ante el SII y opera en entorno de demostración sin alterar los
                      lotes productivos.
                    </div>
                  </div>
                  <label className="flex items-center gap-2 font-semibold text-amber-100 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={acceptedSiiDisclaimer}
                      onChange={(e) => setAcceptedSiiDisclaimer(e.target.checked)}
                      className="accent-amber-500"
                    />
                    Comprendo que POS Express es una vista demostrativa y no reemplaza la boleta electrónica del SII.
                  </label>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-white">
                  3. Regla Operativa de Descuento de Stock (Vitrina vs. Bodega)
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Cuando vendes un producto y en el sistema figura que la Vitrina llegó a 0 unidades, ¿qué debe hacer
                  BVCore? Esta política queda fija para proteger tu inventario.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setFallbackBodega(false)}
                  className={`p-5 rounded-2xl border text-left transition-all ${
                    !fallbackBodega
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Opción A • Recomendado
                    </span>
                    {!fallbackBodega && <CheckCircle2 size={18} className="text-emerald-400" />}
                  </div>
                  <div className="font-bold text-base">Modo Estricto (Detectar Quiebre en Góndola)</div>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                    Descuenta <strong>únicamente de Vitrina</strong>. Si la góndola figura en 0 unidades, genera una
                    alerta de <strong>Quiebre Visual / Discrepancia</strong> para obligar a registrar la reposición
                    desde Bodega.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setFallbackBodega(true)}
                  className={`p-5 rounded-2xl border text-left transition-all ${
                    fallbackBodega
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                      Opción B • Venta Continua
                    </span>
                    {fallbackBodega && <CheckCircle2 size={18} className="text-emerald-400" />}
                  </div>
                  <div className="font-bold text-base">Modo Continuo (Respaldo Automático a Bodega)</div>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                    Si el stock en Vitrina llega a 0, descuenta automáticamente del lote más próximo a vencer en la{" "}
                    <strong>Bodega / Trastienda</strong>. Ideal si despachas directo desde trastienda.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-white">
                  4. Nivel de Trazabilidad en Recepción y Módulos Opcionales
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  ¿Manejas perecibles críticos / etiquetas industriales GS1-128 o prefieres ingreso rápido por unidades?
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setUsesGs1Fefo(true)}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    usesGs1Fefo
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <ScanBarcode size={18} className="text-emerald-400" />
                    Control Estricto por Lote, FEFO y GS1-128
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Habilita el decodificador completo de etiquetas frigoríficas GS1-128 y pallets LPN en Recepción
                    Bodega.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setUsesGs1Fefo(false)}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    !usesGs1Fefo
                      ? "bg-emerald-500/10 border-emerald-500 text-white"
                      : "bg-[#080808] border-[#222] text-gray-300 hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <PackageCheck size={18} className="text-emerald-400" />
                    Control Ágil por Unidades Simples (Abarrotes)
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Simplifica Recepción Bodega pidiendo únicamente código EAN/SKU y cantidad, con vencimiento
                    opcional.
                  </p>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-[#080808] border border-[#1f1f1f] space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <Layers size={14} className="text-emerald-400" />
                  Personalizar Módulos Adicionales del Menú Lateral
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {OPTIONAL_MODULES_LIST.map((mod) => (
                    <label
                      key={mod.id}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#111] border border-[#222] text-xs text-gray-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={enabledModules.includes(mod.id)}
                        onChange={() => toggleOptionalModule(mod.id)}
                        className="accent-emerald-500"
                      />
                      <span>{mod.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="p-6 border-t border-[#1f1f1f] bg-[#0a0a0a] flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="px-4 py-2.5 rounded-xl bg-[#161616] hover:bg-[#222] border border-[#2a2a2a] text-xs font-semibold text-gray-200 flex items-center gap-2"
            >
              <ArrowLeft size={15} />
              Anterior
            </button>
          ) : (
            <div className="text-xs text-gray-500">
              Puedes reconfigurar este perfil cuando quieras desde la barra lateral.
            </div>
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 2 && posMode === "reference_pos" && !acceptedSiiDisclaimer) {
                  setErrorMsg("Por favor confirma la lectura del aviso de Modo Demo antes de continuar.");
                  return;
                }
                setErrorMsg(null);
                setStep((s) => Math.min(4, s + 1));
              }}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-2 transition-colors"
            >
              Siguiente
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold text-xs flex items-center gap-2 transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Guardando Perfil...
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  Aplicar Perfil Operativo
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
