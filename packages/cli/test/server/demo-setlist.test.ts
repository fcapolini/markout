import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { Server } from '../../src/server';

/**
 * Drives the real demo/setlist page, not a copy of it.
 *
 * That is possible because this demo depends on nothing but markout: its
 * chrome is <:define> components rather than a component library off a CDN,
 * so the whole thing renders and hydrates inside happy-dom. The other demos
 * can't be tested this way, which is itself the point being made here.
 *
 * What it has to prove is composition under replication: components nested
 * two deep, slotted content whose expressions resolve at the call site, and
 * a keyed list whose rows are moved rather than rebuilt.
 *
 * A cue note is part of its track, not state stranded in an <input>, so the
 * assertions come in pairs: what the element shows, and what the data holds.
 * Only the second would survive being saved.
 */
describe('demo/setlist', () => {
  let server: Server;

  beforeAll(async () => {
    server = await new Server({
      docroot: path.resolve(__dirname, '../../../../demo'),
      port: 0,
      logger: () => {},
    }).start();
  });

  afterAll(async () => {
    await server.stop();
  });

  async function open() {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    const page = browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/setlist/index.html`);
    await page.waitUntilComplete();
    const doc = page.mainFrame.document;
    return {
      browser,
      doc,
      window: page.mainFrame.window,
      rows: () => [...doc.querySelectorAll('.row')],
      names: () => [...doc.querySelectorAll('.row h3')].map(n => n.textContent),
      positions: () => [...doc.querySelectorAll('.row .pos')].map(n => n.textContent),
      notes: () => [...doc.querySelectorAll('.row input')].map(i => (i as any).value),
      // what the DATA holds, as opposed to what the user typed into the
      // element: the attribute is written by the binding, so it only says
      // this once the note has been round-tripped through `tracks`
      stored: () =>
        [...doc.querySelectorAll('.row input')].map(i => i.getAttribute('value')),
      type: (el: any, text: string) => {
        (el as any).value = text;
        el.dispatchEvent(new page.mainFrame.window.Event('input', { bubbles: true }));
      },
      click: (el: any) => el.dispatchEvent(new page.mainFrame.window.MouseEvent('click')),
    };
  }

  it('expands both component levels, with slotted content reading the call site', async () => {
    const { browser, doc, names } = await open();
    try {
      // no custom tag survives into the served DOM: each was replaced by its
      // definition's base tag
      expect(doc.querySelector('rig-panel')).toBeNull();
      expect(doc.querySelector('rig-row')).toBeNull();
      expect(doc.querySelector('rig-note')).toBeNull();
      expect(doc.querySelector('section.panel')).not.toBeNull();

      // the outer component's own values rendered
      expect(doc.querySelector('.panel-head h2')!.textContent).toBe('Running order');
      // a component instantiated once per replica, reading that replica's item
      expect(names()).toEqual([
        'Lantern Season', 'Quarry Light', 'Last Ferry', 'Northern Gale',
      ]);
      // ...and a SECOND component nested inside the first one's slot, whose
      // own value is an expression written at the call site, inside the loop
      expect([...doc.querySelectorAll('.note-caption')].map(n => n.textContent)).toEqual([
        'Cue for Lantern Season', 'Cue for Quarry Light',
        'Cue for Last Ferry', 'Cue for Northern Gale',
      ]);
      // slotted into a NAMED slot, and still bound to the loop's item
      const up = doc.querySelectorAll('.row-actions button')[0];
      expect(up.getAttribute('aria-label')).toBe('Move Lantern Season earlier');
    } finally {
      await browser.close();
    }
  });

  it('moves a row and its typed-in note together, and renumbers around them', async () => {
    const { browser, names, positions, notes, stored, rows, type, click } = await open();
    try {
      // typing folds the note into `tracks`, so it is the song's, not the
      // element's -- the written-back attribute is the proof of the round trip
      const ferryRow = rows()[2];
      type(ferryRow.querySelector('input'), 'capo 3');
      expect(notes()).toEqual(['', '', 'capo 3', '']);
      expect(stored()).toEqual(['', '', 'capo 3', '']);

      // move Last Ferry up one
      click(ferryRow.querySelectorAll('.row-actions button')[0]);

      expect(names()).toEqual([
        'Lantern Season', 'Last Ferry', 'Quarry Light', 'Northern Gale',
      ]);
      // the very same element, moved rather than rewritten
      expect(rows()[1]).toBe(ferryRow);
      expect(notes()).toEqual(['', 'capo 3', '', '']);
      // and it moved because the DATA moved, not because the element did
      expect(stored()).toEqual(['', 'capo 3', '', '']);
      // positions are derived from the array, so they renumber in place
      expect(positions()).toEqual(['1', '2', '3', '4']);
    } finally {
      await browser.close();
    }
  });

  it('survives reversing the whole list', async () => {
    const { browser, doc, names, notes, stored, rows, type, click } = await open();
    try {
      const galeRow = rows()[3];
      type(galeRow.querySelector('input'), 'ends cold');

      click(doc.querySelector('.panel-actions .ghost')!);

      expect(names()).toEqual([
        'Northern Gale', 'Last Ferry', 'Quarry Light', 'Lantern Season',
      ]);
      expect(rows()[0]).toBe(galeRow);
      expect(notes()).toEqual(['ends cold', '', '', '']);
      expect(stored()).toEqual(['ends cold', '', '', '']);
    } finally {
      await browser.close();
    }
  });

  it('disables the move that would run off the end, per row', async () => {
    const { browser, rows, click, names } = await open();
    try {
      const first = rows()[0];
      const last = rows()[3];
      expect(first.querySelectorAll('.row-actions button')[0].hasAttribute('disabled')).toBe(true);
      expect(last.querySelectorAll('.row-actions button')[1].hasAttribute('disabled')).toBe(true);

      // and the guard follows the row: move the first one down and it is the
      // NEW first row that becomes un-movable upward
      click(first.querySelectorAll('.row-actions button')[1]);
      expect(names()[0]).toBe('Quarry Light');
      expect(rows()[0].querySelectorAll('.row-actions button')[0].hasAttribute('disabled')).toBe(true);
      expect(rows()[1].querySelectorAll('.row-actions button')[0].hasAttribute('disabled')).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
