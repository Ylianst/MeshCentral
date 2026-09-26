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

// Same regions as the device dialog: a head that names the subject and may shrink and scroll itself, one
// scroller, then the blocked reason and the error pinned beside the footer so neither can appear off
// screen. Everything is rewritten through agentBuildHtml, so a 1s or 3s poll leaves focus, text selection
// and open details alone.
function agentManagerFrame() {
    if (!Q('agentManagerBody') || Q('agentManagerHead')) return;
    QH('agentManagerBody', '<div id="agentManagerHead"><div id="agentManagerSubject"></div><div id="agentManagerState" role="status" aria-live="polite"></div><div id="agentManagerCounts" class="agent-manager-tally"></div><div id="agentManagerNotice"></div></div><div id="agentManagerContent"></div><p id="agentManagerReason" role="status" aria-live="polite"></p><p id="agentManagerError" role="alert" class="agent-error"></p>');
    var button = Q('idx_dlgOkButton');
    if (button) button.setAttribute('aria-describedby', 'agentManagerReason');
}
function agentManagerHtml(html) { agentManagerFrame(); agentBuildHtml('agentManagerContent', html); }
function agentManagerClearError() { agentBuildHtml('agentManagerError', ''); }
function agentManagerError(error) {
    if (!agentManager) return;
    agentManager.busy = false;
    agentManagerFrame();
    var element = Q('agentManagerError');
    if (!element) return;
    var text = EscapeHtml((error && error.message) || error || "The operation failed.");
    // A failing poll reports the same error every few seconds, and scrolling on each one would fight
    // whoever is reading it.
    if (element.innerHTML === text) return;
    agentBuildHtml('agentManagerError', text);
    element.scrollIntoView({ block: 'nearest' });
}

function agentManagerSubject(title, detail, tools) {
    agentBuildHtml('agentManagerSubject', '<div class="agent-build-headline"><b>' + EscapeHtml(title) + '</b>' + (tools ? ('<span class="agent-build-headtools">' + tools + '</span>') : '') + '</div>' + (detail ? ('<div class="agent-muted">' + EscapeHtml(detail) + '</div>') : ''));
}
function agentManagerStateLine(level, text) { agentBuildHtml('agentManagerState', text ? ('<span class="' + level + '">' + EscapeHtml(text) + '</span>') : ''); }
function agentManagerNotice(html) { agentBuildHtml('agentManagerNotice', html); }
// Reasons are plain text and are escaped once here, so nothing that reaches this may come from format().
function agentManagerReason(text) { agentBuildHtml('agentManagerReason', text ? EscapeHtml(text) : ''); }
// The primary keeps taking focus while blocked, otherwise the reason it points at is unreachable. This is
// agentBuildOk's contract, kept local so the manager never writes the device dialog's agentBuildBlocked.
function agentManagerOk(enabled) {
    if (agentManager) agentManager.blocked = !enabled;
    var button = Q('idx_dlgOkButton');
    if (!button) return;
    button.disabled = false;
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (enabled) { button.classList.remove('agent-build-off'); } else { button.classList.add('agent-build-off'); }
}
// Cancel is hidden when there is nothing to cancel, read from the submit handler rather than from the
// primary's label: comparing against the literal "Close" is what collapsed the footer to one dead button.
function agentManagerButton(label, enabled, reason) {
    agentBuildButton(label);
    agentManagerOk(enabled);
    agentManagerReason(enabled ? '' : reason);
    QV('idx_dlgCancelButton', !!(agentManager && agentManager.submit));
}
function agentManagerShowReason() {
    if (Q('agentManagerReason')) Q('agentManagerReason').scrollIntoView({ block: 'nearest' });
    var focus = agentManager && agentManager.focus && Q(agentManager.focus);
    if (focus) { focus.scrollIntoView({ block: 'nearest' }); focus.focus(); }
}
function agentManagerKey(event, action) { if (event.key !== 'Enter') return true; action(); return false; }

function agentManagerControl(id, label, control, note) {
    return '<div class="agent-build-field"><label for="' + id + '">' + label + '</label><div>' + control + (note ? ('<div class="agent-build-note">' + note + '</div>') : '') + '</div></div>';
}
// One figure in the tally. A zero is dropped unless it is the subject of the dialog, which is what
// always is for: an installed count of 0 is the answer, an unconfirmed count of 0 is noise.
function agentManagerCount(label, value, level, always) { return (value || always) ? ('<span>' + label + ' <b class="' + level + '">' + value + '</b></span>') : ''; }
function agentManagerDeviceHtml(nodeid, name) {
    return '<button type="button" class="agent-linkbutton" data-node="' + EscapeHtml(nodeid) + '" onclick="agentManagerDevice(this.getAttribute(\'data-node\'))">' + EscapeHtml(name || nodeid) + '</button>';
}
function agentManagerPager(offset, total, size, callback) {
    if (total <= size) return '';
    return '<div class="agent-manager-toolbar" role="group" aria-label="' + "Pages" + '"><button type="button" onclick="' + callback + '(' + Math.max(0, offset - size) + ')"' + (offset <= 0 ? ' disabled' : '') + '>' + "Previous" + '</button><span>' + format("{0} to {1} of {2}", total ? offset + 1 : 0, Math.min(offset + size, total), total) + '</span><button type="button" onclick="' + callback + '(' + (offset + size) + ')"' + (offset + size >= total ? ' disabled' : '') + '>' + "Next" + '</button></div>';
}

function agentManagerStage(stage) {
    return ({ preparing: "Checking devices", ready: "Ready", running: "Running", paused: "Paused", cancelling: "Cancelling remaining devices", cancelled: "Cancelled", complete: "Completed", skipped: "Skipped", starting: "Saving policy", waiting: "Waiting for verification", confirmed: "Verified", failed: "Needs attention", pending: "Pending", updating: "Updating", reconnecting: "Waiting for reconnect", unconfirmed: "Not verified", held: "Held", 'default': "Server default" })[stage] || stage;
}
function agentManagerModeLabel(mode) { return ({ pin: "Pin a build", hold: "Keep the installed agent file", 'default': "Follow server default" })[mode] || mode; }
function agentManagerRelation(mode) { return ({ pin: "Pinned", hold: "Held", 'default': "Server default" })[mode] || mode; }
function agentManagerUsageState(row) {
    return (['held', 'default'].indexOf(row.state) >= 0) ? agentManagerRelation(row.mode) : (agentManagerRelation(row.mode) + ' / ' + agentManagerStage(row.state));
}
function agentManagerAgentType(id) { return agentsStr[id] || ('' + id); }
function agentManagerTargetLevel(state) {
    return (state === 'failed') ? 'agent-error' : ((state === 'skipped') ? 'agent-warn' : ((state === 'confirmed') ? 'agent-match' : ''));
}
function agentManagerJobLevel(job) {
    if ((job.counts || {}).failed) return 'agent-error';
    if (['paused', 'cancelled', 'cancelling'].indexOf(job.stage) >= 0) return 'agent-warn';
    return (job.stage === 'complete') ? 'agent-match' : '';
}
// Older records store an English display name for the two policy modes, so only a pinned build takes its
// name from the record.
function agentManagerJobName(job) { return (job.mode === 'pin') ? (job.name || agentManagerModeLabel('pin')) : agentManagerModeLabel(job.mode); }
function agentManagerFileState(status) {
    var text = ({ Ready: "Ready", Downloading: "Downloading", Unavailable: "Unavailable", 'Not checked': "Not checked" })[status];
    return { level: (status === 'Ready') ? 'agent-match' : ((status === 'Unavailable') ? 'agent-error' : ''), text: text || status };
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
    var button = Q('idx_dlgOkButton');
    // setDialogMode re-enables this button on the next dialog without clearing the focusable-disabled
    // state, so a manager dialog that left it set would grey out an unrelated primary.
    if (button) { button.disabled = false; button.classList.remove('agent-build-off'); button.removeAttribute('aria-disabled'); button.removeAttribute('aria-describedby'); }
    if (Q('agentManagerBody')) Q('agentManagerBody').remove();
}
function agentManagerClose(after) { agentManagerClosed(); closeAgentManagerDialog(after); return false; }
function agentManagerSubmit() {
    if (!agentManager || agentManager.busy) return false;
    if (agentManager.blocked) { agentManagerShowReason(); return false; }
    if (agentManager.submit) agentManager.submit(); else agentManagerClose();
    return false;
}
function agentManagerGoto(mode) {
    if (!agentManager) return false;
    agentManager.mode = mode; agentManager.focus = ''; agentManagerClearError();
    if (mode === 'jobs') agentManagerJobs(0);
    return false;
}
function agentManagerOpen(mode, options) {
    if (xxdialogMode || !userinfo || userinfo.siteadmin != 0xFFFFFFFF) return false;
    var button = Q('idx_dlgOkButton'), cancel = Q('idx_dlgCancelButton');
    var titles = { defaults: "Default agent downloads", 'import': "Import agent build", upload: "Upload agent build", usage: "Build usage", manage: "Manage agent build", bulk: "Deploy agent build", job: "Agent deployment", jobs: "Agent deployments" };
    var title = titles[mode] || titles.jobs;
    agentManager = Object.assign({ mode: mode, offset: 0, focus: '', state: '', buttonText: button.tagName === 'INPUT' ? button.value : button.textContent, cancelText: cancel ? (cancel.tagName === 'INPUT' ? cancel.value : cancel.textContent) : '' }, options || {});
    // Manage is two fields and an action select; everything else carries device rows, file rows or 96
    // character hashes and needs the width the device dialog uses.
    showAgentManagerDialog(title, mode === 'manage' ? null : 'large');
    if (Q('dialog')) Q('dialog').classList.add('agent-manager-dialog');
    agentBuildCancelButton("Close");
    agentManagerHtml('<p role="status">' + "Loading..." + '</p>');
    agentManagerSubject(title); agentManagerButton("Close", true);
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
function agentManagerRun(area, command, callback) {
    var current = agentManager;
    if (!current || current.busy) return;
    current.busy = true; agentManagerOk(false); agentManagerClearError();
    agentManagerRequest(area, command).then(function (result) {
        if (agentManager !== current) return;
        current.busy = false; callback(result);
    }).catch(function (error) {
        if (agentManager !== current) return;
        agentManagerError(error);
        // A refused request leaves the form it came from usable, so the server's reason can be acted on.
        if (current.draft) { current.committing = false; agentManagerReviewChanged(); }
        else if ((current.mode === 'bulk') && Q('agentBatchMode')) agentManagerBatchChanged();
        else if (current.mode === 'job') agentManagerJob(current.id, current.offset);
        else { current.submit = null; agentManagerButton("Close", true); }
    });
}
// go() refuses a view change while a dialog is open, and the modal host closes asynchronously,
// so the jump to the device waits until the dialog has actually gone.
function agentManagerDevice(nodeid) { agentManagerClose(function () { gotoDevice(nodeid, 10); }); }

function agentManagerDefaultsState(result) {
    if (result.busy) return { level: '', text: "Restoring files. You can close this dialog while downloads continue." };
    if (result.error) return { level: 'agent-error', text: result.error };
    if (result.restartRequired) return { level: 'agent-warn', text: "Files are ready. Restart MeshCentral to load the restored defaults." };
    if (!result.files.length) return { level: 'agent-warn', text: "No default release versions are configured. Configure a release manifest or supply local files." };
    var missing = 0, i;
    for (i = 0; i < result.files.length; i++) if (result.files[i].status !== 'Ready') missing++;
    // Concatenated rather than format()ed, because the state line escapes what it is given.
    if (missing) return { level: 'agent-error', text: missing + ' ' + "of" + ' ' + result.files.length + ' ' + "release files are missing." };
    return { level: 'agent-match', text: "All release files are present." };
}
function agentManagerDefaultsReleases(result) {
    var updates = result.updates, html, i;
    if (!updates) return '';
    html = '<details data-agent-detail="releases"><summary>' + "Release updates" + '</summary>';
    if (result.canManage && updates.enabled) html += '<div class="agent-manager-toolbar"><button type="button" onclick="agentManagerDefaults(\'updates\')"' + (updates.checking ? ' disabled' : '') + '>' + (updates.checking ? "Checking for releases..." : "Check for releases") + '</button></div>';
    html += '<p class="agent-muted">' + "Checking for releases does not change the server defaults or install agents." + '</p>';
    if (!updates.intervalHours) html += '<p class="agent-warn">' + "Scheduled release checks are disabled." + '</p>';
    for (i = 0; i < updates.repositories.length; i++) {
        var repository = updates.repositories[i], state = '', detail = '<div class="agent-muted">' + EscapeHtml(repository.tags.join(', ')) + '</div>';
        if (repository.latest) {
            state = '<span class="' + (repository.latest.updateAvailable ? 'agent-warn' : 'agent-match') + '">' + (repository.latest.updateAvailable ? "Release available" : "Latest stable release") + '</span>';
            detail += '<div><a href="' + EscapeHtml(repository.latest.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + EscapeHtml(repository.latest.tag) + '</a></div>';
            if (repository.latest.updateAvailable) detail += '<div>' + "Import this release to review its files and test it on selected devices." + '</div>';
        } else detail += '<div>' + (repository.lastSuccess ? "No stable release with an agent manifest was found." : "Not checked") + '</div>';
        if (repository.lastSuccess) detail += '<div class="agent-muted">' + "Last successful check" + ': ' + printDateTime(new Date(repository.lastSuccess)) + '</div>';
        if (repository.error) detail += '<div class="agent-error">' + EscapeHtml(repository.error) + '</div>';
        html += '<div class="agent-manager-row"><div><b>' + EscapeHtml(repository.repository) + '</b></div><div>' + state + '</div><div class="agent-manager-detail">' + detail + '</div></div>';
    }
    return html + '</details>';
}
function agentManagerDefaults(retry) {
    var current = agentManager;
    if (retry) current.refreshCatalog = true;
    if (current.timer) clearTimeout(current.timer);
    // The server sets its own checking flag before it answers, so a release check needs no optimistic
    // relabel of the primary.
    if (retry !== 'updates') agentManagerButton(retry ? "Restoring files..." : "Loading...", false, '');
    agentManagerRequest('defaults', { op: retry === 'updates' ? 'updates' : retry ? 'retry' : 'status' }).then(function (result) {
        if (agentManager !== current) return;
        agentManagerClearError();
        var html = '', notice = '', state = agentManagerDefaultsState(result), file, detail, i;
        agentManagerSubject("Default agent downloads", "These release files supply the server defaults for new agent installs.");
        agentManagerStateLine(state.level, state.text);
        if (!result.enabled) notice += '<div class="agent-warn">' + "Automatic downloads are disabled. Local files and matching uploaded builds can still be used." + '</div>';
        if (!result.canManage) notice += '<div class="agent-warn">' + "Manage shared defaults from the default server domain." + '</div>';
        // Every per-file failure has its own row, so the aggregate list only matters when there are no
        // rows at all, which is the manifest read failure.
        if (!result.files.length) for (i = 0; i < result.errors.length; i++) notice += '<div class="agent-error">' + EscapeHtml(result.errors[i]) + '</div>';
        agentManagerNotice(notice);
        for (i = 0; i < result.files.length; i++) {
            file = result.files[i];
            detail = '<div class="agent-muted"><a href="' + EscapeHtml(file.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + EscapeHtml(file.repository + ' / ' + file.tag) + '</a></div>';
            if (file.error) detail += '<div class="agent-error">' + EscapeHtml(file.error) + '</div>';
            if (file.status === 'Downloading') detail += '<label class="agent-manager-progress">' + format("Received {0} MiB of {1} MiB", ((file.received || 0) / 1048576).toFixed(1), (file.size / 1048576).toFixed(1)) + '<progress max="' + file.size + '" value="' + (file.received || 0) + '"></progress></label>';
            var fileState = agentManagerFileState(file.status);
            html += '<div class="agent-manager-row"><div><b>' + EscapeHtml(file.filename) + '</b></div><div class="' + fileState.level + '">' + EscapeHtml(fileState.text) + '</div><div class="agent-manager-detail">' + detail + '</div></div>';
        }
        html += agentManagerDefaultsReleases(result);
        html += '<details data-agent-detail="offline"><summary>' + "About default downloads" + '</summary><p>' + "Restoring files does not change device policies. It only fetches the release files this server is configured to serve." + '</p><p>' + "Without internet access, upload the required release files into Agent builds, then restore missing files here. The files must match the hashes in the release manifest." + '</p></details>';
        agentManagerHtml(html);
        current.submit = (result.canManage && result.files.length) ? function () { agentManagerDefaults(true); } : null;
        if (result.busy) agentManagerButton("Restoring files...", false, '');
        else if (current.submit) agentManagerButton("Restore missing files", true);
        else agentManagerButton("Close", true);
        if (result.busy || (result.updates && result.updates.checking)) current.timer = setTimeout(function () { if (agentManager === current) agentManagerDefaults(false); }, 1000);
        else if (current.refreshCatalog || result.restartRequired) { current.refreshCatalog = false; refreshAgentCatalog(); }
    }).catch(function (error) {
        if (agentManager !== current) return;
        agentManagerError(error); current.submit = function () { agentManagerDefaults(false); }; agentManagerButton("Retry", true);
    });
}

function agentManagerUploadForm() {
    agentManagerSubject("Upload agent files", "Review the detected platform, requirements and hashes before the files become a build.");
    agentManagerStateLine('', '');
    agentManagerNotice('');
    agentManagerHtml(agentManagerControl('agentUploadFiles', "Agent files", '<input id="agentUploadFiles" type="file" multiple onchange="agentManagerUploadSelected()" />', "Up to 16 files, 64 MiB each and 128 MiB in total.") + '<p id="agentUploadState" role="status" aria-live="polite"></p><progress id="agentUploadProgress" max="100" value="0" style="display:none"></progress>');
    agentManager.submit = agentManagerUpload; agentManager.focus = 'agentUploadFiles';
    agentManagerButton("Review files", false, "Select the agent files to upload.");
}
function agentManagerUploadSelected() {
    var files = Q('agentUploadFiles').files, total = 0, reason = '', i;
    for (i = 0; i < files.length; i++) {
        total += files[i].size;
        // Concatenated, not format()ed: the reason is escaped once at the sink.
        if (!reason && (files[i].size > 67108864)) reason = files[i].name + ': ' + "this file is larger than 64 MiB.";
    }
    if (!files.length) reason = "Select the agent files to upload.";
    else if (files.length > 16) reason = "Select at most 16 agent files.";
    else if (!reason && (total > 134217728)) reason = "The selected files are larger than 128 MiB in total.";
    agentBuildHtml('agentUploadState', reason ? '' : format("Files selected: {0}", files.length));
    agentManager.focus = 'agentUploadFiles';
    agentManagerButton("Review files", reason === '', reason);
}
function agentManagerUpload() {
    var current = agentManager, body = new FormData(), files = Q('agentUploadFiles').files, i;
    if (!files.length) return;
    for (i = 0; i < files.length; i++) body.append('files', files[i]);
    var request = new XMLHttpRequest(); current.upload = request; current.busy = true;
    agentManagerOk(false); QE('agentUploadFiles', false); QV('agentUploadProgress', true);
    agentManagerButton("Uploading...", false, '');
    agentBuildHtml('agentUploadState', "Uploading files...");
    // The server inspects after the last byte lands, so the bar goes indeterminate under its own label
    // rather than sitting at 100 per cent while the upload label still shows.
    request.upload.onprogress = function (event) {
        if ((agentManager !== current) || !event.lengthComputable) return;
        var percent = Math.floor(event.loaded * 100 / event.total);
        if (percent < 100) { Q('agentUploadProgress').value = percent; }
        else { Q('agentUploadProgress').removeAttribute('value'); agentBuildHtml('agentUploadState', "Inspecting files..."); }
    };
    function fail(message) {
        if (agentManager !== current) return;
        current.upload = null; current.busy = false;
        agentBuildHtml('agentUploadState', ''); QV('agentUploadProgress', false); Q('agentUploadProgress').value = 0;
        QE('agentUploadFiles', true); agentManagerError(message); agentManagerUploadSelected();
    }
    request.onload = function () {
        if (agentManager !== current) return;
        current.upload = null; current.busy = false;
        var result;
        try { result = JSON.parse(request.responseText); } catch (ex) { fail("Unable to read the upload result."); return; }
        if ((request.status !== 200) || result.error) { fail(result.error || "Upload failed."); return; }
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
    var draft = agentManager.draft, files = draft.artifacts, html = '', file, types, i, j;
    agentManagerSubject("Review agent files", files.length + ' ' + ((files.length === 1) ? "agent file" : "agent files") + (draft.channel ? (' / ' + draft.channel) : ''));
    agentManagerStateLine('', '');
    agentManagerNotice('');
    html += agentManagerControl('agentUploadName', "Build name", '<input id="agentUploadName" type="text" maxlength="128" oninput="agentManagerReviewChanged()" value="' + EscapeHtml(draft.name || files[0].filename) + '" />');
    if (draft.source) html += '<details data-agent-detail="source"><summary>' + "Source and verification" + '</summary>' + agentManagerImportProvenance(draft.source) + '</details>';
    if (draft.rejected && draft.rejected.length) {
        html += '<details data-agent-detail="rejected" open><summary class="agent-warn">' + format("Files that cannot be added: {0}", draft.rejected.length) + '</summary>';
        for (i = 0; i < draft.rejected.length; i++) html += '<div class="agent-manager-row"><div>' + EscapeHtml(draft.rejected[i].filename) + '</div><div class="agent-warn">' + "Not added" + '</div><div class="agent-manager-detail">' + EscapeHtml(draft.rejected[i].error) + '</div></div>';
        html += '</details>';
    }
    if (draft.skipped && draft.skipped.length) html += '<details data-agent-detail="skipped"><summary>' + format("Files skipped in the archive: {0}", draft.skipped.length) + '</summary><div class="agent-hash">' + draft.skipped.map(EscapeHtml).join('<br>') + '</div></details>';
    for (i = 0; i < files.length; i++) {
        file = files[i];
        html += '<fieldset class="agent-review-file" id="agentUploadFile' + i + '"><legend><label><input id="agentUploadInclude' + i + '" type="checkbox" checked onchange="agentManagerReviewChanged()" /> ' + EscapeHtml(file.filename) + '</label></legend>';
        html += '<div>' + EscapeHtml(file.platform + ' / ' + file.cpu) + ' / ' + (file.size / 1048576).toFixed(1) + ' MiB</div><div class="agent-muted">' + EscapeHtml(agentManagerRequirements(file)) + '</div>';
        types = '<select id="agentUploadType' + i + '" onchange="agentManagerReviewChanged()">';
        if (file.candidates.length > 1) types += '<option value="">' + "Select the compiled agent type" + '</option>';
        for (j = 0; j < file.candidates.length; j++) types += '<option value="' + file.candidates[j].id + '">' + EscapeHtml(file.candidates[j].name) + ' (' + file.candidates[j].id + ')</option>';
        html += agentManagerControl('agentUploadType' + i, "MeshAgent type", types + '</select>');
        html += agentManagerControl('agentUploadKvm' + i, "Desktop support", '<select id="agentUploadKvm' + i + '" onchange="agentManagerReviewChanged()"><option value="">' + "Select" + '</option><option value="yes">' + "Included" + '</option><option value="no">' + "Not included" + '</option></select>');
        if (file.platform === 'windows') {
            html += agentManagerControl('agentUploadSign' + i, "Code signing", '<label><input id="agentUploadSign' + i + '" type="checkbox" onchange="agentManagerReviewChanged()" /> ' + "Code-sign this file with the server certificate" + '</label>');
            html += agentManagerControl('agentUploadCustomize' + i, "Branding", '<label><input id="agentUploadCustomize' + i + '" type="checkbox" onchange="agentManagerReviewChanged()" /> ' + "Apply the server agent branding and re-sign" + '</label>');
        }
        for (j = 0; j < file.warnings.length; j++) html += '<p class="agent-warn">' + EscapeHtml(file.warnings[j]) + '</p>';
        html += '<p class="agent-warn" id="agentUploadTodo' + i + '"></p>';
        html += '<details data-agent-detail="hashes' + i + '"><summary>' + "Hashes" + '</summary><div class="agent-hash">SHA256 <code>' + EscapeHtml(file.hashes.sha256) + '</code></div><div class="agent-hash">' + "Update SHA384" + ' <code>' + EscapeHtml(file.hashes.agentSha384) + '</code></div></details></fieldset>';
    }
    html += '<p>' + "Headers identify the platform. Agent type and desktop support must match how these files were built. Publisher trust and runtime behavior have not been verified." + '</p><label class="agent-manager-confirm"><input id="agentUploadTrust" type="checkbox" onchange="agentManagerReviewChanged()" /> ' + "I trust these MeshAgent files and have checked the selected agent types." + '</label>';
    agentManagerHtml(html); agentManager.submit = agentManagerUploadCommit; agentManagerReviewChanged();
}
function agentManagerReviewChanged() {
    var files = agentManager.draft.artifacts, selected = 0, outstanding = 0, reason = '', focus = '', included, todo, i;
    for (i = 0; i < files.length; i++) {
        included = Q('agentUploadInclude' + i).checked; todo = '';
        QE('agentUploadType' + i, included); QE('agentUploadKvm' + i, included);
        var customizeBox = Q('agentUploadCustomize' + i);
        if (customizeBox) {
            QE('agentUploadCustomize' + i, included);
            // Customization always re-signs, so force and lock the sign box when it is on.
            if (included && customizeBox.checked) { Q('agentUploadSign' + i).checked = true; QE('agentUploadSign' + i, false); } else { QE('agentUploadSign' + i, included); }
        }
        if (included) {
            selected++;
            if (!Q('agentUploadType' + i).value) todo = "Select the compiled agent type.";
            else if (!Q('agentUploadKvm' + i).value) todo = "State whether this file includes remote desktop support.";
        }
        agentBuildHtml('agentUploadTodo' + i, EscapeHtml(todo));
        if (todo) {
            outstanding++;
            QC('agentUploadFile' + i).add('agent-review-todo');
            if (!focus) { focus = (Q('agentUploadType' + i).value ? 'agentUploadKvm' : 'agentUploadType') + i; reason = files[i].filename + ': ' + todo; }
        } else QC('agentUploadFile' + i).remove('agent-review-todo');
    }
    if (!selected) { reason = "Include at least one agent file."; focus = 'agentUploadInclude0'; }
    else if (!Q('agentUploadName').value.trim()) { reason = "Enter a build name."; focus = 'agentUploadName'; }
    else if (!outstanding && !Q('agentUploadTrust').checked) { reason = "Confirm that you trust these agent files."; focus = 'agentUploadTrust'; }
    agentManager.focus = reason ? focus : '';
    agentManagerButton("Add build", reason === '', reason);
}
function agentManagerUploadCommit() {
    var current = agentManager, files = [], i;
    for (i = 0; i < current.draft.artifacts.length; i++) files.push({ include: Q('agentUploadInclude' + i).checked, agentId: Number(Q('agentUploadType' + i).value), kvm: Q('agentUploadKvm' + i).value === 'yes', sign: Q('agentUploadSign' + i) ? Q('agentUploadSign' + i).checked : false, customize: Q('agentUploadCustomize' + i) ? Q('agentUploadCustomize' + i).checked : false });
    current.committing = true; agentManagerButton("Adding build...", false, '');
    agentManagerRun('upload', { op: 'commit', token: current.draft.token, name: Q('agentUploadName').value, trusted: Q('agentUploadTrust').checked, files: files }, function () {
        current.draft = null; agentManagerClose(); agentCatalogFocus = null; Q('p44group').value = 'builds'; refreshAgentCatalog();
    });
}

function agentManagerManageForm() {
    agentManagerRun('catalog', { op: 'list' }, function (data) {
        var build = data.builds.filter(function (x) { return x.id === agentManager.build; })[0], options, html;
        if (!build) { agentManagerError("This build is no longer in the catalog."); agentManager.submit = null; agentManagerButton("Close", true); return; }
        agentManager.buildInfo = build;
        var isDefault = (data.defaults || []).some(function (x) { return x.defaultBuild && x.defaultBuild.id === build.id; });
        var canDefault = !build.archived && build.artifacts.some(function (x) { return x.matches; });
        agentManagerSubject(build.name, build.channel + ' / ' + build.artifacts.length + ' ' + "agent files" + (build.archived ? (' / ' + "Archived") : ''));
        agentManagerStateLine(build.archived ? 'agent-warn' : '', build.archived ? "This build is archived." : (isDefault ? "This build supplies the server default agent." : ''));
        options = '<select id="agentManageAction" onchange="agentManagerManageChanged()"><option value="' + (build.archived ? 'restore' : 'archive') + '">' + (build.archived ? "Restore to the catalog" : "Archive this build") + '</option>';
        if (canDefault) options += '<option value="setdefault">' + "Use as the server default agent" + '</option>';
        if (isDefault) options += '<option value="cleardefault">' + "Clear the server default from this build" + '</option>';
        if (build.managed) options += '<option value="remove">' + "Remove this build from the server" + '</option>';
        html = agentManagerControl('agentManageAction', "Action", options + '</select>') + '<div id="agentManageNote"></div>';
        if (!build.managed) html += '<p class="agent-muted">' + "This build was not uploaded to this server, so it cannot be removed here." + '</p>';
        agentManagerHtml(html);
        agentManager.submit = function () {
            agentManagerRun('catalog', { op: Q('agentManageAction').value, build: build.id }, function () { agentManagerClose(); agentCatalogFocus = null; refreshAgentCatalog(); });
        };
        agentManagerManageChanged();
    });
}
function agentManagerManageChanged() {
    var action = Q('agentManageAction').value;
    var notes = {
        archive: "Archiving hides this build from new selections. Devices already pinned to it keep running it and the server keeps its stored copies.",
        restore: "Restoring puts this build back in the list of builds that can be pinned.",
        remove: "Removing deletes the uploaded files from this server. It is refused while a device or a deployment still references the build.",
        setdefault: "New Add Agent downloads will serve this build's files for their agent types on this server. This takes effect immediately.",
        cleardefault: "Reverts these agent types to the release or bundled default. Devices already installed are not changed."
    };
    agentBuildHtml('agentManageNote', '<p class="' + ((action === 'remove' || action === 'setdefault') ? 'agent-warn' : 'agent-muted') + '">' + notes[action] + '</p>');
    agentManagerButton((action === 'remove') ? "Remove build" : (action === 'restore') ? "Restore build" : (action === 'setdefault') ? "Set as default" : (action === 'cleardefault') ? "Clear default" : "Archive build", true);
}

function agentManagerUsageSearch() { agentManagerUsage(0); }
function agentManagerUsageForm() {
    var current = agentManager, html;
    // The subject is display only. filename is a real query field for a build, but on the defaults path
    // it would narrow the pinned relation and the pinned count, so that row passes it as label.
    agentManagerSubject(current.filename || current.label || "Build usage", (current.agentId != null ? agentManagerAgentType(current.agentId) : '') + (current.build ? (' / ' + (current.name || current.build)) : (' / ' + "Current server default")));
    agentManagerStateLine('', '');
    agentManagerNotice('');
    html = '<div class="agent-manager-toolbar"><label for="agentUsageRelation">' + "Show" + '</label><select id="agentUsageRelation" onchange="agentManagerUsage(0)"><option value="all">' + "All references" + '</option><option value="installed">' + "Reported installed" + '</option><option value="pinned">' + "Pinned" + '</option></select><input id="agentUsageSearch" type="search" placeholder="' + "Filter devices" + '" aria-label="' + "Filter devices" + '" onkeydown="return agentManagerKey(event, agentManagerUsageSearch)" /><button type="button" onclick="agentManagerUsageSearch()">' + "Search" + '</button></div>';
    html += '<p class="agent-muted">' + "Installed counts use the last agent file hash reported by each device, including offline devices. A device that has not reported a hash is not counted as installed." + '</p><div id="agentUsageRows"></div>';
    agentManagerHtml(html);
    current.submit = null; agentManagerButton("Close", true); agentManagerUsage(0);
}
function agentManagerUsage(offset) {
    var current = agentManager, seq = current.serial = (current.serial || 0) + 1;
    agentManagerRequest('usage', { hash: current.hash, agentId: current.agentId, build: current.build, filename: current.build ? current.filename : '', relation: Q('agentUsageRelation').value, search: Q('agentUsageSearch').value, offset: offset }).then(function (result) {
        if ((agentManager !== current) || (current.serial !== seq)) return;
        agentManagerClearError();
        var counts = result.counts, deploying = (counts.pending || 0) + (counts.updating || 0), html = '', row, i;
        agentBuildHtml('agentManagerCounts', agentManagerCount("Reported installed", counts.installed, counts.installed ? 'agent-match' : '', true) + agentManagerCount("Pinned", counts.pinned, '') + agentManagerCount("Being deployed", deploying, 'agent-warn') + agentManagerCount("Not confirmed", counts.unconfirmed, 'agent-error'));
        for (i = 0; i < result.rows.length; i++) {
            row = result.rows[i];
            html += '<div class="agent-manager-row"><div>' + agentManagerDeviceHtml(row.nodeid, row.name) + '</div><div class="' + agentManagerTargetLevel(row.state) + '">' + EscapeHtml(agentManagerUsageState(row)) + '</div><div class="agent-manager-detail agent-muted">' + (row.online ? "Online" : "Offline") + ' / ' + (row.reportedAt ? printDateTime(new Date(row.reportedAt)) : "No agent file hash reported") + '</div></div>';
        }
        if (!result.rows.length) html += '<p>' + (Q('agentUsageSearch').value ? "No device matches this filter." : "No device references this agent file.") + '</p>';
        html += agentManagerPager(offset, result.total, 50, 'agentManagerUsage');
        agentBuildHtml('agentUsageRows', html);
    }).catch(function (error) { if ((agentManager === current) && (current.serial === seq)) agentManagerError(error); });
}

function agentManagerBulkForm() {
    agentManagerRun('catalog', { op: 'list' }, function (data) {
        var current = agentManager, eligible = [], blocked = 0, unknown = 0, options = '', html, node, i;
        current.catalog = data.builds.filter(function (x) { return !x.archived; });
        // Group Action offers this to any full site admin, so the selection can hold devices the server
        // will refuse. An unresolved device stays in: only the preview can judge it.
        for (i = 0; i < current.nodeids.length; i++) {
            node = getNodeFromId(current.nodeids[i]);
            if (!node) { unknown++; eligible.push(current.nodeids[i]); }
            else if (canManageAgentBuild(node)) eligible.push(current.nodeids[i]);
            else blocked++;
        }
        current.eligible = eligible;
        agentManagerSubject("Deploy agent build", current.nodeids.length + ' ' + "devices selected");
        agentManagerStateLine('', '');
        agentBuildHtml('agentManagerCounts', agentManagerCount("Will be sent to the preview", eligible.length, '', true) + agentManagerCount("Left out", blocked, 'agent-warn') + agentManagerCount("Not loaded in this session", unknown, ''));
        html = '';
        if (blocked) html += '<p class="agent-muted">' + "Devices that are not agent managed, that have agent updates unavailable, or where you do not hold full rights are left out." + '</p>';
        if (unknown) html += '<p class="agent-muted">' + "Some selected devices are not loaded in this session. The preview checks them on the server." + '</p>';
        html += agentManagerControl('agentBatchMode', "Update policy", '<select id="agentBatchMode" onchange="agentManagerBatchFiles()"><option value="pin">' + agentManagerModeLabel('pin') + '</option><option value="default">' + agentManagerModeLabel('default') + '</option><option value="hold">' + agentManagerModeLabel('hold') + '</option></select>');
        html += '<p id="agentBatchDefault" class="agent-warn" style="display:none">' + "Returning to the server default can replace the installed agent file with an older one." + '</p>';
        for (i = 0; i < current.catalog.length; i++) options += '<option value="' + i + '">' + EscapeHtml(current.catalog[i].name) + '</option>';
        html += '<div id="agentBatchPin">' + agentManagerControl('agentBatchBuild', "Build", '<select id="agentBatchBuild" onchange="agentManagerBatchFiles()">' + options + '</select>');
        html += '<div id="agentBatchFiles"></div><label class="agent-manager-confirm"><input id="agentBatchUnknown" type="checkbox" /> ' + "Include devices whose requirements cannot be fully checked." + '</label></div>';
        html += agentManagerControl('agentBatchSize', "Batch size", '<input id="agentBatchSize" type="number" min="1" max="20" value="5" oninput="agentManagerBatchChanged()" />', "Each batch must finish verification before the next starts.");
        html += '<p class="agent-muted">' + "A failure pauses the deployment. Offline devices are skipped when an agent file has to be installed." + '</p>';
        html += '<div class="agent-manager-toolbar"><button type="button" class="agent-linkbutton" onclick="return agentManagerGoto(\'jobs\')">' + "View deployments" + '</button></div>';
        agentManagerHtml(html);
        current.submit = agentManagerBatchPreview;
        agentManagerBatchFiles();
        agentManagerBulkCapacity();
    });
}
// The server caps unfinished deployments per administrator and refuses the eleventh preview, so the ones
// already waiting are named before the form is filled in.
function agentManagerBulkCapacity() {
    var current = agentManager;
    agentManagerRequest('deployment', { op: 'list', offset: 0 }).then(function (result) {
        if ((agentManager !== current) || (current.mode !== 'bulk')) return;
        var open = [], html = '', job, i;
        for (i = 0; i < result.jobs.length; i++) {
            job = result.jobs[i];
            // Without the owner field the server cannot say whose job it is, so the cap warning is only
            // shown when it can be attributed.
            if ((job.owner === true) && (['complete', 'cancelled'].indexOf(job.stage) < 0)) open.push(job);
        }
        if (open.length < 8) return;
        for (i = 0; i < open.length; i++) html += '<div class="agent-manager-row"><div><button type="button" class="agent-linkbutton" data-job="' + EscapeHtml(open[i].id) + '" onclick="agentManagerJobOpen(this.getAttribute(\'data-job\'))">' + EscapeHtml(agentManagerJobName(open[i])) + '</button></div><div class="' + agentManagerJobLevel(open[i]) + '">' + EscapeHtml(agentManagerStage(open[i].stage)) + '</div><div class="agent-manager-detail agent-muted">' + printDateTime(new Date(open[i].created)) + '</div></div>';
        agentManagerNotice('<div class="agent-warn">' + format("Your unfinished deployments: {0}. The server allows ten, so a preview can be refused until one is finished or cancelled.", open.length) + '</div><details data-agent-detail="capacity"><summary>' + "Unfinished deployments" + '</summary>' + html + '</details>');
    }).catch(function () {});
}
function agentManagerBatchFiles() {
    var current = agentManager, mode = Q('agentBatchMode').value, pin = (mode === 'pin');
    var build = current.catalog[Q('agentBatchBuild').value], html = '', groups = {}, counts = {}, missing = [];
    var node, file, options, index, artifact, id, i;
    QV('agentBatchPin', pin); QV('agentBatchDefault', mode === 'default');
    for (i = 0; i < current.eligible.length; i++) { node = getNodeFromId(current.eligible[i]); if (node && node.agent) counts[node.agent.id] = (counts[node.agent.id] || 0) + 1; }
    if (build) for (i = 0; i < build.artifacts.length; i++) {
        file = build.artifacts[i];
        if (file.matches && counts[file.id]) { if (!groups[file.id]) groups[file.id] = []; groups[file.id].push(i); }
    }
    for (id in groups) {
        options = '<select id="agentBatchType' + id + '" data-agent-batch-type="' + id + '" onchange="agentManagerBatchChanged()"><option value="">' + "Skip this agent type" + '</option>';
        for (i = 0; i < groups[id].length; i++) {
            index = groups[id][i]; artifact = build.artifacts[index];
            options += '<option value="' + index + '"' + ((groups[id].length === 1) ? ' selected' : '') + '>' + EscapeHtml(artifact.filename + (artifact.requirements ? (' / ' + artifact.requirements) : '')) + '</option>';
        }
        html += agentManagerControl('agentBatchType' + id, EscapeHtml(agentManagerAgentType(id)), options + '</select>', format("Selected devices: {0}", counts[id]));
    }
    for (id in counts) if (!groups[id]) missing.push(agentManagerAgentType(id));
    if (missing.length) html += '<p class="agent-warn">' + "No verified file in this build matches these agent types, so those devices are left out" + ': ' + EscapeHtml(missing.join(', ')) + '</p>';
    agentBuildHtml('agentBatchFiles', html);
    agentManagerBatchChanged();
}
function agentManagerBatchSelection() {
    var build = agentManager.catalog[Q('agentBatchBuild').value], selectors = Q('agentBatchFiles').querySelectorAll('[data-agent-batch-type]'), files = [], file, i;
    for (i = 0; i < selectors.length; i++) if (selectors[i].value !== '') {
        file = build.artifacts[selectors[i].value];
        files.push({ agentId: file.id, filename: file.filename, sha256: file.sha256 });
    }
    return files;
}
function agentManagerBatchChanged() {
    var current = agentManager, pin = (Q('agentBatchMode').value === 'pin'), size = Number(Q('agentBatchSize').value), reason = '', focus = '';
    if (!current.eligible.length) reason = "None of the selected devices can be deployed to.";
    else if (pin && !current.catalog.length) reason = "No build is available to pin. Upload or import a build first.";
    else if (pin && !agentManagerBatchSelection().length) { reason = "Select at least one agent file to deploy."; focus = 'agentBatchFiles'; }
    else if (!((size >= 1) && (size <= 20))) { reason = "Use a batch size between 1 and 20."; focus = 'agentBatchSize'; }
    current.focus = focus;
    agentManagerButton("Preview deployment", reason === '', reason);
}
function agentManagerBatchPreview() {
    var current = agentManager, mode = Q('agentBatchMode').value, build = current.catalog[Q('agentBatchBuild').value];
    agentManagerButton("Checking devices...", false, '');
    agentManagerRun('deployment', { op: 'preview', mode: mode, nodeids: current.eligible, build: build && build.id, files: agentManagerBatchSelection(), batchSize: Number(Q('agentBatchSize').value), allowUnknown: Q('agentBatchUnknown').checked }, function (result) {
        agentManagerJobOpen(result.id);
    });
}

function agentManagerJobs(offset) {
    var current = agentManager;
    current.submit = null; agentManagerButton("Close", true);
    agentManagerRequest('deployment', { op: 'list', offset: offset }).then(function (result) {
        if (agentManager !== current) return;
        agentManagerClearError();
        var html = '', job, counts, detail, i;
        agentManagerSubject("Agent deployments", result.total + ' ' + ((result.total === 1) ? "deployment" : "deployments"));
        agentManagerStateLine('', '');
        agentManagerNotice('<div class="agent-muted">' + "Start a deployment with Group Action on selected devices, or with Actions on the mobile device page." + '</div>');
        agentBuildHtml('agentManagerCounts', '');
        for (i = 0; i < result.jobs.length; i++) {
            job = result.jobs[i]; counts = job.counts || {};
            detail = '<div class="agent-muted">' + format("{0} devices", job.total) + ' / ' + printDateTime(new Date(job.created)) + '</div>';
            if (counts.confirmed) detail += '<div class="agent-match">' + format("Verified: {0}", counts.confirmed) + '</div>';
            if (counts.failed) detail += '<div class="agent-error">' + format("Needs attention: {0}", counts.failed) + '</div>';
            if (counts.skipped) detail += '<div class="agent-warn">' + format("Skipped: {0}", counts.skipped) + '</div>';
            html += '<div class="agent-manager-row"><div><button type="button" class="agent-linkbutton" data-job="' + EscapeHtml(job.id) + '" onclick="agentManagerJobOpen(this.getAttribute(\'data-job\'))">' + EscapeHtml(agentManagerJobName(job)) + '</button></div><div class="' + agentManagerJobLevel(job) + '">' + EscapeHtml(agentManagerStage(job.stage)) + '</div><div class="agent-manager-detail">' + detail + '</div></div>';
        }
        if (!result.jobs.length) html += '<p>' + "No deployment has been created." + '</p>';
        html += agentManagerPager(offset, result.total, 20, 'agentManagerJobs');
        agentManagerHtml(html);
    }).catch(function (error) { if (agentManager === current) agentManagerError(error); });
}
// Opening a different job resets the filter and the landing logic, so a state chosen on one deployment
// never silently applies to the next.
function agentManagerJobOpen(id) {
    var current = agentManager;
    current.mode = 'job'; current.id = id; current.state = ''; current.landed = false; current.job = null; current.filterable = false;
    if (Q('agentJobRows')) agentBuildHtml('agentManagerContent', '');
    agentManagerJob(id, 0);
}
function agentManagerJobPage(offset) { agentManagerJob(agentManager.id, offset); }
function agentManagerJobFilter() { agentManager.state = Q('agentJobState').value; agentManagerJob(agentManager.id, 0); }
// The skeleton is created once: a poll must never re-create the recovery checkbox or the filter select,
// or a tick would clear the confirmation and reset the view underneath whoever is reading it.
function agentManagerJobFrame() {
    if (Q('agentJobRows')) return;
    agentManagerHtml('<div id="agentJobReport"></div><div class="agent-manager-toolbar"><span id="agentJobFilterRow" style="display:none"><label for="agentJobState">' + "Show" + '</label><select id="agentJobState" onchange="agentManagerJobFilter()"><option value="">' + "All devices" + '</option><option value="attention">' + "Needs attention" + '</option><option value="active">' + "In progress" + '</option><option value="done">' + "Verified" + '</option><option value="ready">' + "Not started" + '</option></select></span><button id="agentJobPause" type="button" style="display:none" onclick="agentManagerJobAction(\'pause\')">' + "Pause" + '</button><button id="agentJobCancel" type="button" style="display:none" onclick="agentManagerJobAction(\'cancel\')"></button><button id="agentJobRemove" type="button" style="display:none" onclick="agentManagerJobRemove()"></button><button type="button" onclick="agentManagerJob(agentManager.id, agentManager.offset)">' + "Refresh" + '</button></div><label id="agentJobConfirm" class="agent-manager-confirm" style="display:none"><input id="agentJobRecovery" type="checkbox" onchange="agentManager.confirmed = this.checked; agentManagerJobButton();" /> ' + "I can recover these devices locally and accept interruption of active sessions." + '</label><p id="agentJobNotice"></p><div id="agentJobRows"></div>');
    Q('agentJobRecovery').checked = !!agentManager.confirmed;
}
function agentManagerJob(id, offset) {
    var current = agentManager;
    if (current.busy) return;
    current.id = id; current.offset = offset;
    agentManagerJobFrame();
    if (current.timer) { clearTimeout(current.timer); current.timer = null; }
    var seq = current.serial = (current.serial || 0) + 1;
    agentManagerRequest('deployment', { op: 'get', id: id, offset: offset, state: current.state || '' }).then(function (job) {
        if ((agentManager !== current) || (current.serial !== seq)) return;
        current.job = job; agentManagerClearError();
        // Only offer the filter once the server has echoed a state back, otherwise an older server lists
        // every device under a control that claims a filter is in effect.
        if (job.state !== undefined) { current.filterable = true; current.state = job.state; if (Q('agentJobState').value !== job.state) Q('agentJobState').value = job.state; }
        QV('agentJobFilterRow', current.filterable);
        // A paused or finished deployment with failures opens on those devices: that is the only reason
        // anyone comes back to this dialog.
        if (!current.landed) {
            current.landed = true;
            if (current.filterable && (((job.counts.failed || 0) + (job.counts.skipped || 0)) > 0) && (['paused', 'complete', 'cancelled'].indexOf(job.stage) >= 0)) {
                current.state = 'attention'; Q('agentJobState').value = 'attention'; agentManagerJob(id, 0); return;
            }
        }
        var counts = job.counts, done = (counts.confirmed || 0) + (counts.failed || 0) + (counts.skipped || 0) + (counts.cancelled || 0);
        var total = (job.filtered == null) ? job.total : job.filtered, report, html = '', target, state, i;
        agentManagerSubject(agentManagerJobName(job), format("{0} devices, batches of {1}", job.total, job.batchSize) + ' / ' + printDateTime(new Date(job.created)));
        agentManagerStateLine(agentManagerJobLevel(job), agentManagerStage(job.stage));
        agentBuildHtml('agentManagerCounts', agentManagerCount("Verified", counts.confirmed, 'agent-match') + agentManagerCount("In progress", (counts.starting || 0) + (counts.waiting || 0), '') + agentManagerCount("Not started", counts.ready, '') + agentManagerCount("Needs attention", counts.failed, 'agent-error') + agentManagerCount("Skipped", counts.skipped, 'agent-warn') + agentManagerCount("Cancelled", counts.cancelled, ''));
        var notice = '';
        // A cancelled or finished job keeps the text of whatever stopped it, so it reads as history.
        if (job.error) notice += '<div class="' + ((['cancelled', 'complete'].indexOf(job.stage) >= 0) ? 'agent-muted' : 'agent-error') + '">' + EscapeHtml(job.error) + '</div>';
        if (job.owner === false) notice += '<div class="agent-warn">' + "Another administrator created this deployment. You can pause or cancel it, but only its owner can start or resume it." + '</div>';
        agentManagerNotice(notice);
        report = '<label class="agent-manager-progress">' + format("{0} of {1} devices finished, in batches of {2}", done, job.total, job.batchSize) + '<progress max="' + job.total + '" value="' + done + '"></progress></label>';
        agentBuildHtml('agentJobReport', report);
        QV('agentJobPause', ['running', 'preparing'].indexOf(job.stage) >= 0);
        // Nothing has run yet, so there is nothing "remaining" to cancel: the record is only holding one
        // of the ten deployment slots, and discarding it is what frees it.
        var fresh = (['preparing', 'ready'].indexOf(job.stage) >= 0) && (done + (counts.starting || 0) + (counts.waiting || 0) === 0);
        var removable = (job.owner !== false) && (['ready', 'complete', 'cancelled'].indexOf(job.stage) >= 0);
        QV('agentJobCancel', (['complete', 'cancelled', 'cancelling'].indexOf(job.stage) < 0) && (job.stage !== 'ready'));
        agentBuildHtml('agentJobCancel', fresh ? "Discard this deployment" : "Cancel remaining");
        QV('agentJobRemove', removable);
        agentBuildHtml('agentJobRemove', (job.stage === 'ready') ? "Discard this deployment" : "Remove from the list");
        for (i = 0; i < job.targets.length; i++) {
            target = job.targets[i];
            state = (target.progress && (target.state === 'waiting')) ? target.progress : target.state;
            html += '<div class="agent-manager-row"><div>' + agentManagerDeviceHtml(target.nodeid, target.name) + '</div><div class="' + agentManagerTargetLevel(target.state) + '">' + EscapeHtml(agentManagerStage(state)) + '</div>';
            if (target.error) html += '<div class="agent-manager-detail agent-error">' + EscapeHtml(target.error) + '</div>';
            else if (target.confirmedAt) html += '<div class="agent-manager-detail agent-muted">' + "Verified" + ' ' + printDateTime(new Date(target.confirmedAt)) + '</div>';
            html += '</div>';
        }
        if (!job.targets.length) html += '<p>' + (current.state ? "No device is in this state." : "No device has been checked yet.") + '</p>';
        html += agentManagerPager(offset, total, 50, 'agentManagerJobPage');
        agentBuildHtml('agentJobRows', html);
        agentManagerJobButton();
        if (['complete', 'cancelled'].indexOf(job.stage) < 0) current.timer = setTimeout(function () { if (agentManager === current) agentManagerJob(id, current.offset); }, 3000);
    }).catch(function (error) {
        if ((agentManager !== current) || (current.serial !== seq)) return;
        agentManagerError(error);
        current.timer = setTimeout(function () { if (agentManager === current) agentManagerJob(id, current.offset); }, 5000);
    });
}
function agentManagerJobNoticeText(job) {
    if (!job) return '';
    if (['preparing', 'ready'].indexOf(job.stage) >= 0) return "Nothing has changed on any device yet. This deployment stays in the list until you start or discard it.";
    if (['running', 'cancelling', 'paused'].indexOf(job.stage) >= 0) return "Closing this dialog does not stop this deployment. Pause or cancel stops new work. Policies already applied stay in place.";
    return '';
}
function agentManagerJobButton() {
    var current = agentManager, job = current.job, stage = job && job.stage, start = false, reason = '';
    if (job && (['ready', 'paused'].indexOf(stage) >= 0) && (((job.counts.ready || 0) > 0) || (stage === 'paused'))) {
        // The server refuses start and resume to anyone else, so it is never offered to them.
        start = job.owner !== false;
        if (!start) reason = "Only the administrator who created this deployment can start or resume it.";
    }
    QV('agentJobConfirm', start);
    agentBuildHtml('agentJobNotice', EscapeHtml(agentManagerJobNoticeText(job)));
    current.submit = start ? function () { agentManagerJobAction((stage === 'ready') ? 'start' : 'resume'); } : null;
    current.focus = start ? 'agentJobRecovery' : '';
    if (start && !current.confirmed) reason = "Confirm local recovery before starting this deployment.";
    agentManagerButton(start ? ((stage === 'ready') ? "Start deployment" : "Resume remaining") : "Close", !start || !!current.confirmed, reason);
}
function agentManagerJobAction(op) {
    var current = agentManager;
    if (current.busy) return;
    current.serial = (current.serial || 0) + 1;
    if (current.timer) { clearTimeout(current.timer); current.timer = null; }
    agentManagerRun('deployment', { op: op, id: current.id, confirm: !!current.confirmed }, function () {
        current.confirmed = false; Q('agentJobRecovery').checked = false; agentManagerJob(current.id, current.offset);
    });
}

// Removing drops the record only. It never reverts a policy already applied, which is why the server
// refuses anything still schedulable.
function agentManagerJobRemove() {
    var current = agentManager;
    if (current.busy) return;
    current.serial = (current.serial || 0) + 1;
    if (current.timer) { clearTimeout(current.timer); current.timer = null; }
    agentManagerRun('deployment', { op: 'remove', id: current.id }, function () {
        current.mode = 'jobs'; current.id = null; current.job = null; current.state = ''; current.confirmed = false;
        agentManagerHtml('');
        agentManagerJobs(0);
    });
}

function agentManagerImportForm() {
    var current = agentManager;
    current.submit = null; agentManagerButton("Loading...", false, '');
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
    agentManagerSubject("Import agent build", "Download agent files from GitHub or a public HTTPS address and review them before they enter the catalog.");
    agentManagerStateLine('', '');
    agentManagerNotice('');
    agentBuildHtml('agentManagerCounts', '');
    agentManagerHtml(agentManagerControl('agentImportSource', "Source", '<select id="agentImportSource" onchange="agentManagerImportSource()"><option value="github">GitHub</option><option value="url">' + "Download URL" + '</option></select>') + '<div id="agentImportForm"></div>');
    agentManagerImportSource();
}
function agentManagerImportSource() {
    var current = agentManager, html;
    current.serial = (current.serial || 0) + 1; current.selection = null; current.items = null; current.trail = ''; current.busy = false;
    agentManagerClearError();
    if (Q('agentImportSource').value === 'url') {
        html = agentManagerControl('agentImportUrl', "HTTPS URL", '<input id="agentImportUrl" type="url" maxlength="4096" autocomplete="off" oninput="agentManagerImportChanged()" onkeydown="return agentManagerKey(event, agentManagerSubmit)" />');
        html += agentManagerControl('agentImportFilename', "Filename (optional)", '<input id="agentImportFilename" maxlength="128" onkeydown="return agentManagerKey(event, agentManagerSubmit)" />');
        html += agentManagerControl('agentImportHash', "Expected SHA256 (optional)", '<input id="agentImportHash" maxlength="64" onkeydown="return agentManagerKey(event, agentManagerSubmit)" />');
        html += '<p class="agent-muted">' + "Download an agent file or a ZIP from a public HTTPS address. Up to 128 MiB downloaded and unpacked, 16 agent files, 64 MiB per file." + '</p>';
        QH('agentImportForm', html);
        current.submit = agentManagerImportStart; agentManagerImportChanged();
        return;
    }
    html = agentManagerControl('agentGithubRepo', "Repository", '<input id="agentGithubRepo" value="Ylianst/MeshAgent" maxlength="201" oninput="agentManagerGithubKind()" onkeydown="return agentManagerKey(event, agentManagerGithubSearch)" />');
    html += agentManagerControl('agentGithubKind', "Builds", '<select id="agentGithubKind" onchange="agentManagerGithubKind()"><option value="runs">' + "Workflow runs" + '</option><option value="pull-request">' + "Pull request" + '</option><option value="releases">' + "Releases" + '</option><option value="run">' + "Run ID" + '</option></select>');
    html += '<div id="agentGithubFilterRow">' + agentManagerControl('agentGithubFilter', '<span id="agentGithubFilterLabel">' + "Branch or commit" + '</span>', '<input id="agentGithubFilter" maxlength="200" oninput="agentManagerGithubKind()" onkeydown="return agentManagerKey(event, agentManagerGithubSearch)" />') + '</div>';
    html += '<p class="agent-muted">' + (current.githubSettings.tokenConfigured ? "GitHub token configured on the server." : "No GitHub token is configured. Public builds can be browsed, Actions downloads need a server token.") + '</p>';
    html += '<details data-agent-detail="github"><summary>' + "GitHub settings" + '</summary><p>' + "Set agentBuilds.github.token in this domain in config.json, then restart MeshCentral. Actions downloads need Actions read, private releases need Contents read, private pull request lookup needs Pull requests read." + '</p><p>' + "Only successful runs with available artifacts matching these names are listed:" + ' ' + EscapeHtml(current.githubSettings.artifactNames.join(', ')) + '</p></details>';
    html += '<div class="agent-manager-toolbar"><button type="button" onclick="agentManagerGithubSearch()">' + "Find builds" + '</button></div><div id="agentGithubResults"></div>';
    QH('agentImportForm', html);
    current.submit = agentManagerGithubSearch; agentManagerButton("Find builds", true);
}
function agentManagerImportChanged() {
    agentManager.focus = 'agentImportUrl';
    agentManagerButton("Download and review", /^https:\/\/\S+$/.test(Q('agentImportUrl').value.trim()), "Enter the HTTPS address of the agent file or ZIP to download.");
}
function agentManagerGithubSearch() { agentManager.trail = ''; agentManagerGithubBrowse(1); }
function agentManagerGithubKind() {
    var current = agentManager, kind = Q('agentGithubKind').value;
    current.serial = (current.serial || 0) + 1; current.busy = false; current.selection = null; current.trail = '';
    QV('agentGithubFilterRow', kind !== 'releases');
    QH('agentGithubFilterLabel', (kind === 'pull-request') ? "PR number" : ((kind === 'run') ? "Run ID" : "Branch or commit"));
    agentBuildHtml('agentGithubResults', '');
    current.submit = agentManagerGithubSearch; agentManagerButton("Find builds", true);
}
function agentManagerGithubBrowse(page, selection) {
    var current = agentManager, seq = current.serial = (current.serial || 0) + 1;
    var request = { op: 'browse', repository: Q('agentGithubRepo').value.trim(), kind: Q('agentGithubKind').value, filter: Q('agentGithubFilter').value.trim(), page: page };
    if (selection) Object.assign(request, selection);
    current.selection = null; current.busy = true; agentManagerClearError();
    agentManagerButton("Loading...", false, '');
    agentBuildHtml('agentGithubResults', '<p role="status">' + "Loading GitHub builds..." + '</p>');
    agentManagerRequest('import', request).then(function (result) {
        if ((agentManager !== current) || (current.serial !== seq)) return;
        current.busy = false; current.items = result.items;
        current.browse = { repository: request.repository, kind: request.kind, filter: request.filter, run: request.run, release: request.release };
        var assets = (request.kind === 'assets') || (request.kind === 'artifacts'), html = '', item, i;
        // Both drill-downs get the same breadcrumb, so a release listing says which release it is.
        agentManagerSubject("Import agent build", request.repository + ' / ' + agentManagerGithubKindLabel(request.kind) + (current.trail ? (' / ' + current.trail) : (request.filter ? (' / ' + request.filter) : '')), assets ? ('<button type="button" class="agent-linkbutton" onclick="agentManagerGithubSearch()">' + "Back to builds" + '</button>') : '');
        if (result.note) html += '<p>' + EscapeHtml(result.note) + '</p>';
        if (result.source) html += agentManagerImportProvenance(result.source);
        if (!result.items.length) html += '<p class="agent-warn">' + (assets ? "No agent file is available for this build." : ((request.kind === 'releases') ? "This repository has no release on this page. Try Workflow runs." : "No successful run with matching, unexpired agent artifacts on this page.")) + (result.more ? (' ' + "Try the next page.") : '') + '</p>';
        if ((request.kind === 'artifacts') && !current.githubSettings.tokenConfigured) html += '<p class="agent-warn">' + "Configure a GitHub token on the server to download these files." + '</p>';
        for (i = 0; i < result.items.length; i++) {
            item = result.items[i];
            html += '<div class="agent-import-row">';
            if (assets) html += '<label><input type="checkbox" class="agent-import-choice" data-index="' + i + '" onchange="agentManagerGithubSelected()"' + (item.available ? '' : ' disabled') + ' /> ' + EscapeHtml(item.name) + '</label><span class="agent-muted"> ' + (item.size / 1048576).toFixed(1) + ' MiB</span>';
            else html += '<button type="button" data-index="' + i + '" onclick="agentManagerGithubBuild(Number(this.getAttribute(\'data-index\')))"' + (item.available ? '' : ' disabled') + '>' + EscapeHtml(item.name) + '</button>';
            if (item.detail) html += '<div class="agent-muted">' + EscapeHtml(item.detail) + '</div>';
            html += '</div>';
        }
        html += '<div class="agent-manager-toolbar" role="group" aria-label="' + "Pages" + '"><button type="button" onclick="agentManagerGithubPage(' + Math.max(1, page - 1) + ')"' + ((page <= 1) ? ' disabled' : '') + '>' + "Previous" + '</button><span>' + format("Page {0}", page) + '</span><button type="button" onclick="agentManagerGithubPage(' + (page + 1) + ')"' + (result.more ? '' : ' disabled') + '>' + "Next" + '</button></div>';
        agentBuildHtml('agentGithubResults', html);
        // Drilling into a run or a release is the expected next step, so the primary stays the search
        // instead of turning into a Close that also hides Cancel.
        if (assets) { current.submit = agentManagerImportStart; agentManagerGithubSelected(); }
        else { current.submit = agentManagerGithubSearch; current.focus = 'agentGithubRepo'; agentManagerButton("Find builds", true); }
    }).catch(function (error) {
        if ((agentManager !== current) || (current.serial !== seq)) return;
        agentManagerError(error); current.submit = function () { agentManagerGithubBrowse(page, selection); }; agentManagerButton("Retry", true);
    });
}
function agentManagerGithubKindLabel(kind) {
    return ({ runs: "Workflow runs", 'pull-request': "Pull request", releases: "Releases", run: "Run ID", artifacts: "Workflow run files", assets: "Release files" })[kind] || kind;
}
function agentManagerGithubPage(page) { agentManagerGithubBrowse(page, agentManager.browse); }
function agentManagerGithubBuild(index) {
    var current = agentManager, item = current.items[index];
    current.trail = item.name;
    agentManagerGithubBrowse(1, Object.assign({}, current.browse, (current.browse.kind === 'releases') ? { kind: 'assets', release: item.id } : { kind: 'artifacts', run: item.id }));
}
function agentManagerGithubSelected() {
    var current = agentManager, ids = [], reason = '';
    Q('agentGithubResults').querySelectorAll('.agent-import-choice:checked').forEach(function (input) { ids.push(current.items[Number(input.getAttribute('data-index'))].id); });
    current.selection = ids;
    if (!ids.length) reason = "Select the agent files to download.";
    else if (ids.length > 16) reason = "Select at most 16 agent files.";
    else if ((current.browse.kind === 'artifacts') && !current.githubSettings.tokenConfigured) reason = "Configure a GitHub token on the server to download workflow artifacts.";
    current.focus = '';
    agentManagerButton("Download and review", !current.busy && (reason === ''), reason);
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
    current.busy = true; current.submit = null;
    agentManagerHtml('<p id="agentImportState" role="status" aria-live="polite">' + "Resolving download..." + '</p><progress id="agentImportProgress" max="100"></progress><p id="agentImportNotice" class="agent-muted">' + "Files are inspected before you can add this build. Closing this dialog cancels the import." + '</p>');
    agentManagerButton("Downloading...", false, '');
    agentManagerRequest('import', request).then(function (result) {
        if (agentManager !== current) { agentManagerRequest('import', { op: 'cancel', id: result.id }).catch(function () {}); return; }
        current.importId = result.id; agentManagerImportPoll();
    }).catch(function (error) {
        if (agentManager !== current) return;
        if (error.code === 'timeout') { agentManagerError(error); agentManagerImportPoll(); }
        else { current.importId = null; agentManagerImportFailed(error); }
    });
}
function agentManagerImportFailed(error) {
    agentBuildHtml('agentImportState', "Import stopped."); QV('agentImportProgress', false);
    agentBuildHtml('agentImportNotice', "Nothing was added to the catalog. Try again or close this dialog.");
    agentManagerError(error); agentManager.submit = agentManagerImportForm; agentManagerButton("Try again", true);
}
function agentManagerImportPoll() {
    var current = agentManager;
    agentManagerRequest('import', { op: 'get', id: current.importId }).then(function (result) {
        if (agentManager !== current) return;
        if (result.stage === 'review') { current.importId = null; current.busy = false; current.draft = result.draft; agentManagerUploadReview(); return; }
        if (['failed', 'cancelled', 'unavailable'].indexOf(result.stage) >= 0) { current.importId = null; agentManagerImportFailed(result.error); return; }
        // format() escapes its arguments, so this is already html and must not be escaped again.
        var state = (result.stage === 'resolving') ? "Resolving download..." : ((result.stage === 'inspecting') ? "Inspecting files..." : format("Downloading {0} ({1} of {2})", result.file, result.index, result.count));
        if (result.received) state += ' / ' + (result.received / 1048576).toFixed(1) + ' MiB';
        agentBuildHtml('agentImportState', state);
        if (result.total) Q('agentImportProgress').value = Math.min(100, result.received * 100 / result.total); else Q('agentImportProgress').removeAttribute('value');
        current.timer = setTimeout(agentManagerImportPoll, 1000);
    }).catch(function (error) {
        if (agentManager !== current) return;
        agentManagerError(error);
        current.timer = setTimeout(agentManagerImportPoll, 5000);
    });
}
function agentManagerImportProvenance(source) {
    var html = '<div class="agent-import-source">', file, i;
    if (source.repository) html += '<b>' + EscapeHtml(source.repository) + '</b>';
    if (source.url) html += '<div class="agent-hash">' + EscapeHtml(source.url) + '</div>';
    if (source.commit) html += '<div class="agent-hash">' + "Source commit" + ': <code>' + EscapeHtml(source.commit) + '</code></div>';
    if (source.runId) html += '<div>' + EscapeHtml([source.event, source.branch, source.headRepository, 'Run ' + source.runId, 'Attempt ' + source.runAttempt].filter(Boolean).join(' / ')) + '</div>';
    if (source.tag) html += '<div>' + "Tag" + ': ' + EscapeHtml(source.tag) + '</div>';
    if (source.downloads) for (i = 0; i < source.downloads.length; i++) {
        file = source.downloads[i];
        html += '<details data-agent-detail="download' + i + '"><summary>' + EscapeHtml(file.name) + ' / ' + (file.digestVerified ? "Download SHA256 verified" : "No expected digest supplied") + '</summary><div class="agent-hash">' + EscapeHtml(file.url) + '<br>SHA256 <code>' + EscapeHtml(file.sha256) + '</code></div></details>';
    }
    return html + '<p class="agent-muted">' + "Source details describe where the files were obtained. They do not prove which source code the agent file contains or that it is safe to run." + '</p></div>';
}
