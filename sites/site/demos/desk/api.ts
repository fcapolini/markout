/**
 * The desk's service: five routes and a list of tickets in memory.
 *
 * This is the half of the demo markout has nothing to do with. It is an
 * ordinary Express router, mounted by `sites/site/server.ts` BEFORE the
 * markout middleware, and that order is the whole arrangement: the
 * application answers what is its own, markout answers what is left, and a
 * path with no extension is a page request.
 *
 * Written in Node because this repository is, and for no other reason. What
 * the page below it needs is a URL that answers with JSON -- see
 * `demos/orbit/`, which is the same architecture with the service replaced by
 * a directory of files.
 *
 * In memory, and deliberately: what is being shown is the seam, not the
 * storage. Replies are kept, so the demo is not read-only, and they last as
 * long as the process does.
 */
import express, { Router } from 'express';

export interface Message {
  who: string;
  text: string;
  /** minutes ago */
  ago: number;
}

export interface Ticket {
  id: string;
  subject: string;
  from: string;
  state: 'open' | 'waiting' | 'closed';
  tag: string;
  ago: number;
  messages: Message[];
}

/** what a reply may be, so a public demo cannot be filled up */
const MAX_REPLY = 400;
const MAX_MESSAGES = 40;

const TICKETS: Ticket[] = [
  {
    id: 't-311', subject: 'Invoice 4471 charged twice', from: 'mira@fieldnotes.io',
    state: 'open', tag: 'billing', ago: 14,
    messages: [
      { who: 'mira@fieldnotes.io', ago: 14,
        text: 'We were charged twice for invoice 4471 this morning. Same amount, two minutes apart.' },
      { who: 'ada', ago: 9,
        text: 'Thanks Mira — I can see both charges. Refunding the second now; it should clear in a day or two.' },
    ],
  },
  {
    id: 't-310', subject: 'SSO login loops back to the sign-in page', from: 'devops@northwind.dev',
    state: 'open', tag: 'auth', ago: 51,
    messages: [
      { who: 'devops@northwind.dev', ago: 51,
        text: 'Since this morning our SSO users land back on the sign-in page instead of the dashboard.' },
      { who: 'grace', ago: 40,
        text: 'That matches a pool resize we did last night. Can you tell me whether it affects every user or only new sessions?' },
      { who: 'devops@northwind.dev', ago: 33, text: 'Only new sessions. Existing ones are fine.' },
    ],
  },
  {
    id: 't-309', subject: 'Export finishes but the CSV is empty', from: 'p.okafor@lumen.co',
    state: 'waiting', tag: 'exports', ago: 190,
    messages: [
      { who: 'p.okafor@lumen.co', ago: 190,
        text: 'The export job says it succeeded, but the file I download has headers and nothing else.' },
      { who: 'karen', ago: 150,
        text: 'Could you send me the export id from the job page? I would like to look at that run in particular.' },
    ],
  },
  {
    id: 't-308', subject: 'Add a webhook for deploy failures', from: 'sam@paperlane.app',
    state: 'waiting', tag: 'feature', ago: 420,
    messages: [
      { who: 'sam@paperlane.app', ago: 420,
        text: 'We would like a webhook when a deploy fails, so it can go straight into our incident channel.' },
      { who: 'barbara', ago: 300,
        text: 'Noted, and it is on the roadmap for this quarter. I will keep this open so you hear about it first.' },
    ],
  },
  {
    id: 't-307', subject: 'Search misses documents with accents', from: 'lea@atlasmaps.fr',
    state: 'closed', tag: 'search', ago: 2600,
    messages: [
      { who: 'lea@atlasmaps.fr', ago: 2600, text: 'Searching for "métro" returns nothing, but "metro" finds the documents.' },
      { who: 'karen', ago: 2400, text: 'Fixed in this morning\'s reindex — both spellings match now. Thanks for the report.' },
    ],
  },
];

/** stands in for a round trip, so a render has something real to wait on */
function slow<T>(value: T, ms = 20): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

/** what the list shows: everything but the thread */
function summarize(t: Ticket) {
  return {
    id: t.id, subject: t.subject, from: t.from, state: t.state, tag: t.tag, ago: t.ago,
    replies: t.messages.length,
    last: t.messages[t.messages.length - 1]?.text ?? '',
  };
}

export function deskApi(): Router {
  const api = Router();
  api.use(express.json());

  /**
   * The list, filtered HERE.
   *
   * Which is the whole reason this demo has a server: `?q=` is a question
   * about data the page does not have, and no arrangement of files answers
   * it. The page puts what was typed into this URL, and a URL that changes
   * is a datasource that refetches.
   */
  api.get('/tickets', async (req, res) => {
    const q = `${req.query.q ?? ''}`.trim().toLowerCase();
    const state = `${req.query.state ?? ''}`;
    const found = TICKETS.filter(t =>
      (!state || t.state === state) &&
      (!q ||
        t.subject.toLowerCase().includes(q) ||
        t.from.toLowerCase().includes(q) ||
        t.tag.includes(q) ||
        t.messages.some(m => m.text.toLowerCase().includes(q)))
    );
    res.json(await slow(found.map(summarize)));
  });

  /**
   * One thread, which is the second link of a chain: the page cannot ask for
   * it until the list has answered, because which ticket to show is decided
   * by which ones matched. The render waits for the first, then for the
   * second, and still serves a finished page.
   */
  api.get('/tickets/:id', async (req, res) => {
    const found = TICKETS.find(t => t.id === req.params.id);
    found ? res.json(await slow(found)) : res.sendStatus(404);
  });

  /**
   * A reply, which is the direction a datasource does not go.
   *
   * `std-data` reads; writing is an ordinary `fetch` in an `:on-click`
   * handler, followed by `reload()`. Nothing in markout is involved, and
   * nothing needs to be: what a write changes is the answer to a question the
   * page already knows how to ask.
   */
  api.post('/tickets/:id/replies', (req, res) => {
    const found = TICKETS.find(t => t.id === req.params.id);
    if (!found) {
      return res.sendStatus(404);
    }
    const text = `${req.body?.text ?? ''}`.trim().slice(0, MAX_REPLY);
    if (!text) {
      return res.status(400).json({ error: 'a reply needs some text' });
    }
    if (found.messages.length >= MAX_MESSAGES) {
      return res.status(409).json({ error: 'this thread has all the replies it can hold' });
    }
    const message: Message = { who: 'you', text, ago: 0 };
    found.messages.push(message);
    found.state = 'waiting';
    res.status(201).json(message);
  });

  /**
   * Who is at the desk, and the one thing here that must NOT travel in the
   * page. A served value is written into the markup as plain text, where
   * anyone who views source can read it -- so the page fetches this one with
   * `:client`, in the browser, after it has arrived.
   */
  api.get('/me', (_req, res) => {
    res.json({ name: 'you', signedInAs: 'agent@markout.dev', queue: 'front desk' });
  });

  return api;
}
