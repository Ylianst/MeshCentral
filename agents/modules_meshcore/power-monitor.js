/*
Copyright 2018-2020 Intel Corporation

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

function powerMonitor()
{
    this._ObjectID = 'power-monitor';
    require('events').EventEmitter.call(this, true)
        .createEvent('changed')
        .createEvent('sx')
        .createEvent('batteryLevel')
        .createEvent('acdc')
        .createEvent('display');

    this._i = setImmediate(function (self)
    {
        require('user-sessions'); // This is needed because this is where the Windows Messages are processed for these events
        delete self._i;
    }, this);
}

module.exports = new powerMonitor();