export default async function handler(request, response) {
  if (!isAuthorized(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const workflowId = process.env.GITHUB_WORKFLOW_ID || "collect.yml";
  const ref = process.env.GITHUB_WORKFLOW_REF || "main";

  if (!owner || !repo || !token) {
    response.status(500).json({
      error: "Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_DISPATCH_TOKEN",
    });
    return;
  }

  const dispatch = await dispatchWorkflow({ owner, repo, token, workflowId, ref });

  if (!dispatch.ok) {
    response.status(dispatch.status).json({
      error: "GitHub workflow dispatch failed",
      details: dispatch.details,
      attempts: dispatch.attempts,
    });
    return;
  }

  response.status(202).json({
    ok: true,
    workflow: workflowId,
    ref,
    attempts: dispatch.attempts,
    triggeredAt: new Date().toISOString(),
  });
}

async function dispatchWorkflow({ owner, repo, token, workflowId, ref }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
  const options = {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref }),
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const githubResponse = await fetch(url, options);
      if (githubResponse.ok) return { ok: true, attempts: attempt };

      const details = await githubResponse.text();
      if (!shouldRetry(githubResponse.status) || attempt === 3) {
        return {
          ok: false,
          status: githubResponse.status,
          details,
          attempts: attempt,
        };
      }
      lastError = details;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 3) {
        return {
          ok: false,
          status: 502,
          details: lastError,
          attempts: attempt,
        };
      }
    }

    await sleep(500 * attempt);
  }

  return {
    ok: false,
    status: 502,
    details: lastError ?? "Unknown dispatch failure",
    attempts: 3,
  };
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const auth = request.headers.authorization || "";
  if (auth === `Bearer ${expected}`) return true;

  const url = new URL(request.url, `https://${request.headers.host ?? "localhost"}`);
  return url.searchParams.get("secret") === expected;
}
