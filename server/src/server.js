const http = require("http");
const app = require("./app");

const server = http.createServer(app);

const port = process.env.PORT ? process.env.PORT : 4000;

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
