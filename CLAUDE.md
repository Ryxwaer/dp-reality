This repo is implementation of project documented at `/home/ryxwaer/Documents/SKOLA/DP/dp-doc/chapters/` (thesis)

# Documentation is always source of truth

- Everything implemented does need to adhere to the documentation
- If at any time through the implementation you come to decision that different approach would be better - immediately inform user about it and let him decide if it needs to be changed in documentation before continuing further.

# Implementation guidelines

- Adhere to the microservices architecture standards
- Use abstraction instead of extensive comments - the code should be well structured and self explaining
- Do not use fallbacks and error handling that would silence everything - it is better to fail fast to have direct feedback to resolve the issue quickly
- Everything that user can see should be in english language
- Application should have no information on what are individual modules doing. Module should implement whole logic that it needs in order to work without any help from `/frontend` app.
- you can change data structure but don't forget to update it in mongodb immediately (migrate or drop old data)

# Deployemnt

- minisforum server: `ssh minisforum`