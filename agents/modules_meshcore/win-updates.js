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

// -----------------------------------------------------------------------------
// Install selected updates through the Windows Update Agent COM API.
// Everything is done in-process with IUpdateSession / IUpdateDownloader / IUpdateInstaller,
// no external process or script is launched.
// -----------------------------------------------------------------------------

var CLSID_UpdateCollection = '{13639463-00DB-4646-803D-528026140D88}';
var IID_IUpdateCollection = '{07F7438C-7709-4CA5-B518-91279288134E}';

// Callback interface IIDs, little-endian byte order as seen in QueryInterface (same encoding as IID_IUSCC above)
var IID_IDownloadProgressChangedCallback = 'DD1C3F8C73619145AEBDA56A53CA77C1';     // {8C3F1CDD-6173-4591-AEBD-A56A53CA77C1}
var IID_IDownloadCompletedCallback = '664825775B9F8E4CB9E2C77A8530D64B';           // {77254866-9F5B-4C8E-B9E2-C77A8530D64B}
var IID_IInstallationProgressChangedCallback = 'D50214E0DAF8BA43A01238894BD048F1'; // {E01402D5-F8DA-43BA-A012-38894BD048F1}
var IID_IInstallationCompletedCallback = 'F3F6F44502D6984F9A8A3EFA152AD2D3';       // {45F4F6F3-D602-4F98-9A8A-3EFA152AD2D3}
var IID_IUnknown_Hex = '0000000000000000C000000000000046';

var UpdateDownloaderFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_ClientApplicationID', 'put_ClientApplicationID', // 7, 8
    'get_IsForced', 'put_IsForced',                       // 9, 10
    'get_Priority', 'put_Priority',                       // 11, 12
    'get_Updates', 'put_Updates',                         // 13, 14
    'BeginDownload', 'Download', 'EndDownload'            // 15, 16, 17
];

var UpdateInstallerFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_ClientApplicationID', 'put_ClientApplicationID', // 7, 8
    'get_IsForced', 'put_IsForced',                       // 9, 10
    'get_ParentHwnd', 'put_ParentHwnd',                   // 11, 12
    'put_ParentWindow', 'get_ParentWindow',               // 13, 14
    'get_Updates', 'put_Updates',                         // 15, 16
    'BeginInstall', 'BeginUninstall',                     // 17, 18
    'EndInstall', 'EndUninstall',                         // 19, 20
    'Install', 'RunWizard', 'get_IsBusy', 'Uninstall',    // 21, 22, 23, 24
    'get_AllowSourcePrompts', 'put_AllowSourcePrompts',   // 25, 26
    'get_RebootRequiredBeforeInstallation'                // 27
];

// IDownloadJob and IInstallationJob share the same layout
var UpdateJobFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_AsyncState', 'get_IsCompleted', 'get_Updates', 'CleanUp', 'GetProgress', 'RequestAbort'
];

var DownloadResultFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_HResult', 'get_ResultCode', 'GetUpdateResult'
];

var InstallationResultFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_HResult', 'get_RebootRequired', 'get_ResultCode', 'GetUpdateResult'
];

// IUpdateDownloadResult (get_HResult, get_ResultCode) and IUpdateInstallationResult (get_HResult, get_RebootRequired, get_ResultCode)
var UpdateDownloadResultFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_HResult', 'get_ResultCode'
];
var UpdateInstallationResultFunctions = [
    'QueryInterface', 'AddRef', 'Release',
    'GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke',
    'get_HResult', 'get_RebootRequired', 'get_ResultCode'
];

// OperationResultCode
var ORC_NAMES = ['NotStarted', 'InProgress', 'Succeeded', 'SucceededWithErrors', 'Failed', 'Aborted'];
function orcName(c) { return ((c >= 0) && (c < ORC_NAMES.length)) ? ORC_NAMES[c] : ('Unknown(' + c + ')'); }
function hrHex(hr) { return '0x' + (hr >>> 0).toString(16); }

var installInProgress = null;
var INSTALL_TIMEOUT_MS = 4 * 60 * 60 * 1000; // Give up waiting for WUA after 4 hours

// Generic one-shot COM callback object (ISearchCompletedCallback, IDownloadCompletedCallback, ...).
// All of these have the layout IUnknown + Invoke(this, job, args).
function makeCallback(GM, COM, iidHex, onInvoke) {
    var cx = _cx_counter;
    _cx_counter += 4;
    var handler = COM.marshalInterface([
        {
            cx: cx, parms: 3, name: 'QueryInterface', func: function (j, riid, ppv) {
                var hex = riid.Deref(0, 16).toBuffer().toString('hex').toUpperCase();
                var ret = GM.CreateVariable(4);
                if ((hex === IID_IUnknown_Hex) || (hex === this.iidHex)) {
                    j.pointerBuffer().copy(ppv.Deref(0, GM.PointerSize).toBuffer());
                    ++this.refcount;
                    ret.increment(0, true);
                } else {
                    ret.increment(E_NOINTERFACE, true);
                }
                return ret;
            }
        },
        { cx: cx + 1, parms: 1, name: 'AddRef', func: function () { return GM.CreateVariable(4).increment(++this.refcount, true); } },
        {
            cx: cx + 2, parms: 1, name: 'Release', func: function () {
                if (--this.refcount === 0) { cleanup(this); }
                return GM.CreateVariable(4).increment(this.refcount >>> 0, true);
            }
        },
        {
            cx: cx + 3, parms: 3, name: 'Invoke', func: function (j, job, args) {
                if (this.onInvoke != null) { try { this.onInvoke(job, args); } catch (e) { } }
                return GM.CreateVariable(4).increment(0, true);
            }
        }
    ]);
    handler.refcount = 1;
    handler.iidHex = iidHex;
    handler.onInvoke = onInvoke;
    active_handlers[handler._hashCode()] = handler;
    return handler;
}

// Drop our own reference on a callback object once WUA is done with it.
function releaseCallback(h) {
    if (h == null) return;
    h.onInvoke = null;
    if (--h.refcount <= 0) { cleanup(h); }
}

function readInt32(v) { try { return v.toBuffer().readInt32LE(); } catch (e) { return -1; } }

// installUpdates(updateIds) - updateIds is an array of WUA UpdateID GUID strings, as returned by getAvailableUpdates().
// Resolves with { resultCode, result, rebootRequired, updates: [ { updateID, title, status, hresult, rebootRequired } ] }
function installUpdates(updateIds) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if (installInProgress != null) { ret._rej(new Error('An update installation is already in progress')); return ret; }
    if (!Array.isArray(updateIds) || (updateIds.length == 0)) { ret._rej(new Error('No updates specified')); return ret; }

    var wanted = {};
    for (var i = 0; i < updateIds.length; i++) { if (typeof updateIds[i] == 'string') { wanted[updateIds[i].toLowerCase()] = true; } }

    var GM = require('_GenericMarshal');
    var COM = require('win-com');
    var state = { session: null, searcher: null, coll: null, downloader: null, installer: null, job: null, callbacks: [], entries: [], done: false, timer: null };
    installInProgress = state;

    function releaseJob(abort) {
        if (state.job == null) return;
        if (abort === true) { try { state.job.funcs.RequestAbort(state.job); } catch (e) { } }
        try { state.job.funcs.CleanUp(state.job); } catch (e) { }
        releaseCOM(state.job);
        state.job = null;
    }

    function finish(err, result) {
        if (state.done) return;
        state.done = true;
        if (state.timer != null) { clearTimeout(state.timer); state.timer = null; }
        // Let the current WUA callback return before tearing things down
        setImmediate(function () {
            releaseJob(err != null);
            for (var i = 0; i < state.callbacks.length; i++) { releaseCallback(state.callbacks[i]); }
            state.callbacks = [];
            releaseCOM(state.installer);
            releaseCOM(state.downloader);
            releaseCOM(state.coll);
            releaseCOM(state.searcher);
            releaseCOM(state.session);
            installInProgress = null;
            if (err) { ret._rej(err); } else { ret._res(result); }
        });
    }

    function wrapJob(jobPtr) {
        var job = jobPtr.Deref();
        job.funcs = COM.marshalFunctions(job, UpdateJobFunctions);
        return job;
    }

    // Step 3: install the downloaded updates
    function startInstall() {
        try {
            var installerPtr = GM.CreatePointer();
            var hr = state.session.funcs.CreateUpdateInstaller(state.session, installerPtr).Val;
            if (hr !== 0) { finish(new Error('CreateUpdateInstaller failed: ' + hrHex(hr))); return; }
            state.installer = installerPtr.Deref();
            state.installer.funcs = COM.marshalFunctions(state.installer, UpdateInstallerFunctions);

            hr = state.installer.funcs.put_Updates(state.installer, state.coll).Val;
            if (hr !== 0) { finish(new Error('IUpdateInstaller::put_Updates failed: ' + hrHex(hr))); return; }

            var progress = makeCallback(GM, COM, IID_IInstallationProgressChangedCallback, null);
            var completed = makeCallback(GM, COM, IID_IInstallationCompletedCallback, function (job) {
                var resPtr = GM.CreatePointer();
                var hr2 = state.installer.funcs.EndInstall(state.installer, job, resPtr).Val;
                if (hr2 !== 0) { finish(new Error('EndInstall failed: ' + hrHex(hr2))); return; }
                var r = resPtr.Deref();
                r.funcs = COM.marshalFunctions(r, InstallationResultFunctions);
                var rcV = GM.CreateVariable(4), rbV = GM.CreateVariable(2);
                var rc = (r.funcs.get_ResultCode(r, rcV).Val === 0) ? readInt32(rcV) : -1;
                var reboot = (r.funcs.get_RebootRequired(r, rbV).Val === 0) ? readVarBool(rbV) : false;
                for (var k = 0; k < state.entries.length; k++) {
                    var e = state.entries[k];
                    if (e.index == null) continue;
                    var urPtr = GM.CreatePointer();
                    if (r.funcs.GetUpdateResult(r, e.index, urPtr).Val === 0) {
                        var ur = urPtr.Deref();
                        ur.funcs = COM.marshalFunctions(ur, UpdateInstallationResultFunctions);
                        var urc = GM.CreateVariable(4), uhr = GM.CreateVariable(4), urb = GM.CreateVariable(2);
                        if (ur.funcs.get_ResultCode(ur, urc).Val === 0) { e.status = orcName(readInt32(urc)); }
                        if (ur.funcs.get_HResult(ur, uhr).Val === 0) { e.hresult = hrHex(readInt32(uhr)); }
                        if (ur.funcs.get_RebootRequired(ur, urb).Val === 0) { e.rebootRequired = readVarBool(urb); }
                        releaseCOM(ur);
                    }
                }
                releaseCOM(r);
                finish(null, { resultCode: rc, result: orcName(rc), rebootRequired: reboot, updates: state.entries });
            });
            state.callbacks.push(progress, completed);

            releaseJob();
            var jobPtr = GM.CreatePointer();
            hr = state.installer.funcs.BeginInstall(state.installer, progress, completed, GM.CreateVariable(16), jobPtr).Val;
            if (hr !== 0) { finish(new Error('BeginInstall failed: ' + hrHex(hr))); return; }
            state.job = wrapJob(jobPtr);
        } catch (ex) { finish(ex); }
    }

    // Step 2: download the selected updates
    function startDownload() {
        try {
            var downloaderPtr = GM.CreatePointer();
            var hr = state.session.funcs.CreateUpdateDownloader(state.session, downloaderPtr).Val;
            if (hr !== 0) { finish(new Error('CreateUpdateDownloader failed: ' + hrHex(hr))); return; }
            state.downloader = downloaderPtr.Deref();
            state.downloader.funcs = COM.marshalFunctions(state.downloader, UpdateDownloaderFunctions);

            hr = state.downloader.funcs.put_Updates(state.downloader, state.coll).Val;
            if (hr !== 0) { finish(new Error('IUpdateDownloader::put_Updates failed: ' + hrHex(hr))); return; }

            var progress = makeCallback(GM, COM, IID_IDownloadProgressChangedCallback, null);
            var completed = makeCallback(GM, COM, IID_IDownloadCompletedCallback, function (job) {
                var resPtr = GM.CreatePointer();
                var hr2 = state.downloader.funcs.EndDownload(state.downloader, job, resPtr).Val;
                if (hr2 !== 0) { finish(new Error('EndDownload failed: ' + hrHex(hr2))); return; }
                var r = resPtr.Deref();
                r.funcs = COM.marshalFunctions(r, DownloadResultFunctions);
                var rcV = GM.CreateVariable(4);
                var rc = (r.funcs.get_ResultCode(r, rcV).Val === 0) ? readInt32(rcV) : -1;
                for (var k = 0; k < state.entries.length; k++) {
                    var e = state.entries[k];
                    if (e.index == null) continue;
                    var urPtr = GM.CreatePointer();
                    if (r.funcs.GetUpdateResult(r, e.index, urPtr).Val === 0) {
                        var ur = urPtr.Deref();
                        ur.funcs = COM.marshalFunctions(ur, UpdateDownloadResultFunctions);
                        var urc = GM.CreateVariable(4), uhr = GM.CreateVariable(4);
                        if (ur.funcs.get_ResultCode(ur, urc).Val === 0) { e.status = 'Download' + orcName(readInt32(urc)); }
                        if (ur.funcs.get_HResult(ur, uhr).Val === 0) { e.hresult = hrHex(readInt32(uhr)); }
                        releaseCOM(ur);
                    }
                }
                releaseCOM(r);
                if ((rc !== 2) && (rc !== 3)) { finish(null, { resultCode: rc, result: 'Download' + orcName(rc), rebootRequired: false, updates: state.entries }); return; }
                setImmediate(startInstall);
            });
            state.callbacks.push(progress, completed);

            releaseJob();
            var jobPtr = GM.CreatePointer();
            hr = state.downloader.funcs.BeginDownload(state.downloader, progress, completed, GM.CreateVariable(16), jobPtr).Val;
            if (hr !== 0) { finish(new Error('BeginDownload failed: ' + hrHex(hr))); return; }
            state.job = wrapJob(jobPtr);
        } catch (ex) { finish(ex); }
    }

    // Step 1: search for the requested updates and put them in a new IUpdateCollection
    try {
        state.timer = setTimeout(function () { finish(new Error('Timed out waiting for Windows Update')); }, INSTALL_TIMEOUT_MS);

        state.session = COM.createInstance(COM.CLSIDFromString(CLSID_UpdateSession), COM.IID_IUnknown);
        state.session.funcs = COM.marshalFunctions(state.session, UpdateSessionFunctions);
        var appId = makeBSTR('MeshCentral');
        try { state.session.funcs.put_ClientApplicationID(state.session, appId); } catch (e) { }
        OleAut32.SysFreeString(appId);

        state.coll = COM.createInstance(COM.CLSIDFromString(CLSID_UpdateCollection), COM.CLSIDFromString(IID_IUpdateCollection));
        state.coll.funcs = COM.marshalFunctions(state.coll, UpdateCollectionFunctions);

        var searcherPtr = GM.CreatePointer();
        var hr = state.session.funcs.CreateUpdateSearcher(state.session, searcherPtr).Val;
        if (hr !== 0) { throw new Error('CreateUpdateSearcher failed: ' + hrHex(hr)); }
        state.searcher = searcherPtr.Deref();
        state.searcher.funcs = COM.marshalFunctions(state.searcher, UpdateSearcherFunctions);

        var searchDone = makeCallback(GM, COM, IID_IUSCC, function (job) {
            var srPtr = GM.CreatePointer();
            var hr2 = state.searcher.funcs.EndSearch(state.searcher, job, srPtr).Val;
            if (hr2 !== 0) { finish(new Error('EndSearch failed: ' + hrHex(hr2))); return; }
            var sr = srPtr.Deref();
            sr.funcs = COM.marshalFunctions(sr, SearchResultFunctions);
            var updatesPtr = GM.CreatePointer();
            if (sr.funcs.get_Updates(sr, updatesPtr).Val !== 0) { releaseCOM(sr); finish(new Error('Unable to read search results')); return; }
            var updates = updatesPtr.Deref();
            updates.funcs = COM.marshalFunctions(updates, UpdateCollectionFunctions);
            var countV = GM.CreateVariable(4);
            updates.funcs.get_Count(updates, countV);
            var count = readInt32(countV), found = {}, queued = 0;
            for (var n = 0; n < count; n++) {
                var upPtr = GM.CreatePointer();
                if (updates.funcs.get_Item(updates, n, upPtr).Val !== 0) continue;
                var up = upPtr.Deref();
                up.funcs = COM.marshalFunctions(up, UpdateFunctions);
                var id = '';
                var identPtr = GM.CreatePointer();
                if (up.funcs.get_Identity(up, identPtr).Val === 0) {
                    var ident = identPtr.Deref();
                    var identFuncs = COM.marshalFunctions(ident, UpdateIdentityFunctions);
                    var uidPtr = GM.CreatePointer();
                    if (identFuncs.get_UpdateID(ident, uidPtr).Val === 0) { id = readBSTR(uidPtr); }
                    try { identFuncs.Release(ident); } catch (e) { }
                }
                if ((id != '') && (wanted[id.toLowerCase()] === true) && (found[id.toLowerCase()] == null)) {
                    found[id.toLowerCase()] = true;
                    var titlePtr = GM.CreatePointer();
                    var entry = { updateID: id, title: (up.funcs.get_Title(up, titlePtr).Val === 0) ? readBSTR(titlePtr) : '', status: 'Queued' };
                    // We do not accept EULAs on behalf of the user. Updates that need one are reported and skipped.
                    var eulaV = GM.CreateVariable(2);
                    if ((up.funcs.get_EulaAccepted(up, eulaV).Val === 0) && (readVarBool(eulaV) === false)) {
                        entry.status = 'EulaNotAccepted';
                    } else {
                        var idxV = GM.CreateVariable(4);
                        if (state.coll.funcs.Add(state.coll, up, idxV).Val === 0) { entry.index = readInt32(idxV); queued++; } else { entry.status = 'AddFailed'; }
                    }
                    state.entries.push(entry);
                }
                releaseCOM(up);
            }
            releaseCOM(updates);
            releaseCOM(sr);
            for (var w in wanted) { if (found[w] == null) { state.entries.push({ updateID: w, title: '', status: 'NotFound' }); } }
            if (queued == 0) { finish(null, { resultCode: -1, result: 'NothingToInstall', rebootRequired: false, updates: state.entries }); return; }
            setImmediate(startDownload);
        });
        state.callbacks.push(searchDone);

        var criteriaBSTR = makeBSTR('IsInstalled=0 and IsHidden=0');
        var jobPtr = GM.CreatePointer();
        hr = state.searcher.funcs.BeginSearch(state.searcher, criteriaBSTR, searchDone, GM.CreateVariable(16), jobPtr).Val;
        OleAut32.SysFreeString(criteriaBSTR);
        if (hr !== 0) { throw new Error('BeginSearch failed: ' + hrHex(hr)); }
        state.job = wrapJob(jobPtr);
    } catch (ex) {
        finish(ex);
    }
    return ret;
}

function isInstallInProgress() { return (installInProgress != null); }

if (process.platform === 'win32') {
    module.exports = { getAvailableUpdates: getAvailableUpdates, getInstalledUpdates: getInstalledUpdates, getInstalledUpdateHistory: getInstalledUpdateHistory, getInstalledUpdatesDeDuplicated: getInstalledUpdatesDeDuplicated, installUpdates: installUpdates, isInstallInProgress: isInstallInProgress };
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
        getInstalledUpdatesDeDuplicated: _notSupported,
        installUpdates: _notSupported,
        isInstallInProgress: function () { return false; }
    };
}
