// AWS Signature Version 4, in about sixty lines.
//
// Polly is the only TTS provider here that will not accept a bearer token or an API key, and the
// app carries no AWS SDK — pulling one in for one signature would add a dependency tree larger
// than the rest of the provider layer put together. The algorithm is public and stable, and it is
// pure: same inputs, same signature, so it is testable without a network.
//
// Reference: docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** '20260902T101530Z' and its date half — AWS wants both, from the same instant. */
export function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz: iso, day: iso.slice(0, 8) };
}

/**
 * Sign one request. Returns the headers to send, including Authorization.
 *
 * @param {object} o
 * @param {string} o.method    'POST' / 'GET'
 * @param {string} o.host      e.g. 'polly.ap-southeast-1.amazonaws.com'
 * @param {string} o.path      e.g. '/v1/speech'
 * @param {string} [o.query]   canonical query string, already sorted and encoded
 * @param {string} [o.body]    the exact bytes that will be sent
 * @param {string} o.region
 * @param {string} o.service   'polly'
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {Date}   [o.now]     injectable so a test can pin the signature
 */
export function signRequest({
  method, host, path, query = '', body = '', region, service,
  accessKeyId, secretAccessKey, now = new Date(),
}) {
  const { amz, day } = amzDate(now);
  const payloadHash = sha256(body);
  // Canonical headers must be lowercase, sorted, and exactly the ones listed in signedHeaders.
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    'X-Amz-Date': amz,
    'X-Amz-Content-Sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
