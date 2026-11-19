import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ApiHttpError, getActiveTenantId } from "@/services/api";

export function isNetworkOrServerError(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}

export interface OfflineSyncOptions {
  onSynced?: (syncedCount: number) => void;
}

export function useOfflineSync<T>(
  storageKey: string,
  submitFn: (payload: T) => Promise<any>,
  options?: OfflineSyncOptions
) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const submitFnRef = useRef(submitFn);
  submitFnRef.current = submitFn;

  const onSyncedRef = useRef(options?.onSynced);
  onSyncedRef.current = options?.onSynced;

  const isSyncingRef = useRef<boolean>(false);

  // Clave particionada por Tenant para prevenir fugas de cola offline entre locales
  const scopedStorageKey = useMemo(() => {
    const tenantId = typeof window !== "undefined" ? getActiveTenantId() : "tenant-default";
    return `${storageKey}_${tenantId}`;
  }, [storageKey]);

  const readQueue = useCallback((): T[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(scopedStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [scopedStorageKey]);

  const writeQueue = useCallback(
    (items: T[]) => {
      if (typeof window === "undefined") return;
      try {
        if (items.length > 0) {
          localStorage.setItem(scopedStorageKey, JSON.stringify(items));
        } else {
          localStorage.removeItem(scopedStorageKey);
        }
      } catch {
        // Ignorar errores de cuota de storage
      }
      setSyncQueueSize(items.length);
    },
    [scopedStorageKey]
  );

  const enqueuePayload = useCallback(
    (payload: T) => {
      const queue = readQueue();
      queue.push(payload);
      writeQueue(queue);
    },
    [readQueue, writeQueue]
  );

  const flushNow = useCallback(async (): Promise<number> => {
    if (typeof window === "undefined" || isSyncingRef.current) return 0;
    if (typeof navigator !== "undefined" && !navigator.onLine) return 0;

    const items = readQueue();
    if (items.length === 0) {
      setSyncQueueSize(0);
      return 0;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    const remaining: T[] = [];
    let syncedCount = 0;

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          await submitFnRef.current(item);
          syncedCount += 1;
        } catch (error: any) {
          if (isNetworkOrServerError(error)) {
            remaining.push(item, ...items.slice(i + 1));
            break;
          }
          if (error instanceof ApiHttpError && error.status === 401) {
            // Preservar la cola offline intacta si expiró el token hasta que el usuario vuelva a iniciar sesión
            remaining.push(item, ...items.slice(i + 1));
            setLastSyncError(
              "Tu sesión expiró. Inicia sesión nuevamente para sincronizar las operaciones guardadas."
            );
            break;
          }
          if (error instanceof ApiHttpError && error.status === 409) {
            // Idempotencia: ya estaba aplicado en servidor
            syncedCount += 1;
            continue;
          }
          // Error de negocio 4xx irrepetible: descartar este ítem sin bloquear el resto
          setLastSyncError(
            error?.message || "Una operación offline fue rechazada por validación del servidor."
          );
        }
      }

      writeQueue(remaining);

      if (syncedCount > 0) {
        window.dispatchEvent(new CustomEvent("bvcore:inventory-updated"));
        onSyncedRef.current?.(syncedCount);
      }

      return syncedCount;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [readQueue, writeQueue]);

  // 1. Inicializar estado de red y listeners
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    setSyncQueueSize(readQueue().length);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [readQueue]);

  // 2. Vaciar automáticamente la cola al recuperar conexión o al montar con red
  useEffect(() => {
    if (isOnline) {
      flushNow();
    }
  }, [isOnline, scopedStorageKey, flushNow]);

  // 3. Método expuesto para que el componente UI lo consuma
  const registerAction = useCallback(
    async (payload: T) => {
      const onlineNow = typeof navigator !== "undefined" ? navigator.onLine : isOnline;

      if (onlineNow) {
        try {
          const result = await submitFnRef.current(payload);
          return {
            success: true,
            offline: false,
            message: "Acción registrada con éxito",
            result,
          };
        } catch (error) {
          if (isNetworkOrServerError(error)) {
            enqueuePayload(payload);
            return {
              success: true,
              offline: true,
              message: "Sin conexión al servidor. Guardado localmente para sincronizar al volver la señal.",
            };
          }
          throw error;
        }
      } else {
        enqueuePayload(payload);
        return {
          success: true,
          offline: true,
          message: "Sin conexión. Guardado localmente y se enviará automáticamente al volver la señal.",
        };
      }
    },
    [isOnline, enqueuePayload]
  );

  const clearSyncError = useCallback(() => setLastSyncError(null), []);

  return {
    isOnline,
    isSyncing,
    syncQueueSize,
    lastSyncError,
    clearSyncError,
    registerAction,
    flushNow,
  };
}
