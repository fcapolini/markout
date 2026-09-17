import path from 'path';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../packages/core/src/compiler';
import { renderPage } from '../packages/core/src/render/render';
import { hydrate } from '../packages/core/src/render/hydrate';
import { discoverKits } from '../packages/core/src/kits';

/**
 * The auth demo keeps the two promises it makes.
 *
 * `sites/site/demos/auth/` exists to answer "can a reactive page in markup
 * be trusted with a login", and it answers it with two properties a reader
 * is invited to check by viewing source. Both are the kind that go on
 * looking right while being wrong -- a page that leaks the signed-in markup
 * renders identically to one that does not -- so neither is left to a reader
 * remembering to look.
 *
 * The third test is the form itself, which the server render cannot show
 * anything about: served signed-out, every interesting state of it (a valid
 * field, a disabled button that becomes enabled) exists only once the page
 * is alive.
 *
 * The recipe is docs/reference/testing.md's, with `serverGlobals` and
 * `globals` standing in for what `server.ts` wires to `sessionUser`.
 */

const DOCROOT = path.resolve(__dirname, '..', 'sites', 'site');
const PAGE = '/demos/auth/index.html';

type Me = { email: string; since: number } | null;

/**
 * Discovered from the site's own `node_modules`, the way the middleware does
 * it: the page imports `/npm/@markout-lang/bootstrap-kit/all.htm`, and
 * without the mounted kits that import is an unresolved path rather than a
 * component library.
 */
const kits = discoverKits(DOCROOT, [path.join(DOCROOT, 'node_modules')]).kits;

async function served(me: Me) {
  const page = await new Compiler({
    docroot: DOCROOT,
    serverGlobals: ['user'],
    kits,
  }).compile(PAGE);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);

  const failed = await renderPage(page, { globals: { user: me } });
  expect(failed.map(e => e.message)).toStrictEqual([]);

  return { page, html: page.source.doc.toString() };
}

/**
 * The response with the stencils and markout's own `<script>`s taken out:
 * what a visitor SEES, as against what the response carries.
 *
 * Both have to go, and the scripts for the reason LAST-MILE.md gives: a
 * `:server-if` takes markup and leaves logic, so `::label="Email address"`
 * is a literal in the page's props whichever branch showed. That is the
 * documented behaviour rather than a leak of this page's, and asserting
 * against the raw response would be asserting against it.
 */
function rendered(html: string): string {
  return html
    .replace(/<template>[\s\S]*?<\/template>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
}

const SIGNED_IN = 'ada@example.com';

describe('what a signed-out visitor receives', () => {
  it('does not include the signed-in markup, in the response at all', async () => {
    const out = await served(null);

    // the branch is `:server-if`, so this is the whole response and not just
    // the rendered part: no stencil either, because a decision the server
    // froze is one the browser will never turn
    expect(out.html).not.toContain('Session started');
    expect(out.html).not.toContain('Rendered by the server, which knew');
  });

  it('and does include the form', async () => {
    const out = await served(null);
    expect(rendered(out.html)).toContain('Email address');
  });

  /**
   * The reason the protected branch is written in plain markup rather than
   * in the kit's components, and a guard on that decision: a `<bs-card>` in
   * there would put its markup back into this page through a stencil of its
   * own. See `leaves a component used inside the branch -- a KNOWN GAP` in
   * packages/core/test/render/server-if.test.ts, and LAST-MILE.md.
   *
   * Pinned here as well as there because the gap is general and this is the
   * page that is exposed by it. If the workaround is ever undone -- by
   * someone tidying the two branches into matching components -- this fails
   * with the reason, next to the page it is about.
   */
  it('and no component smuggles the signed-in markup back in', async () => {
    const out = await served(null);
    expect(out.html).not.toContain('Signed in');
  });
});

describe('what a signed-in visitor receives', () => {
  it('has the session in the HTML, rendered rather than fetched', async () => {
    const out = await served({ email: SIGNED_IN, since: Date.now() });

    // the claim the demo asks to be checked by viewing source: no spinner,
    // no second request, and no flash of the login screen
    expect(rendered(out.html)).toContain(SIGNED_IN);
    expect(rendered(out.html)).toContain('Signed in');
  });

  it('and not the sign-in form', async () => {
    const out = await served({ email: SIGNED_IN, since: Date.now() });
    expect(rendered(out.html)).not.toContain('Email address');
  });
});

describe('the form, once the page is alive', () => {
  async function mounted() {
    const out = await served(null);
    const window = new Window({ url: 'http://x.test/demos/auth/' });
    window.document.write(out.html);
    const m = hydrate(out.page, { doc: window.document as any });

    // `bs-theme-auto` / `bs-theme-toggle` reach for
    // `document.documentElement` to set Bootstrap's colour mode, and
    // happy-dom does not give the handler one. An artifact of the DOM this
    // runs against rather than anything about this page, and dropped by KEY
    // so that a real failure in a value of its own is still reported
    const errors = m.errors
      .filter(e => e.key !== 'handle$_theme')
      .map(e => `${e.key}: ${e.message}`);
    expect(errors).toStrictEqual([]);

    return { doc: window.document, root: m.root as any };
  }

  /**
   * The form's own scope: `<div :aka="signin">` inside the `:else`, holding
   * `busy`, `failed`, `submit` and the two fields' `:aka` names.
   */
  function form(root: any) {
    const signin = root.body?.signin;
    expect(signin).toBeTruthy();
    return signin;
  }

  it('opens with both fields neutral and the button disabled', async () => {
    const { doc } = await mounted();

    // `::required` is deliberately absent from the password: empty has to
    // leave `.valid` false WITHOUT painting the field red before anyone has
    // typed. The comment in the page says why, and this is that comment
    // asserted -- it regressed once already
    expect(doc.querySelectorAll('.is-invalid').length).toBe(0);
    expect(doc.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(
      true
    );
  });

  it('enables the button once both fields are valid', async () => {
    const { doc, root } = await mounted();
    const f = form(root);

    // driven through the values rather than through keystrokes: what is
    // being checked is that the button reads them, and `bs-input` keeps
    // `::value` in step with typing on its own account
    const email = f.email as any;
    const password = f.password as any;

    email.value = 'ada@example.com';
    password.value = 'lovelace';

    expect(email.valid).toBe(true);
    expect(password.valid).toBe(true);
    expect(doc.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(
      false
    );
  });

  it('shows the email field as invalid only once it is wrong, not while empty', async () => {
    const { doc, root } = await mounted();
    const f = form(root);

    (f.email as any).value = 'not-an-address';
    expect(doc.querySelectorAll('.is-invalid').length).toBe(1);

    (f.email as any).value = '';
    expect(doc.querySelectorAll('.is-invalid').length).toBe(0);
  });

  it('disables both fields and relabels the button while a request is in flight', async () => {
    const { doc, root } = await mounted();
    const f = form(root);

    f.busy = true;

    expect(doc.querySelector('input[type="email"]')?.hasAttribute('disabled')).toBe(
      true
    );
    expect(doc.querySelector('input[type="password"]')?.hasAttribute('disabled')).toBe(
      true
    );
    expect(doc.querySelector('button[type="submit"]')?.textContent).toContain(
      'Signing in'
    );
  });

  it("puts the server's error in the page, and takes it away again", async () => {
    const { doc, root } = await mounted();
    const f = form(root);

    f.failed = 'That email and password do not match.';
    expect(doc.querySelector('.alert-danger')?.textContent).toContain(
      'do not match'
    );

    f.failed = null;
    expect(doc.querySelector('.alert-danger')).toBeFalsy();
  });
});
