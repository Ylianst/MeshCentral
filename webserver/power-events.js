/**
* @description Device power event helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasDatabaseFailure = function (error, documents) {
    return (error != null) || !Array.isArray(documents);
};

module.exports.createPowerEventsHandler = function (options) {
    const state = options.state;
    const checkUserIpAddress = options.checkUserIpAddress;
    const setContentDispositionHeader = options.setContentDispositionHeader;

    return function handleDevicePowerEvents(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (req.query.id == null) || (typeof req.query.id != 'string')) { res.sendStatus(401); return; }
        var x = req.query.id.split('/');
        var user = state.users[req.session.userid];
        if ((x.length != 3) || (x[0] != 'node') || (x[1] != domain.id) || (user == null) || (user.links == null)) { res.sendStatus(401); return; }

        state.db.Get(req.query.id, function (err, docs) {
            if (module.exports.hasDatabaseFailure(err, docs)) {
                res.sendStatus(500);
            } else if (docs.length != 1) {
                res.sendStatus(401);
            } else {
                var node = docs[0];
                if (state.GetNodeRights(user, node.meshid, node._id) == 0) { res.sendStatus(401); return; }

                var localTimeOffset = 0;
                var timeConversionSystem = 0;
                if ((req.query.l != null) && (req.query.tz != null)) {
                    timeConversionSystem = 1;
                } else if (req.query.tf != null) {
                    timeConversionSystem = 2;
                    localTimeOffset = parseInt(req.query.tf);
                    if (isNaN(localTimeOffset)) { localTimeOffset = 0; }
                }

                setContentDispositionHeader(res, 'application/octet-stream', 'powerevents.csv', null, 'powerevents.csv');
                state.db.getPowerTimeline(node._id, function (err, docs) {
                    if (module.exports.hasDatabaseFailure(err, docs)) { res.sendStatus(500); return; }
                    var xevents = ['UTC Time, Local Time, State, Previous State'], prevState = 0;
                    for (var i in docs) {
                        if (docs[i].power != prevState) {
                            var timedoc = docs[i].time;
                            if (typeof timedoc == 'string') { timedoc = new Date(timedoc); }
                            prevState = docs[i].power;
                            var localTime = '';
                            if (timeConversionSystem == 1) {
                                localTime = new Date(timedoc.getTime()).toLocaleString(req.query.l, { timeZone: req.query.tz });
                            } else if (timeConversionSystem == 2) {
                                localTime = new Date(timedoc.getTime() + (localTimeOffset * 60000)).toISOString();
                                localTime = localTime.substring(0, localTime.length - 1);
                            }
                            if (docs[i].oldPower != null) {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power + ',' + docs[i].oldPower);
                            } else {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power);
                            }
                        }
                    }
                    res.send(xevents.join('\r\n'));
                });
            }
        });
    };
};
