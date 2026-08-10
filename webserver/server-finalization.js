/**
* @description Web server route and listener finalization
* @license Apache-2.0
*/

'use strict';

module.exports.createServerFinalization = function (options) {
    return function finalizeWebserver() {
        options.setupHttpHandlers();
        if (options.args.nice404 !== false) { options.app.use(options.nice404); }
        options.checkListenPort(options.args.port, options.args.portbind, options.startWebServer);
        if (options.args.agentport) { options.checkListenPort(options.args.agentport, options.args.agentportbind, options.startAltWebServer); }
        if (options.done) { options.done(); }
    };
};
