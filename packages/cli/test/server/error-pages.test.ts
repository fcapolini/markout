import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Server } from "../../src/server";

/**
 * The two things a server shows when there is no page to show.
 *
 * Half of this suite is about what the response does NOT contain. A compile
 * error names a source file and a line, which outside dev mode is a report
 * about the deployment handed to whoever asked for the page -- so the
 * assertions that matter most here are the negative ones, and the one
 * checking that the same detail reached the log instead.
 */
const BROKEN = '<html><body>\n<:import src="/nope.htm"/>\n</body></html>\n';

function docroot(files: { [name: string]: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-errpages-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const dirs: string[] = [];
const track = (dir: string) => (dirs.push(dir), dir);

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("not-found page", () => {
  it("is /404.html by convention, with nothing configured", async () => {
    const dir = track(docroot({
      "index.html": "<html><body><h1>Home</h1></body></html>",
      "404.html": "<html><body><h1>Nothing here</h1><p>${'made by markout'}</p></body></html>",
    }));
    const app = await new Server({ docroot: dir, mute: true }).create();

    const res = await request(app).get("/no-such-page");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Nothing here");
    // rendered, not merely read off disk: the expression ran
    expect(res.text).toContain("made by markout");
  });

  it("is a bare status line when the docroot has no 404.html", async () => {
    const dir = track(docroot({ "index.html": "<html><body>hi</body></html>" }));
    const app = await new Server({ docroot: dir, mute: true }).create();
    const res = await request(app).get("/no-such-page");
    expect(res.status).toBe(404);
    expect(res.text).toBe("Not Found");
  });

  it("takes a page of another name, spelled either way", async () => {
    const dir = track(docroot({
      "errors/gone.html": "<html><body><h1>Gone</h1></body></html>",
    }));
    for (const notFound of ["/errors/gone.html", "errors/gone", "/errors/gone"]) {
      const app = await new Server({ docroot: dir, mute: true, errorPages: { notFound } }).create();
      const res = await request(app).get("/no-such-page");
      expect(res.status, notFound).toBe(404);
      expect(res.text, notFound).toContain("Gone");
    }
  });

  it("can be turned off, leaving the convention unused", async () => {
    const dir = track(docroot({ "404.html": "<html><body>Nothing here</body></html>" }));
    const app = await new Server({
      docroot: dir,
      mute: true,
      errorPages: { notFound: false },
    }).create();
    const res = await request(app).get("/no-such-page");
    expect(res.status).toBe(404);
    expect(res.text).toBe("Not Found");
  });

  it("still answers 404 when the configured page is itself missing", async () => {
    const said: string[] = [];
    const dir = track(docroot({ "index.html": "<html><body>hi</body></html>" }));
    const app = await new Server({
      docroot: dir,
      logger: (type, msg) => { said.push(`${type} ${msg}`); },
      errorPages: { notFound: "/gone.html" },
    }).create();

    const res = await request(app).get("/no-such-page");
    expect(res.status).toBe(404);
    expect(said.join("\n")).toMatch(/not-found page/);

    // and says so once, not once per request: a scanner walking the site
    // would otherwise be the whole log
    const after = said.length;
    await request(app).get("/another-missing-page");
    expect(said.length).toBe(after);
  });

  it("is reachable as an ordinary page too, and then it is a 200", async () => {
    const dir = track(docroot({ "404.html": "<html><body><h1>Nothing here</h1></body></html>" }));
    const app = await new Server({ docroot: dir, mute: true }).create();
    const res = await request(app).get("/404.html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Nothing here");
  });

  it("is found without a restart when it appears later", async () => {
    const dir = track(docroot({ "index.html": "<html><body>hi</body></html>" }));
    const server = new Server({ docroot: dir, mute: true });
    const app = await server.create();
    expect((await request(app).get("/missing")).text).toBe("Not Found");

    fs.writeFileSync(path.join(dir, "404.html"), "<html><body><h1>Now here</h1></body></html>");
    // Polled rather than slept on. The watcher fires when the platform gets
    // round to it, so any single wait is either flaky or slow -- and this
    // test was the flaky one at half a second.
    let text = "";
    for (let i = 0; i < 60 && !text.includes("Now here"); i++) {
      await new Promise(r => setTimeout(r, 50));
      text = (await request(app).get("/missing")).text;
    }
    expect(text).toContain("Now here");
  }, 10000);
});

describe("a docroot that will not compile", () => {
  it("tells the visitor nothing about the source, outside dev mode", async () => {
    const dir = track(docroot({ "broken.html": BROKEN }));
    const app = await new Server({ docroot: dir, mute: true }).create();

    const res = await request(app).get("/broken.html");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("broken.html");
    expect(res.text).not.toContain(":IMPORT");
    expect(res.text).not.toContain("Page Error");
  });

  it("tells the log, in every mode", async () => {
    const dir = track(docroot({ "broken.html": BROKEN }));
    for (const dev of [false, true]) {
      const said: string[] = [];
      const app = await new Server({
        docroot: dir,
        dev,
        logger: (type, msg) => { said.push(`${type} ${msg}`); },
      }).create();
      said.length = 0;
      await request(app).get("/broken.html");
      // the detail the visitor no longer gets has to be SOMEWHERE, and this
      // is the party that can act on it
      expect(said.join("\n"), `dev: ${dev}`).toMatch(/broken\.html/);
      expect(said.join("\n"), `dev: ${dev}`).toMatch(/error/);
    }
  });

  it("keeps the detailed listing in dev mode", async () => {
    const dir = track(docroot({ "broken.html": BROKEN }));
    const app = await new Server({ docroot: dir, dev: true, mute: true }).create();
    const res = await request(app).get("/broken.html");
    expect(res.status).toBe(500);
    expect(res.text).toContain("Page Error");
    expect(res.text).toContain("broken.html");
  });

  it("serves a configured file of ready-made HTML instead", async () => {
    const dir = track(docroot({
      "broken.html": BROKEN,
      "500.html": "<html><body><h1>Something went wrong</h1></body></html>",
    }));
    const app = await new Server({
      docroot: dir,
      mute: true,
      errorPages: { error: "500.html" },
    }).create();

    const res = await request(app).get("/broken.html");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Something went wrong");
    // served verbatim, never compiled -- that is the whole point of it being
    // a file: it has to work when the compiler is the thing that is unwell
    expect(res.text).not.toContain("markout");
  });

  it("falls back to a bare 500 when that file cannot be read", async () => {
    const dir = track(docroot({ "broken.html": BROKEN }));
    const app = await new Server({
      docroot: dir,
      mute: true,
      errorPages: { error: "no-such-file.html" },
    }).create();
    const res = await request(app).get("/broken.html");
    expect(res.status).toBe(500);
    expect(res.text).toBe("Internal Server Error");
  });

  it("does not use the not-found page for a 500", async () => {
    const dir = track(docroot({
      "broken.html": BROKEN,
      "404.html": "<html><body><h1>Nothing here</h1></body></html>",
    }));
    const app = await new Server({ docroot: dir, mute: true }).create();
    const res = await request(app).get("/broken.html");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("Nothing here");
  });
});
