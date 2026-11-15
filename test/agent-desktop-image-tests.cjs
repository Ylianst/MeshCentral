const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(setImmediate);
function fixture(fallback = false) {
    const pending = [], images = [], drawn = [], closed = [], revoked = [], sent = [];
    const context = { Blob, Promise, navigator: { platform: 'Linux', userAgent: 'mozilla' }, console,
        document: {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: x => revoked.push(x) },
        Image: function () { images.push(this); },
        createImageBitmap: fallback ? undefined : blob => new Promise((resolve, reject) => pending.push({ blob, resolve, reject })) };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../public/scripts/agent-desktop-0.0.2.js'), 'utf8'), context);
    const canvas = { style: {}, width: 100, height: 100, getContext: () => ({ drawImage: image => drawn.push(image.id), setTransform() {}, clearRect() {} }) };
    const desktop = context.CreateAgentRemoteDesktop(canvas);
    desktop.parent = { send: value => sent.push(value) };
    desktop.State = 3; desktop.onResize = () => {};
    const picture = id => ({ id, close: () => closed.push(id) });
    const tile = () => desktop.ProcessPictureMsg(new Uint8Array([0, 0, 0, 0, 255, 216]), 0, 0);
    return { desktop, pending, images, drawn, closed, revoked, sent, picture, tile };
}
(async () => {
    { // Upstream serves source assets; checked-in minified files were removed.
        let f = fixture(false);
        f.tile(); f.tile(); await tick();
        assert.equal(f.pending[0].blob.size, 2);
        f.pending[1].resolve(f.picture(2)); await tick(); assert.deepEqual(f.drawn, []);
        f.pending[0].resolve(f.picture(1)); await tick(); assert.deepEqual(f.drawn, [1, 2]); assert.deepEqual(f.closed, [1, 2]);
        f = fixture(false); f.tile(); f.tile(); await tick();
        f.pending[0].reject(new Error('corrupt')); f.pending[1].resolve(f.picture(2)); await tick();
        assert.deepEqual(f.drawn, [2]); assert.equal(f.desktop.PendingOperations.length, 0);
        assert.equal(f.sent.filter(x => x.charCodeAt(1) === 6).length, 1);
        f = fixture(false); f.tile(); await tick(); f.desktop.ProcessScreenMsg(50, 50);
        f.pending[0].resolve(f.picture(1)); await tick(); assert.deepEqual(f.drawn, []); assert.deepEqual(f.closed, [1]);
        f = fixture(false); f.tile(); await tick(); f.desktop.State = 0;
        f.pending[0].resolve(f.picture(1)); await tick(); assert.deepEqual(f.drawn, []); assert.deepEqual(f.closed, [1]);
        f = fixture(true); f.tile(); assert.equal(typeof f.images[0].onerror, 'function');
        f.images[0].onerror(); await tick(); f.tile(); f.images[1].id = 2; f.images[1].onload();
        assert.deepEqual(f.drawn, [2]); assert.equal(f.revoked.length, 2);
        f = fixture(true); f.tile(); f.desktop.ProcessScreenMsg(50, 50);
        assert.equal(f.revoked.length, 1); assert.equal(f.images[0].onload, null); assert.deepEqual(f.drawn, []);
        f = fixture(false);
        f.desktop.recordedData = []; f.desktop.recordedSize = 0;
        f.desktop.ProcessBinaryCommand(3, 10, new Uint8Array([0, 3, 0, 10, 0, 0, 0, 0, 255, 216]));
        assert.equal(f.desktop.recordedData.length, 1); await tick(); f.pending[0].resolve(f.picture(1)); await tick();
    }
    console.log('Viewer source: ordering, errors, refresh, resize/disconnect, cleanup, recording passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
