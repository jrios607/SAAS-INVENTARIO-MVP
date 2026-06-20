import React from 'react';

export function DashboardSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-14 h-14 bg-slate-200 rounded-xl animate-pulse" />
        <div className="space-y-2">
          <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-96 bg-slate-200 rounded animate-pulse" />
        </div>
      </div>

      {/* Cards Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-start gap-4 h-[116px]">
            <div className="w-12 h-12 bg-slate-200 rounded-xl shrink-0 animate-pulse" />
            <div className="space-y-3 w-full">
              <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
              <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-[400px] flex flex-col items-center justify-center space-y-4">
            <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="w-48 h-48 bg-slate-200 rounded-full animate-pulse mt-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
