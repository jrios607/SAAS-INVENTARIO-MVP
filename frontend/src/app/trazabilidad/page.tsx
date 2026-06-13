"use client";

import React, { useState } from 'react';
import useSWR from 'swr';
import { Search, Filter, Clock, User, Package, ChevronLeft, ChevronRight, Activity, FileText, Network, X } from 'lucide-react';

interface LogItem {
  id: number;
  fecha_hora: string;
  accion: string;
  detalles: string | null;
  usuario: string;
  lpn_sku_afectado: string | null;
  sato_id: string;
}

interface LogResponse {
  items: LogItem[];
  total: number;
  limit: number;
  offset: number;
}

interface SatoNode {
  sato_id: string;
  tipo_sato: string;
  lpn: string | null;
  sku: string | null;
  cantidad: number | null;
  estado: string;
  hijos: SatoNode[];
}

const ACTION_COLORS: Record<string, string> = {
  CREACION_INGRESO_LPN: "bg-emerald-100 text-emerald-800 border-emerald-200",
  RECEPCION: "bg-emerald-100 text-emerald-800 border-emerald-200",
  AJUSTE_INVENTARIO: "bg-red-100 text-red-800 border-red-200",
  AJUSTE: "bg-red-100 text-red-800 border-red-200",
  MERMA: "bg-red-100 text-red-800 border-red-200",
  MOVIMIENTO_A_VITRINA: "bg-blue-100 text-blue-800 border-blue-200",
  MOVIMIENTO_VITRINA: "bg-blue-100 text-blue-800 border-blue-200",
  VENTA_CAJA: "bg-purple-100 text-purple-800 border-purple-200",
  FRACCIONAMIENTO: "bg-blue-100 text-blue-800 border-blue-200",
  CONTEO_AUDITORIA: "bg-amber-100 text-amber-800 border-amber-200",
  DEFAULT: "bg-gray-100 text-gray-800 border-gray-200",
};

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function TrazabilidadPage() {
  const [page, setPage] = useState(1);
  const limit = 20;
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [accionFilter, setAccionFilter] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  // Modal State
  const [selectedSatoId, setSelectedSatoId] = useState<string | null>(null);

  const offset = (page - 1) * limit;
  const params = new URLSearchParams({ 
    limit: limit.toString(), 
    offset: offset.toString() 
  });
  
  if (searchQuery) params.append('q', searchQuery);
  if (accionFilter) params.append('accion', accionFilter);
  if (fechaInicio) params.append('fecha_inicio', fechaInicio);
  if (fechaFin) params.append('fecha_fin', fechaFin);

  const { data, error, isLoading } = useSWR<LogResponse>(
    `http://localhost:8000/trazabilidad/logs?${params.toString()}`,
    fetcher
  );

  const { data: treeData, isLoading: isLoadingTree } = useSWR<SatoNode>(
    selectedSatoId ? `http://localhost:8000/trazabilidad/arbol/${selectedSatoId}` : null,
    fetcher
  );

  const logs = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  };

  const renderTree = (node: SatoNode) => {
    return (
      <div key={node.sato_id} className="mt-3">
        <div className={`p-3 rounded-lg border ${node.tipo_sato === 'CONTENEDOR' ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
             {node.tipo_sato === 'CONTENEDOR' ? <Package className="w-5 h-5 text-blue-600" /> : <Activity className="w-5 h-5 text-gray-500" />}
             <div>
                <p className="font-semibold text-sm text-gray-800">
                  {node.tipo_sato === 'CONTENEDOR' ? `LPN: ${node.lpn}` : `SKU: ${node.sku}`}
                </p>
                <p className="text-xs text-gray-500">Estado: {node.estado}</p>
             </div>
          </div>
          {node.tipo_sato === 'PRODUCTO' && (
            <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded border border-gray-200 font-medium">
              Cant: {node.cantidad}
            </span>
          )}
        </div>
        {node.hijos && node.hijos.length > 0 && (
          <div className="border-l-2 border-gray-200 ml-5 pl-4 space-y-2 mt-2">
            {node.hijos.map(renderTree)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard Forense</h1>
        <p className="text-gray-500 mt-2">Trazabilidad total de LPNs y SKUs en el ciclo de vida del WMS.</p>
      </div>

      {/* Filters Section */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[250px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Buscar LPN o SKU</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Ej: 8089962588 o SKU..."
            />
          </div>
        </form>

        <div className="w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Acción</label>
          <div className="relative">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Filter className="h-4 w-4 text-gray-400" />
            </div>
            <select
              value={accionFilter}
              onChange={(e) => { setAccionFilter(e.target.value); setPage(1); }}
              className="block w-full pl-10 pr-8 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none bg-white"
            >
              <option value="">Todas las acciones</option>
              <option value="CREACION_INGRESO_LPN">Recepción (LPN)</option>
              <option value="MOVIMIENTO_A_VITRINA">Movimiento a Vitrina</option>
              <option value="AJUSTE_INVENTARIO">Ajuste de Inventario / Merma</option>
              <option value="FRACCIONAMIENTO">Fraccionamiento</option>
              <option value="VENTA_CAJA">Venta en Caja</option>
              <option value="CONTEO_AUDITORIA">Conteo/Auditoría</option>
            </select>
          </div>
        </div>

        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
          <input
            type="date"
            value={fechaInicio}
            onChange={(e) => { setFechaInicio(e.target.value); setPage(1); }}
            className="block w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
          <input
            type="date"
            value={fechaFin}
            onChange={(e) => { setFechaFin(e.target.value); setPage(1); }}
            className="block w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <button 
          onClick={handleSearchSubmit}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors h-[38px]"
        >
          Buscar
        </button>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col relative min-h-[400px]">
        {error && (
           <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
              <p className="text-red-500 font-medium">Error al cargar los datos.</p>
           </div>
        )}
        <div className="overflow-x-auto flex-1">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Fecha / Hora
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    LPN / SKU
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Acción
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Detalles
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Usuario
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    No se encontraron registros de trazabilidad.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDateTime(log.fecha_hora)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 flex items-center gap-2">
                      {log.lpn_sku_afectado || <span className="text-gray-400 italic">N/A</span>}
                      {log.sato_id && (
                        <button 
                          onClick={() => setSelectedSatoId(log.sato_id)}
                          title="Ver Árbol Genealógico"
                          className="p-1 hover:bg-blue-100 rounded text-blue-600 transition-colors"
                        >
                          <Network className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${ACTION_COLORS[log.accion] || ACTION_COLORS.DEFAULT}`}>
                        {log.accion}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={log.detalles || ''}>
                      {log.detalles || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {log.usuario}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex items-center justify-between sm:px-6">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Mostrando <span className="font-medium">{Math.min((page - 1) * limit + 1, total)}</span> a <span className="font-medium">{Math.min(page * limit, total)}</span> de <span className="font-medium">{total}</span> resultados
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Anterior</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                  Página {page} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || total === 0}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Siguiente</span>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* SATO Tree Modal */}
      {selectedSatoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Network className="w-5 h-5 text-blue-600" />
                Árbol Genealógico del LPN/SKU
              </h2>
              <button 
                onClick={() => setSelectedSatoId(null)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 p-1 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingTree ? (
                <div className="flex justify-center items-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : treeData ? (
                <div className="bg-white">
                  {renderTree(treeData)}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-10">
                  No se pudo cargar la jerarquía.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
