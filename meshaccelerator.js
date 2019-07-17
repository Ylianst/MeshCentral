/**
* @description MeshCentral accelerator
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

const crypto = require('crypto');
var certStore = null;

// When the parent process terminates, we exit also.
process.on('disconnect', function () { process.exit(); });

// Handle parent messages
process.on('message', function (message) {
    switch (message.action) {
        case 'sign': {
            if (typeof message.key == 'number') { message.key = certStore[message.key].key; }
            try {
                const sign = crypto.createSign('SHA384');
                sign.end(Buffer.from(message.data, 'binary'));
                process.send(sign.sign(message.key).toString('binary'));
            } catch (e) { process.send(null); }
            break;
        }
        case 'setState': {
            certStore = message.certs;
            break;
        }
        default: {
            console.log('Unknown accelerator action: ' + message.action + '.');
            break;
        }
    }
});