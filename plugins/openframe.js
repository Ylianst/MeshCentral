'use strict';

const fs = require('fs');
const path = require('path');

const MESH_DIR = process.env.MESH_DIR || '/opt/mesh';
const MESH_DEVICE_GROUP = process.env.MESH_DEVICE_GROUP || '';

// --- Helpers ---

function corsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-MeshAuth');
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function log(msg) {
  console.log('[openframe-plugin] ' + msg);
}

// --- Plugin ---

module.exports.openframe = function (pluginHandler) {
  var obj = {};
  obj.exports = [];

  obj.hook_setupHttpHandlers = function (webserver, parent) {
    var app = webserver.app;
    var db = parent.db;

    log('Routes registered');

    // CORS preflight
    app.options(['/generate-msh', '/api/*'], function (req, res) {
      corsHeaders(res);
      res.sendStatus(204);
    });

    // Route 1: GET /generate-msh?host=X - Generate custom MSH agent config
    app.get('/generate-msh', function (req, res) {
      corsHeaders(res);

      var host = req.query.host;
      if (!host) return sendError(res, 400, 'Missing required parameter: host');

      var meshId, serverId;
      try {
        meshId = fs.readFileSync(path.join(MESH_DIR, 'mesh_id'), 'utf8').trim();
        serverId = fs.readFileSync(path.join(MESH_DIR, 'mesh_server_id'), 'utf8').trim();
      } catch (e) {
        return sendError(res, 500, 'Mesh configuration not initialized');
      }

      if (!meshId || !serverId) return sendError(res, 500, 'Invalid mesh configuration');

      var protocol = host.startsWith('http://') ? 'ws' : 'wss';
      var cleanHost = host.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      var meshServerUrl = protocol + '://' + cleanHost + '/ws/tools/agent/meshcentral-server/agent.ashx';

      var mshContent = [
        'MeshName=' + MESH_DEVICE_GROUP,
        'MeshType=2',
        'MeshID=' + meshId,
        'ignoreProxyFile=1',
        'ServerID=' + serverId,
        'MeshServer=' + meshServerUrl
      ].join('\n');

      log('Generated MSH for host: ' + cleanHost);

      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment; filename=meshagent.msh');
      res.send(mshContent);
    });

    // Route 2: GET /api/deviceStatus?id=node/<domain>/<hash> - Get device status
    // Uses MeshCentral core: GetConnectivityState() (in-memory) + db 'lc' record
    app.get('/api/deviceStatus', function (req, res) {
      corsHeaders(res);

      var nodeId = req.query.id;
      if (!nodeId) return sendError(res, 400, 'Missing required parameter: id');

      var parts = nodeId.split('/');
      if (parts.length !== 3 || parts[0] !== 'node') {
        return sendError(res, 400, 'Invalid device id format. Expected: node/<domain>/<id>');
      }

      // 1. Live connectivity state from MeshCentral in-memory store
      var state = parent.GetConnectivityState(nodeId);
      var online = (state != null) && ((state.connectivity & 1) !== 0);

      // 2. Last connection record from DB
      db.Get('lc' + nodeId, function (err, docs) {
        var lc = (docs != null && docs.length === 1) ? docs[0] : null;

        res.json({
          nodeId: nodeId,
          online: online,
          lastConnectTime: lc ? lc.time : null,
          lastConnectAddr: lc ? lc.addr : null
        });
      });
    });
  };

  return obj;
};
