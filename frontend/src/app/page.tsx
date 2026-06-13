"use client";

import React, { useState, useEffect } from "react";
import { Package, Grid as GridIcon, AlertTriangle, TrendingUp, Search } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

// ─── Datos Mockeados Temporales ──────────────────────────────────────────────
const KpisData = {
  totalProductos: 1254,
  totalPatentes: 48,
  alertasCriticas: 12,
};

const CategoriaData = [
  { name: "Lácteos", value: 450, color: "#14b8a6" },     // Teal 500
  { name: "Abarrotes", value: 520, color: "#64748b" },   // Slate 500
  { name: "Carnicería", value: 180, color: "#ef4444" },  // Red 500
  { name: "Fiambrería", value: 104, color: "#f59e0b" },  // Amber 500
];

const VencimientosAlertas = [
  { sku: "LAC-LECHE-01", nombre: "Leche Entera 1L", diasRestantes: 2, stock: 45 },
  { sku: "CAR-VAC-05", nombre: "Carne Molida 500g", diasRestantes: 1, stock: 12 },
  { sku: "FIA-JAM-02", nombre: "Jamón Pierna 250g", diasRestantes: 3, stock: 28 },
];

// ─── Componentes ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Para evitar problemas de hidratación con recharts
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      
      {/* Cabecera */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Resumen general de tu Sala de Ventas y Catálogo.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div>
            <p className="text-sm font-medium text-slate-500">Total Productos Catálogo</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{KpisData.totalProductos}</p>
          </div>
          <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
            <Package size={24} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div>
            <p className="text-sm font-medium text-slate-500">Muebles (Patentes) Mapeados</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{KpisData.totalPatentes}</p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
            <GridIcon size={24} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div>
            <p className="text-sm font-medium text-slate-500">Alertas de Vencimiento</p>
            <p className="text-3xl font-bold text-red-600 mt-1">{KpisData.alertasCriticas}</p>
          </div>
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500">
            <AlertTriangle size={24} />
          </div>
        </div>
      </div>

      {/* Gráficos y Tablas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Gráfico de Anillo */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 lg:col-span-1 flex flex-col">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-slate-400" /> Distribución del Catálogo
          </h2>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={CategoriaData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {CategoriaData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: any) => [`${value} Productos`, 'Cantidad']}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alertas Críticas (Mock) */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" /> Próximos a Vencer
            </h2>
            <button className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
              Ver reporte completo <Search size={14} />
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">SKU</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3 text-right">Stock en Sala</th>
                  <th className="px-4 py-3 text-right rounded-tr-lg">Días Restantes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {VencimientosAlertas.map((item) => (
                  <tr key={item.sku} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-500">{item.sku}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{item.nombre}</td>
                    <td className="px-4 py-3 text-right font-medium">{item.stock} u.</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        item.diasRestantes <= 1 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {item.diasRestantes} {item.diasRestantes === 1 ? 'día' : 'días'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Gráfico de Barras Dummy (Opcional, para complementar el layout) */}
          <div className="mt-6 pt-4 border-t border-slate-100 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={CategoriaData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {CategoriaData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
