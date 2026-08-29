import { DESK_BUILD_ID, DESK_UPDATE_AVAILABLE_EVENT } from "@/pwa/buildInfo";

export function registerDeskServiceWorker(env: ImportMetaEnv = import.meta.env) {
  if (!env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/service-worker.js?build=${encodeURIComponent(DESK_BUILD_ID)}`, {
      scope: "/",
      updateViaCache: "none",
    }).then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent(DESK_UPDATE_AVAILABLE_EVENT));
          }
        });
      });
      void registration.update();
    }).catch((error) => {
      console.warn("DESK_PWA_SERVICE_WORKER_REGISTRATION_FAILED", error);
    });
  });
}
