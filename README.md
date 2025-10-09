# Markout

**HTML-based** reactive web framework for Node.js and the browser — for devs who despise *needless complexity*.

🚧 **Markout is currently in development and its features being implemented!**

Markout is three things:

* an Express-based web server (and Express middleware)
* an HTML-based reactive language for web presentation logic
* a CLI development tool.

Compared to mainstream JS-based frameworks like [React](https://react.dev/):

* it does away with ceremonies and boilerplate code
* it's more accessible to non developers
* it makes componentization and code reuse a breeze.

This is the canonical "click counter" example which is a traditional "hello world" for reactive frameworks:

```html
<html>
<body>
   <button :count=${0} :on-click=${() => count++}>
      Clicks: ${count}
   </button>
</body>
</html>
```

It must be noted that:

* you can simply place this code in a `.html` file, install the CLI with `npm i -g @markout/cli`, and serve it as it is with `markout serve page.html`
* at first request, the page will be (very quickly) compiled and executed in the server (on subsequent requests the compiled version will be reused)
* the resulting page will be pre-rendered (meaning button's text will already contain "Clicks: 0") plus it will contain page-specific code to continue execution in the browser
* the browser will instantly show the pre-rendered page and continue execution in the client-side (meaning it will increment the count when users click the button)
* indexing engines which don't support JavaScript execution will get the actual page content anyway, which is perfect for SEO

As you can see:

* no complex project setup is needed
* rather than a code snippet as is customary, this is a complete, self contained code example which doesn't need any hidden parts to actually work
* Markout is *polymorphic* by design, meaning it runs page logic in the server by default before passing the ball to the browser (rather than having a retrofitted SSR feature like in JS-based frameworks).

Make no mistake: Markout doesn't have a *simplistic design*, it actually has a *more sophisticated design* which, by making thoughtful choices and putting things in their right place, greatly simplifies developer experience without sacrificing expressiveness and power.

With this approach to reactive code you get four big wins:

* ✅ Simplicity - No ceremonies, no boilerplate
* ✅ Familiarity - It's still HTML, with added powers
* ✅ Reactivity - Start with HTML, add presentation logic
* ✅ Indexability - SEO-ready by default.

In addition, Markout supports these different types of deployment:

* Development (Markout CLI)
* Production (Markout server or Express middleware)
* Static (JAMstack/CDN)
* PWA ([progressive web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app))
* Desktop ([Electron](https://www.electronjs.org)/[Tauri](https://tauri.app)/[Wails](https://wails.io/))
* Mobile (Tauri/[Capacitor](https://capacitorjs.com)/[Cordova](https://cordova.apache.org))

**NOTE**: Of course you can still have a full blown project setup when needed — just simpler than what JS-based frameworks require.

# Motivation

Life as a web developer has become unduly complex. Even the simplest projects require a complex setup these days. And complexity extends to application code: modern reactive frameworks force us to pollute our code with obscure ceremonies (like `useState`, `useEffect` and so on) because of *their own implementation details*.

In our opinion, although they are clearly very useful, they obfuscate our code *for no good reason*: reactivity should make things simpler, not more complex. And, to make things worse, they keep changing! Even if you're perfectly fine with your code, you have to keep updating it just to keep them happy.

Let's be clear: this constant state of radical change is not natural evolution, it's a consequence of rushed and ill considered design — coupled with hype-driven marketing. We can think of no other industry where this would be considered standard practice. This approach should be confined to bleeding edge projects, not *every single web project* no matter what.

Markout is an attempt to solve these problems, or to prove at least that alternative solutions can be found. And in keeping with another of our industry's great ironies, here we are trying to simplify things by proposing *yet another solution*.

# Principles

First, what I think is wrong with JS-based frameworks:

* if you try to hide or replace HTML you get a Frankenstein monster like JSX
* ditto if you try to add declarative reactive logic to JavaScript, which is mainly an imperative language
* reactivity should work intuitively and automatically and it should actually *simplify application code*: `useState()` and `useEffect()`, for example, shouldn't exist
* you should't need to learn the dark art of keeping the framework happy, the framework should work for you, not *the other way around*: `useContext()` and `useMemo()`, for example, shouldn't exist either.

Then, what I think can be done about it:

* **given** reactivity is best used in a *declarative context*
* **and** HTML is already a widely used and well known *declarative language*
* **clearly** making *HTML itself reactive* makes a lot more sense than adding reactivity to JavaScript (and then having to reinvent the markup syntax in some proprietary form)
* **and** additions to HTML should be *unobstrusive and easy to spot* to keep things clear.

As a result I came up with these additions to standard HTML:

* **logic values**, expressed with `:`-prefixed attributes
* **reactive expressions**, expressed with the familiar `${...}` syntax
* **directives**, expressed with `:`-prefixed tags and augmented `<template>` tags.

## Logic values

Logic values are the foundation of reactivity in Markout. They can be used to add presentation logic to any HTML tag. They're expressed as `:`-prefixed attributes to keep them apart from HTML's own attributes. Compared to normal attributes, they don't appear in output pages: they are used to generate page-specific reactive code which is added as a script in the output.

In our click counter example we have two logic values:

* `:count` which stores a number
* `:on-click` which declares an event handler.

Logic value names must be either valid JavaScript identifiers or `*-`-prefixed names, which have special meaning for the framework. You can use:

* `:on-` for [event handlers](#)
* `:class-` for [conditional CSS classes](#)
* `:style-` for [conditional CSS styles](#)
* `:watch-` for (rarely needed) [value watchers](#).
* `:will-` and `:did-` for (rarely needed) [delegate methods](#).

By adding logic values to an HTML tag you're conceptually adding variables and methods to it. There's no need to use `<script>` tags to define interactive presentation logic: it becomes an integral part of Markout's reactive DOM model.

To make this approach practical, tag attributes in Markout accept multiline values, can be commented out, and can have comments added to them. This makes it feel like you're defining a proper reactive visual object — because that's what you're actually doing:

```html
<button
   :count=${0}
   :on-click=${() => count++}

   // highlight dangerous state
   :class-danger=${count > 3}
>
   <!--- button text can display either the count or an error -->
   ${count < 6
      ? `Clicks: ${count}`
      : `Oh my, you clicked too much and broke the Web!`}
</button>
```

As you can see, inside a tag and between attributes you can use C-style comments (both single- and multi-line). In HTML text you can use the "triple dash" comments to have them removed from the output (or normal HTML comments to have them maintained).

## Reactive expressions

Reactive expressions are where logic values are consumed. They adopt the familiar `${...}` syntax, and can be used anywhere as attribute values and in HTML text. They're automatically re-evaluated when the logic values they reference get updated.

In our click counter example we have three reactive expressions:

* `${0}` used to initialize `count`
* `${() => count++}` used to declare the event handler's function
* `${count}` used to inject the value of `count` in button's text.

Of these, only the latter exhibits an actual reactive behavior: it updates page text whenever the value of `count` changes.

The first is a constant, so it doesn't depend on other values and thus it's never re-evaluated.

The second is a function, which is also never re-evaluated by design.

## Directives

### `:`-prefixed tags

`:`-prefixed tags add modularity, reusability, and data handling to HTML:

* `<:import>` and `<:include>` let you modularize source code
* `<:define>` lets you declare reusable custom tags (aka components)
* `<:data>` lets you interact with remote and local data

#### `<:import>` and `<:include>`

TBD

#### `<:define>`

TBD

#### `<:data>`

TBD

### Augmented `<template>` tags

Augmented `<template>` tags are used for conditionals and looping:

* `<template :if=${}>` and `<template :elseif=${}>` for conditionals
* `<template :foreach=${} :item="" index="">` for replication.

#### `<template :if>` and `<template :elseif>`

TBD

#### `<template :foreach :item :index>`

TBD

# Data binding

TBD

# Ecosystem

Most fellow devs might be thinking: "Yeah but a brand new framework means no component libraries!"

Well, not exactly: because Markout is a superset of HTML, what works with plain HTML + JavaScript can also be easily adapted to Markout — and made reactive in the process.

## Bootstrap

Let's take [Bootstrap](https://getbootstrap.com) for example:

```html
<div class="modal fade" id="exampleModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Modal title</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <p>Modal body text goes here.</p>
      </div>
    </div>
  </div>
</div>
<script>
  $('#exampleModal').modal('show');
</script>
```

This code is confusing to say the least, and you have to duplicate it everywhere you need a modal. In Markout, though, you can just define it once, and use it like this everywhere you need it:

```html
<:bs-modal :open=${true} :title="Greeting" :message="Hello world!" />
```

That's much better! Although it's still HTML (with powers) you now have a proper component which clearly declares what it is (`bs-modal`) and only exposes what's meaningful for its use (`open` state, `title` and `message` texts).

For completeness, this is what the component definition could look like:

```html
<:define
   :tag="bs-modal"

   // interface:
   :open=${false}
   :title=${'Modal title'}
   :message=${'Modal body text goes here.'}

   // implementation:
   class="modal fade"
   tabindex="-1"
   :watch-open=${() => open ? _modal.show() : _modal.hide()}
   :_modal=${new bootstrap.Modal(this.$dom)}
>
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">${title}$</h5>
        <button
          type="button" class="btn-close" data-bs-dismiss="modal"
          :on-click=${() => open = false}
        />
      </div>
      <div class="modal-body">
        <p>${message}</p>
      </div>
    </div>
  </div>
</:define>
```

It can be noted that:

* you can componentize a block by just turning its root tag into a `<:define>` and giving it its own tag name
* by default the base tag for a Markout component is a `<div>` which is OK here
* in order to parametrize the component, you can add logic values with their defaults, and use them in the appropriate places inside its code
* any tag can be self closed in Markout HTML.

With this approach to components you get four big wins:

* ✅ Simplicity - Complex UI becomes one line
* ✅ Familiarity - Still Bootstrap underneath
* ✅ Reactivity - Turn imperative components into reactive ones
* ✅ Reusability - Define once, use everywhere.

**NOTE**: I plan to release a Markout Bootstrap library soon — I want the fun part for myself 😉

## Shoelace

Markout is totally fine with Web Component libraries as well. Let's take [Shoelace](https://shoelace.style) as an example:

```
TBD
```

By following Markout's simple conventions for page fragments, it's easy to consolidate the required plumbing in an importable library:

```
TBD
```

## Project components

Finally, what works for third-party libraries works just as well for your own stuff. Let's say you have a block you want to use multiple times: Markout makes it trivial to turn it into a reusable parametric component.

This is an example before componentization:

```
TBD
```

And this is the componentized code:

```
TBD
```

Your component definitions can just as easily be grouped in importable page fragments reusable across pages as well as across different projects:

```
TBD
```

# CLI

...

# License

Markout is released unde the [MIT License](LICENSE).
