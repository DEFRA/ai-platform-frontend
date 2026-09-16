---
description: "Use when adding a new SCSS partial or GOV.UK Frontend based stylesheet. Covers where to add partials and how they're wired into application.scss."
applyTo: "src/client/stylesheets/**/*.scss"
---
# Stylesheet Conventions

- New partials go under the matching folder: layout/structure in `core/`, reusable mixins/functions in `helpers/`, shared markup-adjacent styles in `partials/`, one-off page/component overrides in `components/`, and design tokens in `variables/`.
- Each folder has an `_index.scss` that forwards/imports its partials — add new partials there rather than importing them directly from `application.scss`.
- Prefix partial filenames with `_` (Sass partial convention) and keep one concern per file.
- This project extends `govuk-frontend` (see `_govuk-frontend.scss`) — prefer GOV.UK Frontend variables/mixins over hardcoded values.
- Lint with `npm run lint:scss` (Stylelint + `stylelint-config-gds`) before committing.
