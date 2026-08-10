/**
* @description Unit tests for custom icon storage and validation helpers
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('path');
const crypto = require('crypto');
const customIconsModule = require('../../../webserver/ui/custom-icons.js');
const createCustomIcons = customIconsModule.createCustomIcons;

const icons = createCustomIcons({ crypto: crypto, path: path, fs: {}, datapath: path.join('data', 'root') });

test('custom icon paths use stable non-identifying user keys', function () {
    const user = { _id: 'user/domain/alice' };
    const key = crypto.createHash('sha256').update(user._id).digest('hex');
    assert.equal(icons.getUserKey(user), key);
    assert.equal(icons.getUserDir(user), path.join('data', 'root', 'icons', 'custom', key));
    assert.equal(icons.getUserKey(null), null);
});

test('custom icon MIME types accept only supported extensions', function () {
    assert.equal(icons.getMimeType('ICON.SVG'), 'image/svg+xml');
    assert.equal(icons.getMimeType('icon.png'), 'image/png');
    assert.equal(icons.getMimeType('icon.jpeg'), 'image/jpeg');
    assert.equal(icons.getMimeType('icon.html'), null);
});

test('SVG cleaning rejects scripts, event handlers and href references', function () {
    assert.equal(icons.cleanSvg('\uFEFF<svg><path d="M0 0"/></svg>'), '<svg><path d="M0 0"/></svg>');
    assert.equal(icons.cleanSvg('<svg><script>alert(1)</script></svg>'), null);
    assert.equal(icons.cleanSvg('<svg><path onclick="run()"/></svg>'), null);
    assert.equal(icons.cleanSvg('<svg><image href="https://example.com/a.png"/></svg>'), null);
    assert.equal(icons.cleanSvg('<svg><use href="#shape"/></svg>'), null);
});

test('PNG and JPEG dimensions are read from validated headers', function () {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png);
    png.writeUInt32BE(32, 16);
    png.writeUInt32BE(48, 20);
    assert.deepEqual(icons.getDimensions(png, '.png'), { width: 32, height: 48 });

    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x07, 0x08, 0x00, 0x20, 0x00, 0x30, 0xFF, 0xD9]);
    assert.deepEqual(icons.getDimensions(jpeg, '.jpg'), { width: 48, height: 32 });
    assert.equal(icons.getDimensions(Buffer.from('not an image'), '.png'), null);
});

test('custom icon handlers resolve only valid owned or legacy paths', function () {
    const user = { _id: 'user/domain/alice' };
    const userKey = icons.getUserKey(user);
    const handlers = customIconsModule.createCustomIconHandlers({
        state: {
            common: { IsFilenameValid: function (name) { return /^[a-zA-Z0-9_.-]+$/.test(name) && (name !== '..'); } },
            path: path,
            users: {},
            fs: {}
        },
        parent: { datapath: path.join('data', 'root') },
        customIcons: icons,
        checkUserIpAddress: function () { return {}; },
        getDomain: function () { return {}; },
        resolveSafeUploadTempPath: function () { return null; },
        multiparty: { Form: function () { } }
    });

    const owned = handlers.resolvePath('/domain/icons/custom/' + userKey + '/myDevices.svg?version=1', user);
    assert.equal(owned.isOwned, true);
    assert.equal(owned.isLegacy, false);
    assert.equal(owned.diskPath, path.join('data', 'root', 'icons', 'custom', userKey, 'myDevices.svg'));

    const legacy = handlers.resolvePath('/icons/custom/myDevices.png', user);
    assert.equal(legacy.isLegacy, true);
    assert.equal(legacy.isOwned, false);
    assert.equal(handlers.resolvePath('/icons/custom/another-user/myDevices.svg', user).isOwned, false);
    assert.equal(handlers.resolvePath('https://example.com/icons/custom/icon.svg', user), null);
    assert.equal(handlers.resolvePath('/icons/custom/../icon.svg', user), null);
    assert.equal(handlers.resolvePath('/icons/custom/icon.html', user), null);
});
