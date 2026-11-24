// O tema da tela: segue o aparelho até você escolher no botão. A escolha fica neste navegador (localStorage) e
// vira o atributo data-theme do #m-app, que o CSS lê. Escolher o mesmo tema do aparelho apaga a escolha: a tela
// volta a seguir o aparelho, inclusive quando ele troca sozinho à noite.

export type TemaDaTela = "claro" | "escuro";
type Escolha = "light" | "dark";

export const CHAVE_DO_TEMA = "central-de-execucao-tema";
export const ID_DA_TELA = "m-app";
const EVENTO_DO_TEMA = "central-tema";

// Pura: o tema que vale dado o atributo e o aparelho.
export function temaEfetivo(escolha: string | null | undefined, aparelhoEscuro: boolean): TemaDaTela {
  if (escolha === "dark") return "escuro";
  if (escolha === "light") return "claro";
  return aparelhoEscuro ? "escuro" : "claro";
}

// Pura: o que gravar ao trocar. Igual ao aparelho, nada (volta a seguir o aparelho).
export function escolhaAoTrocar(atual: TemaDaTela, aparelhoEscuro: boolean): Escolha | null {
  const proximo: TemaDaTela = atual === "escuro" ? "claro" : "escuro";
  if ((proximo === "escuro") === aparelhoEscuro) return null;
  return proximo === "escuro" ? "dark" : "light";
}

const aparelhoEscuro = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function escolhaGuardada(): Escolha | null {
  try {
    const v = localStorage.getItem(CHAVE_DO_TEMA);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Põe a escolha gravada na tela. Roda antes de desenhar, para não piscar no tema errado. */
export function aplicarTemaGuardado(): void {
  const raiz = document.getElementById(ID_DA_TELA);
  const guardada = escolhaGuardada();
  if (raiz && guardada) raiz.setAttribute("data-theme", guardada);
}

export function temaDaTela(): TemaDaTela {
  const raiz = document.getElementById(ID_DA_TELA);
  return temaEfetivo(escolhaGuardada() ?? raiz?.getAttribute("data-theme"), aparelhoEscuro());
}

export function trocarTemaDaTela(): TemaDaTela {
  const raiz = document.getElementById(ID_DA_TELA);
  const escolha = escolhaAoTrocar(temaDaTela(), aparelhoEscuro());
  if (escolha) raiz?.setAttribute("data-theme", escolha);
  else raiz?.removeAttribute("data-theme");
  try {
    if (escolha) localStorage.setItem(CHAVE_DO_TEMA, escolha);
    else localStorage.removeItem(CHAVE_DO_TEMA);
  } catch {}
  window.dispatchEvent(new Event(EVENTO_DO_TEMA));
  return temaDaTela();
}

// Chama `aoMudar` quando o aparelho troca ou quando você troca no botão. Devolve o desligar.
export function ouvirTemaDaTela(aoMudar: (tema: TemaDaTela) => void): () => void {
  const consulta = window.matchMedia("(prefers-color-scheme: dark)");
  const avisar = () => aoMudar(temaDaTela());
  consulta.addEventListener("change", avisar);
  window.addEventListener(EVENTO_DO_TEMA, avisar);
  return () => {
    consulta.removeEventListener("change", avisar);
    window.removeEventListener(EVENTO_DO_TEMA, avisar);
  };
}
