// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  devtools: {
    enabled: false
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    mongodbUri: '',
    rabbitmqUrl: '',
    unsubscribeSecret: '',
    public: {
      appName: 'dp-reality'
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  // Bot lifecycle janitor — see server/tasks/janitor/provisional-bots.
  // Sweeps two kinds of garbage every 5 minutes:
  //   * users.bots[] rows stuck in `pending` past their TTL (15 min):
  //     the wizard popup never produced a module:saved.
  //   * <bot>_config rows older than 1h whose config_id appears in no
  //     user's bots[]: the bot persisted before the BFF could record
  //     the matching users.bots[] entry, then the wizard was abandoned.
  nitro: {
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '*/5 * * * *': ['janitor:provisional-bots']
    },
    // `isomorphic-dompurify` (our DOMPurify wrapper, per thesis §3.7.5)
    // pulls jsdom → undici via a CJS `require('undici')`. When the build
    // runs inside `oven/bun:1-alpine`, Nitro's @vercel/nft tracer drops
    // undici's `main` entry from `.output/server/node_modules/undici/`,
    // which crashes the runtime with "Cannot find module 'undici/index.js'".
    // Listing the packages in `traceInclude` forces NFT to use them as
    // additional trace entry points, which guarantees the main entry +
    // every transitive file is copied to the output. See
    // https://github.com/nuxt/nuxt/issues/22325 for the underlying NFT
    // limitation. DOMPurify's maintainers explicitly disrecommend
    // happy-dom (XSS risk), so swapping the DOM layer is not an option.
    externals: {
      traceInclude: [
        './node_modules/undici/index.js',
        './node_modules/jsdom/lib/api.js',
        './node_modules/isomorphic-dompurify/dist/index.js'
      ]
    }
  },

  compatibilityDate: '2024-07-11',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
