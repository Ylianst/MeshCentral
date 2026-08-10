/**
* @description macOS MeshAgent installer download helpers
* @license Apache-2.0
*/

'use strict';

module.exports.handleArchiveError = function (parent, response, error) {
    parent.debug('web', 'Failed to archive macOS MeshAgent package: ' + error);
    if (!response.headersSent) {
        try { response.sendStatus(500); } catch (ex) { }
    } else if (typeof response.destroy == 'function') {
        try { response.destroy(error); } catch (ex) { }
    } else {
        try { response.end(); } catch (ex) { }
    }
};
