"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, Package, Grid3X3, Warehouse, 
  PackageMinus, ClipboardList, BoxSelect, Map,
  ChevronDown, ChevronRight 
} from "lucide-react";

const navGroups = [
  {
    id: "general",
    title: "Visión General",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Catálogo", href: "/catalogo", icon: Package },
    ]
  },
  {
    id: "espacio",
    title: "Gestión de Espacio",
    items: [
      { name: "Plano 2D (Patentes)", href: "/patentes", icon: Grid3X3 },
      { name: "Plano 2D (Bodega)", href: "/plano-bodega", icon: Map },
    ]
  },
  {
    id: "operaciones",
    title: "Operaciones",
    items: [
      { name: "Recepción Bodega", href: "/recepcion", icon: Warehouse },
      { name: "Ajustes de Inventario", href: "/ajustes", icon: PackageMinus },
      { name: "Preparación (Picking)", href: "/picking", icon: BoxSelect },
      { name: "Trazabilidad", href: "/trazabilidad", icon: ClipboardList },
    ]
  }
];

export function Sidebar() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState({ 
    general: true, 
    espacio: true, 
    operaciones: true 
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => ({ 
      ...prev, 
      [groupId]: !prev[groupId as keyof typeof prev] 
    }));
  };

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 h-screen flex flex-col fixed left-0 top-0 border-r border-slate-700/60 shadow-xl">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-700/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-white font-black text-sm tracking-tight">SG</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-none tracking-wide">SG BVC</h1>
            <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-widest">Sistema logístico</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navGroups.map((group) => {
          const isOpen = openGroups[group.id as keyof typeof openGroups];
          return (
            <div key={group.id} className="mb-4">
              <button 
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-slate-500 tracking-widest uppercase hover:text-slate-300 transition-colors focus:outline-none"
              >
                <span>{group.title}</span>
                {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
              </button>
              
              <div 
                className={`overflow-hidden transition-all duration-300 ease-in-out space-y-1 ${isOpen ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}
              >
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group relative
                        ${isActive
                          ? "bg-emerald-500/15 text-emerald-400 font-semibold"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                        }`}
                    >
                      {/* Barra activa a la izquierda */}
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-emerald-500 rounded-r-full" />
                      )}
                      <Icon
                        size={17}
                        className={`flex-shrink-0 transition-colors ${isActive ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"}`}
                      />
                      <span className="text-sm truncate">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-700/60 bg-slate-900/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <span className="text-emerald-400 text-xs font-bold">A</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-300 font-medium truncate">Admin</p>
            <p className="text-[10px] text-slate-500 truncate">v1.0.0 — BVC</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
