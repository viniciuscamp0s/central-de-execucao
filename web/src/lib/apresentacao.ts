import type { Demanda, StatusDaDemanda } from "./tipos";

// Como a tela fala (puro). Nada aqui estima nada: o que o registro não tem fica vazio.

export const ROTULO_DO_STATUS: Record<StatusDaDemanda, string> = {
  executando: "Executando",
  "esperando-voce": "Esperando você",
  parada: "Parada",
  encerrada: "Encerrada",
};

// Onde roda agora, ou onde rodou por último, para o title do ícone.
export function textoDoOnde(d: Demanda): string | null {
  if (!d.onde || !d.ondeNome) return null;
  return d.status === "executando" ? `Rodando em ${d.ondeNome}` : `Rodou por último em ${d.ondeNome}`;
}

// O número de referência (#4829130): fixo para o tema, calculado a partir do nome dele.
export function textoDaRef(ref: number | undefined): string | null {
  return typeof ref === "number" ? `#${ref}` : null;
}

// ---------- tempo parado ----------
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const MES = 30 * DIA;
const ANO = 365 * DIA;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Menos de 1 h em minutos; de 1 h a 24 h em horas; de 1 a 30 dias em dias; depois meses e anos.
export function duracaoCurta(ms: number): string {
  const v = Math.max(0, ms);
  if (v < HORA) return `${Math.max(1, Math.floor(v / MINUTO))} min`;
  if (v < DIA) return `${Math.floor(v / HORA)} h`;
  if (v <= 30 * DIA) return plural(Math.max(1, Math.floor(v / DIA)), "dia", "dias");
  if (v < ANO) return plural(Math.max(1, Math.floor(v / MES)), "mês", "meses");
  return plural(Math.floor(v / ANO), "ano", "anos");
}

// Há quanto tempo a demanda está parada (pelo último registro). Executando não está parada: null.
export function tempoParadoMs(d: Demanda, agora: number): number | null {
  if (d.status === "executando" || !d.mudouEm) return null;
  const t = Date.parse(d.mudouEm);
  return Number.isFinite(t) ? Math.max(0, agora - t) : null;
}
export function textoDoTempoParado(d: Demanda, agora: number): string | null {
  const ms = tempoParadoMs(d, agora);
  return ms === null ? null : duracaoCurta(ms);
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

export function tokensPorExtenso(n: number): string {
  return inteiro.format(Math.max(0, Math.round(n)));
}

// A versão curta do celular: 845, 12,3 mil, 1,2 mi, 3,4 bi.
export function tokensCurtos(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1_000) return inteiro.format(v);
  if (v < 1_000_000) return `${umaCasa.format(v / 1_000)} mil`;
  if (v < 1_000_000_000) return `${umaCasa.format(v / 1_000_000)} mi`;
  return `${umaCasa.format(v / 1_000_000_000)} bi`;
}

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const chaveDoDia = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });

/** "hoje 14:30", "ontem 09:12" ou "21/11 18:05", no fuso do seu computador. */
export function quando(ms: number, agora: number): string {
  const d = chaveDoDia.format(ms);
  if (d === chaveDoDia.format(agora)) return `hoje ${hora.format(ms)}`;
  if (d === chaveDoDia.format(agora - 86_400_000)) return `ontem ${hora.format(ms)}`;
  return `${dia.format(ms)} ${hora.format(ms)}`;
}

// A coluna "Aberta em": quando a primeira sessão do tema começou.
export function textoDaAbertura(d: Demanda, agora: number): string {
  const em = d.abertaEm ? Date.parse(d.abertaEm) : Number.NaN;
  return Number.isFinite(em) ? quando(em, agora) : "sem data";
}

// ---------- agente ----------
/** O texto da coluna Agente e o title: quem trabalha agora, ou o último que trabalhou. */
export function textoDoAgente(d: Demanda): { nome: string; title: string; agora: boolean } | null {
  const a = d.agente;
  if (!a) return null;
  return {
    nome: a.nome,
    agora: a.agora,
    title: a.agora ? `${a.nome} trabalhando agora` : `Último a trabalhar: ${a.nome}`,
  };
}
