import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-react';

export interface CatalogLote {
  id_lote: string;
  proveedor: string;
  fecha_vencimiento: string;
  ubicacion: string;
  stock: number;
}

export interface CatalogProduct {
  sku: string;
  nombre: string;
  ean: string;
  familia: string;
  subFamilia: string;
  stockSubFamilia: number;
  stock: number;
  stockGlobalFamilia?: number;
  lotes?: CatalogLote[];
}

interface CatalogTableProps {
  products?: CatalogProduct[];
  isLoading?: boolean;
}

export function CatalogTable({ products = [], isLoading }: CatalogTableProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleMenu = (sku: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenu(openMenu === sku ? null : sku);
  };

  const toggleExpand = (sku: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(sku)) {
      newExpanded.delete(sku);
    } else {
      newExpanded.add(sku);
    }
    setExpandedRows(newExpanded);
  };

  const handleEdit = (sku: string, e: React.MouseEvent) => {
    e.stopPropagation();
    alert(`La edición para el SKU ${sku} estará disponible en la próxima actualización del backend.`);
    setOpenMenu(null);
  };

  const handleDelete = (sku: string, e: React.MouseEvent) => {
    e.stopPropagation();
    alert(`La eliminación del SKU ${sku} estará disponible en la próxima actualización del backend.`);
    setOpenMenu(null);
  };

  const getLotes = (product: CatalogProduct): CatalogLote[] => {
    if (product.lotes && product.lotes.length > 0) return product.lotes;
    if (product.stock === 0) return [];
    
    // Generar mock data si no hay lotes
    const stockA = Math.max(1, Math.floor(product.stock * 0.7));
    const stockB = product.stock - stockA;
    
    const mockLotes: CatalogLote[] = [
      {
        id_lote: `L-${product.sku.substring(0, 3).toUpperCase()}-001`,
        proveedor: "Proveedor Principal S.A.",
        fecha_vencimiento: "2026-12-31",
        ubicacion: "Bodega Central - Pasillo A",
        stock: stockA,
      }
    ];
    
    if (stockB > 0) {
      mockLotes.push({
        id_lote: `L-${product.sku.substring(0, 3).toUpperCase()}-002`,
        proveedor: "Distribuidora Secundaria",
        fecha_vencimiento: "2027-06-15",
        ubicacion: "Vitrina Tienda",
        stock: stockB,
      });
    }
    
    return mockLotes;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-slate-200 rounded-full mb-4"></div>
          <div className="h-4 w-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 border-dashed overflow-hidden min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center text-slate-400">
          <div className="p-3 bg-slate-50 rounded-full mb-3">
            <MoreVertical size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium">No se encontraron productos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible pb-16" ref={menuRef}>
      <div className="overflow-x-visible">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
            <tr>
              <th scope="col" className="px-4 py-4 w-10"></th>
              <th scope="col" className="px-6 py-4 font-medium">SKU / Producto</th>
              <th scope="col" className="px-6 py-4 font-medium">EAN</th>
              <th scope="col" className="px-6 py-4 font-medium">Familia</th>
              <th scope="col" className="px-6 py-4 font-medium">Sub Familia</th>
              <th scope="col" className="px-6 py-4 font-medium">Stock Individual</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {products.map((product) => {
              const isExpanded = expandedRows.has(product.sku);
              const lotes = getLotes(product);

              return (
                <React.Fragment key={product.sku}>
                  <tr 
                    className="hover:bg-slate-50 transition-colors duration-150 cursor-pointer group"
                    onClick={(e) => toggleExpand(product.sku, e)}
                  >
                    <td className="px-4 py-4 text-slate-400 group-hover:text-indigo-500 transition-colors">
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 truncate max-w-[250px]" title={product.nombre}>
                        {product.nombre}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {product.sku}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                      {product.ean}
                    </td>
                    
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${product.familia === 'Sin Familia' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                        {product.familia}
                      </span>
                    </td>
                    
                    <td className="px-6 py-4">
                      <span className="text-slate-700 font-medium text-sm">{product.subFamilia}</span>
                    </td>
                    
                    <td className="px-6 py-4">
                      {product.stock > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm"></div>
                          <span className="font-medium text-emerald-700">{product.stock.toLocaleString()}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                          Agotado
                        </span>
                      )}
                    </td>
                    
                    <td className="px-6 py-4 text-right relative">
                      <button 
                        onClick={(e) => toggleMenu(product.sku, e)}
                        className="text-slate-400 hover:text-slate-600 transition-colors rounded p-1 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <MoreVertical size={20} />
                      </button>
                      {openMenu === product.sku && (
                        <div className="absolute right-8 top-10 w-36 bg-white rounded-lg shadow-lg border border-slate-200 z-50 py-1.5 animate-in fade-in zoom-in-95 duration-100">
                          <button 
                            onClick={(e) => handleEdit(product.sku, e)} 
                            className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Pencil size={14} className="text-slate-400" />
                            Editar
                          </button>
                          <button 
                            onClick={(e) => handleDelete(product.sku, e)} 
                            className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} className="text-red-400" />
                            Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  
                  {isExpanded && (
                    <tr className="bg-slate-50 border-y border-slate-100 shadow-inner">
                      <td colSpan={7} className="px-8 py-5">
                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                          <table className="w-full text-left text-xs whitespace-nowrap">
                            <thead className="bg-slate-100 text-slate-500 border-b border-slate-200">
                              <tr>
                                <th scope="col" className="px-5 py-3 font-semibold">ID Lote / SATO</th>
                                <th scope="col" className="px-5 py-3 font-semibold">Proveedor</th>
                                <th scope="col" className="px-5 py-3 font-semibold">Fecha Venc. (FEFO)</th>
                                <th scope="col" className="px-5 py-3 font-semibold">Ubicación</th>
                                <th scope="col" className="px-5 py-3 font-semibold text-right">Stock</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {lotes.map((lote, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-5 py-3 font-mono text-slate-700">{lote.id_lote}</td>
                                  <td className="px-5 py-3 text-slate-600">{lote.proveedor}</td>
                                  <td className="px-5 py-3 text-slate-600 font-medium">{lote.fecha_vencimiento}</td>
                                  <td className="px-5 py-3 text-slate-600">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                                      {lote.ubicacion}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 font-medium text-slate-700 text-right">{lote.stock} un</td>
                                </tr>
                              ))}
                              {lotes.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-5 py-6 text-center text-slate-400 italic">No hay detalles de lote disponibles para este producto.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
