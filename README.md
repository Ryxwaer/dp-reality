# dp-reality

## Existing projects that could be utilised:
- https://github.com/Ryxwaer/bazos_watcher (private)
- https://github.com/Ryxwaer/reality_bot (private)

## Features
- create and configure bots (only one for free teer)
- receive mails
  - same minimalistic format of realities across all sources
  - app will check all defined reality services within fixed time period and then send one mail for each user with newly found realities
  - unsubscribe button for the emails
  - mails will be sent from custom domain
- dashboard with user's bots statistics
- global statistics for preset metrics (eg. price change of 1 room flats in Brno over years)
- high level of error handling and failure recovery
  
## Technology stack
- mongodb
- nuxt 3 - fe
- different languages with microservice architecture - be
  - API Gateway - NestJS
  - Bazos - NestJS
  - SReality - python (fastapi)
  - monitoring and logging - Prometheus/Grafana

## Deployment
- whole app will be selfhosted on rpi4 ubuntu server using dockers:
  - mailserver (mailcow)
  - app (all of its parts)
  - mongodb

## Free tear limitations
- only one bot running
- need to atract users to use it not just setup bot and rely on mails for the reast of time
  - impllemnet some tokens that would be refreshed on app wisit
  - tokens could be auto spent on extending mails period (another week or so)
  - also app needs have really good UX to atract users event without need of tokens (usefull dashboards)
- less frequest period of requests

## Roadmap (deadlines)
- 2025-02-01 - brainstorm, try to come up with as many ideas as possible
- 2025-09-01 - by now the assignment should have fixed form and first prototypes should be prepared
- 2025-02-01 - all functional parts of the app implemented and deployed on the server (ready for testing)
- untill submission (last semester) - testing + improving documentation (floading tests, ux tests, statistics) 

## Resources (inspiration)
- https://dspace.cvut.cz/bitstream/handle/10467/103384/F8-BP-2021-Malach-Ondrej-thesis.pdf?sequence=-1&isAllowed=y
- https://is.muni.cz/th/ilu2h/Bakala_r_ska__pra_ce_Divis_ova__vec_er.pdf
