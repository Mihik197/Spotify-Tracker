import { scrapeSpotifyProfile } from "./scrape.js";
import { config } from "./config.js";
import { saveFailure, saveObservation } from "./store.js";

const once = process.argv.includes("--once");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelay(failureCount = 0) {
  if (failureCount > 0) {
    const base = Math.min(config.poll.maxBackoffMs, 30_000 * 2 ** Math.min(failureCount, 6));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }
  const { minMs, maxMs } = config.poll;
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

async function collectOnce() {
  const observation = await scrapeSpotifyProfile();
  const result = await saveObservation(observation);
  const names = observation.artists.slice(0, 5).map((artist) => artist.name).join(", ");
  const stats = observation.profileStats;
  const profileSummary =
    stats?.followers !== null && stats?.following !== null
      ? `; ${stats.followers} followers, ${stats.following} following`
      : "";
  console.log(
    `[${observation.observedAt}] ${result.snapshot.changed ? "changed" : "same"}: ${names}${profileSummary}`,
  );
  return result;
}

async function run() {
  let failureCount = 0;

  while (true) {
    try {
      await collectOnce();
      failureCount = 0;
    } catch (error) {
      failureCount += 1;
      await saveFailure(error);
      console.error(`[${new Date().toISOString()}] collection failed: ${error.message}`);
    }

    if (once) break;
    const delay = nextDelay(failureCount);
    console.log(`next check in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
