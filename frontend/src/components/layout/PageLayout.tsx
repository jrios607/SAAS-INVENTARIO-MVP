import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64">
        <Header />
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
