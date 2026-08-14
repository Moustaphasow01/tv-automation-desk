export function registerDeskServiceWorker(env: ImportMetaEnv = import.meta.env) {
  if (!env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", {
      scope: "/"
    }).catch((error) => {
      console.warn("DESK_PWA_SERVICE_WORKER_REGISTRATION_FAILED", error);
    });
  });
}
