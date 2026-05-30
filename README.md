# Spotify Profile Tracker

Tracks a public Spotify profile's recently played artists, public follower/following counts, and visible social lists. It uses Spotify's public profile pages, not Spotify OAuth or the Spotify Web API.

## What It Shows

- activity timeline inferred from recently played artist list changes
- day history and per-day activity views
- top observed artists
- current recently played artists
- public follower/following counts and visible users
- change timeline for artist/social-list updates

This is observation-based. Spotify does not expose exact play times, tracks, or duration through the public profile page.

## Required Services

- Supabase for storage
- GitHub Actions for collection
- Vercel for the static dashboard and cron trigger endpoint
- cron-job.org, or similar, to trigger collection on a schedule

## Supabase

Create a Supabase project and run:

```text
supabase/schema.sql
```

You need:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Use `SUPABASE_ANON_KEY` only in the frontend host. Use `SUPABASE_SERVICE_ROLE_KEY` only in GitHub Actions.

## GitHub Secrets

Add repository secrets in **Settings > Secrets and variables > Actions**:

```text
SPOTIFY_PROFILE_URL=https://open.spotify.com/user/your-user-id
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
```

The recently played artists URL is derived from `SPOTIFY_PROFILE_URL`.

## Vercel Env Vars

Add these to Vercel:

```text
SPOTIFY_PROFILE_URL=https://open.spotify.com/user/your-user-id
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
CRON_SECRET=make-a-long-random-string
GITHUB_OWNER=your GitHub username/org
GITHUB_REPO=your repo name
GITHUB_WORKFLOW_ID=collect.yml
GITHUB_WORKFLOW_REF=main
GITHUB_DISPATCH_TOKEN=your fine-grained GitHub token
```

The GitHub token should be scoped to this repo with **Actions: Read and write** and **Metadata: Read-only**.

Vercel build settings:

```text
Build command: npm run build:web
Output directory: public
```

## Cron Schedule

Create cron jobs that call:

```text
https://your-vercel-domain.vercel.app/api/trigger-collect?secret=your-CRON_SECRET-value
```

Recommended schedule in Asia/Kolkata:

```cron
*/15 0-1,7-23 * * *
*/20 2-6 * * *
```

Use two cron jobs if your cron provider only supports one expression per job.

## Local Development

Create `.env` from `.env.example`, then:

```bash
npm install
npm run sample
npm run start
```

Open:

```text
http://localhost:4387
```

Run collector and dashboard together:

```bash
npm run dev
```

## Data Retention

Events are kept because they are the activity history. Unchanged snapshots older than 10 days are deleted after successful collection. Changed snapshots, events, and current state are kept.

Override with:

```bash
SPOTIFY_TRACKER_SNAPSHOT_RETENTION_DAYS=30 npm run collect
```

Use `0` to disable cleanup.
