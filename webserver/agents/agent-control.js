/**
* @description Authorized local mesh-agent disconnection and core management
* @license Apache-2.0
*/

'use strict';

module.exports.createAgentControl = function (options) {
    const state = options.state;
    const common = options.common;
    const crypto = options.crypto;
    const getMeshRights = options.getMeshRights;
    const agentConsoleRight = options.agentConsoleRight;

    function getAuthorizedAgent(user, domain, nodeId) {
        if (nodeId == null) return null;
        const parts = nodeId.split('/');
        if ((parts.length != 3) || (parts[1] != domain.id)) return null;
        const agent = state.wsagents[nodeId];
        if (agent == null) return null;
        if (((getMeshRights(user, agent.dbMeshKey) & agentConsoleRight) == 0) && (user.siteadmin != 0xFFFFFFFF)) return null;
        return agent;
    }

    function forceMeshAgentDisconnect(user, domain, nodeId, disconnectMode) {
        const agent = getAuthorizedAgent(user, domain, nodeId);
        if (agent != null) agent.close(disconnectMode);
    }

    function sendBuiltInCore(agent, coreType) {
        const architecture = ((agent.agentInfo != null) && (state.parent.meshAgentsArchitectureNumbers != null)) ? state.parent.meshAgentsArchitectureNumbers[agent.agentInfo.agentId] : null;
        const coreProperty = { 'default': 'core', 'recovery': 'rcore', 'tiny': 'tcore' }[coreType];
        const coreName = (architecture == null) ? null : architecture[coreProperty];
        const coreHash = (coreName == null) ? null : state.parent.defaultMeshCoresHash[coreName];
        const core = (coreName == null) ? null : state.parent.defaultMeshCores[coreName];

        agent.agentCoreCheck = (coreType == 'recovery') ? 1001 : ((coreType == 'tiny') ? 1011 : 0);
        if ((coreHash != null) && (core != null)) {
            agent.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + coreHash + core.toString('binary'));
        } else {
            agent.send(common.ShortToStr(11) + common.ShortToStr(0));
        }
    }

    function sendMeshAgentCore(user, domain, nodeId, coreType, coreData) {
        const agent = getAuthorizedAgent(user, domain, nodeId);
        if (agent == null) return;
        if (coreType == 'clear') {
            agent.agentCoreCheck = 1000;
            agent.send(common.ShortToStr(10) + common.ShortToStr(0));
        } else if (coreType == 'default') {
            sendBuiltInCore(agent, coreType);
        } else if (coreType == 'recovery') {
            sendBuiltInCore(agent, coreType);
        } else if (coreType == 'tiny') {
            sendBuiltInCore(agent, coreType);
        } else if (coreType == 'custom') {
            agent.agentCoreCheck = 1000;
            const buffer = Buffer.from(coreData, 'utf8');
            const hash = crypto.createHash('sha384').update(buffer).digest().toString('binary');
            agent.sendBinary(common.ShortToStr(10) + common.ShortToStr(0) + hash + buffer.toString('binary'));
        }
    }

    return { forceMeshAgentDisconnect: forceMeshAgentDisconnect, sendMeshAgentCore: sendMeshAgentCore };
};
