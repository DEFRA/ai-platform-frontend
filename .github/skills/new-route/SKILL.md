---
name: new-route
description: 'Scaffold a new Hapi frontend route (page) in this repo, following the existing home route pattern. Use when asked to add a new page, route, or endpoint with a Nunjucks view.'
---

# New Route Scaffolding

Creates a new server route following this repo's established structure: plugin registration, controller, Nunjucks view, and a colocated test.

## When to Use

- Adding a new page/route under `src/server/routes/<name>/`
- Need the route wired into the router and covered by a test

## Procedure

1. Ask for (or infer) the route name, URL path, and page title/heading if not given.
2. Create `src/server/routes/<name>/controller.js` exporting a `<name>Controller` object with a `handler(request, h)` that returns `h.view('<name>/index', { pageTitle, heading, ... })`. See [example controller](../../../src/server/routes/home/controller.js).
3. Create `src/server/routes/<name>/index.js` exporting a Hapi plugin object (`plugin: { name, register(server) { server.route([...]) } }`) that registers the route(s) and spreads the controller. See [example plugin](../../../src/server/routes/home/index.js).
4. Create `src/server/routes/<name>/index.njk` extending the shared layout (see [page layout](../../../src/server/common/templates/layouts/page.njk)) with the page content.
5. Register the new plugin in `src/server/plugins/router.js` alongside the existing routes.
6. Create `src/server/routes/<name>/controller.test.js` following [testing conventions](../instructions/testing.instructions.md) — boot the server, inject a request, assert status code and expected content.
7. Run `npm test` and `npm run lint` to verify.
