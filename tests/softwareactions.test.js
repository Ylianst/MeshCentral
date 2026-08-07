'use strict';

const assert = require('assert');
const softwareActions = require('../softwareactions.js');

const ADMIN = 0xFFFFFFFF;
const REMOTE_CONTROL = 0x00000008;
const REMOTE_VIEW_ONLY = 0x00000100;
const DEVICE_DETAILS = 0x00100000;
const NO_SOFTWARE = 0x00800000;

function permitted(action, rights) {
    return softwareActions.isActionAllowed(action, rights);
}

assert.strictEqual(permitted('installedapps', REMOTE_CONTROL | REMOTE_VIEW_ONLY), true, 'view-only users retain inventory access');
assert.strictEqual(permitted('installedstoreapps', REMOTE_CONTROL | REMOTE_VIEW_ONLY), true, 'view-only users retain store inventory access');
assert.strictEqual(permitted('uninstallapp', REMOTE_CONTROL | REMOTE_VIEW_ONLY), false, 'view-only users cannot change software');
assert.strictEqual(permitted('uninstallstoreapp', REMOTE_CONTROL | REMOTE_VIEW_ONLY), false, 'view-only users cannot change store software');

assert.strictEqual(permitted('uninstallapp', DEVICE_DETAILS), false, 'device details does not permit software changes');
assert.strictEqual(permitted('uninstallapp', REMOTE_CONTROL), false, 'remote control does not permit software changes');
assert.strictEqual(permitted('uninstallstoreapp', REMOTE_CONTROL), false, 'remote control does not permit store software changes');

assert.strictEqual(permitted('installedapps', ADMIN), true, 'administrators can read inventory');
assert.strictEqual(permitted('installedstoreapps', ADMIN), true, 'administrators can read store inventory');
assert.strictEqual(permitted('uninstallapp', ADMIN), true, 'administrators can change software');
assert.strictEqual(permitted('uninstallstoreapp', ADMIN), true, 'administrators can change store software');

assert.strictEqual(permitted('installedapps', REMOTE_CONTROL | REMOTE_VIEW_ONLY | NO_SOFTWARE), false, 'No Software denies inventory access');
assert.strictEqual(permitted('uninstallapp', REMOTE_CONTROL | REMOTE_VIEW_ONLY | NO_SOFTWARE), false, 'No Software denies software changes');
assert.strictEqual(permitted('unknown', ADMIN), false, 'unknown actions are denied');
assert.strictEqual(permitted('UninstallApp', ADMIN), false, 'action names are exact');
assert.strictEqual(permitted(undefined, ADMIN), false, 'missing actions are denied');
assert.strictEqual(permitted('installedapps', undefined), false, 'missing rights are denied');

assert.strictEqual(softwareActions.getActionKind('installedapps'), 'read');
assert.strictEqual(softwareActions.getActionKind('installedstoreapps'), 'read');
assert.strictEqual(softwareActions.getActionKind('uninstallapp'), 'change');
assert.strictEqual(softwareActions.getActionKind('uninstallstoreapp'), 'change');
assert.strictEqual(softwareActions.getActionKind('unknown'), null);

console.log('software action permission checks passed');
