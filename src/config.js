export const config = {
  profileUrl:
    process.env.SPOTIFY_PROFILE_URL ??
    "https://open.spotify.com/user/31c2zzrpetowojd6qxjfw2ld42sy",
  recentlyPlayedArtistsUrl:
    process.env.SPOTIFY_RECENTLY_PLAYED_ARTISTS_URL ??
    withRecentlyPlayedArtists(
      process.env.SPOTIFY_PROFILE_URL ??
        "https://open.spotify.com/user/31c2zzrpetowojd6qxjfw2ld42sy",
    ),
  dataDir: new URL("../data/", import.meta.url),
  serverPort: Number(process.env.PORT ?? 4387),
  snapshotRetentionDays: Number(process.env.SPOTIFY_TRACKER_SNAPSHOT_RETENTION_DAYS ?? 30),
  poll: {
    minMs: Number(process.env.SPOTIFY_TRACKER_MIN_MS ?? 55_000),
    maxMs: Number(process.env.SPOTIFY_TRACKER_MAX_MS ?? 95_000),
    navigationTimeoutMs: Number(process.env.SPOTIFY_TRACKER_TIMEOUT_MS ?? 45_000),
    maxBackoffMs: Number(process.env.SPOTIFY_TRACKER_MAX_BACKOFF_MS ?? 15 * 60_000),
  },
};

function withRecentlyPlayedArtists(profileUrl) {
  return `${profileUrl.replace(/\/$/, "")}/recently-played-artists`;
}
