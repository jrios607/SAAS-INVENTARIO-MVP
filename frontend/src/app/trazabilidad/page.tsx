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
  CREACION_INGRESO_LPN: "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20",
  RECEPCION: "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20",
  AJUSTE_INVENTARIO: "bg-rose-400/10 text-rose-400 border border-rose-400/20",
  AJUSTE: "bg-rose-400/10 text-rose-400 border border-rose-400/20",
  MERMA: "bg-rose-400/10 text-rose-400 border border-rose-400/20",
  MOVIMIENTO_A_VITRINA: "bg-blue-400/10 text-blue-400 border border-blue-400/20",
  MOVIMIENTO_VITRINA: "bg-blue-400/10 text-blue-400 border border-blue-400/20",
  VENTA_CAJA: "bg-purple-400/10 text-purple-400 border border-purple-400/20",
  FRACCIONAMIENTO: "bg-blue-400/10 text-blue-400 border border-blue-400/20",
  CONTEO_AUDITORIA: "bg-amber-400/10 text-amber-400 border border-amber-400/20",
  PICKING_OUTBOUND: "bg-indigo-400/10 text-indigo-400 border border-indigo-400/20",
  DEFAULT: "bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a]",
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
    `http://localhost:8000/logs?${params.toString()}`,
    fetcher
  );

  const { data: treeData, isLoading: isLoadingTree } = useSWR<SatoNode>(
    selectedSatoId ? `http://localhost:8000/logs/sato/${selectedSatoId}/arbol` : null,
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
        <div className={`p-3 rounded-lg border ${node.tipo_sato === 'CONTENEDOR' ? 'bg-blue-50 border-blue-200' : 'bg-[#0a0a0a] border-[#1f1f1f]'} flex items-center justify-between`}>
          <div className="">
            {node.tipo_sato === 'CONTENEDOR' ? <Package className="w-5 h-5 text-emerald-500" /> : <Activity className="w-5 h-5 text-gray-500" />}
            <div>
              <p className="font-semibold text-sm text-gray-300">
                {node.tipo_sato === 'CONTENEDOR' ? `LPN: ${node.lpn}` : `SKU: ${node.sku}`}
              </p>
              <p className="text-xs text-gray-500">Estado: {node.estado}</p>
            </div>
          </div>
          {node.tipo_sato === 'PRODUCTO' && (
            <span className="bg-gray-100 text-gray-300 text-xs px-2 py-1 rounded border border-[#1f1f1f] font-medium">
              Cant: {node.cantidad}
            </span>
          )}
        </div>
        {node.hijos && node.hijos.length > 0 && (
          <div className="border-l-2 border-[#1f1f1f] ml-5 pl-4 space-y-2 mt-2">
            {node.hijos.map(renderTree)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-white mb-1">Tabla de movimientos</h1>
        <p className="text-gray-500 text-sm tracking-wide mb-8">Consulta el detalle de todos los movimientos del sistema.</p>
      </div>

      {/* Filters Section */}
      <div className="bg-[#121212] p-4 rounded-xl  border border-gray-100 flex flex-wrap gap-4 items-end">
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
              className="block w-full pl-10 pr-3 py-2 border border-[#1f1f1f] rounded-lg  focus:border-neutral-600 sm:text-sm"
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
              className="block w-full pl-10 pr-8 py-2 border border-[#1f1f1f] rounded-lg  focus:border-neutral-600 sm:text-sm appearance-none bg-[#121212]"
            >
              <option value="">Todas las acciones</option>
              <option value="CREACION_INGRESO_LPN">Recepción (LPN)</option>
              <option value="MOVIMIENTO_A_VITRINA">Movimiento a Vitrina</option>
              <option value="AJUSTE_INVENTARIO">Ajuste de Inventario / Merma</option>
              <option value="FRACCIONAMIENTO">Fraccionamiento</option>
              <option value="VENTA_CAJA">Venta en Caja</option>
              <option value="CONTEO_AUDITORIA">Conteo/Auditoría</option>
              <option value="PICKING_OUTBOUND">Picking & Outbound</option>
            </select>
          </div>
        </div>

        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
          <input
            type="date"
            value={fechaInicio}
            onChange={(e) => { setFechaInicio(e.target.value); setPage(1); }}
            className="block w-full px-3 py-2 border border-[#1f1f1f] rounded-lg  focus:border-neutral-600 sm:text-sm"
          />
        </div>

        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
          <input
            type="date"
            value={fechaFin}
            onChange={(e) => { setFechaFin(e.target.value); setPage(1); }}
            className="block w-full px-3 py-2 border border-[#1f1f1f] rounded-lg  focus:border-neutral-600 sm:text-sm"
          />
        </div>

        <button
          onClick={handleSearchSubmit}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors h-[38px]"
        >
          Buscar
        </button>
      </div>

      {/* Data Table */}
      <div className="bg-[#121212] border border-[#1f1f1f] rounded-xl  overflow-hidden flex flex-col relative min-h-[400px]">
        {error && (
          <div className="absolute inset-0 bg-[#121212]/80 z-10 flex items-center justify-center">
            <p className="text-red-500 font-medium">Error al cargar los datos.</p>
          </div>
        )}
        <div className="overflow-x-auto flex-1">
          <table className="min-w-full divide-y divide-[#1f1f1f]">
            <thead className="bg-[#0a0a0a]">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="">
                    <Clock className="w-4 h-4" />
                    Fecha / Hora
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="">
                    <Package className="w-4 h-4" />
                    LPN / SKU
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="">
                    <Activity className="w-4 h-4" />
                    Acción
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="">
                    <FileText className="w-4 h-4" />
                    Detalles
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="">
                    <User className="w-4 h-4" />
                    Usuario
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#121212] divide-y divide-[#1f1f1f]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
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
                  <tr key={log.id} className="hover:bg-[#0a0a0a] transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {formatDateTime(log.fecha_hora)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200 ">
                      {log.lpn_sku_afectado || <span className="text-gray-400 italic">N/A</span>}
                      {log.sato_id && (
                        <button
                          onClick={() => setSelectedSatoId(log.sato_id)}
                          title="Ver Origen"
                          className="p-1 hover:bg-emerald-500/20 rounded text-emerald-500 transition-colors"
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {log.usuario}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-[#0a0a0a] px-6 py-3 border-t border-[#1f1f1f] flex items-center justify-between sm:px-6">
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Mostrando <span className="font-medium">{Math.min((page - 1) * limit + 1, total)}</span> a <span className="font-medium">{Math.min(page * limit, total)}</span> de <span className="font-medium">{total}</span> resultados
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md  -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-[#121212] text-sm font-medium text-gray-500 hover:bg-[#0a0a0a] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Anterior</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-[#121212] text-sm font-medium text-gray-700">
                  Página {page} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || total === 0}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-[#121212] text-sm font-medium text-gray-500 hover:bg-[#0a0a0a] disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-[#121212] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1f1f1f] flex items-center justify-between bg-[#0a0a0a]">
              <h2 className="text-lg font-bold text-gray-200 ">
                <Network className="w-5 h-5 text-emerald-500" />
                Árbol Genealógico del LPN/SKU
              </h2>
              <button
                onClick={() => setSelectedSatoId(null)}
                className="text-gray-400 hover:text-gray-400 hover:bg-gray-200 p-1 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingTree ? (
                <div className="flex justify-center items-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                </div>
              ) : treeData ? (
                <div className="bg-[#121212]">
                  {renderTree(treeData)}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-10">
                  No se pudo cargar el Origen.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
