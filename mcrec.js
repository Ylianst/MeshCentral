/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2019-2020
* @license Apache-2.0
* @version v0.0.1
*/

var fs = require('fs');
var path = require('path');

var worker = null;
const NodeJSVer = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
var directRun = (require.main === module);
function log() { if (directRun) { console.log(...arguments); } else { if (worker != null) { worker.parentPort.postMessage({ msg: arguments[0] }); } } }
if (directRun && (NodeJSVer >= 12)) { const xworker = require('worker_threads'); try { if (xworker.isMainThread == false) { worker = xworker; } } catch (ex) { log(ex); } }
function start() { startEx(process.argv); }
if (directRun) { setup(); }

function setup() { InstallModules(['image-size'], start); }
function start() { startEx(process.argv); }

function startEx(argv) {
    var state = { recFileName: null, recFile: null, recFileSize: 0, recFilePtr: 0 };
    var infile = null;
    if (argv.length > 2) { infile = argv[2]; } else {
        log('MeshCentral Session Recodings Processor');
        log('This tool will index a .mcrec file so that the player can seek thru the file.');
        log('');
        log('  Usage: node mcrec [file]');
        return;
    }
    if (fs.existsSync(infile) == false) { log("Missing file: " + infile); return; }
    state.recFileName = infile;
    state.recFileSize = fs.statSync(infile).size;
    if (state.recFileSize < 32) { log("Invalid file: " + infile); return; }
    log("Processing file: " + infile + ", " + state.recFileSize + " bytes.");
    state.recFile = fs.openSync(infile, 'r');
    state.indexTime = 10; // Interval between indexes in seconds
    state.lastIndex = 0; // Last time an index was writen in seconds
    state.indexes = [];
    state.width = 0;
    state.height = 0;
    state.basePtr = null;
    readLastBlock(state, function (state, result) {
        if (result == false) { log("Invalid file: " + infile); return; }
        readNextBlock(state, processBlock);
    });
}

function createIndex(state, ptr) {
    var index = [];
    for (var i in state.screen) { if (index.indexOf(state.screen[i]) == -1) { index.push(state.screen[i]); } }
    index.sort(function (a, b) { return a - b });
    index.unshift(state.height);
    index.unshift(state.width);
    index.unshift(ptr - state.basePtr);
    state.indexes.push(index); // Index = [ Ptr, Width, Height, Block Pointers... ]
    //log('Index', state.lastIndex, index.length);
    //log('Index', index);
    state.lastIndex += 10;
}

function processBlock(state, block) {
    if (block == null) { writeIndexedFile(state, function () { log("Done."); }); return; }
    var elapseMilliSeconds = 0;
    if (state.startTime != null) { elapseMilliSeconds = (block.time - state.startTime); }
    var flagBinary = (block.flags & 1) != 0;
    var flagUser = (block.flags & 2) != 0;

    // Start indexing at the first type 2 block
    if ((state.basePtr == null) && (block.type == 2)) { state.basePtr = block.ptr; state.startTime = block.time; }

    // Check if we need to create one or more indexes
    while (((state.lastIndex + state.indexTime) * 1000) < elapseMilliSeconds) { createIndex(state, block.ptr); }

    if (block.type == 1) {
        // Metadata
        state.metadata = JSON.parse(block.data.toString());
        if (state.metadata.indexInterval != null) { log("This file is already indexed."); return; }
        if (state.metadata.protocol != 2) { log("Only remote desktop sessions can currently be indexed."); return; }
        state.metadataFlags = block.flags;
        state.metadataTime = block.time;
        state.recFileProtocol = state.metadata.protocol;
        state.dataStartPtr = state.recFilePtr;
        if (typeof state.recFileProtocol == 'string') { state.recFileProtocol = parseInt(state.recFileProtocol); }
    } else if ((block.type == 2) && flagBinary && !flagUser) {
        // Device --> User data
        if (state.recFileProtocol == 1) {
            // MeshCentral Terminal
            // TODO
            log('Terminal');
        } else if (state.recFileProtocol == 2) {
            // MeshCentral Remote Desktop
            // TODO
            if (block.data.length >= 4) {
                var command = block.data.readInt16BE(0);
                var cmdsize = block.data.readInt16BE(2);
                if ((command == 27) && (cmdsize == 8)) {
                    // Jumbo packet
                    if (block.data.length >= 12) {
                        command = block.data.readInt16BE(8);
                        cmdsize = block.data.readInt32BE(4);
                        if (block.data.length == (cmdsize + 8)) {
                            block.data = block.data.slice(8, block.data.length);
                        } else {
                            console.log('TODO-PARTIAL-JUMBO', command, cmdsize, block.data.length);
                            return; // TODO
                        }
                    }
                }

                switch (command) {
                    case 3: // Tile
                        var x = block.data.readInt16BE(4);
                        var y = block.data.readInt16BE(6);
                        var dimensions = require('image-size')(block.data.slice(8));
                        //log("Tile", x, y, dimensions.width, dimensions.height, block.ptr);
                        //console.log(elapseSeconds);

                        // Update the screen with the correct pointers.
                        var sx = x/16, sy = y/16, sw = dimensions.width/16, sh = dimensions.height/16;
                        for (var i = 0; i < sw; i++) {
                            for (var j = 0; j < sh; j++) {
                                var k = ((state.swidth * (j + sy)) + (i + sx));
                                state.screen[k] = (block.ptr - state.basePtr);
                            }
                        }

                        break;
                    case 4: // Tile copy
                        var x = block.data.readInt16BE(4);
                        var y = block.data.readInt16BE(6);
                        //log("TileCopy", x, y);
                        break;
                    case 7: // Screen Size, clear the screen state and computer the tile count
                        state.width = block.data.readInt16BE(4);
                        state.height = block.data.readInt16BE(6);
                        state.swidth = state.width / 16;
                        state.sheight = state.height / 16;
                        if (Math.floor(state.swidth) != state.swidth) { state.swidth = Math.floor(state.swidth) + 1; }
                        if (Math.floor(state.sheight) != state.sheight) { state.sheight = Math.floor(state.sheight) + 1; }
                        state.screen = {};
                        //log("ScreenSize", state.width, state.height, state.swidth, state.sheight, state.swidth * state.sheight);
                        break;
                }

                //log('Desktop', command, cmdsize);
            }
        } else if (state.recFileProtocol == 101) {
            // Intel AMT KVM
            // TODO
            log('AMTKVM');
        }
    } else if ((block.type == 2) && flagBinary && flagUser) {
        // User --> Device data
        if (state.recFileProtocol == 101) {
            // Intel AMT KVM
            //if (rstr2hex(data) == '0000000008080001000700070003050200000000') { amtDesktop.bpp = 1; } // Switch to 1 byte per pixel.
        }
    }

    //console.log(block);
    readNextBlock(state, processBlock);
}

function writeIndexedFile(state, func) {
    var outfile = state.recFileName;
    if (outfile.endsWith('.mcrec')) { outfile = outfile.substring(0, outfile.length - 6) + '-ndx.mcrec'; } else { outfile += '-ndx.mcrec'; }
    if (fs.existsSync(outfile)) { log("File already exists: " + outfile); return; }
    log("Writing file: " + outfile);
    state.writeFile = fs.openSync(outfile, 'w');
    state.metadata.indexInterval = state.indexTime;
    state.metadata.indexStartTime = state.startTime;
    state.metadata.indexes = state.indexes;
    var firstBlock = JSON.stringify(state.metadata);
    recordingEntry(state.writeFile, 1, state.metadataFlags, state.metadataTime, firstBlock, function (state) {
        var len = 0, buffer = Buffer.alloc(4096), ptr = state.dataStartPtr;
        while (ptr < state.recFileSize) {
            len = fs.readSync(state.recFile, buffer, 0, 4096, ptr);
            fs.writeSync(state.writeFile, buffer, 0, len);
            ptr += len;
        }
        func(state);
    }, state);
}

// Record a new entry in a recording log
function recordingEntry(fd, type, flags, time, data, func, tag) {
    try {
        if (typeof data == 'string') {
            // String write
            var blockData = Buffer.from(data), header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
            header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
            header.writeInt16BE(flags, 2); // Flags (1 = Binary, 2 = User)
            header.writeInt32BE(blockData.length, 4); // Size
            header.writeIntBE(time, 10, 6); // Time
            var block = Buffer.concat([header, blockData]);
            fs.write(fd, block, 0, block.length, function () { func(tag); });
        } else {
            // Binary write
            var header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
            header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
            header.writeInt16BE(flags | 1, 2); // Flags (1 = Binary, 2 = User)
            header.writeInt32BE(data.length, 4); // Size
            header.writeIntBE(time, 10, 6); // Time
            var block = Buffer.concat([header, data]);
            fs.write(fd, block, 0, block.length, function () { func(tag); });
        }
    } catch (ex) { console.log(ex); func(state, tag); }
}

function readLastBlock(state, func) {
    var buf = Buffer.alloc(32);
    fs.read(state.recFile, buf, 0, 32, state.recFileSize - 32, function (err, bytesRead, buf) {
        var type = buf.readInt16BE(0);
        var flags = buf.readInt16BE(2);
        var size = buf.readInt32BE(4);
        var time = (buf.readInt32BE(8) << 32) + buf.readInt32BE(12);
        var magic = buf.toString('utf8', 16, 32);
        func(state, (type == 3) && (size == 16) && (magic == 'MeshCentralMCREC'));
    });
}

function readNextBlock(state, func) {
    if ((state.recFilePtr + 16) > state.recFileSize) { func(state, null); return; }
    var r = {}, buf = Buffer.alloc(16);
    fs.read(state.recFile, buf, 0, 16, state.recFilePtr, function (err, bytesRead, buf) {
        r.type = buf.readInt16BE(0);
        r.flags = buf.readInt16BE(2);
        r.size = buf.readInt32BE(4);
        r.time = buf.readIntBE(8, 8);
        r.date = new Date(r.time);
        r.ptr = state.recFilePtr;
        if ((state.recFilePtr + 16 + r.size) > state.recFileSize) { func(state, null); return; }
        if (r.size == 0) {
            r.data = null;
            func(state, r);
        } else {
            r.data = Buffer.alloc(r.size);
            fs.read(state.recFile, r.data, 0, r.size, state.recFilePtr + 16, function (err, bytesRead, buf) {
                state.recFilePtr += (16 + r.size);
                func(state, r);
            });
        }
    });
}

function isNumber(x) { return (('' + parseInt(x)) === x) || (('' + parseFloat(x)) === x); }
function format(format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); };

// Check if a list of modules are present and install any missing ones
var InstallModuleChildProcess = null;
var previouslyInstalledModules = {};
function InstallModules(modules, func) {
    var missingModules = [];
    if (previouslyInstalledModules == null) { previouslyInstalledModules = {}; }
    if (modules.length > 0) {
        for (var i in modules) {
            try {
                var xxmodule = require(modules[i]);
            } catch (e) {
                if (previouslyInstalledModules[modules[i]] !== true) { missingModules.push(modules[i]); }
            }
        }
        if (missingModules.length > 0) { InstallModule(missingModules.shift(), InstallModules, modules, func); } else { func(); }
    }
}

// Check if a module is present and install it if missing
function InstallModule(modulename, func, tag1, tag2) {
    log('Installing ' + modulename + '...');
    var child_process = require('child_process');
    var parentpath = __dirname;

    // Get the working directory
    if ((__dirname.endsWith('/node_modules/meshcentral')) || (__dirname.endsWith('\\node_modules\\meshcentral')) || (__dirname.endsWith('/node_modules/meshcentral/')) || (__dirname.endsWith('\\node_modules\\meshcentral\\'))) { parentpath = require('path').join(__dirname, '../..'); }

    // Looks like we need to keep a global reference to the child process object for this to work correctly.
    InstallModuleChildProcess = child_process.exec('npm install --no-optional --save ' + modulename, { maxBuffer: 512000, timeout: 120000, cwd: parentpath }, function (error, stdout, stderr) {
        InstallModuleChildProcess = null;
        if ((error != null) && (error != '')) {
            log('ERROR: Unable to install required module "' + modulename + '". May not have access to npm, or npm may not have suffisent rights to load the new module. Try "npm install ' + modulename + '" to manualy install this module.\r\n');
            process.exit();
            return;
        }
        previouslyInstalledModules[modulename] = true;
        func(tag1, tag2);
        return;
    });
}

// Export table
module.exports.startEx = startEx;