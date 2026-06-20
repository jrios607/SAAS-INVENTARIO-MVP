"use client";

import React, { useState, useEffect } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, Loader2, Save, AlertCircle, X, Package, Tags, Layers } from 'lucide-react';
import { CatalogTable, CatalogProduct } from '@/components/catalogo/CatalogTable';
import { getStockAgrupado, createProducto, Producto } from '@/services/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HybridInput } from '@/components/HybridInput';

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
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filtros
  const [familiaFilter, setFamiliaFilter] = useState<string>('');
  const [subFamiliaFilter, setSubFamiliaFilter] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<string>('');

  // Estados para Modales
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Producto>>(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const data = await getStockAgrupado();
      
      const flatProducts: CatalogProduct[] = [];
      data.forEach(grupo => {
        grupo.sub_familias.forEach(sub => {
          sub.productos.forEach(prod => {
            flatProducts.push({
              sku: prod.sku || '',
              nombre: prod.nombre || '',
              ean: prod.ean || '',
              familia: grupo.familia || 'Sin Familia',
              subFamilia: sub.nombre_sub_familia || 'General',
              stockSubFamilia: sub.stock_sub_familia || 0,
              stock: prod.stock_individual || 0,
              stockGlobalFamilia: grupo.stock_global_familia || 0
            });
          });
        });
      });
      
      setProducts(flatProducts);
    } catch (err) {
      console.error("Error loading products:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreateModal = () => {
    setFormData(INITIAL_FORM);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.sku?.trim() || !formData.nombre?.trim() || !formData.ean?.trim()) {
      setError("SKU, Nombre y EAN son obligatorios.");
      return;
    }
    
    setIsSaving(true);
    setError(null);
    
    try {
      const productPayload = {
        ...formData,
        tolerancia_vencimiento_dias: formData.tolerancia_vencimiento_dias || 0
      };
      await createProducto(productPayload as Omit<Producto, "tolerancia_vencimiento_dias"> & { tolerancia_vencimiento_dias: number });
      setIsModalOpen(false);
      await loadData();
    } catch (e: any) {
      setError(e.message || "Error al procesar la solicitud.");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = p.sku.toLowerCase().includes(term) ||
                          p.nombre.toLowerCase().includes(term) ||
                          p.ean.includes(searchTerm);
                          
    const matchesFamilia = familiaFilter === '' || p.familia === familiaFilter;
    const matchesSubFamilia = subFamiliaFilter === '' || p.subFamilia === subFamiliaFilter;
    
    let matchesStock = true;
    if (stockFilter === 'con_stock') matchesStock = p.stock > 0;
    if (stockFilter === 'sin_stock') matchesStock = p.stock === 0;

    return matchesSearch && matchesFamilia && matchesSubFamilia && matchesStock;
  });

  // Unique Familias for dropdown
  const familias = React.useMemo(() => {
    return Array.from(new Set(products.map(p => p.familia)));
  }, [products]);

  // Derived Sub Familias based on selected Familia
  const subFamilias = React.useMemo(() => {
    if (familiaFilter === '') {
      return Array.from(new Set(products.map(p => p.subFamilia)));
    }
    const filteredByFamily = products.filter(p => p.familia === familiaFilter);
    return Array.from(new Set(filteredByFamily.map(p => p.subFamilia)));
  }, [products, familiaFilter]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Catálogo de Productos</h1>
        <p className="text-slate-500 text-sm mt-1">Gestión centralizada de SKUs, Familias y existencias.</p>
      </div>

      {/* ── Métricas Globales ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Stock Global</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{products.reduce((acc, p) => acc + p.stock, 0).toLocaleString()}</p>
          </div>
          <div className="h-12 w-12 bg-indigo-50 rounded-full flex items-center justify-center">
            <Package className="h-6 w-6 text-indigo-600" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Total SKUs</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{products.length.toLocaleString()}</p>
          </div>
          <div className="h-12 w-12 bg-blue-50 rounded-full flex items-center justify-center">
            <Tags className="h-6 w-6 text-blue-600" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Familias Activas</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{familias.length}</p>
          </div>
          <div className="h-12 w-12 bg-emerald-50 rounded-full flex items-center justify-center">
            <Layers className="h-6 w-6 text-emerald-600" />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        
        <div className="flex flex-wrap md:flex-nowrap items-center gap-3 w-full md:w-auto">
          <div className="relative w-full md:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Buscar por SKU, EAN o Nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors shadow-sm"
            />
          </div>

          <select 
            value={familiaFilter}
            onChange={(e) => {
              setFamiliaFilter(e.target.value);
              setSubFamiliaFilter(''); // Reset dependent state
            }}
            className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm cursor-pointer"
          >
            <option value="">Todas las Familias</option>
            {familias.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <select 
            value={subFamiliaFilter}
            onChange={(e) => setSubFamiliaFilter(e.target.value)}
            className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm cursor-pointer"
          >
            <option value="">Todas las Sub Familias</option>
            {subFamilias.map(sf => <option key={sf} value={sf}>{sf}</option>)}
          </select>
          
          <select 
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm cursor-pointer"
          >
            <option value="">Todo el Stock</option>
            <option value="con_stock">Con Stock</option>
            <option value="sin_stock">Agotado</option>
          </select>
        </div>

        <button 
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 h-10 px-5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 hover:shadow-md hover:-translate-y-0.5 transition-all w-full md:w-auto justify-center shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nuevo Producto
        </button>
      </div>

      <CatalogTable 
        products={filteredProducts} 
        isLoading={isLoading} 
      />

      <div className="flex items-center justify-between border-t border-slate-200 pt-4 mt-6">
        <p className="text-sm text-slate-500 font-medium">
          Mostrando <span className="text-slate-900 font-semibold">{filteredProducts.length > 0 ? 1 : 0}-{filteredProducts.length > 50 ? 50 : filteredProducts.length}</span> de <span className="text-slate-900 font-semibold">{products.length}</span> productos
        </p>
        
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled>
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <button className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50" disabled={filteredProducts.length <= 50}>
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Modal Nativo de Tailwind ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-indigo-500" />
                Nuevo Producto
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-700 font-semibold text-sm">SKU <span className="text-red-500">*</span></Label>
                  <Input
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="Ej: PAN-HMB-XL"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-700 font-semibold text-sm">EAN / GS1 <span className="text-red-500">*</span></Label>
                  <HybridInput
                    value={formData.ean || ''}
                    onChange={(val) => setFormData({ ...formData, ean: val })}
                    placeholder="Ej: 7802000000001"
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

              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-slate-700 font-semibold text-sm">Familia Global</Label>
                  <select
                    value={formData.familia || ''}
                    onChange={(e) => setFormData({ ...formData, familia: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
                  >
                    <option value="" disabled>Seleccione familia...</option>
                    <option value="Abarrotes">Abarrotes</option>
                    <option value="Vestuario">Vestuario</option>
                    <option value="Calzado">Calzado</option>
                    <option value="Fiambrería y Lácteos">Fiambrería y Lácteos</option>
                    <option value="Carnicería">Carnicería</option>
                    <option value="Limpieza y Hogar">Limpieza y Hogar</option>
                    <option value="Frescos">Frescos</option>
                  </select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-slate-700 font-semibold text-sm">Sub Familia</Label>
                  <Input
                    value={formData.sub_familia || ''}
                    onChange={(e) => setFormData({ ...formData, sub_familia: e.target.value })}
                    placeholder="Ej: Aceites"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-700 font-semibold text-sm">Proveedor / Marca</Label>
                  <Input
                    value={formData.proveedor_marca || ''}
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
                  value={formData.tolerancia_vencimiento_dias || 0}
                  onChange={(e) => setFormData({ ...formData, tolerancia_vencimiento_dias: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
                className="px-4 py-2.5 text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSaving}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-sm hover:shadow"
              >
                {isSaving
                  ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
                  : <><Save size={16} /> Crear Producto</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
