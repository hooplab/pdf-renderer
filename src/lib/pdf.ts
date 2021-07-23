import puppeteer, { WaitForSelectorOptions } from "puppeteer";
import genericPool from "generic-pool";
import assertNever from "../assert-never";
import fastify from "fastify";

const LOW_PRIORITY = 0;
const HIGH_PRIORITY = 1;

type BaseRenderOptions = {
  pdf: puppeteer.PDFOptions;
  waitForSelector?: {
    selector: string;
    options?: WaitForSelectorOptions;
  };
  waitForXpath?: {
    xpath: string;
    options?: WaitForSelectorOptions;
  };
  navigation?: puppeteer.NavigationOptions;
  mediaType?: puppeteer.MediaType;
  defaultNavigationTimeout: number;
  defaultTimeout: number;
};

type UrlRenderOptions = BaseRenderOptions & {
  type: "url";
  url: string;
};

type HtmlRenderOptions = BaseRenderOptions & {
  type: "html";
  html: string;
};

export type RenderOptions = UrlRenderOptions | HtmlRenderOptions;

export type Renderer = {
  render(options: RenderOptions, log: fastify.Logger): Promise<Buffer>;
  isHealthy(log: fastify.Logger): Promise<boolean>;
};

export type PoolOptions = {
  min: number;
  max: number;
};

export type PdfLaunchOptions = {
  puppeteer?: puppeteer.LaunchOptions;
  pool?: PoolOptions;
};

const createPuppeteerPool = async (
  options: PdfLaunchOptions,
  log: fastify.Logger
) => {
  const shouldRepair: { [key: number]: boolean } = {};

  const factory: genericPool.Factory<puppeteer.Browser> = {
    async create() {
      log.info("[pool] creating a new browser");

      try {
        const browser = await puppeteer.launch(options.puppeteer);
        const pid = browser.process().pid;

        // Update map of healthy pids
        shouldRepair[pid] = false;

        // Trigger a cleanup if disconnected
        browser.once("disconnected", () => {
          log.info(`[pool] browser with pid`, pid, `disconnected`);
          shouldRepair[pid] = true;
        });

        log.info(`[pool] created browser with pid`, pid);

        return browser;
      } catch (err) {
        log.error(`[pool] error while creating browser:`);
        log.error(err);
        throw err;
      }
    },

    async destroy(browser) {
      log.info("[pool] destroying browser");

      try {
        // remove from list of pids
        const pid = browser.process().pid;
        delete shouldRepair[pid];

        // close browser
        await browser.close();
      } catch (err) {
        log.error("[pool] error while destroying browser:");
        log.error(err);
      }
    },

    async validate(browser) {
      log.info("[pool] validating browser");

      try {
        const pid = browser.process().pid;

        if (shouldRepair[pid]) {
          return false;
        }

        return true;
      } catch (err) {
        log.error("[pool] error validating browser");
        log.error(err);
        return false;
      }
    },
  };

  return genericPool.createPool(factory, {
    min: options.pool?.min ?? 1,
    max: options.pool?.max ?? 10,
    autostart: true,
    testOnBorrow: true,
  });
};

const render = async (
  browser: puppeteer.Browser,
  options: RenderOptions,
  log: fastify.Logger
): Promise<Buffer> => {
  const page = await browser.newPage();

  page.on("error", (err) => {
    log.error(`[render] [error callback] page error:`);
    log.error(err);
    throw new Error(`page error: ${err}`);
  });

  page.on("requestfailed", (request) => {
    const msg = `[render] [requestfailed callback] request for url '${request.url()}' failed with status code '${request
      .response()
      ?.status()}' and status text '${request.response()?.statusText()}'`;
    log.error(msg);
    throw new Error(msg);
  });

  try {
    // set default timeouts
    page.setDefaultTimeout(options.defaultTimeout);
    page.setDefaultNavigationTimeout(options.defaultNavigationTimeout);

    if (options.type === "url") {
      // navigate to page
      log.info(
        `[render] navigation to '${options.url}' with options: ${JSON.stringify(
          options.navigation ?? {}
        )}`
      );

      const response = await page.goto(options.url, options.navigation);

      if (response) {
        if (!response.ok()) {
          let responseText = "";

          try {
            responseText = await response.text();
          } catch (err) {}

          throw new Error(
            `response from '${
              options.url
            }' was not ok. received status code '${response.status()}' with response body: '${responseText}'`
          );
        }
      } else {
        throw new Error("response was null, somehow");
      }
    } else if (options.type === "html") {
      log.info(
        `[render] setting content with length ${
          options.html.length
        } and options: ${JSON.stringify(options.navigation ?? {})}`
      );
      await page.setContent(options.html, options.navigation);
    } else {
      assertNever(options);
    }

    // if format is not defined, use A4 width and height adjusted to content
    if (!options.pdf.format && (!options.pdf.width || !options.pdf.height)) {
      log.info(`[render] setting height to fit content`);
      options.pdf.width = options.pdf.width ?? "8.27in";
      let height = await page.evaluate(
        () => document.documentElement.offsetHeight
      );
      // + 2px to avoid blank page at bottom
      options.pdf.height = options.pdf.height ?? `${height + 2} px`;
    }

    // set media type
    if (options.mediaType) {
      log.info(`[render] setting media type to '${options.mediaType}'`);
      await page.emulateMediaType(options.mediaType);
    }

    if (options.waitForSelector) {
      log.info(
        `[render] waiting for selector '${
          options.waitForSelector.selector
        }' with options: ${JSON.stringify(
          options.waitForSelector.options ?? {}
        )}`
      );
      await page.waitForSelector(options.waitForSelector.selector);
    }

    if (options.waitForXpath) {
      log.info(
        `[render] waiting for xpath '${
          options.waitForXpath.xpath
        }' with options: ${JSON.stringify(options.waitForXpath.options ?? {})}`
      );
      await page.waitForXPath(
        options.waitForXpath.xpath,
        options.waitForXpath.options
      );
    }

    // create pdf
    log.info(
      `[render] creating pdf with options: ${JSON.stringify(options.pdf ?? {})}`
    );
    const pdf = await page.pdf(options.pdf);

    // close page (not waiting for it to complete)
    page.close();

    if (pdf) {
      return pdf;
    } else {
      throw new Error("pdf response was null or undefined");
    }
  } catch (err) {
    log.error("[render] error occurred when rendering page");
    log.error(err);
    throw err;
  }
};

const createRenderer = (
  pool: genericPool.Pool<puppeteer.Browser>
): Renderer => ({
  async render(options: RenderOptions, log: fastify.Logger) {
    try {
      return await pool.use(async (browser) => {
        return await render(browser, options, log);
      });
    } catch (err) {
      log.error(err);
      throw err;
    }
  },

  async isHealthy(log) {
    try {
      return await pool.use(async () => true);
    } catch (err) {
      log.error(err);
      return false;
    }
  },
});

export const launch = async (
  options: PdfLaunchOptions,
  log: fastify.Logger
): Promise<Renderer> => {
  const pool = await createPuppeteerPool(options, log);
  return createRenderer(pool);
};
