/**
* @description Unit tests for account creation reservations
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAccountCreationReservations = require('../webserver/account-creation-reservations.js').createAccountCreationReservations;

test('account creation reservations serialize requests within each domain', function () {
    const reservations = createAccountCreationReservations();
    assert.equal(reservations.acquire('tenant'), true);
    assert.equal(reservations.isPending('tenant'), true);
    assert.equal(reservations.acquire('tenant'), false);
    assert.equal(reservations.acquire('other'), true);
    assert.equal(reservations.release('tenant'), true);
    assert.equal(reservations.isPending('tenant'), false);
    assert.equal(reservations.acquire('tenant'), true);
});

test('releasing an absent account creation reservation is harmless', function () {
    const reservations = createAccountCreationReservations();
    assert.equal(reservations.release('tenant'), false);
});
