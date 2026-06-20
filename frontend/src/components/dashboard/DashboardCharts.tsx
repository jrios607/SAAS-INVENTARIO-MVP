"use client";

import React from 'react';
import { 
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { DashboardKPIs } from '@/services/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { BarChart3 } from 'lucide-react';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

interface DashboardChartsProps {
  data: DashboardKPIs;
}

export function DashboardCharts({ data }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
      
      {/* Gráfico 1: Ocupación Vitrina vs Bodega */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-200">
        <h3 className="text-lg font-bold text-slate-800 mb-6 text-center">Distribución de Inventario</h3>
        <div className="h-[300px] w-full">
          {data.distribucion_inventario.length === 0 ? (
            <EmptyState message="No hay inventario registrado para distribuir." icon={<BarChart3 />} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.distribucion_inventario}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {data.distribucion_inventario.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: any) => value ? value.toLocaleString() : '0'} 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle"/>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Gráfico 2: Top Mermas */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-200">
        <h3 className="text-lg font-bold text-slate-800 mb-6 text-center">Top 5 Mermas (Últimos 7 días)</h3>
        <div className="h-[300px] w-full">
          {data.top_mermas.length === 0 ? (
            <EmptyState message="Excelente. No se han registrado mermas en los últimos 7 días." icon={<BarChart3 />} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.top_mermas}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                <XAxis 
                  dataKey="sku_nombre" 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  interval={0} 
                  angle={-45} 
                  textAnchor="end"
                />
                <YAxis allowDecimals={false} tick={{ fill: '#64748b' }} axisLine={false} tickLine={false}/>
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}} 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="cantidad" fill="#ef4444" radius={[6, 6, 0, 0]} name="Unidades Mermadas">
                  {data.top_mermas.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[3]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

    </div>
  );
}
