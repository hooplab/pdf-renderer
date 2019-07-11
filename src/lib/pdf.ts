import puppeteer, { WaitForSelectorOptions } from "puppeteer";
import genericPool from "generic-pool";

const LOW_PRIORITY = 0;
const HIGH_PRIORITY = 1;

export interface RenderOptions {
  url?: string;
  html?: string;
  pdf: puppeteer.PDFOptions;
  timeout?: number;
  waitForSelector?: {
    selector: string;
    options?: WaitForSelectorOptions;
  };
  waitForXpath?: {
    xpath: string;
    options?: WaitForSelectorOptions;
  };
  navigation?: puppeteer.DirectNavigationOptions;
  mediaType?: puppeteer.MediaType;
}

export interface Renderer {
  render(options: RenderOptions): Promise<Buffer>;
  isHealthy(): Promise<boolean>;
}

export interface PoolOptions {
  min: number;
  max: number;
}

export interface PdfLaunchOptions {
  puppeteerLaunchOptions?: puppeteer.LaunchOptions;
  poolOptions?: PoolOptions;
}

const createPuppeteerPool = async (options: PdfLaunchOptions) => {
  const shouldRepair: { [key: number]: boolean } = {};

  const factory: genericPool.Factory<puppeteer.Browser> = {
    async create() {
      console.log("[pool] creating a new browser");

      try {
        const browser = await puppeteer.launch(options.puppeteerLaunchOptions);
        const pid = browser.process().pid;

        // Update map of healthy pids
        shouldRepair[pid] = false;

        // Trigger a cleanup if disconnected
        browser.once("disconnected", () => {
          console.log(`[pool] browser with pid '${pid}' disconnected`);
          shouldRepair[pid] = true;
        });

        console.log(`[pool] created browser with pid ${pid}`);

        return browser;
      } catch (err) {
        console.error(`[pool] error while creating browser:`);
        console.error(err);
        throw err;
      }
    },

    async destroy(browser) {
      console.log("[pool] destroying browser");

      try {
        // remove from list of pids
        const pid = browser.process().pid;
        delete shouldRepair[pid];

        // close browser
        await browser.close();
      } catch (err) {
        console.error("[pool] error while destroying browser:");
        console.error(err);
      }
    },

    async validate(browser) {
      console.log("[pool] validating browser");

      try {
        const pid = browser.process().pid;

        if (shouldRepair[pid]) {
          return false;
        }

        return true;
      } catch (err) {
        console.log("[pool] error validating browser");
        console.error(err);
        return false;
      }
    },
  };

  return genericPool.createPool(factory, {
    min: options.poolOptions ? options.poolOptions.min : 1,
    max: options.poolOptions ? options.poolOptions.max : 10,
    autostart: true,
    testOnBorrow: true,
    acquireTimeoutMillis: 10000,
  });
};

async function timeout<T>(promise: PromiseLike<T>, timeoutMs: number) {
  const timeoutPromise: Promise<T> = new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error("promise timed out"));
      clearTimeout(id);
    }, timeoutMs);
  });

  return await Promise.race([timeoutPromise, promise]);
}

const render = async (
  browser: puppeteer.Browser,
  options: RenderOptions
): Promise<Buffer> => {
  const page = await browser.newPage();

  page.on("error", err => {
    console.error(`[render] page error:`);
    console.error(err);
    throw new Error(`page error: ${err}`);
  });

  page.on("requestfailed", request => {
    console.error(`[render] request failed: ${request}`);
    throw new Error(`page request failed: ${request}`);
  });

  try {
    if (options.url) {
      // navigate to page
      console.log(
        `[render] navigation to '${options.url}' with options: ${JSON.stringify(
          options.navigation || {}
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
    } else if (options.html) {
      console.log(
        `[render] setting page content. length: ${options.html.length}`
      );
      await page.setContent(options.html);
    } else {
      throw new Error("either `url` or `html` must be set");
    }

    if (options.waitForSelector) {
      console.log(
        `waiting for selector '${
          options.waitForSelector.selector
        }' with options: ${JSON.stringify(
          options.waitForSelector.options || {}
        )}`
      );
      await page.waitForSelector(
        options.waitForSelector.selector,
        options.waitForSelector.options
      );
    }

    if (options.waitForXpath) {
      console.log(
        `waiting for xpath '${
          options.waitForXpath.xpath
        }' with options: ${JSON.stringify(options.waitForXpath.options || {})}`
      );
      await page.waitForXPath(
        options.waitForXpath.xpath,
        options.waitForXpath.options
      );
    }

    // set media type
    if (options.mediaType) {
      console.log(`setting media type to '${options.mediaType}'`);
      await page.emulateMedia(options.mediaType);
    }

    // create pdf
    console.log(`creating pdf with options: ${JSON.stringify(options.pdf)}`);
    const pdf = await page.pdf(options.pdf);

    // close page (not waiting for it to complete)
    page.close();

    if (pdf) {
      return pdf;
    } else {
      throw new Error("pdf response was null or undefined");
    }
  } catch (err) {
    console.error("error occurred when rendering page", err);
    throw err;
  }
};

const defaultTimeoutMs = 25000;

const createRenderer = (
  pool: genericPool.Pool<puppeteer.Browser>
): Renderer => ({
  async render(options: RenderOptions) {
    const browser = await pool.acquire(LOW_PRIORITY);

    try {
      const timeoutMs = options.timeout ? options.timeout : defaultTimeoutMs;
      return await timeout(render(browser, options), timeoutMs);
    } catch (err) {
      console.error(err);
      throw err;
    } finally {
      pool.release(browser);
    }
  },

  async isHealthy() {
    try {
      const browser = await pool.acquire(HIGH_PRIORITY);
      pool.release(browser);
      return true;
    } catch (err) {
      return false;
    }
  },
});

export const launch = async (options: PdfLaunchOptions): Promise<Renderer> => {
  const pool = await createPuppeteerPool(options);
  return createRenderer(pool);
};
