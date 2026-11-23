// test/cookie.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCookies } = require('../auth/middleware');

test('parses a cookie header into a map', () => {
  assert.deepStrictEqual(parseCookies('a=1; cl_session=abc.def; b=2'),
    { a: '1', cl_session: 'abc.def', b: '2' });
});

test('handles missing / empty header', () => {
  assert.deepStrictEqual(parseCookies(undefined), {});
  assert.deepStrictEqual(parseCookies(''), {});
});

test('url-decodes values', () => {
  assert.deepStrictEqual(parseCookies('x=a%20b'), { x: 'a b' });
});
