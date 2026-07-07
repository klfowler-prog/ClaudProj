# Secret Manager setup (one-time)

The deploy workflow reads three sensitive values from **Google Secret Manager**
via `--set-secrets` instead of passing them as plaintext env vars. Run this once
(with **rotated** values) before merging the Secret Manager change to `main`,
or the deploy will fail because the secrets don't exist yet.

The two non-sensitive OAuth client IDs (`GMAIL_CLIENT_ID`, `SLACK_CLIENT_ID`)
stay as env vars sourced from GitHub Actions secrets — only the secrets move.

## 1. Create the secrets (use freshly rotated values)

```bash
printf '%s' 'NEW_GMAIL_CLIENT_SECRET' | gcloud secrets create gmail-client-secret --data-file=- --project cmo-task-app
printf '%s' 'NEW_GEMINI_API_KEY'      | gcloud secrets create gemini-api-key      --data-file=- --project cmo-task-app
printf '%s' 'NEW_SLACK_CLIENT_SECRET' | gcloud secrets create slack-client-secret --data-file=- --project cmo-task-app
```

To rotate later, add a new version instead of recreating:

```bash
printf '%s' 'ROTATED_VALUE' | gcloud secrets versions add gemini-api-key --data-file=- --project cmo-task-app
```

## 2. Grant read access to the Cloud Run runtime service account

```bash
for S in gmail-client-secret gemini-api-key slack-client-secret; do
  gcloud secrets add-iam-policy-binding "$S" --project cmo-task-app \
    --member='serviceAccount:951932541878-compute@developer.gserviceaccount.com' \
    --role='roles/secretmanager.secretAccessor'
done
```

If the **deploy step** itself errors validating the secret reference, also grant
`roles/secretmanager.secretAccessor` to the deployer SA
`github-deployer@cmo-task-app.iam.gserviceaccount.com`.

## 3. Clean up

- Delete `GMAIL_CLIENT_SECRET`, `GEMINI_API_KEY`, `SLACK_CLIENT_SECRET` from the
  GitHub repo secrets — they are no longer referenced by the workflow.
- Then merge the workflow change to `main`; the next deploy will mount the
  secrets from Secret Manager.
