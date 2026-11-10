import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, Pencil, Trash2, ChevronRight, ChevronDown, Snowflake, Thermometer, Box, AlertTriangle, CalendarClock, PlusCircle, SlidersHorizontal, Printer } from 'lucide-react';
import { LoteDetalleFEFO } from '@/services/api';

export interface CatalogProduct {
  sku: string;
  nombre: string;
  ean: string;
  dun14?: string | null;
  unidades_por_caja: number;
  unidad_medida: string;
  temperatura_requerida: string;
  stock_minimo: number;
  dias_alerta_vencimiento: number;
  tolerancia_vencimiento_dias: number;
  controla_vencimiento: boolean;
  dias_vida_util?: number | null;
  costo_unitario: number;
  es_ghost_sku: boolean;
  proveedor_marca: string;
  familia: string;
  subFamilia: string;
  stockSubFamilia: number;
  stock: number;
  stockVitrina: number;
  stockBodega: number;
  proximaFechaVencimiento?: string | null;
  alertaVencimiento: string;
  stockGlobalFamilia?: number;
  clase_abc?: string;
  es_perecible_corto?: boolean;
  venta_valorizada_ventana?: number;
  lotes: LoteDetalleFEFO[];
}

interface CatalogTableProps {
  products?: CatalogProduct[];
  isLoading?: boolean;
  onEdit?: (product: CatalogProduct) => void;
  onDelete?: (product: CatalogProduct) => void;
  onAddStock?: (product: CatalogProduct) => void;
  onEditLote?: (product: CatalogProduct, lote: LoteDetalleFEFO) => void;
  onPrintLabel?: (product: CatalogProduct) => void;
}

export function CatalogTable({ products = [], isLoading, onEdit, onDelete, onAddStock, onEditLote, onPrintLabel }: CatalogTableProps) {
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

  const renderTempBadge = (temp: string) => {
    const raw = (temp || 'SECO').toUpperCase();
    const isCongelado = raw.includes('CONGELADO') || raw.includes('FROZEN') || raw.includes('18');
    const isRefrigerado = raw.includes('REFRIGER') || raw.includes('FRIO') || raw.includes('0_5');
    if (isCongelado) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
          <Snowflake size={11} /> Congelado
        </span>
      );
    }
    if (isRefrigerado) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
          <Thermometer size={11} /> Refrigerado
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-800 text-gray-300 border border-neutral-700">
        <Box size={11} /> Seco / Ambiente
      </span>
    );
  };

  const renderAlertaFEFO = (product: CatalogProduct) => {
    if (!product.proximaFechaVencimiento) {
      return <span className="text-xs text-gray-500">Sin lote c/venc.</span>;
    }
    const alerta = product.alertaVencimiento;
    const badgeClass =
      alerta === 'VENCIDO'
        ? 'bg-red-500/20 text-red-300 border-red-500/40'
        : alerta === 'CRITICO'
        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
        : alerta === 'PROXIMO'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

    return (
      <div className="flex flex-col gap-1">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border w-fit ${badgeClass}`}>
          <CalendarClock size={11} />
          {product.proximaFechaVencimiento}
        </span>
        {alerta !== 'OK' && (
          <span className="text-[10px] font-medium text-amber-400">
            {alerta === 'VENCIDO' ? 'Lote vencido' : alerta === 'CRITICO' ? 'Vencimiento crítico' : 'Próximo a vencer'}
          </span>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-[#121212] rounded-xl border border-[#1f1f1f] overflow-hidden min-h-[400px] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-[#1f1f1f] rounded-full mb-4"></div>
          <div className="h-4 w-32 bg-[#1f1f1f] rounded"></div>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-[#121212] rounded-xl border border-[#1f1f1f] border-dashed overflow-hidden min-h-[320px] flex items-center justify-center">
        <div className="flex flex-col items-center text-gray-400">
          <div className="p-3 bg-[#0a0a0a] rounded-full mb-3">
            <Box size={24} className="text-gray-500" />
          </div>
          <p className="text-sm font-medium text-gray-300">No se encontraron productos con los filtros actuales.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#121212] rounded-xl border border-[#1f1f1f] overflow-visible pb-12" ref={menuRef}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[#0a0a0a] text-gray-400 border-b border-[#1f1f1f] text-xs uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-4 py-4 w-10"></th>
              <th scope="col" className="px-5 py-4 font-semibold">SKU / Producto</th>
              <th scope="col" className="px-5 py-4 font-semibold">EAN / Empaque DUN-14</th>
              <th scope="col" className="px-5 py-4 font-semibold">Familia / Cadena Frío</th>
              <th scope="col" className="px-5 py-4 font-semibold">Próx. Vencimiento (FEFO)</th>
              <th scope="col" className="px-5 py-4 font-semibold">Existencias (Vitrina / Bodega)</th>
              <th scope="col" className="px-5 py-4 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1f1f1f]">
            {products.map((product) => {
              const isExpanded = expandedRows.has(product.sku);
              const lotes = product.lotes || [];
              const bajoMinimo = product.stock > 0 && product.stock <= product.stock_minimo;

              return (
                <React.Fragment key={product.sku}>
                  <tr
                    className="hover:bg-[#181818] transition-colors duration-150 cursor-pointer group"
                    onClick={(e) => toggleExpand(product.sku, e)}
                  >
                    <td className="px-4 py-4 text-gray-400 group-hover:text-indigo-400 transition-colors">
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-white truncate max-w-[260px]" title={product.nombre}>
                          {product.nombre}
                        </div>
                        {(() => {
                          const abc = (product.clase_abc || 'B').toUpperCase();
                          const badgeStyle =
                            abc === 'A'
                              ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40'
                              : abc === 'C'
                              ? 'bg-neutral-800 text-gray-400 border-neutral-700'
                              : 'bg-sky-500/20 text-sky-300 border-sky-500/40';
                          return (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${badgeStyle}`}>
                              Clase {abc}
                            </span>
                          );
                        })()}
                        {product.es_ghost_sku && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <AlertTriangle size={10} /> Ghost SKU
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-indigo-300">{product.sku}</span>
                        {product.sku.toUpperCase().startsWith('PLU-') && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            PLU Interno
                          </span>
                        )}
                        {product.proveedor_marca && (
                          <span className="text-gray-500">• {product.proveedor_marca}</span>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="text-gray-200 font-mono text-xs">{product.ean}</div>
                      {product.dun14 ? (
                        <div className="text-[11px] text-emerald-400 font-mono mt-0.5">
                          DUN: {product.dun14} ({product.unidades_por_caja} {product.unidad_medida}/caja)
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                          {['KG', 'GR'].includes(product.unidad_medida.toUpperCase()) ? (
                            <span className="text-amber-400 font-semibold flex items-center gap-1">
                              ⚖️ Granel / Pesable ({product.unidad_medida})
                            </span>
                          ) : (
                            <span>Venta por {product.unidad_medida} {product.unidades_por_caja > 1 ? `(${product.unidades_por_caja}/caja)` : ''}</span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${product.familia === 'Sin Familia' ? 'bg-[#1f1f1f] text-gray-300 border-[#2a2a2a]' : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'}`}>
                          {product.familia}
                        </span>
                        {renderTempBadge(product.temperatura_requerida)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{product.subFamilia}</div>
                    </td>

                    <td className="px-5 py-4">
                      {renderAlertaFEFO(product)}
                    </td>

                    <td className="px-5 py-4">
                      {product.stock > 0 ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${bajoMinimo ? 'bg-amber-400' : 'bg-emerald-500'}`}></div>
                            <span className={`font-semibold ${bajoMinimo ? 'text-amber-300' : 'text-emerald-400'}`}>
                              {product.stock.toLocaleString()} {product.unidad_medida}
                            </span>
                            {bajoMinimo && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Bajo Mín. ({product.stock_minimo})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            Vitrina: <span className="text-gray-200 font-medium">{product.stockVitrina}</span> • Bodega: <span className="text-gray-200 font-medium">{product.stockBodega}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          Agotado (0 {product.unidad_medida})
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-right relative">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {onPrintLabel && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPrintLabel(product);
                            }}
                            title="Imprimir Etiqueta PLU / Código de Barras"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
                          >
                            <Printer size={13} />
                            Etiqueta
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddStock?.(product);
                          }}
                          title="Ingresar stock o nuevo lote directo"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                        >
                          <PlusCircle size={13} />
                          + Stock
                        </button>
                        <button
                          onClick={(e) => toggleMenu(product.sku, e)}
                          className="text-gray-400 hover:text-white transition-colors rounded-lg p-1.5 hover:bg-[#222222] focus:outline-none"
                        >
                          <MoreVertical size={18} />
                        </button>
                      </div>
                      {openMenu === product.sku && (
                        <div className="absolute right-8 top-11 w-56 bg-[#181818] rounded-xl shadow-2xl border border-[#2a2a2a] z-50 py-1.5 animate-in fade-in zoom-in-95 duration-100">
                          {onPrintLabel && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenu(null);
                                onPrintLabel(product);
                              }}
                              className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-indigo-300 hover:bg-indigo-500/15 transition-colors"
                            >
                              <Printer size={14} className="text-indigo-400" />
                              Imprimir Etiqueta PLU / Código
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenu(null);
                              onAddStock?.(product);
                            }}
                            className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/15 transition-colors"
                          >
                            <PlusCircle size={14} className="text-emerald-400" />
                            Ingresar Stock / Lote
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenu(null);
                              onEdit?.(product);
                            }}
                            className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-gray-200 hover:bg-[#242424] transition-colors"
                          >
                            <Pencil size={14} className="text-indigo-400" />
                            Editar Ficha Producto
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenu(null);
                              onDelete?.(product);
                            }}
                            className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-rose-400 hover:bg-rose-500/15 transition-colors"
                          >
                            <Trash2 size={14} className="text-rose-400" />
                            Eliminar / Baja
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-[#0c0c0c] border-y border-[#1f1f1f]">
                      <td colSpan={7} className="px-8 py-4">
                        <div className="bg-[#141414] rounded-xl border border-[#242424] overflow-hidden">
                          <div className="px-5 py-2.5 bg-[#1a1a1a] border-b border-[#242424] flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-300">
                              Desglose Real de Lotes Activos (`Sato`) — Ordenados por Prioridad de Salida FEFO
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">
                                {lotes.length} lote(s) con existencias
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddStock?.(product);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                              >
                                <PlusCircle size={12} />
                                Agregar Lote / Stock
                              </button>
                            </div>
                          </div>
                          <table className="w-full text-left text-xs whitespace-nowrap">
                            <thead className="bg-[#161616] text-gray-400 border-b border-[#242424]">
                              <tr>
                                <th scope="col" className="px-5 py-2.5 font-semibold">Orden FEFO</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold">ID Lote / SATO</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold">Marca / Proveedor</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold">Vencimiento</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold">Ubicación Actual</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold text-right">Cantidad Activa</th>
                                <th scope="col" className="px-5 py-2.5 font-semibold text-right">Ajustar Cantidad</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#222222]">
                              {lotes.map((lote, idx) => (
                                <tr key={lote.sato_id || idx} className="hover:bg-[#1c1c1c] transition-colors">
                                  <td className="px-5 py-2.5">
                                    {idx === 0 ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                        #1 Prioridad FEFO
                                      </span>
                                    ) : (
                                      <span className="text-gray-500 font-mono">#{idx + 1}</span>
                                    )}
                                  </td>
                                  <td className="px-5 py-2.5 font-mono text-gray-200">{lote.id_lote}</td>
                                  <td className="px-5 py-2.5 text-gray-300">{lote.proveedor}</td>
                                  <td className="px-5 py-2.5">
                                    <span className="text-gray-200 font-medium">{lote.fecha_vencimiento}</span>
                                    {typeof lote.dias_restantes === 'number' && (
                                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                        lote.dias_restantes < 0
                                          ? 'bg-red-500/20 text-red-300'
                                          : lote.dias_restantes <= 7
                                          ? 'bg-amber-500/20 text-amber-300'
                                          : 'bg-emerald-500/15 text-emerald-300'
                                      }`}>
                                        {lote.dias_restantes < 0
                                          ? `Vencido (${Math.abs(lote.dias_restantes)}d)`
                                          : `${lote.dias_restantes} días`}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-5 py-2.5">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#222222] text-gray-200 border border-[#333333]">
                                      {lote.ubicacion}
                                    </span>
                                  </td>
                                  <td className="px-5 py-2.5 font-semibold text-emerald-400 text-right">
                                    {lote.stock.toLocaleString()} {product.unidad_medida}
                                  </td>
                                  <td className="px-5 py-2.5 text-right">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onEditLote?.(product, lote);
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
                                    >
                                      <SlidersHorizontal size={12} />
                                      Editar Cantidad
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {lotes.length === 0 && (
                                <tr>
                                  <td colSpan={7} className="px-5 py-6 text-center text-gray-500 italic">
                                    Sin lotes activos en Vitrina ni Bodega para este SKU. Haga clic en &quot;Agregar Lote / Stock&quot; arriba para cargar existencias.
                                  </td>
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
