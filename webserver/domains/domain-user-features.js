/**
* @description Domain and user capability masks exposed to the web client
* @license Apache-2.0
*/

'use strict';

module.exports.createDomainUserFeatures = function (options) {
    const obj = options.state;
    const parent = options.parent;
    const ipcheck = options.ipcheck;

    return function getDomainUserFeatures(domain, user, req) {
        var features = 0;
        var features2 = 0;
        var features3 = 0;
        if (obj.args.wanonly == true) { features += 0x00000001; } // WAN-only mode
        if (obj.args.lanonly == true) { features += 0x00000002; } // LAN-only mode
        if (obj.args.nousers == true) { features += 0x00000004; } // Single user mode
        if (domain.userQuota == -1) { features += 0x00000008; } // No server files mode
        if (obj.args.mpstlsoffload) { features += 0x00000010; } // No mutual-auth CIRA
        if ((parent.config.settings.allowframing != null) || (domain.allowframing != null) || (parent.config.settings.allowedframingorigins != null) || (domain.allowedframingorigins != null)) { features += 0x00000020; } // Allow site within iframe
        if ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true)) { features += 0x00000040; } // Email invites
        if (obj.args.webrtc == true) { features += 0x00000080; } // Enable WebRTC (Default false for now)
        // 0x00000100 --> This feature flag is free for future use.
        if (obj.args.allowhighqualitydesktop !== false) { features += 0x00000200; } // Enable AllowHighQualityDesktop (Default true)
        if ((obj.args.lanonly == true) || (obj.args.mpsport == 0)) { features += 0x00000400; } // No CIRA
        if ((obj.parent.serverSelfWriteAllowed == true) && (user != null) && ((user.siteadmin & 0x00000010) != 0)) { features += 0x00000800; } // Server can self-write (Allows self-update)
        if ((parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (user._id.split('/')[2][0] != '~')) { features += 0x00001000; } // 2FA login supported
        if (domain.agentnoproxy === true) { features += 0x00002000; } // Indicates that agents should be installed without using a HTTP proxy
        if ((parent.config.settings.no2factorauth !== true) && domain.yubikey && domain.yubikey.id && domain.yubikey.secret && (user._id.split('/')[2][0] != '~')) { features += 0x00004000; } // Indicates Yubikey support
        if (domain.geolocation == true) { features += 0x00008000; } // Enable geo-location features
        if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { features += 0x00010000; } // Enable password hints
        if (parent.config.settings.no2factorauth !== true) { features += 0x00020000; } // Enable WebAuthn/FIDO2 support
        if ((obj.args.nousers != true) && (domain.passwordrequirements != null) && (domain.passwordrequirements.force2factor === true) && (user._id.split('/')[2][0] != '~')) {
            // Check if we can skip 2nd factor auth because of the source IP address
            var skip2factor = false;
            if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
                for (var i in domain.passwordrequirements.skip2factor) {
                    if (ipcheck.match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) { skip2factor = true; }
                }
            }
            if (skip2factor == false) { features += 0x00040000; } // Force 2-factor auth
        }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { features += 0x00080000; } // LDAP or SSPI in use, warn that users must login first before adding a user to a group.
        if (domain.amtacmactivation) { features += 0x00100000; } // Intel AMT ACM activation/upgrade is possible
        if (domain.usernameisemail) { features += 0x00200000; } // Username is email address
        if (parent.mqttbroker != null) { features += 0x00400000; } // This server supports MQTT channels
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null)) { features += 0x00800000; } // using email for 2FA is allowed
        if (domain.agentinvitecodes == true) { features += 0x01000000; } // Support for agent invite codes
        if (parent.smsserver != null) { features += 0x02000000; } // SMS messaging is supported
        if ((parent.smsserver != null) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false))) { features += 0x04000000; } // SMS 2FA is allowed
        if (domain.sessionrecording != null) { features += 0x08000000; } // Server recordings enabled
        if (domain.urlswitching === false) { features += 0x10000000; } // Disables the URL switching feature
        if (domain.novnc === false) { features += 0x20000000; } // Disables noVNC
        if (domain.mstsc === false) { features += 0x40000000; } // Disables MSTSC.js
        if (obj.isTrustedCert(domain) == false) { features += 0x80000000; } // Indicate we are not using a trusted certificate
        if (obj.parent.amtManager != null) { features2 += 0x00000001; } // Indicates that the Intel AMT manager is active
        if (obj.parent.firebase != null) { features2 += 0x00000002; } // Indicates the server supports Firebase push messaging
        if ((obj.parent.firebase != null) && (obj.parent.firebase.pushOnly != true)) { features2 += 0x00000004; } // Indicates the server supports Firebase two-way push messaging
        if (obj.parent.webpush != null) { features2 += 0x00000008; } // Indicates web push is enabled
        if (((obj.args.noagentupdate == 1) || (obj.args.noagentupdate == true))) { features2 += 0x00000010; } // No agent update
        if (parent.amtProvisioningServer != null) { features2 += 0x00000020; } // Intel AMT LAN provisioning server
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.push2factor != false)) && (obj.parent.firebase != null)) { features2 += 0x00000040; } // Indicates device push notification 2FA is enabled
        if ((typeof domain.passwordrequirements != 'object') || ((domain.passwordrequirements.logintokens !== false) && ((Array.isArray(domain.passwordrequirements.logintokens) == false) || ((domain.passwordrequirements.logintokens.indexOf(user._id) >= 0) || (user.links && Object.keys(user.links).some(key => domain.passwordrequirements.logintokens.indexOf(key) >= 0)) )))) { features2 += 0x00000080; } // Indicates login tokens are allowed
        if (req.session.loginToken != null) { features2 += 0x00000100; } // LoginToken mode, no account changes.
        if (domain.ssh == true) { features2 += 0x00000200; } // SSH is enabled
        if (domain.localsessionrecording === false) { features2 += 0x00000400; } // Disable local recording feature
        if (domain.clipboardget == false) { features2 += 0x00000800; } // Disable clipboard get
        if (domain.clipboardset == false) { features2 += 0x00001000; } // Disable clipboard set
        if ((typeof domain.desktop == 'object') && (domain.desktop.viewonly == true)) { features2 += 0x00002000; } // Indicates remote desktop is viewonly
        if (domain.mailserver != null) { features2 += 0x00004000; } // Indicates email server is active
        if (domain.devicesearchbarserverandclientname) { features2 += 0x00008000; } // Search bar will find both server name and client name
        if (domain.ipkvm) { features2 += 0x00010000; } // Indicates support for IP KVM device groups
        if ((domain.passwordrequirements) && (domain.passwordrequirements.otp2factor == false)) { features2 += 0x00020000; } // Indicates support for OTP 2FA is disabled
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.backupcode2factor === false)) { features2 += 0x00040000; } // Indicates 2FA backup codes are disabled
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.single2factorwarning === false)) { features2 += 0x00080000; } // Indicates no warning if a single 2FA is in use
        if (domain.nightmode === 1) { features2 += 0x00100000; } // Always night mode
        if (domain.nightmode === 2) { features2 += 0x00200000; } // Always day mode
        if (domain.allowsavingdevicecredentials == false) { features2 += 0x00400000; } // Do not allow device credentials to be saved on the server
        if ((typeof domain.files == 'object') && (domain.files.sftpconnect === false)) { features2 += 0x00800000; } // Remove the "SFTP Connect" button in the "Files" tab when the device is agent managed
        if ((typeof domain.terminal == 'object') && (domain.terminal.sshconnect === false)) { features2 += 0x01000000; } // Remove the "SSH Connect" button in the "Terminal" tab when the device is agent managed
        if ((parent.msgserver != null) && (parent.msgserver.providers != 0)) { features2 += 0x02000000; } // User messaging server is enabled
        if ((parent.msgserver != null) && (parent.msgserver.providers != 0) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false))) { features2 += 0x04000000; } // User messaging 2FA is allowed
        if (domain.scrolltotop == true) { features2 += 0x08000000; } // Show the "Scroll to top" button
        if (domain.devicesearchbargroupname === true) { features2 += 0x10000000; } // Search bar will find by group name too
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.duo2factor != false)) && (typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) { features2 += 0x20000000; } // using Duo for 2FA is allowed
        if (domain.showmodernuitoggle == true) { features2 += 0x40000000; } // Indicates that the new UI should be shown
        if (domain.sitestyle === 3) { features2 |= 0x80000000; } // Indicates that Modern UI is forced (siteStyle = 3)
        if ((typeof domain.desktop == 'object') && (domain.desktop.disableconnectall == true)) { features3 += 0x00000001; } // Disable "Connect All" button when multiple sessions are active on a device
        if (domain.upninsteadofuser === true) { features3 += 0x00000002; } // Show UPN instead of username in General tab
        return { features: features, features2: features2, features3: features3 };
    };

};
