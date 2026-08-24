# gitlab-unfurl-teams

Paste a GitLab merge request, issue or epic link into Microsoft Teams and get a
card instead of a sign-in page.

Each person sees exactly what they can already see in GitLab, because the card
is built with their own OAuth token. There is no shared service token.

## What it recognises

| Kind | URL shape | Card reads |
|---|---|---|
| Merge request | `/{namespace}/{project}/-/merge_requests/412` | `!412` |
| Issue | `/{namespace}/{project}/-/issues/88` | `#88` |
| Epic | `/groups/{namespace}/-/epics/17` | `&17` |

The sigils are GitLab's own reference syntax, so the card needs no separate type
label. Note that epics live under `/groups/` and carry a **group** path rather
than a project path — a different URL shape, not just a different word.

Epics are a Premium feature on GitLab.com. On a Free namespace the API returns
404 and you get no card, which is the correct outcome rather than an error.

Anything else — commits, snippets, jobs, a project's home page — is not
recognised and produces no card. Teams then falls back to its own generic
preview.

```
https://gitlab.example.com/platform/api/-/merge_requests/412
```
becomes

```
┌────────────────────────────────────────┐
│ !412 · Add rate limiting to the API    │
│ platform/api                           │
│                                        │
│ State      opened                      │
│ Author     Ada Lovelace                │
│ Assignees  Grace Hopper                │
│ Labels     backend, security           │
│ Pipeline   success                     │
│                                        │
│ [ Open in GitLab ]                     │
└────────────────────────────────────────┘
```

---

## Why this exists

**GitLab ships link unfurling on no platform at all.** Not Teams, and not Slack
either. The only occurrence of `unfurl` in GitLab's codebase disables it: the
Slack integration sends `unfurl_links: false` to stop Slack unfurling GitLab's
own notification links. GitLab's Slack app does notifications and slash
commands, and does not subscribe to `link_shared`.

Slack users solved this themselves — `kiwicom/gitlab-unfurly` and seven other
open-source unfurlers exist precisely *because* GitLab does not do it. Teams
users had no unfurler at all, first-party or community. This is the community
one.

### What already exists, and why it is not this

Search the Teams store for "gitlab" and nothing you find is published by GitLab.
GitHub ships a first-party Teams app. GitLab ships none. That asymmetry is the
reason this project exists.

Commercial notification bots do cover GitLab in Teams. They message you when a
merge request needs your attention, and some let you approve or merge from the
card. **If that is what you want, use one — it is the better tool for that job.**

It is a different capability, though. A notification bot delivers to *you*, in a
one-to-one chat, about work you are already involved in. Unfurling expands a link
*somebody else* pasted into a channel, so everyone reading that channel can see
what it is without opening a tab. The two are complementary, and the hosted
options generally do not unfurl at all.

One difference may decide it regardless of features: a hosted bot holds an OAuth
grant into your repositories and processes that data on vendor infrastructure.
This runs in your own tenant, stores nothing, and holds no shared credential.
See [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md).

---

## How it works

```
┌────────────────────────────────────────────────────────────────────────────┐
│ MICROSOFT-OPERATED   ·   you neither host nor pay for any of this          │
│                                                                            │
│ ┌──────────────────────────┐    ┌────────────────────────────────────┐     │
│ │ Teams client             │    │ Bot Framework token service        │     │
│ │ channel · chat · DM      │    │ token.botframework.com             │     │
│ └──────────────────────────┘    │                                    │     │
│                                 │ Holds ONE GitLab token PER USER.   │     │
│                                 │ This is why the app needs no       │     │
│                                 │ database and no service account.   │     │
│                                 └────────────────────────────────────┘     │
│                                                                            │
│    [1] someone pastes a GitLab link into the compose box                   │
│    [4] the app asks this service for THAT user's token                     │
│    [5] no token yet -> a sign-in card is returned instead                  │
└────────────────────────────────────────────────────────────────────────────┘

   |  [2] POST /api/messages, JWT signed by Bot Framework
   v

┌────────────────────────────────────────────────────────────────────────────┐
│ YOUR IDENTITY TENANT   ·   Microsoft Entra ID                              │
│                                                                            │
│ ┌───────────────────────────────┐    A bot registration is required        │
│ │ App registration              │    for ANY Teams app, whichever          │
│ │ -> app id + client secret     │    cloud runs your compute.              │
│ │                               │                                          │
│ │ Azure Bot  ·  free tier       │    This is the only Azure piece          │
│ │ · endpoint -> your host       │    you cannot avoid.                     │
│ │ · OAuth connection "gitlab"   │                                          │
│ │   Generic OAuth 2 -> GitLab   │                                          │
│ └───────────────────────────────┘                                          │
│                                                                            │
│    [2] Teams POSTs /api/messages, signed by Bot Framework                  │
│    [3] your service verifies that JWT before anything else                 │
└────────────────────────────────────────────────────────────────────────────┘

   |  [3] the request reaches your own compute
   v

┌────────────────────────────────────────────────────────────────────────────┐
│ YOUR INFRASTRUCTURE   ·   pick one, the code is identical                  │
│                                                                            │
│   AWS                     Azure                      GCP                   │
│   Lambda +                App Service (zip)          Cloud Run or          │
│   Function URL            or Container Apps          any Node host         │
│   hosts/aws               hosts/azure                hosts/gcp             │
│                                                                            │
│ ┌──────────────────────────────────────────────────────────────┐           │
│ │ POST /api/messages                                           │           │
│ │                                                              │           │
│ │ packages/app    [3] verify JWT · validate activity           │           │
│ │                 [4] look up this user's token                │           │
│ │ packages/core   validate URL · [6] fetch · [7] build card    │           │
│ │                                                              │           │
│ │ no database  ·  no disk  ·  no shared credential             │           │
│ └──────────────────────────────────────────────────────────────┘           │
│                                                                            │
│   secret store (your platform's)  ->  BOT_PASSWORD                         │
│   egress restricted to Bot Framework + your GitLab origin only             │
└────────────────────────────────────────────────────────────────────────────┘

   |  [6] GET /api/v4/... with that user's token
   v

┌────────────────────────────────────────────────────────────────────────────┐
│ YOUR GITLAB   ·   gitlab.com or self-managed   ·   any tier                │
│                                                                            │
│ ┌──────────────────────────────────────┐    registered at one of:          │
│ │ OAuth application                    │      instance-wide (self-managed) │
│ │ redirect -> token.botframework.com   │      group-owned   (gitlab.com)   │
│ │ scope: read_api                      │      user-owned    (small teams)  │
│ └──────────────────────────────────────┘                                   │
│                                                                            │
│    [6] called as the USER · read_api · redirects refused                   │
└────────────────────────────────────────────────────────────────────────────┘

  [7] the Adaptive Card returns to the thread everyone is reading.

  WHY IT MATTERS   [4] and [5] are why there is no database here: Microsoft
                   holds the tokens. [6] is why one person can never see
                   another person's projects - the call is made as them.
```

---

## What it does not do

- **No Slack.** That gap is already filled, eight times over.
- **No write actions.** No approve, no merge, no comment. Read-only scope.
- **No unfurling of already-posted links.** Teams only unfurls on paste. No app
  can change that.
- **No zero-install unfurling.** An anonymous invoke carries no user identity,
  so there would be no token to act with.

---

## Security

Read [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md). It is written for the person
who has to approve this, and it states what is *not* built as plainly as what
is.

The short version: no shared credential, no database, no Graph permissions, and
the request destination comes from your configuration rather than from the
pasted link. Fifteen numbered invariants, each mapped to a test.

---

## Requirements

- Node 22 or later
- A GitLab instance, any tier. Free works. Self-managed works.
- An Azure Bot Service registration. This is required for **any** Teams app,
  whichever cloud runs your compute.
- A Teams administrator who can upload a custom app.

---

## Setup

### 1. Register a GitLab OAuth application

All three levels work on **Free, Premium and Ultimate**. Pick the one that
matches how you run GitLab. Each is a complete procedure.

#### Self-managed GitLab

1. Sign in as an administrator.
2. Go to **Admin panel → Applications → New application**.
3. Name it `Teams Unfurl`.
4. Set **Redirect URI** to your Bot Service redirect URI, which is
   `https://token.botframework.com/.auth/web/redirect`.
5. Tick **Trusted**. This skips the per-user authorization screen, so your
   people never see a consent prompt. It is the best experience available and
   it is easy to miss.
6. Under **Scopes**, tick `read_api` only.
7. Save. Keep the Application ID and Secret for step 2.

#### GitLab.com, company group

1. Go to your group → **Settings → Applications**.
2. Select **Add new application**.
3. Name it `Teams Unfurl`.
4. Set **Redirect URI** to `https://token.botframework.com/.auth/web/redirect`.
5. Under **Scopes**, tick `read_api` only.
6. Save. Keep the Application ID and Secret for step 2.

#### GitLab.com, small team

Use this when nobody has group Owner.

1. Go to **Avatar → Edit profile → Access → Applications**.
2. Select **Add new application**.
3. Name it `Teams Unfurl`.
4. Set **Redirect URI** to `https://token.botframework.com/.auth/web/redirect`.
5. Under **Scopes**, tick `read_api` only.
6. Save. Keep the Application ID and Secret for step 2.

Note that a user-owned application belongs to one person and disappears when
that account does. Prefer a group-owned or instance-wide application where you
can.

### 2. Create the Azure Bot Service OAuth connection

> **One deployment serves one tenant.** Multi-tenant bot creation was
> [deprecated on 31 July 2025](https://learn.microsoft.com/azure/bot-service/abs-quickstart)
> and is now refused outright — `--app-type MultiTenant` fails. Register the
> Entra app as **single-tenant** (`AzureADMyOrg`) and create the bot as
> **SingleTenant**. Since this app can never be published to the Teams Store
> (see above), one instance cannot serve several organisations. Each
> organisation deploys its own, which is the intended model anyway.
>
> `UserAssignedMSI` is the other supported type and removes `BOT_PASSWORD`
> entirely. It only works on Azure compute, so it trades the multi-cloud story
> for one fewer secret. Worth it if you are on Azure and staying there.

1. Create an **Azure Bot** resource with app type **SingleTenant**. Note the
   Microsoft App ID, the tenant ID and the secret.
2. Open **Settings → Configuration → Add OAuth Connection Settings**.
   **Use the portal, not the CLI.** `az bot authsetting create` calls
   `Microsoft.BotService/listAuthServiceProviders` at *subscription* scope, which
   many organisations deny to a resource-group-scoped account. It fails even
   with every parameter supplied. The portal path needs no subscription-scope
   permission — only ownership of the bot.
3. Name the connection, for example `gitlab`.
4. Choose service provider **Generic Oauth 2**.
5. Enter the Application ID and Secret from step 1.
6. Set the URLs, replacing the host with your own:
   - Authorization URL `https://gitlab.example.com/oauth/authorize`
   - Token URL `https://gitlab.example.com/oauth/token`
   - Refresh URL `https://gitlab.example.com/oauth/token`
7. Set **Scopes** to `read_api`.
8. Leave **Token Exchange URL** empty.
9. Save, then use **Test Connection** to confirm it works.

### 3. Configure and deploy

Copy `.env.example` and fill it in. In production, supply `BOT_PASSWORD`
through your platform's secret manager rather than a literal value. On Azure
that means a Key Vault reference in app settings, which the platform resolves at
runtime — the portal shows the setting as **Resolved** and the literal never
appears in configuration, a deployment manifest or a log.

Two things about vaults that are painful to discover later: a vault is either
**RBAC** or **access-policy** mode, and that is chosen at creation and awkward to
change afterwards. If you cannot get a role assignment on an existing vault,
creating your own is usually faster than waiting for one.

| Cloud | Entry point | Runs as |
|---|---|---|
| AWS | `hosts/aws` | Lambda + Function URL |
| Azure | `hosts/azure` | App Service (zip deploy), or Container Apps |
| GCP | `hosts/gcp` | Cloud Run, or any Node host |

**The artifact is a Node HTTP server listening on `$PORT`**, not a container.
`hosts/azure` and `hosts/gcp` are the same eight lines of `@hono/node-server`, so
they run anywhere Node runs: a zip deploy to App Service's Node runtime, a
container on Container Apps or Cloud Run, a VM, or a PaaS of your choosing. You
do not need a container registry.

AWS is the exception, and gets a thin `hono/aws-lambda` adapter instead, because
Lambda's handler contract is not an HTTP listener.

What Hono does *not* publish is an Azure Functions or GCP Cloud Functions
adapter. That rules out the serverless-function path on those two clouds. It
does not require a container.

Point your Azure Bot's messaging endpoint at `https://<your-host>/api/messages`.

### 4. Build and upload the Teams app

```bash
BOT_ID=<your-bot-id> GITLAB_ORIGIN=https://gitlab.example.com \
  node manifest/build-manifest.mjs
```

That writes `manifest/build/gitlab-unfurl-teams.zip`, containing the manifest and
both icons at the archive root, which is what Teams expects. Upload it in
**Teams admin center → Teams apps → Manage apps → Upload new app**.

The `GITLAB_ORIGIN` you build with is baked into the manifest as the domain Teams
watches for. Rebuild and re-upload if you change instance.

---

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```

146 tests, no network access needed. The security-critical code lives in
`packages/core`, which declares no dependency on Hono or the Teams SDK and can
be tested with no server running.

---

## Architecture

```
packages/core    url validation, GitLab client, card building
                 depends only on fetch
packages/app     Hono server, Teams activity validation, the invoke handler
hosts/*          thin adapters for AWS, Azure and GCP
```

`packages/core` declares no dependency on Hono or `@microsoft/teams.*`, and a
test enforces it. Microsoft archived `botbuilder-js` in January 2026 and
replaced it with `teams.ts`, so this layer does churn. When it churns again,
the rewrite touches `packages/app` and the tests worth keeping do not move.

---

## Contributing

A Slack renderer would be welcome. `packages/core` is platform-neutral by
construction, so it is one renderer plus Slack's asynchronous `chat.unfurl`
call. Note that this changes the handler contract, which is synchronous for
Teams.

---

## Credits

The GitLab URL taxonomy started from [`kiwicom/gitlab-unfurly`](https://gitlab.com/kiwicom/gitlab-unfurly),
MIT licensed, which solved the discrimination between issue, merge request,
snippet, commit and epic paths. This project is a TypeScript reimplementation
rather than a fork, and the validator here is a security component the original
was never required to be.

Cross-checked against GitLab's own Banzai reference filters
(`lib/banzai/filter/references/`), which hold the canonical patterns.

## Licence

MIT. See [LICENSE](LICENSE).
