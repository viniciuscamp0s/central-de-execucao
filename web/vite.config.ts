import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// O build vai para ../dist (na raiz do repositório), que o central.mjs serve. Caminhos relativos: a pasta pode
// morar em qualquer lugar. Em desenvolvimento (npm run dev), a API do central.mjs responde na porta 4555.
// Os números de 10 dígitos que o React traz no código (máscaras de bits) saem em hexadecimal: o valor é o mesmo, e
// ferramentas que procuram telefone em texto deixam de dar alarme falso.
const numerosLongosEmHexadecimal: Plugin = {
  name: "numeros-longos-em-hexadecimal",
  enforce: "post",
  generateBundle(_opcoes, pacote) {
    for (const item of Object.values(pacote)) {
      if (item.type !== "chunk") continue;
      item.code = item.code.replace(/(?<![\w.$])(\d{10,})(?![\w.])/g, (n) =>
        Number.isSafeInteger(Number(n)) ? `0x${Number(n).toString(16)}` : n,
      );
    }
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), numerosLongosEmHexadecimal],
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
  // O central.mjs só aceita pedido para o próprio endereço: o proxy troca o cabeçalho Host (changeOrigin).
  server: { proxy: { "/api": { target: "http://127.0.0.1:4555", changeOrigin: true } } },
});
