import { useCallback, useMemo, useState } from "react";
import { ROTULO_DO_STATUS } from "../lib/apresentacao";
import {
  type Coluna,
  FILTRO_INICIAL,
  type Filtro,
  filtrarDemandas,
  type Ordem,
  proximaOrdem,
} from "../lib/ordem";
import { type LeituraDasDemandas, STATUS_DA_DEMANDA, type StatusDaDemanda } from "../lib/tipos";
import { Avisos } from "./avisos";
import { BotaoDeTema } from "./botao-de-tema";
import { IconeOnde } from "./icone-onde";
import { BlocoDeDemandas } from "./lista-de-demandas";
import { MaquinaMini } from "./maquina-mini";

// A tela inteira da Central de Execução. Só dado real das suas sessões: sem lista, a tela diz isso. Nenhum filtro
// vai ao servidor: tudo roda sobre a leitura de 5 s.

export function StatusDoPc({ dados, falhou }: { dados: LeituraDasDemandas; falhou: boolean }) {
  const conectado = dados.pc.estado === "ao-vivo" && !falhou;
  return (
    <p className="dm-sinal" data-tom={conectado ? "ok" : "apagado"} role="status">
      <i aria-hidden="true" /> {conectado ? "Conectado" : "Desconectado"}
    </p>
  );
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function Resumo({ dados, periodo }: { dados: LeituraDasDemandas; periodo: string }) {
  const m = dados.resumo[periodo];
  if (!m) return null;
  return (
    <p className="dm-resumo">
      <span title="Entrada, saída e escrita no cache, a mesma conta da coluna Tokens">
        <strong>{inteiro.format(Math.round(m.tokensNovos / 1000))} mil</strong> tokens
      </span>
      <span title="Demandas que trabalharam ou mudaram nesse período">
        <strong>{inteiro.format(m.demandas)}</strong> {m.demandas === 1 ? "demanda" : "demandas"}
      </span>
    </p>
  );
}

function Controles({
  dados,
  filtro,
  mudar,
}: {
  dados: LeituraDasDemandas;
  filtro: Filtro;
  mudar: (f: Partial<Filtro>) => void;
}) {
  const alternarStatus = (s: StatusDaDemanda) =>
    mudar({
      status: filtro.status.includes(s)
        ? filtro.status.filter((x) => x !== s)
        : [...filtro.status, s],
    });
  const temPeriodo = dados.periodos.length > 1;
  const temProjeto = dados.projetos.length > 1;
  const temOnde = dados.ondes.length > 1;
  return (
    <div className="dm-controles">
      {temPeriodo || temProjeto ? (
        <div className="dm-linha-de-controles">
          {temPeriodo ? (
            <fieldset className="dm-seg" data-pilula="" aria-label="Período">
              {dados.periodos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={filtro.dias === p.dias}
                  onClick={() => mudar({ dias: p.dias })}
                  title={`Últimos ${p.dias} ${p.dias === 1 ? "dia" : "dias"}`}
                >
                  {p.id}
                </button>
              ))}
            </fieldset>
          ) : null}
          {temProjeto ? (
            <fieldset className="dm-regua" data-pilula="" aria-label="Projeto">
              <button
                type="button"
                aria-pressed={filtro.projeto === null}
                onClick={() => mudar({ projeto: null })}
              >
                Todos
              </button>
              {dados.projetos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={filtro.projeto === p.id}
                  onClick={() => mudar({ projeto: p.id })}
                  title={p.rotulo}
                >
                  {p.rotuloCurto}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}
      <div className="dm-linha-de-controles">
        <fieldset className="dm-chips" aria-label="Filtrar por status">
          {STATUS_DA_DEMANDA.map((s) => (
            <button
              key={s}
              type="button"
              className="dm-chip-filtro"
              data-status={s}
              aria-pressed={filtro.status.includes(s)}
              onClick={() => alternarStatus(s)}
            >
              {ROTULO_DO_STATUS[s]}
            </button>
          ))}
        </fieldset>
        {temOnde ? (
          <fieldset className="dm-seg" data-pilula="" aria-label="Onde roda">
            <button
              type="button"
              aria-pressed={filtro.onde === null}
              onClick={() => mudar({ onde: null })}
            >
              Todos
            </button>
            {dados.ondes.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={filtro.onde === o.id}
                onClick={() => mudar({ onde: o.id })}
                aria-label={`Só em ${o.nome}`}
                title={`Só em ${o.nome}`}
              >
                <IconeOnde onde={o.id} titulo={null} tamanho={14} />
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}

export function TelaDeDemandas({ dados, falhou }: { dados: LeituraDasDemandas; falhou: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>(() => ({
    ...FILTRO_INICIAL,
    dias: dados.periodos.find((p) => p.id === dados.periodoPadrao)?.dias ?? null,
  }));
  const [ordem, setOrdem] = useState<Ordem>(null);
  const mudar = useCallback((f: Partial<Filtro>) => setFiltro((atual) => ({ ...atual, ...f })), []);
  const aoOrdenar = useCallback((coluna: Coluna) => setOrdem((o) => proximaOrdem(o, coluna)), []);
  const blocos = useMemo(() => {
    const f = (lista: LeituraDasDemandas["blocos"]["ativas"]) => filtrarDemandas(lista, filtro, dados.agora);
    return { ativas: f(dados.blocos.ativas), paradas: f(dados.blocos.paradas) };
  }, [dados, filtro]);
  const { agora } = dados;
  const periodo = dados.periodos.find((p) => p.dias === filtro.dias)?.id ?? dados.periodoPadrao;
  const comum = { agora, ordem, aoOrdenar };
  return (
    <div className="m-stack dm" data-variante="inteira">
      <header className="dm-topo">
        <div className="m-heading dm-topo-titulo">
          <p className="m-subheadline m-secondary">Sessões de IA</p>
          <h1 className="m-large-title">Central de Execução</h1>
          <div className="dm-linha-do-sinal">
            <StatusDoPc dados={dados} falhou={falhou} />
            <BotaoDeTema />
          </div>
        </div>
        <MaquinaMini pontos={dados.maquina} agora={agora} />
      </header>
      {dados.demo ? (
        <p className="dm-explica">
          Modo demonstração: as sessões abaixo são de exemplo. Rode <code>node central.mjs</code> para ver as suas.
        </p>
      ) : null}
      <Resumo dados={dados} periodo={periodo} />
      <Controles dados={dados} filtro={filtro} mudar={mudar} />
      {!dados.temLista ? (
        <p className="dm-vazio">
          Nenhuma sessão nas últimas {dados.janelaHoras} h. Abra o Claude Code ou o Codex: ela aparece aqui sozinha.
        </p>
      ) : (
        <>
          <BlocoDeDemandas
            id="dm-ativas"
            abertoDeInicio={true}
            titulo="Ativas"
            nota="Trabalhando agora no topo; depois o que parou ou espera há menos de 48 h"
            demandas={blocos.ativas}
            vazio="Nenhuma demanda ativa com esse filtro."
            {...comum}
          />
          <BlocoDeDemandas
            id="dm-paradas"
            abertoDeInicio={dados.blocos.ativas.length === 0}
            titulo="Paradas"
            nota="Paradas há mais de 48 h"
            demandas={blocos.paradas}
            vazio="Nada parado com esse filtro."
            {...comum}
          />
        </>
      )}
      <Avisos avisos={dados.avisos} />
    </div>
  );
}
