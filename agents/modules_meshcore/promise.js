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

var refTable = {};

function event_switcher_helper(desired_callee, target)
{
    this._ObjectID = 'event_switcher';
    this.func = function func()
    {
        var args = [];
        for(var i in arguments)
        {
            args.push(arguments[i]);
        }
        return (func.target.apply(func.desired, args));
    };
    this.func.desired = desired_callee;
    this.func.target = target;
    this.func.self = this;
}
function event_switcher(desired_callee, target)
{
    return (new event_switcher_helper(desired_callee, target));
}

function Promise(promiseFunc)
{
    this._ObjectID = 'promise';
    this.promise = this;
    this._internal = { _ObjectID: 'promise.internal', promise: this, func: promiseFunc, completed: false, errors: false, completedArgs: [] };
    require('events').EventEmitter.call(this._internal);
    this._internal.on('_eventHook', function (eventName, eventCallback)
    {
        //console.log('hook', eventName, 'errors/' + this.errors + ' completed/' + this.completed);
        var r = null;

        if (eventName == 'resolved' && !this.errors && this.completed)
        {
            r = eventCallback.apply(this, this.completedArgs);
            if(r!=null)
            {
                this.emit_returnValue('resolved', r);
            }
        }
        if (eventName == 'rejected' && this.errors && this.completed)
        {
            eventCallback.apply(this, this.completedArgs);
        }
        if (eventName == 'settled' && this.completed)
        {
            eventCallback.apply(this, []);
        }
    });
    this._internal.resolver = function _resolver()
    {
        _resolver._self.errors = false;
        _resolver._self.completed = true;
        _resolver._self.completedArgs = [];
        var args = ['resolved'];
        if (this.emit_returnValue && this.emit_returnValue('resolved') != null)
        {
            _resolver._self.completedArgs.push(this.emit_returnValue('resolved'));
            args.push(this.emit_returnValue('resolved'));
        }
        else
        {
            for (var a in arguments)
            {
                _resolver._self.completedArgs.push(arguments[a]);
                args.push(arguments[a]);
            }
        }
        _resolver._self.emit.apply(_resolver._self, args);
        _resolver._self.emit('settled');
    };
    this._internal.rejector = function _rejector()
    {
        _rejector._self.errors = true;
        _rejector._self.completed = true;
        _rejector._self.completedArgs = [];
        var args = ['rejected'];
        for (var a in arguments)
        {
            _rejector._self.completedArgs.push(arguments[a]);
            args.push(arguments[a]);
        }

        _rejector._self.emit.apply(_rejector._self, args);
        _rejector._self.emit('settled');
    };
    this.catch = function(func)
    {
        this._internal.once('rejected', event_switcher(this, func).func);
    }
    this.finally = function (func)
    {
        this._internal.once('settled', event_switcher(this, func).func);
    };
    this.then = function (resolved, rejected)
    {
        if (resolved) { this._internal.once('resolved', event_switcher(this, resolved).func); }
        if (rejected) { this._internal.once('rejected', event_switcher(this, rejected).func); }

        var retVal = new Promise(function (r, j) { });
        this._internal.once('resolved', retVal._internal.resolver);
        this._internal.once('rejected', retVal._internal.rejector);
        retVal.parentPromise = this;
        return (retVal);
    };

    this._internal.resolver._self = this._internal;
    this._internal.rejector._self = this._internal;;

    try
    {
        promiseFunc.call(this, this._internal.resolver, this._internal.rejector);
    }
    catch(e)
    {
        this._internal.errors = true;
        this._internal.completed = true;
        this._internal.completedArgs = [e];
        this._internal.emit('rejected', e);
        this._internal.emit('settled');
    }

    if(!this._internal.completed)
    {
        // Save reference of this object
        refTable[this._internal._hashCode()] = this._internal;
        this._internal.once('settled', function () { refTable[this._hashCode()] = null; });
    }
}

Promise.resolve = function resolve()
{
    var retVal = new Promise(function (r, j) { });
    var args = [];
    for (var i in arguments)
    {
        args.push(arguments[i]);
    }
    retVal._internal.resolver.apply(retVal._internal, args);
    return (retVal);
};
Promise.reject = function reject() {
    var retVal = new Promise(function (r, j) { });
    var args = [];
    for (var i in arguments) {
        args.push(arguments[i]);
    }
    retVal._internal.rejector.apply(retVal._internal, args);
    return (retVal);
};
Promise.all = function all(promiseList)
{
    var ret = new Promise(function (res, rej)
    {
        this.__rejector = rej;
        this.__resolver = res;
        this.__promiseList = promiseList;
        this.__done = false;
        this.__count = 0;
    });

    for (var i in promiseList)
    {
        promiseList[i].then(function ()
        {
            // Success
            if(++ret.__count == ret.__promiseList.length)
            {
                ret.__done = true;
                ret.__resolver(ret.__promiseList);
            }
        }, function (arg)
        {
            // Failure
            if(!ret.__done)
            {
                ret.__done = true;
                ret.__rejector(arg);
            }
        });
    }
    if (promiseList.length == 0)
    {
        ret.__resolver(promiseList);
    }
    return (ret);
};

module.exports = Promise;