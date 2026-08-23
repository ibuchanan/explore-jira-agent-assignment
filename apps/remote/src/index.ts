import { log } from "@forge-ahead/logging";

import { createA2aServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const serverResult = createA2aServer();

if (serverResult.isErr()) {
  log.error(
    "[Forge Remote/FIT] server configuration failed: FORGE_APP_ID is required",
  );
  process.exitCode = 1;
} else {
  const server = serverResult.value.listen(port, () => {
    const address = server.address();
    const listeningPort =
      address && typeof address !== "string" ? address.port : port;
    log.info({ port: listeningPort }, "[HTTP] server listening");
  });
}
