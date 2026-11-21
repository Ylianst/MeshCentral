/**
* @description MeshCentral mass deployment user interface. Push files and run commands on many devices at once.
* @license Apache-2.0
* @version v0.0.1
*/

// Usage from the web page:
//   MeshDeploy.init({ send: function (cmd) { meshserver.send(cmd); }, getNode: getNodeFromId, isWindows: isWindowsNode, getRights: GetNodeRights,
//                     authCookie: function () { return authCookie; }, gotoDevice: function (nodeid) { ... }, onRunningChange: function (count) { ... } });
//   MeshDeploy.open(nodeids, files);   // Open the deploy form for these devices, files is an optional FileList or array of File
//   MeshDeploy.openActivity();         // Open the activity view
//   MeshDeploy.onMessage(message);     // Call for every 'meshdeploy' message from the server
//   MeshDeploy.onEvent(event);         // Call for every 'meshdeploy' event from the server

var MeshDeploy = (function () {
    'use strict';
    var opts = null, root = null, state = null, jobs = {}, jobOrder = [], responseHandlers = {}, nextResponseId = 1, listLoaded = false;
    var STORE_KEY = 'meshDeployForm';
    var ACTIVE = ['preparing', 'uploading', 'verifying', 'running'];
    var ISSUES = ['failed', 'timeout', 'warning'];
    var STATE_LABELS = { queued: 'Queued', waiting: 'Waiting', preparing: 'Preparing', uploading: 'Pushing', verifying: 'Checking', running: 'Running', success: 'Success', warning: 'Warning', failed: 'Failed', timeout: 'Timeout', offline: 'Offline', skipped: 'Skipped', cancelled: 'Cancelled' };
    var EXAMPLES = {
        ps: [
            { n: 'Install pushed MSI silently', s: '$p = Start-Process msiexec.exe -ArgumentList \'/i\', "`"$env:MD_FILE`"", \'/qn\', \'/norestart\' -Wait -PassThru\nexit $p.ExitCode' },
            { n: 'Run pushed EXE installer silently', s: '$p = Start-Process -FilePath $env:MD_FILE -ArgumentList \'/S\' -Wait -PassThru\nexit $p.ExitCode' },
            { n: 'Restart a service', s: 'Restart-Service -Name \'Spooler\' -Force\nGet-Service -Name \'Spooler\'' },
            { n: 'Disk space', s: 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, @{n=\'FreeGB\';e={[math]::Round($_.FreeSpace/1GB,1)}}, @{n=\'SizeGB\';e={[math]::Round($_.Size/1GB,1)}}' }
        ],
        cmd: [
            { n: 'Install pushed MSI silently', s: 'msiexec /i "%MD_FILE%" /qn /norestart' },
            { n: 'Flush DNS', s: 'ipconfig /flushdns' },
            { n: 'Group policy update', s: 'gpupdate /force' }
        ],
        sh: [
            { n: 'Run pushed script', s: 'chmod +x "$MD_FILE" && "$MD_FILE"' },
            { n: 'Install pushed .deb', s: 'DEBIAN_FRONTEND=noninteractive dpkg -i "$MD_FILE" || apt-get -f install -y' },
            { n: 'Disk space', s: 'df -h' },
            { n: 'Uptime', s: 'uptime' }
        ]
    };

    //
    // Small helpers
    //

    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) { for (var i in attrs) { if (i == 'text') { e.textContent = attrs[i]; } else if (i == 'html') { e.innerHTML = attrs[i]; } else if (i.substring(0, 2) == 'on') { e.addEventListener(i.substring(2), attrs[i]); } else if (attrs[i] != null && attrs[i] !== false) { e.setAttribute(i, attrs[i] === true ? '' : attrs[i]); } } }
        if (children) { for (var j = 0; j < children.length; j++) { if (children[j] == null) continue; e.appendChild((typeof children[j] == 'string') ? document.createTextNode(children[j]) : children[j]); } }
        return e;
    }
    function $(id) { return root ? root.querySelector('[data-md="' + id + '"]') : null; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
    function fmtDuration(ms) { if (ms == null || ms < 0) return ''; var s = Math.round(ms / 1000); if (s < 60) return s + 's'; var m = Math.floor(s / 60); if (m < 60) return m + 'm ' + (s % 60) + 's'; return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
    function fmtAgo(t) { var s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(t).toLocaleString(); }
    function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (ex) { return {}; } }
    function save(x) { try { localStorage.setItem(STORE_KEY, JSON.stringify(x)); } catch (ex) { } }
    function isDark() { return document.body.classList.contains('night') || (document.documentElement.getAttribute('data-bs-theme') == 'dark'); }
    function isActive(s) { return ACTIVE.indexOf(s) >= 0; }
    function isDoneState(s) { return (s != 'queued') && (s != 'waiting') && !isActive(s); }

    function send(cmd, func) {
        cmd.action = 'meshdeploy';
        if (func) { cmd.responseid = 'md' + (nextResponseId++); responseHandlers[cmd.responseid] = func; }
        opts.send(cmd);
    }

    //
    // Styles, injected once
    //

    function addStyles() {
        if (document.getElementById('meshDeployStyles')) return;
        var css = [
            '.md-root{--md-bg:#fff;--md-bg2:#f5f6f8;--md-bg3:#eceef2;--md-fg:#1d2330;--md-fg2:#5b6475;--md-bd:#d9dde4;--md-acc:#2f6fdb;--md-acc-fg:#fff;--md-ok:#1f9d55;--md-warn:#c98a00;--md-err:#d33d3d;--md-run:#2f6fdb;--md-mut:#8a93a3;--md-code:#fbfaf3;',
            'position:fixed;inset:0;z-index:30000;background:rgba(15,20,30,.55);display:flex;align-items:center;justify-content:center;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--md-fg)}',
            '.md-root.md-dark{--md-bg:#1d2129;--md-bg2:#252a33;--md-bg3:#2e343f;--md-fg:#e6e9ef;--md-fg2:#a3abba;--md-bd:#3a414d;--md-acc:#4c8dff;--md-code:#14171d;--md-mut:#7d8696}',
            '.md-root *{box-sizing:border-box}',
            '.md-modal{background:var(--md-bg);width:min(980px,96vw);height:min(760px,94vh);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}',
            '.md-head{display:flex;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid var(--md-bd)}',
            '.md-title{font-size:17px;font-weight:600;white-space:nowrap}',
            '.md-tabs{display:flex;gap:4px;flex:1}',
            '.md-tab{border:0;background:none;color:var(--md-fg2);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit;display:flex;align-items:center;gap:6px}',
            '.md-tab:hover{background:var(--md-bg2)}.md-tab.md-on{background:var(--md-bg3);color:var(--md-fg);font-weight:600}',
            '.md-badge{background:var(--md-acc);color:var(--md-acc-fg);border-radius:9px;padding:0 7px;font-size:11px;line-height:18px;font-weight:600}',
            '.md-x{border:0;background:none;color:var(--md-fg2);font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}.md-x:hover{background:var(--md-bg2)}',
            '.md-body{flex:1;overflow:auto;min-height:0}',
            '.md-pane{padding:16px;display:none}.md-pane.md-on{display:block}',
            '.md-foot{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--md-bd);background:var(--md-bg2)}',
            '.md-sum{flex:1;color:var(--md-fg2);font-size:13px;min-width:0}',
            '.md-err{color:var(--md-err)}',
            '.md-btn{border:1px solid var(--md-bd);background:var(--md-bg);color:var(--md-fg);padding:7px 14px;border-radius:6px;cursor:pointer;font:inherit;white-space:nowrap}',
            '.md-btn:hover:not(:disabled){border-color:var(--md-acc)}.md-btn:disabled{opacity:.5;cursor:default}',
            '.md-btn.md-pri{background:var(--md-acc);border-color:var(--md-acc);color:var(--md-acc-fg);font-weight:600}.md-btn.md-pri:hover:not(:disabled){filter:brightness(1.08)}',
            '.md-btn.md-sm{padding:4px 10px;font-size:12px}',
            '.md-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;align-items:center}',
            '.md-chip{background:var(--md-bg2);border:1px solid var(--md-bd);border-radius:14px;padding:2px 10px;font-size:12px;color:var(--md-fg2)}',
            '.md-chip b{color:var(--md-fg)}',
            '.md-link{background:none;border:0;color:var(--md-acc);cursor:pointer;font:inherit;font-size:12px;padding:0}',
            '.md-devlist{max-height:90px;overflow:auto;font-size:12px;color:var(--md-fg2);background:var(--md-bg2);border-radius:6px;padding:6px 10px;margin:-6px 0 14px}',
            '.md-sec{border:1px solid var(--md-bd);border-radius:8px;margin-bottom:14px}',
            '.md-sech{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--md-bd);background:var(--md-bg2);border-radius:8px 8px 0 0}',
            '.md-sech h3{margin:0;font-size:14px;font-weight:600;flex:1}.md-opt{font-size:11px;color:var(--md-mut);font-weight:400;margin-left:6px}',
            '.md-secb{padding:12px}',
            '.md-drop{border:2px dashed var(--md-bd);border-radius:8px;padding:16px;text-align:center;color:var(--md-fg2);cursor:pointer;transition:border-color .15s,background .15s}',
            '.md-drop:hover,.md-drop.md-over{border-color:var(--md-acc);background:var(--md-bg2)}',
            '.md-files{margin-top:8px}',
            '.md-file{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:var(--md-bg2);margin-top:4px;font-size:13px}',
            '.md-file span:first-child{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.md-file .md-sz{color:var(--md-fg2);font-size:12px}',
            '.md-grid{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;align-items:center;margin-top:12px}',
            '.md-grid label{color:var(--md-fg2);font-size:13px}',
            '.md-in{width:100%;padding:6px 8px;border:1px solid var(--md-bd);border-radius:6px;background:var(--md-bg);color:var(--md-fg);font:inherit}',
            '.md-in:focus,.md-ta:focus{outline:2px solid var(--md-acc);outline-offset:-1px}',
            '.md-checks{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:13px}.md-checks label{display:flex;align-items:center;gap:6px;cursor:pointer}',
            '.md-eds{display:grid;grid-template-columns:1fr;gap:12px}.md-eds.md-two{grid-template-columns:1fr 1fr}',
            '.md-edh{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}.md-edh b{font-size:13px;flex:1;white-space:nowrap}',
            '.md-seg{display:inline-flex;border:1px solid var(--md-bd);border-radius:6px;overflow:hidden}',
            '.md-seg button{border:0;background:var(--md-bg);color:var(--md-fg2);padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}.md-seg button.md-on{background:var(--md-acc);color:var(--md-acc-fg)}',
            '.md-sel{padding:3px 6px;border:1px solid var(--md-bd);border-radius:6px;background:var(--md-bg);color:var(--md-fg);font:inherit;font-size:12px;max-width:150px}',
            '.md-ta{width:100%;height:170px;resize:vertical;font:12.5px/1.45 Consolas,"SF Mono",Menlo,monospace;padding:8px;border:1px solid var(--md-bd);border-radius:6px;background:var(--md-code);color:var(--md-fg);tab-size:4;white-space:pre}',
            '.md-hint{font-size:12px;color:var(--md-fg2);margin-top:6px}.md-hint code{background:var(--md-bg3);padding:0 4px;border-radius:3px;font-size:11.5px}',
            '.md-warnbox{font-size:12px;color:var(--md-warn);margin-top:6px}',
            'details.md-sec>summary{list-style:none;cursor:pointer}details.md-sec>summary::-webkit-details-marker{display:none}',
            'details.md-sec:not([open]) .md-sech{border-bottom:0;border-radius:8px}',
            '.md-chev{transition:transform .15s;color:var(--md-fg2)}details[open] .md-chev{transform:rotate(90deg)}',
            '.md-prog{height:6px;border-radius:3px;background:var(--md-bg3);overflow:hidden;display:flex}',
            '.md-prog i{display:block;height:100%}',
            '.md-act{display:grid;grid-template-columns:270px 1fr;height:100%;min-height:0}',
            '.md-act.md-pane{padding:0}.md-act.md-pane.md-on{display:grid}',
            '.md-jobs{border-right:1px solid var(--md-bd);overflow:auto;padding:8px}',
            '.md-job{padding:10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}',
            '.md-job:hover{background:var(--md-bg2)}.md-job.md-on{background:var(--md-bg2);border-color:var(--md-bd)}',
            '.md-jobn{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.md-jobm{font-size:11.5px;color:var(--md-fg2);display:flex;justify-content:space-between;margin:2px 0 6px}',
            '.md-det{overflow:auto;padding:14px 16px;min-width:0}',
            '.md-deth{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}.md-deth h2{margin:0;font-size:16px;font-weight:600;flex:1;word-break:break-word}',
            '.md-meta{font-size:12px;color:var(--md-fg2);margin-bottom:10px}.md-meta div{margin-bottom:2px}',
            '.md-filters{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 8px}',
            '.md-filters button{border:1px solid var(--md-bd);background:var(--md-bg);color:var(--md-fg2);padding:3px 10px;border-radius:14px;cursor:pointer;font:inherit;font-size:12px}.md-filters button.md-on{background:var(--md-fg);color:var(--md-bg);border-color:var(--md-fg)}',
            '.md-tbl{width:100%;border-collapse:collapse;font-size:13px}',
            '.md-tbl td{padding:7px 6px;border-top:1px solid var(--md-bd);vertical-align:top}',
            '.md-tbl tr.md-row{cursor:pointer}.md-tbl tr.md-row:hover td{background:var(--md-bg2)}',
            '.md-tbl .md-dn{font-weight:500;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}',
            '.md-tbl .md-dd{color:var(--md-fg2);word-break:break-word}',
            '.md-tbl .md-dt{color:var(--md-fg2);white-space:nowrap;text-align:right;font-size:12px}',
            '.md-pill{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:10px;white-space:nowrap;color:#fff;background:var(--md-mut)}',
            '.md-pill.success{background:var(--md-ok)}.md-pill.warning{background:var(--md-warn)}.md-pill.failed,.md-pill.timeout{background:var(--md-err)}',
            '.md-pill.preparing,.md-pill.uploading,.md-pill.verifying,.md-pill.running{background:var(--md-run);animation:mdpulse 1.4s ease-in-out infinite}',
            '@keyframes mdpulse{50%{opacity:.6}}',
            '.md-os{font-size:10px;color:var(--md-fg2);border:1px solid var(--md-bd);border-radius:3px;padding:0 4px;margin-left:6px;vertical-align:1px}',
            '.md-out{margin:0;padding:10px;background:var(--md-code);border:1px solid var(--md-bd);border-radius:6px;font:12px/1.45 Consolas,"SF Mono",Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;color:var(--md-fg)}',
            '.md-empty{color:var(--md-fg2);text-align:center;padding:50px 20px}',
            '.md-upbar{width:160px}',
            '@media (max-width:760px){.md-eds.md-two{grid-template-columns:1fr}.md-act{grid-template-columns:1fr;grid-template-rows:auto 1fr}.md-jobs{border-right:0;border-bottom:1px solid var(--md-bd);max-height:180px}.md-grid{grid-template-columns:1fr}.md-head{flex-wrap:wrap;gap:8px}.md-tabs{order:3;flex-basis:100%}.md-x{margin-left:auto}.md-deth{flex-wrap:wrap}.md-deth h2{flex-basis:100%}.md-tbl .md-dd{display:none}}'
        ].join('\n');
        var s = document.createElement('style');
        s.id = 'meshDeployStyles';
        s.textContent = css;
        document.head.appendChild(s);
    }

    //
    // Modal
    //

    function buildModal() {
        addStyles();
        root = el('div', { 'class': 'md-root' + (isDark() ? ' md-dark' : '') });
        // Keep keys typed in the dialog away from the page shortcuts
        ['keydown', 'keypress', 'keyup'].forEach(function (n) { root.addEventListener(n, function (e) { if ((n == 'keydown') && (e.key == 'Escape')) { close(); } e.stopPropagation(); }); });
        root.addEventListener('mousedown', function (e) { if (e.target === root) { root.xdown = true; } });
        root.addEventListener('click', function (e) { if ((e.target === root) && root.xdown) { close(); } root.xdown = false; });
        // Dropping files anywhere in the dialog adds them to the deployment
        root.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); } });
        root.addEventListener('drop', function (e) { if (hasFiles(e)) { e.preventDefault(); showTab('deploy'); addFiles(e.dataTransfer.files); } });

        var modal = el('div', { 'class': 'md-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mass Deploy' }, [
            el('div', { 'class': 'md-head' }, [
                el('div', { 'class': 'md-title', text: 'Mass Deploy' }),
                el('div', { 'class': 'md-tabs', role: 'tablist' }, [
                    el('button', { 'class': 'md-tab', 'data-md': 'tab-deploy', role: 'tab', onclick: function () { showTab('deploy'); } }, ['New deployment']),
                    el('button', { 'class': 'md-tab', 'data-md': 'tab-activity', role: 'tab', onclick: function () { showTab('activity'); } }, ['Activity', el('span', { 'class': 'md-badge', 'data-md': 'badge', style: 'display:none' })])
                ]),
                el('button', { 'class': 'md-x', title: 'Close', 'aria-label': 'Close', onclick: close, html: '&times;' })
            ]),
            el('div', { 'class': 'md-body' }, [
                el('div', { 'class': 'md-pane', 'data-md': 'pane-deploy' }),
                el('div', { 'class': 'md-pane md-act', 'data-md': 'pane-activity' }, [
                    el('div', { 'class': 'md-jobs', 'data-md': 'jobs' }),
                    el('div', { 'class': 'md-det', 'data-md': 'detail' })
                ])
            ]),
            el('div', { 'class': 'md-foot', 'data-md': 'foot' })
        ]);
        root.appendChild(modal);
        document.body.appendChild(root);
    }

    function hasFiles(e) { return e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0; }

    function close() {
        if (state && state.uploading) { if (!confirm('Files are still uploading to the server. Cancel the upload?')) return; if (state.xhr) { state.xhr.abort(); } }
        if (state && state.form) { saveForm(); }
        if (root) { document.body.removeChild(root); }
        root = null;
        state = null;
    }

    function showTab(t) {
        state.tab = t;
        $('tab-deploy').classList.toggle('md-on', t == 'deploy');
        $('tab-activity').classList.toggle('md-on', t == 'activity');
        $('pane-deploy').classList.toggle('md-on', t == 'deploy');
        $('pane-activity').classList.toggle('md-on', t == 'activity');
        if (t == 'activity') { renderJobs(); renderDetail(); }
        renderFoot();
    }

    //
    // Deploy form
    //

    function getTargets(nodeids) {
        var r = { all: [], win: [], posix: [], offline: 0, noagent: 0, nocmd: 0, nofiles: 0 };
        for (var i in nodeids) {
            var n = opts.getNode(nodeids[i]);
            if (n == null) continue;
            if (n.agent == null) { r.noagent++; continue; }
            var rights = opts.getRights(n);
            if ((rights & 131072) == 0) { r.nocmd++; }
            r.all.push(n);
            if (opts.isWindows(n)) { r.win.push(n); } else { r.posix.push(n); }
            if (((n.conn || 0) & 1) == 0) { r.offline++; }
        }
        return r;
    }

    function saveForm() {
        var f = state.form, x = load();
        x.winPath = f.winPath; x.linuxPath = f.linuxPath; x.createFolder = f.createFolder; x.overwrite = f.overwrite;
        x.winType = f.winType; x.runAsUser = f.runAsUser; x.timeout = f.timeout; x.concurrency = f.concurrency; x.waitOffline = f.waitOffline;
        x.winScript = f.winScript; x.linuxScript = f.linuxScript;
        save(x);
    }

    function renderDeploy() {
        var pane = $('pane-deploy'), f = state.form, tg = state.targets;
        pane.innerHTML = '';
        if (tg.all.length == 0) {
            pane.appendChild(el('div', { 'class': 'md-empty' }, [el('div', { style: 'font-size:15px;font-weight:600;margin-bottom:6px', text: 'No devices selected' }), 'Check the devices you want to deploy to in the device list, then open Mass Deploy again.']));
            return;
        }

        // Target summary
        var chips = el('div', { 'class': 'md-chips' }, [
            el('span', { 'class': 'md-chip', html: '<b>' + tg.all.length + '</b> device' + (tg.all.length > 1 ? 's' : '') }),
            tg.win.length ? el('span', { 'class': 'md-chip', html: '<b>' + tg.win.length + '</b> Windows' }) : null,
            tg.posix.length ? el('span', { 'class': 'md-chip', html: '<b>' + tg.posix.length + '</b> Linux / macOS' }) : null,
            tg.offline ? el('span', { 'class': 'md-chip', html: '<b>' + tg.offline + '</b> offline' }) : null,
            tg.nocmd ? el('span', { 'class': 'md-chip md-err', text: tg.nocmd + ' without run commands right' }) : null,
            el('button', { 'class': 'md-link', text: state.showDevs ? 'Hide devices' : 'Show devices', onclick: function () { state.showDevs = !state.showDevs; renderDeploy(); } })
        ]);
        pane.appendChild(chips);
        if (state.showDevs) { pane.appendChild(el('div', { 'class': 'md-devlist', text: tg.all.map(function (n) { return n.name; }).join(', ') })); }

        // Files
        var fileList = el('div', { 'class': 'md-files' });
        for (var i = 0; i < f.files.length; i++) {
            (function (i) {
                fileList.appendChild(el('div', { 'class': 'md-file' }, [el('span', { text: f.files[i].name, title: f.files[i].name }), el('span', { 'class': 'md-sz', text: fmtSize(f.files[i].size) }), el('button', { 'class': 'md-x', style: 'font-size:16px', title: 'Remove', 'aria-label': 'Remove ' + f.files[i].name, html: '&times;', onclick: function () { f.files.splice(i, 1); renderDeploy(); } })]));
            })(i);
        }
        var picker = el('input', { type: 'file', multiple: true, style: 'display:none', onchange: function () { addFiles(this.files); this.value = ''; } });
        var drop = el('div', { 'class': 'md-drop', tabindex: '0', role: 'button', onclick: function () { picker.click(); }, onkeydown: function (e) { if (e.key == 'Enter' || e.key == ' ') { e.preventDefault(); picker.click(); } } }, [
            el('div', { html: '<b>Drop files here</b> or click to browse' }),
            el('div', { style: 'font-size:12px;margin-top:2px', text: 'Files are uploaded to the server once, then each device downloads them.' })
        ]);
        ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function () { drop.classList.add('md-over'); }); });
        ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function () { drop.classList.remove('md-over'); }); });
        var fileBody = el('div', { 'class': 'md-secb' }, [drop, picker, fileList]);
        if (f.files.length > 0) {
            var grid = el('div', { 'class': 'md-grid' });
            if (tg.win.length) { grid.appendChild(el('label', { 'for': 'mdWinPath', text: 'Windows folder' })); grid.appendChild(input('mdWinPath', 'winPath', 'C:\\ProgramData\\Deploy')); }
            if (tg.posix.length) { grid.appendChild(el('label', { 'for': 'mdLinuxPath', text: 'Linux / macOS folder' })); grid.appendChild(input('mdLinuxPath', 'linuxPath', '/tmp/deploy')); }
            fileBody.appendChild(grid);
            fileBody.appendChild(el('div', { 'class': 'md-checks' }, [check('createFolder', 'Create the folder if missing'), check('overwrite', 'Overwrite existing files')]));
        }
        pane.appendChild(section('Files to push', true, fileBody, f.files.length ? (f.files.length + ' file' + (f.files.length > 1 ? 's' : '')) : null));

        // Commands
        var eds = el('div', { 'class': 'md-eds' + ((tg.win.length && tg.posix.length) ? ' md-two' : '') });
        if (tg.win.length) {
            var seg = el('div', { 'class': 'md-seg', role: 'group', 'aria-label': 'Windows shell' }, [
                el('button', { 'class': f.winType == 2 ? 'md-on' : '', text: 'PowerShell', onclick: function () { f.winType = 2; renderDeploy(); } }),
                el('button', { 'class': f.winType == 1 ? 'md-on' : '', text: 'Command Prompt', onclick: function () { f.winType = 1; renderDeploy(); } })
            ]);
            eds.appendChild(editor('Windows', seg, 'winScript', (f.winType == 2) ? EXAMPLES.ps : EXAMPLES.cmd, (f.winType == 2) ? 'Get-Service | Where-Object Status -eq Running' : 'ipconfig /all', '.ps1,.bat,.cmd,.txt', function (name) { if (/\.ps1$/i.test(name)) { f.winType = 2; } if (/\.(bat|cmd)$/i.test(name)) { f.winType = 1; } }));
        }
        if (tg.posix.length) {
            eds.appendChild(editor('Linux / macOS', el('span', { 'class': 'md-opt', text: 'sh, or the interpreter on the #! line' }), 'linuxScript', EXAMPLES.sh, 'uname -a', '.sh,.bash,.py,.txt', null));
        }
        var cmdBody = el('div', { 'class': 'md-secb' }, [eds]);
        if (f.files.length > 0) {
            var h = [];
            if (tg.win.length) { h.push((f.winType == 2) ? '<code>$env:MD_PATH</code> <code>$env:MD_FILE</code>' : '<code>%MD_PATH%</code> <code>%MD_FILE%</code>'); }
            if (tg.posix.length) { h.push('<code>$MD_PATH</code> <code>$MD_FILE</code>'); }
            cmdBody.appendChild(el('div', { 'class': 'md-hint', html: 'Runs after the files are pushed and checked. Use ' + h.join(' / ') + ' for the folder and the first file.' }));
        }
        cmdBody.appendChild(el('div', { 'class': 'md-warnbox', 'data-md': 'cmdwarn', style: 'display:none', text: 'Command Prompt scripts run line by line like a console: labels, GOTO, CALL :label and delayed expansion do not work. Use PowerShell for these scripts.' }));
        pane.appendChild(section('Command to run', true, cmdBody, null));

        // Options
        var opt = el('div', { 'class': 'md-secb' }, [el('div', { 'class': 'md-grid', style: 'margin-top:0' }, [
            el('label', { 'for': 'mdName', text: 'Name' }), input('mdName', 'name', 'Automatic'),
            el('label', { 'for': 'mdRunAs', text: 'Run as' }), select('mdRunAs', 'runAsUser', [[0, 'Agent (SYSTEM / root)'], [1, 'Logged in user, agent if none'], [2, 'Logged in user only']]),
            el('label', { 'for': 'mdOffline', text: 'Offline devices' }), select('mdOffline', 'waitOffline', [[0, 'Skip them'], [1, 'Run when online, up to 1 hour'], [4, 'Run when online, up to 4 hours'], [24, 'Run when online, up to 24 hours']]),
            el('label', { 'for': 'mdTimeout', text: 'Command timeout' }), select('mdTimeout', 'timeout', [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']]),
            el('label', { 'for': 'mdConc', text: 'Devices at once' }), select('mdConc', 'concurrency', [[10, '10'], [25, '25'], [50, '50'], [100, '100'], [250, '250']])
        ])]);
        var det = section('Options', false, opt, optSummary());
        pane.appendChild(det);
        renderFoot();
    }

    function optSummary() {
        var f = state.form;
        return ['Agent', 'User or agent', 'User only'][f.runAsUser] + ' · ' + (f.waitOffline ? ('wait ' + f.waitOffline + 'h for offline') : 'skip offline') + ' · ' + f.timeout + ' min timeout';
    }

    function section(title, open, body, note) {
        var isOpt = (title == 'Options');
        if (isOpt) {
            var d = el('details', { 'class': 'md-sec' }, [el('summary', { 'class': 'md-sech' }, [el('span', { 'class': 'md-chev', html: '&#9656;' }), el('h3', {}, [title, el('span', { 'class': 'md-opt', text: note || '' })])]), body]);
            if (state.optOpen) { d.setAttribute('open', ''); }
            d.addEventListener('toggle', function () { state.optOpen = d.open; });
            return d;
        }
        return el('div', { 'class': 'md-sec' }, [el('div', { 'class': 'md-sech' }, [el('h3', {}, [title, el('span', { 'class': 'md-opt', text: 'optional' })]), note ? el('span', { 'class': 'md-chip', text: note }) : null]), body]);
    }

    function input(id, key, ph) {
        return el('input', { 'class': 'md-in', id: id, type: 'text', placeholder: ph, value: state.form[key] || '', spellcheck: 'false', oninput: function () { state.form[key] = this.value; renderFoot(); } });
    }
    function check(key, label) {
        var c = el('input', { type: 'checkbox', onchange: function () { state.form[key] = this.checked; renderFoot(); } });
        c.checked = !!state.form[key];
        return el('label', {}, [c, label]);
    }
    function select(id, key, list) {
        var s = el('select', { 'class': 'md-in', id: id, onchange: function () { state.form[key] = parseInt(this.value); var n = root.querySelector('details.md-sec .md-opt'); if (n) { n.textContent = optSummary(); } renderFoot(); } });
        for (var i in list) { var o = el('option', { value: list[i][0], text: list[i][1] }); if (state.form[key] == list[i][0]) { o.selected = true; } s.appendChild(o); }
        return s;
    }
    function editor(title, extra, key, examples, ph, accept, onFile) {
        var ta = el('textarea', { 'class': 'md-ta', 'aria-label': title + ' command', placeholder: ph, spellcheck: 'false', oninput: function () { state.form[key] = this.value; renderFoot(); } });
        ta.value = state.form[key] || '';
        ta.addEventListener('keydown', function (e) {
            if (e.key == 'Tab' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; state.form[key] = ta.value; }
            if (e.key == 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); deploy(); }
        });
        var filePick = el('input', { type: 'file', accept: accept, style: 'display:none', onchange: function () {
            var file = this.files[0]; if (!file) return;
            var r = new FileReader();
            r.onload = function () { state.form[key] = r.result; if (onFile) { onFile(file.name); } renderDeploy(); };
            r.readAsText(file);
            this.value = '';
        } });
        var ex = el('select', { 'class': 'md-sel', 'aria-label': 'Insert an example', onchange: function () { var i = parseInt(this.value); if (i >= 0) { state.form[key] = examples[i].s; renderDeploy(); } } }, [el('option', { value: -1, text: 'Examples' })]);
        for (var i in examples) { ex.appendChild(el('option', { value: i, text: examples[i].n })); }
        return el('div', {}, [
            el('div', { 'class': 'md-edh' }, [el('b', { text: title }), extra, ex, el('button', { 'class': 'md-btn md-sm', text: 'Open file', onclick: function () { filePick.click(); } }), filePick]),
            ta
        ]);
    }

    function addFiles(list) {
        if (!state || !state.form || !list) return;
        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            if (f.size === 0 && f.type === '' && !f.name.includes('.')) { continue; } // A dropped folder
            var dup = -1;
            for (var j in state.form.files) { if (state.form.files[j].name.toLowerCase() == f.name.toLowerCase()) { dup = j; } }
            if (dup >= 0) { state.form.files[dup] = f; } else { state.form.files.push(f); }
        }
        renderDeploy();
    }

    // Check the form, returns a list of problems and a summary of what will happen
    function validate() {
        var f = state.form, tg = state.targets, p = [], parts = [];
        var hasWinCmd = tg.win.length && (f.winScript || '').trim() != '';
        var hasLinCmd = tg.posix.length && (f.linuxScript || '').trim() != '';
        if (f.files.length > 0) {
            if (tg.win.length && !/^[a-zA-Z]:[\\\/]/.test((f.winPath || '').trim())) { p.push('Enter a full Windows folder, like C:\\ProgramData\\Deploy'); }
            if (tg.win.length && /["%*?<>|]/.test((f.winPath || '').substring(2))) { p.push('The Windows folder has characters that are not allowed'); }
            if (tg.posix.length && (f.linuxPath || '').trim()[0] != '/') { p.push('Enter a full Linux / macOS folder, like /tmp/deploy'); }
            parts.push('push ' + (f.files.length == 1 ? f.files[0].name : (f.files.length + ' files')));
        }
        if (hasWinCmd || hasLinCmd) { parts.push('run ' + (hasWinCmd && hasLinCmd ? 'commands' : (hasWinCmd ? ((f.winType == 2) ? 'PowerShell' : 'Command Prompt') : 'shell') + ' commands')); }
        if (parts.length == 0) { p.push('Add files to push or a command to run'); }
        var n = 0;
        if (f.files.length > 0) { n = tg.all.length; } else { n = (hasWinCmd ? tg.win.length : 0) + (hasLinCmd ? tg.posix.length : 0); }
        var text = parts.length ? (parts.join(' then ') + ' on ' + n + ' device' + (n == 1 ? '' : 's')) : '';
        return { problems: p, summary: text.charAt(0).toUpperCase() + text.substring(1) };
    }

    function renderFoot() {
        var foot = $('foot');
        if (!foot) return;
        var warn = $('cmdwarn');
        if (warn) { warn.style.display = (state.targets.win.length && (state.form.winType == 1) && /(^\s*:[A-Za-z_])|(\bgoto\b)|(\bcall\s+:)|(enabledelayedexpansion)/im.test(state.form.winScript || '')) ? '' : 'none'; }
        foot.innerHTML = '';
        if (state.tab == 'deploy' && state.targets.all.length > 0) {
            var v = validate();
            var sum = el('div', { 'class': 'md-sum', 'data-md': 'sum' });
            if (state.error) { sum.appendChild(el('span', { 'class': 'md-err', text: state.error })); }
            else if (state.uploading) { sum.appendChild(el('span', { text: state.uploadText || 'Uploading...' })); }
            else if (v.problems.length) { sum.appendChild(el('span', { text: v.problems[0] })); }
            else { sum.appendChild(el('span', { text: v.summary })); }
            foot.appendChild(sum);
            if (state.uploading) { foot.appendChild(el('div', { 'class': 'md-prog md-upbar' }, [el('i', { 'data-md': 'upbar', style: 'width:' + (state.uploadPct || 0) + '%;background:var(--md-acc)' })])); }
            foot.appendChild(el('button', { 'class': 'md-btn', text: 'Close', onclick: close }));
            var b = el('button', { 'class': 'md-btn md-pri', text: state.uploading ? 'Deploying...' : 'Deploy', title: 'Ctrl+Enter', onclick: deploy });
            b.disabled = (v.problems.length > 0) || !!state.uploading;
            foot.appendChild(b);
        } else {
            foot.appendChild(el('div', { 'class': 'md-sum', text: 'Results are kept on the server for 24 hours.' }));
            foot.appendChild(el('button', { 'class': 'md-btn', text: 'Close', onclick: close }));
        }
    }

    function deploy() {
        if (!state || state.uploading) return;
        var v = validate();
        if (v.problems.length) return;
        var f = state.form;
        state.error = null;
        saveForm();
        var cmd = {
            op: 'create', nodeids: state.targets.all.map(function (n) { return n._id; }), name: (f.name || '').trim(),
            runAsUser: f.runAsUser, timeout: f.timeout, concurrency: f.concurrency, waitOffline: f.waitOffline
        };
        if (state.targets.win.length && (f.winScript || '').trim() != '') { cmd.winScript = f.winScript; cmd.winType = f.winType; }
        if (state.targets.posix.length && (f.linuxScript || '').trim() != '') { cmd.linuxScript = f.linuxScript; }
        var create = function (fileids) {
            if (fileids) {
                cmd.files = fileids; cmd.createFolder = !!f.createFolder; cmd.overwrite = !!f.overwrite;
                if (state.targets.win.length) { cmd.winPath = f.winPath.trim(); }
                if (state.targets.posix.length) { cmd.linuxPath = f.linuxPath.trim(); }
            }
            state.uploading = true; state.uploadText = 'Starting...'; renderFoot();
            send(cmd, function (m) {
                if (!state) return;
                state.uploading = false;
                if (m.result != 'OK') { state.error = m.result; renderFoot(); return; }
                addJob(m.job, m.targets);
                state.form.files = [];
                state.form.name = '';
                state.selected = m.job.id;
                state.filter = 'all';
                showTab('activity');
                renderDeploy();
            });
        };
        if (f.files.length == 0) { create(null); return; }

        // Upload the files to the server first
        var fd = new FormData();
        fd.append('auth', opts.authCookie());
        for (var i in f.files) { fd.append('files', f.files[i], f.files[i].name); }
        var total = 0; for (var i in f.files) { total += f.files[i].size; }
        var xhr = new XMLHttpRequest();
        state.xhr = xhr; state.uploading = true; state.uploadPct = 0; state.uploadText = 'Uploading to server...';
        renderFoot();
        xhr.upload.onprogress = function (e) {
            if (!state || !e.lengthComputable) return;
            state.uploadPct = Math.round(e.loaded * 100 / e.total);
            state.uploadText = 'Uploading to server, ' + fmtSize(Math.min(e.loaded, total)) + ' of ' + fmtSize(total);
            var b = $('upbar'); if (b) { b.style.width = state.uploadPct + '%'; }
            var s = $('sum'); if (s) { s.textContent = state.uploadText; }
        };
        xhr.onload = function () {
            if (!state) return;
            state.xhr = null;
            var r = null; try { r = JSON.parse(xhr.responseText); } catch (ex) { }
            if ((xhr.status != 200) || (r == null) || (r.result != 'OK')) { state.uploading = false; state.error = 'Upload failed' + ((r && r.result) ? (': ' + r.result) : (' (HTTP ' + xhr.status + ')')); renderFoot(); return; }
            create(r.files.map(function (x) { return x.id; }));
        };
        xhr.onerror = function () { if (!state) return; state.xhr = null; state.uploading = false; state.error = 'Upload failed, check the connection to the server'; renderFoot(); };
        xhr.onabort = function () { if (!state) return; state.xhr = null; state.uploading = false; renderFoot(); };
        xhr.open('POST', 'meshdeployupload.ashx');
        xhr.send(fd);
    }

    //
    // Activity
    //

    function addJob(job, targets) {
        var old = jobs[job.id];
        job.targets = targets ? targets.slice() : (old ? old.targets : null);
        jobs[job.id] = job;
        if (jobOrder.indexOf(job.id) < 0) { jobOrder.unshift(job.id); }
        jobOrder.sort(function (a, b) { return jobs[b].created - jobs[a].created; });
        updateBadge();
    }

    function runningCount() { var n = 0; for (var i in jobs) { if (jobs[i].state == 'running') { n++; } } return n; }
    function updateBadge() {
        var n = runningCount();
        if (opts && opts.onRunningChange) { try { opts.onRunningChange(n); } catch (ex) { } }
        var b = $('badge'); if (b) { b.style.display = n ? '' : 'none'; b.textContent = n; }
    }

    function counts(job) {
        var c = job.counts || {}, r = { ok: 0, warn: 0, err: 0, run: 0, wait: 0, other: 0 };
        for (var s in c) {
            if (s == 'success') r.ok += c[s]; else if (s == 'warning') r.warn += c[s]; else if (s == 'failed' || s == 'timeout') r.err += c[s];
            else if (isActive(s)) r.run += c[s]; else if (s == 'queued' || s == 'waiting') r.wait += c[s]; else r.other += c[s];
        }
        return r;
    }

    function progressBar(job) {
        var c = counts(job), t = job.total || 1;
        var seg = function (n, color) { return n ? el('i', { style: 'width:' + (n * 100 / t) + '%;background:' + color }) : null; };
        return el('div', { 'class': 'md-prog', title: c.ok + ' success, ' + c.warn + ' warning, ' + c.err + ' failed, ' + c.run + ' in progress, ' + c.wait + ' waiting, ' + c.other + ' skipped / offline / cancelled' },
            [seg(c.ok, 'var(--md-ok)'), seg(c.warn, 'var(--md-warn)'), seg(c.err, 'var(--md-err)'), seg(c.other, 'var(--md-mut)'), seg(c.run, 'var(--md-run)')]);
    }

    function renderJobs() {
        var list = $('jobs');
        if (!list) return;
        list.innerHTML = '';
        if (jobOrder.length == 0) { list.appendChild(el('div', { 'class': 'md-empty', style: 'padding:30px 10px', text: listLoaded ? 'No deployments yet.' : 'Loading...' })); return; }
        if ((state.selected == null) || (jobs[state.selected] == null)) { state.selected = jobOrder[0]; }
        for (var i in jobOrder) {
            (function (job) {
                var c = counts(job), done = job.total - c.run - c.wait;
                var stateText = (job.state == 'running') ? (done + ' / ' + job.total) : (job.state == 'cancelled' ? 'Cancelled' : (c.err ? (c.err + ' failed') : 'Done'));
                list.appendChild(el('div', { 'class': 'md-job' + (state.selected == job.id ? ' md-on' : ''), tabindex: '0', role: 'button', onclick: function () { selectJob(job.id); }, onkeydown: function (e) { if (e.key == 'Enter') selectJob(job.id); } }, [
                    el('div', { 'class': 'md-jobn', text: job.name, title: job.name }),
                    el('div', { 'class': 'md-jobm' }, [el('span', { text: fmtAgo(job.created) }), el('span', { text: stateText, style: c.err ? 'color:var(--md-err)' : '' })]),
                    progressBar(job)
                ]));
            })(jobs[jobOrder[i]]);
        }
    }

    function selectJob(id) {
        state.selected = id; state.filter = 'all'; state.expanded = {};
        renderJobs(); renderDetail();
    }

    function renderDetail() {
        var d = $('detail');
        if (!d) return;
        var job = jobs[state.selected];
        d.innerHTML = '';
        if (job == null) { d.appendChild(el('div', { 'class': 'md-empty', text: listLoaded ? 'Select devices in the device list and start a new deployment.' : '' })); return; }
        if (job.targets == null) {
            d.appendChild(el('div', { 'class': 'md-empty', text: 'Loading...' }));
            if (!job.loading) { job.loading = true; send({ op: 'get', jobid: job.id }, function (m) { job.loading = false; if (m.result == 'OK') { addJob(m.job, m.targets); if (state) { renderDetail(); } } }); }
            return;
        }

        // Header and actions
        var c = counts(job), retryable = c.err + c.warn + ((job.counts || {}).offline || 0) + ((job.counts || {}).cancelled || 0);
        var actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end' }, [
            (job.state == 'running') ? el('button', { 'class': 'md-btn md-sm', text: 'Cancel', onclick: function () { send({ op: 'cancel', jobid: job.id }); } }) : null,
            ((job.state != 'running') && retryable) ? el('button', { 'class': 'md-btn md-sm md-pri', text: 'Retry ' + retryable + ' device' + (retryable > 1 ? 's' : ''), title: 'Run again on devices that failed, timed out, had warnings, were offline or cancelled', onclick: function () { retry(job); } }) : null,
            el('button', { 'class': 'md-btn md-sm', text: 'Export', title: 'Download the results as a CSV file', onclick: function () { exportCsv(job); } }),
            el('button', { 'class': 'md-btn md-sm', text: 'Reuse', title: 'Start a new deployment with these settings on the selected devices', onclick: function () { reuse(job); } }),
            (job.state != 'running') ? el('button', { 'class': 'md-btn md-sm', text: 'Remove', onclick: function () { send({ op: 'remove', jobid: job.id }, function (m) { if (m.result == 'OK') { removeLocal(job.id); } }); } }) : null
        ]);
        d.appendChild(el('div', { 'class': 'md-deth' }, [el('h2', { text: job.name }), actions]));

        var meta = el('div', { 'class': 'md-meta' });
        meta.appendChild(el('div', { text: new Date(job.created).toLocaleString() + (job.finished ? (' · took ' + fmtDuration(job.finished - job.created)) : '') + ' · ' + ['run as agent', 'run as user or agent', 'run as user only'][job.runAsUser || 0] }));
        if (job.files && job.files.length) { meta.appendChild(el('div', { text: 'Files: ' + job.files.map(function (x) { return x.name + ' (' + fmtSize(x.size) + ')'; }).join(', ') + ' → ' + [job.winPath, job.linuxPath].filter(function (x) { return x; }).join(' / ') })); }
        if (job.winScript) { meta.appendChild(el('div', { text: ((job.winType == 1) ? 'Command Prompt: ' : 'PowerShell: ') + firstLine(job.winScript) })); }
        if (job.linuxScript) { meta.appendChild(el('div', { text: 'Shell: ' + firstLine(job.linuxScript) })); }
        d.appendChild(meta);
        d.appendChild(progressBar(job));

        // Filters
        var all = job.targets, groups = {
            all: all,
            active: all.filter(function (t) { return !isDoneState(t.state); }),
            success: all.filter(function (t) { return t.state == 'success'; }),
            issues: all.filter(function (t) { return ISSUES.indexOf(t.state) >= 0; }),
            other: all.filter(function (t) { return ['offline', 'skipped', 'cancelled'].indexOf(t.state) >= 0; })
        };
        var names = { all: 'All', active: 'In progress', success: 'Success', issues: 'Failed / warning', other: 'Offline / skipped' };
        if (groups[state.filter] == null) { state.filter = 'all'; }
        var fl = el('div', { 'class': 'md-filters', role: 'tablist' });
        for (var k in names) {
            if ((k != 'all') && (groups[k].length == 0)) continue;
            (function (k) { fl.appendChild(el('button', { 'class': state.filter == k ? 'md-on' : '', text: names[k] + ' ' + groups[k].length, onclick: function () { state.filter = k; renderDetail(); } })); })(k);
        }
        d.appendChild(fl);

        // Devices
        var rows = groups[state.filter].slice().sort(function (a, b) { return order(a.state) - order(b.state) || a.name.localeCompare(b.name); });
        var limit = state.rowLimit || 300;
        var tbl = el('table', { 'class': 'md-tbl' }), tb = el('tbody');
        for (var i = 0; i < rows.length && i < limit; i++) {
            (function (t) {
                var exp = state.expanded && state.expanded[t.idx];
                var detail = t.step || t.detail || '';
                if (t.files && t.files.length && isActive(t.state)) { detail = t.step || detail; }
                var time = t.ended && t.started ? fmtDuration(t.ended - t.started) : (t.started ? fmtDuration(Date.now() - t.started) : '');
                var nameCell = el('td', { 'class': 'md-dn', title: t.name }, [t.name, el('span', { 'class': 'md-os', text: t.os == 'win' ? 'WIN' : 'NIX' })]);
                var row = el('tr', { 'class': 'md-row', tabindex: '0', 'aria-expanded': exp ? 'true' : 'false', onclick: function () { toggleRow(job, t); }, onkeydown: function (e) { if (e.key == 'Enter') toggleRow(job, t); } }, [
                    el('td', { style: 'width:1%' }, [el('span', { 'class': 'md-pill ' + t.state, text: STATE_LABELS[t.state] || t.state })]),
                    nameCell,
                    el('td', { 'class': 'md-dd', text: detail + ((t.exitCode != null && t.exitCode !== 0 && detail.indexOf('Exit code') < 0) ? (' (exit ' + t.exitCode + ')') : '') }),
                    el('td', { 'class': 'md-dt', text: time })
                ]);
                tb.appendChild(row);
                if (exp) {
                    var cell = el('td', { colspan: '4', style: 'border-top:0;padding-top:0' });
                    var out = state.outputs[job.id + ':' + t.idx];
                    var bar = el('div', { style: 'display:flex;gap:6px;margin-bottom:6px' }, [
                        opts.gotoDevice ? el('button', { 'class': 'md-btn md-sm', text: 'Open device', onclick: function (e) { e.stopPropagation(); close(); opts.gotoDevice(t.nodeid); } }) : null,
                        (out != null && out !== '') ? el('button', { 'class': 'md-btn md-sm', text: 'Copy output', onclick: function (e) { e.stopPropagation(); copy(out, this); } }) : null
                    ]);
                    cell.appendChild(bar);
                    if (!t.hasOutput) { cell.appendChild(el('div', { 'class': 'md-hint', style: 'margin:0 0 6px', text: isDoneState(t.state) ? 'No output.' : 'Output is shown when the device finishes.' })); }
                    else if (out == null) { cell.appendChild(el('div', { 'class': 'md-hint', text: 'Loading output...' })); loadOutput(job, t); }
                    else { cell.appendChild(el('pre', { 'class': 'md-out', text: out })); }
                    tb.appendChild(el('tr', {}, [cell]));
                }
            })(rows[i]);
        }
        tbl.appendChild(tb);
        d.appendChild(tbl);
        if (rows.length > limit) { d.appendChild(el('div', { style: 'text-align:center;margin:10px' }, [el('button', { 'class': 'md-btn md-sm', text: 'Show ' + Math.min(500, rows.length - limit) + ' more', onclick: function () { state.rowLimit = limit + 500; renderDetail(); } })])); }
    }

    var ORDER = { failed: 0, timeout: 1, warning: 2, running: 3, verifying: 3, uploading: 3, preparing: 3, waiting: 4, queued: 5, success: 6, offline: 7, cancelled: 8, skipped: 9 };
    function order(s) { return ORDER.hasOwnProperty(s) ? ORDER[s] : 10; }
    function firstLine(s) { var l = String(s).split('\n').filter(function (x) { return x.trim() != ''; }); return (l[0] || '').trim().substring(0, 120) + (l.length > 1 ? ' (+' + (l.length - 1) + ' lines)' : ''); }

    function toggleRow(job, t) {
        if (!state.expanded) { state.expanded = {}; }
        if (state.expanded[t.idx]) { delete state.expanded[t.idx]; } else { state.expanded[t.idx] = 1; }
        renderDetail();
    }

    function loadOutput(job, t) {
        var key = job.id + ':' + t.idx;
        if (state.loadingOut[key]) return;
        state.loadingOut[key] = 1;
        send({ op: 'output', jobid: job.id, idx: t.idx }, function (m) {
            if (!state) return;
            delete state.loadingOut[key];
            state.outputs[key] = (m.result == 'OK') ? m.output : ('Unable to load the output: ' + m.result);
            renderDetail();
        });
    }

    function copy(text, btn) {
        var done = function () { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { }); return; }
        var ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (ex) { } document.body.removeChild(ta);
    }

    function retry(job) {
        send({ op: 'retry', jobid: job.id }, function (m) {
            if (!state) return;
            if (m.result != 'OK') { alert(m.result); return; }
            addJob(m.job, m.targets);
            selectJob(m.job.id);
        });
    }

    function reuse(job) {
        var f = state.form;
        if (job.winScript != null) { f.winScript = job.winScript; f.winType = job.winType; }
        if (job.linuxScript != null) { f.linuxScript = job.linuxScript; }
        if (job.winPath) { f.winPath = job.winPath; }
        if (job.linuxPath) { f.linuxPath = job.linuxPath; }
        f.runAsUser = job.runAsUser; f.timeout = job.timeout; f.concurrency = job.concurrency; f.waitOffline = job.waitOffline;
        showTab('deploy');
        renderDeploy();
    }

    function removeLocal(id) {
        delete jobs[id];
        var i = jobOrder.indexOf(id); if (i >= 0) { jobOrder.splice(i, 1); }
        if (state && state.selected == id) { state.selected = null; }
        updateBadge();
        if (state) { renderJobs(); renderDetail(); }
    }

    function exportCsv(job) {
        var q = function (s) { s = String(s == null ? '' : s); return /[",\n\r]/.test(s) ? ('"' + s.replace(/"/g, '""') + '"') : s; };
        var lines = ['Device,OS,Status,Detail,Exit code,Started,Ended'];
        for (var i in job.targets) {
            var t = job.targets[i];
            lines.push([t.name, t.os == 'win' ? 'Windows' : 'Linux/macOS', STATE_LABELS[t.state] || t.state, t.detail, t.exitCode, t.started ? new Date(t.started).toISOString() : '', t.ended ? new Date(t.ended).toISOString() : ''].map(q).join(','));
        }
        var blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
        var a = el('a', { href: URL.createObjectURL(blob), download: 'deployment-' + job.id + '.csv' });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // Re-render the activity view at most a few times per second
    var renderTimer = null;
    function scheduleRender() {
        if (renderTimer != null) return;
        renderTimer = setTimeout(function () {
            renderTimer = null;
            if (!state || state.tab != 'activity') return;
            renderJobs();
            renderDetail();
        }, 250);
    }

    //
    // Public interface
    //

    function open(nodeids, files, tab) {
        if (opts == null) return;
        if (root) { close(); }
        var saved = load();
        state = {
            tab: 'deploy', targets: getTargets(nodeids || []), selected: null, filter: 'all', expanded: {}, outputs: {}, loadingOut: {}, showDevs: false, optOpen: false,
            form: {
                files: [], name: '',
                winPath: saved.winPath || '', linuxPath: saved.linuxPath || '',
                createFolder: (saved.createFolder !== false), overwrite: (saved.overwrite === true),
                winType: (saved.winType === 1) ? 1 : 2, winScript: saved.winScript || '', linuxScript: saved.linuxScript || '',
                runAsUser: saved.runAsUser || 0, timeout: saved.timeout || 15, concurrency: saved.concurrency || 50, waitOffline: saved.waitOffline || 0
            }
        };
        buildModal();
        if (files) { for (var i = 0; i < files.length; i++) { state.form.files.push(files[i]); } }
        renderDeploy();
        showTab(tab || ((state.targets.all.length == 0) ? 'activity' : 'deploy'));
        if (!listLoaded) { refreshList(); }
        var first = root.querySelector('.md-tab.md-on');
        if (first) { first.focus(); }
    }

    function refreshList() {
        send({ op: 'list' }, function (m) {
            if (m.result != 'OK') return;
            listLoaded = true;
            var seen = {};
            for (var i in m.jobs) { seen[m.jobs[i].id] = 1; addJob(m.jobs[i], null); }
            for (var id in jobs) { if (!seen[id]) { removeLocal(id); } }
            if (state && state.tab == 'activity') { renderJobs(); renderDetail(); }
        });
    }

    return {
        init: function (o) { opts = o; },
        refresh: function () { if (opts != null) { refreshList(); } },
        open: function (nodeids, files) { open(nodeids, files, null); },
        openActivity: function () { open([], null, 'activity'); },
        isOpen: function () { return root != null; },
        runningCount: runningCount,
        onMessage: function (m) {
            if (m.responseid && responseHandlers[m.responseid]) { var f = responseHandlers[m.responseid]; delete responseHandlers[m.responseid]; f(m); }
        },
        onEvent: function (e) {
            if ((e == null) || (e.op != 'update') || (e.job == null)) return;
            var job = jobs[e.job.id];
            if (job == null) { addJob(e.job, null); job = jobs[e.job.id]; }
            else { var t = job.targets; for (var k in e.job) { job[k] = e.job[k]; } job.targets = t; }
            if (job.targets && e.targets) {
                for (var i in e.targets) {
                    job.targets[e.targets[i].idx] = e.targets[i];
                    if (state) { delete state.outputs[job.id + ':' + e.targets[i].idx]; } // Output may have changed
                }
            }
            updateBadge();
            scheduleRender();
        }
    };
})();
