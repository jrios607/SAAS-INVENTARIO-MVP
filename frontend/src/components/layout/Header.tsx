"use client";

export function Header() {
  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-700 text-sm tracking-wide">Panel de Control</span>
        <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 uppercase tracking-wider">
          Live
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-xs font-semibold text-slate-700">Administrador</p>
          <p className="text-[10px] text-slate-400">SG Sistema de Gestión</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow shadow-emerald-500/30">
          A
        </div>
      </div>
    </header>
  );
}
