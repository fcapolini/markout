import path from 'path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Ticket } from '../../../../sites/site/demos/desk/api';
import { createSite } from '../../../../sites/site/server';

/** what `/tickets` answers with: a ticket without its thread */
type Summary = Omit<Ticket, 'messages'> & { replies: number; last: string };

/**
 * The desk demo, driven through the same app the dev server runs.
 *
 * It is the counterpart of Orbit: same architecture, opposite back end. Orbit
 * reads a directory of JSON files and needs no server at all, which is what
 * makes it deployable anywhere; the desk has a service of its own, and exists
 * to show the three things a file cannot do -- answer a question, answer one
 * that depends on another answer, and be written to.
 *
 * Driven over HTTP rather than by compiling the page with a stubbed `fetch`,
 * because half of what is under test is the arrangement itself: the
 * application's routes are mounted BEFORE markout, and a demo whose service
 * was stubbed out would not be checking that at all.
 */
describe('the desk demo: a page with a service of its own', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createSite({
      docroot: path.resolve(__dirname, '../../../../sites/site'),
    }).listen(0);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address() as import('net').AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const page = () => fetch(`${base}/demos/desk/`).then(r => r.text());
  const api = (pathname: string, init?: RequestInit) =>
    fetch(`${base}/demos/desk/api${pathname}`, init);
  const json = <T>(pathname: string, init?: RequestInit) =>
    api(pathname, init).then(r => r.json() as Promise<T>);

  it('answers its own routes before markout sees them', async () => {
    // the ordering the arrangement rests on: `/demos/desk/api/tickets` has no
    // extension, so it is a page request as far as markout is concerned. The
    // router is mounted first, which is the whole of what makes this an
    // application with markout in it rather than the other way round
    const res = await api('/tickets');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as Summary[]).length).toBeGreaterThan(0);
  });

  it('serves the list and a thread already in the markup', async () => {
    const markup = await page();
    // the list
    expect(markup).toContain('Invoice 4471 charged twice');
    // and the thread the list decided on, which is the second question: it
    // cannot be asked until the first has answered, so this text is here only
    // because the render waited twice
    expect(markup).toContain('We were charged twice for invoice 4471');
    // a thread that was NOT chosen is not in the page: the chain fetched one
    expect(markup).not.toContain('lands back on the sign-in page');
  });

  it('keeps the `:client` source out of what it publishes', async () => {
    // a served value is written into the markup in plain text, so anything
    // that should not be published must not be fetched while rendering
    const markup = await page();
    expect(markup).not.toContain('agent@markout.dev');
    expect(await json('/me')).toMatchObject({ signedInAs: 'agent@markout.dev' });
  });

  it('answers a question no file could', async () => {
    const all = await json<Summary[]>('/tickets');
    const matching = await json<Summary[]>('/tickets?q=sso');
    expect(matching).toHaveLength(1);
    expect(matching[0].subject).toContain('SSO');
    expect(all.length).toBeGreaterThan(matching.length);
    // the search reaches the messages, not just the subject line -- the point
    // being that what it searches is the server's business and the page never
    // sees the rows it did not match
    const deep = await json<Summary[]>('/tickets?q=reindex');
    expect(deep.map(t => t.id)).toStrictEqual(['t-307']);
  });

  it('takes a reply, and the next question answers differently', async () => {
    const before = await json<Ticket>('/tickets/t-308');
    const posted = await api('/tickets/t-308/replies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Any news on the webhook?' }),
    });
    expect(posted.status).toBe(201);

    const after = await json<Ticket>('/tickets/t-308');
    expect(after.messages).toHaveLength(before.messages.length + 1);
    expect(after.messages.at(-1)?.text).toBe('Any news on the webhook?');
    // which is why the page reloads both sources rather than one: the list's
    // summary counted the messages too
    const summary = await json<Summary[]>('/tickets');
    expect(summary.find(t => t.id === 't-308')?.replies).toBe(after.messages.length);
  });

  it('refuses an empty reply and an unknown ticket', async () => {
    expect(
      await api('/tickets/t-308/replies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      }).then(r => r.status)
    ).toBe(400);
    expect(
      await api('/tickets/nope/replies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello?' }),
      }).then(r => r.status)
    ).toBe(404);
    expect(await api('/tickets/nope').then(r => r.status)).toBe(404);
  });
});
