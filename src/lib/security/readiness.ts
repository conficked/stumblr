import { readPrivateAccessConfig } from "./privateAccess";
import { readDeploymentOriginConfig } from "./requestOrigin";

export function buildHealthResponse(env: NodeJS.ProcessEnv) {
  const accessReady = env.STUMBLR_ACCESS_MODE === "public" || readPrivateAccessConfig(env).ok;
  const ready = accessReady && readDeploymentOriginConfig(env).ok;
  return new Response(null, {
    status: ready ? 204 : 503,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
