const stateKey = "collector";

export function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && getSupabaseKey());
}

export function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
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
        top_artist: event.topArtist,
        artists: event.artists,
        added: event.added,
        removed: event.removed,
      })),
    ),
  });
}

export async function readSupabaseDataset() {
  const [snapshots, events, state] = await Promise.all([
    supabaseRequest("spotify_snapshots?select=*&order=observed_at.asc&limit=5000"),
    supabaseRequest("spotify_events?select=*&order=observed_at.asc&limit=5000"),
    readSupabaseState(),
  ]);

  return {
    snapshots: snapshots.map(fromSnapshotRow),
    events: events.map(fromEventRow),
    state,
  };
}

function fromSnapshotRow(row) {
  return {
    observedAt: row.observed_at,
    sourceUrl: row.source_url,
    hash: row.hash,
    changed: row.changed,
    previousHash: row.previous_hash,
    artists: row.artists ?? [],
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
  };
}
