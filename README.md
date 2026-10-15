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

1. `npm install`
2. Copy `.env.example` to `.env` and set `APP_PASSWORD`
3. `npm start`
4. Open http://localhost:3000

Uploaded files are saved in `./data/vault`.

## Deploying on Render

Push the repo to GitHub, then in Render choose **New → Blueprint** and pick the repo. It reads `render.yaml` and asks for `APP_PASSWORD`.

Note that Render's free plan wipes the disk on every deploy or restart, so uploads there won't last. Free services also sleep after 15 minutes idle, so the first visit after a while takes ~30 seconds.

## Settings

| Variable | |
| --- | --- |
| `APP_PASSWORD` | required, the one password to get in. Changing it signs out every device |
| `SESSION_SECRET` | optional, signs the login cookie |
| `STORAGE_DIR` | where uploaded files are kept (default `./data/vault`) |
| `MAX_UPLOAD_MB` | per-file upload limit, default 2048 |
