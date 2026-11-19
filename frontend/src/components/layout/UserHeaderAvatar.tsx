"use client";

import React, { useEffect, useState } from "react";
import { getStoredUserSession, AuthUserSession } from "@/services/api";

export function UserHeaderAvatar() {
  const [session, setSession] = useState<AuthUserSession | null>(null);

  useEffect(() => {
    setSession(getStoredUserSession());
    const onAuthChanged = () => setSession(getStoredUserSession());
    window.addEventListener("bvcore:auth-changed", onAuthChanged);
    return () => window.removeEventListener("bvcore:auth-changed", onAuthChanged);
  }, []);

  const initial = session ? session.usuario.slice(0, 1).toUpperCase() : "A";
  const label = session ? `${session.usuario} (${session.rol})` : "Modo Local";

  return (
    <div
      title={label}
      className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-600 to-rose-500 text-white font-bold text-xs flex items-center justify-center shadow-xs select-none"
    >
      {initial}
    </div>
  );
}
