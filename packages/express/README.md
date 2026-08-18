# @markout-dev/express

[Markout](https://markout.dev) as Express middleware: your application's own
routes first, then markout, then static files.

```js
import express from 'express';
import { markout } from '@markout-dev/express';

const app = express();
app.get('/api/things', myHandler);        // yours, and it wins
app.use(markout({ docroot: './site' }));  // pages, compiled and rendered
app.use(express.static('./site'));        // everything else
```

That order is the point: markout is the presentation layer and does not want
your routes. A page is an ordinary `.html` file, rendered server-side with
the same scope-and-value model that then runs in the browser, so there is no
flash and no second fetch.

`dev: true` adds live reload and readable expressions; leave it off in
production.

Full documentation is in the
[repository](https://github.com/fcapolini/markout).

MIT.
