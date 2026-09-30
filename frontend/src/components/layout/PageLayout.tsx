"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export function PageLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/pos")) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-[#050505] text-gray-200 font-sans overflow-hidden selection:bg-emerald-500/30">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-y-auto">
        <Header />
        {children}
      </main>
    </div>
  );
}
