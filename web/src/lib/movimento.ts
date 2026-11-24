// O movimento da pílula elástica dos filtros. Funções puras: as curvas e as quatro bordas.
//
// A pílula é uma camada que cobre o grupo inteiro, recortada por clip-path inset(t r b l round …); as quatro
// bordas andam separadas: a da frente (na direção do movimento) em 0,36 s com power3.out e a de trás em 0,55 s
// com power3.inOut. Na curva do GSAP, power3 é a de grau 4 (quart).

export type Bordas = { t: number; r: number; b: number; l: number };
export type Lado = keyof Bordas;

/** GSAP power3.out (quart): sai rápido e assenta devagar. */
export function power3Out(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return 1 - (1 - x) ** 4;
}

/** GSAP power3.inOut (quart): começa e termina devagar. */
export function power3InOut(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2;
}

export const DURACAO_DA_FRENTE = 360;
export const DURACAO_DE_TRAS = 550;

type Caixa = { left: number; top: number; width: number; height: number };

/** As bordas do alvo medidas a partir das bordas do grupo, como no inset() do clip-path. */
export function bordasDoAlvo(grupo: { width: number; height: number }, alvo: Caixa): Bordas {
  return {
    l: alvo.left,
    t: alvo.top,
    r: grupo.width - (alvo.left + alvo.width),
    b: grupo.height - (alvo.top + alvo.height),
  };
}

/**
 * Quais bordas vão na frente. Na horizontal, como no vídeo (indo para a direita, a borda direita lidera);
 * num grupo vertical (menu lateral), a mesma ideia de cima para baixo. As bordas do eixo parado andam com
 * a curva de trás, que é a mais suave.
 */
export function bordasDaFrente(de: Bordas, para: Bordas): Set<Lado> {
  const frente = new Set<Lado>();
  const dx = para.l - de.l;
  const dy = para.t - de.t;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx !== 0) frente.add(dx > 0 ? "r" : "l");
  } else {
    frente.add(dy > 0 ? "b" : "t");
  }
  return frente;
}

/**
 * Um quadro da pílula: cada borda sai do ponto em que estava quando o movimento começou e anda com a curva
 * dela. `ms` é o tempo desde o começo; devolve as bordas e se ainda falta andar.
 */
export function quadroDaPilula(
  de: Bordas,
  para: Bordas,
  frente: Set<Lado>,
  ms: number,
): { bordas: Bordas; andando: boolean } {
  const lados: Lado[] = ["t", "r", "b", "l"];
  const bordas = { ...para };
  let andando = false;
  for (const lado of lados) {
    const naFrente = frente.has(lado);
    const duracao = naFrente ? DURACAO_DA_FRENTE : DURACAO_DE_TRAS;
    const p = ms / duracao;
    if (p < 1) andando = true;
    const curva = naFrente ? power3Out(p) : power3InOut(p);
    bordas[lado] = de[lado] + (para[lado] - de[lado]) * curva;
  }
  return { bordas, andando };
}

export function clipDaPilula(bordas: Bordas, raio = "999px"): string {
  const px = (v: number) => `${Math.round(v * 100) / 100}px`;
  return `inset(${px(bordas.t)} ${px(bordas.r)} ${px(bordas.b)} ${px(bordas.l)} round ${raio})`;
}

