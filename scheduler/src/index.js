// GitHub drops most scheduled runs for this repo, so Cloudflare cron triggers
// dispatch the workflows instead. GITHUB_TOKEN is a Worker secret: a
// fine-grained token limited to this repository with Actions read/write.

const REPO = "conficked/stumblr";
export const DISCOVERY_CRON = "17 * * * *";
export const PUBLISH_CRON = "37 1,17,21 * * *";

async function dispatch(env, workflow, inputs) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "stumblr-scheduler",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  // A thrown error marks the invocation failed in the Cloudflare dashboard.
  if (response.status !== 204) throw new Error(`${workflow} dispatch failed: ${response.status} ${await response.text()}`);
}

const scheduler = {
  async scheduled(controller, env) {
    if (controller.cron === DISCOVERY_CRON) {
      // Recheck live entries every sixth hour, matching the GitHub schedule.
      const hour = new Date(controller.scheduledTime).getUTCHours();
      await dispatch(env, "discovery-manual-review.yml", { mode: "maintenance", recheck: String(hour % 6 === 0) });
    } else if (controller.cron === PUBLISH_CRON) {
      await dispatch(env, "catalogue-auto-publish.yml", { mode: "publish" });
    } else {
      throw new Error(`Unknown cron: ${controller.cron}`);
    }
  },
};

export default scheduler;
