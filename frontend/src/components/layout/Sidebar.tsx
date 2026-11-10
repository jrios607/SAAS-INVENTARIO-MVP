"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DebugConsole } from "@/components/DebugConsole";
import { OnboardingWizardModal } from "@/components/onboarding/OnboardingWizardModal";
import {
  getCachedTenantSettings,
  getTenantSettings,
  getStockAgrupado,
  getDashboardKpis,
  TenantSettingsResponse,
  DashboardAlertasOperativas,
} from "@/services/api";

interface NavItem {
  id: string;
  name: string;
  href: string;
  renderIcon: () => React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    name: "Centro de Información",
    href: "/",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    ),
  },
  {
    id: "catalogo",
    name: "Catálogo de Productos",
    href: "/catalogo",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    ),
  },
  {
    id: "plano_supermercado",
    name: "Mapa del Local",
    href: "/patentes",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
        />
      </svg>
    ),
  },
  {
    id: "plano_bodega",
    name: "Mapa de Bodega",
    href: "/plano-bodega",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
  },
  {
    id: "recepcion_bodega",
    name: "Recepción de Mercadería",
    href: "/recepcion",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
        />
      </svg>
    ),
  },
  {
    id: "ajustes_inventario",
    name: "Registro de Merma",
    href: "/ajustes",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
        />
      </svg>
    ),
  },
  {
    id: "ventas_externas",
    name: "Ventas POS",
    href: "/ventas-externas",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "trazabilidad",
    name: "Historial de Movimientos",
    href: "/trazabilidad",
    renderIcon: () => (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
];

const SHOW_DEBUG_CONSOLE = process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";

export function Sidebar() {
  const pathname = usePathname();
  const [tenantSettings, setTenantSettings] = useState<TenantSettingsResponse | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [alertasOps, setAlertasOps] = useState<DashboardAlertasOperativas | null>(null);

  const refreshSidebarIndicators = useCallback(() => {
    getStockAgrupado()
      .then((grupos) => {
        let total = 0;
        (grupos || []).forEach((g) => {
          (g.sub_familias || []).forEach((s) => {
            total += (s.productos || []).length;
          });
        });
        setCatalogCount(total);
      })
      .catch(() => {});

    getDashboardKpis()
      .then((kpis) => {
        if (kpis?.alertas_operativas) {
          setAlertasOps(kpis.alertas_operativas);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cached = getCachedTenantSettings();
    if (cached) {
      setTenantSettings(cached);
    }

    getTenantSettings().then((fresh) => {
      if (fresh) {
        setTenantSettings(fresh);
        const dismissedKey = `bvcore_onboarding_prompted_${fresh.tenant_id}`;
        if (
          !fresh.onboarding_completed &&
          typeof window !== "undefined" &&
          !sessionStorage.getItem(dismissedKey)
        ) {
          sessionStorage.setItem(dismissedKey, "1");
          setIsWizardOpen(true);
        }
      }
    });

    const handleUpdated = (e: Event) => {
      const custom = e as CustomEvent<TenantSettingsResponse>;
      if (custom.detail) {
        setTenantSettings(custom.detail);
      }
      refreshSidebarIndicators();
    };
    window.addEventListener("bvcore:tenant-settings-updated", handleUpdated);
    return () => window.removeEventListener("bvcore:tenant-settings-updated", handleUpdated);
  }, [refreshSidebarIndicators]);

  useEffect(() => {
    refreshSidebarIndicators();
  }, [pathname, refreshSidebarIndicators]);

  const enabledModules = tenantSettings?.enabled_modules || [
    "dashboard",
    "catalogo",
    "plano_supermercado",
    "plano_bodega",
    "ordenes_compra",
    "recepcion_bodega",
    "ajustes_inventario",
    "picking",
    "ventas_externas",
    "trazabilidad",
  ];

  const visibleItems = NAV_ITEMS.filter((item) => enabledModules.includes(item.id));

  // Cálculo de insignias de alerta por ítem de menú
  const getItemBadge = (
    itemId: string
  ): { count: number; tone: "rose" | "amber" | "neutral"; title: string } | null => {
    const fefo7d = alertasOps?.lotes_por_vencer_7d_count ?? 0;
    const anomalias = alertasOps?.anomalias_abiertas_count ?? 0;
    const orphans = alertasOps?.skus_huerfanos_pendientes_count ?? 0;
    const bajoMin = alertasOps?.productos_bajo_minimo_count ?? 0;

    if (itemId === "dashboard") {
      const totalAlertas = fefo7d + anomalias + orphans + bajoMin;
      if (totalAlertas > 0) {
        return {
          count: totalAlertas,
          tone: fefo7d + anomalias > 0 ? "rose" : "amber",
          title: `${totalAlertas} alerta(s) operativa(s) activa(s)`,
        };
      }
      return null;
    }

    if (itemId === "ajustes_inventario") {
      const mermaAlertas = fefo7d + anomalias;
      if (mermaAlertas > 0) {
        return {
          count: mermaAlertas,
          tone: "rose",
          title: `${fefo7d} lote(s) por vencer y ${anomalias} diferencia(s) en vitrina`,
        };
      }
      return null;
    }

    if (itemId === "ventas_externas") {
      if (orphans > 0) {
        return {
          count: orphans,
          tone: "amber",
          title: `${orphans} código(s) POS pendientes de vincular`,
        };
      }
      return null;
    }

    if (itemId === "catalogo") {
      if (bajoMin > 0) {
        return {
          count: bajoMin,
          tone: "amber",
          title: `${bajoMin} producto(s) bajo stock mínimo`,
        };
      }
      if (catalogCount !== null && catalogCount > 0) {
        return {
          count: catalogCount,
          tone: "neutral",
          title: `${catalogCount} productos en catálogo`,
        };
      }
      return null;
    }

    return null;
  };

  return (
    <>
      {/* Sidebar Izquierdo Desplegable al pasar el mouse */}
      <aside className="sidebar-glass min-h-screen p-4 flex flex-col justify-between sticky top-0 z-40 flex-shrink-0">
        <div className="space-y-6 flex flex-col">
          {/* Logo Mini / Completo */}
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-600 to-rose-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-rose-200 flex-shrink-0">
              BV
            </div>
            <div className="nav-label flex flex-col">
              <span className="font-extrabold text-sm text-slate-900 tracking-tight">BVCore</span>
              <span className="text-[10px] text-rose-600 font-semibold">Tu gemelo digital</span>
            </div>
          </div>

          {/* Lista de Iconos Interactivos */}
          <div className="space-y-2 flex flex-col">
            {visibleItems.map((item) => {
              const isActive = pathname === item.href;
              const badge = getItemBadge(item.id);
              const isAlertBadge = badge && (badge.tone === "rose" || badge.tone === "amber");

              return (
                <Link key={item.id} href={item.href} title={badge?.title || item.name}>
                  <div
                    className={
                      isActive
                        ? "relative w-full h-12 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 text-white flex items-center gap-3 px-3 transition shadow-md shadow-rose-200 group cursor-pointer"
                        : "relative w-full h-12 rounded-2xl bg-slate-50 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200/80 flex items-center gap-3 px-3 transition shadow-2xs group cursor-pointer"
                    }
                  >
                    <div className="relative w-6 h-6 flex items-center justify-center flex-shrink-0">
                      {item.renderIcon()}
                      {/* Punto / Contador compacto sobre el ícono cuando hay alerta activa */}
                      {isAlertBadge && (
                        <span
                          className={` -top-1.5 -right-2 min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-black flex items-center justify-center shadow-xs ${
                            isActive
                              ? "bg-white text-rose-600"
                              : badge.tone === "rose"
                              ? "bg-rose-600 text-white"
                              : "bg-amber-500 text-white"
                          } absolute`}
                        >
                          {badge.count > 99 ? "99+" : badge.count}
                        </span>
                      )}
                    </div>

                    <div className="nav-label flex items-center justify-between w-full min-w-0">
                      <span
                        className={`text-xs font-bold truncate ${
                          isActive ? "text-white" : "text-slate-700 group-hover:text-rose-600"
                        }`}
                      >
                        {item.name}
                      </span>

                      {badge && (
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ml-2 shrink-0 ${
                            isActive
                              ? "bg-white/20 text-white"
                              : badge.tone === "rose"
                              ? "bg-rose-100 text-rose-700 border border-rose-200"
                              : badge.tone === "amber"
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-rose-50 text-rose-600 border border-rose-200/60"
                          }`}
                        >
                          {badge.count}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Botón de Configuración Inferior */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="w-full h-12 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-3 px-3 transition shadow-2xs group cursor-pointer"
          >
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <span className="nav-label text-xs font-bold text-rose-700">Configuración</span>
          </button>

          {SHOW_DEBUG_CONSOLE && <DebugConsole />}
        </div>
      </aside>

      <OnboardingWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        currentSettings={tenantSettings}
        onSaved={(updated) => setTenantSettings(updated)}
      />
    </>
  );
}
