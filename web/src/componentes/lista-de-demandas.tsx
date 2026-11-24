import { ChevronDown, ChevronUp } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import {
  quando,
  ROTULO_DO_STATUS,
  textoDaAbertura,
  textoDaRef,
  textoDoAgente,
  textoDoOnde,
  textoDoTempoParado,
  tokensCurtos,
  tokensPorExtenso,
} from "../lib/apresentacao";
import { type Coluna, type Ordem, ordenarDemandas } from "../lib/ordem";
import { ativaAgora } from "../lib/regras";
import type { Demanda } from "../lib/tipos";
import { Contador } from "./contador";
import { IconeOnde } from "./icone-onde";

// Um bloco da lista de demandas (Ativas ou Paradas). Todas as linhas com a mesma altura: o texto longo termina
// em reticências e mostra o nome inteiro ao passar o mouse (title) ou ao focar pelo teclado (dica desenhada).
// Mudou o peso, muda a ordem com a troca de posição suave (FLIP, 300 ms, nada com movimento reduzido). A linha
// expande e mostra as sessões que formam a demanda. No topo, a demanda com atividade real agora, realçada, com o
// pulso neon e o brilho que percorre a borda (nada anima com "reduzir movimento").

// Guarda a posição de cada linha e, quando a ordem muda, anima de onde ela estava até onde está.
function useTrocaSuave(lista: React.RefObject<HTMLTableSectionElement | null>, ordem: string) {
  const antes = useRef(new Map<string, number>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a ordem é o gatilho da medida
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const agora = new Map<string, number>();
    for (const linha of el.querySelectorAll<HTMLElement>("[data-flip]")) {
      const id = linha.dataset.flip ?? "";
      const topo = linha.offsetTop;
      agora.set(id, topo);
      const velho = antes.current.get(id);
      if (!reduzido && velho !== undefined && velho !== topo && typeof linha.animate === "function") {
        linha.animate(
          [{ transform: `translateY(${velho - topo}px)` }, { transform: "translateY(0)" }],
          {
            duration: 300,
            easing: "cubic-bezier(.2,.8,.2,1)",
          },
        );
      }
    }
    antes.current = agora;
  }, [ordem]);
}

function Linha({
  d,
  agora,
  aberta,
  aoAbrir,
}: {
  d: Demanda;
  agora: number;
  aberta: boolean;
  aoAbrir: () => void;
}) {
  const agente = textoDoAgente(d);
  const parada = textoDoTempoParado(d, agora);
  const ref = textoDaRef(d.ref);
  const agoraMesmo = ativaAgora(d);
  return (
    <tr
      className="dm-linha"
      data-flip={d.id}
      data-status={d.status}
      data-agora={agoraMesmo ? "" : undefined}
      data-aberta={aberta ? "" : undefined}
      onClick={(evento) => {
        // Clicar em qualquer lugar da linha expande; os botões da linha fazem só o deles.
        if ((evento.target as HTMLElement).closest("button, a")) return;
        aoAbrir();
      }}
    >
      <td className="dm-c dm-c-onde">
        <IconeOnde onde={d.onde} titulo={textoDoOnde(d)} />
      </td>
      <td className="dm-c dm-c-ref" title={ref ? `Número de referência ${ref}` : undefined}>
        {ref ?? ""}
      </td>
      <th scope="row" className="dm-c dm-c-titulo">
        <button
          type="button"
          className="dm-titulo"
          title={d.titulo}
          data-titulo={d.titulo}
          aria-expanded={aberta}
          aria-controls={`dm-det-${d.id}`}
          onClick={aoAbrir}
        >
          {agoraMesmo ? <span className="dm-neon" role="img" aria-label="trabalhando agora" /> : null}
          {d.titulo}
        </button>
        {ref ? (
          <span className="dm-ref-mini" aria-hidden="true">
            {ref}
          </span>
        ) : null}
        {d.totalDeSessoes > 1 ? (
          <span className="dm-sessoes-mini" title={`${d.totalDeSessoes} sessões neste tema`}>
            +{d.totalDeSessoes - 1}
          </span>
        ) : null}
      </th>
      <td className="dm-c dm-c-projeto" title={d.projeto}>
        {d.projeto}
      </td>
      <td className="dm-c dm-c-status">
        <span className="dm-status" data-status={d.status}>
          {ROTULO_DO_STATUS[d.status]}
        </span>
        {parada ? (
          <span className="dm-parada-mini" aria-hidden="true">
            há {parada}
          </span>
        ) : null}
      </td>
      <td
        className="dm-c dm-c-agente"
        title={agente?.title}
        data-agora={agente?.agora ? "" : undefined}
      >
        {agente?.nome ?? ""}
      </td>
      <td
        className="dm-c dm-c-parada"
        title={parada ? `Parada há ${parada}` : undefined}
        data-sem={parada ? undefined : ""}
      >
        {parada ?? ""}
      </td>
      <td className="dm-c dm-c-falta" title={d.falta ?? undefined}>
        {d.falta ?? ""}
      </td>
      <td className="dm-c dm-c-previsao" title={`Aberta ${textoDaAbertura(d, agora)}`}>
        <span className="dm-prev-texto">{textoDaAbertura(d, agora)}</span>
      </td>
      <td className="dm-c dm-c-tokens">
        {/* O número por extenso na tela larga e o curto no celular (o CSS mostra um dos dois). */}
        <span className="dm-tok-longo">
          <Contador valor={d.tokens} formatar={tokensPorExtenso} />
        </span>
        <span className="dm-tok-curto">
          <Contador valor={d.tokens} formatar={tokensCurtos} />
        </span>
      </td>
    </tr>
  );
}

// A linha aberta: quem está ativo agora no topo, com o ícone em movimento, tudo o que já passou pela demanda
// (modelos, subagentes e skills) e as sessões que a formam. Só nomes, vindos do seu computador.
function Rastro({ d, colunas, agora }: { d: Demanda; colunas: number; agora: number }) {
  const r = d.rastro;
  const ativos = r
    ? [
        ...r.modelos.filter((m) => m.ativo).map((m) => m.nome),
        ...r.subagentes.filter((x) => x.ativo).map((x) => `subagente ${x.nome}`),
        ...r.skills.filter((x) => x.ativo).map((x) => `skill ${x.nome}`),
      ]
    : [];
  const grupos: [string, string[]][] = r
    ? [
        ["Modelos", r.modelos.map((m) => m.nome)],
        ["Subagentes", r.subagentes.map((x) => x.nome)],
        ["Skills", r.skills.map((x) => x.nome)],
      ]
    : [];
  return (
    <tr className="dm-detalhe" id={`dm-det-${d.id}`}>
      <td colSpan={colunas}>
        {!r ? (
          <p className="dm-det-vazio">Sem registro de agentes nesta demanda ainda.</p>
        ) : (
          <div className="dm-det">
            <div className="dm-det-agora">
              <span className="dm-det-rotulo">Agora</span>
              {ativos.length ? (
                <ul>
                  {ativos.map((nome) => (
                    <li key={nome} className="dm-det-ativo">
                      <span className="dm-girando" aria-hidden="true" />
                      {nome}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="dm-det-nada">ninguém trabalhando nela neste momento</span>
              )}
            </div>
            {grupos.map(([titulo, nomes]) => (
              <div key={titulo} className="dm-det-grupo">
                <span className="dm-det-rotulo">{titulo}</span>
                {nomes.length ? (
                  <ul>
                    {nomes.map((nome) => (
                      <li key={nome}>{nome}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="dm-det-nada">nenhum registro</span>
                )}
              </div>
            ))}
          </div>
        )}
        {d.sessoes.length ? (
          <div className="dm-det-sessoes">
            <span className="dm-det-rotulo">
              Sessões{d.totalDeSessoes > d.sessoes.length ? ` (as ${d.sessoes.length} mais recentes de ${d.totalDeSessoes})` : ""}
            </span>
            <ul>
              {d.sessoes.map((s) => (
                <li key={`${s.ferramenta}-${s.titulo}-${s.ultima}`}>
                  <span className="dm-det-s-nome" title={s.titulo}>
                    {s.titulo}
                  </span>
                  <span className="dm-det-s-meta">{s.onde ?? s.ferramenta}</span>
                  <span className="dm-det-s-meta">{s.modelo ?? ""}</span>
                  <span className="dm-det-s-meta">
                    {s.estado === "executando" ? "agora" : s.ultima ? quando(Date.parse(s.ultima), agora) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

// O cabeçalho que ordena: um botão por coluna, com a seta da direção e o aria-sort na coluna escolhida.
function Cabeca({
  coluna,
  rotulo,
  ordem,
  aoOrdenar,
  className,
  oculto,
}: {
  coluna: Coluna;
  rotulo: string;
  ordem: Ordem;
  aoOrdenar: (coluna: Coluna) => void;
  className?: string;
  oculto?: boolean;
}) {
  const cx = `dm-h-${coluna}${className ? ` ${className}` : ""}`;
  const atual = ordem?.coluna === coluna ? ordem.direcao : null;
  const sort = atual === "asc" ? "ascending" : atual === "desc" ? "descending" : undefined;
  return (
    <th scope="col" className={cx} aria-sort={sort}>
      <button
        type="button"
        className="dm-ordem"
        data-ativa={atual ? "" : undefined}
        onClick={() => aoOrdenar(coluna)}
        title={`Ordenar por ${rotulo.toLowerCase()}`}
      >
        {oculto ? <span className="sr-only">{rotulo}</span> : <span>{rotulo}</span>}
        <span className="dm-seta" aria-hidden="true">
          {atual === "desc" ? (
            <ChevronDown size={13} strokeWidth={2.2} />
          ) : (
            <ChevronUp size={13} strokeWidth={2.2} />
          )}
        </span>
      </button>
    </th>
  );
}

export function BlocoDeDemandas({
  id,
  titulo,
  nota,
  demandas,
  agora,
  vazio,
  ordem,
  aoOrdenar,
  abertoDeInicio,
}: {
  id: string;
  titulo: string;
  nota?: string;
  demandas: Demanda[];
  agora: number;
  vazio: string;
  ordem: Ordem;
  aoOrdenar: (coluna: Coluna) => void;
  /** O bloco recolhe e abre pelo título e começa assim. */
  abertoDeInicio: boolean;
}) {
  const lista = useRef<HTMLTableSectionElement>(null);
  const [aberto, setAberto] = useState(abertoDeInicio);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const alternar = (idDaDemanda: string) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(idDaDemanda)) nova.delete(idDaDemanda);
      else nova.add(idDaDemanda);
      return nova;
    });
  // A que trabalha agora fica no topo, mesmo com a ordem por coluna.
  const ordenadas = ordenarDemandas(demandas, ordem, agora);
  useTrocaSuave(lista, ordenadas.map((d) => d.id).join("|"));
  const c = { ordem, aoOrdenar };
  return (
    <section className="dm-bloco" data-variante="inteira" aria-labelledby={`${id}-titulo`}>
      <header className="dm-bloco-topo">
        <h2 id={`${id}-titulo`}>
          <button
            type="button"
            className="dm-bloco-alternar"
            aria-expanded={aberto}
            onClick={() => setAberto((v) => !v)}
          >
            <ChevronDown size={18} aria-hidden className="dm-bloco-seta" />
            {titulo} <span className="dm-conta">{demandas.length}</span>
          </button>
        </h2>
        {nota ? <p className="dm-nota">{nota}</p> : null}
      </header>
      {!aberto ? null : demandas.length === 0 ? (
        <p className="dm-vazio">{vazio}</p>
      ) : (
        <table className="dm-tabela" aria-labelledby={`${id}-titulo`}>
          <thead>
            <tr className="dm-cabeca">
              <Cabeca coluna="onde" rotulo="Onde roda" oculto {...c} />
              <Cabeca coluna="ref" rotulo="Nº" {...c} />
              <Cabeca coluna="titulo" rotulo="Demanda" {...c} />
              <Cabeca coluna="projeto" rotulo="Projeto" {...c} />
              <Cabeca coluna="status" rotulo="Status" {...c} />
              <Cabeca coluna="agente" rotulo="Agente" {...c} />
              <Cabeca coluna="parada" rotulo="Parada há" {...c} />
              <Cabeca coluna="falta" rotulo="Onde parou" {...c} />
              <Cabeca coluna="previsao" rotulo="Aberta em" {...c} />
              <Cabeca coluna="tokens" rotulo="Tokens" className="dm-cabeca-tokens" {...c} />
            </tr>
          </thead>
          <tbody ref={lista}>
            {ordenadas.map((d) => (
              <Fragment key={d.id}>
                <Linha d={d} agora={agora} aberta={abertas.has(d.id)} aoAbrir={() => alternar(d.id)} />
                {abertas.has(d.id) ? <Rastro d={d} colunas={10} agora={agora} /> : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

