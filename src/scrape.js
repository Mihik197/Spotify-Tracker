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
