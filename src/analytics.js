import { readDataset } from "./store.js";

const hourNames = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);

export async function buildDashboardData() {
  const { snapshots, events, state } = await readDataset();
  return buildAnalytics(snapshots, events, state);
}

export function buildAnalytics(snapshots, events, state = {}) {
  return {
    state,
    totals: getTotals(snapshots, events),
    currentArtists: state.lastArtists ?? [],
    topArtists: getTopArtists(events, snapshots),
    hourlyActivity: getHourlyActivity(events),
    dailyActivity: getDailyActivity(events),
    availableDays: getAvailableDays(events, snapshots),
    recentEvents: events.slice(-50).reverse(),
    recentSnapshots: snapshots.slice(-100).reverse(),
    snapshots,
    events,
  };
}

function getTotals(snapshots, events) {
  const changed = snapshots.filter((snapshot) => snapshot.changed).length;
  const first = snapshots[0]?.observedAt ?? null;
  const last = snapshots.at(-1)?.observedAt ?? null;
  return {
    snapshots: snapshots.length,
    changes: changed,
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
  const hours = hourNames.map((label, hour) => ({ hour, label, changes: 0 }));
  for (const event of events) {
    const hour = new Date(event.observedAt).getHours();
    if (Number.isInteger(hour) && hours[hour]) hours[hour].changes += 1;
  }
  return hours;
}

function getDailyActivity(events) {
  const days = new Map();
  for (const event of events) {
    const day = event.observedAt?.slice(0, 10);
    if (!day) continue;
    const record = days.get(day) ?? { date: day, changes: 0 };
    record.changes += 1;
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
