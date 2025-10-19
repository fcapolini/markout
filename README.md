# Markout

[![npm version](https://img.shields.io/npm/v/@markout-js/cli.svg?refresh=1)](https://www.npmjs.com/package/@markout-js/cli)
[![CI](https://github.com/fcapolini/markout/actions/workflows/ci.yml/badge.svg)](https://github.com/fcapolini/markout/actions/workflows/ci.yml)
[![CodeQL](https://github.com/fcapolini/markout/actions/workflows/codeql.yml/badge.svg)](https://github.com/fcapolini/markout/actions/workflows/codeql.yml)
[![Node.js](https://img.shields.io/badge/node.js-18.x%20%7C%2020.x%20%7C%2022.x%20%7C%2024.x-brightgreen)](https://nodejs.org/)
[![codecov](https://codecov.io/gh/fcapolini/markout/graph/badge.svg?token=VENQIX1AWP)](https://codecov.io/gh/fcapolini/markout)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**HTML-based** reactive web framework for Node.js and the browser — for devs who despise _needless complexity_.

🚧 **Alpha Release (v0.1.4)** - Core features working, some features still in development. See [ROADMAP.md](ROADMAP.md) for details.

Markout is three things:

- an Express-based web server (and Express middleware)
- an HTML-based reactive language for web presentation logic
- a CLI development tool.

Compared to mainstream JS-based frameworks like [React](https://react.dev/):

- it doesn't need a complex project setup
- it does away with ceremonies and boilerplate code
- it's more accessible to designers, testers, and non-technical roles
- it makes componentization and code reuse a breeze
- it provides server side rendering by default.

This is the canonical "click counter" example which is a traditional "hello world" for reactive frameworks. Markout supports both quoted and unquoted expression syntaxes:

```html
<!-- Quoted syntax (HTML-native with interpolation) -->
<html>
  <body>
    <button :count="${0}" :on-click="${() => count++}">
      Clicks: ${count}
    </button>
  </body>
</html>

<!-- Unquoted syntax (direct JavaScript expressions) -->
<html>
  <body>
    <button :count=${0} :on-click=${() => count++}>
      Clicks: ${count}
    </button>
  </body>
</html>
```

It must be noted that:

- you can simply place this code in a `.html` file, install Markout with `npm install -g @markout-js/cli`, and serve it with `markout serve .` (serves the current directory)
- at first request, the page will be (very quickly) compiled and executed in the server (on subsequent requests the compiled version will be reused)
- the resulting page will be pre-rendered (meaning button's text will already contain "Clicks: 0") plus it will contain page-specific code to continue execution in the browser
- the browser will instantly show the pre-rendered page and continue execution in the client-side (meaning it will increment the count when users click the button)
- indexing engines which don't support JavaScript execution will get the actual page content anyway, which is perfect for SEO

As you can see:

- no complex project setup is needed
- rather than a code snippet as is customary, this is a complete, self contained code example which doesn't need any hidden parts to actually work
- it only includes what's actually needed and _zero boilerplate code_
- Markout is _polymorphic_ by design, meaning it runs page logic in the server by default before passing the ball to the browser (rather than having a retrofitted SSR feature like in JS-based frameworks).

Make no mistake: Markout doesn't have a _simplistic design_, it actually has a _more sophisticated design_ which, by making thoughtful choices and putting things in their right place, greatly simplifies developer experience without sacrificing expressiveness and power.

With this approach to reactive code you get four big wins:

- ✅ Simplicity - No ceremonies, no boilerplate
- ✅ Familiarity - It's still HTML, just with added powers
- ✅ Reactivity - Start with HTML, add presentation logic
- ✅ Indexability - SEO-ready by default.

In addition, Markout supports different types of deployment:

- Development (Markout CLI)
- Production (Markout server or Express middleware)
- Static (JAMstack/CDN)
- PWA ([progressive web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app))
- Desktop ([Electron](https://www.electronjs.org)/[Tauri](https://tauri.app)/[Wails](https://wails.io/))
- Mobile (Tauri/[Capacitor](https://capacitorjs.com)/[Cordova](https://cordova.apache.org))

**NOTE**: Of course you can still have a full blown project setup when needed — just simpler than what JS-based frameworks require.

## Quick Start

Want to try Markout right now? Here's the fastest way to get started:

### 1. Install and Run

```bash
# Install Markout CLI globally
npm install -g @markout-js/cli

# Create a simple HTML file
echo '<html><body><button :count="${0}" :on-click="${() => count++}">Clicks: ${count}</button></body></html>' > counter.html

# Serve it immediately
markout serve .
```

Open http://localhost:3000/counter.html and click the button - it works!

### 2. Try More Features

Create `app.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Markout App</title>
  <style>
    .danger { background: red; color: white; }
    .safe { background: green; color: white; }
  </style>
</head>
<body>
  <h1>Reactive Counter</h1>
  
  <div :count="${0}">
    <button 
      :class-danger="${count > 5}"
      :class-safe="${count <= 5}"
      :on-click="${() => count++}">
      Clicks: ${count}
    </button>
    
    <p>
      ${count === 0 ? 'Click the button!' : 
        count <= 5 ? `Nice! You clicked ${count} times.` : 
        'Whoa, slow down there!'}
    </p>
    
    <button :on-click="${() => count = 0}">Reset</button>
  </div>
</body>
</html>
```

### 3. Add Components

Create `lib/greeting.htm`:

```html
<lib>
  <:define 
    :tag="greeting-card" 
    :name="${'World'}" 
    :mood="${'happy'}"
    :style-color="${mood === 'happy' ? 'green' : 'red'}">
    
    <div style="padding: 1rem; border: 1px solid #ccc;">
      <h2 style="color: ${mood === 'happy' ? 'green' : 'red'}">
        Hello, ${name}!
      </h2>
      <p>I'm feeling ${mood} today.</p>
    </div>
  </:define>
</lib>
```

Update your `app.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <:import :src="lib/greeting.htm" />
  <title>My Markout App</title>
</head>
<body>
  <:greeting-card :name="Markout" :mood="excited" />
  <!-- Your counter code here -->
</body>
</html>
```

### 4. What's Next?

- **Learn the concepts**: Read the sections below for deep understanding
- **Try the ecosystem**: Add Bootstrap or Shoelace components
- **Build something real**: Markout scales from simple pages to complex apps
- **⭐ Star the repo**: If Markout sparks joy, give us a star on GitHub - it really helps! 
- **Join the community**: Check out the GitHub repo and contribute!

**No build step needed** - Markout compiles on-the-fly during development and pre-renders for production automatically.

## Alpha Status & Limitations

**Current Version: 0.1.3 (Alpha)**

Markout is currently in alpha development. While the core reactive system is functional and many features work well, some features are still being implemented:

**✅ Working Features:**
- Logic values (`:count`, `:on-click`, `:class-`, `:style-`, etc.)
- Reactive expressions (`${...}`)
- Fragments (`<:import>` for modular HTML)
- Advanced fragment features
- Server-side rendering with client-side hydration

**🚧 In Development:**
- Conditionals (`:if|:else|:elseif` attribute in `<template>`)
- Looping (`:foreach` attribute in `<template>`)
- Runtime component system improvements

**❌ Not Yet Implemented:**
- Components (`<:define>` with slots)
- Data services (`<:data>` directive)
- Development server with hot reload
- TypeScript support and VS Code extension (planned for v2.x)
- Islands (`<:island>` for isolated web components - planned for v3.x)

See [ROADMAP.md](ROADMAP.md) for complete development timeline and feature status.

**API Stability:** During alpha, APIs may change. We'll provide migration guides for any breaking changes.

## Motivation

Life as a web developer has become unduly complex. Even the simplest projects require a complex setup these days. And complexity extends to application code: modern reactive frameworks force us to pollute our code with obscure ceremonies (like `useState`, `useEffect` and so on) because of _their own implementation details_.

In my opinion, although they are clearly very useful, they obfuscate our code _for no good reason_: reactivity should really make things simpler, not more complex. And, to make things worse, they keep changing! Even if you're perfectly fine with your code, you have to keep updating just to keep them happy.

Let's be clear: this constant state of radical change is not natural evolution, it's a consequence of rushed and ill considered design — coupled with hype-driven marketing. I can think of no other industry where this would be considered standard practice. This approach should be confined to bleeding edge projects, not used in _every single web project_ no matter what.

Markout is an attempt to solve these problems, or at least to prove that solutions can be found. And in keeping with another of our industry's great ironies, here we are trying to simplify things by proposing _yet another solution_.

A final note about Markout's development process: this is the culmination of a long series of explorations, proofs of concept, and ~~failed attempts~~ learning experiences. In no other project I felt so clearly why indeed _simplicity is the ultimate sophistication_: keeping the framework out of the way of application code does in fact require a lot of consideration.

I think I can proudly say that, compared to frameworks which _move fast and break (other people's) stuff_, I actually _thought it out before I pushed it out_. There, _that_'s a revolutionary idea! 🤯

## Concepts

First, what I think is wrong with JS-based frameworks:

- if you try to hide or replace HTML you get a Frankenstein monster like JSX
- ditto if you try to add declarative reactive logic to JavaScript, which is mainly an imperative language
- reactivity should work intuitively and automatically and it should actually _simplify application code_: `useState()` and `useEffect()`, for example, shouldn't exist
- you should't need to learn the dark art of keeping the framework happy; the framework should work for you, _not the other way around_: `useContext()` and `useMemo()`, for example, shouldn't exist either.

Then, what I think can be done about it:

- **given that** reactivity works best in a _declarative context_
- **and that** HTML is already a widely used and well known _declarative language_
- **it's clear that** making _HTML itself reactive_ makes a lot more sense than adding reactivity to JavaScript (and then having to reinvent the markup syntax in some proprietary form)
- **and that**, to keep it clean, additions to HTML should be _unobstrusive and easy to spot_.

As a result I came up with these additions to standard HTML:

- **logic values**, added with `:`-prefixed attributes
- **reactive expressions**, added with the familiar `${...}` syntax
- **directives**, added with `:`-prefixed tags and augmented `<template>` tags.

## Logic values

Logic values are the foundation of reactivity in Markout. They can be used to add presentation logic to any HTML tag. They're expressed as `:`-prefixed attributes to keep them apart from HTML's own attributes. Compared to normal attributes, they don't appear in output pages: they are used to generate page-specific code which is added as a script to the output.

In our click counter example we have two logic values:

- `:count` which stores a number
- `:on-click` which declares an event handler.

Logic value names must be either valid JavaScript identifiers or `*-`-prefixed names, which have special meaning for the framework. You can use:

- `:on-` for [event handlers](#)
- `:class-` for [conditional CSS classes](#)
- `:style-` for [conditional CSS styles](#)
- `:did-` and `:will-` for [delegate methods](#) (advanced use cases).

By adding logic values to HTML tags you're conceptually adding variables and methods to them. There's no need to use `<script>` tags to define interactive presentation logic: it becomes an integral part of Markout's reactive DOM model.

To make this approach practical, tag attributes in Markout accept multiline values, can be commented out, and can have comments added to them. This makes it feel like you're defining a proper reactive visual object — because that's what you're actually doing:

```html
<button 
  :count="${0}" 
  :on-click="${() => count++}" 
  // highlight dangerous state
  :class-danger="${count > 3}"
>
  <!--- button text can display either the count or an error -->
  ${count < 6 ? `Clicks: ${count}` : `Oh my, you clicked too much and broke the Web!`}
</button>
```

As you can see, inside a tag and between attributes you can use C-style comments (both single- and multi-line). In HTML text you can use the "triple dash" `<!---` comments to have them removed from the output, or normal HTML comments to have them maintained. Finally, to simplify things any tag can be self closing — output pages always contain standard HTML regardless.

### Reactive Attribute Syntax

Markout supports **dual expression syntax** for maximum developer flexibility:

## Quoted Expression Syntax (HTML-native with interpolation)

```html
<button :count="${0}" :on-click="${() => count++}">Clicks: ${count}</button>
```

**Simple and predictable rules:**
- **Single expressions**: `:count="${42}"` → number 42 (preserves type)
- **String interpolation**: `:title="Welcome ${user.name}!"` → interpolated string
- **Literal strings**: `:name="John"` → string "John" (no `${}` needed for literals)

**Perfect syntax highlighting and editor support:**
- **Works in any editor** - VS Code, Vim, Sublime, generic HTML highlighters all work perfectly
- **No broken syntax** - Code never looks malformed in syntax highlighters
- **Familiar to developers** - Standard HTML attribute quoting that every developer understands

## Unquoted Expression Syntax (direct JavaScript)

```html
<button :count=${0} :on-click=${() => count++}>Clicks: ${count}</button>
```

**Key advantages:**
- **Mixed quotes freedom**: `:message=${'String with "double" quotes'}` - no escaping needed
- **Template literals**: `:greeting=${`Hello, ${name}! Welcome to "Markout".`}` - natural syntax
- **Complex objects**: `:config=${{ theme: "dark", debug: true }}` - clean notation
- **Type preservation**: All expressions preserve their original JavaScript types

## String Interpolation Examples

```html
<!-- Quoted syntax - perfect for string templates -->
<div :title="Welcome ${user.name}, you have ${notifications.count} messages"
     :class="btn btn-${variant} ${isActive ? 'active' : ''}"
     :style="color: ${theme.primary}; font-size: ${size}px">

<!-- Unquoted syntax - ideal for complex expressions -->
<div :config=${{ theme: user.preferences.theme, locale: "en-US" }}
     :handler=${(event) => console.log('Event:', event.type)}
     :condition=${user.isActive && notifications.count > 0}>
```

**Use whichever syntax feels more natural** - both preserve types for single expressions, and you can mix them freely within the same component.

## Reactive expressions

Reactive expressions are where logic values are consumed. They adopt the familiar `${...}` syntax, and can be used anywhere as attribute values and in HTML text. They're automatically re-evaluated when the logic values they reference get updated.

In our latest example we have four reactive expressions:

- `${0}` used to initialize `count`
- `${() => count++}` used to define the event handler's function
- `${count > 3}` used to conditionally apply the `danger` class to the button
- `${count < 6 ...}` used keep button's text updated.

Of these, only the last two exhibit an actual reactive behavior: they keep button's class and text updated when the value of `count` changes.

The first is a constant, so it doesn't depend on other values and thus it's never re-evaluated.

The second is a function, which is also never re-evaluated by design.

### Optimizations

Although it's completely transparent for developers, it's worth noting that DOM updates caused by reactive expression updates are batched to prevent the so called "layout thrashing" in the browser.

This means a set of changes caused by an application state change is applied as a whole at the same time and without duplicated DOM access.

Please note that only the DOM application of changes is batched: logic values themselves are always consistent with the latest changes, giving you the best of both worlds: performance optimization and programming model consistency.

Given Markout's design where updates are surgically applied where needed, this results in better performance than the vaunted _Virtual DOM_ adopted in other frameworks.

### Cross-Scope Effects

Markout's reactive system combined with lexical scoping enables elegant side effects that automatically respond to state changes. Use the `:effect` pattern to create reactive side effects - the attribute name declares intent while the value implements the effect.

Here's how you can create an effect that applies dark mode across your application:

```html
<div :darkMode="${false}">
  <button :on-click="${() => darkMode = !darkMode}">
    Toggle Theme
  </button>
  
  <!-- Component with effect that depends on parent's darkMode -->
  <section :effect="${
    (() => {
      // Side effect: update document theme when darkMode changes
      document.body.classList.toggle('dark-theme', head.darkMode);
      localStorage.setItem('theme', head.darkMode ? 'dark' : 'light');
    })(darkMode)  // Dependency triggers re-execution
  }">
    <h2>Content automatically themed</h2>
    <p>This entire section responds to theme changes.</p>
  </section>
</div>
```

This pattern demonstrates several powerful features:

- **Intent Declaration**: `:effect` clearly indicates this logic value creates a side effect
- **Automatic dependency tracking**: The effect runs whenever `head.darkMode` changes
- **Cross-scope reactivity**: Child components can react to parent state through lexical scoping  
- **Standard JavaScript**: Effects use the `(() => sideEffect())(dependencies)` pattern with no special syntax
- **Batched execution**: Multiple effects triggered by the same change are batched together

The effect pattern `(() => sideEffect())(dependencies)` works by:
1. Creating an immediately invoked function expression (IIFE) that performs the side effect
2. Calling it with dependencies as arguments to establish reactive tracking
3. Re-executing automatically when any dependency changes

This approach works for any side effects: analytics tracking, API synchronization, local storage updates, or DOM manipulation outside the component tree.

### Reactivity implementation

**No Virtual DOM, No Re-rendering Nightmare**: Unlike frameworks that re-render entire component trees and rely on diffing algorithms to figure out what changed, Markout knows _exactly_ what needs updating because of its reactive dependency tracking. This eliminates the common performance pitfalls of Virtual DOM frameworks:

- **No unnecessary re-renders**: Components don't re-execute when unrelated state changes
- **No render cascade problems**: A change in one component doesn't trigger re-renders throughout the component tree
- **No need for optimization ceremonies**: No `React.memo`, `useMemo`, `useCallback`, or similar workarounds to prevent wasteful re-renders
- **Predictable performance**: Updates are surgical and proportional to actual changes, not component tree size

## Directives

Markout directives are based on either `<template>` or custom `<:...>` tags:

- `<template>`: conditionals and looping
- `<:define>`: reusable components
- `<:import>|<:include>`: source code modules
- `<:data>`: data and services
- `<:island>`: isolated web components (planned for v3.x)

### Conditionals

Conditional rendering can be controlled with `<template :if | :else | :elseif>`.

For example:

```html
<template :if="${userType === 'buyer'}">
  ...
</template>
<template :elseif="${userType === 'seller'}">
  ...
</template>
<template :else>
  ...
</template>
```

Of course conditionals can be nested:

```html
<template :if="${userType === 'buyer'}">
  ...
  <template :if="${catalog.length}">
    ...
  </template>
  ...
</template>
```

#### Conditional Transitions

Like looping with `:foreach`, conditionals support smooth appearance and disappearance animations using the same transition attributes:

```html
<template :if="${showWelcomeMessage}" 
  :transition-in="${fadeInUp({ ms: 300, dy: 20 })}"
  :transition-out="${fadeOutUp({ ms: 200, dy: -20 })}">
  <div class="welcome-banner">
    <h2>Welcome to our platform!</h2>
    <p>Get started with these quick actions...</p>
  </div>
</template>

<template :if="${user.hasNotifications}"
  :transition-in="${slideInDown({ ms: 250, dy: -30 })}"
  :transition-out="${slideOutUp({ ms: 200, dy: -30 })}">
  <div class="notification-panel">
    You have ${user.notifications.length} new notifications
  </div>
</template>
```

This provides consistent animation behavior across all `<template>` blocks, whether controlled by data changes (`:foreach`) or boolean conditions (`:if`/:else`).

### Looping

Replication can be expressed with `<template :foreach [:item] [:index] [:key]>`.

For example:

```html
<template :foreach="${[1, 2, 3]}" :item="n" :index="i">
  Item ${n} has index ${i}
</template>
```

For optimal performance with dynamic arrays, you can provide a `:key` attribute:

```html
<template :foreach="${users}" :item="user" :key="user.id">
  <div class="user-card">
    <h3>${user.name}</h3>
    <p>${user.email}</p>
  </div>
</template>
```

The `:foreach` logic value is meant to receive an array, but it accepts `null`, `undefined` and non-array types as synonims of `[]`, so if it doesn't get something valid to replicate, it simply won't replicate anything.

Note that `:item`, `:index`, and `:key` are all optional:
- If `:item` is missing, you won't have access to the current item
- If `:index` is missing, you won't have access to its index  
- If `:key` is missing, Markout will use the array index for tracking (less efficient for dynamic data)

Keep in mind that the `<template>` element itself is kept in output markup, preceeded by its possible replicated clones. This is important to know in case you're using CSS pseudo-classes like `:last-child` for styling, in which case `:last-of-type` is advised.

### Components

Components can be declared with `<:define>`.

This directive lets you turn any HTML block into a reusable component. You can:

- **Declare parameters** with default values using logic values like `:name="Default Name"`
- **Use reactive expressions** `${...}` to inject parameter values into the component HTML
- **Support slots** just like Web Components for flexible content composition
- **Add presentation logic** with event handlers, conditional styling, and reactive behavior.

The component can then be used anywhere as a simple custom tag, passing different parameters each time.

You can find a comprehensive demonstration of component creation and usage in the [Bootstrap](#Bootstrap) section below, which shows how to turn Bootstrap's verbose modal markup into a clean, reusable and reactive `<:bs-modal>` component.

#### Two-Tier Component Architecture (Planned for v3.x)

Markout v3.x will support an elegant dual-component system addressing different isolation needs:

**🏝️ Islands = Web Components** (Heavy Isolation)
```html
<!-- Independent, fully isolated widgets -->
<:island src="/widgets/weather.htm"></:island>
<:island src="/widgets/todo-list.htm"></:island>
```

- **Purpose**: Independent widgets requiring complete encapsulation
- **Isolation**: Shadow DOM provides full CSS/DOM boundaries
- **Communication**: Standard DOM events, attributes, slots and data services
- **Use Cases**: Third-party widgets, micro-frontends, cross-team components

**🧩 Components = Markup Scopes** (Light Composition)
```html
<!-- Logical organization within apps -->
<:import href="/components/user-profile.htm" />
<:import href="/components/notification-list.htm" />
```

- **Purpose**: Logical organization within islands or main applications  
- **Isolation**: Lexical scoping for reactive values, shared styling context
- **Communication**: Direct scope access, shared reactive context
- **Use Cases**: UI patterns, layout components, data presentation

**🔗 Service-Oriented Communication**
```html
<!-- Cart service island -->
<:island src="/services/cart.htm" name="cartService"></:island>

<!-- Product island consuming cart service -->
<:island src="/widgets/products.htm">
  <:data :aka="cart" :src="@cartService" />
  <button :on-click="${() => cart.json.addItem(product)}">
    Add to Cart (${cart.json.count})
  </button>
</:island>
```

Islands can expose services using `<:data>`, enabling async operations (local DB, API calls) while maintaining reactive data flow. Services handle complex async operations internally while exposing simple reactive interfaces to consumers.

This provides optimal performance (isolation only where needed) while maintaining clear conceptual boundaries between "what needs isolation" (islands) vs "what can share context" (components).

### Fragments

Source modules can be included with `<:import>` and `<:include>`.

With these tags you can include _page fragments_. For example:

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

- page fragments should use the `.htm` rather than `.html` extension (so they won't be served as pages by mistake)
- they have an arbitrary root tag which is discarded (`<lib>` in this case)
- they are normally imported in page's `<head>`, so their styles fall naturally into place
- since `<:define>` is removed from output markup (and included in generated JS code) it doesn't pollute `<head>`'s content
- page fragments can in turn import other fragments with either relative or absolute path in the document root
- `<:import>` ensures each single fragment is imported only once in the whole page
- if two imported fragments import the same other fragment, only the first one will actually have it added to page `<head>`
- each component can simply import all its dependencies: you don't need to import `lib/baseline.htm` yourself, it will be included as soon as you import any of your library's components.

**It all boils down to this**: you can easily build your component libraries where each component includes its own dependencies (e.g. for baseline styling) without fearing duplications and with automatic dependency handling.

The `<:include>` directive can be used to explicitly include a fragment multiple time in a single page or fragment.

One note about the `<style>` tags: since they're tags like all others, they can include `${...}` expressions and be made reactive as well! This should be used sparingly though — primarily for theming and configuration that changes infrequently (like at application launch). For dynamic styling that responds to user interactions, stick to the standard approaches: `:class-` logic values and `:style-` logic values on individual elements, which are optimized for frequent updates.

Even with a considered use, reactive `<style>` tags can be amazingly useful and:

- can remove the need of CSS preprocessing
- can let you implement switchable themes with ease
- can help you implement **adaptive** styling e.g. for mobile
- eliminates the CSS vs JS variable barrier
- let component implementation and styling have a single source of truth.

With this approach to modularity you get four big wins:

- ✅ Simplicity - Include fragments with a single tag, automatic dependency resolution
- ✅ Familiarity - Still regular HTML files, just with `.htm` extension for fragments
- ✅ Configurability - Even CSS can be parameterized for themes and component variants
- ✅ Reusability - Build component libraries where each component manages its own dependencies

## Data

Technically speaking this should be a paragraph of [Directives](#Directives) dedicated to the `<:data>` tag. But it covers such a fundamental concern in web apps that it deserves its own section.

The `<:data>` directive lets you formally declare all data and service interactions, and define your own data generation and processing if needed.

For example, here is how you can connect to a REST endpoint:

```html
<:data :aka="usersData" :src="/api/users" />
```

And here's how you may use the data:

```html
<ul>
  <template :foreach="${usersData.json.list}" :item="user">
    <li>${user.name}</li>
  </template>
</ul>
```

Note that `<:data>`'s `json` value is always defined, at most it can be an empty object. Given that `:foreach` accepts `undefined` and `null` as synonyms of `[]`, no defensive checks are needed here.

The data can be local as well:

```html
<:data :aka="navigationData" :json="${{
  list: [
    { id: 1, url: '/dashboard', title: 'Dashboard' },
    { id: 2, url: '/activity', title: 'Activity' },
  ]
}}" />
```

And, because local data participates in the reactive system — `:json` is a logic value after all — it can automatically update too:

```html
<:data :aka="localeData" :json="${{
  en: { dashboard: 'Dashboard', activity: 'Activity' },
  it: { dashboard: 'Panoramica', activity: 'Attività' }
}}" />
<:data :aka="navigationData" :lang="en" :_locale="${localeData.json[lang]}" :json="${{
  list: [
    { id: 1, url: '/dashboard', title: _locale.dashboard },
    { id: 2, url: '/activity', title: _locale.activity },
  ]
}}" />
```

Now you have a localized menu which seamlessly updates when users switch language!

In addition, again because `:json` is a logic attribute, you can locally generate data:

```html
<:data :aka="totalsData" :json="${_generate()}" :_generate="${() => { return ...
}}">
```

You get the idea. In the same way, you can concatenate `<:data>` directives to build data pipelines, simply making each _a function_ of the one before, and you can cascade API calls just by making each dependent on the previous one's data.

By leveraging source code modularization with `<:import>`, you can of course properly organize the data layer in your code and import it where needed.

With this approach to data handling you get four big wins:

- ✅ Simplicity - Declare data needs directly in HTML, no separate data layers
- ✅ Familiarity - REST endpoints and JSON data work exactly as expected
- ✅ Reactivity - Data updates automatically flow through dependent components and pipelines
- ✅ Composability - Chain data transformations naturally without complex state management

### Advanced features

There's still a lot to say about the deceptively simple `<:data>` directive: things like HTTP methods, authentication, caching, error handling, retries etc. but it takes its own chapter in the docs.

#### GraphQL Integration (Planned for v2.x)

GraphQL support will be implemented as **reusable component libraries** with full TypeScript integration, leveraging Markout's fragment system:

```html
<!-- GraphQL query with TypeScript schema validation -->
<:import src="/lib/graphql/query.htm" 
         :aka="users"
         :endpoint="/graphql"
         :schema="${UserSchema}"
         :query="${`
           query GetUsers($limit: Int) {
             users(limit: $limit) {
               id name email
               profile { avatar bio }
             }
           }
         `}"
         :variables="${{ limit: 10 }}" />

<!-- Type-safe mutations -->
<:import src="/lib/graphql/mutation.htm"
         :aka="userMutations"
         :endpoint="/graphql"
         :schema="${UserMutationSchema}" />

<!-- Fully typed data access -->
<template :foreach="${users.json.users}" :item="user">
  <div>
    ${user.name} - ${user.email}
    <button :on-click="${() => userMutations.updateUser(user.id, updates)}">
      Update
    </button>
  </div>
</template>
```

**v2.x GraphQL Features:**
- **Full TypeScript Integration**: Schema validation and type-safe queries/mutations
- **Code Generation**: Automatic TypeScript types from GraphQL schemas
- **Real-time Subscriptions**: WebSocket-based GraphQL subscriptions with reactive state
- **Fragment Composition**: Reusable GraphQL fragments as importable `.htm` files
- **Zero Runtime Overhead**: Pure library implementation using existing reactive capabilities

#### tRPC Integration (Planned for v2.x)

[tRPC](https://trpc.io/) support will provide end-to-end type safety with seamless client-server communication:

```html
<!-- Type-safe tRPC client -->
<:import src="/lib/trpc/client.htm"
         :aka="api"
         :endpoint="/api/trpc"
         :router="${AppRouter}" />

<!-- Fully typed queries and mutations -->
<div :user="${null}" :posts="${[]}" 
     :on-load="${async () => {
       user = await api.user.getById.query({ id: userId });
       posts = await api.posts.getByUser.query({ userId });
     }}">
  
  <h2>${user?.name}</h2>
  
  <template :foreach="${posts}" :item="post">
    <article>
      <h3>${post.title}</h3>
      <button :on-click="${() => api.posts.delete.mutate({ id: post.id })}">
        Delete
      </button>
    </article>
  </template>
</div>
```

**v2.x tRPC Features:**
- **End-to-End Type Safety**: Shared types between server and client
- **Reactive Integration**: tRPC calls work seamlessly with Markout's reactive system
- **Real-time Updates**: WebSocket-based subscriptions with automatic UI updates
- **Error Handling**: Type-safe error boundaries and validation
- **Development Experience**: Full IntelliSense and compile-time error checking

#### WebSocket Real-time Communication

WebSocket support is implemented as **reusable fragment libraries** using standard browser APIs and Markout's reactive system:

```html
<!-- Import WebSocket client component -->
<:import src="/lib/websocket/client.htm"
         :aka="chatSocket"
         :url="ws://localhost:8080/chat"
         :on-message="${(context, event) => {
           const message = JSON.parse(event.data);
           return {
             ...context,
             messages: [...context.messages, message]
           };
         }}" />

<!-- Reactive UI updates automatically -->
<div :if="${chatSocket.json.connecting}">Connecting...</div>
<div :if="${chatSocket.json.connected}">
  <template :foreach="${chatSocket.json.messages}" :item="message">
    <div><strong>${message.user}:</strong> ${message.text}</div>
  </template>
  
  <input :on-keydown="${(e) => {
    if (e.key === 'Enter') {
      chatSocket.send(JSON.stringify({
        user: currentUser.name,
        text: e.target.value
      }));
    }
  }}" />
</div>
```

**Key Benefits:**
- **Pure Library Implementation**: Built using standard `<:data>` patterns and browser WebSocket API
- **Reusable Components**: WebSocket connection management as importable fragments
- **Custom Integrations**: Teams can build domain-specific WebSocket patterns (chat, notifications, collaboration)
- **No Framework Bloat**: Core runtime stays minimal, WebSocket features added only when imported

#### Universal Async Interface

The same library-first pattern works for any async communication - all implemented as importable fragment libraries:

```html
<!-- Server-Sent Events -->
<:import src="/lib/sse/client.htm" :aka="notifications" :url="/api/notifications/stream" />

<!-- IndexedDB -->
<:import src="/lib/indexeddb/client.htm" :aka="localDB" :database="userPreferences" />

<!-- Web Workers -->
<:import src="/lib/worker/client.htm" :aka="worker" :script="/js/data-processor.js" />

<!-- WebRTC -->
<:import src="/lib/webrtc/peer.htm" :aka="peer" :peerId="${peerId}" />
```

**Ecosystem Architecture:**
- **Community Libraries**: Standard integration patterns shared as `.htm` fragment libraries
- **Company Libraries**: Internal teams create reusable integration components for consistent patterns
- **Zero Runtime Dependencies**: All integrations use existing `<:data>` capabilities and browser APIs
- **Selective Enhancement**: Import only the async capabilities your application actually uses

Two things are important to outline straight away though.

For one, `<:data>` is where business logic should live: while presentation logic is more effectively scattered around in visual objects, business logic is better kept centralized in dedicated data-oriented objects. For example:

```html
<!--- Business logic: user validation, data processing -->
<:data :aka="userService" :validate="${(user) => user.email && user.age >= 18}" />

<!--- Presentation logic: button states, form interactions -->
<form :user="${{}}"  >
  <input :value="${user.email}" :on-change="${(e) => user.email = e.target.value}" />
  <button :disabled="${!userService.validate(user)}">Submit</button>
</form>
```

Another important thing to clarify is: `<:data>` is where `async/await` and promise-based code, if any, should live. Markout reactivity is synchronous, but it can be triggered by events, timers, and asynchronous data operations.

The `<:data>` directive provides a universal async interface that works consistently across all transport layers - WebSockets, Workers, IndexedDB, WebRTC, Server-Sent Events - using the same declarative patterns and reactive data flow. GraphQL and tRPC integrations (planned for v2.x) will extend this pattern with full TypeScript support.

## Ecosystem

Most fellow devs might be thinking: "Yeah but a brand new framework means no component libraries!"

Except, Markout being a superset of HTML, what works with plain HTML + JavaScript can also work with Markout — and be made reactive too.

### Bootstrap

Let's take [Bootstrap](https://getbootstrap.com) for example:

```html
<div class="modal fade" id="exampleModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Modal title</h5>
        <button
          type="button"
          class="btn-close"
          data-bs-dismiss="modal"
        ></button>
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
<:bs-modal :open="${true}" :title="Greeting" :message="Hello world!" />
```

That's much better! Now you have a properly [encapsulated](<https://en.wikipedia.org/wiki/Encapsulation_(computer_programming)>) component which clearly declares what it is (`bs-modal`) and only exposes what's meaningful for its use (`open` state, `title` and `message` texts).

For completeness, this is what the component definition could look like:

```html
<:define
   :tag="bs-modal"

   // interface:
   :open="${false}"
   :title="Modal title"
   :message="Modal body text goes here."

   // implementation:
   class="modal fade"
   tabindex="-1"
   :effect="${(() => open ? _modal.show() : _modal.hide())(open)}"
   :_modal="${new bootstrap.Modal(this.$dom)}"
>
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">${title}</h5>
        <button
          type="button" class="btn-close" data-bs-dismiss="modal"
          :on-click="${() => open = false}"
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

- you can componentize a block by just turning its root tag into a `<:define>` and giving it a tag name
- by default the base tag for a Markout component is a `<div>`, which is OK here
- in order to parametrize the component, you can add logic values with their defaults, and use them in the appropriate places inside its code
- the `:effect` pattern `(() => sideEffect())(dependencies)` is the recommended way to create reactive side effects that respond to state changes.

With this approach to components you get four big wins:

- ✅ Simplicity - Complex UI becomes one line
- ✅ Familiarity - Still Bootstrap underneath
- ✅ Reactivity - Turn imperative components into reactive ones
- ✅ Reusability - Define once, use everywhere.

**NOTE**: I plan to release a Markout Bootstrap library soon — I want the fun part for myself 😉

### Shoelace

Markout works seamlessly with Web Component libraries. Let's take [Shoelace](https://shoelace.style) as an example:

```html
<!-- Traditional Shoelace usage -->
<sl-button variant="primary" size="large" disabled>
  <sl-icon slot="prefix" name="gear"></sl-icon>
  Settings
</sl-button>

<script type="module">
  import '@shoelace-style/shoelace/dist/components/button/button.js';
  import '@shoelace-style/shoelace/dist/components/icon/icon.js';
  
  const button = document.querySelector('sl-button');
  button.addEventListener('sl-click', () => {
    console.log('Button clicked!');
  });
</script>
```

In Markout, you can make Shoelace components reactive and eliminate the JavaScript ceremony:

```html
<!-- Reactive Shoelace in Markout -->
<sl-button 
  :variant="primary" 
  :size="large" 
  :disabled="${!user.canEditSettings}"
  :on-sl-click="${() => openSettingsModal()}">
  <sl-icon slot="prefix" name="gear"></sl-icon>
  Settings
</sl-button>
```

By following Markout's simple conventions for page fragments, it's easy to consolidate the required plumbing in an importable library:

```html
<!-- lib/shoelace.htm -->
<lib>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.15.0/cdn/themes/light.css" />
  <script type="module" src="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.15.0/cdn/shoelace-autoloader.js"></script>
  
  <script>
    // Set the base path for Shoelace assets
    import { setBasePath } from 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.15.0/cdn/utilities/base-path.js';
    setBasePath('https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.15.0/cdn/');
  </script>
</lib>
```

Now you can use Shoelace components reactively throughout your application by simply importing the library:

```html
<html>
<head>
  <:import :src="lib/shoelace.htm" />
</head>
<body>
  <sl-button :loading="${isSubmitting}" :on-sl-click="${() => submitForm()}">
    Submit Form
  </sl-button>
</body>
</html>
```

### Project components

Finally, what works for third-party libraries works just as well for your own stuff. Let's say you have a user profile card you want to use multiple times: Markout makes it trivial to turn it into a reusable parametric component.

This is an example before componentization:

```html
<!-- Repeated across multiple pages -->
<div class="profile-card">
  <img src="/avatars/john-doe.jpg" alt="John Doe" class="avatar" />
  <div class="profile-info">
    <h3 class="name">John Doe</h3>
    <p class="title">Senior Developer</p>
    <p class="email">john.doe@company.com</p>
    <button class="contact-btn" onclick="openChat('john-doe')">
      Contact
    </button>
  </div>
</div>

<style>
  .profile-card { /* ... styling ... */ }
  .avatar { /* ... styling ... */ }
  /* ... more CSS ... */
</style>
```

And this is the componentized code:

```html
<!-- lib/profile-card.htm -->
<lib>
  <style>
    .profile-card {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
    }
    .avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
    }
    .profile-info h3 {
      margin: 0;
      color: #333;
    }
    .contact-btn {
      background: #007bff;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>

  <:define 
    :tag="profile-card"
    :user="${{}}"
    :show-contact="${true}"
    class="profile-card">
    
    <img :src="${user.avatar || '/default-avatar.png'}" 
         :alt="${user.name}" 
         class="avatar" />
    
    <div class="profile-info">
      <h3 class="name">${user.name}</h3>
      <p class="title">${user.title}</p>
      <p class="email">${user.email}</p>
      
      <template :if="${showContact}">
        <button 
          class="contact-btn" 
          :on-click="${() => openChat(user.id)}">
          Contact
        </button>
      </template>
    </div>
  </:define>
</lib>
```

Now you can use it anywhere with just one line:

```html
<html>
<head>
  <:import :src="lib/profile-card.htm" />
</head>
<body>
  <!-- Usage becomes simple and declarative -->
  <:profile-card :user="${johnDoe}" />
  <:profile-card :user="${janeDoe}" :show-contact="${false}" />
</body>
</html>
```

Your component definitions can just as easily be grouped in a set of page fragments reusable across pages as well as across different projects:

```html
<!-- lib/ui-components.htm - Your component library -->
<lib>
  <:import :src="profile-card.htm" />
  <:import :src="data-table.htm" />
  <:import :src="modal-dialog.htm" />
  <:import :src="notification-toast.htm" />
</lib>
```

```html
<!-- Any page in any project -->
<html>
<head>
  <:import :src="lib/ui-components.htm" />
</head>
<body>
  <:profile-card :user="${currentUser}" />
  <:data-table :data="${users}" :columns="${userColumns}" />
</body>
</html>
```

Leveraging Markout support for page fragments which can include baseline and default component styling, it's easy to define and maintain **design systems** and **company-wide UI libraries**. Even better, their implementation is easily inspectable and terse enough to serve as guidance for their use, removing the need for detailed documentation which is chronically out of date.

With this approach to project components you get four big wins:

- ✅ **Simplicity** - Turn any HTML block into a reusable component with one tag change
- ✅ **Familiarity** - Components are just HTML files that anyone can read and understand
- ✅ **Self-Documentation** - Component implementations serve as their own usage guide
- ✅ **Scale** - From individual components to enterprise design systems with the same pattern

## Tooling

### CLI

Markout includes a powerful CLI tool for development and deployment. 

**Installation:**

```bash
# Install globally via npm
npm install -g @markout-js/cli

# Or run directly with npx (no installation needed)
npx @markout-js/cli --help
```

#### Development Server

Start a development server with hot reload:

```bash
# Serve current directory on default port (3000)
markout serve .

# Serve specific directory
markout serve ./my-project

# Serve on custom port
markout serve . --port 8080

# Or use with npx (no global install needed)
npx @markout-js/cli serve . --port 8080
```

The development server includes:
- **Hot reload**: Automatically refreshes pages when files change
- **Live compilation**: Markout pages are compiled on-the-fly
- **Static file serving**: Serves CSS, JS, images, and other assets
- **Error reporting**: Clear error messages with stack traces
- **CORS support**: Configured for local development

#### Production Deployment

Deploy your Markout application for production:

```bash
# Start production server
npm run start:prod

# With PM2 process management (already included in start:prod)
npm run start:prod

# Custom configuration (modify ecosystem.config.js or use CLI directly)
markout serve . --port 80
```

Production features:
- **Process clustering**: Utilizes all CPU cores
- **Automatic restarts**: Crash recovery and memory leak protection  
- **Compression**: Gzip/Brotli compression for faster loading
- **Rate limiting**: Built-in DoS protection
- **Health checks**: Monitoring endpoints for load balancers
- **Graceful shutdown**: Clean process termination

#### Project Scaffolding

Create new Markout projects with built-in templates:

```bash
# Create a new project
markout create my-app

# Create with specific template
markout create my-app --template bootstrap
markout create my-app --template shoelace
markout create my-app --template minimal

# Create component library
markout create my-components --template library
```

#### Static Site Generation

**Alpha Note:** Static site generation features are planned for future releases. Currently available:

```bash
# Build the project (server and client bundles)
npm run build

# Start development server  
npm run dev

# Production server with PM2
npm run start:prod
```

#### Development Tools

Additional development utilities:

```bash
# Validate Markout syntax
markout validate src/

# Format Markout files
markout format src/

# Analyze bundle size
markout analyze

# Generate component documentation
markout docs --output ./docs
```

### VS Code Extension (planned for v.2.x)

The Markout VS Code extension (planned) will provide comprehensive development support for Markout projects:

#### **Syntax Highlighting**
- Syntax highlighting for `:` prefixed logic attributes (`:count`, `:on-click`, `:class-active`)
- Highlighting for reactive expressions `${...}` within HTML
- Support for Markout directives (`<:import>`, `<:define>`, `<:data>`)
- Color coding for framework reserved identifiers (`$parent`, `$value()`)

#### **IntelliSense & Code Completion**
- Auto-completion for component names and fragment imports
- IntelliSense for data references and reactive expressions
- Type hints for component parameters and data pipeline inputs
- Smart suggestions for logic attribute names and values
- Context-aware completion within `${...}` expressions

#### **Error Detection & Validation**
- Real-time validation of Markout syntax and framework rules
- Detection of circular dependencies in data pipelines
- Type mismatch warnings for reactive expressions
- Undefined reference detection for variables and components
- Framework naming rule enforcement (no `$` in user identifiers)

#### **Development Tools**
- **Dependency Graph Visualization**: Interactive view of data pipelines and component relationships
- **Fragment Explorer**: Navigate modular code organization with import/export tracking
- **Component Preview**: Live preview of components with parameter interfaces
- **Architecture Diagrams**: Visualize component hierarchy and data flow

#### **Live Templates & Snippets**
- Code snippets for common Markout patterns
- Live templates for reactive components, data definitions, and imports
- Quick scaffolding for fragment structures and component definitions

#### **Documentation Integration**
- Hover documentation for framework methods and properties
- Inline documentation for component parameters and data schema
- Quick access to Markout API reference and examples

#### **Project Management**
- Project initialization templates for different use cases
- Integration with Markout CLI commands
- Build task integration and error reporting

The extension will significantly enhance the developer experience by providing the same level of tooling support that developers expect from modern frameworks, while maintaining Markout's philosophy of simplicity and HTML-first development.

## Roadmap

Markout follows a **stability-first development philosophy**. Rather than rushing to market with incomplete features, we focus on thoughtful design and comprehensive testing to ensure each release provides genuine value without breaking existing code.

### Current Status: Alpha (v0.1.x)

**✅ Completed Core Features:**
- Reactive runtime system with batched DOM updates
- Logic values (`:count`, `:on-click`, `:class-`, `:style-`)
- Reactive expressions (`${...}`) in HTML and attributes
- Components (`<:define>`) with slots and parameters
- Fragments (`<:import>`) with automatic dependency resolution
- Server-side rendering with client-side hydration
- Development CLI with hot reload and production deployment

### Near Term: Beta Releases (v0.2.x - v0.9.x)

**v0.2.x - Complete Core Directives:**
- ✅ Conditionals (`<template :if>`, `:else`, `:elseif`)
- ✅ Data services (`<:data>` directive for REST endpoints and reactive data)
- ✅ Enhanced fragment system with attribute inheritance
- ✅ Component lifecycle and validation

**v0.3.x - v0.5.x - Library Ecosystem:**
- WebSocket libraries for real-time communication
- Universal async patterns (Server-Sent Events, IndexedDB, WebRTC)
- Bootstrap and Shoelace integration libraries
- Production deployment guides and best practices

**v0.6.x - v0.9.x - Production Readiness:**
- Performance optimizations and memory leak prevention
- Advanced CLI features (project scaffolding, static site generation)
- Accessibility (a11y) compliance and internationalization (i18n) support
- Real-world application testing and ecosystem maturation

### Stable Release: v1.0.0

**🎯 Stability Promise:**
- **Semantic versioning** with backward compatibility guarantee
- **Long-term support** with security updates and bug fixes
- **Production ready** with proven real-world usage
- **Complete documentation** with tutorials and migration guides

**v1.x Feature Extensions:**
- Optional dependencies with `?` syntax for graceful error handling
- Advanced component patterns and enterprise features
- Performance profiling and optimization tools

### Major Feature Releases

**v2.x - Developer Experience & TypeScript:**
- **VS Code Extension** with syntax highlighting and IntelliSense
- **TypeScript Integration** with type-safe reactive expressions
- **GraphQL Integration** with full TypeScript support (queries, mutations, subscriptions, schema validation)
- **tRPC Integration** with end-to-end type safety and seamless client-server communication
- Advanced development tools and error detection
- Type-safe component interfaces and data contracts

**v3.x - Islands Architecture:**
- **Two-Tier Component System**: Islands (Web Components) + Components (markup scopes)
- **Service-Oriented Communication** via reactive `<:data>` services
- **Micro-frontend capabilities** with complete isolation boundaries
- **Enterprise-grade** patterns for large-scale applications

**Future Vision (v4.x+):**
- Edge computing optimization (Cloudflare Workers, Deno Deploy)
- Mobile development patterns and PWA enhancements
- AI/ML integration for template generation and accessibility
- Advanced reactivity with fine-grained object tracking

### Philosophy

Our roadmap reflects Markout's core principles:

- **🎯 Stability Over Speed**: Features are thoroughly designed and tested before release
- **🏗️ HTML-First**: Build on web standards rather than replacing them
- **👥 Developer Experience**: Make common tasks simple while keeping complex things possible
- **🔄 Thoughtful Evolution**: Changes driven by real user needs, not technology trends
- **🌍 Community-Driven**: Roadmap priorities shaped by user feedback and contributions

For detailed milestones, feature status, and contribution opportunities, see [ROADMAP.md](ROADMAP.md).

## Closing remarks

In an industry obsessed with the next big disruption—whether it's "signals" as the latest reactive primitive or yet another framework promising to revolutionize everything, without actually challenging the mainstream model—Markout takes a different path.

I believe in **thoughtful engineering over marketing hype**. While others chase trends and breaking changes, Markout focuses on solving real problems with minimal disruption. Markout's HTML-first approach builds on web standards that have proven their worth, enhanced with just three simple additions that make complex things possible without making simple things complicated.

**Markout is for teams who value stability over novelty, productivity over ceremonies, and solutions over disruptions.** It's for developers who want to build great web applications without constantly relearning their tools or migrating their codebases.

The upcoming island/component architecture exemplifies this philosophy: instead of inventing new abstractions, they'll leverage Web Components and extend Markout's existing `<:data>` system to enable service-oriented communication. Think of client-side microservices. Real-world benefits—like multiple independent functional modules on the same page—achieved through standards-based solutions that will still work in five years.

Revolutionary? No, just careful engineering, as it should be.

## License

Markout is released under the [MIT License](LICENSE).
