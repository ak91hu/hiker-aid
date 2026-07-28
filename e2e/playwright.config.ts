import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const javaHome = process.env.JAVA_HOME || 'C:\\Users\\Kovács Ákos\\.jdks\\azul-22.0.2';
const javaPath = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ''}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:8080',
    serviceWorkers: 'block',
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.disabled': false,
            'webgl.force-enabled': true,
          },
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle'],
        },
      },
    },
  ],
  webServer: {
    command: 'mvn -f ../pom.xml spring-boot:run',
    url: 'http://localhost:8080/api/health',
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      JAVA_HOME: javaHome,
      Path: javaPath,
      PATH: javaPath,
    },
  },
});
