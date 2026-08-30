/*
Copyright 2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

var promise = require('promise');
var GM = require('_GenericMarshal');
var COM = require('win-com');
var sm = require('service-manager');
const CLSID_WbemAdministrativeLocator = '{CB8555CC-9128-11D1-AD9B-00C04FD8FDFF}';
const IID_WbemLocator = '{dc12a687-737f-11cf-884d-00aa004b2e24}';
const WMI_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WBEM_FLAG_BIDIRECTIONAL = 0;
const WBEM_FLAG_RETURN_IMMEDIATELY = 0x10;
const WBEM_FLAG_FORWARD_ONLY = 0x20;
const WBEM_FLAG_NONSYSTEM_ONLY = 0x40;
const WBEM_FLAG_CONNECT_USE_MAX_WAIT = 0x80;
const WBEM_INFINITE = -1;
const WBEM_FLAG_ALWAYS = 0;
const E_NOINTERFACE = 0x80004002;
const WBEM_S_NO_ERROR = 0;
const WBEM_S_FALSE = 1;
const WBEM_S_TIMEDOUT = 0x40004;
const WBEM_STATUS_COMPLETE = 0;
const WBEM_ERRORS = {
    0x80041001: 'Generic failure',
    0x80041002: 'Object not found',
    0x80041003: 'Access denied',
    0x80041004: 'Provider failure',
    0x80041006: 'Out of memory',
    0x80041008: 'Invalid parameter',
    0x80041009: 'Resource not available',
    0x8004100E: 'Invalid namespace',
    0x80041010: 'Invalid class',
    0x80041017: 'Invalid query',
    0x80041013: 'Provider not found',
    0x80041021: 'Invalid syntax',
    0x80070422: 'Service unavailable'
};

var OleAut32 = GM.CreateNativeProxy('OleAut32.dll');
OleAut32.CreateMethod('SafeArrayAccessData');
OleAut32.CreateMethod('SafeArrayUnaccessData');
OleAut32.CreateMethod('SafeArrayDestroy');
OleAut32.CreateMethod('VariantClear');
var wmi_handlers = {};

const LocatorFunctions = ['QueryInterface', 'AddRef', 'Release', 'ConnectToServer'];

//
// Reference for IWbemServices can be found at:
// https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-iwbemservices
//
const ServiceFunctions = [
    'QueryInterface',
    'AddRef',
    'Release',
    'OpenNamespace',
    'CancelAsyncCall',
    'QueryObjectSink',
    'GetObject',
    'GetObjectAsync',
    'PutClass',
    'PutClassAsync',
    'DeleteClass',
    'DeleteClassAsync',
    'CreateClassEnum',
    'CreateClassEnumAsync',
    'PutInstance',
    'PutInstanceAsync',
    'DeleteInstance',
    'DeleteInstanceAsync',
    'CreateInstanceEnum',
    'CreateInstanceEnumAsync',
    'ExecQuery',
    'ExecQueryAsync',
    'ExecNotificationQuery',
    'ExecNotificationQueryAsync',
    'ExecMethod',
    'ExecMethodAsync'
];

//
// Reference to IEnumWbemClassObject can be found at:
// https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-ienumwbemclassobject
//
const ResultsFunctions = [
        'QueryInterface',
        'AddRef',
        'Release',
        'Reset',
        'Next',
        'NextAsync',
        'Clone',
        'Skip'
];

//
// Reference to IWbemCallResult can be found at:
// https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-iwbemcallresult
// Used for semisynchronous calls (WBEM_FLAG_RETURN_IMMEDIATELY): poll GetResultObject() with a timeout.
//
const CallResultFunctions = [
        'QueryInterface',
        'AddRef',
        'Release',
        'GetResultObject',
        'GetResultString',
        'GetResultServices',
        'GetCallStatus'
];

//
// Reference to IWbemClassObject can be found at:
// https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nn-wbemcli-iwbemclassobject
//
const ResultFunctions = [
            'QueryInterface',
            'AddRef',
            'Release',
            'GetQualifierSet',
            'Get',
            'Put',
            'Delete',
            'GetNames',
            'BeginEnumeration',
            'Next',
            'EndEnumeration',
            'GetPropertyQualifierSet',
            'Clone',
            'GetObjectText',
            'SpawnDerivedClass',
            'SpawnInstance',
            'CompareTo',
            'GetPropertyOrigin',
            'InheritsFrom',
            'GetMethod',
            'PutMethod',
            'DeleteMethod',
            'BeginMethodEnumeration',
            'NextMethod',
            'EndMethodEnumeration',
            'GetMethodQualifierSet',
            'GetMethodOrigin'
];

// https://learn.microsoft.com/en-us/windows/win32/wmisdk/iwbemobjectsink
// A COM interface consists at least of QueryInterface, Addref and Release, which are called by the windows system to manage the COM object
// Indicate gets resultsets pushed and SetStatus gets called when finished
// When refCount hits 0, which normally happens after the SetStatus call through the system calling the Release function, clean everything up
const QueryAsyncHandler =
    [
        {
            cx: 10, parms: 3, name: 'QueryInterface', func: function (sink, riid, ppv)
            {
                var ret = GM.CreateVariable(4);
                // console.log('QueryInterface', riid.Deref(0, 16).toBuffer().toString('hex'));
                switch (riid.Deref(0, 16).toBuffer().toString('hex'))
                {
                    case '0000000000000000C000000000000046': // IID_IUnknown
                    case '0178857C8173CF11884D00AA004B2E24': // IID_IWmiObjectSink
                        sink.pointerBuffer().copy(ppv.Deref(0, GM.PointerSize).toBuffer());
                        ret.increment(0, true); //return WBEM_S_NO_ERROR=0
                        ++this.refcount;
                        break;
                    default:
                        ret.increment(E_NOINTERFACE, true);
                        break;
                }

                return ret;
            }
        },
        {
            cx: 11, parms: 1, name: 'AddRef', func: function ()
            {
                // console.log('AddRef: ' + this.refcount);
                return (GM.CreateVariable(4).increment(++this.refcount, true)); // return new refCount
            }
        },
        {
            cx: 12, parms: 1, name: 'Release', func: function ()
            {
                // console.log('Release: ' + this.refcount);
                if (--this.refcount === 0) { // console.log('Released');
                    destroy(this); }
                return GM.CreateVariable(4).increment(this.refcount >>> 0, true);   // return new refCount
            }
        },
        {
            cx: 13, parms: 3, name: 'Indicate', func: function (sink, count, arr)
            {
                // console.log('Indicate: ' + count.Val);
                if (this._abandoned) { return (GM.CreateVariable(4).increment(0, true)); }   // discard
                if (this.sessionid) {
                    this.progress += count.Val;
                    var now = Date.now();
                    if ((now - this.lastProg) > 2000) {     //wait at least 2 seconds per msg, otherwise it gets throttled and possibly lose the result msg
                        this.lastProg = now;
                        this.MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: ' + this.progress +  ' results', sessionid: this.sessionid }); }
                }
                for (var i = 0; i < count.Val; ++i)
                {
                    var wmiResultObj  = arr.Deref((i * GM.PointerSize) + 0, GM.PointerSize);
                    try {
                        if (this.reqFields != null) {
                            this.results.push(enumerateProperties(wmiResultObj, this.reqFields, this.fixedNameVars));
                        } else {
                            var c = this.cache.forRow(wmiResultObj);
                            this.results.push(enumerateProperties(wmiResultObj, c.propNames, c.propNameVars));
                        }
                    } catch (e) {
                        // only skip, not throw
                        console.log('win-wmi Indicate row error: ' + (e && e.message ? e.message : e));
                    }
                }
                return GM.CreateVariable(4).increment(0, true); //Indicate must always return WBEM_S_NO_ERROR=0
            }
        },
        {
            cx: 14, parms: 5, name: 'SetStatus', func: function (sink, lFlags, hResult, strParam, pObjParam)
            {
                // console.log('SetStatus ' + lFlags.Val);
                var ret = GM.CreateVariable(4).increment(0, true);  // SetStatus must always return WBEM_S_NO_ERROR=0
                if (lFlags.Val !== WBEM_STATUS_COMPLETE) { return (ret); }  // SetStatus can receive other messages, skip those

                if (this._timer) { clearTimeout(this._timer); this._timer = null; } // Finished before the settimeout, remove timer
                var self = this;
                setImmediate(function () { if (--self.refcount === 0) { destroy(self); } });    // decrement self set refCount of 1 at init
                if (this._abandoned) { return (ret); }  // timeout settled the promise
                this._abandoned = true;                 // Signal timeout function
                if (hResult.Val == 0) {     // Everything ok, msg & resolve
                    if (this.sessionid) {
                        this.MA.SendCommand({ action: 'msg', type: 'console', value: 'Querytotal: ' + this.results.length + ' results, time take: ' + (Date.now()-this.progStart)/1000 + ' seconds', sessionid: this.sessionid });
                    }
                    this.p.resolve(this.results); }
                else {
                    var e = new Error('WMI async query error: ' + (WBEM_ERRORS[hResult.Val>>>0] || 'unknown') + ' (0x' + (hResult.Val>>>0).toString(16) + ')');
                    if (this.results.length > 0) { e.results = this.results; }
                    this.p.reject(e);
                }
                return (ret);
            }
        }
    ];

function destroy(h) {
    // console.log('Destroy oh boy!');
    if (h.cleanup) { h.cleanup(); }
    h.p = null;
    delete wmi_handlers[h._hashCode()];
    h.services = releaseCOM(h.services, true);
    
    if (h.callbackDispatched) {
        setImmediate(function () { h.locator = releaseCOM(h.locator, false); });
    } else {
        h.locator = releaseCOM(h.locator, false);
    }
}

function releaseCOM(obj, deref) {
    if (obj && obj.funcs) {
        try { obj.funcs.Release(deref ? obj.Deref() : obj); }
        catch (e) { console.log('WMI: releaseCOM error = ' + (e && e.message ? e.message : e)); }
    }
    return null;
}

function extractFields(queryString) {
    if (typeof queryString !== 'string') { return null; }

    // get between 'select' and 'from'
    var props = /^\s*SELECT\s+(.+?)\s+FROM\s/i.exec(queryString);
    if (props == null) { return null; }

    var list = props[1].trim();
    if (list === '*') { return null; }

    var parts = list.split(',');
    var fields = [];
    for (var i = 0; i < parts.length; ++i) {
        var name = parts[i].trim();
        // check if wmi field, otherwise exit, fallback to GetNames in enum
        if (!WMI_FIELD.test(name)) { return null; }
        fields.push(name);
    }
    return (fields.length > 0 ? fields : null);
}

// Optimze query: If a 'select * from' query has the 'fields' argument, rewrite query to replace the * with fields argument
// Except for event/notification queries (WITHIN or FROM __)
// This gives a significant perfomance boost as enumerateProperties is very costly if it needs to get all properties every row
// Always try to do:  queryString='select [field1][,field2][...] from [class]', fields=['field1','field2',...]
// Keeping the fields argument filled helps with the enumerateProperties function not getting all the names every row.
// And the reverse, if there are fields between 'select' and 'from', extract them and return it as the fields argument
function prepareQuery (queryString, fields) {
    if (typeof(queryString) !=='string' || queryString.trim().length === 0) { throw new Error('No querystring'); }
    // Always check if wmi service is running
    var s = sm.manager.getService('winmgmt');
    if (!s.isRunning()) { throw new Error('WMI service not running'); }
    if (!Array.isArray(fields) || fields.length === 0) {
        fields = extractFields(queryString); }
    else {
        for (var i = 0; i < fields.length; ++i) {
            if (typeof fields[i] !== 'string' || !WMI_FIELD.test(fields[i])) {
                throw new Error('win-wmi: invalid field name: ' + fields[i]);
            }
        }
        //skip 'within' clause and system event queries
        if ( !(/\bWITHIN\b/i.test(queryString) || /\bFROM\s+__/i.test(queryString))) {
            queryString = queryString.replace(/^(\s*SELECT\s+)\*(\s+FROM\s)/i, '$1' + fields.join(',') + '$2');
        }
    }
    // console.info1('WMI: prepared query = ' + queryString + ' fields: ' + fields);
    return { q: queryString, f: fields };
}

// get all property names for a wmi result
function getAllNames(wmiResultObj, includeSysProp)
{
    if (!wmiResultObj.funcs) { wmiResultObj.funcs = COM.marshalFunctions(wmiResultObj.Deref(), ResultFunctions); }

    var saNames = GM.CreatePointer();
    // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-getnames
    var res = (wmiResultObj.funcs.GetNames(wmiResultObj.Deref(), 0, (includeSysProp ? WBEM_FLAG_ALWAYS : WBEM_FLAG_NONSYSTEM_ONLY), 0, saNames));
    if (res.Val != 0) { return []; }
    var len = saNames.Deref().Deref(GM.PointerSize == 8 ? 24 : 16, 4).toBuffer().readUInt32LE();
    var pNamesArray = GM.CreatePointer();
    OleAut32.SafeArrayAccessData(saNames.Deref(), pNamesArray);

    var propNames = [];
    for (var i = 0; i < len; ++i) {
        var propName = pNamesArray.Deref().increment(i * GM.PointerSize).Deref().Wide2UTF8;
        if (propName.length === 0) { continue; }
        propNames.push(propName);
    }
    OleAut32.SafeArrayUnaccessData(saNames.Deref());
    OleAut32.SafeArrayDestroy(saNames.Deref());   // saNames is caller-owned
    // console.info1('WMI: getAllNames(propNames) = ' + JSON.stringify(propNames));
    return propNames;
}

function NameCache(includeSysProp)
{
    this.includeSysProp = (typeof(includeSysProp) == 'boolean') ? includeSysProp : false;
    this.byClass = {};
    this._classNameVar = GM.CreateVariable('__CLASS', { wide: true }); // reused every row
}

NameCache.prototype.forRow = function (wmiResultObj)
{
    if (!wmiResultObj.funcs) { wmiResultObj.funcs = COM.marshalFunctions(wmiResultObj.Deref(), ResultFunctions); }

    // Read __CLASS (system property, always a BSTR). Falls back to '' if absent.
    var key = '';
    var val = GM.CreateVariable(24);
    try {
        if (wmiResultObj.funcs.Get(wmiResultObj.Deref(), this._classNameVar, 0, val, 0, 0).Val == 0 && val.toBuffer().readUInt16LE() == 0x0008) {
            key = val.Deref(8, GM.PointerSize).Deref().Wide2UTF8; 
        }
    } finally {
        OleAut32.VariantClear(val);
    }
    
    var entry = this.byClass[key];
    if (!entry) {
        var propNames = getAllNames(wmiResultObj, this.includeSysProp);
        var propNameVars = [];
        for (var n = 0; n < propNames.length; ++n) {
            propNameVars.push(GM.CreateVariable(propNames[n], { wide: true }));
        }
        entry = this.byClass[key] = { propNames: propNames, propNameVars: propNameVars };
    }
    return entry;
};

function enumerateProperties(wmiResultObj, propNames, propNameVars)
{
    //
    // Reference to SafeArrayAccessData() can be found at:
    // https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearrayaccessdata
    //

    var values = {};
    if (!wmiResultObj.funcs) { wmiResultObj.funcs = COM.marshalFunctions(wmiResultObj.Deref(), ResultFunctions); }

    // Now we need to introspect the Array Fields
    var propVal = GM.CreateVariable(24);
    for (var i = 0; i < propNames.length; ++i)
    {
        if (wmiResultObj.funcs.Get(wmiResultObj.Deref(), propNameVars[i], 0, propVal, 0, 0).Val == 0)
        {
            //
            // Reference for IWbemClassObject::Get() can be found at:
            // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-get
            //

            var vartype = propVal.toBuffer().readUInt16LE();
            var isArray = (vartype & 0x2000) != 0;  // VT_ARRAY flag
            var baseType = vartype & 0x0FFF;

            if (isArray)
            {
                // Handle array types (VT_ARRAY | base type)
                var safeArray = propVal.Deref(8, GM.PointerSize).Deref();
                var arrayLength = safeArray.Deref(GM.PointerSize == 8 ? 24 : 16, 4).toBuffer().readUInt32LE();
                var arrayData = GM.CreatePointer();
                OleAut32.SafeArrayAccessData(safeArray, arrayData);
                
                // VT_I8 & VT_UI8 (64-bit types) aren't used (yet?) in wmi, added for completeness
                // added float type VT_R4 and VT_R8, uncommon but used
                // VT_DECIMAL not mapped in wmi
                var arrayValues = [];
                for (var k = 0; k < arrayLength; ++k)
                {
                    switch (baseType)
                    {
                        case 0x0002:    // VT_I2
                            arrayValues.push(arrayData.Deref().Deref(k * 2, 2).toBuffer().readInt16LE());
                            break;
                        case 0x0003:    // VT_I4
                        case 0x0016:    // VT_INT
                            arrayValues.push(arrayData.Deref().Deref(k * 4, 4).toBuffer().readInt32LE());
                            break;
                        case 0x0004:    // VT_R4
                            arrayValues.push(arrayData.Deref().Deref(k * 4, 4).toBuffer().readFloatLE(0));
                            break;
                        case 0x0005:    // VT_R8
                            arrayValues.push(arrayData.Deref().Deref(k * 8, 8).toBuffer().readDoubleLE(0));
                            break;
                        case 0x0008:    // VT_BSTR
                            arrayValues.push(arrayData.Deref().Deref(k * GM.PointerSize, GM.PointerSize).Deref().Wide2UTF8);
                            break;
                        case 0x000B:    // VT_BOOL
                            arrayValues.push(arrayData.Deref().Deref(k * 2, 2).toBuffer().readInt16LE() != 0);
                            break;
                        // case 0x000E:    //VT_DECIMAL
                        //     break;
                        case 0x0010:    // VT_I1
                            arrayValues.push(arrayData.Deref().Deref(k, 1).toBuffer().readInt8());
                            break;
                        case 0x0011:    // VT_UI1
                            arrayValues.push(arrayData.Deref().Deref(k, 1).toBuffer().readUInt8());
                            break;
                        case 0x0012:    // VT_UI2
                            arrayValues.push(arrayData.Deref().Deref(k * 2, 2).toBuffer().readUInt16LE());
                            break;
                        case 0x0013:    // VT_UI4
                        case 0x0017:    // VT_UINT
                            arrayValues.push(arrayData.Deref().Deref(k * 4, 4).toBuffer().readUInt32LE());
                            break;
/*
                        case 0x0014:    // VT_I8 (signed 64-bit)
                            var ai8 = arrayData.Deref().Deref(k * 8, 8).toBuffer();
                            // recombine the two 32-bit halves; exact up to 2^53 (high word signed)
                            arrayValues.push(ai8.readInt32LE(4) * 0x100000000 + ai8.readUInt32LE(0));
                            break;
                        case 0x0015:    // VT_UI8 (unsigned 64-bit)
                            var aui8 = arrayData.Deref().Deref(k * 8, 8).toBuffer();
                            arrayValues.push(aui8.readUInt32LE(4) * 0x100000000 + aui8.readUInt32LE(0));
                            break;
*/
                        default:
                            console.info1('VARTYPE (array element): 0x' + baseType.toString(16));
                            break;
                    }
                }
                OleAut32.SafeArrayUnaccessData(safeArray);
                values[propNames[i]] = arrayValues;
            }
            else
            {
                // Handle scalar types
                switch (vartype)
                {
                    case 0x0000:    // VT_EMPTY
                    case 0x0001:    // VT_NULL
                        values[propNames[i]] = null;
                        break;
                    case 0x0002:    // VT_I2
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readInt16LE();
                        break;
                    case 0x0003:    // VT_I4
                    case 0x0016:    // VT_INT
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readInt32LE();
                        break;
                    case 0x0004:    // VT_R4
                        values[propNames[i]] = propVal.Deref(8, 4).toBuffer().readFloatLE(0);
                        break;
                    case 0x0005:    // VT_R8
                        values[propNames[i]] = propVal.Deref(8, 8).toBuffer().readDoubleLE(0);
                        break;
                    case 0x0008:    // VT_BSTR
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).Deref().Wide2UTF8;
                        break;
                    case 0x000B:    // VT_BOOL
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readInt32LE() != 0;
                        break;
                    // case 0x000E:    // VT_DECIMAL
                    //     break;
                    case 0x0010:    // VT_I1
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readInt8();
                        break;
                    case 0x0011:    // VT_UI1
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readUInt8();
                        break;
                    case 0x0012:    // VT_UI2
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readUInt16LE();
                        break;
                    case 0x0013:    // VT_UI4
                    case 0x0017:    // VT_UINT
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readUInt32LE();
                        break;
/*
                    case 0x0014:    // VT_I8
                        var i8 = propVal.Deref(8, 8).toBuffer();
                        // recombine the two 32-bit halves; exact up to 2^53 (high word is signed)
                        values[propNames[i]] = i8.readInt32LE(4) * 0x100000000 + i8.readUInt32LE(0);
                        break;
                    case 0x0015:    // VT_UI8
                        var ui8 = propVal.Deref(8, 8).toBuffer();
                        values[propNames[i]] = ui8.readUInt32LE(4) * 0x100000000 + ui8.readUInt32LE(0);
                        break;
*/
                    default:
                        console.info1('VARTYPE: 0x' + vartype.toString(16));
                        break;
                }
            }
        }
        OleAut32.VariantClear(propVal);
    }
    return (values);
}


// (optional) includeSysProp, default=false. Include system properties (__CLASS, etc.)
// (optional) timeout, default=120 seconds. Query duration timeout in ms
// (optional) sessionid, default=null. Report progress back to the given sessionid.
function queryAsync(resourceString, queryString, fields, includeSysProp, timeout, sessionid)
{
    var queryStarted = false;
    var handlers = null;
    try {
        var p = new promise(promise.defaultInit);
        //32-bit windows cannot do more than 1 async query at a time because of the hardcoded vtable for the cx pre-compiled __stdcall custom handlers in iLibDuktape_GenericMarshal.c
        if (GM.PointerSize == 4 && Object.keys(wmi_handlers).length != 0) {
            setImmediate(function(){ p.reject(new Error('Another AsyncQuery is already running, only one AsyncQuery possible at a time on 32-bit Windows')); }); return (p); }
        if (!timeout || typeof timeout !== 'number') { timeout = 120 * 1000 };       //Default timeout set to 2m
        var pq = prepareQuery(queryString, fields);
        queryString = pq.q;
        var reqFields = pq.f;
        var resource = GM.CreateVariable(resourceString, { wide: true });
        var language = GM.CreateVariable("WQL", { wide: true });
        var query = GM.CreateVariable(queryString, { wide: true });

        // Setup the Async COM handler for QueryAsync() 
        handlers = COM.marshalInterface(QueryAsyncHandler);
        handlers.refcount = 1;
        handlers.results = [];
        handlers.reqFields = reqFields;
        handlers.query = resourceString + ':' + queryString;
        handlers._timer = null;
        handlers._abandoned = false;
        if (reqFields != null && Array.isArray(reqFields)) {
            handlers.fixedNameVars = reqFields.map(function (f) { return GM.CreateVariable(f, { wide: true }); });
        } else {
            handlers.cache = new NameCache(includeSysProp);
        }
        if (sessionid) { handlers.sessionid = sessionid; handlers.progStart = Date.now(); handlers.progress = 0; handlers.lastProg = 0; handlers.MA = require('MeshAgent'); }
        handlers.locator = COM.createInstance(COM.CLSIDFromString(CLSID_WbemAdministrativeLocator), COM.IID_IUnknown);
        handlers.locator.funcs = COM.marshalFunctions(handlers.locator, LocatorFunctions);

        handlers.services = GM.CreatePointer();

        // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemlocator-connectserver
        // WBEM_FLAG_CONNECT_USE_MAX_WAIT=wait max 2 minutes instead of infinite. Prevents blocking.
        var hr = handlers.locator.funcs.ConnectToServer(handlers.locator, resource, 0, 0, 0, WBEM_FLAG_CONNECT_USE_MAX_WAIT, 0, 0, handlers.services).Val >>> 0;
        if (hr != 0) {
            throw (new Error('ConnectToServer(' + resourceString + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')')); }

        handlers.services.funcs = COM.marshalFunctions(handlers.services.Deref(), ServiceFunctions);
        handlers.p = p;
        
        // Make the COM call
        var execRes = handlers.services.funcs.ExecQueryAsync(handlers.services.Deref(), language, query, WBEM_FLAG_BIDIRECTIONAL, 0, handlers).Val >>> 0;
        if (execRes !== 0) {
            throw new Error('ExecQueryAsync(' + handlers.query + ') failed: ' + (WBEM_ERRORS[execRes] || 'unknown') + ' (0x' + execRes.toString(16) + ')'); }
        queryStarted = true;
        // Hold a reference to the callback object
        wmi_handlers[handlers._hashCode()] = handlers;
        handlers._timer = setTimeout(function () {
            handlers._timer = null;
            if (handlers._abandoned) { return; }    //Signal from SetStatus, it settled
            // WMI CancelAsyncCall causes a fatal exception. Only way to cancel is through abandonment.
            // Reject the promise and clean that part up, hoping the wmi query resolves eventually and cleans itself up through SetStatus
            // There seems to be not other way to stop a hung/long query
            handlers._abandoned = true;     // Signal SetStatus we'll reject
            var e = new Error('WMI query timed out after ' + (timeout/1000) + ' seconds');
            if (handlers.results.length > 0) { e.results = handlers.results; }
            handlers.p.reject(e);
        }, timeout);
    } catch (e) {
        console.log('win-wmi queryAsync error: ' + e.message);
        if (!queryStarted && handlers) {
            handlers.refcount = 0;
            destroy(handlers);
        }
        p.reject(e);
    }
    return (p);
}

// (optional) includeSysProp, default=false. Include system properties (__CLASS, etc.)
// (optional) timeout, default=120 seconds. Query duration timeout in ms
// (optional) sessionid, default=null. Report progress back to the given sessionid.
function query(resourceString, queryString, fields, includeSysProp, timeout, sessionid)
{
    const uCount = 32;  // number of rows to retrieve per round
    var ret = [];
    try {
        if (!timeout || typeof timeout !== 'number') { timeout = 120 * 1000 };       //Default timeout set to 2m
        var pq = prepareQuery(queryString, fields);
        queryString = pq.q;
        var reqFields = pq.f;
        var fixedNameVars = null;
        var cache = null;
        if (reqFields != null && Array.isArray(reqFields)) {
            fixedNameVars = reqFields.map(function (f) { return GM.CreateVariable(f, { wide: true }); });
        } else {
            cache = new NameCache(includeSysProp);
        }
        var resource = GM.CreateVariable(resourceString, { wide: true });
        var language = GM.CreateVariable("WQL", { wide: true });
        var query = GM.CreateVariable(queryString, { wide: true });
        var results = GM.CreatePointer();
        if (sessionid) { var MA = require('MeshAgent'), progress = 0, lastProg =  0 }
        // Connect the locator connection for WMI
        var locator = COM.createInstance(COM.CLSIDFromString(CLSID_WbemAdministrativeLocator), COM.IID_IUnknown);
        locator.funcs = COM.marshalFunctions(locator, LocatorFunctions);
        var services = GM.CreatePointer();

       // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemlocator-connectserver
        // WBEM_FLAG_CONNECT_USE_MAX_WAIT=wait max 2 minutes instead of infinite. Prevents blocking.
        var hr = locator.funcs.ConnectToServer(locator, resource, 0, 0, 0, WBEM_FLAG_CONNECT_USE_MAX_WAIT, 0, 0, services).Val >>> 0;
        if (hr != 0) {
            throw new Error('ConnectToServer(' + resourceString + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }

        // Execute the Query
        // FORWARD_ONLY & RETURN_IMMEDIATELY instead of BIDIRECTIONAL, faster and less memory. https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemservices-execquery
        services.funcs = COM.marshalFunctions(services.Deref(), ServiceFunctions);
        if ((hr = services.funcs.ExecQuery(services.Deref(), language, query, WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, 0, results).Val >>> 0) != 0) {
            throw new Error('ExecQuery() failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }

        // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-ienumwbemclassobject-next
        // Batch retrieve per round instead of the original 1. Improves speed on larger sets as it lowers COM calls, like the asyncHandler does
        // nextRes=WBEM_S_FALSE: signals the last set. Check returnedCount if rows left to process
        // nextRes=WBEM_S_NO_ERROR: returnedCount equal to requested number
        results.funcs = COM.marshalFunctions(results.Deref(), ResultsFunctions);
        var apObjects = GM.CreateVariable(uCount * GM.PointerSize);
        var returnedCount = GM.CreateVariable(4);   // ULONG puReturned
        var retries = 0, rowTimeout = 10 * 1000;    // rowTimeout was WBEM_INFINITE. in ms. Prevents blocking. Generates WBEM_S_TIMEDOUT on timeout
        var progStart = Date.now();
        while (true) {
            if ((Date.now()-progStart) > timeout) { throw new Error('WMI query timed out after ' + (timeout/1000) + ' seconds'); }
            var nextRes = results.funcs.Next(results.Deref(), rowTimeout, uCount, apObjects, returnedCount).Val >>> 0;
            if (nextRes >= 0x80000000) { throw new Error('Next() failed: ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ')'); }
            var returnedRows = (nextRes === WBEM_S_NO_ERROR) ? uCount : returnedCount.toBuffer().readUInt32LE();   // Only use returnedCount on last set, as WBEM_S_NO_ERROR implies a full batch

            if (returnedRows === 0) {  // handle special case, no rows returned
                if (nextRes === WBEM_S_FALSE) { break; }    // Done. Exit.
                if (++retries > 6) { throw new Error('Next() errored too many times: ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ')'); }
                if (sessionid) { MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: issue ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ') after ' + progress + ' results', sessionid: sessionid }); }
                continue; // timed out, retry
            }
            retries = 0;

            for (var row = 0; row < returnedRows; ++row) {
                var rowObj = apObjects.Deref(row * GM.PointerSize, GM.PointerSize);
                rowObj.funcs = COM.marshalFunctions(rowObj.Deref(), ResultFunctions);
                try {
                    if (reqFields != null) { ret.push(enumerateProperties(rowObj, reqFields, fixedNameVars)); }
                    else { var c = cache.forRow(rowObj); ret.push(enumerateProperties(rowObj, c.propNames, c.propNameVars)); }
                } catch (rowErr) {
                    console.log('win-wmi query row error: ' + (rowErr && rowErr.message ? rowErr.message : rowErr));
                } finally {
                    rowObj.funcs.Release(rowObj.Deref());
                }
            }

            if (sessionid) {
                progress += returnedRows;
                var now = Date.now();
                if ((now - lastProg) > 2000) {
                    lastProg = now;
                    MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: ' + progress + ' results', sessionid: sessionid });
                }
            }

            if (nextRes === WBEM_S_FALSE) { break; }   // last (partial) batch done. Exit
        }
    } catch (e) {
        console.log('win-wmi query error: ' + e.message);
        if (ret.length > 0) { e.results = ret; }
        throw (e);
    } finally {
        results = releaseCOM(results, true);
        services = releaseCOM(services, true);
        locator = releaseCOM(locator, false);
    }
    // console.log(JSON.stringify(ret).substring(0,200));
    if (sessionid) {
        MA.SendCommand({ action: 'msg', type: 'console', value: 'Querytotal: ' + ret.length + ' results, time take: ' + (Date.now()-progStart)/1000 + ' seconds', sessionid: sessionid }); }
    return (ret);
}

// Helperfunction to avoid annoying backslash/double quote escapes
function buildEscapePath(className, keys) {
    if (!keys || Object.keys(keys).length === 0) { return className; }
    var parts = [];
    for (var k in keys) {
        var val = keys[k];
        // Numeric keys are written as is, the rest gets an escape
        if (typeof val === 'number') { parts.push(k + '=' + val); }
        else { parts.push(k + '="' + ('' + val).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'); }
    }
    return className + '.' + parts.join(',');
}

// Write a single input value into a VARIANT buffer (vbuf = the variant's toBuffer() view).
// !!! Returns a GM variable that must be KEPT ALIVE until AFTER the COM call (for VT_BSTR only, whose pointer lives in the variant),
// This is because the VARIANT does not contain the string bytes. It contains an 8-byte pointer to bstr's separately-allocated native memory.
// The VARIANT and the string buffer are two different allocations, so the caller must keep a reference until after the COM call.
// This prevents the GC from cleaning up the buffer allocation until we're done. 
function writeInParamVariant(vbuf, val) {
    var type = null, value = val;
    if (val !== null && typeof val === 'object' && val.type != null) { type = ('' + val.type).toLowerCase(); value = val.value; }
    if (type === null) {
        if (val === null || typeof val === 'undefined') { type = 'null'; }
        else if (typeof val === 'boolean') { type = 'bool'; }
        else if (typeof val === 'string') { type = 'bstr'; }
        else if (typeof val === 'number') { type = (Math.floor(value) === value) ? 'i4' : 'r8'; }   // integer -> VT_I4, fractional -> VT_R8
        else { throw new Error('win-wmi: unsupported inParam value: ' + JSON.stringify(val)); }
    }
    switch (type) {
        case 'empty':                          vbuf.writeUInt16LE(0x0000, 0); break;                                  // VT_EMPTY
        case 'null':                           vbuf.writeUInt16LE(0x0001, 0); break;                                  // VT_NULL
        case 'i2':  case 'int16':  case 'short':vbuf.writeUInt16LE(0x0002, 0); vbuf.writeInt16LE(value | 0, 8); break;  // VT_I2
        case 'i4':  case 'int32':  case 'int':  vbuf.writeUInt16LE(0x0003, 0); vbuf.writeInt32LE(value | 0, 8); break;  // VT_I4
        case 'r4':  case 'float':               vbuf.writeUInt16LE(0x0004, 0); vbuf.writeFloatLE(+value, 8);    break;  // VT_R4
        case 'r8':  case 'double':              vbuf.writeUInt16LE(0x0005, 0); vbuf.writeDoubleLE(+value, 8);   break;  // VT_R8
        case 'bool': case 'boolean':            vbuf.writeUInt16LE(0x000B, 0); vbuf.writeInt16LE(value ? -1 : 0, 8); break;  // VT_BOOL (-1 = true)
        case 'i1':  case 'int8':  case 'sbyte': vbuf.writeUInt16LE(0x0010, 0); vbuf.writeInt8(value | 0, 8);    break;  // VT_I1
        case 'ui1': case 'uint8': case 'byte':  vbuf.writeUInt16LE(0x0011, 0); vbuf.writeUInt8(value & 0xFF, 8);break;  // VT_UI1
        case 'ui2': case 'uint16':              vbuf.writeUInt16LE(0x0012, 0); vbuf.writeUInt16LE(value & 0xFFFF, 8); break;  // VT_UI2
        case 'ui4': case 'uint32': case 'uint': vbuf.writeUInt16LE(0x0013, 0); vbuf.writeUInt32LE(value >>> 0, 8); break;  // VT_UI4
        case 'bstr': case 'string':                                                                                     // VT_BSTR
            var bstr = GM.CreateVariable('' + value, { wide: true });
            vbuf.writeUInt16LE(0x0008, 0);
            bstr.pointerBuffer().copy(vbuf, 8);   // pointer to wide string at union offset 8
            return bstr;                          // caller must keep this alive so the GC won't reclaim 
        default: throw new Error('win-wmi: unsupported inParam VARIANT type: ' + type);
    }
    return null;    // directly written, no need to keep alive
}

// Open a reusable connection to a WMI namespace, so multiple ExecMethod calls can share a single
// IWbemServices and skip the per-call ConnectToServer (the expensive DCOM/RPC handshake). Caller MUST
// call release() when done.
//   var sess = wmi.connect(ns);
//   try { sess.execMethod(className, keys, method, inParams, timeout); ... } finally { sess.release(); }
function wmiConnect(resourceString)
{
    var s = sm.manager.getService('winmgmt');
    if (!s.isRunning()) { throw new Error('WMI service not running'); }

    var locator = COM.createInstance(COM.CLSIDFromString(CLSID_WbemAdministrativeLocator), COM.IID_IUnknown);
    locator.funcs = COM.marshalFunctions(locator, LocatorFunctions);
    var services = GM.CreatePointer();
    var resource = GM.CreateVariable(resourceString, { wide: true });
    var hr = locator.funcs.ConnectToServer(locator, resource, 0, 0, 0, WBEM_FLAG_CONNECT_USE_MAX_WAIT, 0, 0, services).Val >>> 0;
    if (hr != 0) {
        releaseCOM(locator, false);
        throw new Error('ConnectToServer(' + resourceString + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')');
    }
    services.funcs = COM.marshalFunctions(services.Deref(), ServiceFunctions);

    return {
        ns: resourceString,
        services: services,
        locator: locator,
        _sigCache: {},   // 'Class.Method' -> in-params signature (IWbemClassObject), reused across calls
        // Same signature as execMethod() minus the leading namespace (it's bound to this connection)
        execMethod: function (className, keys, methodName, inParams, timeout) {
            return execMethodOn(this.services, this.ns, className, keys, methodName, inParams, timeout, this._sigCache);
        },
        release: function () {
            for (var k in this._sigCache) { this._sigCache[k] = releaseCOM(this._sigCache[k], true); }
            this.services = releaseCOM(this.services, true);
            this.locator = releaseCOM(this.locator, false);
        }
    };
}

// Call a WMI method via IWbemServices::ExecMethod
// resourceString : namespace, e.g. 'root\\cimv2\\Security\\MicrosoftVolumeEncryption'
// className      : the class the method lives on, e.g. 'Win32_EncryptableVolume'
// keys           : (optional) plain object of key property/properties identifying the
//                  instance, e.g. { DeviceID: vols[0].DeviceID }. Values are escaped
//                  automatically - pass the RAW value, do NOT pre-escape. Pass null/{}
//                  for static (class-level) methods.
// methodName     : e.g. 'GetConversionStatus'
// inParams       : (optional) plain object of { paramName: value } input arguments
// timeout        : (optional) max ms to wait for the method to complete, default 60s.
//
// One-shot: connects, runs, releases. For several calls to the same namespace use wmi.connect(ns)
// and reuse sess.execMethod(...) to avoid reconnecting each time.
// Reference: https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemservices-execmethod
function execMethod(resourceString, className, keys, methodName, inParams, timeout)
{
    var sess = wmiConnect(resourceString);
    try { return execMethodOn(sess.services, resourceString, className, keys, methodName, inParams, timeout); }
    finally { sess.release(); }
}

// Core ExecMethod against an already-connected IWbemServices. Does NOT release `services`/locator -
// the caller (execMethod wrapper or a wmiConnect() session) owns the connection lifetime.
// sigCache (optional): a session-owned { 'Class.Method': inSignature } map. When passed, the in-params
// signature is fetched once (GetObject+GetMethod) and reused on subsequent calls; the session releases it.
function execMethodOn(services, ns, className, keys, methodName, inParams, timeout, sigCache)
{
    if (!timeout || typeof timeout !== 'number') { timeout = 60 * 1000; }   // default 60s ceiling
    var debug = false;
    function DBG(msg) { if (debug) { console.log('win-wmiii execMethod: ' + msg); } }
    var objectPath = buildEscapePath(className, keys);
    DBG('ns=' + ns + ' path=' + objectPath + ' method=' + methodName + ' in=' + JSON.stringify(inParams || {}));
    var classObj = null, inSig = null, inSigCached = false, inInst = null, outParams = null, callRes = null;
    try {
        var hr;
        var pathVar = GM.CreateVariable(objectPath, { wide: true });
        var methodVar = GM.CreateVariable(methodName, { wide: true });

        // Get the in-params signature (cached per Class.Method when a session is used) > spawn instance > put params in
        var pInParams = 0;
        if (inParams && Object.keys(inParams).length > 0) {
            var sigKey = className + '.' + methodName;
            if (sigCache && sigCache[sigKey]) {
                inSig = sigCache[sigKey];       // reuse the cached signature, skip GetObject/GetMethod
                inSigCached = true;
            } else {
                // Get the class definition, then the method's in-signature
                // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemservices-getobject
                var classNameVar = GM.CreateVariable(className, { wide: true });
                classObj = GM.CreatePointer();
                if ((hr = services.funcs.GetObject(services.Deref(), classNameVar, 0, 0, classObj, 0).Val >>> 0) != 0) {
                    throw new Error('GetObject(' + className + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }
                classObj.funcs = COM.marshalFunctions(classObj.Deref(), ResultFunctions);

                // GetMethod -> in-param signature (ppOutSignature is optional, pass 0 - we don't use it)
                // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-getmethod
                inSig = GM.CreatePointer();
                if ((hr = classObj.funcs.GetMethod(classObj.Deref(), methodVar, 0, inSig, 0).Val >>> 0) != 0) {
                    throw new Error('GetMethod(' + methodName + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }
                inSig.funcs = COM.marshalFunctions(inSig.Deref(), ResultFunctions);
                if (sigCache) { sigCache[sigKey] = inSig; inSigCached = true; }   // hand ownership to the session cache
            }

            // create class instance to put params in
            // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-spawninstance
            inInst = GM.CreatePointer();
            if ((hr = inSig.funcs.SpawnInstance(inSig.Deref(), 0, inInst).Val >>> 0) != 0) {
                throw new Error('SpawnInstance failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }
            inInst.funcs = COM.marshalFunctions(inInst.Deref(), ResultFunctions);

            // Set the named properties in the instance
            // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-put
            var keepAlive = [];
            for (var name in inParams) {
                var nameVar = GM.CreateVariable(name, { wide: true });
                var v = GM.CreateVariable(24);   // VARIANT: 16 bytes on x86 / 24 on x64; same offset, so doesn't have to be 32/64 bit specific, use largest
                var vbuf = v.toBuffer();
                var val = inParams[name];
                var keep = writeInParamVariant(vbuf, val);
                if (keep != null) { keepAlive.push(keep); }     // Keep the B_STR reference alive until at least after the COM call, now releases after function exit
                DBG('Put ' + name + '=' + JSON.stringify(val) + ' variant[0:12]=' + vbuf.slice(0, 12).toString('hex'));
                if ((hr = inInst.funcs.Put(inInst.Deref(), nameVar, 0, v, 0).Val >>> 0) != 0) {
                    throw new Error('Put(' + name + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }
            }
            pInParams = inInst.Deref();
        }

        // Run execMethod semi-synchronous to prevent blocking
        // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemservices-execmethod
        DBG('ExecMethod calling, pInParams=' + (pInParams ? 'set' : 'NULL'));
        callRes = GM.CreatePointer();
        hr = services.funcs.ExecMethod(services.Deref(), pathVar, methodVar, WBEM_FLAG_RETURN_IMMEDIATELY, 0, pInParams, 0, callRes).Val >>> 0;
        DBG('ExecMethod returned 0x' + hr.toString(16) + (hr ? ' (' + (WBEM_ERRORS[hr] || 'unknown') + ')' : ''));
        if (hr != 0) {
            throw new Error('ExecMethod(' + methodName + ') failed: ' + (WBEM_ERRORS[hr] || 'unknown') + ' (0x' + hr.toString(16) + ')'); }
        callRes.funcs = COM.marshalFunctions(callRes.Deref(), CallResultFunctions);

        // GetResultObject returns WBEM_S_TIMEDOUT if the method hasn't finished within the chunk.
        // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemcallresult-getresultobject
        outParams = GM.CreatePointer(); // results
        var deadline = Date.now() + timeout;
        var chunk = 2000;   // ms per GetResultObject() call
        while (true) {
            if (Date.now() > deadline) { throw new Error('ExecMethod(' + methodName + ') timed out after ' + (timeout/1000) + ' seconds'); }
            var gr = callRes.funcs.GetResultObject(callRes.Deref(), chunk, outParams).Val >>> 0;
            if (gr === WBEM_S_NO_ERROR) { break; }       // ready
            if (gr === WBEM_S_TIMEDOUT) { continue; }   //continue until deadline
            throw new Error('GetResultObject(' + methodName + ') failed: ' + (WBEM_ERRORS[gr] || 'unknown') + ' (0x' + gr.toString(16) + ')');
        }

        if (outParams.Deref().Val == 0) { DBG('no out-params returned'); return {}; }   // method returned no out-params
        outParams.funcs = COM.marshalFunctions(outParams.Deref(), ResultFunctions);
        // Single result object: read its property names directly (no need for NameCache's per-class caching / __CLASS read)
        var propNames = getAllNames(outParams, false);
        var propNameVars = [];
        for (var pi = 0; pi < propNames.length; ++pi) { propNameVars.push(GM.CreateVariable(propNames[pi], { wide: true })); }
        var out = enumerateProperties(outParams, propNames, propNameVars);
        DBG('out=' + JSON.stringify(out) + '\r\n');
        return out;
    } finally {
        // Release only the per-call COM objects. services/locator are owned by the caller (wrapper or session).
        // inSig is released here only when NOT cached - a cached signature is owned by the session and freed in release().
        outParams = releaseCOM(outParams, true);
        callRes = releaseCOM(callRes, true);
        inInst = releaseCOM(inInst, true);
        if (!inSigCached) { inSig = releaseCOM(inSig, true); }
        classObj = releaseCOM(classObj, true);
    }
}

module.exports = { query: query, queryAsync: queryAsync, execMethod: execMethod, connect: wmiConnect };