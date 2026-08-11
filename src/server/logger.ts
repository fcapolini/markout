/* istanbul ignore file */

export type MarkoutLogger = (
  type: 'error' | 'warn' | 'info' | 'debug',
  msg: unknown
) => void;

export const defaultLogger: MarkoutLogger = (type, msg) => {
  const ts = getTimestamp();
  switch (type) {
    case 'error':
      console.error(ts, type, msg);
      break;
    case 'warn':
      console.warn(ts, type, msg);
      break;
    case 'info':
      console.info(ts, type, msg);
      break;
    case 'debug':
      console.debug(ts, type, msg);
      break;
    default:
      console.log(ts, type, msg);
  }
};

function getTimestamp(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    ('' + (d.getMonth() + 1)).padStart(2, '0') +
    '-' +
    ('' + d.getDate()).padStart(2, '0') +
    ' ' +
    ('' + d.getHours()).padStart(2, '0') +
    ':' +
    ('' + d.getMinutes()).padStart(2, '0') +
    ':' +
    ('' + d.getSeconds()).padStart(2, '0')
  );
}
