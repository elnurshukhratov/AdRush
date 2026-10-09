'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDbUnavailable, isUniqueViolation } = require('../src/utils/dbErrors');

const known = (code) => Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code });

test('DB mavjud emasligi aniqlanadi', () => {
  assert.equal(isDbUnavailable(known('P1001')), true);
  assert.equal(isDbUnavailable(known('P1017')), true);
  assert.equal(isDbUnavailable(Object.assign(new Error('x'), { name: 'PrismaClientInitializationError' })), true);
  assert.equal(isDbUnavailable(known('P2002')), false);
  assert.equal(isDbUnavailable(new Error('boshqa')), false);
  assert.equal(isDbUnavailable(null), false);
});

test('unique constraint buzilishi aniqlanadi', () => {
  assert.equal(isUniqueViolation(known('P2002')), true);
  assert.equal(isUniqueViolation(known('P2025')), false);
});
