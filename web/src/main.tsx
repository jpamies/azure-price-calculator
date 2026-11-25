import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { preloadCatalog } from "./data/hooks.ts";

// Start downloading the price manifest and indexes before the first render.
preloadCatalog();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
