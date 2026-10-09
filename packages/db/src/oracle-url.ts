import { isIPv6 } from 'node:net';
import { invalid, isRecord } from '@deckbuilder/server-core';

export interface OracleUrl {
  /** What `oracledb.getConnection` takes: `host:port/service`, or a descriptor for a SID. */
  connectString: string;
  host: string;
  port: number;
  service?: string;
  sid?: string;
}

/** What the app's connection records hold (the password is the store's secret field). */
export interface DbConnectionFields {
  name: string;
  url: string;
  user: string;
}

const MAX_URL = 300;
const DEFAULT_PORT = 1521;
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const IPV4ISH = /^[\d.]+$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const NAME = /^[A-Za-z0-9_.$#-]{1,128}$/;
const THIN = /^(?:jdbc:)?oracle:thin:@/i;
// Host (bracketed IPv6 or anything up to : or /), optional :port, then /service or :SID.
const PARTS = /^(\[[^\]]*\]|[^:/[\]]+)(?::(\d{1,5}))?(?:([/:])(.*))?$/;

const badUrl = () => invalid('badDbUrl', 'Use oracle:thin:@host:port/service.');

/**
 * Parses the Oracle URL forms people paste: `jdbc:oracle:thin:@host:port/service`,
 * `oracle:thin:@host:port/service`, `@//host:port/service`, `host:port/service` and the SID form
 * `…@host:port:SID`. The port defaults to 1521 in the `//` and plain forms. Descriptors, TNS
 * aliases and query parameters are refused.
 */
export function parseOracleUrl(raw: unknown): OracleUrl {
  if (typeof raw !== 'string') throw badUrl();
  let rest = raw.trim();
  if (!rest || rest.length > MAX_URL) throw badUrl();
  let prefixed = false;
  const thin = THIN.exec(rest);
  if (thin) {
    rest = rest.slice(thin[0].length);
    prefixed = true;
  } else if (rest.startsWith('@')) {
    rest = rest.slice(1);
    prefixed = true;
  }
  const slashes = rest.startsWith('//');
  if (slashes) rest = rest.slice(2);

  const m = PARTS.exec(rest);
  if (!m) throw badUrl();
  const [, hostPart, portText, sep, name] = m;
  if (!sep || !name || !NAME.test(name)) throw badUrl();
  const host = validHost(hostPart!);
  if (host === null) throw badUrl();
  const port = portText === undefined ? null : Number(portText);
  if (port !== null && (port < 1 || port > 65535)) throw badUrl();

  if (sep === ':') {
    // SID: needs the port, and EZConnect's `//` form has no SID.
    if (port === null || slashes) throw badUrl();
    const connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${name})))`;
    return { connectString, host, port, sid: name };
  }
  if (port === null && prefixed && !slashes) throw badUrl();
  const p = port ?? DEFAULT_PORT;
  const hostText = host.includes(':') ? `[${host}]` : host;
  return { connectString: `${hostText}:${p}/${name}`, host, port: p, service: name };
}

/** The host without brackets, or null. */
function validHost(text: string): string | null {
  if (text.startsWith('[')) {
    const inner = text.slice(1, -1);
    return isIPv6(inner) ? inner : null;
  }
  if (IPV4ISH.test(text)) return IPV4.test(text) ? text : null;
  return text.length <= 253 && HOSTNAME.test(text) ? text : null;
}

/** `validate` for the app's connection `recordStore`: builds the record fields from raw client input. */
export function validConnection(input: unknown): DbConnectionFields {
  if (!isRecord(input)) throw invalid('badRequest', 'Invalid request.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 80) throw invalid('dbBadName', 'The name must have 1 to 80 characters.');
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  parseOracleUrl(url);
  return { name, url, user: validUser(input.user) };
}

/** The trimmed user name of a connection. */
export function validUser(input: unknown): string {
  const user = typeof input === 'string' ? input.trim() : '';
  if (!/^\S{1,128}$/.test(user)) throw invalid('dbBadUser', 'The user must have 1 to 128 characters, without spaces.');
  return user;
}
