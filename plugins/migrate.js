#!/usr/bin/env node
/**
 * OpenFrame MeshCentral Migration Script
 *
 * Standalone Node script that runs once at container startup (invoked from entrypoint.sh).
 * Replaces the shell-based setup-mesh.sh logic.
 *
 * Responsibilities:
 *   1. Read agent cert from disk, compute hash → mesh_server_id
 *   2. Connect to MongoDB via MeshCentral's db.js
 *   3. Ensure admin user exists
 *   4. Ensure device group (mesh) exists
 *   5. Write mesh_id, mesh_device_group_id files
 *   6. Generate meshagent.msh file (+ copy to public/)
 *
 * Usage:
 *   node migrate.js --datapath <path> --configfile <path>
 *
 * Required environment variables:
 *   MESH_DIR, MESH_USER, MESH_PASS, MESH_DEVICE_GROUP
 *   OPENFRAME_MODE, OPENFRAME_GATEWAY_URL (for OpenFrame mode MSH URL)
 *   MESH_PROTOCOL, MESH_NGINX_NAT_HOST, MESH_EXTERNAL_PORT (for standard mode MSH URL)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Logging ---

function log(msg) { console.log('[migrate] ' + msg); }
function err(msg) { console.error('[migrate] ERROR: ' + msg); }

// --- Arg parsing ---

function parseArgs() {
  var args = { datapath: null, configfile: null };
  for (var i = 2; i < process.argv.length; i++) {
    var a = process.argv[i];
    if (a === '--datapath') { args.datapath = process.argv[++i]; }
    else if (a === '--configfile') { args.configfile = process.argv[++i]; }
  }
  if (!args.datapath) { err('--datapath is required'); process.exit(1); }
  if (!args.configfile) { err('--configfile is required'); process.exit(1); }
  return args;
}

// --- Env vars ---

var MESH_DIR = process.env.MESH_DIR;
var MESH_USER = process.env.MESH_USER;
var MESH_PASS = process.env.MESH_PASS;
var MESH_DEVICE_GROUP = process.env.MESH_DEVICE_GROUP || 'OpenFrame';
var OPENFRAME_MODE = process.env.OPENFRAME_MODE || 'false';
var OPENFRAME_GATEWAY_URL = process.env.OPENFRAME_GATEWAY_URL || '';
var MESH_PROTOCOL = process.env.MESH_PROTOCOL || 'wss';
var MESH_NGINX_NAT_HOST = process.env.MESH_NGINX_NAT_HOST || '';
var MESH_EXTERNAL_PORT = process.env.MESH_EXTERNAL_PORT || '8383';

if (!MESH_DIR) { err('MESH_DIR env var is required'); process.exit(1); }
if (!MESH_USER || !MESH_PASS) { err('MESH_USER and MESH_PASS env vars are required'); process.exit(1); }

// --- Resolve paths ---

var args = parseArgs();
// MeshCentral install root — where node_modules, db.js, pass.js etc. live.
// In production the container sets MESH_INSTALL_DIR=/opt/meshcentral and the
// actual node files are at /opt/meshcentral/meshcentral/. Locally it points
// at the repo root which contains meshcentral.js directly.
var MESHCENTRAL_ROOT = process.env.MESH_INSTALL_DIR || path.resolve(__dirname, '..', '..', '..');
// If MESH_INSTALL_DIR/meshcentral exists (production layout), use that subdirectory
if (fs.existsSync(path.join(MESHCENTRAL_ROOT, 'meshcentral', 'meshcentral.js'))) {
  MESHCENTRAL_ROOT = path.join(MESHCENTRAL_ROOT, 'meshcentral');
}

function requireFromMeshCentral(name) {
  return require(path.join(MESHCENTRAL_ROOT, name));
}

// --- Step 1: Read agent cert and compute hash ---

function computeServerIdFromCert(datapath) {
  var certPath = path.join(datapath, 'agentserver-cert-public.crt');
  if (!fs.existsSync(certPath)) {
    throw new Error('Agent certificate not found at ' + certPath);
  }

  var certPem = fs.readFileSync(certPath, 'utf8');

  // Reuse certoperations.getPublicKeyHash() logic
  var forge = require(path.join(MESHCENTRAL_ROOT, 'node_modules', 'node-forge'));
  var publicKey = forge.pki.certificateFromPem(certPem).publicKey;
  var hashHex = forge.pki.getPublicKeyFingerprint(publicKey, { encoding: 'hex', md: forge.md.sha384.create() });

  return hashHex.toUpperCase();
}

// --- Step 2: Build minimal parent shim for db.js ---

function buildParentShim(config, datapath) {
  return {
    datapath: datapath,
    args: {
      mongodb: config.settings && config.settings.mongodb,
      mongodbname: (config.settings && config.settings.mongodbname) || 'meshcentral',
      mongodbcol: (config.settings && config.settings.mongodbcol) || 'meshcentral',
      datapath: datapath
    },
    config: config,
    crypto: crypto,
    fs: fs,
    path: path,
    common: requireFromMeshCentral('common.js'),
    certificateOperations: null,  // not needed for Get/Set operations
    debug: function () { /* no-op */ },
    DispatchEvent: function () { /* no-op */ },
    GetConnectivityState: function () { return null; },
    webserver: { meshes: {}, users: {} },
    userGroups: {}
  };
}

// --- Step 3: Load config.json ---

function loadConfig(configfile) {
  var raw = fs.readFileSync(configfile, 'utf8');
  // Strip any ${VAR} placeholders that weren't substituted — fall back to env
  raw = raw.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, function (m, name) {
    return process.env[name] || '';
  });
  return JSON.parse(raw);
}

// --- Step 4: Ensure admin user exists ---

function ensureAdminUser(db, domain, cb) {
  var userid = 'user/' + domain + '/' + MESH_USER.toLowerCase();

  db.Get(userid, function (dbErr, docs) {
    if (docs != null && docs.length === 1) {
      log('Admin user already exists: ' + MESH_USER);
      return cb(null, userid);
    }

    log('Creating admin user: ' + MESH_USER);
    var passModule = requireFromMeshCentral('pass.js');
    passModule.hash(MESH_PASS, function (hashErr, salt, hash) {
      if (hashErr) { return cb(hashErr); }

      var user = {
        _id: userid,
        type: 'user',
        name: MESH_USER,
        domain: domain,
        creation: Math.floor(Date.now() / 1000),
        links: {},
        email: MESH_USER,
        emailVerified: true,
        salt: salt,
        hash: hash,
        siteadmin: 0xFFFFFFFF
      };

      db.Set(user, function (setErr) {
        if (setErr) { return cb(setErr); }
        log('Admin user created: ' + userid);
        cb(null, userid);
      });
    }, 0);
  });
}

// --- Step 5: Ensure device group exists ---

function ensureDeviceGroup(db, domain, userid, cb) {
  db.GetAllType('mesh', function (dbErr, docs) {
    if (dbErr) { return cb(dbErr); }

    // Look for existing mesh matching name + domain
    if (docs) {
      for (var i = 0; i < docs.length; i++) {
        var m = docs[i];
        if (m.domain === domain && m.name === MESH_DEVICE_GROUP && !m.deleted) {
          log('Device group already exists: ' + MESH_DEVICE_GROUP + ' (' + m._id + ')');
          return cb(null, m._id);
        }
      }
    }

    // Create new mesh
    log('Creating device group: ' + MESH_DEVICE_GROUP);
    crypto.randomBytes(48, function (randErr, buf) {
      if (randErr) { return cb(randErr); }

      var meshid = 'mesh/' + domain + '/' + buf.toString('base64').replace(/\+/g, '@').replace(/\//g, '$');

      var links = {};
      if (userid) {
        links[userid] = { name: MESH_USER, rights: 0xFFFFFFFF };
      }

      var mesh = {
        type: 'mesh',
        _id: meshid,
        name: MESH_DEVICE_GROUP,
        mtype: 2,
        desc: 'Created by openframe migration',
        domain: domain,
        links: links,
        creation: Date.now(),
        creatorid: userid,
        creatorname: MESH_USER
      };

      db.Set(mesh, function (setErr) {
        if (setErr) { return cb(setErr); }
        log('Device group created: ' + meshid);

        // Update user to include this mesh in their links
        db.Get(userid, function (getErr, userDocs) {
          if (getErr || !userDocs || userDocs.length !== 1) {
            // Not fatal — mesh is created, just couldn't update user links
            return cb(null, meshid);
          }
          var user = userDocs[0];
          if (user.links == null) { user.links = {}; }
          user.links[meshid] = { rights: 0xFFFFFFFF };
          db.Set(user, function () {
            cb(null, meshid);
          });
        });
      });
    });
  });
}

// --- Step 6: Write mesh ID files ---

function writeMeshIdFiles(meshid, serverIdHex) {
  // Extract base64 hash from meshid: mesh/<domain>/<BASE64>
  var parts = meshid.split('/');
  var base64Hash = parts[parts.length - 1];

  fs.writeFileSync(path.join(MESH_DIR, 'mesh_device_group_id'), base64Hash);
  log('Wrote mesh_device_group_id: ' + base64Hash);

  // Convert base64 (with MC's @$ escaping) → hex with 0x prefix
  var standardBase64 = base64Hash.replace(/@/g, '+').replace(/\$/g, '/');
  var hex = Buffer.from(standardBase64, 'base64').toString('hex').toUpperCase();
  var meshIdHex = '0x' + hex;
  fs.writeFileSync(path.join(MESH_DIR, 'mesh_id'), meshIdHex);
  log('Wrote mesh_id: ' + meshIdHex);

  fs.writeFileSync(path.join(MESH_DIR, 'mesh_server_id'), serverIdHex);
  log('Wrote mesh_server_id: ' + serverIdHex);

  return meshIdHex;
}

// --- Step 7: Generate meshagent.msh file ---

function generateMshFile(meshIdHex, serverIdHex) {
  var meshServerUrl;
  if (OPENFRAME_MODE === 'true' && OPENFRAME_GATEWAY_URL) {
    log('OpenFrame mode enabled — using gateway URL');
    meshServerUrl = 'wss://' + OPENFRAME_GATEWAY_URL + '/ws/tools/agent/meshcentral-server/agent.ashx';
  } else {
    log('Standard mode — using direct MeshCentral URL');
    meshServerUrl = MESH_PROTOCOL + '://' + MESH_NGINX_NAT_HOST + ':' + MESH_EXTERNAL_PORT + '/agent.ashx';
  }

  var mshContent = [
    'MeshName=' + MESH_DEVICE_GROUP,
    'MeshType=2',
    'MeshID=' + meshIdHex,
    'ignoreProxyFile=1',
    'ServerID=' + serverIdHex,
    'MeshServer=' + meshServerUrl
  ].join('\n');

  var mshPath = path.join(MESH_DIR, 'meshagent.msh');
  fs.writeFileSync(mshPath, mshContent);
  log('Wrote ' + mshPath);

  // Copy to public/ for static serving
  var publicDir = path.join(MESH_DIR, 'public');
  try { fs.mkdirSync(publicDir, { recursive: true }); } catch (e) { /* exists */ }
  fs.writeFileSync(path.join(publicDir, 'meshagent.msh'), mshContent);
  log('Wrote ' + path.join(publicDir, 'meshagent.msh'));
}

// --- Main ---

function main() {
  log('Starting migration');
  log('datapath: ' + args.datapath);
  log('configfile: ' + args.configfile);

  // Step 1: Compute server ID from cert
  var serverIdHex;
  try {
    serverIdHex = computeServerIdFromCert(args.datapath);
    log('Computed server ID: ' + serverIdHex);
  } catch (e) {
    err('Failed to compute server ID: ' + e.message);
    process.exit(1);
  }

  // Step 2: Load config and set up DB shim
  var config;
  try {
    config = loadConfig(args.configfile);
  } catch (e) {
    err('Failed to load config: ' + e.message);
    process.exit(1);
  }

  if (!config.settings || !config.settings.mongodb) {
    err('config.json has no settings.mongodb connection string');
    process.exit(1);
  }

  var parentShim = buildParentShim(config, args.datapath);

  // Step 3: Connect to DB
  log('Connecting to MongoDB...');
  var dbModule = requireFromMeshCentral('db.js');
  dbModule.CreateDB(parentShim, function (db) {
    db.SetupDatabase(function (dbversion) {
      log('Database ready (version ' + dbversion + ')');

      var domain = '';  // default domain

      // Step 4: Ensure user
      ensureAdminUser(db, domain, function (userErr, userid) {
        if (userErr) { err('User setup failed: ' + userErr); process.exit(1); }

        // Step 5: Ensure device group
        ensureDeviceGroup(db, domain, userid, function (meshErr, meshid) {
          if (meshErr) { err('Device group setup failed: ' + meshErr); process.exit(1); }

          // Step 6 + 7: Write files
          try {
            var meshIdHex = writeMeshIdFiles(meshid, serverIdHex);
            generateMshFile(meshIdHex, serverIdHex);
          } catch (e) {
            err('File generation failed: ' + e.message);
            process.exit(1);
          }

          log('Migration completed successfully');
          process.exit(0);
        });
      });
    });
  });
}

main();
