import { describe, expect, it } from 'vitest';
import { Page } from '../../../src/compiler/ir/Page';
import { stage1load } from '../../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../../src/compiler/stages/stage7-generate';
import { parse } from '../../../src/html/parser';
import { WebContext } from '../../../src/runtime/web/web-context';
import { loadProps } from '../../../src/render/props';

/**
 * `<:mode>` — a scope with no element of its own, acting on its parent's.
 *
 * Rule 3 of docs/design/conditional-scopes.md, first slice: handlers only.
 * A mode's whole point is the delta going on and coming off while the element
 * STAYS, which is what separates it from `:if` on the element (that takes the
 * markup away) and from a handler bound once and guarded from inside (which
 * goes on firing).
 *
 * Handlers first because they need no ownership model: binding and unbinding
 * are unambiguous. Paint and attributes are a set the element's own scope is
 * already diffing, and sharing that is the next slice — refused here in so
 * many words rather than half-done.
 */
function compile(html: string) {
  const page = new Page(parse(html, 'mode.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  return page;
}

function live(html: string) {
  const page = compile(html);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) {
    return { errors, ctx: undefined, doc: undefined };
  }
  stage7generate(page);
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: () => {
      /* the cases here have none, and a thrown one would fail louder */
    },
  }).refresh();
  return { errors, ctx, doc: page.source.doc };
}

/** the server DOM has no querySelector, and one tag is all these need */
function find(node: any, tag: string): any {
  if (node?.tagName === tag) return node;
  for (const child of node?.childNodes ?? []) {
    const found = find(child, tag);
    if (found) return found;
  }
  return undefined;
}

describe('<:mode>', () => {
  it('binds its handler to the element above it, and lets go on the way out', () => {
    const r = live(
      '<html :on=${true}><body><div id="p">' +
        '<:mode :if=${on} :on-ping=${() => 1} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');

    // `addEventListener` is a no-op on the server DOM, so the calls are what
    // there is to observe -- and they are the whole behaviour anyway
    const log: string[] = [];
    el.addEventListener = (type: string) => log.push(`add ${type}`);
    el.removeEventListener = (type: string) => log.push(`remove ${type}`);

    r.ctx!.root.proxy.on = false;
    expect(log).toStrictEqual(['remove ping']);

    log.length = 0;
    r.ctx!.root.proxy.on = true;
    // re-added rather than rebuilt: the value that first bound it is
    // re-evaluated on the way back, and the branch that calls
    // `addEventListener` runs once, when a value is constructed
    expect(log).toStrictEqual(['add ping']);
  });

  it('leaves the element it borrowed exactly where it was', () => {
    // the failure this guards is severe and quiet: everything that disposes a
    // scope removes the DOM that scope owns, and a mode owns none of it
    const r = live(
      '<html :on=${true}><body><div id="p">' +
        '<:mode :if=${on} :on-ping=${() => 1} />x</div></body></html>'
    );
    r.ctx!.root.proxy.on = false;
    expect(find((r.doc as any).documentElement, 'DIV')).toBeTruthy();
    r.ctx!.root.proxy.on = true;
    expect(find((r.doc as any).documentElement, 'DIV')).toBeTruthy();
  });

  it('gives its parent element a scope, so it acts on the right one', () => {
    // a plain <div> needs no scope of its own, and without one the mode would
    // borrow whatever scoped ancestor came next -- painting <body> instead
    const r = live(
      '<html><body><div id="p"><:mode :on-ping=${() => 1} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');
    expect(el.getAttribute('data-markout')).toBeTruthy();
  });

  it('refuses replication, which is an arity it has no answer for', () => {
    const page = compile(
      '<html><body><div><:mode :for-each=${[1, 2]} /></div></body></html>'
    );
    expect(page.errors.map(e => e.msg).join()).toMatch(
      /is one delta on one element, so there is nothing to replicate/
    );
  });

  it('refuses what it cannot hand back, and says which is which', () => {
    const cases: [string, RegExp][] = [
      // a DOM property is state on the element itself, so there is no
      // declaration underneath for a mode to hand it back to
      [':prop-value=${1}', /nothing underneath to hand it back to/],
      // and a static plain attribute would be written nowhere at all
      ['title="t"', /needs "title" to be an expression/],
    ];
    for (const [attr, message] of cases) {
      const page = compile(`<html><body><div><:mode ${attr} /></div></body></html>`);
      expect(page.errors.map(e => e.msg).join(), attr).toMatch(message);
    }
  });

  /** the class of the one <div> these cases paint */
  const painted = (r: { doc: any }) =>
    find((r.doc as any).documentElement, 'DIV').className;

  it('paints the borrowed element, and takes it back off', () => {
    const r = live(
      '<html :on=${false}><body><div class="card">' +
        '<:mode :if=${on} :class-dragging />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(painted(r as any)).toBe('card');
    r.ctx!.root.proxy.on = true;
    expect(painted(r as any)).toBe('card dragging');
    r.ctx!.root.proxy.on = false;
    expect(painted(r as any)).toBe('card');
  });

  it('claims none of the element own classes, and loses none of them', () => {
    // the reason a mode's base is EMPTY where an element's own scope starts
    // from what the markup wrote: everything already on a borrowed element
    // belongs to whoever owns it, and a mode that took that as its base would
    // adopt those classes and then hand them back as its own set moved
    const r = live(
      '<html :on=${true} :big=${false}><body>' +
        '<div class="card" :class-big=${big}>' +
        '<:mode :if=${on} :class-dragging />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(painted(r as any)).toBe('card dragging');

    // the element's OWN scope changes its class while the mode is on
    r.ctx!.root.proxy.big = true;
    expect(painted(r as any)).toBe('card dragging big');

    // and the mode leaving takes exactly its own with it
    r.ctx!.root.proxy.on = false;
    expect(painted(r as any)).toBe('card big');
  });

  it('takes its paint off when it has children too', () => {
    // with children a mode is a replica and is DISPOSED rather than disarmed,
    // so the paint has to come off there as well -- everything else that
    // disposes removes the element and takes its classes with it
    const r = live(
      '<html :on=${false}><body><div class="card">' +
        '<:mode :if=${on} :class-dragging><b>k</b></:mode></div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    r.ctx!.root.proxy.on = true;
    expect(painted(r as any)).toBe('card dragging');
    r.ctx!.root.proxy.on = false;
    expect(painted(r as any)).toBe('card');
  });

  it('sets an attribute nobody else declares, and takes it away again', () => {
    const r = live(
      '<html :on=${false}><body><div>' +
        '<:mode :if=${on} :attr-draggable=${true} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');
    expect(el.getAttribute('draggable')).toBe(null);
    r.ctx!.root.proxy.on = true;
    expect(el.getAttribute('draggable')).toBe('');
    r.ctx!.root.proxy.on = false;
    // it existed only because the mode did
    expect(el.getAttribute('draggable')).toBe(null);
  });

  it('overrides one the element declares, and hands it back', () => {
    // nothing is remembered: what an element's `title` is, is whatever the
    // innermost live declaration says, and the one underneath was live the
    // whole time -- so handing back is asking it to say again
    const r = live(
      '<html :on=${false} :t=${"base"}><body>' +
        '<div title=${t}><:mode :if=${on} title=${"MODE"} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');
    expect(el.getAttribute('title')).toBe('base');

    r.ctx!.root.proxy.on = true;
    expect(el.getAttribute('title')).toBe('MODE');

    r.ctx!.root.proxy.on = false;
    expect(el.getAttribute('title')).toBe('base');

    // and the element's own declaration was never anything but live
    r.ctx!.root.proxy.t = 'CHANGED';
    expect(el.getAttribute('title')).toBe('CHANGED');
  });

  it('refuses two modes claiming one attribute at the same rank', () => {
    const page = compile(
      '<html :a=${true} :b=${true}><body><div>' +
        '<:mode :if=${a} :attr-hidden=${true} />' +
        '<:mode :if=${b} :attr-hidden=${false} />x</div></body></html>'
    );
    expect(page.errors.map(e => e.msg).join()).toMatch(
      /both set "hidden" at priority 0/
    );
    // and names the spelling that lifts it, rather than only what does not work
    expect(page.errors.map(e => e.msg).join()).toMatch(/":priority"/);
  });

  it('lets declared ranks decide, and hands back down the stack', () => {
    const r = live(
      '<html :a=${false} :b=${false}><body><div title=${"base"}>' +
        '<:mode :if=${a} title=${"LOW"} />' +
        '<:mode :if=${b} :priority=${1} title=${"HIGH"} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');
    expect(el.getAttribute('title')).toBe('base');

    r.ctx!.root.proxy.a = true;
    expect(el.getAttribute('title')).toBe('LOW');

    // the higher rank takes it while both are on
    r.ctx!.root.proxy.b = true;
    expect(el.getAttribute('title')).toBe('HIGH');

    // and gives it back to the one still underneath, not to the element
    r.ctx!.root.proxy.b = false;
    expect(el.getAttribute('title')).toBe('LOW');

    r.ctx!.root.proxy.a = false;
    expect(el.getAttribute('title')).toBe('base');
  });

  it('refuses a rank it cannot decide at compile time', () => {
    // one worked out while the page runs could tie, and the error this exists
    // to give would arrive as a silent last-write-wins instead
    const page = compile(
      '<html :n=${2}><body><div><:mode :priority=${n} :attr-x=${1} /></div></body></html>'
    );
    expect(page.errors.map(e => e.msg).join()).toMatch(
      /has to be a number written here/
    );
  });

  it('lets two modes add the same class, which is no conflict at all', () => {
    // the difference the refusal above turns on: a class list is a set
    const page = compile(
      '<html :a=${true} :b=${true}><body><div>' +
        '<:mode :if=${a} :class-busy />' +
        '<:mode :if=${b} :class-busy />x</div></body></html>'
    );
    expect(page.errors).toStrictEqual([]);
  });

  it('styles the borrowed element without disturbing its own', () => {
    const r = live(
      '<html :on=${false} :c=${"red"}><body>' +
        '<div :style-color=${c}>' +
        '<:mode :if=${on} :style-opacity=${"0.5"} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const css = () => find((r.doc as any).documentElement, 'DIV').style.cssText;
    expect(css()).toBe('color: red;');

    r.ctx!.root.proxy.on = true;
    expect(css()).toBe('color: red; opacity: 0.5;');

    r.ctx!.root.proxy.on = false;
    expect(css()).toBe('color: red;');

    // and the element's own declaration is still live afterwards
    r.ctx!.root.proxy.c = 'blue';
    expect(css()).toBe('color: blue;');
  });

  it('hands a style property back to the element that declared it', () => {
    // the one that needs the owner's record of having applied it cleared as
    // well: its re-say would otherwise diff against what it last wrote, which
    // is true of that and not of the element, no longer having the property
    const r = live(
      '<html :on=${false} :c=${"red"}><body>' +
        '<div :style-color=${c}>' +
        '<:mode :if=${on} :style-color=${"green"} />x</div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const css = () => find((r.doc as any).documentElement, 'DIV').style.cssText;
    expect(css()).toBe('color: red;');
    r.ctx!.root.proxy.on = true;
    expect(css()).toBe('color: green;');
    r.ctx!.root.proxy.on = false;
    expect(css()).toBe('color: red;');
  });

  it('builds and destroys its children, rather than parking them', () => {
    // the one place a mode departs from the region machinery instead of
    // reusing it: every region here PRESERVES, so that a hide keeps focus, a
    // scroll offset, a playing video. A modality wants the opposite -- its
    // markup and its state go, so the next one starts clean
    const r = live(
      '<html :on=${false}><body><div id="p">' +
        '<:mode :if=${on} :_draft=${"start"}><b>${_draft}</b></:mode>' +
        '<i>t</i></div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const body = () => {
      const s = (r.doc as any).toString();
      return s
        .slice(s.indexOf('<body'), s.indexOf('<script'))
        .replace(/<!--.*?-->/g, '')
        .replace(/\s+/g, ' ');
    };
    expect(body()).not.toContain('<b>');

    r.ctx!.root.proxy.on = true;
    expect(body()).toContain('<b>start</b>');
    // written where the tag was: before the sibling that followed it
    expect(body().indexOf('<b>')).toBeLessThan(body().indexOf('<i>'));

    // edit the modality's own state, then take the modality away and back
    const all: any[] = [];
    const walk = (s: any) => {
      all.push(s);
      (s.children ?? []).forEach(walk);
      (s.clones ?? []).forEach(walk);
    };
    walk((r.ctx as any).root);
    const replica = all.find(s => s.cloned && s.values?._draft);
    expect(replica).toBeTruthy();
    replica.proxy._draft = 'EDITED';
    expect(body()).toContain('<b>EDITED</b>');

    r.ctx!.root.proxy.on = false;
    expect(body()).not.toContain('<b>');
    r.ctx!.root.proxy.on = true;
    // start, not EDITED: the draft died with the edit, which is the whole
    // reason this is a replica and not a region
    expect(body()).toContain('<b>start</b>');
  });

  it('binds on the borrowed element once, with children in play', () => {
    const r = live(
      '<html :on=${true}><body><div id="p">' +
        '<:mode :if=${on} :on-ping=${() => 1}><b>x</b></:mode></div></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const el = find((r.doc as any).documentElement, 'DIV');
    const log: string[] = [];
    el.addEventListener = (type: string) => log.push(`add ${type}`);
    el.removeEventListener = (type: string) => log.push(`remove ${type}`);

    r.ctx!.root.proxy.on = false;
    expect(log).toStrictEqual(['remove ping']);

    log.length = 0;
    r.ctx!.root.proxy.on = true;
    // once. The host of the replication borrows the same element its replica
    // does, and a page seeing every event twice is what that costs
    expect(log).toStrictEqual(['add ping']);
  });
});
