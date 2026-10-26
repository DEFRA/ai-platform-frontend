import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    // First-time module graph / dynamic imports (e.g. vite, server.js) can be slow in CI/sandboxes
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      // The floors are what the suite measured at d3a80c7 (plan §8); coverage
      // does not fall. The progress script is held to 95 on its own.
      thresholds: {
        lines: 94.29,
        functions: 97.43,
        branches: 92.25,
        statements: 94.4,
        'src/client/javascripts/progress-refresh.js': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95
        }
      },
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.js',
        '.sonarlint',
        'babel.config.cjs'
      ]
    }
  }
})
