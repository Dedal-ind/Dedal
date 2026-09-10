# S3 Upload Setup

Dedal stores uploaded images (event/fest posters) through a pluggable storage
driver. **Local disk is the default** — you only need this guide when you want
production uploads to go to Amazon S3.

The switch is automatic: when `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID` **and**
`S3_SECRET_ACCESS_KEY` are all set, the backend uses the S3 driver; otherwise it
writes to `uploads/` and serves the files itself. The active driver is logged at
startup:

```
Using local upload driver
Using S3 upload driver
```

Objects are stored under the `uploads/` key prefix and served as public
`https://<bucket>.s3.<region>.amazonaws.com/uploads/<random>.<ext>` URLs.

---

## 1. Create the bucket (ap-south-1 / Mumbai)

1. AWS Console → **S3** → **Create bucket**.
2. Name it (e.g. `festpass-uploads-prod`) and choose region **Asia Pacific
   (Mumbai) `ap-south-1`** — this must match `AWS_REGION`.
3. Under **Block Public Access**, **uncheck** "Block all public access" (posters
   must be publicly readable). Acknowledge the warning. Only the `uploads/*`
   prefix is made public by the bucket policy below.
4. Leave the rest default and create.

## 2. Bucket policy — public read on `uploads/*`

S3 → your bucket → **Permissions** → **Bucket policy**. Replace
`YOUR_BUCKET_NAME`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/uploads/*"
    }
  ]
}
```

This makes **only** objects under `uploads/` world-readable; everything else in
the bucket stays private.

## 3. IAM user — least privilege

The app needs to put, delete, and read objects — nothing more.

1. IAM → **Users** → **Create user** (e.g. `festpass-uploader`), programmatic
   access only (no console login).
2. Attach an **inline policy** (replace `YOUR_BUCKET_NAME`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

3. Create an **access key** for the user and copy the **Access key ID** and
   **Secret access key** — the secret is shown only once.

> The scope is `/*` (the whole bucket) so future private prefixes work with the
> same key; public exposure is still controlled solely by the bucket policy in
> step 2.

## 4. CORS (only if the browser ever calls S3 directly)

The current flow uploads **through the backend** (the browser posts to
`/api/v1/uploads`, the server puts to S3), so no bucket CORS is required. If you
later add browser-direct presigned uploads, add this under S3 → **Permissions** →
**CORS**, replacing the origin:

```json
[
  {
    "AllowedOrigins": ["https://your-production-frontend.example.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

## 5. Activate S3 — set the environment variables

In the backend's **`.env`** (never `.env.example`, and never committed):

```bash
AWS_REGION=ap-south-1
S3_BUCKET_NAME=festpass-uploads-prod
S3_ACCESS_KEY_ID=AKIA...                # from step 3
S3_SECRET_ACCESS_KEY=...                # from step 3
S3_UPLOAD_URL_EXPIRY_SECONDS=3600       # only used by presigned (private) URLs
```

Restart the backend. Startup logs should read **`Using S3 upload driver`**. Upload
a poster from the admin Create-Event form and confirm the returned URL is an
`https://…amazonaws.com/uploads/…` link that renders.

To revert to local disk, unset any one of the three S3 credentials and restart.

---

### How it maps to the code

| Concern | Where |
|---|---|
| Driver selection + interface | `src/services/upload-storage-service.js` (`getStorageDriver`) |
| Upload endpoint | `POST /api/v1/uploads` → `src/controllers/upload-controller.js` (admin-only, 5 MB cap, in-memory multer) |
| Response shape | `{ "data": { "url": "…" } }` — identical for both drivers |
| Local static serving | `/uploads` mount in `src/application.js` (local driver only) |
| Startup log | `logActiveUploadDriver()` in `server.js` |

The `posterImageUrl` event field validator (`helpers/event-field-parsers.js`) uses
`validator.isURL(..., { require_tld: false, protocols: ["http", "https"] })`, so
both localhost dev URLs and production S3 URLs validate cleanly.
