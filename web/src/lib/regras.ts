import type { Demanda } from "./tipos";

// As duas regras de ordem que o servidor (os blocos) e a tela (a ordem por coluna) dividem.

/** Por peso: mais tokens novos no topo; empate pelo id. */
export const porPeso = (a: Demanda, b: Demanda) => b.tokens - a.tokens || a.id.localeCompare(b.id);

/** Atividade real agora: sessão que escreveu há segundos. */
export const ativaAgora = (d: Demanda) => d.status === "executando" && d.ativaAgora === true;
