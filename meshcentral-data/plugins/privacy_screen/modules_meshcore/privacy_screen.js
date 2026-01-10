(function () {
    var g = (typeof global !== 'undefined') ? global : this;

    if (!g.__privacy_screen_state) {
        g.__privacy_screen_state = { on: false, lastRc: 0, lastTs: 0 };
    }

    function normArgs(args) {
        if (args == null) return [];
        if (Array.isArray(args)) return args.map(String);
        if (typeof args === 'string') {
            var s = args.trim();
            return s ? s.split(/\s+/) : [];
        }
        if (typeof args === 'object') {
            if (Array.isArray(args.args)) return args.args.map(String);
            if (typeof args.args === 'string') return normArgs(args.args);
        }
        return [String(args)];
    }

    function rcToMsg(rc) {
        if (rc === 0) return 'OK';
        if (rc === -1) return 'NOT_SUPPORTED';
        if (rc === 2) return 'MUTEX_CREATE_FAILED';
        if (rc === 3) return 'MUTEX_TIMEOUT';
        return 'ERROR_' + rc;
    }

    function setPrivacy(on) {
        if (typeof BlankScreen_Enable !== 'function') {
            return 'ERROR: BlankScreen_Enable() is not available in meshcore JS';
        }

        var rc;
        try {
            rc = BlankScreen_Enable(!!on);
        } catch (e) {
            return 'ERROR: native exception: ' + String(e);
        }

        g.__privacy_screen_state.on = (rc === 0) ? !!on : g.__privacy_screen_state.on;
        g.__privacy_screen_state.lastRc = rc;
        g.__privacy_screen_state.lastTs = Date.now();

        return (rc === 0)
            ? ('PRIVACY_SCREEN=' + (on ? 'ON' : 'OFF') + ' (' + rcToMsg(rc) + ')')
            : ('FAILED ' + (on ? 'ON' : 'OFF') + ' (' + rcToMsg(rc) + ')');
    }

    function status() {
        var st = g.__privacy_screen_state;
        return 'PRIVACY_SCREEN=' + (st.on ? 'ON' : 'OFF') +
            ' lastRc=' + st.lastRc +
            ' lastTs=' + st.lastTs;
    }

    function handler(args) {
        var a = normArgs(args);
        var cmd = (a[0] || '').toLowerCase();

        if (cmd === 'on' || cmd === '1' || cmd === 'true') return setPrivacy(true);
        if (cmd === 'off' || cmd === '0' || cmd === 'false') return setPrivacy(false);
        if (cmd === 'status' || cmd === 'state') return status();

        return 'USAGE: plugin privacy_screen on|off|status';
    }

    module.exports = handler;
    module.exports.run = handler;
    module.exports.exec = handler;
    module.exports.status = status;
    module.exports.on = function () { return setPrivacy(true); };
    module.exports.off = function () { return setPrivacy(false); };
})();
