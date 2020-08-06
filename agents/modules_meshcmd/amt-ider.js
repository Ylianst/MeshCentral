/** 
* @description IDER Handling Module
* @author Ylian Saint-Hilaire
*/

// meshservice meshcmd.js amtider --host 192.168.2.186 --pass P@ssw0rd --floppy msdos.img

// Construct a Intel AMT IDER object
module.exports = function CreateAmtRemoteIder() {
    var obj = {};
    obj.protocol = 3; // IDER
    obj.bytesToAmt = 0;
    obj.bytesFromAmt = 0;
    obj.rx_timeout = 30000;     // Default 30000
    obj.tx_timeout = 0;         // Default 0
    obj.heartbeat = 20000;      // Default 20000
    obj.version = 1;
    obj.acc = null;
    obj.inSequence = 0;
    obj.outSequence = 0;
    obj.iderinfo = null;
    obj.enabled = false;
    obj.iderStart = 0; // OnReboot = 0, Graceful = 1, Now = 2
    obj.floppy = null;
    obj.cdrom = null;
    obj.floppyReady = false;
    obj.cdromReady = false;
    //obj.pingTimer = null;
    obj.sectorStats = null;
    obj.debug = false;

    // Mode Sense
    var IDE_ModeSence_LS120Disk_Page_Array = Buffer.from([0x00, 0x26, 0x31, 0x80, 0x00, 0x00, 0x00, 0x00, 0x05, 0x1E, 0x10, 0xA9, 0x08, 0x20, 0x02, 0x00, 0x03, 0xC3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xD0, 0x00, 0x00]);
    var IDE_ModeSence_3F_LS120_Array = Buffer.from([0x00, 0x5c, 0x24, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x0a, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x16, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x12, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x05, 0x1E, 0x10, 0xA9, 0x08, 0x20, 0x02, 0x00, 0x03, 0xC3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xD0, 0x00, 0x00, 0x08, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x06, 0x00, 0x00, 0x00, 0x11, 0x24, 0x31]);
    var IDE_ModeSence_FloppyDisk_Page_Array = Buffer.from([0x00, 0x26, 0x24, 0x80, 0x00, 0x00, 0x00, 0x00, 0x05, 0x1E, 0x04, 0xB0, 0x02, 0x12, 0x02, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xD0, 0x00, 0x00]);
    var IDE_ModeSence_3F_Floppy_Array = Buffer.from([0x00, 0x5c, 0x24, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x0a, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x16, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x12, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x05, 0x1e, 0x04, 0xb0, 0x02, 0x12, 0x02, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xd0, 0x00, 0x00, 0x08, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x06, 0x00, 0x00, 0x00, 0x11, 0x24, 0x31]);
    var IDE_ModeSence_CD_1A_Array = Buffer.from([0x00, 0x12, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    //var IDE_ModeSence_CD_1B_Array = Buffer.from([0x00, 0x12, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x1B, 0x0A, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    var IDE_ModeSence_CD_1D_Array = Buffer.from([0x00, 0x12, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x1D, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    var IDE_ModeSence_CD_2A_Array = Buffer.from([0x00, 0x20, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x2a, 0x18, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    //var IDE_ModeSence_CD_01_Array = Buffer.from([0x00, 0x0E, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00]);
    var IDE_ModeSence_3F_CD_Array = Buffer.from([0x00, 0x28, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x2a, 0x18, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    // 0x46 constant data
    var IDE_CD_ConfigArrayHeader = Buffer.from([0x00, 0x00,0x00, 0x28, 0x00, 0x00, 0x00, 0x08]);
    var IDE_CD_ConfigArrayProfileList = Buffer.from([0x00, 0x00, 0x03, 0x04, 0x00, 0x08, 0x01, 0x00]);
    var IDE_CD_ConfigArrayCore = Buffer.from([0x00, 0x01, 0x03, 0x04, 0x00, 0x00, 0x00, 0x02]);
    var IDE_CD_Morphing = Buffer.from([0x00, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    var IDE_CD_ConfigArrayRemovable = Buffer.from([0x00, 0x03, 0x03, 0x04, 0x29, 0x00, 0x00, 0x02]);
    var IDE_CD_ConfigArrayRandom = Buffer.from([0x00, 0x10, 0x01, 0x08, 0x00, 0x00, 0x08, 0x00, 0x00, 0x01, 0x00, 0x00]);
    var IDE_CD_Read = Buffer.from([0x00, 0x1E, 0x03, 0x00]);
    var IDE_CD_PowerManagement = Buffer.from([0x01, 0x00, 0x03, 0x00]);
    var IDE_CD_Timeout = Buffer.from([0x01, 0x05, 0x03, 0x00]);

    // 0x01 constant data
    var IDE_ModeSence_FloppyError_Recovery_Array = Buffer.from([0x00, 0x12, 0x24, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x0A, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
    var IDE_ModeSence_Ls120Error_Recovery_Array = Buffer.from([0x00, 0x12, 0x31, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x0A, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
    var IDE_ModeSence_CDError_Recovery_Array = Buffer.from([0x00, 0x0E, 0x01, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x00]);


    // Private method, called by parent when it change state
    obj.xxStateChange = function (newstate) {
        if (obj.debug) console.log("IDER-StateChange", newstate);
        if (newstate == 0) { obj.Stop(); }
        if (newstate == 3) { obj.Start(); }
    }

    obj.Start = function () {
        if (obj.debug) { console.log("IDER-Start"); console.log(obj.floppy, obj.cdrom); }
        obj.bytesToAmt = 0;
        obj.bytesFromAmt = 0;
        obj.inSequence = 0;
        obj.outSequence = 0;
        g_readQueue = [];

        // Send first command, OPEN_SESSION
        obj.SendCommand(0x40, Buffer.concat([ ShortToStrX(obj.rx_timeout), ShortToStrX(obj.tx_timeout), ShortToStrX(obj.heartbeat), IntToStrX(obj.version) ]));

        // Send sector stats
        if (obj.sectorStats) {
            obj.sectorStats(0, 0, obj.floppy ? (obj.floppy.size >> 9) : 0);
            obj.sectorStats(0, 1, obj.cdrom ? (obj.cdrom.size >> 11) : 0);
        }

        // Setup the ping timer
        //obj.pingTimer = setInterval(function () { obj.SendCommand(0x44); }, 5000);
    }

    obj.Stop = function () {
        if (obj.debug) console.log("IDER-Stop");
        //if (obj.pingTimer) { clearInterval(obj.pingTimer); obj.pingTimer = null; }
        obj.parent.Stop();
    }

    // Private method
    obj.ProcessData = function (data) {
        obj.bytesFromAmt += data.length;
        if (obj.acc == null) { obj.acc = data; } else { obj.acc = Buffer.concat(obj.acc, data); }
        if (obj.debug) console.log('IDER-ProcessData', obj.acc.length, obj.acc.toString('hex'));

        // Process as many commands as possible
        while (obj.acc != null) {
            var len = obj.ProcessDataEx();
            if (len == 0) return;
            if (obj.inSequence != ReadIntX(obj.acc, 4)) {
                if (obj.debug) console.log('ERROR: Out of sequence', obj.inSequence, ReadIntX(obj.acc, 4));
                obj.Stop();
                return;
            }
            obj.inSequence++;
            if (len == obj.acc.length) { obj.acc = null; } else { obj.acc = obj.acc.slice(len); }
        }
    }

    // Private method
    obj.SendCommand = function (cmdid, data, completed, dma) {
        if (data == null) { data = Buffer.alloc(0); }
        var attributes = ((cmdid > 50) && (completed == true)) ? 2 : 0;
        if (dma) { attributes += 1; }
        var x = Buffer.concat([Buffer([cmdid, 0, 0, attributes]), IntToStrX(obj.outSequence++), data]);
        obj.parent.xxSend(x);
        obj.bytesToAmt += x.length;
        //if (cmdid != 0x4B) { console.log('IDER-SendData', x.length, x.toString('hex')); }
    }

    // CommandEndResponse (SCSI_SENSE)
    obj.SendCommandEndResponse = function (error, sense, device, asc, asq) {
        if (error) { obj.SendCommand(0x51, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc5, 0, 3, 0, 0, 0, device, 0x50, 0, 0, 0]), true); }
        else { obj.SendCommand(0x51, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x87, (sense << 4), 3, 0, 0, 0, device, 0x51, sense, asc, asq]), true); }
    }

    // DataToHost (SCSI_READ)
    obj.SendDataToHost = function (device, completed, data, dma) {
        var dmalen = (dma) ? 0 : data.length;
        if (completed == true) {
            obj.SendCommand(0x54, Buffer.concat([Buffer.from([0, (data.length & 0xff), (data.length >> 8), 0, dma ? 0xb4 : 0xb5, 0, 2, 0, (dmalen & 0xff), (dmalen >> 8), device, 0x58, 0x85, 0, 3, 0, 0, 0, device, 0x50, 0, 0, 0, 0, 0, 0]), data ]), completed, dma);
        } else {
            obj.SendCommand(0x54, Buffer.concat([Buffer.from([0, (data.length & 0xff), (data.length >> 8), 0, dma ? 0xb4 : 0xb5, 0, 2, 0, (dmalen & 0xff), (dmalen >> 8), device, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), data]), completed, dma);
        }
    }

    // GetDataFromHost (SCSI_CHUNK)
    obj.SendGetDataFromHost = function (device, chunksize) {
        obj.SendCommand(0x52, Buffer.from([0, (chunksize & 0xff), (chunksize >> 8), 0, 0xb5, 0, 0, 0, (chunksize & 0xff), (chunksize >> 8), device, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), false);
    }

    // DisableEnableFeatures (STATUS_DATA)
    // If type is REGS_TOGGLE (3), 4 bytes of data must be provided.
    obj.SendDisableEnableFeatures = function (type, data) { if (data == null) { data = ''; } obj.SendCommand(0x48, Buffer.concat([Buffer.from([type]), data])); }

    // Private method
    obj.ProcessDataEx = function () {
        if (obj.acc.length < 8) return 0;

        // First 8 bytes are the header
        // CommandID + 0x000000 + Sequence Number
        //console.log('ProcessDataEx', obj.acc[0]);

        switch(obj.acc[0]) {
            case 0x41: // OPEN_SESSION
                if (obj.acc.length < 30) return 0;
                var len = obj.acc[29];
                if (obj.acc.length < (30 + len)) return 0;
                obj.iderinfo = {};
                obj.iderinfo.major = obj.acc[8];
                obj.iderinfo.minor = obj.acc[9];
                obj.iderinfo.fwmajor = obj.acc[10];
                obj.iderinfo.fwminor = obj.acc[11];
                obj.iderinfo.readbfr = ReadShortX(obj.acc, 16);
                obj.iderinfo.writebfr = ReadShortX(obj.acc, 18);
                obj.iderinfo.proto = obj.acc[21];
                obj.iderinfo.iana = ReadIntX(obj.acc, 25);
                if (obj.debug) console.log(obj.iderinfo);

                if (obj.iderinfo.proto != 0) {
                    if (obj.debug) console.log("Unknown proto", obj.iderinfo.proto);
                    obj.Stop();
                }
                if (obj.iderinfo.readbfr > 8192) {
                    if (obj.debug) console.log("Illegal read buffer size", obj.iderinfo.readbfr);
                    obj.Stop();
                }
                if (obj.iderinfo.writebfr > 8192) {
                    if (obj.debug) console.log("Illegal write buffer size", obj.iderinfo.writebfr);
                    obj.Stop();
                }

                if (obj.iderStart == 0) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x08)); } // OnReboot
                else if (obj.iderStart == 1) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x10)); } // Graceful
                else if (obj.iderStart == 2) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x18)); } // Now
                //obj.SendDisableEnableFeatures(1); // GetSupportedFeatures
                return 30 + len;
            case 0x43: // CLOSE
                if (obj.debug) console.log('CLOSE');
                obj.Stop();
                return 8;
            case 0x44: // KEEPALIVEPING
                obj.SendCommand(0x45); // Send PONG back
                return 8;
            case 0x45: // KEEPALIVEPONG
                if (obj.debug) console.log('PONG');
                return 8;
            case 0x46: // RESETOCCURED
                if (obj.acc.length < 9) return 0;
                var resetMask = obj.acc[8];
                if (g_media === null) {
                    // No operations are pending
                    obj.SendCommand(0x47); // Send ResetOccuredResponse
                    if (obj.debug) console.log('RESETOCCURED1', resetMask);
                } else {
                    // Operations are being done, sent the reset once completed.
                    g_reset = true;
                    if (obj.debug) console.log('RESETOCCURED2', resetMask);
                }
                return 9;
            case 0x49: // STATUS_DATA - DisableEnableFeaturesReply
                if (obj.acc.length < 13) return 0;
                var type = obj.acc[8];
                var value = ReadIntX(obj.acc, 9);
                if (obj.debug) console.log('STATUS_DATA', type, value);
                switch (type)
                {
                    case 1: // REGS_AVAIL
                        if (value & 1) {
                            if (obj.iderStart == 0) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x08)); } // OnReboot
                            else if (obj.iderStart == 1) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x10)); } // Graceful
                            else if (obj.iderStart == 2) { obj.SendDisableEnableFeatures(3, IntToStrX(0x01 + 0x18)); } // Now
                        }
                        break;
                    case 2: // REGS_STATUS
                        obj.enabled = (value & 2) ? true : false;
                        if (obj.debug) console.log("IDER Status: " + obj.enabled);
                        break;
                    case 3: // REGS_TOGGLE
                        if (value != 1) {
                            if (obj.debug) console.log("Register toggle failure");
                        } //else { obj.SendDisableEnableFeatures(2); }
                        break;
                }
                return 13;
            case 0x4A: // ERROR OCCURED
                if (obj.acc.length < 11) return 0;
                if (obj.debug) console.log('IDER: ABORT', obj.acc[8]);
                //obj.Stop();
                return 11;
            case 0x4B: // HEARTBEAT
                //console.log('HEARTBEAT');
                return 8;
            case 0x50: // COMMAND WRITTEN
                if (obj.acc.length < 28) return 0;
                var device = (obj.acc[14] & 0x10) ? 0xB0 : 0xA0;
                var deviceFlags = obj.acc[14];
                var cdb = obj.acc.slice(16, 28);
                var featureRegister = obj.acc[9];
                if (obj.debug) console.log('SCSI_CMD', device, cdb.toString('hex'), featureRegister, deviceFlags);
                handleSCSI(device, cdb, featureRegister, deviceFlags);
                return 28;
            case 0x53: // DATA FROM HOST
                if (obj.acc.length < 14) return 0;
                var len = ReadShortX(obj.acc, 9);
                if (obj.acc.length < (14 + len)) return 0;
                if (obj.debug) console.log('SCSI_WRITE, len = ' + (14 + len));
                obj.SendCommand(0x51, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x87, 0x70, 0x03, 0x00, 0x00, 0x00, 0xa0, 0x51, 0x07, 0x27, 0x00]), true);
                return 14 + len;
            default:
                if (obj.debug) console.log('Unknown IDER command', obj.acc[0]);
                obj.Stop();
                break;
        }
        return 0;
    }

    function handleSCSI(dev, cdb, featureRegister, deviceFlags)
    {
        var lba;
        var len;

        switch(cdb[0])
        {
            case 0x00: // TEST_UNIT_READY:
                if (obj.debug) console.log("SCSI: TEST_UNIT_READY", dev);
                switch (dev) {
                    case 0xA0: // DEV_FLOPPY
                        if (obj.floppy == null) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                        if (obj.floppyReady == false) { obj.floppyReady = true; obj.SendCommandEndResponse(1, 0x06, dev, 0x28, 0x00); return -1; } // Switch to ready
                        break;
                    case 0xB0: // DEV_CDDVD
                        if (obj.cdrom == null) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                        if (obj.cdromReady == false) { obj.cdromReady = true; obj.SendCommandEndResponse(1, 0x06, dev, 0x28, 0x00); return -1; } // Switch to ready
                        break;
                    default:
                        if (obj.debug) console.log("SCSI Internal error 3", dev);
                        return -1;
                }
                obj.SendCommandEndResponse(1, 0x00, dev, 0x00, 0x00); // Indicate ready
                break;
            case 0x08: // READ_6
                lba = ((cdb[1] & 0x1f) << 16) + (cdb[2] << 8) + cdb[3];
                len = cdb[4];
                if (len == 0) { len = 256; }
                if (obj.debug) console.log("SCSI: READ_6", dev, lba, len);
                sendDiskData(dev, lba, len, featureRegister);
                break;
            case 0x0a: // WRITE_6
                lba = ((cdb[1] & 0x1f) << 16) + (cdb[2] << 8) + cdb[3];
                len = cdb[4];
                if (len == 0) { len = 256; }
                if (obj.debug) console.log("SCSI: WRITE_6", dev, lba, len);
                obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); // Write is not supported, remote no medium.
                return -1;
                /*
            case 0x15: // MODE_SELECT_6:
                console.log("SCSI ERROR: MODE_SELECT_6", dev);
                obj.SendCommandEndResponse(1, 0x05, dev, 0x20, 0x00);
                return -1;
                */
            case 0x1a: // MODE_SENSE_6
                if (obj.debug) console.log("SCSI: MODE_SENSE_6", dev);
                if ((cdb[2] == 0x3f) && (cdb[3] == 0x00)) {
                    var a = 0, b = 0;
                    switch (dev) {
                        case 0xA0: // DEV_FLOPPY
                            if (obj.floppy == null) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                            a = 0x00;
                            b = 0x80; // Read only = 0x80, Read write = 0x00
                            break;
                        case 0xB0: // DEV_CDDVD
                            if (obj.cdrom == null) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                            a = 0x05;
                            b = 0x80;
                            break;
                        default:
                            if (obj.debug) console.log("SCSI Internal error 6", dev);
                            return -1;
                    }
                    obj.SendDataToHost(dev, true, Buffer.from([0, a, b, 0]), featureRegister & 1);
                    return;
                }
                obj.SendCommandEndResponse(1, 0x05, dev, 0x24, 0x00);
                break;
            case 0x1b: // START_STOP (Called when you eject the CDROM)
                //var immediate = cdb[1] & 0x01;
                //var loej = cdb[4] & 0x02;
                //var start = cdb[4] & 0x01;
                obj.SendCommandEndResponse(1, 0, dev);
                break;
            case 0x1e: // LOCK_UNLOCK - ALLOW_MEDIUM_REMOVAL
                if (obj.debug) console.log("SCSI: ALLOW_MEDIUM_REMOVAL", dev);
                if ((dev == 0xA0) && (obj.floppy == null)) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                if ((dev == 0xB0) && (obj.cdrom == null)) { obj.SendCommandEndResponse(1, 0x02, dev, 0x3a, 0x00); return -1; }
                obj.SendCommandEndResponse(1, 0x00, dev, 0x00, 0x00);
                break;
            case 0x23: // READ_FORMAT_CAPACITIES (Floppy only)
                if (obj.debug) console.log("SCSI: READ_FORMAT_CAPACITIES", dev);
                var buflen = ReadShort(cdb, 7);
                var mediaStatus = 0, sectors;
                var mcSize = buflen / 8; // Capacity descriptor size is 8

                switch (dev) {
                    case 0xA0: // DEV_FLOPPY
                        if ((obj.floppy == null) || (obj.floppy.size == 0)) { obj.SendCommandEndResponse(0, 0x05, dev, 0x24, 0x00); return -1; }
                        sectors = (obj.floppy.size >> 9) - 1;
                        break;
                    case 0xB0: // DEV_CDDVD
                        if ((obj.cdrom == null) || (obj.cdrom.size == 0)) { obj.SendCommandEndResponse(0, 0x05, dev, 0x24, 0x00); return -1; }
                        sectors = (obj.cdrom.size >> 11) - 1; // Number 2048 byte blocks
                        break;
                    default:
                        if (obj.debug) console.log("SCSI Internal error 4", dev);
                        return -1;
                }

                obj.SendDataToHost(dev, true, Buffer.concat([IntToStr(8), Buffer.from([0x00, 0x00, 0x0b, 0x40, 0x02, 0x00, 0x02, 0x00]) ]), featureRegister & 1);
                break;
            case 0x25: // READ_CAPACITY
                if (obj.debug) console.log("SCSI: READ_CAPACITY", dev);
                var len = 0;
                switch(dev)
                {
                    case 0xA0: // DEV_FLOPPY
                        if ((obj.floppy == null) || (obj.floppy.size == 0)) { obj.SendCommandEndResponse(0, 0x02, dev, 0x3a, 0x00); return -1; }
                        if (obj.floppy != null) { len = (obj.floppy.size >> 9) - 1; }
                        if (obj.debug) console.log('DEV_FLOPPY', len); // Number 512 byte blocks
                        break;
                    case 0xB0: // DEV_CDDVD
                        if ((obj.cdrom == null) || (obj.cdrom.size == 0)) { obj.SendCommandEndResponse(0, 0x02, dev, 0x3a, 0x00); return -1; }
                        if (obj.cdrom != null) { len = (obj.cdrom.size >> 11) - 1; } // Number 2048 byte blocks
                        if (obj.debug) console.log('DEV_CDDVD', len);
                        break;
                    default:
                        if (obj.debug) console.log("SCSI Internal error 4", dev);
                        return -1;
                }
                //if (dev == 0xA0) { dev = 0x00; } else { dev = 0x10; } // Weird but seems to work.
                if (obj.debug) console.log("SCSI: READ_CAPACITY2", dev, deviceFlags);
                obj.SendDataToHost(deviceFlags, true, Buffer.concat([IntToStr(len), Buffer.from([0, 0, ((dev == 0xB0) ? 0x08 : 0x02), 0])]), featureRegister & 1);
                break;
            case 0x28: // READ_10
                lba = ReadInt(cdb, 2);
                len = ReadShort(cdb, 7);
                if (obj.debug) console.log("SCSI: READ_10", dev, lba, len);
                sendDiskData(dev, lba, len, featureRegister);
                break;
            case 0x2a: // WRITE_10 (Floppy only)
            case 0x2e: // WRITE_AND_VERIFY (Floppy only)
                lba = ReadInt(cdb, 2);
                len = ReadShort(cdb, 7);
                if (obj.debug) console.log("SCSI: WRITE_10", dev, lba, len);
                obj.SendGetDataFromHost(dev, 512 * len); // Floppy writes only, accept sectors of 512 bytes
                break;
            case 0x43: // READ_TOC (CD Audio only)
                var buflen = ReadShort(cdb, 7);
                var msf = cdb[1] & 0x02; 
                var format = cdb[2] & 0x07;
                if (format == 0) { format = cdb[9] >> 6; }
                if (obj.debug) console.log("SCSI: READ_TOC, dev=" + dev + ", buflen=" + buflen + ", msf=" + msf + ", format=" + format);

                switch (dev) {
                    case 0xA0: // DEV_FLOPPY
                        obj.SendCommandEndResponse(1, 0x05, dev, 0x20, 0x00); // Not implemented
                        return -1;
                    case 0xB0: // DEV_CDDVD
                        // NOP
                        break;
                    default:
                        if (obj.debug) console.log("SCSI Internal error 9", dev);
                        return -1;
                }

                if (format == 1) { obj.SendDataToHost(dev, true, Buffer.from([0x00, 0x0a, 0x01, 0x01, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]), featureRegister & 1); }
                else if (format == 0) {
                    if (msf) {
                        obj.SendDataToHost(dev, true, Buffer.from([0x00, 0x12, 0x01, 0x01, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x14, 0xaa, 0x00, 0x00, 0x00, 0x34, 0x13]), featureRegister & 1);
                    } else {
                        obj.SendDataToHost(dev, true, Buffer.from([0x00, 0x12, 0x01, 0x01, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0xaa, 0x00, 0x00, 0x00, 0x00, 0x00]), featureRegister & 1);
                    }
                }
                break;
            case 0x46: // GET_CONFIGURATION
                var sendall = (cdb[1] != 2);
                var firstcode = ReadShort(cdb, 2);
                var buflen = ReadShort(cdb, 7);

                if (obj.debug) console.log("SCSI: GET_CONFIGURATION", dev, sendall, firstcode, buflen);
                if (buflen == 0) { obj.SendDataToHost(dev, true, Buffer.concat([IntToStr(0x003c), IntToStr(0x0008)]), featureRegister & 1); return -1; } // TODO: Fixed this return, it's not correct.

                // Set the header
                var r = null;

                // Add the data
                if (firstcode == 0) { r = IDE_CD_ConfigArrayProfileList; }
                if ((firstcode ==   0x1) || (sendall && (firstcode <   0x1))) { r = IDE_CD_ConfigArrayCore; }
                if ((firstcode ==   0x2) || (sendall && (firstcode <   0x2))) { r = IDE_CD_Morphing; }
                if ((firstcode ==   0x3) || (sendall && (firstcode <   0x3))) { r = IDE_CD_ConfigArrayRemovable; }
                if ((firstcode ==  0x10) || (sendall && (firstcode <  0x10))) { r = IDE_CD_ConfigArrayRandom; }
                if ((firstcode ==  0x1E) || (sendall && (firstcode <  0x1E))) { r = IDE_CD_Read; }
                if ((firstcode == 0x100) || (sendall && (firstcode < 0x100))) { r = IDE_CD_PowerManagement; }
                if ((firstcode == 0x105) || (sendall && (firstcode < 0x105))) { r = IDE_CD_Timeout; }

                if (r == null) {
                    //console.log('NOT RIGHT', sendall, firstcode, cdb[2], cdb[3]);
                    //process.exit(0);
                    r = Buffer.concat([IntToStr(0x0008), IntToStr(4)]);
                } else {
                    r = Buffer.concat([IntToStr(0x0008), IntToStr(r.length + 4), r]);
                }

                // Cut the length to buflen if needed
                if (r.length > buflen) { r = r.slice(0, buflen); }

                obj.SendDataToHost(dev, true, r, featureRegister & 1);
                return -1;
            case 0x4a: // GET_EV_STATUS - GET_EVENT_STATUS_NOTIFICATION
                //var buflen = (cdb[7] << 8) + cdb[8];
                //if (buflen == 0) { obj.SendDataToHost(dev, true, Buffer.concat([IntToStr(0x003c), IntToStr(0x0008)]), featureRegister & 1); return -1; } // TODO: Fixed this return, it's not correct.
                if (obj.debug) console.log("SCSI: GET_EVENT_STATUS_NOTIFICATION", dev, cdb[1], cdb[4], cdb[9]);
                if ((cdb[1] != 0x01) && (cdb[4] != 0x10)) {
                    if (obj.debug) console.log('SCSI ERROR');
                    obj.SendCommandEndResponse(1, 0x05, dev, 0x26, 0x01);
                    break;
                }
                var present = 0x00;
                if ((dev == 0xA0) && (obj.floppy != null)) { present = 0x02; }
                else if ((dev == 0xB0) && (obj.cdrom != null)) { present = 0x02; }
                obj.SendDataToHost(dev, true, Buffer.from([0x00, present, 0x80, 0x00]), featureRegister & 1); // This is the original version, 4 bytes long
                break;
            case 0x4c:
                obj.SendCommand(0x51, Buffer.concat([IntToStrX(0), IntToStrX(0), IntToStrX(0), Buffer.from([0x87, 0x50, 0x03, 0x00, 0x00, 0x00, 0xb0, 0x51, 0x05, 0x20, 0x00]) ]), true);
                break;
            case 0x51: // READ_DISC_INFO
                if (obj.debug) console.log("SCSI READ_DISC_INFO", dev);
                obj.SendCommandEndResponse(0, 0x05, dev, 0x20, 0x00); // Correct
                return -1;
            case 0x55: // MODE_SELECT_10:
                if (obj.debug) console.log("SCSI ERROR: MODE_SELECT_10", dev);
                obj.SendCommandEndResponse(1, 0x05, dev, 0x20, 0x00);
                return -1;
            case 0x5a: // MODE_SENSE_10
                if (obj.debug) console.log("SCSI: MODE_SENSE_10", dev, cdb[2] & 0x3f);
                var buflen = ReadShort(cdb, 7);
                //var pc = cdb[2] & 0xc0;
                var r = null;
                
                if (buflen == 0) { obj.SendDataToHost(dev, true, Buffer.concat([IntToStr(0x003c), IntToStr(0x0008)]), featureRegister & 1); return -1; } // TODO: Fixed this return, it's not correct.

                // 1.44 mb floppy or LS120 (sectorCount == 0x3c300)
                var sectorCount = 0;
                if (dev == 0xA0) {
                    if (obj.floppy != null) { sectorCount = (obj.floppy.size >> 9); }
                } else {
                    if (obj.cdrom != null) { sectorCount = (obj.cdrom.size >> 11); }
                }

                switch (cdb[2] & 0x3f) {
                    case 0x01: if (dev == 0xA0) { r = (sectorCount <= 0xb40)?IDE_ModeSence_FloppyError_Recovery_Array:IDE_ModeSence_Ls120Error_Recovery_Array; } else { r = IDE_ModeSence_CDError_Recovery_Array; } break;
                    case 0x05: if (dev == 0xA0) { r = (sectorCount <= 0xb40)?IDE_ModeSence_FloppyDisk_Page_Array:IDE_ModeSence_LS120Disk_Page_Array; } break;
                    case 0x3f: if (dev == 0xA0) { r = (sectorCount <= 0xb40)?IDE_ModeSence_3F_Floppy_Array:IDE_ModeSence_3F_LS120_Array; } else { r = IDE_ModeSence_3F_CD_Array; } break;
                    case 0x1A: if (dev == 0xB0) { r = IDE_ModeSence_CD_1A_Array; } break;
                    case 0x1D: if (dev == 0xB0) { r = IDE_ModeSence_CD_1D_Array; } break;			
                    case 0x2A: if (dev == 0xB0) { r = IDE_ModeSence_CD_2A_Array; } break;
                }

                if (r == null) {
                    obj.SendCommandEndResponse(0, 0x05, dev, 0x20, 0x00); // TODO: Send proper error!!!
                } else {
                    // Set disk to read only (we don't support write).
                    //ms_data[3] = ms_data[3] | 0x80;
                    obj.SendDataToHost(dev, true, r, featureRegister & 1);
                }
                break;
            default: // UNKNOWN COMMAND
                if (obj.debug) console.log("IDER: Unknown SCSI command", cdb[0]);
                obj.SendCommandEndResponse(0, 0x05, dev, 0x20, 0x00);
                return -1;
        }
        return 0;
    }

    function sendDiskData(dev, lba, len, featureRegister) {
        var media = null;
        var mediaBlocks = 0;
        if (dev == 0xA0) { media = obj.floppy; if (obj.floppy != null) { mediaBlocks = (obj.floppy.size >> 9); } }
        if (dev == 0xB0) { media = obj.cdrom; if (obj.cdrom != null) { mediaBlocks = (obj.cdrom.size >> 11); } }
        if ((len < 0) || (lba + len > mediaBlocks)) { obj.SendCommandEndResponse(1, 0x05, dev, 0x21, 0x00); return 0; }
        if (len == 0) { obj.SendCommandEndResponse(1, 0x00, dev, 0x00, 0x00); return 0; }
        if (media != null) {
            // Send sector stats
            if (obj.sectorStats) { obj.sectorStats(1, (dev == 0xA0) ? 0 : 1, mediaBlocks, lba, len); }
            if (dev == 0xA0) { lba <<= 9; len <<= 9; } else { lba <<= 11; len <<= 11; }
            if (g_media !== null) {
                // Queue read operation
                g_readQueue.push({ media: media, dev: dev, lba: lba, len: len, fr: featureRegister });
            } else {
                // obj.iderinfo.readbfr // TODO: MaxRead
                g_media = media;
                g_dev = dev;
                g_lba = lba;
                g_len = len;
                sendDiskDataEx(featureRegister);
            }
        }
    }

    var g_readQueue = [];
    var g_reset = false;
    var g_media = null;
    var g_dev;
    var g_lba;
    var g_len;
    function sendDiskDataEx(featureRegister) {
        var len = g_len, lba = g_lba;
        if (g_len > obj.iderinfo.readbfr) { len = obj.iderinfo.readbfr; }
        g_len -= len;
        g_lba += len;

        //console.log('Read from ' + lba + ' to ' + (lba + len) + ', total of ' + len);

        var result = Buffer.alloc(len);
        fs.readSync(g_media.file, result, 0, len, lba);
        obj.SendDataToHost(g_dev, (g_len == 0), result, featureRegister & 1);
        if ((g_len > 0) && (g_reset == false)) {
            sendDiskDataEx(featureRegister);
        } else {
            g_media = null;
            if (g_reset) { obj.SendCommand(0x47); g_readQueue = []; g_reset = false; } // Send ResetOccuredResponse
            else if (g_readQueue.length > 0) { var op = g_readQueue.shift(); g_media = op.media; g_dev = op.dev; g_lba = op.lba; g_len = op.len; sendDiskDataEx(op.fr); } // Un-queue read operation
        }
    }

    return obj;
}

function ShortToStr(v) { return Buffer.from([(v >> 8) & 0xFF, v & 0xFF]); }
function ShortToStrX(v) { return Buffer.from([v & 0xFF, (v >> 8) & 0xFF]); }
function IntToStr(v) { return Buffer.from([(v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]); }
function IntToStrX(v) { return Buffer.from([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]); }
function ReadShort(v, p) { return (v[p] << 8) + v[p + 1]; }
function ReadShortX(v, p) { return (v[p + 1] << 8) + v[p]; }
function ReadInt(v, p) { return (v[p] * 0x1000000) + (v[p + 1] << 16) + (v[p + 2] << 8) + v[p + 3]; } // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
function ReadSInt(v, p) { return (v[p] << 24) + (v[p + 1] << 16) + (v[p + 2] << 8) + v[p + 3]; }
function ReadIntX(v, p) { return (v[p + 3] * 0x1000000) + (v[p + 2] << 16) + (v[p + 1] << 8) + v[p]; }