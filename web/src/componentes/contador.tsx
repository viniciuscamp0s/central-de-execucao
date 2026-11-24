import { useEffect, useRef, useState } from "react";

// O contador de tokens: a cada leitura (5 s), sobe do número mostrado até o último valor MEDIDO, devagar, e para
// nele. Nunca passa do medido nem adivinha o próximo. Valor que desce (a lista recomeçou) ou movimento reduzido
// no aparelho: troca na hora.

const DURACAO_MS = 4_500;

function movimentoReduzido(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Contador({ valor, formatar }: { valor: number; formatar: (n: number) => string }) {
  const [mostrado, setMostrado] = useState(valor);
  const atual = useRef(valor);

  useEffect(() => {
    const de = atual.current;
    if (valor <= de || movimentoReduzido()) {
      atual.current = valor;
      setMostrado(valor);
      return;
    }
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const p = Math.min(1, (agora - inicio) / DURACAO_MS);
      const suave = 1 - (1 - p) ** 3;
      const v = p >= 1 ? valor : Math.round(de + (valor - de) * suave);
      atual.current = v;
      setMostrado(v);
      if (p < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return (
    <>
      <span aria-hidden="true">{formatar(mostrado)}</span>
      <span className="sr-only">{formatar(valor)} tokens</span>
    </>
  );
}
