# OpenClaw Suno Music

OpenClaw plugin for generating music through the Suno API.

## Features

- Create complete songs with original lyrics and style prompts
- Generate lyric variations without creating audio
- Check lyrics and music task status
- Check remaining Suno API credits
- Create reusable Suno personas from completed tracks
- Keep a small local task history for songs, lyrics, and personas created through the plugin
- Optional local callback server for Suno webhooks

## Tools

- `suno_create_song`
- `suno_generate_lyrics`
- `suno_lyrics_status`
- `suno_credit_status`
- `suno_generate_persona`
- `suno_song_status`
- `suno_user_records`

## Requirements

- OpenClaw `2026.5.20` or newer
- Node.js `22.19.0` or newer
- Suno API key from `sunoapi.org`
- Public callback URL for Suno task callbacks

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
chmod 600 .env
```

Required:

```bash
SUNO_API_KEY=your_api_key_here
SUNO_CALLBACK_URL=https://your-public-callback.example/suno/callback
```

Optional:

```bash
SUNO_BASE_URL=https://api.sunoapi.org
SUNO_DEFAULT_MODEL=V4_5ALL
SUNO_DEFAULT_NEGATIVE_TAGS=low quality, distorted vocals, clipping, noisy mix
SUNO_GENERATION_MIN_CREDITS=10
```

## Local Callback Server

For local testing:

```bash
npm run callback
```

Expose `http://localhost:8787/suno/callback` with Cloudflare Tunnel, ngrok, or another reverse proxy, then set `SUNO_CALLBACK_URL` to the public URL.

## Local Development

```bash
npm install
npm run doctor
node --check index.mjs
openclaw plugins install --link .
openclaw plugins enable suno-music
openclaw gateway restart
openclaw plugins inspect suno-music --runtime --json
```

## ClawHub Publishing

Before publishing, make sure the package name matches the ClawHub owner policy you intend to use. If you publish under an org or user scope, use a package name like:

```json
{
  "name": "@your-owner/openclaw-suno-music"
}
```

If the package is scoped, the scope must match the selected ClawHub publish owner.

Run the local checks:

```bash
npm run prepublish:check
npm run pack:dry-run
npm run doctor
```

Then run a ClawHub dry run before creating a release:

```bash
clawhub package publish . --dry-run
```

Publish after the dry run passes:

```bash
clawhub package publish .
```

## Security Notes

Do not publish `.env`, `suno-history.json`, generated audio files, or local callback payloads. This package uses `files`, `.npmignore`, `.gitignore`, and `.clawhubignore` to keep local secrets and runtime state out of release artifacts.

The plugin sends prompts and lyrics to the configured Suno API provider. Do not submit private or sensitive content unless that is acceptable for your provider account and policy.
