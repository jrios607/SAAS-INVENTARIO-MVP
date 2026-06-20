import React, { ReactNode } from 'react';

export type ColorScheme = 'indigo' | 'emerald' | 'amber' | 'red' | 'blue';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  colorScheme?: ColorScheme;
}

const colorStyles: Record<ColorScheme, { bg: string; text: string; iconBg: string; border: string }> = {
  indigo: { bg: 'bg-white', text: 'text-indigo-600', iconBg: 'bg-indigo-50', border: 'border-slate-200' },
  emerald: { bg: 'bg-white', text: 'text-emerald-600', iconBg: 'bg-emerald-50', border: 'border-slate-200' },
  amber: { bg: 'bg-white', text: 'text-amber-600', iconBg: 'bg-amber-50', border: 'border-slate-200' },
  red: { bg: 'bg-white', text: 'text-red-600', iconBg: 'bg-red-50', border: 'border-slate-200' },
  blue: { bg: 'bg-white', text: 'text-blue-600', iconBg: 'bg-blue-50', border: 'border-slate-200' },
};

export function StatCard({ title, value, icon, colorScheme = 'indigo' }: StatCardProps) {
  const styles = colorStyles[colorScheme];

  return (
    <div 
      className={`
        ${styles.bg} ${styles.border} 
        p-6 rounded-2xl shadow-sm border 
        flex items-start gap-4 
        hover:-translate-y-1 hover:shadow-md transition-all duration-200
        cursor-default
      `}
    >
      <div className={`p-3 ${styles.iconBg} ${styles.text} rounded-xl shrink-0`}>
        {icon}
      </div>
      <div className="overflow-hidden">
        <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
        <h3 className={`text-3xl font-black ${styles.text} mt-1 tracking-tight truncate`}>
          {value.toLocaleString()}
        </h3>
      </div>
    </div>
  );
}
