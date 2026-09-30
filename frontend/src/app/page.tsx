"use client";

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const financialData = [
  { mes: 'Ene', Ganancias: 4500000, Perdidas: 800000 },
  { mes: 'Feb', Ganancias: 5200000, Perdidas: 600000 },
  { mes: 'Mar', Ganancias: 4800000, Perdidas: 900000 },
  { mes: 'Abr', Ganancias: 6100000, Perdidas: 400000 },
  { mes: 'May', Ganancias: 5900000, Perdidas: 500000 },
  { mes: 'Jun', Ganancias: 7200000, Perdidas: 300000 },
];

export default function DashboardDarkPremium() {
  return (
    <div className="p-8">
      {/* Título de Página */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-gray-800 text-gray-300 border border-gray-700 px-2 py-1 rounded text-xs font-bold">
              BVC
            </span>
            <h2 className="text-3xl font-bold text-white tracking-tight">Centro de información</h2>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-gray-400 text-sm">Métricas Operativas</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Sistemas Activos</div>
            <div className="text-sm text-white font-medium">4 / 4 SISTEMAS</div>
          </div>
          <button className="bg-white text-black hover:bg-gray-200 transition-colors px-6 py-2.5 rounded-lg text-sm font-bold shadow-lg">
            Generar Reporte
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

        <div className="bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Flujo de Caja (Hoy)</div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-light text-white">TEST</h3>
            <span className="text-sm text-gray-500 font-medium">Visual</span>
          </div>
          <p className="text-xs text-gray-500 mt-4">Visual de ganancias (Próximamente)</p>
        </div>

        <div className="bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Pérdida Proyectada</div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-light text-white">TEST</h3>
            <span className="text-sm text-gray-500 font-medium">Visual</span>
          </div>
          <p className="text-xs text-gray-500 mt-4">Mermas por vencimiento (Próximamente)</p>
        </div>

        <div className="bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Stock Total</div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-light text-white">TEST</h3>
            <span className="text-sm text-gray-500 font-medium">Visual</span>
          </div>
          <p className="text-xs text-gray-500 mt-4">Bodega (Cantidad) + Vitrina (Cantidad)</p>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* Gráfico */}
        <div className="lg:col-span-2 bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6 flex flex-col">
          <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold mb-8">
            Desempeño Semestral
          </div>

          <div className="flex-1 w-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData} margin={{ top: 0, right: 0, left: 10, bottom: 0 }} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f1f1f" />
                <XAxis
                  dataKey="mes"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#666', fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#666', fontSize: 12 }}
                  tickFormatter={(value) => `\$${Math.floor(value / 1000)}k`}
                />
                <Tooltip
                  cursor={{ fill: '#1a1a1a' }}
                  contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: '8px' }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: '#888' }}
                />
                <Bar name="Ingresos Brutos" dataKey="Ganancias" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Bar name="Mermas" dataKey="Perdidas" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mapa Visual / Logs */}
        <div className="lg:col-span-1 bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6 flex flex-col">
          <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold mb-6">
            Sistemas
          </div>

          <div className="space-y-4 flex-1">

            {/* Log 1 */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
              <div className="flex justify-between items-start mb-1">
                <h4 className="text-sm font-bold text-white">Terminal Caja 1</h4>
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Online</span>
              </div>
              <p className="text-xs text-gray-400 mb-2">Últ. Venta: Aceite Belmont</p>
              <p className="text-[10px] text-gray-600 font-mono">Hace 12s</p>
            </div>

            {/* Log 2 */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
              <div className="flex justify-between items-start mb-1">
                <h4 className="text-sm font-bold text-white">Impresora Recepción</h4>
                <span className="text-[9px] font-bold text-blue-400 uppercase tracking-wider">Printing</span>
              </div>
              <p className="text-xs text-gray-400 mb-2">Cola: 14 Etiquetas LPN</p>
              <p className="text-[10px] text-gray-600 font-mono">Hace 45s</p>
            </div>

            {/* Log 3 */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 opacity-75">
              <div className="flex justify-between items-start mb-1">
                <h4 className="text-sm font-bold text-white">Scanner Pasillo 4</h4>
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Sleep</span>
              </div>
              <p className="text-xs text-gray-400 mb-2">Estado: Inactivo</p>
              <p className="text-[10px] text-gray-600 font-mono">Hace 5m</p>
            </div>

          </div>
        </div>

      </div>

      <div className="bg-[#121212] border border-[#1f1f1f] rounded-2xl p-6">
        <div className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold mb-6 flex items-center justify-between">
          <span>FEFO</span>
          <button className="text-[10px] text-gray-300 border border-[#333] px-3 py-1 rounded hover:bg-[#1f1f1f] transition-colors">
            Ver Listado Completo
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Item FEFO 1 */}
          <div className="bg-[#0a0a0a] p-4 rounded-xl border border-[#1a1a1a]">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h5 className="text-sm font-medium text-white mb-0.5">Trutro de Pollo Granel (10kg)</h5>
                <p className="text-[11px] text-gray-500 font-mono">LOTE: 3989791 (GS1-128)</p>
              </div>
              <span className="text-rose-500 font-bold text-sm">-.000</span>
            </div>

            <div className="w-full bg-[#1f1f1f] rounded-full h-1.5 mb-2">
              <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: '85%' }}></div>
            </div>

            <div className="flex justify-between text-[10px] uppercase tracking-wider">
              <span className="text-gray-500">Ubicación: Cámara Frío 1</span>
              <span className="text-rose-500 font-bold">Vence en 5 días</span>
            </div>
          </div>

          {/* Item FEFO 2 */}
          <div className="bg-[#0a0a0a] p-4 rounded-xl border border-[#1a1a1a]">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h5 className="text-sm font-medium text-white mb-0.5">Leche Entera 1L (Soprole)</h5>
                <p className="text-[11px] text-gray-500 font-mono">LOTE: 80901160</p>
              </div>
              <span className="text-amber-500 font-bold text-sm">-.500</span>
            </div>

            <div className="w-full bg-[#1f1f1f] rounded-full h-1.5 mb-2">
              <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '52%' }}></div>
            </div>

            <div className="flex justify-between text-[10px] uppercase tracking-wider">
              <span className="text-gray-500">Ubicación: Bodega Pasillo 2</span>
              <span className="text-amber-500 font-bold">Vence en 12 días</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
