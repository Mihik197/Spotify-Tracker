import { writeFile } from "node:fs/promises";

const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  spotifyProfileUrl: process.env.SPOTIFY_PROFILE_URL ?? "",
  spotifyRecentlyPlayedArtistsUrl:
    process.env.SPOTIFY_RECENTLY_PLAYED_ARTISTS_URL ??
    (process.env.SPOTIFY_PROFILE_URL ? withRecentlyPlayedArtists(process.env.SPOTIFY_PROFILE_URL) : ""),
};

await writeFile(
  new URL("../public/config.js", import.meta.url),
  `window.SPOTIFY_TRACKER_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);

console.log("Wrote public/config.js");

function withRecentlyPlayedArtists(profileUrl) {
  return `${profileUrl.replace(/\/$/, "")}/recently-played-artists`;
}
