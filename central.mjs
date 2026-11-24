#!/usr/bin/env node
// Central de Execução: painel local das suas sessões de IA (Claude Code, Codex e o que você plugar).
// Só Node 18+, sem dependências e sem rede: lê os registros que as próprias ferramentas gravam no seu PC
// e serve a tela (a pasta dist/, já construída) em http://127.0.0.1:4555. Nada sai da sua máquina.
//
// Uso:
//   node central.mjs                 abre o painel (porta 4555)
//   node central.mjs --demo          abre o painel com sessões de exemplo (a pasta exemplos/), sem ler as suas
//   node central.mjs --porta 5000    outra porta
//   node central.mjs --json          imprime o retrato em JSON e sai (para usar em outro script ou agente)
//   node central.mjs --horas 72      janela de leitura (padrão 168 h = 7 dias)

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { promises as fs, readFileSync, existsSync, rmSync } from "node:fs";
import { cpus, freemem, homedir, tmpdir, totalmem } from "node:os";
import { join, basename, dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};
const DEMO = args.includes("--demo");

// ---------- Configuração (opcional) ----------
// central.config.json ao lado deste arquivo ou em ~/.central-de-execucao.json. Ver central.config.example.json.
// No modo demonstração a sua configuração não vale: a tela mostra sempre o mesmo exemplo.
function lerConfig() {
  if (DEMO) return {};
  for (const p of [join(AQUI, "central.config.json"), join(homedir(), ".central-de-execucao.json")]) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        console.error(`Config inválida em ${p}: ${e.message}`);
      }
    }
  }
  return {};
}
const CONFIG = lerConfig();
const HORAS = Number(arg("--horas", CONFIG.horas ?? 168));
const PORTA = Number(arg("--porta", CONFIG.porta ?? 4555));
const ATIVA_MIN = CONFIG.ativaMinutos ?? 3; // escreveu nos últimos N min = trabalhando
const PARADA_MIN = CONFIG.paradaMinutos ?? 60; // até N min = parada (cache ainda quente)
const AGORA_SEG = CONFIG.ativaAgoraSegundos ?? 45; // escreveu nos últimos N s = destaque "trabalhando agora"

// ---------- Leitura incremental: cada arquivo é lido uma vez; depois, só o que foi acrescentado ----------
// Os registros têm milhares de linhas grandes (saída de ferramenta) que não interessam. Em vez de interpretar
// todas, a leitura procura direto nos bytes as poucas linhas que importam (a resposta do assistente, o título, o
// primeiro pedido) e só interpreta essas.
const LOTE = 4 * 1024 * 1024;
const LINHA_MAXIMA = 1_500_000; // linha maior que isso (saída de ferramenta) não é interpretada

async function* arquivos(dir, ext, profundidade = 4) {
  let itens;
  try {
    itens = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of itens) {
    const p = join(dir, it.name);
    if (it.isDirectory() && profundidade > 0) yield* arquivos(p, ext, profundidade - 1);
    else if (it.isFile() && it.name.endsWith(ext)) yield p;
  }
}

// Os arquivos recentes (e o tamanho de cada um), do mais novo para o mais antigo.
async function recentes(raiz, desde, profundidade) {
  const lista = [];
  for await (const f of arquivos(raiz, ".jsonl", profundidade)) {
    const st = await fs.stat(f).catch(() => null);
    if (st && st.mtimeMs >= desde) lista.push({ f, st });
  }
  return lista.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
}

// Lê vários arquivos ao mesmo tempo: enquanto um espera o disco, outro é interpretado.
async function emParalelo(lista, quantos, fazer) {
  const saida = new Array(lista.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(quantos, lista.length) }, async () => {
      while (proximo < lista.length) {
        const i = proximo++;
        saida[i] = await fazer(lista[i]);
      }
    }),
  );
  return saida;
}

const MEMORIA = new Map(); // arquivo -> { tam, mtime, desloc, est }
let vistos = new Set(); // arquivos tocados na rodada atual (o resto sai da memória)

// Lê o que falta do arquivo e entrega cada lote de linhas completas a `processar(buffer, estado)`.
async function lerArquivo(f, st, novoEstado, processar) {
  vistos.add(f);
  let m = MEMORIA.get(f);
  if (m && st.size === m.tam && st.mtimeMs === m.mtime) return m.est;
  // Arquivo menor ou reescrito sem crescer: começa de novo. Só cresceu: continua de onde parou.
  if (!m || st.size <= m.tam) m = { tam: 0, mtime: 0, desloc: 0, est: novoEstado() };
  const fh = await fs.open(f, "r");
  try {
    let pos = m.desloc;
    let resto = Buffer.alloc(0);
    while (pos < st.size) {
      const n = Math.min(LOTE, st.size - pos);
      const buf = Buffer.allocUnsafe(n);
      const { bytesRead } = await fh.read(buf, 0, n, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const dados = resto.length ? Buffer.concat([resto, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const ult = dados.lastIndexOf(0x0a);
      if (ult < 0) {
        resto = Buffer.from(dados);
        continue;
      }
      resto = Buffer.from(dados.subarray(ult + 1));
      processar(dados.subarray(0, ult), m.est);
    }
    m.desloc = pos - resto.length;
    m.tam = st.size;
    m.mtime = st.mtimeMs;
    MEMORIA.set(f, m);
    return m.est;
  } catch (e) {
    MEMORIA.delete(f);
    throw e;
  } finally {
    await fh.close();
  }
}

// Cada linha que contém o marcador, com onde ela começa e termina no lote.
function* achados(buf, marcador, de = 0) {
  const m = Buffer.from(marcador);
  let i = buf.indexOf(m, de);
  while (i >= 0) {
    const ini = buf.lastIndexOf(0x0a, i) + 1;
    let fim = buf.indexOf(0x0a, i);
    if (fim < 0) fim = buf.length;
    yield { ini, fim, linha: buf.subarray(ini, fim) };
    i = buf.indexOf(m, fim);
  }
}
function interpretar(a) {
  if (a.linha.length > LINHA_MAXIMA) return null;
  try {
    return JSON.parse(a.linha.toString("utf8"));
  } catch {
    return null;
  }
}

const RE_HORA = /"timestamp":"([^"]{20,32})"/;
// O horário da última linha do lote (fica no fim das linhas do Claude Code e no começo das do Codex).
function horaDaUltimaLinha(buf) {
  const ini = buf.lastIndexOf(0x0a) + 1;
  if (buf.length - ini <= 0) return NaN;
  const m =
    RE_HORA.exec(buf.subarray(Math.max(ini, buf.length - 600), buf.length).toString("utf8")) ||
    RE_HORA.exec(buf.subarray(ini, Math.min(buf.length, ini + 200)).toString("utf8"));
  return m ? Date.parse(m[1]) : NaN;
}
function marcarHora(est, t) {
  if (!Number.isFinite(t)) return;
  if (!est.inicio || t < est.inicio) est.inicio = t;
  if (!est.ultima || t > est.ultima) est.ultima = t;
}
// Tokens novos por hora (UTC): entrada + saída + escrita no cache, a mesma conta da coluna Tokens.
function somarTokens(est, t, delta) {
  if (!(delta > 0)) return;
  est.tokens += delta;
  if (!Number.isFinite(t)) return;
  const hora = new Date(t).toISOString().slice(0, 13);
  est.porHora[hora] = (est.porHora[hora] || 0) + delta;
}

const textoDe = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((c) => c && (c.type === "text" || c.type === "input_text" || c.type === "output_text"))
      .map((c) => c.text)
      .join(" ");
  return "";
};
const limpar = (t) =>
  (t || "")
    .replace(/<[^>]{1,40}>[\s\S]*?<\/[^>]{1,40}>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const curto = (t, n = 220) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const NOME_CURTO = /^[A-Za-z0-9:_.-]{1,60}$/;

// ---------- Interfaces: de onde a sessão foi aberta ----------
const INTERFACES = {
  cli: "Terminal",
  "claude-vscode": "VS Code",
  "claude-jetbrains": "JetBrains",
  orca: "Orca",
  "claude-desktop": "Claude Desktop",
  web: "Web (claude.ai/code)",
  remote: "Nuvem",
  "sdk-ts": "SDK / automação",
  "sdk-py": "SDK / automação",
  "sdk-cli": "SDK / automação",
  mcp: "MCP",
  codex_cli_rs: "Terminal",
  codex_exec: "Codex exec (automação)",
  codex_vscode: "VS Code",
  codex_desktop: "Codex Desktop",
  ...(CONFIG.interfaces || {}),
};
const nomeInterface = (bruto) => (bruto ? INTERFACES[bruto] || bruto : "Desconhecida");

// A chave do ícone da tela (a primeira coluna): o que roda onde.
const ICONE_DA_INTERFACE = {
  cli: "terminal",
  codex_cli_rs: "terminal",
  "claude-vscode": "vscode",
  codex_vscode: "vscode",
  "claude-jetbrains": "jetbrains",
  orca: "orca",
  "claude-desktop": "desktop",
  codex_desktop: "desktop",
  web: "web",
  remote: "nuvem",
  "sdk-ts": "sdk",
  "sdk-py": "sdk",
  "sdk-cli": "sdk",
  mcp: "sdk",
  codex_exec: "sdk",
};
const iconeDaInterface = (bruto) => (bruto ? ICONE_DA_INTERFACE[bruto] || "outro" : null);

// ---------- Adaptadores: cada ferramenta de IA é um ----------
// Para plugar outra (Gemini CLI, Aider, Cursor...): escreva uma função async que devolva sessões
// no formato de `sessao()` abaixo e acrescente em ADAPTADORES.
function sessao(campos) {
  return {
    ferramenta: "",
    id: "",
    titulo: "",
    pedido: "",
    pasta: "",
    branch: "",
    interface: "Desconhecida",
    interfaceBruta: "",
    modelos: [],
    inicio: null,
    ultima: null,
    tokens: 0, // tokens novos: entrada + saída + escrita no cache (sem a leitura do cache)
    tokensSaida: 0,
    porHora: {}, // tokens novos por hora (UTC, "AAAA-MM-DDTHH")
    skills: [], // [{ nome, em }]
    subagentes: [], // [{ nome, em }]
    subagente: false,
    esperandoVoce: false,
    fimDaResposta: "",
    arquivo: "",
    ...campos,
  };
}

// ----- Claude Code -----
function estadoClaude() {
  return {
    pasta: "",
    branch: "",
    interfaceBruta: "",
    titulo: "",
    pedido: "",
    inicio: null,
    ultima: null,
    tokens: 0,
    tokensSaida: 0,
    porHora: {},
    usos: new Map(), // id da mensagem -> { novo, saida } (a mesma resposta é gravada em várias linhas)
    modelos: new Set(),
    modeloAtual: "",
    skills: new Map(),
    subagentes: new Map(),
    fim: "",
    ultimoTipo: "", // "fala" (assistente escreveu texto) | "ferramenta" | "usuario"
  };
}

// Um lote de linhas completas do registro do Claude Code.
function processarClaude(buf, est) {
  marcarHora(est, horaDaUltimaLinha(buf));
  let fimDoUltimoAssistente = 0;
  const base = (e) => {
    if (e.cwd && !est.pasta) est.pasta = e.cwd;
    if (e.gitBranch && !est.branch) est.branch = e.gitBranch;
    if (e.entrypoint && !est.interfaceBruta) est.interfaceBruta = e.entrypoint;
    if (e.timestamp) marcarHora(est, Date.parse(e.timestamp));
  };
  // O primeiro pedido seu: a primeira mensagem de usuário que não é saída de ferramenta.
  if (!est.pedido) {
    for (const a of achados(buf, '"type":"user"')) {
      if (a.linha.includes('"type":"tool_result"')) continue;
      const e = interpretar(a);
      if (!e) continue;
      base(e);
      if (e.isMeta || !e.message) continue;
      const txt = limpar(textoDe(e.message.content));
      if (txt && !txt.startsWith("Caveat:") && !txt.startsWith("[Request interrupted")) {
        est.pedido = curto(txt, 400);
        break;
      }
    }
  }
  for (const a of achados(buf, '"type":"ai-title"')) {
    const e = interpretar(a);
    if (e?.aiTitle) est.titulo = e.aiTitle;
  }
  if (!est.titulo) {
    for (const a of achados(buf, '"type":"summary"')) {
      const e = interpretar(a);
      if (e?.summary && !est.titulo) est.titulo = e.summary;
    }
  }
  for (const a of achados(buf, '"type":"assistant"')) {
    const e = interpretar(a);
    fimDoUltimoAssistente = a.fim;
    if (!e?.message) {
      est.ultimoTipo = "ferramenta";
      continue;
    }
    base(e);
    const m = e.message;
    const hora = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (m.model && m.model !== "<synthetic>") {
      est.modelos.add(m.model);
      est.modeloAtual = m.model;
    }
    const u = m.usage;
    if (u) {
      const id = m.id || e.uuid || `${a.ini}`;
      const novo = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const saida = u.output_tokens || 0;
      const antes = est.usos.get(id) || { novo: 0, saida: 0 };
      est.usos.set(id, { novo, saida });
      est.tokensSaida += saida - antes.saida;
      somarTokens(est, hora, novo - antes.novo);
    }
    const blocos = Array.isArray(m.content) ? m.content : [];
    let usouFerramenta = false;
    for (const c of blocos) {
      if (c?.type !== "tool_use") continue;
      usouFerramenta = true;
      const ehSkill = c.name === "Skill";
      const ehSub = c.name === "Task" || c.name === "Agent";
      const alvo = ehSkill ? c.input?.skill : ehSub ? c.input?.subagent_type : null;
      if ((ehSkill || ehSub) && typeof alvo === "string" && NOME_CURTO.test(alvo)) (ehSkill ? est.skills : est.subagentes).set(alvo, hora);
    }
    const txt = limpar(textoDe(m.content));
    if (txt) est.fim = curto(txt.slice(-300), 300);
    est.ultimoTipo = txt && !usouFerramenta ? "fala" : "ferramenta";
  }
  // Depois da última resposta do assistente veio algo seu ou o retorno de uma ferramenta: ele não está esperando você.
  if (buf.indexOf('"type":"user"', fimDoUltimoAssistente) >= 0) est.ultimoTipo = "usuario";
}

async function claudeCode(desde) {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const raiz = join(base, "projects");
  const lidos = (
    await emParalelo(await recentes(raiz, desde, 4), 6, async ({ f, st }) => {
      const partes = f.split(sep);
      const iSub = partes.lastIndexOf("subagents");
      const ehSub = iSub > 1;
      const est = await lerArquivo(f, st, estadoClaude, processarClaude).catch(() => null);
      return est ? { f, st, est, ehSub, paiId: ehSub ? partes[iSub - 1] : null } : null;
    })
  ).filter(Boolean);
  const out = [];
  const porId = new Map();
  for (const { f, st, est, ehSub } of lidos) {
    if (ehSub && !CONFIG.mostrarSubagentes) continue;
    const s = sessao({
      ferramenta: "Claude Code",
      arquivo: f,
      subagente: ehSub,
      id: basename(f, ".jsonl"),
      pasta: est.pasta,
      branch: est.branch,
      interfaceBruta: est.interfaceBruta,
      titulo: est.titulo,
      pedido: est.pedido,
      inicio: est.inicio,
      ultima: est.ultima || st.mtimeMs,
      tokens: est.tokens,
      tokensSaida: est.tokensSaida,
      porHora: { ...est.porHora },
      modelos: [...est.modelos],
      fimDaResposta: est.fim,
      esperandoVoce: est.ultimoTipo === "fala" && /\?\s*$/.test(est.fim),
      skills: [...est.skills].map(([nome, em]) => ({ nome, em })),
      subagentes: [...est.subagentes].map(([nome, em]) => ({ nome, em })),
    });
    s.interface = nomeInterface(s.interfaceBruta);
    s.modeloAtual = est.modeloAtual;
    out.push(s);
    porId.set(`${dirname(f)}${sep}${s.id}`, s);
  }
  // Os arquivos dos subagentes são parte da sessão que os chamou: os tokens deles somam nela, e a sessão
  // conta como ativa enquanto um subagente escreve.
  if (!CONFIG.mostrarSubagentes) {
    for (const { f, st, est, ehSub, paiId } of lidos) {
      if (!ehSub) continue;
      const partes = f.split(sep);
      const iSub = partes.lastIndexOf("subagents");
      const pai = porId.get(`${partes.slice(0, iSub - 1).join(sep)}${sep}${paiId}`);
      if (!pai) continue;
      pai.tokens += est.tokens;
      pai.tokensSaida += est.tokensSaida;
      for (const [h, v] of Object.entries(est.porHora)) pai.porHora[h] = (pai.porHora[h] || 0) + v;
      pai.ultima = Math.max(pai.ultima || 0, est.ultima || st.mtimeMs);
      for (const mo of est.modelos) if (!pai.modelos.includes(mo)) pai.modelos.push(mo);
    }
  }
  return out;
}

// ----- Codex -----
function estadoCodex() {
  return {
    pasta: "",
    branch: "",
    interfaceBruta: "",
    id: "",
    subagente: false,
    pedido: "",
    inicio: null,
    ultima: null,
    tokens: 0,
    tokensSaida: 0,
    porHora: {},
    totalAntes: 0,
    modelos: new Set(),
    modeloAtual: "",
    fim: "",
    ultimoTipo: "",
  };
}

// Um lote de linhas completas do registro do Codex.
function processarCodex(buf, est) {
  marcarHora(est, horaDaUltimaLinha(buf));
  const hora = (e) => (e.timestamp ? Date.parse(e.timestamp) : NaN);
  if (!est.id) {
    for (const a of achados(buf, '"type":"session_meta"')) {
      const e = interpretar(a);
      const p = e?.payload;
      if (!p) continue;
      marcarHora(est, hora(e));
      est.pasta = p.cwd || est.pasta;
      est.interfaceBruta = p.originator || est.interfaceBruta;
      est.id = p.id || est.id;
      est.branch = p.git?.branch || est.branch;
      if (p.source && typeof p.source === "object" && p.source.subagent) est.subagente = true;
      break;
    }
  }
  for (const a of achados(buf, '"type":"turn_context"')) {
    const e = interpretar(a);
    if (e?.payload?.model) {
      est.modelos.add(e.payload.model);
      est.modeloAtual = e.payload.model;
    }
  }
  for (const a of achados(buf, '"type":"token_count"')) {
    const e = interpretar(a);
    const u = e?.payload?.info?.total_token_usage;
    if (!u) continue;
    // O Codex soma o cache dentro da entrada: o que é novo é a entrada sem o cache, mais a saída.
    const total = Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)) + (u.output_tokens || 0);
    if (total > est.totalAntes) {
      somarTokens(est, hora(e), total - est.totalAntes);
      est.totalAntes = total;
    }
    if (u.output_tokens) est.tokensSaida = u.output_tokens;
  }
  let fimDaUltimaMensagem = 0;
  for (const a of achados(buf, '"type":"message"')) {
    const e = interpretar(a);
    const p = e?.payload;
    if (e?.type !== "response_item" || p?.type !== "message") continue;
    marcarHora(est, hora(e));
    const txt = limpar(textoDe(p.content));
    if (p.role === "user" && !est.pedido && txt && !txt.startsWith("<") && !/^#?\s*AGENTS\.md/i.test(txt)) est.pedido = curto(txt, 400);
    if (p.role === "assistant" && txt) {
      est.fim = curto(txt.slice(-300), 300);
      est.ultimoTipo = "fala";
    } else est.ultimoTipo = p.role === "user" ? "usuario" : "ferramenta";
    fimDaUltimaMensagem = a.fim;
  }
  if (fimDaUltimaMensagem && buf.indexOf('"type":"response_item"', fimDaUltimaMensagem) >= 0) est.ultimoTipo = "ferramenta";
}

async function codex(desde) {
  const raiz = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
  const out = [];
  const lidos = await emParalelo(await recentes(raiz, desde, 4), 4, async ({ f, st }) => ({
    f,
    st,
    est: await lerArquivo(f, st, estadoCodex, processarCodex).catch(() => null),
  }));
  for (const { f, st, est } of lidos) {
    if (!est) continue;
    if (est.subagente && !CONFIG.mostrarSubagentes) continue;
    const s = sessao({
      ferramenta: "Codex",
      arquivo: f,
      id: est.id || basename(f, ".jsonl"),
      pasta: est.pasta,
      branch: est.branch,
      interfaceBruta: est.interfaceBruta,
      pedido: est.pedido,
      subagente: est.subagente,
      inicio: est.inicio,
      ultima: est.ultima || st.mtimeMs,
      tokens: est.tokens,
      tokensSaida: est.tokensSaida,
      porHora: { ...est.porHora },
      modelos: [...est.modelos],
      fimDaResposta: est.fim,
      esperandoVoce: est.ultimoTipo === "fala" && /\?\s*$/.test(est.fim),
    });
    s.interface = nomeInterface(s.interfaceBruta);
    s.modeloAtual = est.modeloAtual;
    out.push(s);
  }
  return out;
}

const ADAPTADORES = [claudeCode, codex];

// ---------- Temas: agrupar sessões da mesma demanda ----------
// 1) regras da config (palavra ou regex no título, no pedido ou na pasta), na ordem;
// 2) senão, o projeto: a raiz do repositório, sem o sufixo de worktree.
function projetoDaPasta(pasta) {
  if (!pasta) return "Sem pasta";
  const partes = pasta.split(/[\\/]+/).filter(Boolean);
  // worktrees comuns: .../worktrees/<nome>, .../.claude/worktrees/<nome>, pastas _wt-*, *-wt-*
  const iWt = partes.findIndex((p) => /^(worktrees?|\.worktrees)$/i.test(p));
  let nome = iWt > 0 ? (partes[iWt - 1] === ".claude" ? partes[iWt - 2] : partes[iWt - 1]) : partes.at(-1);
  nome = (nome || "").replace(/^_?wt[-_]/i, "").replace(/[-_]wt[-_].*$/i, "");
  return nome || "Sem pasta";
}
const REGRAS = (CONFIG.temas || []).map((r) => ({
  tema: r.tema,
  re: new RegExp(r.regex || r.palavras.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i"),
  onde: r.onde || ["titulo", "pedido", "pasta"],
}));
function temaDa(s) {
  for (const r of REGRAS) if (r.onde.some((c) => r.re.test(s[c] || ""))) return r.tema;
  return projetoDaPasta(s.pasta);
}

function estadoDa(s, agora) {
  const min = (agora - s.ultima) / 60000;
  if (s.esperandoVoce && min < 24 * 60) return "esperando-voce";
  if (min <= ATIVA_MIN) return "trabalhando";
  if (min <= PARADA_MIN) return "parada";
  return "encerrada";
}

// Uma leitura de tudo: um retrato por vez (várias abas abertas dividem a mesma leitura).
let leituraEmCurso = null;
async function sessoesDoDisco() {
  if (leituraEmCurso) return leituraEmCurso;
  leituraEmCurso = (async () => {
    if (DEMO) await prepararDemo();
    const agora = Date.now();
    const desde = agora - HORAS * 3600 * 1000;
    vistos = new Set();
    const listas = await Promise.all(ADAPTADORES.map((a) => a(desde).catch((e) => (console.error(e), []))));
    for (const f of [...MEMORIA.keys()]) if (!vistos.has(f)) MEMORIA.delete(f);
    return { agora, sessoes: listas.flat() };
  })().finally(() => {
    leituraEmCurso = null;
  });
  return leituraEmCurso;
}

async function retrato() {
  const { agora, sessoes: brutas } = await sessoesDoDisco();
  const sessoes = brutas
    .map((s) => ({ ...s, tema: temaDa(s), estado: estadoDa(s, agora) }))
    .sort((a, b) => b.ultima - a.ultima);
  const grupos = new Map();
  for (const s of sessoes) {
    if (!grupos.has(s.tema)) grupos.set(s.tema, []);
    grupos.get(s.tema).push(s);
  }
  const conta = (campo) => {
    const m = {};
    for (const s of sessoes) for (const v of [].concat(s[campo])) m[v] = (m[v] || 0) + 1;
    return m;
  };
  return {
    geradoEm: agora,
    janelaHoras: HORAS,
    total: sessoes.length,
    porEstado: conta("estado"),
    porInterface: conta("interface"),
    porModelo: conta("modelos"),
    porFerramenta: conta("ferramenta"),
    temas: [...grupos.entries()].map(([tema, lista]) => ({ tema, ultima: lista[0].ultima, sessoes: lista })),
    _agora: agora,
  };
}
function paraJson(r) {
  const { _agora, ...resto } = r;
  return {
    ...resto,
    temas: r.temas.map((t) => ({
      ...t,
      sessoes: t.sessoes.map(({ arquivo, porHora, skills, subagentes, modeloAtual, ...s }) => s),
    })),
  };
}

// ---------- O computador ao vivo: memória e CPU da última hora, amostradas aqui mesmo ----------
const HISTORICO_MS = 60 * 60_000;
const AMOSTRA_MS = 5_000;
const amostras = []; // { em, memPct, cpuPct }
let cpuAntes = null;
function memoriaUsadaPct() {
  const total = totalmem();
  let livre = freemem();
  try {
    // No Linux, o que o sistema considera disponível inclui o cache que ele devolve na hora.
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) livre = Number(m[1]) * 1024;
  } catch {}
  return Math.round(((total - livre) / total) * 1000) / 10;
}
function cpuAgora() {
  let ocioso = 0;
  let soma = 0;
  for (const c of cpus()) {
    for (const v of Object.values(c.times)) soma += v;
    ocioso += c.times.idle;
  }
  const antes = cpuAntes;
  cpuAntes = { ocioso, soma };
  if (!antes || soma === antes.soma) return null;
  return Math.round((1 - (ocioso - antes.ocioso) / (soma - antes.soma)) * 1000) / 10;
}
function amostrar() {
  const em = Date.now();
  amostras.push({ em, memPct: memoriaUsadaPct(), cpuPct: cpuAgora() });
  while (amostras.length && em - amostras[0].em > HISTORICO_MS) amostras.shift();
}
// Junta a hora em até `maximo` pontos (médias por faixa de tempo): a resposta fica pequena.
function afinar(agora, maximo = 90) {
  if (amostras.length <= maximo) return amostras.map((a) => ({ ...a }));
  const faixa = HISTORICO_MS / maximo;
  const grupos = new Map();
  for (const a of amostras) {
    const chave = Math.min(maximo - 1, Math.floor((agora - a.em) / faixa));
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(a);
  }
  const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return [...grupos.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, g]) => {
      const cpusG = g.map((x) => x.cpuPct).filter((v) => v !== null);
      return {
        em: Math.round(media(g.map((x) => x.em))),
        memPct: Math.round(media(g.map((x) => x.memPct)) * 10) / 10,
        cpuPct: cpusG.length ? Math.round(media(cpusG) * 10) / 10 : null,
      };
    });
}

// ---------- A lista de demandas (o que a tela lê a cada 5 s) ----------
const HORA_MS = 3_600_000;
const QUARENTA_E_OITO_H_MS = 48 * HORA_MS;
const FAMILIAS = ["opus", "sonnet", "haiku", "fable"];
const familiaDoModelo = (m) => FAMILIAS.find((f) => new RegExp(f, "i").test(m || "")) || null;
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const iso = (ms) => (Number.isFinite(ms) && ms ? new Date(ms).toISOString() : null);

// "Claude Opus", "Claude", "GPT (Codex)" ou o nome da ferramenta plugada.
function nomeDoAgente(s) {
  if (s.ferramenta === "Codex") return "GPT (Codex)";
  if (s.ferramenta === "Claude Code") {
    const f = familiaDoModelo(s.modeloAtual || s.modelos.at(-1));
    return f ? `Claude ${maiuscula(f)}` : "Claude";
  }
  return s.ferramenta || "IA";
}
function nomeDoModelo(s, modelo) {
  if (s.ferramenta === "Codex") return `GPT (Codex) · ${modelo}`;
  const f = familiaDoModelo(modelo);
  return f ? `Claude ${maiuscula(f)}` : modelo;
}

// Até 140 caracteres do fim do texto, começando numa frase inteira quando dá.
function ultimasFrases(texto, max = 140) {
  const t = (texto || "").replace(/[*`#>_]+/g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const partes = t.split(/(?<=[.!?:])\s+/);
  let out = "";
  for (let i = partes.length - 1; i >= 0; i--) {
    const cand = out ? `${partes[i]} ${out}` : partes[i];
    if (cand.length > max) break;
    out = cand;
  }
  return out || `…${t.slice(-(max - 1))}`;
}

const refDoTema = (tema) => 1_000_000 + (parseInt(createHash("sha1").update(tema).digest("hex").slice(0, 8), 16) % 9_000_000);

// As janelas do filtro de período, até o tamanho da leitura.
function periodosDisponiveis() {
  const dias = [1, 7, 30].filter((d) => d * 24 <= HORAS);
  const maior = Math.max(1, Math.ceil(HORAS / 24));
  if (!dias.length || dias.at(-1) < maior) dias.push(maior);
  return dias.map((d) => ({ id: `${d}d`, dias: d }));
}

function montarDemandas(sessoes, agora) {
  const grupos = new Map();
  for (const s of sessoes) {
    if (!grupos.has(s.tema)) grupos.set(s.tema, []);
    grupos.get(s.tema).push(s);
  }
  const prioridade = { trabalhando: 0, "esperando-voce": 1, parada: 2, encerrada: 3 };
  const demandas = [];
  for (const [tema, lista] of grupos) {
    lista.sort((a, b) => b.ultima - a.ultima);
    // A sessão que representa a demanda: a que trabalha, senão a que espera você, senão a mais recente.
    const rep = [...lista].sort((a, b) => prioridade[a.estado] - prioridade[b.estado] || b.ultima - a.ultima)[0];
    const estado = rep.estado;
    const status = estado === "trabalhando" ? "executando" : estado;
    const titulo = curto(limpar(rep.titulo || rep.pedido) || "(sem título)", 100);
    const ativaAgora = lista.some((s) => s.estado === "trabalhando" && agora - s.ultima <= AGORA_SEG * 1000);
    const modelos = [];
    for (const s of lista)
      for (const mo of s.modelos) {
        const nome = nomeDoModelo(s, mo);
        if (!modelos.some((x) => x.nome === nome)) modelos.push({ nome, ativo: s.estado === "trabalhando" && (s.modeloAtual || s.modelos.at(-1)) === mo });
      }
    const juntar = (campo, janela) => {
      const mapa = new Map();
      for (const s of lista) for (const x of s[campo]) mapa.set(x.nome, Math.max(mapa.get(x.nome) || 0, x.em || 0));
      return [...mapa].slice(-8).map(([nome, em]) => ({ nome, ativo: agora - em <= janela && lista.some((s) => s.estado === "trabalhando") }));
    };
    const falta = rep.esperandoVoce || rep.fimDaResposta ? ultimasFrases(rep.fimDaResposta) : null;
    demandas.push({
      id: `t-${createHash("sha1").update(tema).digest("hex").slice(0, 10)}`,
      titulo,
      projeto: tema,
      status,
      falta,
      tokens: lista.reduce((n, s) => n + s.tokens, 0),
      mudouEm: iso(lista[0].ultima),
      abertaEm: iso(Math.min(...lista.map((s) => s.inicio || s.ultima))),
      ref: refDoTema(tema),
      onde: iconeDaInterface(rep.interfaceBruta),
      ondeNome: rep.interfaceBruta ? rep.interface : null,
      ativaAgora,
      agente: { nome: nomeDoAgente(rep), agora: status === "executando" },
      rastro: { modelos, subagentes: juntar("subagentes", 3 * 60_000), skills: juntar("skills", 5 * 60_000) },
      sessoes: lista.slice(0, 12).map((s) => ({
        titulo: curto(limpar(s.titulo || s.pedido) || "(sem título)", 90),
        ferramenta: s.ferramenta,
        onde: s.interfaceBruta ? s.interface : null,
        modelo: s.modeloAtual || s.modelos.at(-1) ? nomeDoModelo(s, s.modeloAtual || s.modelos.at(-1)) : null,
        estado: s.estado === "trabalhando" ? "executando" : s.estado,
        ultima: iso(s.ultima),
        tokens: s.tokens,
      })),
      totalDeSessoes: lista.length,
    });
  }
  return demandas;
}

// Ativas: trabalhando agora no topo e o que parou ou espera há menos de 48 h; Paradas: o que passou disso.
function separarEmBlocos(itens, agora) {
  const porPeso = (a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id);
  const ativas = [];
  const paradas = [];
  for (const d of itens) {
    const mudou = Date.parse(d.mudouEm || "");
    const recente = Number.isFinite(mudou) && agora - mudou < QUARENTA_E_OITO_H_MS;
    (d.status === "executando" || recente ? ativas : paradas).push(d);
  }
  ativas.sort((a, b) => Number(b.ativaAgora) - Number(a.ativaAgora) || porPeso(a, b));
  paradas.sort(porPeso);
  return { ativas, paradas, entregues: [] };
}

// Os avisos discretos: a diferença entre duas leituras, por regra fixa.
const AVISO_FICA_MS = 2 * 60_000;
const O_QUE_ACONTECEU = {
  executando: "voltou a andar",
  "esperando-voce": "está esperando você",
  parada: "parou",
};
const avisos = [];
let proximoAviso = 1;
let statusAntes = null;
function atualizarAvisos(demandas, agora) {
  const atual = new Map(demandas.map((d) => [d.id, d]));
  if (statusAntes) {
    for (const [id, d] of atual) {
      const antes = statusAntes.get(id);
      if (antes === undefined) {
        if (d.status === "executando") avisos.push({ id: proximoAviso++, em: agora, texto: `Central: ${d.titulo} começou` });
      } else if (antes !== d.status && O_QUE_ACONTECEU[d.status])
        avisos.push({ id: proximoAviso++, em: agora, texto: `Central: ${d.titulo} ${O_QUE_ACONTECEU[d.status]}` });
    }
  }
  statusAntes = new Map(demandas.map((d) => [d.id, d.status]));
  while (avisos.length > 20) avisos.shift();
}

function resumoDosPeriodos(sessoes, demandas, agora) {
  const resumo = {};
  for (const { id, dias } of periodosDisponiveis()) {
    const corte = agora - dias * 86_400_000;
    let tokensNovos = 0;
    for (const s of sessoes)
      for (const [hora, v] of Object.entries(s.porHora)) if (Date.parse(`${hora}:00:00Z`) + HORA_MS > corte) tokensNovos += v;
    const emAndamento = demandas.filter((d) => d.status === "executando" || Date.parse(d.mudouEm || "") >= corte).length;
    resumo[id] = { tokensNovos, demandas: emAndamento };
  }
  return resumo;
}

let ultimaLeitura = { em: 0, valor: null };
async function lerDemandas() {
  const agoraDoCache = Date.now();
  if (ultimaLeitura.valor && agoraDoCache - ultimaLeitura.em < 2000) return ultimaLeitura.valor;
  const { agora, sessoes: brutas } = await sessoesDoDisco();
  const sessoes = brutas.map((s) => ({ ...s, tema: temaDa(s), estado: estadoDa(s, agora) }));
  const demandas = montarDemandas(sessoes, agora);
  atualizarAvisos(demandas, agora);
  const periodos = periodosDisponiveis();
  // Projetos e "onde roda" que a tela oferece nos filtros, só os que existem nesta máquina.
  const projetos = demandas
    .sort((a, b) => Date.parse(b.mudouEm || "") - Date.parse(a.mudouEm || ""))
    .map((d) => ({ id: d.projeto, rotulo: d.projeto, rotuloCurto: curto(d.projeto, 18) }))
    .filter((p, i, todos) => todos.findIndex((x) => x.id === p.id) === i)
    .slice(0, 12);
  const ondes = [];
  for (const d of demandas) if (d.onde && !ondes.some((o) => o.id === d.onde)) ondes.push({ id: d.onde, nome: d.ondeNome || d.onde });
  const valor = {
    agora,
    janelaHoras: HORAS,
    demo: DEMO,
    maquina: afinar(agora),
    periodos,
    periodoPadrao: periodos.at(-1).id,
    resumo: resumoDosPeriodos(sessoes, demandas, agora),
    pc: { estado: "ao-vivo", ultimoEm: agora },
    temLista: demandas.length > 0,
    blocos: separarEmBlocos(demandas, agora),
    projetos,
    ondes,
    avisos: avisos.filter((a) => agora - a.em <= AVISO_FICA_MS),
  };
  ultimaLeitura = { em: Date.now(), valor };
  return valor;
}

// ---------- Modo demonstração: sessões de exemplo, com os horários trazidos para agora ----------
// exemplos/demo.json diz a idade de cada arquivo; aqui os registros são copiados para uma pasta temporária
// com os horários deslocados, e as ferramentas passam a "ler" de lá. Nada da sua máquina entra.
let pastaDaDemo = null;
let demoPreparadaEm = 0;
async function prepararDemo() {
  const agora = Date.now();
  if (pastaDaDemo && agora - demoPreparadaEm < 20_000) return;
  const origem = join(AQUI, "exemplos");
  const manifesto = JSON.parse(readFileSync(join(origem, "demo.json"), "utf8"));
  if (!pastaDaDemo) {
    pastaDaDemo = await fs.mkdtemp(join(tmpdir(), "central-de-execucao-demo-"));
    process.on("exit", () => {
      try {
        rmSync(pastaDaDemo, { recursive: true, force: true });
      } catch {}
    });
  }
  process.env.CLAUDE_CONFIG_DIR = join(pastaDaDemo, "claude");
  process.env.CODEX_HOME = join(pastaDaDemo, "codex");
  for (const item of manifesto.sessoes) {
    const texto = readFileSync(join(origem, item.arquivo), "utf8");
    const horas = [...texto.matchAll(/"timestamp":"([^"]+)"/g)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
    const delta = agora - item.idadeMin * 60_000 - Math.max(...horas);
    const novo = texto.replace(/"timestamp":"([^"]+)"/g, (_, t) => `"timestamp":"${new Date(Date.parse(t) + delta).toISOString()}"`);
    const destino = join(pastaDaDemo, item.arquivo);
    await fs.mkdir(dirname(destino), { recursive: true });
    await fs.writeFile(destino, novo.endsWith("\n") ? novo : `${novo}\n`);
    const quando = new Date(agora - item.idadeMin * 60_000);
    await fs.utimes(destino, quando, quando);
  }
  demoPreparadaEm = agora;
}

// ---------- Saída ----------
if (args.includes("--json")) {
  const r = await retrato();
  process.stdout.write(JSON.stringify(paraJson(r), null, 2));
  process.exit(0);
}

const DIST = join(AQUI, "dist");
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const SEGURANCA = {
  "content-security-policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Só aceita pedido feito para o endereço local: um site de fora não consegue ler a lista pelo seu navegador.
const HOSTS_OK = new Set([`127.0.0.1:${PORTA}`, `localhost:${PORTA}`, `[::1]:${PORTA}`]);

function json(res, corpo) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SEGURANCA });
  res.end(JSON.stringify(corpo));
}

async function entregarArquivo(req, res) {
  const caminho = decodeURIComponent((req.url || "/").split("?")[0]);
  const relativo = caminho === "/" ? "index.html" : normalize(caminho).replace(/^([/\\])+/, "");
  const arquivo = resolve(DIST, relativo);
  if (!arquivo.startsWith(DIST + sep) && arquivo !== DIST) {
    res.writeHead(403, SEGURANCA);
    return res.end("Proibido");
  }
  try {
    const dados = await fs.readFile(arquivo);
    const ext = extname(arquivo).toLowerCase();
    res.writeHead(200, {
      "content-type": TIPOS[ext] || "application/octet-stream",
      "cache-control": relativo.startsWith("assets") ? "public, max-age=31536000, immutable" : "no-cache",
      ...SEGURANCA,
    });
    res.end(dados);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SEGURANCA });
    res.end("Não encontrado");
  }
}

amostrar();
setTimeout(amostrar, 1000);
setInterval(amostrar, AMOSTRA_MS).unref();

createServer(async (req, res) => {
  try {
    if (!HOSTS_OK.has(String(req.headers.host || "").toLowerCase())) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Acesso só por 127.0.0.1 ou localhost.");
    }
    const rota = (req.url || "/").split("?")[0];
    if (rota === "/api/demandas") return json(res, await lerDemandas());
    if (rota === "/api/retrato") return json(res, paraJson(await retrato()));
    return await entregarArquivo(req, res);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Erro ao ler as sessões.");
  }
}).listen(PORTA, "127.0.0.1", () => {
  const modo = DEMO ? "modo demonstração, com sessões de exemplo" : `lendo as últimas ${HORAS} h`;
  console.log(`Central de Execução no ar: http://127.0.0.1:${PORTA}  (${modo}; Ctrl+C para sair)`);
  if (!existsSync(join(DIST, "index.html"))) console.error("Aviso: a pasta dist/ não existe. Rode `npm run build` dentro de web/ (ou baixe o repositório de novo).");
  // Esquenta a primeira leitura (a primeira vez lê os arquivos inteiros; depois só o que cresceu).
  void sessoesDoDisco().catch(() => {});
});
