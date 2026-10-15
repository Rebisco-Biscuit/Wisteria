# <img width="26" height="26" alt="image" src="https://github.com/user-attachments/assets/10deb7dc-850e-4b89-9fe1-465ed8289269" /> Wisteria
A personal, password-locked art vault. Drop in working files and finished pieces and it keeps them tidy.

## How files get organized

| You upload | What happens |
| --- | --- |
| `art.sai2` on its own | stays as `art.sai2` |
| `sketch.png` on its own | stays as `sketch.png` |
| `art.psd` + `art.png` (together or at different times) | both go into an `art/` folder, with the png as its cover |
| `art.clip` after `art/` already exists | goes straight into `art/` |

Matching is by filename without the extension and ignores case. Uploading a file with a name that's already in the vault replaces it (you get asked first).

## Running locally

```bash
npm install
APP_PASSWORD=whatever npm start
```

Open http://localhost:3000. Files land in `./data/vault` unless you point it at a bucket (see `.env.example`).

## Deploying on Render

Render's free web services lose their disk on every deploy or restart, so there are two ways to go:

**Free: Render + Cloudflare R2 (recommended)**

1. In Cloudflare, create an R2 bucket and an R2 API token with read/write on it. Note the account endpoint (`https://<account-id>.r2.cloudflarestorage.com`). R2's free tier is 10 GB.
2. Push this repo to GitHub, then in Render choose **New → Blueprint** and pick the repo. It reads `render.yaml`.
3. Fill in `APP_PASSWORD`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` when asked.

Free services sleep after 15 minutes idle, so the first visit after a while takes ~30 seconds to wake up.

**Paid: Render persistent disk**

Use a Starter instance, add a disk (say mounted at `/var/data`), set `STORAGE_DIR=/var/data/vault` and leave the `S3_*` variables empty.

## Settings

| Variable | |
| --- | --- |
| `APP_PASSWORD` | required, the one password to get in. Changing it signs out every device |
| `SESSION_SECRET` | optional, signs the login cookie |
| `STORAGE_DIR` | where files go when no bucket is set (default `./data/vault`) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_PREFIX` | bucket storage |
| `MAX_UPLOAD_MB` | per-file upload limit, default 2048 |
