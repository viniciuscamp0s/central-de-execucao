import { AppWindow, Bot, Braces, Cloud, Globe, Monitor, Terminal } from "lucide-react";

// Onde a demanda roda (ou rodou por último), na primeira coluna: os logotipos pequenos e numa cor só, a do texto
// (currentColor), no estilo da tela; nada de logo colorida. Os logotipos do Orca e do VS Code são das marcas
// deles, usados só para identificar a interface; as outras interfaces usam ícones de traço.

function Orca({ tamanho }: { tamanho: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="6.67 50 318.6 244"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m 177.81311,248.33334 c 23.82304,-41.29793 40.54045,-66.84626 49.51207,-75.66667 6.81685,-6.70196 10.07373,-8.7374 20.07265,-12.54475 34.57822,-13.16655 61.04674,-26.78733 72.37222,-37.24295 9.62924,-8.88966 9.34286,-9.01142 -23.43671,-9.964 -35.71756,-1.03796 -43.72989,0.42119 -62.17546,11.323 -16.72118,9.88265 -34.20103,30.11225 -42.74704,49.47157 -2.57353,5.82985 -14.81294,44.3056 -27.96399,87.90747 -2.86036,9.48343 -3.02466,11.71633 -0.86213,11.71633 0.44382,0 7.29659,-11.25 15.22839,-25 z m -65.14644,-8.32267 C 120,239.3326 130.5,237.50979 136,235.95998 c 5.5,-1.5498 12.25,-3.13783 15,-3.52895 2.75,-0.39111 5,-0.95485 5,-1.25275 0,-0.29789 2.15135,-7.58487 4.78078,-16.19328 8.49209,-27.80201 12.21334,-40.41629 21.13747,-71.65166 4.81891,-16.86667 11.23502,-39.185 14.25802,-49.596301 5.12803,-17.66103 5.74763,-23.07037 2.64253,-23.07037 -1.84887,0 -4.07048,6.908293 -16.72243,52.000001 -21.78975,77.65896 -20.80806,74.74393 -26.84794,79.72251 -7.5925,6.25838 -25.03916,14.82524 -36.10856,17.73044 -17.0947,4.48656 -33.410599,3.86724 -53.116765,-2.01622 -18.569242,-5.54403 -23.142662,-5.80284 -33.639754,-1.9037 -5.875424,2.18242 -9.864152,5.04363 -16.716684,11.99127 -4.95,5.0187 -9.0000001,10.02884 -9.0000001,11.13364 0,1.75174 5.9276921,2.00299 46.3333351,1.96383 25.483334,-0.0247 52.333338,-0.59969 59.666668,-1.27777 z M 252.69513,104.63708 c 12.18267,-3.48651 15.77304,-7.895503 9.63821,-11.835773 -10.19296,-6.546726 -36.19849,-1.77301 -41.19436,7.561863 -1.2556,2.3461 -0.98698,3.2037 1.68353,5.375 2.69471,2.19098 4.59991,2.47691 12.53928,1.88189 5.14899,-0.3859 12.94899,-1.72824 17.33334,-2.98298 z" />
    </svg>
  );
}

function VsCode({ tamanho }: { tamanho: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  );
}

// Os ícones de traço das demais interfaces (terminal, JetBrains, aplicativo, web, nuvem, automação).
const DE_TRACO = {
  terminal: Terminal,
  jetbrains: Braces,
  desktop: Monitor,
  web: Globe,
  nuvem: Cloud,
  sdk: Bot,
  outro: AppWindow,
} as const;

export function IconeOnde({
  onde,
  titulo,
  tamanho = 15,
}: {
  onde: string | null | undefined;
  titulo: string | null;
  tamanho?: number;
}) {
  if (!onde) {
    return (
      <span className="dm-onde" data-sem="" title="Sem registro de onde rodou">
        <span className="sr-only">Sem registro de onde rodou</span>
      </span>
    );
  }
  const Traco = onde in DE_TRACO ? DE_TRACO[onde as keyof typeof DE_TRACO] : AppWindow;
  return (
    <span className="dm-onde" data-onde={onde} title={titulo ?? undefined}>
      {onde === "orca" ? (
        <Orca tamanho={tamanho + 3} />
      ) : onde === "vscode" ? (
        <VsCode tamanho={tamanho - 1} />
      ) : (
        <Traco size={tamanho + 1} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="sr-only">{titulo}</span>
    </span>
  );
}
