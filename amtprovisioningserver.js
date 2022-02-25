/**
* @description MeshCentral Intel AMT Hello server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

// Construct the Intel AMT hello server. This is used for Intel AMT bare-metal activation on the local LAN.
// This server can receive a notification from Intel AMT and attempt activation.
// In Intel documentation, this is called the Setup and Configuration Application (SCA)
module.exports.CreateAmtProvisioningServer = function (parent, config) {
    var obj = {};
    obj.meshid = config.devicegroup; // This is the device group identifier that all activated devices will be added to.

    // WSMAN stack
    const CreateWsmanComm = require('./amt/amt-wsman-comm');
    const WsmanStackCreateService = require('./amt/amt-wsman');
    const AmtStackCreateService = require('./amt/amt');

    // Check configuration
    if (checkAmtPassword(config.newmebxpassword) == false) { console.log('Invalid MEBx password, must have 1 lower, 1 upper, 1 numeric, 1 non-alpha and be 8 or more in length.'); return null; }

    // Start the Intel AMT hello server
    var port = 9971;
    if (typeof config.port == 'number') { port = config.port; }
    const net = require('net');
    obj.server = net.createServer(function (socket) {
        socket.ra = socket.remoteAddress;
        socket.data = null;
        socket.on('error', function (err) { })
        socket.on('close', function () { if (this.data != null) { processHelloData(this.data, this.ra); } delete this.ra; this.removeAllListeners(); })
        socket.on('data', function (data) {
            if (this.data == null) { this.data = data; } else { Buffer.concat([this.data, data]); }
            var str = this.data.toString();
            if (str.startsWith('GET ') && (str.indexOf('\r\n\r\n') >= 0)) {
                this.data = null;
                var content = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Intel&reg; AMT Hello Server</title></head><body>Intel AMT hello server.<br />Intel&reg; AMT devices should send notification to this port for activation.</body></html>";
                try { socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ' + content.length + '\r\nConnection: close\r\n\r\n' + content); } catch (ex) {}
            } else if (this.data.length > 16000) {
                try { this.end(); } catch (ex) { };
            }
        })
    });
    obj.server.listen(port);
    console.log('MeshCentral Intel(R) AMT provisioning server running on port ' + port + '.');
    obj.parent = parent;
    obj.rootCertCN = obj.parent.certificateOperations.forge.pki.certificateFromPem(obj.parent.certificates.root.cert).subject.getField('CN').value;

    // Devices activaly being configured
    obj.devices = {} // Address -> Device

    // Example hello data for testing
    //setTimeout(function () { processHelloData(Buffer.from('01000300000000004b529b93d413181de4871c697a6b7a2b170220c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4022045140b3247eb9cc8c5b4f0d7b53091f73292089e6e5a63e2749dd3aca9198eda0220d7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef402201465fa205397b876faa6f0a9958e5590e40fcc7faa4fb7c2c8677521fb5fb65802202ce1cb0bf9d2f9e102993fbe215152c3b2dd0cabde1c68e5319b839154dbb7f502209acfab7e43c8d880d06b262a94deeee4b4659989c3d0caf19baf6405e41ab7df022016af57a9f676b0ab126095aa5ebadef22ab31119d644ac95cd4b93dbf3f26aeb0220960adf0063e96356750c2965dd0a0867da0b9cbd6e77714aeafb2349ab393da3022068ad50909b04363c605ef13581a939ff2c96372e3f12325b0a6861e1d59f660302206dc47172e01cbcb0bf62580d895fe2b8ac9ad4f873801e0c10b9c837d21eb177022073c176434f1bc6d5adf45b0e76e727287c8de57616c1e6e6141a2b2cbc7d8e4c022043df5774b03e7fef5fe40d931a7bedf1bb2e6b42738c4e6d3841103d3aa7f33902202399561127a57125de8cefea610ddf2fa078b5c8067f4e828290bfb860e84b3c022070a73f7f376b60074248904534b11482d5bf0e698ecc498df52577ebf2e93b9a02204348a0e9444c78cb265e058d5e8944b4d84f9662bd26db257f8934a443c701610220cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f022031ad6648f8104138c738f39ea4320133393e3a18cc02296ef97c2ac9ef6731d00220552f7bdcf1a7af9e6ce672017f4f12abf77240c78e761ac203d1d9d20ac89988022067540a47aa5b9f34570a99723cfefa96a96ee3f0d9b8bf4def9440b8065d665d02207224395222cd588c4f2683716922addb41e39b581ac34fa87b39efa896fbb39e0220cbb522d7b7f127ad6a0113865bdf1cd4102e7d0759af635a7cf4720dc963c53b0220179fbc148a3dd00fd24ea13458cc43bfa7f59c8182d783a513f6ebec100c892402202cabeafe37d06ca22aba7391c0033d25982952c453647349763a3ab5ad6ccf69', 'hex'), '192.168.2.148'); }, 500);
    //setTimeout(function () { processHelloData(Buffer.from('01000300000000004b529b93d413181de4871c697a6b7a2b180220c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4022045140b3247eb9cc8c5b4f0d7b53091f73292089e6e5a63e2749dd3aca9198eda0220d7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef402201465fa205397b876faa6f0a9958e5590e40fcc7faa4fb7c2c8677521fb5fb65802202ce1cb0bf9d2f9e102993fbe215152c3b2dd0cabde1c68e5319b839154dbb7f502209acfab7e43c8d880d06b262a94deeee4b4659989c3d0caf19baf6405e41ab7df022016af57a9f676b0ab126095aa5ebadef22ab31119d644ac95cd4b93dbf3f26aeb0220960adf0063e96356750c2965dd0a0867da0b9cbd6e77714aeafb2349ab393da3022068ad50909b04363c605ef13581a939ff2c96372e3f12325b0a6861e1d59f660302206dc47172e01cbcb0bf62580d895fe2b8ac9ad4f873801e0c10b9c837d21eb177022073c176434f1bc6d5adf45b0e76e727287c8de57616c1e6e6141a2b2cbc7d8e4c022043df5774b03e7fef5fe40d931a7bedf1bb2e6b42738c4e6d3841103d3aa7f33902202399561127a57125de8cefea610ddf2fa078b5c8067f4e828290bfb860e84b3c022070a73f7f376b60074248904534b11482d5bf0e698ecc498df52577ebf2e93b9a02204348a0e9444c78cb265e058d5e8944b4d84f9662bd26db257f8934a443c701610220cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f022031ad6648f8104138c738f39ea4320133393e3a18cc02296ef97c2ac9ef6731d00220552f7bdcf1a7af9e6ce672017f4f12abf77240c78e761ac203d1d9d20ac89988022067540a47aa5b9f34570a99723cfefa96a96ee3f0d9b8bf4def9440b8065d665d0220a267c480b0b29056eb5e8aa7c93add804f5a7df516e969e77bcacafe8d45607902207224395222cd588c4f2683716922addb41e39b581ac34fa87b39efa896fbb39e0220cbb522d7b7f127ad6a0113865bdf1cd4102e7d0759af635a7cf4720dc963c53b0220179fbc148a3dd00fd24ea13458cc43bfa7f59c8182d783a513f6ebec100c892402202cabeafe37d06ca22aba7391c0033d25982952c453647349763a3ab5ad6ccf69', 'hex'), '192.168.2.148'); }, 5000);
    //setTimeout(function () { processHelloData(Buffer.from('01000300010000003ec2ffd2d19d2d41860a54b2039b72ff180220c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4022045140b3247eb9cc8c5b4f0d7b53091f73292089e6e5a63e2749dd3aca9198eda0220d7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef402201465fa205397b876faa6f0a9958e5590e40fcc7faa4fb7c2c8677521fb5fb65802202ce1cb0bf9d2f9e102993fbe215152c3b2dd0cabde1c68e5319b839154dbb7f502209acfab7e43c8d880d06b262a94deeee4b4659989c3d0caf19baf6405e41ab7df022016af57a9f676b0ab126095aa5ebadef22ab31119d644ac95cd4b93dbf3f26aeb0220960adf0063e96356750c2965dd0a0867da0b9cbd6e77714aeafb2349ab393da3022068ad50909b04363c605ef13581a939ff2c96372e3f12325b0a6861e1d59f660302206dc47172e01cbcb0bf62580d895fe2b8ac9ad4f873801e0c10b9c837d21eb177022073c176434f1bc6d5adf45b0e76e727287c8de57616c1e6e6141a2b2cbc7d8e4c022043df5774b03e7fef5fe40d931a7bedf1bb2e6b42738c4e6d3841103d3aa7f33902202399561127a57125de8cefea610ddf2fa078b5c8067f4e828290bfb860e84b3c022070a73f7f376b60074248904534b11482d5bf0e698ecc498df52577ebf2e93b9a02204348a0e9444c78cb265e058d5e8944b4d84f9662bd26db257f8934a443c701610220cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f022031ad6648f8104138c738f39ea4320133393e3a18cc02296ef97c2ac9ef6731d00220552f7bdcf1a7af9e6ce672017f4f12abf77240c78e761ac203d1d9d20ac89988022067540a47aa5b9f34570a99723cfefa96a96ee3f0d9b8bf4def9440b8065d665d0220a267c480b0b29056eb5e8aa7c93add804f5a7df516e969e77bcacafe8d45607902207224395222cd588c4f2683716922addb41e39b581ac34fa87b39efa896fbb39e0220cbb522d7b7f127ad6a0113865bdf1cd4102e7d0759af635a7cf4720dc963c53b0220179fbc148a3dd00fd24ea13458cc43bfa7f59c8182d783a513f6ebec100c892402202cabeafe37d06ca22aba7391c0033d25982952c453647349763a3ab5ad6ccf69', 'hex'), '192.168.2.134'); }, 5000);

    // Parse Intel AMT hello data
    function parseHelloData(data, addr) {
        try {
            var amtHello = { time: Date.now(), addr: addr };

            // Decode header
            if (data.length < 25) return; // Invalid data
            const firstBytes = data.readInt16LE(0);
            if (firstBytes > 1) return; // Invalid data
            amtHello.adminCredentialsSet = (firstBytes != 0);
            amtHello.helloversion = data.readInt16LE(2);
            if (amtHello.helloversion != 3) return null; // One touch PID not supported, only version 3 supported.
            amtHello.retryCount = data.readInt32LE(4);
            amtHello.guidhex = data.slice(8, 24).toString('hex');
            amtHello.guid = guidToStr(amtHello.guidhex);

            // Get the list of hashes
            const hashCount = data[24];
            amtHello.hashes = [];
            var ptr = 25;
            for (var i = 0; i < hashCount; i++)
            {
                const hashType = data[ptr]; // 1=SHA1 (20 byte hash); 2 = SHA256 (32 byte hash); 3 = SHA384 (48 byte hash)
                const hashSize = data[ptr + 1];
                if ((hashType < 1) || (hashType > 3)) return null; // Unexpected hash type
                if ((hashType == 1) && (hashSize != 20)) return null; // Unexpected SHA1 hash size
                if ((hashType == 2) && (hashSize != 32)) return null; // Unexpected SHA256 hash size
                if ((hashType == 3) && (hashSize != 48)) return null; // Unexpected SHA384 hash size
                const hash = data.slice(ptr + 2, ptr + 2 + hashSize);
                amtHello.hashes.push(hash.toString('hex'));
                ptr += (hashSize + 2);
            }
            if (amtHello.hashes.length != hashCount) return null; // Unexpected number of hashes
            return amtHello; // Everything looks good.
        } catch (ex) { return null; }
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }
    function strToGuid(s) { s = s.replace(/-/g, ''); var ret = s.substring(6, 8) + s.substring(4, 6) + s.substring(2, 4) + s.substring(0, 2) + s.substring(10, 12) + s.substring(8, 10) + s.substring(14, 16) + s.substring(12, 14) + s.substring(16, 20) + s.substring(20); return ret; }

    // Process incoming Intel AMT hello data
    function processHelloData(data, addr) {
        // Check if we can parse the incoming data
        if (addr.startsWith('::ffff:')) { addr = addr.substring(7); }
        if (obj.devices[addr] != null) return; // Device on this address already being activated.
        const dev = parseHelloData(data, addr);
        if (dev == null) { parent.debug('amtsca', addr, 'Got invalid hello from: ' + addr); return; } // Invalid Intel AMT hello
        parent.debug('amtsca', 'Got hello from ' + addr);
        obj.devices[addr] = dev;
        dev.aquired = {};

        // Set device messages
        dev.consoleMsg = function deviceConsoleMsg(msg) { parent.debug('amtsca', deviceConsoleMsg.dev.aquired.host ? deviceConsoleMsg.dev.aquired.host : deviceConsoleMsg.dev.addr, msg); return; }
        dev.consoleMsg.dev = dev;

        // Get assumed trusted FQDN and device group
        dev.trustedFqdn = config.trustedfqdn;
        var mesh = parent.webserver.meshes[config.devicegroup];
        if ((mesh == null) || (mesh.mtype !== 1) || (typeof mesh.amt !== 'object') || (typeof mesh.amt.type !== 'number')) { dev.consoleMsg('Invalid device group for Intel AMT activation.'); return; }
        if ((mesh.amt.type != 3) && (mesh.amt.type != 4)) { dev.consoleMsg('Device group does not have ACM activation policy.'); return; }
        dev.mesh = mesh;
        dev.meshid = mesh._id;
        dev.domainid = mesh.domain;

        // Compute the nodeid for this device using the device GUID
        const g = dev.guid.split('-').join('');
        const id = Buffer.from(g + g + g, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
        dev.nodeid = 'node/' + mesh.domain + '/' + id;

        // Attempts reverse DNS loopup on the device IP address
        const func = function dnsReverseLoopup(err, hostnames) {
            var hostname = dnsReverseLoopup.addr;
            if ((err == null) && (hostnames != null) && (hostnames.length > 0)) { hostname = hostnames[0]; }
            dnsReverseLoopup.dev.aquired.host = hostname;
            processHelloDataEx1(dnsReverseLoopup.dev);
        }
        func.addr = addr;
        func.dev = dev;
        require('dns').reverse(addr, func);
    }

    // Check if this device has any way to be activated in ACM using our server certificates.
    function checkAcmActivation(hello) {
        var domain = parent.config.domains[hello.domainid];
        if ((domain == null) || (domain.amtacmactivation == null) || (domain.amtacmactivation.certs == null) || (domain.amtacmactivation.certs.length == 0)) return null;
        const activationCerts = domain.amtacmactivation.certs;

        // Get the trusted FQDN of the device
        var trustedFqdn = hello.trustedFqdn;

        // Find a matching certificate
        for (var i in activationCerts) {
            var cert = activationCerts[i];
            if ((cert.cn == '*') || (cert.cn == trustedFqdn)) {
                for (var j in hello.hashes) {
                    var hash = hello.hashes[j];
                    if (hash == cert.sha256) { return { cert: cert, fqdn: trustedFqdn, hash: cert.sha256 }; } // Found a match
                    else if (hash == cert.sha1) { return { cert: cert, fqdn: trustedFqdn, hash: cert.sha1 }; } // Found a match
                }
            }
        }
        return null; // Did not find a match
    }

    function processHelloDataEx1(dev) {
        // Get an activation certificate chain
        const certinfo = checkAcmActivation(dev);
        if (certinfo == null) { dev.consoleMsg('Unable to find a matching ACM activation certificate.'); destroyDevice(dev); return; }
        var certchain = parent.certificateOperations.getAcmCertChain(parent.config.domains[dev.domainid], dev.trustedFqdn, certinfo.cert.sha256);
        if (certchain == null) { dev.consoleMsg('Unable to create TLS certificate chain.'); destroyDevice(dev); return; }
        dev.certchain = certchain;

        // Setup a connection to the Intel AMT device
        dev.consoleMsg('Launching TLS connection...');
        var comm = CreateWsmanComm(dev.aquired.host, 16993, 'admin', '', 1, { cert: dev.certchain.certs.reverse().join(''), key: dev.certchain.signkey }); // Perform TLS connection
        comm.xtlsFingerprint = 0; // No Intel AMT certificate checking.
        var wsstack = WsmanStackCreateService(comm);
        dev.amtstack = AmtStackCreateService(wsstack);
        dev.amtstack.dev = dev;
        dev.amtstack.BatchEnum(null, ['*AMT_GeneralSettings', 'CIM_SoftwareIdentity', '*AMT_SetupAndConfigurationService'], processHelloDataEx2);
    }

    function processHelloDataEx2(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg('Failed TLS connection, status=' + status + '.'); destroyDevice(dev); return; }

        // Fetch the Intel AMT version from WSMAN
        if ((responses != null) && (responses['CIM_SoftwareIdentity'] != null) && (responses['CIM_SoftwareIdentity'].responses != null)) {
            var amtlogicalelements = [];
            amtlogicalelements = responses['CIM_SoftwareIdentity'].responses;
            if (responses['AMT_SetupAndConfigurationService'] != null && responses['AMT_SetupAndConfigurationService'].response != null) {
                amtlogicalelements.push(responses['AMT_SetupAndConfigurationService'].response);
            }
            if (amtlogicalelements.length > 0) {
                var vs = getInstance(amtlogicalelements, 'AMT')['VersionString'];
                if (vs != null) {
                    dev.aquired.version = vs;
                    dev.aquired.versionmajor = parseInt(dev.aquired.version.split('.')[0]);
                    dev.aquired.versionminor = parseInt(dev.aquired.version.split('.')[1]);
                }
            }
        }

        // Fetch the Intel AMT version from HTTP stack
        if ((dev.amtversionstr == null) && (stack.wsman.comm.amtVersion != null)) {
            var s = stack.wsman.comm.amtVersion.split('.');
            if (s.length >= 3) {
                dev.aquired.version = s[0] + '.' + s[1] + '.' + s[2];
                dev.aquired.versionmajor = parseInt(s[0]);
                dev.aquired.versionminor = parseInt(s[1]);
            }
        }

        // If we can't get the Intel AMT version, stop here.
        if (dev.aquired.version == null) { dev.consoleMsg('Could not get Intel AMT version.'); destroyDevice(dev); return; } // Could not get Intel AMT version, disconnect();

        // Get the digest realm
        if (responses['AMT_GeneralSettings'] && responses['AMT_GeneralSettings'].response && (typeof responses['AMT_GeneralSettings'].response['DigestRealm'] == 'string')) {
            dev.aquired.realm = responses['AMT_GeneralSettings'].response['DigestRealm'];
        } else {
            dev.consoleMsg('Could not get Intel AMT digest realm.'); destroyDevice(dev); return;
        }

        // Looks like we are doing well.
        dev.consoleMsg('Succesful TLS connection, Intel AMT v' + dev.aquired.version);

        // Set the new MEBx password
        dev.consoleMsg('Setting MEBx password...');
        dev.amtstack.AMT_SetupAndConfigurationService_SetMEBxPassword(config.newmebxpassword, processHelloDataEx3);
    }

    // Response from setting MEBx password
    function processHelloDataEx3(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg('Failed to set MEBx password, status=' + status + '.'); destroyDevice(dev); return; }
        dev.consoleMsg('MEBx password set. Setting admin password...');

        // See what admin password to use
        dev.aquired.user = 'admin';
        dev.aquired.pass = dev.mesh.amt.password;
        if (dev.aquired.pass == null) { dev.aquired.pass = getRandomAmtPassword(); }

        // Set the admin password
        dev.amtstack.AMT_AuthorizationService_SetAdminAclEntryEx(dev.aquired.user, hex_md5(dev.aquired.user + ':' + dev.aquired.realm + ':' + dev.aquired.pass), processHelloDataEx4);
    }

    // Response from setting admin password
    function processHelloDataEx4(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg('Failed to set admin password, status=' + status + '.'); destroyDevice(dev); return; }
        dev.consoleMsg('Admin password set.');

        // Perform Intel AMT clock sync
        attemptSyncClock(dev, function (dev) {
            // Setup TLS and commit.
            attemptTlsSync(dev, function (dev) {
                dev.consoleMsg('Intel AMT ACM activation completed.');
                parent.SetConnectivityState(dev.meshid, dev.nodeid, Date.now(), 4, 7, null, { name: dev.name }); // Report power state as "present" (7).
                if (obj.parent.amtManager != null) { obj.parent.amtManager.startAmtManagement(dev.nodeid, 3, dev.aquired.host); } // Request that Intel AMT manager take a look at this device.
                destroyDevice(dev); // We are done, clean up.
            });
        });
    }


    //
    // Intel AMT TLS setup
    //

    // Check if Intel AMT TLS state is correct
    function attemptTlsSync(dev, func) {
        dev.taskCount = 1;
        dev.taskCompleted = func;
        // TODO: We only deal with certificates starting with Intel AMT 6 and beyond
        dev.amtstack.BatchEnum(null, ['AMT_PublicKeyCertificate', 'AMT_PublicPrivateKeyPair', 'AMT_TLSSettingData', 'AMT_TLSCredentialContext'], attemptTlsSyncEx);
    }

    // Intel AMT is not always in a good spot to generate a key pair. This will retry at 10 second interval.
    function generateKeyPairWithRetry(dev, func) {
        if (isAmtDeviceValid(dev) == false) return;
        if (dev.keyPairAttempts == null) { dev.keyPairAttempts = 1; } else { dev.keyPairAttempts++; }
        dev.amtstack.AMT_PublicKeyManagementService_GenerateKeyPair(0, 2048, function (stack, name, responses, status) {
            if (isAmtDeviceValid(dev) == false) { delete dev.keyPairAttempts; return; }
            if ((status == 200) || (dev.keyPairAttempts > 19)) {
                delete dev.keyPairAttempts;
                func(stack, name, responses, status);
            } else {
                if ((responses.Body != null) && (responses.Body.ReturnValue != null) && (responses.Body.ReturnValueStr != null)) {
                    dev.consoleMsg("Failed to generate a key pair (" + status + ", " + responses.Body.ReturnValue + ", \"" + responses.Body.ReturnValueStr + "\"), attempt " + dev.keyPairAttempts + ", trying again in 10 seconds...");
                } else {
                    dev.consoleMsg("Failed to generate a key pair (" + status + "), attempt " + dev.keyPairAttempts + ", trying again in 10 seconds...");
                }

                // Wait 10 seconds before attempting again
                var f = function doManage() { generateKeyPairWithRetry(doManage.dev, doManage.func); }
                f.dev = dev;
                f.func = func;
                setTimeout(f, 10000);
            }
        });
    }

    function attemptTlsSyncEx(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get security information (" + status + ")."); destroyDevice(dev); return; }

        // Setup the certificates
        dev.policy = {};
        dev.policy.certPrivateKeys = responses['AMT_PublicPrivateKeyPair'].responses;
        dev.policy.tlsSettings = responses['AMT_TLSSettingData'].responses;
        dev.policy.tlsCredentialContext = responses['AMT_TLSCredentialContext'].responses;
        var xxCertificates = responses['AMT_PublicKeyCertificate'].responses;
        for (var i in xxCertificates) {
            xxCertificates[i].TrustedRootCertficate = (xxCertificates[i]['TrustedRootCertficate'] == true);
            xxCertificates[i].X509CertificateBin = Buffer.from(xxCertificates[i]['X509Certificate'], 'base64').toString('binary');
            xxCertificates[i].XIssuer = parseCertName(xxCertificates[i]['Issuer']);
            xxCertificates[i].XSubject = parseCertName(xxCertificates[i]['Subject']);
        }
        amtcert_linkCertPrivateKey(xxCertificates, dev.policy.certPrivateKeys);
        dev.policy.certificates = xxCertificates;
        dev.consoleMsg("Intel AMT has " + xxCertificates.length + " certificate(s) and " + dev.policy.certPrivateKeys.length + " private keys(s).");

        // Find the current TLS certificate & MeshCentral root certificate
        var xxTlsCurrentCert = null;
        if (dev.policy.tlsCredentialContext.length > 0) {
            var certInstanceId = dev.policy.tlsCredentialContext[0]['ElementInContext']['ReferenceParameters']['SelectorSet']['Selector']['Value'];
            for (var i in dev.policy.certificates) { if (dev.policy.certificates[i]['InstanceID'] == certInstanceId) { xxTlsCurrentCert = i; } }
        }

        // This is a managed device and TLS is not enabled, turn it on.
        if (xxTlsCurrentCert === null) {
            // Start by generating a key pair
            dev.consoleMsg("No TLS certificate. Generating key pair...");
            generateKeyPairWithRetry(dev, function (stack, name, responses, status) {
                const dev = stack.dev;
                if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                if (status != 200) { dev.consoleMsg("Failed to generate a key pair (" + status + ")."); removeAmtDevice(dev, 20); return; }

                // Check that we get a key pair reference
                var x = null;
                try { x = responses.Body['KeyPair']['ReferenceParameters']['SelectorSet']['Selector']['Value']; } catch (ex) { }
                if (x == null) { dev.consoleMsg("Unable to get key pair reference."); removeAmtDevice(dev, 21); return; }

                // Get the new key pair
                dev.consoleMsg("Fetching key pair...");
                dev.amtstack.Enum('AMT_PublicPrivateKeyPair', function (stack, name, responses, status, tag) {
                    const dev = stack.dev;
                    if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                    if (status != 200) { dev.consoleMsg("Failed to get a key pair list (" + status + ")."); removeAmtDevice(dev, 22); return; }

                    // Get the new DER key
                    var DERKey = null;
                    for (var i in responses) { if (responses[i]['InstanceID'] == tag) { DERKey = responses[i]['DERKey']; } }

                    // Get certificate values
                    const commonName = 'IntelAMT-' + Buffer.from(parent.crypto.randomBytes(6), 'binary').toString('hex');
                    const domain = parent.config.domains[dev.domainid];
                    var serverName = 'MeshCentral';
                    if ((domain != null) && (domain.title != null)) { serverName = domain.title; }
                    const certattributes = { 'CN': commonName, 'O': serverName, 'ST': 'MC', 'C': 'MC' };

                    // See what root certificate to use to sign the TLS cert
                    var xxCaPrivateKey = parent.webserver.certificates.root.key; // Use our own root by default
                    var issuerattributes = { 'CN': obj.rootCertCN };
                    if (domain.amtmanager.tlsrootcert2 != null) {
                        xxCaPrivateKey = domain.amtmanager.tlsrootcert2.key;
                        issuerattributes = domain.amtmanager.tlsrootcert2.attributes;
                        // TODO: We should change the start and end dates of our issued certificate to at least match the root.
                        // TODO: We could do one better and auto-renew TLS certificates as needed.
                    }

                    // Set the extended key usages
                    var extKeyUsage = { name: 'extKeyUsage', serverAuth: true, clientAuth: true }

                    // Sign the key pair using the CA certifiate
                    dev.consoleMsg("Signing certificate...");
                    const cert = parent.amtManager.amtcert_createCertificate(certattributes, xxCaPrivateKey, DERKey, issuerattributes, extKeyUsage);
                    if (cert == null) { dev.consoleMsg("Failed to sign the TLS certificate."); removeAmtDevice(dev, 23); return; }

                    // Place the resulting signed certificate back into AMT
                    var pem = obj.parent.certificateOperations.forge.pki.certificateToPem(cert).replace(/(\r\n|\n|\r)/gm, '');

                    // Set the certificate finderprint (SHA1)
                    var md = obj.parent.certificateOperations.forge.md.sha1.create();
                    md.update(obj.parent.certificateOperations.forge.asn1.toDer(obj.parent.certificateOperations.forge.pki.certificateToAsn1(cert)).getBytes());
                    dev.aquired.hash = md.digest().toHex();

                    dev.consoleMsg("Adding certificate, hash: " + dev.aquired.hash);
                    dev.amtstack.AMT_PublicKeyManagementService_AddCertificate(pem.substring(27, pem.length - 25), function (stack, name, responses, status) {
                        const dev = stack.dev;
                        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
                        if (status != 200) { dev.consoleMsg("Failed to add TLS certificate (" + status + ")."); removeAmtDevice(dev, 24); return; }
                        var certInstanceId = null;
                        try { certInstanceId = responses.Body['CreatedCertificate']['ReferenceParameters']['SelectorSet']['Selector']['Value']; } catch (ex) { }
                        if (certInstanceId == null) { dev.consoleMsg("Failed to get TLS certificate identifier."); removeAmtDevice(dev, 25); return; }

                        // Set the TLS certificate
                        dev.setTlsSecurityPendingCalls = 2;
                        if (dev.policy.tlsCredentialContext.length > 0) {
                            // Modify the current context
                            var newTLSCredentialContext = Clone(dev.policy.tlsCredentialContext[0]);
                            newTLSCredentialContext['ElementInContext']['ReferenceParameters']['SelectorSet']['Selector']['Value'] = certInstanceId;
                            dev.amtstack.Put('AMT_TLSCredentialContext', newTLSCredentialContext, amtSwitchToTls, 0, 1);
                        } else {
                            // Add a new security context
                            dev.amtstack.Create('AMT_TLSCredentialContext', {
                                'ElementInContext': '<a:Address>/wsman</a:Address><a:ReferenceParameters><w:ResourceURI>' + dev.amtstack.CompleteName('AMT_PublicKeyCertificate') + '</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">' + certInstanceId + '</w:Selector></w:SelectorSet></a:ReferenceParameters>',
                                'ElementProvidingContext': '<a:Address>/wsman</a:Address><a:ReferenceParameters><w:ResourceURI>' + dev.amtstack.CompleteName('AMT_TLSProtocolEndpointCollection') + '</w:ResourceURI><w:SelectorSet><w:Selector Name="ElementName">TLSProtocolEndpointInstances Collection</w:Selector></w:SelectorSet></a:ReferenceParameters>'
                            }, amtSwitchToTls);
                        }

                        // Figure out what index is local & remote
                        var localNdx = ((dev.policy.tlsSettings[0]['InstanceID'] == 'Intel(r) AMT LMS TLS Settings')) ? 0 : 1, remoteNdx = (1 - localNdx);

                        // Remote TLS settings
                        var xxTlsSettings2 = Clone(dev.policy.tlsSettings);
                        xxTlsSettings2[remoteNdx]['Enabled'] = true;
                        xxTlsSettings2[remoteNdx]['MutualAuthentication'] = false;
                        xxTlsSettings2[remoteNdx]['AcceptNonSecureConnections'] = true;
                        delete xxTlsSettings2[remoteNdx]['TrustedCN'];

                        // Update TLS settings. Enable on remote port only. If you enable on local port, the commit() will succeed but be ignored.
                        dev.consoleMsg("Enabling TLS on remote port...");
                        if (remoteNdx == 0) { dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[0], amtSwitchToTls, 0, 1, xxTlsSettings2[0]); }
                        else { dev.amtstack.Put('AMT_TLSSettingData', xxTlsSettings2[1], amtSwitchToTls, 0, 1, xxTlsSettings2[1]); }
                    });

                }, responses.Body['KeyPair']['ReferenceParameters']['SelectorSet']['Selector']['Value']);
            });
        } else {
            // TLS already enabled, update device in the database
            dev.consoleMsg("Intel AMT has TLS already enabled.");

            // Perform commit
            dev.taskCount = 1;
            amtPerformCommit(dev);
        }
    }

    function amtSwitchToTls(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed setup TLS (" + status + ")."); removeAmtDevice(dev, 26); return; }

        // Check if all the calls are done & perform a commit
        if ((--dev.setTlsSecurityPendingCalls) == 0) {
            dev.consoleMsg("Calling Commit...");
            amtPerformCommit(dev);
        }
    }

    function amtPerformCommit(dev) {
        dev.consoleMsg("Performing commit...");
        dev.amtstack.AMT_SetupAndConfigurationService_CommitChanges(null, function (stack, name, responses, status) {
            const dev = stack.dev;
            if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
            if (status != 200) { dev.consoleMsg("Failed perform commit (" + status + ")."); removeAmtDevice(dev, 27); return; }
            dev.consoleMsg("Commited, holding 5 seconds...");

            // Update the device state
            dev.aquired.tls = 1;
            dev.aquired.state = 2; // Activated
            dev.aquired.controlMode = 2; // Activated in ACM

            // Save activation data to amtactivation.log
            var domain = parent.config.domains[dev.domainid];
            obj.logAmtActivation(domain, { time: new Date(), action: 'acmactivate-bare-metal', domain: dev.domainid, amtUuid: dev.guid, newmebx: config.newmebxpassword, mesh: dev.meshid, amtRealm: dev.aquired.realm, amtver: dev.aquired.version, host: dev.aquired.host, ip: dev.addr, user: dev.aquired.user, pass: dev.aquired.pass, tls: dev.aquired.tls, tlshash: dev.aquired.hash });

            // Update device in the database
            if (UpdateDevice(dev) == false) return;

            // Switch our communications to TLS (Restart our management of this node)
            dev.switchToTls = 1;
            delete dev.tlsfail;

            // Wait 5 seconds before attempting to manage this device some more
            var f = function doManage() { if (isAmtDeviceValid(dev)) { devTaskCompleted(doManage.dev); } }
            f.dev = dev;
            setTimeout(f, 5000);
        });
    }


    //
    // Intel AMT Clock Syncronization
    //

    // Attempt to sync the Intel AMT clock if needed, call func back when done.
    // Care should be take not to have many pending WSMAN called when performing clock sync.
    function attemptSyncClock(dev, func) {
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        dev.taskCount = 1;
        dev.taskCompleted = func;
        dev.amtstack.AMT_TimeSynchronizationService_GetLowAccuracyTimeSynch(attemptSyncClockEx);
    }

    // Intel AMT clock query response
    function attemptSyncClockEx(stack, name, response, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to get clock (" + status + ")."); removeAmtDevice(dev, 17); return; }

        // Compute how much drift between Intel AMT and our clock.
        var t = new Date(), now = new Date();
        t.setTime(response.Body['Ta0'] * 1000);
        if (Math.abs(t - now) > 10000) { // If the Intel AMT clock is more than 10 seconds off, set it.
            dev.consoleMsg("Performing clock sync.");
            var Tm1 = Math.round(now.getTime() / 1000);
            dev.amtstack.AMT_TimeSynchronizationService_SetHighAccuracyTimeSynch(response.Body['Ta0'], Tm1, Tm1, attemptSyncClockSet);
        } else {
            // Clock is fine, we are done.
            devTaskCompleted(dev)
        }
    }

    // Intel AMT clock set response
    function attemptSyncClockSet(stack, name, responses, status) {
        const dev = stack.dev;
        if (isAmtDeviceValid(dev) == false) return; // Device no longer exists, ignore this request.
        if (status != 200) { dev.consoleMsg("Failed to sync clock (" + status + ")."); removeAmtDevice(dev, 18); }
        devTaskCompleted(dev)
    }


    //
    // Device Management Methods
    //

    // Do aggressive cleanup on the device
    function destroyDevice(dev) {
        delete obj.devices[dev.addr]; // Remove the device from the list of currently active devices.
        if (dev.amtstack != null) { delete dev.amtstack.dev; delete dev.amtstack; } // Clean up the AMT stack.
        for (var i in dev) { delete dev[i]; } // Aggressive cleanup or everything else.
    }

    // Update the device in the database and event any changes
    function UpdateDevice(dev) {
        // Check that the mesh exists
        const mesh = parent.webserver.meshes[dev.meshid];
        if (mesh == null) { destroyDevice(dev); return false; }

        // Get the node and change it if needed
        parent.db.Get(dev.nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length == 0)) {
                // Add a new device
                var devicename = dev.guid;
                if (dev.addr != dev.aquired.host) { devicename = dev.aquired.host.split('.')[0]; }
                var device = { type: 'node', _id: dev.nodeid, meshid: dev.meshid, name: devicename, host: dev.aquired.host, domain: dev.domainid, intelamt: { ver: dev.aquired.version, user: dev.aquired.user, pass: dev.aquired.pass, tls: dev.aquired.tls, state: 2, realm: dev.aquired.realm } };
                if (dev.aquired.hash != null) { device.intelamt.hash = dev.aquired.hash; }

                // Set Intel AMT flags
                // dev.aquired.controlMode // 1 = CCM, 2 = ACM
                // (node.intelamt.flags & 2) == CCM, (node.intelamt.flags & 4) == ACM
                if (dev.aquired.controlMode == 1) { device.intelamt.flags = 2; } // CCM
                if (dev.aquired.controlMode == 2) { device.intelamt.flags = 4; } // ACM

                parent.db.Set(device);

                // Event the new node
                parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(dev.meshid, [dev.nodeid]), obj, { etype: 'node', action: 'addnode', node: parent.webserver.CloneSafeNode(device), msgid: 84, msgArgs: [devicename, mesh.name], msg: 'Added device ' + devicename + ' to device group ' + mesh.name, domain: dev.domainid });
            } else {
                // Update an existing device
                const device = nodes[0];
                var changes = [], change = 0, log = 0;
                var domain = parent.config.domains[device.domain];
                if (domain == null) return false;

                // Check if anything changes
                if (device.intelamt == null) { device.intelamt = {}; }
                if ((typeof dev.aquired.version == 'string') && (dev.aquired.version != device.intelamt.ver)) { change = 1; log = 1; device.intelamt.ver = dev.aquired.version; changes.push('AMT version'); }
                if ((typeof dev.aquired.user == 'string') && (dev.aquired.user != device.intelamt.user)) { change = 1; log = 1; device.intelamt.user = dev.aquired.user; changes.push('AMT user'); }
                if ((typeof dev.aquired.pass == 'string') && (dev.aquired.pass != device.intelamt.pass)) { change = 1; log = 1; device.intelamt.pass = dev.aquired.pass; changes.push('AMT pass'); }
                if ((typeof dev.aquired.mpspass == 'string') && (dev.aquired.mpspass != device.intelamt.mpspass)) { change = 1; log = 1; device.intelamt.mpspass = dev.aquired.mpspass; changes.push('AMT MPS pass'); }
                if ((typeof dev.aquired.host == 'string') && (dev.aquired.host != device.intelamt.host)) { change = 1; log = 1; device.intelamt.host = dev.aquired.host; changes.push('AMT host'); }
                if ((typeof dev.aquired.realm == 'string') && (dev.aquired.realm != device.intelamt.realm)) { change = 1; log = 1; device.intelamt.realm = dev.aquired.realm; changes.push('AMT realm'); }
                if ((typeof dev.aquired.hash == 'string') && (dev.aquired.hash != device.intelamt.hash)) { change = 1; log = 1; device.intelamt.hash = dev.aquired.hash; changes.push('AMT hash'); }
                if ((typeof dev.aquired.tls == 'number') && (dev.aquired.tls != device.intelamt.tls)) { change = 1; log = 1; device.intelamt.tls = dev.aquired.tls; /*changes.push('AMT TLS');*/ }
                if ((typeof dev.aquired.state == 'number') && (dev.aquired.state != device.intelamt.state)) { change = 1; log = 1; device.intelamt.state = dev.aquired.state; changes.push('AMT state'); }

                // Intel AMT Warning Flags: 1 = Unknown credentials, 2 = Realm Mismatch, 4 = TLS Cert Mismatch, 8 = Trying credentials
                if ((typeof dev.aquired.warn == 'number')) { if ((dev.aquired.warn == 0) && (device.intelamt.warn != null)) { delete device.intelamt.warn; change = 1; } else if (dev.aquired.warn != device.intelamt.warn) { device.intelamt.warn = dev.aquired.warn; change = 1; } }

                // Update Intel AMT flags if needed
                // dev.aquired.controlMode // 1 = CCM, 2 = ACM
                // (node.intelamt.flags & 2) == CCM, (node.intelamt.flags & 4) == ACM
                var flags = 0;
                if (typeof device.intelamt.flags == 'number') { flags = device.intelamt.flags; }
                if (dev.aquired.controlMode == 1) { if ((flags & 4) != 0) { flags -= 4; } if ((flags & 2) == 0) { flags += 2; } } // CCM
                if (dev.aquired.controlMode == 2) { if ((flags & 4) == 0) { flags += 4; } if ((flags & 2) != 0) { flags -= 2; } } // ACM
                if (device.intelamt.flags != flags) { change = 1; log = 1; device.intelamt.flags = flags; changes.push('AMT flags'); }

                // If there are changes, event the new device
                if (change == 1) {
                    // Save to the database
                    parent.db.Set(device);

                    // Event the node change
                    var event = { etype: 'node', action: 'changenode', nodeid: device._id, domain: domain.id, node: parent.webserver.CloneSafeNode(device) };
                    if (changes.length > 0) { event.msg = 'Changed device ' + device.name + ' from group ' + mesh.name + ': ' + changes.join(', '); }
                    if ((log == 0) || ((obj.agentInfo) && (obj.agentInfo.capabilities) && (obj.agentInfo.capabilities & 0x20)) || (changes.length == 0)) { event.nolog = 1; } // If this is a temporary device, don't log changes
                    if (parent.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                    parent.DispatchEvent(parent.webserver.CreateMeshDispatchTargets(device.meshid, [device._id]), obj, event);
                }
            }
        });

        return true;
    }


    //
    // General Methods
    //

    // Log the Intel AMT activation operation in the domain log
    obj.logAmtActivation = function (domain, x) {
        if (x == null) return true;

        // Add the password to the Intel AMT list of UUID to passwords
        if ((typeof x.amtUuid == 'string') && (typeof x.password == 'string')) {
            if (parent.amtPasswords == null) { parent.amtPasswords = {}; }
            if (parent.amtPasswords[x.amtUuid] == null) {
                parent.amtPasswords[x.amtUuid] = [x.password]; // Add password to array
                parent.amtPasswords = parent.common.sortObj(parent.amtPasswords);
            } else {
                if (parent.amtPasswords[x.amtUuid].indexOf(x.password) == -1) {
                    parent.amtPasswords[x.amtUuid].unshift(x.password); // Add password at the start of the array
                    while (parent.amtPasswords[x.amtUuid].length > 3) { parent.amtPasswords[x.amtUuid].pop(); } // Only keep the 3 last passwords for any given device
                }
            }
        }

        // Append to the log file
        var logpath = null;
        if ((domain.amtacmactivation == null) || (domain.amtacmactivation.log == null) || (typeof domain.amtacmactivation.log != 'string')) {
            if (domain.id == '') { logpath = parent.path.join(obj.parent.datapath, 'amtactivation.log'); } else { logpath = parent.path.join(obj.parent.datapath, 'amtactivation-' + domain.id + '.log'); }
        } else {
            logpath = parent.common.joinPath(obj.parent.datapath, domain.amtacmactivation.log);
        }
        try { parent.fs.appendFileSync(logpath, JSON.stringify(x) + '\r\n'); } catch (ex) { console.log(ex); return false; }
        return true;
    }

    // Called this when a task is completed, when all tasks are completed the call back function will be called.
    function devTaskCompleted(dev) {
        dev.taskCount--;
        if (dev.taskCount == 0) { var f = dev.taskCompleted; delete dev.taskCount; delete dev.taskCompleted; if (f != null) { f(dev); } }
    }

    // Check which key pair matches the public key in the certificate
    function amtcert_linkCertPrivateKey(certs, keys) {
        for (var i in certs) {
            var cert = certs[i];
            try {
                if (keys.length == 0) return;
                var b = obj.parent.certificateOperations.forge.asn1.fromDer(cert.X509CertificateBin);
                var a = obj.parent.certificateOperations.forge.pki.certificateFromAsn1(b).publicKey;
                var publicKeyPEM = obj.parent.certificateOperations.forge.pki.publicKeyToPem(a).substring(28 + 32).replace(/(\r\n|\n|\r)/gm, "");
                for (var j = 0; j < keys.length; j++) {
                    if (publicKeyPEM === (keys[j]['DERKey'] + '-----END PUBLIC KEY-----')) {
                        keys[j].XCert = cert; // Link the key pair to the certificate
                        cert.XPrivateKey = keys[j]; // Link the certificate to the key pair
                    }
                }
            } catch (e) { console.log(e); }
        }
    }

    function isAmtDeviceValid(dev) { return (obj.devices[dev.addr] != null); }
    function getInstance(x, y) { for (var i in x) { if (x[i]['InstanceID'] == y) return x[i]; } return null; }
    function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
    function getRandomAmtPassword() { var p; do { p = Buffer.from(obj.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }
    function hex_md5(str) { return parent.crypto.createHash('md5').update(str).digest('hex'); }
    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    function parseCertName(x) {
        var j, r = {}, xx = x.split(',');
        for (var i in xx) { j = xx[i].indexOf('='); r[xx[i].substring(0, j)] = xx[i].substring(j + 1); }
        return r;
    }

    return obj;
};
