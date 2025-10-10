# Markout

**HTML-based** reactive web framework for Node.js and the browser — for devs who despise *needless complexity*.

🚧 **Markout is currently in development and its features are being implemented!**

Markout is three things:

* an Express-based web server (and Express middleware)
* an HTML-based reactive language for web presentation logic
* a CLI development tool.

Compared to mainstream JS-based frameworks like [React](https://react.dev/):

* it doesn't need a complex project setup
* it does away with ceremonies and boilerplate code
* it's more accessible to designers, testers, and non-technical roles
* it makes componentization and code reuse a breeze
* it provides server side rendering by default.

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
* it only includes what's actually needed and *zero boilerplate code*
* Markout is *polymorphic* by design, meaning it runs page logic in the server by default before passing the ball to the browser (rather than having a retrofitted SSR feature like in JS-based frameworks).

Make no mistake: Markout doesn't have a *simplistic design*, it actually has a *more sophisticated design* which, by making thoughtful choices and putting things in their right place, greatly simplifies developer experience without sacrificing expressiveness and power.

With this approach to reactive code you get four big wins:

* ✅ Simplicity - No ceremonies, no boilerplate
* ✅ Familiarity - It's still HTML, just with added powers
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

## Motivation

Life as a web developer has become unduly complex. Even the simplest projects require a complex setup these days. And complexity extends to application code: modern reactive frameworks force us to pollute our code with obscure ceremonies (like `useState`, `useEffect` and so on) because of *their own implementation details*.

In my opinion, although they are clearly very useful, they obfuscate our code *for no good reason*: reactivity should make things simpler, not more complex. And, to make things worse, they keep changing! Even if you're perfectly fine with your code, you have to keep updating just to keep them happy.

Let's be clear: this constant state of radical change is not natural evolution, it's a consequence of rushed and ill considered design — coupled with hype-driven marketing. I can think of no other industry where this would be considered standard practice. This approach should be confined to bleeding edge projects, not *every single web project* no matter what.

Markout is an attempt to solve these problems, or at least to prove that solutions can be found. And in keeping with another of our industry's great ironies, here we are trying to simplify things by proposing *yet another solution*.

A final note about Markout's development process: this is the culmination of a long series of explorations, proofs of concept, and ~~failed attempts~~ learning experiences. In no other project I felt so clearly why indeed *simplicity is the ultimate sophistication*: keeping the framework out of the way of application code required a lot of consideration. I think I can proudly say that, compared to frameworks which *move fast and break (other people's) stuff*, I actually *thought it out before I pushed it out*.

## Principles

First, what I think is wrong with JS-based frameworks:

* if you try to hide or replace HTML you get a Frankenstein monster like JSX
* ditto if you try to add declarative reactive logic to JavaScript, which is mainly an imperative language
* reactivity should work intuitively and automatically and it should actually *simplify application code*: `useState()` and `useEffect()`, for example, shouldn't exist
* you should't need to learn the dark art of keeping the framework happy; the framework should work for you, *not the other way around*: `useContext()` and `useMemo()`, for example, shouldn't exist either.

Then, what I think can be done about it:

* **given that** reactivity works best in a *declarative context*
* **and that** HTML is already a widely used and well known *declarative language*
* **it's clear that** making *HTML itself reactive* makes a lot more sense than adding reactivity to JavaScript (and then having to reinvent the markup syntax in some proprietary form)
* **and that**, to keep it clean, additions to HTML should be *unobstrusive and easy to spot*.

As a result I came up with these additions to standard HTML:

* **logic values**, added with `:`-prefixed attributes
* **reactive expressions**, added with the familiar `${...}` syntax
* **directives**, added with `:`-prefixed tags and augmented `<template>` tags.

## Logic values

Logic values are the foundation of reactivity in Markout. They can be used to add presentation logic to any HTML tag. They're expressed as `:`-prefixed attributes to keep them apart from HTML's own attributes. Compared to normal attributes, they don't appear in output pages: they are used to generate page-specific code which is added as a script to the output.

In our click counter example we have two logic values:

* `:count` which stores a number
* `:on-click` which declares an event handler.

Logic value names must be either valid JavaScript identifiers or `*-`-prefixed names, which have special meaning for the framework. You can use:

* `:on-` for [event handlers](#)
* `:class-` for [conditional CSS classes](#)
* `:style-` for [conditional CSS styles](#)
* `:watch-` for [value watchers](#) (rarely needed)
* `:did-` and `:will-` for [delegate methods](#) (advanced use cases).

By adding logic values to HTML tags you're conceptually adding variables and methods to them. There's no need to use `<script>` tags to define interactive presentation logic: it becomes an integral part of Markout's reactive DOM model.

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

As you can see, inside a tag and between attributes you can use C-style comments (both single- and multi-line). In HTML text you can use the "triple dash" comments to have them removed from the output, or normal HTML comments to have them maintained. Finally, to simplify things any tag can be self closing — output pages always contain standard HTML regardless.

## Reactive expressions

Reactive expressions are where logic values are consumed. They adopt the familiar `${...}` syntax, and can be used anywhere as attribute values and in HTML text. They're automatically re-evaluated when the logic values they reference get updated.

In our latest example we have four reactive expressions:

* `${0}` used to initialize `count`
* `${() => count++}` used to declare the event handler's function
* `${count > 3}` used to conditionally apply the `danger` class to the button
* `${count < 6 ...}` used keep button's text updated.

Of these, only the last two exhibit an actual reactive behavior: they keep button's class and text updated when the value of `count` changes.

The first is a constant, so it doesn't depend on other values and thus it's never re-evaluated.

The second is a function, which is also never re-evaluated by design.

## Directives

Markout directives are based on either `<template>` or custom `<:...>` tags:

* `<template>`: conditionals and looping
* `<:define>`: reusable components
* `<:import>|<:include>`: source coude modules
* `<:data>`: data and services

### `<template :if | :else | :elseif | :endif>`

TBD

### `<template :foreach [:item] [:index]>`

TBD

### `<:define>`

This directive lets you turn any HTML block into a reusable component. You can:

* **Declare parameters** with default values using logic values like `:name="Default Name"`
* **Use reactive expressions** `${...}` to inject parameter values into the component HTML
* **Support slots** just like Web Components for flexible content composition
* **Add presentation logic** with event handlers, conditional styling, and reactive behavior.

The component can then be used anywhere as a simple custom tag, passing different parameters each time.

You can find a comprehensive demonstration of component creation and usage in the [Bootstrap](#Bootstrap) section below, where we show how to turn Bootstrap's verbose modal markup into a clean, reusable and reactive `<:bs-modal>` component.

### `<:import>` and `<:include>`

With these tags you can include *page fragments*. For example:

```html
<html>
<head>
  <:import :src="lib/app-card.htm" />
</head>
<body>
  <:app-card>
    Hello.
  </:app-card>
</body>
</html>
```

Where this could be `lib/app-card.htm`'s content:

```html
<lib>
  <:import :src="baseline.htm" />

  <style>
    .app-card {
      border: 1px solid #ccc;
    }
  </style>

  <:define :tag="app-card" class="app-card" />
</lib>
```

And `lib/baseline.htm`'s content could be:

```html
<lib>
  <style>
    body {
      margin: 0;
    }
  </style>
</lib>
```

It should be noted that:

* page fragments should use the `.htm` rather than `.html` extension (so they won't be served as pages by mistake)
* they have an arbitrary root tag which is discarded (`<lib>` in this case)
* they are normally imported in page's `<head>`, so their styles fall naturally into place
* since `<:define>` is removed from output markup (and included in generated JS code) it doesn't pollute `<head>`'s content
* page fragments can in turn import other fragments with either relative or absolute path in the document root
* `<:import>` ensures each single fragment is imported only once in the whole page
* if two imported fragments import the same other fragment, only the first one will actually have it added to page `<head>`
* each component can simply import all its dependencies: you don't need to import `lib/baseline.htm` yourself, it will be included as soon as you import any of your library's components.

It all boils down to this: you can easily build your component libraries where each component includes its own dependencies (e.g. for baseline styling) without fearing duplications and with automatic dependency handling.

The `<:include>` directive can be used to explicitly include a fragment multiple time in a single page or fragment.

One last note about the `<style>` tags: since they're tags like all others, they can include `${...}` expressions. This should be used sparingly — primarily for theming and configuration that changes infrequently (like at application launch). For dynamic styling that responds to user interactions, stick to the standard approaches: `:class-` logic values and `:style-` logic values on individual elements, which are optimized for frequent updates.

With this approach to modularity you get four big wins:

* ✅ Simplicity - Include fragments with a single tag, automatic dependency resolution
* ✅ Familiarity - Still regular HTML files, just with `.htm` extension for fragments  
* ✅ Configurability - Even CSS can be parameterized for themes and component variants
* ✅ Reusability - Build component libraries where each component manages its own dependencies

### `<:data>`

This directive lets you formally declare all data and service interactions, and define your own data generation and processing if needed.

For example, here is how you can connect to a REST endpoint:

```html
<:data :aka="usersData" :src="/api/users" />
```

And here's how you may use the data:

```html
<ul>
  <template :foreach=${usersData.list} :item="user">
    <li>${user.name}</li>
  </template>
</ul>
```

The data can be local as well:

```html
<:data :aka="navigationData" :json=${{
  list: [
    { id: 1, url: '/dashboard', title: 'Dashboard' },
    { id: 2, url: '/activity', title: 'Activity' },
  ]
}} />
```

And, because local data participate in the reactive system — `:json` is a logic value after all — it can automatically update too:

```html
<:data :aka="locale" :json=${{
  en: {
    dashboard: 'Dashboard',
    activity: 'Activity'
  },
  it: {
    dashboard: 'Panoramica',
    activity: 'Attività'
  }
}} />

<:data :aka="navigationData" :lang="en" :json=${{
  list: [
    { id: 1, url: '/dashboard', title: locale[lang].dashboard },
    { id: 2, url: '/activity', title: locale[lang].activity },
  ]
}} />
```

Now you have a localized menu which seamlessly updates when users switch language!

In addition, again because `:json` is a logic attribute, you can locally generate data:

```html
<:data :aka="totalsData" :json=${generate()} :generate=${() => {
  return ...
}}>
```

You get the idea. In the same way, you can concatenate `<:data>` directives to build data pipelines, simply making each *a function* of the one before, and you can cascade API calls just by making each dependend on the previous one's received data.

By leveraging source code modularization with `<:import>`, you can of course properly organize the data layer in your code and import it where needed.

With this approach to data handling you get four big wins:

* ✅ Simplicity - Declare data needs directly in HTML, no separate data layers
* ✅ Familiarity - REST endpoints and JSON data work exactly as expected  
* ✅ Reactivity - Data updates automatically flow through dependent components and pipelines
* ✅ Composability - Chain data transformations naturally without complex state management

### Advanced `<:data>` features

There's still a lot to say about the deceptively simple `<:data>` directive: things like HTTP methods, caching, error handling, retries etc. but it takes its own chapter in the docs.

One thing is important to clarify here though: `<:data>` is where `async` stuff lives. Markout reactivity is synchronous, but it can be triggered asynchronously by two things: events and data.

So much so that `<:data>` can be used to formalize inter-process communication with [workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), and can be adapted to any transport layer available in the browser by using its own delegate methods (with `:did-` and `:will-` logic values), but I'm getting ahead of myself again.

This includes local DBs by the way... OK I stop.

## Ecosystem

Most fellow devs might be thinking: "Yeah but a brand new framework means no component libraries!"

Except, Markout is a superset of HTML, so what works with plain HTML + JavaScript can also work with Markout — and can be made reactive too.

### Bootstrap

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

That's much better! Now you have a properly [encapsulated](https://en.wikipedia.org/wiki/Encapsulation_(computer_programming)) component which clearly declares what it is (`bs-modal`) and only exposes what's meaningful for its use (`open` state, `title` and `message` texts).

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
        <h5 class="modal-title">${title}</h5>
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

It should be noted that:

* you can componentize a block by just turning its root tag into a `<:define>` and giving it a tag name
* by default the base tag for a Markout component is a `<div>`, which is OK here
* in order to parametrize the component, you can add logic values with their defaults, and use them in the appropriate places inside its code.

With this approach to components you get four big wins:

* ✅ Simplicity - Complex UI becomes one line
* ✅ Familiarity - Still Bootstrap underneath
* ✅ Reactivity - Turn imperative components into reactive ones
* ✅ Reusability - Define once, use everywhere.

**NOTE**: I plan to release a Markout Bootstrap library soon — I want the fun part for myself 😉

### Shoelace

Markout is totally fine with Web Component libraries. Let's take [Shoelace](https://shoelace.style) as an example:

```
TBD
```

By following Markout's simple conventions for page fragments, it's easy to consolidate the required plumbing in an importable library:

```
TBD
```

### Project components

Finally, what works for third-party libraries works just as well for your own stuff. Let's say you have a block you want to use multiple times: Markout makes it trivial to turn it into a reusable parametric component.

This is an example before componentization:

```
TBD
```

And this is the componentized code:

```
TBD
```

Your component definitions can just as easily be grouped in a set of page fragments reusable across pages as well as across different projects:

```
TBD
```

## Tooling

TBD

### CLI

TBD

### VSCode extension

TBD

## License

Markout is released under the [MIT License](LICENSE).
