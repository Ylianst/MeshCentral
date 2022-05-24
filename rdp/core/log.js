/*
 * Copyright (c) 2014-2015 Sylvain Peyrefitte
 *
 * This file is part of node-rdpjs.
 *
 * node-rdpjs is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

var Levels = {
    'DEBUG': 1,
    'INFO': 2,
    'WARN': 3,
    'ERROR': 4,
    'NONE': 5
}

/*
var Logger = require('bunyan');

let logStreams = [];

if (process.env.enable_log_file === 'true') {
	logStreams.push(
		{
			type: 'rotating-file',
			period: '1d',
			count: 2,
			path: `node-rdpjs${process.pid}.log`,
			level: process.env.log_level
		}
	);
}

logStreams.push(
	{
		stream: process.stderr,
		level: process.env.log_level
	}
);

var logger = Logger.createLogger({
	name: 'node-rdpjs',
	streams: logStreams
});
*/

function log(level, message) {
	if (Levels[level] < module.exports.level) return;
	console.log("[node-rdpjs] " + level + ":\t" + message);
}

/**
 * Module exports
 */
module.exports = {
    level: Levels.INFO, // Levels.INFO,
	Levels: Levels,
    debug: function (message) {
        //console.log(message);
	    //logger.debug(message);
	},
    info: function (message) {
        //console.log(message);
	    //logger.info(message);
	},
    warn: function (message) {
        //console.log(message);
	    //logger.warn(message);
	},
    error: function (message) {
        //console.log(message);
	    //logger.error(message);
	}
};
