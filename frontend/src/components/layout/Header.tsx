"use client";

export function Header() {
  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-[#1a1a1a] bg-[#0a0a0a]/50 sticky top-0 z-10 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-white">Panel de Control</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-right">
        <div className="hidden sm:block">
          <div className="font-bold text-white text-xs uppercase tracking-wider">Administrador</div>
          <div className="text-gray-500 text-[10px]">BVCore</div>
        </div>
        <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold text-white">
          A
        </div>
      </div>
    </header>
  );
}
