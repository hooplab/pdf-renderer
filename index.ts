import puppeteer from "puppeteer";
import genericPool from "generic-pool";

interface Pool {
  acquire(): Promise<puppeteer.Page>;
  release(): void;
}

interface RenderOptions {
  url: string;
  pdf: puppeteer.PDFOptions;
  navigation: puppeteer.DirectNavigationOptions;
  mediaType?: puppeteer.MediaType;
}

const render = async (
  pool: genericPool.Pool<puppeteer.Page>,
  options: RenderOptions
) => {
  const page = await pool.acquire();

  page.on("error", err => {
    console.error(err);
  });

  page.on("requestfailed", request => {
    console.error("request failed", request);
  });

  try {
    // navigate to page
    console.log(`navigation to ${options.url}`);
    await page.goto(options.url, options.navigation);

    // set media type
    if (options.mediaType) {
      console.log(`setting media type to ${options.mediaType}`);
      await page.emulateMedia(options.mediaType);
    }

    // create pdf
    console.log(`creating pdf`);
    const pdf = await page.pdf(options.pdf);

    pool.destroy(page);

    return pdf;
  } catch (err) {
    console.error("error occurred when rendering page", err);
  }

  pool.destroy(page);

  // pool.release();
};

const createPuppeteerPool = async (
  browser: puppeteer.Browser,
  poolOptions?: genericPool.Options
) => {
  const factory: genericPool.Factory<puppeteer.Page> = {
    create() {
      console.log("acquiring new page");
      return browser.newPage();
    },

    async destroy(page) {
      console.log(`destroying ${page}`);

      if (!page.isClosed) {
        await page.close();
      }

      return;
    },

    validate(page) {
      console.log(`validating ${page}`);

      return new Promise(resolve => resolve(page.isClosed()));
    },
  };

  return genericPool.createPool(factory, poolOptions);
};

(async () => {
  const wsEndpoint =
    "ws://localhost:9222/devtools/browser/ed2a46d6-e425-4157-9691-c8852ee955fe";
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

  const pool = await createPuppeteerPool(browser, {
    min: 2,
    max: 10,
    autostart: true,
  });

  const range = Array.from(Array(10).keys());

  const all = range.map(async n => {
    await render(pool, {
      url: "http://example.com/",
      pdf: { format: "A4" },
      navigation: { waitUntil: "networkidle0" },
    });
    console.log("created pdf");
  });

  await Promise.all(all);

  console.log("all created");

  await browser.disconnect();
})();
