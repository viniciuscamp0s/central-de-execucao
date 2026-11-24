import { useLayoutEffect } from "react";
import { MovimentoDaPilula } from "./componentes/movimento-da-pilula";
import { TelaDeDemandas } from "./componentes/tela-de-demandas";
import { useDemandas } from "./componentes/usar-demandas";
import { aplicarTemaGuardado, ID_DA_TELA } from "./lib/tema";

// A casca: o #m-app (onde mora o tema claro/escuro) e a coluna central da tela. Espera a primeira leitura das
// sessões (a primeira vez lê os registros inteiros, depois só o que cresceu).
export function App() {
  const { dados, falhou } = useDemandas();
  // O tema escolhido entra antes do primeiro quadro.
  useLayoutEffect(aplicarTemaGuardado, []);
  return (
    <div id={ID_DA_TELA} className="central-app">
      <main id="conteudo-central" className="m-content">
        {dados ? (
          <TelaDeDemandas dados={dados} falhou={falhou} />
        ) : (
          <p className="dm-carregando" role="status">
            {falhou ? "Sem conexão com o leitor local. Rode node central.mjs." : "Lendo as sessões…"}
          </p>
        )}
      </main>
      <MovimentoDaPilula />
    </div>
  );
}
