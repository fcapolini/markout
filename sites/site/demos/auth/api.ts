/**
 * The auth demo's service: three routes, a cookie, and a map of sessions.
 *
 * This file is the half markout has nothing to do with, and saying which
 * half that is IS the demo. The page next door is reactive markup around a
 * sign-in form; everything that decides whether a password is right, how
 * long a session lasts and what a browser is allowed to keep is here, in
 * ordinary Express, and would read the same behind any renderer.
 *
 * The seam between them is one line of `server.ts`:
 *
 *     requestGlobals: { user: sessionUser }
 *
 * which hands each page render whatever this file already authenticated.
 * `user` is then readable from a `:server-` value and nowhere else -- the
 * compiler is told the name and enforces it, so a page that tried to read it
 * in the browser fails to build rather than shipping empty.
 *
 * What is deliberately NOT here: password hashing, a user store, email
 * verification, a second factor, a CSRF token. Each of them is a real
 * application's answer to a question this demo does not have, and a stub for
 * one would teach the shape of the stub. What is here is the shape of the
 * boundary.
 *
 * In memory and per process, like the desk's tickets: what is being shown is
 * the seam, not the storage.
 */
import express, { type Request, type Response, type Router } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';

/**
 * The cookie's name and where it applies.
 *
 * Scoped to this demo's own path rather than to the site, which is not
 * tidiness: every other page here is public and cacheable, and a cookie on
 * `/` would travel with all of them and make each one look personalised to
 * anything in between.
 */
const COOKIE = 'markout_demo_session';
const COOKIE_PATH = '/demos/auth';

/** How long a demo session is worth keeping. */
const TTL_MS = 30 * 60_000;

/**
 * The one account, printed on the page.
 *
 * A demo with a secret credential is a demo nobody can try. A real one looks
 * this up and compares a hash; the comparison being trivial here is the
 * point at which this file stops being interesting, which is why it is one
 * line and not a module.
 */
const DEMO_EMAIL = 'ada@example.com';
const DEMO_PASSWORD = 'lovelace';

export interface Session {
  email: string;
  since: number;
}

/** sid -> session. Opaque ids: the cookie carries a lookup key, never a claim. */
const SESSIONS = new Map<string, Session>();

/** stands in for a real check, so the form's in-flight state has something to show */
function slow<T>(value: T, ms = 400): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

/**
 * The session id on a request, if it has one.
 *
 * Parsed by hand rather than with `cookie-parser`, to keep the demo's
 * dependency list honest: one cookie, one name, and no middleware the reader
 * has to go and read.
 */
function sidOf(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}

/** Expiry checked on read rather than on a timer: nothing has to sweep. */
function sessionOf(req: Request): (Session & { sid: string }) | null {
  const sid = sidOf(req);
  if (!sid) {
    return null;
  }
  const found = SESSIONS.get(sid);
  if (!found) {
    return null;
  }
  if (Date.now() - found.since > TTL_MS) {
    SESSIONS.delete(sid);
    return null;
  }
  return { ...found, sid };
}

/**
 * What a page is allowed to know about who is asking.
 *
 * This is the `requestGlobals` entry, and its return value is the whole
 * contract with the markup: an object with an email, or null. The session id
 * is NOT in it, and that omission is the one deliberate decision in this
 * function -- a `:server-` value's RESULT travels to the browser in the
 * page's state, readable by anyone who views source. `:server-` keeps the
 * expression off the client, not the answer.
 *
 * So the rule the page relies on: put in here only what the page would be
 * willing to print, because reading it is printing it.
 */
export function sessionUser(req: Request): { email: string; since: number } | null {
  const session = sessionOf(req);
  return session ? { email: session.email, since: session.since } : null;
}

function setCookie(res: Response, sid: string) {
  res.cookie(COOKIE, sid, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: TTL_MS,
  });
}

export function authApi(): Router {
  const api = express.Router();
  api.use(express.json());

  // Nothing here is about anything but who is asking. `server.ts` says the
  // same for the PAGE, and it has to be said twice because this router is
  // mounted before that middleware and therefore never reaches it -- which
  // is the order the whole file depends on, so it is not worth changing to
  // save a line. POST and DELETE are uncacheable anyway; `GET /session` is
  // the one that would otherwise be fair game.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  /**
   * Sign-in attempts, bounded.
   *
   * A public demo with an unlimited password endpoint is a public password
   * oracle. Ten a minute is far more than a person needs and far less than a
   * script wants.
   */
  const attempts = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Wait a minute and try again.' },
  });

  /**
   * Who is signed in, for anyone asking over HTTP.
   *
   * The page never calls it, and that absence is the demo: the cookie
   * arrives with the page REQUEST, so the render already knew, and there is
   * no "check who I am" round trip to wait for or to flash a spinner
   * through. It is here because a session resource without a GET is a
   * strange shape, and because it makes the whole thing explorable with
   * curl.
   */
  api.get('/session', (req, res) => {
    const session = sessionOf(req);
    res.json(session ? { email: session.email, since: session.since } : null);
  });

  /**
   * Sign in.
   *
   * Replies with what the page may show and a cookie the page cannot read.
   * The error is deliberately the same for an unknown address and a wrong
   * password: distinguishing them tells an attacker which half to keep.
   */
  api.post('/session', attempts, async (req, res) => {
    const email = `${req.body?.email ?? ''}`.trim().toLowerCase();
    const password = `${req.body?.password ?? ''}`;

    if (!email || !password) {
      return res.status(400).json({ error: 'An email address and a password, please.' });
    }

    const ok = await slow(email === DEMO_EMAIL && password === DEMO_PASSWORD);
    if (!ok) {
      return res.status(401).json({ error: 'That email and password do not match.' });
    }

    const sid = randomUUID();
    const session: Session = { email, since: Date.now() };
    SESSIONS.set(sid, session);
    setCookie(res, sid);
    res.status(201).json({ email: session.email, since: session.since });
  });

  /** Sign out: forget the session server-side, and clear the cookie. */
  api.delete('/session', (req, res) => {
    const sid = sidOf(req);
    if (sid) {
      SESSIONS.delete(sid);
    }
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    res.status(204).end();
  });

  return api;
}
