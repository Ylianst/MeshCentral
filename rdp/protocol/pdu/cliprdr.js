const type = require('../../core').type;
const EventEmitter = require('events').EventEmitter;
const caps = require('./caps');
const log = require('../../core').log;
const data = require('./data');



/**
 * Cliprdr channel for all clipboard
 * capabilities exchange
 */
class Cliprdr extends EventEmitter {

    constructor(transport) {
        super();
        this.transport = transport;
        // must be init via connect event
        this.userId = 0;
        this.serverCapabilities = [];
        this.clientCapabilities = [];
    }

}


/**
 * Client side of Cliprdr channel automata
 * @param transport
 */
class Client extends Cliprdr {

    constructor(transport, fastPathTransport) {

        super(transport, fastPathTransport);

        this.transport.once('connect', (gccCore, userId, channelId) => {
            this.connect(gccCore, userId, channelId);
        }).on('close', function () {
            //this.emit('close');
        }).on('error', function (err) {
            //this.emit('error', err);
        });

        this.content = '';

    }

    /**
     * connect function
     * @param gccCore {type.Component(clientCoreData)}
     */
    connect(gccCore, userId, channelId) {
        this.gccCore = gccCore;
        this.userId = userId;
        this.channelId = channelId;
        this.transport.once('cliprdr', (s) => {
            this.recv(s);
        });
    }


    send(message) {
        this.transport.send('cliprdr', new type.Component([
            // Channel PDU Header
            new type.UInt32Le(message.size()),
            // CHANNEL_FLAG_FIRST | CHANNEL_FLAG_LAST | CHANNEL_FLAG_SHOW_PROTOCOL
            new type.UInt32Le(0x13),
            message
        ]));
    };

    recv(s) {
        s.offset = 18;
        const pdu = data.clipPDU().read(s), type = data.ClipPDUMsgType;

        switch (pdu.obj.header.obj.msgType.value) {
            case type.CB_MONITOR_READY:
                this.recvMonitorReadyPDU(s);
                break;
            case type.CB_FORMAT_LIST:
                this.recvFormatListPDU(s);
                break;
            case type.CB_FORMAT_LIST_RESPONSE:
                this.recvFormatListResponsePDU(s);
                break;
            case type.CB_FORMAT_DATA_REQUEST:
                this.recvFormatDataRequestPDU(s);
                break;
            case type.CB_FORMAT_DATA_RESPONSE:
                this.recvFormatDataResponsePDU(s);
                break;
            case type.CB_TEMP_DIRECTORY:
                break;
            case type.CB_CLIP_CAPS:
                this.recvClipboardCapsPDU(s);
                break;
            case type.CB_FILECONTENTS_REQUEST:
        }

        this.transport.once('cliprdr', (s) => {
            this.recv(s);
        });
    }

    /**
     * Receive capabilities from server
     * @param s {type.Stream}
     */
    recvClipboardCapsPDU(s) {
        // Start at 18
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        // console.log('recvClipboardCapsPDU', s);
    }


    /**
     * Receive monitor ready from server
     * @param s {type.Stream}
     */
    recvMonitorReadyPDU(s) {
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        // console.log('recvMonitorReadyPDU', s);

        this.sendClipboardCapsPDU();
        // this.sendClientTemporaryDirectoryPDU();
        this.sendFormatListPDU();
    }


    /**
     * Send clipboard capabilities PDU
     */
    sendClipboardCapsPDU() {
        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_CLIP_CAPS),
            msgFlags: new type.UInt16Le(0x00),
            dataLen: new type.UInt32Le(0x10),
            cCapabilitiesSets: new type.UInt16Le(0x01),
            pad1: new type.UInt16Le(0x00),
            capabilitySetType: new type.UInt16Le(0x01),
            lengthCapability: new type.UInt16Le(0x0c),
            version: new type.UInt32Le(0x02),
            capabilityFlags: new type.UInt32Le(0x02)
        }));
    }


    /**
     * Send client temporary directory PDU
     */
    sendClientTemporaryDirectoryPDU(path = '') {
        // TODO
        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_TEMP_DIRECTORY),
            msgFlags: new type.UInt16Le(0x00),
            dataLen: new type.UInt32Le(0x0208),
            wszTempDir: new type.BinaryString(Buffer.from('D:\\Vectors' + Array(251).join('\x00'), 'ucs2'), { readLength: new type.CallableValue(520) })
        }));
    }


    /**
     * Send format list PDU
     */
    sendFormatListPDU() {
        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_FORMAT_LIST),
            msgFlags: new type.UInt16Le(0x00),

            dataLen: new type.UInt32Le(0x24),

            formatId6: new type.UInt32Le(0xc004),
            formatName6: new type.BinaryString(Buffer.from('Native\x00', 'ucs2'), { readLength: new type.CallableValue(14) }),

            formatId8: new type.UInt32Le(0x0d),
            formatName8: new type.UInt16Le(0x00),

            formatId9: new type.UInt32Le(0x10),
            formatName9: new type.UInt16Le(0x00),

            formatId0: new type.UInt32Le(0x01),
            formatName0: new type.UInt16Le(0x00),

            // dataLen: new type.UInt32Le(0xe0),

            // formatId1: new type.UInt32Le(0xc08a),
            // formatName1: new type.BinaryString(Buffer.from('Rich Text Format\x00' , 'ucs2'), { readLength : new type.CallableValue(34)}),

            // formatId2: new type.UInt32Le(0xc145),
            // formatName2: new type.BinaryString(Buffer.from('Rich Text Format Without Objects\x00' , 'ucs2'), { readLength : new type.CallableValue(66)}),

            // formatId3: new type.UInt32Le(0xc143),
            // formatName3: new type.BinaryString(Buffer.from('RTF As Text\x00' , 'ucs2'), { readLength : new type.CallableValue(24)}),

            // formatId4: new type.UInt32Le(0x01),
            // formatName4: new type.BinaryString(0x00),

            formatId5: new type.UInt32Le(0x07),
            formatName5: new type.UInt16Le(0x00),

            // formatId6: new type.UInt32Le(0xc004),
            // formatName6: new type.BinaryString(Buffer.from('Native\x00' , 'ucs2'), { readLength : new type.CallableValue(14)}),

            // formatId7: new type.UInt32Le(0xc00e),
            // formatName7: new type.BinaryString(Buffer.from('Object Descriptor\x00' , 'ucs2'), { readLength : new type.CallableValue(36)}),

            // formatId8: new type.UInt32Le(0x03),
            // formatName8: new type.UInt16Le(0x00),

            // formatId9: new type.UInt32Le(0x10),
            // formatName9: new type.UInt16Le(0x00),

            // formatId0: new type.UInt32Le(0x07),
            // formatName0: new type.UInt16Le(0x00),
        }));

    }

    /**
     * Recvie format list PDU from server
     * @param {type.Stream} s 
     */
    recvFormatListPDU(s) {
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        // console.log('recvFormatListPDU', s);
        this.sendFormatListResponsePDU();
    }


    /**
     * Send format list reesponse
     */
    sendFormatListResponsePDU() {
        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_FORMAT_LIST_RESPONSE),
            msgFlags: new type.UInt16Le(0x01),
            dataLen: new type.UInt32Le(0x00),
        }));

        this.sendFormatDataRequestPDU();
    }


    /**
     * Receive format list response from server
     * @param s {type.Stream}
     */
    recvFormatListResponsePDU(s) {
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        // console.log('recvFormatListResponsePDU', s);
        // this.sendFormatDataRequestPDU();
    }


    /**
     * Send format data request PDU
     */
    sendFormatDataRequestPDU(formartId = 0x0d) {
        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_FORMAT_DATA_REQUEST),
            msgFlags: new type.UInt16Le(0x00),
            dataLen: new type.UInt32Le(0x04),
            requestedFormatId: new type.UInt32Le(formartId),
        }));
    }


    /**
     * Receive format data request PDU from server
     * @param s {type.Stream}
     */
    recvFormatDataRequestPDU(s) {
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        // console.log('recvFormatDataRequestPDU', s);
        this.sendFormatDataResponsePDU();
    }


    /**
     * Send format data reesponse PDU
     */
    sendFormatDataResponsePDU() {

        const bufs = Buffer.from(this.content + '\x00', 'ucs2');

        this.send(new type.Component({
            msgType: new type.UInt16Le(data.ClipPDUMsgType.CB_FORMAT_DATA_RESPONSE),
            msgFlags: new type.UInt16Le(0x01),
            dataLen: new type.UInt32Le(bufs.length),
            requestedFormatData: new type.BinaryString(bufs, { readLength: new type.CallableValue(bufs.length) })
        }));

    }


    /**
     * Receive format data response PDU from server
     * @param s {type.Stream}
     */
    recvFormatDataResponsePDU(s) {
        s.offset = 18;
        // const pdu = data.clipPDU().read(s);
        const str = s.buffer.toString('ucs2', 26, s.buffer.length - 2);
        // console.log('recvFormatDataResponsePDU', str);
        this.content = str;
        this.emit('clipboard', str)
    }


    // =====================================================================================
    setClipboardData(content) {
        this.content = content;
        this.sendFormatListPDU();
    }

}


module.exports = {
    Client
}
