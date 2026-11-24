import { tempoParadoMs } from "./apresentacao";
import { ativaAgora, porPeso } from "./regras";
import { type Demanda, STATUS_DA_DEMANDA, type StatusDaDemanda } from "./tipos";

// Ordenar e filtrar a lista de demandas na tela. Puro, rodando no navegador sobre a leitura de 5 s: nada vai
// ao servidor.
//
// Ordem: clicar no cabeçalho de uma coluna ordena por ela (crescente, depois decrescente). As demandas com
// atividade real agora ficam SEMPRE no topo do bloco, por peso entre elas; o resto segue a coluna escolhida.
// Sem coluna escolhida, a ordem é a do servidor (por peso).

export const COLUNAS = [
  "onde",
  "ref",
  "titulo",
  "projeto",
  "status",
  "agente",
  "parada",
  "falta",
  "previsao",
  "tokens",
] as const;
export type Coluna = (typeof COLUNAS)[number];
export type Direcao = "asc" | "desc";
export type Ordem = { coluna: Coluna; direcao: Direcao } | null;

// O clique no cabeçalho: outra coluna começa crescente (tokens começa do mais pesado); a mesma alterna.
export function proximaOrdem(atual: Ordem, coluna: Coluna): Ordem {
  if (atual?.coluna !== coluna) return { coluna, direcao: coluna === "tokens" ? "desc" : "asc" };
  return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
}

const instante = (valor: string | null | undefined): number | null => {
  if (!valor) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? t : null;
};
const texto = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

// O valor de cada coluna; null vai sempre para o fim, nas duas direções.
function valor(d: Demanda, coluna: Coluna, agora: number): number | string | null {
  switch (coluna) {
    case "onde":
      return d.onde ?? null;
    case "ref":
      return d.ref ?? null;
    case "titulo":
      return d.titulo;
    case "projeto":
      return d.projeto;
    case "status":
      return STATUS_DA_DEMANDA.indexOf(d.status);
    case "agente":
      return d.agente?.nome ?? null;
    case "parada":
      return tempoParadoMs(d, agora);
    case "falta":
      return d.falta ?? null;
    case "previsao":
      return instante(d.abertaEm);
    case "tokens":
      return d.tokens;
  }
}

export function ordenarDemandas(lista: readonly Demanda[], ordem: Ordem, agora: number): Demanda[] {
  const fixas = lista.filter(ativaAgora).sort(porPeso);
  const resto = lista.filter((d) => !ativaAgora(d));
  if (ordem) {
    const sinal = ordem.direcao === "asc" ? 1 : -1;
    resto.sort((a, b) => {
      const va = valor(a, ordem.coluna, agora);
      const vb = valor(b, ordem.coluna, agora);
      if (va === null || vb === null) {
        if (va === vb) return porPeso(a, b);
        return va === null ? 1 : -1;
      }
      const c =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : texto.compare(String(va), String(vb));
      return c * sinal || porPeso(a, b);
    });
  }
  return [...fixas, ...resto];
}

// ---------- filtros ----------
export type Filtro = {
  // Quantos dias olhar para trás (null = tudo o que o servidor leu).
  dias: number | null;
  projeto: string | null;
  status: StatusDaDemanda[];
  onde: string | null;
};
export const FILTRO_INICIAL: Filtro = { dias: null, projeto: null, status: [], onde: null };

// O período vale pelo último registro; o que está executando entra sempre.
export function noPeriodo(d: Demanda, dias: number | null, agora: number): boolean {
  if (dias === null || d.status === "executando") return true;
  const em = instante(d.mudouEm);
  return em !== null && agora - em <= dias * 86_400_000;
}

export function filtrarDemandas(lista: readonly Demanda[], filtro: Filtro, agora: number): Demanda[] {
  return lista.filter(
    (d) =>
      noPeriodo(d, filtro.dias, agora) &&
      (filtro.projeto === null || d.projeto === filtro.projeto) &&
      (filtro.status.length === 0 || filtro.status.includes(d.status)) &&
      (filtro.onde === null || d.onde === filtro.onde),
  );
}
