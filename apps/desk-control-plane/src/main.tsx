import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import { registerDeskServiceWorker } from "@/pwa/registerServiceWorker";
import "@/design-system/styles.css";

registerDeskServiceWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
