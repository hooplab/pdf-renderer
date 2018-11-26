import Hapi from "hapi";

const host = "0.0.0.0";
const port = 9000;

const server = new Hapi.Server({
  host: host,
  port: port,
});

server.route({
  method: "POST",
  path: "/pdf",
  handler: function(request, h) {
    return "hello there";
  },
});

const init = async () => {
  await server.start();
  console.log(`Server running at ${host}:${port}`);
};

process.on("unhandledRejection", err => {
  console.log(err);
  process.exit(1);
});

init();
