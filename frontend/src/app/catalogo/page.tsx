"use client";

import { useState, useEffect, useCallback } from "react";
import { getProductos, createProducto, Producto } from "@/services/api";
import { HybridInput } from "@/components/HybridInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, Package } from "lucide-react";

const INITIAL_FORM = {
  sku: "",
  nombre: "",
  ean: "",
  categoria: "",
  tolerancia_vencimiento_dias: 0,
};

export default function CatalogoPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Modal nuevo producto ──
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProductos = useCallback(async () => {
    setIsLoading(true);
    const data = await getProductos();
    setProductos(data);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  const handleOpenModal = () => {
    setFormData(INITIAL_FORM);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.sku.trim() || !formData.nombre.trim() || !formData.ean.trim()) {
      setError("SKU, Nombre y EAN son obligatorios.");
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
          <p className="text-slate-500 text-sm mt-1">SKUs maestros y metadatos del sistema.</p>
        </div>
        <button
          onClick={handleOpenModal}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02] active:scale-100 text-white px-3.5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm shadow-emerald-500/20 flex-shrink-0"
        >
          <Plus size={16} /> Nuevo Producto
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-slate-400">
            <Loader2 size={20} className="animate-spin text-emerald-500" />
            <span className="text-sm">Cargando catálogo...</span>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["SKU", "Nombre", "EAN", "Categoría"].map((h) => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Package size={28} className="text-slate-200" />
                      <p className="text-sm">No hay productos registrados en el sistema.</p>
                      <button onClick={handleOpenModal} className="mt-2 text-xs text-emerald-600 hover:underline font-medium">
                        + Crear el primer producto
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                productos.map((p) => (
                  <tr key={p.sku} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono font-semibold text-slate-800 text-xs">{p.sku}</td>
                    <td className="px-5 py-3.5 text-slate-700 font-medium">{p.nombre}</td>
                    <td className="px-5 py-3.5 font-mono text-slate-400 text-xs">{p.ean}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        {p.categoria || "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {!isLoading && productos.length > 0 && (
        <p className="text-xs text-slate-400 text-right">{productos.length} producto(s) registrado(s)</p>
      )}

      {/* ── Modal: Nuevo Producto ── */}
      <Dialog open={isModalOpen} onOpenChange={(open) => setIsModalOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <Plus size={18} className="text-emerald-500" /> Nuevo Producto
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

              {/* EAN con Escáner Híbrido */}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Categoría</Label>
                <select
                  value={formData.categoria}
                  onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="" disabled>Seleccione una categoría</option>
                  <option value="Lácteos">Lácteos</option>
                  <option value="Abarrotes">Abarrotes</option>
                  <option value="Carnicería">Carnicería</option>
                  <option value="Fiambrería">Fiambrería</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-700 font-semibold text-sm">Tolerancia (días)</Label>
                <Input
                  type="number"
                  min={0}
                  value={formData.tolerancia_vencimiento_dias}
                  onChange={(e) => setFormData({ ...formData, tolerancia_vencimiento_dias: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
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
