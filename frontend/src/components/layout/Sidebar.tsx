"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DebugConsole } from "@/components/DebugConsole";
import {
  LayoutDashboard,
  Box,
  Grid,
  Map,
  ArrowDownToLine,
  Settings2,
  ListChecks,
  Activity,

} from 'lucide-react';

const navGroups = [
  {
    id: "general",
    title: "Visión General",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Catálogo", href: "/catalogo", icon: Box },
    ]
  },
  {
    id: "espacio",
    title: "Gestión de Espacio",
    items: [
      { name: "Plano Supermercado", href: "/patentes", icon: Grid },
      { name: "Plano Bodega", href: "/plano-bodega", icon: Map },
    ]
  },
  {
    id: "operaciones",
    title: "Operaciones",
    items: [
      { name: "Recepción Bodega", href: "/recepcion", icon: ArrowDownToLine },
      { name: "Ajustes de Inventario", href: "/ajustes", icon: Settings2 },
      { name: "Preparación (Picking)", href: "/picking", icon: ListChecks },
      { name: "Trazabilidad", href: "/trazabilidad", icon: Activity },
    ]
  }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="p-6 mb-2">
        <h1 className="text-xl font-bold text-white tracking-tight">BVCore</h1>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Sistema Logístico</p>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-8">
        {navGroups.map(group => (
          <div key={group.id}>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 px-3">{group.title}</div>
            {group.items.map(item => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.name} href={item.href}>
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors mt-1 ${isActive ? 'bg-[#1a1a1a] text-white border border-[#2a2a2a]' : 'text-gray-400 hover:text-white border border-transparent'}`}>
                    <Icon size={18} className={isActive ? 'text-emerald-500' : ''} />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Sidebar */}
      <div className="p-4 border-t border-[#1a1a1a]">
        <DebugConsole />
      </div>
    </aside>
  );
}
