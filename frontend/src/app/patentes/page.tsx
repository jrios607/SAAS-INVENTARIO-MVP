"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { 
  getPatentes, createPatente, updatePatente, getStockPatente, 
  getProductos, deletePatente, getSatosDisponibles, moverSatoAVitrina, 
  getPatenteCompliance, Patente, StockItem, Producto, SatoDisponible, ComplianceResponse 
} from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmapEditor } from "@/components/SubmapEditor";
import {
  Save, Plus, Settings, Lock, Package, Loader2, AlertCircle, Trash2,
  Pencil, PencilOff, CheckCircle2, ArrowRight, Box, Layers, ChevronDown, ChevronRight
} from "lucide-react";

// ─── Paleta de colores por área ───────────────────────────────────────────────

const AREA_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  abarrotes:  { bg: "bg-gradient-to-b from-slate-400 to-slate-500 shadow-lg shadow-slate-900/20 ring-1 ring-inset ring-white/20",   border: "border-slate-600 border-b-4",   text: "text-white drop-shadow-sm" },
  lacteos:    { bg: "bg-gradient-to-b from-teal-400 to-teal-500 shadow-lg shadow-teal-900/20 ring-1 ring-inset ring-white/20",    border: "border-teal-600 border-b-4",    text: "text-white drop-shadow-sm" },
  carniceria: { bg: "bg-gradient-to-b from-red-400 to-red-500 shadow-lg shadow-red-900/20 ring-1 ring-inset ring-white/20",     border: "border-red-600 border-b-4",     text: "text-white drop-shadow-sm" },
  fiambreria: { bg: "bg-gradient-to-b from-amber-400 to-amber-500 shadow-lg shadow-amber-900/20 ring-1 ring-inset ring-white/20",   border: "border-amber-600 border-b-4",   text: "text-white drop-shadow-sm" },
  default:    { bg: "bg-gradient-to-b from-emerald-400 to-emerald-500 shadow-lg shadow-emerald-900/20 ring-1 ring-inset ring-white/20", border: "border-emerald-600 border-b-4", text: "text-white drop-shadow-sm" },
};

function getAreaColor(area: string) {
  const key = area
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s/g, "");
  return AREA_COLORS[key] ?? AREA_COLORS.default;
}

// ─── Componente PlanogramGrid ──────────────────────────────────────────────────
const PlanogramGrid = ({ stock, submapeo }: { stock: StockItem[], submapeo: any }) => {
  if (!submapeo || !submapeo.filas || !submapeo.columnas) {
    // Fallback: mostrar como antes si no hay submapeo configurado
    const niveles = stock.reduce((acc, s) => {
      const n = s.nivel_estante || 0;
      if (!acc[n]) acc[n] = [];
      acc[n].push(s);
      return acc;
    }, {} as Record<number, StockItem[]>);
    
    const sortedNiveles = Object.keys(niveles).map(Number).sort((a, b) => b - a);
  
    if (stock.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
          <AlertCircle size={24} className="text-slate-300" />
          <p className="text-sm">Góndola vacía.</p>
        </div>
      );
    }
  
    return (
      <div className="flex flex-col gap-6 bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner">
        {sortedNiveles.map(n => (
           <div key={n} className="flex flex-col gap-2">
             <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
               <Layers size={14} />
               {n === 0 ? "Sin Asignar / Piso" : `Nivel ${n}`}
             </div>
             <div className="flex bg-slate-200/50 border-b-[12px] border-slate-300 p-3 gap-3 min-h-[100px] overflow-x-auto rounded-t-lg shadow-sm">
               {niveles[n].sort((a,b) => (a.frente_posicion || 0) - (b.frente_posicion || 0)).map((s, idx) => {
                 const hoy = new Date();
                 const vence = new Date(s.fecha_vencimiento);
                 const dias = Math.ceil((vence.getTime() - hoy.getTime()) / 86400000);
                 return (
                  <div key={idx} className="bg-white rounded-lg border border-slate-200 shadow-md p-3 flex flex-col items-center justify-center min-w-[90px] relative group hover:-translate-y-1 transition-transform">
                     <span className="text-sm font-black text-slate-800">{s.sku}</span>
                     <span className="text-xs text-slate-500 font-medium">{s.cantidad} und</span>
                     <span className="text-[10px] text-slate-400 mt-1 bg-slate-100 px-1.5 py-0.5 rounded">Fte: {s.frente_posicion || 0}</span>
                     
                     {dias <= 7 && (
                       <div className={`absolute -top-2 -right-2 w-4 h-4 rounded-full border-2 border-white ${dias < 0 ? 'bg-red-500' : 'bg-amber-500'}`} title={dias < 0 ? "Vencido" : `Vence en ${dias} días`} />
                     )}
                  </div>
                 );
               })}
             </div>
           </div>
        ))}
      </div>
    );
  }

  // Renderizar usando la cuadrícula del Submapeo
  const { filas, columnas, celdas } = submapeo;
  
  const esperadosSet = new Set(celdas?.filter((c:any) => c.sku_asignado).map((c:any) => `${c.sku_asignado}-${c.coordenadas[0]+1}-${c.coordenadas[1]+1}`));
  const sobrantes = stock.filter(s => !esperadosSet.has(`${s.sku}-${s.nivel_estante}-${s.frente_posicion}`));

  return (
    <div className="flex flex-col gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner overflow-x-auto">
      <div 
        className="grid gap-2 min-w-max"
        style={{
          gridTemplateRows: `repeat(${filas}, minmax(80px, 1fr))`,
          gridTemplateColumns: `repeat(${columnas}, minmax(90px, 1fr))`
        }}
      >
         {Array.from({ length: filas }).map((_, r) => (
           Array.from({ length: columnas }).map((_, c) => {
              const expectedCell = celdas?.find((cell: any) => cell.coordenadas[0] === r && cell.coordenadas[1] === c);
              const sku = expectedCell?.sku_asignado;
              const matchingStock = sku ? stock.filter(s => s.sku === sku && s.nivel_estante === r + 1 && s.frente_posicion === c + 1) : [];
              
              if (!sku) {
                 return <div key={`${r}-${c}`} className="bg-slate-100/50 rounded-lg border border-slate-200/50 shadow-sm flex items-center justify-center opacity-60" />;
              }
              
              if (matchingStock.length === 0) {
                 return (
                   <div key={`${r}-${c}`} className="bg-red-50 rounded-lg border-2 border-dashed border-red-300 flex flex-col items-center justify-center p-2 opacity-80 hover:opacity-100 transition-opacity">
                     <AlertCircle size={16} className="text-red-400 mb-1" />
                     <span className="text-[10px] font-bold text-red-500 text-center leading-tight">Falta<br/>{sku}</span>
                   </div>
                 );
              }
              
              const totalCant = matchingStock.reduce((acc, s) => acc + s.cantidad, 0);
              return (
                 <div key={`${r}-${c}`} className="bg-white rounded-lg border-2 border-emerald-400 shadow-md p-2 flex flex-col items-center justify-center relative group">
                    <span className="text-sm font-black text-slate-800 line-clamp-1">{sku}</span>
                    <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full mt-1">{totalCant} und</span>
                 </div>
              )
           })
         ))}
      </div>
      
      {sobrantes.length > 0 && (
         <div className="mt-4 border-t border-slate-200 pt-4">
           <h4 className="text-sm font-bold text-amber-600 mb-2 flex items-center gap-1"><AlertCircle size={14}/> Sobrantes / Mal Ubicados</h4>
           <div className="flex flex-wrap gap-2">
             {sobrantes.map((s, i) => (
                <div key={i} className="bg-amber-50 rounded-lg border border-amber-200 p-2 flex flex-col items-center justify-center min-w-[80px] shadow-sm">
                  <span className="text-xs font-bold text-amber-800">{s.sku}</span>
                  <span className="text-[10px] text-amber-600 font-medium">Niv {s.nivel_estante} Fte {s.frente_posicion}</span>
                </div>
             ))}
           </div>
         </div>
      )}
    </div>
  );
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function PatentesPage() {
  const [layout, setLayout] = useState<any[]>([]);
  const [complianceData, setComplianceData] = useState<Record<string, ComplianceResponse>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Modo Edición ──
  const [editMode, setEditMode] = useState(false);

  // ── Modal: Configurar nuevo mueble ──
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSubmapModalOpen, setIsSubmapModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ id_patente: "", area_pasillo: "Abarrotes", tipo_mueble: "Góndola", url_imagen_planograma: "", productos_asignados: [] as string[], submapeo_grid: null as any });

  // ── Catálogo de productos para asignación ──
  const [productosCatalogo, setProductosCatalogo] = useState<Producto[]>([]);

  useEffect(() => {
    getProductos().then(setProductosCatalogo);
  }, []);

  const [openFamilias, setOpenFamilias] = useState<Record<string, boolean>>({});
  const [openSubFamilias, setOpenSubFamilias] = useState<Record<string, boolean>>({});

  const groupedProducts = useMemo(() => {
    const map: Record<string, Record<string, Producto[]>> = {};
    
    // Filtrar productos para que solo se muestren los correspondientes al área seleccionada
    const areaSeleccionada = formData.area_pasillo?.toLowerCase().trim();
    const filteredProducts = productosCatalogo.filter(prod => {
      if (!areaSeleccionada) return true;
      const familiaProd = (prod.familia || "Sin Categorizar").toLowerCase().trim();
      return familiaProd === areaSeleccionada || familiaProd.includes(areaSeleccionada) || areaSeleccionada.includes(familiaProd);
    });

    filteredProducts.forEach(prod => {
      const fam = prod.familia || "Sin Categorizar";
      const sub = prod.sub_familia || "Sin Categorizar";
      if (!map[fam]) map[fam] = {};
      if (!map[fam][sub]) map[fam][sub] = [];
      map[fam][sub].push(prod);
    });
    return map;
  }, [productosCatalogo, formData.area_pasillo]);

  // ── Modal: Stock de mueble existente ──
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [stockPatente, setStockPatente] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockPatenteId, setStockPatenteId] = useState("");
  const [stockTab, setStockTab] = useState<"actual" | "bodega">("actual");
  const [satosBodega, setSatosBodega] = useState<SatoDisponible[]>([]);
  const [bodegaLoading, setBodegaLoading] = useState(false);

  // ── Carga de patentes ──
  const loadPatentes = useCallback(async () => {
    setIsLoading(true);
    const data = await getPatentes();
    setLayout(
      data.map((p) => ({
        i: p.id_patente,
        x: p.coordenada_x,
        y: p.coordenada_y,
        w: p.ancho,
        h: p.largo,
        static: true, 
        isNew: false,
        area: p.area_pasillo,
        tipo: p.tipo_mueble,
        url_imagen_planograma: p.url_imagen_planograma || "",
        productos_asignados: p.productos_asignados || [],
        submapeo_grid: p.submapeo_grid || null,
      }))
    );
    
    // Cargar Compliance
    const compliances: Record<string, ComplianceResponse> = {};
    await Promise.all(data.map(async (p) => {
      const c = await getPatenteCompliance(p.id_patente);
      if (c) compliances[p.id_patente] = c;
    }));
    setComplianceData(compliances);
    
    setIsLoading(false);
  }, []);

  useEffect(() => { loadPatentes(); }, [loadPatentes]);

  // ── Cuando cambia modo edición, actualizar static de muebles existentes ──
  useEffect(() => {
    setLayout((prev) =>
      prev.map((item) => ({
        ...item,
        static: item.isNew ? false : !editMode,
      }))
    );
  }, [editMode]);

  const handleAddMueble = () => {
    const id = `temp_${Date.now()}`;
    setLayout((prev) => [
      ...prev,
      { i: id, x: 0, y: 0, w: 4, h: 2, static: false, isNew: true, area: "Abarrotes", tipo: "Góndola", url_imagen_planograma: "", productos_asignados: [], submapeo_grid: null },
    ]);
  };

  const handleLayoutChange = (newLayout: any) => {
    setLayout((prev) =>
      newLayout.map((item: any) => {
        const existing = prev.find((l) => l.i === item.i);
        return { ...existing, ...item };
      })
    );
  };

  const handleDeletePatente = async () => {
    if (!selectedItemId) return;
    if (selectedItemId.startsWith("temp_")) {
      setLayout((prev) => prev.filter((item) => item.i !== selectedItemId));
      setIsConfigModalOpen(false);
      return;
    }
    
    if (confirm("¿Estás seguro de eliminar esta góndola? Si tiene stock en vitrina, la operación será rechazada.")) {
      try {
        await deletePatente(selectedItemId);
        setLayout((prev) => prev.filter((item) => item.i !== selectedItemId));
        setIsConfigModalOpen(false);
        // Quitar de complianceData
        setComplianceData(prev => {
          const newData = {...prev};
          delete newData[selectedItemId];
          return newData;
        });
      } catch (e: any) {
        alert(e.message || "Error al eliminar la góndola");
      }
    }
  };

  const handleItemDoubleClick = async (itemId: string) => {
    const item = layout.find((l) => l.i === itemId);
    if (!item) return;

    if (editMode || item.isNew) {
      setSelectedItemId(itemId);
      setFormData({
        id_patente: item.i.startsWith("temp_") ? "" : item.i,
        area_pasillo: item.area,
        tipo_mueble: item.tipo,
        url_imagen_planograma: item.url_imagen_planograma || "",
        productos_asignados: item.productos_asignados || [],
        submapeo_grid: item.submapeo_grid || null,
      });
      setIsConfigModalOpen(true);
    } else {
      setStockPatenteId(itemId);
      setIsStockModalOpen(true);
      setStockTab("actual");
      setStockLoading(true);
      const stock = await getStockPatente(itemId);
      setStockPatente(stock);
      setStockLoading(false);

      setBodegaLoading(true);
      const bodega = await getSatosDisponibles();
      setSatosBodega(bodega);
      setBodegaLoading(false);
    }
  };

  const handleMoverAVitrina = async (satoId: string, n: number, f: number) => {
    if (n === undefined || f === undefined || isNaN(n) || isNaN(f)) {
      alert("Error: No se pudo determinar el Nivel y Frente automático.");
      return;
    }

    try {
      await moverSatoAVitrina(satoId, stockPatenteId, n, f);
      alert("SATO movido a la vitrina exitosamente.");
      
      // Refresh bodega list
      setBodegaLoading(true);
      const bodega = await getSatosDisponibles();
      setSatosBodega(bodega);
      setBodegaLoading(false);

      // Refresh stock vitrina
      setStockLoading(true);
      const stock = await getStockPatente(stockPatenteId);
      setStockPatente(stock);
      setStockLoading(false);
      
      // Recargar compliance silently
      getPatenteCompliance(stockPatenteId).then(c => {
         if (c) setComplianceData(prev => ({...prev, [stockPatenteId]: c}));
      });
      
    } catch (e: any) {
      alert(e.message || "Error al mover SATO");
    }
  };

  const saveConfigModal = () => {
    if (!selectedItemId) return;
    if (!formData.id_patente.trim()) { alert("El ID de la patente es obligatorio."); return; }
    setLayout((prev) =>
      prev.map((item) =>
        item.i === selectedItemId
          ? { ...item, i: formData.id_patente, area: formData.area_pasillo, tipo: formData.tipo_mueble, url_imagen_planograma: formData.url_imagen_planograma, productos_asignados: formData.productos_asignados, submapeo_grid: formData.submapeo_grid }
          : item
      )
    );
    setIsConfigModalOpen(false);
  };

  // ── Guardar: crea nuevos y actualiza existentes modificados ──
  const handleSaveLayout = async () => {
    const newItems = layout.filter((item) => item.isNew);
    const existingItems = layout.filter((item) => !item.isNew && editMode);

    if (newItems.length === 0 && existingItems.length === 0) {
      alert("No hay cambios que guardar.");
      return;
    }

    const invalidNew = newItems.filter((item) => item.i.startsWith("temp_"));
    if (invalidNew.length > 0) {
      alert("Hay muebles sin configurar. Haz doble clic en los bloques verdes para asignarles un ID.");
      return;
    }

    setIsSaving(true);
    let errors: string[] = [];

    // ── Crear muebles nuevos ──
    for (const item of newItems) {
      const patente: Patente = {
        id_patente: item.i,
        area_pasillo: item.area,
        tipo_mueble: item.tipo,
        coordenada_x: item.x,
        coordenada_y: item.y,
        ancho: item.w,
        largo: item.h,
        url_imagen_planograma: item.url_imagen_planograma,
        productos_asignados: item.productos_asignados,
        submapeo_grid: item.submapeo_grid,
      };
      try { await createPatente(patente); }
      catch (e: any) { errors.push(`CREATE "${item.i}": ${e.message}`); }
    }

    // ── Actualizar posiciones de muebles existentes (Modo Edición) ──
    for (const item of existingItems) {
      try {
        await updatePatente(item.i, {
          coordenada_x: item.x,
          coordenada_y: item.y,
          ancho: item.w,
          largo: item.h,
          url_imagen_planograma: item.url_imagen_planograma,
          productos_asignados: item.productos_asignados,
          submapeo_grid: item.submapeo_grid,
        });
      } catch (e: any) { errors.push(`UPDATE "${item.i}": ${e.message}`); }
    }

    setIsSaving(false);

    if (errors.length > 0) {
      alert(`Algunos cambios fallaron:\n${errors.join("\n")}`);
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }

    setEditMode(false);
    await loadPatentes();
  };

  // ─────────────────────────────────────────────────────────────────────────────

  if (isLoading && layout.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
        <Loader2 size={28} className="animate-spin text-emerald-500" />
        <span className="text-sm">Cargando plano 2D...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Plano 2D — Patentes</h1>
          <p className="text-slate-500 text-sm mt-1">
            {editMode
              ? "🟡 Modo edición activo. Mueve y redimensiona cualquier mueble."
              : "Doble clic en un mueble guardado para ver su stock. Los bordes indican el % de cumplimiento."}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap flex-shrink-0">
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all border hover:scale-[1.02] active:scale-100
              ${editMode
                ? "bg-amber-500 border-amber-600 text-white shadow-sm shadow-amber-400/30"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm"
              }`}
          >
            {editMode ? <PencilOff size={16} /> : <Pencil size={16} />}
            {editMode ? "Salir Edición" : "Modo Edición"}
          </button>

          <button
            onClick={handleAddMueble}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 hover:scale-[1.02] active:scale-100 text-slate-700 px-3.5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            <Plus size={16} /> Añadir Mueble
          </button>

          <button
            onClick={handleSaveLayout}
            disabled={isSaving}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm hover:scale-[1.02] active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed
              ${saveSuccess
                ? "bg-green-500 border-green-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
              }`}
          >
            {isSaving
              ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
              : saveSuccess
                ? <><CheckCircle2 size={16} /> Guardado</>
                : <><Save size={16} /> Guardar Diseño</>
            }
          </button>
        </div>
      </div>

      {/* ── Leyenda de colores ── */}
      <div className="flex flex-wrap gap-3 text-xs font-medium bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-slate-500 font-bold mr-2">Áreas:</span>
        {[
          { label: "Abarrotes", color: "bg-slate-500" },
          { label: "Frío / Lácteos", color: "bg-teal-500" },
          { label: "Carnicería", color: "bg-red-500" },
          { label: "Fiambrería", color: "bg-amber-500" },
          { label: "Sin guardar", color: "bg-emerald-100 border border-emerald-400 text-emerald-800" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-slate-600">
            <span className={`w-3 h-3 rounded-sm inline-block ${item.color}`} />
            {item.label}
          </div>
        ))}
        
        <div className="w-px h-4 bg-slate-200 mx-2" />
        <span className="text-slate-500 font-bold mr-2">Compliance:</span>
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="w-3 h-3 rounded-sm inline-block bg-emerald-400" /> Óptimo (&gt;80%)
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="w-3 h-3 rounded-sm inline-block bg-amber-400" /> Regular
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="w-3 h-3 rounded-sm inline-block bg-red-500" /> Crítico (&lt;50%)
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 overflow-x-auto relative">
        <div
          className="min-w-[1200px]"
          style={{
            minHeight: "680px",
            backgroundColor: "#f8fafc",
            backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "30px 30px",
          }}
        >
          {/* @ts-ignore */}
          {React.createElement(GridLayout as any, {
            className: "layout",
            layout: layout,
            cols: 40,
            rowHeight: 30,
            width: 1200,
            onLayoutChange: handleLayoutChange,
            isDraggable: true,
            isResizable: true,
            compactType: null,
            preventCollision: true,
          }, layout.map((item) => {
              const isEditable = editMode && !item.isNew;
              const colors = item.isNew
                ? { bg: "bg-emerald-100", border: "border-emerald-500", text: "text-emerald-800" }
                : isEditable
                  ? { bg: "bg-amber-400", border: "border-amber-500", text: "text-white" }
                  : getAreaColor(item.area);

              const compliance = complianceData[item.i];
              let borderColor = colors.border;
              let barColor = "";
              
              if (compliance && !item.isNew && !editMode) {
                if (compliance.cumplimiento_porcentaje >= 80) {
                  borderColor = "border-emerald-500 border-2";
                  barColor = "bg-emerald-400";
                } else if (compliance.cumplimiento_porcentaje >= 50) {
                  borderColor = "border-amber-400 border-2";
                  barColor = "bg-amber-400";
                } else {
                  borderColor = "border-red-500 border-2 shadow-[0_0_10px_rgba(239,68,68,0.5)]";
                  barColor = "bg-red-500";
                }
              }

              return (
                <div
                  key={item.i}
                  data-grid={{ x: item.x, y: item.y, w: item.w, h: item.h, static: item.static }}
                  className={`flex flex-col items-center justify-center rounded transition-all overflow-hidden select-none relative
                    ${colors.bg} ${borderColor} ${colors.text}
                    ${item.static
                      ? "cursor-pointer hover:brightness-110"
                      : "cursor-grab active:cursor-grabbing shadow-md"
                    }`}
                  onDoubleClick={() => handleItemDoubleClick(item.i)}
                  title={compliance ? `Cumplimiento: ${compliance.cumplimiento_porcentaje.toFixed(1)}%` : ''}
                >
                  <div className="flex items-center gap-1 font-bold text-[11px] tracking-tight truncate px-1 z-10">
                    {item.static && !item.isNew && <Lock size={10} className="opacity-70 flex-shrink-0" />}
                    {isEditable && <Pencil size={10} className="opacity-80 flex-shrink-0" />}
                    <span className="truncate">{item.i.startsWith("temp_") ? "NUEVO" : item.i}</span>
                    {item.isNew && <Settings size={10} className="opacity-70 flex-shrink-0" />}
                  </div>
                  <div className="text-[9px] opacity-80 uppercase tracking-widest mt-0.5 z-10">{item.tipo}</div>
                  
                  {/* Barra de Capacidad/Cumplimiento */}
                  {compliance && !item.isNew && !editMode && (
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20">
                      <div 
                        className={`h-full ${barColor} transition-all duration-500`}
                        style={{ width: `${compliance.cumplimiento_porcentaje}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            }))}
        </div>
      </div>

      {/* ── Modal: Configurar nuevo mueble ── */}
      <Dialog open={isConfigModalOpen} onOpenChange={setIsConfigModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-emerald-700 flex items-center gap-2">
              <Settings size={18} /> Configurar Patente (Space Management)
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-3">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">ID de Patente (único)</Label>
                <Input value={formData.id_patente} onChange={(e) => setFormData({ ...formData, id_patente: e.target.value })} placeholder="Ej: A-01-01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Área / Pasillo</Label>
                <select
                  value={formData.area_pasillo}
                  onChange={(e) => setFormData({ ...formData, area_pasillo: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="" disabled>Seleccione un área</option>
                  <option value="Lácteos">Lácteos</option>
                  <option value="Abarrotes">Abarrotes</option>
                  <option value="Carnicería">Carnicería</option>
                  <option value="Fiambrería">Fiambrería</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Tipo de Mueble</Label>
                <Input value={formData.tipo_mueble} onChange={(e) => setFormData({ ...formData, tipo_mueble: e.target.value })} placeholder="Góndola, Isla..." />
              </div>
              
              <hr className="border-slate-100" />
              
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm flex items-center gap-2">
                  <Package size={14} className="text-slate-400" /> URL Imagen Planograma
                </Label>
                <Input 
                  value={formData.url_imagen_planograma} 
                  onChange={(e) => setFormData({ ...formData, url_imagen_planograma: e.target.value })} 
                  placeholder="https://ejemplo.com/plano.jpg" 
                />
                {formData.url_imagen_planograma && (
                  <div className="mt-2 space-y-2">
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 flex items-center justify-center p-1">
                      <img 
                        src={formData.url_imagen_planograma} 
                        alt="Planograma Preview" 
                        className="max-h-[200px] w-auto object-contain rounded-md"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    </div>
                    <button 
                      onClick={() => setIsSubmapModalOpen(true)}
                      className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Settings size={16} /> 🔧 Editar Submapeo Virtual
                    </button>
                    {formData.submapeo_grid && (
                      <p className="text-xs text-center text-emerald-600 font-medium">✅ Submapeo configurado ({formData.submapeo_grid.celdas?.length || 0} celdas)</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 flex flex-col h-full">
              <Label className="text-slate-700 font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500" /> Surtido Asignado
              </Label>
              <p className="text-xs text-slate-500">Selecciona los productos que deben exhibirse en esta patente.</p>
              
              <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-y-auto max-h-64 sm:max-h-[360px] p-2 space-y-1 shadow-inner">
                {productosCatalogo.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-4">No hay productos en el catálogo</div>
                ) : (
                  Object.keys(groupedProducts).sort().map(fam => {
                    const subs = groupedProducts[fam];
                    const famProducts = Object.values(subs).flat();
                    const famSelected = famProducts.filter(p => formData.productos_asignados.includes(p.sku)).length;
                    const isFamOpen = openFamilias[fam];
                    
                    return (
                      <div key={fam} className="border border-slate-200 rounded-lg overflow-hidden mb-2">
                        <button 
                          className="w-full flex items-center justify-between p-2.5 bg-slate-100 hover:bg-slate-200 transition-colors text-left"
                          onClick={() => setOpenFamilias(prev => ({...prev, [fam]: !prev[fam]}))}
                        >
                          <div className="flex items-center gap-2">
                            {isFamOpen ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                            <span className="font-bold text-slate-700 text-sm">{fam}</span>
                          </div>
                          {famSelected > 0 && (
                            <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                              {famSelected} selec.
                            </span>
                          )}
                        </button>
                        
                        {isFamOpen && (
                          <div className="p-2 space-y-2 bg-white">
                            {Object.keys(subs).sort().map(sub => {
                               const subProducts = subs[sub];
                               const subSelected = subProducts.filter(p => formData.productos_asignados.includes(p.sku)).length;
                               const isSubOpen = openSubFamilias[`${fam}-${sub}`];
                               
                               return (
                                 <div key={sub} className="border border-slate-100 rounded-md overflow-hidden">
                                   <button 
                                     className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                                     onClick={() => setOpenSubFamilias(prev => ({...prev, [`${fam}-${sub}`]: !prev[`${fam}-${sub}`]}))}
                                   >
                                     <div className="flex items-center gap-2 ml-2">
                                       {isSubOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                       <span className="font-semibold text-slate-600 text-sm">{sub}</span>
                                     </div>
                                     {subSelected > 0 && (
                                       <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">
                                         {subSelected}
                                       </span>
                                     )}
                                   </button>
                                   
                                   {isSubOpen && (
                                      <div className="p-1.5 space-y-1 bg-white ml-6">
                                        {subProducts.map(prod => {
                                          const isChecked = formData.productos_asignados.includes(prod.sku);
                                          return (
                                            <label 
                                              key={prod.sku} 
                                              className={`flex items-start gap-3 p-2 rounded-md cursor-pointer border transition-colors ${isChecked ? 'bg-emerald-50/50 border-emerald-200' : 'border-transparent hover:bg-slate-50'}`}
                                            >
                                              <input
                                                type="checkbox"
                                                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                  const newAsignados = e.target.checked
                                                    ? [...formData.productos_asignados, prod.sku]
                                                    : formData.productos_asignados.filter(sku => sku !== prod.sku);
                                                  setFormData({ ...formData, productos_asignados: newAsignados });
                                                }}
                                              />
                                              <div className="flex flex-col">
                                                <span className="text-xs font-medium text-slate-700 line-clamp-1">{prod.nombre || "Sin nombre"}</span>
                                                <span className="text-[10px] text-slate-400 font-mono">{prod.sku}</span>
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                   )}
                                 </div>
                               );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="text-right text-xs text-slate-500 pt-1">
                {formData.productos_asignados.length} productos seleccionados
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 mt-4">
            {selectedItemId && !selectedItemId.startsWith("temp_") && (
              <button onClick={handleDeletePatente} className="px-4 py-2 text-white bg-red-500 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors mr-auto flex items-center gap-2">
                <Trash2 size={15} /> Eliminar Góndola
              </button>
            )}
            <button onClick={() => setIsConfigModalOpen(false)} className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors">Cancelar</button>
            <button onClick={saveConfigModal} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
              <Save size={15} /> Confirmar Datos
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Editor de Submapeo ── */}
      {isSubmapModalOpen && (
        <SubmapEditor
          isOpen={isSubmapModalOpen}
          onClose={() => setIsSubmapModalOpen(false)}
          imageUrl={formData.url_imagen_planograma}
          productosAsignados={formData.productos_asignados}
          productosCatalogo={productosCatalogo}
          initialGridData={formData.submapeo_grid}
          onSave={(gridData) => {
            setFormData({ ...formData, submapeo_grid: gridData });
            setIsSubmapModalOpen(false);
          }}
        />
      )}

      {/* ── Modal: Stock de mueble existente ── */}
      <Dialog open={isStockModalOpen} onOpenChange={setIsStockModalOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <Package size={18} className="text-emerald-500" />
              Stock Vitrina —{" "}
              <code className="ml-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-sm font-mono">
                {stockPatenteId}
              </code>
            </DialogTitle>
            <div className="flex gap-4 mt-2 border-b border-slate-200">
              <button 
                onClick={() => setStockTab("actual")}
                className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${stockTab === "actual" ? "border-emerald-500 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                Planograma / Stock Actual
              </button>
              <button 
                onClick={() => setStockTab("bodega")}
                className={`pb-2 text-sm font-semibold transition-colors border-b-2 ${stockTab === "bodega" ? "border-emerald-500 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                Añadir de Bodega
              </button>
            </div>
          </DialogHeader>
          <div className="py-4 min-h-[350px] max-h-[70vh] overflow-y-auto">
            {stockTab === "actual" ? (
              stockLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
                  <Loader2 size={20} className="animate-spin text-emerald-500" />
                  <span className="text-sm">Consultando stock...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {complianceData[stockPatenteId] && complianceData[stockPatenteId].discrepancias.length > 0 && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg text-sm">
                      <p className="font-bold flex items-center gap-1 mb-2"><AlertCircle size={16}/> Discrepancias de Compliance:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {complianceData[stockPatenteId].discrepancias.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                  <PlanogramGrid stock={stockPatente} submapeo={layout.find(l => l.i === stockPatenteId)?.submapeo_grid} />
                </div>
              )
            ) : (
              bodegaLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
                  <Loader2 size={20} className="animate-spin text-emerald-500" />
                  <span className="text-sm">Buscando stock en bodega...</span>
                </div>
              ) : satosBodega.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
                  <Box size={24} className="text-slate-300" />
                  <p className="text-sm">No hay bultos disponibles en Bodega.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">Los SKUs se ubicarán automáticamente según el planograma configurado.</p>
                  <div className="grid grid-cols-1 gap-3">
                    {satosBodega.map(sato => {
                      const submapeoActual = layout.find(l => l.i === stockPatenteId)?.submapeo_grid;
                      const celdaDestino = submapeoActual?.celdas?.find((c: any) => c.sku_asignado === sato.sku);
                      
                      const isValid = !!celdaDestino;
                      const n = isValid ? celdaDestino.coordenadas[0] + 1 : undefined;
                      const f = isValid ? celdaDestino.coordenadas[1] + 1 : undefined;
                      
                      return (
                      <div key={sato.sato_id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg transition-colors gap-4 shadow-sm ${isValid ? 'bg-white border-slate-200 hover:border-emerald-300' : 'bg-slate-50 border-slate-200 opacity-70'}`}>
                        <div className="flex-1">
                          <div className="font-bold text-slate-800 text-base flex items-center gap-2">
                            {sato.sku} <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border uppercase tracking-wider">{sato.estado}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            <span>Lote: {sato.lote || "N/A"}</span>
                            <span>Cant: <strong className="text-slate-700 text-sm">{sato.cantidad}</strong></span>
                            <span>Vence: {sato.fecha_vencimiento || "N/A"}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {isValid ? (
                            <div className="text-right">
                              <span className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">Destino Automático</span>
                              <span className="block text-sm font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                                Nivel {n}, Frente {f}
                              </span>
                            </div>
                          ) : (
                            <div className="text-right">
                              <span className="block text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100">
                                SKU no pertenece al planograma
                              </span>
                            </div>
                          )}
                          <div className="flex flex-col justify-end h-full">
                             <button 
                              onClick={() => isValid && handleMoverAVitrina(sato.sato_id, n, f)}
                              disabled={!isValid}
                              className="flex items-center gap-1.5 px-3 py-1.5 h-10 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
                             >
                              Mover Aquí <ArrowRight size={16} />
                             </button>
                          </div>
                        </div>
                      </div>
                    )})}
                  </div>
                </div>
              )
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setIsStockModalOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors">
              Cerrar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
