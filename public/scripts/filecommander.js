/**
* @description File Commander - a dual pane file manager for the Files tab.
*
* Each pane shows either the remote device (over the existing files tunnel) or a folder on this
* computer (File System Access API, Chromium based browsers). Files are copied or moved between
* the panes with F5/F6, drag and drop or the context menu. Folders are copied recursively.
*
* The page owns the files tunnel. It forwards the messages it receives to processData(),
* processBinary() and processBinaryString(), and calls onConnect()/onDisconnect() when the
* tunnel state changes. Requests sent from here use reqid/id values starting with "fc" so the
* page can tell them apart from its own.
*/

var FileCommander = (function () {
    'use strict';

    var localSupported = (typeof window.showDirectoryPicker == 'function') && (window.isSecureContext == true);

    // Why this browser cannot show folders of this computer, so the pane can say what to change
    function localUnsupportedReason() {
        if (window.isSecureContext != true) return 'Folders on this computer can only be opened when MeshCentral is opened over HTTPS. This page was opened over HTTP.';
        if (navigator.brave != null) return 'Brave turns off access to folders on this computer. Turn on the File System Access API at brave://flags (#file-system-access-api) and restart Brave, or use Chrome or Edge.';
        return 'This browser cannot open folders on this computer (Firefox and Safari do not support it). Use Chrome or Edge, on Windows, Linux or macOS.';
    }
    var uploadWindow = 8; // Upload blocks sent but not yet acknowledged by the agent
    var maxEditSize = 5 * 1024 * 1024;

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    function sizeStr(n) {
        if ((n == null) || isNaN(n)) return '';
        if (n < 1024) return n + ' B';
        var u = ['KB', 'MB', 'GB', 'TB', 'PB'], i = -1;
        do { n /= 1024; i++; } while ((n >= 1024) && (i < u.length - 1));
        return n.toFixed((n < 10) ? 2 : ((n < 100) ? 1 : 0)) + ' ' + u[i];
    }

    function fileType(item) {
        if (item.kind == 'source') return item.desc;
        if (item.sroot) return ({ 1: 'My files', 4: 'Device group files', 5: 'User group files', 6: 'Shared files' }[item.st] || 'Shared files') + (item.ro ? ' (read only)' : '');
        if (item.kind == 'place') return item.fav ? 'Favorite' : 'Recent folder';
        if (item.kind == 'dlplace') return 'Browser downloads';
        if (item.kind == 'browse') return '';
        if (item.kind == 'drive') { return (item.dt == 'REMOVABLE') ? 'Removable Disk' : ((item.dt == 'CDROM') ? 'CD Drive' : ((item.dt == 'NETWORK') ? 'Network Drive' : 'Local Disk')); }
        if (item.kind == 'dir') return 'File Folder';
        var i = item.name.lastIndexOf('.');
        if ((i <= 0) || (i == item.name.length - 1)) return 'File';
        return item.name.substring(i + 1).toUpperCase() + ' File';
    }

    function cancelError() { var e = new Error('Canceled'); e.canceled = true; return e; }

    // Small IndexedDB key/value store, used to remember local folders between visits.
    function idbOpen() {
        return new Promise(function (resolve, reject) {
            var r = indexedDB.open('meshcentral-filecommander', 1);
            r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
            r.onsuccess = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
        });
    }
    function idbGet(key) {
        return idbOpen().then(function (db) {
            return new Promise(function (resolve) {
                var r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
                r.onsuccess = function () { resolve(r.result); };
                r.onerror = function () { resolve(null); };
            });
        }).catch(function () { return null; });
    }
    function idbSet(key, value) {
        return idbOpen().then(function (db) {
            return new Promise(function (resolve) {
                var t = db.transaction('kv', 'readwrite');
                t.objectStore('kv').put(value, key);
                t.oncomplete = function () { resolve(true); };
                t.onerror = function () { resolve(false); };
            });
        }).catch(function () { return false; });
    }

    function storeGet(key, def) { try { var v = localStorage.getItem(key); return (v == null) ? def : JSON.parse(v); } catch (ex) { return def; } }
    function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (ex) { } }

    // host: {
    //   root: element to render in,
    //   send(obj), sendBinary(Uint8Array), isConnected(), isWindows(), isSftp(), nodeId(), nodeName(),
    //   chunkSize(), formatDate(Date), downloadUrl(path, name) (optional), onActiveChanged(active) (optional)
    // }
    function create(host) {
        var obj = { active: false };
        var root = host.root;
        var panes = [];
        var activeIdx = 1;
        var reqSeq = 0;
        var pending = {};        // ls reqid -> { resolve, reject, timer }
        var upload = null;       // Running upload
        var download = null;     // Running download
        var job = null;          // Running copy/move job
        var remoteDrives = null; // Root listing of a Windows device
        var recentLocal = [];    // Recently used local folder handles
        var favLocal = [];       // Favorite local folder handles
        var favRemote = storeGet('fcFavRemote', []); // Favorite device folders: [{ w: windows, path }], the path may use variables
        var cfg = host.config || {};  // The domain's fileCommander settings (lower case keys)
        var remoteEnv = null;         // { platform, user, env } from the device, used to resolve %VAR% and $VAR in locations
        var envPromise = null;
        favRemote = favRemote.filter(function (f) { return f && ((typeof f.path == 'string') || Array.isArray(f.segs)); }).map(function (f) {
            if (typeof f.path == 'string') return f;
            return { w: f.w, path: f.w ? (f.segs.join('\\') + ((f.segs.length == 1) ? '\\' : '')) : ('/' + f.segs.join('/')) }; // Older entries kept the folder as segments
        });
        var menuEl = null, modalEl = null;
        var dragSource = null;

        //
        // Remote primitives
        //

        function nextId(p) { return 'fc' + p + (++reqSeq); }
        function connected() { return host.isConnected() == true; }
        function rSend(cmd) { if (connected()) { host.send(cmd); } }
        function caseless() { return host.isWindows(); }

        function rPath(segs) {
            if (host.isWindows()) { return (segs.length == 0) ? '' : (segs.join('/') + ((segs.length == 1) ? '/' : '')); }
            return '/' + segs.join('/');
        }
        function rPathNoSlash(segs) { return host.isWindows() ? segs.join('/') : ('/' + segs.join('/')); }
        function rDisplay(segs) {
            if (host.isWindows()) { return (segs.length == 0) ? 'Computer' : (segs.join('\\') + ((segs.length == 1) ? '\\' : '')); }
            return '/' + segs.join('/');
        }
        function rParse(s) { return String(s).replace(/\\/g, '/').split('/').filter(function (x) { return (x != '') && (x != '.'); }); }

        function rList(path) {
            return new Promise(function (resolve, reject) {
                if (!connected()) { reject(new Error('Not connected')); return; }
                var reqid = nextId('l');
                pending[reqid] = { resolve: resolve, reject: reject, timer: setTimeout(function () { delete pending[reqid]; reject(new Error('The device did not answer')); }, 120000) };
                host.send({ action: 'ls', reqid: reqid, path: path });
            });
        }

        // Work out the device's path variables once per connection. Over SFTP the server's relay reports the home
        // folder. For agents they are worked out here, from the logged in user the server knows and folder listings.
        function requestEnv() {
            if (envPromise) return envPromise;
            envPromise = new Promise(function (resolve) {
                if (!connected()) { resolve(null); return; }
                if (!host.isSftp()) { agentEnv().then(function (e) { remoteEnv = e; resolve(e); }, function () { resolve(null); }); return; }
                var reqid = nextId('e');
                pending[reqid] = { raw: true, resolve: function (data) { remoteEnv = { platform: data.platform, user: data.user, env: data.env || {} }; resolve(remoteEnv); }, reject: function () { resolve(null); }, timer: setTimeout(function () { delete pending[reqid]; resolve(null); }, 6000) };
                host.send({ action: 'envpaths', reqid: reqid });
            });
            return envPromise;
        }

        // The usual Windows and Unix folders. The user's folders are found by listing the folders that hold the
        // profiles, since the profile of sam can be C:\Users\sam.CORP, and OneDrive can move Desktop and Documents.
        async function agentEnv() {
            var users = (host.deviceUsers ? host.deviceUsers() : null) || [], name = null, env = {}, k;
            for (var i = 0; i < users.length; i++) { if (typeof users[i] == 'string') { name = users[i].split('\\').pop().split('@')[0]; break; } }
            function names(dir) { return (dir || []).filter(function (f) { return f.t == 2; }).map(function (f) { return f.n; }); }
            async function list(path) { try { return await rList(path); } catch (ex) { return null; } }
            var folders = { DESKTOP: 'Desktop', DOCUMENTS: 'Documents', DOWNLOADS: 'Downloads', PICTURES: 'Pictures', MUSIC: 'Music', VIDEOS: 'Videos' };
            if (host.isWindows()) {
                env = { SYSTEMDRIVE: 'C:', SYSTEMROOT: 'C:\\Windows', WINDIR: 'C:\\Windows', PROGRAMDATA: 'C:\\ProgramData', ALLUSERSPROFILE: 'C:\\ProgramData', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', PUBLIC: 'C:\\Users\\Public', TEMP: 'C:\\Windows\\Temp', TMP: 'C:\\Windows\\Temp' };
                if (name == null) return { platform: 'win32', user: null, env: env };
                var n = name.toLowerCase(), profiles = names(await list('C:/Users')), dir = null;
                profiles.forEach(function (d) { var l = d.toLowerCase(); if (l == n) { dir = d; } else if ((dir == null) && (l.indexOf(n + '.') == 0)) { dir = d; } });
                if (dir == null) return { platform: 'win32', user: null, env: env };
                var profile = 'C:\\Users\\' + dir;
                env.USERNAME = name; env.USERPROFILE = profile; env.HOMEDRIVE = 'C:'; env.HOMEPATH = '\\Users\\' + dir;
                env.APPDATA = profile + '\\AppData\\Roaming'; env.LOCALAPPDATA = profile + '\\AppData\\Local'; env.TEMP = env.TMP = env.LOCALAPPDATA + '\\Temp';
                for (k in folders) { env[k] = profile + '\\' + folders[k]; }
                // OneDrive folder backup moves Desktop, Documents and Pictures into the OneDrive folder
                var od = names(await list('C:/Users/' + dir)).filter(function (d) { return (d == 'OneDrive') || (d.indexOf('OneDrive - ') == 0); });
                if (od.length > 0) {
                    env.ONEDRIVE = profile + '\\' + od[0];
                    var inside = names(await list('C:/Users/' + dir + '/' + od[0]));
                    ['DESKTOP', 'DOCUMENTS', 'PICTURES'].forEach(function (x) { if (inside.indexOf(folders[x]) >= 0) { env[x] = env.ONEDRIVE + '\\' + folders[x]; } });
                }
                return { platform: 'win32', user: name, env: env };
            }
            var mac = host.isMac ? host.isMac() : false, home = null;
            if (name == 'root') { home = mac ? '/var/root' : '/root'; }
            else if (name != null) {
                var base = mac ? '/Users' : '/home';
                if (names(await list(base)).indexOf(name) >= 0) { home = base + '/' + name; }
            }
            if (home == null) return { platform: mac ? 'darwin' : 'linux', user: null, env: env };
            env.HOME = home;
            for (k in folders) { env[k] = home + '/' + folders[k]; }
            return { platform: mac ? 'darwin' : 'linux', user: name, env: env };
        }

        // Replace %VAR% (Windows) or $VAR, ${VAR} and a leading ~ (other systems) with the device's values.
        // Returns null when a variable is unknown on the device.
        function expandVars(text) {
            var env = (remoteEnv && remoteEnv.env) || {}, bad = false, s = String(text).trim();
            function get(n) { var v = env[host.isWindows() ? n.toUpperCase() : n]; if (typeof v != 'string') { bad = true; return ''; } return v; }
            if (host.isWindows()) { s = s.replace(/%([^%\\\/]+)%/g, function (m, n) { return get(n); }); }
            else {
                s = s.replace(/^~(?=\/|$)/, function () { return get('HOME'); });
                s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, function (m, a, b) { return get(a || b); });
            }
            return bad ? null : s;
        }

        function remoteOs() {
            if (host.isWindows()) return 'windows';
            return (remoteEnv && (remoteEnv.platform == 'darwin')) ? 'mac' : 'linux';
        }

        // Which devices a location is for: its os setting, or a guess from how the path is written
        function locationFits(loc) {
            var os = (typeof loc.os == 'string') ? loc.os.toLowerCase() : null, path = loc.path;
            if (os == null) {
                if (/%[^%]+%|^[A-Za-z]:|\\/.test(path)) { os = 'windows'; }
                else if (/^[\/$~]/.test(path)) { os = 'unix'; }
                else { return true; }
            }
            var dev = remoteOs();
            return (os == dev) || ((os == 'unix') && (dev != 'windows'));
        }

        // Built-in locations. user: only shown when someone is logged in, since the agent's own profile is not useful.
        var builtinLocations = [
            { name: 'Desktop', path: '%DESKTOP%', user: 1 }, { name: 'Documents', path: '%DOCUMENTS%', user: 1 }, { name: 'Downloads', path: '%DOWNLOADS%', user: 1 },
            { name: 'User profile', path: '%USERPROFILE%', user: 1 }, { name: 'AppData (Roaming)', path: '%APPDATA%', user: 1 }, { name: 'AppData (Local)', path: '%LOCALAPPDATA%', user: 1 },
            { name: 'User temp', path: '%TEMP%', user: 1 }, { name: 'Users', path: '%SystemDrive%\\Users' }, { name: 'Public Desktop', path: '%PUBLIC%\\Desktop' },
            { name: 'ProgramData', path: '%ProgramData%' }, { name: 'Program Files', path: '%ProgramFiles%' }, { name: 'Program Files (x86)', path: '%ProgramFiles(x86)%' },
            { name: 'Windows temp', path: '%SystemRoot%\\Temp' },
            { name: 'Home', path: '~' }, { name: 'Desktop', path: '$DESKTOP', user: 1 }, { name: 'Documents', path: '$DOCUMENTS', user: 1 }, { name: 'Downloads', path: '$DOWNLOADS', user: 1 },
            { name: 'Applications', path: '/Applications', os: 'mac' }, { name: '/tmp', path: '/tmp' }, { name: '/var/log', path: '/var/log' }, { name: '/etc', path: '/etc' }
        ];

        // This device's own settings, saved on the device record by anyone who can manage it: { startpath, locations }
        function deviceSettings() { var d = host.deviceConfig ? host.deviceConfig() : null; return ((d != null) && (typeof d == 'object')) ? d : {}; }
        function canEditDevice() { return !!(host.canEditDevice && host.saveDeviceConfig && host.canEditDevice()); }

        // The locations to offer for this device, resolved: [{ name, path, segs, own }]. The device's own come first,
        // then config.json, then the built-in ones. A device's own location the device cannot resolve is kept with segs null.
        function deviceLocations() {
            var list = [], seen = {}, dev = deviceSettings();
            function norm(a) { return (Array.isArray(a) ? a : []).map(function (l) { return (typeof l == 'string') ? { path: l } : l; }).filter(function (l) { return l && (typeof l.path == 'string'); }); }
            function add(l, own) {
                if (!own && !locationFits(l)) return;
                var x = expandVars(l.path), segs = (x == null) ? null : rParse(x);
                if (segs == null) { if (own) { list.push({ name: l.name || l.path, path: l.path, segs: null, own: true }); } return; }
                var key = rPath(segs).toLowerCase();
                if (seen[key]) return;
                seen[key] = 1;
                list.push({ name: (typeof l.name == 'string') ? l.name : l.path, path: l.path, segs: segs, own: own });
            }
            if (typeof dev.startpath == 'string') { add({ name: 'Start folder', path: dev.startpath }, true); }
            norm(dev.locations).forEach(function (l) { add(l, true); });
            norm(cfg.locations).forEach(function (l) { add(l, false); });
            if (cfg.commonlocations !== false) { builtinLocations.forEach(function (l) { if (!l.user || (remoteEnv && remoteEnv.user)) { add(l, false); } }); }
            return list;
        }

        // Where a device opens the first time: its own start folder, else the one in config.json
        function startPath() {
            var dev = deviceSettings();
            if (typeof dev.startpath == 'string') return dev.startpath;
            return (typeof cfg.startpath == 'string') ? cfg.startpath : null;
        }

        function startSegs() {
            var sp = startPath();
            if (sp == null) return [];
            var x = expandVars(sp);
            return (x == null) ? [] : rParse(x);
        }

        // Edit this device's start folder and locations. Saved on the device for everyone who can see it.
        async function editDeviceLocations(p) {
            if (!canEditDevice()) return;
            var dev = deviceSettings(), w = host.isWindows();
            var lines = (Array.isArray(dev.locations) ? dev.locations : []).map(function (l) { return (l.name ? (l.name + ' = ') : '') + l.path; });
            var help = 'Shown for everyone who opens this device, above the locations of config.json. One folder per line, optionally named as <i>Name = folder</i>. ' +
                (w ? 'Variables such as %USERPROFILE%, %DESKTOP% or %DOWNLOADS% are read from the device, for the logged in user.' : 'Variables such as $HOME, ~/projects or ${DOWNLOADS} are read from the device, for the logged in user.');
            var r = await modal('Locations for ' + (host.nodeName() || 'this device'), help, [['Save', 'save', true], ['Cancel', null]],
                { multiline: true, value: lines.join('\n'), extra: { label: 'Start folder, used the first time the device is opened (empty for the default)', value: dev.startpath || '' } });
            if (r.value != 'save') return;
            var locs = [];
            r.text.split(/\r?\n/).forEach(function (l) {
                l = l.trim();
                if ((l == '') || (l[0] == '#')) return;
                var i = l.indexOf(' = ');
                locs.push((i > 0) ? { name: l.substring(0, i).trim(), path: l.substring(i + 3).trim() } : { path: l });
            });
            var settings = {};
            if (r.extra.trim() != '') { settings.startpath = r.extra.trim(); }
            if (locs.length > 0) { settings.locations = locs.slice(0, 100); }
            if (Object.keys(settings).length == 0) { settings = null; }
            host.saveDeviceConfig(settings);
            if (settings && settings.startpath && host.nodeId()) { storeSet('fcPaths', storeGet('fcPaths', []).filter(function (x) { return x.n != host.nodeId(); })); } // So this browser opens the new start folder next time
            flash(p, 'Saved for this device', true);
            renderDrives(panes[0]); renderDrives(panes[1]);
        }

        function remoteItem(f) {
            var d = null;
            if (f.d != null) { d = (typeof f.d == 'number') ? (f.d * 1000) : Date.parse(f.d); if (isNaN(d)) { d = null; } }
            return { name: f.n, kind: (f.t == 1) ? 'drive' : ((f.t == 2) ? 'dir' : 'file'), size: (f.t == 3) ? (f.s || 0) : ((f.t == 1) ? f.s : null), free: f.f, dt: f.dt, date: d };
        }

        function rUpload(dirPath, name, blob, onProgress) {
            return new Promise(function (resolve, reject) {
                if (!connected()) { reject(new Error('Not connected')); return; }
                upload = { reqid: nextId('u'), blob: blob, size: blob.size, ptr: 0, inflight: 0, reading: false, doneSent: false, resolve: resolve, reject: reject, onProgress: onProgress };
                host.send({ action: 'upload', reqid: upload.reqid, path: dirPath, name: name, size: blob.size });
            });
        }

        function uploadPump() {
            var u = upload;
            if ((u == null) || u.reading) return;
            if (u.ptr >= u.size) {
                if ((u.inflight == 0) && !u.doneSent) { u.doneSent = true; rSend({ action: 'uploaddone', reqid: u.reqid }); }
                return;
            }
            if (u.inflight >= uploadWindow) return;
            var end = Math.min(u.size, u.ptr + host.chunkSize());
            u.reading = true;
            u.blob.slice(u.ptr, end).arrayBuffer().then(function (buf) {
                u.reading = false;
                if (upload !== u) return;
                var d = new Uint8Array(buf);
                if ((d.length > 0) && ((d[0] == 0) || (d[0] == 123))) { var x = new Uint8Array(d.length + 1); x.set(d, 1); d = x; } // Leading zero marks the block as data, not JSON
                host.sendBinary(d);
                u.inflight++;
                u.ptr = end;
                if (u.onProgress) { u.onProgress(u.ptr, u.size); }
                uploadPump();
            }, function (err) {
                u.reading = false;
                if (upload !== u) return;
                upload = null;
                rSend({ action: 'uploadcancel', reqid: u.reqid });
                u.reject(err);
            });
        }

        function uploadMessage(m) {
            var u = upload;
            if ((u == null) || (u.reqid != m.reqid)) return;
            switch (m.action) {
                case 'uploadstart': { uploadPump(); break; }
                case 'uploadack': { if (u.inflight > 0) { u.inflight--; } uploadPump(); break; }
                case 'uploaddone': { upload = null; u.resolve(); break; }
                case 'uploaderror': { upload = null; u.reject(new Error('Unable to write the file on the device')); break; }
                case 'uploadcancel': { upload = null; u.reject(cancelError()); break; }
            }
        }

        function uploadCancel() {
            var u = upload;
            if (u == null) return;
            upload = null;
            rSend({ action: 'uploadcancel', reqid: u.reqid });
            u.reject(cancelError());
        }

        // sink: { write(Uint8Array) -> Promise, close() -> Promise, abort() }
        function rDownload(path, size, sink, onProgress) {
            return new Promise(function (resolve, reject) {
                if (!connected()) { reject(new Error('Not connected')); return; }
                download = { id: nextId('d'), state: 0, got: 0, size: size, sink: sink, chain: Promise.resolve(), resolve: resolve, reject: reject, onProgress: onProgress };
                host.send({ action: 'download', sub: 'start', id: download.id, path: path });
            });
        }

        function downloadFail(d, err) {
            if (download === d) { download = null; rSend({ action: 'download', sub: 'stop', id: d.id }); }
            if (d.failed) return;
            d.failed = true;
            try { d.sink.abort(); } catch (ex) { }
            d.reject(err);
        }

        function downloadMessage(m) {
            var d = download;
            if ((d == null) || (d.id != m.id)) return;
            if (m.sub == 'start') { d.state = 1; rSend({ action: 'download', sub: 'startack', id: d.id }); }
            else if (m.sub == 'cancel') { download = null; downloadFail(d, new Error('Unable to read the file on the device')); }
        }

        function downloadBlock(data) {
            var d = download;
            if ((d == null) || (d.state != 1) || (data.length < 4) || (data[0] != 1)) return false;
            var payload = data.slice(4), last = ((data[3] & 1) != 0);
            d.got += payload.length;
            if (payload.length > 0) { d.chain = d.chain.then(function () { if (!d.failed) { return d.sink.write(payload); } }); }
            d.chain = d.chain.catch(function (err) { downloadFail(d, err); });
            if (d.onProgress) { d.onProgress(d.got, d.size); }
            if (last) {
                download = null;
                d.chain.then(function () { if (!d.failed) { return d.sink.close().then(d.resolve); } }).catch(function (err) { downloadFail(d, err); });
            } else {
                rSend({ action: 'download', sub: 'ack', id: d.id });
            }
            return true;
        }

        function downloadCancel() { var d = download; if (d != null) { downloadFail(d, cancelError()); } }

        function memorySink() {
            var chunks = [], size = 0;
            return {
                write: function (b) { size += b.length; if (size > maxEditSize) { return Promise.reject(new Error('File is too large')); } chunks.push(b); return Promise.resolve(); },
                close: function () { return Promise.resolve(); },
                abort: function () { chunks = []; },
                blob: function () { return new Blob(chunks); }
            };
        }

        function localSink(dirHandle, name) {
            return dirHandle.getFileHandle(name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) {
                var aborted = null;
                return { write: function (b) { return w.write(b); }, close: function () { return w.close(); }, abort: function () { if (aborted == null) { aborted = w.abort().catch(function () { }); } return aborted; } };
            });
        }

        //
        // Local helpers
        //

        async function localEntries(dirHandle) {
            var list = [], files = [];
            for await (var h of dirHandle.values()) {
                if (h.kind == 'directory') { list.push({ name: h.name, kind: 'dir', size: null, date: null, handle: h }); }
                else { var it = { name: h.name, kind: 'file', size: null, date: null, handle: h }; list.push(it); files.push(it); }
            }
            for (var i = 0; i < files.length; i += 64) {
                await Promise.all(files.slice(i, i + 64).map(function (it) {
                    return it.handle.getFile().then(function (f) { it.size = f.size; it.date = f.lastModified; }, function () { });
                }));
            }
            return list;
        }

        async function ensurePermission(handle) {
            var opts = { mode: 'readwrite' };
            if ((await handle.queryPermission(opts)) == 'granted') return true;
            return (await handle.requestPermission(opts)) == 'granted';
        }

        //
        // Files on server: the user's "My Files" and the files of device groups, kept on the MeshCentral server.
        // The page holds the whole tree, sent by the server after every change. Files move over HTTP.
        //

        var serverWaiters = [], serverXhr = null;
        function serverTree() { return host.serverFiles ? host.serverFiles() : null; }
        function serverAvailable() { return serverTree() != null; }

        // Ask the server for the tree again. Resolves when it arrives, or after 5 seconds.
        function serverRefreshTree() {
            return new Promise(function (resolve) { serverWaiters.push(resolve); host.serverSend({ action: 'files' }); setTimeout(resolve, 5000); });
        }

        // segs: the folder keys from the root, the first one being the owner (user//name or mesh//id)
        function serverNode(segs) {
            var t = serverTree();
            for (var i = 0; t && (i < segs.length); i++) { t = (t.f || {})[segs[i]]; }
            return (t && (t.f != null)) ? t : null;
        }
        // The top of the server files has My Files (type 1), the domain's Shared Files (6), device group (4) and user group (5) folders.
        // A pane shows one scope of them: mine (My Files), shared (Shared Files) or server (the group folders, listed at the top).
        function rootScope(t) { return (t == 1) ? 'mine' : ((t == 6) ? 'shared' : 'server'); }
        function scopeRootKey(scope) { var t = serverTree(); if (t && t.f) { for (var k in t.f) { if (rootScope(t.f[k].t) == scope) return k; } } return null; }
        function paneScope(p) { return p.scope || 'server'; }
        function singleRoot(p) { return paneScope(p) != 'server'; } // My Files and Shared Files open in their own folder
        function serverItems(segs, scope) {
            var n = serverNode(segs), r = [];
            if (n == null) return null;
            for (var k in n.f) {
                var f = n.f[k];
                if (segs.length == 0) { if (rootScope(f.t) == scope) { r.push({ name: f.n || k, key: k, kind: 'drive', sroot: true, st: f.t, ro: (f.ro == true) }); } }
                else if (f.t == 3) { r.push({ name: k, kind: 'file', size: f.s || 0, date: (f.d > 1000) ? f.d : null }); }
                else { r.push({ name: k, kind: 'dir', size: null, date: null }); }
            }
            return r;
        }
        function sKey(row) { return row.key || row.name; }
        function myRootKey() { return scopeRootKey('mine'); }
        // The server sends ro on shared folders the user can only read
        function serverReadOnly(segs) { var t = serverTree(); return (segs.length == 0) || !!(t && t.f && t.f[segs[0]] && t.f[segs[0]].ro); }
        function sLink(segs) { return segs.join('/'); }
        function sDisplay(segs) {
            if (segs.length == 0) return 'Server files';
            var t = serverTree(), root = (t && t.f && t.f[segs[0]] && t.f[segs[0]].n) ? t.f[segs[0]].n : segs[0];
            return [root].concat(segs.slice(1)).join('\\') + '\\';
        }
        function sOp(cmd) { cmd.action = 'fileoperation'; host.serverSend(cmd); }
        function sUrl(segs) { return 'downloadfile.ashx?link=' + encodeURIComponent(sLink(segs)); }

        function sXhr(method, url, body, onProgress, upload) {
            return new Promise(function (resolve, reject) {
                var x = new XMLHttpRequest();
                serverXhr = x;
                x.open(method, url);
                if (!upload) { x.responseType = 'blob'; }
                (upload ? x.upload : x).onprogress = function (e) { if (onProgress) { onProgress(e.loaded, e.lengthComputable ? e.total : 0); } };
                x.onload = function () { serverXhr = null; if (x.status == 200) { resolve(x.response); } else { reject(new Error((x.status == 401) ? 'Not allowed on the server' : ('The server answered ' + x.status))); } };
                x.onerror = function () { serverXhr = null; reject(new Error('The server could not be reached')); };
                x.onabort = function () { serverXhr = null; reject(cancelError()); };
                x.send(body);
            });
        }
        function sDownload(segs, onProgress) { return sXhr('GET', sUrl(segs), null, onProgress, false); }
        function sUpload(dirSegs, name, blob, onProgress) {
            var fd = new FormData();
            fd.append('link', encodeURIComponent(sLink(dirSegs)));
            fd.append('files', blob, name);
            return sXhr('POST', 'uploadfile.ashx', fd, onProgress, true);
        }
        function serverCancel() { if (serverXhr) { try { serverXhr.abort(); } catch (ex) { } } }

        async function loadServer(p, segs, keepMarks, focusName) {
            if (p.type != 'server') return false;
            if (!serverAvailable()) { p.items = []; p.rows = []; p.message = 'Files on the server are not available to your account.'; renderPane(p); return false; }
            var seq = ++p.loadSeq, t = serverTree();
            if ((t.f == null) || (Object.keys(t.f).length == 0)) { p.loading = true; renderStatus(p); await serverRefreshTree(); }
            if ((seq != p.loadSeq) || (p.type != 'server')) return false;
            p.loading = false;
            var own = singleRoot(p) ? scopeRootKey(paneScope(p)) : null;
            if (singleRoot(p) && ((segs.length == 0) || (segs[0] != own))) { segs = (own != null) ? [own] : []; } // My Files and Shared Files open at their own top
            var items = serverItems(segs, paneScope(p));
            if (items == null) {
                if (segs.length > (singleRoot(p) ? 1 : 0)) { flash(p, 'Unable to open ' + sDisplay(segs)); return loadServer(p, segs.slice(0, -1)); }
                items = [];
            }
            var samePath = (sLink(segs) == sLink(p.ssegs));
            var prevName = (p.rows[p.cursor] != null) ? p.rows[p.cursor].name : null;
            p.ssegs = segs;
            p.items = items;
            p.message = null;
            finishLoad(p, (samePath && keepMarks), focusName || (samePath ? prevName : null));
            storeSet('fcServerSegs', [panes[0].ssegs, panes[1].ssegs]);
            return true;
        }

        //
        // Panes
        //

        function newPane(idx) {
            return { idx: idx, type: 'remote', segs: [], ssegs: [], stack: [], items: [], rows: [], sortKey: 'name', sortDir: 1, marked: {}, cursor: 0, anchor: 0, loadSeq: 0, loading: false, message: null, el: {} };
        }

        function other(p) { return panes[1 - p.idx]; }
        function activePane() { return panes[activeIdx]; }

        function paneLabel(p) {
            if (p.type == 'home') return 'Home';
            if (p.type == 'remote') return rDisplay(p.segs);
            if (p.type == 'server') return sDisplay(p.ssegs);
            if (p.stack.length == 0) return 'This computer';
            return p.stack.map(function (h) { return h.name; }).join('\\') + '\\';
        }

        function sortItems(p) {
            var dir = p.sortDir, key = p.sortKey;
            function byName(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); }
            var cmp = byName;
            if (key == 'size') { cmp = function (a, b) { return ((a.size || 0) - (b.size || 0)) || byName(a, b); }; }
            else if (key == 'date') { cmp = function (a, b) { return ((a.date || 0) - (b.date || 0)) || byName(a, b); }; }
            else if (key == 'type') { cmp = function (a, b) { return fileType(a).localeCompare(fileType(b)) || byName(a, b); }; }
            // Every source has .. at its top too, back to Home
            var up = (p.type == 'home') ? [] : [{ up: true, name: '..', kind: 'up' }];
            if ((p.type == 'home') || localRoot(p)) { p.rows = up.concat(p.items); return; } // Keep the order of these lists
            var rank = { drive: 0, dir: 1, file: 2 };
            var list = p.items.slice().sort(function (a, b) { return (rank[a.kind] - rank[b.kind]) || (cmp(a, b) * dir); });
            p.rows = up.concat(list);
        }

        function atRoot(p) { if (p.type == 'home') return true; return (p.type == 'remote') ? (p.segs.length == 0) : ((p.type == 'server') ? (p.ssegs.length <= (singleRoot(p) ? 1 : 0)) : (p.stack.length == 0)); }
        function localRoot(p) { return (p.type == 'local') && (p.stack.length == 0); }
        function isEntry(r) { return (r.kind == 'file') || (r.kind == 'dir'); }

        function saveState() {
            storeSet('fcTypes3', [srcValue(panes[0]), srcValue(panes[1])]);
            storeSet('fcSort', [[panes[0].sortKey, panes[0].sortDir], [panes[1].sortKey, panes[1].sortDir]]);
            if (host.nodeId()) {
                var paths = storeGet('fcPaths', []).filter(function (x) { return x.n != host.nodeId(); });
                paths.push({ n: host.nodeId(), p: [panes[0].segs, panes[1].segs] });
                while (paths.length > 40) { paths.shift(); }
                storeSet('fcPaths', paths);
            }
        }

        async function loadRemote(p, segs, keepMarks, focusName) {
            if (p.type != 'remote') return false;
            if (!connected()) { p.items = []; p.rows = []; p.message = 'Not connected. Use the Connect button above.'; renderPane(p); return false; }
            var seq = ++p.loadSeq;
            p.loading = true; renderStatus(p);
            var dir;
            try { dir = await rList(rPath(segs)); } catch (ex) { if (seq == p.loadSeq) { p.loading = false; flash(p, ex.message); renderStatus(p); } return false; }
            if ((seq != p.loadSeq) || (p.type != 'remote')) return false;
            p.loading = false;
            if (dir == null) {
                flash(p, 'Unable to open ' + rDisplay(segs));
                if ((p.rows.length == 0) && (segs.length > 0)) { return loadRemote(p, segs.slice(0, -1)); }
                renderStatus(p);
                return false;
            }
            var samePath = (rPath(segs) == rPath(p.segs));
            var prevName = (p.rows[p.cursor] != null) ? p.rows[p.cursor].name : null;
            p.segs = segs;
            p.items = dir.map(remoteItem);
            p.message = null;
            if (segs.length == 0 && host.isWindows()) { remoteDrives = p.items.filter(function (x) { return x.kind == 'drive'; }); renderDrives(panes[0]); renderDrives(panes[1]); }
            finishLoad(p, (samePath && keepMarks), focusName || (samePath ? prevName : null));
            saveState();
            return true;
        }

        async function loadLocal(p, stack, keepMarks, focusName) {
            if (p.type != 'local') return false;
            var seq = ++p.loadSeq;
            p.loading = true; renderStatus(p);
            var items;
            try { items = (stack.length == 0) ? (await placeItems()) : (await localEntries(stack[stack.length - 1])); } catch (ex) { if (seq == p.loadSeq) { p.loading = false; flash(p, ex.message); renderStatus(p); } return false; }
            if ((seq != p.loadSeq) || (p.type != 'local')) return false;
            p.loading = false;
            var samePath = (stack.length == p.stack.length) && ((stack.length == 0) || (stack[stack.length - 1] === p.stack[p.stack.length - 1]));
            var prevName = (p.rows[p.cursor] != null) ? p.rows[p.cursor].name : null;
            p.stack = stack;
            p.items = items;
            p.message = null;
            finishLoad(p, (samePath && keepMarks), focusName || (samePath ? prevName : null));
            return true;
        }

        function finishLoad(p, keepMarks, focusName) {
            if (!keepMarks) { p.marked = {}; }
            else { var names = {}; p.items.forEach(function (x) { names[x.name] = 1; }); for (var n in p.marked) { if (!names[n]) { delete p.marked[n]; } } }
            sortItems(p);
            p.cursor = 0;
            if (focusName != null) { for (var i = 0; i < p.rows.length; i++) { if (p.rows[i].name == focusName) { p.cursor = i; break; } } }
            p.anchor = p.cursor;
            renderPane(p);
        }

        // Home lists the sources a pane can show, so one double-click opens any of them
        // Home lists the sources a pane can show, each followed by shortcuts into it, so one double-click opens any of them.
        // Rows have an id (the source, or source|name for a shortcut) to keep the cursor in place when Home is rebuilt.
        async function homeItems() {
            var r = [], conn = connected();
            function src(name, s, icon, desc) { r.push({ id: s, name: name, kind: 'source', src: s, icon: icon, desc: desc }); }
            function link(s, name, icon, desc, go) { r.push({ id: s + '|' + name, name: name, kind: 'shortcut', src: s, icon: icon, desc: desc, go: go }); }

            src(host.nodeName() || 'Remote device', 'remote', 4, conn ? 'Remote device' : 'Remote device, not connected');
            if (conn) {
                if (host.isWindows() && (cfg.drives !== false)) { (remoteDrives || []).forEach(function (d) { link('remote', d.name, (d.dt == 'REMOVABLE') ? 5 : ((d.dt == 'CDROM') ? 6 : 1), fileType(d), function (p) { p.segs = [d.name]; setPaneType(p, 'remote'); }); }); }
                deviceLocations().forEach(function (l) { if (l.segs) { link('remote', l.name, 2, l.own ? 'This device' : 'Location', function (p) { p.segs = l.segs.slice(); setPaneType(p, 'remote'); }); } });
                favRemote.forEach(function (f) {
                    if (f.w != host.isWindows()) return;
                    var x = expandVars(f.path);
                    if (x != null) { link('remote', '\u2605 ' + f.path, 2, 'Favorite', function (p) { p.segs = rParse(x); setPaneType(p, 'remote'); }); }
                });
            }

            src('This computer', 'local', 1, localSupported ? 'Folders on this computer' : 'Not available in this browser');
            if (localSupported) {
                (await placeItems()).forEach(function (pl) {
                    if (pl.kind != 'place') return;
                    link('local', (pl.fav ? '\u2605 ' : '') + pl.name, 2, pl.fav ? 'Favorite' : 'Recent folder', function (p) { p.stack = []; setPaneType(p, 'local'); chooseLocalFolder(p, pl.handle); });
                });
            }

            if (serverAvailable()) {
                src('My Files', 'myfiles', 2, 'Your files on the server');
                var sh = (serverItems([], 'shared') || [])[0]; // The domain's Shared Files, when the server has them
                if (sh) { src(sh.name, 'shared', 1, 'Shared with all users' + (sh.ro ? ', read only' : '')); }
                src('Server files', 'server', 1, 'Device group and user group files');
                (serverItems([], 'server') || []).forEach(function (sr) { link('server', sr.name, (sr.st == 4) ? 4 : 1, fileType(sr), function (p) { p.scope = 'server'; p.ssegs = [sr.key]; setPaneType(p, 'server'); }); });
            }
            return r;
        }

        async function loadHome(p, focusId) {
            if (p.type != 'home') return;
            var seq = ++p.loadSeq;
            if (focusId == null) { focusId = (p.rows[p.cursor] || {}).id; }
            var items = await homeItems();
            if ((seq != p.loadSeq) || (p.type != 'home')) return;
            p.loading = false; p.message = null;
            p.items = items;
            finishLoad(p, false, null);
            for (var i = 0; i < p.rows.length; i++) { if (p.rows[i].id == focusId) { setCursor(p, i); break; } }
            // Fill in what is only known later, once per connection: the drives and the variables of the device
            if (connected() && !homeExtrasAsked) {
                homeExtrasAsked = true;
                var later = [requestEnv()];
                if (host.isWindows() && (remoteDrives == null)) { later.push(rList('').then(function (dir) { if (dir) { remoteDrives = dir.map(remoteItem).filter(function (x) { return x.kind == 'drive'; }); } }, function () { })); }
                Promise.all(later).then(refreshHomes);
            }
            // The page only has the server files once asked for them; the reply refreshes Home
            var t = serverTree();
            if ((t != null) && ((t.f == null) || (Object.keys(t.f).length == 0)) && !homeTreeAsked) { homeTreeAsked = true; serverRefreshTree(); }
        }

        var homeExtrasAsked = false, homeTreeAsked = false;
        function refreshHomes() { panes.forEach(function (p) { if (p.type == 'home') { loadHome(p); } }); }

        function goHome(p) { var from = srcValue(p); setPaneType(p, 'home'); loadHome(p, from); }

        function refresh(p, focusName) {
            if (p.type == 'home') { return loadHome(p); }
            if (p.type == 'remote') { return loadRemote(p, p.segs, true, focusName); }
            if (p.type == 'server') { return loadServer(p, p.ssegs, true, focusName); }
            return loadLocal(p, p.stack, true, focusName);
        }

        function refreshAll() { return Promise.all([refresh(panes[0]), refresh(panes[1])]); }

        function openRow(p, row) {
            if (row == null) return;
            if (row.up) { goUp(p); return; }
            if (row.kind == 'source') { setPaneType(p, row.src); return; }
            if (row.kind == 'shortcut') { row.go(p); return; }
            if (row.kind == 'place') { chooseLocalFolder(p, row.handle); return; }
            if (row.kind == 'browse') { chooseLocalFolder(p); return; }
            if (row.kind == 'dlplace') { flash(p, 'Copy or drag device files here to save them to your Downloads folder', true); return; }
            if ((row.kind == 'dir') || (row.kind == 'drive')) {
                if (p.type == 'remote') { loadRemote(p, p.segs.concat([row.name])); }
                else if (p.type == 'server') { loadServer(p, p.ssegs.concat([sKey(row)])); }
                else { loadLocal(p, p.stack.concat([row.handle])); }
                return;
            }
            if ((p.type == 'remote') || (p.type == 'server')) { downloadToBrowser(p, [row]); }
        }

        function goUp(p) {
            if (p.type == 'home') return;
            if (atRoot(p)) { goHome(p); return; }
            if (p.type == 'remote') { var name = p.segs[p.segs.length - 1]; loadRemote(p, p.segs.slice(0, -1), false, name); }
            else if (p.type == 'server') {
                var up = p.ssegs.slice(0, -1), last = p.ssegs[p.ssegs.length - 1], root = (up.length == 0) ? (serverItems([], 'server') || []).filter(function (x) { return x.key == last; })[0] : null;
                loadServer(p, up, false, root ? root.name : last);
            }
            else { var h = p.stack[p.stack.length - 1]; loadLocal(p, p.stack.slice(0, -1), false, h.name); }
        }

        function goRoot(p) {
            if (p.type == 'home') return;
            if (p.type == 'remote') { loadRemote(p, []); }
            else if (p.type == 'server') { loadServer(p, []); } // My Files goes to its own top
            else { loadLocal(p, []); }
        }

        function gotoPath(p, text) {
            if (p.type == 'home') { renderPath(p); return; }
            if (p.type == 'remote') {
                requestEnv().then(function () {
                    var x = expandVars(text);
                    if (x == null) { flash(p, remoteEnv ? 'Unknown variable in ' + text : 'This agent cannot resolve variables yet'); renderPath(p); return; }
                    loadRemote(p, rParse(x));
                });
                return;
            }
            if (p.type == 'server') {
                // The first part is the name shown for My Files or a device group
                var sp = rParse(text), roots = serverItems([], 'server') || [];
                if (singleRoot(p)) { // The path may start with the name of the folder, My Files or Shared Files
                    var own = scopeRootKey(paneScope(p)), ownName = (sDisplay(own ? [own] : []) || '').replace(/\\$/, '').toLowerCase();
                    if ((sp.length > 0) && (sp[0].toLowerCase() == ownName)) { sp.shift(); }
                    loadServer(p, [own].concat(sp)); return;
                }
                if (sp.length == 0) { loadServer(p, []); return; }
                var r = roots.filter(function (x) { return (x.name.toLowerCase() == sp[0].toLowerCase()) || (x.key == sp[0]); })[0];
                if (r == null) { flash(p, 'Not found on the server: ' + sp[0]); renderPath(p); return; }
                loadServer(p, [r.key].concat(sp.slice(1)));
                return;
            }
            // Local panes can only move inside the chosen folder
            var parts = rParse(text), stack = p.stack.slice(0, 1);
            if ((stack.length == 0) || (parts.length == 0) || (parts[0] != stack[0].name)) { flash(p, (stack.length == 0) ? 'Open a folder first' : ('Local paths must start with ' + stack[0].name)); renderPath(p); return; }
            (async function () {
                var s = stack.slice();
                for (var i = 1; i < parts.length; i++) {
                    try { s.push(await s[s.length - 1].getDirectoryHandle(parts[i])); } catch (ex) { flash(p, 'Folder not found: ' + parts[i]); break; }
                }
                loadLocal(p, s);
            })();
        }

        async function chooseLocalFolder(p, handle) {
            try {
                if (handle == null) { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'meshcommander' + p.idx }); }
                else if (!(await ensurePermission(handle))) { flash(p, 'Permission to the folder was denied'); return; }
            } catch (ex) { if (ex && (ex.name != 'AbortError')) { flash(p, ex.message); } return; }
            var list = [handle];
            for (var i = 0; i < recentLocal.length && list.length < 8; i++) {
                var same = false;
                try { same = await recentLocal[i].isSameEntry(handle); } catch (ex) { }
                if (!same) { list.push(recentLocal[i]); }
            }
            recentLocal = list;
            idbSet('recent', recentLocal);
            idbSet('last' + p.idx, handle);
            renderDrives(panes[0]); renderDrives(panes[1]);
            refreshHomes();
            loadLocal(p, [handle]);
        }

        // The "This computer" list. Browsers cannot list drives, so it shows the folders picked before.
        async function placeItems() {
            var items = [{ name: 'Browse for a folder...', kind: 'browse' }], seen = [];
            async function add(hd, fav) {
                for (var i = 0; i < seen.length; i++) { try { if (await seen[i].isSameEntry(hd)) return; } catch (ex) { } }
                seen.push(hd);
                items.push({ name: hd.name, kind: 'place', handle: hd, fav: fav });
            }
            for (var i = 0; i < favLocal.length; i++) { await add(favLocal[i], true); }
            for (var i = 0; i < recentLocal.length; i++) { await add(recentLocal[i], false); }
            items.push({ name: 'Downloads (save with the browser)', kind: 'dlplace' });
            return items;
        }

        async function localFavIndex(handle) {
            for (var i = 0; i < favLocal.length; i++) { try { if (await favLocal[i].isSameEntry(handle)) return i; } catch (ex) { } }
            return -1;
        }

        function remoteFavIndex(segs) {
            var w = host.isWindows(), key = rPath(segs);
            if (w) { key = key.toLowerCase(); }
            for (var i = 0; i < favRemote.length; i++) {
                var f = favRemote[i];
                if (f.w != w) continue;
                var x = expandVars(f.path);
                if (x == null) continue;
                var k = rPath(rParse(x));
                if ((w ? k.toLowerCase() : k) == key) return i;
            }
            return -1;
        }

        // Edit the device favorites as text, one folder per line. Lines can use variables.
        async function editFavorites(p) {
            var w = host.isWindows(), mine = favRemote.filter(function (f) { return f.w == w; }), others = favRemote.filter(function (f) { return f.w != w; });
            var help = w ? 'One folder per line. Variables such as %USERPROFILE%\\Desktop or %DOWNLOADS% are read from the device, for the logged in user.' : 'One folder per line. Variables such as $HOME/projects, ~/Downloads or ${DESKTOP} are read from the device, for the logged in user.';
            var r = await modal('Favorites for ' + (w ? 'Windows' : 'Linux and macOS') + ' devices', esc(help), [['Save', 'save', true], ['Cancel', null]], { multiline: true, value: mine.map(function (f) { return f.path; }).join('\n') });
            if (r.value != 'save') return;
            var lines = r.text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l != ''; });
            favRemote = others.concat(lines.map(function (l) { return { w: w, path: l }; }));
            storeSet('fcFavRemote', favRemote);
            refreshHomes();
            renderDrives(panes[0]); renderDrives(panes[1]);
            updateFavButton(panes[0]); updateFavButton(panes[1]);
        }

        // row: a folder row to add or remove, or null for the folder the pane shows
        async function toggleFavorite(p, row) {
            if (p.type == 'remote') {
                var segs = row ? p.segs.concat([row.name]) : p.segs;
                if (segs.length == 0) return;
                var i = remoteFavIndex(segs);
                if (i >= 0) { favRemote.splice(i, 1); flash(p, 'Removed from favorites', true); }
                else { favRemote.push({ w: host.isWindows(), path: rDisplay(segs) }); flash(p, 'Added to favorites', true); }
                storeSet('fcFavRemote', favRemote);
            } else {
                var hd = row ? row.handle : p.stack[p.stack.length - 1];
                if (hd == null) return;
                var j = await localFavIndex(hd);
                if (j >= 0) { favLocal.splice(j, 1); flash(p, 'Removed from favorites', true); }
                else { favLocal.push(hd); flash(p, 'Added to favorites', true); }
                idbSet('favorites', favLocal);
                panes.forEach(function (x) { if (localRoot(x)) { loadLocal(x, [], true); } });
            }
            renderDrives(panes[0]); renderDrives(panes[1]);
            updateFavButton(panes[0]); updateFavButton(panes[1]);
            refreshHomes();
        }

        async function removePlaces(p, rows) {
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].kind != 'place') continue;
                var hd = rows[i].handle, keep = [];
                for (var j = 0; j < recentLocal.length; j++) { var same = false; try { same = await recentLocal[j].isSameEntry(hd); } catch (ex) { } if (!same) { keep.push(recentLocal[j]); } }
                recentLocal = keep;
                var f = await localFavIndex(hd);
                if (f >= 0) { favLocal.splice(f, 1); }
            }
            idbSet('recent', recentLocal); idbSet('favorites', favLocal);
            renderDrives(panes[0]); renderDrives(panes[1]);
            refreshHomes();
            loadLocal(p, []);
        }

        function updateFavButton(p) {
            var b = p.el.fav;
            if (!b) return;
            function set(on, enabled) { b.innerHTML = on ? '&#x2605;' : '&#x2606;'; b.classList.toggle('fc-on', on); b.disabled = !enabled; b.title = on ? 'Remove this folder from favorites' : 'Add this folder to favorites'; }
            if (p.type == 'remote') { set(remoteFavIndex(p.segs) >= 0, p.segs.length > 0); return; }
            if ((p.type == 'server') || (p.type == 'home')) { b.style.display = 'none'; return; }
            b.style.display = '';
            if (p.stack.length == 0) { set(false, false); return; }
            var hd = p.stack[p.stack.length - 1];
            localFavIndex(hd).then(function (i) { if (p.stack[p.stack.length - 1] === hd) { set(i >= 0, true); } });
        }

        // type is a source value: remote, local, myfiles or server. My Files and Server files are both server panes.
        function setPaneType(p, type) {
            if ((type == 'myfiles') || (type == 'shared') || (type == 'server')) { var scope = { myfiles: 'mine', shared: 'shared', server: 'server' }[type]; if (scope != paneScope(p)) { p.ssegs = []; } p.scope = scope; type = 'server'; }
            p.type = type; p.items = []; p.rows = []; p.marked = {}; p.cursor = 0; p.message = null; p.loadSeq++;
            renderPane(p);
            renderDrives(p);
            saveState();
            if (type == 'home') { loadHome(p); }
            else if (type == 'remote') { loadRemote(p, p.segs || []); }
            else if (type == 'server') { loadServer(p, p.ssegs || []); }
            else { loadLocal(p, p.stack); }
        }

        //
        // Selection
        //

        function selectedRows(p) {
            var r = p.rows.filter(function (x) { return !x.up && p.marked[x.name]; });
            if ((r.length == 0) && (p.rows[p.cursor] != null) && !p.rows[p.cursor].up) { r = [p.rows[p.cursor]]; }
            return r;
        }

        function setCursor(p, i, extend) {
            if (p.rows.length == 0) return;
            i = Math.max(0, Math.min(p.rows.length - 1, i));
            p.cursor = i;
            if (extend) {
                p.marked = {};
                var a = Math.min(p.anchor, i), b = Math.max(p.anchor, i);
                for (var j = a; j <= b; j++) { if (!p.rows[j].up) { p.marked[p.rows[j].name] = 1; } }
            } else {
                p.anchor = i;
            }
            renderMarks(p);
            scrollToCursor(p);
        }

        function toggleMark(p, i) {
            var row = p.rows[i];
            if ((row == null) || row.up) return;
            if (p.marked[row.name]) { delete p.marked[row.name]; } else { p.marked[row.name] = 1; }
        }

        function setActive(idx) {
            activeIdx = idx;
            for (var i = 0; i < 2; i++) { panes[i].el.pane.classList.toggle('fc-active', i == idx); }
            renderButtons();
        }

        //
        // Rendering
        //

        function h(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html != null) { e.innerHTML = html; } return e; }

        function build() {
            root.innerHTML = '';
            root.classList.add('fc-root');
            var panesEl = h('div', 'fc-panes');
            for (var i = 0; i < 2; i++) {
                var p = panes[i], e = p.el;
                e.pane = h('div', 'fc-pane');
                e.head = h('div', 'fc-head');
                e.src = h('select', 'fc-src');
                e.src.title = 'Show the remote device or a folder on this computer';
                e.drives = h('select', 'fc-drives');
                e.drives.title = 'Drives and folders';
                e.up = h('button', 'fc-btn', '&#x2191;'); e.up.title = 'Parent folder (Backspace)';
                e.rootBtn = h('button', 'fc-btn', '\\'); e.rootBtn.title = 'Top level: drives on the device, your folders on this computer';
                e.refresh = h('button', 'fc-btn', '&#x21bb;'); e.refresh.title = 'Refresh (Ctrl+R)';
                e.fav = h('button', 'fc-btn fc-fav', '&#x2606;');
                e.head.append(e.src, e.drives, e.up, e.rootBtn, e.refresh, e.fav);
                e.path = h('input', 'fc-path'); e.path.type = 'text'; e.path.spellcheck = false; e.path.title = 'Type a path and press Enter';
                e.scroll = h('div', 'fc-scroll'); e.scroll.tabIndex = 0;
                e.table = h('table', 'fc-table');
                e.table.innerHTML = '<colgroup><col><col class=fc-c-size><col class=fc-c-type><col class=fc-c-date></colgroup><thead><tr><th data-k=name>Name</th><th data-k=size class=fc-r>Size</th><th data-k=type>Type</th><th data-k=date>Modified</th></tr></thead><tbody></tbody>';
                e.tbody = e.table.tBodies[0];
                e.empty = h('div', 'fc-empty');
                e.scroll.append(e.table, e.empty);
                e.status = h('div', 'fc-status');
                e.pane.append(e.head, e.path, e.scroll, e.status);
                if (i == 0) { panesEl.append(e.pane, h('div', 'fc-split')); } else { panesEl.append(e.pane); }
                wirePane(p);
            }
            root.append(panesEl);
            obj.keysEl = h('div', 'fc-keys');
            root.append(obj.keysEl);
            obj.jobEl = h('div', 'fc-job');
            obj.jobEl.style.display = 'none';
            root.append(obj.jobEl);
            wireSplitter(panesEl);
            renderButtons();
        }

        function srcValue(p) { return (p.type == 'server') ? { mine: 'myfiles', shared: 'shared', server: 'server' }[paneScope(p)] : p.type; }

        function renderSrc(p) {
            var e = p.el, name = host.nodeName() || 'Remote device';
            e.src.innerHTML = '<option value=home>Home</option><option value=remote>' + esc(name) + '</option>' + '<option value=local>This computer' + (localSupported ? '' : ' (not available)') + '</option>' +
                ((serverAvailable() || (p.type == 'server')) ? '<option value=myfiles>My Files</option>' : '') +
                ((scopeRootKey('shared') != null) ? '<option value=shared>' + esc((serverItems([], 'shared') || [{ name: 'Shared Files' }])[0].name) + '</option>' : '') +
                ((serverAvailable() || (p.type == 'server')) ? '<option value=server>Server files</option>' : '');
            e.src.value = srcValue(p);
        }

        function renderDrives(p) {
            var e = p.el, x = '<option value=":go" hidden>Go to...</option>', sel = ':go';
            function group(label, list) { if (list.length > 0) { x += '<optgroup label="' + esc(label) + '">' + list.join('') + '</optgroup>'; } }
            function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; }
            e.drives.style.display = (p.type == 'home') ? 'none' : '';
            if (p.type == 'home') { e.drives.innerHTML = ''; return; }
            if (p.type == 'remote') {
                var w = host.isWindows();
                if (cfg.drives !== false) {
                    x += opt(':root', w ? 'Computer' : '/');
                    if (w) { (remoteDrives || []).forEach(function (d) { x += opt('d:' + d.name, d.name + ' ' + fileType(d)); }); }
                }
                p.locs = deviceLocations();
                var own = [], shared = [];
                p.locs.forEach(function (l, i) {
                    if (l.segs == null) { own.push('<option value=":na" disabled title="' + esc(l.path) + '">' + esc(l.name + ' (not on this device now)') + '</option>'); }
                    else { (l.own ? own : shared).push('<option value="loc:' + i + '" title="' + esc(l.path) + '">' + esc(l.name) + '</option>'); }
                });
                group('This device', own);
                group('Locations' + ((remoteEnv && remoteEnv.user) ? ' (' + remoteEnv.user + ')' : ''), shared);
                var favs = [];
                favRemote.forEach(function (f, i) { if ((f.w == w) && (expandVars(f.path) != null)) { favs.push(opt('fav:' + i, '\u2605 ' + f.path)); } });
                group('Favorites', favs);
                x += opt(':favs', 'Edit favorites...');
                if (canEditDevice()) { x += opt(':dev', 'Edit locations for this device...'); }
                if (p.segs.length == 0) { sel = ':root'; }
                else if (w && (p.segs.length == 1)) { sel = 'd:' + p.segs[0]; }
                else { p.locs.forEach(function (l, i) { if (l.segs && (rPath(l.segs).toLowerCase() == rPath(p.segs).toLowerCase())) { sel = 'loc:' + i; } }); }
            } else if (p.type == 'server') {
                if (singleRoot(p)) { var ownKey = scopeRootKey(paneScope(p)); x += opt(':root', ownKey ? sDisplay([ownKey]).replace(/\\$/, '') : 'My Files'); if (p.ssegs.length <= 1) { sel = ':root'; } }
                else {
                    x += opt(':root', 'Server files');
                    (serverItems([], 'server') || []).forEach(function (r) { x += opt('sr:' + r.key, r.name + (r.ro ? ' (read only)' : '')); });
                    if (p.ssegs.length == 0) { sel = ':root'; } else if (p.ssegs.length == 1) { sel = 'sr:' + p.ssegs[0]; }
                }
            } else {
                x += opt(':root', 'This computer');
                group('Favorites', favLocal.map(function (hd, i) { return opt('f:' + i, '\u2605 ' + hd.name); }));
                group('Recent', recentLocal.map(function (hd, i) { return opt('r:' + i, hd.name); }));
                x += opt(':pick', 'Browse for a folder...');
                if (p.stack.length == 0) { sel = ':root'; }
            }
            e.drives.innerHTML = x;
            e.drives.value = sel;
            if (e.drives.selectedIndex < 0) { e.drives.value = ':go'; }
        }

        function renderPath(p) { p.el.path.value = paneLabel(p); }

        function rowHtml(p, row, i) {
            var cls = 'fc-row';
            if (p.marked[row.name] && !row.up) { cls += ' fc-marked'; }
            if (i == p.cursor) { cls += ' fc-cursor'; }
            if (row.up) { return '<tr class="' + cls + '" data-i=' + i + ' title="Double-click to go up a folder"><td class=fc-name><span class="fc-icon fileIcon2"></span>..</td><td class=fc-r></td><td>Up</td><td></td></tr>'; }
            if ((row.kind == 'source') || (row.kind == 'shortcut')) {
                return '<tr class="' + cls + ' fc-place' + ((row.kind == 'source') ? ' fc-home-src' : ' fc-home-link') + '" data-i=' + i + ' title="Double-click to open"><td class=fc-name><span class="fc-icon fileIcon' + row.icon + '"></span>' + esc(row.name) + '</td><td class=fc-r></td><td title="' + esc(row.desc) + '">' + esc(row.desc) + '</td><td></td></tr>';
            }
            if ((row.kind == 'place') || (row.kind == 'browse') || (row.kind == 'dlplace')) {
                var t = (row.kind == 'browse') ? 'Pick a folder on this computer' : ((row.kind == 'dlplace') ? 'Device files copied here are saved by the browser to your Downloads folder' : 'Double-click to open');
                return '<tr class="' + cls + ' fc-place" data-i=' + i + ' title="' + esc(t) + '"><td class=fc-name><span class="fc-icon fileIcon' + ((row.kind == 'place') ? 2 : 1) + '"></span>' + (row.fav ? '&#x2605; ' : '') + esc(row.name) + '</td><td class=fc-r></td><td>' + esc(fileType(row)) + '</td><td></td></tr>';
            }
            var icon = (row.kind == 'drive') ? ((row.dt == 'REMOVABLE') ? 5 : ((row.dt == 'CDROM') ? 6 : 1)) : ((row.kind == 'dir') ? 2 : 3);
            var size = (row.kind == 'file') ? sizeStr(row.size) : ((row.kind == 'drive') && row.size ? (sizeStr(row.free) + ' free') : '');
            var date = (row.date != null) ? esc(host.formatDate(new Date(row.date))) : '';
            return '<tr class="' + cls + '" data-i=' + i + ' draggable=true><td class=fc-name title="' + esc(row.name) + '"><span class="fc-icon fileIcon' + icon + '"></span>' + esc(row.name) + '</td><td class=fc-r>' + esc(size) + '</td><td>' + esc(fileType(row)) + '</td><td>' + date + '</td></tr>';
        }

        function renderRows(p) {
            var x = [];
            for (var i = 0; i < p.rows.length; i++) { x.push(rowHtml(p, p.rows[i], i)); }
            p.el.tbody.innerHTML = x.join('');
            var ths = p.el.table.tHead.rows[0].cells;
            for (var j = 0; j < ths.length; j++) {
                var k = ths[j].getAttribute('data-k');
                ths[j].classList.toggle('fc-sorted', k == p.sortKey);
                ths[j].setAttribute('data-dir', (k == p.sortKey) ? (p.sortDir > 0 ? 'asc' : 'desc') : '');
            }
            renderStatus(p);
            if (p.idx == activeIdx) { renderButtons(); }
        }

        // Update selection and cursor without rebuilding the rows, so double clicks land on the same element
        function renderMarks(p) {
            var trs = p.el.tbody.rows;
            for (var i = 0; i < trs.length; i++) {
                var row = p.rows[i];
                trs[i].classList.toggle('fc-marked', !!(row && !row.up && p.marked[row.name]));
                trs[i].classList.toggle('fc-cursor', i == p.cursor);
            }
            renderStatus(p);
            if (p.idx == activeIdx) { renderButtons(); }
        }

        function renderPane(p) {
            renderSrc(p);
            renderDrives(p);
            renderPath(p);
            var e = p.el, msg = '', hint = '';
            if (p.message) { msg = esc(p.message); }
            else if ((p.type == 'local') && !localSupported) { msg = localUnsupportedReason() + ' You can still drag files from your desktop onto the device pane to upload them.'; }
            else if (localRoot(p)) {
                hint = '<b>Browsers cannot list drives.</b> Use "Browse for a folder..." and the folder is kept here. Chrome blocks drive roots such as C:\\, your user folder and Downloads itself, so pick a folder inside them (for example Downloads\\Mesh). ' +
                    'To save device files to Downloads, copy or drag them onto "Downloads (save with the browser)". Use the &#x2606; button to add favorites.';
            }
            e.empty.innerHTML = msg || hint;
            e.empty.style.display = (msg || hint) ? '' : 'none';
            e.empty.classList.toggle('fc-hint', !!hint);
            e.table.style.display = msg ? 'none' : '';
            e.path.disabled = localRoot(p) || (p.type == 'home');
            updateFavButton(p);
            renderRows(p);
            fit();
        }

        function renderStatus(p) {
            var dirs = 0, filesCount = 0, bytes = 0, sel = 0, selBytes = 0;
            p.items.forEach(function (x) {
                if (x.kind == 'file') { filesCount++; bytes += x.size || 0; } else { dirs++; }
                if (p.marked[x.name]) { sel++; if (x.kind == 'file') { selBytes += x.size || 0; } }
            });
            var s = '';
            if (p.type == 'home') { s = 'Double-click to open, or use Backspace or .. from any of them to come back here'; }
            else if (p.loading) { s = 'Loading...'; }
            else if (localRoot(p)) { s = 'This computer \u2014 double-click a folder to open it'; }
            else if (p.items.length > 0) {
                s = dirs + ' folder' + (dirs == 1 ? '' : 's') + ', ' + filesCount + ' file' + (filesCount == 1 ? '' : 's') + ' (' + sizeStr(bytes) + ')';
                if (sel > 0) { s = sel + ' selected (' + sizeStr(selBytes) + ') of ' + s; }
                if ((p.type == 'remote') && host.isWindows() && (p.segs.length > 0) && remoteDrives) {
                    var d = remoteDrives.filter(function (x) { return x.name == p.segs[0]; })[0];
                    if (d && d.size) { s += ' — ' + sizeStr(d.free) + ' free of ' + sizeStr(d.size); }
                }
            }
            if ((p.type == 'server') && (p.ssegs.length > 0) && serverReadOnly(p.ssegs)) { s += ' \u2014 read only'; }
            if (p.flash) { s = p.flash + (s ? ' — ' + s : ''); }
            p.el.status.textContent = s;
            p.el.status.classList.toggle('fc-error', !!p.flash && !p.flashInfo);
        }

        function flash(p, msg, info) {
            p.flash = msg;
            p.flashInfo = !!info;
            renderStatus(p);
            clearTimeout(p.flashTimer);
            p.flashTimer = setTimeout(function () { p.flash = null; renderStatus(p); }, 6000);
        }

        function scrollToCursor(p) {
            var tr = p.el.tbody.rows[p.cursor];
            if (tr == null) return;
            var sc = p.el.scroll, head = p.el.table.tHead.offsetHeight;
            if (tr.offsetTop - head < sc.scrollTop) { sc.scrollTop = tr.offsetTop - head; }
            else if (tr.offsetTop + tr.offsetHeight > sc.scrollTop + sc.clientHeight) { sc.scrollTop = tr.offsetTop + tr.offsetHeight - sc.clientHeight; }
        }

        var keyDefs = [
            { k: 'F2', t: 'Rename', f: function () { renameCmd(); }, en: function (p) { var s = selectedRows(p); return (s.length == 1) && isEntry(s[0]) && canWrite(p); } },
            { k: 'F3', t: 'Download', f: function () { downloadToBrowser(activePane()); }, en: function (p) { return ((p.type == 'remote') || (p.type == 'server')) && selectedRows(p).some(function (x) { return x.kind == 'file'; }); } },
            { k: 'F4', t: 'Edit', f: function () { editCmd(); }, en: function (p) { var s = selectedRows(p); return (s.length == 1) && (s[0].kind == 'file'); } },
            { k: 'F5', t: 'Copy', f: function () { copyCmd(false); }, en: function (p) { return canTransfer(p); } },
            { k: 'F6', t: 'Move', f: function () { copyCmd(true); }, en: function (p) { return canTransfer(p) && canRemoveFrom(p); } },
            { k: 'F7', t: 'New Folder', f: function () { mkdirCmd(); }, en: function (p) { return canWrite(p); } },
            { k: 'F8', t: 'Delete', f: function () { deleteCmd(); }, en: function (p) { return canWrite(p) && selectedRows(p).some(isEntry); } },
            { k: 'S-F4', t: 'New File', f: function () { mkfileCmd(); }, en: function (p) { return canWrite(p); } },
            { k: '', t: 'Upload', f: function () { uploadPickCmd(); }, en: function (p) { return ((p.type == 'remote') || (p.type == 'server')) && canWrite(p); } },
            { k: '', t: 'Zip', f: function () { zipCmd(); }, en: function (p) { return (p.type == 'remote') && !host.isSftp() && canWrite(p) && selectedRows(p).length > 0; } },
            { k: '', t: 'Unzip', f: function () { unzipCmd(); }, en: function (p) { var s = selectedRows(p); return (p.type == 'remote') && !host.isSftp() && (s.length == 1) && /\.zip$/i.test(s[0].name); } },
            { k: 'C-R', t: 'Refresh', f: function () { refreshAll(); }, en: function () { return true; } }
        ];

        function canWrite(p) {
            if (p.type == 'home') return false;
            if (p.type == 'local') return (p.stack.length > 0);
            if (p.type == 'server') return serverAvailable() && !serverReadOnly(p.ssegs); // Not the top of Server files, nor a shared folder that is read only
            return connected() && (!host.isWindows() || (p.segs.length > 0)); // The Windows root only lists drives
        }
        // A move removes the source, which a read only server folder does not allow
        function canRemoveFrom(p) { return (p.type != 'server') || !serverReadOnly(p.ssegs); }

        function canTransfer(p) {
            var o = other(p), rows = selectedRows(p).filter(isEntry);
            if (rows.length == 0) return false;
            if (localRoot(o)) return ((p.type == 'remote') || (p.type == 'server')) && rows.some(function (r) { return r.kind == 'file'; }); // Saved as browser downloads
            if (!canWrite(o)) return false;
            if ((p.type == 'remote') && (o.type == 'remote') && host.isSftp()) return false;
            return true;
        }

        function renderButtons() {
            if (!obj.keysEl || panes.length < 2) return;
            var p = activePane(), x = '';
            keyDefs.forEach(function (d, i) {
                var label = d.t;
                if ((d.t == 'Copy') || (d.t == 'Move')) { label += ' ' + ((p.idx == 0) ? '→' : '←'); }
                x += '<button class=fc-key data-i=' + i + (d.en(p) ? '' : ' disabled') + '>' + (d.k ? '<b>' + esc(d.k.replace('S-', 'Shift+').replace('C-', 'Ctrl+')) + '</b> ' : '') + esc(label) + '</button>';
            });
            obj.keysEl.innerHTML = x;
        }

        //
        // Events
        //

        function rowIndex(ev) { var tr = ev.target.closest('tr.fc-row'); return tr ? parseInt(tr.getAttribute('data-i')) : -1; }

        function wirePane(p) {
            var e = p.el;
            e.pane.addEventListener('mousedown', function () { if (activeIdx != p.idx) { setActive(p.idx); } });
            e.src.onchange = function () { setPaneType(p, e.src.value); };
            e.drives.onchange = function () {
                var v = e.drives.value, n = parseInt(v.split(':')[1]);
                if (p.type == 'server') {
                    if (v == ':root') { goRoot(p); }
                    else if (v.indexOf('sr:') == 0) { loadServer(p, [v.substring(3)]); }
                } else if (p.type == 'remote') {
                    if (v == ':root') { loadRemote(p, []); }
                    else if (v == ':favs') { editFavorites(p); }
                    else if (v == ':dev') { editDeviceLocations(p); }
                    else if (v.indexOf('d:') == 0) { loadRemote(p, [v.substring(2)]); }
                    else if ((v.indexOf('fav:') == 0) && favRemote[n]) { gotoPath(p, favRemote[n].path); }
                    else if ((v.indexOf('loc:') == 0) && p.locs && p.locs[n] && p.locs[n].segs) { loadRemote(p, p.locs[n].segs.slice()); }
                } else {
                    if (v == ':root') { loadLocal(p, []); }
                    else if (v == ':pick') { chooseLocalFolder(p); }
                    else if (v.indexOf('f:') == 0) { chooseLocalFolder(p, favLocal[n]); }
                    else if (v.indexOf('r:') == 0) { chooseLocalFolder(p, recentLocal[n]); }
                }
                renderDrives(p);
                e.scroll.focus();
            };
            e.fav.onclick = function () { toggleFavorite(p, null); };
            e.up.onclick = function () { goUp(p); };
            e.rootBtn.onclick = function () { goRoot(p); };
            e.refresh.onclick = function () { refresh(p); };
            e.path.onkeydown = function (ev) {
                if (ev.key == 'Enter') { ev.preventDefault(); gotoPath(p, e.path.value); e.scroll.focus(); }
                else if (ev.key == 'Escape') { renderPath(p); e.scroll.focus(); }
                ev.stopPropagation();
            };
            e.table.tHead.onclick = function (ev) {
                var th = ev.target.closest('th'); if (!th) return;
                var k = th.getAttribute('data-k');
                if (p.sortKey == k) { p.sortDir = -p.sortDir; } else { p.sortKey = k; p.sortDir = 1; }
                var name = (p.rows[p.cursor] || {}).name;
                sortItems(p);
                p.cursor = Math.max(0, p.rows.findIndex(function (r) { return r.name == name; }));
                renderRows(p);
                saveState();
            };
            e.tbody.addEventListener('mousedown', function (ev) {
                var i = rowIndex(ev); if (i < 0) return;
                setActive(p.idx);
                if (ev.button == 2) { if (!p.rows[i].up && !p.marked[p.rows[i].name]) { p.marked = {}; p.marked[p.rows[i].name] = 1; } p.cursor = i; renderMarks(p); return; }
                if (ev.shiftKey) { setCursor(p, i, true); }
                else if (ev.ctrlKey || ev.metaKey) { toggleMark(p, i); p.anchor = i; p.cursor = i; renderMarks(p); }
                else if (!p.marked[(p.rows[i] || {}).name]) { p.marked = {}; toggleMark(p, i); setCursor(p, i); }
                else { p.cursor = i; p.anchor = i; renderMarks(p); }
            });
            e.tbody.addEventListener('click', function (ev) {
                // A plain click on a row that was already part of a multi selection narrows the selection to it
                var i = rowIndex(ev); if ((i < 0) || ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
                if (p.marked[(p.rows[i] || {}).name] && Object.keys(p.marked).length > 1 && !p.dragged) { p.marked = {}; toggleMark(p, i); renderMarks(p); }
                p.dragged = false;
            });
            e.tbody.addEventListener('dblclick', function (ev) { var i = rowIndex(ev); if (i >= 0) { openRow(p, p.rows[i]); } });
            e.scroll.addEventListener('contextmenu', function (ev) { ev.preventDefault(); setActive(p.idx); showMenu(p, ev.clientX, ev.clientY); });
            e.scroll.addEventListener('keydown', function (ev) { onKey(p, ev); });
            e.scroll.addEventListener('focus', function () { if (activeIdx != p.idx) { setActive(p.idx); } });

            // Drag rows to the other pane
            e.tbody.addEventListener('dragstart', function (ev) {
                var i = rowIndex(ev); if ((i < 0) || p.rows[i].up) { ev.preventDefault(); return; }
                if (!p.marked[p.rows[i].name]) { p.marked = {}; p.marked[p.rows[i].name] = 1; renderMarks(p); }
                p.dragged = true;
                dragSource = p;
                ev.dataTransfer.effectAllowed = 'copyMove';
                ev.dataTransfer.setData('text/plain', selectedRows(p).map(function (r) { return r.name; }).join('\n'));
            });
            e.tbody.addEventListener('dragend', function () { dragSource = null; });
            function clearDrop() {
                e.pane.classList.remove('fc-drop');
                if (p.dropTr) { p.dropTr.classList.remove('fc-droprow'); p.dropTr = null; }
            }
            // Moves within a pane, copies between panes. Ctrl forces a copy, Shift a move.
            function dropMove(ev) { return ev.ctrlKey ? false : (ev.shiftKey ? true : (dragSource === p)); }
            e.pane.addEventListener('dragover', function (ev) {
                if ((dragSource == null) && !(ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0)) return;
                var t = dropTarget(p, ev);
                if (t == null) { clearDrop(); return; }
                ev.preventDefault(); ev.stopPropagation();
                ev.dataTransfer.dropEffect = (dragSource && dropMove(ev) && !t.toBrowser) ? 'move' : 'copy';
                if (p.dropTr !== t.tr) { clearDrop(); }
                if (t.tr) { t.tr.classList.add('fc-droprow'); p.dropTr = t.tr; } else { e.pane.classList.add('fc-drop'); }
            });
            e.pane.addEventListener('dragleave', function (ev) { if (!e.pane.contains(ev.relatedTarget)) { clearDrop(); } });
            e.pane.addEventListener('drop', function (ev) {
                var t = dropTarget(p, ev);
                clearDrop();
                if (t == null) return;
                ev.preventDefault(); ev.stopPropagation();
                if (dragSource != null) { var src = dragSource, move = dropMove(ev); dragSource = null; setActive(src.idx); transfer(src, selectedRows(src), p, t.row, move); return; }
                dropFromDesktop(p, ev.dataTransfer, t.row);
            });
        }

        // Where a drag over pane p would land: { row, tr } for a folder row, { row: null } for the folder
        // the pane shows, { toBrowser } for browser downloads, or null when it cannot be dropped there.
        function dropTarget(p, ev) {
            var tr = (ev.target && ev.target.closest) ? ev.target.closest('tr.fc-row') : null;
            var row = (tr && p.el.tbody.contains(tr)) ? p.rows[parseInt(tr.getAttribute('data-i'))] : null;
            var fromRemote = (dragSource != null) && ((dragSource.type == 'remote') || (dragSource.type == 'server'));
            if (localRoot(p)) {
                if (!fromRemote) return null;
                return { row: null, tr: (row && (row.kind == 'dlplace')) ? tr : null, toBrowser: true };
            }
            if (row && !row.up && ((row.kind == 'dir') || ((row.kind == 'drive') && ((p.type == 'server') ? !row.ro : connected()))) && !((dragSource === p) && p.marked[row.name])) { return { row: row, tr: tr }; }
            if ((dragSource === p) || !canWrite(p)) return null;
            return { row: null, tr: null };
        }

        function wireSplitter(panesEl) {
            var split = panesEl.querySelector('.fc-split');
            var ratio = storeGet('fcSplit', 0.5);
            function apply() { panes[0].el.pane.style.flexBasis = (ratio * 100) + '%'; panes[1].el.pane.style.flexBasis = ((1 - ratio) * 100) + '%'; }
            apply();
            split.addEventListener('mousedown', function (ev) {
                ev.preventDefault();
                var r = panesEl.getBoundingClientRect();
                function move(e2) { ratio = Math.max(0.15, Math.min(0.85, (e2.clientX - r.left) / r.width)); apply(); }
                function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); storeSet('fcSplit', ratio); }
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
            split.addEventListener('dblclick', function () { ratio = 0.5; apply(); storeSet('fcSplit', ratio); });
        }

        function onKey(p, ev) {
            if (modalEl) return;
            var page = Math.max(1, Math.floor(p.el.scroll.clientHeight / 22) - 1), handled = true, k = ev.key;
            if (k == 'ArrowDown') { setCursor(p, p.cursor + 1, ev.shiftKey); }
            else if (k == 'ArrowUp') { setCursor(p, p.cursor - 1, ev.shiftKey); }
            else if (k == 'PageDown') { setCursor(p, p.cursor + page, ev.shiftKey); }
            else if (k == 'PageUp') { setCursor(p, p.cursor - page, ev.shiftKey); }
            else if (k == 'Home') { setCursor(p, 0, ev.shiftKey); }
            else if (k == 'End') { setCursor(p, p.rows.length - 1, ev.shiftKey); }
            else if (k == 'Enter') { openRow(p, p.rows[p.cursor]); }
            else if (k == 'Backspace') { goUp(p); }
            else if (k == 'Tab') { setActive(1 - p.idx); panes[activeIdx].el.scroll.focus(); }
            else if (((k == ' ') && !typing(p)) || (k == 'Insert')) { toggleMark(p, p.cursor); setCursor(p, p.cursor + 1); }
            else if ((k == 'a' || k == 'A') && (ev.ctrlKey || ev.metaKey)) { p.marked = {}; p.rows.forEach(function (r) { if (!r.up) { p.marked[r.name] = 1; } }); renderMarks(p); }
            else if ((k == 'r' || k == 'R') && (ev.ctrlKey || ev.metaKey)) { refresh(p); }
            else if ((k == 'Escape') && job) { cancelJob(job); }
            else if (k == 'Escape') { p.marked = {}; renderMarks(p); }
            else if (k == 'F2') { renameCmd(); }
            else if (k == 'F3') { downloadToBrowser(p); }
            else if ((k == 'F4') && ev.shiftKey) { mkfileCmd(); }
            else if (k == 'F4') { editCmd(); }
            else if (k == 'F5') { copyCmd(false); }
            else if (k == 'F6') { copyCmd(true); }
            else if (k == 'F7') { mkdirCmd(); }
            else if ((k == 'F8') || (k == 'Delete')) { deleteCmd(); }
            else if ((k.length == 1) && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { typeAhead(p, k); }
            else { handled = false; }
            if (handled) { ev.preventDefault(); ev.stopPropagation(); }
        }

        // Typing jumps to names: a letter goes to the next name starting with it (pressing it again cycles),
        // letters typed quickly go to the first name starting with all of them.
        function typing(p) { return (p.typeBuf != '') && (p.typeBuf != null) && ((Date.now() - p.typeTime) < 1000); }
        function typeAhead(p, ch) {
            var buf = (typing(p) ? p.typeBuf : '') + ch.toLowerCase();
            p.typeBuf = buf; p.typeTime = Date.now();
            var cycle = buf.split('').every(function (c) { return c == buf[0]; }), prefix = cycle ? buf[0] : buf, n = p.rows.length;
            var start = cycle ? (p.cursor + 1) : p.cursor;
            for (var i = 0; i < n; i++) {
                var j = (start + i) % n, r = p.rows[j];
                if (!r.up && (r.name.toLowerCase().indexOf(prefix) == 0)) { setCursor(p, j); return; }
            }
        }

        //
        // Context menu and dialogs
        //

        function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

        async function showMenu(p, x, y) {
            closeMenu();
            var items = [];
            var row = p.rows[p.cursor], sel = selectedRows(p);
            if (row && (row.up || row.kind != 'file')) { items.push(['Open', function () { openRow(p, row); }]); }
            var folder = (sel.length == 1) && (p.type != 'server') && ((sel[0].kind == 'dir') || (sel[0].kind == 'place')) ? sel[0] : null;
            if (folder) {
                var isFav = (p.type == 'remote') ? (remoteFavIndex(p.segs.concat([folder.name])) >= 0) : ((await localFavIndex(folder.handle)) >= 0);
                items.push([isFav ? 'Remove from favorites' : 'Add to favorites', function () { toggleFavorite(p, folder); }]);
            }
            if (sel.some(function (r) { return r.kind == 'place'; })) { items.push(['Remove from this list', function () { removePlaces(p, sel); }]); }
            keyDefs.forEach(function (d) { if ((d.t != 'Refresh') && d.en(p)) { items.push([d.t + (((d.t == 'Copy') || (d.t == 'Move')) ? (p.idx == 0 ? ' →' : ' ←') : ''), d.f]); } });
            if ((p.type == 'remote') && !host.isSftp() && (sel.length == 1) && host.openOnDevice) {
                items.push(['Open on device desktop', async function () {
                    if ((await modal('Open', 'Open <b>' + esc(sel[0].name) + '</b> on the desktop of the remote device?', [['Open', true, true], ['Cancel', false]])) !== true) return;
                    var path = rPathNoSlash(p.segs.concat([sel[0].name]));
                    host.openOnDevice(host.isWindows() ? path.replace(/\//g, '\\') : path, sel[0].kind != 'file');
                }]);
            }
            if (sel.some(isEntry)) { items.push(['Copy path', function () { copyPaths(p, sel.filter(isEntry)); }]); }
            items.push(['Select all', function () { p.marked = {}; p.rows.forEach(function (r) { if (!r.up) { p.marked[r.name] = 1; } }); renderMarks(p); }]);
            items.push(['Refresh', function () { refresh(p); }]);
            menuEl = h('div', 'fc-menu');
            items.forEach(function (it) { var b = h('div', 'fc-menu-item'); b.textContent = it[0]; b.onclick = function () { closeMenu(); it[1](); }; menuEl.append(b); });
            root.append(menuEl);
            var r = root.getBoundingClientRect();
            var left = Math.min(x - r.left, r.width - menuEl.offsetWidth - 4), top = Math.min(y - r.top, r.height - menuEl.offsetHeight - 4);
            menuEl.style.left = Math.max(0, left) + 'px';
            menuEl.style.top = Math.max(0, top) + 'px';
        }

        function copyPaths(p, sel) {
            var base = (p.type == 'remote') ? rDisplay(p.segs) : paneLabel(p);
            var sep = ((p.type == 'remote') && !host.isWindows()) ? '/' : '\\';
            if (!base.endsWith(sep)) { base += sep; }
            var text = sel.map(function (r) { return base + r.name; }).join('\r\n');
            try { navigator.clipboard.writeText(text); flash(p, 'Path copied', true); } catch (ex) { }
        }

        // buttons: [[label, value, primary]], body: html. Resolves with the value of the button,
        // or { value, text } when an input is shown.
        function modal(title, body, buttons, input) {
            return new Promise(function (resolve) {
                closeMenu();
                if (modalEl) { modalEl.remove(); }
                modalEl = h('div', 'fc-modal-bg');
                var box = h('div', 'fc-modal');
                box.append(h('div', 'fc-modal-title', esc(title)));
                var content = h('div', 'fc-modal-body', body || '');
                box.append(content);
                var inp = null, extra = null;
                if (input && input.extra) {
                    var lab = h('label', 'fc-extra-label');
                    lab.textContent = input.extra.label || '';
                    extra = h('input', 'fc-input'); extra.type = 'text'; extra.spellcheck = false; extra.value = input.extra.value || '';
                    lab.append(extra);
                    content.append(lab);
                }
                if (input) {
                    inp = h(input.multiline ? 'textarea' : 'input', input.multiline ? 'fc-editor' : 'fc-input');
                    if (!input.multiline) { inp.type = 'text'; }
                    inp.spellcheck = false;
                    inp.value = input.value || '';
                    content.append(inp);
                }
                var bar = h('div', 'fc-modal-buttons');
                function done(v) {
                    if (modalEl == null) return;
                    modalEl.remove(); modalEl = null;
                    var p = activePane(); if (p) { p.el.scroll.focus(); }
                    resolve(inp ? { value: v, text: inp.value, extra: extra ? extra.value : null } : v);
                }
                buttons.forEach(function (b) { var x = h('button', 'fc-btn' + (b[2] ? ' fc-primary' : '')); x.textContent = b[0]; x.onclick = function () { done(b[1]); }; bar.append(x); });
                box.append(bar);
                modalEl.append(box);
                modalEl.addEventListener('keydown', function (ev) {
                    ev.stopPropagation();
                    if (ev.key == 'Escape') { ev.preventDefault(); done(null); }
                    else if ((ev.key == 'Enter') && !(input && input.multiline)) { ev.preventDefault(); var pr = buttons.filter(function (b) { return b[2]; })[0]; done(pr ? pr[1] : null); }
                    else if ((ev.key == 's') && (ev.ctrlKey || ev.metaKey) && input && input.multiline) { ev.preventDefault(); done('save'); }
                });
                root.append(modalEl);
                if (inp) {
                    inp.focus();
                    if (!input.multiline) { var dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, (input.selectStem && dot > 0) ? dot : inp.value.length); }
                } else { var f = bar.querySelector('.fc-primary') || bar.firstChild; if (f) { f.focus(); } }
            });
        }

        function alertBox(title, msg) { return modal(title, esc(msg), [['OK', true, true]]); }

        function validName(n) { return (n != null) && (n.trim() != '') && !/[\\\/:*?"<>|]/.test(n) && (n != '.') && (n != '..'); }

        //
        // Commands
        //

        function busyCheck() {
            if (job || upload || download) { alertBox('File Commander', 'Wait for the current transfer to finish.'); return true; }
            return false;
        }

        async function mkdirCmd() {
            var p = activePane();
            if (!canWrite(p) || busyCheck()) return;
            var r = await modal('New Folder', 'Folder name', [['Create', 'ok', true], ['Cancel', null]], { value: 'New Folder' });
            if ((r.value != 'ok') || !validName(r.text)) { if (r.value == 'ok') { flash(p, 'Invalid name'); } return; }
            try {
                if (p.type == 'remote') { rSend({ action: 'mkdir', reqid: 1, path: joinRemote(p.segs, r.text) }); }
                else if (p.type == 'server') { sOp({ fileop: 'createfolder', path: p.ssegs, newfolder: r.text }); await serverRefreshTree(); }
                else { await p.stack[p.stack.length - 1].getDirectoryHandle(r.text, { create: true }); }
            } catch (ex) { flash(p, ex.message); }
            p.marked = {}; // Select only the new item
            refresh(p, r.text);
        }

        async function mkfileCmd() {
            var p = activePane();
            if (!canWrite(p) || busyCheck()) return;
            var r = await modal('New File', 'File name', [['Create', 'ok', true], ['Cancel', null]], { value: 'New File.txt', selectStem: true });
            if ((r.value != 'ok') || !validName(r.text)) { if (r.value == 'ok') { flash(p, 'Invalid name'); } return; }
            try {
                if (p.type == 'remote') { rSend({ action: 'mkfile', reqid: 1, path: joinRemote(p.segs, r.text) }); }
                else if (p.type == 'server') { await sUpload(p.ssegs, r.text, new Blob([])); await serverRefreshTree(); }
                else { await p.stack[p.stack.length - 1].getFileHandle(r.text, { create: true }); }
            } catch (ex) { flash(p, ex.message); }
            p.marked = {}; // Select only the new item
            refresh(p, r.text);
        }

        async function renameCmd() {
            var p = activePane(), sel = selectedRows(p);
            if ((sel.length != 1) || !isEntry(sel[0]) || !canWrite(p) || busyCheck()) return;
            var item = sel[0];
            var r = await modal('Rename', 'New name for ' + esc(item.name), [['Rename', 'ok', true], ['Cancel', null]], { value: item.name, selectStem: (item.kind == 'file') });
            if ((r.value != 'ok') || (r.text == item.name)) return;
            if (!validName(r.text)) { flash(p, 'Invalid name'); return; }
            try {
                if (p.type == 'remote') { rSend({ action: 'rename', reqid: 1, path: rPath(p.segs), oldname: item.name, newname: r.text }); }
                else if (p.type == 'server') { sOp({ fileop: 'rename', path: p.ssegs, oldname: item.name, newname: r.text }); await serverRefreshTree(); }
                else if (typeof item.handle.move == 'function') { await item.handle.move(r.text); }
                else { throw new Error('This browser cannot rename local files'); }
                p.marked = {};
            } catch (ex) { flash(p, ex.message); }
            refresh(p, r.text);
        }

        async function deleteCmd() {
            var p = activePane();
            if (localRoot(p)) { removePlaces(p, selectedRows(p)); return; }
            var sel = selectedRows(p).filter(isEntry);
            if ((sel.length == 0) || !canWrite(p) || busyCheck()) return;
            var dirs = sel.filter(function (x) { return x.kind == 'dir'; }).length;
            var msg = (sel.length == 1) ? ('Delete <b>' + esc(sel[0].name) + '</b>' + (dirs ? ' and everything in it' : '') + '?') : ('Delete ' + sel.length + ' items' + (dirs ? ', including ' + dirs + ' folder' + (dirs > 1 ? 's' : '') + ' and everything in them' : '') + '?');
            msg += '<div class=fc-where>' + esc(paneLabel(p)) + '</div>';
            if ((await modal('Delete', msg, [['Delete', true, true], ['Cancel', false]])) !== true) return;
            try {
                if (p.type == 'remote') { rSend({ action: 'rm', reqid: 1, path: rPath(p.segs), delfiles: sel.map(function (x) { return x.name; }), rec: true }); }
                else if (p.type == 'server') { sOp({ fileop: 'delete', path: p.ssegs, delfiles: sel.map(function (x) { return x.name; }), rec: true }); await serverRefreshTree(); }
                else { var dir = p.stack[p.stack.length - 1]; for (var i = 0; i < sel.length; i++) { await dir.removeEntry(sel[i].name, { recursive: true }); } }
                p.marked = {};
            } catch (ex) { flash(p, ex.message); }
            refresh(p);
            var o = other(p);
            if ((o.type == p.type) && (paneLabel(o).indexOf(paneLabel(p)) == 0)) { refresh(o); }
        }

        async function zipCmd() {
            var p = activePane(), sel = selectedRows(p);
            if ((p.type != 'remote') || (sel.length == 0) || busyCheck()) return;
            var def = ((sel.length == 1) ? sel[0].name.replace(/\.[^.]*$/, '') : (p.segs[p.segs.length - 1] || 'archive').replace(':', '')) + '.zip';
            var r = await modal('Zip', 'Archive name', [['Zip', 'ok', true], ['Cancel', null]], { value: def, selectStem: true });
            if ((r.value != 'ok') || !validName(r.text)) return;
            var out = r.text.toLowerCase().endsWith('.zip') ? r.text : (r.text + '.zip');
            rSend({ action: 'zip', path: rPathNoSlash(p.segs), files: sel.map(function (x) { return x.name; }), output: out });
        }

        async function unzipCmd() {
            var p = activePane(), sel = selectedRows(p);
            if ((p.type != 'remote') || (sel.length != 1) || busyCheck()) return;
            var sep = host.isWindows() ? '\\' : '/';
            var base = rDisplay(p.segs); if (!base.endsWith(sep)) { base += sep; }
            var r = await modal('Unzip', 'Extract to folder', [['Unzip', 'ok', true], ['Cancel', null]], { value: base + sel[0].name.replace(/\.zip$/i, '') + sep });
            if ((r.value != 'ok') || (r.text.trim() == '')) return;
            rSend({ action: 'unzip', input: base + sel[0].name, dest: r.text });
        }

        function joinRemote(segs, name) { return rPathNoSlash(segs.concat([name])); }

        function downloadToBrowser(p, rows) {
            if (!p || ((p.type != 'remote') && (p.type != 'server'))) return;
            rows = (rows || selectedRows(p)).filter(function (x) { return x.kind == 'file'; });
            if (rows.length == 0) return;
            if (p.type == 'server') { rows.forEach(function (row) { host.downloadFile(sUrl(p.ssegs.concat([row.name])), row.name); }); return; }
            var segs = p.segs.slice(), tunnel = [];
            rows.forEach(function (row) {
                var url = host.downloadUrl ? host.downloadUrl(joinRemote(segs, row.name), row.name) : null;
                if (url) { host.downloadFile(url, row.name); } else { tunnel.push(row); }
            });
            if ((tunnel.length == 0) || busyCheck()) return;
            // No direct link (SFTP or a local device), pull the files through the tunnel
            runJob('Downloading', async function (j) {
                for (var i = 0; i < tunnel.length; i++) {
                    var row = tunnel[i], chunks = [];
                    if (j.canceled) throw cancelError();
                    j.current = row.name; j.curBytes = 0; j.curSize = row.size; renderJob();
                    var sink = { write: function (b) { chunks.push(b); return Promise.resolve(); }, close: function () { return Promise.resolve(); }, abort: function () { chunks = []; } };
                    await rDownload(joinRemote(segs, row.name), row.size, sink, function (got) { j.curBytes = got; renderJob(); });
                    if (typeof saveAs == 'function') { saveAs(new Blob(chunks), row.name); }
                    j.files++; j.bytes += row.size || 0;
                }
            });
        }

        async function uploadPickCmd() {
            var p = activePane();
            if (((p.type != 'remote') && (p.type != 'server')) || !canWrite(p) || busyCheck()) return;
            var inp = document.createElement('input');
            inp.type = 'file'; inp.multiple = true;
            inp.onchange = function () { if (inp.files.length > 0) { startCopy(Array.prototype.map.call(inp.files, fileSource), destInfo(p, null), false, 'Upload', null, p); } };
            inp.click();
        }

        async function editCmd() {
            var p = activePane(), sel = selectedRows(p);
            if ((sel.length != 1) || (sel[0].kind != 'file') || busyCheck()) return;
            var row = sel[0];
            if ((row.size || 0) > maxEditSize) { alertBox('Edit', 'Only files smaller than ' + sizeStr(maxEditSize) + ' can be edited.'); return; }
            var bytes;
            try {
                if (p.type == 'remote') {
                    var sink = memorySink();
                    flash(p, 'Loading ' + row.name + '...', true);
                    await rDownload(joinRemote(p.segs, row.name), row.size, sink);
                    bytes = new Uint8Array(await sink.blob().arrayBuffer());
                } else if (p.type == 'server') {
                    bytes = new Uint8Array(await (await sDownload(p.ssegs.concat([row.name]))).arrayBuffer());
                } else {
                    bytes = new Uint8Array(await (await row.handle.getFile()).arrayBuffer());
                }
            } catch (ex) { flash(p, ex.message); return; }
            var text = new TextDecoder('utf-8').decode(bytes);
            var crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/\n/g) || []).length - crlf;
            var readOnly = !canWrite(p); // Shown without Save in a read only server folder
            var r = await modal((readOnly ? 'View - ' : 'Edit - ') + row.name, '<div class=fc-where>' + esc(paneLabel(p)) + (readOnly ? ' (read only)' : '') + '</div>', readOnly ? [['Close', null, true]] : [['Save', 'save', false], ['Close', null]], { multiline: true, value: text });
            if (r.value != 'save') return;
            var out = r.text;
            if (crlf > lf) { out = out.replace(/\r?\n/g, '\r\n'); }
            var blob = new Blob([new TextEncoder().encode(out)]);
            try {
                if (p.type == 'remote') { await rUpload(rPath(p.segs), row.name, blob); }
                else if (p.type == 'server') { await sUpload(p.ssegs, row.name, blob); await serverRefreshTree(); }
                else { var w = await row.handle.createWritable(); await w.write(blob); await w.close(); }
                flash(p, 'Saved ' + row.name, true);
            } catch (ex) { flash(p, 'Save failed: ' + ex.message); }
            refresh(p, row.name);
        }

        //
        // Copy / move engine
        //

        // A source item: { name, kind: 'file'|'dir', size, remote: { segs }, getFile(), children(), remove() }
        function remoteSource(segs, item) {
            return {
                name: item.name, kind: (item.kind == 'file') ? 'file' : 'dir', size: item.size, remote: { segs: segs },
                children: function () {
                    var s = segs.concat([item.name]);
                    return rList(rPath(s)).then(function (dir) { if (dir == null) { throw new Error('Unable to open ' + rDisplay(s)); } return dir.map(function (f) { return remoteSource(s, remoteItem(f)); }); });
                },
                remove: function () { rSend({ action: 'rm', reqid: 1, path: rPath(segs), delfiles: [item.name], rec: true }); return Promise.resolve(); }
            };
        }

        function serverSource(segs, item) {
            var path = segs.concat([sKey(item)]);
            return {
                name: item.name, kind: item.kind, size: item.size, server: { segs: segs },
                getFile: function (onProgress) { return sDownload(path, onProgress); },
                children: function () { var it = serverItems(path); if (it == null) { return Promise.reject(new Error('Not found on the server: ' + sDisplay(path))); } return Promise.resolve(it.map(function (x) { return serverSource(path, x); })); },
                remove: function () { sOp({ fileop: 'delete', path: segs, delfiles: [sKey(item)], rec: true }); return Promise.resolve(); }
            };
        }

        function handleSource(handle, parent, size) {
            return {
                name: handle.name, kind: (handle.kind == 'directory') ? 'dir' : 'file', size: size,
                getFile: function () { return handle.getFile(); },
                children: async function () { var r = []; for await (var c of handle.values()) { r.push(handleSource(c, handle)); } return r; },
                remove: function () { if (parent == null) { throw new Error('Unable to remove ' + handle.name); } return parent.removeEntry(handle.name, { recursive: true }); }
            };
        }

        function fileSource(file) {
            return { name: file.name, kind: 'file', size: file.size, getFile: function () { return Promise.resolve(file); }, remove: function () { return Promise.resolve(); } };
        }

        function entrySource(entry) {
            if (entry.isFile) { return { name: entry.name, kind: 'file', size: null, getFile: function () { return new Promise(function (res, rej) { entry.file(res, rej); }); }, remove: function () { return Promise.resolve(); } }; }
            return {
                name: entry.name, kind: 'dir',
                children: function () {
                    return new Promise(function (resolve, reject) {
                        var reader = entry.createReader(), all = [];
                        (function next() { reader.readEntries(function (list) { if (list.length == 0) { resolve(all.map(entrySource)); } else { all = all.concat(list); next(); } }, reject); })();
                    });
                },
                remove: function () { return Promise.resolve(); }
            };
        }

        // A destination: { remote: { segs } | local: dirHandle, names(), mkdir(name), writeFile(name, src, onProgress, move) }
        function remoteDest(segs) {
            return {
                remote: { segs: segs }, label: rDisplay(segs),
                names: function () { return rList(rPath(segs)).then(function (dir) { return (dir || []).map(function (f) { return f.n; }); }); },
                mkdir: function (name) { rSend({ action: 'mkdir', reqid: 1, path: joinRemote(segs, name) }); return Promise.resolve(remoteDest(segs.concat([name]))); },
                writeFile: async function (name, src, onProgress, move) {
                    if (src.remote) {
                        rSend({ action: move ? 'move' : 'copy', reqid: 1, scpath: rPath(src.remote.segs), dspath: rPath(segs), names: [name] });
                        return true; // The device copied or moved it on its own
                    }
                    var file = await src.getFile(onProgress); // From the server, the bar shows the download first
                    await rUpload(rPath(segs), name, file, onProgress);
                    return false;
                }
            };
        }

        function localDest(dir) {
            return {
                local: dir, label: dir.name,
                names: async function () { var r = []; for await (var k of dir.keys()) { r.push(k); } return r; },
                mkdir: async function (name) { return localDest(await dir.getDirectoryHandle(name, { create: true })); },
                writeFile: async function (name, src, onProgress) {
                    if (src.remote) {
                        var existed = true;
                        try { await dir.getFileHandle(name); } catch (ex) { existed = false; }
                        var sink = await localSink(dir, name);
                        try { await rDownload(joinRemote(src.remote.segs, name), src.size, sink, onProgress); }
                        catch (ex) { await sink.abort(); if (!existed) { try { await dir.removeEntry(name); } catch (e2) { } } throw ex; } // Don't leave an empty file behind
                        return false;
                    }
                    var file = await src.getFile(onProgress);
                    var fh = await dir.getFileHandle(name, { create: true });
                    var w = await fh.createWritable();
                    try { await w.write(file); await w.close(); } catch (ex) { try { await w.abort(); } catch (e2) { } throw ex; }
                    if (onProgress) { onProgress(file.size, file.size); }
                    return false;
                }
            };
        }

        // A folder of the server files. Folders are created over the web socket and the tree fetched again,
        // so a folder exists before a file is uploaded into it over HTTP.
        function serverDest(segs) {
            return {
                label: 'Server: ' + sDisplay(segs),
                names: function () { return Promise.resolve((serverItems(segs) || []).map(function (x) { return x.name; })); },
                mkdir: async function (name) { sOp({ fileop: 'createfolder', path: segs, newfolder: name }); await serverRefreshTree(); return serverDest(segs.concat([name])); },
                writeFile: async function (name, src, onProgress, move) {
                    if (src.server) { sOp({ fileop: move ? 'move' : 'copy', scpath: src.server.segs, path: segs, names: [name] }); return true; }
                    var blob;
                    if (src.remote) {
                        var chunks = [], sink = { write: function (b) { chunks.push(b); return Promise.resolve(); }, close: function () { return Promise.resolve(); }, abort: function () { chunks = []; } };
                        await rDownload(joinRemote(src.remote.segs, name), src.size, sink, onProgress); // The bar shows the download from the device first
                        blob = new Blob(chunks);
                    } else { blob = await src.getFile(); }
                    await sUpload(segs, name, blob, onProgress);
                    return false;
                }
            };
        }

        // Device files saved through the browser, landing in its Downloads folder
        function browserDest() {
            return {
                label: 'Downloads folder (browser downloads)',
                names: function () { return Promise.resolve([]); },
                mkdir: function () { return Promise.reject(new Error('Folders cannot be saved as browser downloads. Open a folder on this computer instead.')); },
                writeFile: async function (name, src, onProgress) {
                    if (src.server) { host.downloadFile(sUrl(src.server.segs.concat([name])), name); if (onProgress) { onProgress(src.size, src.size); } return false; }
                    if (!src.remote) throw new Error('Only device files can be saved as browser downloads');
                    var path = joinRemote(src.remote.segs, name);
                    var url = host.downloadUrl ? host.downloadUrl(path, name) : null;
                    if (url) { host.downloadFile(url, name); if (onProgress) { onProgress(src.size, src.size); } return false; }
                    var chunks = [];
                    var sink = { write: function (b) { chunks.push(b); return Promise.resolve(); }, close: function () { return Promise.resolve(); }, abort: function () { chunks = []; } };
                    await rDownload(path, src.size, sink, onProgress);
                    if (typeof saveAs == 'function') { saveAs(new Blob(chunks), name); }
                    return false;
                }
            };
        }

        // Destination for pane o, or for the folder row in it: { dest, label, segs | handle | toBrowser }
        function destInfo(o, row) {
            if (o.type == 'remote') {
                var segs = o.segs.concat(row ? [row.name] : []);
                return { dest: remoteDest(segs), label: host.nodeName() + ': ' + rDisplay(segs), segs: segs };
            }
            if (o.type == 'server') {
                var ss = o.ssegs.concat(row ? [sKey(row)] : []);
                return { dest: serverDest(ss), label: 'Server: ' + sDisplay(ss), ssegs: ss };
            }
            if (o.stack.length == 0) { return { dest: browserDest(), label: 'Your Downloads folder (browser downloads)', toBrowser: true }; }
            var hd = row ? row.handle : o.stack[o.stack.length - 1];
            return { dest: localDest(hd), label: 'This computer: ' + paneLabel(o) + (row ? row.name + '\\' : ''), handle: hd };
        }

        function sourcesFor(p, rows) {
            if (p.type == 'remote') { var segs = p.segs.slice(); return rows.map(function (r) { return remoteSource(segs, r); }); }
            if (p.type == 'server') { var ss = p.ssegs.slice(); return rows.map(function (r) { return serverSource(ss, r); }); }
            var parent = p.stack[p.stack.length - 1];
            return rows.map(function (r) { return handleSource(r.handle, parent, r.size); });
        }

        function copyCmd(move) { var p = activePane(); return transfer(p, selectedRows(p), other(p), null, move); }

        // Copy or move rows of pane p into pane o, or into the folder row dstRow of pane o
        async function transfer(p, rows, o, dstRow, move) {
            rows = rows.filter(isEntry);
            if ((rows.length == 0) || busyCheck() || !connected() && ((p.type == 'remote') || (o.type == 'remote'))) return;
            if (move && !canRemoveFrom(p)) { alertBox('Move', 'This folder is read only, its files can be copied but not moved.'); return; }
            var t = destInfo(o, dstRow), verb = move ? 'Move' : 'Copy';
            if (t.toBrowser) {
                if ((p.type != 'remote') && (p.type != 'server')) return;
                var dirs = rows.filter(function (r) { return r.kind == 'dir'; });
                rows = rows.filter(function (r) { return r.kind == 'file'; });
                if (rows.length == 0) { alertBox('Download', 'Folders cannot be saved as browser downloads. Open a folder on this computer, or zip the folder on the device first.'); return; }
                if (dirs.length > 0) { flash(p, dirs.length + ' folder' + (dirs.length > 1 ? 's' : '') + ' skipped'); }
                move = false; verb = 'Download';
            }
            if ((p.type == 'remote') && (o.type == 'remote')) {
                var dst = rPath(t.segs).toLowerCase() + '/';
                if (dst == rPath(p.segs).toLowerCase() + '/') { alertBox(verb, 'The source and destination folders are the same.'); return; }
                for (var i = 0; i < rows.length; i++) {
                    if ((rows[i].kind == 'dir') && (dst.indexOf(rPath(p.segs.concat([rows[i].name])).toLowerCase() + '/') == 0)) { alertBox(verb, 'A folder cannot be copied into itself.'); return; }
                }
            } else if ((p.type == 'server') && (o.type == 'server')) {
                var sdst = sLink(t.ssegs) + '/';
                if (sdst == sLink(p.ssegs) + '/') { alertBox(verb, 'The source and destination folders are the same.'); return; }
                for (var i = 0; i < rows.length; i++) {
                    if ((rows[i].kind == 'dir') && (sdst.indexOf(sLink(p.ssegs.concat([rows[i].name])) + '/') == 0)) { alertBox(verb, 'A folder cannot be copied into itself.'); return; }
                }
            } else if ((p.type == 'local') && (o.type == 'local') && t.handle) {
                var same = false;
                try { same = await p.stack[p.stack.length - 1].isSameEntry(t.handle); } catch (ex) { }
                if (same) { alertBox(verb, 'The source and destination folders are the same.'); return; }
            }
            var what = (rows.length == 1) ? ('<b>' + esc(rows[0].name) + '</b>') : (rows.length + ' items');
            var msg = verb + ' ' + what + ' to<div class=fc-where>' + esc(t.label) + '</div>';
            if ((await modal(verb, msg, [[verb, true, true], ['Cancel', false]])) !== true) return;
            startCopy(sourcesFor(p, rows), t, move, verb, p, o);
        }

        async function dropFromDesktop(p, dt, row) {
            var t = destInfo(p, row);
            if (t.toBrowser || busyCheck()) return;
            var sources = [], items = dt.items ? Array.prototype.slice.call(dt.items) : [];
            var handles = items.filter(function (it) { return it.kind == 'file'; });
            if ((handles.length > 0) && (typeof handles[0].getAsFileSystemHandle == 'function')) {
                var hs = await Promise.all(handles.map(function (it) { return it.getAsFileSystemHandle(); }));
                hs.forEach(function (hd) { if (hd) { sources.push(handleSource(hd, null)); } });
            } else if ((handles.length > 0) && (typeof handles[0].webkitGetAsEntry == 'function')) {
                handles.forEach(function (it) { var en = it.webkitGetAsEntry(); if (en) { sources.push(entrySource(en)); } });
            } else {
                Array.prototype.forEach.call(dt.files || [], function (f) { sources.push(fileSource(f)); });
            }
            if (sources.length == 0) return;
            startCopy(sources, t, false, 'Upload', null, p);
        }

        function startCopy(sources, target, move, verb, srcPane, destPane) {
            var title = { Upload: 'Uploading', Download: 'Downloading', Move: 'Moving' }[verb] || 'Copying';
            runJob(title, async function (j) {
                j.policy = null;
                j.caseless = (destPane.type == 'remote') ? caseless() : (destPane.type != 'server');
                await copyInto(j, sources, target.dest, move);
            }, function () {
                if (!target.toBrowser) { refresh(destPane); }
                if (srcPane && move && (srcPane !== destPane)) { srcPane.marked = {}; refresh(srcPane); }
                if (srcPane === destPane) { srcPane.marked = {}; }
            });
        }

        async function copyInto(j, sources, dest, move) {
            var existing = null;
            async function exists(name) {
                if (existing == null) { try { existing = (await dest.names()).map(function (n) { return j.caseless ? n.toLowerCase() : n; }); } catch (ex) { existing = []; } }
                return existing.indexOf(j.caseless ? name.toLowerCase() : name) >= 0;
            }
            for (var i = 0; i < sources.length; i++) {
                var s = sources[i];
                if (j.canceled) throw cancelError();
                if (s.kind == 'dir') {
                    var errorsBefore = j.errors.length + j.skipped;
                    try {
                        var sub = await dest.mkdir(s.name);
                        await copyInto(j, await s.children(), sub, move);
                        if (move && (j.errors.length + j.skipped == errorsBefore)) { await s.remove(); }
                    } catch (ex) { if (ex.canceled) throw ex; j.errors.push(s.name + ': ' + ex.message); }
                    continue;
                }
                if ((j.policy != 'overwrite') && (await exists(s.name))) {
                    var choice = j.policy;
                    if (choice == null) {
                        choice = await modal('File exists', '<b>' + esc(s.name) + '</b> already exists in<div class=fc-where>' + esc(dest.label) + '</div>', [['Overwrite', 'o1', true], ['Overwrite all', 'overwrite'], ['Skip', 's1'], ['Skip all', 'skip'], ['Cancel', null]]);
                        if (choice == null) { j.canceled = true; throw cancelError(); }
                        if ((choice == 'overwrite') || (choice == 'skip')) { j.policy = choice; }
                    }
                    if ((choice == 'skip') || (choice == 's1')) { j.skipped++; continue; }
                }
                j.current = s.name; j.curBytes = 0; j.curSize = s.size; renderJob();
                try {
                    var moved = await dest.writeFile(s.name, s, function (got, total) { j.curBytes = got; j.curSize = total; renderJob(); }, move);
                    j.files++;
                    j.bytes += (s.size != null) ? s.size : (j.curSize || 0);
                    if (move && !moved) { await s.remove(); }
                } catch (ex) { if (ex.canceled || j.canceled) throw cancelError(); j.errors.push(s.name + ': ' + ex.message); }
            }
        }

        function runJob(title, fn, after) {
            job = { title: title, files: 0, bytes: 0, skipped: 0, errors: [], current: null, curBytes: 0, curSize: 0, canceled: false };
            var j = job;
            renderJob();
            fn(j).then(function () { return null; }, function (ex) { return ex; }).then(function (ex) {
                job = null;
                if (ex && !ex.canceled) { j.errors.push(ex.message); }
                renderJob(j, ex && ex.canceled);
                if (after) { after(); }
                renderButtons();
            });
        }

        function cancelJob(j) {
            if ((j == null) || j.canceled) return;
            j.canceled = true;
            uploadCancel(); downloadCancel(); serverCancel();
            var b = obj.jobEl.querySelector('.fc-cancel');
            if (b) { b.disabled = true; b.textContent = 'Canceling...'; }
        }

        function renderJob(done, canceled) {
            var el = obj.jobEl, j = job || done;
            if (!el) return;
            if (j == null) { el.style.display = 'none'; return; }
            el.style.display = '';
            clearTimeout(obj.jobTimer);
            if (job) {
                // Built once per job and then only updated, so the Cancel button stays clickable while progress changes
                if (el.fcJob !== j) {
                    el.fcJob = j;
                    el.innerHTML = '<div class=fc-job-text></div><progress max=100 value=0></progress><button class="fc-btn fc-cancel" title="Cancel the transfer (Esc)">Cancel</button>';
                    el.querySelector('.fc-cancel').onclick = function () { cancelJob(j); };
                }
                var pct = (j.curSize > 0) ? Math.min(100, Math.floor(j.curBytes * 100 / j.curSize)) : 0;
                el.firstChild.innerHTML = esc(j.title) + ' <b>' + esc(j.current || '') + '</b> ' + (j.curSize > 0 ? pct + '% of ' + sizeStr(j.curSize) : '') + ' &mdash; ' + j.files + ' done' + (j.skipped ? ', ' + j.skipped + ' skipped' : '') + (j.errors.length ? ', ' + j.errors.length + ' failed' : '');
                el.querySelector('progress').value = pct;
            } else {
                el.fcJob = null;
                var s = (canceled ? 'Canceled' : 'Done') + ': ' + j.files + ' file' + (j.files == 1 ? '' : 's') + ' (' + sizeStr(j.bytes) + ')' + (j.skipped ? ', ' + j.skipped + ' skipped' : '') + (j.errors.length ? ', ' + j.errors.length + ' failed' : '');
                el.innerHTML = '<div class=fc-job-text' + (j.errors.length ? ' style=color:var(--fc-err)' : '') + '>' + esc(s) + '</div>' + (j.errors.length ? '<button class="fc-btn fc-details">Details</button>' : '') + '<button class="fc-btn fc-close">Close</button>';
                el.querySelector('.fc-close').onclick = function () { el.style.display = 'none'; };
                var det = el.querySelector('.fc-details');
                if (det) { det.onclick = function () { modal('Errors', '<div class=fc-errlist>' + j.errors.map(esc).join('<br>') + '</div>', [['OK', true, true]]); }; }
                if (j.errors.length == 0) { obj.jobTimer = setTimeout(function () { if (!job) { el.style.display = 'none'; } }, 6000); }
            }
        }

        //
        // Public API
        //

        obj.processData = function (data) {
            if (data == null) return false;
            if (data.action == 'refresh') { if (obj.active) { refreshAll(); } return false; }
            if ((typeof data.reqid == 'string') && (data.reqid.indexOf('fc') == 0)) {
                if ((typeof data.action == 'string') && (data.action.indexOf('upload') == 0)) { uploadMessage(data); return true; }
                var pr = pending[data.reqid];
                if (pr) { delete pending[data.reqid]; clearTimeout(pr.timer); pr.resolve(pr.raw ? data : ((data.dir == null) ? null : data.dir)); }
                return true;
            }
            if ((data.action == 'download') && (typeof data.id == 'string') && (data.id.indexOf('fc') == 0)) { downloadMessage(data); return true; }
            return false;
        };

        obj.processBinary = function (data) { return downloadBlock(data); };

        // The device's own locations changed, from this browser or another
        obj.refreshLocations = function () { renderDrives(panes[0]); renderDrives(panes[1]); refreshHomes(); };

        // The page received a new tree of the server files
        obj.serverFilesChanged = function () {
            var w = serverWaiters;
            serverWaiters = [];
            w.forEach(function (f) { f(); });
            panes.forEach(function (p) { if (p.type == 'server') { loadServer(p, p.ssegs, true); } else if (p.type == 'home') { loadHome(p); } else { renderSrc(p); } }); // My Files and Server files appear once the tree arrives
        };

        obj.processBinaryString = function (str) {
            if ((download == null) || (download.state != 1)) return false;
            var b = new Uint8Array(str.length);
            for (var i = 0; i < str.length; i++) { b[i] = str.charCodeAt(i) & 0xFF; }
            return downloadBlock(b);
        };

        obj.onConnect = function () {
            remoteDrives = null;
            var saved = null;
            storeGet('fcPaths', []).forEach(function (x) { if (x.n == host.nodeId()) { saved = x.p; } });
            remoteEnv = null; envPromise = null; homeExtrasAsked = false;
            panes.forEach(function (p, i) {
                p.needStart = !(saved && Array.isArray(saved[i])); // A device seen before reopens its last folders
                p.segs = p.needStart ? [] : saved[i];
                if (p.type == 'home') { loadHome(p); } // The device may have changed
                if (p.type != 'remote') return;
                p.items = []; p.rows = []; p.marked = {}; p.message = null;
                renderPane(p);
            });
            if (obj.active) { openRemotePanes(); } // Otherwise when the commander is shown
            renderButtons();
        };

        function openRemotePanes() {
            requestEnv().then(function () { renderDrives(panes[0]); renderDrives(panes[1]); });
            panes.forEach(function (p) {
                if ((p.type != 'remote') || (p.items.length > 0)) return;
                if (!p.needStart || (startPath() == null)) { p.needStart = false; loadRemote(p, p.segs); return; }
                p.needStart = false;
                p.loading = true; renderStatus(p);
                requestEnv().then(function () { loadRemote(p, startSegs()); });
            });
            if (host.isWindows() && !panes.some(function (p) { return (p.type == 'remote') && (p.segs.length == 0); })) {
                rList('').then(function (dir) { if (dir) { remoteDrives = dir.map(remoteItem).filter(function (x) { return x.kind == 'drive'; }); renderDrives(panes[0]); renderDrives(panes[1]); } }, function () { });
            }
        }

        obj.onDisconnect = function () {
            for (var k in pending) { clearTimeout(pending[k].timer); pending[k].reject(new Error('Disconnected')); }
            pending = {};
            remoteEnv = null; envPromise = null; homeExtrasAsked = false;
            if (job) { job.canceled = true; }
            uploadCancel(); downloadCancel();
            panes.forEach(function (p) { if (p.type == 'remote') { p.loadSeq++; p.loading = false; p.items = []; p.rows = []; p.marked = {}; p.message = 'Not connected. Use the Connect button above.'; renderPane(p); } });
            closeMenu();
            renderButtons();
        };

        obj.setActive = function (active) {
            obj.active = !!active;
            storeSet('fcActive', obj.active);
            root.style.display = obj.active ? '' : 'none';
            if (host.onActiveChanged) { host.onActiveChanged(obj.active); }
            if (obj.active) {
                fit();
                panes.forEach(function (p) { if ((p.type == 'server') && (p.items.length == 0)) { loadServer(p, p.ssegs); } else { renderPane(p); } });
                if (connected()) { openRemotePanes(); }
                setActive(activeIdx);
                panes[activeIdx].el.scroll.focus();
            }
        };

        obj.toggle = function () { obj.setActive(!obj.active); };
        obj.isBusy = function () { return (job != null) || (upload != null) || (download != null); };

        // Keep the commander filling the space down to the bottom of the window
        // Themes such as Stylish UI clip the page column and pin a footer over the bottom of the window.
        function fit() {
            if (!obj.active || (root.offsetParent == null)) return;
            var rect = root.getBoundingClientRect(), bottom = window.innerHeight;
            for (var e = root.parentElement; e && (e != document.body); e = e.parentElement) {
                if (getComputedStyle(e).overflowY != 'visible') { bottom = Math.min(bottom, e.getBoundingClientRect().bottom); }
            }
            var x = rect.left + (rect.width / 2), y = bottom - 2, cover = document.elementFromPoint(x, y);
            for (var c = cover; c && !root.contains(c) && (c != document.body); c = c.parentElement) {
                var pos = getComputedStyle(c).position;
                if ((pos == 'fixed') || (pos == 'sticky')) { bottom = Math.min(bottom, c.getBoundingClientRect().top); break; }
            }
            root.style.height = Math.max(240, Math.floor(bottom - rect.top) - 4) + 'px';
        }
        obj.fit = fit;

        // Setup
        var types = storeGet('fcTypes3', ['home', 'remote']); // The left pane starts on Home
        var sorts = storeGet('fcSort', null);
        for (var i = 0; i < 2; i++) {
            panes.push(newPane(i));
            panes[i].type = (types[i] == 'home') ? 'home' : (((types[i] == 'local') && localSupported) ? 'local' : (((types[i] == 'server') || (types[i] == 'myfiles') || (types[i] == 'shared')) ? 'server' : 'remote'));
            panes[i].scope = { myfiles: 'mine', shared: 'shared' }[types[i]] || 'server';
            var ss = storeGet('fcServerSegs', []);
            if (Array.isArray(ss[i])) { panes[i].ssegs = ss[i]; }
            if (sorts && sorts[i]) { panes[i].sortKey = sorts[i][0]; panes[i].sortDir = sorts[i][1]; }
        }
        build();
        panes.forEach(function (p) { if (p.type == 'home') { loadHome(p); } else { renderPane(p); } });
        setActive(1);
        root.style.display = 'none';
        window.addEventListener('resize', fit);
        if (typeof ResizeObserver == 'function') { new ResizeObserver(fit).observe(document.body); }
        document.addEventListener('mousedown', function (ev) { if (menuEl && !menuEl.contains(ev.target)) { closeMenu(); } });
        obj.keysEl.addEventListener('click', function (ev) { var b = ev.target.closest('.fc-key'); if (b) { keyDefs[parseInt(b.getAttribute('data-i'))].f(); } });
        if (localSupported) {
            // Reopen the folder each local pane showed last time, when the browser still allows it without asking
            Promise.all([idbGet('recent'), idbGet('favorites'), idbGet('last0'), idbGet('last1')]).then(async function (r) {
                if (Array.isArray(r[0])) { recentLocal = r[0]; }
                if (Array.isArray(r[1])) { favLocal = r[1]; }
                refreshHomes();
                for (var i = 0; i < 2; i++) {
                    var p = panes[i], last = r[2 + i], ok = false;
                    if (p.type != 'local') continue;
                    if (last) { try { ok = (await last.queryPermission({ mode: 'readwrite' })) == 'granted'; } catch (ex) { } }
                    if (p.stack.length == 0) { loadLocal(p, ok ? [last] : []); }
                }
            });
        }
        if (storeGet('fcActive', false)) { setTimeout(function () { obj.setActive(true); }, 0); }
        return obj;
    }

    return { create: create, localSupported: localSupported };
})();
