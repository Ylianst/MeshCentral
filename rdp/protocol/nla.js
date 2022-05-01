const inherits = require('util').inherits;
const type = require('../core').type;
const events = require('events');
const crypto = require('crypto');
const forge = require('node-forge');
const asn1 = forge.asn1;
const pki = forge.pki;

/**
 * NLA layer of rdp stack
 */
function NLA(transport, nlaCompletedFunc, domain, user, password) {
    // Get NTLM ready
    const ntlm = Create_Ntlm();
    ntlm.domain = domain;
    ntlm.completedFunc = nlaCompletedFunc;
    ntlm.user = user;
    ntlm.password = password;
    ntlm.response_key_nt = ntowfv2(ntlm.password, ntlm.user, ntlm.domain);
    ntlm.response_key_lm = lmowfv2(ntlm.password, ntlm.user, ntlm.domain);
    this.ntlm = ntlm;
    this.state = 1;

    // Get transport ready
	this.transport = transport;
	// Wait 2 bytes
	this.transport.expect(2);
	// Next state is receive header
	var self = this;

	this.oldDataListeners = this.transport.listeners('data');
	this.oldCloseListeners = this.transport.listeners('close');
	this.oldErrorListeners = this.transport.listeners('error');

    // Unhook the previous transport handler
	this.transport.removeAllListeners('data');
	this.transport.removeAllListeners('close');
	this.transport.removeAllListeners('error');

    // Hook this module as the transport handler
    this.transport.once('data', function (s) {
        self.recvHeader(s);
    }).on('close', function () {
        self.emit('close');
    }).on('error', function (err) {
        self.emit('close'); // Errors occur when NLA authentication fails, for now, just close.
        //self.emit('error', err);
    });
}

/**
 * inherit from a packet layer
 */
inherits(NLA, events.EventEmitter);

/**
 * Receive correct packet as expected
 * @param s {type.Stream}
 */
NLA.prototype.recvHeader = function (s) {
    //console.log('NLA - recvHeader', s);
    var self = this;
    var derType = new type.UInt8().read(s).value;
    var derLen = new type.UInt8().read(s).value;
    self.buffers = [ s.buffer ];

    if (derLen < 128) {
        // wait for the entire data block
        this.transport.expect(derLen);
        this.transport.once('data', function (s) { self.recvData(s); });
    } else {
        // wait for the header size
        this.transport.expect(derLen - 128);
        this.transport.once('data', function (s) { self.recvHeaderSize(s); });
    }

    //console.log('NLA - DER', derType, derLen);
};

/**
 * Receive correct packet as expected
 * @param s {type.Stream}
 */
NLA.prototype.recvHeaderSize = function (s) {
    //console.log('NLA - recvHeaderSize', s.buffer.length);
    var self = this;
    self.buffers.push(s.buffer);
    if (s.buffer.length == 1) {
        // wait for the entire data block
        var derLen = s.buffer.readUInt8(0);
        this.transport.expect(derLen);
        this.transport.once('data', function (s) { self.recvData(s); });
    } else if (s.buffer.length == 2) {
        // wait for the entire data block
        var derLen = s.buffer.readUInt16BE(0);
        this.transport.expect(derLen);
        this.transport.once('data', function (s) { self.recvData(s); });
    }
}

/**
 * Receive correct packet as expected
 * @param s {type.Stream}
 */
NLA.prototype.recvData = function (s) {
    //console.log('NLA - recvData', s.buffer.length);
    var self = this;
    self.buffers.push(s.buffer);
    var entireBuffer = Buffer.concat(self.buffers);
    //console.log('entireBuffer', entireBuffer.toString('hex'));

    // We have a full ASN1 data block, decode it now
    const der = asn1.fromDer(entireBuffer.toString('binary'));
    const derNum = der.value[0].value[0].value.charCodeAt(0);
    //console.log('NLA - Number', derNum);

    if (derNum == 6) {
        if (this.state == 1) {
            const derBuffer = Buffer.from(der.value[1].value[0].value[0].value[0].value[0].value, 'binary');
            const client_challenge = read_challenge_message(this.ntlm, derBuffer);
            self.security_interface = build_security_interface(this.ntlm);
            const peer_cert = this.transport.secureSocket.getPeerCertificate();
            const challenge = create_ts_authenticate(client_challenge, self.security_interface.gss_wrapex(peer_cert.pubkey.slice(24)));
            this.ntlm.publicKeyDer = peer_cert.pubkey.slice(24);
            this.send(challenge);
            this.state = 2;
        } else if (this.state == 2) {
            const derBuffer = Buffer.from(der.value[1].value[0].value, 'binary');
            const publicKeyDer = self.security_interface.gss_unwrapex(derBuffer);

            // Check that the public key is identical except the first byte which is the DER encoding type.
            if (!this.ntlm.publicKeyDer.slice(1).equals(publicKeyDer.slice(1))) { console.log('RDP man-in-the-middle detected.'); close(); return; }
            delete this.ntlm.publicKeyDer; // Clean this up, we don't need it anymore.

            var xdomain, xuser, xpassword;
            if (this.ntlm.is_unicode) {
                xdomain = toUnicode(this.ntlm.domain);
                xuser = toUnicode(this.ntlm.user);
                xpassword = toUnicode(this.ntlm.password);
            } else {
                xdomain = Buffer.from(this.ntlm.domain, 'utf8');
                xuser = Buffer.from(this.ntlm.user, 'utf8');
                xpassword = Buffer.from(this.ntlm.password, 'utf8');
            }

            const credentials = create_ts_authinfo(self.security_interface.gss_wrapex(create_ts_credentials(xdomain, xuser, xpassword)));
            this.send(credentials);

            // Rehook the previous transport handler
            this.transport.removeAllListeners('data');
            this.transport.removeAllListeners('close');
            this.transport.removeAllListeners('error');

            for (var i in this.oldDataListeners) { this.transport.once('data', this.oldDataListeners[i]); }
            for (var i in this.oldCloseListeners) { this.transport.on('close', this.oldCloseListeners[i]); }
            for (var i in this.oldErrorListeners) { this.transport.on('error', this.oldErrorListeners[i]); }

            // Done!
            this.transport.expect(2);
            this.state = 3;
            this.ntlm.completedFunc();
            return;
        }
    }

    // Receive next block of data
    this.transport.expect(2);
    this.transport.once('data', function (s) { self.recvHeader(s); });
}


/**
 * Send message throught NLA layer
 * @param message {type.*}
 */
NLA.prototype.send = function (message) {
    this.transport.sendBuffer(message);
};

/**
 * close stack
 */
NLA.prototype.close = function() {
	this.transport.close();
};


NLA.prototype.sendNegotiateMessage = function () {
    // Create create_ts_request
    this.ntlm.negotiate_message = create_negotiate_message();
    const asn1obj =
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(2)),
            ]),
            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, this.ntlm.negotiate_message.toString('binary'))
                        ])
                    ])
                ])
            ])
        ]);

    // Serialize an ASN.1 object to DER format
    this.send(Buffer.from(asn1.toDer(asn1obj).data, 'binary'));
}

/**
 * Module exports
 */
module.exports = NLA;






const NegotiateFlags = {
    NtlmsspNegociate56: 0x80000000,
    NtlmsspNegociateKeyExch: 0x40000000,
    NtlmsspNegociate128: 0x20000000,
    NtlmsspNegociateVersion: 0x02000000,
    NtlmsspNegociateTargetInfo: 0x00800000,
    NtlmsspRequestNonNTSessionKey: 0x00400000,
    NtlmsspNegociateIdentify: 0x00100000,
    NtlmsspNegociateExtendedSessionSecurity: 0x00080000,
    NtlmsspTargetTypeServer: 0x00020000,
    NtlmsspTargetTypeDomain: 0x00010000,
    NtlmsspNegociateAlwaysSign: 0x00008000,
    NtlmsspNegociateOEMWorkstationSupplied: 0x00002000,
    NtlmsspNegociateOEMDomainSupplied: 0x00001000,
    NtlmsspNegociateNTLM: 0x00000200,
    NtlmsspNegociateLMKey: 0x00000080,
    NtlmsspNegociateDatagram: 0x00000040,
    NtlmsspNegociateSeal: 0x00000020,
    NtlmsspNegociateSign: 0x00000010,
    NtlmsspRequestTarget: 0x00000004,
    NtlmNegotiateOEM: 0x00000002,
    NtlmsspNegociateUnicode: 0x00000001
}

const MajorVersion = {
    WindowsMajorVersion5: 0x05,
    WindowsMajorVersion6: 0x06
}

const MinorVersion = {
    WindowsMinorVersion0: 0x00,
    WindowsMinorVersion1: 0x01,
    WindowsMinorVersion2: 0x02,
    WindowsMinorVersion3: 0x03
}

const NTLMRevision = {
    NtlmSspRevisionW2K3: 0x0F
}

function decodeTargetInfo(targetInfoBuf) {
    var r = {}, type, len, data, ptr = 0;
    while (true) {
        type = targetInfoBuf.readInt16LE(ptr);
        if (type == 0) break;
        len = targetInfoBuf.readInt16LE(ptr + 2);
        r[type] = targetInfoBuf.slice(ptr + 4, ptr + 4 + len);
        ptr += (4 + len);
    }
    return r;
}

function bufToArr(b) { var r = []; for (var i = 0; i < b.length; i++) { r.push(b.readUInt8(i)); } return r; } // For unit testing
function compareArray(a, b) { if (a.length != b.length) return false; for (var i = 0; i < a.length; i++) { if (a[i] != b[i]) return false; } return true; } // For unit testing
function toUnicode(str) { return Buffer.from(str, 'ucs2'); }
function md4(buffer) {
    try {
        return crypto.createHash('md4').update(buffer).digest(); // Built in NodeJS MD4, this does not work starting with NodeJS v17
    } catch (ex) {
        return Buffer.from(require('../security/md4').array(buffer.toString('binary'))); // This is the alternative if NodeJS does not support MD4
    }
}
function md5(str) { return crypto.createHash('md5').update(str).digest(); }
function hmac_md5(key, data) { return crypto.createHmac('md5', key).update(data).digest(); }
function ntowfv2(password, user, domain) { return hmac_md5(md4(toUnicode(password)), toUnicode(user.toUpperCase() + domain)); }
function lmowfv2(password, user, domain) { return ntowfv2(password, user, domain); }
function zeroBuffer(len) { return Buffer.alloc(len); }
function compute_response_v2(response_key_nt, response_key_lm, server_challenge, client_challenge, time, server_name) {
    const response_version = Buffer.from('01', 'hex');
    const hi_response_version = Buffer.from('01', 'hex');
    const temp = Buffer.concat([response_version, hi_response_version, zeroBuffer(6), time, client_challenge, zeroBuffer(4), server_name]);
    const nt_proof_str = hmac_md5(response_key_nt, Buffer.concat([server_challenge, temp]));
    const nt_challenge_response = Buffer.concat([nt_proof_str, temp]);
    const lm_challenge_response = Buffer.concat([hmac_md5(response_key_lm, Buffer.concat([server_challenge, client_challenge])), client_challenge]);
    const session_base_key = hmac_md5(response_key_nt, nt_proof_str);
    return [nt_challenge_response, lm_challenge_response, session_base_key];
}
function kx_key_v2(session_base_key, _lm_challenge_response, _server_challenge) { return session_base_key; }
function rc4k(key, data) { return createRC4(key).update(data); }

function createRC4(key) {
    const obj = {};
    try {
        obj.n = crypto.createCipheriv('rc4', key, null); // Built in NodeJS RC4, this does not work starting with NodeJS v17
        obj.update = function(x) { return obj.n.update(x); }
    } catch (ex) {
        const RC4 = require('../security/rc4'); // This is the alternative if NodeJS does not support RC4
        obj.r = new RC4(key.toString('binary'));
        obj.update = function (x) { return Buffer.from(obj.r.encrypt(x.toString('binary')), 'hex'); }
    }
    return obj;
}

function create_negotiate_message() {
    return negotiate_message(
        NegotiateFlags.NtlmsspNegociateKeyExch |
        NegotiateFlags.NtlmsspNegociate128 |
        NegotiateFlags.NtlmsspNegociateExtendedSessionSecurity |
        NegotiateFlags.NtlmsspNegociateAlwaysSign |
        NegotiateFlags.NtlmsspNegociateNTLM |
        NegotiateFlags.NtlmsspNegociateSeal |
        NegotiateFlags.NtlmsspNegociateSign |
        NegotiateFlags.NtlmsspRequestTarget |
        NegotiateFlags.NtlmsspNegociateUnicode, Buffer.alloc(0), Buffer.alloc(0)
    );
}

function negotiate_message(flags, domain, workstation) {
    const offset = ((flags & NegotiateFlags.NtlmsspNegociateVersion) == 0) ? 32 : 40;
    const buf = Buffer.alloc(offset);
    buf.write('4e544c4d53535000', 0, 8, 'hex'); // Signature (NTLMSP\0)
    buf.writeInt32LE(1, 8); // MessageType (1)
    buf.writeInt32LE(flags, 12); // Flags
    buf.writeInt16LE(domain.length, 16); // DomainNameLen
    buf.writeInt16LE(domain.length, 18); // DomainNameMaxLen
    if (domain.length > 0) { buf.writeInt32LE(offset, 20); } // DomainNameBufferOffset
    buf.writeInt16LE(workstation.length, 24); // WorkstationLen
    buf.writeInt16LE(workstation.length, 26); // WorkstationMaxLen
    if (workstation.length > 0) { buf.writeInt32LE(offset + domain.length, 28); } // WorkstationBufferOffset
    if ((flags & NegotiateFlags.NtlmsspNegociateVersion) != 0) {
        buf.writeUInt8(MajorVersion.WindowsMajorVersion6, 32); // ProductMajorVersion
        buf.writeUInt8(MinorVersion.WindowsMinorVersion0, 33); // ProductMinorVersion
        buf.writeInt16LE(6002, 34); // ProductBuild
        //buf.writeInt16LE(0, 36); // Reserved
        //buf.writeUInt8(0, 38); // Reserved
        buf.writeUInt8(NTLMRevision.NtlmSspRevisionW2K3, 39); // NTLMRevisionCurrent
    }
    return Buffer.concat([buf, domain, workstation]);
}

function mac(rc4_handle, signing_key, seq_num, data) {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(seq_num, 0);
    var signature = hmac_md5(signing_key, Buffer.concat([buf, data]));
    return message_signature_ex(rc4_handle.update(signature.slice(0, 8)), seq_num);
}

function message_signature_ex(check_sum, seq_num) {
    const buf = Buffer.alloc(16);
    buf.writeInt32LE(1, 0); // Version
    if (check_sum) { check_sum.copy(buf, 4, 0, 8); } // check_sum
    if (seq_num) { buf.writeInt32LE(seq_num, 12); } // seq_num
    return buf;
}

/// Compute a signature of all data exchange during NTLMv2 handshake
function mic(exported_session_key, negotiate_message, challenge_message, authenticate_message) { return hmac_md5(exported_session_key, Buffer.concat([negotiate_message, challenge_message, authenticate_message])); }

/// NTLMv2 security interface generate a sign key
/// By using MD5 of the session key + a static member (sentense)
function sign_key(exported_session_key, is_client) {
    if (is_client) {
        return md5(Buffer.concat([exported_session_key, Buffer.from("session key to client-to-server signing key magic constant\0")]));
    } else {
        return md5(Buffer.concat([exported_session_key, Buffer.from("session key to server-to-client signing key magic constant\0")]));
    }
}

/// NTLMv2 security interface generate a seal key
/// By using MD5 of the session key + a static member (sentense)
function seal_key(exported_session_key, is_client) {
    if (is_client) {
        return md5(Buffer.concat([exported_session_key, Buffer.from("session key to client-to-server sealing key magic constant\0")]));
    } else {
        return md5(Buffer.concat([exported_session_key, Buffer.from("session key to server-to-client sealing key magic constant\0")]));
    }
}

/// We are now able to build a security interface
/// that will be used by the CSSP manager to cipherring message (private keys)
/// To detect MITM attack
function build_security_interface(ntlm) {
    const obj = {};
    if (ntlm) {
        obj.signing_key = sign_key(ntlm.exported_session_key, true);
        obj.verify_key = sign_key(ntlm.exported_session_key, false);
        const client_sealing_key = seal_key(ntlm.exported_session_key, true);
        const server_sealing_key = seal_key(ntlm.exported_session_key, false);
        obj.encrypt = createRC4(client_sealing_key);
        obj.decrypt = createRC4(server_sealing_key);
    }
    obj.seq_num = 0;

    obj.gss_wrapex = function (data) {
        const encrypted_data = obj.encrypt.update(data);
        const signature = mac(obj.encrypt, obj.signing_key, obj.seq_num, data);
        obj.seq_num++;
        return Buffer.concat([signature, encrypted_data]);
    }

    obj.gss_unwrapex = function (data) {
        const version = data.readInt32LE(0);
        const checksum = data.slice(4, 12);
        const seqnum = data.readInt32LE(12);
        const payload = data.slice(16);
        const plaintext_payload = obj.decrypt.update(payload);
        const plaintext_checksum = obj.decrypt.update(checksum);
        const seqnumbuf = Buffer.alloc(4);
        seqnumbuf.writeInt32LE(seqnum, 0);
        const computed_checksum = hmac_md5(obj.verify_key, Buffer.concat([seqnumbuf, plaintext_payload])).slice(0, 8);
        if (!plaintext_checksum.equals(computed_checksum)) { console.log("Invalid checksum on NTLMv2"); }
        return plaintext_payload;
    }

    return obj;
}

function Create_Ntlm() {
    return {
        /// Microsoft Domain for Active Directory
        domain: "", //String,
        /// Username
        user: "", //String,
        /// Password
        password: "", // String,
        /// Key generated from NTLM hash
        response_key_nt: null, // Buffer
        /// Key generated from NTLM hash
        response_key_lm: null, // Buffer
        /// Keep trace of each messages to compute a final hash
        negotiate_message: null, // Buffer
        /// Key use to ciphering messages
        exported_session_key: crypto.randomBytes(16), // Buffer
        /// True if session use unicode
        is_unicode: false // Boolean
    }
}

function authenticate_message(lm_challenge_response, nt_challenge_response, domain, user, workstation, encrypted_random_session_key, flags) {
    const payload = Buffer.concat([lm_challenge_response, nt_challenge_response, domain, user, workstation, encrypted_random_session_key]);
    const offset = ((flags & NegotiateFlags.NtlmsspNegociateVersion) == 0) ? 80 : 88;
    const buf = Buffer.alloc(offset - 16);
    buf.write('4e544c4d53535000', 0, 8, 'hex'); // Signature
    buf.writeInt32LE(3, 8); // MessageType
    buf.writeInt16LE(lm_challenge_response.length, 12); // LmChallengeResponseLen
    buf.writeInt16LE(lm_challenge_response.length, 14); // LmChallengeResponseMaxLen
    buf.writeInt32LE(offset, 16); // LmChallengeResponseBufferOffset
    buf.writeInt16LE(nt_challenge_response.length, 20); // NtChallengeResponseLen
    buf.writeInt16LE(nt_challenge_response.length, 22); // NtChallengeResponseMaxLen
    buf.writeInt32LE(offset + lm_challenge_response.length, 24); // NtChallengeResponseBufferOffset
    buf.writeInt16LE(domain.length, 28); // DomainNameLen
    buf.writeInt16LE(domain.length, 30); // DomainNameMaxLen
    buf.writeInt32LE(offset + lm_challenge_response.length + nt_challenge_response.length, 32); // DomainNameBufferOffset
    buf.writeInt16LE(user.length, 36); // UserNameLen
    buf.writeInt16LE(user.length, 38); // UserNameMaxLen
    buf.writeInt32LE(offset + lm_challenge_response.length + nt_challenge_response.length + domain.length, 40); // UserNameBufferOffset
    buf.writeInt16LE(workstation.length, 44); // WorkstationLen
    buf.writeInt16LE(workstation.length, 46); // WorkstationMaxLen
    buf.writeInt32LE(offset + lm_challenge_response.length + nt_challenge_response.length + domain.length + user.length, 48); // WorkstationBufferOffset
    buf.writeInt16LE(encrypted_random_session_key.length, 52); // EncryptedRandomSessionLen
    buf.writeInt16LE(encrypted_random_session_key.length, 54); // EncryptedRandomSessionMaxLen
    buf.writeInt32LE(offset + lm_challenge_response.length + nt_challenge_response.length + domain.length + user.length + workstation.length, 56); // EncryptedRandomSessionBufferOffset
    buf.writeInt32LE(flags, 60); // NegotiateFlags
    if ((flags & NegotiateFlags.NtlmsspNegociateVersion) != 0) {
        buf.writeUInt8(MajorVersion.WindowsMajorVersion6, 64); // ProductMajorVersion
        buf.writeUInt8(MinorVersion.WindowsMinorVersion0, 65); // ProductMinorVersion
        buf.writeInt16LE(6002, 66); // ProductBuild
        //buf.writeInt16LE(0, 68); // Reserved
        //buf.writeUInt8(0, 70); // Reserved
        buf.writeUInt8(NTLMRevision.NtlmSspRevisionW2K3, 71); // NTLMRevisionCurrent
    }
    return [buf, payload];
}

function create_ts_authinfo(auth_info) {
    asn1obj =
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(2)),
        ]),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, auth_info.toString('binary'))
        ])
    ]);
    return Buffer.from(asn1.toDer(asn1obj).data, 'binary');
}

function create_ts_credentials(domain, user, password) {
    var asn1obj =
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, domain.toString('binary'))
        ]),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, user.toString('binary'))
        ]),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, password.toString('binary'))
        ])
    ]);
    const ts_password_cred_encoded = asn1.toDer(asn1obj).data;
    asn1obj =
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1)),
        ]),
        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, ts_password_cred_encoded)
        ])
    ]);
    return Buffer.from(asn1.toDer(asn1obj).data, 'binary');
}

function create_ts_authenticate(nego, pub_key_auth) {
    // Create create_ts_request
    const asn1obj =
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(2)),
            ]),
            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, nego.toString('binary'))
                        ])
                    ])
                ])
            ]),
            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 3, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, pub_key_auth.toString('binary'))
            ]),
        ]);

    // Serialize an ASN.1 object to DER format
    return Buffer.from(asn1.toDer(asn1obj).data, 'binary');
}

function read_challenge_message(ntlm, derBuffer) {

    //console.log('ntlm.negotiate_message', ntlm.negotiate_message.toString('hex'));
    //ntlm.negotiate_message = Buffer.from('4e544c4d53535000010000003582086000000000000000000000000000000000', 'hex');

    // ********
    //ntlm.exported_session_key = Buffer.from('9a1ed052e932834a311daf90c2750219', 'hex'); // *************************
    //derBuffer = Buffer.from('4e544c4d53535000020000000e000e003800000035828a6259312ef59a4517dd000000000000000058005800460000000a00614a0000000f430045004e005400520041004c0002000e00430045004e005400520041004c0001000e00430045004e005400520041004c0004000e00430065006e007400720061006c0003000e00430065006e007400720061006c00070008007b7b3bee9e5ad80100000000', 'hex');

    //console.log("YST: read_challenge_message1: ", derBuffer.toString('hex'));

    const headerSignature = derBuffer.slice(0, 8);
    if (headerSignature.toString('hex') != '4e544c4d53535000') { console.log('BAD SIGNATURE'); }
    const messageType = derBuffer.readInt32LE(8);
    if (messageType != 2) { console.log('BAD MESSAGE TYPE'); }
    const targetNameLen = derBuffer.readInt16LE(12);
    const targetNameLenMax = derBuffer.readInt16LE(14);
    const targetNameBufferOffset = derBuffer.readInt32LE(16);
    const negotiateFlags = derBuffer.readInt32LE(20);
    const serverChallenge = derBuffer.slice(24, 32);
    const reserved = derBuffer.slice(32, 40);
    if (reserved.toString('hex') != '0000000000000000') { console.log('BAD RESERVED'); }
    const targetInfoLen = derBuffer.readInt16LE(40);
    const targetInfoLenMax = derBuffer.readInt16LE(42);
    const targetInfoBufferOffset = derBuffer.readInt32LE(44);
    const targetName = derBuffer.slice(targetNameBufferOffset, targetNameBufferOffset + targetNameLen);
    const targetInfoBuf = derBuffer.slice(targetInfoBufferOffset, targetInfoBufferOffset + targetInfoLen);
    const targetInfo = decodeTargetInfo(derBuffer.slice(targetInfoBufferOffset, targetInfoBufferOffset + targetInfoLen));
    const timestamp = targetInfo[7];
    //const timestamp = Buffer.from('7b7b3bee9e5ad801', 'hex'); // **************
    if (timestamp == null) { console.log('NO TIMESTAMP'); }
    const clientChallenge = crypto.randomBytes(8);
    //const clientChallenge = Buffer.from('10aac9679ef64e66', 'hex'); // *****************************
    const response_key_nt = ntowfv2(ntlm.password, ntlm.user, ntlm.domain); // Password, Username, Domain
    const response_key_lm = lmowfv2(ntlm.password, ntlm.user, ntlm.domain); // Password, Username, Domain

    //console.log("YST: target_name:", targetInfoBuf.toString('hex'));
    //console.log("YST: timestamp:", timestamp.toString('hex'));
    //console.log('YST: client_challenge:', clientChallenge.toString('hex'));
    //console.log("YST: response_key_nt:", response_key_nt.toString('hex'));
    //console.log("YST: response_key_lm:", response_key_lm.toString('hex'));

    var resp = compute_response_v2(response_key_nt, response_key_lm, serverChallenge, clientChallenge, timestamp, targetInfoBuf);
    const nt_challenge_response = resp[0];
    const lm_challenge_response = resp[1];
    const session_base_key = resp[2];

    //console.log('YST: nt_challenge_response:', nt_challenge_response.toString('hex'));
    //console.log('YST: lm_challenge_response:', lm_challenge_response.toString('hex'));
    //console.log("YST: session_base_key:", session_base_key.toString('hex'));

    const key_exchange_key = kx_key_v2(session_base_key, lm_challenge_response, serverChallenge);
    const encrypted_random_session_key = rc4k(key_exchange_key, ntlm.exported_session_key);

    //console.log("YST: key_exchange_key:", key_exchange_key.toString('hex'));
    //console.log("YST: self.exported_session_key:", ntlm.exported_session_key.toString('hex'));
    //console.log("YST: encrypted_random_session_key:", encrypted_random_session_key.toString('hex'));

    ntlm.is_unicode = ((negotiateFlags & 1) != 0)
    //console.log("YST: self.is_unicode: {}", ntlm.is_unicode);
    var xdomain = null;
    var xuser = null;
    if (ntlm.is_unicode) {
        xdomain = toUnicode(ntlm.domain);
        xuser = toUnicode(ntlm.user);
    } else {
        xdomain = Buffer.from(ntlm.domain, 'utf8');
        xuser = Buffer.from(ntlm.user, 'utf8');
    }

    //console.log("YST: domain:", xdomain.toString('hex'));
    //console.log("YST: user:", xuser.toString('hex'));

    const auth_message_compute = authenticate_message(lm_challenge_response, nt_challenge_response, xdomain, xuser, zeroBuffer(0), encrypted_random_session_key, negotiateFlags);

    // Write a tmp message to compute MIC and then include it into final message
    const tmp_final_auth_message = Buffer.concat([auth_message_compute[0], zeroBuffer(16), auth_message_compute[1]]);

    //console.log("YST: tmp_final_auth_message: {}", tmp_final_auth_message.toString('hex'));

    const signature = mic(ntlm.exported_session_key, ntlm.negotiate_message, derBuffer, tmp_final_auth_message);

    //console.log("YST: signature: {}", signature.toString('hex'));

    const r = Buffer.concat([auth_message_compute[0], signature, auth_message_compute[1]]);

    //console.log("YST: read_challenge_message2: {}", r.toString('hex'));

    return r;
}

function unitTest() {
    console.log('--- Starting RDP NLA Unit Tests');

    // Test format of the first client message
    var r = create_negotiate_message();
    console.log(compareArray(bufToArr(r), [78, 84, 76, 77, 83, 83, 80, 0, 1, 0, 0, 0, 53, 130, 8, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) ? "negotiate_message passed." : "negotiate_message failed.");

    // Test of MD4 hash function
    r = md4(Buffer.from("foo"));
    console.log(compareArray(bufToArr(r), [0x0a, 0xc6, 0x70, 0x0c, 0x49, 0x1d, 0x70, 0xfb, 0x86, 0x50, 0x94, 0x0b, 0x1c, 0xa1, 0xe4, 0xb2]) ? "RC4 passed." : "RC4 failed.");

    // Test of the unicode function
    r = toUnicode("foo");
    console.log(compareArray(bufToArr(r), [0x66, 0x00, 0x6f, 0x00, 0x6f, 0x00]) ? "Unicode passed." : "Unicode failed.");

    // Test HMAC_MD5 function
    r = hmac_md5(Buffer.from("foo"), Buffer.from("bar"));
    console.log(compareArray(bufToArr(r), [0x0c, 0x7a, 0x25, 0x02, 0x81, 0x31, 0x5a, 0xb8, 0x63, 0x54, 0x9f, 0x66, 0xcd, 0x8a, 0x3a, 0x53]) ? "HMAC_MD5 passed." : "HMAC_MD5 failed.");

    // Test NTOWFv2 function
    r = ntowfv2("foo", "user", "domain");
    console.log(compareArray(bufToArr(r), [0x6e, 0x53, 0xb9, 0x0, 0x97, 0x8c, 0x87, 0x1f, 0x91, 0xde, 0x6, 0x44, 0x9d, 0x8b, 0x8b, 0x81]) ? "NTOWFv2 passed." : "NTOWFv2 failed.");

    // Test LMOWFv2 function
    r = ntowfv2("foo", "user", "domain");
    console.log(compareArray(bufToArr(r), ntowfv2("foo", "user", "domain")) ? "LMOWFv2 passed." : "LMOWFv2 failed.");

    // Test compute response v2 function
    r = compute_response_v2(Buffer.from("a"), Buffer.from("b"), Buffer.from("c"), Buffer.from("d"), Buffer.from("e"), Buffer.from("f"));
    console.log(compareArray(bufToArr(r[0]), [0xb4, 0x23, 0x84, 0xf, 0x6e, 0x83, 0xc1, 0x5a, 0x45, 0x4f, 0x4c, 0x92, 0x7a, 0xf2, 0xc3, 0x3e, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x65, 0x64, 0x0, 0x0, 0x0, 0x0, 0x66]) ? "responsev2 1 passed." : "responsev2 1 failed.");
    console.log(compareArray(bufToArr(r[1]), [0x56, 0xba, 0xff, 0x2d, 0x98, 0xbe, 0xcd, 0xa5, 0x6d, 0xe6, 0x17, 0x89, 0xe1, 0xed, 0xca, 0xae, 0x64]) ? "responsev2 2 passed." : "responsev2 2 failed.");
    console.log(compareArray(bufToArr(r[2]), [0x40, 0x3b, 0x33, 0xe5, 0x24, 0x34, 0x3c, 0xc3, 0x24, 0xa0, 0x4d, 0x77, 0x75, 0x34, 0xa4, 0xd0]) ? "responsev2 3 passed." : "responsev2 3 failed.");

    // Test of rc4k function
    r = rc4k(Buffer.from("foo"), Buffer.from("bar"));
    console.log(compareArray(bufToArr(r), [201, 67, 159]) ? "rc4k passed." : "rc4k failed.");

    // Test of sign_key function
    r = sign_key(Buffer.from("foo"), true);
    console.log(compareArray(bufToArr(r), [253, 238, 149, 155, 221, 78, 43, 179, 82, 61, 111, 132, 168, 68, 222, 15]) ? "sign_key 1 passed." : "sign_key 1 failed.");
    r = sign_key(Buffer.from("foo"), false);
    console.log(compareArray(bufToArr(r), [90, 201, 12, 225, 140, 156, 151, 61, 156, 56, 31, 254, 10, 223, 252, 74]) ? "sign_key 2 passed." : "sign_key 2 failed.");

    // Test of seal_key function
    r = seal_key(Buffer.from("foo"), true);
    console.log(compareArray(bufToArr(r), [20, 213, 185, 176, 168, 142, 134, 244, 36, 249, 89, 247, 180, 36, 162, 101]) ? "seal_key 1 passed." : "seal_key 1 failed.");
    r = seal_key(Buffer.from("foo"), false);
    console.log(compareArray(bufToArr(r), [64, 125, 160, 17, 144, 165, 62, 226, 22, 125, 128, 31, 103, 141, 55, 40]) ? "seal_key 2 passed." : "seal_key 2 failed.");

    // Test signature function
    var rc4 = createRC4(Buffer.from("foo"));
    r = mac(rc4, Buffer.from("bar"), 0, Buffer.from("data"));
    console.log(compareArray(bufToArr(r), [1, 0, 0, 0, 77, 211, 144, 84, 51, 242, 202, 176, 0, 0, 0, 0]) ? "Signature passed." : "Signature failed.");

    // Test challenge message
    r = authenticate_message(Buffer.from("foo"), Buffer.from("foo"), Buffer.from("domain"), Buffer.from("user"), Buffer.from("workstation"), Buffer.from("foo"), 0);
    var buf = Buffer.concat([r[0], Buffer.alloc(16), r[1]]);
    console.log(compareArray(bufToArr(buf), [78, 84, 76, 77, 83, 83, 80, 0, 3, 0, 0, 0, 3, 0, 3, 0, 80, 0, 0, 0, 3, 0, 3, 0, 83, 0, 0, 0, 6, 0, 6, 0, 86, 0, 0, 0, 4, 0, 4, 0, 92, 0, 0, 0, 11, 0, 11, 0, 96, 0, 0, 0, 3, 0, 3, 0, 107, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 102, 111, 111, 102, 111, 111, 100, 111, 109, 97, 105, 110, 117, 115, 101, 114, 119, 111, 114, 107, 115, 116, 97, 116, 105, 111, 110, 102, 111, 111]) ? "Challenge message passed." : "Challenge message failed.");

    // Test RC4
    rc4 = createRC4(Buffer.from("foo"));
    r = rc4.update(Buffer.from("bar"));
    console.log(compareArray(bufToArr(r), [201, 67, 159]) ? "RC4 1 passed." : "RC4 1 failed.");
    r = rc4.update(Buffer.from("bar"));
    console.log(compareArray(bufToArr(r), [75, 169, 19]) ? "RC4 2 passed." : "RC4 2 failed.");

    // Test create_ts_authenticate
    r = create_ts_authenticate(Buffer.from("000102", 'hex'), Buffer.from("000102", 'hex'));
    console.log(compareArray(bufToArr(r), [48, 25, 160, 3, 2, 1, 2, 161, 11, 48, 9, 48, 7, 160, 5, 4, 3, 0, 1, 2, 163, 5, 4, 3, 0, 1, 2]) ? "create_ts_authenticate passed." : "create_ts_authenticate failed.");

    // Test test_create_ts_credentials
    r = create_ts_credentials(Buffer.from("domain"), Buffer.from("user"), Buffer.from("password"));
    console.log(compareArray(bufToArr(r), [48, 41, 160, 3, 2, 1, 1, 161, 34, 4, 32, 48, 30, 160, 8, 4, 6, 100, 111, 109, 97, 105, 110, 161, 6, 4, 4, 117, 115, 101, 114, 162, 10, 4, 8, 112, 97, 115, 115, 119, 111, 114, 100]) ? "test_create_ts_credentials passed." : "test_create_ts_credentials failed.");
    
    // Test create_ts_authinfo
    r = create_ts_authinfo(Buffer.from("foo"));
    console.log(compareArray(bufToArr(r), [48, 12, 160, 3, 2, 1, 2, 162, 5, 4, 3, 102, 111, 111]) ? "create_ts_authinfo passed." : "create_ts_authinfo failed.");

    console.log('--- RDP NLA Unit Tests Completed');
}