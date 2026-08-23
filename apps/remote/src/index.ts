import { createA2aServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const app = createA2aServer();
const server = app.listen(port, () => {
  const address = server.address();
  const listeningPort =
    address && typeof address !== "string" ? address.port : port;
  console.info(`A2A server listening on ${listeningPort}`);
});
