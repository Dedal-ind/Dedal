import { defineConfig } from 'vitest/config';

/*
 * Pure-helper tests only. The screens are not rendered here, so no DOM
 * environment: what is covered is logic that has been lifted out of a screen
 * into src/helpers precisely so it can be tested without React.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.js'],
  },
});
