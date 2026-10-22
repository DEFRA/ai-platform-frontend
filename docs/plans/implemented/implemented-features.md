# Implemented features

A one-page index of what is built in the AI Platform Portal (`ai-platform-frontend` and `ai-platform-backend-api`),
for new joiners. It holds no detail: each row links to the category file in this folder
that does. What is not built is in [remaining.md](../remaining.md).

Last updated: 20 Oct 2026.

## What you can do

| Journey                                                             | Status                                                | Detail                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Home page, sign in with Defra Entra ID, flat Defra design           | Built (Sept 2026)                                     | [01 Portal journeys](01-portal-journeys.md)             |
| Browse the model catalogue, including ineligible and retired models | Built (Sept to Oct 2026)                              | [04 Catalogue and gateway](04-catalogue-and-gateway.md) |
| Get a personal research key, renew, revoke, re-reveal with a reason | Built, live in Infradev                               | [02 Research tier](02-research-tier.md)                 |
| Create a team, manage members and roles, set a service code         | Built (Sept to Oct 2026)                              | [03 Team tier](03-team-tier.md)                         |
| Request one or several dedicated models, follow the GitOps progress | Built, live in Infradev                               | [03 Team tier](03-team-tier.md)                         |
| Remove a model from a team                                          | Built (18 Oct 2026)                                   | [03 Team tier](03-team-tier.md)                         |
| Rotate and revoke a team credential (Admin)                         | Built; the secret is a labelled placeholder until B18 | [03 Team tier](03-team-tier.md)                         |

## What it runs on

| Area                                                                       | Status                                   | Detail                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Terraform and GitHub Actions pipeline, five repositories, Infradev applied | Built (15 to 20 Oct 2026)                | [05 Platform and GitOps](05-platform-and-gitops-pipeline.md) |
| CDP dev wired to Infradev (config, proxy rules)                            | Built (20 Oct 2026), one proxy rule open | [05 Platform and GitOps](05-platform-and-gitops-pipeline.md) |
| Idempotency, audit, locks, backfills, security baseline, federated auth    | Built                                    | [06 Shared services](06-shared-services-and-security.md)     |

## Not built yet

Team client secrets and federations (B18), federated portal sign-in with token validation on the backend (B27), limits
(B17), usage and chargeback (B19), observability (B20 to B22), the gateway
authorisation layers' built state (B23), research-tier journey tests and the liveness reconcile, and the delivery-quality
work. See [remaining.md](../remaining.md).

## Where to go next

- [ui-flow-three-routes.md](../../flat-design-updates/v1/ui-flow-three-routes-v1.md): the end-to-end flow the journeys implement.
- `ai-platform-discovery-docs/src/content/design-*.md`: the design pack (environments, orchestration, repositories and
  pipelines, infrastructure, identity, teams, observability) and `build-stories.md`.
- Each repository's README: setup, testing, locks, backfills and the proxy.
