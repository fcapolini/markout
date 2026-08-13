# State

The DOM is a projection of data. Everything on screen is derived from values,
and the runtime's job is keeping the projection true as those values change.

So the question when writing a page isn't *where do I keep this* — values are
the only place — but **how long does it need to last**. Three answers, and
they want different treatment.

## Durable app state

What the page is *about*: the setlist's tracks and their cue notes, a
basket's contents, a draft someone is halfway through. It should survive a
reload, and losing it is a bug a user would report.

Today it goes in ordinary values, declared on whichever scope owns it —
usually `<body>`, so the whole page can read it:

```html
<body :tracks=${[{ id: 'lantern', name: 'Lantern Season', note: '' }]}>
  <ol><li :for-each=${tracks} :for-key=${data.id}>
    <input value=${data.note}
           :on-input=${e => tracks = tracks.map(t =>
             t.id === data.id ? { ...t, note: e.target.value } : t)}>
  </li></ol>
</body>
```

Note where the cue note lives. Typing folds it back into `tracks` rather than
leaving it in the `<input>` — an element is a projection, so anything left
only there is unreachable and unsavable. It is the one mistake this page
exists to prevent.

Durable state is what [datasources](#datasources--designed-not-implemented)
are for. Until they exist, it lives in values like anything else and is lost
on reload.

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
[`:for-key`](replication.md#for-key) is for: a keyed list moves a row rather
than rebuilding it, so whatever the element was holding survives the move.

## The first two are a decision, not a category

`basket` and `activeSeason` are the same shape — plain values on `<body>`,
declared identically. Nothing about them says which is which. They differ
only in whether losing them on reload would be a bug, and that is a judgment
about the application, not about the value.

Worth making deliberately, because it is the one that decides what a
datasource will eventually own.

## Datasources — designed, not implemented

Datasources are the planned home for durable state: a value whose contents
come from somewhere outside the page, computed once while server rendering
and handed to the browser with the rest of the page's state, so the client
resumes from what the server already worked out rather than fetching it
again.

They do not exist yet. Nothing in this section is available today, and
durable state currently lives in ordinary values, with a reload losing it.
