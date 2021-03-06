import { LoadEvent, PDFFormat, MediaType } from "puppeteer";
import { RenderOptions } from "../../lib/pdf";

type BaseBody = {
  waitForNavigation?: LoadEvent | LoadEvent[];
  waitForSelector?: string;
  waitForXpath?: string;

  headerTemplate?: string;
  footerTemplate?: string;

  format?: PDFFormat;
  mediaType?: MediaType;

  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };

  defaultNavigationTimeout?: number;
  defaultTimeout?: number;
};

type UrlBody = BaseBody & {
  url: string;
};

type HtmlBody = BaseBody & {
  html: string;
};

export type Body = UrlBody | HtmlBody;

const waitForNavigationEnum = [
  "load",
  "domcontentloaded",
  "networkidle0",
  "networkidle2",
];

const formatEnum = [
  "Letter",
  "Legal",
  "Tabload",
  "Ledger",
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
];

export const bodySchema = {
  type: "object",

  // make sure either `url` or `html` is present
  anyOf: [{ required: ["url"] }, { required: ["html"] }],

  properties: {
    url: { type: "string" },
    html: { type: "string" },

    waitForNavigation: {
      anyOf: [
        { type: "string", enum: waitForNavigationEnum },
        {
          type: "array",
          items: { type: "string", enum: waitForNavigationEnum },
        },
      ],
    },
    waitForSelector: { type: "string" },
    waitForXpath: { type: "string" },

    headerTemplate: { type: "string" },
    footerTemplate: { type: "string" },

    format: { type: "string", enum: formatEnum },
    mediaType: { type: "string", enum: ["screen", "print"] },
    margin: {
      type: "object",
      properties: {
        top: { type: "string" },
        right: { type: "string" },
        bottom: { type: "string" },
        left: { type: "string" },
      },
    },
    defaultNavigationTimeout: { type: "number" },
    defaultTimeout: { type: "number" },
  },
};

export const pdfBodyToRenderOptions = (body: Body): RenderOptions => {
  const shared = {
    navigation: body.waitForNavigation
      ? {
          waitUntil: body.waitForNavigation,
        }
      : undefined,
    waitForXpath: body.waitForXpath
      ? {
          xpath: body.waitForXpath,
        }
      : undefined,
    waitForSelector: body.waitForSelector
      ? { selector: body.waitForSelector }
      : undefined,
    mediaType: body.mediaType,
    pdf: {
      format: body.format,
      displayHeaderFooter: !!(body.headerTemplate || body.footerTemplate),
      headerTemplate: body.headerTemplate,
      footerTemplate: body.footerTemplate,
      margin: body.margin,
    },
    defaultNavigationTimeout: body.defaultNavigationTimeout ?? 60 * 1000,
    defaultTimeout: body.defaultTimeout ?? 60 * 1000,
  };

  return "url" in body
    ? { type: "url", url: body.url, ...shared }
    : { type: "html", html: body.html, ...shared };
};
