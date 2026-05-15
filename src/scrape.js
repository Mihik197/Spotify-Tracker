import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { config } from "./config.js";

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

  const isWindowsBrowser = /\.exe$/i.test(browserPath);
  const profileDir = await createBrowserProfileDir(isWindowsBrowser);

  return dumpDom(
    browserPath,
    [
      "--headless=new",
      ...browserRuntimeFlags(isWindowsBrowser),
      "--disable-gpu",
      "--disable-extensions",
      "--disable-features=PushMessaging,Notifications",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profileDir}`,
      "--virtual-time-budget=25000",
      "--dump-dom",
      url,
    ],
  );
}

function dumpDom(browserPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      browserPath,
      args,
      {
        timeout: config.poll.navigationTimeoutMs + 20_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (looksLikeHtml(stdout)) {
          resolve(stdout);
          return;
        }

        if (error) {
          error.message = stderr ? `${error.message}\n${stderr}` : error.message;
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });
}

function looksLikeHtml(value) {
  return /<html[\s>]/i.test(value) || /<!doctype html/i.test(value);
}

function browserRuntimeFlags(isWindowsBrowser) {
  if (isWindowsBrowser) return [];
  return ["--no-sandbox", "--disable-dev-shm-usage"];
}

async function createBrowserProfileDir(isWindowsBrowser) {
  const baseDir = isWindowsBrowser ? findWindowsTempDir() : tmpdir();
  const profileDir = join(baseDir, "spotify-tracker-browser-profile");
  await mkdir(profileDir, { recursive: true });
  return isWindowsBrowser ? wslPathToWindowsPath(profileDir) : profileDir;
}

function findWindowsTempDir() {
  const cwdUser = process.cwd().match(/^\/mnt\/c\/Users\/([^/]+)/)?.[1];
  const candidates = [
    process.env.SPOTIFY_TRACKER_WINDOWS_TEMP,
    cwdUser ? `/mnt/c/Users/${cwdUser}/AppData/Local/Temp` : null,
    process.env.USER ? `/mnt/c/Users/${process.env.USER}/AppData/Local/Temp` : null,
    "/mnt/c/Windows/Temp",
    tmpdir(),
  ].filter(Boolean);

  return candidates.find((path) => existsSync(path)) ?? tmpdir();
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
