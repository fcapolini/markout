# State

The DOM is a projection of data. Everything on screen is derived from values,
and the runtime's job is keeping the projection true as those values change.

So the question when writing a page isn't *where do I keep this* — values are
the only place — but **how long does it need to last**. Three answers, and
they want different treatment.

The three map onto model-view-presenter, which is the shape markout is: the
model's, the presenter's, and the view's own. That the two framings agree is
the reason to trust either.

## Durable app state

What the page is *about*: the setlist's tracks and their cue notes, a
basket's contents, a draft someone is halfway through. It should survive a
reload, and losing it is a bug a user would report.

It goes in ordinary values, declared on whichever scope owns it — usually
`<body>`, so the whole page can read it:

```html
<body :tracks=${[{ id: 'lantern', name: 'Lantern Season', note: '' }]}>
  <ol><li :for-each=${tracks} :for-key=${data.id}>
    <input value=${data.note}
           :prop-value=${data.note}
           :on-input=${e => tracks = tracks.map(t =>
             t.id === data.id ? { ...t, note: e.target.value } : t)}>
  </li></ol>
</body>
```

Note where the cue note lives. Typing folds it back into `tracks` rather than
leaving it in the `<input>` — an element is a projection, so anything left
only there is unreachable and unsavable. It is the one mistake this page
exists to prevent.

And the projection has to keep projecting, which is what the second binding
is for. HTML gives `value` a *dirty flag*: from the user's first keystroke
the element's value is its own, independent of the attribute, so an attribute
written afterwards is simply not consulted. `value=` is what the element is
**served** with, which a page rendered on the server still needs;
`:prop-value=` is what it **shows** from then on. Both, together — writing
only the first compiles clean and then loses every change made from anywhere
but that box, which is why the compiler warns when it sees one without the
other.

Where that data comes FROM is what [datasources](#datasources) are for: a
value whose contents are fetched rather than written down, computed while the
page is rendered and carried to the browser with it. What a datasource does
not do is make the state durable by itself — a value edited in the page is
lost on reload unless something is told about it, which is the application's
job rather than the presenter's.

## Ephemeral view state

Which filter is active, which tab is open, whether a panel is expanded. It
does not need to survive a reload — but it is still **data**, declared the
same way:

```html
<body :activeSeason=${'All'}>
  <button :for-each=${['All', 'Spring']} :on-click=${() => activeSeason = data}>
    ${data}
  </button>
  <p>${activeSeason}</p>
</body>
```

It has to be data because the page must be renderable *from* the values
alone. Server rendering and hydration both draw the page that way, so view
state living anywhere else is view state the two can't agree on — the page
would arrive showing one thing and flip to another the moment it hydrates.

## Interaction micro-state

Focus, caret position, scroll offset, hover, an IME composition in progress.
This is the DOM's own, it is never modelled, and trying to would be a
mistake — it changes on every keystroke and means nothing to the page.

What it needs is not to be *destroyed*, which is what
[`:for-key`](directives.md#for-key) is for: a keyed list moves a row rather
than rebuilding it, so whatever the element was holding survives the move.

## The first two are a decision, not a category

`basket` and `activeSeason` are the same shape — plain values on `<body>`,
declared identically. Nothing about them says which is which. They differ
only in whether losing them on reload would be a bug, and that is a judgment
about the application, not about the value.

Worth making deliberately, because it is the one that decides what a
datasource owns.

## Datasources

Where the data outside the page comes in:
[`std-data`](../../kits/std-kit/parts/data.htm), in the standard kit.

```html
<std-data :aka="rows" ::url="/api/tracks" />

<li :for-each=${rows.data ?? []}>${data.title}</li>
```

The thing worth noticing is that the language knows nothing about it. It is
an ordinary component: `:server-` marks an expression that runs while the
page is rendering, the server waits for the promise before serializing, and
the result travels with the page — so the served markup is already complete
and there is no flash. See [server-only
values](../design/value-transfer.md).

Two modes. **Served** is the default and is the one that renders: one request
per page load, and the data is in the source. **`:client`** does nothing on
the server and fetches on arrival, which is what anything the page should not
publish needs — a session, another user's row — since a served value is
written into the page as plain text where anyone can read it.

The served mode wants a server, which matters when there isn't one: a page run
through `markout prerender` has no request to take an origin from, so a
relative `:url` needs an absolute one, `:client`, or `markout prerender
--origin` before the page will prerender. `markout build` sidesteps the
question entirely by evaluating nothing — the fetch happens in the browser,
where there is always an origin. See [the std kit's
notes](../../kits/std-kit/README.md#the-url-means-the-same-thing-in-both-modes).

That a framework-shaped feature lives in a kit rather than in the language is
deliberate rather than incidental. The language stays the small thing it is,
and what a page needs beyond it is markup somebody can open and read.
