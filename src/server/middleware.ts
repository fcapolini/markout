import { generate } from 'escodegen';
import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Compiler } from '../compiler/compiler';
import { PROPS_GLOBAL } from '../constants';
import { Element, NodeType } from '../html/dom';
import { PageError } from '../html/parser';
import { WebContext, WebContextProps } from '../runtime/web/web-context';
import { MarkoutLogger } from './logger';

export const CLIENT_CODE_REQ = '/.markout.js';

export interface MarkoutProps {
  docroot: string;
  ssr?: boolean;
  csr?: boolean;
  logger?: MarkoutLogger;
  clientCodePath?: string;
  // virtualFiles?: Array<VirtualFile>;
}

//TODO: add virtualFiles
//TODO: cache compiled pages
//TODO: sandbox server-side logic execution
//TODO: pool of server-side executor workers
//TODO: pool of server-side compiler workers
//TODO: queue concurrent compilations of same pages
export function markout(props: MarkoutProps) {
  props.clientCodePath ??= path.join(__dirname, 'client.js');
  const docroot = props.docroot || process.cwd();
  const compiler = new Compiler({ docroot });
  const clientCode = props.csr
    ? fs.readFileSync(props.clientCodePath).toString()
    : '';

  return async function (req: Request, res: Response, next: NextFunction) {
    const i = req.path.lastIndexOf('.');
    const extname = i < 0 ? '.html' : req.path.substring(i).toLowerCase();

    if (handleNonPageRequests(req, res, i, extname, clientCode, next)) {
      return;
    }

    const pathname = await resolvePath(req, res, i, docroot);
    if (!pathname) {
      res.sendStatus(404);
      return;
    }
    const page = await compiler.compile(pathname);
    if (page.source.errors.length) {
      return serveErrorPage(page.source.errors, res);
    }

    let doc = page.source.doc;
    const propsJs = props.ssr || props.csr ? generate(page.code) : '';

    if (props.ssr) {
      // https://esbuild.github.io/content-types/#direct-eval
      const root = (0, eval)(propsJs);
      const props: WebContextProps = { doc, root };
      new WebContext(props).refresh();
    }

    if (props.csr && doc?.documentElement) {
      for (const n of doc.documentElement.childNodes) {
        if (
          n.nodeType === NodeType.ELEMENT &&
          (n as Element).tagName === 'BODY'
        ) {
          const script1 = doc.createElement('script');
          script1.appendChild(
            doc.createTextNode(`${PROPS_GLOBAL} = ${propsJs}`)
          );
          (n as Element).appendChild(script1);
          const script2 = doc.createElement('script');
          script2.setAttribute('src', CLIENT_CODE_REQ);
          script2.setAttribute('async', '');
          (n as Element).appendChild(script2);
          break;
        }
      }
    }

    const html = doc.toString();
    res.header('Content-Type', 'text/html;charset=UTF-8');
    res.send('<!doctype html>\n' + html);
  };
}

function handleNonPageRequests(
  req: Request,
  res: Response,
  i: number,
  extname: string,
  clientCode: string,
  next: NextFunction
) {
  if (req.path === CLIENT_CODE_REQ) {
    res.header('Content-Type', 'text/javascript;charset=UTF-8');
    res.send(clientCode);
    return true;
  }
  if (req.path.startsWith('/.') || extname === '.htm') {
    res.sendStatus(404);
    return true;
  }
  if (extname !== '.html') {
    next();
    return true;
  }
  return false;
}

async function resolvePath(
  req: Request,
  res: Response,
  i: number,
  docroot: string
) {
  let pathname = i < 0 ? req.path : req.path.substring(0, i).toLowerCase();
  if (i < 0) {
    try {
      // Remove leading slash to ensure relative path resolution
      const relativePath = pathname.startsWith('/')
        ? pathname.slice(1)
        : pathname;
      const fullPath = path.resolve(docroot, relativePath);
      // Ensure the resolved path is contained in docroot
      if (!fullPath.startsWith(path.resolve(docroot))) {
        return;
      }
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) {
        // if path is a dir, access <dir>/index.html
        pathname = path.join(pathname, 'index');
      }
    } catch (ignored) {
      // Intentionally ignore file system errors (file not found, permission denied, etc.)
      // Return undefined to let caller handle with 404 response
      return;
    }
  }
  return pathname + '.html';
}

function serveErrorPage(errors: PageError[], res: Response) {
  const p = new Array<string>();
  p.push(`<!doctype html><html><head>
    <title>Page Error</title>
    <meta name="color-scheme" content="light dark"/>
    </head><body><ul>`);
  errors.forEach(err => {
    const l = err.loc;
    p.push(`<li>${err.msg}`);
    l && p.push(` - ${l.source} `);
    l && p.push(`[${l.start.line}, ${l.start.column + 1}]`);
    p.push('</li>');
  });
  p.push('</ul></body></html>');
  res.header('Content-Type', 'text/html;charset=UTF-8');
  res.sendStatus(500);
  res.send(p.join(''));
}
