"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Layers,
  Package,
  AlertTriangle,
  Flame,
  Search,
  Store,
  X,
  Info,
  Plus,
  Pencil,
  PencilOff,
  Trash2,
  RotateCw,
  Settings,
  Copy,
  RefreshCw,
  Save,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  TrendingUp,
} from "lucide-react";
import {
  ApiHttpError,
  getActiveTenantId,
  getPatentesStrict,
  createPatente,
  updatePatenteSafe,
  deletePatente,
  moverSatoAVitrina,
  getStockPatente,
  getSatosDisponibles,
  getProductos,
  getComplianceBatch,
  getAlertasVencimiento,
  getZonasAbcPatentes,
  recalcularAbc,
  reportarDiscrepanciaVitrina,
  declararMermaRapida,
  type Patente,
  type Producto,
  type StockItem,
  type SatoDisponible,
  type ComplianceResponse,
  type AlertaVencimientoItem,
  type AbcPlanoResumenResponse,
} from "@/services/api";

// ─── Tipos del Plano 2D Esquemático (Sin medidas físicas en metros) ──────────
type CapaVisual = "categorias" | "stock" | "vencimientos" | "abc";

type TipoMueble =
  | "Góndola Central"
  | "Cabecera Promocional"
  | "Vitrina Mural Frío"
  | "Isla Congelados"
  | "Mostrador"
  | "Fruver"
  | "Zona de Cajas";

type AreaMueble =
  | "Abarrotes"
  | "Lácteos"
  | "Carnicería"
  | "Fiambrería"
  | "Panadería"
  | "Frutas y Verduras"
  | "Congelados"
  | "Bebidas"
  | "Limpieza"
  | "Cajas";

interface MueblePlano {
  id: string;
  nombre: string;
  tipo: TipoMueble;
  area: AreaMueble;
  x: number;
  y: number;
  w: number;
  h: number;
  rotacion: number;
  persistedInDb: boolean;
  productosAsignados: string[];
  submapeoGrid: Record<string, any> | null;
}

const AREAS_DISPONIBLES: AreaMueble[] = [
  "Abarrotes",
  "Lácteos",
  "Carnicería",
  "Fiambrería",
  "Panadería",
  "Frutas y Verduras",
  "Congelados",
  "Bebidas",
  "Limpieza",
  "Cajas",
];

const TIPOS_MUEBLE_DISPONIBLES: TipoMueble[] = [
  "Góndola Central",
  "Cabecera Promocional",
  "Vitrina Mural Frío",
  "Isla Congelados",
  "Mostrador",
  "Fruver",
  "Zona de Cajas",
];

const PREFIX_POR_TIPO: Record<TipoMueble, string> = {
  "Góndola Central": "GOND",
  "Cabecera Promocional": "CAB",
  "Vitrina Mural Frío": "VITR",
  "Isla Congelados": "ISLA",
  Mostrador: "MOST",
  Fruver: "FRUV",
  "Zona de Cajas": "CAJA",
};

const CATEGORY_STYLES: Record<AreaMueble, { bg: string; border: string; dot: string; text: string }> = {
  Abarrotes:           { bg: "bg-white/95 hover:bg-rose-50/40",        border: "border-rose-200 hover:border-rose-400",       dot: "bg-emerald-500", text: "text-slate-600" },
  Lácteos:             { bg: "bg-teal-50/75 hover:bg-teal-50",         border: "border-teal-300 hover:border-teal-400",       dot: "bg-teal-500",    text: "text-teal-700" },
  Carnicería:          { bg: "bg-rose-50/75 hover:bg-rose-100/70",     border: "border-rose-300 hover:border-rose-500",       dot: "bg-rose-600",    text: "text-rose-700" },
  Fiambrería:          { bg: "bg-amber-50/75 hover:bg-amber-100/70",   border: "border-amber-300 hover:border-amber-400",     dot: "bg-amber-500",   text: "text-amber-700" },
  Panadería:           { bg: "bg-yellow-50/75 hover:bg-yellow-100/70", border: "border-yellow-300 hover:border-yellow-400",   dot: "bg-yellow-500",  text: "text-yellow-700" },
  "Frutas y Verduras": { bg: "bg-emerald-50/75 hover:bg-emerald-50",   border: "border-emerald-300 hover:border-emerald-400", dot: "bg-emerald-500", text: "text-emerald-700" },
  Congelados:          { bg: "bg-sky-50/75 hover:bg-sky-100/70",       border: "border-sky-300 hover:border-sky-400",         dot: "bg-sky-500",     text: "text-sky-700" },
  Bebidas:             { bg: "bg-purple-50/75 hover:bg-purple-100/70", border: "border-purple-300 hover:border-purple-400",   dot: "bg-purple-500",  text: "text-purple-700" },
  Limpieza:            { bg: "bg-blue-50/75 hover:bg-blue-100/70",     border: "border-blue-300 hover:border-blue-400",       dot: "bg-blue-500",    text: "text-blue-700" },
  Cajas:               { bg: "bg-white/95 hover:bg-rose-50/40",        border: "border-rose-200 hover:border-rose-400",       dot: "bg-emerald-500", text: "text-rose-600" },
};

const VALID_ID_RE = /^[A-Z0-9._-]+$/;

// ─── Normalización de valores históricos de Base de Datos ────────────────────
function normalizarTipoMueble(raw?: string | null): TipoMueble {
  const s = (raw || "").trim().toLowerCase();
  if (s.includes("vitrina") || s.includes("mural") || s.includes("frío") || s.includes("frio")) {
    return "Vitrina Mural Frío";
  }
  if (s.includes("isla") || s.includes("congelad")) return "Isla Congelados";
  if (s.includes("cabecera")) return "Cabecera Promocional";
  if (s.includes("mostrador") || s.includes("balanza")) return "Mostrador";
  if (s.includes("fruver") || s.includes("fruta") || s.includes("verdura")) return "Fruver";
  if (s.includes("caja") || s.includes("check")) return "Zona de Cajas";
  return "Góndola Central";
}

function normalizarArea(raw?: string | null): AreaMueble {
  const s = (raw || "").trim().toLowerCase();
  if (s.includes("lácteo") || s.includes("lacteo") || s.includes("refrigerad")) return "Lácteos";
  if (s.includes("carnic") || s.includes("carne") || s.includes("pollo")) return "Carnicería";
  if (s.includes("fiambr") || s.includes("queso") || s.includes("cecina")) return "Fiambrería";
  if (s.includes("panad") || s.includes("pastel")) return "Panadería";
  if (s.includes("fruta") || s.includes("verdura") || s.includes("fruver")) return "Frutas y Verduras";
  if (s.includes("congelad")) return "Congelados";
  if (s.includes("bebida") || s.includes("jugo") || s.includes("licor")) return "Bebidas";
  if (s.includes("limpieza") || s.includes("aseo")) return "Limpieza";
  if (s.includes("caja")) return "Cajas";
  return "Abarrotes";
}

function hidratarPatenteDeBD(p: Patente): MueblePlano {
  // Compatibilidad hacia atrás: registros antiguos guardaban grillas chicas (< 40),
  // mientras que el lienzo esquemático guarda unidades enteras directas (>= 40).
  const esEscalaAntigua = (p.ancho ?? 0) < 40 && (p.largo ?? 0) < 40;
  const rawX = p.coordenada_x ?? 3;
  const rawY = p.coordenada_y ?? 3;
  const rawW = p.ancho ?? 2;
  const rawH = p.largo ?? 2;

  const x = esEscalaAntigua ? Math.round(rawX * 40) : Math.round(rawX);
  const y = esEscalaAntigua ? Math.round(rawY * 40) : Math.round(rawY);
  const w = Math.max(60, esEscalaAntigua ? Math.round(rawW * 40) : Math.round(rawW));
  const h = Math.max(60, esEscalaAntigua ? Math.round(rawH * 40) : Math.round(rawH));

  const gridObj = p.submapeo_grid && typeof p.submapeo_grid === "object" ? p.submapeo_grid : null;
  const nombreGuardado =
    typeof gridObj?.nombre_display === "string" && gridObj.nombre_display.trim()
      ? gridObj.nombre_display.trim()
      : p.id_patente;

  return {
    id: p.id_patente,
    nombre: nombreGuardado,
    tipo: normalizarTipoMueble(p.tipo_mueble),
    area: normalizarArea(p.area_pasillo),
    x,
    y,
    w,
    h,
    rotacion: p.rotacion ?? 0,
    persistedInDb: true,
    productosAsignados: Array.isArray(p.productos_asignados) ? p.productos_asignados : [],
    submapeoGrid: gridObj,
  };
}

function generarIdUnico(prefix: string, existentes: Set<string>): { id: string; num: string } {
  const cleanPrefix = prefix.replace(/[^A-Z0-9_-]/gi, "").toUpperCase() || "MUEB";
  let n = 1;
  while (n < 9999) {
    const num = n.toString().padStart(2, "0");
    const candidate = `${cleanPrefix}-${num}`;
    if (!existentes.has(candidate)) {
      return { id: candidate, num };
    }
    n++;
  }
  const fallbackNum = Date.now().toString().slice(-4);
  return { id: `${cleanPrefix}-${fallbackNum}`, num: fallbackNum };
}

// ─── Verificación de Solapamiento (AABB) ─────────────────────────────────────
function checkOverlap(
  candidate: { id: string; x: number; y: number; w: number; h: number },
  items: MueblePlano[]
): boolean {
  return items.some((other) => {
    if (other.id === candidate.id) return false;
    return !(
      candidate.x + candidate.w <= other.x ||
      candidate.x >= other.x + other.w ||
      candidate.y + candidate.h <= other.y ||
      candidate.y >= other.y + other.h
    );
  });
}

function getDraftStorageKey(): string {
  return `sg_bvc_plano_draft_${getActiveTenantId()}`;
}

export default function PatentesPage() {
  const [capaActiva, setCapaActiva] = useState<CapaVisual>("categorias");
  const [muebles, setMuebles] = useState<MueblePlano[]>([]);
  const [dbSnapshotMap, setDbSnapshotMap] = useState<Record<string, MueblePlano>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFefoDrawer, setShowFefoDrawer] = useState<boolean>(false);

  // ── Modo Edición y Construcción ──
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [muebleOriginalIdEdicion, setMuebleOriginalIdEdicion] = useState<string | null>(null);
  const [muebleEnEdicion, setMuebleEnEdicion] = useState<MueblePlano | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const [isSavingBD, setIsSavingBD] = useState<boolean>(false);
  const [isLoadingDB, setIsLoadingDB] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Datos Operativos Reales del Backend ──
  const [complianceMap, setComplianceMap] = useState<Record<string, ComplianceResponse>>({});
  const [alertasFefo, setAlertasFefo] = useState<AlertaVencimientoItem[]>([]);
  const [stockBodegaReal, setStockBodegaReal] = useState<SatoDisponible[]>([]);
  const [catalogoMap, setCatalogoMap] = useState<Record<string, Producto>>({});
  const [abcResumen, setAbcResumen] = useState<AbcPlanoResumenResponse | null>(null);
  const [isRecalculandoAbc, setIsRecalculandoAbc] = useState<boolean>(false);

  // Stock FEFO vivo y reporte de discrepancia de la góndola seleccionada
  const [stockPatenteSeleccionada, setStockPatenteSeleccionada] = useState<StockItem[]>([]);
  const [isLoadingStockPatente, setIsLoadingStockPatente] = useState<boolean>(false);
  const [reponiendoSatoId, setReponiendoSatoId] = useState<string | null>(null);
  const [cantidadesReponer, setCantidadesReponer] = useState<Record<string, number>>({});
  const [discrepanciaSkuSelect, setDiscrepanciaSkuSelect] = useState<string>("");
  const [discrepanciaSkuManual, setDiscrepanciaSkuManual] = useState<string>("");
  const [discrepanciaDetalles, setDiscrepanciaDetalles] = useState<string>("");
  const [isReportingDiscrepancia, setIsReportingDiscrepancia] = useState<boolean>(false);

  // Merma Rápida en Góndola (3 Toques - Etapa 2 RF-01)
  const [mermaGondolaSku, setMermaGondolaSku] = useState<string>("");
  const [mermaGondolaCant, setMermaGondolaCant] = useState<number>(1);
  const [mermaGondolaMotivo, setMermaGondolaMotivo] = useState<string>("VENCIDO");
  const [isReportingMermaGondola, setIsReportingMermaGondola] = useState<boolean>(false);

  // ── Arrastre y Redimensionamiento ──
  const [draggingGondolaId, setDraggingGondolaId] = useState<string | null>(null);
  const [collisionActive, setCollisionActive] = useState<boolean>(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gondolaDragRef = useRef({
    offsetX: 0,
    offsetY: 0,
    initialX: 0,
    initialY: 0,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    captured: false,
  });

  const [resizingState, setResizingState] = useState<{
    id: string;
    handle: "e" | "s" | "se";
    startX: number;
    startY: number;
    initialW: number;
    initialH: number;
    changed: boolean;
  } | null>(null);

  // ── Cámara Interactiva (Pan & Zoom) ──
  const [pos, setPos] = useState({ x: 80, y: 40 });
  const [scale, setScale] = useState(1);
  const [isCameraDragging, setIsCameraDragging] = useState(false);
  const cameraDragStart = useRef({
    x: 0,
    y: 0,
    startClientX: 0,
    startClientY: 0,
    captured: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const muebleSeleccionado = useMemo(
    () => (selectedId ? muebles.find((m) => m.id === selectedId) || null : null),
    [muebles, selectedId]
  );

  const mostrarToast = useCallback((text: string, tone: "ok" | "warn" | "err" = "ok") => {
    setToast({ text, tone });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const limpiarBorradorTenant = useCallback(() => {
    try {
      localStorage.removeItem(getDraftStorageKey());
      // Limpiar clave antigua global sin tenant para evitar fugas residuales
      localStorage.removeItem("sg_bvc_plano_v4_clean");
    } catch {}
  }, []);

  // Persistencia de borrador aislada por Tenant mientras existan cambios sin guardar
  const guardarBorradorTenant = useCallback(
    (nextMuebles: MueblePlano[], nextDeletes: string[]) => {
      setMuebles(nextMuebles);
      setPendingDeleteIds(nextDeletes);

      const snapshotIds = Object.keys(dbSnapshotMap);
      const hayCambios =
        nextDeletes.length > 0 ||
        nextMuebles.length !== snapshotIds.length ||
        nextMuebles.some((m) => {
          if (!m.persistedInDb) return true;
          const orig = dbSnapshotMap[m.id];
          if (!orig) return true;
          return (
            orig.x !== m.x ||
            orig.y !== m.y ||
            orig.w !== m.w ||
            orig.h !== m.h ||
            orig.rotacion !== m.rotacion ||
            orig.nombre !== m.nombre ||
            orig.tipo !== m.tipo ||
            orig.area !== m.area
          );
        });

      setHasUnsavedChanges(hayCambios);
      if (hayCambios) {
        try {
          localStorage.setItem(
            getDraftStorageKey(),
            JSON.stringify({ muebles: nextMuebles, pendingDeleteIds: nextDeletes })
          );
        } catch {}
      } else {
        limpiarBorradorTenant();
      }
    },
    [dbSnapshotMap, limpiarBorradorTenant]
  );

  // Proteger cierre accidental de pestaña si hay cambios sin guardar
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  // Listener nativo no pasivo para zoom con rueda sin warnings en consola
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      setScale((prevScale) => {
        const nextScale = Math.min(2.5, Math.max(0.35, prevScale * zoomFactor));
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        setPos((prevPos) => ({
          x: mouseX - (mouseX - prevPos.x) * (nextScale / prevScale),
          y: mouseY - (mouseY - prevPos.y) * (nextScale / prevScale),
        }));
        return nextScale;
      });
    };

    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  // ── Carga Integral de Datos Reales del Backend ──
  const refrescarDatosOperativos = useCallback(async () => {
    const [comp, alertas, bodega, productos, zonasAbc] = await Promise.all([
      getComplianceBatch(),
      getAlertasVencimiento(7),
      getSatosDisponibles(),
      getProductos(),
      getZonasAbcPatentes(),
    ]);
    setComplianceMap(comp || {});
    setAlertasFefo(alertas || []);
    setStockBodegaReal(bodega || []);
    setAbcResumen(zonasAbc || null);
    const prodDict: Record<string, Producto> = {};
    for (const prod of productos || []) {
      prodDict[prod.sku] = prod;
    }
    setCatalogoMap(prodDict);
  }, []);

  const cargarTodoDesdeServidor = useCallback(async () => {
    setIsLoadingDB(true);
    setLoadError(null);
    try {
      const dataPatentes = await getPatentesStrict();
      const patentesSala = (dataPatentes || []).filter(
        (p) => (p.tipo_ubicacion || "SALA_VENTA") === "SALA_VENTA"
      );
      const hidratados = patentesSala.map(hidratarPatenteDeBD);

      const snapshot: Record<string, MueblePlano> = {};
      for (const m of hidratados) {
        snapshot[m.id] = m;
      }
      setDbSnapshotMap(snapshot);

      // Verificar si hay un borrador sin guardar de este mismo tenant
      let restauradoDeDraft = false;
      try {
        const rawDraft = localStorage.getItem(getDraftStorageKey());
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft);
          if (parsed && Array.isArray(parsed.muebles)) {
            setMuebles(parsed.muebles);
            setPendingDeleteIds(Array.isArray(parsed.pendingDeleteIds) ? parsed.pendingDeleteIds : []);
            setHasUnsavedChanges(true);
            restauradoDeDraft = true;
          }
        }
      } catch {}

      if (!restauradoDeDraft) {
        setMuebles(hidratados);
        setPendingDeleteIds([]);
        setHasUnsavedChanges(false);
      }

      await refrescarDatosOperativos();
    } catch (err: any) {
      setLoadError(err?.message || "No se pudo conectar con el servidor backend.");
    } finally {
      setIsLoadingDB(false);
    }
  }, [refrescarDatosOperativos]);

  useEffect(() => {
    cargarTodoDesdeServidor();
  }, [cargarTodoDesdeServidor]);

  // Cargar lotes FEFO reales al seleccionar una góndola en modo operativo
  const cargarStockGondola = useCallback(async (idPatente: string, persisted: boolean) => {
    if (!persisted) {
      setStockPatenteSeleccionada([]);
      return;
    }
    setIsLoadingStockPatente(true);
    try {
      const items = await getStockPatente(idPatente);
      setStockPatenteSeleccionada(items || []);
    } finally {
      setIsLoadingStockPatente(false);
    }
  }, []);

  useEffect(() => {
    if (muebleSeleccionado && !isEditMode) {
      cargarStockGondola(muebleSeleccionado.id, muebleSeleccionado.persistedInDb);
    }
  }, [muebleSeleccionado, isEditMode, cargarStockGondola]);

  // ── Guardar Layout Real en PostgreSQL (Incluye Altas, Cambios y Eliminaciones) ──
  const handleGuardarEnPostgreSQL = async () => {
    setIsSavingBD(true);
    const errores: string[] = [];
    const eliminadosExitosos = new Set<string>();
    const restaurarPorBloqueo: MueblePlano[] = [];

    try {
      // 1. Procesar eliminaciones pendientes en BD
      for (const delId of pendingDeleteIds) {
        try {
          await deletePatente(delId);
          eliminadosExitosos.add(delId);
        } catch (err: any) {
          if (err instanceof ApiHttpError && err.status === 404) {
            eliminadosExitosos.add(delId);
          } else {
            errores.push(`Eliminar ${delId}: ${err?.message || "Error"}`);
            if (dbSnapshotMap[delId]) {
              restaurarPorBloqueo.push(dbSnapshotMap[delId]);
            }
          }
        }
      }

      // 2. Procesar creaciones y actualizaciones con coordenadas enteras
      const mueblesActualizados: MueblePlano[] = [...restaurarPorBloqueo];
      for (const m of muebles) {
        const xInt = Math.round(m.x);
        const yInt = Math.round(m.y);
        const wInt = Math.max(40, Math.round(m.w));
        const hInt = Math.max(40, Math.round(m.h));
        const nextSubmap = {
          ...(m.submapeoGrid || {}),
          nombre_display: m.nombre.trim() || m.id,
        };

        const updatePayload = {
          area_pasillo: m.area,
          tipo_mueble: m.tipo,
          tipo_ubicacion: "SALA_VENTA",
          coordenada_x: xInt,
          coordenada_y: yInt,
          ancho: wInt,
          largo: hInt,
          rotacion: m.rotacion || 0,
          productos_asignados: m.productosAsignados,
          submapeo_grid: nextSubmap,
        };

        try {
          if (m.persistedInDb) {
            await updatePatenteSafe(m.id, updatePayload);
          } else {
            try {
              await createPatente({ id_patente: m.id, ...updatePayload });
            } catch (createErr: any) {
              if (createErr instanceof ApiHttpError && createErr.status === 400) {
                await updatePatenteSafe(m.id, updatePayload);
              } else {
                throw createErr;
              }
            }
          }
          mueblesActualizados.push({
            ...m,
            x: xInt,
            y: yInt,
            w: wInt,
            h: hInt,
            persistedInDb: true,
            submapeoGrid: nextSubmap,
          });
        } catch (err: any) {
          if (m.persistedInDb && err instanceof ApiHttpError && err.status === 404) {
            try {
              await createPatente({ id_patente: m.id, ...updatePayload });
              mueblesActualizados.push({
                ...m,
                x: xInt,
                y: yInt,
                w: wInt,
                h: hInt,
                persistedInDb: true,
                submapeoGrid: nextSubmap,
              });
              continue;
            } catch (innerErr: any) {
              errores.push(`${m.id}: ${innerErr?.message || "Error al crear"}`);
              mueblesActualizados.push(m);
              continue;
            }
          }
          errores.push(`${m.id}: ${err?.message || "Error al guardar"}`);
          mueblesActualizados.push(m);
        }
      }

      const remainingDeletes = pendingDeleteIds.filter(
        (id) => !eliminadosExitosos.has(id) && !restaurarPorBloqueo.some((r) => r.id === id)
      );

      setMuebles(mueblesActualizados);
      setPendingDeleteIds(remainingDeletes);

      const newSnapshot: Record<string, MueblePlano> = {};
      for (const item of mueblesActualizados) {
        if (item.persistedInDb) newSnapshot[item.id] = item;
      }
      setDbSnapshotMap(newSnapshot);

      if (errores.length === 0) {
        setHasUnsavedChanges(false);
        limpiarBorradorTenant();
        mostrarToast("Plano sincronizado con PostgreSQL correctamente.", "ok");
      } else {
        setHasUnsavedChanges(true);
        mostrarToast(`Atención: ${errores[0]}`, "err");
      }

      await refrescarDatosOperativos();
    } finally {
      setIsSavingBD(false);
    }
  };

  // ── Contorno Esquemático Auto-Expandible (Sin metros ni m²) ──
  const limitesRecinto = useMemo(() => {
    let maxX = 760;
    let maxY = 560;
    for (const m of muebles) {
      if (m.x + m.w + 80 > maxX) maxX = m.x + m.w + 80;
      if (m.y + m.h + 80 > maxY) maxY = m.y + m.h + 80;
    }
    const w = Math.ceil(maxX / 40) * 40;
    const h = Math.ceil(maxY / 40) * 40;
    return {
      x: 60,
      y: 60,
      w: w - 60,
      h: h - 60,
      canvasW: Math.max(2400, w + 400),
      canvasH: Math.max(1800, h + 400),
    };
  }, [muebles]);

  // ── Centrar Encuadrando los Muebles Reales (Fit-to-Content) ──
  const handleCentrarPlano = useCallback(() => {
    const el = containerRef.current;
    if (!el || muebles.length === 0) {
      setPos({ x: 80, y: 40 });
      setScale(1);
      return;
    }
    const rect = el.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of muebles) {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.w);
      maxY = Math.max(maxY, m.y + m.h);
    }
    const contentW = Math.max(200, maxX - minX + 160);
    const contentH = Math.max(200, maxY - minY + 160);
    const fitScale = Math.min(1.25, Math.max(0.45, Math.min(rect.width / contentW, rect.height / contentH)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setScale(fitScale);
    setPos({
      x: Math.round(rect.width / 2 - centerX * fitScale),
      y: Math.round(rect.height / 2 - centerY * fitScale),
    });
  }, [muebles]);

  // ── Alertas FEFO Agrupadas por Góndola ──
  const alertasPorPatente = useMemo(() => {
    const map: Record<string, { vencidos: number; proximos: number; skus: Set<string> }> = {};
    for (const a of alertasFefo) {
      if (a.estado !== "Vitrina" || !a.ubicacion_id) continue;
      if (!map[a.ubicacion_id]) {
        map[a.ubicacion_id] = { vencidos: 0, proximos: 0, skus: new Set() };
      }
      map[a.ubicacion_id].skus.add(a.sku);
      if (a.dias_restantes < 0) {
        map[a.ubicacion_id].vencidos += 1;
      } else {
        map[a.ubicacion_id].proximos += 1;
      }
    }
    return map;
  }, [alertasFefo]);

  // ── KPIs Operativos Accionables ──
  const stats = useMemo(() => {
    const unidadesBodega = stockBodegaReal.reduce((acc, s) => acc + (s.cantidad || 0), 0);
    let unidadesVitrina = 0;
    let gondolasConQuiebre = 0;

    for (const m of muebles) {
      if (m.tipo === "Zona de Cajas" || m.area === "Cajas") continue;
      const comp = complianceMap[m.id];
      if (!comp) continue;
      unidadesVitrina += comp.stock_total ?? 0;

      const skusAsignados = comp.skus_asignados_count ?? m.productosAsignados.length;
      const skusConStock = comp.skus_con_stock_count ?? 0;
      const tieneDiscrepanciaFalta = (comp.discrepancias || []).some(
        (d) => d.toLowerCase().includes("agotado") || d.toLowerCase().includes("falta")
      );
      if (skusAsignados > 0 && (skusConStock < skusAsignados || tieneDiscrepanciaFalta || (comp.stock_total ?? 0) === 0)) {
        gondolasConQuiebre += 1;
      }
    }

    const lotesVencidos = alertasFefo.filter((a) => a.dias_restantes < 0).length;
    const lotesProximos = alertasFefo.filter((a) => a.dias_restantes >= 0).length;

    return {
      unidadesVitrina,
      unidadesBodega,
      gondolasConQuiebre,
      lotesVencidos,
      lotesProximos,
    };
  }, [muebles, complianceMap, stockBodegaReal, alertasFefo]);

  // ── Buscador Inteligente con Atenuación (ID, Nombre, Área, SKU, Producto o EAN) ──
  const matchingIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const matched = new Set<string>();

    for (const m of muebles) {
      if (
        m.id.toLowerCase().includes(q) ||
        m.nombre.toLowerCase().includes(q) ||
        m.area.toLowerCase().includes(q) ||
        m.tipo.toLowerCase().includes(q)
      ) {
        matched.add(m.id);
        continue;
      }

      // Buscar dentro de los SKUs asignados o presentes en alertas/compliance
      const skusMueble = new Set<string>(m.productosAsignados);
      if (m.submapeoGrid && Array.isArray(m.submapeoGrid.celdas)) {
        for (const c of m.submapeoGrid.celdas) {
          if (c?.sku_asignado) skusMueble.add(c.sku_asignado);
        }
      }
      const alertaInfo = alertasPorPatente[m.id];
      if (alertaInfo) {
        alertaInfo.skus.forEach((s) => skusMueble.add(s));
      }

      for (const sku of Array.from(skusMueble)) {
        if (sku.toLowerCase().includes(q)) {
          matched.add(m.id);
          break;
        }
        const prod = catalogoMap[sku];
        if (
          prod &&
          (prod.nombre?.toLowerCase().includes(q) ||
            prod.ean?.toLowerCase().includes(q) ||
            prod.familia?.toLowerCase().includes(q))
        ) {
          matched.add(m.id);
          break;
        }
      }
    }
    return matched;
  }, [muebles, searchQuery, catalogoMap, alertasPorPatente]);

  // Áreas activas en el plano para mostrar leyenda compacta en capa Categorías
  const areasActivasEnPlano = useMemo(() => {
    const set = new Set<AreaMueble>();
    muebles.forEach((m) => set.add(m.area));
    return Array.from(set);
  }, [muebles]);

  // Lotes disponibles en bodega compatibles con el surtido de la góndola seleccionada
  const lotesBodegaParaSeleccionada = useMemo(() => {
    if (!muebleSeleccionado) return [];
    const skusPermitidos = new Set<string>(muebleSeleccionado.productosAsignados);
    if (muebleSeleccionado.submapeoGrid && Array.isArray(muebleSeleccionado.submapeoGrid.celdas)) {
      for (const c of muebleSeleccionado.submapeoGrid.celdas) {
        if (c?.sku_asignado) skusPermitidos.add(c.sku_asignado);
      }
    }
    if (skusPermitidos.size === 0) return [];

    return stockBodegaReal.filter(
      (s) =>
        skusPermitidos.has(s.sku) &&
        s.cantidad > 0 &&
        s.estado_vencimiento !== "VENCIDO" &&
        (s.dias_restantes === undefined || s.dias_restantes === null || s.dias_restantes >= 0)
    );
  }, [muebleSeleccionado, stockBodegaReal]);

  // ── Abastecer Góndola desde Bodega (FEFO Real) ──
  const handleAbastecerDesdeBodega = async (sato: SatoDisponible) => {
    if (!muebleSeleccionado || !muebleSeleccionado.persistedInDb) return;
    const cantSolicitada = cantidadesReponer[sato.sato_id] ?? sato.cantidad;
    if (cantSolicitada <= 0 || cantSolicitada > sato.cantidad) {
      mostrarToast(`Ingresa una cantidad entre 1 y ${sato.cantidad}.`, "warn");
      return;
    }

    // Buscar nivel/frente sugerido si tiene micro-slotting
    let nivel = 1;
    let frente = 1;
    if (muebleSeleccionado.submapeoGrid && Array.isArray(muebleSeleccionado.submapeoGrid.celdas)) {
      const celdaMatch = muebleSeleccionado.submapeoGrid.celdas.find(
        (c: any) => c?.sku_asignado === sato.sku && Array.isArray(c?.coordenadas)
      );
      if (celdaMatch) {
        nivel = (celdaMatch.coordenadas[0] ?? 0) + 1;
        frente = (celdaMatch.coordenadas[1] ?? 0) + 1;
      }
    }

    setReponiendoSatoId(sato.sato_id);
    try {
      await moverSatoAVitrina(sato.sato_id, muebleSeleccionado.id, nivel, frente, cantSolicitada);
      mostrarToast(`Abastecidas ${cantSolicitada} und de ${sato.sku} en ${muebleSeleccionado.id}.`, "ok");
      await Promise.all([
        cargarStockGondola(muebleSeleccionado.id, true),
        refrescarDatosOperativos(),
      ]);
    } catch (err: any) {
      mostrarToast(err?.message || "No se pudo mover el lote a vitrina.", "err");
      await refrescarDatosOperativos();
    } finally {
      setReponiendoSatoId(null);
    }
  };

  // ── Recalcular Motor ABC y Reportar Discrepancia de Vitrina ──
  const handleRecalcularAbc = async () => {
    setIsRecalculandoAbc(true);
    try {
      const res = await recalcularAbc();
      mostrarToast(
        `ABC recalculado (${res.ventana_w_dias}d): ${res.clase_a_count} A · ${res.clase_b_count} B · ${res.clase_c_count} C.`,
        "ok"
      );
      await refrescarDatosOperativos();
    } catch (err: any) {
      mostrarToast(err?.message || "No se pudo recalcular la clasificación ABC.", "err");
    } finally {
      setIsRecalculandoAbc(false);
    }
  };

  useEffect(() => {
    setDiscrepanciaSkuSelect("");
    setDiscrepanciaSkuManual("");
    setDiscrepanciaDetalles("");
  }, [selectedId]);

  const skusCandidatosDiscrepancia = useMemo(() => {
    if (!muebleSeleccionado) return [];
    const seen = new Set<string>();
    const result: Array<{ sku: string; nombre: string }> = [];
    const pushSku = (rawSku?: string | null, rawNombre?: string | null) => {
      const clean = (rawSku || "").trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      const nombre =
        (rawNombre && rawNombre.trim()) ||
        catalogoMap[clean]?.nombre ||
        clean;
      result.push({ sku: clean, nombre });
    };

    for (const s of muebleSeleccionado.productosAsignados) {
      pushSku(s);
    }
    if (muebleSeleccionado.submapeoGrid && Array.isArray(muebleSeleccionado.submapeoGrid.celdas)) {
      for (const c of muebleSeleccionado.submapeoGrid.celdas) {
        if (c?.sku_asignado) pushSku(c.sku_asignado);
      }
    }
    const abcPat = abcResumen?.patentes?.[muebleSeleccionado.id];
    if (abcPat?.top_skus) {
      for (const t of abcPat.top_skus) {
        pushSku(t.sku, t.nombre);
      }
    }
    for (const st of stockPatenteSeleccionada) {
      pushSku(st.sku, st.nombre_producto);
    }
    return result;
  }, [muebleSeleccionado, catalogoMap, abcResumen, stockPatenteSeleccionada]);

  const effectiveDiscrepanciaMode =
    skusCandidatosDiscrepancia.length === 0
      ? "__MANUAL__"
      : discrepanciaSkuSelect === "__MANUAL__"
      ? "__MANUAL__"
      : skusCandidatosDiscrepancia.some((c) => c.sku === discrepanciaSkuSelect)
      ? discrepanciaSkuSelect
      : skusCandidatosDiscrepancia[0].sku;

  const handleReportarDiscrepanciaVitrina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!muebleSeleccionado || !muebleSeleccionado.persistedInDb) return;
    const skuFinal =
      effectiveDiscrepanciaMode === "__MANUAL__"
        ? discrepanciaSkuManual.trim().toUpperCase()
        : effectiveDiscrepanciaMode.trim();
    if (!skuFinal) {
      mostrarToast("Selecciona o ingresa un SKU para reportar la discrepancia.", "warn");
      return;
    }

    setIsReportingDiscrepancia(true);
    try {
      const anom = await reportarDiscrepanciaVitrina({
        sku: skuFinal,
        ubicacion_id: muebleSeleccionado.id,
        detalles: discrepanciaDetalles.trim() || undefined,
      });
      mostrarToast(
        `Discrepancia registrada (${anom.sku} en ${muebleSeleccionado.id}) → Conteo por Excepción.`,
        "ok"
      );
      setDiscrepanciaDetalles("");
      setDiscrepanciaSkuManual("");
      await refrescarDatosOperativos();
    } catch (err: any) {
      mostrarToast(err?.message || "No se pudo registrar la discrepancia en vitrina.", "err");
    } finally {
      setIsReportingDiscrepancia(false);
    }
  };

  const handleMermaRapidaGondola = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!muebleSeleccionado || !muebleSeleccionado.persistedInDb) return;
    const skuTarget = (
      mermaGondolaSku ||
      stockPatenteSeleccionada[0]?.sku ||
      skusCandidatosDiscrepancia[0]?.sku ||
      ""
    ).trim();
    if (!skuTarget) {
      mostrarToast("Selecciona un SKU con stock en esta góndola para mermar.", "warn");
      return;
    }
    if (!mermaGondolaCant || mermaGondolaCant <= 0) {
      mostrarToast("Ingresa una cantidad mayor a 0.", "warn");
      return;
    }

    setIsReportingMermaGondola(true);
    try {
      const res = await declararMermaRapida({
        sku: skuTarget,
        cantidad: Number(mermaGondolaCant),
        motivo: mermaGondolaMotivo,
        origen: "VITRINA",
        ubicacion_id: muebleSeleccionado.id,
      });
      mostrarToast(
        `Merma aplicada: -${res.cantidad_registrada} ${res.sku} ($${res.valor_merma_clp.toLocaleString("es-CL")} CLP).`,
        "ok"
      );
      setMermaGondolaCant(1);
      await Promise.all([
        cargarStockGondola(muebleSeleccionado.id, true),
        refrescarDatosOperativos(),
      ]);
    } catch (err: any) {
      mostrarToast(err?.message || "No se pudo registrar la merma en góndola.", "err");
    } finally {
      setIsReportingMermaGondola(false);
    }
  };

  // Salvaguarda global para liberar estados de arrastre si el puntero sale de la ventana
  useEffect(() => {
    if (!isCameraDragging && !draggingGondolaId && !resizingState) return;
    const resetInteractions = () => {
      setIsCameraDragging(false);
      setDraggingGondolaId(null);
      setResizingState(null);
      setCollisionActive(false);
    };
    window.addEventListener("blur", resetInteractions);
    return () => window.removeEventListener("blur", resetInteractions);
  }, [isCameraDragging, draggingGondolaId, resizingState]);

  // ── Manejo de Puntero en Contenedor (Pan, Arrastre y Redimensionamiento) ──
  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    if (
      targetEl.closest(".gondola-card") ||
      targetEl.closest(".resize-handle") ||
      targetEl.closest(".gondola-toolbar") ||
      targetEl.closest(".no-canvas-drag") ||
      targetEl.closest("button") ||
      targetEl.closest("input") ||
      targetEl.closest("select") ||
      targetEl.closest("a")
    ) {
      return;
    }
    setShowAddMenu(false);
    setIsCameraDragging(true);
    cameraDragStart.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      captured: false,
    };
  };

  const handleContainerPointerMove = (e: React.PointerEvent) => {
    if (isCameraDragging) {
      const dist = Math.hypot(
        e.clientX - cameraDragStart.current.startClientX,
        e.clientY - cameraDragStart.current.startClientY
      );
      if (dist < 3 && !cameraDragStart.current.captured) return;
      if (!cameraDragStart.current.captured) {
        try {
          containerRef.current?.setPointerCapture(e.pointerId);
          cameraDragStart.current.captured = true;
        } catch {}
      }
      setPos({
        x: e.clientX - cameraDragStart.current.x,
        y: e.clientY - cameraDragStart.current.y,
      });
      return;
    }

    if (resizingState && isEditMode) {
      const mouseXInCanvas = (e.clientX - pos.x) / scale;
      const mouseYInCanvas = (e.clientY - pos.y) / scale;
      const deltaX = mouseXInCanvas - resizingState.startX;
      const deltaY = mouseYInCanvas - resizingState.startY;

      const target = muebles.find((m) => m.id === resizingState.id);
      if (!target) return;

      let candidateW = target.w;
      let candidateH = target.h;

      if (resizingState.handle === "e" || resizingState.handle === "se") {
        candidateW = Math.max(60, Math.round((resizingState.initialW + deltaX) / 20) * 20);
      }
      if (resizingState.handle === "s" || resizingState.handle === "se") {
        candidateH = Math.max(60, Math.round((resizingState.initialH + deltaY) / 20) * 20);
      }

      if (candidateW === target.w && candidateH === target.h) return;

      const candidateObj = { ...target, w: candidateW, h: candidateH };
      if (!checkOverlap(candidateObj, muebles)) {
        setResizingState((prev) => (prev ? { ...prev, changed: true } : null));
        setMuebles((prev) =>
          prev.map((m) => (m.id === resizingState.id ? { ...m, w: candidateW, h: candidateH } : m))
        );
      }
      return;
    }

    if (draggingGondolaId && isEditMode) {
      const dist = Math.hypot(
        e.clientX - gondolaDragRef.current.startClientX,
        e.clientY - gondolaDragRef.current.startClientY
      );
      if (dist < 4 && !gondolaDragRef.current.moved) return;

      if (!gondolaDragRef.current.captured) {
        try {
          containerRef.current?.setPointerCapture(e.pointerId);
          gondolaDragRef.current.captured = true;
        } catch {}
      }

      const mouseXInCanvas = (e.clientX - pos.x) / scale;
      const mouseYInCanvas = (e.clientY - pos.y) / scale;

      const rawX = mouseXInCanvas - gondolaDragRef.current.offsetX;
      const rawY = mouseYInCanvas - gondolaDragRef.current.offsetY;
      const snappedX = Math.max(60, Math.round(rawX / 20) * 20);
      const snappedY = Math.max(60, Math.round(rawY / 20) * 20);

      const target = muebles.find((m) => m.id === draggingGondolaId);
      if (!target) return;
      if (snappedX === target.x && snappedY === target.y) return;

      gondolaDragRef.current.moved = true;
      const candidate = { ...target, x: snappedX, y: snappedY };
      const isColliding = checkOverlap(candidate, muebles);
      setCollisionActive(isColliding);

      setMuebles((prev) =>
        prev.map((m) => (m.id === draggingGondolaId ? candidate : m))
      );
    }
  };

  const handleContainerPointerUp = (e: React.PointerEvent) => {
    try {
      const el = containerRef.current;
      if (el && el.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (isCameraDragging) {
      cameraDragStart.current.captured = false;
      setIsCameraDragging(false);
    }

    if (resizingState) {
      if (resizingState.changed) {
        guardarBorradorTenant(muebles, pendingDeleteIds);
      }
      setResizingState(null);
    }

    if (draggingGondolaId) {
      const target = muebles.find((m) => m.id === draggingGondolaId);
      if (target && collisionActive) {
        const reverted = muebles.map((m) =>
          m.id === draggingGondolaId
            ? { ...m, x: gondolaDragRef.current.initialX, y: gondolaDragRef.current.initialY }
            : m
        );
        setMuebles(reverted);
        mostrarToast("Solapamiento bloqueado: los muebles no pueden superponerse.", "warn");
      } else if (gondolaDragRef.current.moved) {
        guardarBorradorTenant(muebles, pendingDeleteIds);
      }

      gondolaDragRef.current.captured = false;
      setDraggingGondolaId(null);
      setCollisionActive(false);
    }
  };

  const handleGondolaPointerDown = (e: React.PointerEvent, mueble: MueblePlano) => {
    if (e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    if (
      targetEl.closest(".gondola-toolbar") ||
      targetEl.closest(".resize-handle") ||
      targetEl.closest(".no-canvas-drag") ||
      targetEl.closest("button")
    ) {
      return;
    }

    e.stopPropagation();
    setSelectedId(mueble.id);
    setShowFefoDrawer(false);
    setShowAddMenu(false);

    if (!isEditMode) return;

    setDraggingGondolaId(mueble.id);
    setCollisionActive(false);

    const mouseXInCanvas = (e.clientX - pos.x) / scale;
    const mouseYInCanvas = (e.clientY - pos.y) / scale;

    gondolaDragRef.current = {
      offsetX: mouseXInCanvas - mueble.x,
      offsetY: mouseYInCanvas - mueble.y,
      initialX: mueble.x,
      initialY: mueble.y,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      captured: false,
    };
  };

  const handleResizeStart = (e: React.PointerEvent, id: string, handle: "e" | "s" | "se") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = muebles.find((m) => m.id === id);
    if (!target) return;

    const mouseXInCanvas = (e.clientX - pos.x) / scale;
    const mouseYInCanvas = (e.clientY - pos.y) / scale;

    setResizingState({
      id,
      handle,
      startX: mouseXInCanvas,
      startY: mouseYInCanvas,
      initialW: target.w,
      initialH: target.h,
      changed: false,
    });

    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {}
  };

  // ── Herramientas de Construcción y Edición (Intactas y Robustas) ──
  const handleRotarGondola = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDraggingGondolaId(null);
    let changed = false;
    let appliedRot = 0;

    const updated = muebles.map((m) => {
      if (m.id !== id) return m;
      const nextRot = (m.rotacion + 90) % 360;
      const nextW = m.h;
      const nextH = m.w;
      const centerX = m.x + m.w / 2;
      const centerY = m.y + m.h / 2;
      const centeredX = Math.max(60, Math.round((centerX - nextW / 2) / 20) * 20);
      const centeredY = Math.max(60, Math.round((centerY - nextH / 2) / 20) * 20);

      const centeredCandidate: MueblePlano = {
        ...m,
        x: centeredX,
        y: centeredY,
        w: nextW,
        h: nextH,
        rotacion: nextRot,
      };

      if (!checkOverlap(centeredCandidate, muebles)) {
        changed = true;
        appliedRot = nextRot;
        return centeredCandidate;
      }

      const topLeftCandidate: MueblePlano = {
        ...m,
        w: nextW,
        h: nextH,
        rotacion: nextRot,
      };

      if (!checkOverlap(topLeftCandidate, muebles)) {
        changed = true;
        appliedRot = nextRot;
        return topLeftCandidate;
      }

      mostrarToast("No se puede rotar: colisiona con un mueble vecino.", "warn");
      return m;
    });

    if (changed) {
      guardarBorradorTenant(updated, pendingDeleteIds);
      mostrarToast(`${id} rotado a ${appliedRot}°.`, "ok");
    }
  };

  const handleDuplicarGondola = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDraggingGondolaId(null);
    const target = muebles.find((m) => m.id === id);
    if (!target) return;

    const existentes = new Set<string>([...muebles.map((m) => m.id), ...pendingDeleteIds]);
    const prefix = PREFIX_POR_TIPO[target.tipo] || "GOND";
    const { id: newId, num } = generarIdUnico(prefix, existentes);

    const candidate: MueblePlano = {
      ...target,
      id: newId,
      nombre: `${target.tipo} ${num}`,
      x: target.x + target.w + 20,
      y: target.y,
      persistedInDb: false,
      productosAsignados: [],
      submapeoGrid: null,
    };

    if (checkOverlap(candidate, muebles)) {
      candidate.x = target.x;
      candidate.y = target.y + target.h + 20;
    }

    let attempts = 0;
    while (checkOverlap(candidate, muebles) && attempts < 25) {
      candidate.y += 40;
      attempts++;
    }

    const updated = [...muebles, candidate];
    guardarBorradorTenant(updated, pendingDeleteIds);
    setSelectedId(candidate.id);
    mostrarToast(`Mueble clonado como ${candidate.id}. Pulsa "Guardar en BD" para confirmar.`, "ok");
  };

  const handleEliminarGondola = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDraggingGondolaId(null);
    const target = muebles.find((m) => m.id === id);
    if (!target) return;

    const stockActivo = complianceMap[id]?.stock_total ?? 0;
    if (target.persistedInDb && stockActivo > 0) {
      mostrarToast(
        `No se puede eliminar ${id}: tiene ${stockActivo} unidades activas en vitrina.`,
        "err"
      );
      return;
    }

    // Si es un mueble recién añadido que aún no existe en PostgreSQL, eliminarlo de inmediato
    if (!target.persistedInDb) {
      const updated = muebles.filter((m) => m.id !== id);
      guardarBorradorTenant(updated, pendingDeleteIds);
      if (selectedId === id) setSelectedId(null);
      mostrarToast(`Mueble ${id} eliminado del plano.`, "ok");
      return;
    }

    // Si ya está persistido en PostgreSQL, pedir confirmación mediante modal propio (sin window.confirm)
    setConfirmDialog({
      title: `Eliminar ${id}`,
      description: `¿Quitar el mueble ${id} (${target.nombre}) del plano? Se eliminará definitivamente de PostgreSQL cuando pulses "Guardar en BD".`,
      confirmLabel: "Quitar del plano",
      onConfirm: () => {
        const updated = muebles.filter((m) => m.id !== id);
        const nextDeletes = pendingDeleteIds.includes(id)
          ? pendingDeleteIds
          : [...pendingDeleteIds, id];
        guardarBorradorTenant(updated, nextDeletes);
        if (selectedId === id) setSelectedId(null);
        setConfirmDialog(null);
        mostrarToast(`Mueble ${id} marcado para eliminar. Pulsa "Guardar en BD" para confirmar.`, "warn");
      },
    });
  };

  const handleAddPreset = (tipoStr: TipoMueble, areaStr: AreaMueble, w: number, h: number) => {
    const existentes = new Set<string>([...muebles.map((m) => m.id), ...pendingDeleteIds]);
    const prefix = PREFIX_POR_TIPO[tipoStr] || "MUEB";
    const { id, num } = generarIdUnico(prefix, existentes);

    const rect = containerRef.current?.getBoundingClientRect();
    const screenOffsetX = rect ? rect.width / 2 - (w * scale) / 2 : 280;
    const screenOffsetY = rect ? rect.height / 2 - (h * scale) / 2 : 180;
    const viewCenterX = (-pos.x + screenOffsetX) / scale;
    const viewCenterY = (-pos.y + screenOffsetY) / scale;
    const candidateX = Math.max(80, Math.round(viewCenterX / 20) * 20);
    const candidateY = Math.max(80, Math.round(viewCenterY / 20) * 20);

    const nuevo: MueblePlano = {
      id,
      nombre: `${tipoStr} ${num}`,
      tipo: tipoStr,
      area: areaStr,
      x: candidateX,
      y: candidateY,
      w,
      h,
      rotacion: 0,
      persistedInDb: false,
      productosAsignados: [],
      submapeoGrid: null,
    };

    let attempts = 0;
    while (checkOverlap(nuevo, muebles) && attempts < 30) {
      nuevo.y += 40;
      attempts++;
    }

    const updated = [...muebles, nuevo];
    guardarBorradorTenant(updated, pendingDeleteIds);
    setSelectedId(nuevo.id);
    setShowAddMenu(false);
    mostrarToast(`${tipoStr} (${id}) añadido al plano.`, "ok");
  };

  const abrirModalConfiguracion = (m: MueblePlano, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDraggingGondolaId(null);
    setResizingState(null);
    setMuebleOriginalIdEdicion(m.id);
    setMuebleEnEdicion({ ...m });
    setConfigError(null);
    setIsConfigModalOpen(true);
  };

  const handleGuardarConfigMueble = () => {
    if (!muebleEnEdicion || !muebleOriginalIdEdicion) return;
    const cleanId = muebleEnEdicion.id.trim().toUpperCase();
    const cleanNombre = muebleEnEdicion.nombre.trim();

    if (!cleanId || !VALID_ID_RE.test(cleanId)) {
      setConfigError("El código solo admite letras A-Z, números, guiones o puntos (sin espacios ni tildes).");
      return;
    }
    if (!cleanNombre) {
      setConfigError("Ingresa un nombre descriptivo para el mueble.");
      return;
    }

    const colisionId = muebles.some(
      (m) => m.id !== muebleOriginalIdEdicion && m.id.toUpperCase() === cleanId
    );
    if (colisionId) {
      setConfigError(`Ya existe otro mueble con el código ${cleanId}.`);
      return;
    }

    const actualizado: MueblePlano = {
      ...muebleEnEdicion,
      id: muebleEnEdicion.persistedInDb ? muebleOriginalIdEdicion : cleanId,
      nombre: cleanNombre,
    };

    const updated = muebles.map((m) => (m.id === muebleOriginalIdEdicion ? actualizado : m));
    guardarBorradorTenant(updated, pendingDeleteIds);
    setSelectedId(actualizado.id);
    setIsConfigModalOpen(false);
    mostrarToast("Propiedades actualizadas. Recuerda guardar en BD.", "ok");
  };

  const handleLimpiarPlano = () => {
    const conStock = muebles.filter(
      (m) => m.persistedInDb && (complianceMap[m.id]?.stock_total ?? 0) > 0
    );
    if (conStock.length > 0) {
      mostrarToast(
        `No se puede vaciar todo el plano: ${conStock.length} mueble(s) tienen stock activo en vitrina.`,
        "err"
      );
      return;
    }

    const hayPersistidos = muebles.some((m) => m.persistedInDb);
    setConfirmDialog({
      title: "Vaciar muebles del plano",
      description: hayPersistidos
        ? `¿Quitar los ${muebles.length} mueble(s) sin stock activo del plano? Deberás pulsar "Guardar en BD" para confirmar los cambios en PostgreSQL.`
        : `¿Quitar los ${muebles.length} mueble(s) en borrador del plano?`,
      confirmLabel: "Vaciar plano",
      onConfirm: () => {
        const idsABorrar = Array.from(
          new Set([
            ...pendingDeleteIds,
            ...muebles.filter((m) => m.persistedInDb).map((m) => m.id),
          ])
        );
        guardarBorradorTenant([], idsABorrar);
        setSelectedId(null);
        setConfirmDialog(null);
        mostrarToast(
          hayPersistidos
            ? "Plano vaciado en borrador. Pulsa 'Guardar en BD' para confirmar."
            : "Plano vaciado.",
          hayPersistidos ? "warn" : "ok"
        );
      },
    });
  };

  return (
    <div
      className="flex flex-col h-screen w-full overflow-hidden select-none text-slate-800 relative"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {/* ── TOAST DE NOTIFICACIÓN ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-semibold py-3 px-4 rounded-2xl shadow-2xl z-50 flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              toast.tone === "err"
                ? "bg-rose-500"
                : toast.tone === "warn"
                ? "bg-amber-400"
                : "bg-emerald-400"
            }`}
          />
          <span>{toast.text}</span>
        </div>
      )}

      {/* ── BANNER DE ERROR DE CONEXIÓN (SI FALLA LA API) ── */}
      {loadError && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-800 flex items-center justify-between z-30">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-rose-600 shrink-0" />
            <span className="font-semibold">Error al sincronizar con el servidor: {loadError}</span>
          </div>
          <button
            onClick={cargarTodoDesdeServidor}
            className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ── CABECERA PRINCIPAL: KPIs ACCIONABLES Y EDICIÓN ── */}
      <header className="bg-white/90 backdrop-blur-md border-b border-rose-100 px-6 py-4 z-20 shrink-0 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight">
                  Plano 2D Interactivo
                </h1>
                {hasUnsavedChanges && (
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700 shrink-0">
                    Cambios sin guardar
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Distribución optimizada del minimarket con consulta directa a góndolas y pasillos.
              </p>
            </div>
          </div>

          {/* KPIs Operativos Reales y Acciones de Construcción */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-2xl shadow-2xs">
              Sala: {stats.unidadesVitrina} • Bodega: {stats.unidadesBodega}
            </span>

            <button
              type="button"
              onClick={() => {
                setIsEditMode(false);
                setCapaActiva("stock");
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl border text-xs font-bold transition-colors shadow-2xs ${
                stats.gondolasConQuiebre > 0
                  ? "bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              title="Ver semáforo de abastecimiento en sala"
            >
              <AlertTriangle
                size={13}
                className={stats.gondolasConQuiebre > 0 ? "text-rose-600" : "text-emerald-600"}
              />
              <span>
                Quiebres: <strong className="text-slate-900">{stats.gondolasConQuiebre}</strong>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsEditMode(false);
                setCapaActiva("vencimientos");
                setShowFefoDrawer((v) => !v);
                setSelectedId(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl border text-xs font-bold transition-colors shadow-2xs ${
                stats.lotesVencidos > 0
                  ? "bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100"
                  : stats.lotesProximos > 0
                  ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              title="Abrir listado de lotes vencidos o próximos a vencer (≤ 7 días)"
            >
              <Flame
                size={13}
                className={
                  stats.lotesVencidos > 0
                    ? "text-rose-600"
                    : stats.lotesProximos > 0
                    ? "text-amber-600"
                    : "text-slate-400"
                }
              />
              <span>
                FEFO:{" "}
                <strong className="text-slate-900">{stats.lotesVencidos} venc.</strong> ·{" "}
                <strong className="text-amber-700">{stats.lotesProximos} ≤7d</strong>
              </span>
            </button>

            <button
              type="button"
              onClick={refrescarDatosOperativos}
              className="p-2 rounded-2xl bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors shadow-2xs"
              title="Refrescar stock y alertas FEFO"
            >
              <RefreshCw size={14} />
            </button>

            <button
              type="button"
              onClick={handleGuardarEnPostgreSQL}
              disabled={isSavingBD || !hasUnsavedChanges}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-bold transition-all shadow-md disabled:opacity-45 ${
                hasUnsavedChanges
                  ? "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 text-white shadow-rose-200 ring-2 ring-rose-300"
                  : "bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-rose-200"
              }`}
              title="Persistir cambios del plano en PostgreSQL"
            >
              <Save size={14} />
              <span>{isSavingBD ? "Guardando..." : "Guardar en BD"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextMode = !isEditMode;
                setIsEditMode(nextMode);
                setShowAddMenu(false);
                if (nextMode) {
                  setCapaActiva("categorias");
                  setShowFefoDrawer(false);
                }
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all border ${
                isEditMode
                  ? "bg-amber-500 border-amber-600 text-white shadow-md shadow-amber-200"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"
              }`}
            >
              {isEditMode ? <PencilOff size={14} /> : <Pencil size={14} />}
              <span>{isEditMode ? "Salir Edición" : "Modo Edición"}</span>
            </button>

            {isEditMode && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAddMenu((v) => !v)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-200"
                  >
                    <Plus size={14} />
                    <span>Añadir Mueble</span>
                  </button>

                  {showAddMenu && (
                    <div className="card-soft absolute right-0 top-full mt-2 w-64 rounded-2xl shadow-2xl p-2 z-50 flex flex-col gap-1 text-xs">
                      <div className="text-[10px] font-bold text-rose-600 px-2.5 py-1 uppercase tracking-wider">
                        Mobiliario de Sala
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Góndola Central", "Abarrotes", 240, 80)}
                        className="text-left px-3 py-2 text-slate-700 hover:bg-rose-50 hover:text-rose-700 font-semibold rounded-xl transition-colors"
                      >
                        Góndola Central (Abarrotes)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Cabecera Promocional", "Abarrotes", 80, 80)}
                        className="text-left px-3 py-2 text-slate-700 hover:bg-rose-50 hover:text-rose-700 font-semibold rounded-xl transition-colors"
                      >
                        Cabecera de Pasillo
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Vitrina Mural Frío", "Lácteos", 100, 240)}
                        className="text-left px-3 py-2 text-teal-700 hover:bg-teal-50 font-semibold rounded-xl transition-colors"
                      >
                        Vitrina Mural Refrigerada
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Isla Congelados", "Congelados", 120, 120)}
                        className="text-left px-3 py-2 text-sky-700 hover:bg-sky-50 font-semibold rounded-xl transition-colors"
                      >
                        Isla de Congelados
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Mostrador", "Panadería", 160, 80)}
                        className="text-left px-3 py-2 text-amber-700 hover:bg-amber-50 font-semibold rounded-xl transition-colors"
                      >
                        Mostrador / Atención
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Fruver", "Frutas y Verduras", 220, 80)}
                        className="text-left px-3 py-2 text-emerald-700 hover:bg-emerald-50 font-semibold rounded-xl transition-colors"
                      >
                        Módulo Frutas y Verduras
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddPreset("Zona de Cajas", "Cajas", 80, 120)}
                        className="text-left px-3 py-2 text-slate-600 hover:bg-slate-100 font-semibold rounded-xl border-t border-rose-100 transition-colors"
                      >
                        Zona de Cajas (Referencial)
                      </button>
                    </div>
                  )}
                </div>

                {muebles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleLimpiarPlano}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-2xl border border-rose-200 transition-colors"
                    title="Vaciar muebles sin stock activo"
                  >
                    Limpiar Plano
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── BARRA SECUNDARIA: FILTROS SUPERIORES LIMPIOS Y BUSCADOR ── */}
      <div className="px-6 pt-4 shrink-0 z-20">
        <div className="max-w-7xl mx-auto card-soft rounded-3xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            {!isEditMode && muebles.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCapaActiva("categorias")}
                  className={`px-4 py-2 rounded-2xl text-xs transition ${
                    capaActiva === "categorias"
                      ? "bg-rose-600 text-white font-bold shadow-sm"
                      : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold"
                  }`}
                >
                  Vista General
                </button>

                <button
                  type="button"
                  onClick={() => setCapaActiva("stock")}
                  className={`px-4 py-2 rounded-2xl text-xs transition ${
                    capaActiva === "stock"
                      ? "bg-rose-600 text-white font-bold shadow-sm"
                      : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold"
                  }`}
                >
                  Semáforo Stock
                </button>

                <button
                  type="button"
                  onClick={() => setCapaActiva("vencimientos")}
                  className={`px-4 py-2 rounded-2xl text-xs transition ${
                    capaActiva === "vencimientos"
                      ? "bg-rose-600 text-white font-bold shadow-sm"
                      : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold"
                  }`}
                >
                  Radar FEFO
                </button>

                <button
                  type="button"
                  onClick={() => setCapaActiva("abc")}
                  className={`px-4 py-2 rounded-2xl text-xs transition ${
                    capaActiva === "abc"
                      ? "bg-rose-600 text-white font-bold shadow-sm"
                      : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold"
                  }`}
                >
                  Rotación Ventas (ABC)
                </button>

                {capaActiva === "abc" && (
                  <button
                    type="button"
                    onClick={handleRecalcularAbc}
                    disabled={isRecalculandoAbc}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition disabled:opacity-50"
                    title="Actualizar cálculo de rotación según las últimas ventas"
                  >
                    <RefreshCw
                      size={12}
                      className={isRecalculandoAbc ? "animate-spin text-rose-600" : "text-rose-600"}
                    />
                    <span>{isRecalculandoAbc ? "Calculando..." : "Actualizar ABC"}</span>
                  </button>
                )}
              </div>
            )}

            {isEditMode && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-2xl">
                  Modo Edición activo: arrastra muebles, usa los tiradores ámbar para estirar y guarda en BD al terminar.
                </div>

                {muebleSeleccionado && (
                  <div className="flex items-center gap-1 bg-white border border-rose-200 px-2.5 py-1 rounded-2xl shadow-xs">
                    <span className="font-mono text-[11px] font-bold text-rose-600 px-1.5">
                      {muebleSeleccionado.id}
                    </span>
                    <div className="h-3.5 w-[1px] bg-rose-100 mx-0.5" />
                    <button
                      type="button"
                      onClick={(e) => handleRotarGondola(muebleSeleccionado.id, e)}
                      className="px-2 py-1 hover:bg-amber-50 text-amber-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold"
                      title="Rotar 90°"
                    >
                      <RotateCw size={13} /> Rotar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDuplicarGondola(muebleSeleccionado.id, e)}
                      className="px-2 py-1 hover:bg-emerald-50 text-emerald-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold"
                      title="Clonar mueble"
                    >
                      <Copy size={13} /> Clonar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => abrirModalConfiguracion(muebleSeleccionado, e)}
                      className="px-2 py-1 hover:bg-blue-50 text-blue-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold"
                      title="Configurar propiedades"
                    >
                      <Settings size={13} /> Configurar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleEliminarGondola(muebleSeleccionado.id, e)}
                      className="px-2 py-1 hover:bg-rose-50 text-rose-600 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold"
                      title="Eliminar mueble"
                    >
                      <Trash2 size={13} /> Eliminar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Buscador con Atenuación Espacial + Hint */}
          <div className="flex items-center gap-3">
            <span className="hidden xl:inline text-xs font-semibold text-slate-500">
              ✨ Haz clic en cualquier góndola para consultar inventario
            </span>
            {matchingIds && (
              <span className="text-[11px] text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-xl border border-rose-200">
                {matchingIds.size} coincidencia(s)
              </span>
            )}
            <div className="relative w-56 md:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar producto o góndola..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-2 bg-white border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600 text-xs font-bold"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── GRID DEL PLANO 2D Y PANEL DESPLEGADO HUMANO ── */}
      <div className="flex-1 px-6 py-4 min-h-0 overflow-hidden">
        <div className="max-w-7xl w-full h-full mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
          {/* Mapa 2D (Ocupa 2 columnas si hay panel abierto, o las 3 si no) */}
          <div
            ref={containerRef}
            onPointerDown={handleContainerPointerDown}
            onPointerMove={handleContainerPointerMove}
            onPointerUp={handleContainerPointerUp}
            onPointerCancel={handleContainerPointerUp}
            className={`${
              (muebleSeleccionado || showFefoDrawer) && !isEditMode
                ? "lg:col-span-2"
                : "lg:col-span-3"
            } floor-blueprint border border-rose-200 rounded-3xl relative h-full min-h-[480px] overflow-hidden select-none shadow-sm touch-none transition-all duration-300 ${
              isCameraDragging ? "cursor-grabbing" : isEditMode ? "cursor-default" : "cursor-grab"
            }`}
            style={{
              backgroundImage: `
                linear-gradient(to right, #f1f5f9 1px, transparent 1px),
                linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)
              `,
              backgroundSize: `${24 * scale}px ${24 * scale}px`,
              backgroundPosition: `${pos.x}px ${pos.y}px`,
            }}
          >
          <div
            style={{
              transform: `translate3d(${pos.x}px, ${pos.y}px, 0px) scale(${scale})`,
              transformOrigin: "0 0",
              willChange: "transform",
              width: `${limitesRecinto.canvasW}px`,
              height: `${limitesRecinto.canvasH}px`,
            }}
            className="absolute left-0 top-0 pointer-events-none"
          >
            {/* Contorno Esquemático Limpio de la Sala */}
            {muebles.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <rect
                  x={limitesRecinto.x}
                  y={limitesRecinto.y}
                  width={limitesRecinto.w}
                  height={limitesRecinto.h}
                  fill="rgba(255, 241, 242, 0.32)"
                  stroke="#fda4af"
                  strokeWidth="2"
                  strokeDasharray="8 8"
                  rx="24"
                />
              </svg>
            )}

            {/* ── MUEBLES DE SALA ── */}
            {muebles.map((mueble) => {
              const isSelected = selectedId === mueble.id;
              const isBeingDragged = draggingGondolaId === mueble.id;
              const isCollidingNow = isBeingDragged && collisionActive;
              const isCaja = mueble.tipo === "Zona de Cajas" || mueble.area === "Cajas";

              const isSearchMatch = matchingIds ? matchingIds.has(mueble.id) : false;
              const isDimmed = matchingIds ? !isSearchMatch : false;

              const comp = complianceMap[mueble.id];
              const stockTotal = comp?.stock_total ?? 0;
              const skusAsignados = comp?.skus_asignados_count ?? mueble.productosAsignados.length;
              const skusConStock = comp?.skus_con_stock_count ?? 0;
              const vencidosCount =
                comp?.vencidos_count ?? alertasPorPatente[mueble.id]?.vencidos ?? 0;
              const alertasCount =
                comp?.alertas_vencimiento_count ?? alertasPorPatente[mueble.id]?.proximos ?? 0;

              let borderStyle = "border-rose-200 hover:border-rose-400";
              let bgStyle = "bg-white/95";
              let dotClass = "bg-emerald-500";
              let headerTextClass = "text-rose-600";
              let statusBadge: React.ReactNode = null;
              let footerRightText: React.ReactNode = isCaja ? (
                <span className="text-emerald-600 font-semibold">Activas</span>
              ) : skusAsignados > 0 ? (
                <span className="text-rose-600 font-semibold">
                  {skusConStock}/{skusAsignados} SKUs
                </span>
              ) : (
                <span className="text-slate-400 font-medium">Sin SKUs</span>
              );

              if (isEditMode) {
                if (isCollidingNow) {
                  borderStyle = "border-rose-500 border-dashed ring-4 ring-rose-500/30 shadow-2xl z-40";
                  bgStyle = "bg-rose-50/95";
                  dotClass = "bg-rose-600 animate-ping";
                  headerTextClass = "text-rose-700";
                } else if (isSelected) {
                  borderStyle = "border-amber-500 ring-4 ring-amber-400/30 shadow-xl z-30";
                  bgStyle = "bg-amber-50/70";
                  dotClass = "bg-amber-500";
                  headerTextClass = "text-amber-700";
                } else {
                  borderStyle = "border-rose-200 hover:border-amber-400";
                  bgStyle = "bg-white/95";
                  dotClass = "bg-slate-400";
                  headerTextClass = "text-slate-600";
                }
              } else if (capaActiva === "categorias") {
                const catTheme = CATEGORY_STYLES[mueble.area] || CATEGORY_STYLES.Abarrotes;
                borderStyle = catTheme.border;
                bgStyle = catTheme.bg;
                dotClass = catTheme.dot;
                headerTextClass = catTheme.text;
              } else if (capaActiva === "stock") {
                if (isCaja) {
                  borderStyle = "border-rose-200";
                  bgStyle = "bg-white/95";
                  dotClass = "bg-emerald-500";
                  headerTextClass = "text-rose-600";
                } else if (skusAsignados === 0 && stockTotal === 0) {
                  borderStyle = "border-slate-300 border-dashed";
                  bgStyle = "bg-slate-50/90";
                  dotClass = "bg-slate-400";
                  headerTextClass = "text-slate-500";
                  footerRightText = <span className="text-slate-500 font-semibold">Sin surtido</span>;
                } else {
                  const tieneQuiebre =
                    (skusAsignados > 0 && (stockTotal === 0 || skusConStock < skusAsignados)) ||
                    (comp?.discrepancias || []).some((d) =>
                      d.toLowerCase().includes("agotado")
                    );
                  const esParcial =
                    !tieneQuiebre &&
                    ((comp?.cumplimiento_porcentaje ?? 100) < 100 || skusAsignados === 0);

                  if (tieneQuiebre) {
                    borderStyle = "border-rose-400 hover:border-rose-500 shadow-md shadow-rose-500/10";
                    bgStyle = "bg-rose-50/85";
                    dotClass = "bg-rose-600 animate-ping";
                    headerTextClass = "text-rose-700";
                    footerRightText = <span className="text-rose-600 font-bold">Reponer urgente</span>;
                  } else if (esParcial) {
                    borderStyle = "border-amber-300 hover:border-amber-400 shadow-sm";
                    bgStyle = "bg-amber-50/75";
                    dotClass = "bg-amber-500 animate-pulse";
                    headerTextClass = "text-amber-700";
                    footerRightText = <span className="text-amber-700 font-semibold">Stock parcial</span>;
                  } else {
                    borderStyle = "border-emerald-300 hover:border-emerald-400 shadow-sm";
                    bgStyle = "bg-white/95";
                    dotClass = "bg-emerald-500";
                    headerTextClass = "text-emerald-700";
                    footerRightText = <span className="text-emerald-600 font-semibold">Abastecido</span>;
                  }
                }
              } else if (capaActiva === "vencimientos") {
                if (isCaja) {
                  borderStyle = "border-rose-200";
                  bgStyle = "bg-white/95";
                  dotClass = "bg-emerald-500";
                  headerTextClass = "text-rose-600";
                } else if (vencidosCount > 0) {
                  borderStyle = "border-rose-400 ring-2 ring-rose-400/30 shadow-md";
                  bgStyle = "bg-rose-50/90";
                  dotClass = "bg-rose-600 animate-ping";
                  headerTextClass = "text-rose-700";
                  footerRightText = (
                    <span className="text-rose-600 font-bold">{vencidosCount} VENCIDO</span>
                  );
                } else if (alertasCount > 0) {
                  borderStyle = "border-amber-300 hover:border-amber-400 shadow-sm";
                  bgStyle = "bg-amber-50/80";
                  dotClass = "bg-amber-500 animate-pulse";
                  headerTextClass = "text-amber-700";
                  footerRightText = (
                    <span className="text-amber-700 font-semibold">Alerta FEFO ({alertasCount})</span>
                  );
                } else if (stockTotal > 0) {
                  borderStyle = "border-emerald-300";
                  bgStyle = "bg-white/95";
                  dotClass = "bg-emerald-500";
                  headerTextClass = "text-emerald-700";
                  footerRightText = <span className="text-emerald-600 font-semibold">FEFO OK</span>;
                } else {
                  borderStyle = "border-slate-300 border-dashed";
                  bgStyle = "bg-slate-50/85";
                  dotClass = "bg-slate-400";
                  headerTextClass = "text-slate-500";
                  footerRightText = <span className="text-slate-400 font-semibold">Sin lotes</span>;
                }
              } else if (capaActiva === "abc") {
                const abcItem = abcResumen?.patentes?.[mueble.id];
                const zonaTermica = abcItem?.zona_termica ?? "SIN_DATOS";
                const anomaliasAbiertas = abcItem?.anomalias_abiertas_count ?? 0;
                const participacionPct = Math.round((abcItem?.participacion_patente ?? 0) * 100);
                const skusACount = abcItem?.skus_a_count ?? 0;

                if (isCaja) {
                  borderStyle = "border-rose-200";
                  bgStyle = "bg-white/95";
                  dotClass = "bg-emerald-500";
                  headerTextClass = "text-rose-600";
                } else {
                  if (zonaTermica === "CALIENTE_A") {
                    borderStyle = "border-rose-400 ring-2 ring-rose-300/40 shadow-md";
                    bgStyle = "bg-rose-50/85";
                    dotClass = "bg-rose-600";
                    headerTextClass = "text-rose-700";
                    footerRightText = (
                      <span className="text-rose-600 font-bold">
                        {participacionPct > 0 ? `Clase A · ${participacionPct}%` : `Clase A (${skusACount})`}
                      </span>
                    );
                  } else if (zonaTermica === "MEDIA_B") {
                    borderStyle = "border-amber-300 shadow-sm";
                    bgStyle = "bg-amber-50/75";
                    dotClass = "bg-amber-500";
                    headerTextClass = "text-amber-700";
                    footerRightText = (
                      <span className="text-amber-700 font-semibold">
                        {participacionPct > 0 ? `Clase B · ${participacionPct}%` : "Clase B"}
                      </span>
                    );
                  } else if (zonaTermica === "FRIA_C") {
                    borderStyle = "border-slate-300";
                    bgStyle = "bg-white/95";
                    dotClass = "bg-slate-400";
                    headerTextClass = "text-slate-600";
                    footerRightText = <span className="text-slate-600 font-semibold">Clase C</span>;
                  } else {
                    borderStyle = "border-slate-300 border-dashed";
                    bgStyle = "bg-slate-50/80";
                    dotClass = "bg-slate-300";
                    headerTextClass = "text-slate-500";
                    footerRightText = <span className="text-slate-400 font-medium">Sin datos ABC</span>;
                  }

                  if (anomaliasAbiertas > 0) {
                    statusBadge = (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-amber-500 text-white shrink-0">
                        ! {anomaliasAbiertas}
                      </span>
                    );
                  }
                }
              }

              const normRot = ((mueble.rotacion % 360) + 360) % 360;
              const toolbarBelow = pos.y + mueble.y * scale < 68;
              const frontStripeStyle =
                normRot === 90
                  ? "left-1 top-2.5 bottom-2.5 w-1"
                  : normRot === 180
                  ? "top-1 left-2.5 right-2.5 h-1"
                  : normRot === 270
                  ? "right-1 top-2.5 bottom-2.5 w-1"
                  : "bottom-1 left-2.5 right-2.5 h-1";

              return (
                <div
                  key={mueble.id}
                  onPointerDown={(e) => handleGondolaPointerDown(e, mueble)}
                  style={{
                    left: `${mueble.x}px`,
                    top: `${mueble.y}px`,
                    width: `${mueble.w}px`,
                    height: `${mueble.h}px`,
                  }}
                  className={`gondola-card absolute pointer-events-auto rounded-2xl border transition-all duration-150 select-none p-3 flex flex-col justify-between shadow-sm ${
                    isEditMode ? "cursor-move" : "cursor-pointer"
                  } ${isBeingDragged ? "z-40 shadow-2xl" : ""} ${borderStyle} ${bgStyle} ${
                    isDimmed ? "opacity-25 grayscale" : "opacity-100"
                  } ${
                    isSearchMatch ? "ring-4 ring-rose-400 shadow-xl shadow-rose-500/15 z-20" : ""
                  } ${
                    isSelected && !isEditMode
                      ? "ring-4 ring-rose-500/30 border-rose-500 z-20 shadow-lg"
                      : ""
                  }`}
                >
                  {/* Franja visual de frente de orientación */}
                  {isEditMode && (
                    <div
                      className={`pointer-events-none absolute rounded-full bg-amber-400/80 ${frontStripeStyle}`}
                    />
                  )}

                  {/* Fila Superior: Código/Pasillo + Punto de Estado */}
                  <div className="flex items-center justify-between gap-1.5 pointer-events-none min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider truncate ${headerTextClass}`}
                      >
                        {mueble.id}
                      </span>
                      {!mueble.persistedInDb && (
                        <span className="text-[8px] font-bold px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                          NUEVO
                        </span>
                      )}
                      {isEditMode && normRot !== 0 && (
                        <span className="text-[8px] font-mono font-bold px-1 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                          {normRot}°
                        </span>
                      )}
                      {isCollidingNow && (
                        <span className="bg-rose-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded shrink-0">
                          SOLAPAMIENTO
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {statusBadge}
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                    </div>
                  </div>

                  {/* Cuerpo Central: Nombre y Área */}
                  <div className="pointer-events-none min-w-0 my-auto">
                    <h3 className="font-extrabold text-slate-900 text-xs truncate leading-tight">
                      {mueble.nombre}
                    </h3>
                    <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
                      {mueble.area}
                    </p>
                  </div>

                  {/* Fila Inferior: Unidades y SKUs / Estado */}
                  <div className="pt-1.5 border-t border-rose-100/80 flex items-center justify-between text-[10px] pointer-events-none">
                    <span className="font-bold text-slate-800 truncate">
                      {isCaja ? "Punto cobro" : `${stockTotal} und`}
                    </span>
                    <span className="truncate ml-1">{footerRightText}</span>
                  </div>

                  {/* ── BARRA FLOTANTE DE ACCIONES RÁPIDAS EN MODO EDICIÓN ── */}
                  {isEditMode && isSelected && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        left: "50%",
                        ...(toolbarBelow
                          ? { top: `calc(100% + ${Math.round(10 / scale)}px)` }
                          : { bottom: `calc(100% + ${Math.round(10 / scale)}px)` }),
                        transform: `translateX(-50%) scale(${1 / scale})`,
                        transformOrigin: toolbarBelow ? "top center" : "bottom center",
                      }}
                      className="gondola-toolbar no-canvas-drag pointer-events-auto cursor-default absolute flex items-center gap-1 bg-white border border-rose-200 px-2.5 py-1.5 rounded-2xl shadow-2xl z-50 whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => handleRotarGondola(mueble.id, e)}
                        className="px-2 py-1 hover:bg-amber-50 text-amber-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title="Rotar 90°"
                      >
                        <RotateCw size={13} /> Rotar
                      </button>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => handleDuplicarGondola(mueble.id, e)}
                        className="px-2 py-1 hover:bg-emerald-50 text-emerald-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title="Clonar mueble"
                      >
                        <Copy size={13} /> Clonar
                      </button>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => abrirModalConfiguracion(mueble, e)}
                        className="px-2 py-1 hover:bg-blue-50 text-blue-700 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title="Configurar propiedades"
                      >
                        <Settings size={13} /> Configurar
                      </button>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => handleEliminarGondola(mueble.id, e)}
                        className="px-2 py-1 hover:bg-rose-50 text-rose-600 rounded-xl transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title="Eliminar mueble"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}

                  {/* ── TIRADORES ÁMBAR DE REDIMENSIONAMIENTO ── */}
                  {isEditMode && isSelected && (
                    <>
                      <div
                        onPointerDown={(e) => handleResizeStart(e, mueble.id, "e")}
                        className="resize-handle absolute top-1/2 -right-2 -translate-y-1/2 w-3.5 h-6 bg-amber-400 hover:bg-amber-300 border border-white rounded-full cursor-ew-resize z-30 shadow-md flex items-center justify-center"
                        title="Estirar ancho"
                      >
                        <div className="w-0.5 h-3 bg-amber-950 rounded" />
                      </div>
                      <div
                        onPointerDown={(e) => handleResizeStart(e, mueble.id, "s")}
                        className="resize-handle absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-3.5 bg-amber-400 hover:bg-amber-300 border border-white rounded-full cursor-ns-resize z-30 shadow-md flex items-center justify-center"
                        title="Estirar alto"
                      >
                        <div className="w-3 h-0.5 bg-amber-950 rounded" />
                      </div>
                      <div
                        onPointerDown={(e) => handleResizeStart(e, mueble.id, "se")}
                        className="resize-handle absolute -bottom-2 -right-2 w-4 h-4 bg-amber-400 hover:bg-amber-300 border border-white rounded-md cursor-nwse-resize z-30 shadow-md"
                        title="Cambiar tamaño"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── ESTADO VACÍO LIMPIO ── */}
          {muebles.length === 0 && !isLoadingDB && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="no-canvas-drag card-soft rounded-3xl p-8 max-w-md text-center shadow-xl pointer-events-auto space-y-4"
              >
                <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <Store size={32} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Plano de Sala de Ventas Vacío</h3>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    Diagrama tu sala de ventas libremente añadiendo góndolas, vitrinas de frío e islas para monitorear su stock y vencimientos FEFO en tiempo real.
                  </p>
                </div>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setIsEditMode(true);
                    setShowAddMenu(true);
                  }}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md shadow-rose-200"
                >
                  <Plus size={16} /> Activar Edición y Añadir Primer Mueble
                </button>
              </div>
            </div>
          )}

          {/* ── CONTROLES DE ZOOM Y ENCUADRE ── */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="no-canvas-drag card-soft absolute bottom-5 right-5 flex items-center rounded-2xl p-1.5 shadow-lg z-30"
          >
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.5, s * 1.2))}
              className="w-8 h-8 flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-sm font-bold transition-colors"
              title="Acercar"
            >
              +
            </button>
            <span className="text-[11px] font-mono font-bold px-2.5 text-slate-700">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.35, s * 0.8))}
              className="w-8 h-8 flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-sm font-bold transition-colors"
              title="Alejar"
            >
              -
            </button>
            <button
              type="button"
              onClick={handleCentrarPlano}
              className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-xs text-slate-700 hover:text-rose-700 rounded-xl transition-colors ml-1 font-bold"
              title="Encuadrar muebles en pantalla"
            >
              Encuadrar
            </button>
          </div>
          </div>

          {/* ── PANEL LATERAL DE ALERTAS FEFO GLOBALES (SALA Y BODEGA) ── */}
          {showFefoDrawer && !isEditMode && (
            <div className="lg:col-span-1 card-soft rounded-3xl p-6 space-y-4 relative bg-white shadow-xl flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between border-b border-rose-100 pb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Flame size={18} className="text-amber-500" />
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">Alertas FEFO (≤ 7 días)</h3>
                    <p className="text-[11px] text-slate-500">
                      {alertasFefo.length} lote(s) por vencer o vencidos
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFefoDrawer(false)}
                  className="text-slate-400 hover:text-rose-600 text-sm font-bold p-1"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {alertasFefo.length === 0 ? (
                  <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-6 text-center text-xs text-slate-600 space-y-2">
                    <CheckCircle2 size={24} className="mx-auto text-emerald-600" />
                    <p className="font-bold text-slate-900">Sin alertas de vencimiento</p>
                    <p>Todos los productos en sala y bodega tienen más de 7 días de vigencia.</p>
                  </div>
                ) : (
                  alertasFefo.map((alerta) => {
                    const vencido = alerta.dias_restantes < 0;
                    const existeEnPlano =
                      alerta.estado === "Vitrina" &&
                      alerta.ubicacion_id &&
                      muebles.some((m) => m.id === alerta.ubicacion_id);

                    return (
                      <div
                        key={alerta.sato_id}
                        onClick={() => {
                          if (existeEnPlano && alerta.ubicacion_id) {
                            setShowFefoDrawer(false);
                            setSelectedId(alerta.ubicacion_id);
                          }
                        }}
                        className={`p-3.5 rounded-2xl border text-xs space-y-1.5 transition-colors ${
                          vencido
                            ? "bg-rose-50/80 border-rose-300"
                            : "bg-amber-50/80 border-amber-300"
                        } ${existeEnPlano ? "cursor-pointer hover:border-rose-500 shadow-2xs" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-extrabold text-slate-900 leading-snug">
                            {alerta.nombre_producto}
                          </div>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-md shrink-0 ${
                              vencido ? "bg-rose-600 text-white" : "bg-amber-500 text-white"
                            }`}
                          >
                            {vencido
                              ? `Vencido (${Math.abs(alerta.dias_restantes)}d)`
                              : `${alerta.dias_restantes}d`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Lote: {alerta.lote || "S/L"}</span>
                          <span className="font-bold text-slate-800">{alerta.cantidad} UN</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Ubicación</span>
                          <span className="font-bold text-rose-600">
                            {alerta.estado}: {alerta.ubicacion_id || "General"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── PANEL LATERAL DESPLEGADO DE GÓNDOLA (SIMPLIFICADO Y HUMANO) ── */}
          {muebleSeleccionado && !isEditMode && !showFefoDrawer && (
            <div
              id="gondolaPanel"
              className="lg:col-span-1 card-soft rounded-3xl p-6 space-y-5 relative bg-white shadow-xl flex flex-col h-full overflow-y-auto"
            >
              {/* Cabecera limpia y humana */}
              <div className="flex items-center justify-between border-b border-rose-100 pb-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-xl truncate">
                    {muebleSeleccionado.nombre || muebleSeleccionado.id}
                  </span>
                  <span className="text-xs text-slate-500 font-medium truncate">
                    {muebleSeleccionado.area}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => abrirModalConfiguracion(muebleSeleccionado)}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded-lg transition-colors"
                    title="Editar nombre o área de la góndola"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="text-slate-400 hover:text-rose-600 text-sm font-bold p-1"
                    title="Cerrar panel"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {muebleSeleccionado.tipo === "Zona de Cajas" || muebleSeleccionado.area === "Cajas" ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 space-y-1.5">
                  <p className="font-bold text-slate-900">Punto de Cobro / Salida</p>
                  <p>
                    Representa tus cajas en el plano. Las ventas se descuentan automáticamente desde la sección de Ventas POS.
                  </p>
                </div>
              ) : !muebleSeleccionado.persistedInDb ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1.5">
                  <p className="font-bold">Góndola recién agregada</p>
                  <p className="text-amber-800">
                    Haz clic en <strong>Guardar en BD</strong> arriba a la derecha para activar su control de inventario.
                  </p>
                </div>
              ) : (
                <>
                  {/* Métricas resumidas de la góndola */}
                  {(() => {
                    const comp = complianceMap[muebleSeleccionado.id];
                    const discrepanciasRaw = comp?.discrepancias || [];
                    const totalStock = stockPatenteSeleccionada.reduce((a, i) => a + i.cantidad, 0);
                    const skusEsperados =
                      comp?.skus_asignados_count ?? muebleSeleccionado.productosAsignados.length;
                    const skusActivos =
                      comp?.skus_con_stock_count ??
                      new Set(stockPatenteSeleccionada.map((s) => s.sku)).size;

                    // Humanizar mensajes técnicos reemplazando códigos SKU por nombres reales del catálogo
                    const humanizarMensaje = (msg: string) => {
                      let out = msg;
                      for (const [skuCode, prod] of Object.entries(catalogoMap)) {
                        if (out.includes(skuCode) && prod?.nombre) {
                          out = out.replace(skuCode, `${prod.nombre} (${skuCode})`);
                        }
                      }
                      return out;
                    };

                    return (
                      <>
                        <div className="grid grid-cols-2 gap-3 shrink-0">
                          <div className="bg-rose-50/50 border border-rose-100 rounded-2xl p-3.5">
                            <span className="text-[11px] font-semibold text-slate-500 block">
                              Stock en Vitrina
                            </span>
                            <div className="text-xl font-black text-slate-900">
                              {totalStock} und
                            </div>
                          </div>
                          <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-3.5">
                            <span className="text-[11px] font-semibold text-slate-500 block">
                              Surtido Activo
                            </span>
                            <div className="text-xl font-black text-emerald-700">
                              {skusEsperados > 0
                                ? `${skusActivos} / ${skusEsperados}`
                                : skusActivos}{" "}
                              SKUs
                            </div>
                          </div>
                        </div>

                        {/* Indicador Compacto y Humano de Rotación ABC de la Góndola */}
                        {(() => {
                          const abcPat = abcResumen?.patentes?.[muebleSeleccionado.id];
                          const zona = abcPat?.zona_termica ?? "SIN_DATOS";
                          const ventaClp = abcPat?.venta_valorizada_patente_clp ?? 0;
                          const sharePct =
                            Math.round((abcPat?.participacion_patente ?? 0) * 1000) / 10;

                          const rotConfig =
                            zona === "CALIENTE_A"
                              ? {
                                  badge: "Alta Rotación · Clase A",
                                  badgeClass: "bg-rose-600 text-white",
                                  boxClass: "bg-rose-50/60 border-rose-200 text-rose-900",
                                  desc:
                                    ventaClp > 0
                                      ? `Concentra el ${sharePct}% de tus ventas ($${ventaClp.toLocaleString("es-CL")})`
                                      : "Pasillo de alta demanda comercial",
                                }
                              : zona === "MEDIA_B"
                              ? {
                                  badge: "Rotación Media · Clase B",
                                  badgeClass: "bg-amber-500 text-white",
                                  boxClass: "bg-amber-50/60 border-amber-200 text-amber-900",
                                  desc:
                                    ventaClp > 0
                                      ? `Aporta el ${sharePct}% de tus ventas ($${ventaClp.toLocaleString("es-CL")})`
                                      : "Demanda regular en sala",
                                }
                              : zona === "FRIA_C"
                              ? {
                                  badge: "Baja Rotación · Clase C",
                                  badgeClass: "bg-slate-600 text-white",
                                  boxClass: "bg-slate-50 border-slate-200 text-slate-700",
                                  desc:
                                    ventaClp > 0
                                      ? `Movimiento lento (${sharePct}% de las ventas)`
                                      : "Productos de baja frecuencia de compra",
                                }
                              : {
                                  badge: "Rotación ABC",
                                  badgeClass: "bg-slate-200 text-slate-700",
                                  boxClass: "bg-slate-50 border-slate-200 text-slate-500",
                                  desc: "Sin ventas registradas aún en este pasillo",
                                };

                          return (
                            <div
                              className={`px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-2 text-xs shrink-0 ${rotConfig.boxClass}`}
                            >
                              <span className="text-[11px] font-medium truncate">
                                {rotConfig.desc}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg shrink-0 ${rotConfig.badgeClass}`}
                              >
                                {rotConfig.badge}
                              </span>
                            </div>
                          );
                        })()}

                        {/* Alerta limpia y humana */}
                        {discrepanciasRaw.length > 0 && (
                          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs space-y-1 shrink-0">
                            <strong className="font-bold text-amber-900 flex items-center gap-1.5">
                              <span>⚠️</span> Alerta de Surtido
                            </strong>
                            {discrepanciasRaw.map((d, idx) => (
                              <p key={idx} className="text-amber-800 text-[11px] leading-relaxed">
                                {humanizarMensaje(d)}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Merma Rápida en Góndola (Humana y Directa) */}
                  {skusCandidatosDiscrepancia.length > 0 && (
                    <form
                      onSubmit={handleMermaRapidaGondola}
                      className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3 shrink-0"
                    >
                      <span className="text-xs font-bold text-slate-900 block">
                        Merma Rápida en Góndola
                      </span>
                      <div className="space-y-2">
                        <select
                          value={
                            mermaGondolaSku &&
                            skusCandidatosDiscrepancia.some((c) => c.sku === mermaGondolaSku)
                              ? mermaGondolaSku
                              : stockPatenteSeleccionada[0]?.sku ||
                                skusCandidatosDiscrepancia[0]?.sku ||
                                ""
                          }
                          onChange={(e) => setMermaGondolaSku(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-rose-400"
                        >
                          {skusCandidatosDiscrepancia.map((item) => (
                            <option key={item.sku} value={item.sku}>
                              {item.nombre}
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-2">
                          {[1, 2, 5].map((q) => (
                            <button
                              type="button"
                              key={q}
                              onClick={() => setMermaGondolaCant(q)}
                              className={`px-3 py-1.5 rounded-xl text-xs transition ${
                                mermaGondolaCant === q
                                  ? "bg-rose-600 text-white font-bold"
                                  : "bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-rose-50"
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                          <input
                            type="number"
                            min={1}
                            value={mermaGondolaCant}
                            onChange={(e) =>
                              setMermaGondolaCant(Math.max(1, parseInt(e.target.value) || 1))
                            }
                            className="w-14 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 text-center ml-auto focus:outline-none focus:border-rose-400"
                            title="Otra cantidad"
                          />
                          <span className="text-xs text-slate-500 font-medium">unidades</span>
                        </div>

                        <select
                          value={mermaGondolaMotivo}
                          onChange={(e) => setMermaGondolaMotivo(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-600 focus:outline-none focus:border-rose-400"
                        >
                          <option value="VENCIDO">Motivo: Producto vencido</option>
                          <option value="ROTURA_DANO">Motivo: Envase roto o dañado</option>
                          <option value="DETERIORO_CADENA_FRIO">Motivo: Falla en cadena de frío</option>
                          <option value="MERMA_CORTE_GRANEL">Motivo: Merma por corte / granel</option>
                          <option value="OTRO">Motivo: Otro motivo</option>
                        </select>
                      </div>

                      <button
                        type="submit"
                        disabled={isReportingMermaGondola}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                      >
                        {isReportingMermaGondola
                          ? "Registrando merma..."
                          : "Confirmar Merma en Vitrina"}
                      </button>
                    </form>
                  )}

                  {/* Lotes FEFO y Abastecimiento Integrado */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>Lotes en Vitrina (FEFO)</span>
                      <span className="text-rose-600">
                        {stockPatenteSeleccionada.length}{" "}
                        {stockPatenteSeleccionada.length === 1 ? "lote" : "lotes"}
                      </span>
                    </div>

                    {isLoadingStockPatente ? (
                      <div className="text-xs text-slate-500 py-5 text-center">
                        Consultando inventario de la góndola...
                      </div>
                    ) : stockPatenteSeleccionada.length === 0 &&
                      lotesBodegaParaSeleccionada.length === 0 ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center text-xs text-slate-500">
                        No hay unidades cargadas en esta góndola ni stock pendiente en bodega.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {stockPatenteSeleccionada.map((item, idx) => {
                          const est = item.estado_vencimiento || "OK";
                          const badgeClass =
                            est === "VENCIDO"
                              ? "text-white bg-rose-600"
                              : est === "CRITICO" || est === "PROXIMO"
                              ? "text-amber-800 bg-amber-100"
                              : "text-emerald-700 bg-emerald-50";

                          // Buscar si existe un lote en bodega de este mismo producto para abastecer directo
                          const loteBodegaMatch = lotesBodegaParaSeleccionada.find(
                            (b) => b.sku === item.sku
                          );
                          const abcClaseSku =
                            abcResumen?.patentes?.[muebleSeleccionado.id]?.top_skus?.find(
                              (t) => t.sku === item.sku
                            )?.clase_abc || catalogoMap[item.sku]?.clase_abc;

                          return (
                            <div
                              key={item.sato_id || `${item.sku}-${idx}`}
                              className="p-3 bg-white border border-slate-200 rounded-2xl text-xs space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {abcClaseSku && (
                                    <span
                                      className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${
                                        abcClaseSku === "A"
                                          ? "bg-rose-600 text-white"
                                          : abcClaseSku === "B"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-slate-100 text-slate-600"
                                      }`}
                                      title={
                                        abcClaseSku === "A"
                                          ? "Producto Estrella (Alta Rotación A)"
                                          : abcClaseSku === "B"
                                          ? "Rotación Media (Clase B)"
                                          : "Baja Rotación (Clase C)"
                                      }
                                    >
                                      {abcClaseSku}
                                    </span>
                                  )}
                                  <strong className="text-slate-900 truncate">
                                    {item.nombre_producto || catalogoMap[item.sku]?.nombre || item.sku}
                                  </strong>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-md font-semibold text-[10px] shrink-0 ${badgeClass}`}
                                >
                                  {est === "VENCIDO"
                                    ? "Vencido"
                                    : item.dias_restantes !== null &&
                                      item.dias_restantes !== undefined
                                    ? `${item.dias_restantes}d`
                                    : "Vigente"}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                                <span>Lote: {item.lote || "S/L"}</span>
                                <span className="font-bold text-slate-700">
                                  {item.cantidad} {item.unidad_medida || "UN"}
                                </span>
                              </div>

                              {loteBodegaMatch && (
                                <button
                                  type="button"
                                  disabled={reponiendoSatoId === loteBodegaMatch.sato_id}
                                  onClick={() => handleAbastecerDesdeBodega(loteBodegaMatch)}
                                  className="w-full mt-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-xs disabled:opacity-50"
                                >
                                  {reponiendoSatoId === loteBodegaMatch.sato_id
                                    ? "Abasteciendo..."
                                    : `Abastecer a Vitrina (${loteBodegaMatch.cantidad} disp. en bodega)`}
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Lotes disponibles en bodega para productos que están en 0 en la góndola */}
                        {lotesBodegaParaSeleccionada
                          .filter(
                            (b) => !stockPatenteSeleccionada.some((v) => v.sku === b.sku)
                          )
                          .map((sato) => (
                            <div
                              key={sato.sato_id}
                              className="p-3 bg-emerald-50/40 border border-emerald-200 rounded-2xl text-xs space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <strong className="text-slate-900 truncate">
                                  {sato.nombre_producto || catalogoMap[sato.sku]?.nombre || sato.sku}
                                </strong>
                                <span className="text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md font-semibold text-[10px] shrink-0">
                                  Agotado en sala
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                                <span>Lote bodega: {sato.lote || "S/L"}</span>
                                <span className="font-bold text-emerald-700">
                                  {sato.cantidad} disp.
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={reponiendoSatoId === sato.sato_id}
                                onClick={() => handleAbastecerDesdeBodega(sato)}
                                className="w-full mt-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow-xs disabled:opacity-50"
                              >
                                {reponiendoSatoId === sato.sato_id
                                  ? "Abasteciendo..."
                                  : `Abastecer a Vitrina (${sato.cantidad} disp. en bodega)`}
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: CONFIGURAR PROPIEDADES DEL MUEBLE ── */}
      {isConfigModalOpen && muebleEnEdicion && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleGuardarConfigMueble();
            }}
            className="card-soft rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-rose-600" />
                <h3 className="font-extrabold text-slate-900 text-base">Propiedades del Mueble</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="text-slate-400 hover:text-rose-600"
              >
                <X size={18} />
              </button>
            </div>

            {configError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-300 text-xs text-rose-700 font-semibold">
                {configError}
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-600 font-semibold block mb-1">
                  Código del Mueble {muebleEnEdicion.persistedInDb && "(vinculado en BD)"}
                </label>
                <input
                  type="text"
                  readOnly={muebleEnEdicion.persistedInDb}
                  value={muebleEnEdicion.id}
                  onChange={(e) =>
                    setMuebleEnEdicion({ ...muebleEnEdicion, id: e.target.value.toUpperCase() })
                  }
                  className={`w-full border rounded-xl px-3 py-2 font-mono font-bold uppercase focus:outline-none ${
                    muebleEnEdicion.persistedInDb
                      ? "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed"
                      : "bg-white border-rose-200 text-slate-900 focus:border-rose-500"
                  }`}
                />
              </div>

              <div>
                <label className="text-slate-600 font-semibold block mb-1">Nombre Visible</label>
                <input
                  type="text"
                  value={muebleEnEdicion.nombre}
                  onChange={(e) => setMuebleEnEdicion({ ...muebleEnEdicion, nombre: e.target.value })}
                  className="w-full bg-white border border-rose-200 rounded-xl px-3 py-2 text-slate-900 font-semibold focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-600 font-semibold block mb-1">Tipo de Mobiliario</label>
                  <select
                    value={muebleEnEdicion.tipo}
                    onChange={(e) =>
                      setMuebleEnEdicion({ ...muebleEnEdicion, tipo: e.target.value as TipoMueble })
                    }
                    className="w-full bg-white border border-rose-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:border-rose-500"
                  >
                    {TIPOS_MUEBLE_DISPONIBLES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-600 font-semibold block mb-1">Área / Pasillo</label>
                  <select
                    value={muebleEnEdicion.area}
                    onChange={(e) =>
                      setMuebleEnEdicion({ ...muebleEnEdicion, area: e.target.value as AreaMueble })
                    }
                    className="w-full bg-white border border-rose-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:border-rose-500"
                  >
                    {AREAS_DISPONIBLES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-rose-100 pt-4">
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="px-4 py-2 rounded-2xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-2xl text-xs font-bold bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 text-white transition-all shadow-md shadow-rose-200"
              >
                Aplicar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── MODAL DE CONFIRMACIÓN REACT (SIN DEPENDER DE WINDOW.CONFIRM) ── */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card-soft rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-600" />
                <h3 className="font-extrabold text-slate-900 text-sm">{confirmDialog.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="text-slate-400 hover:text-rose-600"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{confirmDialog.description}</p>

            <div className="flex items-center justify-end gap-2 border-t border-rose-100 pt-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-2xl text-xs font-bold bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 text-white transition-all shadow-md shadow-rose-200"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
