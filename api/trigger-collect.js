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

  const githubResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    },
  );

  if (!githubResponse.ok) {
    response.status(githubResponse.status).json({
      error: "GitHub workflow dispatch failed",
      details: await githubResponse.text(),
    });
    return;
  }

  response.status(202).json({
    ok: true,
    workflow: workflowId,
    ref,
    triggeredAt: new Date().toISOString(),
  });
}

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const auth = request.headers.authorization || "";
  if (auth === `Bearer ${expected}`) return true;

  const url = new URL(request.url, `https://${request.headers.host ?? "localhost"}`);
  return url.searchParams.get("secret") === expected;
}
