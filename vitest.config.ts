import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@pixtides/engine': pkg('engine'), '@pixtides/scenes': pkg('scenes') } },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
