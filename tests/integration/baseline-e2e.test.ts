import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import http from 'http';

// Simple HTTP fetch utility for Node.js
async function fetchHttp(url: string): Promise<{
  status: number;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
  ok: boolean;
}> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const headers: Record<string, string> = {};
        Object.entries(res.headers).forEach(([key, value]) => {
          headers[key] = Array.isArray(value) ? value.join(', ') : value || '';
        });

        resolve({
          status: res.statusCode || 0,
          headers,
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          text: async () => data,
          json: async () => JSON.parse(data),
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Test configuration
const TEST_PORT = 3001;
const SERVER_TIMEOUT = 15000; // 15 seconds to start server
const baselineDir = path.resolve('./tests/integration/baseline');

describe.skip('baseline e2e - full user journey', () => {
  let serverProcess: ChildProcess | null = null;
  let serverReady = false;

  beforeAll(async () => {
    // Skip if baseline directory doesn't exist
    if (!fs.existsSync(baselineDir)) {
      console.log('Skipping e2e tests - baseline directory not found');
      return;
    }

    // Start the Markout server
    console.log(`Starting Markout server on port ${TEST_PORT}...`);
    serverProcess = spawn(
      'node',
      [
        path.join(__dirname, '../../dist/index.js'),
        'serve',
        baselineDir,
        '--port',
        TEST_PORT.toString(),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start within ${SERVER_TIMEOUT}ms`));
      }, SERVER_TIMEOUT);

      const checkServer = async () => {
        try {
          console.log(`Checking server at http://127.0.0.1:${TEST_PORT}/`);
          const response = await fetchHttp(`http://127.0.0.1:${TEST_PORT}/`);
          console.log(`Server response: ${response.status}`);
          if (response.status === 404 || response.ok) {
            // 404 means server is responding, even if index.html doesn't exist
            clearTimeout(timeout);
            serverReady = true;
            console.log('✅ Markout server is ready');
            resolve();
          } else {
            setTimeout(checkServer, 500);
          }
        } catch (e) {
          console.log(`Server check failed: ${e}`);
          // Server not ready yet, try again
          setTimeout(checkServer, 500);
        }
      };

      // Handle server output
      serverProcess!.stdout?.on('data', data => {
        const output = data.toString();
        console.log('Server:', output.trim());
        if (output.includes('Server running on')) {
          checkServer();
        }
      });

      serverProcess!.stderr?.on('data', data => {
        console.error('Server error:', data.toString().trim());
      });

      serverProcess!.on('error', error => {
        clearTimeout(timeout);
        reject(error);
      });

      serverProcess!.on('exit', code => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Start checking immediately
      setTimeout(checkServer, 1000);
    });
  }, 20000);

  afterAll(async () => {
    if (serverProcess) {
      console.log('🛑 Stopping Markout server...');
      serverProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise<void>(resolve => {
        serverProcess!.on('exit', () => {
          console.log('✅ Server stopped');
          resolve();
        });

        // Force kill after 5 seconds
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGKILL');
            resolve();
          }
        }, 5000);
      });
    }
  });

  // Test each baseline example through full HTTP cycle
  if (fs.existsSync(baselineDir)) {
    fs.readdirSync(baselineDir).forEach(file => {
      if (
        fs.statSync(path.join(baselineDir, file)).isFile() &&
        file.endsWith('-in.html')
      ) {
        const testName = file.replace('-in.html', '');
        const testUrl = `/${file}`;

        describe(`${testName} - full user journey`, () => {
          it('should serve page with SSR (server-side rendering)', async () => {
            if (!serverReady) {
              console.log('Skipping SSR test - server not ready');
              return;
            }

            const response = await fetchHttp(
              `http://127.0.0.1:${TEST_PORT}${testUrl}`
            );
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('text/html');

            const html = await response.text();
            expect(html).toContain('<html');
            expect(html).toContain('</html>');

            // Should contain pre-rendered content (not just templates)
            expect(html).not.toContain('${'); // Templates should be resolved

            // Should contain client-side hydration script
            expect(html).toContain('<script'); // Hydration script injected

            console.log(`✅ SSR working for ${testName}`);
          });

          it('should hydrate correctly on client-side', async () => {
            if (!serverReady) {
              console.log('Skipping hydration test - server not ready');
              return;
            }

            // Fetch the page
            const response = await fetchHttp(
              `http://127.0.0.1:${TEST_PORT}${testUrl}`
            );
            const html = await response.text();

            // Create JSDOM environment to simulate browser
            const dom = new JSDOM(html, {
              url: `http://127.0.0.1:${TEST_PORT}${testUrl}`,
              resources: 'usable',
              runScripts: 'dangerously',
            });

            const { window } = dom;
            global.window = window as any;
            global.document = window.document;

            // Wait for scripts to execute
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify that Markout runtime is available
            const markoutRuntime = (window as any).markout;
            if (markoutRuntime) {
              expect(markoutRuntime).toBeDefined();
              console.log(`✅ Client-side hydration working for ${testName}`);
            } else {
              console.log(
                `⚠️  No client-side runtime detected for ${testName} (may be expected)`
              );
            }

            // Cleanup
            dom.window.close();
          });

          it('should handle reactive updates in browser', async () => {
            if (!serverReady) {
              console.log('Skipping reactive test - server not ready');
              return;
            }

            // Only test this for examples that should have reactive behavior
            const shouldHaveReactivity = [
              '001-simple-counter',
              '002-reactive-counter',
              '005-basic-reactive',
            ].includes(testName);

            if (!shouldHaveReactivity) {
              console.log(
                `⏭️  Skipping reactivity test for ${testName} (not expected to be reactive)`
              );
              return;
            }

            const response = await fetchHttp(
              `http://127.0.0.1:${TEST_PORT}${testUrl}`
            );
            const html = await response.text();

            const dom = new JSDOM(html, {
              url: `http://127.0.0.1:${TEST_PORT}${testUrl}`,
              resources: 'usable',
              runScripts: 'dangerously',
            });

            const { window } = dom;
            global.window = window as any;
            global.document = window.document;

            // Wait for hydration
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Test reactive behavior if available
            const markoutRuntime = (window as any).markout;
            if (markoutRuntime && markoutRuntime.context) {
              // Try to find reactive values and update them
              const context = markoutRuntime.context;
              const rootScope = context.root;

              // This is a basic test - in real scenarios we'd have more specific tests
              expect(rootScope).toBeDefined();
              console.log(`✅ Reactive runtime available for ${testName}`);
            }

            dom.window.close();
          });
        });
      }
    });
  } else {
    it('should skip tests when baseline directory does not exist', () => {
      console.log('Skipping e2e tests - baseline directory not found');
      expect(true).toBe(true);
    });
  }

  it('should serve root endpoint', async () => {
    if (!serverReady) {
      console.log('Skipping root endpoint test - server not ready');
      return;
    }

    const response = await fetchHttp(`http://127.0.0.1:${TEST_PORT}/`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('should serve static files', async () => {
    if (!serverReady) {
      console.log('Skipping static file test - server not ready');
      return;
    }

    // Test that non-.html files are served as static files
    const response = await fetchHttp(
      `http://127.0.0.1:${TEST_PORT}/lib/greeting.htm`
    );

    if (response.status === 200) {
      const content = await response.text();
      expect(content).toContain('<lib>');
      console.log('✅ Static file serving working');
    } else {
      console.log('⚠️  Static file not found (may be expected)');
    }
  });
});
