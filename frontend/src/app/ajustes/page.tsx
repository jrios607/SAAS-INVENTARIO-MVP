"use client";

import { useState, useEffect, useCallback } from "react";
import { getSatosRecepcion, ajustarInventario, SatoRecepcionDetalle, AjusteInventarioRequest } from "@/services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, PackageMinus, Box, Search, CheckCircle2, AlertCircle } from "lucide-react";

export default function AjustesBodegaPage() {
  const [satos, setSatos] = useState<SatoRecepcionDetalle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selectedSato, setSelectedSato] = useState<SatoRecepcionDetalle | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cantidadRestar, setCantidadRestar] = useState<number | "">("");
  const [motivo, setMotivo] = useState<AjusteInventarioRequest["motivo"]>("Faltante de Origen");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchSatos = useCallback(async () => {
    setIsLoading(true);
    const data = await getSatosRecepcion();
    setSatos(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSatos();
  }, [fetchSatos]);

  const handleOpenModal = (sato: SatoRecepcionDetalle) => {
    setSelectedSato(sato);
    setCantidadRestar("");
    setMotivo("Faltante de Origen");
    setError("");
    setIsModalOpen(true);
  };

  const handleAjustar = async () => {
    if (!selectedSato) return;
    const cant = Number(cantidadRestar);
    if (!cant || cant <= 0) {
      setError("Ingrese una cantidad válida mayor a 0.");
      return;
    }
    if (cant > selectedSato.cantidad_actual) {
      setError(`No puede restar más del stock actual (${selectedSato.cantidad_actual}).`);
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      await ajustarInventario(selectedSato.sato_id, { cantidad_a_restar: cant, motivo });
      setIsModalOpen(false);
      await fetchSatos();
    } catch (err: any) {
      setError(err.message || "Error al realizar el ajuste.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSatos = satos.filter(s => 
    s.sku.toLowerCase().includes(search.toLowerCase()) || 
    s.nombre_producto.toLowerCase().includes(search.toLowerCase()) ||
    (s.lpn_padre && s.lpn_padre.includes(search))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <PackageMinus className="text-amber-600" /> Ajustes de Inventario
          </h1>
          <p className="text-slate-500 text-sm mt-1">Gestione mermas y faltantes de los pallets recién recibidos.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por SKU, nombre o LPN..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2 w-full md:w-72 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-shadow text-sm"
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Loader2 className="animate-spin text-amber-500" size={24} />
            <span className="text-sm font-medium">Cargando inventario disponible...</span>
          </div>
        ) : satos.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-3">
            <CheckCircle2 size={32} className="text-emerald-400" />
            <p className="text-sm font-medium text-slate-600">No hay productos pendientes en la zona de recepción.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">SKU / Producto</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">LPN Contenedor</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Stock Actual</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSatos.map(sato => (
                <tr key={sato.sato_id} className="hover:bg-amber-50/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-mono text-xs text-slate-500 mb-0.5">{sato.sku}</div>
                    <div className="font-semibold text-slate-800">{sato.nombre_producto}</div>
                  </td>
                  <td className="px-5 py-4">
                    {sato.lpn_padre ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-mono text-xs font-medium border border-indigo-100">
                        <Box size={14} /> {sato.lpn_padre}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs italic">Sin pallet</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-slate-800">{sato.cantidad_actual}</span>
                      <span className="text-xs text-slate-500 uppercase font-medium">un</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button 
                      onClick={() => handleOpenModal(sato)}
                      className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 hover:text-amber-700 hover:border-amber-400 hover:bg-amber-50 rounded-lg font-semibold transition-colors shadow-sm text-xs"
                    >
                      Reportar Faltante
                    </button>
                  </td>
                </tr>
              ))}
              {filteredSatos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-slate-500 text-sm">
                    No se encontraron productos que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Ajuste */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <PackageMinus className="text-amber-600" size={20} />
              Ajuste de Inventario
            </DialogTitle>
          </DialogHeader>
          
          {selectedSato && (
            <div className="space-y-4 py-3">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-2">
                <p className="text-xs text-slate-500 font-mono mb-1">{selectedSato.sku}</p>
                <p className="font-semibold text-slate-800 text-sm">{selectedSato.nombre_producto}</p>
                <div className="flex justify-between items-center mt-2 border-t border-slate-200 pt-2">
                  <span className="text-xs text-slate-500">Stock Actual (Físico)</span>
                  <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">{selectedSato.cantidad_actual}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-start gap-2 text-sm">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-700 text-sm font-semibold">Cantidad Faltante</Label>
                  <div className="relative">
                    <Input 
                      type="number"
                      min={1}
                      max={selectedSato.cantidad_actual}
                      value={cantidadRestar}
                      onChange={(e) => setCantidadRestar(e.target.value ? Number(e.target.value) : "")}
                      className="text-lg font-bold pr-10 border-slate-300 focus:border-amber-500 focus:ring-amber-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">un</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-700 text-sm font-semibold">Motivo</Label>
                  <select 
                    value={motivo}
                    onChange={(e: any) => setMotivo(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  >
                    <option value="Faltante de Origen">Faltante de Origen</option>
                    <option value="Rotura">Rotura / Daño</option>
                    <option value="Merma Operativa">Merma Operativa</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-end">
            <button
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleAjustar}
              disabled={isSubmitting}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow-md disabled:opacity-70 flex items-center gap-2"
            >
              {isSubmitting ? (
                <><Loader2 size={16} className="animate-spin" /> Procesando...</>
              ) : (
                "Confirmar Ajuste"
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
