"use client";

import React from 'react';
import { Package, AlertTriangle, TrendingDown, LayoutDashboard, AlertCircle } from 'lucide-react';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { StatCard } from '@/components/dashboard/StatCard';
import { DashboardCharts } from '@/components/dashboard/DashboardCharts';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';

export default function DashboardPage() {
  const { data, isLoading, error } = useDashboardMetrics();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <EmptyState 
        message={error || "Error cargando los KPIs del Dashboard. Asegúrate de que la API esté respondiendo."} 
        icon={<AlertCircle className="w-12 h-12 text-red-400" />} 
      />
    );
  }

  const mermasSemanales = data.top_mermas.reduce((acc, curr) => acc + curr.cantidad, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
      
      {/* Encabezado */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
           <LayoutDashboard className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard Gerencial (LIVE)</h1>
          <p className="text-slate-500 text-sm mt-1">Métricas operativas alimentadas en tiempo real por Uvicorn/FastAPI.</p>
        </div>
      </div>

      {/* Fila 1: Tarjetas de KPI (Bento Box) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard 
          title="Stock Total (Unidades)" 
          value={data.stock_total_unidades} 
          icon={<Package size={24} />} 
          colorScheme="indigo" 
        />
        <StatCard 
          title="Riesgo Vencimiento (7 días)" 
          value={data.alertas_vencimiento} 
          icon={<AlertTriangle size={24} />} 
          colorScheme="red" 
        />
        <StatCard 
          title="Mermas Semanales (Unidades)" 
          value={mermasSemanales} 
          icon={<TrendingDown size={24} />} 
          colorScheme="amber" 
        />
      </div>

      {/* Fila 2: Gráficos y Visualizaciones */}
      <DashboardCharts data={data} />
      
    </div>
  );
}

