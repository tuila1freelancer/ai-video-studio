import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRefusal, host, isLoopback, isServerMode, mode } from '../src/core/runtime-mode.js';

test('desktop is the default shape, loopback the default interface', () => {
  assert.equal(mode({}), 'desktop');
  assert.equal(isServerMode({}), false);
  assert.equal(host({}), '127.0.0.1');
  assert.equal(host({ AVS_HOST: '  0.0.0.0 ' }), '0.0.0.0');
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('0.0.0.0'), false);
});

test('server mode is opt-in and does not change the default interface', () => {
  assert.equal(mode({ AVS_MODE: 'server' }), 'server');
  assert.equal(mode({ AVS_MODE: 'Server' }), 'desktop', 'only the exact flag counts');
  assert.equal(host({ AVS_MODE: 'server' }), '127.0.0.1');
});

test('an unauthenticated API is never published to a network', () => {
  assert.equal(bootRefusal({}), null);
  assert.equal(bootRefusal({ AVS_HOST: '127.0.0.1' }), null);
  assert.equal(bootRefusal({ AVS_MODE: 'server', AVS_HOST: '0.0.0.0' }), null);
  const refusal = bootRefusal({ AVS_HOST: '0.0.0.0' });
  assert.match(refusal, /AVS_MODE=server/, 'the refusal says how to fix it');
});
