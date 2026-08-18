# Deploying Drift to Google Cloud

Everything Drift runs on is Google Cloud (`AGENTS.md` section 1). The dashboard
is a Cloud Run service, the render worker is a Cloud Run job, and the job is
started two ways: Cloud Scheduler on an interval per watched project, and a
Pub/Sub push to the dashboard when a watched repo redeploys its preview.

This file is meant to be followed top to bottom from an empty project. Every
step is a command you run. Set the two placeholders in step 1 and the rest of
the file uses them.

There are four things this file cannot do for you, all of them console clicks.
They are listed together in **[Console steps](#console-steps)** near the end,
and each is referenced from the step that needs it.

---

## 1. Set the placeholders

`PROJECT_ID` is the Google Cloud project id, not its display name. `REGION` is
one region for the service, the job, the bucket and the images, so they sit
together and nothing pays to cross a region on the hot path.

**`REGION` is not a free choice if this project already has a Firestore
database.** A Firestore location is fixed when the database is created and can
never be moved, and it is the one thing everything else talks to constantly: a
worker run makes many sequential Firestore calls per screen, and every dashboard
page assembles itself from several queries. Put the compute where the data
already is, not the other way round. Check before you pick:

```bash
gcloud firestore databases list --format='value(name.basename(),locationId)'
```

For this project that answers `(default) africa-south1`, so:

```bash
export PROJECT_ID=drift-504722
export REGION=africa-south1
```

Cloud Scheduler needs its own, because **it is not offered in every region
`REGION` can be**, and `africa-south1` is one of the ones it is not offered in.
That costs nothing: a scheduler entry makes one call to the Cloud Run Admin API
to start a job, so its region adds one request's latency per run rather than one
per Firestore operation. Any supported location will do.

```bash
export SCHEDULER_REGION=europe-west1
```

If `REGION` happens to be a region Cloud Scheduler supports, set
`SCHEDULER_REGION` to the same thing and the distinction disappears. The current
list is at <https://cloud.google.com/scheduler/docs/locations>.

Point the CLI at it and record the project number, which a couple of service
agents are named after.

```bash
gcloud config set project "$PROJECT_ID"
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "$PROJECT_NUMBER"
```

Everything below assumes you are in the repo root, on a machine with `gcloud`
authenticated as someone who owns the project.

```bash
gcloud auth login
```

---

## 2. Enable the APIs

Every service this deployment touches, in one call. It takes a couple of
minutes the first time.

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  logging.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  identitytoolkit.googleapis.com \
  firebase.googleapis.com \
  generativelanguage.googleapis.com \
  cloudresourcemanager.googleapis.com
```

Pub/Sub mints the identity tokens it signs its pushes with through a service
agent that is created lazily. Force it into existence now, because step 10
grants it a role and you cannot grant a role to an account that does not exist.

```bash
gcloud beta services identity create --service=pubsub.googleapis.com --project="$PROJECT_ID"
```

---

## 3. Artifact Registry

One Docker repository holds both images.

```bash
gcloud artifacts repositories create drift \
  --repository-format=docker \
  --location="$REGION" \
  --description="Drift container images"
```

---

## 4. Firestore

Native mode, one database, the id `(default)` that `FIRESTORE_DATABASE`
defaults to (`AGENTS.md` sections 1 and 8).

Skip this if you already ran Drift locally against this project: it is the same
database, and the projects, runs and findings you have already written are the
ones the deployed dashboard will read. **This project has one already**, in
`africa-south1`, which is where step 1 got `REGION` from.

Creating one is the single least reversible command in this file. Its location
cannot be changed afterwards, and everything else follows it.

```bash
gcloud firestore databases create --location="$REGION" --type=firestore-native
```

Then the composite indexes. Every repository query that filters by project and
sorts at the same time needs one, and the dashboard will not load a page until
they exist. These are the same nine declared in `firestore.indexes.json`; that
file stays the source of truth, and a query that pairs a new `where` with an
`orderBy` needs a new entry there and a new command here.

```bash
gcloud firestore indexes composite create --collection-group=runs \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=startedAt,order=descending

gcloud firestore indexes composite create --collection-group=findings \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=createdAt,order=descending

gcloud firestore indexes composite create --collection-group=findings \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=createdAt,order=descending

gcloud firestore indexes composite create --collection-group=conventions \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=updatedAt,order=descending

gcloud firestore indexes composite create --collection-group=archetypes \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=createdAt,order=ascending

gcloud firestore indexes composite create --collection-group=screens \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=capturedAt,order=descending

gcloud firestore indexes composite create --collection-group=screens \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=route,order=ascending \
  --field-config=field-path=viewport,order=ascending \
  --field-config=field-path=capturedAt,order=descending

gcloud firestore indexes composite create --collection-group=resolutions \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=findingId,order=ascending \
  --field-config=field-path=createdAt,order=ascending

gcloud firestore indexes composite create --collection-group=resolutions \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=createdAt,order=descending
```

They build in the background. Watch them until every one says `READY`:

```bash
gcloud firestore indexes composite list --format='table(name.basename(), state)'
```

Run that first, before the block above. If it already lists nine `READY`
indexes, they were created while running Drift locally and this step is done.

---

## 5. The screenshot bucket

Private, and firmly so: the dashboard streams every screenshot through
`/api/screens/[screenId]/image` behind the session, and no object is ever
public and no signed URL is ever handed to a browser.

As with Firestore, skip the creation if you already ran Drift locally: the
bucket named in your `.env.local` is the one holding the screenshots the
deployed dashboard will serve. Take the name from there rather than inventing a
second one.

```bash
export BUCKET=drift-504722-screenshots

gcloud storage buckets describe "gs://${BUCKET}" --format='value(name,location)'
```

If it does not exist yet:

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention
```

---

## 6. Secret Manager

Every value in `AGENTS.md` section 8 becomes a secret. Nothing sensitive is in
either Dockerfile, in any image, or in any `gcloud run` flag other than
`--set-secrets`, which passes a reference rather than a value.

Fill in each placeholder below before running the block. You have most of these
values already: they are the ones in your local `.env.local`, and where each
comes from is in [docs/credentials.md](docs/credentials.md). Two notes on the
list itself:

- `PREVIEW_AUTH_COOKIE_VALUE` is only read for a project whose
  `drift.config.json` sets `authCookieName`. If every route you watch is
  public, leave the placeholder newline below as it is; the worker ignores the
  value entirely when no config names a cookie. If a project does name one and
  this is empty, the run fails before the browser launches, on purpose
  (`AGENTS.md` section 8).
- `NEXT_PUBLIC_APP_URL` is in the canonical list but nothing reads it yet. It
  is created here so the list is complete. You will not know the dashboard's
  URL until step 9, so put a placeholder in now and correct it in step 9 if you
  want it accurate.

If your shell is set to skip history lines that start with a space, indent the
block by one space before pasting it.

```bash
printf '%s' 'PASTE_GEMINI_API_KEY'            | gcloud secrets create GEMINI_API_KEY            --replication-policy=automatic --data-file=-
printf '%s' "$PROJECT_ID"                     | gcloud secrets create GOOGLE_CLOUD_PROJECT      --replication-policy=automatic --data-file=-
printf '%s' '(default)'                       | gcloud secrets create FIRESTORE_DATABASE        --replication-policy=automatic --data-file=-
printf '%s' "$BUCKET"                         | gcloud secrets create STORAGE_BUCKET            --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_GITHUB_TOKEN'              | gcloud secrets create GITHUB_TOKEN              --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_GITHUB_APP_ID'             | gcloud secrets create GITHUB_APP_ID             --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_BASE64_OF_THE_PEM'         | gcloud secrets create GITHUB_APP_PRIVATE_KEY    --replication-policy=automatic --data-file=-
printf '%s' 'owner/name'                      | gcloud secrets create GITHUB_REPO_ALLOWLIST     --replication-policy=automatic --data-file=-
printf '\n'                                   | gcloud secrets create PREVIEW_AUTH_COOKIE_VALUE --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_FIREBASE_API_KEY'          | gcloud secrets create FIREBASE_API_KEY          --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_FIREBASE_AUTH_DOMAIN'      | gcloud secrets create FIREBASE_AUTH_DOMAIN      --replication-policy=automatic --data-file=-
printf '%s' "$PROJECT_ID"                     | gcloud secrets create FIREBASE_PROJECT_ID       --replication-policy=automatic --data-file=-
printf '%s' 'PASTE_FIREBASE_APP_ID'           | gcloud secrets create FIREBASE_APP_ID           --replication-policy=automatic --data-file=-
printf '%s' 'https://example.invalid'         | gcloud secrets create NEXT_PUBLIC_APP_URL       --replication-policy=automatic --data-file=-
```

`GITHUB_REPO_ALLOWLIST` is the hard gate on pull requests (`AGENTS.md` section
8). Put the watched repo's `owner/name` in it, comma-separated if there is more
than one. An empty allowlist means no repo is writable, not every repo.

`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are the GitHub App, which is what
a project should be watched through: an installation is scoped by GitHub to the
repos somebody picked, where the PAT reaches everything its owner can. Both are
optional — with neither set, everything runs on `GITHUB_TOKEN` exactly as
before, and a project with no `installationId` does anyway.

The private key is the `.pem` GitHub gives you when you generate one. Secret
Manager holds newlines happily, so the PEM can go in as it is; base64 on one
line is accepted too, and is what a `.env.local` has to use.

```bash
base64 -i ~/Downloads/your-app.private-key.pem | tr -d '\n' \
  | gcloud secrets create GITHUB_APP_PRIVATE_KEY --replication-policy=automatic --data-file=-
```

The app's **Setup URL** on GitHub has to be `$DASHBOARD_URL/api/github/callback`
once step 9 has told you what `$DASHBOARD_URL` is. It is a single field, unlike
the redirect URIs, so a machine developing locally and a deployed service
cannot both have it; point it at whichever one is being used. Nothing breaks
when it is wrong — the install still happens on GitHub, and the dashboard reads
its installations from GitHub either way — but the person is not carried back
into the dialog.

To change any of these later, add a version rather than recreating the secret.
The services read `:latest`, so a new version takes effect on the next
revision.

```bash
printf '%s' 'NEW_VALUE' | gcloud secrets versions add GITHUB_TOKEN --data-file=-
```

---

## 7. Service accounts

Four, one per thing that acts. Splitting them is what makes the log of who did
what worth reading, and it is what lets the worker write to the bucket while
the dashboard can only read from it.

```bash
gcloud iam service-accounts create drift-dashboard \
  --display-name="Drift dashboard (Cloud Run service)"

gcloud iam service-accounts create drift-worker \
  --display-name="Drift render worker (Cloud Run job)"

gcloud iam service-accounts create drift-pubsub \
  --display-name="Drift deploy webhook (Pub/Sub push identity)"

gcloud iam service-accounts create drift-scheduler \
  --display-name="Drift scheduled runs (Cloud Scheduler identity)"
```

`drift-pubsub` is not an arbitrary name. The dashboard's push endpoint accepts
a push only from an identity token whose `email` claim is exactly
`drift-pubsub@$PROJECT_ID.iam.gserviceaccount.com`, and it works that out from
`GOOGLE_CLOUD_PROJECT` rather than being told. The job name `drift-worker` in
step 9 is fixed for the same reason: the dashboard starts the worker by naming
its job. Both are `DEPLOYMENT` in `packages/core/src/constants.ts`, because
both ends have to agree on them and a name only one side knows is a name that
can drift. Rename either one here and the deploy webhook stops working.

```bash
export SA_DASHBOARD="drift-dashboard@${PROJECT_ID}.iam.gserviceaccount.com"
export SA_WORKER="drift-worker@${PROJECT_ID}.iam.gserviceaccount.com"
export SA_PUBSUB="drift-pubsub@${PROJECT_ID}.iam.gserviceaccount.com"
export SA_SCHEDULER="drift-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
```

---

## 8. IAM

### Firestore and logging

Both runtimes read and write Firestore, and both write structured logs.

```bash
for member in "$SA_DASHBOARD" "$SA_WORKER"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${member}" --role=roles/datastore.user --condition=None
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${member}" --role=roles/logging.logWriter --condition=None
done
```

### The bucket

The worker uploads screenshots. The dashboard reads them back to stream through
`/api/screens/[screenId]/image`, and deletes them when a project is removed:
removing a project deletes every screenshot under its prefix (`AGENTS.md`
section 2), and that cascade runs in the dashboard because that is where the
person pressing the button is. So it needs `objectAdmin` too, not
`objectViewer`. A read-only dashboard fails on the first step of a removal, with
a 403 from Cloud Storage and a project left half deleted.

```bash
for member in "$SA_WORKER" "$SA_DASHBOARD"; do
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${member}" --role=roles/storage.objectAdmin
done
```

### Minting session cookies

The dashboard exchanges a Firebase ID token for a session cookie, and that
needs two permissions neither of which is implied by anything above.

**It has to be allowed to mint one.** Creating a session cookie is a call to
the Firebase Auth admin API, and `roles/datastore.user` does not carry it.

**It has to be able to sign one.** With a key file the SDK signs locally; on
Cloud Run there is no key file, so it asks Google's IAM service to sign on the
account's behalf, which requires the account to impersonate **itself**.

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_DASHBOARD}" \
  --role=roles/firebaseauth.admin --condition=None

gcloud iam service-accounts add-iam-policy-binding "$SA_DASHBOARD" \
  --member="serviceAccount:${SA_DASHBOARD}" \
  --role=roles/iam.serviceAccountTokenCreator
```

The second is granted on the account as a resource rather than project-wide, so
the dashboard can impersonate itself and nothing else.

Without both, Google accepts the sign-in and the dashboard rejects it a moment
later: the browser gets "that sign-in was not accepted" and the log says
`auth.session_rejected` with `insufficient permission`. It reads like an auth
configuration problem and is not one. The message is identical for either
missing permission, so check the account holds both rather than guessing which.

### The secrets

Granted one secret at a time rather than project-wide, so each runtime can read
exactly what it needs. The worker gets all fourteen. The dashboard gets twelve: it
calls no model, so it has no reason to hold the Gemini key, and it renders
nothing, so it has no reason to hold a preview's session cookie.

The lists are written out in the `for` line rather than held in a variable,
because macOS defaults to zsh and zsh does not split an unquoted variable into
words the way bash does. `for name in $WORKER_SECRETS` there passes all twelve
names as a single name, and every call fails on a secret id with spaces in it.

```bash
for name in GEMINI_API_KEY GOOGLE_CLOUD_PROJECT FIRESTORE_DATABASE STORAGE_BUCKET \
            GITHUB_TOKEN GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY \
            GITHUB_REPO_ALLOWLIST PREVIEW_AUTH_COOKIE_VALUE FIREBASE_API_KEY \
            FIREBASE_AUTH_DOMAIN FIREBASE_PROJECT_ID FIREBASE_APP_ID NEXT_PUBLIC_APP_URL; do
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SA_WORKER}" --role=roles/secretmanager.secretAccessor
done

for name in GOOGLE_CLOUD_PROJECT FIRESTORE_DATABASE STORAGE_BUCKET \
            GITHUB_TOKEN GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY \
            GITHUB_REPO_ALLOWLIST FIREBASE_API_KEY \
            FIREBASE_AUTH_DOMAIN FIREBASE_PROJECT_ID FIREBASE_APP_ID NEXT_PUBLIC_APP_URL; do
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SA_DASHBOARD}" --role=roles/secretmanager.secretAccessor
done
```

### Cloud Build

Builds run as the project's default compute service account unless told
otherwise. It needs to push to Artifact Registry and to write its own logs.

```bash
export SA_BUILD="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_BUILD}" --role=roles/artifactregistry.writer --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_BUILD}" --role=roles/logging.logWriter --condition=None
```

### Starting the job

Two identities start executions of the worker job: the dashboard, when a deploy
arrives, and Cloud Scheduler, on an interval. Both pass the project and the
trigger as a container override, and starting a job *with overrides* needs more
than `roles/run.invoker` allows. The binding below is `roles/run.developer`
scoped to the one job, not to the project, so neither identity can touch
anything else Cloud Run runs.

This is the step that has to wait: you cannot grant a role on a job that does
not exist yet, so run it after step 9.

---

## 9. Build and deploy

Both images build from the repo root, because this is a pnpm workspace and each
image needs the lockfile, the workspace file, and `packages/core`. Both build in
Cloud Build rather than locally: Cloud Run needs `linux/amd64` and a laptop with
Apple silicon produces `arm64` by default, which fails at deploy time with a
message that does not mention architecture.

### The images

```bash
gcloud builds submit --config cloudbuild.dashboard.yaml \
  --substitutions=_REGION="$REGION" .

gcloud builds submit --config cloudbuild.worker.yaml \
  --substitutions=_REGION="$REGION" .
```

The worker image is the slower of the two; the Playwright base image it starts
from is about a gigabyte, and it carries the Chromium build pinned in
`apps/worker/package.json`.

No `--region` on these, on purpose. The build runs in Cloud Build's default
pool and pushes to the Artifact Registry named in `_REGION`, which is where the
images have to end up. Where the build itself ran costs one upload, once, and
Cloud Build is not offered in every region Cloud Run is.

### The dashboard service

```bash
gcloud run deploy drift-dashboard \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/drift/drift-dashboard:latest" \
  --region="$REGION" \
  --service-account="$SA_DASHBOARD" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=120s \
  --set-secrets="GOOGLE_CLOUD_PROJECT=GOOGLE_CLOUD_PROJECT:latest,FIRESTORE_DATABASE=FIRESTORE_DATABASE:latest,STORAGE_BUCKET=STORAGE_BUCKET:latest,GITHUB_TOKEN=GITHUB_TOKEN:latest,GITHUB_APP_ID=GITHUB_APP_ID:latest,GITHUB_APP_PRIVATE_KEY=GITHUB_APP_PRIVATE_KEY:latest,GITHUB_REPO_ALLOWLIST=GITHUB_REPO_ALLOWLIST:latest,FIREBASE_API_KEY=FIREBASE_API_KEY:latest,FIREBASE_AUTH_DOMAIN=FIREBASE_AUTH_DOMAIN:latest,FIREBASE_PROJECT_ID=FIREBASE_PROJECT_ID:latest,FIREBASE_APP_ID=FIREBASE_APP_ID:latest,NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_APP_URL:latest"
```

`--allow-unauthenticated` is right here and is not a hole. The dashboard is a
browser application: every page and every route handler verifies a Firebase
session cookie on the server, and the one route that does not, the Pub/Sub push
endpoint, verifies a Google-signed identity token instead. Cloud Run's own IAM
check cannot do either of those, and turning it on would lock out the browser
and Pub/Sub alike.

Record the URL. Everything after this points at it.

```bash
export DASHBOARD_URL=$(gcloud run services describe drift-dashboard \
  --region="$REGION" --format='value(status.url)')
echo "$DASHBOARD_URL"
```

If you want `NEXT_PUBLIC_APP_URL` to be accurate, correct it now. Nothing reads
it yet, so this changes no behaviour.

```bash
printf '%s' "$DASHBOARD_URL" | gcloud secrets versions add NEXT_PUBLIC_APP_URL --data-file=-
```

### The worker job

```bash
gcloud run jobs deploy drift-worker \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/drift/drift-worker:latest" \
  --region="$REGION" \
  --service-account="$SA_WORKER" \
  --memory=4Gi \
  --cpu=2 \
  --task-timeout=30m \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=0 \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,GOOGLE_CLOUD_PROJECT=GOOGLE_CLOUD_PROJECT:latest,FIRESTORE_DATABASE=FIRESTORE_DATABASE:latest,STORAGE_BUCKET=STORAGE_BUCKET:latest,GITHUB_TOKEN=GITHUB_TOKEN:latest,GITHUB_APP_ID=GITHUB_APP_ID:latest,GITHUB_APP_PRIVATE_KEY=GITHUB_APP_PRIVATE_KEY:latest,GITHUB_REPO_ALLOWLIST=GITHUB_REPO_ALLOWLIST:latest,PREVIEW_AUTH_COOKIE_VALUE=PREVIEW_AUTH_COOKIE_VALUE:latest,FIREBASE_API_KEY=FIREBASE_API_KEY:latest,FIREBASE_AUTH_DOMAIN=FIREBASE_AUTH_DOMAIN:latest,FIREBASE_PROJECT_ID=FIREBASE_PROJECT_ID:latest,FIREBASE_APP_ID=FIREBASE_APP_ID:latest,NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_APP_URL:latest"
```

Four of those flags are decisions rather than defaults.

- **4Gi and 2 CPU.** Chromium rendering a full-page screenshot of a real
  product at 1440px is the memory ceiling of this whole system. Less than 4Gi
  and long pages die partway through with an error that reads like a Playwright
  bug.
- **`--max-retries=0`.** A run that fails has already written its `runs`
  document with `status: error` and the reason (`AGENTS.md` section 7). A retry
  would write a second run for the same trigger and make the history lie about
  how often Drift looked.
- **`--task-timeout=30m`.** A run renders every declared route at every
  declared viewport, sequentially and on purpose, so a project with a lot of
  routes is slow rather than parallel and hard on the watched preview.
- **Second generation execution.** Chromium wants a full Linux kernel. The job
  also launches it with `--no-sandbox` and `--disable-dev-shm-usage`, which the
  worker turns on by itself when it sees `CLOUD_RUN_JOB` in its environment and
  never on a laptop.

  There is deliberately no `--execution-environment=gen2` above. No `gcloud run
  jobs` subcommand accepts that flag as of SDK 579 — not `deploy`, not
  `update`, not `create`, and not their `beta` forms — and passing it fails
  client-side with `unrecognized arguments`, before any call is made. That
  failure is quiet in the worst way: the command errors, the job keeps running
  the image it already had, and nothing anywhere says the deploy did not
  happen. Check `metadata.generation` if a deploy seems not to have landed.

  So the setting is left where it already is rather than restated. Confirm it
  after every deploy, because a job that silently drops to first generation
  renders nothing and says only that the browser closed:

  ```bash
  gcloud run jobs describe drift-worker --region="$REGION" \
    --format='value(spec.template.metadata.annotations["run.googleapis.com/execution-environment"])'
  ```

  If that ever comes back empty, export the job to YAML, set the annotation,
  and `gcloud run jobs replace` it.

The image has no default command. Every execution supplies one as a container
override, so an execution that arrives without one stops at the CLI's usage
message instead of quietly rendering whichever project was baked in.

### The binding held back from step 8

Now that the job exists:

```bash
gcloud run jobs add-iam-policy-binding drift-worker \
  --region="$REGION" \
  --member="serviceAccount:${SA_DASHBOARD}" \
  --role=roles/run.developer

gcloud run jobs add-iam-policy-binding drift-worker \
  --region="$REGION" \
  --member="serviceAccount:${SA_SCHEDULER}" \
  --role=roles/run.developer
```

### Prove the job runs at all

Before wiring anything to it, start one execution by hand, with a project id
from your `projects` collection. This writes a real run with trigger `manual`.

```bash
gcloud run jobs execute drift-worker \
  --region="$REGION" \
  --args="run,--project,PROJECT_DOC_ID,--trigger,manual" \
  --wait
```

If you have no project yet, seed one from your laptop, which talks to the same
Firestore database:

```bash
pnpm seed --name "Acme" --repo "acme/web" --preview-url "https://acme-preview.a.run.app"
```

---

## 10. Cloud Scheduler: one entry per watched project

A schedule belongs to a project, not to Drift: different products are worth
looking at at different rates. So there is one scheduler job per watched
project, each carrying that project's id on the worker's command line, and each
recording `scheduled` as the run's trigger because the command line says so.

Substitute `PROJECT_DOC_ID` in both places. The name of the scheduler entry is
the thing you will read on the console page, so it carries the project id too.

The entry lives in `SCHEDULER_REGION` and the job it starts lives in `REGION`.
Those are two different places when Cloud Scheduler is not offered where the
rest of Drift runs (step 1), and only the `--location` flag moves: the `--uri`
still names the job's own region, because that is where the job is.

```bash
export PROJECT_DOC_ID=paste-the-firestore-project-id

gcloud scheduler jobs create http "drift-run-${PROJECT_DOC_ID}" \
  --location="$SCHEDULER_REGION" \
  --schedule="0 */6 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/drift-worker:run" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --oauth-service-account-email="$SA_SCHEDULER" \
  --message-body="{\"overrides\":{\"containerOverrides\":[{\"args\":[\"run\",\"--project\",\"${PROJECT_DOC_ID}\",\"--trigger\",\"scheduled\"]}]}}"
```

Every six hours is a reasonable watch rate for a product under development. For
a demo, `*/30 * * * *` gives you a run every half hour without waiting.

Fire it once without waiting for the clock:

```bash
gcloud scheduler jobs run "drift-run-${PROJECT_DOC_ID}" --location="$SCHEDULER_REGION"
```

Repeat the block for each further project you watch.

---

## 11. Pub/Sub: runs triggered by a deploy

The other way a run starts. The watched repo publishes one message when its
preview finishes redeploying; a push subscription posts it to the dashboard;
the dashboard works out which project owns that repo and starts the worker job
with `--trigger deploy`. Drift notices the deploy without anyone opening it.

### The topic and the push subscription

```bash
gcloud pubsub topics create drift-deploys

gcloud pubsub subscriptions create drift-deploys-dashboard \
  --topic=drift-deploys \
  --push-endpoint="${DASHBOARD_URL}/api/pubsub/deploy" \
  --push-auth-service-account="$SA_PUBSUB" \
  --ack-deadline=30 \
  --min-retry-delay=10s \
  --max-retry-delay=600s \
  --message-retention-duration=1h
```

No `--push-auth-token-audience`, deliberately. Left alone, Pub/Sub sets the
token's audience to the push endpoint URL, which is exactly what the endpoint
recomputes from the request it received. Nothing has to be kept in step by
hand, and a token minted for some other service cannot be replayed at this one.

Pub/Sub signs those tokens through its own service agent, which needs to be
allowed to mint tokens for `drift-pubsub`:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator --condition=None
```

### The message

One JSON object. `repo` is required and is how the dashboard finds the project;
`commit` and `ref` are optional and exist so a run in the dashboard can be
traced back to the commit that caused it. Unknown keys are rejected, so a typo
is a logged rejection rather than a deploy that silently never triggers
anything.

```json
{ "repo": "owner/name", "commit": "abc1234", "ref": "refs/heads/main" }
```

Publish one by hand to check the wiring end to end:

```bash
gcloud pubsub topics publish drift-deploys \
  --message='{"repo":"owner/name","commit":"manual-test"}'
```

Within a few seconds a `drift-worker` execution should appear. Step 13 shows
how to watch that happen in the log.

### Publishing it from the watched repo

The watched preview is itself on Cloud Run (`AGENTS.md` section 1: no Vercel,
no Netlify, even for previews), so the natural place to publish from is the end
of the same Cloud Build that deploys the preview. Add this as the last step of
the watched repo's `cloudbuild.yaml`, after the deploy step:

```yaml
- name: gcr.io/google.com/cloudsdktool/cloud-sdk
  id: tell-drift
  entrypoint: gcloud
  args:
    - pubsub
    - topics
    - publish
    - drift-deploys
    - --message
    - '{"repo":"owner/name","commit":"$COMMIT_SHA","ref":"$REF_NAME"}'
```

The build's service account needs to be allowed to publish. If the watched repo
builds in this same project, that is the default compute account again:

```bash
gcloud pubsub topics add-iam-policy-binding drift-deploys \
  --member="serviceAccount:${SA_BUILD}" \
  --role=roles/pubsub.publisher
```

If the watched repo deploys from GitHub Actions instead, the same one-line
`gcloud pubsub topics publish` goes at the end of that workflow, authenticated
with `google-github-actions/auth` through Workload Identity Federation, and the
role above goes to whichever service account the workflow impersonates.

---

## 12. Console steps

Four things that have no `gcloud` equivalent. Do them in this order, before you
try to sign in.

1. **Add Firebase to the project.** <https://console.firebase.google.com> ->
   **Add project** -> choose the existing `$PROJECT_ID`. This is what makes
   Firebase Auth available; the Firestore database and the bucket you already
   created are the ones it will show you.
2. **Turn on the Google sign-in provider.** Firebase console -> **Build** ->
   **Authentication** -> **Get started** -> **Sign-in method** -> **Google** ->
   enable, set a support email, save. Google only; there are no other providers
   (`AGENTS.md` section 1).
3. **Authorise the dashboard's domain.** Firebase console -> **Authentication**
   -> **Settings** -> **Authorized domains** -> **Add domain**, and paste the
   host part of `$DASHBOARD_URL`, for example
   `drift-dashboard-abc123.africa-south1.run.app`, without the `https://`. Sign-in fails
   with `auth/unauthorized-domain` until this is done.
4. **Register a web app, if you have not already.** Firebase console ->
   **Project settings** -> **Your apps** -> **Web**. The `apiKey`,
   `authDomain`, `projectId` and `appId` it shows you are the four `FIREBASE_*`
   secrets from step 6. If you filled those in from `.env.local` you already
   did this locally and the same values apply.

If your organisation's policy blocks `--allow-unauthenticated`
(`constraints/iam.allowedPolicyMemberDomains` usually), step 9 will fail on
that flag and it has to be lifted for this project before the dashboard is
reachable from a browser.

---

## 13. Cloud Logging

Both runtimes write one JSON object per line to stdout, so Cloud Logging lifts
every field into `jsonPayload` and every field is queryable. Every line a run
writes carries `runId` and `projectId` (`AGENTS.md` section 7).

### One run, end to end

This is the query. Substitute the run id.

```
resource.type="cloud_run_job"
resource.labels.job_name="drift-worker"
jsonPayload.runId="RUN_ID"
```

From a terminal, in order, with the phases in a column:

```bash
gcloud logging read \
  'resource.type="cloud_run_job" resource.labels.job_name="drift-worker" jsonPayload.runId="RUN_ID"' \
  --order=asc --limit=500 \
  --format='table(timestamp, jsonPayload.phase, jsonPayload.route, jsonPayload.viewport)'
```

It reads as the pipeline: `run.start`, `config.loaded`, `tokens.loaded`,
`render.planned`, `render.browser_ready`, then `render.target_start` through
`persist.findings_written` once per route per viewport, then `judge.*`,
`actuate.decision` per finding, and `run.finish` with the counts.

To get a run id without opening the dashboard, take the latest one:

```bash
gcloud logging read \
  'resource.type="cloud_run_job" resource.labels.job_name="drift-worker" jsonPayload.phase="run.start"' \
  --order=desc --limit=1 --format='value(jsonPayload.runId, jsonPayload.trigger, jsonPayload.projectId)'
```

### Everything about one watched project, across both runtimes

`projectId` is on every line the job writes and on every line the dashboard
writes about a deploy, so one query covers the service and the job together.

```
(resource.labels.job_name="drift-worker" OR resource.labels.service_name="drift-dashboard")
jsonPayload.projectId="PROJECT_DOC_ID"
```

### One deploy, from the webhook to the run

The dashboard logs `deploy.run_started` with the execution it started, and the
worker logs `run.start` with the execution it is running in, so the two ends
join up on the execution name.

```
resource.labels.service_name="drift-dashboard"
jsonPayload.phase=~"^deploy\."
```

Then follow the execution it names:

```
resource.type="cloud_run_job"
labels."run.googleapis.com/execution_name"="drift-worker-abcde"
```

### Errors only

Every line the runtimes write at `ERROR` severity, newest first. A quiet result
here is the healthy one.

```
severity="ERROR"
(resource.labels.job_name="drift-worker" OR resource.labels.service_name="drift-dashboard")
```

---

## 14. Redeploying after a change

Rebuild the image that changed and redeploy that one thing. Neither command
touches secrets, scheduler entries, or the subscription.

```bash
gcloud builds submit --config cloudbuild.dashboard.yaml --substitutions=_REGION="$REGION" .
gcloud run deploy drift-dashboard \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/drift/drift-dashboard:latest" --region="$REGION"
```

```bash
gcloud builds submit --config cloudbuild.worker.yaml --substitutions=_REGION="$REGION" .
gcloud run jobs deploy drift-worker \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/drift/drift-worker:latest" --region="$REGION"
```

---

## 15. When something does not work

| What you see | What it usually is |
| --- | --- |
| A worker deploy reports nothing and changes nothing | The command failed client-side on an unrecognised flag, so no call was made. `gcloud run jobs describe drift-worker --format='value(metadata.generation)'` is unchanged when this happens, and Cloud Run's audit log has no `Jobs.ReplaceJob` entry. `--execution-environment` is the one that does this |
| The dashboard is empty after separating accounts | A project created before `projects.userId` existed has no owner and is invisible. `pnpm adopt-projects --user <uid>` reports them, `--apply` hands them over. An unadopted project also blocks its repo from being added again, since a repo may only be watched once |
| Every dashboard page 500s with `FAILED_PRECONDITION` | The `projects.userId + createdAt` composite index is missing or still `CREATING`. Step 4 declares it; `gcloud firestore indexes composite list` says which |
| The repo picker is empty but the app is installed | The installation is not linked to the signed-in account. That link is written on the way back from GitHub, so an install done without going through Connect GitHub leaves nothing to read. Install again from the dialog |
| Connect GitHub goes to GitHub and comes back to the wrong place | The app's Setup URL points at the other environment. One field, so a laptop and a deployed service cannot both hold it (step 6) |
| The dashboard shows a page with no runs | The composite indexes in step 4 are still `CREATING`, or nothing has seeded a project |
| `PERMISSION_DENIED` on Firestore in the job's log | `roles/datastore.user` did not land on `$SA_WORKER` |
| The push endpoint answers 403 and logs `deploy.rejected` | The reason field says which of the three checks failed: the audience, the service account, or the signature. A different service account almost always means the subscription was created with the wrong `--push-auth-service-account` |
| The push endpoint answers 401 | Something other than Pub/Sub posted to it, or the subscription was created without `--push-auth-service-account` |
| Pub/Sub retries the same message forever | The endpoint is answering 500, which it only does when Cloud Run refused to start the job. Check the `deploy.run_failed` line and the `roles/run.developer` binding in step 9 |
| The scheduler entry says `PERMISSION_DENIED` | `roles/run.developer` did not land on `$SA_SCHEDULER`, or it was granted before the job existed |
| An execution exits immediately with usage text | It was started without a container override. `gcloud run jobs execute` needs `--args` |
| `Target page, context or browser has been closed` | The job is out of memory. It wants 4Gi |
| Sign-in fails with `auth/unauthorized-domain` | Console step 3 |
| Google accepts the sign-in, then the dashboard says it was not accepted | `auth.session_rejected` in the log. The dashboard cannot mint a session cookie: it needs **both** bindings in step 8's "Minting session cookies", and the message does not say which one is missing |
| The deploy of the service fails on `--allow-unauthenticated` | An org policy blocks public Cloud Run services. See the note at the end of step 12 |
| `Location ... is not supported` creating the scheduler entry | It was created with `--location="$REGION"`. Cloud Scheduler is not offered everywhere Cloud Run is; use `$SCHEDULER_REGION` (step 1) |
| Removing a project fails, and the project is still there with no screenshots | The dashboard's service account has `objectViewer` rather than `objectAdmin` on the bucket. The images went first, so re-run the removal once the binding in step 8 is right |
| Every page and every run feels slow, and nothing is erroring | Compute is in a different region from Firestore. Compare `gcloud firestore databases list` against the service's region; the data cannot move, so the compute has to |
