"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { ModoPistolaModal } from "./ModoPistolaModal";
import {
  getAuthStatus,
  getStoredUserSession,
  syncStoredUserProfile,
  clearStoredAuthSession,
} from "@/services/api";

const LIGHT_PATHS = new Set([
  "/",
  "/ajustes",
  "/catalogo",
  "/ventas-externas",
  "/patentes",
  "/plano-bodega",
  "/recepcion",
  "/trazabilidad",
  "/login",
]);

export function PageLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLightPage = LIGHT_PATHS.has(pathname);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    let active = true;

    const verifyAuth = async () => {
      const st = await getAuthStatus();
      if (!active) return;

      if (st.authenticated && st.usuario) {
        syncStoredUserProfile({
          id: st.usuario.id,
          usuario: st.usuario.nombre,
          rol: st.usuario.rol,
          tenant_id: st.usuario.tenant_id,
        });
      } else if (!st.authenticated && getStoredUserSession()) {
        clearStoredAuthSession();
      }

      if (st.auth_required && !st.authenticated && pathname !== "/login") {
        router.replace("/login");
      }
    };

    verifyAuth();

    const handleUnauthorized = () => {
      clearStoredAuthSession();
      getAuthStatus().then((st) => {
        if (st.auth_required && pathname !== "/login") {
          router.replace("/login");
        }
      });
    };

    window.addEventListener("bvcore:auth-unauthorized", handleUnauthorized);
    return () => {
      active = false;
      window.removeEventListener("bvcore:auth-unauthorized", handleUnauthorized);
    };
  }, [pathname, router]);

  if (isLoginPage) {
    return <div className="min-h-screen font-sans">{children}</div>;
  }

  return (
    <div
      className={`flex h-screen font-sans overflow-hidden ${
        isLightPage
          ? "bg-[#f8fafc] text-slate-800 selection:bg-rose-500 selection:text-white"
          : "bg-[#050505] text-gray-200 selection:bg-emerald-500/30"
      }`}
    >
      <Sidebar />
      <div
        className="flex-1 flex flex-col overflow-y-auto min-w-0"
        style={
          pathname === "/ajustes"
            ? { background: "linear-gradient(135deg, #fcecee 0%, #f7f8fc 50%, #edf1f7 100%)" }
            : isLightPage
            ? { background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 40%, #f8fafc 100%)" }
            : undefined
        }
      >
        {children}
      </div>
      <ModoPistolaModal />
    </div>
  );
}
