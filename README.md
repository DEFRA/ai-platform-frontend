# ai-platform-frontend

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_ai-platform-frontend&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_ai-platform-frontend)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_ai-platform-frontend&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_ai-platform-frontend)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_ai-platform-frontend&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_ai-platform-frontend)

Core delivery platform Node.js Frontend Template.

- [Documentation](#documentation)
- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Server-side Caching](#server-side-caching)
- [Redis](#redis)
- [Local Development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Documentation

- [Implemented features](docs/plans/implemented/implemented-features.md) — what's been built so far across this repo and
  `ai-platform-backend-api`, for new joiners.
- [UI flow build plan (v2 and v3)](docs/flat-design-updates/v3/build-plan.md) and the per-route plans in
  [docs/plans/](docs/plans/) — the authoritative design/build detail behind the journey.

## Requirements

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd ai-platform-frontend
nvm use
```

## Server-side Caching

We use Catbox for server-side caching. By default the service will use CatboxRedis when deployed and CatboxMemory for
local development.
You can override the default behaviour by setting the `SESSION_CACHE_ENGINE` environment variable to either `redis` or
`memory`.

Please note: CatboxMemory (`memory`) is _not_ suitable for production use! The cache will not be shared between each
instance of the service and it will not persist between restarts.

Sessions are always held in this cache (the cookie carries only a session id), so a person, a half-made request and a
client secret awaiting display never sit in the browser, and signing out ends the session for good.

## Redis

Redis is an in-memory key-value store. Every instance of a service has access to the same Redis key-value store similar
to how services might have a database (or MongoDB). All frontend services are given access to a namespaced prefixed that
matches the service name. e.g. `my-service` will have access to everything in Redis that is prefixed with `my-service`.

## Proxy

We are using forward-proxy which is set up by default. Services are automatically configured with the proxy environment variables when deployed.

Node.js 24 uses these variables to route outbound HTTP(S) requests through the proxy:

NODE_USE_ENV_PROXY=1
HTTPS_PROXY=...
NO_PROXY=...

No additional proxy configuration is required in the service.

## Local Development

### Setup

Install application dependencies:

```bash
npm install
```

### Git hooks

Install git hooks (optional)

```bash
npm run git:hooks
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

#### Local sign-in without a real Entra ID tenant

Entra ID (Azure AD) OIDC sign-in normally needs a real `AZURE_TENANT_ID` and
`AZURE_CLIENT_ID`. For local development without one, run the bundled mock
OIDC provider alongside the app:

```bash
npm run dev:mock-oidc
```

Then in your local `.env` set:

```env
OIDC_MOCK_ISSUER_URL=http://localhost:3100
AZURE_TENANT_ID=mock-tenant
AZURE_CLIENT_ID=mock-client
AZURE_CLIENT_SECRET=mock-secret
```

`dev:mock-oidc` loads the same `.env` as `npm run dev`, so if you already have
real `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` values set, both processes will
use them consistently — you only need to add `OIDC_MOCK_ISSUER_URL`. Signing
in always logs in as one fixed mock user (`dev.user@defra.gov.uk`, as `preferred_username` and `email`). This path
is never used in production: it's gated behind `OIDC_MOCK_ISSUER_URL` being
set **and** the app not running in production.

#### Who can sign in

The frontend decides this in the sign-in callback, from the claims of the ID token, which is the only place they are
seen, and a refused account is not sent to the backend and nothing about it is logged. The checks, all of which must
pass:

- **Not a guest.** Microsoft's [ID token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
  (read 4 Nov 2026) says `idp` "is identical to the value of the issuer claim unless the user account isn't in the same
  tenant as the issuer - guests, for instance", and that it "should always be sent in managed domain scenarios". A guest
  is refused when `idp` is present and is not this tenant (its tenant ID is not the token's `tid`, which for a guest is
  the resource tenant, and it is not `iss`; `live.com` and `google.com` have no tenant and are refused). `acct` is the
  other documented signal ([optional claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference),
  `acct` 0 member, 1 guest): it is refused when it is present and not 0, but the app registration does not send it yet
  (a manual Entra step, a follow-up, which would remove the one gap below). An `#EXT#` name in any claim is refused by
  the address rule.
- **Eligible by address.** The domain is decided on the person's own sign-in name (`preferred_username`, else `upn`),
  and the `email` and `upn` claims, when present, must be eligible too: the claims Microsoft says are mutable can only
  refuse, never admit. The rule is the one in `eligibility-rule.js`, the same as the backend's `isEligible`: the whole
  address is trimmed and lower-cased, has exactly one `@`, no `#EXT#` anywhere, and a domain that is an exact match for
  one in `ALLOWED_EMAIL_DOMAINS` (a comma-separated list, default `defra.gov.uk,defra.onmicrosoft.com`), so a subdomain
  (`x@sub.defra.gov.uk`) or a look-alike (`x@defra.gov.uk.example.com`) is refused. A blank `email` is no email.

A refused account sees "You cannot sign in with this account".

**What this does not catch:** a guest whose token has no `idp`, no `acct` and no `#EXT#` name, and whose sign-in name
and email are both on an allowed domain, passes, because nothing in that token says it is a guest. Microsoft sends
`idp` for guests, so this should not happen; adding the `acct` optional claim to the ID token in the app registration
would close it. The backend does not close it: it is sent only the email, and applies the same address rule to that.
Until the backend validates tokens itself (B27), it relies on this check for guests.

The two sides run the same table of addresses (`eligibility-rule.test.js` here, `directory-eligibility.test.js` in the
backend); change one, change the other. They differ in what they see: the frontend sees the claims, the backend only
the address it is sent. Keep the list the same as the backend's.

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json)
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Docker

### Development image

> [!TIP]
> For Apple Silicon users, you may need to add `--platform linux/amd64` to the `docker run` command to ensure
> compatibility fEx: `docker build --platform=linux/arm64 --no-cache --tag ai-platform-frontend`

Build:

```bash
docker build --target development --no-cache --tag ai-platform-frontend:development .
```

Run:

```bash
docker run -p 3000:3000 ai-platform-frontend:development
```

### Production image

Build:

```bash
docker build --no-cache --tag ai-platform-frontend .
```

Run:

```bash
docker run -p 3000:3000 ai-platform-frontend
```

### Docker Compose

A local environment with:

- Floci (replacing Localstack) for AWS services (S3, SQS)
- Redis
- MongoDB
- This service.
- A commented out backend example.

```bash
docker compose up --build -d
```

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties).

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
