import fastify from "fastify";

import * as pdf from "./lib/pdf";

const port = 3000;
const host = "0.0.0.0";

// Create a pdf renderer pool
const pdfRenderer = pdf.launch({ poolOptions: { min: 5, max: 5 } });

const server = fastify({
  ignoreTrailingSlash: true,
  logger: {
    prettyPrint: true,
    level: "info",
  },
});

server.get("/api/_healthcheck", async (request, reply) => {
  const renderer = await pdfRenderer;
  const isHealthy = await renderer.isHealthy();

  if (isHealthy) {
    reply.send({ ok: true });
  } else {
    reply.code(503).send({ ok: false });
  }
});

server.get("/api/pdf", async (request, reply) => {
  const options: pdf.RenderOptions = {
    // url: "http://httpbin.org/status/403",
    url: "file:///Users/hlindset/src/hoopla-pdf-renderer/foo.html",
    mediaType: "print",
    navigation: {},
    waitForSelector: {
      selector: ".document-ready",
    },
    pdf: {
      format: "A4",
    },
  };

  const renderer = await pdfRenderer;
  const pdf = await renderer.render(options);

  if (pdf) {
    reply.send(pdf);
  } else {
    reply.code(500).send({ error: "could not render pdf" });
  }
});

const start = async (port: number, host: string) => {
  await server.ready();

  console.log("Routes:");
  console.log(server.printRoutes());

  try {
    await server.listen(port, host);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start(port, host);
