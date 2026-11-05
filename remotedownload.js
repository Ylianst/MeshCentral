/**
* @description MeshCentral desktop "Remote Download" helper, finds the files highlighted in Windows Explorer
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// The Remote Download button in the desktop view downloads the files highlighted in Windows Explorer on the remote computer.
// To find them without PowerShell and without changing the agent, the server sends the agent a fixed agent console "eval"
// command. The agent starts a short lived copy of itself in the user's session, as it does to read the desktop wallpaper,
// and that copy asks Explorer for its selection with the Windows shell COM interfaces. The result is sent back to the
// browser session that asked, as a { action: 'msg', type: 'remotedownloadselection' } message.
//
// Both functions below are not run on the server, their source is sent to the agent, so they must stay ES5 JavaScript
// that runs in the agent's JavaScript engine, and can't use anything outside of their own body.

// Runs in the user's session. Prints a JSON array of { s: [file paths], fg: true if this is the foreground window },
// one entry for each Explorer window, or tab, that is showing and has files highlighted.
function explorerSelection() {
    setTimeout(function () { process.exit(); }, 8000); // Never stay around, even if Explorer does not answer
    var result = [];
    try {
        var GM = require('_GenericMarshal');
        var COM = require('win-com');
        var user32 = GM.CreateNativeProxy('user32.dll');
        user32.CreateMethod('GetForegroundWindow');
        user32.CreateMethod('GetAncestor');
        user32.CreateMethod('IsWindowVisible');
        var ole32 = GM.CreateNativeProxy('ole32.dll');
        ole32.CreateMethod('CoTaskMemFree');
        var oleaut32 = GM.CreateNativeProxy('OleAut32.dll');
        oleaut32.CreateMethod('VariantClear');

        var IUNKNOWN = ['QueryInterface', 'AddRef', 'Release'];
        var GA_ROOT = 2, VT_DISPATCH = 9, SIGDN_FILESYSPATH = (0x80058000 | 0), MAX_FILES = 50;
        var foreground = user32.GetForegroundWindow().Val;

        // Every COM interface we hold is released at the end
        var held = [];
        var hold = function (p, names) { p.funcs = COM.marshalFunctions(p, IUNKNOWN.concat(names || [])); held.push(p); return p; };
        var queryInterface = function (p, iid, names) {
            var out = GM.CreatePointer();
            if (COM.marshalFunctions(p, IUNKNOWN).QueryInterface(p, COM.CLSIDFromString(iid), out).Val != 0) return null;
            return hold(out.Deref(), names);
        };

        // Read the selection of one Explorer window, given its IDispatch from IShellWindows
        var readWindow = function (disp) {
            // IServiceProvider -> IShellBrowser -> active IShellView
            var sp = queryInterface(disp, '{6D5140C1-7436-11CE-8034-00AA006009FA}', ['QueryService']);
            if (sp == null) return;
            var out = GM.CreatePointer();
            if (sp.funcs.QueryService(sp, COM.CLSIDFromString('{4C96BE40-915C-11CF-99D3-00AA004AE837}'), COM.CLSIDFromString('{000214E2-0000-0000-C000-000000000046}'), out).Val != 0) return; // SID_STopLevelBrowser, IID_IShellBrowser
            var browser = hold(out.Deref(), ['GetWindow', 'ContextSensitiveHelp', 'InsertMenusSB', 'SetMenuSB', 'RemoveMenusSB', 'SetStatusTextSB', 'EnableModelessSB', 'TranslateAcceleratorSB', 'BrowseObject', 'GetViewStateStream', 'GetControlWindow', 'SendControlMsg', 'QueryActiveShellView']);
            out = GM.CreatePointer();
            if (browser.funcs.QueryActiveShellView(browser, out).Val != 0) return;
            var view = hold(out.Deref(), ['GetWindow']);

            // Skip tabs that are not showing, their view window is hidden
            var viewWindow = GM.CreatePointer();
            if (view.funcs.GetWindow(view, viewWindow).Val != 0) return;
            if (user32.IsWindowVisible(viewWindow.Deref()).Val == 0) return;
            var isForeground = (user32.GetAncestor(viewWindow.Deref(), GA_ROOT).Val == foreground);

            // IFolderView2::GetSelection -> IShellItemArray
            var folderView = queryInterface(view, '{1af3a467-214f-4298-908e-06b03e0b39f9}', ['GetCurrentViewMode', 'SetCurrentViewMode', 'GetFolder', 'Item', 'ItemCount', 'Items', 'GetSelectionMarkedItem', 'GetFocusedItem', 'GetItemPosition', 'GetSpacing', 'GetDefaultSpacing', 'GetAutoArrange', 'SelectItem', 'SelectAndPositionItems', 'SetGroupBy', 'GetGroupBy', 'SetViewProperty', 'GetViewProperty', 'SetTileViewProperties', 'SetExtendedTileViewProperties', 'SetText', 'SetCurrentFolderFlags', 'GetCurrentFolderFlags', 'GetSortColumnCount', 'SetSortColumns', 'GetSortColumns', 'GetItem', 'GetVisibleItem', 'GetSelectedItem', 'GetSelection']);
            if (folderView == null) return;
            out = GM.CreatePointer();
            if (folderView.funcs.GetSelection(folderView, 0, out).Val != 0) return; // Fails when nothing is highlighted
            var items = hold(out.Deref(), ['BindToHandler', 'GetPropertyStore', 'GetPropertyDescriptionList', 'GetAttributes', 'GetCount', 'GetItemAt']);
            var count = GM.CreateVariable(4);
            if (items.funcs.GetCount(items, count).Val != 0) return;
            count = count.toBuffer().readUInt32LE();

            var files = [];
            for (var i = 0; (i < count) && (files.length < MAX_FILES); i++) {
                out = GM.CreatePointer();
                if (items.funcs.GetItemAt(items, i, out).Val != 0) continue;
                var item = hold(out.Deref(), ['BindToHandler', 'GetParent', 'GetDisplayName']);
                var name = GM.CreatePointer();
                if (item.funcs.GetDisplayName(item, SIGDN_FILESYSPATH, name).Val != 0) continue; // Not a file system item
                var path = name.Deref().Wide2UTF8;
                ole32.CoTaskMemFree(name.Deref());
                try { if (require('fs').statSync(path).isDirectory() == false) { files.push(path); } } catch (ex) { } // Folders can't be downloaded
            }
            if (files.length > 0) { result.push({ s: files, fg: isForeground }); }
        };

        // Go thru the Explorer windows with IShellWindows::_NewEnum, IEnumVARIANT only takes pointers, so this works on 32 and 64 bit
        var windows = COM.createInstance(COM.CLSIDFromString('{9BA05972-F6A8-11CF-A442-00A0C90A8F39}'), COM.CLSIDFromString('{85CB6900-4D95-11CF-960C-0080C7F4EE85}')); // CLSID_ShellWindows, IID_IShellWindows
        hold(windows, ['GetTypeInfoCount', 'GetTypeInfo', 'GetIDsOfNames', 'Invoke', 'get_Count', 'Item', '_NewEnum']);
        var unknown = GM.CreatePointer();
        if (windows.funcs._NewEnum(windows, unknown).Val == 0) {
            hold(unknown.Deref());
            var enumerator = queryInterface(unknown.Deref(), '{00020404-0000-0000-C000-000000000046}', ['Next', 'Skip', 'Reset', 'Clone']); // IID_IEnumVARIANT
            if (enumerator != null) {
                var variant = GM.CreateVariable(24), fetched = GM.CreateVariable(4);
                while ((enumerator.funcs.Next(enumerator, 1, variant, fetched).Val == 0) && (fetched.toBuffer().readUInt32LE() == 1)) {
                    try { if (variant.toBuffer().readUInt16LE() == VT_DISPATCH) { readWindow(variant.Deref(8, GM.PointerSize).Deref()); } } catch (ex) { }
                    oleaut32.VariantClear(variant);
                }
            }
        }
        for (var j = held.length - 1; j >= 0; j--) { try { held[j].funcs.Release(held[j]); } catch (ex) { } }
    } catch (ex) { }
    console.log(JSON.stringify(result));
    process.exit();
}

// Runs in the agent. Starts explorerSelection() in the user's session, or in the session picked in the desktop view,
// and sends what it prints to the browser session. Uses the same launch as the agent's desktop wallpaper toggle.
function launchSelection(sessionid, script) {
    var agent = require('MeshAgent');
    var options = { type: 0 };
    if (require('user-sessions').getProcessOwnerName(process.pid).tsid == 0) { // Agent runs as a service, start the copy in the user's session
        options.type = 1;
        if (agent._tsid != null) { options.type = 5; options.uid = agent._tsid; }
    }
    var reply = function (value) { agent.SendCommand({ action: 'msg', type: 'remotedownloadselection', sessionid: sessionid, value: value }); };
    var child;
    try { child = require('child_process').execFile(process.execPath, [process.execPath.split('\\').pop(), '-b64exec', Buffer.from(script).toString('base64')], options); } catch (ex) { reply(null); return; }
    agent._remoteDownloadChild = child; // Keep a reference until it exits
    child.str = '';
    child.stdout.on('data', function (c) { child.str += c.toString(); });
    child.stderr.on('data', function () { });
    var timer = setTimeout(function () { try { child.kill(); } catch (ex) { } }, 10000);
    child.on('exit', function () {
        clearTimeout(timer);
        if (agent._remoteDownloadChild === child) { delete agent._remoteDownloadChild; }
        reply(child.str.trim());
    });
}

// Function source without comment lines and indentation, the agent logs each console command, so keep it small
function compact(func) { return func.toString().split('\n').map(function (line) { return line.trim(); }).filter(function (line) { return (line != '') && (line.startsWith('//') == false); }).join('\n'); }

// Returns the agent console command that sends the Explorer selection to this browser session.
// The console splits its arguments on spaces and quotes, so the code goes in base64 inside an expression with neither.
module.exports.getSelectionConsoleCommand = function (sessionid) {
    const childScript = '(' + compact(explorerSelection) + ')();';
    const agentScript = '(' + compact(launchSelection) + ')(' + JSON.stringify(sessionid) + ',' + JSON.stringify(childScript) + ');undefined;';
    return 'eval eval(Buffer.from(\'' + Buffer.from(agentScript).toString('base64') + '\',\'base64\').toString())';
};
