/*
Copyright 2018 Intel Corporation

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

var KEY_QUERY_VALUE = 0x0001;
var KEY_ENUMERATE_SUB_KEYS = 0x0008;
var KEY_WRITE = 0x20006;

var KEY_DATA_TYPES =
    {
        REG_NONE: 0,
        REG_SZ: 1,
        REG_EXPAND_SZ: 2,
        REG_BINARY: 3,
        REG_DWORD: 4,
        REG_DWORD_BIG_ENDIAN: 5,
        REG_LINK: 6,
        REG_MULTI_SZ: 7,
        REG_RESOURCE_LIST: 8,
        REG_FULL_RESOURCE_DESCRIPTOR: 9,
        REG_RESOURCE_REQUIREMENTS_LIST: 10,
        REG_QWORD: 11
    };

function windows_registry()
{
    this._ObjectId = 'win-registry';
    this._marshal = require('_GenericMarshal');
    this._AdvApi = this._marshal.CreateNativeProxy('Advapi32.dll');
    this._AdvApi.CreateMethod('RegCreateKeyExA');
    this._AdvApi.CreateMethod('RegEnumKeyExA');
    this._AdvApi.CreateMethod('RegEnumValueA');
    this._AdvApi.CreateMethod('RegOpenKeyExA');
    this._AdvApi.CreateMethod('RegQueryInfoKeyA');
    this._AdvApi.CreateMethod('RegQueryValueExA');
    this._AdvApi.CreateMethod('RegCloseKey');
    this._AdvApi.CreateMethod('RegDeleteKeyA');
    this._AdvApi.CreateMethod('RegDeleteValueA');
    this._AdvApi.CreateMethod('RegSetValueExA');
    this.HKEY = { Root: Buffer.from('80000000', 'hex').swap32(), CurrentUser: Buffer.from('80000001', 'hex').swap32(), LocalMachine: Buffer.from('80000002', 'hex').swap32(), Users: Buffer.from('80000003', 'hex').swap32() };

    this.QueryKey = function QueryKey(hkey, path, key)
    {
        var err;
        var h = this._marshal.CreatePointer();
        var len = this._marshal.CreateVariable(4);
        var valType = this._marshal.CreateVariable(4);
        var HK = this._marshal.CreatePointer(hkey);
        var retVal = null;
        if (key) { key = this._marshal.CreateVariable(key); }
        if (!path) { path = ''; }


        if ((err = this._AdvApi.RegOpenKeyExA(HK, this._marshal.CreateVariable(path), 0, KEY_QUERY_VALUE | KEY_ENUMERATE_SUB_KEYS, h).Val) != 0)
        {
            throw ('Opening Registry Key: ' + path + ' => Returned Error: ' + err);
        }
  
        if ((path == '' && !key) || !key)
        {
            var result = { subkeys: [], values: [] };

            // Enumerate  keys
            var achClass = this._marshal.CreateVariable(1024);
            var achKey = this._marshal.CreateVariable(1024);
            var achValue = this._marshal.CreateVariable(32768);
            var achValueSize = this._marshal.CreateVariable(4);
            var nameSize = this._marshal.CreateVariable(4); 
            var achClassSize = this._marshal.CreateVariable(4); achClassSize.toBuffer().writeUInt32LE(1024);
            var numSubKeys = this._marshal.CreateVariable(4);
            var numValues = this._marshal.CreateVariable(4);
            var longestSubkeySize = this._marshal.CreateVariable(4);
            var longestClassString = this._marshal.CreateVariable(4);
            var longestValueName = this._marshal.CreateVariable(4);
            var longestValueData = this._marshal.CreateVariable(4);
            var securityDescriptor = this._marshal.CreateVariable(4);
            var lastWriteTime = this._marshal.CreateVariable(8);

            retVal = this._AdvApi.RegQueryInfoKeyA(h.Deref(), achClass, achClassSize, 0,
                numSubKeys, longestSubkeySize, longestClassString, numValues,
                longestValueName, longestValueData, securityDescriptor, lastWriteTime);
            if (retVal.Val != 0) { throw ('RegQueryInfoKeyA() returned error: ' + retVal.Val); }
            for(var i = 0; i < numSubKeys.toBuffer().readUInt32LE(); ++i)
            {
                nameSize.toBuffer().writeUInt32LE(1024);
                retVal = this._AdvApi.RegEnumKeyExA(h.Deref(), i, achKey, nameSize, 0, 0, 0, lastWriteTime);
                if(retVal.Val == 0)
                {
                    result.subkeys.push(achKey.String);
                }
            }
            for (var i = 0; i < numValues.toBuffer().readUInt32LE() ; ++i)
            {
                achValueSize.toBuffer().writeUInt32LE(32768);
                if(this._AdvApi.RegEnumValueA(h.Deref(), i, achValue, achValueSize, 0, 0, 0, 0).Val == 0)
                {
                    result.values.push(achValue.String);
                }
            }
            return (result);
        }

        if(this._AdvApi.RegQueryValueExA(h.Deref(), key, 0, 0, 0, len).Val == 0)
        {
            var data = this._marshal.CreateVariable(len.toBuffer().readUInt32LE());
            if (this._AdvApi.RegQueryValueExA(h.Deref(), key, 0, valType, data, len).Val == 0)
            {
                switch(valType.toBuffer().readUInt32LE())
                {
                    case KEY_DATA_TYPES.REG_DWORD:
                        retVal = data.toBuffer().readUInt32LE();
                        break;
                    case KEY_DATA_TYPES.REG_DWORD_BIG_ENDIAN:
                        retVal = data.toBuffer().readUInt32BE();
                        break;
                    case KEY_DATA_TYPES.REG_SZ:
                        retVal = data.String;
                        break;
                    case KEY_DATA_TYPES.REG_BINARY:
                    default:
                        retVal = data.toBuffer();
                        retVal._data = data;
                        break;
                }
            }
        }
        else
        {
            this._AdvApi.RegCloseKey(h.Deref());
            throw ('Not Found');
        }
        this._AdvApi.RegCloseKey(h.Deref());
        return (retVal);
    };
    this.WriteKey = function WriteKey(hkey, path, key, value)
    {
        var result;
        var h = this._marshal.CreatePointer();

        if (this._AdvApi.RegCreateKeyExA(this._marshal.CreatePointer(hkey), this._marshal.CreateVariable(path), 0, 0, 0, KEY_WRITE, 0, h, 0).Val != 0)
        {
            throw ('Error Opening Registry Key: ' + path);
        }

        var data;
        var dataType;

        switch(typeof(value))
        {
            case 'boolean':
                dataType = KEY_DATA_TYPES.REG_DWORD;
                data = this._marshal.CreateVariable(4);
                data.toBuffer().writeUInt32LE(value ? 1 : 0);
                break;
            case 'number':
                dataType = KEY_DATA_TYPES.REG_DWORD;
                data = this._marshal.CreateVariable(4);
                data.toBuffer().writeUInt32LE(value);
                break;
            case 'string':
                dataType = KEY_DATA_TYPES.REG_SZ;
                data = this._marshal.CreateVariable(value);
                break;
            default:
                dataType = KEY_DATA_TYPES.REG_BINARY;
                data = this._marshal.CreateVariable(value.length);
                value.copy(data.toBuffer());
                break;
        }

        if(this._AdvApi.RegSetValueExA(h.Deref(), this._marshal.CreateVariable(key), 0, dataType, data, data._size).Val != 0)
        {           
            this._AdvApi.RegCloseKey(h.Deref());
            throw ('Error writing reg key: ' + key);
        }
        this._AdvApi.RegCloseKey(h.Deref());
    };
    this.DeleteKey = function DeleteKey(hkey, path, key)
    {
        if(!key)
        {
            if(this._AdvApi.RegDeleteKeyA(this._marshal.CreatePointer(hkey), this._marshal.CreateVariable(path)).Val != 0)
            {
                throw ('Error Deleting Key: ' + path);
            }
        }
        else
        {
            var h = this._marshal.CreatePointer();
            var result;
            if (this._AdvApi.RegOpenKeyExA(this._marshal.CreatePointer(hkey), this._marshal.CreateVariable(path), 0, KEY_QUERY_VALUE | KEY_WRITE, h).Val != 0)
            {
                throw ('Error Opening Registry Key: ' + path);
            }
            if ((result = this._AdvApi.RegDeleteValueA(h.Deref(), this._marshal.CreateVariable(key)).Val) != 0)
            {
                this._AdvApi.RegCloseKey(h.Deref());
                throw ('Error[' + result + '] Deleting Key: ' + path + '.' + key);
            }
            this._AdvApi.RegCloseKey(h.Deref());
        }
    };
}

module.exports = new windows_registry();

