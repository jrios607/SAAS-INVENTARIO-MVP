"use client";

import { useState, useEffect, useCallback } from "react";
import { getStockAgrupado, createProducto, StockAgrupadoFamilia, Producto } from "@/services/api";
import { HybridInput } from "@/components/HybridInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, Package, ChevronDown, ChevronRight, Boxes, AlertTriangle } from "lucide-react";

const INITIAL_FORM = {
  sku: "",
  nombre: "",
  ean: "",
  familia: "",
  sub_familia: "",
  proveedor_marca: "",
  categoria: "",
  tolerancia_vencimiento_dias: 0,
};

export default function CatalogoPage() {
  const [agrupado, setAgrupado] = useState<StockAgrupadoFamilia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});

  // ── Modal nuevo producto ──
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProductos = useCallback(async () => {
    setIsLoading(true);
    const data = await getStockAgrupado();
    setAgrupado(data);
    // Expand first one by default if exists
    if (data.length > 0 && Object.keys(expandedFamilies).length === 0) {
      setExpandedFamilies({ [data[0].familia]: true });
    }
    setIsLoading(false);
  }, [expandedFamilies]);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  const toggleFamily = (fam: string) => {
    setExpandedFamilies(prev => ({ ...prev, [fam]: !prev[fam] }));
  };

  const handleOpenModal = () => {
    setFormData(INITIAL_FORM);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.sku.trim() || !formData.nombre.trim() || !formData.ean.trim() || !formData.familia.trim()) {
      setError("SKU, Nombre, EAN y Familia son obligatorios.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await createProducto({ ...formData, tolerancia_vencimiento_dias: Number(formData.tolerancia_vencimiento_dias) });
      setIsModalOpen(false);
      await fetchProductos();
    } catch (e: any) {
      setError(e.message || "Error al crear el producto.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Catálogo de Productos</h1>
          <p className="text-slate-500 text-sm mt-1">Gestión de maestro de artículos y stock agrupado global.</p>
        </div>
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02] active:scale-100 text-white px-3.5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm shadow-emerald-500/20 flex-shrink-0"
        >
          <Plus size={16} /> Nuevo Producto
        </button>
      </div>

      {/* Accordion / Agrupación */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-center h-48 gap-2 text-slate-400">
            <Loader2 size={20} className="animate-spin text-emerald-500" />
            <span className="text-sm">Cargando catálogo consolidado...</span>
          </div>
        ) : agrupado.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
            <Package size={28} className="text-slate-200" />
            <p className="text-sm">No hay productos registrados en el sistema.</p>
            <button onClick={handleOpenModal} className="mt-2 text-xs text-emerald-600 hover:underline font-medium">
              + Crear el primer producto
            </button>
          </div>
        ) : (
          agrupado.map((grupo) => {
            const isExpanded = expandedFamilies[grupo.familia];
            return (
              <div key={grupo.familia} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                {/* Header Familia */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <button onClick={() => toggleFamily(grupo.familia)} className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-500">
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>
                    <div>
                      <h2 className={`text-lg font-bold flex items-center gap-2 ${grupo.familia === "Sin Familia" ? "text-red-600" : "text-slate-800"}`}>
                        {grupo.familia === "Sin Familia" && <AlertTriangle size={18} className="text-red-500" />}
                        {grupo.familia}
                      </h2>
                      <p className={`text-xs ${grupo.familia === "Sin Familia" ? "text-red-400" : "text-slate-500"}`}>
                        {grupo.sub_familias?.reduce((acc, sub) => acc + (sub.productos?.length || 0), 0) || 0} SKUs asociados
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold border ${grupo.familia === "Sin Familia" ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
                    <Boxes size={16} className={grupo.familia === "Sin Familia" ? "text-red-500" : "text-emerald-500"} />
                    <span>Stock Global: {grupo.stock_global_familia} un</span>
                  </div>
                </div>

                {/* Body Detalles (Sub Familias y Productos) */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-3 space-y-4">
                    {grupo.sub_familias.map((sub, i) => (
                      <div key={i} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-slate-100/70 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                          <h3 className="font-bold text-slate-700">{sub.nombre_sub_familia}</h3>
                          <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-1 rounded">
                            Stock: {sub.stock_sub_familia}
                          </span>
                        </div>
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                              {["SKU", "Nombre", "EAN", "Proveedor", "Stock Indiv."].map((h) => (
                                <th key={h} className="px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {sub.productos.map((p) => {
                              const isGhost = p.nombre.includes("PENDIENTE DE REVISIÓN");
                              return (
                                <tr key={p.sku} className={`transition-colors ${isGhost ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
                                  <td className="px-5 py-2.5 font-mono font-semibold text-slate-800 text-xs">{p.sku}</td>
                                  <td className="px-5 py-2.5 text-slate-700 font-medium">
                                    {isGhost ? (
                                      <span className="flex items-center gap-2 text-red-700 font-bold text-xs">
                                        <AlertTriangle size={14} /> {p.nombre}
                                      </span>
                                    ) : (
                                      p.nombre
                                    )}
                                  </td>
                                  <td className="px-5 py-2.5 font-mono text-slate-400 text-xs">{p.ean}</td>
                                  <td className="px-5 py-2.5 text-slate-600 text-xs">{p.proveedor_marca || "—"}</td>
                                  <td className={`px-5 py-2.5 font-bold ${isGhost ? 'text-red-700' : 'text-emerald-700'}`}>{p.stock_individual}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Modal: Nuevo Producto ── */}
      <Dialog open={isModalOpen} onOpenChange={(open) => setIsModalOpen(open)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <Plus size={18} className="text-emerald-500" /> Nuevo Producto (Jerárquico)
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <span className="font-medium">Error:</span> {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">SKU <span className="text-red-500">*</span></Label>
                <Input
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  placeholder="LECHE-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">EAN / GS1 <span className="text-red-500">*</span></Label>
                <HybridInput
                  value={formData.ean}
                  onChange={(val) => setFormData({ ...formData, ean: val })}
                  placeholder="Ej: 7802000000001"
                  autoFocus={true}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-700 font-semibold text-sm">Nombre <span className="text-red-500">*</span></Label>
              <Input
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Ej: Leche entera 1L"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-slate-700 font-semibold text-sm">Familia Global <span className="text-red-500">*</span></Label>
                <select
                  value={formData.familia}
                  onChange={(e) => setFormData({ ...formData, familia: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="" disabled>Seleccione familia...</option>
                  <option value="Abarrotes">Abarrotes</option>
                  <option value="Fiambrería y Lácteos">Fiambrería y Lácteos</option>
                  <option value="Carnicería">Carnicería</option>
                  <option value="Limpieza y Hogar">Limpieza y Hogar</option>
                  <option value="Frescos">Frescos</option>
                </select>
              </div>
              
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Sub Familia</Label>
                <Input
                  value={formData.sub_familia}
                  onChange={(e) => setFormData({ ...formData, sub_familia: e.target.value })}
                  placeholder="Ej: Aceites"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Proveedor / Marca</Label>
                <Input
                  value={formData.proveedor_marca}
                  onChange={(e) => setFormData({ ...formData, proveedor_marca: e.target.value })}
                  placeholder="Ej: Carozzi"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-700 font-semibold text-sm">Tolerancia Vida Útil (días)</Label>
              <Input
                type="number"
                min={0}
                value={formData.tolerancia_vencimiento_dias}
                onChange={(e) => setFormData({ ...formData, tolerancia_vencimiento_dias: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 mt-2">
            <button
              onClick={() => setIsModalOpen(false)}
              disabled={isSaving}
              className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {isSaving
                ? <><Loader2 size={15} className="animate-spin" /> Guardando...</>
                : <><Plus size={15} /> Crear Producto</>
              }
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
