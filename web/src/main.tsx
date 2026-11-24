import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/nucleo.css";
import "./estilos/demandas.css";

const raiz = document.getElementById("raiz");
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
