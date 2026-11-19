"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  loginUsuario,
  getAuthStatus,
  ApiHttpError,
} from "@/services/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [showTenantInput, setShowTenantInput] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);

  useEffect(() => {
    getAuthStatus().then((st) => {
      setAuthRequired(st.auth_required);
      if (st.authenticated) {
        router.replace("/");
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg("Por favor ingresa tu usuario y contraseña.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      await loginUsuario({
        username: username.trim(),
        password,
        tenant_id: showTenantInput && tenantId.trim() ? tenantId.trim() : undefined,
      });
      router.replace("/");
    } catch (err: any) {
      if (err instanceof ApiHttpError && err.status === 409) {
        setShowTenantInput(true);
      }
      setErrorMsg(err?.message || "No se pudo iniciar sesión. Verifica tus datos.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{
        background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 45%, #f8fafc 100%)",
      }}
    >
      <div className="card-soft rounded-3xl max-w-md w-full p-7 sm:p-8 space-y-6 border border-rose-200/80 shadow-xl bg-white/95">
        {/* Cabecera de Marca */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-rose-500 text-white font-black text-lg flex items-center justify-center shadow-md shadow-rose-200">
            BV
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Bienvenido a BVCore
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Ingresa con tu cuenta de tienda para gestionar inventario, vitrina y mermas.
            </p>
          </div>
          {authRequired === false && (
            <span className="text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-full">
              Modo Desarrollo Local · Inicio de sesión opcional
            </span>
          )}
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="login-username"
              className="block text-xs font-bold text-slate-700"
            >
              Usuario
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej: admin, supervisor u operario"
              className="w-full bg-slate-50 border border-slate-200 focus:border-rose-500 focus:bg-white rounded-2xl px-4 py-3 text-sm text-slate-900 font-semibold focus:outline-none transition"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-xs font-bold text-slate-700"
            >
              Contraseña
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ingresa tu contraseña"
              className="w-full bg-slate-50 border border-slate-200 focus:border-rose-500 focus:bg-white rounded-2xl px-4 py-3 text-sm text-slate-900 font-semibold focus:outline-none transition"
            />
          </div>

          {/* Campo opcional de Código de Local (Multi-Tenant) */}
          <div className="pt-1">
            {!showTenantInput ? (
              <button
                type="button"
                onClick={() => setShowTenantInput(true)}
                className="text-[11px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
              >
                + ¿Tienes un Código de Local específico? (Opcional)
              </button>
            ) : (
              <div className="space-y-1.5 bg-rose-50/50 border border-rose-200/70 rounded-2xl p-3">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="login-tenant"
                    className="block text-xs font-bold text-slate-700"
                  >
                    Código de Local (Opcional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setTenantId("");
                      setShowTenantInput(false);
                    }}
                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Ocultar
                  </button>
                </div>
                <input
                  id="login-tenant"
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="Ej: 130cc80b-1971-4332-bab3-9ee5ef66063b"
                  className="w-full bg-white border border-rose-200 focus:border-rose-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none transition"
                />
                <p className="text-[10px] text-slate-500">
                  Déjalo en blanco si tu usuario pertenece a un único local.
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-700 hover:to-rose-600 text-white text-sm font-extrabold shadow-md shadow-rose-200 transition cursor-pointer disabled:opacity-60"
          >
            {isLoading ? "Verificando acceso..." : "Ingresar al Local"}
          </button>
        </form>

        {authRequired === false && (
          <div className="pt-3 border-t border-slate-100 text-center">
            <Link
              href="/"
              className="inline-block text-xs font-bold text-slate-500 hover:text-slate-800 transition"
            >
              Continuar al panel sin iniciar sesión (Modo Local) →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
