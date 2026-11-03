import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Élément #root introuvable dans index.html.");
}

// The back-office is served by the instance under /admin: the router must strip that prefix
// from the location (the same base as the Vite build).
createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
