# Implemented features

A one-page index of what is built in the AI Platform Portal (`ai-platform-frontend` and `ai-platform-backend-api`),
for new joiners. It holds no detail: each row links to the category file in this folder
that does. What is not built is in [remaining.md](../remaining.md).

Last updated: 12 Nov 2026.

## What you can do

| Journey                                                                                   | Status                                                | Detail                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Home page, sign in with Defra Entra ID, flat Defra design                                 | Built (Sept 2026)                                     | [01 Portal journeys](01-portal-journeys.md)               |
| Browse the model catalogue, including ineligible and retired models                       | Built (Sept to Oct 2026)                              | [04 Catalogue and gateway](04-catalogue-and-gateway.md)   |
| Get a personal research key, renew, revoke, re-reveal with a reason                       | Built, live in Infradev                               | [02 Research tier](02-research-tier.md)                   |
| Create a team, manage members and roles, set a service code                               | Built (Sept to Oct 2026)                              | [03 Team tier](03-team-tier.md)                           |
| Add a team member by searching the directory (mock until Graph)                           | Built (4 Nov 2026), directory is a seeded mock        | [03 Team tier](03-team-tier.md)                           |
| Request one or several dedicated models, follow the GitOps progress                       | Built, live in Infradev                               | [03 Team tier](03-team-tier.md)                           |
| Remove a model from a team (ready models only)                                            | Built (18 Oct 2026, ready only 2 Nov 2026)            | [03 Team tier](03-team-tier.md)                           |
| Rotate and revoke a team credential (Admin)                                               | Built; the secret is a labelled placeholder until B18 | [03 Team tier](03-team-tier.md)                           |
| Session ends after 30 minutes idle or 8 hours, with a warning                             | Built (4 Nov 2026), part of B27                       | [06 Shared services](06-shared-services-and-security.md)  |
| Platform Admin: list every team, open one, add and remove members                         | Built (12 Nov 2026), Teams tab only (B31 in part)     | [08 Platform admin](08-platform-admin.md)                 |
| Platform Admin: Audit log of every event, with filters                                    | Built (13 Nov 2026); credential events' team pending  | [08 Platform admin](08-platform-admin.md#audit-log-tab)   |
| Platform Admin: Deployments tab, Reconcile, Retry, disable, enable and revoke credentials | Built (13 Nov 2026), non-federated credentials only   | [08 Platform admin](08-platform-admin.md#deployments-tab) |

## What it runs on

| Area                                                                               | Status                                                                                                                    | Detail                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Terraform and GitHub Actions pipeline, five repositories, Infradev applied         | Built (15 to 20 Oct 2026)                                                                                                 | [05 Platform and GitOps](05-platform-and-gitops-pipeline.md)                               |
| CDP dev wired to Infradev (config, proxy rules)                                    | Built (20 Oct 2026), one proxy rule open                                                                                  | [05 Platform and GitOps](05-platform-and-gitops-pipeline.md)                               |
| Asynchronous GitOps operations: queues, worker, direct commits, events (B28)       | Partly built (28 and 29 Oct 2026)                                                                                         | [05 Platform and GitOps](05-platform-and-gitops-pipeline.md)                               |
| Idempotency, audit, locks, backfills, security baseline, federated auth            | Built                                                                                                                     | [06 Shared services](06-shared-services-and-security.md)                                   |
| Portal sign-in and API access: Entra tokens on every backend route, sessions (B27) | Built 5 Nov 2026 (HVE #42; frontend 0.67.0, backend 0.57.0); deployed and validated in CDP dev, user-confirmed 5 Nov 2026 | [06 Shared services](06-shared-services-and-security.md#portal-sign-in-and-api-access-b27) |
| Gateway authorisation layers (B23)                                                 | Built 5 Nov 2026 (HVE #42; infra v0.11.0 to v0.11.2); applied, probed and p95 validated, user-confirmed 5 Nov 2026        | [04 Catalogue and gateway](04-catalogue-and-gateway.md#gateway-authorisation-layers-b23)   |

## Not built yet

Team client secrets and federations (B18), the Graph switch-on for directory search, limits (B17), usage and
chargeback (B19), observability (B20 to B22), the rest of the Platform Admin area (B31: team lifecycle, federated
credentials), research-tier journey tests and the liveness reconcile, the
delivery-quality work, and B28's journey tests and end-to-end check. See [remaining.md](../remaining.md).

## Where to go next

- [ui-flow-three-routes.md](../../flat-design-updates/v1/ui-flow-three-routes-v1.md): the end-to-end flow the journeys implement.
- `ai-platform-discovery-docs/src/content/design-*.md`: the design pack (environments, orchestration, repositories and
  pipelines, infrastructure, identity, teams, observability) and `build-stories.md`.
- Each repository's README: setup, testing, locks, backfills and the proxy.
