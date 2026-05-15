import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { config } from "./config.js";
import {
  hasSupabase,
  insertSupabaseEvents,
  insertSupabaseSnapshot,
  pruneUnchangedSupabaseSnapshots,
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
  const profileStats = normalizeProfileStats(observation.profileStats);
  const followerLists = normalizeFollowerLists(observation.followerLists, profileStats);
  const countChanges = getProfileCountChanges(previous.lastProfileStats, profileStats);
  const userListChanges = getProfileUserListChanges(previous.lastFollowerLists, followerLists);
  const snapshot = {
    ...observation,
    profileStats,
    followerLists,
    profileStatsChanged: countChanges.length > 0,
    followerListsChanged: userListChanges.length > 0,
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

  if (countChanges.length) {
    events.push({
      observedAt: snapshot.observedAt,
      type: "profile_counts_changed",
      topArtist: snapshot.artists[0] ?? null,
      artists: snapshot.artists,
      added: [],
      removed: [],
      profileStats,
      previousProfileStats: normalizeProfileStats(previous.lastProfileStats),
      countChanges,
    });
  }

  for (const change of userListChanges) {
    events.push({
      observedAt: snapshot.observedAt,
      type: `profile_${change.kind}_changed`,
      topArtist: snapshot.artists[0] ?? null,
      artists: snapshot.artists,
      added: [],
      removed: [],
      profileStats,
      previousProfileStats: normalizeProfileStats(previous.lastProfileStats),
      countChanges: [],
      followerListKind: change.kind,
      addedUsers: change.added,
      removedUsers: change.removed,
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
    lastProfileStats: profileStats,
    lastFollowerLists: followerLists,
    lastStatus: "ok",
    lastError: null,
  });

  await pruneOldUnchangedSnapshots();

  return { snapshot, events };
}

async function pruneOldUnchangedSnapshots() {
  const retentionDays = config.snapshotRetentionDays;
  if (!hasSupabase() || !Number.isFinite(retentionDays) || retentionDays <= 0) return;

  const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  await pruneUnchangedSupabaseSnapshots({ olderThan }).catch((error) => {
    console.warn(`[${new Date().toISOString()}] snapshot cleanup skipped: ${error.message}`);
  });
}

function normalizeFollowerLists(followerLists = {}, profileStats = {}) {
  return {
    followers: normalizeFollowerList(followerLists.followers, profileStats.followers),
    following: normalizeFollowerList(followerLists.following, profileStats.following),
  };
}

function normalizeFollowerList(list = {}, expectedCount = null) {
  const users = Array.isArray(list.users) ? list.users.map(normalizeProfileUser).filter(Boolean) : [];
  const loaded = Boolean(list.loaded) || users.length > 0 || expectedCount === 0;

  return {
    sourceUrl: list.sourceUrl ?? null,
    expectedCount: normalizeCount(list.expectedCount ?? expectedCount),
    loaded,
    users,
  };
}

function normalizeProfileUser(user) {
  const id = user?.id || user?.url || user?.name;
  const name = user?.name;
  if (!id || !name) return null;
  return {
    rank: Number.isFinite(user.rank) ? user.rank : null,
    id: String(user.id ?? id),
    name,
    url: user.url ?? `https://open.spotify.com/user/${id}`,
    imageUrl: user.imageUrl ?? null,
  };
}

function normalizeProfileStats(profileStats = {}) {
  return {
    followers: normalizeCount(profileStats.followers),
    following: normalizeCount(profileStats.following),
  };
}

function normalizeCount(value) {
  return Number.isFinite(value) ? value : null;
}

function getProfileCountChanges(previousStats, currentStats) {
  if (!previousStats) return [];

  const previous = normalizeProfileStats(previousStats);
  const current = normalizeProfileStats(currentStats);

  return ["followers", "following"]
    .filter((field) => previous[field] !== null && current[field] !== null && previous[field] !== current[field])
    .map((field) => ({
      field,
      previous: previous[field],
      current: current[field],
      delta: current[field] - previous[field],
    }));
}

function getProfileUserListChanges(previousLists, currentLists) {
  if (!previousLists) return [];

  return ["followers", "following"]
    .map((kind) => {
      const previous = normalizeFollowerList(previousLists[kind], currentLists[kind]?.expectedCount);
      const current = normalizeFollowerList(currentLists[kind], currentLists[kind]?.expectedCount);
      if (!previous.loaded || !current.loaded) return null;

      const previousIds = new Set(previous.users.map(profileUserKey));
      const currentIds = new Set(current.users.map(profileUserKey));
      const added = current.users.filter((user) => !previousIds.has(profileUserKey(user)));
      const removed = previous.users.filter((user) => !currentIds.has(profileUserKey(user)));
      if (!added.length && !removed.length) return null;

      return { kind, added, removed };
    })
    .filter(Boolean);
}

function profileUserKey(user) {
  return user.id || user.url || user.name;
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
