'use strict';

var agentManager = null, agentManagerSequence = 0, agentManagerRequests = {};
function agentManagerRequest(area, command) {
    return new Promise(function (resolve, reject) {
        var id = ++agentManagerSequence;
        var timer = setTimeout(function () { delete agentManagerRequests[id]; var error = new Error("The server did not respond. Refresh to check the result."); error.code = 'timeout'; reject(error); }, 30000);
        agentManagerRequests[id] = { resolve: resolve, reject: reject, timer: timer };
        meshserver.send(Object.assign({}, command, { action: 'agentbuildadmin', area: area, requestid: id }));
    });
}
function onAgentBuildAdmin(message) {
    var pending = agentManagerRequests[message.requestid];
    if (!pending) return;
    delete agentManagerRequests[message.requestid]; clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
}
function agentManagerButton(label, enabled) { agentBuildButton(label); QE('idx_dlgOkButton', enabled); QV('idx_dlgCancelButton', label !== "Close"); }
function agentManagerError(error) {
    if (agentManager && Q('agentManagerError')) { QH('agentManagerError', EscapeHtml(error.message || error)); agentManager.busy = false; }
}
function agentManagerHtml(html) {
    QH('agentManagerBody', '<p id="agentManagerError" role="alert" class="agent-error"></p>' + html);
}
function agentManagerClosed() {
    var current = agentManager;
    if (!current) return;
    agentManager = null;
    if (Q('dialog')) Q('dialog').classList.remove('agent-manager-dialog');
    if (current.timer) clearTimeout(current.timer);
    if (current.upload) current.upload.abort();
    if (current.importId) agentManagerRequest('import', { op: 'cancel', id: current.importId }).catch(function () {});
    if (current.draft && !current.committing) agentManagerRequest('upload', { op: 'discard', token: current.draft.token }).catch(function () {});
    agentBuildButton(current.buttonText); agentBuildCancelButton(current.cancelText); QV('idx_dlgCancelButton', true);
    if (Q('agentManagerBody')) Q('agentManagerBody').remove();
}
function agentManagerClose() { agentManagerClosed(); closeAgentManagerDialog(); return false; }
function agentManagerOpen(mode, options) {
    if (xxdialogMode || !userinfo || userinfo.siteadmin != 0xFFFFFFFF) return false;
    var button = Q('idx_dlgOkButton'), cancel = Q('idx_dlgCancelButton');
    agentManager = Object.assign({ mode: mode, offset: 0, buttonText: button.tagName === 'INPUT' ? button.value : button.textContent, cancelText: cancel ? (cancel.tagName === 'INPUT' ? cancel.value : cancel.textContent) : '' }, options || {});
    showAgentManagerDialog(mode === 'defaults' ? "Default agent downloads" : mode === 'import' ? "Import agent build" : mode === 'upload' ? "Upload agent build" : mode === 'usage' ? "Build usage" : mode === 'manage' ? "Manage agent build" : "Agent deployments");
    if (Q('dialog')) Q('dialog').classList.add('agent-manager-dialog');
    agentBuildCancelButton("Close");
    agentManagerHtml('<p>' + "Loading..." + '</p>'); agentManagerButton("Close", true);
    if (mode === 'upload') agentManagerUploadForm();
    if (mode === 'import') agentManagerImportForm();
    if (mode === 'usage') agentManagerUsageForm();
    if (mode === 'manage') agentManagerManageForm();
    if (mode === 'bulk') agentManagerBulkForm();
    if (mode === 'jobs') agentManagerJobs(0);
    if (mode === 'job') agentManagerJob(agentManager.id, 0);
    if (mode === 'defaults') agentManagerDefaults(false);
    return false;
}
function agentManagerDefaults(retry) {
    var current = agentManager;
    if (retry) current.refreshCatalog = true;
    if (current.timer) clearTimeout(current.timer);
    agentManagerButton("Checking...", false);
    agentManagerRequest('defaults', { op: retry === 'updates' ? 'updates' : retry ? 'retry' : 'status' }).then(function (result) {
        if (agentManager !== current) return;
        var html = '<p>' + "These release files supply the server defaults. Checking files restores missing downloads without changing device policies." + '</p>';
        if (!result.files.length) html += '<p>' + "No default release versions are configured. Configure a release manifest or supply local files." + '</p>';
        if (!result.enabled) html += '<p>' + "Automatic downloads are disabled. Local files and matching uploaded builds can still be used." + '</p>';
        if (result.updates) {
            html += '<div class="agent-manager-row"><b>' + "Release updates" + '</b>';
            if (result.canManage && result.updates.enabled) html += ' <button type="button" onclick="agentManagerDefaults(\'updates\')"' + (result.updates.checking ? ' disabled' : '') + '>' + (result.updates.checking ? "Checking..." : "Check for updates") + '</button>';
            html += '</div><div class="agent-muted">' + "Checking for releases does not change the server defaults or install agents." + '</div>';
            if (!result.updates.intervalHours) html += '<p>' + "Scheduled release checks are disabled." + '</p>';
            for (var i = 0; i < result.updates.repositories.length; i++) {
                var repository = result.updates.repositories[i];
                html += '<div class="agent-manager-row"><b>' + EscapeHtml(repository.repository) + '</b><div class="agent-muted">' + EscapeHtml(repository.tags.join(', ')) + '</div>';
                if (repository.latest) {
                    html += '<div>' + (repository.latest.updateAvailable ? "Release available" : "Latest stable release") + ': <a href="' + EscapeHtml(repository.latest.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + EscapeHtml(repository.latest.tag) + '</a></div>';
                    if (repository.latest.updateAvailable) html += '<div class="agent-muted">' + "Import the release to review its files and test it on selected devices." + '</div>';
                } else html += '<div>' + (repository.lastSuccess ? "No stable release with an agent manifest found." : "Not checked") + '</div>';
                if (repository.lastSuccess) html += '<div class="agent-muted">' + "Last successful check" + ': ' + EscapeHtml(new Date(repository.lastSuccess).toLocaleString()) + '</div>';
                if (repository.error) html += '<div class="agent-error">' + EscapeHtml(repository.error) + '</div>';
                html += '</div>';
            }
        }
        if (result.restartRequired) html += '<p role="status"><b>' + "Files ready. Restart MeshCentral to load the restored defaults." + '</b></p>';
        if (!result.busy) {
            for (var i = 0; i < result.errors.length; i++) html += '<p class="agent-error">' + EscapeHtml(result.errors[i]) + '</p>';
        }
        if (result.error) html += '<p class="agent-error">' + EscapeHtml(result.error) + '</p>';
        for (var i = 0; i < result.files.length; i++) {
            var file = result.files[i];
            html += '<div class="agent-manager-row"><b>' + EscapeHtml(file.filename) + '</b><span>' + EscapeHtml(file.status) + '</span><div class="agent-muted"><a href="' + EscapeHtml(file.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + EscapeHtml(file.repository + ' / ' + file.tag) + '</a></div>';
            if (file.status === 'Downloading') html += '<progress max="' + file.size + '" value="' + (file.received || 0) + '"></progress>';
            html += '</div>';
        }
        html += '<p>' + "For offline recovery, upload the required release files into Agent builds, then check files here. Files must match the configured release hashes." + '</p>';
        if (!result.canManage) html += '<p>' + "Manage shared defaults from the default server domain." + '</p>';
        if (result.busy) html += '<p role="status">' + "Checking files. You can close this dialog while downloads continue." + '</p>';
        agentManagerHtml(html);
        current.submit = result.canManage && result.files.length ? function () { agentManagerDefaults(true); } : null;
        agentManagerButton(result.busy ? "Checking..." : current.submit ? "Check files" : "Close", !result.busy);
        if (result.busy || (result.updates && result.updates.checking)) current.timer = setTimeout(function () { if (agentManager === current) agentManagerDefaults(false); }, 1000);
        else if (current.refreshCatalog || result.restartRequired) { current.refreshCatalog = false; refreshAgentCatalog(); }
    }).catch(function (error) {
        if (agentManager !== current) return;
        agentManagerError(error); current.submit = function () { agentManagerDefaults(false); }; agentManagerButton("Retry", true);
    });
}
function agentManagerSubmit() {
    if (!agentManager || agentManager.busy) return false;
    if (agentManager.submit) agentManager.submit(); else agentManagerClose();
    return false;
}
function agentManagerRun(area, command, callback) {
    var current = agentManager;
    if (!current || current.busy) return;
    current.busy = true; QE('idx_dlgOkButton', false); QH('agentManagerError', '');
    agentManagerRequest(area, command).then(function (result) {
        if (agentManager !== current) return;
        current.busy = false; callback(result);
    }).catch(function (error) { if (agentManager !== current) return; agentManagerError(error);
        if (current.draft) { current.committing = false; agentManagerButton("Add build", true); }
        else if (current.mode === 'job') agentManagerJob(current.id, current.offset);
        else { agentManagerButton("Close", true); current.submit = null; } });
}
function agentManagerUploadForm() {
    agentManagerHtml('<p>' + "Upload native agent binaries to review their detected platform, requirements and hashes." + '</p><p>' + "Up to 16 files, 64 MiB each and 128 MiB total." + '</p><input id="agentUploadFiles" type="file" multiple onchange="agentManagerUploadSelected()" /><p id="agentUploadState" role="status"></p><progress id="agentUploadProgress" max="100" value="0" style="display:none"></progress>');
    agentManager.submit = agentManagerUpload; agentManagerButton("Review files", false);
}
function agentManagerUploadSelected() {
    var files = Q('agentUploadFiles').files, total = 0, valid = files.length > 0 && files.length <= 16;
    for (var i = 0; i < files.length; i++) { total += files[i].size; if (files[i].size > 67108864) valid = false; }
    if (total > 134217728) valid = false;
    QH('agentUploadState', valid ? format("Files selected: {0}", files.length) : "Select up to 16 files within the upload limits.");
    QE('idx_dlgOkButton', valid);
}
function agentManagerUpload() {
    var current = agentManager, body = new FormData(), files = Q('agentUploadFiles').files;
    if (!files.length) return;
    for (var i = 0; i < files.length; i++) body.append('files', files[i]);
    var request = new XMLHttpRequest(); current.upload = request; current.busy = true;
    QE('idx_dlgOkButton', false); QE('agentUploadFiles', false); QV('agentUploadProgress', true);
    QH('agentUploadState', "Uploading and inspecting files...");
    request.upload.onprogress = function (event) { if (agentManager === current && event.lengthComputable) Q('agentUploadProgress').value = Math.floor(event.loaded * 100 / event.total); };
    function fail(message) {
        if (agentManager !== current) return;
        current.upload = null; current.busy = false; agentManagerError(message); QE('agentUploadFiles', true); agentManagerButton("Review files", true);
    }
    request.onload = function () {
        if (agentManager !== current) return;
        current.upload = null; current.busy = false;
        var result;
        try { result = JSON.parse(request.responseText); } catch (ex) { fail("Unable to read the upload result."); return; }
        if (request.status !== 200 || result.error) { fail(result.error || "Upload failed."); return; }
        current.draft = result; agentManagerUploadReview();
    };
    request.onerror = request.ontimeout = function () { fail("Upload interrupted. Try again."); };
    request.open('POST', 'agentbuildupload.ashx' + (urlargs.key ? '?key=' + encodeURIComponent(urlargs.key) : ''));
    request.setRequestHeader('X-MeshCentral-AgentBuild', '1'); request.timeout = 120000; request.send(body);
}
function agentManagerRequirements(file) {
    var m = file.binaryMetadata || file.metadata || {}, values = [];
    if (m.glibcRequired) values.push('glibc ' + m.glibcRequired + '+');
    if (m.libc) values.push(m.libc);
    if (m.minimumMacos) values.push('macOS ' + m.minimumMacos + '+');
    if (m.freebsdAbi) values.push('FreeBSD ABI ' + m.freebsdAbi);
    if (m.interpreter) values.push(m.interpreter);
    if (m.neededLibraries) values.push(m.neededLibraries.join(', '));
    return values.length ? values.join('; ') : "Runtime requirements are not fully known.";
}
function agentManagerUploadReview() {
    var files = agentManager.draft.artifacts;
    var html = '<label class="agent-manager-field">' + "Build name" + '<input id="agentUploadName" type="text" maxlength="128" oninput="agentManagerReviewChanged()" value="' + EscapeHtml(agentManager.draft.name || files[0].filename) + '" /></label>';
    if (agentManager.draft.source) html += '<details><summary>' + "Source and verification" + '</summary>' + agentManagerImportProvenance(agentManager.draft.source) + '</details>';
    if (agentManager.draft.skipped && agentManager.draft.skipped.length) html += '<details><summary>' + format("Skipped non-binary files: {0}", agentManager.draft.skipped.length) + '</summary><div class="agent-hash">' + agentManager.draft.skipped.map(EscapeHtml).join('<br />') + '</div></details>';
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        html += '<fieldset class="agent-review-file"><legend><label><input id="agentUploadInclude' + i + '" type="checkbox" checked onchange="agentManagerReviewChanged()" /> ' + EscapeHtml(file.filename) + '</label></legend><div>' + EscapeHtml(file.platform + ' / ' + file.cpu) + ' / ' + (file.size / 1048576).toFixed(1) + ' MiB</div><div class="agent-muted">' + EscapeHtml(agentManagerRequirements(file)) + '</div>';
        html += '<label class="agent-manager-field">' + "MeshAgent type" + '<select id="agentUploadType' + i + '" onchange="agentManagerReviewChanged()">';
        if (file.candidates.length > 1) html += '<option value="">' + "Select the compiled agent type" + '</option>';
        for (var j = 0; j < file.candidates.length; j++) html += '<option value="' + file.candidates[j].id + '">' + EscapeHtml(file.candidates[j].name) + ' (' + file.candidates[j].id + ')</option>';
        html += '</select></label><label class="agent-manager-field">' + "Desktop support" + '<select id="agentUploadKvm' + i + '" onchange="agentManagerReviewChanged()"><option value="">' + "Select" + '</option><option value="yes">' + "Included" + '</option><option value="no">' + "Not included" + '</option></select></label>';
        for (var j = 0; j < file.warnings.length; j++) html += '<p class="agent-error">' + EscapeHtml(file.warnings[j]) + '</p>';
        html += '<details><summary>' + "Hashes" + '</summary><div class="agent-hash">SHA256 <code>' + file.hashes.sha256 + '</code></div><div class="agent-hash">' + "Update SHA384" + ' <code>' + file.hashes.agentSha384 + '</code></div></details></fieldset>';
    }
    html += '<p>' + "Headers identify the platform. Agent type and desktop support must match how these files were built. Publisher trust and runtime behavior have not been verified." + '</p><label><input id="agentUploadTrust" type="checkbox" onchange="agentManagerReviewChanged()" /> ' + "I trust these MeshAgent files and have checked the selected agent types." + '</label>';
    agentManagerHtml(html); agentManager.submit = agentManagerUploadCommit; agentManagerButton("Add build", false);
}
function agentManagerReviewChanged() {
    var valid = Q('agentUploadTrust').checked && Q('agentUploadName').value.trim().length > 0, selected = 0;
    for (var i = 0; i < agentManager.draft.artifacts.length; i++) {
        var included = Q('agentUploadInclude' + i).checked;
        QE('agentUploadType' + i, included); QE('agentUploadKvm' + i, included);
        if (included) { selected++; if (!Q('agentUploadType' + i).value || !Q('agentUploadKvm' + i).value) valid = false; }
    }
    QE('idx_dlgOkButton', valid && selected > 0);
}
function agentManagerUploadCommit() {
    var current = agentManager, files = [];
    for (var i = 0; i < current.draft.artifacts.length; i++) files.push({ include: Q('agentUploadInclude' + i).checked, agentId: Number(Q('agentUploadType' + i).value), kvm: Q('agentUploadKvm' + i).value === 'yes' });
    current.committing = true; agentManagerButton("Adding build...", false);
    agentManagerRun('upload', { op: 'commit', token: current.draft.token, name: Q('agentUploadName').value, trusted: Q('agentUploadTrust').checked, files: files }, function () {
        current.draft = null; agentManagerClose(); agentCatalogFocus = null; Q('p44group').value = 'builds'; refreshAgentCatalog();
    });
}
function agentManagerManageForm() {
    agentManagerRun('catalog', { op: 'list' }, function (data) {
        var build = data.builds.filter(function (x) { return x.id === agentManager.build; })[0];
        if (!build) { agentManagerError("Build is unavailable."); return; }
        agentManager.buildInfo = build;
        var html = '<b>' + EscapeHtml(build.name) + '</b><p>' + "Archiving hides this build from new selections. Existing pins keep their cached binaries." + '</p><label class="agent-manager-field">' + "Action" + '<select id="agentManageAction"><option value="' + (build.archived ? 'restore' : 'archive') + '">' + (build.archived ? "Restore to catalog" : "Archive build") + '</option>';
        if (build.managed) html += '<option value="remove">' + "Remove uploaded build" + '</option>';
        html += '</select></label><p>' + "Removal is blocked while devices or deployment jobs reference the build." + '</p>';
        agentManagerHtml(html); agentManagerButton("Apply", true); agentManager.submit = function () {
            agentManagerRun('catalog', { op: Q('agentManageAction').value, build: build.id }, function () { agentManagerClose(); agentCatalogFocus = null; refreshAgentCatalog(); });
        };
    });
}
function agentManagerUsageForm() {
    agentManagerHtml('<div class="agent-manager-toolbar"><label>' + "Show" + ' <select id="agentUsageRelation" onchange="agentManagerUsage(0)"><option value="all">' + "All references" + '</option><option value="installed">' + "Last reported installed" + '</option><option value="pinned">' + "Pinned" + '</option></select></label><input id="agentUsageSearch" type="search" placeholder="' + "Filter devices" + '" aria-label="' + "Filter devices" + '" /><button type="button" onclick="agentManagerUsage(0)">' + "Search" + '</button></div><p>' + "Installed counts use the last binary hash reported by each device, including offline devices. Devices without a reported hash are not counted as installed." + '</p><div id="agentUsageRows"></div>');
    agentManager.submit = null; agentManagerButton("Close", true); agentManagerUsage(0);
}
function agentManagerPager(offset, total, size, callback) {
    return '<div class="agent-manager-toolbar"><button type="button" onclick="' + callback + '(' + Math.max(0, offset - size) + ')"' + (offset <= 0 ? ' disabled' : '') + '>' + "Previous" + '</button><span>' + format("{0} to {1} of {2}", total ? offset + 1 : 0, Math.min(offset + size, total), total) + '</span><button type="button" onclick="' + callback + '(' + (offset + size) + ')"' + (offset + size >= total ? ' disabled' : '') + '>' + "Next" + '</button></div>';
}
function agentManagerUsage(offset) {
    var current = agentManager, seq = current.serial = (current.serial || 0) + 1;
    agentManagerRequest('usage', { hash: current.hash, agentId: current.agentId, build: current.build, filename: current.filename, relation: Q('agentUsageRelation').value, search: Q('agentUsageSearch').value, offset: offset }).then(function (result) {
        if (agentManager !== current || current.serial !== seq) return;
        var html = '<p>' + format("Installed: {0}. Pinned: {1}. Pending: {2}. Updating: {3}. Unconfirmed: {4}.", result.counts.installed, result.counts.pinned, result.counts.pending, result.counts.updating, result.counts.unconfirmed) + '</p>';
        for (var i = 0; i < result.rows.length; i++) {
            var row = result.rows[i];
            html += '<div class="agent-manager-row"><button type="button" class="agent-usage-link" data-node="' + EscapeHtml(row.nodeid) + '" onclick="agentManagerDevice(this.getAttribute(\'data-node\'))">' + EscapeHtml(row.name || row.nodeid) + '</button><span>' + EscapeHtml(row.mode + ' / ' + agentManagerStage(row.state)) + '</span><div class="agent-muted">' + (row.online ? "Online" : "Offline") + (row.reportedAt ? ' / ' + EscapeHtml(new Date(row.reportedAt).toLocaleString()) : ' / ' + "Binary not reported") + '</div></div>';
        }
        html += agentManagerPager(offset, result.total, 50, 'agentManagerUsage'); QH('agentUsageRows', html);
    }).catch(function (error) { if (agentManager === current && current.serial === seq) agentManagerError(error); });
}
function agentManagerBulkForm() {
    agentManagerRun('catalog', { op: 'list' }, function (data) {
        agentManager.catalog = data.builds.filter(function (x) { return !x.archived; });
        var html = '<p>' + format("Selected devices: {0}. Preview checks eligibility without changing any device.", agentManager.nodeids.length) + '</p><label class="agent-manager-field">' + "Update policy" + '<select id="agentBatchMode" onchange="agentManagerBatchFiles()"><option value="pin">' + "Pin selected build" + '</option><option value="default">' + "Follow server default" + '</option><option value="hold">' + "Hold installed binary" + '</option></select></label><p id="agentBatchDefault" style="display:none">' + "Returning to the server default can downgrade the installed agent." + '</p><div id="agentBatchPin"><label class="agent-manager-field">' + "Build" + '<select id="agentBatchBuild" onchange="agentManagerBatchFiles()">';
        for (var i = 0; i < agentManager.catalog.length; i++) html += '<option value="' + i + '">' + EscapeHtml(agentManager.catalog[i].name) + '</option>';
        html += '</select></label><div id="agentBatchFiles"></div><label><input id="agentBatchUnknown" type="checkbox" /> ' + "Include devices whose requirements cannot be fully checked." + '</label></div><label class="agent-manager-field">' + "Batch size" + '<input id="agentBatchSize" type="number" min="1" max="20" value="5" /></label><p>' + "Each batch must finish verification before the next starts. Failures pause the deployment. Offline devices are skipped for binary updates." + '</p>';
        agentManagerHtml(html); agentManager.submit = agentManagerBatchPreview; agentManagerButton("Preview deployment", true); agentManagerBatchFiles();
    });
}
function agentManagerBatchFiles() {
    var pin = Q('agentBatchMode').value === 'pin', build = agentManager.catalog[Q('agentBatchBuild').value], html = '', groups = {}, selected = {};
    QV('agentBatchPin', pin); QV('agentBatchDefault', Q('agentBatchMode').value === 'default');
    for (var i = 0; i < agentManager.nodeids.length; i++) { var node = getNodeFromId(agentManager.nodeids[i]); if (node && node.agent) selected[node.agent.id] = true; }
    if (build) for (var i = 0; i < build.artifacts.length; i++) {
        var file = build.artifacts[i];
        if (file.matches && selected[file.id]) { if (!groups[file.id]) groups[file.id] = []; groups[file.id].push(i); }
    }
    for (var id in groups) {
        html += '<label class="agent-manager-field">' + format("Agent type {0}", id) + '<select data-agent-batch-type="' + id + '"><option value="">' + "Skip this type" + '</option>';
        for (var i = 0; i < groups[id].length; i++) {
            var index = groups[id][i], file = build.artifacts[index];
            html += '<option value="' + index + '"' + (groups[id].length === 1 ? ' selected' : '') + '>' + EscapeHtml(file.filename + (file.requirements ? ' / ' + file.requirements : '')) + '</option>';
        }
        html += '</select></label>';
    }
    QH('agentBatchFiles', html || '<p>' + "No files in this build match the selected agent types." + '</p>');
    QE('idx_dlgOkButton', !pin || Object.keys(groups).length > 0);
}
function agentManagerBatchPreview() {
    var mode = Q('agentBatchMode').value, build = agentManager.catalog[Q('agentBatchBuild').value], files = [], selectors = Q('agentBatchFiles').querySelectorAll('select');
    for (var i = 0; i < selectors.length; i++) if (selectors[i].value !== '') {
        var file = build.artifacts[selectors[i].value]; files.push({ agentId: file.id, filename: file.filename, sha256: file.sha256 });
    }
    agentManagerRun('deployment', { op: 'preview', mode: mode, nodeids: agentManager.nodeids, build: build && build.id, files: files, batchSize: Number(Q('agentBatchSize').value), allowUnknown: Q('agentBatchUnknown').checked }, function (result) { agentManager.mode = 'job'; agentManagerJob(result.id, 0); });
}
function agentManagerJobs(offset) {
    var current = agentManager;
    current.submit = null; agentManagerButton("Close", true);
    agentManagerRequest('deployment', { op: 'list', offset: offset }).then(function (result) {
        if (agentManager !== current) return;
        var html = '<p>' + "Use Group Action on selected devices, or Actions on the mobile device page." + '</p>';
        for (var i = 0; i < result.jobs.length; i++) {
            var job = result.jobs[i];
            html += '<div class="agent-manager-row"><button type="button" data-job="' + job.id + '" onclick="agentManager.mode=\'job\';agentManagerJob(this.getAttribute(\'data-job\'),0)">' + EscapeHtml(job.name) + '</button><span>' + EscapeHtml(agentManagerStage(job.stage)) + ' / ' + job.total + '</span><div class="agent-muted">' + EscapeHtml(new Date(job.created).toLocaleString()) + '</div></div>';
        }
        html += agentManagerPager(offset, result.total, 20, 'agentManagerJobs'); agentManagerHtml(html);
    }).catch(function (error) { if (agentManager === current) agentManagerError(error); });
}
function agentManagerJob(id, offset) {
    var current = agentManager;
    if (current.busy) return;
    current.id = id; current.offset = offset;
    if (!Q('agentJobReport')) agentManagerHtml('<div id="agentJobReport" role="status" aria-live="polite"></div><div class="agent-manager-toolbar"><button id="agentJobPause" type="button" onclick="agentManagerJobAction(\'pause\')">' + "Pause" + '</button><button id="agentJobCancel" type="button" onclick="agentManagerJobAction(\'cancel\')">' + "Cancel remaining" + '</button><button type="button" onclick="agentManagerJob(agentManager.id,agentManager.offset)">' + "Refresh" + '</button></div><label id="agentJobConfirm"><input id="agentJobRecovery" type="checkbox" onchange="agentManagerJobButton()" /> ' + "I can recover these devices locally and accept interruption of active sessions." + '</label><p>' + "Closing this dialog does not stop a running deployment. Pause or cancel stops new work; policies already applied remain in place." + '</p><div id="agentJobRows"></div>');
    if (current.timer) { clearTimeout(current.timer); current.timer = null; }
    var seq = current.serial = (current.serial || 0) + 1;
    agentManagerRequest('deployment', { op: 'get', id: id, offset: offset }).then(function (job) {
        if (agentManager !== current || current.serial !== seq) return;
        current.job = job; QH('agentManagerError', '');
        var counts = job.counts;
        QH('agentJobReport', '<b>' + EscapeHtml(job.name) + '</b><p>' + EscapeHtml(agentManagerStage(job.stage)) + ' / ' + format("{0} devices, batches of {1}", job.total, job.batchSize) + '</p><p>' + format("Ready: {0}. Skipped: {1}. Active: {2}. Verified: {3}. Failed: {4}. Cancelled: {5}.", counts.ready || 0, counts.skipped || 0, (counts.starting || 0) + (counts.waiting || 0), counts.confirmed || 0, counts.failed || 0, counts.cancelled || 0) + '</p>' + (job.error ? '<p class="agent-error">' + EscapeHtml(job.error) + '</p>' : ''));
        QV('agentJobPause', ['running', 'preparing'].indexOf(job.stage) >= 0); QV('agentJobCancel', ['complete', 'cancelled', 'cancelling'].indexOf(job.stage) < 0);
        QV('agentJobConfirm', ['ready', 'paused'].indexOf(job.stage) >= 0);
        var html = '';
        for (var i = 0; i < job.targets.length; i++) {
            var target = job.targets[i];
            html += '<div class="agent-manager-row"><b>' + EscapeHtml(target.name || target.nodeid) + '</b><span>' + EscapeHtml(agentManagerStage(target.progress && target.state === 'waiting' ? target.progress : target.state)) + '</span>' + (target.error ? '<div class="agent-error">' + EscapeHtml(target.error) + '</div>' : '') + '</div>';
        }
        html += agentManagerPager(offset, job.total, 50, 'agentManagerJobPage'); QH('agentJobRows', html); agentManagerJobButton();
        if (['complete', 'cancelled'].indexOf(job.stage) < 0) current.timer = setTimeout(function () { if (agentManager === current) agentManagerJob(id, current.offset); }, 3000);
    }).catch(function (error) {
        if (agentManager !== current || current.serial !== seq) return;
        agentManagerError(error); current.timer = setTimeout(function () { if (agentManager === current) agentManagerJob(id, current.offset); }, 5000);
    });
}
function agentManagerStage(stage) {
    return ({ preparing: "Checking devices", ready: "Ready", running: "Running", paused: "Paused", cancelling: "Cancelling remaining devices", cancelled: "Cancelled", complete: "Completed", skipped: "Skipped", starting: "Saving policy", waiting: "Waiting for verification", confirmed: "Verified", failed: "Needs attention", pending: "Pending", updating: "Updating", reconnecting: "Waiting for reconnect", unconfirmed: "Not verified", held: "Held", default: "Server default" })[stage] || stage;
}
function agentManagerJobPage(offset) { agentManagerJob(agentManager.id, offset); }
function agentManagerJobButton() {
    var job = agentManager.job, start = job && ['ready', 'paused'].indexOf(job.stage) >= 0 && ((job.counts.ready || 0) > 0 || job.stage === 'paused');
    agentManager.submit = start ? function () { agentManagerJobAction(job.stage === 'ready' ? 'start' : 'resume'); } : null;
    agentManagerButton(start ? (job.stage === 'ready' ? "Start deployment" : "Resume remaining") : "Close", !agentManager.busy && (!start || Q('agentJobRecovery').checked));
}
function agentManagerJobAction(op) {
    var current = agentManager;
    if (current.busy) return;
    current.serial = (current.serial || 0) + 1;
    if (current.timer) { clearTimeout(current.timer); current.timer = null; }
    agentManagerRun('deployment', { op: op, id: current.id, confirm: Q('agentJobRecovery').checked }, function () { Q('agentJobRecovery').checked = false; agentManagerJob(current.id, current.offset); });
}

function agentManagerDevice(nodeid) { agentManagerClose(); gotoDevice(nodeid, 10); }

function agentManagerImportForm() {
    var current = agentManager;
    agentManagerButton("Loading...", false);
    agentManagerRequest('import', { op: 'settings' }).then(function (settings) {
        if (agentManager !== current) return;
        current.githubSettings = settings;
        agentManagerImportSources();
    }).catch(function (error) {
        if (agentManager !== current) return;
        agentManagerError(error); current.submit = agentManagerImportForm; agentManagerButton("Retry", true);
    });
}
function agentManagerImportSources() {
    agentManagerHtml('<label class="agent-manager-field">' + "Source" + '<select id="agentImportSource" onchange="agentManagerImportSource()"><option value="github">GitHub</option><option value="url">' + "Download URL" + '</option></select></label><div id="agentImportForm"></div>');
    agentManagerImportSource();
}
function agentManagerImportSource() {
    var current = agentManager;
    current.serial = (current.serial || 0) + 1; current.selection = null; current.items = null; current.busy = false;
    QH('agentManagerError', '');
    if (Q('agentImportSource').value === 'url') {
        QH('agentImportForm', '<label class="agent-manager-field">HTTPS URL<input id="agentImportUrl" type="url" maxlength="4096" autocomplete="off" /></label><label class="agent-manager-field">' + "Filename (optional)" + '<input id="agentImportFilename" maxlength="128" /></label><label class="agent-manager-field">' + "Expected SHA256 (optional)" + '<input id="agentImportHash" maxlength="64" /></label><p>' + "Download a native binary or ZIP from a public HTTPS address. Up to 128 MiB downloaded and unpacked, 16 binaries, 64 MiB per file." + '</p>');
        current.submit = agentManagerImportStart; agentManagerButton("Download and review", true);
    } else {
        QH('agentImportForm', '<label class="agent-manager-field">' + "Repository" + '<input id="agentGithubRepo" oninput="agentManagerGithubKind()" value="Ylianst/MeshAgent" maxlength="201" /></label><label class="agent-manager-field">' + "Builds" + '<select id="agentGithubKind" onchange="agentManagerGithubKind()"><option value="runs">' + "Workflow runs" + '</option><option value="pull-request">' + "Pull request" + '</option><option value="releases">' + "Releases" + '</option><option value="run">' + "Run ID" + '</option></select></label><label class="agent-manager-field" id="agentGithubFilterRow"><span id="agentGithubFilterLabel">' + "Branch or commit" + '</span><input id="agentGithubFilter" oninput="agentManagerGithubKind()" maxlength="200" /></label><p class="agent-muted">' + (current.githubSettings.tokenConfigured ? "GitHub token configured on server." : "GitHub token not configured. Public builds can be browsed; Actions downloads need a server token.") + '</p><details><summary>' + "GitHub settings" + '</summary><p>' + "Set agentBuilds.github.token in this domain in config.json, then restart MeshCentral. Actions downloads need Actions read; private releases need Contents read; private PR lookup needs Pull requests read." + '</p><p>' + "Only successful runs with available artifacts matching these names are listed:" + ' ' + EscapeHtml(current.githubSettings.artifactNames.join(', ')) + '</p></details><div class="agent-manager-toolbar"><button type="button" onclick="agentManagerGithubBrowse(1)">' + "Find builds" + '</button></div><div id="agentGithubResults"></div>');
        current.submit = function () { agentManagerGithubBrowse(1); }; agentManagerButton("Find builds", true);
    }
}
function agentManagerGithubKind() {
    agentManager.serial = (agentManager.serial || 0) + 1; agentManager.busy = false;
    QV('agentGithubFilterRow', Q('agentGithubKind').value !== 'releases');
    QH('agentGithubFilterLabel', Q('agentGithubKind').value === 'pull-request' ? "PR number" : Q('agentGithubKind').value === 'run' ? "Run ID" : "Branch or commit");
    agentManager.selection = null; QH('agentGithubResults', '');
    agentManager.submit = function () { agentManagerGithubBrowse(1); }; agentManagerButton("Find builds", true);
}
function agentManagerGithubBrowse(page, selection) {
    var current = agentManager, seq = current.serial = (current.serial || 0) + 1;
    var request = { op: 'browse', repository: Q('agentGithubRepo').value.trim(), kind: Q('agentGithubKind').value, filter: Q('agentGithubFilter').value.trim(), page: page };
    if (selection) Object.assign(request, selection);
    current.selection = null; current.busy = true; agentManagerButton("Loading...", false); QH('agentManagerError', ''); QH('agentGithubResults', '<p role="status">' + "Loading GitHub builds..." + '</p>');
    agentManagerRequest('import', request).then(function (result) {
        if (agentManager !== current || current.serial !== seq) return;
        current.busy = false; current.items = result.items; current.browse = { repository: request.repository, kind: request.kind, filter: request.filter, run: request.run, release: request.release };
        var assets = request.kind === 'assets' || request.kind === 'artifacts', html = '';
        if (selection) html += '<button type="button" onclick="agentManagerGithubBrowse(1)">' + "Back to builds" + '</button>';
        if (result.note) html += '<p>' + EscapeHtml(result.note) + '</p>';
        if (result.source) html += agentManagerImportProvenance(result.source);
        if (!result.items.length) html += '<p>' + (assets ? "No agent artifacts are available for this build." : request.kind === 'releases' ? "This repository has no releases on this page. Try Workflow runs." : "No successful runs with matching, unexpired agent artifacts on this page.") + (result.more ? ' ' + "Try the next page." : '') + '</p>';
        if (request.kind === 'artifacts' && !current.githubSettings.tokenConfigured) html += '<p>' + "Configure a GitHub token on the server to download these artifacts." + '</p>';
        for (var i = 0; i < result.items.length; i++) {
            var item = result.items[i];
            html += '<div class="agent-import-row">';
            if (assets) html += '<label><input type="checkbox" class="agent-import-choice" data-index="' + i + '" onchange="agentManagerGithubSelected()"' + (item.available ? '' : ' disabled') + ' /> ' + EscapeHtml(item.name) + '</label><span class="agent-muted"> ' + (item.size / 1048576).toFixed(1) + ' MiB</span>';
            else html += '<button type="button" onclick="agentManagerGithubBuild(' + i + ')"' + (item.available ? '' : ' disabled') + '>' + EscapeHtml(item.name) + '</button>';
            if (item.detail) html += '<div class="agent-muted">' + EscapeHtml(item.detail) + '</div>';
            html += '</div>';
        }
        html += '<div class="agent-manager-toolbar"><button type="button" onclick="agentManagerGithubPage(' + Math.max(1, page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>' + "Previous" + '</button><span>' + format("Page {0}", page) + '</span><button type="button" onclick="agentManagerGithubPage(' + (page + 1) + ')"' + (!result.more ? ' disabled' : '') + '>' + "Next" + '</button></div>';
        QH('agentGithubResults', html); current.submit = assets ? agentManagerImportStart : null; agentManagerButton(assets ? "Download and review" : "Close", !assets);
    }).catch(function (error) { if (agentManager !== current || current.serial !== seq) return; agentManagerError(error); current.submit = function () { agentManagerGithubBrowse(page, selection); }; agentManagerButton("Retry", true); });
}
function agentManagerGithubPage(page) { agentManagerGithubBrowse(page, agentManager.browse); }
function agentManagerGithubBuild(index) {
    var current = agentManager, item = current.items[index];
    agentManagerGithubBrowse(1, Object.assign({}, current.browse, current.browse.kind === 'releases' ? { kind: 'assets', release: item.id } : { kind: 'artifacts', run: item.id }));
}
function agentManagerGithubSelected() {
    var ids = [], current = agentManager;
    Q('agentGithubResults').querySelectorAll('.agent-import-choice:checked').forEach(function (input) { ids.push(current.items[Number(input.getAttribute('data-index'))].id); });
    current.selection = ids;
    agentManagerButton("Download and review", !current.busy && ids.length > 0 && ids.length <= 16 && (current.browse.kind !== 'artifacts' || current.githubSettings.tokenConfigured));
}
function agentManagerImportStart() {
    var current = agentManager, request = { op: 'start', kind: 'url' };
    if (Q('agentImportSource').value === 'url') Object.assign(request, { url: Q('agentImportUrl').value.trim(), filename: Q('agentImportFilename').value.trim(), sha256: Q('agentImportHash').value.trim() });
    else {
        if (!current.selection || !current.selection.length) return;
        Object.assign(request, current.browse, { ids: current.selection });
    }
    current.importId = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    request.id = current.importId;
    current.busy = true; current.submit = null; agentManagerButton("Downloading...", false);
    agentManagerHtml('<p id="agentImportState" role="status" aria-live="polite">' + "Resolving download..." + '</p><progress id="agentImportProgress" max="100"></progress><p id="agentImportNotice">' + "Files will be inspected before you can add this build. Closing this dialog cancels the import." + '</p>');
    agentManagerRequest('import', request).then(function (result) {
        if (agentManager !== current) { agentManagerRequest('import', { op: 'cancel', id: result.id }).catch(function () {}); return; }
        current.importId = result.id; agentManagerImportPoll();
    }).catch(function (error) {
        if (agentManager !== current) return;
        if (error.code === 'timeout') { QH('agentManagerError', EscapeHtml(error.message)); agentManagerImportPoll(); }
        else { current.importId = null; agentManagerImportFailed(error); }
    });
}
function agentManagerImportFailed(error) {
    QH('agentImportState', "Import stopped."); QV('agentImportProgress', false);
    QH('agentImportNotice', "Nothing was added to the catalog. Try again or close this dialog.");
    agentManagerError(error); agentManager.submit = agentManagerImportForm; agentManagerButton("Try again", true);
}
function agentManagerImportPoll() {
    var current = agentManager;
    agentManagerRequest('import', { op: 'get', id: current.importId }).then(function (result) {
        if (agentManager !== current) return;
        if (result.stage === 'review') { current.importId = null; current.busy = false; current.draft = result.draft; agentManagerUploadReview(); return; }
        if (result.stage === 'failed' || result.stage === 'cancelled' || result.stage === 'unavailable') { current.importId = null; agentManagerImportFailed(result.error); return; }
        var state = result.stage === 'resolving' ? "Resolving download..." : result.stage === 'inspecting' ? "Inspecting files..." : format("Downloading {0} ({1} of {2})", result.file, result.index, result.count);
        if (result.received) state += ' / ' + (result.received / 1048576).toFixed(1) + ' MiB';
        QH('agentImportState', EscapeHtml(state));
        if (result.total) Q('agentImportProgress').value = Math.min(100, result.received * 100 / result.total); else Q('agentImportProgress').removeAttribute('value');
        current.timer = setTimeout(agentManagerImportPoll, 1000);
    }).catch(function (error) {
        if (agentManager !== current) return;
        QH('agentManagerError', EscapeHtml(error.message));
        current.timer = setTimeout(agentManagerImportPoll, 5000);
    });
}
function agentManagerImportProvenance(source) {
    var html = '<div class="agent-import-source">';
    if (source.repository) html += '<b>' + EscapeHtml(source.repository) + '</b>';
    if (source.url) html += '<div class="agent-hash">' + EscapeHtml(source.url) + '</div>';
    if (source.commit) html += '<div class="agent-hash">' + "Source commit" + ': <code>' + EscapeHtml(source.commit) + '</code></div>';
    if (source.runId) html += '<div>' + EscapeHtml([source.event, source.branch, source.headRepository, 'Run ' + source.runId, 'Attempt ' + source.runAttempt].filter(Boolean).join(' / ')) + '</div>';
    if (source.tag) html += '<div>' + "Tag" + ': ' + EscapeHtml(source.tag) + '</div>';
    if (source.downloads) for (var i = 0; i < source.downloads.length; i++) {
        var file = source.downloads[i];
        html += '<details><summary>' + EscapeHtml(file.name) + ' / ' + (file.digestVerified ? "Download SHA256 verified" : "No expected digest supplied") + '</summary><div class="agent-hash">' + EscapeHtml(file.url) + '<br />SHA256 <code>' + EscapeHtml(file.sha256) + '</code></div></details>';
    }
    return html + '<p class="agent-muted">' + "Source details describe where the files were obtained. They do not prove which source code the binary contains or that it is safe to run." + '</p></div>';
}
