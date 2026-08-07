# Getting the credentials

Every variable in `.env.example` and where it comes from. Work top to bottom;
later steps reuse the project you create in step 2.

Everything lands in `.env.local`, which is gitignored. Never paste a value into
a tracked file, a commit message, or a log line. The canonical variable list is
`AGENTS.md` section 8.

Start by making the file:

```bash
cp .env.example .env.local
```

## 0. Tools you need locally

`gcloud` is required, because Firestore and Cloud Storage authenticate through
your own Google credentials rather than through a key in the env file. `gh` is
optional and only saves clicking.

```bash
brew install --cask google-cloud-sdk
```

```bash
brew install gh
```

## 1. GEMINI_API_KEY

This is a real API key, and the only one in the file that is a model
credential.

1. Go to https://aistudio.google.com/apikey and sign in with the Google account
   you want to bill.
2. Choose **Create API key**.
3. When it asks which Cloud project to attach the key to, pick the project from
   step 2 if you have already made it. Otherwise let it create one and reuse
   that project below, so you do not end up with two.
4. Copy the key once. Studio will not show it again.
5. Put it in `.env.local` as `GEMINI_API_KEY=`.

The free tier is enough for development. Rate limits apply per project, so if
flows start returning empty, check the quota page before suspecting the code.

## 2. GOOGLE_CLOUD_PROJECT

1. Go to https://console.cloud.google.com/projectcreate.
2. Name it something you will recognise, for example `drift-dev`.
3. After it is created, copy the **project ID**, not the display name. The ID is
   the lowercase one, often with a number appended.
4. Put it in `.env.local` as `GOOGLE_CLOUD_PROJECT=`.

Then point your local CLI at it:

```bash
gcloud auth login
```

```bash
gcloud config set project YOUR_PROJECT_ID
```

Billing has to be enabled on the project for Cloud Storage to accept writes,
even inside the free tier. Do that at
https://console.cloud.google.com/billing/linkedaccount.

## 3. FIRESTORE_DATABASE

1. Go to https://console.cloud.google.com/firestore/databases with your project
   selected.
2. Create a database. Choose **Native mode**, not Datastore mode. Drift does not
   work in Datastore mode.
3. Pick a region near you and keep it. The region cannot be changed later.
4. Leave the database id as `(default)` unless you deliberately named it
   something else.

`.env.local` already has `FIRESTORE_DATABASE=(default)`. Only change it if you
named the database yourself.

## 4. STORAGE_BUCKET

Screenshots go here. Bucket names are globally unique across all of Google
Cloud, so prefix yours with the project id.

```bash
gcloud storage buckets create gs://YOUR_PROJECT_ID-drift-screenshots --location=US --uniform-bucket-level-access
```

Put the bare name in `.env.local`, with no `gs://` prefix and no trailing slash:

```
STORAGE_BUCKET=YOUR_PROJECT_ID-drift-screenshots
```

The `gs://` form only appears inside stored `screenshotPath` values, which the
code builds for you.

## 5. Credentials for Firestore and Cloud Storage

There is no variable for these. `packages/core/src/firestore.ts` uses Google
application default credentials, so the worker picks up whatever identity your
machine is signed in as. This is deliberate: it means no service-account JSON
key sits on disk or in the env file.

```bash
gcloud auth application-default login
```

This opens a browser, and on success writes a credentials file under
`~/.config/gcloud/`. Run it once per machine. You will need to rerun it if you
ever see `Could not load the default credentials`.

If the account you signed in with is not the project owner, it needs the
**Cloud Datastore User** and **Storage Object Admin** roles on the project.

In deployed environments this step does not apply at all. Cloud Run uses its
service account automatically, and the API keys come from Secret Manager rather
than a file.

## 6. GITHUB_TOKEN and GITHUB_REPO_ALLOWLIST

Drift reads `drift.config.json` out of the watched repo and later opens pull
requests against it, so the token needs write access to exactly one repo.

1. Go to https://github.com/settings/personal-access-tokens/new. This is the
   **fine-grained** token page. Do not use a classic token.
2. Name it `drift-dev` and set an expiry you are comfortable with. Ninety days
   is reasonable.
3. Under **Repository access**, choose **Only select repositories** and pick the
   watched demo app. Nothing else.
4. Under **Repository permissions**, set:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Metadata**: Read-only, which GitHub selects for you and will not let you
     remove
   Leave every other permission at **No access**.
5. Generate the token and copy it. It starts with `github_pat_`.
6. Put it in `.env.local` as `GITHUB_TOKEN=`.

Then list the same repo in the allowlist, as `owner/name`, comma-separated if
there is ever more than one:

```
GITHUB_REPO_ALLOWLIST=your-username/your-demo-app
```

This is a hard gate. Drift refuses to open a PR against a repo that is not on
this list even if Firestore says otherwise, so it has to match the repo string
on the project document exactly.

## 7. FIREBASE_* (auth client config)

Nothing reads these yet. They are needed once the dashboard's login route
exists, so you can skip this until then.

1. Go to https://console.firebase.google.com and choose **Add project**. When it
   asks, select the **existing** Cloud project from step 2 rather than making a
   new one.
2. In **Build > Authentication**, choose **Get started**, then enable the
   **Google** provider only. Drift has no other sign-in method by design.
3. Under **Authentication > Settings > Authorized domains**, confirm
   `localhost` is listed. It usually is.
4. In **Project settings > General**, scroll to **Your apps** and add a **Web**
   app. Skip Firebase Hosting when offered; Drift deploys to Cloud Run.
5. From the config snippet it shows you, copy four values into `.env.local`:
   - `apiKey` goes to `FIREBASE_API_KEY`
   - `authDomain` goes to `FIREBASE_AUTH_DOMAIN`
   - `projectId` goes to `FIREBASE_PROJECT_ID`
   - `appId` goes to `FIREBASE_APP_ID`

The Firebase web API key is not a secret in the way the others are. It ships to
the browser by design and is restricted by the authorized-domains list, not by
being hidden. It still stays out of git, for consistency.

## 8. PREVIEW_AUTH_COOKIE_VALUE

Only needed if the watched app has routes behind a login. If every route Drift
renders is public, leave this empty.

1. Open the watched app's preview URL in a browser and sign in as the demo user.
2. Open developer tools, then **Application > Cookies** in Chrome or
   **Storage > Cookies** in Firefox.
3. Find the session cookie. Its **name** goes in the watched repo's
   `drift.config.json` as `authCookieName`. Its **value** is what you copy.
4. Put the value in `.env.local` as `PREVIEW_AUTH_COOKIE_VALUE=`.

A run whose config sets `authCookieName` fails before the browser launches when
this is empty. That is on purpose: rendering a login page under a signed-in
route's name would poison every later comparison.

Session cookies expire. When runs suddenly start finding drift on every screen
at once, re-copy this value before believing the findings.

## 9. NEXT_PUBLIC_APP_URL

Drift's own dashboard URL, not the watched app's. Locally this is already
correct in `.env.example`:

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Change it to the Cloud Run URL when the dashboard is deployed. The
`NEXT_PUBLIC_` prefix means Next.js inlines it into the browser bundle, so never
put anything secret behind that prefix.

## Checking it worked

`.env.local` should now have no empty values except `PREVIEW_AUTH_COOKIE_VALUE`
if the watched app is public, and the `FIREBASE_*` group if you skipped step 7.

Confirm your Google credentials resolve and the bucket is reachable:

```bash
gcloud auth application-default print-access-token > /dev/null && echo "credentials ok"
```

```bash
gcloud storage ls gs://$STORAGE_BUCKET && echo "bucket ok"
```

Then seed a project document, which exercises `GOOGLE_CLOUD_PROJECT`, the
application default credentials, and Firestore in one go:

```bash
pnpm seed --name "Acme" --repo "your-username/your-demo-app" --preview-url "https://your-preview-url"
```

## If a value leaks

Rotating is quick and always the right call. Gemini keys are deleted and
recreated at https://aistudio.google.com/apikey. Fine-grained GitHub tokens are
revoked at https://github.com/settings/tokens?type=beta. If a value ever reaches
a commit, rotate it first and rewrite history second; assume anything pushed was
captured.
