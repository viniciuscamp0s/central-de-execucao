#!/usr/bin/env node
// Central de Execução: painel local das suas sessões de IA (Claude Code, Codex e o que você plugar).
// Só Node 18+, sem dependências, sem rede: lê os registros que as próprias ferramentas gravam no seu PC
// e serve uma página em http://127.0.0.1:4555. Nada sai da sua máquina.
//
// Uso:
//   node central.mjs                 abre o painel (porta 4555)
//   node central.mjs --porta 5000    outra porta
//   node central.mjs --json          imprime o retrato em JSON e sai (para usar em outro script ou agente)
//   node central.mjs --horas 72      janela de leitura (padrão 48 h)

import { createServer } from "node:http";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

// ---------- Configuração (opcional) ----------
// central.config.json ao lado deste arquivo ou em ~/.central-de-execucao.json. Ver central.config.example.json.
function lerConfig() {
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
const HORAS = Number(arg("--horas", CONFIG.horas ?? 48));
const PORTA = Number(arg("--porta", CONFIG.porta ?? 4555));
const ATIVA_MIN = CONFIG.ativaMinutos ?? 3; // escreveu nos últimos N min = trabalhando
const PARADA_MIN = CONFIG.paradaMinutos ?? 60; // até N min = parada (cache ainda quente)

// ---------- Leitura barata: começo e fim do arquivo ----------
const PEDACO = 256 * 1024;
async function cabecaECauda(caminho, tamanho) {
  const fh = await fs.open(caminho, "r");
  try {
    if (tamanho <= PEDACO * 2) {
      const buf = Buffer.alloc(tamanho);
      await fh.read(buf, 0, tamanho, 0);
      return { cabeca: linhas(buf.toString("utf8")), cauda: [] };
    }
    const a = Buffer.alloc(PEDACO);
    const b = Buffer.alloc(PEDACO);
    await fh.read(a, 0, PEDACO, 0);
    await fh.read(b, 0, PEDACO, tamanho - PEDACO);
    const ca = a.toString("utf8").split("\n");
    ca.pop(); // última linha cortada
    const cb = b.toString("utf8").split("\n");
    cb.shift(); // primeira linha cortada
    return { cabeca: parse(ca), cauda: parse(cb) };
  } finally {
    await fh.close();
  }
}
const linhas = (txt) => parse(txt.split("\n"));
function parse(ls) {
  const out = [];
  for (const l of ls) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}

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

const textoDe = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((c) => c && (c.type === "text" || c.type === "input_text"))
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
    tokensSaida: 0,
    subagente: false,
    esperandoVoce: false,
    fimDaResposta: "",
    arquivo: "",
    ...campos,
  };
}

async function claudeCode(desde) {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const raiz = join(base, "projects");
  const out = [];
  for await (const f of arquivos(raiz, ".jsonl", 2)) {
    const st = await fs.stat(f).catch(() => null);
    if (!st || st.mtimeMs < desde) continue;
    const ehSub = f.includes(`${sep}subagents${sep}`);
    if (ehSub && !CONFIG.mostrarSubagentes) continue;
    const { cabeca, cauda } = await cabecaECauda(f, st.size);
    const todos = [...cabeca, ...cauda];
    const s = sessao({ ferramenta: "Claude Code", arquivo: f, subagente: ehSub, id: basename(f, ".jsonl") });
    const modelos = new Set();
    for (const e of todos) {
      if (e.cwd && !s.pasta) s.pasta = e.cwd;
      if (e.gitBranch && !s.branch) s.branch = e.gitBranch;
      if (e.entrypoint && !s.interfaceBruta) s.interfaceBruta = e.entrypoint;
      if (e.type === "ai-title" && e.aiTitle) s.titulo = e.aiTitle;
      if (e.type === "summary" && e.summary && !s.titulo) s.titulo = e.summary;
      if (e.timestamp) {
        const t = Date.parse(e.timestamp);
        if (!s.inicio || t < s.inicio) s.inicio = t;
        if (!s.ultima || t > s.ultima) s.ultima = t;
      }
      const m = e.message;
      if (e.type === "user" && m && !s.pedido && !e.isMeta) {
        const t = limpar(textoDe(m.content));
        if (t && !t.startsWith("Caveat:") && !t.startsWith("[Request interrupted")) s.pedido = curto(t, 400);
      }
      if (e.type === "assistant" && m) {
        if (m.model && m.model !== "<synthetic>") modelos.add(m.model);
        if (m.usage?.output_tokens) s.tokensSaida += m.usage.output_tokens;
      }
    }
    // A última fala do assistente diz se a sessão parou perguntando algo a você.
    const ultimaFala = [...todos].reverse().find((e) => e.type === "assistant" && textoDe(e.message?.content).trim());
    const ultimoEvento = [...todos].reverse().find((e) => e.type === "assistant" || e.type === "user");
    if (ultimaFala) {
      const t = limpar(textoDe(ultimaFala.message.content));
      s.fimDaResposta = curto(t.slice(-300), 300);
      s.esperandoVoce = ultimoEvento === ultimaFala && /\?\s*$/.test(t);
    }
    s.modelos = [...modelos];
    s.interface = nomeInterface(s.interfaceBruta);
    s.ultima = s.ultima || st.mtimeMs;
    out.push(s);
  }
  return out;
}

async function codex(desde) {
  const raiz = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
  const out = [];
  for await (const f of arquivos(raiz, ".jsonl", 4)) {
    const st = await fs.stat(f).catch(() => null);
    if (!st || st.mtimeMs < desde) continue;
    const { cabeca, cauda } = await cabecaECauda(f, st.size);
    const todos = [...cabeca, ...cauda];
    const s = sessao({ ferramenta: "Codex", arquivo: f, id: basename(f, ".jsonl") });
    const modelos = new Set();
    for (const e of todos) {
      const p = e.payload || {};
      if (e.timestamp) {
        const t = Date.parse(e.timestamp);
        if (!s.inicio || t < s.inicio) s.inicio = t;
        if (!s.ultima || t > s.ultima) s.ultima = t;
      }
      if (e.type === "session_meta") {
        s.pasta = p.cwd || s.pasta;
        s.interfaceBruta = p.originator || s.interfaceBruta;
        s.id = p.id || s.id;
        s.branch = p.git?.branch || s.branch;
        if (p.source && typeof p.source === "object" && p.source.subagent) s.subagente = true;
      }
      if (e.type === "turn_context" && p.model) modelos.add(p.model);
      if (e.type === "response_item" && p.type === "message") {
        const t = limpar(textoDe(p.content));
        if (p.role === "user" && !s.pedido && t && !t.startsWith("<") && !/^#?\s*AGENTS\.md/i.test(t))
          s.pedido = curto(t, 400);
        if (p.role === "assistant" && t) s.fimDaResposta = curto(t.slice(-300), 300);
      }
      if (e.type === "event_msg" && p.type === "token_count" && p.info?.total_token_usage?.output_tokens)
        s.tokensSaida = p.info.total_token_usage.output_tokens;
    }
    if (s.subagente && !CONFIG.mostrarSubagentes) continue;
    s.modelos = [...modelos];
    s.interface = nomeInterface(s.interfaceBruta);
    s.ultima = s.ultima || st.mtimeMs;
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
  let nome = iWt > 0 ? partes[iWt - 1] === ".claude" ? partes[iWt - 2] : partes[iWt - 1] : partes.at(-1);
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

async function retrato() {
  const agora = Date.now();
  const desde = agora - HORAS * 3600 * 1000;
  const listas = await Promise.all(ADAPTADORES.map((a) => a(desde).catch((e) => (console.error(e), []))));
  const sessoes = listas
    .flat()
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
  };
}

// ---------- Saída ----------
if (args.includes("--json")) {
  const r = await retrato();
  for (const t of r.temas) for (const s of t.sessoes) delete s.arquivo;
  process.stdout.write(JSON.stringify(r, null, 2));
  process.exit(0);
}

const HTML = readFileSync(join(AQUI, "painel.html"), "utf8");
createServer(async (req, res) => {
  if (req.url === "/api/retrato") {
    const r = await retrato();
    for (const t of r.temas) for (const s of t.sessoes) delete s.arquivo;
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return res.end(JSON.stringify(r));
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  res.end(HTML);
}).listen(PORTA, "127.0.0.1", () => {
  console.log(`Central de Execução no ar: http://127.0.0.1:${PORTA}  (lendo as últimas ${HORAS} h; Ctrl+C para sair)`);
});
