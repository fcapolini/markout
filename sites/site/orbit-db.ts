/**
 * Orbit's operations database.
 *
 * Fake and in-memory: what this exists to show is the seam, not the storage.
 * The rows are the ones the page used to declare inline -- moved here
 * unchanged, so the console renders exactly as it did and the only thing
 * that differs is where its data comes from.
 *
 * Every call is async and a little slow, because that is the part that
 * matters: the page waits for these while it renders, and the visitor does
 * not wait for anything.
 */

const SERVICES = [
  { id: 'edge', name: 'edge-router', owner: 'Platform', state: 'ok',
    uptime: 99.98, latency: 42, rps: 8600, errors: 0.02 },
  { id: 'api', name: 'public-api', owner: 'Core', state: 'ok',
    uptime: 99.95, latency: 118, rps: 5200, errors: 0.11 },
  { id: 'auth', name: 'auth-service', owner: 'Identity', state: 'degraded',
    uptime: 99.41, latency: 340, rps: 1900, errors: 1.84 },
  { id: 'jobs', name: 'job-runner', owner: 'Platform', state: 'ok',
    uptime: 99.99, latency: 12, rps: 640, errors: 0.00 },
  { id: 'search', name: 'search-index', owner: 'Data', state: 'ok',
    uptime: 99.87, latency: 76, rps: 2400, errors: 0.19 },
  { id: 'billing', name: 'billing', owner: 'Revenue', state: 'down',
    uptime: 97.20, latency: 0, rps: 0, errors: 100 },
  ];

const DEPLOYS = [
  { id: 'd-2481', service: 'public-api', env: 'production', commit: '9f3c1ab',
    author: 'ada', state: 'shipped', secs: 214, ago: 12 },
  { id: 'd-2480', service: 'auth-service', env: 'production', commit: '4d81e02',
    author: 'grace', state: 'failed', secs: 96, ago: 48 },
  { id: 'd-2479', service: 'auth-service', env: 'staging', commit: '4d81e02',
    author: 'grace', state: 'shipped', secs: 88, ago: 61 },
  { id: 'd-2478', service: 'edge-router', env: 'production', commit: 'c07f5de',
    author: 'barbara', state: 'shipped', secs: 143, ago: 130 },
  { id: 'd-2477', service: 'search-index', env: 'staging', commit: '1a9b7c4',
    author: 'karen', state: 'running', secs: 51, ago: 3 },
  { id: 'd-2476', service: 'job-runner', env: 'production', commit: 'be22910',
    author: 'ada', state: 'shipped', secs: 67, ago: 240 },
  { id: 'd-2475', service: 'billing', env: 'production', commit: '77d0c31',
    author: 'lynn', state: 'failed', secs: 402, ago: 300 },
  { id: 'd-2474', service: 'billing', env: 'staging', commit: '77d0c31',
    author: 'lynn', state: 'shipped', secs: 388, ago: 330 },
  { id: 'd-2473', service: 'public-api', env: 'staging', commit: '02ea6f8',
    author: 'ada', state: 'shipped', secs: 191, ago: 420 },
  { id: 'd-2472', service: 'edge-router', env: 'staging', commit: 'de41b09',
    author: 'barbara', state: 'shipped', secs: 121, ago: 500 },
  { id: 'd-2471', service: 'search-index', env: 'production', commit: 'ff3a8d2',
    author: 'karen', state: 'shipped', secs: 260, ago: 640 },
  { id: 'd-2470', service: 'auth-service', env: 'staging', commit: '8c1e40a',
    author: 'grace', state: 'queued', secs: 0, ago: 690 },
  { id: 'd-2469', service: 'job-runner', env: 'staging', commit: '5b7d2c9',
    author: 'ada', state: 'shipped', secs: 44, ago: 1500 },
  { id: 'd-2468', service: 'public-api', env: 'production', commit: 'aa90f13',
    author: 'karen', state: 'shipped', secs: 233, ago: 1900 },
  { id: 'd-2467', service: 'billing', env: 'staging', commit: '6e2c807',
    author: 'lynn', state: 'shipped', secs: 355, ago: 2600 },
  { id: 'd-2466', service: 'edge-router', env: 'production', commit: '3f8b1a5',
    author: 'barbara', state: 'shipped', secs: 118, ago: 3100 },
  { id: 'd-2465', service: 'search-index', env: 'staging', commit: 'd41cb60',
    author: 'karen', state: 'failed', secs: 12, ago: 4400 },
  { id: 'd-2464', service: 'job-runner', env: 'production', commit: '90ac2f7',
    author: 'ada', state: 'shipped', secs: 59, ago: 5800 },
  ];

const TRAFFIC = [
  2760, 2880, 3010, 2940, 3180, 3320, 3260, 3090, 2970, 3140, 3380, 3510,
  3120, 3040, 2980, 3260, 3510, 3880, 4210, 4460, 4390, 4620, 4810, 5030,
  5220, 5110, 4980, 5240, 5480, 5610, 5390, 5720, 5940, 6110, 5980, 6240,
  6480, 6320, 6150, 6390, 6610, 6840, 6720, 6580, 6810, 7020, 6890, 7140,
  ];

const FAULTS = [
  9, 8, 11, 10, 13, 12, 9, 8, 7, 9, 11, 10,
  14, 11, 9, 12, 18, 22, 19, 16, 13, 15, 12, 10,
  11, 14, 21, 28, 34, 41, 37, 29, 24, 19, 16, 15,
  13, 12, 14, 17, 15, 12, 14, 16, 13, 11, 12, 14,
  ];

const LATENCIES = [
  96, 94, 99, 97, 102, 104, 100, 97, 95, 98, 101, 103,
  104, 101, 99, 106, 112, 118, 121, 117, 113, 110, 108, 105,
  107, 111, 124, 138, 152, 171, 164, 149, 137, 128, 122, 118,
  115, 113, 116, 121, 119, 114, 117, 120, 116, 112, 114, 118,
  ];

const ENDPOINTS = [
  { path: '/v1/events', calls: 184200, share: 38, tone: 'primary' },
  { path: '/v1/projects', calls: 96400, share: 20, tone: 'info' },
  { path: '/v1/auth/token', calls: 72900, share: 15, tone: 'success' },
  { path: '/v1/search', calls: 58100, share: 12, tone: 'warning' },
  { path: '/v1/billing/usage', calls: 34700, share: 7, tone: 'secondary' },
  ];

const ZONES = [
  { name: 'eu-west', share: 46, tone: 'primary' },
  { name: 'us-east', share: 34, tone: 'info' },
  { name: 'ap-south', share: 20, tone: 'warning' },
  ];

const FEED = [
  { who: 'grace', what: 'restarted auth-service in production', ago: 8, kind: 'warning' },
  { who: 'ada', what: 'shipped public-api 9f3c1ab', ago: 12, kind: 'success' },
  { who: 'orbit', what: 'auto-scaled edge-router to 14 nodes', ago: 27, kind: 'secondary' },
  { who: 'lynn', what: 'opened incident #418 — billing unreachable', ago: 44, kind: 'danger' },
  { who: 'karen', what: 'reindexed search-index (2.1M documents)', ago: 96, kind: 'info' },
  { who: 'barbara', what: 'merged "cache edge responses" into main', ago: 180, kind: 'secondary' },
  ];

const INCIDENTS = [
  { id: 418, services: ['billing'],
    title: 'billing unreachable in eu-west', since: 44, tone: 'danger',
    detail: 'The billing service stopped answering health checks after the '
      + '77d0c31 rollout. Traffic is being held at the edge; no customer '
      + 'charges have been lost.' },
  { id: 417, services: ['auth'],
    title: 'auth-service latency above budget', since: 210, tone: 'warning',
    detail: 'Token issuance is running at roughly three times its usual '
      + 'latency since the connection pool was resized.' },
  ];

const TODOS = [
  { id: 1, text: 'Roll back billing to 6e2c807', done: false, due: 'today' },
  { id: 2, text: 'Raise the auth-service pool back to 40', done: false, due: 'today' },
  { id: 3, text: 'Post the incident note in #status', done: true, due: 'today' },
  { id: 4, text: 'Review edge-router cache hit rate', done: false, due: 'this week' },
  { id: 5, text: 'Archive the 2465 build logs', done: true, due: 'this week' },
  ];

/** stands in for a round trip, so the render has something real to wait on */
function slow<T>(value: T, ms = 20): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(structuredClone(value)), ms));
}

export function openOperationsDb() {
  return {
    services: {
  all: () => slow(SERVICES),
    },
    deploys: {
  recent: () => slow(DEPLOYS),
    },
    metrics: {
  /** forty-eight hourly readings, oldest first */
  traffic: () => slow(TRAFFIC),
  faults: () => slow(FAULTS),
  latencies: () => slow(LATENCIES),
  endpoints: () => slow(ENDPOINTS),
  zones: () => slow(ZONES),
    },
    activity: {
  feed: () => slow(FEED),
    },
    incidents: {
  /**
       * Open incidents for the services given, which is what makes this the
       * second link of a chain: the page cannot ask until it knows which
       * services are unwell, and that answer is itself a query.
       */
  forServices: (ids: string[]) =>
  slow(INCIDENTS.filter(i => ids.some(id => i.services.includes(id)))),
    },
    todos: {
  open: () => slow(TODOS),
    },
  };
}

export type OperationsDb = ReturnType<typeof openOperationsDb>;
