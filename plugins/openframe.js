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

// --- DB Layer ---

/**
 * Fetch all device data from DB in parallel (node, sysinfo, network, lastconnect).
 * @param {object} db - MeshCentral database interface (parent.db)
 * @param {string} nodeId - Device ID in format node/<domain>/<hash>
 * @param {function} callback - callback(err, { node, sysinfo, network, lastconnect })
 */
function fetchDeviceInfo(db, nodeId, callback) {
  var pending = 4;
  var result = { node: null, sysinfo: null, network: null, lastconnect: null };

  function done() {
    if (--pending > 0) return;
    callback(null, result);
  }

  db.Get(nodeId, function (err, docs) {
    if (docs != null && docs.length === 1) { result.node = docs[0]; }
    done();
  });

  db.Get('si' + nodeId, function (err, docs) {
    if (docs != null && docs.length === 1) { result.sysinfo = docs[0]; }
    done();
  });

  db.Get('if' + nodeId, function (err, docs) {
    if (docs != null && docs.length === 1) { result.network = docs[0]; }
    done();
  });

  db.Get('lc' + nodeId, function (err, docs) {
    if (docs != null && docs.length === 1) { result.lastconnect = docs[0]; }
    done();
  });
}

// --- Response Formatters ---

var AGENT_TYPES = [
  'Unknown', 'Windows 32bit console', 'Windows 64bit console',
  'Windows 32bit service', 'Windows 64bit service',
  'Linux 32bit', 'Linux 64bit', 'MIPS', 'XENx86',
  'Android', 'Linux ARM', 'macOS x86-32bit', 'Android x86',
  'PogoPlug ARM', 'Android', 'Linux Poky x86-32bit',
  'macOS x86-64bit', 'ChromeOS', 'Linux Poky x86-64bit',
  'Linux NoKVM x86-32bit', 'Linux NoKVM x86-64bit',
  'Windows MinCore console', 'Windows MinCore service',
  'NodeJS', 'ARM-Linaro', 'ARMv6l / ARMv7l', 'ARMv8 64bit',
  'ARMv6l / ARMv7l / NoKVM', 'MIPS24KC (OpenWRT)',
  'Apple Silicon', 'FreeBSD x86-64', 'Unknown',
  'Linux ARM 64 bit', 'Alpine Linux x86 64 Bit (MUSL)',
  'Assistant (Windows)'
];

function formatGeneral(node) {
  var out = {};
  if (node.name) out['Server Name'] = node.name;
  if (node.rname) out['Computer Name'] = node.rname;
  if (node.host != null) out['Hostname'] = node.host;
  if (node.ip != null) out['IP Address'] = node.ip;
  if (node.desc != null) out['Description'] = node.desc;
  if (node.icon != null) out['Icon'] = node.icon;
  if (node.tags) out['Tags'] = node.tags;
  return Object.keys(out).length > 0 ? out : null;
}

function formatOS(node, hardware) {
  var hasOsInfo = (hardware && hardware.windows && hardware.windows.osinfo);
  if (!hasOsInfo && !node.osdesc) return null;

  var out = {};
  if (node.rname) out['Name'] = node.rname;
  if (node.osdesc) out['Version'] = node.osdesc;
  if (hasOsInfo && hardware.windows.osinfo.OSArchitecture) {
    out['Architecture'] = hardware.windows.osinfo.OSArchitecture;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function formatAgent(node) {
  if (!node.agent) return null;

  var out = {};
  if (node.agent.id != null && node.agent.ver != null) {
    var str = (node.agent.id < AGENT_TYPES.length) ? AGENT_TYPES[node.agent.id] : AGENT_TYPES[0];
    if (node.agent.ver != 0) str += ' v' + node.agent.ver;
    out['Mesh Agent'] = str;
  }

  var connected = (node.conn & 1) != 0;
  out['Agent status'] = connected ? 'Connected now' : 'Offline';

  if (connected) {
    out['Last agent connection'] = 'Connected now';
  } else if (node.lastconnect) {
    out['Last agent connection'] = new Date(node.lastconnect).toISOString();
  }

  if (node.lastaddr) {
    var parts = node.lastaddr.split(':');
    out['Last agent address'] = (parts.length > 2) ? node.lastaddr : parts[0];
  }

  if (node.agent.tag != null) out['Tag'] = node.agent.tag;
  return Object.keys(out).length > 0 ? out : null;
}

function formatNetworking(network) {
  if (network == null || network.netif == null) return null;

  var out = {};
  for (var i in network.netif) {
    var m = network.netif[i], iface = {};
    if (m.desc) iface['Description'] = m.desc;
    if (m.mac) iface['MAC'] = m.mac;
    if (m.v4addr && m.v4addr != '0.0.0.0') {
      iface['IPv4'] = m.v4addr;
      if (m.v4mask) iface['Mask'] = m.v4mask;
      if (m.v4gateway) iface['Gateway'] = m.v4gateway;
    }
    if (Object.keys(iface).length > 0) {
      out[m.name + (m.dnssuffix ? (', ' + m.dnssuffix) : '')] = iface;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function formatHardware(hardware) {
  if (hardware == null || hardware.identifiers == null) return null;

  var ident = hardware.identifiers;
  var sections = {};

  // BIOS
  var bios = {};
  if (ident.bios_vendor) bios['Vendor'] = ident.bios_vendor;
  if (ident.bios_version) bios['Version'] = ident.bios_version;
  if (Object.keys(bios).length > 0) sections['BIOS'] = bios;

  // Motherboard
  var board = {};
  if (ident.board_vendor) board['Vendor'] = ident.board_vendor;
  if (ident.board_name) board['Name'] = ident.board_name;
  if (ident.board_serial) board['Serial'] = ident.board_serial;
  if (ident.product_uuid) board['Identifier'] = ident.product_uuid;
  if (ident.cpu_name) board['CPU'] = ident.cpu_name;
  if (Object.keys(board).length > 0) sections['Motherboard'] = board;

  return Object.keys(sections).length > 0 ? sections : null;
}

/**
 * Build formatted device info response from raw DB data.
 * Mirrors meshctrl.js displayDeviceInfo() output structure.
 */
function formatDeviceInfo(data) {
  var node = data.node;
  var hardware = (data.sysinfo != null && data.sysinfo.hardware != null) ? data.sysinfo.hardware : null;

  // Attach lastconnect to node
  if (data.lastconnect != null) {
    node.lastconnect = data.lastconnect.time;
    node.lastaddr = data.lastconnect.addr;
  }

  var info = {};

  var general = formatGeneral(node);
  if (general) info['General'] = general;

  var os = formatOS(node, hardware);
  if (os) info['Operating System'] = os;

  var agent = formatAgent(node);
  if (agent) info['Mesh Agent'] = agent;

  var net = formatNetworking(data.network);
  if (net) info['Networking'] = net;

  var hw = formatHardware(hardware);
  if (hw) { for (var k in hw) { info[k] = hw[k]; } }

  return info;
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

    // Route 2: GET /api/deviceInfo?id=node/<domain>/<hash> - Get device info by ID
    app.get('/api/deviceInfo', function (req, res) {
      corsHeaders(res);

      var nodeId = req.query.id;
      if (!nodeId) return sendError(res, 400, 'Missing required parameter: id');

      var parts = nodeId.split('/');
      if (parts.length !== 3 || parts[0] !== 'node') {
        return sendError(res, 400, 'Invalid device id format. Expected: node/<domain>/<id>');
      }

      log('DeviceInfo request: ' + nodeId);

      fetchDeviceInfo(db, nodeId, function (err, data) {
        if (err || data.node == null) return sendError(res, 404, 'Device not found');
        if (req.query.raw === 'true') return res.json(data);
        res.json(formatDeviceInfo(data));
      });
    });
  };

  return obj;
};
