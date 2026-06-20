"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageSearch, ArrowRight, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { getOlasPicking } from '@/services/api';

interface Ola {
  id: number;
  estado: string;
}

export default function PickingDashboardPage() {
  const [olas, setOlas] = useState<Ola[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOlasPicking()
      .then((data) => {
        setOlas(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Preparación de Pedidos</h1>
        <p className="text-slate-500 mt-2">Gestiona las olas de picking activas y asigables a los operarios.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[300px]">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : olas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <PackageSearch className="w-12 h-12 mb-4 text-slate-300" />
            <p>No hay olas de picking generadas en este momento.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase">Ola ID</th>
                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase">Estado</th>
                <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {olas.map((ola) => (
                <tr key={ola.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900">
                    Ola #{ola.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {ola.estado === 'COMPLETADA' ? (
                       <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                         <CheckCircle2 size={14} /> Completada
                       </span>
                    ) : (
                       <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
                         <Clock size={14} /> {ola.estado}
                       </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link 
                      href={`/picking/ola/${ola.id}`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {ola.estado === 'COMPLETADA' ? 'Ver Detalles' : 'Iniciar Picking'}
                      <ArrowRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
