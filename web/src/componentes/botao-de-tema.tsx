import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { ouvirTemaDaTela, type TemaDaTela, temaDaTela, trocarTemaDaTela } from "../lib/tema";

// O botão claro/escuro: segue o aparelho até você escolher. O efeito roda antes da pintura e recompõe a escolha
// gravada se a árvore tiver sido refeita.
export function BotaoDeTema() {
  const [tema, setTema] = useState<TemaDaTela | null>(null);
  useLayoutEffect(() => {
    setTema(temaDaTela());
    return ouvirTemaDaTela(setTema);
  }, []);
  const proximo = tema === "escuro" ? "claro" : "escuro";
  return (
    <button
      type="button"
      className="m-tema dm-tema"
      aria-label={proximo === "escuro" ? "Usar o tema escuro" : "Usar o tema claro"}
      title={proximo === "escuro" ? "Tema escuro" : "Tema claro"}
      onClick={() => setTema(trocarTemaDaTela())}
    >
      {tema === "escuro" ? (
        <Sun size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Moon size={16} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  );
}
