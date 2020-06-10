/*
 * Copyright (c) 2015 Sylvain Peyrefitte
 *
 * This file is part of mstsc.js.
 *
 * mstsc.j is free software: you can redistribute it and/or modify
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

(function() {

	/**
	 * Use for domain declaration
	 */
	Mstsc = function () {
	}
	
	Mstsc.prototype = {
		// shortcut
		$ : function (id) {
			return document.getElementById(id);
		},
		
		/**
		 * Compute screen offset for a target element
		 * @param el {DOM element}
		 * @return {top : {integer}, left {integer}}
		 */
		elementOffset : function (el) {
		    var x = 0;
		    var y = 0;
		    while (el && !isNaN( el.offsetLeft ) && !isNaN( el.offsetTop )) {
		        x += el.offsetLeft - el.scrollLeft;
		        y += el.offsetTop - el.scrollTop;
		        el = el.offsetParent;
		    }
		    return { top: y, left: x };
		},
		
		/**
		 * Try to detect browser
		 * @returns {String} [firefox|chrome|ie]
		 */
		browser : function () {
			if (typeof InstallTrigger !== 'undefined') {
				return 'firefox';
			}
			
			if (!!window.chrome) {
				return 'chrome';
			}
			
			if (!!document.docuemntMode) {
				return 'ie';
			}
			
			return null;
		},
		
		/**
		 * Try to detect language
		 * @returns
		 */
		locale : function () {
			return window.navigator.userLanguage || window.navigator.language;
		}
	}
	
})();

this.Mstsc = new Mstsc();