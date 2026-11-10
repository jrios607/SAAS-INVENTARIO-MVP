"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

const LIGHT_PATHS = new Set([
  "/",
  "/ajustes",
  "/catalogo",
  "/ventas-externas",
  "/patentes",
  "/plano-bodega",
  "/recepcion",
  "/trazabilidad",
  "/picking",
  "/ordenes-compra",
]);

export function PageLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLightPage = LIGHT_PATHS.has(pathname);

  return (
    <div
      className={`flex h-screen font-sans overflow-hidden ${
        isLightPage
          ? "bg-[#f8fafc] text-slate-800 selection:bg-rose-500 selection:text-white"
          : "bg-[#050505] text-gray-200 selection:bg-emerald-500/30"
      }`}
    >
      <Sidebar />
      <main
        className="flex-1 flex flex-col overflow-y-auto"
        style={
          pathname === "/ajustes"
            ? { background: "linear-gradient(135deg, #fcecee 0%, #f7f8fc 50%, #edf1f7 100%)" }
            : isLightPage
            ? { background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 40%, #f8fafc 100%)" }
            : undefined
        }
      >
        {!isLightPage && <Header />}
        {children}
      </main>
    </div>
  );
}
