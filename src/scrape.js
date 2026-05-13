import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export async function scrapeRecentlyPlayedArtists({ url = config.recentlyPlayedArtistsUrl } = {}) {
  const html = await renderPublicPage(url);
  const artists = extractArtists(html);

  if (!artists.length) {
    throw new Error("No artist links found in rendered public profile page.");
  }

  return {
    observedAt: new Date().toISOString(),
    sourceUrl: url,
    artists,
  };
}

export async function scrapeProfileStats({ url = config.profileUrl } = {}) {
  const html = await renderPublicPage(url);
  const profileStats = extractProfileStats(html);

  return {
    sourceUrl: url,
    profileStats,
  };
}

export async function scrapeSpotifyProfile() {
  const recent = await scrapeRecentlyPlayedArtists();
  const profile = await scrapeProfileStats();
  const followerLists = {
    followers: await scrapeProfileUsers("followers", profile.profileStats.followers),
    following: await scrapeProfileUsers("following", profile.profileStats.following),
  };

  return {
    ...recent,
    profileUrl: profile.sourceUrl,
    profileStats: profile.profileStats,
    followerLists,
  };
}

export async function scrapeProfileUsers(kind, expectedCount = null) {
  const url = `${config.profileUrl.replace(/\/$/, "")}/${kind}`;
  const html = await renderPublicPage(url);
  const users = extractProfileUsers(html, kind);
  const loaded = users.length > 0 || expectedCount === 0;

  return {
    sourceUrl: url,
    expectedCount,
    loaded,
    users,
  };
}

async function renderPublicPage(url) {
  const browserPath = findLocalBrowser();
  if (!browserPath) {
    throw new Error("No local Chrome or Edge executable found for public page rendering.");
  }

  const profileDir = wslPathToWindowsPath(
    `/mnt/c/Users/Mihik/AppData/Local/Temp/spotify-tracker-dump-${process.pid}-${Date.now()}`,
  );

  try {
    const { stdout } = await execFileAsync(
      browserPath,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profileDir}`,
        "--virtual-time-budget=15000",
        "--dump-dom",
        url,
      ],
      {
        timeout: config.poll.navigationTimeoutMs + 20_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return stdout;
  } finally {
    await rm(windowsPathToWslPath(profileDir), { recursive: true, force: true }).catch(() => {});
  }
}

function extractArtists(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const artists = [];

  $('a[href*="/artist/"]').each((_, element) => {
    const link = $(element);
    const href = link.attr("href") ?? "";
    const id = href.match(/\/artist\/([A-Za-z0-9]+)/)?.[1];
    if (!id || seen.has(id)) return;

    const title = link.find("[title]").first().attr("title")?.trim();
    const text = link
      .text()
      .replace(/\s*Artist\s*$/i, "")
      .trim();
    const name = title || text;
    if (!name) return;

    const imageUrl =
      link.find("img").first().attr("src") ||
      link.closest("div").find("img").first().attr("src") ||
      link.parent().find("img").first().attr("src") ||
      null;

    seen.add(id);
    artists.push({
      rank: artists.length + 1,
      id,
      name,
      url: `https://open.spotify.com/artist/${id}`,
      imageUrl,
    });
  });

  return artists;
}

function extractProfileStats(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return {
    followers: parseCountBeforeLabel(text, "followers?"),
    following: parseCountBeforeLabel(text, "following"),
  };
}

function extractProfileUsers(html, kind) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const users = [];

  $('a[href*="/user/"]').each((_, element) => {
    const link = $(element);
    const href = link.attr("href") ?? "";
    if (href.includes(`/${kind}`) || href.includes("/followers") || href.includes("/following")) return;

    const id = href.match(/\/user\/([^/?#]+)/)?.[1];
    if (!id || seen.has(id) || id === getProfileUserId(config.profileUrl)) return;

    const title = link.find("[title]").first().attr("title")?.trim() || link.attr("title")?.trim();
    const text = link.text().replace(/\s+/g, " ").trim();
    const name = title || text;
    if (!name) return;

    const imageUrl =
      link.find("img").first().attr("src") ||
      link.closest("div").find("img").first().attr("src") ||
      link.parent().find("img").first().attr("src") ||
      null;

    seen.add(id);
    users.push({
      rank: users.length + 1,
      id,
      name,
      url: `https://open.spotify.com/user/${id}`,
      imageUrl,
    });
  });

  return users;
}

function getProfileUserId(url) {
  return String(url).match(/\/user\/([^/?#]+)/)?.[1] ?? null;
}

function parseCountBeforeLabel(text, labelPattern) {
  const pattern = new RegExp(`([\\d,.]+\\s*[KMB]?)\\s+${labelPattern}\\b`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  return parseCompactNumber(match[1]);
}

function parseCompactNumber(value) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  const match = normalized.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const multiplier = multipliers[match[2]?.toUpperCase()] ?? 1;
  return Math.round(amount * multiplier);
}

function findLocalBrowser() {
  if (process.env.SPOTIFY_TRACKER_BROWSER) return process.env.SPOTIFY_TRACKER_BROWSER;

  const candidates = [
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  return candidates.find((path) => existsSync(path));
}

function wslPathToWindowsPath(path) {
  if (!path.startsWith("/mnt/")) return path;
  return path.replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`).replaceAll("/", "\\");
}

function windowsPathToWslPath(path) {
  if (!/^[A-Z]:\\/i.test(path)) return path;
  return path.replace(/^([A-Z]):\\/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/");
}
