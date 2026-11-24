import { useEffect, useRef, useState } from "react";
import type { Aviso } from "../lib/tipos";

// Os avisos discretos "Central: <o que aconteceu>" (a diferença entre duas leituras, feita no servidor, sem IA).
// Só os que chegam depois de a tela abrir; somem sozinhos em alguns segundos; no máximo 3 de cada vez.

const FICA_MS = 6_000;
const MAXIMO = 3;

export type AvisoLocal = { id: string; texto: string };

export function Avisos({ avisos, locais = [] }: { avisos: Aviso[]; locais?: AvisoLocal[] }) {
  const [pilha, setPilha] = useState<(AvisoLocal & { ate: number })[]>([]);
  const visto = useRef<number | null>(null);
  const vistosLocais = useRef(new Set<string>());

  useEffect(() => {
    const maior = avisos.reduce((m, a) => Math.max(m, a.id), 0);
    // Na primeira leitura, o que já estava lá não sobe.
    if (visto.current === null) {
      visto.current = maior;
      return;
    }
    const corte = visto.current;
    const novos = avisos
      .filter((a) => a.id > corte)
      .map((a) => ({ id: `s${a.id}`, texto: a.texto, ate: Date.now() + FICA_MS }));
    visto.current = Math.max(corte, maior);
    if (novos.length) setPilha((p) => [...p, ...novos].slice(-MAXIMO));
  }, [avisos]);

  useEffect(() => {
    const novos = locais.filter((a) => !vistosLocais.current.has(a.id));
    for (const a of novos) vistosLocais.current.add(a.id);
    const comPrazo = novos.map((a) => ({ ...a, ate: Date.now() + FICA_MS }));
    if (comPrazo.length) setPilha((p) => [...p, ...comPrazo].slice(-MAXIMO));
  }, [locais]);

  useEffect(() => {
    if (!pilha.length) return;
    // Cada aviso tem o seu prazo: o próximo a vencer some na hora certa, os outros ficam.
    const espera = Math.max(0, Math.min(...pilha.map((a) => a.ate)) - Date.now());
    const timer = window.setTimeout(() => {
      const agora = Date.now() + 50;
      setPilha((p) => p.filter((a) => a.ate > agora));
    }, espera);
    return () => window.clearTimeout(timer);
  }, [pilha]);

  return (
    <div className="dm-avisos" aria-live="polite" aria-atomic="false">
      {pilha.map((a) => (
        <p key={a.id} className="dm-aviso">
          {a.texto}
        </p>
      ))}
    </div>
  );
}
