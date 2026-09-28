import { defineConfig, devices } from "@playwright/test";

const port = 4173;
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}/` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: `node tools/serve-site.mjs ${port}`, url: `http://127.0.0.1:${port}/`, reuseExistingServer: !process.env.CI },
});
