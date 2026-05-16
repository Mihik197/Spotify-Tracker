# Spotify Profile Tracker

Tracks a public Spotify profile's "Recently played artists" page over time and turns the observed changes into a local dashboard. It also records public follower/following counts and visible follower/following profile lists.

This uses the public profile route, not Spotify OAuth or the Spotify Web API. It renders the public pages with local Chrome/Edge, extracts artist links, profile counts, and visible social lists from the rendered DOM, and stores snapshots/events as JSONL files in `data/`.

## Run

```bash
npm install
npm run sample
npm run start
```

Open `http://localhost:4387`.

To keep collecting in the background while the dashboard runs:

```bash
npm run dev
```

Or run the pieces separately:

```bash
npm run collect
npm run start
```

## Free Hosted Setup

Recommended free setup:

- GitHub Actions runs the collector every 5 minutes.
- Supabase stores snapshots, events, and collector state.
- Vercel or Netlify hosts the static dashboard.

### 1. Create Supabase Project

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Run the SQL in `supabase/schema.sql`.
4. Go to **Project Settings > API** and copy:
   - Project URL
   - `anon public` key
   - `service_role` key

The anon key is used by the frontend for read-only dashboard data. The service-role key is only used by GitHub Actions to write collector data.

If you already created the original tables, run `supabase/schema.sql` again. It includes safe `alter table ... add column if not exists` statements for the follower/following fields.

### 2. Push This Repo To GitHub

Commit and push the project to a GitHub repository. The collector workflow is already in `.github/workflows/collect.yml`.

### 3. Add GitHub Action Secrets

In GitHub:

1. Open the repo.
2. Go to **Settings > Secrets and variables > Actions**.
3. Add these repository secrets:

```text
SPOTIFY_PROFILE_URL=https://open.spotify.com/user/your-user-id
SPOTIFY_RECENTLY_PLAYED_ARTISTS_URL=https://open.spotify.com/user/your-user-id/recently-played-artists
SUPABASE_URL=your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
```

4. Open **Actions > Collect Spotify Profile**.
5. Run the workflow manually once with **Run workflow**.

After that, GitHub runs it every 5 minutes. GitHub Actions does not support every-minute cron reliably; 5 minutes is the practical free minimum.

If GitHub's native scheduler does not fire reliably, use the Vercel trigger fallback below.

### 4. Deploy The Dashboard

#### Vercel

1. Import the GitHub repo in Vercel.
2. Set framework preset to **Other** if asked.
3. Add environment variables:

```text
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
```

4. Build command: `npm run build:web`
5. Output directory: `public`
6. Deploy.

`vercel.json` already contains these defaults.

#### Netlify

1. Import the GitHub repo in Netlify.
2. Add environment variables:

```text
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
```

3. Build command: `npm run build:web`
4. Publish directory: `public`
5. Deploy.

`netlify.toml` already contains these defaults.

#### Render Static Site

Use **Static Site**, not Web Service.

1. Connect the GitHub repo.
2. Add environment variables:

```text
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
```

3. Build command: `npm run build:web`
4. Publish directory: `public`
5. Deploy.

### 5. Optional Reliable Cron Fallback

GitHub scheduled workflows can be delayed or dropped. If scheduled runs do not appear, use an external cron service to call the deployed Vercel endpoint, which then triggers the same GitHub workflow.

1. Create a fine-grained GitHub token:
   - GitHub **Settings > Developer settings > Personal access tokens > Fine-grained tokens**
   - Repository access: only this repo
   - Permissions: **Actions: Read and write**, **Metadata: Read-only**

2. In Vercel, add these environment variables:

```text
CRON_SECRET=make-a-long-random-string
GITHUB_OWNER=Mihik197
GITHUB_REPO=Spotify-Tracker
GITHUB_WORKFLOW_ID=collect.yml
GITHUB_WORKFLOW_REF=main
GITHUB_DISPATCH_TOKEN=your fine-grained GitHub token
```

3. Redeploy Vercel.

4. Create a free cron job at a service like cron-job.org:
   - URL: `https://your-vercel-domain.vercel.app/api/trigger-collect`
   - Method: `GET`
   - Schedule: every 5 minutes
   - Header: `Authorization: Bearer your-CRON_SECRET-value`

If the cron service cannot set headers, use:

```text
https://your-vercel-domain.vercel.app/api/trigger-collect?secret=your-CRON_SECRET-value
```

This does not scrape from Vercel. It only tells GitHub Actions to run the collector.

## Dashboard Views

The dashboard has:

- overall activity by hour
- day-by-day history
- a date picker for viewing one specific day's active times
- top observed artists for overall history or the selected day
- current follower/following counts from the public profile
- current recently played artists
- change timeline, including follower/following count and visible-user changes

## Polling

The collector checks the public page every 55-95 seconds by default, with random jitter and exponential backoff after failures. You can tune it with environment variables:

```bash
SPOTIFY_TRACKER_MIN_MS=55000 SPOTIFY_TRACKER_MAX_MS=95000 npm run collect
```

On GitHub Actions the collector runs once per workflow execution, scheduled every 5 minutes.

The collector renders the public Spotify pages with Chrome. The default render budget is 15 seconds per page, and pages are rendered in parallel with separate browser profiles. If Spotify gets slow, you can raise it:

```bash
SPOTIFY_TRACKER_RENDER_BUDGET_MS=25000 npm run collect
```

## Snapshot Retention

Events are kept forever because they are the useful activity history. To keep Supabase tidy, the collector deletes unchanged snapshots older than 10 days after each successful run. Changed snapshots, events, and current state are kept.

You can change the cleanup window:

```bash
SPOTIFY_TRACKER_SNAPSHOT_RETENTION_DAYS=60 npm run collect
```

Set `SPOTIFY_TRACKER_SNAPSHOT_RETENTION_DAYS=0` to disable cleanup.

## What The Data Means

Spotify's public page shows a ranked list of recently played artists, but it does not expose exact play timestamps, tracks, or listening duration. This tracker records:

- recent public artist list snapshots, plus changed snapshots long-term
- when the public list changes
- which artists were added/removed from the visible list
- public follower/following counts, and when either count changes
- visible public followers/following users, and who appeared/disappeared when the lists render publicly
- the time of day those public-list changes were observed

So the dashboard is an observation-based activity tracker, not a precise listening-history export.
