import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { paths } from "./config.js";

export const DEFAULT_OIC_PORTAL_URL = "https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome";

let browserContext: BrowserContext | undefined;
let oicPage: Page | undefined;

export async function openOicBrowserPreflight(portalUrl = DEFAULT_OIC_PORTAL_URL): Promise<string> {
  const context = await getBrowserContext();
  const page = await getOicPage(context);
  oicPage = page;

  await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  const title = await page.title().catch(() => "");
  return title ? `Opened visible browser at ${page.url()} (${title})` : `Opened visible browser at ${page.url()}`;
}

export interface OicLoginResult {
  ok: boolean;
  signedIn: boolean;
  message: string;
  storageStatePath?: string;
}

/**
 * Signs into the Oracle Fusion portal in the visible runner browser using the
 * supplied credentials. Best-effort automation of the Oracle sign-in flow; if MFA
 * or an unexpected screen appears, the visible window is left open for the user.
 */
export async function loginOic(username: string, password: string): Promise<OicLoginResult> {
  const context = await getBrowserContext();
  const page = await getOicPage(context);
  oicPage = page;

  await page.goto(DEFAULT_OIC_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  // Oracle Fusion sign-in: an email/username field, then a password field.
  const emailField = page.locator('input[type="email"], input[name="userid"], input#userid, input[name="j_username"]').first();
  const hasEmail = await emailField.isVisible().catch(() => false);
  if (hasEmail) {
    await emailField.fill(username);
    await clickPrimary(page);
  }

  const passwordField = page.locator('input[type="password"], input#password, input[name="j_password"]').first();
  const gotPassword = await passwordField.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
  if (gotPassword) {
    await passwordField.fill(password);
    await clickPrimary(page);
  }

  // "Stay signed in?" / Oracle security prompts (best-effort).
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await clickPrimary(page).catch(() => undefined);

  const reachedPortal = await page.waitForURL(/ecaw-test\.fa\.us2\.oraclecloud\.com/, { timeout: 45_000 }).then(() => true).catch(() => false);
  if (reachedPortal) {
    const storageStatePath = await saveOicStorageState();
    return { ok: true, signedIn: true, message: `Signed in as ${username}.`, storageStatePath };
  }

  return {
    ok: true,
    signedIn: false,
    message: "Sign-in started. If MFA or another prompt appeared, finish it in the browser window, then click Save login state."
  };
}

async function clickPrimary(page: Page): Promise<void> {
  const semanticPrimary = page.getByRole("button", { name: /sign in|continue|next|submit/i }).first();
  if (await semanticPrimary.isVisible().catch(() => false)) {
    await semanticPrimary.click();
    return;
  }

  const formPrimary = page.locator('button[type="submit"], input[type="submit"], input[type="button"], .btn-signin, #btn-signin, .primarybutton').first();
  if (await formPrimary.isVisible().catch(() => false)) {
    await formPrimary.click();
    return;
  }

  await page.keyboard.press("Enter");
}

export async function saveOicStorageState(): Promise<string> {
  const context = await getBrowserContext();
  const authFolder = paths.authPath;
  await fs.mkdir(authFolder, { recursive: true });
  const statePath = path.join(authFolder, `oic-state-${Date.now()}.json`);
  await context.storageState({ path: statePath });
  return statePath;
}

export async function closeOicBrowserPreflight(): Promise<void> {
  if (browserContext) {
    await browserContext.close().catch(() => undefined);
    browserContext = undefined;
    oicPage = undefined;
  }
}

async function getBrowserContext(): Promise<BrowserContext> {
  if (!browserContext) {
    const userDataDir = paths.browserProfilePath;
    browserContext = await launchPersistentContext(userDataDir, true).catch(() => launchPersistentContext(userDataDir, false));
    browserContext.on("close", () => {
      browserContext = undefined;
      oicPage = undefined;
    });
  }
  return browserContext;
}

async function launchPersistentContext(userDataDir: string, useChromeChannel: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: useChromeChannel ? "chrome" : undefined,
    headless: false,
    viewport: { width: 1440, height: 900 }
  });
}

export async function navigateOicBrowser(url: string): Promise<{ url: string; title: string }> {
  const context = await getBrowserContext();
  const page = await getOicPage(context);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();
  return { url: page.url(), title: await page.title().catch(() => "") };
}

export async function captureOicBrowserSnapshot(): Promise<{ url: string; title: string; text: string; controls: string[] }> {
  const context = await getBrowserContext();
  const page = await getOicPage(context);
  const controls = await page.locator("button, a, input, textarea, select, [role='button'], [role='link'], [role='menuitem'], [role='tab']")
    .evaluateAll((elements) => elements
      .map((element) => {
        const aria = element.getAttribute("aria-label") ?? "";
        const text = element.textContent ?? "";
        const placeholder = element.getAttribute("placeholder") ?? "";
        return [aria, text, placeholder].map((value) => value.trim()).filter(Boolean).join(" | ");
      })
      .filter(Boolean)
      .slice(0, 120))
    .catch(() => []);
  const text = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    text: text.slice(0, 12_000),
    controls
  };
}

async function getOicPage(context: BrowserContext): Promise<Page> {
  if (oicPage && !oicPage.isClosed()) {
    return oicPage;
  }
  oicPage = context.pages().find((page) => !page.isClosed()) ?? await context.newPage();
  return oicPage;
}
