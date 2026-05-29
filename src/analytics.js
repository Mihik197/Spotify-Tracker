import { readDataset } from "./store.js";

const hourNames = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
const RECENT_WINDOW_SIZE = 5;

export async function buildDashboardData() {
  const { snapshots, events, state, metadata } = await readDataset();
  return buildAnalytics(snapshots, events, state, metadata);
}

export function buildAnalytics(snapshots, events, state = {}, metadata = {}) {
  const activityEvents = annotateRecentActivity(events.filter(isArtistActivityEvent));
  const followerLists = hydrateFollowerLists(
    state.lastFollowerLists ?? snapshots.at(-1)?.followerLists ?? {},
    metadata.profileNameSnapshots?.length ? metadata.profileNameSnapshots : snapshots,
    events,
  );
  return {
    state,
    totals: getTotals(snapshots, events, metadata),
    currentArtists: state.lastArtists ?? snapshots.at(-1)?.artists ?? [],
    profileStats: state.lastProfileStats ?? snapshots.at(-1)?.profileStats ?? {},
    followerLists,
    topArtists: getTopArtists(activityEvents, snapshots),
    hourlyActivity: getHourlyActivity(activityEvents),
    dailyActivity: getDailyActivity(activityEvents),
    availableDays: getAvailableDays(activityEvents, snapshots),
    recentEvents: events.slice(-50).reverse(),
    recentSnapshots: snapshots.slice(-100).reverse(),
    snapshots,
    events,
  };
}

function hydrateFollowerLists(followerLists = {}, snapshots = [], events = []) {
  const displayNames = getKnownProfileUserNames(snapshots, events);
  return Object.fromEntries(
    Object.entries(followerLists).map(([kind, list]) => [
      kind,
      {
        ...list,
        users: (list.users ?? []).map((user) => hydrateProfileUser(user, displayNames)),
      },
    ]),
  );
}

function getKnownProfileUserNames(snapshots = [], events = []) {
  const names = new Map();
  const remember = (user) => {
    const key = profileUserKey(user);
    if (!key || !user?.name || isProfileUserIdName(user.name, user)) return;
    names.set(key, user.name);
  };

  for (const snapshot of snapshots) {
    for (const list of Object.values(snapshot.followerLists ?? {})) {
      for (const user of list?.users ?? []) remember(user);
    }
  }
  for (const event of events) {
    for (const user of event.addedUsers ?? []) remember(user);
    for (const user of event.removedUsers ?? []) remember(user);
  }
  return names;
}

function hydrateProfileUser(user, displayNames) {
  const key = profileUserKey(user);
  if (!key || !isProfileUserIdName(user?.name, user)) return user;
  const name = displayNames.get(key);
  return name ? { ...user, name } : user;
}

function getTotals(snapshots, events, metadata = {}) {
  const changed = metadata.changeCount ?? snapshots.filter((snapshot) => snapshot.changed).length;
  const profileCountChanges = events.filter((event) => event.type === "profile_counts_changed").length;
  const first = metadata.firstObservedAt ?? snapshots[0]?.observedAt ?? null;
  const last = metadata.lastObservedAt ?? snapshots.at(-1)?.observedAt ?? null;
  return {
    snapshots: metadata.snapshotCount ?? snapshots.length,
    changes: changed,
    profileCountChanges,
    profileUserChanges: events.filter((event) => isProfileUserEvent(event)).length,
    events: events.length,
    firstObservedAt: first,
    lastObservedAt: last,
  };
}

function getTopArtists(events, snapshots) {
  const counts = new Map();

  for (const event of events) {
    for (const artist of event.artists ?? []) {
      const key = artist.id || artist.url || artist.name;
      const record = counts.get(key) ?? { ...artist, observations: 0, topRankChanges: 0 };
      record.observations += 1;
      if (event.topArtist && (event.topArtist.id || event.topArtist.url) === key) {
        record.topRankChanges += 1;
      }
      counts.set(key, record);
    }
  }

  if (!counts.size) {
    for (const snapshot of snapshots) {
      for (const artist of snapshot.artists ?? []) {
        const key = artist.id || artist.url || artist.name;
        const record = counts.get(key) ?? { ...artist, observations: 0, topRankChanges: 0 };
        record.observations += 1;
        counts.set(key, record);
      }
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.observations - a.observations || b.topRankChanges - a.topRankChanges)
    .slice(0, 20);
}

function getHourlyActivity(events) {
  const hours = hourNames.map((label, hour) => ({ hour, label, changes: 0, movement: 0, updates: 0 }));
  for (const event of events) {
    const hour = new Date(event.observedAt).getHours();
    if (Number.isInteger(hour) && hours[hour]) {
      hours[hour].changes += getArtistActivityUnits(event);
      hours[hour].movement += getRecentActivityUnitsFromEvent(event);
      if (event.type === "profile_changed") hours[hour].updates += 1;
    }
  }
  return hours;
}

function getDailyActivity(events) {
  const days = new Map();
  for (const event of events) {
    const day = event.observedAt?.slice(0, 10);
    if (!day) continue;
    const record = days.get(day) ?? { date: day, changes: 0, updates: 0 };
    record.changes += getArtistActivityUnits(event);
    record.movement = (record.movement ?? 0) + getRecentActivityUnitsFromEvent(event);
    if (event.type === "profile_changed") record.updates += 1;
    days.set(day, record);
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getAvailableDays(events, snapshots) {
  const days = new Set();
  for (const event of events) if (event.observedAt) days.add(event.observedAt.slice(0, 10));
  for (const snapshot of snapshots) if (snapshot.observedAt) days.add(snapshot.observedAt.slice(0, 10));
  return Array.from(days).sort().reverse();
}

function isArtistActivityEvent(event) {
  return event.type === "initial_observation" || event.type === "profile_changed";
}

function isProfileUserEvent(event) {
  return event.type === "profile_followers_changed" || event.type === "profile_following_changed";
}

function profileUserKey(user) {
  return user?.id || String(user?.url ?? "").match(/\/user\/([^/?#]+)/)?.[1] || user?.name || "";
}

function isProfileUserIdName(name, user) {
  const key = profileUserKey(user);
  return name === key || /^31[a-z0-9]{20,}$/i.test(String(name));
}

function getArtistActivityUnits(event) {
  if (event.type === "initial_observation") return 0;
  if (!Array.isArray(event.added)) return event.type === "profile_changed" ? 1 : 0;
  return event.added.length;
}

function annotateRecentActivity(events) {
  let previousArtists = [];
  return events.map((event) => {
    const recentActivityUnits = getRecentActivityUnits(event, previousArtists);
    if (Array.isArray(event.artists) && event.artists.length) previousArtists = event.artists;
    return { ...event, recentActivityUnits };
  });
}

function getRecentActivityUnits(event, previousArtists = []) {
  if (event.type !== "profile_changed") return 0;
  const currentTop = (event.artists ?? []).slice(0, RECENT_WINDOW_SIZE);
  if (!currentTop.length) return event.topArtist ? 1 : 0;

  const previousRank = new Map();
  previousArtists.forEach((artist, index) => previousRank.set(artistKey(artist), index));

  let units = 0;
  for (let index = 0; index < currentTop.length; index += 1) {
    const previousIndex = previousRank.get(artistKey(currentTop[index]));
    if (previousIndex === undefined || previousIndex > index) units += 1;
  }
  return units;
}

function getRecentActivityUnitsFromEvent(event) {
  return Number.isFinite(event.recentActivityUnits) ? event.recentActivityUnits : getArtistActivityUnits(event);
}

function artistKey(artist) {
  return artist?.id || artist?.url || artist?.name || "";
}
