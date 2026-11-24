import { useId } from "react";
import type { PontoDaMaquina } from "../lib/tipos";
import { HISTORICO_MS } from "../lib/tipos";

// Memória e CPU do computador ao vivo no topo da Central de Execução, na mesma linha do título: o gráfico pequeno
// (memória em área e CPU em linha tracejada) com a última hora que o servidor local amostrou, relido a cada 5 s com
// a lista. Sem cartão em volta e fixo (nada recolhe). O desenho se revela da esquerda ao entrar (.m-graf-plot) e
// cada leitura nova desliza suave.

const L = 220;
const A = 34;

export function MaquinaMini({ pontos, agora }: { pontos: PontoDaMaquina[]; agora: number }) {
  const id = useId().replace(/:/g, "");
  const ultimo = pontos.at(-1);
  const memAgora = ultimo ? Math.round(ultimo.memPct) : null;
  const cpuAgora =
    ultimo?.cpuPct === null || ultimo === undefined ? null : Math.round(ultimo.cpuPct);
  // A janela é a do histórico que existe (no máximo 1 h, no mínimo 15 min): logo depois de o servidor subir,
  // os poucos minutos ocupam o desenho em vez de virar um risco na ponta.
  const janela = Math.min(HISTORICO_MS, Math.max(15 * 60_000, agora - (pontos[0]?.em ?? agora)));
  const x = (em: number) => Math.max(0, 1 - (agora - em) / janela) * L;
  const y = (pct: number) => 2 + (1 - Math.min(100, Math.max(0, pct)) / 100) * (A - 4);
  const linha = (pares: [number, number][]) =>
    pares.map(([em, v], i) => `${i ? "L" : "M"}${x(em).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const mem = pontos.map((p): [number, number] => [p.em, p.memPct]);
  const cpu = pontos
    .filter((p) => p.cpuPct !== null)
    .map((p): [number, number] => [p.em, p.cpuPct as number]);
  const caminhoMem = linha(mem);
  const primeiro = mem[0];
  const fim = mem.at(-1);
  const area =
    primeiro && fim
      ? `${caminhoMem}L${x(fim[0]).toFixed(1)} ${A}L${x(primeiro[0]).toFixed(1)} ${A}Z`
      : "";
  return (
    <figure className="dm-maq" aria-label="Memória e CPU do PC, ao vivo">
      <figcaption className="dm-maq-num">
        <span data-serie="mem">
          Memória <strong>{memAgora === null ? "—" : `${memAgora}%`}</strong>
        </span>
        <span data-serie="cpu">
          CPU <strong>{cpuAgora === null ? "—" : `${cpuAgora}%`}</strong>
        </span>
      </figcaption>
      {pontos.length < 2 ? null : (
        <svg
          className="dm-maq-graf"
          viewBox={`0 0 ${L} ${A}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Última hora: memória em ${memAgora ?? "?"}% e CPU em ${cpuAgora ?? "?"}% agora`}
        >
          <defs>
            <linearGradient id={`${id}-m`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--dm-azul)" stopOpacity=".3" />
              <stop offset="100%" stopColor="var(--dm-azul)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="m-graf-plot">
            <path d={area} fill={`url(#${id}-m)`} className="dm-maq-area" />
            <path d={caminhoMem} className="dm-maq-mem" vectorEffect="non-scaling-stroke" />
            <path
              d={linha(cpu)}
              className="dm-maq-cpu"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      )}
    </figure>
  );
}
