/**
* @description Intel AMT event request helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasDatabaseFailure = function (error, nodes) {
    return (error != null) || !Array.isArray(nodes);
};

module.exports.hasRandomBytesFailure = function (error, buffer) {
    return (error != null) || !Buffer.isBuffer(buffer);
};

module.exports.createAmtEventHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;

    return function handleAmtEventRequest(req, res) {
        const domain = getDomain(req);
        try {
            if (req.headers.authorization) {
                var authstr = req.headers.authorization;
                if (authstr.substring(0, 7) == 'Digest ') {
                    var auth = state.common.parseNameValueList(state.common.quoteSplit(authstr.substring(7)));
                    if ((req.url === auth.uri) && (state.httpAuthRealm === auth.realm) && (auth.opaque === state.crypto.createHmac('SHA384', state.httpAuthRandom).update(auth.nonce).digest('hex'))) {
                        var eventData = '';
                        req.on('data', function (chunk) { eventData += chunk; });
                        req.on('end', function () {
                            var i = eventData.indexOf('<m:arg xmlns:m="http://x.com">');
                            if (i > 0) {
                                var nodeid = eventData.substring(i + 30, i + 30 + 64);
                                if (nodeid.length == 64) {
                                    var nodekey = 'node/' + domain.id + '/' + nodeid;
                                    state.db.Get(nodekey, function (err, nodes) {
                                        if (!module.exports.hasDatabaseFailure(err, nodes) && (nodes.length == 1)) {
                                            var node = nodes[0];
                                            var amtpass = state.crypto.createHash('sha384').update(auth.username.toLowerCase() + ':' + nodeid + ':' + parent.dbconfig.amtWsEventSecret).digest('base64').substring(0, 12).split('/').join('x').split('\\').join('x');
                                            if (auth.response === state.common.ComputeDigesthash(auth.username, amtpass, auth.realm, 'POST', auth.uri, auth.qop, auth.nonce, auth.nc, auth.cnonce)) {
                                                var amthost = req.clientIp;
                                                if (amthost.substring(0, 7) === '::ffff:') { amthost = amthost.substring(7); }
                                                if (node.host != amthost) {
                                                    var mesh = state.meshes[node.meshid];
                                                    if (mesh) {
                                                        var oldname = node.host;
                                                        node.host = amthost;
                                                        state.db.Set(state.cleanDevice(node));
                                                        var event = { etype: 'node', action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Intel(R) AMT host change ' + node.name + ' from group ' + mesh.name + ': ' + oldname + ' to ' + amthost };
                                                        event.node = node;
                                                        if (event.node.intelamt && event.node.intelamt.pass) {
                                                            event.node = Object.assign({}, event.node);
                                                            event.node.intelamt = Object.assign({}, event.node.intelamt);
                                                            delete event.node.intelamt.pass;
                                                        }
                                                        if (state.db.changeStream) { event.noact = 1; }
                                                        parent.DispatchEvent(['*', node.meshid], state, event);
                                                    }
                                                }
                                                if (parent.amtEventHandler) { parent.amtEventHandler.handleAmtEvent(eventData, nodeid, amthost); }
                                                return;
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            }
        } catch (e) { console.log(e); }

        state.crypto.randomBytes(48, function (err, buf) {
            if (module.exports.hasRandomBytesFailure(err, buf)) { res.sendStatus(500); return; }
            var nonce = buf.toString('hex'), opaque = state.crypto.createHmac('SHA384', state.httpAuthRandom).update(nonce).digest('hex');
            res.set({ 'WWW-Authenticate': 'Digest realm="' + state.httpAuthRealm + '", qop="auth,auth-int", nonce="' + nonce + '", opaque="' + opaque + '"' });
            res.sendStatus(401);
        });
    };
};
