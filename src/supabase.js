const stateKey = "collector";

export function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && getSupabaseKey());
}

export function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
}

export function hasSupabaseServiceRole() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = getSupabaseKey();
  if (!url || !key) throw new Error("SUPABASE_URL and a Supabase key are required.");

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${details}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function readSupabaseState() {
  const rows = await supabaseRequest(
    `spotify_tracker_state?key=eq.${encodeURIComponent(stateKey)}&select=value&limit=1`,
  );
  return rows?.[0]?.value ?? {};
}

export async function writeSupabaseState(state) {
  await supabaseRequest("spotify_tracker_state", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key: stateKey, value: state }]),
  });
}

export async function insertSupabaseSnapshot(snapshot) {
  await supabaseRequest("spotify_snapshots", {
    method: "POST",
    body: JSON.stringify([
      {
        observed_at: snapshot.observedAt,
        source_url: snapshot.sourceUrl,
        hash: snapshot.hash,
        changed: snapshot.changed,
        previous_hash: snapshot.previousHash,
        artists: snapshot.artists,
        profile_stats: snapshot.profileStats,
        profile_stats_changed: snapshot.profileStatsChanged,
        follower_lists: snapshot.followerLists,
        follower_lists_changed: snapshot.followerListsChanged,
      },
    ]),
  });
}

export async function insertSupabaseEvents(events) {
  if (!events.length) return;
  await supabaseRequest("spotify_events", {
    method: "POST",
    body: JSON.stringify(
      events.map((event) => ({
        observed_at: event.observedAt,
        type: event.type,
        top_artist: event.topArtist ?? null,
        artists: event.artists ?? [],
        added: event.added ?? [],
        removed: event.removed ?? [],
        profile_stats: event.profileStats ?? null,
        previous_profile_stats: event.previousProfileStats ?? null,
        count_changes: event.countChanges ?? [],
        follower_list_kind: event.followerListKind ?? null,
        added_users: event.addedUsers ?? [],
        removed_users: event.removedUsers ?? [],
      })),
    ),
  });
}

export async function pruneUnchangedSupabaseSnapshots({ olderThan }) {
  if (!hasSupabaseServiceRole()) return;
  await supabaseRequest(
    `spotify_snapshots?changed=eq.false&observed_at=lt.${encodeURIComponent(olderThan)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );
}

export async function readSupabaseDataset() {
  const [snapshotsDesc, events, state, snapshotCount, changeCount, firstSnapshot] = await Promise.all([
    supabaseRequest("spotify_snapshots?select=observed_at,changed&order=observed_at.desc&limit=5000"),
    readSupabaseRows(
      "spotify_events?select=observed_at,type,top_artist,artists,added,removed,count_changes,follower_list_kind,added_users,removed_users&order=observed_at.asc",
    ),
    readSupabaseState(),
    readSupabaseCount("spotify_snapshots"),
    readSupabaseCount("spotify_snapshots?changed=eq.true"),
    supabaseRequest("spotify_snapshots?select=observed_at&order=observed_at.asc&limit=1"),
  ]);
  const profileNameSnapshots = needsProfileNameHistory(state.lastFollowerLists)
    ? await supabaseRequest("spotify_snapshots?select=follower_lists&order=observed_at.desc&limit=20")
    : [];

  return {
    snapshots: snapshotsDesc.map(fromSnapshotRow).reverse(),
    events: events.map(fromEventRow),
    state,
    metadata: {
      snapshotCount,
      changeCount,
      firstObservedAt: firstSnapshot[0]?.observed_at ?? null,
      lastObservedAt: state.lastCheckedAt ?? snapshotsDesc[0]?.observed_at ?? null,
      profileNameSnapshots: profileNameSnapshots.map(fromSnapshotRow),
    },
  };
}

async function readSupabaseRows(path, batchSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += batchSize) {
    const page = await supabaseRequest(addQueryParams(path, { limit: batchSize, offset }));
    rows.push(...page);
    if (page.length < batchSize) return rows;
  }
}

async function readSupabaseCount(path) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = getSupabaseKey();
  if (!url || !key) throw new Error("SUPABASE_URL and a Supabase key are required.");

  const response = await fetch(`${url}/rest/v1/${addQueryParams(path, { select: "id", limit: 1 })}`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });

  if (!response.ok) return null;
  const range = response.headers.get("content-range") ?? "";
  const count = Number(range.split("/").at(-1));
  return Number.isFinite(count) ? count : null;
}

function addQueryParams(path, params) {
  const query = new URLSearchParams(params);
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

function fromSnapshotRow(row) {
  return {
    observedAt: row.observed_at,
    sourceUrl: row.source_url,
    hash: row.hash,
    changed: row.changed,
    previousHash: row.previous_hash,
    artists: row.artists ?? [],
    profileStats: row.profile_stats ?? {},
    profileStatsChanged: row.profile_stats_changed ?? false,
    followerLists: row.follower_lists ?? {},
    followerListsChanged: row.follower_lists_changed ?? false,
  };
}

function fromEventRow(row) {
  return {
    observedAt: row.observed_at,
    type: row.type,
    topArtist: row.top_artist,
    artists: row.artists ?? [],
    added: row.added ?? [],
    removed: row.removed ?? [],
    profileStats: row.profile_stats ?? null,
    previousProfileStats: row.previous_profile_stats ?? null,
    countChanges: row.count_changes ?? [],
    followerListKind: row.follower_list_kind ?? null,
    addedUsers: row.added_users ?? [],
    removedUsers: row.removed_users ?? [],
  };
}

function needsProfileNameHistory(followerLists = {}) {
  return Object.values(followerLists).some((list) =>
    (list?.users ?? []).some((user) => isProfileUserIdName(user?.name, user)),
  );
}

function profileUserKey(user) {
  return user?.id || String(user?.url ?? "").match(/\/user\/([^/?#]+)/)?.[1] || user?.name || "";
}

function isProfileUserIdName(name, user) {
  const key = profileUserKey(user);
  return name === key || /^31[a-z0-9]{20,}$/i.test(String(name));
}
