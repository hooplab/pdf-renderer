import fastify from "fastify";

import * as pdf from "./lib/pdf";
import * as pdfRequest from "./domain/pdf/request";

const port = 3000;
const host = "0.0.0.0";

const server = fastify({
  ignoreTrailingSlash: true,
  bodyLimit: 1048576 * 100, // 100 MiB
  logger: {
    prettyPrint: true,
    level: "info",
  },
});

// Create a pdf renderer pool
const pdfRenderer = pdf.launch(
  {
    puppeteer: {
      // XXX: This runs chrome without a sandbox because it's simpler. If we're to
      // allow user generated content in the future, chrome _must_ be placed in a
      // sandboxed environment.
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
  server.log
);

server.get("/api/_healthcheck", async (request, reply) => {
  const renderer = await pdfRenderer;
  const isHealthy = await renderer.isHealthy(request.log);

  if (isHealthy) {
    reply.send({ ok: true });
  } else {
    reply.code(503).send({ ok: false });
  }
});

server.get("/api/_liveness", async (request, reply) => {
  reply.send({ ok: true });
});

const pdfOpts: fastify.RouteShorthandOptions = {
  schema: {
    body: pdfRequest.bodySchema,
  },
};

server.post("/api/pdf", pdfOpts, async (request, reply) => {
  const renderer = await pdfRenderer;

  // this is a bit icky. but it has been validated by the json schema.
  // should probably generate it using the typescript interface
  const body = request.body as pdfRequest.Body;

  // Render PDF
  const renderOptions = pdfRequest.pdfBodyToRenderOptions(body);
  const pdf = await renderer.render(renderOptions, request.log);

  if (pdf) {
    reply.send(pdf);
  } else {
    reply.code(500).send({ error: "could not render pdf" });
  }
});

const start = async (port: number, host: string) => {
  await server.ready();

  try {
    await server.listen(port, host);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start(port, host);
