import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { config } from "./config.js";
import {
  hasSupabase,
  insertSupabaseEvents,
  insertSupabaseSnapshot,
  readSupabaseDataset,
  readSupabaseState,
  writeSupabaseState,
} from "./supabase.js";

const dataDir = fileURLToPath(config.dataDir);
const snapshotsPath = new URL("snapshots.jsonl", config.dataDir);
const eventsPath = new URL("events.jsonl", config.dataDir);
const statePath = new URL("state.json", config.dataDir);

export async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
}

export async function readJsonLines(url) {
  if (!existsSync(url)) return [];
  const text = await readFile(url, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readState() {
  if (hasSupabase()) return readSupabaseState();
  if (!existsSync(statePath)) return {};
  return JSON.parse(await readFile(statePath, "utf8"));
}

export async function writeState(state) {
  if (hasSupabase()) {
    await writeSupabaseState(state);
    return;
  }
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export async function readDataset() {
  if (hasSupabase()) return readSupabaseDataset();
  return {
    snapshots: await readJsonLines(snapshotsPath),
    events: await readJsonLines(eventsPath),
    state: await readState(),
  };
}

export function artistHash(artists) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(artists.map((artist) => artist.id || artist.url || artist.name)))
    .digest("hex");
}

export async function saveObservation(observation) {
  await ensureStore();
  const previous = await readState();
  const hash = artistHash(observation.artists);
  const snapshot = {
    ...observation,
    hash,
    changed: previous.lastHash !== hash,
    previousHash: previous.lastHash ?? null,
  };

  if (hasSupabase()) {
    await insertSupabaseSnapshot(snapshot);
  } else {
    await appendFile(snapshotsPath, `${JSON.stringify(snapshot)}\n`);
  }

  const events = [];
  if (snapshot.changed) {
    const previousArtists = previous.lastArtists ?? [];
    const previousIds = new Set(previousArtists.map((artist) => artist.id || artist.url));
    const currentIds = new Set(snapshot.artists.map((artist) => artist.id || artist.url));
    const added = snapshot.artists.filter((artist) => !previousIds.has(artist.id || artist.url));
    const removed = previousArtists.filter((artist) => !currentIds.has(artist.id || artist.url));

    events.push({
      observedAt: snapshot.observedAt,
      type: previous.lastHash ? "profile_changed" : "initial_observation",
      topArtist: snapshot.artists[0] ?? null,
      artists: snapshot.artists,
      added,
      removed,
    });
  }

  if (hasSupabase()) {
    await insertSupabaseEvents(events);
  } else {
    for (const event of events) {
      await appendFile(eventsPath, `${JSON.stringify(event)}\n`);
    }
  }

  await writeState({
    lastCheckedAt: snapshot.observedAt,
    lastHash: hash,
    lastArtists: snapshot.artists,
    lastStatus: "ok",
    lastError: null,
  });

  return { snapshot, events };
}

export async function saveFailure(error) {
  await ensureStore();
  const previous = await readState();
  await writeState({
    ...previous,
    lastCheckedAt: new Date().toISOString(),
    lastStatus: "error",
    lastError: error.message,
  });
}

export const paths = {
  snapshotsPath,
  eventsPath,
  statePath,
};
