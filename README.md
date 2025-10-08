# Markout

An alternative HTML-based reactive web framework for Node.js and the browser.

Markout is three things:
* an Express-based web server (and Express middleware)
* an HTML-based reactive language for web presentation logic
* a CLI development tool.

Compared to mainstream JS-based frameworks like React, Markout:
* does away with ceremonies and boilerplate code
* is more accessible to non developers
* makes componentization and code reuse a breeze.

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
* you can simply place this code in a `.html` file and serve it as it is with Markout server
* at first request, the page will be compiled and executed in the server (on subsequent requests the compiled version will be reused)
* the resulting page will be pre-rendered (meaning button's text will already contain "Clicks: 0") plus it will contain page-specific code to continue execution in the browser
* the browser will instantly show the pre-rendered page and continue execution in the client-side (meaning it will increment the count when users click the button)
* indexing engines which don't support JavaScript execution will get the actual page content anyway, which is perfect for SEO

As you can see:
* no complex project setup is needed
* rather than a code snippet as is customary, this is a complete, self contained code example which doesn't need any hidden parts to actually work
* Markout is *polymorphic* by design, meaning it runs page logic in the server by default before passing the ball to the browser (rather than having a retrofitted SSR feature like in JS-based frameworks).

# Motivation

Life as a web developer has become unduly complex. Even the simplest of projects requires a complex setup these days. Plus, modern reactive frameworks force developers to pollute your application code with obscure ceremonies (like `useState`, `useEffect` and so on) because of their own implementation details.

In other words, although they are very useful, they obfuscate your code *for no good reason*: reactivity should make things simpler, not more complex. Plus, for good measure, they keep changing! Even if you're fine with your code, you're forced to keep updating it just to keep them happy.

Let's be clear: this constant state of radical change is not natural evolution, it's a consequence of rushed and ill considered design—coupled with hype-driven marketing. We can think of no other industry where this would be considered standard practice. This approach should be confined to bleeding edge projects, not *every single web project* no matter what.

The problem is we all love to reinvent the wheel and show off. But as a matter of fact reactive UIs, even for the Web, are not new. For example in the mid 2000s the OpenLaszlo framework was already ahead, design wise, compared to what we have now. If only someone could refine and update that design, it would be pretty good.

That's how Markout was born. And in keeping with another of our industry's great ironies, here we are trying to simplify things by proposing *yet another solution*.

# Principles

First, what we think is wrong with JS-based frameworks:

* if you try to hide or replace HTML you get monsters like JSX
* ditto if you try to add declarative reactive logic to JavaScript, which is chiefly an imperative language
* reactivity should work intuitively and automatically and it should actually *simplify* application code: `useState()` and `useEffect()`, for example, shouldn't exist
* you should't need to learn the dark arts to keep the framework happy, the framework should work for you, not the other way around: `useMemo()`, for example, shouldn't exist either.

Then, what we think we can do about it:

* reactivity lends itself to be used in a declarative context
* HTML is already a widely used and well known *declarative language*
* making *HTML itself* reactive makes a lot more sense than adding reactivity to JavaScript and then reinvent the markup syntax in some proprietary form
* additions to HTML should be unobstrusive easy to spot.

As a result we came up with exactly three syntactic additions to standard HTML:

* directives, expressed with `:`-prefixed tags
* logic values, expressed with `:`-prefixed attributes
* reactive expressions, expressed with the familiar `${...}` syntax.

## Directives

Directives are mainly devoted to adding modularity and reusability to HTML:
* `<:import>` lets you import ".htm" page fragments
* `<:define>` lets you declare reusable custom tags (aka components)

TBD: conditionals, replication

## Logic values

Logic values can be used to add presentation logic to any HTML tag. They're expressed as `:`-prefixed attributes to keep them apart from HTML's own tags. Compared to the latter, they don't appear in output pages: they are used to generate page-specific reactive code which is added as a script in the output.

In our example above we have two logic values:
* `:count` which stores a number
* `:on-click` which declares an event handler.

Logic value names must be either valid JavaScript identifiers or `*-`-prefixed names. The latter have special meaning for the framework. You can use:

* `:on-` for [event handlers](#)
* `:class-` for [conditional CSS classes](#)
* `:style-` for [conditional CSS styles](#)
* `:watch-` for (rarely needed) [value observers](#).
* `:will-` and `:did-` for (rarely needed) [delegate methods](#).

By adding logic values to an HTML tag you're effectively adding variables and methods to it. There's no need to use `<script>` tags here and there to define interactive presentation logic: it becomes an integral part of Markout's extended DOM model.

To make this approach practical, tag attributes in Markout accept multiline values, can be commented out, and can have comments added to them:

```html
<html>
<head>
   <style>
      .danger {
         color: red;
      }
   </style>
</head>
<body>
   <button
      // this is the counter, initialized to zero
      :count=${0}

      // at each click we increment the counter
      :on-click=${() => count++}

      // highlight dangerous state
      :class-danger=${count > 10}
   >
      <!--- this is where the counter is added to button text -->
      ${
         count < 20
            ? `Clicks: ${count}`
            : `Look here: you clicked too much and broke the Web!`
      }
   </button>
</body>
</html>
```

As you can see, inside a tag and between attributes you can use C-style comments (both single- and multi-line). In HTML text you can use the "triple dash" comments to have them removed from the output (or, of course, normal HTML comments to have them maintained).

## Reactive expressions

Reactive expressions use the familiar `${...}` syntax. They can be used anywhere as attribute values and in HTML text. They can reference logic values and they're automatically re-evaluated when those change.

In our example above we have three reactive expressions:
* `${0}` used to initialize `count`
* `${() => count++}` used to declare the event handler's function
* `${count}` used to inject the value of `count` in button's text.

Of these, only the latter exhibits an actual reactive behavior: it updates page text whenever the value of `count` changes.

The first is a constant, so it doesn't depend on other values and thus it's never re-evaluated.

The second is a function, which is also never re-evaluated by design.

# Ecosystem

Most fellow devs might now be thinking: "Yeah but a brand new framework means no component libraries!".

Well, not exactly: because Markout is a superset of HTML, whatever works with plain HTML + JavaScript also works with Markout.

Let's take Bootstrap for example:

```
TBD
```

Bootstrap, though, requires purpose-built markup for implementing its components: that's the perfect use case for Markout's `<:define>`:

```
TBD
```

Of course Web Component libraries are also valid in Markout because they are valid in HTML. Let's take Shoelace:

```
TBD
```

By following Markout's simple conventions for page fragments, it's trivial to consolidate the required plumbing in an importable library:

```
TBD
```

Finally, what works for third-party libraries works just as well for your own stuff. Let's say in a project you have a block you want to use multiple times: Markout makes it trivial to turn it into a reusable parametric component.

This is an example before componentization:

```
TBD
```

And this is the componentized code:

```
TBD
```

Your component definitions can just as easily be grouped in importable page fragments reusable across pages in a project as well as across different projects:

```
TBD
```

# Examples

...
