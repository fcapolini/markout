# What markout.dev runs.
#
# Built from the REPOSITORY ROOT, not from this directory: the site is one
# workspace among several and the packages it loads are the ones next door, so
# the build context is the whole tree even though a single workspace is being
# deployed.
#
#     docker build -f sites/site/Dockerfile -t markout-site .
#     docker run --rm -p 3000:3000 markout-site
#
# CapRover builds it for itself, told where to find it by `captain-definition`
# at the root of the repository. See sites/site/DEPLOY.md.

# --------------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app

# The manifests before the sources, so that editing a page does not reinstall
# the world: this layer is keyed on the lockfile and on nothing that changes
# daily. Every workspace's package.json is here even though most of them are
# not being deployed -- `npm ci` installs the tree the lockfile describes, and
# a workspace missing from disk is a tree that does not match it.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/express/package.json packages/express/
COPY packages/vscode/package.json packages/vscode/
COPY kits/std-kit/package.json kits/std-kit/
COPY kits/bootstrap-kit/package.json kits/bootstrap-kit/
COPY sites/site/package.json sites/site/

# The three workspaces this image is made of, and their dev dependencies --
# `tsc` for all of them and `esbuild` for the browser runtime core bundles.
# Naming them leaves out the CLI's test suite, which would otherwise download
# a Playwright browser here to open no page at all, and the VS Code extension's
# packaging tools.
RUN npm ci --no-audit --no-fund \
      -w @markout-lang/core -w @markout-lang/express -w @markout-lang/site \
      --include-workspace-root

COPY . .

# The compiler and the runtime it serves, the middleware, and the site's own
# server -- which is TypeScript in the repository and JavaScript from here on:
# what the container starts is `node`, with no compiler and no transpiler in
# the image and nothing between the process starting and the first page.
RUN npm run build -w @markout-lang/core \
 && npm run build -w @markout-lang/express \
 && npm run build:image -w @markout-lang/site

# ------------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The same install, minus everything that was only needed to build. What lands
# here is Express, compression, the compiler's own handful of dependencies,
# and symlinks into the workspaces below -- seven megabytes, because a served
# markout page needs the compiler and nothing else.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/express/package.json packages/express/
COPY packages/vscode/package.json packages/vscode/
COPY kits/std-kit/package.json kits/std-kit/
COPY kits/bootstrap-kit/package.json kits/bootstrap-kit/
COPY sites/site/package.json sites/site/
RUN npm ci --omit=dev --no-audit --no-fund \
      -w @markout-lang/site --include-workspace-root \
 && npm cache clean --force

# The workspaces those symlinks point at. The packages are their built output;
# the kits are markup and publish nothing else, which is why a kit needs no
# build step in the stage above.
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/express/dist packages/express/dist
COPY kits/std-kit/all.htm kits/std-kit/
COPY kits/std-kit/parts kits/std-kit/parts
COPY kits/bootstrap-kit/all.htm kits/bootstrap-kit/
COPY kits/bootstrap-kit/parts kits/bootstrap-kit/parts

# The application: the server and the one demo's service, compiled. It keeps
# the workspace's own path because the symlinks npm just wrote point at it, and
# because `require('./demos/desk/api')` is written relative to the server.
COPY --from=build /app/sites/site/dist sites/site/

# The docroot: the site, and nothing else.
#
# Deliberately NOT the directory the server lives in, which is what it is in a
# checkout. Everything under a docroot is servable -- that is what a docroot IS
# -- so a deployment that keeps its code outside one cannot serve its own
# source, its manifests or its configuration by accident, whatever gets added
# to the tree later.
COPY sites/site/index.html sites/site/robots.txt sites/site/sitemap.xml ./public/
COPY sites/site/favicon.ico sites/site/favicon.svg sites/site/logo-small-plain.svg ./public/
COPY sites/site/social-card.png ./public/
COPY sites/site/parts ./public/parts
COPY sites/site/examples ./public/examples
COPY sites/site/demos ./public/demos
# The desk's service is the one piece of TypeScript inside the demos, and its
# compiled half is up in the application. Nothing here is a source file.
RUN find ./public -name '*.ts' -delete

# `public` sits under /app on purpose: kits and `/npm/` imports resolve by
# walking `node_modules` UP from the docroot, and /app/node_modules is where
# the install above put them.
ENV DOCROOT=/app/public \
    PORT=3000 \
    TRUST_PROXY=1
EXPOSE 3000

# Nothing here needs to write anything, and nothing here needs root to read it.
USER node

# What CapRover restarts the container over. `/healthz` is a route rather than
# a page precisely so that this costs a string rather than a compile.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# `--prod` because dev mode is the default: readable expressions are what the
# dev server is for, and about five times the bytes of what belongs on a wire.
CMD ["node", "sites/site/server.js", "--prod"]
