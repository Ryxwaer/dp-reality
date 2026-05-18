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

  nitro: {
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '*/5 * * * *': ['janitor:provisional-bots']
    },
    externals: {
      traceInclude: [
        './node_modules/undici/index.js',
        './node_modules/jsdom/lib/api.js',
        './node_modules/isomorphic-dompurify/dist/index.js',
        './node_modules/@opentelemetry/auto-instrumentations-node/build/src/index.js',
        './node_modules/@opentelemetry/sdk-node/build/src/index.js',
        './node_modules/@opentelemetry/exporter-trace-otlp-grpc/build/src/index.js'
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
