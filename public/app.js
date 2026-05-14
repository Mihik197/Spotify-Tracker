const config = window.SPOTIFY_TRACKER_CONFIG ?? {};
let dashboard = null;
let selectedDay = "overall";
let selectedSocialList = "followers";

const formatTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  day: "numeric",
});
const formatDay = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const number = new Intl.NumberFormat();

async function loadDashboard() {
  if (config.supabaseUrl && config.supabaseAnonKey) return loadSupabaseDashboard();

  const response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
  return response.json();
}

async function loadSupabaseDashboard() {
  const [snapshots, events, stateRows] = await Promise.all([
    supabaseGet("spotify_snapshots?select=*&order=observed_at.asc&limit=5000"),
    supabaseGet("spotify_events?select=*&order=observed_at.asc&limit=5000"),
    supabaseGet("spotify_tracker_state?key=eq.collector&select=value&limit=1"),
  ]);

  return buildAnalytics(
    snapshots.map(fromSnapshotRow),
    events.map(fromEventRow),
    stateRows[0]?.value ?? {},
  );
}

async function supabaseGet(path) {
  const base = config.supabaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
  return response.json();
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

function buildAnalytics(snapshots, events, state = {}) {
  const activityEvents = events.filter(isArtistActivityEvent);
  const days = getAvailableDays(activityEvents, snapshots);
  return {
    state,
    totals: {
      snapshots: snapshots.length,
      changes: snapshots.filter((snapshot) => snapshot.changed).length,
      profileCountChanges: events.filter((event) => event.type === "profile_counts_changed").length,
      profileUserChanges: events.filter((event) => isProfileUserEvent(event)).length,
      events: events.length,
      activeDays: days.length,
      firstObservedAt: snapshots[0]?.observedAt ?? null,
      lastObservedAt: snapshots.at(-1)?.observedAt ?? null,
    },
    currentArtists: state.lastArtists ?? snapshots.at(-1)?.artists ?? [],
    profileStats: state.lastProfileStats ?? snapshots.at(-1)?.profileStats ?? {},
    followerLists: state.lastFollowerLists ?? snapshots.at(-1)?.followerLists ?? {},
    topArtists: getTopArtists(activityEvents, snapshots),
    hourlyActivity: getHourlyActivity(activityEvents),
    dailyActivity: getDailyActivity(activityEvents),
    availableDays: days,
    recentEvents: events.slice(-50).reverse(),
    recentSnapshots: snapshots.slice(-100).reverse(),
    snapshots,
    events,
  };
}

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  byId(id).textContent = value;
}

function timeAgo(iso) {
  if (!iso) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatTime.format(new Date(iso));
}

function renderStatus(state) {
  const status = byId("status");
  status.className = `status ${state.lastStatus === "error" ? "error" : state.lastStatus === "ok" ? "ok" : ""}`;
  status.querySelector("span:last-child").textContent =
    state.lastStatus === "error" ? state.lastError || "Collector error" : `Checked ${timeAgo(state.lastCheckedAt)}`;
}

function renderMetrics(data) {
  setText("snapshotCount", number.format(data.totals.snapshots));
  setText("changeCount", number.format(data.totals.changes));
  setText("followerCount", formatProfileCount(data.profileStats.followers));
  setText("followingCount", formatProfileCount(data.profileStats.following));
  setText("activeDays", number.format(data.totals.activeDays ?? data.availableDays.length));
  setText("lastCheck", timeAgo(data.totals.lastObservedAt));
  setText("currentTopArtist", data.currentArtists[0]?.name ?? "Unknown");
  setText("snapshotMeta", data.totals.firstObservedAt ? `since ${formatDayLabel(toLocalDateKey(data.totals.firstObservedAt))}` : "observations");
  setText(
    "changeMeta",
    `${number.format(data.totals.profileCountChanges + data.totals.profileUserChanges)} social events`,
  );
  setText("followerMeta", profileListMeta(data.followerLists.followers));
  setText("followingMeta", profileListMeta(data.followerLists.following));
  setText("activeDaysMeta", data.availableDays[0] ? `latest ${formatDayLabel(data.availableDays[0])}` : "recorded");
  setText("lastCheckMeta", data.state.lastStatus === "error" ? "needs attention" : "collector healthy");
  setText("currentTopMeta", data.currentArtists[1] ? `ahead of ${data.currentArtists[1].name}` : "latest profile rank");
  setText(
    "pageSummary",
    data.totals.lastObservedAt
      ? `${number.format(data.currentArtists.length)} visible artists, updated ${timeAgo(data.totals.lastObservedAt)}`
      : "Waiting for collector data",
  );
}

function renderControls(data) {
  const select = byId("daySelect");
  const previous = selectedDay;
  select.innerHTML = [
    `<option value="overall">Overall history</option>`,
    ...data.availableDays.map((day) => `<option value="${day}">${escapeHtml(formatDayLabel(day))}</option>`),
  ].join("");
  selectedDay = data.availableDays.includes(previous) || previous === "overall" ? previous : "overall";
  select.value = selectedDay;
  byId("overallView").classList.toggle("active", selectedDay === "overall");
}

function renderCurrentArtists(artists) {
  setText("artistCount", `${artists.length} visible`);
  byId("currentArtists").innerHTML = artists.length
    ? artists
        .slice(0, 30)
        .map(
          (artist, index) => `
            <div class="artist-row">
              ${
                artist.imageUrl
                  ? `<img src="${escapeHtml(artist.imageUrl)}" alt="" loading="lazy">`
                  : `<div class="artist-fallback">${escapeHtml(initials(artist.name))}</div>`
              }
              <div class="artist-meta">
                <a href="${escapeHtml(artist.url)}" target="_blank" rel="noreferrer">${escapeHtml(artist.name)}</a>
                <span>Rank ${index + 1}</span>
              </div>
              <span class="rank">#${index + 1}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="empty">Run the collector once to create the first observation.</p>`;
}

function renderSocialList(followerLists = {}) {
  const list = followerLists[selectedSocialList] ?? {};
  const users = list.users ?? [];
  const label = selectedSocialList === "following" ? "Following" : "Followers";
  const itemLabel = selectedSocialList === "following" ? "Following" : "Follower";

  byId("followersView").classList.toggle("active", selectedSocialList === "followers");
  byId("followingView").classList.toggle("active", selectedSocialList === "following");
  setText(
    "socialListSummary",
    list.loaded
      ? `${number.format(users.length)} visible ${selectedSocialList}`
      : `${label} is count-only right now`,
  );

  byId("socialList").innerHTML = list.loaded
    ? users.length
      ? users
          .slice(0, 60)
          .map(
            (user, index) => `
              <div class="artist-row social-row">
                ${
                  user.imageUrl
                    ? `<img src="${escapeHtml(user.imageUrl)}" alt="" loading="lazy">`
                    : `<div class="artist-fallback">${escapeHtml(initials(user.name))}</div>`
                }
                <div class="artist-meta">
                  <a href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">${escapeHtml(user.name)}</a>
                  <span>${itemLabel} ${index + 1}</span>
                </div>
                <span class="rank">#${index + 1}</span>
              </div>
            `,
          )
          .join("")
      : `<p class="empty">Spotify rendered this list, but no public users were visible.</p>`
    : `<p class="empty">Spotify exposed the ${selectedSocialList} count, but did not render the public user list during the latest check.</p>`;
}

function renderHourChart(events) {
  const hours = getHourlyActivity(events);
  const max = Math.max(1, ...hours.map((item) => item.changes));
  const peak = hours.reduce((winner, item) => (item.changes > winner.changes ? item : winner), hours[0]);
  const scope = selectedDay === "overall" ? "overall" : formatDayLabel(selectedDay);
  setText("hourPeak", peak?.changes ? `${peak.label} peak, ${scope}` : `No changes, ${scope}`);
  renderScopeSummary(hours, events);

  byId("hourChart").innerHTML = hours
    .map((item) => {
      const height = Math.round((item.changes / max) * 220);
      const label = item.hour % 3 === 0 ? String(item.hour).padStart(2, "0") : "";
      return `
        <div class="hour-column" title="${item.label}: ${item.changes} changes">
          <div class="hour-value">${item.changes || ""}</div>
          <div class="hour-bar" style="height:${Math.max(2, height)}px; opacity:${item.changes ? 1 : 0.22}"></div>
          <span class="hour-label">${label}</span>
        </div>
      `;
    })
    .join("");
}

function renderDayStrip(data) {
  const max = Math.max(1, ...data.dailyActivity.map((item) => item.changes));
  setText(
    "historySummary",
    data.dailyActivity.length
      ? `${data.dailyActivity.length} recorded days`
      : "No day history yet",
  );

  byId("dayStrip").innerHTML = data.dailyActivity.length
    ? data.dailyActivity
        .slice(-45)
        .map((item) => {
          const height = Math.max(6, Math.round((item.changes / max) * 72));
          const active = selectedDay === item.date ? "active" : "";
          return `
            <button class="day-pill ${active}" type="button" data-day="${item.date}" title="${formatDayLabel(
              item.date,
            )}: ${item.changes} changes">
              <span class="day-stick" style="height:${height}px"></span>
              <strong>${item.changes}</strong>
              <span>${escapeHtml(shortDayLabel(item.date))}</span>
            </button>
          `;
        })
        .join("")
    : `<p class="empty">Day history appears after scheduled collection starts.</p>`;
}

function renderTopArtists(events, snapshots) {
  const artists = getTopArtists(events, snapshots);
  const max = Math.max(1, ...artists.map((artist) => artist.observations));
  setText("artistScope", selectedDay === "overall" ? "Overall ranking" : `Ranking for ${formatDayLabel(selectedDay)}`);
  byId("topArtists").innerHTML = artists.length
    ? artists
        .slice(0, 18)
        .map(
          (artist, index) => `
            <div class="artist-bar">
              <span class="artist-index">${index + 1}</span>
              <a class="artist-name" href="${escapeHtml(artist.url)}" target="_blank" rel="noreferrer">${escapeHtml(artist.name)}</a>
              <div class="bar-track">
                <div class="bar-fill" style="width:${Math.max(4, (artist.observations / max) * 100)}%"></div>
              </div>
              <span class="bar-count">${artist.observations}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="empty">Artist rankings appear after the first observation.</p>`;
}

function renderTimeline(events) {
  setText("eventCount", `${events.length} events`);
  byId("timeline").innerHTML = events.length
    ? events
        .slice()
        .reverse()
        .slice(0, 60)
        .map((event) => {
          if (event.type === "profile_counts_changed") return renderCountChangeEvent(event);
          if (isProfileUserEvent(event)) return renderProfileUserEvent(event);
          const artist = event.topArtist?.name ?? "Profile list";
          const added = event.added?.map((item) => item.name).slice(0, 3).join(", ");
          const removed = event.removed?.map((item) => item.name).slice(0, 2).join(", ");
          return `
            <div class="event">
              <div class="event-marker"></div>
              <strong>${escapeHtml(artist)}</strong>
              <span>${formatTime.format(new Date(event.observedAt))}</span>
              ${added ? `<span>Added: ${escapeHtml(added)}</span>` : ""}
              ${removed ? `<span>Removed: ${escapeHtml(removed)}</span>` : ""}
            </div>
          `;
        })
        .join("")
    : `<p class="empty">No profile changes in this view.</p>`;
}

function renderView() {
  if (!dashboard) return;
  const scopedEvents =
    selectedDay === "overall"
      ? dashboard.events
      : dashboard.events.filter((event) => toLocalDateKey(event.observedAt) === selectedDay);
  const scopedActivityEvents = scopedEvents.filter(isArtistActivityEvent);
  const scopedSnapshots =
    selectedDay === "overall"
      ? dashboard.snapshots
      : dashboard.snapshots.filter((snapshot) => toLocalDateKey(snapshot.observedAt) === selectedDay);

  renderMetrics(dashboard);
  renderControls(dashboard);
  renderHourChart(scopedActivityEvents);
  renderDayStrip(dashboard);
  renderTopArtists(scopedActivityEvents, scopedSnapshots);
  renderTimeline(scopedEvents);
  renderCurrentArtists(dashboard.currentArtists);
  renderSocialList(dashboard.followerLists);
}

function renderScopeSummary(hours, events) {
  const activeHours = hours.filter((hour) => hour.changes > 0);
  const total = events.length;
  if (!activeHours.length) {
    setText("scopeSummary", "No changes recorded in this view yet.");
    return;
  }

  const busiest = activeHours
    .slice()
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 3)
    .map((hour) => hour.label)
    .join(", ");
  setText(
    "scopeSummary",
    `${number.format(total)} public-list changes across ${activeHours.length} active hour${
      activeHours.length === 1 ? "" : "s"
    }. Busiest window${activeHours.length === 1 ? "" : "s"}: ${busiest}.`,
  );
}

function getTopArtists(events, snapshots) {
  const counts = new Map();
  for (const event of events) {
    for (const artist of event.artists ?? []) incrementArtist(counts, artist, event.topArtist);
  }
  if (!counts.size) {
    for (const snapshot of snapshots) {
      for (const artist of snapshot.artists ?? []) incrementArtist(counts, artist);
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.observations - a.observations || b.topRankChanges - a.topRankChanges,
  );
}

function incrementArtist(counts, artist, topArtist = null) {
  const key = artist.id || artist.url || artist.name;
  const record = counts.get(key) ?? { ...artist, observations: 0, topRankChanges: 0 };
  record.observations += 1;
  if (topArtist && (topArtist.id || topArtist.url) === key) record.topRankChanges += 1;
  counts.set(key, record);
}

function renderCountChangeEvent(event) {
  const summary = event.countChanges?.map(formatCountChange).join(", ") || "Profile count changed";
  return `
    <div class="event count-change">
      <div class="event-marker"></div>
      <strong>Follower stats changed</strong>
      <span>${formatTime.format(new Date(event.observedAt))}</span>
      <span>${escapeHtml(summary)}</span>
    </div>
  `;
}

function renderProfileUserEvent(event) {
  const kindLabel = event.followerListKind === "following" ? "Following" : "Followers";
  const added = formatUserNames(event.addedUsers, 3);
  const removed = formatUserNames(event.removedUsers, 3);
  return `
    <div class="event social-change">
      <div class="event-marker"></div>
      <strong>${kindLabel} changed</strong>
      <span>${formatTime.format(new Date(event.observedAt))}</span>
      ${added ? `<span>Added: ${escapeHtml(added)}</span>` : ""}
      ${removed ? `<span>Removed: ${escapeHtml(removed)}</span>` : ""}
    </div>
  `;
}

function formatCountChange(change) {
  const label = change.field === "following" ? "Following" : "Followers";
  const sign = change.delta > 0 ? "+" : "";
  return `${label}: ${number.format(change.previous)} -> ${number.format(change.current)} (${sign}${number.format(change.delta)})`;
}

function formatProfileCount(value) {
  return Number.isFinite(value) ? number.format(value) : "-";
}

function isArtistActivityEvent(event) {
  return event.type === "initial_observation" || event.type === "profile_changed";
}

function isProfileUserEvent(event) {
  return event.type === "profile_followers_changed" || event.type === "profile_following_changed";
}

function profileListMeta(list) {
  if (!list) return "public profile";
  if (list.loaded) return `${number.format(list.users?.length ?? 0)} visible users`;
  return "count only";
}

function formatUserNames(users = [], limit = 3) {
  const names = users
    .slice(0, limit)
    .map((user) => user.name)
    .filter(Boolean)
    .join(", ");
  const extra = users.length > limit ? ` +${number.format(users.length - limit)} more` : "";
  return `${names}${extra}`;
}

function getHourlyActivity(events) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    changes: 0,
  }));
  for (const event of events) {
    const hour = new Date(event.observedAt).getHours();
    if (Number.isInteger(hour) && hours[hour]) hours[hour].changes += 1;
  }
  return hours;
}

function getDailyActivity(events) {
  const days = new Map();
  for (const event of events) {
    const day = toLocalDateKey(event.observedAt);
    if (!day) continue;
    const record = days.get(day) ?? { date: day, changes: 0 };
    record.changes += 1;
    days.set(day, record);
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getAvailableDays(events, snapshots) {
  const days = new Set();
  for (const event of events) days.add(toLocalDateKey(event.observedAt));
  for (const snapshot of snapshots) days.add(toLocalDateKey(snapshot.observedAt));
  return Array.from(days).filter(Boolean).sort().reverse();
}

function toLocalDateKey(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(day) {
  return formatDay.format(new Date(`${day}T12:00:00`));
}

function shortDayLabel(day) {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function render() {
  try {
    dashboard = await loadDashboard();
    renderStatus(dashboard.state);
    renderView();
  } catch (error) {
    const status = byId("status");
    status.className = "status error";
    status.querySelector("span:last-child").textContent = error.message;
  }
}

byId("overallView").addEventListener("click", () => {
  selectedDay = "overall";
  renderView();
});

byId("daySelect").addEventListener("change", (event) => {
  selectedDay = event.target.value;
  renderView();
});

byId("dayStrip").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]");
  if (!button) return;
  selectedDay = button.dataset.day;
  renderView();
});

byId("latestDayView").addEventListener("click", () => {
  selectedDay = dashboard?.availableDays?.[0] ?? "overall";
  renderView();
});

byId("followersView").addEventListener("click", () => {
  selectedSocialList = "followers";
  renderView();
});

byId("followingView").addEventListener("click", () => {
  selectedSocialList = "following";
  renderView();
});

render();
setInterval(render, 30_000);
