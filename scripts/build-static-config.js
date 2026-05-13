import { writeFile } from "node:fs/promises";

const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
};

await writeFile(
  new URL("../public/config.js", import.meta.url),
  `window.SPOTIFY_TRACKER_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);

console.log("Wrote public/config.js");
