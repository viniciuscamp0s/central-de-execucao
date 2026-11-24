// O formato que o servidor local (central.mjs) entrega em /api/demandas e que a tela lê a cada 5 s.
// Cada tema (o projeto onde a sessão foi aberta, ou uma regra sua em central.config.json) é uma demanda,
// e agrupa as sessões dele.

export const HISTORICO_MS = 60 * 60_000;

// Executando: escreveu nos últimos minutos. Esperando você: a última fala terminou com pergunta.
// Parada: sem escrever há pouco. Encerrada: sem escrever há mais de uma hora.
export const STATUS_DA_DEMANDA = ["executando", "esperando-voce", "parada", "encerrada"] as const;
export type StatusDaDemanda = (typeof STATUS_DA_DEMANDA)[number];

export type SessaoDaDemanda = {
  titulo: string;
  ferramenta: string;
  onde: string | null;
  modelo: string | null;
  estado: StatusDaDemanda;
  ultima: string | null;
  tokens: number;
};

export type Demanda = {
  id: string;
  titulo: string;
  projeto: string;
  status: StatusDaDemanda;
  // O fim da última resposta (a pergunta que ela fez a você, quando está esperando).
  falta: string | null;
  // Tokens novos medidos (entrada + saída + escrita no cache), somando as sessões do tema.
  tokens: number;
  mudouEm: string | null;
  abertaEm: string | null;
  ref: number;
  // A chave do ícone de onde roda (orca, vscode, terminal, jetbrains, desktop, web, nuvem, sdk, outro).
  onde: string | null;
  ondeNome: string | null;
  ativaAgora: boolean;
  agente: { nome: string; agora: boolean } | null;
  rastro: {
    modelos: { nome: string; ativo: boolean }[];
    subagentes: { nome: string; ativo: boolean }[];
    skills: { nome: string; ativo: boolean }[];
  } | null;
  sessoes: SessaoDaDemanda[];
  totalDeSessoes: number;
};

export type Projeto = { id: string; rotulo: string; rotuloCurto: string };
export type PeriodoDaLista = { id: string; dias: number };
export type Aviso = { id: number; em: number; texto: string };
// O mini gráfico do computador no topo da tela: memória e CPU da última hora.
export type PontoDaMaquina = { em: number; memPct: number; cpuPct: number | null };

export type Blocos = { ativas: Demanda[]; paradas: Demanda[]; entregues: Demanda[] };

export type LeituraDasDemandas = {
  agora: number;
  janelaHoras: number;
  demo: boolean;
  maquina: PontoDaMaquina[];
  periodos: PeriodoDaLista[];
  periodoPadrao: string;
  resumo: Record<string, { tokensNovos: number; demandas: number }>;
  pc: { estado: "ao-vivo" | "sem-sinal" | "nunca"; ultimoEm: number | null };
  temLista: boolean;
  blocos: Blocos;
  projetos: Projeto[];
  ondes: { id: string; nome: string }[];
  avisos: Aviso[];
};
