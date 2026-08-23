import { createA2aServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const server = createA2aServer();
server.listen(port, () => {
  const address = server.address();
  const listeningPort =
    address && typeof address !== "string" ? address.port : port;
  console.info(`A2A server listening on ${listeningPort}`);
});
