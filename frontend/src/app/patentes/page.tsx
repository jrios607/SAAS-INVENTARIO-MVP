"use client";

import React, { useState, useEffect, useCallback } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { getPatentes, createPatente, updatePatente, getStockPatente, getProductos, Patente, StockItem, Producto } from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmapEditor } from "@/components/SubmapEditor";
import {
  Save, Plus, Settings, Lock, Package, Loader2, AlertCircle,
  Pencil, PencilOff, CheckCircle2,
} from "lucide-react";

// ─── Paleta de colores por área ───────────────────────────────────────────────

const AREA_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  abarrotes:  { bg: "bg-slate-500",   border: "border-slate-600",   text: "text-white" },
  lacteos:    { bg: "bg-teal-500",    border: "border-teal-600",    text: "text-white" },
  carniceria: { bg: "bg-red-500",     border: "border-red-600",     text: "text-white" },
  fiambreria: { bg: "bg-amber-500",   border: "border-amber-600",   text: "text-white" },
  default:    { bg: "bg-emerald-500", border: "border-emerald-600", text: "text-white" },
};

function getAreaColor(area: string) {
  const key = area
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s/g, "");
  return AREA_COLORS[key] ?? AREA_COLORS.default;
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function PatentesPage() {
  const [layout, setLayout] = useState<any[]>([]);
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

  // ── Modal: Stock de mueble existente ──
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [stockPatente, setStockPatente] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockPatenteId, setStockPatenteId] = useState("");

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
        static: true, // siempre empieza bloqueado
        isNew: false,
        area: p.area_pasillo,
        tipo: p.tipo_mueble,
        url_imagen_planograma: p.url_imagen_planograma || "",
        productos_asignados: p.productos_asignados || [],
        submapeo_grid: p.submapeo_grid || null,
      }))
    );
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

  const handleLayoutChange = (newLayout: Layout[]) => {
    setLayout((prev) =>
      newLayout.map((item) => {
        const existing = prev.find((l) => l.i === item.i);
        return { ...existing, ...item };
      })
    );
  };

  const handleItemDoubleClick = async (itemId: string) => {
    const item = layout.find((l) => l.i === itemId);
    if (!item) return;

    if (item.isNew) {
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
    } else if (!editMode) {
      // Solo abrir stock si NO estamos en modo edición
      setStockPatenteId(itemId);
      setIsStockModalOpen(true);
      setStockLoading(true);
      const stock = await getStockPatente(itemId);
      setStockPatente(stock);
      setStockLoading(false);
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
              : "Doble clic en un mueble guardado para ver su stock."}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap flex-shrink-0">
          {/* Toggle Modo Edición */}
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

          {/* Añadir mueble */}
          <button
            onClick={handleAddMueble}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 hover:scale-[1.02] active:scale-100 text-slate-700 px-3.5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            <Plus size={16} /> Añadir Mueble
          </button>

          {/* Guardar */}
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
      <div className="flex flex-wrap gap-3 text-xs font-medium">
        {[
          { label: "Abarrotes", color: "bg-slate-500" },
          { label: "Frío / Lácteos", color: "bg-blue-500" },
          { label: "Carnicería", color: "bg-red-500" },
          { label: "Otros", color: "bg-emerald-500" },
          { label: "Sin guardar", color: "bg-emerald-100 border border-emerald-400" },
          { label: "Editable", color: "bg-amber-400" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-slate-600">
            <span className={`w-3 h-3 rounded-sm inline-block ${item.color}`} />
            {item.label}
          </div>
        ))}
      </div>

      {/* ── Canvas ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 overflow-x-auto">
        <div
          className="min-w-[1200px]"
          style={{
            minHeight: "680px",
            backgroundColor: "#f8fafc",
            backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "30px 30px",
          }}
        >
          <GridLayout
            className="layout"
            layout={layout}
            cols={40}
            rowHeight={30}
            width={1200}
            onLayoutChange={handleLayoutChange}
            isDraggable={true}
            isResizable={true}
            compactType={null}
            preventCollision={true}
          >
            {layout.map((item) => {
              const isEditable = editMode && !item.isNew;
              const colors = item.isNew
                ? { bg: "bg-emerald-100", border: "border-emerald-500", text: "text-emerald-800" }
                : isEditable
                  ? { bg: "bg-amber-400", border: "border-amber-500", text: "text-white" }
                  : getAreaColor(item.area);

              return (
                <div
                  key={item.i}
                  data-grid={{ x: item.x, y: item.y, w: item.w, h: item.h, static: item.static }}
                  className={`flex flex-col items-center justify-center rounded border-2 transition-all overflow-hidden select-none
                    ${colors.bg} ${colors.border} ${colors.text}
                    ${item.static
                      ? "cursor-pointer hover:brightness-110"
                      : "cursor-grab active:cursor-grabbing shadow-md"
                    }`}
                  onDoubleClick={() => handleItemDoubleClick(item.i)}
                >
                  <div className="flex items-center gap-1 font-bold text-[11px] tracking-tight truncate px-1">
                    {item.static && !item.isNew && <Lock size={10} className="opacity-70 flex-shrink-0" />}
                    {isEditable && <Pencil size={10} className="opacity-80 flex-shrink-0" />}
                    <span className="truncate">{item.i.startsWith("temp_") ? "NUEVO" : item.i}</span>
                    {item.isNew && <Settings size={10} className="opacity-70 flex-shrink-0" />}
                  </div>
                  <div className="text-[9px] opacity-80 uppercase tracking-widest mt-0.5">{item.tipo}</div>
                </div>
              );
            })}
          </GridLayout>
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
            {/* Columna Izquierda: Metadatos y Planograma */}
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

            {/* Columna Derecha: Asignación de SKUs */}
            <div className="space-y-2 flex flex-col h-full">
              <Label className="text-slate-700 font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500" /> Surtido Asignado
              </Label>
              <p className="text-xs text-slate-500">Selecciona los productos que deben exhibirse en esta patente.</p>
              
              <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-y-auto max-h-64 sm:max-h-[360px] p-2 space-y-1 shadow-inner">
                {productosCatalogo.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-4">No hay productos en el catálogo</div>
                ) : (
                  productosCatalogo.map((prod) => {
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
                          <span className="text-sm font-medium text-slate-700 line-clamp-1">{prod.nombre || "Sin nombre"}</span>
                          <span className="text-xs text-slate-400 font-mono">{prod.sku}</span>
                        </div>
                      </label>
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <Package size={18} className="text-emerald-500" />
              Stock Vitrina —{" "}
              <code className="ml-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-sm font-mono">
                {stockPatenteId}
              </code>
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {stockLoading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin text-emerald-500" />
                <span className="text-sm">Consultando stock...</span>
              </div>
            ) : stockPatente.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
                <AlertCircle size={24} className="text-slate-300" />
                <p className="text-sm">Esta patente no tiene SATOs en vitrina.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Lote</th>
                      <th className="px-4 py-3 text-right">Cantidad</th>
                      <th className="px-4 py-3 text-right">Vence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockPatente.map((s, i) => {
                      const hoy = new Date();
                      const vence = new Date(s.fecha_vencimiento);
                      const dias = Math.ceil((vence.getTime() - hoy.getTime()) / 86400000);
                      return (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-800">{s.sku}</td>
                          <td className="px-4 py-3 font-mono text-slate-500 text-xs">{s.lote}</td>
                          <td className="px-4 py-3 text-right font-bold">{s.cantidad}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                              ${dias < 0 ? "bg-red-100 text-red-700" : dias <= 7 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                              {s.fecha_vencimiento}{dias < 0 ? " ⚠ Vencido" : dias <= 7 ? ` (${dias}d)` : ""}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
