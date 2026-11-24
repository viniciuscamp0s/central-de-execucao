import { useEffect, useState } from "react";
import type { LeituraDasDemandas } from "../lib/tipos";

// Lê /api/demandas a cada 5 s (o ritmo do servidor local) e pausa com a aba escondida; volta lendo na hora em
// que ela reaparece.

const INTERVALO_MS = 5_000;

export type LeituraDaTela = {
  dados: LeituraDasDemandas | null;
  falhou: boolean;
};

export function useDemandas(): LeituraDaTela {
  const [dados, setDados] = useState<LeituraDasDemandas | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    let emVoo = false;
    async function ler() {
      if (emVoo || document.visibilityState === "hidden") return;
      emVoo = true;
      try {
        const resposta = await fetch("/api/demandas", { cache: "no-store" });
        if (!resposta.ok) throw new Error(String(resposta.status));
        const corpo = (await resposta.json()) as LeituraDasDemandas;
        if (!vivo) return;
        setDados(corpo);
        setFalhou(false);
      } catch {
        if (vivo) setFalhou(true);
      } finally {
        emVoo = false;
      }
    }
    void ler();
    const timer = window.setInterval(ler, INTERVALO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void ler();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  return { dados, falhou };
}
