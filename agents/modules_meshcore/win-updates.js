// Windows Update available updates lister via Windows Update Agent COM API.
// Uses IUpdateSession -> IUpdateSearcher (async) to find updates not yet installed.

var promise = require('promise');

var CLSID_UpdateSession = '{4CB43D7F-7EEE-4906-8698-60DA1C38F2FE}';
// IID observed from QueryInterface wire call for IUpdateSearchCompletedCallback
var IID_IUSCC = '58E0AE88B0D42547A2F1814A67AE964C';
var E_NOINTERFACE = 0x80004002;

var _GM = require('_GenericMarshal');
var OleAut32 = _GM.CreateNativeProxy('OleAut32.dll');
OleAut32.CreateMethod('SysAllocString');
OleAut32.CreateMethod('SysFreeString');

function makeBSTR(str) {
    return OleAut32.SysAllocString(_GM.CreateVariable(str, { wide: true }));
}

var UpdateSessionFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_ClientApplicationID', 'put_ClientApplicationID', 'get_ReadOnly',
    'get_WebProxy', 'put_WebProxy',
    'CreateUpdateSearcher', 'CreateUpdateDownloader', 'CreateUpdateInstaller'
];

var UpdateSearcherFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_CanAutomaticallyUpgradeService', 'put_CanAutomaticallyUpgradeService',
    'get_ClientApplicationID', 'put_ClientApplicationID',
    'get_IncludePotentiallySupersededUpdates', 'put_IncludePotentiallySupersededUpdates',
    'get_ServerSelection', 'put_ServerSelection',
    'BeginSearch', 'EndSearch', 'EscapeString', 'QueryHistory', 'Search',
    'get_Online', 'put_Online', 'GetTotalHistoryCount', 'get_ServiceID', 'put_ServiceID'
];

var SearchResultFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_ResultCode', 'get_RootCategories', 'get_Updates', 'get_Warnings'
];

var UpdateCollectionFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_Item', 'put_Item', 'get__NewEnum', 'get_Count', 'get_ReadOnly',
    'Add', 'Clear', 'Copy', 'Insert', 'RemoveAt'
];

var UpdateFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_Title',                            // 7
    'get_AutoSelectOnWebSites',             // 8
    'get_BundledUpdates',                   // 9
    'get_CanRequireSource',                 // 10
    'get_Categories',                       // 11
    'get_Deadline',                         // 12
    'get_DeltaCompressedContentAvailable',  // 13
    'get_DeltaCompressedContentPreferred',  // 14
    'get_Description',                      // 15
    'get_EulaAccepted',                     // 16
    'get_EulaText',                         // 17
    'get_HandlerID',                        // 18
    'get_Identity',                         // 19
    'get_Image',                            // 20
    'get_InstallationBehavior',             // 21
    'get_IsBeta',                           // 22
    'get_IsDownloaded',                     // 23
    'get_IsHidden',                         // 24
    'put_IsHidden',                         // 25
    'get_IsInstalled',                      // 26
    'get_IsMandatory',                      // 27
    'get_IsUninstallable',                  // 28
    'get_Languages',                        // 29
    'get_LastDeploymentChangeTime',         // 30
    'get_MaxDownloadSize',                  // 31
    'get_MinDownloadSize',                  // 32
    'get_MoreInfoUrls',                     // 33
    'get_MsrcSeverity',                     // 34
    'get_RecommendedCpuSpeed',              // 35
    'get_RecommendedHardDiskSpace',         // 36
    'get_RecommendedMemory',                // 37
    'get_ReleaseNotes',                     // 38
    'get_SecurityBulletinIDs',              // 39
    'get_SupersededUpdateIDs',              // 40
    'get_SupportUrl',                       // 41
    'get_Type',                             // 42
    'get_UninstallationNotes',              // 43
    'get_UninstallationBehavior',           // 44
    'get_UninstallationSteps',              // 45
    'AcceptEula',                           // 46
    'get_KBArticleIDs',                     // 47
    'get_DeploymentAction',                 // 48
    'CopyFromCache',                        // 49
    'get_DownloadPriority',                 // 50
    'get_DownloadContents'                  // 51
];

var UpdateIdentityFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_RevisionNumber', 'get_UpdateID'
];

// IUpdateHistoryEntryCollection
var UpdateHistoryCollectionFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_Item',     // 7
    'get__NewEnum', // 8
    'get_Count'     // 9
];

// IUpdateHistoryEntry
var UpdateHistoryEntryFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_Operation',        // 7
    'get_ResultCode',       // 8
    'get_Date',             // 9
    'get_UpdateIdentity',   // 10
    'get_HResult',          // 11 (extra method between identity and title)
    'get_Title',            // 12
    'get_Description',      // 13
    'get_UnmappedResultCode', // 14
    'get_ClientApplicationID', // 15
    'get_ServerSelection',  // 16
    'get_ServiceID',        // 17
    'get_UninstallationSteps', // 18
    'get_UninstallationNotes', // 19
    'get_SupportUrl'        // 20
];

var active_handlers = {};
var _cx_counter = 30;


function releaseCOM(obj) {
    if (obj && obj.funcs) { try { obj.funcs.Release(obj); } catch (e) {} }
}

function readBSTR(ptr) {
    try { return ptr.Deref().Wide2UTF8; } catch (e) { return ''; }
}

function readVarBool(v) {
    try { return v.toBuffer().readInt16LE() !== 0; } catch (e) { return false; }
}

function readUpdates(searchResultPtr, COM, GM) {
    var result = [];
    var searchResult = searchResultPtr.Deref();
    searchResult.funcs = COM.marshalFunctions(searchResult, SearchResultFunctions);

    var rcV = GM.CreateVariable(4);
    var resultCode = searchResult.funcs.get_ResultCode(searchResult, rcV).Val === 0 ? rcV.toBuffer().readInt32LE() : -1;
    if (resultCode !== 2 && resultCode !== 3) { releaseCOM(searchResult); return []; }

    var updatesPtr = GM.CreatePointer();
    if (searchResult.funcs.get_Updates(searchResult, updatesPtr).Val !== 0) { releaseCOM(searchResult); return []; }

    var updates = updatesPtr.Deref();
    updates.funcs = COM.marshalFunctions(updates, UpdateCollectionFunctions);

    var countV = GM.CreateVariable(4);
    updates.funcs.get_Count(updates, countV);
    var count = countV.toBuffer().readInt32LE();

    for (var i = 0; i < count; i++) {
        var updatePtr = GM.CreatePointer();
        if (updates.funcs.get_Item(updates, i, updatePtr).Val !== 0) continue;

        var update = updatePtr.Deref();
        update.funcs = COM.marshalFunctions(update, UpdateFunctions);

        var entry = {};
        try {
            var titlePtr = GM.CreatePointer();
            entry.title = update.funcs.get_Title(update, titlePtr).Val === 0 ? readBSTR(titlePtr) : '';

            var sevPtr = GM.CreatePointer();
            entry.severity = update.funcs.get_MsrcSeverity(update, sevPtr).Val === 0 ? readBSTR(sevPtr) : '';

            var dlV = GM.CreateVariable(2);
            entry.isDownloaded = update.funcs.get_IsDownloaded(update, dlV).Val === 0 ? readVarBool(dlV) : false;

            var mandV = GM.CreateVariable(2);
            entry.isMandatory = update.funcs.get_IsMandatory(update, mandV).Val === 0 ? readVarBool(mandV) : false;

            var identPtr = GM.CreatePointer();
            entry.updateID = '';
            if (update.funcs.get_Identity(update, identPtr).Val === 0) {
                var identFuncs = COM.marshalFunctions(identPtr.Deref(), UpdateIdentityFunctions);
                var uidPtr = GM.CreatePointer();
                if (identFuncs.get_UpdateID(identPtr.Deref(), uidPtr).Val === 0) { entry.updateID = readBSTR(uidPtr); }
            }

            // KB article IDs extracted from title e.g. "(KB1234567)"
            entry.kbArticleIDs = [];
            var kbMatches = entry.title.match(/KB\d+/gi);
            if (kbMatches) {
                for (var k = 0; k < kbMatches.length; k++) {
                    entry.kbArticleIDs.push(kbMatches[k].toUpperCase());
                }
            }
        } catch (e) {}

        releaseCOM(update);
        result.push(entry);
    }

    releaseCOM(updates);
    releaseCOM(searchResult);
    return result;
}

function makeSearchCallback(GM, COM, p, searcher) {
    var cx = _cx_counter;
    _cx_counter += 4;
    var handler = COM.marshalInterface([
        {
            cx: cx, parms: 3, name: 'QueryInterface', func: function (j, riid, ppv)
            {
                var hex = riid.Deref(0, 16).toBuffer().toString('hex').toUpperCase();
                var ret = GM.CreateVariable(4);
                if (hex === '0000000000000000C000000000000046' || hex === IID_IUSCC) {
                    j.pointerBuffer().copy(ppv.Deref(0, GM.PointerSize).toBuffer());
                    ret.increment(++this.refcount, true);
                } else {
                    ret.increment(E_NOINTERFACE, true);
                }
                return ret;
            }
        },
        { cx: cx+1, parms: 1, name: 'AddRef',   func: function () { return GM.CreateVariable(4).increment(++this.refcount, true); } },
        { cx: cx+2, parms: 1, name: 'Release',  func: function () {
            if (--this.refcount === 0) { cleanup(this); }
            return GM.CreateVariable(4).increment(this.refcount >>> 0, true);
        }},
        {
            cx: cx+3, parms: 3, name: 'Invoke', func: function (j, searchJob, callbackArgs)
            {
                var searchResultPtr = GM.CreatePointer();
                var hr = this.searcher.funcs.EndSearch(this.searcher, searchJob, searchResultPtr).Val;
                if (hr !== 0) {
                    this.p._rej(new Error('EndSearch failed: 0x' + (hr >>> 0).toString(16)));
                } else {
                    try { this.p._res(readUpdates(searchResultPtr, COM, GM)); }
                    catch (e) { this.p._rej(e); }
                }
                var self = this;
                setImmediate(function () { if (--self.refcount === 0) { cleanup(self); } });
                return GM.CreateVariable(4).increment(0, true);
            }
        }
    ]);

    handler.refcount = 1;
    handler.p = p;
    handler.searcher = searcher;
    active_handlers[handler._hashCode()] = handler;
    return handler;
}

function cleanup(h) {
    if (h.cleanup) { h.cleanup(); }
    delete active_handlers[h._hashCode()];
}

function getAvailableUpdates() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });

    try {
        var GM = require('_GenericMarshal');
        var COM = require('win-com');

        var session = COM.createInstance(COM.CLSIDFromString(CLSID_UpdateSession), COM.IID_IUnknown);
        session.funcs = COM.marshalFunctions(session, UpdateSessionFunctions);

        var searcherPtr = GM.CreatePointer();
        var hr = session.funcs.CreateUpdateSearcher(session, searcherPtr).Val;
        if (hr !== 0) { throw new Error('CreateUpdateSearcher failed: 0x' + (hr >>> 0).toString(16)); }

        var searcher = searcherPtr.Deref();
        searcher.funcs = COM.marshalFunctions(searcher, UpdateSearcherFunctions);

        var criteriaBSTR = makeBSTR('IsInstalled=0 and IsHidden=0');
        var searchJobPtr = GM.CreatePointer();
        var stateV = GM.CreateVariable(16); // VT_EMPTY VARIANT
        var callback = makeSearchCallback(GM, COM, ret, searcher);

        hr = searcher.funcs.BeginSearch(searcher, criteriaBSTR, callback, stateV, searchJobPtr).Val;
        OleAut32.SysFreeString(criteriaBSTR);

        if (hr !== 0) {
            cleanup(callback);
            releaseCOM(searcher);
            releaseCOM(session);
            throw new Error('BeginSearch failed: 0x' + (hr >>> 0).toString(16));
        }

    } catch (ex) {
        ret._rej(ex);
    }

    return ret;
}

function getInstalledUpdates() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });

    try {
        var GM = require('_GenericMarshal');
        var COM = require('win-com');

        var session = COM.createInstance(COM.CLSIDFromString(CLSID_UpdateSession), COM.IID_IUnknown);
        session.funcs = COM.marshalFunctions(session, UpdateSessionFunctions);

        var searcherPtr = GM.CreatePointer();
        var hr = session.funcs.CreateUpdateSearcher(session, searcherPtr).Val;
        if (hr !== 0) { throw new Error('CreateUpdateSearcher failed: 0x' + (hr >>> 0).toString(16)); }

        var searcher = searcherPtr.Deref();
        searcher.funcs = COM.marshalFunctions(searcher, UpdateSearcherFunctions);

        var criteriaBSTR = makeBSTR('IsInstalled=1');
        var searchJobPtr = GM.CreatePointer();
        var stateV = GM.CreateVariable(16);
        var callback = makeSearchCallback(GM, COM, ret, searcher);

        hr = searcher.funcs.BeginSearch(searcher, criteriaBSTR, callback, stateV, searchJobPtr).Val;
        OleAut32.SysFreeString(criteriaBSTR);

        if (hr !== 0) {
            cleanup(callback);
            releaseCOM(searcher);
            releaseCOM(session);
            throw new Error('BeginSearch failed: 0x' + (hr >>> 0).toString(16));
        }

    } catch (ex) {
        ret._rej(ex);
    }

    return ret;
}

function getInstalledUpdateHistory() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });

    var GM, COM, session, searcher, history;
    try {
        GM = require('_GenericMarshal');
        COM = require('win-com');

        session = COM.createInstance(COM.CLSIDFromString(CLSID_UpdateSession), COM.IID_IUnknown);
        session.funcs = COM.marshalFunctions(session, UpdateSessionFunctions);

        var searcherPtr = GM.CreatePointer();
        var hr = session.funcs.CreateUpdateSearcher(session, searcherPtr).Val;
        if (hr !== 0) { throw new Error('CreateUpdateSearcher failed: 0x' + (hr >>> 0).toString(16)); }

        searcher = searcherPtr.Deref();
        searcher.funcs = COM.marshalFunctions(searcher, UpdateSearcherFunctions);

        var totalV = GM.CreateVariable(4);
        hr = searcher.funcs.GetTotalHistoryCount(searcher, totalV).Val;
        if (hr !== 0) { throw new Error('GetTotalHistoryCount failed: 0x' + (hr >>> 0).toString(16)); }
        var total = totalV.toBuffer().readInt32LE();

        var historyPtr = GM.CreatePointer();
        hr = searcher.funcs.QueryHistory(searcher, 0, total, historyPtr).Val;
        if (hr !== 0) { throw new Error('QueryHistory failed: 0x' + (hr >>> 0).toString(16)); }

        history = historyPtr.Deref();
        history.funcs = COM.marshalFunctions(history, UpdateHistoryCollectionFunctions);

        var countV = GM.CreateVariable(4);
        history.funcs.get_Count(history, countV);
        var count = countV.toBuffer().readInt32LE();

        var result = [];
        var i = 0;
        var BATCH = 100;

        function processBatch() {
            try {
                var end = Math.min(i + BATCH, count);
                while (i < end) {
                    var entryPtr2 = GM.CreatePointer();
                    if (history.funcs.get_Item(history, i, entryPtr2).Val === 0) {
                        var ec = entryPtr2.Deref();
                        ec.funcs = COM.marshalFunctions(ec, UpdateHistoryEntryFunctions);
                        try {
                            var opV = GM.CreateVariable(4);
                            var op = ec.funcs.get_Operation(ec, opV).Val === 0 ? opV.toBuffer().readInt32LE() : -1;
                            var rcV = GM.CreateVariable(4);
                            var rc = ec.funcs.get_ResultCode(ec, rcV).Val === 0 ? rcV.toBuffer().readInt32LE() : -1;
                            if (op === 1 && rc === 2) {
                                var entry = {};
                                var tPtr = GM.CreatePointer();
                                entry.title = ec.funcs.get_Title(ec, tPtr).Val === 0 ? readBSTR(tPtr) : '';
                                entry.kbArticleIDs = [];
                                var kbM = entry.title.match(/KB\d+/gi);
                                if (kbM) { for (var k = 0; k < kbM.length; k++) { entry.kbArticleIDs.push(kbM[k].toUpperCase()); } }
                                result.push(entry);
                            }
                        } catch (e) { }
                        releaseCOM(ec);
                    }
                    i++;
                }
                if (i < count) {
                    ret._batchTimer = setTimeout(processBatch, 0);
                } else {
                    releaseCOM(history);
                    releaseCOM(searcher);
                    releaseCOM(session);
                    ret._res(result);
                }
            } catch (ex) {
                releaseCOM(history);
                releaseCOM(searcher);
                releaseCOM(session);
                ret._rej(ex);
            }
        }
        processBatch();
    } catch (ex) {
        if (history) { releaseCOM(history); }
        if (searcher) { releaseCOM(searcher); }
        if (session) { releaseCOM(session); }
        ret._rej(ex);
    }
    return ret;
}

function getInstalledUpdatesDeDuplicated() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    getInstalledUpdateHistory().then(function (all) {
        // Deduplicate by KB number, keeping most recent (history is newest-first so first seen wins)
        // For entries with no KB number, deduplicate by full title
        var seen = {};
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var key = all[i].kbArticleIDs.length > 0 ? all[i].kbArticleIDs.join(',') : all[i].title;
            if (!seen[key]) {
                seen[key] = true;
                result.push(all[i]);
            }
        }
        ret._res(result);
    }).catch(function (e) { ret._rej(e); });
    return ret;
}

if (process.platform === 'win32') {
    module.exports = { getAvailableUpdates: getAvailableUpdates, getInstalledUpdates: getInstalledUpdates, getInstalledUpdateHistory: getInstalledUpdateHistory, getInstalledUpdatesDeDuplicated: getInstalledUpdatesDeDuplicated };
} else {
    var _notSupported = function () {
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret._rej(new Error(process.platform + ' not supported'));
        return ret;
    };
    module.exports = {
        getAvailableUpdates: _notSupported,
        getInstalledUpdates: _notSupported,
        getInstalledUpdateHistory: _notSupported,
        getInstalledUpdatesDeDuplicated: _notSupported
    };
}
