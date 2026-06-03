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
//
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
                        ret.increment(0, true);
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
                return (GM.CreateVariable(4).increment(++this.refcount, true));
            }
        },
        {
            cx: 12, parms: 1, name: 'Release', func: function ()
            {
                // console.log('Release: ' + this.refcount);
                if (--this.refcount === 0) { destroy(this); }
                return GM.CreateVariable(4).increment(this.refcount >>> 0, true);
            }
        },
        {
            cx: 13, parms: 3, name: 'Indicate', func: function (sink, count, arr)
            {
                // console.log('Indicate: ' + count.Val);
                if (!this.results) return GM.CreateVariable(4).increment(0, true);
                if (this.sessionid) {
                    this.progress += count.Val;
                    var now = Date.now();
                    if ((now - this.lastProg) > 2000) {     //max 1 msg/2s, otherwise it gets throttled and possibly lose the result msg
                        this.lastProg = now;
                        this.MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: ' + this.progress +  ' results', sessionid: this.sessionid }); }
                }
                for (var i = 0; i < count.Val; ++i)
                {
                    var wmiResultObj  = arr.Deref((i * GM.PointerSize) + 0, GM.PointerSize);
                    if (this.reqFields != null) {
                        this.results.push(enumerateProperties(wmiResultObj , this.reqFields, this.fixedNameVars));
                    } else {
                        var e = this.cache.forRow(wmiResultObj );
                        this.results.push(enumerateProperties(wmiResultObj , e.propNames, e.propNameVars));
                    }
                }
                return GM.CreateVariable(4).increment(0, true);
            }
        },
        {
            cx: 14, parms: 5, name: 'SetStatus', func: function (sink, lFlags, hResult, strParam, pObjParam)
            {
                // console.log('SetStatus ' + lFlags.Val);
                if (hResult.Val == 0)
                {
                    if (this.sessionid) {
                        this.MA.SendCommand({ action: 'msg', type: 'console', value: 'Querytotal: ' + this.results.length + ' results, time take: ' + (Date.now()-this.progStart)/1000 + ' seconds', sessionid: this.sessionid });
                    }
                    this.p.resolve(this.results);
                }
                else
                {
                    var e = new Error('WMI async query error: ' + (WBEM_ERRORS[hResult.Val>>>0] || 'unknown') + ' (0x' + (hResult.Val>>>0).toString(16) + ')');
                    if (this.results.length > 0) { e.results = this.results; }
                    this.p.reject(e);
                }
                var self = this;
                setImmediate(function () {
                    if (--self.refcount === 0) { destroy(self); }
                });
                return GM.CreateVariable(4).increment(0, true);
            }
        }
    ];

function destroy(h) {
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
    for (var i = 0; i < propNames.length; ++i)
    {
        var propVal = GM.CreateVariable(24);
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
                        case 0x000B:    // VT_BOOL
                            arrayValues.push(arrayData.Deref().Deref(k * 2, 2).toBuffer().readInt16LE() != 0);
                            break;
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
                        case 0x0008:    // VT_BSTR
                            arrayValues.push(arrayData.Deref().Deref(k * GM.PointerSize, GM.PointerSize).Deref().Wide2UTF8);
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
                    case 0x000B:    // VT_BOOL
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).toBuffer().readInt32LE() != 0;
                        break;
                    case 0x000E:    // VT_DECIMAL
                        break;
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
                    //case 0x0014:    // VT_I8
                    //    break;
                    //case 0x0015:    // VT_UI8
                    //    break;
                    case 0x0008:    // VT_BSTR
                        values[propNames[i]] = propVal.Deref(8, GM.PointerSize).Deref().Wide2UTF8;
                        break;
                    default:
                        console.info1('VARTYPE: ' + vartype);
                        break;
                }
            }
        }
        OleAut32.VariantClear(propVal);
    }

    return (values);
}


// (optional) includeSysProp, default=false. Include system properties (__CLASS, etc.)
// (optional) sessionid, default=null. Report progress back to the given sessionid.
function queryAsync(resourceString, queryString, fields, includeSysProp, sessionid)
{
    var queryStarted = false;
    try {
        //32-bit windows cannot do more than 1 async query at a time because of the hardcoded vtable for the cx pre-compiled __stdcall custom handlers in iLibDuktape_GenericMarshal.c
        if (GM.PointerSize == 4 && Object.keys(wmi_handlers).length != 0) {
            throw new Error('Another AsyncQuery is already running, only one AsyncQuery possible at a time on 32-bit Windows'); }
        var pq = prepareQuery(queryString, fields);
        queryString = pq.q;
        var reqFields = pq.f;
        var p = new promise(promise.defaultInit);
        var resource = GM.CreateVariable(resourceString, { wide: true });
        var language = GM.CreateVariable("WQL", { wide: true });
        var query = GM.CreateVariable(queryString, { wide: true });

        // Setup the Async COM handler for QueryAsync() 
        var handlers = COM.marshalInterface(QueryAsyncHandler);
        handlers.refcount = 1;
        handlers.results = [];
        handlers.reqFields = reqFields;
        if (reqFields != null && Array.isArray(reqFields)) {
            handlers.fixedNameVars = reqFields.map(function (f) { return GM.CreateVariable(f, { wide: true }); });
        } else {
            handlers.cache = new NameCache(includeSysProp);
        }
        if (sessionid) { handlers.sessionid = sessionid; handlers.progStart = Date.now(); handlers.progress = 0; handlers.lastProg = 0; handlers.MA = require('MeshAgent'); }
        handlers.locator = COM.createInstance(COM.CLSIDFromString(CLSID_WbemAdministrativeLocator), COM.IID_IUnknown);
        handlers.locator.funcs = COM.marshalFunctions(handlers.locator, LocatorFunctions);

        handlers.services = GM.CreatePointer();

        // For easier debugging in case a certain WMI component is not available
        var hr = handlers.locator.funcs.ConnectToServer(handlers.locator, resource, 0, 0, 0, 0, 0, 0, handlers.services).Val;
        if (hr != 0) {
            var hex = (hr < 0 ? hr + 0x100000000 : hr).toString(16).toUpperCase();
            throw ('queryAsync: Error calling ConnectToServer: HRESULT=0x' + hex + ' resource=' + resourceString);
        }

        handlers.services.funcs = COM.marshalFunctions(handlers.services.Deref(), ServiceFunctions);
        handlers.p = p;
        
        // Make the COM call
        if (handlers.services.funcs.ExecQueryAsync(handlers.services.Deref(), language, query, WBEM_FLAG_BIDIRECTIONAL, 0, handlers).Val != 0)  { throw new Error('Error in Query'); }
        queryStarted = true;
        // Hold a reference to the callback object
        wmi_handlers[handlers._hashCode()] = handlers;
    } catch (e) {
        console.log('win-wmi queryAsync error: ' + e.message);
        if (!queryStarted && handlers) {
            handlers.refcount = 0;
            destroy(handlers);
        }
        throw (e);    
    }
    return (p);
}

// (optional) includeSysProp, default=false. Include system properties (__CLASS, etc.)
// (optional) sessionid, default=null. Report progress back to the given sessionid.
function query(resourceString, queryString, fields, includeSysProp, sessionid)
{
    var ret = [];
    try {
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
        if (sessionid) { var MA = require('MeshAgent'), progress = 0, lastProg =  0, progStart = Date.now(); }
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

        results.funcs = COM.marshalFunctions(results.Deref(), ResultsFunctions);
        var returnedCount = GM.CreateVariable(8);
        var result = GM.CreatePointer();
        var nextRes;
        // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-ienumwbemclassobject-next
        var retries = 0, rowTimeout = 10*1000; // rowTimeout was WBEM_INFINITE. in ms. Prevents blocking.
        while (true) {
            nextRes = results.funcs.Next(results.Deref(), rowTimeout, 1, result, returnedCount).Val >>> 0;
            if (nextRes === WBEM_S_FALSE) break; // normal exit
            if (nextRes >= 0x80000000 ) { throw new Error('Next() failed: ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ')'); }
            if (nextRes !== WBEM_S_NO_ERROR) {
                if (++retries > 6) { throw new Error('Next() errored too many times: ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ')'); }
                if (sessionid) { MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: issue ' + (WBEM_ERRORS[nextRes] || 'unknown') + ' (0x' + nextRes.toString(16) + ') on row: ' + (progress+1), sessionid: sessionid }); }
                continue;
            }
            retries = 0;
            if (sessionid) {
                ++progress;
                var now = Date.now();
                if ((now - lastProg) > 2000) {  //max 1 msg/2s, otherwise it gets throttled and possibly lose the result msg
                    lastProg = now;
                    MA.SendCommand({ action: 'msg', type: 'console', value: 'Queryprogress: ' + progress +  ' results', sessionid: sessionid }); }
                }
            result.funcs = COM.marshalFunctions(result.Deref(), ResultFunctions);
            if (reqFields != null) {
                ret.push(enumerateProperties(result, reqFields, fixedNameVars));
            } else {
                var e = cache.forRow(result);
                ret.push(enumerateProperties(result, e.propNames, e.propNameVars));
            }
            result.funcs.Release(result.Deref());
        }
        if (sessionid) { MA.SendCommand({ action: 'msg', type: 'console', value: 'Querytotal: ' + ret.length +  ' results, time take: ' + (Date.now()-progStart)/1000 + ' seconds', sessionid: sessionid }); }
    } catch (e) {
        console.log('win-wmi query error: ' + e.message);
        if (ret.length > 0) {
            e.results = ret;
        }
        throw (e);
    } finally {
        results = releaseCOM(results, true);
        services = releaseCOM(services, true);
        locator = releaseCOM(locator, false);
    }
    // console.log(JSON.stringify(ret).substring(0,200));
    return (ret);
}

module.exports = { query: query, queryAsync: queryAsync };
