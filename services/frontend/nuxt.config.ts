// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt',
    'nuxt-auth-utils'
  ],

  devtools: {
    enabled: true
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
