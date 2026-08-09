/**
* @description MeshCentral login and two-factor authentication throttling
* @license Apache-2.0
*/

"use strict";

module.exports.createThrottling = function (settings, ipcheck, now) {
    const api = {
        badLoginTable: {},
        badLoginTableLastClean: 0,
        bad2faTable: {},
        bad2faTableLastClean: 0
    };
    if (typeof now != 'function') { now = Date.now; }

    function normalizeConfig(name) {
        if (settings[name] === false) return;
        if (typeof settings[name] != 'object') { settings[name] = { time: 10, count: 10 }; }
        if (typeof settings[name].time != 'number') { settings[name].time = 10; }
        if (typeof settings[name].count != 'number') { settings[name].count = 10; }
        if ((typeof settings[name].coolofftime != 'number') || (settings[name].coolofftime < 1)) { settings[name].coolofftime = null; }
    }

    function isExcluded(ip, config) {
        if (config == null) return false;
        if (typeof config.exclude == 'string') {
            const excludeSplit = config.exclude.split(',');
            for (var i in excludeSplit) { if (ipcheck.match(ip, excludeSplit[i])) return true; }
        } else if (Array.isArray(config.exclude)) {
            for (var i in config.exclude) { if (ipcheck.match(ip, config.exclude[i])) return true; }
        }
        return false;
    }

    function normalizeIp(ip) {
        if (typeof ip == 'object') { ip = ip.clientIp; }
        var splitip = ip.split('.');
        if (splitip.length == 4) { ip = splitip[0] + '.' + splitip[1] + '.' + splitip[2] + '.*'; }
        return ip;
    }

    function record(ip, configName, tableName, counterName, cleanFunction) {
        if (settings[configName] === false) return;
        if (typeof ip == 'object') { ip = ip.clientIp; }
        if (isExcluded(ip, settings[configName])) return;
        ip = normalizeIp(ip);
        if (++api[counterName] > 100) { cleanFunction(); }
        if (typeof api[tableName][ip] == 'number') { if (api[tableName][ip] < now()) { delete api[tableName][ip]; } else { return; } }
        if (api[tableName][ip] == null) { api[tableName][ip] = [now()]; } else { api[tableName][ip].push(now()); }
        if ((api[tableName][ip].length >= settings[configName].count) && (settings[configName].coolofftime != null)) {
            api[tableName][ip] = now() + (settings[configName].coolofftime * 60000);
        }
    }

    function allow(ip, configName, tableName) {
        if (settings[configName] === false) return true;
        ip = normalizeIp(ip);
        var cutoffTime = now() - (settings[configName].time * 60000);
        var ipTable = api[tableName][ip];
        if (ipTable == null) return true;
        if (typeof ipTable == 'number') { if (api[tableName][ip] < now()) { delete api[tableName][ip]; } else { return false; } }
        while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
        if (ipTable.length == 0) { delete api[tableName][ip]; return true; }
        return (ipTable.length < settings[configName].count);
    }

    function clean(configName, tableName, counterName) {
        if (settings[configName] === false) return;
        var cutoffTime = now() - (settings[configName].time * 60000);
        for (var ip in api[tableName]) {
            var ipTable = api[tableName][ip];
            if (typeof ipTable == 'number') {
                if (api[tableName][ip] < now()) { delete api[tableName][ip]; }
            } else {
                while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
                if (ipTable.length == 0) { delete api[tableName][ip]; }
            }
        }
        api[counterName] = 0;
    }

    normalizeConfig('maxinvalidlogin');
    normalizeConfig('maxinvalid2fa');

    api.setbadLogin = function (ip) { record(ip, 'maxinvalidlogin', 'badLoginTable', 'badLoginTableLastClean', api.cleanBadLoginTable); };
    api.checkAllowLogin = function (ip) { return allow(ip, 'maxinvalidlogin', 'badLoginTable'); };
    api.cleanBadLoginTable = function () { clean('maxinvalidlogin', 'badLoginTable', 'badLoginTableLastClean'); };
    api.setbad2Fa = function (ip) { record(ip, 'maxinvalid2fa', 'bad2faTable', 'bad2faTableLastClean', api.cleanBad2faTable); };
    api.checkAllow2Fa = function (ip) { return allow(ip, 'maxinvalid2fa', 'bad2faTable'); };
    api.cleanBad2faTable = function () { clean('maxinvalid2fa', 'bad2faTable', 'bad2faTableLastClean'); };

    return api;
};
