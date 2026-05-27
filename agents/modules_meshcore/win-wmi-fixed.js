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
var sm = require('service-manager');
var COM = require('win-com');

const CLSID_WbemAdministrativeLocator = '{CB8555CC-9128-11D1-AD9B-00C04FD8FDFF}';
const IID_WbemLocator = '{dc12a687-737f-11cf-884d-00aa004b2e24}';
const WBEM_FLAG_BIDIRECTIONAL = 0;
const WBEM_INFINITE = -1;
const WBEM_FLAG_ALWAYS = 0;
const WBEM_S_NO_ERROR = 0;
const E_NOINTERFACE = 0x80004002;
var OleAut32 = GM.CreateNativeProxy('OleAut32.dll');
OleAut32.CreateMethod('SafeArrayAccessData');
OleAut32.CreateMethod('SafeArrayUnaccessData');

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

//
// Reference to IWbemObjectSink can be found at:
// https://learn.microsoft.com/en-us/windows/win32/wmisdk/iwbemobjectsink
//
const QueryAsyncHandler =
    [
        {
            cx: 10, parms: 3, name: 'QueryInterface', func: function (j, riid, ppv)
            {
                var ret = GM.CreateVariable(4);
                // console.log('QueryInterface', riid.Deref(0, 16).toBuffer().toString('hex'));
                switch (riid.Deref(0, 16).toBuffer().toString('hex'))
                {
                    case '0000000000000000C000000000000046': // IID_IUnknown
                    case '0178857C8173CF11884D00AA004B2E24': // IID_IWmiObjectSink
                        j.pointerBuffer().copy(ppv.Deref(0, GM.PointerSize).toBuffer());
                        ret.increment(0, true);
                        ++this.refcount;
                        //console.log('QueryInterface ' +  riid.Deref(0, 16).toBuffer().toString('hex') + ' refcount: ' + this.refcount);
                        break;
                    default:
                        ret.increment(E_NOINTERFACE, true);
                        //console.log(riid.Deref(0, 16).toBuffer().toString('hex'), 'returning E_NOINTERFACE');
                        break;
                }

                return ret;
            }
        },
        {
            cx: 11, parms: 1, name: 'AddRef', func: function ()
            {
                //console.log('AddRef: ' + this.refcount);
                return (GM.CreateVariable(4).increment(++this.refcount, true));
            }
        },
        {
            cx: 12, parms: 1, name: 'Release', func: function ()
            {
                //console.log('Release: ' + this.refcount);
                //--this.refcount;
                if (--this.refcount === 0) { destroy(this); }
                return GM.CreateVariable(4).increment(this.refcount >>> 0, true);
            }
        },
        {
            cx: 13, parms: 3, name: 'Indicate', func: function (j, count, arr)
            {
                //console.log('Indicate: ' + count.Val);
                if (!this.results) return GM.CreateVariable(4).increment(0, true);

                for (var i = 0; i < count.Val; ++i)
                {
                    j = arr.Deref((i * GM.PointerSize) + 0, GM.PointerSize);
                    this.results.push(enumerateProperties(j, this.fields));
                }

                return GM.CreateVariable(4).increment(0, true);
            }
        },
        {
            cx: 14, parms: 5, name: 'SetStatus', func: function (j, lFlags, hResult, strParam, pObjParam)
            {
                //console.log('SetStatus');
                if (hResult.Val == 0)
                {
                    this.p.resolve(this.results);
                }
                else
                {
                    this.p.reject(new Error('WMI async query error: 0x' + (hResult.Val >>> 0).toString(16)));
                }
                var self = this;
                setImmediate(function () {
                    // console.log('SetStatus refcount: ' + self.refcount);
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
        catch (e) { console.log('releaseCOM error: ' + (e && e.message ? e.message : e)); }
    }
    return null;
}

function enumerateProperties(j, fields)
{
    //
    // Reference to SafeArrayAccessData() can be found at:
    // https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearrayaccessdata
    //

    var nme, len, nn;
    var properties = [];
    var values = {};

    j.funcs = COM.marshalFunctions(j.Deref(), ResultFunctions);

    // First we need to enumerate the COM Array
    if (fields != null && Array.isArray(fields))
    {
        properties = fields;
    }
    else
    {
        nme = GM.CreatePointer();
        j.funcs.GetNames(j.Deref(), 0, WBEM_FLAG_ALWAYS, 0, nme);
        len = nme.Deref().Deref(GM.PointerSize == 8 ? 24 : 16, 4).toBuffer().readUInt32LE();
        nn = GM.CreatePointer();
        OleAut32.SafeArrayAccessData(nme.Deref(), nn);


        for (var i = 0; i < len; ++i)
        {
            var propName = nn.Deref().increment(i * GM.PointerSize).Deref().Wide2UTF8;
            if (propName.length === 0) { continue; }
            properties.push(propName);
        }
        OleAut32.SafeArrayUnaccessData(nme.Deref());
    }

    // Now we need to introspect the Array Fields
    for (var i = 0; i < properties.length; ++i)
    {
        var tmp1 = GM.CreateVariable(24);
        if (j.funcs.Get(j.Deref(), GM.CreateVariable(properties[i], { wide: true }), 0, tmp1, 0, 0).Val == 0)
        {
            //
            // Reference for IWbemClassObject::Get() can be found at:
            // https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemclassobject-get
            //

            var vartype = tmp1.toBuffer().readUInt16LE();
            var isArray = (vartype & 0x2000) != 0;  // VT_ARRAY flag
            var baseType = vartype & 0x0FFF;

            if (isArray)
            {
                // Handle array types (VT_ARRAY | base type)
                var safeArray = tmp1.Deref(8, GM.PointerSize).Deref();
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
                values[properties[i]] = arrayValues;
            }
            else
            {
                // Handle scalar types
                switch (vartype)
                {
                    case 0x0000:    // VT_EMPTY
                    case 0x0001:    // VT_NULL
                        values[properties[i]] = null;
                        break;
                    case 0x0002:    // VT_I2
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readInt16LE();
                        break;
                    case 0x0003:    // VT_I4
                    case 0x0016:    // VT_INT
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readInt32LE();
                        break;
                    case 0x000B:    // VT_BOOL
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readInt32LE() != 0;
                        break;
                    case 0x000E:    // VT_DECIMAL
                        break;
                    case 0x0010:    // VT_I1
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readInt8();
                        break;
                    case 0x0011:    // VT_UI1
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readUInt8();
                        break;
                    case 0x0012:    // VT_UI2
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readUInt16LE();
                        break;
                    case 0x0013:    // VT_UI4
                    case 0x0017:    // VT_UINT
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).toBuffer().readUInt32LE();
                        break;
                    //case 0x0014:    // VT_I8
                    //    break;
                    //case 0x0015:    // VT_UI8
                    //    break;
                    case 0x0008:    // VT_BSTR
                        values[properties[i]] = tmp1.Deref(8, GM.PointerSize).Deref().Wide2UTF8;
                        break;
                    default:
                        console.info1('VARTYPE: ' + vartype);
                        break;
                }
            }
        }
    }

    return (values);
}

function queryAsync(resourceString, queryString, fields)
{
    var queryStarted = false;
    try {
        var s = sm.manager.getService('winmgmt');
        if (!s.isRunning()) { throw new Error ('WMI service not running')};
        var p = new promise(promise.defaultInit);
        var resource = GM.CreateVariable(resourceString, { wide: true });
        var language = GM.CreateVariable("WQL", { wide: true });
        var query = GM.CreateVariable(queryString, { wide: true });

        // Setup the Async COM handler for QueryAsync() 
        var handlers = COM.marshalInterface(QueryAsyncHandler);
        handlers.refcount = 1;
        handlers.results = [];
        handlers.fields = fields;
        handlers.locator = COM.createInstance(COM.CLSIDFromString(CLSID_WbemAdministrativeLocator), COM.IID_IUnknown);
        handlers.locator.funcs = COM.marshalFunctions(handlers.locator, LocatorFunctions);

    handlers.services = require('_GenericMarshal').CreatePointer();

	// For easier debugging in case a certain WMI component is not available
	var hr = handlers.locator.funcs.ConnectToServer(handlers.locator, resource, 0, 0, 0, 0, 0, 0, handlers.services).Val;
	if (hr != 0) {
		var hex = (hr < 0 ? hr + 0x100000000 : hr).toString(16).toUpperCase();
		throw ('queryAsync: Error calling ConnectToServer: HRESULT=0x' + hex + ' resource=' + resourceString);
	}

        handlers.services.funcs = COM.marshalFunctions(handlers.services.Deref(), ServiceFunctions);
        handlers.p = p;
        // Make the COM call
        if (handlers.services.funcs.ExecQueryAsync(handlers.services.Deref(), language, query, WBEM_FLAG_BIDIRECTIONAL, 0, handlers).Val != 0) { throw new Error('Error in Query'); }
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
function query(resourceString, queryString, fields)
{
    try {
        var s = sm.manager.getService('winmgmt');
        if (!s.isRunning()) { throw new Error ('WMI service not running')};
        var resource = GM.CreateVariable(resourceString, { wide: true });
        var language = GM.CreateVariable("WQL", { wide: true });
        var query = GM.CreateVariable(queryString, { wide: true });
        var results = GM.CreatePointer();

    // Connect the locator connection for WMI
    var locator = require('win-com').createInstance(require('win-com').CLSIDFromString(CLSID_WbemAdministrativeLocator), require('win-com').IID_IUnknown);
    locator.funcs = require('win-com').marshalFunctions(locator, LocatorFunctions);
    var services = require('_GenericMarshal').CreatePointer();
    
	// For easier debugging in case a certain WMI component is not available
	var hr = locator.funcs.ConnectToServer(locator, resource, 0, 0, 0, 0, 0, 0, services).Val;
	if (hr != 0) {
		var hex = (hr < 0 ? hr + 0x100000000 : hr).toString(16).toUpperCase();
		throw ('query: Error calling ConnectToServer: HRESULT=0x' + hex + ' resource=' + resourceString);
	}

        // Execute the Query
        services.funcs = COM.marshalFunctions(services.Deref(), ServiceFunctions);
        if (services.funcs.ExecQuery(services.Deref(), language, query, WBEM_FLAG_BIDIRECTIONAL, 0, results).Val != 0) { throw new Error('Error in Query'); }

        results.funcs = COM.marshalFunctions(results.Deref(), ResultsFunctions);
        var returnedCount = GM.CreateVariable(8);
        var result = GM.CreatePointer();
        var ret = [];

        // Enumerate the results
        while (results.funcs.Next(results.Deref(), WBEM_INFINITE, 1, result, returnedCount).Val == 0)
        {
            ret.push(enumerateProperties(result, fields));
        }
    } catch (e) {
        console.log('win-wmi query error: ' + e.message);
        throw (e);
    } finally {
        results = releaseCOM(results, true);
        services = releaseCOM(services, true);
        locator = releaseCOM(locator, false);
    }
    return (ret);
}

module.exports = { query: query, queryAsync: queryAsync };
