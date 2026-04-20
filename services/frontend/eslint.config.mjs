// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // Pre-built third-party / seeded module bundles — treat as binary.
    ignores: [
      'server/assets/seed-modules/**/*.mjs',
      'server/seeds/generated-bundles.ts'
    ]
  },
  {
    rules: {
      'vue/no-multiple-template-root': 'off',
      'vue/max-attributes-per-line': ['error', { singleline: 3 }]
    }
  }
)
