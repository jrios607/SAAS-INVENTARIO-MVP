import { useState, useEffect, useMemo } from "react";
import { getActiveTenantId } from "@/services/api";

export function useOfflineSync<T>(
  storageKey: string,
  submitFn: (payload: T) => Promise<any>
) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);

  // Clave particionada por Tenant para prevenir fugas de cola offline entre locales
  const scopedStorageKey = useMemo(() => {
    const tenantId = typeof window !== "undefined" ? getActiveTenantId() : "tenant-default";
    return `${storageKey}_${tenantId}`;
  }, [storageKey]);

  // 1. Inicializar estado de red y listeners
  useEffect(() => {
    setIsOnline(typeof window !== "undefined" ? navigator.onLine : true);

    const queue = JSON.parse(localStorage.getItem(scopedStorageKey) || "[]");
    setSyncQueueSize(queue.length);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scopedStorageKey]);

  // 2. Método expuesto para que el componente UI lo consuma
  const registerAction = async (payload: T) => {
    if (isOnline) {
      try {
        const result = await submitFn(payload);
        return { success: true, offline: false, message: "Acción exitosa", result };
      } catch (error) {
        enqueuePayload(payload);
        return {
          success: true,
          offline: true,
          message: "Error de red. Guardado offline para sincronizar más tarde.",
        };
      }
    } else {
      enqueuePayload(payload);
      return {
        success: true,
        offline: true,
        message: "Sin conexión. Guardado offline. Se sincronizará al recuperar señal.",
      };
    }
  };

  const enqueuePayload = (payload: T) => {
    const queue = JSON.parse(localStorage.getItem(scopedStorageKey) || "[]");
    queue.push(payload);
    localStorage.setItem(scopedStorageKey, JSON.stringify(queue));
    setSyncQueueSize(queue.length);
  };

  // 3. Listener reactivo: Vaciar la cola cuando isOnline cambie a true
  useEffect(() => {
    let isSyncing = false;

    const syncPendingQueue = async () => {
      const savedQueue = localStorage.getItem(scopedStorageKey);
      if (!savedQueue || isSyncing) return;

      const items: T[] = JSON.parse(savedQueue);
      if (items.length === 0) return;

      isSyncing = true;
      const failedItems: T[] = [];

      for (const item of items) {
        try {
          await submitFn(item);
        } catch (error) {
          console.error(`[Offline Sync] Item falló:`, error);
          failedItems.push(item);
        }
      }

      if (failedItems.length > 0) {
        localStorage.setItem(scopedStorageKey, JSON.stringify(failedItems));
      } else {
        localStorage.removeItem(scopedStorageKey);
      }

      setSyncQueueSize(failedItems.length);
      isSyncing = false;
    };

    if (isOnline) {
      syncPendingQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, scopedStorageKey]);

  return { isOnline, syncQueueSize, registerAction };
}
