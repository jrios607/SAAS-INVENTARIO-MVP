import { useState, useEffect } from 'react';

export function useOfflineSync<T>(
  storageKey: string,
  submitFn: (payload: T) => Promise<any>
) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [syncQueueSize, setSyncQueueSize] = useState<number>(0);

  // 1. Inicializar estado de red y listeners
  useEffect(() => {
    setIsOnline(typeof window !== 'undefined' ? navigator.onLine : true);
    
    // Contar cuántos items hay al montar
    const queue = JSON.parse(localStorage.getItem(storageKey) || '[]');
    setSyncQueueSize(queue.length);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [storageKey]);

  // 2. Método expuesto para que el componente UI lo consuma
  const registerAction = async (payload: T) => {
    if (isOnline) {
      try {
        const result = await submitFn(payload);
        return { success: true, offline: false, message: 'Acción exitosa', result };
      } catch (error) {
        enqueuePayload(payload);
        return { success: true, offline: true, message: 'Error de red. Guardado offline para sincronizar más tarde.' };
      }
    } else {
      enqueuePayload(payload);
      return { success: true, offline: true, message: 'Sin conexión. Guardado offline. Se sincronizará al recuperar señal.' };
    }
  };

  const enqueuePayload = (payload: T) => {
    const queue = JSON.parse(localStorage.getItem(storageKey) || '[]');
    queue.push(payload);
    localStorage.setItem(storageKey, JSON.stringify(queue));
    setSyncQueueSize(queue.length);
  };

  // 3. Listener reactivo: Vaciar la cola cuando isOnline cambie a true
  useEffect(() => {
    let isSyncing = false;

    const syncPendingQueue = async () => {
      const savedQueue = localStorage.getItem(storageKey);
      if (!savedQueue || isSyncing) return;
      
      const items: T[] = JSON.parse(savedQueue);
      if (items.length === 0) return;

      isSyncing = true;
      console.log(`[Offline Sync] Iniciando vaciado de ${items.length} items de ${storageKey}...`);
      const failedItems: T[] = [];

      for (const item of items) {
        try {
          await submitFn(item);
          console.log(`[Offline Sync] Item sincronizado.`);
        } catch (error) {
          console.error(`[Offline Sync] Item falló:`, error);
          failedItems.push(item);
        }
      }

      // Actualizar el localstorage solo con los que fallaron
      if (failedItems.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(failedItems));
      } else {
        localStorage.removeItem(storageKey);
      }
      
      setSyncQueueSize(failedItems.length);
      isSyncing = false;
    };

    if (isOnline) {
      syncPendingQueue();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, storageKey]); // omitimos submitFn para evitar loops si no está memorizada

  return { isOnline, syncQueueSize, registerAction };
}
