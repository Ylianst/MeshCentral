/**
* @description Agent invitation code and download-page handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createAgentInvitations = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const getDomain = options.getDomain;
    const nice404 = options.nice404;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;

    function handleInviteRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleInviteRequest: failed checks.'); res.sendStatus(404); return; }
        if (domain.agentinvitecodes != true) { nice404(req, res); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if ((req.body == null) || (req.body.inviteCode == null) || (req.body.inviteCode == '')) { render(req, res, getRenderPage('invite', req, domain), getRenderArgs({ messageid: 0 }, req, domain)); return; }

        for (var meshId in state.meshes) {
            const mesh = state.meshes[meshId];
            if ((mesh.domain == domain.id) && (mesh.deleted == null) && (mesh.invite != null) && (mesh.invite.codes.indexOf(req.body.inviteCode) >= 0)) {
                res.redirect(domain.url + 'agentinvite?c=' + parent.encodeCookie({ a: 4, mid: meshId, f: mesh.invite.flags, ag: mesh.invite.ag, expire: 1 }, parent.invitationLinkEncryptionKey) + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + (req.query.hide ? ('&hide=' + encodeURIComponent(req.query.hide)) : ''));
                return;
            }
        }

        render(req, res, getRenderPage('invite', req, domain), getRenderArgs({ messageid: 100 }, req, domain));
    }

    function renderAgentInvite(req, res, domain, mesh, installFlags, showAgents) {
        var agentServerName = state.getWebServerName(domain, req);
        if (typeof state.args.agentaliasdns == 'string') { agentServerName = state.args.agentaliasdns; }
        const domainPath = (domain.dns == null) ? domain.id : '';
        var agentHttpsPort = ((state.args.aliasport == null) ? state.args.port : state.args.aliasport);
        if (state.args.agentport != null) { agentHttpsPort = state.args.agentport; }
        if (state.args.agentaliasport != null) { agentHttpsPort = state.args.agentaliasport; }
        const mobileAgentUrl = 'mc://' + agentServerName + ((agentHttpsPort != 443) ? (':' + agentHttpsPort) : '') + ((domainPath != '') ? ('/' + domainPath) : '') + ',' + state.agentCertificateHashBase64 + ',' + mesh._id.split('/')[2];
        const meshCookie = parent.encodeCookie({ m: mesh._id.split('/')[2] }, parent.invitationLinkEncryptionKey);
        render(req, res, getRenderPage('agentinvite', req, domain), getRenderArgs({ meshid: meshCookie, serverport: ((args.aliasport != null) ? args.aliasport : args.port), serverhttps: 1, servernoproxy: ((domain.agentnoproxy === true) ? '1' : '0'), meshname: encodeURIComponent(mesh.name).replace(/'/g, '%27'), installflags: installFlags, showagents: showAgents, magenturl: mobileAgentUrl, assistanttype: (domain.assistanttypeagentinvite ? domain.assistanttypeagentinvite : 0) }, req, domain));
    }

    function handleAgentInviteRequest(req, res) {
        const domain = getDomain(req);
        if ((domain == null) || ((req.query.m == null) && (req.query.c == null))) { parent.debug('web', 'handleAgentInviteRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }

        if (req.query.c != null) {
            const cookie = parent.decodeCookie(req.query.c, parent.invitationLinkEncryptionKey);
            if (cookie == null) { res.sendStatus(404); return; }
            const mesh = state.meshes[cookie.mid];
            if (mesh == null) { res.sendStatus(404); return; }
            var installFlags = cookie.f;
            if (typeof installFlags != 'number') { installFlags = 0; }
            var showAgents = cookie.ag;
            if (typeof showAgents != 'number') { showAgents = 0; }
            parent.debug('web', 'handleAgentInviteRequest using cookie.');
            renderAgentInvite(req, res, domain, mesh, installFlags, showAgents);
        } else if (req.query.m != null) {
            const mesh = state.meshes['mesh/' + domain.id + '/' + req.query.m.toLowerCase()];
            if (mesh == null) { res.sendStatus(404); return; }
            var installFlags = 0;
            if (req.query.f) { installFlags = parseInt(req.query.f); }
            if (typeof installFlags != 'number') { installFlags = 0; }
            var showAgents = 0;
            if (req.query.ag) { showAgents = parseInt(req.query.ag); }
            if (typeof showAgents != 'number') { showAgents = 0; }
            parent.debug('web', 'handleAgentInviteRequest using meshid.');
            renderAgentInvite(req, res, domain, mesh, installFlags, showAgents);
        }
    }

    return { handleInviteRequest: handleInviteRequest, handleAgentInviteRequest: handleAgentInviteRequest };
};
