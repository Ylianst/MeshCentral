/**
* @description MeshCentral main module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// This module is only called when MeshCentral is running as a Windows service.
// In this case, we don't want to start a child process, so we launch directly without arguments.
require('./meshcentral.js').mainStart({ "launch": true });
