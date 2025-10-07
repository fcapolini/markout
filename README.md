# Markout

An alternative HTML-based reactive web framework for Node.js and the browser.

Markout is three things:
* an Express-based web server (and Express middleware)
* an HTML-based reactive language for web presentation logic
* a CLI development tool.

Compared to mainstream JS-based reactive web frameworks like React, Markout:
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
* rather than a code snipped as is customary, this is a complete, self contained code example which doesn't need any "hidden" parts to actually work
* Markout is *polymorphic* by design, meaning it runs page logic in the server by default before passing the ball to the browser (rather than having a retrofitted SSR feature like in JS-based frameworks).

# Motivation

Life as a web developer has become unduly complex. Even the simplest of projects requires a complex setup these days. Plus, modern reactive frameworks force developers to pollute your application code with obscure ceremonies (like `useState`, `useEffect` and so on) because of their own implementation details.

In other words, although they are very useful, they obfuscate your code *for no good reason*: reactivity should make things simpler, not more complex. Plus, for good measure, they keep changing! Even if you're fine with your code, you're forced to keep updating it just to keep them happy.

To be perfectly honest, this constant state of change is not a natural evolution: it's a consequence of rushed and ill considered design in the first place. We can think of no other industry where this would be considered standard practice. This approach should be confined to bleeding edge projects, not *every single web project* no matter what.

The problem is: we love to reinvent the wheel and to show off. But as a matter of fact reactivity, even for the Web, is not new. For example in the mid 2000s the OpenLaszlo was already ahead, design wise, compared to what we have now. If only someone refined that design and updated it with the latest technologies, it would be pretty good.

That's how Markout was born. And in keeping with another of our industry's great ironies, here we are trying to simplify things by proposing *yet another solution*.

# Principles

* if you try to hide or incorporate HTML in your design you get monsters like JSX: let's base our design *on HTML* instead
* ditto if you try to express declarative reactive logic in JavaScript, which is an imperative language
* reactivity should work intuitively and automatically and it should actually *simplify* application code
* you should't learn the dark arts to keep the framework happy: the framework should work for you, not the other way around
* reactivity lends itself to be used in a declarative context
* HTML is already a widely used and well known *declarative* language
* making *HTML itself* reactive makes a lot more sense than adding reactivity to JavaScript and then reinvent it in some proprietary form.

As a result we came up with exactly three syntactic additions to standard HTML:
* directives, expressed with `:`-prefixed tags
* logic values, expressed with `:`-prifixed attributes
* reactive expressions, expressed with the familiar `${...}` syntax.

## Directives

Directives are mainly devoted to add modularity and reusability to HTML:
* `<:import>` lets you import ".htm" page fragments
* `<:define>` lets you declare reusable custom tags (aka components)

## Logic values

Logic values can be used to add presentation logic to any HTML tag. They're expressed as `:`-prefixed attributes to keep them apart from HTML's own tags. Compared to the latter, they don't appear in output pages: they are used to generate page-specific reactive code which is added as a script in the output.

In our example above we have two logic values:
* `:count` which stores a number
* `:on-click` which declares an event handler.

## Reactive expressions

Reactive expression use the familiar `${...}` syntax. They can be used anywhere as attribute values and in HTML text. They can reference logic values and they're automatically re-evaluated when they change.

In our example above we have three reactive expressions:
* `${0}` used to initialize `count`
* `${() => count++}` used to declare the event handler's function
* `${count}` used to inject the current value of `count` in button's text.

Of these, only the latter exhibits an actual reactive behavior: it updates page text whenever the value of `count` changes.

The first is a constant, so it doesn't depend on other values and as such it's never re-evaluated.

The second is a function, which is also never re-evaluated by design.

# Examples

...
