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

var BigInteger = require('./jsbn');

/**
 * @param modulus {Buffer}
 * @param pubExp {integer}
 */
function publicKey(modulus, pubExp) {
	return {
		n : modulus,
		e : pubExp
	}
}

function encrypt(data, publicKey) {
	return new BigInteger(data).modPowInt(publicKey.e, new BigInteger(publicKey.n)).toBuffer();
}

/**
 * Module Export
 */
module.exports = {
	publicKey : publicKey,
	encrypt : encrypt
};