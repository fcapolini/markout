import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnostics';
import { forgetPages, hostPageFor } from '../src/pages';

/**
 * Diagnostics for a `.htm` fragment, which is not a page.
 *
 * It used to get none at all, on the reasoning that a fragment has no scope
 * chain of its own. That is half true, and the half that is false is where
 * kit authors spend their time.
 *
 * Compiling one ON ITS OWN does not work: its `<:import>`s are then not
 * inside a `<head>`, because it has no head, and 37 of the 45 fragments in
 * this repository would light up with a rule they do not break. So it is
 * compiled the way it is used -- through a page that imports it.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-frag-'));
  forgetPages();
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(docroot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return text;
}

const KIT = [
  '<lib>',
  '  <:import src="/base.htm" />',
  '  <:define tag="x-card:div" :title=${1}>',
  '    <h2>${title}</h2>',
  '  </:define>',
  '</lib>',
].join('\n');

async function diagnoseFragment(rel: string, text: string) {
  return diagnose({ docroot, pathname: `/${rel}`, text });
}

describe('a fragment nothing imports', () => {
  it('is clean, imports and all', async () => {
    // the case that made a naive check useless: `<:import>` is legal only
    // directly in a head, and a fragment compiled alone has none
    write('base.htm', '<lib><style>.a{}</style></lib>');
    const text = write('card.htm', KIT);
    expect(await diagnoseFragment('card.htm', text)).toStrictEqual([]);
  });

  it('reports a mistake in it, in the fragment itself', async () => {
    write('base.htm', '<lib><style>.a{}</style></lib>');
    const text = write('card.htm', KIT.replace('${title}', '${titel}'));
    const [found, ...rest] = await diagnoseFragment('card.htm', text);
    expect(rest).toStrictEqual([]);
    expect(found.message).toMatch(/titel/);
    expect(found.pathname).toBe('/card.htm');
    expect(found.range.start.line).toBe(3);
  });
});

describe('a fragment a page does import', () => {
  it('is checked through that page, so its host names resolve', async () => {
    // an `<:include>`d fragment is an INSTANCE, and instances resolve names
    // where they are written. On its own, every name its host supplies reads
    // as unknown -- which is the noisiest possible way to be wrong
    write('parts.htm', '<lib><p>${greeting}</p></lib>');
    write('index.html', '<html :greeting=${"hi"}><body><:include src="/parts.htm" /></body></html>');
    const text = fs.readFileSync(path.join(docroot, 'parts.htm'), 'utf8');
    expect(await diagnoseFragment('parts.htm', text)).toStrictEqual([]);
  });

  it('finds the page that names it', () => {
    write('index.html', '<html><head><:import src="/lib.htm" /></head></html>');
    write('other.html', '<html></html>');
    expect(hostPageFor(docroot, '/lib.htm')).toBe('/index.html');
    expect(hostPageFor(docroot, '/nobody.htm')).toBeUndefined();
  });

  it('still reports a mistake that belongs to the fragment', async () => {
    write('parts.htm', '<lib><p>${greeting} ${nope}</p></lib>');
    write('index.html', '<html :greeting=${"hi"}><body><:include src="/parts.htm" /></body></html>');
    const text = fs.readFileSync(path.join(docroot, 'parts.htm'), 'utf8');
    const found = await diagnoseFragment('parts.htm', text);
    expect(found.map(d => d.message)).toStrictEqual(['Unknown reference: "nope"']);
    expect(found[0].pathname).toBe('/parts.htm');
  });
});

describe('what a page costs to ask about twice', () => {
  it('is compiled once for the same buffer', async () => {
    // one keystroke asks for diagnostics, completion, a definition and a
    // hover, and compiling is the expensive part of each
    const text = write('index.html', '<html :n=${1}><body>${n}</body></html>');
    const first = Date.now();
    await diagnose({ docroot, pathname: '/index.html', text });
    const cold = Date.now() - first;

    const second = Date.now();
    for (let i = 0; i < 8; i++) {
      await diagnose({ docroot, pathname: '/index.html', text });
    }
    const warm = Date.now() - second;
    // eight of them together well inside the cost of the one
    expect(warm).toBeLessThanOrEqual(Math.max(cold, 5));
  });

  it('is compiled again once the buffer changes', async () => {
    write('index.html', '<html :n=${1}><body>${n}</body></html>');
    expect(
      await diagnose({ docroot, pathname: '/index.html', text: '<html><body>${n}</body></html>' })
    ).toHaveLength(1);
    expect(
      await diagnose({
        docroot,
        pathname: '/index.html',
        text: '<html :n=${1}><body>${n}</body></html>',
      })
    ).toStrictEqual([]);
  });
});
