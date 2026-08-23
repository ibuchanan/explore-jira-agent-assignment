const { createA2aServer } = require("./server");

const port = Number(process.env.PORT ?? 3000);
const server = createA2aServer();
server.listen(port, () =>
  console.info(`A2A server listening on ${server.address().port}`),
);
