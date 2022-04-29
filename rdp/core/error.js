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

var inherits = require('util').inherits;

/**
 * Fatal error stop program
 */
function FatalError(message, code) {
	Error.captureStackTrace(this);
	this.message = message || "";
	this.code = code || 'NODE_RDP_CORE_ERROR_NO_ERROR_CODE';
}

/**
 * inherit from error
 */
inherits(FatalError, Error);

/**
 * Protocol error (non fatal);
 */
function ProtocolError(code, message) {
	Error.captureStackTrace(this);
	this.code = code;
	this.message = message || "";
}

/**
 * inherit from error
 */
inherits(ProtocolError, Error);

/**
 * ImplementationError error (non fatal);
 */
function ImplementationError(code, message) {
	Error.captureStackTrace(this);
	this.code = code;
	this.message = message || "";
}

/**
 * inherit from error
 */
inherits(ImplementationError, Error);

/**
 * Module exports
 */
module.exports = {
		FatalError : FatalError,
		ProtocolError : ProtocolError,
		ImplementationError : ImplementationError
};