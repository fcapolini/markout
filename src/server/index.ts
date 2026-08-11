import express, { Application } from "express";
import http from "http";
import exitHook from './exit-hook';
import { defaultLogger, MarkoutLogger } from "./logger";
import process from "process";
import { markout } from "./middleware";
import { AddressInfo } from "net";

export interface ServerProps {
  docroot: string;
  port?: number;
  trustProxy?: boolean;
  logger?: MarkoutLogger;
}

export class Server {
  private props: ServerProps;
  private logger: MarkoutLogger;
  server?: http.Server;
  port?: number;
  app?: Application;

  constructor(props: ServerProps) {
    this.props = props;
    this.logger = props.logger || defaultLogger;
  }

  async start(): Promise<this> {
    if (this.server) {
      return this;
    }
    const config = this.props;
    const app = (this.app = express());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    // see https://expressjs.com/en/guide/behind-proxies.html
    config.trustProxy && app.set('trust proxy', 1);
    config.docroot ||= process.cwd();

    app.use(markout(config));

    app.use(express.static(config.docroot));
    this.server = app.listen(config.port);
    this.port = (this.server?.address() as AddressInfo).port;
    this.logger('info', `[server] docroot ${config.docroot}`);
    this.logger('info', `[server] address http://127.0.0.1:${this.port}/`);
    exitHook(() => this.logger('info', '[server] will exit'));
    process.on('uncaughtException', err => {
      this.logger('error', err.stack ? err.stack : `${err}`);
    });
    return this;
  }

  async stop(): Promise<this> {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    return this;
  }
}
