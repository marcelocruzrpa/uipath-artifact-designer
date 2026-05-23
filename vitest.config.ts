import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the UiPath Artifact Designer.
 *
 * Tests target the pure, host-side model + util code (`src/model/**`,
 * `src/util/validateMessage.ts`, `src/util/nonce.ts`) — none of which import
 * `vscode`, so a plain Node environment is sufficient. Tests are TypeScript;
 * Vitest transpiles them via esbuild natively, so no extra build step is needed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false
  }
});
