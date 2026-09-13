'use client';

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let reloadingForUpdate = false;
    const hadControllerAtStart = Boolean(navigator.serviceWorker.controller);
    let registrationRef: ServiceWorkerRegistration | null = null;

    const reloadOnControllerChange = () => {
      // En una instalación nueva no hace falta recargar. Si ya había un SW controlando la
      // página, controllerchange significa que entró una versión nueva: recargamos una sola vez
      // para que la UI y la lógica no queden ejecutando bundles viejos durante horas/días.
      if (!hadControllerAtStart || reloadingForUpdate || disposed) return;
      reloadingForUpdate = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      if (disposed || !navigator.onLine) return;
      void registrationRef?.update().catch(() => undefined);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        registrationRef = registration;
        await navigator.serviceWorker.ready;
        if (disposed) return;

        // No dependemos únicamente del chequeo periódico del navegador. En PWAs instaladas,
        // especialmente en iOS, una app puede volver del fondo sin navegar de nuevo.
        await registration.update().catch(() => undefined);

        // Después de la primera carga online, guardamos también los bundles JS/CSS
        // que Next genera con hashes. Así la PWA puede volver a abrir completa offline.
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => {
            try {
              return new URL(url).origin === window.location.origin;
            } catch {
              return false;
            }
          });

        registration.active?.postMessage({ type: 'CACHE_URLS', urls });

        // Best effort: algunos navegadores pueden proteger el storage local
        // contra limpieza automática cuando la app se usa con frecuencia.
        if (navigator.storage?.persist) {
          void navigator.storage.persist().catch(() => false);
        }
      } catch {
        // Lebu sigue funcionando online aunque el service worker no pueda registrarse.
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', reloadOnControllerChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', checkForUpdate);

    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', reloadOnControllerChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
