import { useEffect } from "react";
import {
  type Bordas,
  bordasDaFrente,
  bordasDoAlvo,
  clipDaPilula,
  type Lado,
  quadroDaPilula,
} from "../lib/movimento";

// A pílula elástica de todo grupo `[data-pilula]` (os filtros do topo), montada uma vez na tela. Nenhum filtro
// precisa chamar nada: a camada ::before do grupo (nucleo.css) é recortada por clip-path e as quatro bordas andam
// separadas, a da frente em 0,36 s (power3.out) e a de trás em 0,55 s (power3.inOut). Anda no clique, antes de a
// tela responder, e acompanha o item atual (aria-pressed ou data-ativo) quando ele muda.
//
// Com "reduzir movimento", a pílula vai direto para o item.

const GRUPO = "[data-pilula]";
const ITEM = "a, button, label, [role='tab']";
const ATIVO = "[aria-pressed='true'], [data-ativo], [aria-selected='true']";

type EstadoDoGrupo = {
  bordas: Bordas | null;
  alvo: Element | null;
  de: Bordas | null;
  para: Bordas | null;
  frente: Set<Lado>;
  inicio: number;
  quadro: number;
};

function semMovimento(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function medir(grupo: HTMLElement, alvo: Element): Bordas {
  const g = grupo.getBoundingClientRect();
  const a = alvo.getBoundingClientRect();
  return bordasDoAlvo(
    { width: grupo.clientWidth, height: grupo.clientHeight },
    {
      left: a.left - g.left - grupo.clientLeft,
      top: a.top - g.top - grupo.clientTop,
      width: a.width,
      height: a.height,
    },
  );
}

function itemAtivo(grupo: HTMLElement): Element | null {
  for (const candidato of grupo.querySelectorAll(ATIVO)) {
    // Só o item do próprio grupo (um grupo dentro de outro cuida do seu).
    if (candidato.closest(GRUPO) !== grupo) continue;
    return candidato;
  }
  return null;
}

export function MovimentoDaPilula() {
  useEffect(() => {
    const raiz = document.querySelector<HTMLElement>(".central-app") ?? document.body;
    const estados = new WeakMap<HTMLElement, EstadoDoGrupo>();
    const redimensionar = new ResizeObserver((entradas) => {
      for (const entrada of entradas) sincronizar(entrada.target as HTMLElement, false);
    });
    const vistos = new WeakSet<HTMLElement>();

    const pintar = (grupo: HTMLElement, bordas: Bordas) => {
      grupo.style.setProperty(
        "--m-pilula-clip",
        clipDaPilula(bordas, "var(--m-pilula-raio, 999px)"),
      );
    };

    const estadoDe = (grupo: HTMLElement): EstadoDoGrupo => {
      let estado = estados.get(grupo);
      if (!estado) {
        estado = {
          bordas: null,
          alvo: null,
          de: null,
          para: null,
          frente: new Set(),
          inicio: 0,
          quadro: 0,
        };
        estados.set(grupo, estado);
      }
      return estado;
    };

    const andar = (grupo: HTMLElement, alvo: Element, animar: boolean) => {
      const estado = estadoDe(grupo);
      const para = medir(grupo, alvo);
      const mudouDeAlvo = estado.alvo !== alvo;
      estado.alvo = alvo;
      grupo.setAttribute("data-pilula-pronta", "");
      if (!estado.bordas || !animar || semMovimento()) {
        cancelAnimationFrame(estado.quadro);
        estado.quadro = 0;
        estado.bordas = para;
        estado.para = para;
        pintar(grupo, para);
        return;
      }
      if (!mudouDeAlvo && estado.quadro) {
        // O grupo mudou de tamanho no meio do caminho: só o destino se ajusta.
        estado.para = para;
        return;
      }
      if (!mudouDeAlvo) {
        estado.bordas = para;
        pintar(grupo, para);
        return;
      }
      cancelAnimationFrame(estado.quadro);
      // Sai de onde a pílula está agora (mesmo no meio de outro movimento).
      estado.de = { ...estado.bordas };
      estado.para = para;
      estado.frente = bordasDaFrente(estado.de, para);
      estado.inicio = performance.now();
      const passo = (agora: number) => {
        if (!estado.de || !estado.para) return;
        const { bordas, andando } = quadroDaPilula(
          estado.de,
          estado.para,
          estado.frente,
          agora - estado.inicio,
        );
        estado.bordas = bordas;
        pintar(grupo, bordas);
        estado.quadro = andando ? requestAnimationFrame(passo) : 0;
      };
      estado.quadro = requestAnimationFrame(passo);
    };

    function sincronizar(grupo: HTMLElement, animar: boolean) {
      if (!grupo.isConnected) return;
      const alvo = itemAtivo(grupo);
      if (!alvo) {
        grupo.removeAttribute("data-pilula-pronta");
        const estado = estadoDe(grupo);
        estado.alvo = null;
        estado.bordas = null;
        return;
      }
      andar(grupo, alvo, animar);
    }

    const varrer = (animar: boolean) => {
      for (const grupo of raiz.querySelectorAll<HTMLElement>(GRUPO)) {
        if (!vistos.has(grupo)) {
          vistos.add(grupo);
          redimensionar.observe(grupo);
          sincronizar(grupo, false);
        } else sincronizar(grupo, animar);
      }
    };

    let agendado = 0;
    const agendar = () => {
      if (agendado) return;
      agendado = requestAnimationFrame(() => {
        agendado = 0;
        varrer(true);
      });
    };
    const observador = new MutationObserver(agendar);
    observador.observe(raiz, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current", "data-ativo", "aria-selected", "aria-pressed"],
    });

    // No clique a pílula anda na hora, antes de a tela responder; quando o item atual muda de verdade, ela
    // confere. Se a tela não mudou nada em 4 s, volta para o item atual.
    const conferencias = new Set<number>();
    const aoClicar = (evento: MouseEvent) => {
      const alvo = evento.target as Element | null;
      const item = alvo?.closest(ITEM);
      const grupo = item?.closest<HTMLElement>(GRUPO);
      if (!item || !grupo || item.closest(GRUPO) !== grupo) return;
      if (item.matches(":disabled, [aria-disabled='true']")) return;
      andar(grupo, item, true);
      const id = window.setTimeout(() => {
        conferencias.delete(id);
        sincronizar(grupo, true);
      }, 4000);
      conferencias.add(id);
    };
    document.addEventListener("click", aoClicar, true);
    varrer(false);
    // As fontes podem chegar depois e mexer na largura dos itens.
    document.fonts?.ready.then(() => varrer(false)).catch(() => {});

    return () => {
      observador.disconnect();
      redimensionar.disconnect();
      cancelAnimationFrame(agendado);
      for (const id of conferencias) window.clearTimeout(id);
      document.removeEventListener("click", aoClicar, true);
    };
  }, []);

  return null;
}
