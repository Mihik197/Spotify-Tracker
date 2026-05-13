# Spotify Profile Tracker

Tracks a public Spotify profile's "Recently played artists" page over time and turns the observed changes into a local dashboard.

This uses the public profile route, not Spotify OAuth or the Spotify Web API. It renders the public page with local Chrome/Edge, extracts artist links from the rendered DOM, and stores snapshots/events as JSONL files in `data/`.

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

## Dashboard Views

The dashboard has:

- overall activity by hour
- day-by-day history
- a date picker for viewing one specific day's active times
- top observed artists for overall history or the selected day
- current recently played artists
- change timeline

## Polling

The collector checks the public page every 55-95 seconds by default, with random jitter and exponential backoff after failures. You can tune it with environment variables:

```bash
SPOTIFY_TRACKER_MIN_MS=55000 SPOTIFY_TRACKER_MAX_MS=95000 npm run collect
```

On GitHub Actions the collector runs once per workflow execution, scheduled every 5 minutes.

## What The Data Means

Spotify's public page shows a ranked list of recently played artists, but it does not expose exact play timestamps, tracks, or listening duration. This tracker records:

- every observed public artist list snapshot
- when the public list changes
- which artists were added/removed from the visible list
- the time of day those public-list changes were observed

So the dashboard is an observation-based activity tracker, not a precise listening-history export.
