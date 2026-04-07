'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MESH_DIR = process.env.MESH_DIR || '/opt/mesh';
const MESH_INSTALL_DIR = process.env.MESH_INSTALL_DIR || '/opt/meshcentral';
const MESH_USER = process.env.MESH_USER || '';
const MESH_PASS = process.env.MESH_PASS || '';
const MESH_PROTOCOL = process.env.MESH_PROTOCOL || 'wss';
const MESH_NGINX_HOST = process.env.MESH_NGINX_HOST || 'localhost';
const MESH_EXTERNAL_PORT = process.env.MESH_EXTERNAL_PORT || '8383';
const MESH_DEVICE_GROUP = process.env.MESH_DEVICE_GROUP || '';

const MESHCTRL_PATH = path.join(MESH_INSTALL_DIR, 'meshcentral', 'meshctrl.js');
const MESHCTRL_URL = `${MESH_PROTOCOL}://${MESH_NGINX_HOST}:${MESH_EXTERNAL_PORT}`;

function corsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-MeshAuth');
}

module.exports.openframe = function (pluginHandler) {
  const obj = {};
  obj.exports = [];

  // hook_setupHttpHandlers receives (webserver, parent) from callHook
  obj.hook_setupHttpHandlers = function (webserver, parent) {
    var app = webserver.app;
    var jsonParser = webserver.bodyParser.json();
    console.log('[openframe-plugin] Routes registered');

    // CORS preflight for all plugin routes
    app.options(['/generate-msh', '/api/*'], function (req, res) {
      corsHeaders(res);
      res.sendStatus(204);
    });

    // Route 1: /generate-msh?host=X
    app.get('/generate-msh', function (req, res) {
      corsHeaders(res);

      var host = req.query.host;
      if (!host) {
        return res.status(400).json({ error: 'Missing required parameter: host' });
      }

      var meshId, serverId;
      try {
        meshId = fs.readFileSync(path.join(MESH_DIR, 'mesh_id'), 'utf8').trim();
        serverId = fs.readFileSync(path.join(MESH_DIR, 'mesh_server_id'), 'utf8').trim();
      } catch (e) {
        return res.status(500).json({ error: 'Mesh configuration not initialized' });
      }

      if (!meshId || !serverId) {
        return res.status(500).json({ error: 'Invalid mesh configuration' });
      }

      // Determine protocol
      var protocol = 'wss';
      if (host.startsWith('http://')) { protocol = 'ws'; }
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

      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment; filename=meshagent.msh');
      res.send(mshContent);
    });


    // Route 2: GET /api/deviceInfo?id=node//domain//hash - Get device info by ID
    app.get('/api/deviceInfo', function (req, res) {
      corsHeaders(res);

      var deviceId = req.query.id;
      if (!deviceId) {
        return res.status(400).json({ error: 'Missing required parameter: id' });
      }

      var args = [
        MESHCTRL_PATH,
        '--url', MESHCTRL_URL,
        '--loginuser', MESH_USER,
        '--loginpass', MESH_PASS,
        'DeviceInfo',
        '--id', deviceId,
        '--json'
      ];

      if (req.query.raw === 'true') {
        args.push('--raw');
      }

      execFile('node', args, { timeout: 30000 }, function (err, stdout, stderr) {
        if (err) {
          return res.status(500).json({ error: stderr || stdout || err.message });
        }
        res.set('Content-Type', 'application/json');
        res.send(stdout);
      });
    });
  };

  return obj;
};
