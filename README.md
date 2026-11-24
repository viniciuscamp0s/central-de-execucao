# Central de Execução

Painel local que mostra **todas as suas sessões de IA num lugar só**: o que cada uma está fazendo, onde foi aberta (terminal, VS Code, Orca, automação), qual modelo usa, se está trabalhando, parada ou **esperando uma resposta sua**, agrupadas por tema.

- **Só Node 18+**, sem dependências e sem instalar nada.
- **Sem rede:** lê os registros que o Claude Code e o Codex já gravam no seu PC e abre uma página em `http://127.0.0.1:4555`. Nada sai da sua máquina.
- **Funciona em qualquer estrutura:** Windows, macOS e Linux, uma pasta ou vinte projetos, com ou sem worktrees.

## O que aparece

| Item | De onde vem |
|---|---|
| **Interface** | Terminal, VS Code, JetBrains, Orca, Claude Desktop, Web, SDK ou automação (`entrypoint` do Claude Code, `originator` do Codex) |
| **Modelo** | Todos os modelos que a sessão usou (Fable, Opus, Sonnet, Haiku, GPT/Codex...) |
| **Estado** | `trabalhando` (escreveu nos últimos 3 min), `parada` (até 60 min), `esperando você` (a última fala terminou com pergunta), `encerrada` |
| **Tema** | Suas regras (palavras ou regex) ou, sem regra, o projeto (raiz do repositório, juntando as worktrees dele) |
| **Pedido e fim da resposta** | A primeira mensagem sua e o fim da última resposta, para saber onde cada uma parou |
| **Branch, subagente e tokens de saída** | Direto do registro |

Clique em qualquer contador do topo (estado, interface, modelo, ferramenta) para filtrar. A página se atualiza sozinha a cada 10 s.

## Instalar e abrir

**Pelo Claude Code ou pelo Codex** (o jeito mais fácil), escreva na conversa:

```
Clone https://github.com/viniciuscamp0s/central-de-execucao, rode node central.mjs e abra http://127.0.0.1:4555 no meu navegador.
```

**Ou no terminal:**

```bash
git clone https://github.com/viniciuscamp0s/central-de-execucao.git
cd central-de-execucao
node central.mjs
```

Abra `http://127.0.0.1:4555`. Para outra porta: `node central.mjs --porta 5000`. Para ler mais tempo: `--horas 168`.

### Para o seu agente usar

`node central.mjs --json` imprime o retrato inteiro (sessões, temas, contagens) e sai. O seu Claude Code pode rodar isso antes de responder "o que está em andamento?" e enxergar as outras sessões abertas, inclusive as de outras ferramentas.

## Adaptar à sua estrutura

Copie `central.config.example.json` para `central.config.json` (na mesma pasta) ou para `~/.central-de-execucao.json`:

- **`temas`**: agrupe sessões da mesma demanda por palavras (`"palavras": ["crm", "pipeline"]`) ou regex, procurando no título, no pedido ou na pasta. A primeira regra que bater vence; sem regra, vale o projeto.
- **`interfaces`**: dê nome a um `entrypoint` ou `originator` próprio.
- **`ativaMinutos` / `paradaMinutos`**: os limites dos estados.
- **`mostrarSubagentes`**: `true` mostra também as sessões filhas.

O Claude Code respeita `CLAUDE_CONFIG_DIR` e o Codex respeita `CODEX_HOME`, se você mudou essas pastas.

### Plugar outra ferramenta

Cada ferramenta é um adaptador em `central.mjs` (`claudeCode`, `codex`). Para Gemini CLI, Aider ou outra: escreva uma função que leia os registros dela e devolva sessões no formato de `sessao()`, e acrescente em `ADAPTADORES`. Peça ao seu Claude Code: *"crie um adaptador para a ferramenta X na Central de Execução"*.

## Privacidade

O servidor escuta só em `127.0.0.1` (ninguém da rede acessa) e a página não carrega nada de fora. O texto das sessões aparece só na sua tela; o JSON omite o caminho dos arquivos de registro.

## Licença

MIT. Criado por [viniciuscamp0s_](https://github.com/viniciuscamp0s).
