
var promise = require('promise');

function apps() {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });

    function runSh(script) {
        try {
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (d) { child.stdout.str += d; });
            child.stdin.write(script + '\nexit\n');
            child.waitExit();
            return child.stdout.str.trim();
        } catch (ex) { return ''; }
    }

    // Single shell process: PlistBuddy handles both XML and binary plists.
    // Outputs tab-separated: name, version, publisher, date, scope — one app per line.
    var script = [
        'PB=/usr/libexec/PlistBuddy',
        'process_app() {',
        '  app="$1" scope="$2"',
        '  plist="$app/Contents/Info.plist"',
        '  [ -f "$plist" ] || return',
        '  name=$(basename "$app" .app)',
        '  version=$("$PB" -c "Print :CFBundleShortVersionString" "$plist" 2>/dev/null)',
        '  publisher=$("$PB" -c "Print :NSHumanReadableCopyright" "$plist" 2>/dev/null)',
        '  if [ -z "$publisher" ]; then',
        '    bid=$("$PB" -c "Print :CFBundleIdentifier" "$plist" 2>/dev/null)',
        '    publisher=$(echo "$bid" | awk -F. \'{if(NF>=2){s=$2; print toupper(substr(s,1,1)) substr(s,2)}}\')',
        '  fi',
        '  date=$(stat -f "%Sm" -t "%Y-%m-%d" "$app" 2>/dev/null)',
        '  arch=""',
        '  exe=$("$PB" -c "Print :CFBundleExecutable" "$plist" 2>/dev/null)',
        '  if [ -n "$exe" ]; then',
        '    lipoout=$(lipo -info "$app/Contents/MacOS/$exe" 2>/dev/null)',
        '    if echo "$lipoout" | grep -q "x86_64" && echo "$lipoout" | grep -q "arm64"; then',
        '      arch="universal"',
        '    elif echo "$lipoout" | grep -q "arm64"; then',
        '      arch="arm64"',
        '    elif echo "$lipoout" | grep -q "x86_64"; then',
        '      arch="x86_64"',
        '    fi',
        '  fi',
        '  printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\',
        '    "$(printf "%s" "$name"      | tr "\\t\\n" "  ")" \\',
        '    "$(printf "%s" "$version"   | tr "\\t\\n" "  ")" \\',
        '    "$(printf "%s" "$publisher" | tr "\\t\\n" "  ")" \\',
        '    "$date" "$arch" "$scope"',
        '}',
        'for sysdir in /Applications /System/Applications /System/Applications/Utilities; do',
        '  [ -d "$sysdir" ] || continue',
        '  find "$sysdir" -maxdepth 1 -name "*.app" -type d 2>/dev/null | while IFS= read -r app; do',
        '    process_app "$app" system',
        '  done',
        'done',
        'for userdir in /Users/*/; do',
        '  user=$(basename "$userdir")',
        '  [ "$user" = Shared ] && continue',
        '  case "$user" in .*) continue;; esac',
        '  appsdir="${userdir}Applications"',
        '  [ -d "$appsdir" ] || continue',
        '  find "$appsdir" -maxdepth 1 -name "*.app" -type d 2>/dev/null | while IFS= read -r app; do',
        '    process_app "$app" user',
        '  done',
        'done'
    ].join('\n');

    try {
        var out = runSh(script);
        var results = [];
        if (out) {
            out.split('\n').forEach(function (line) {
                var p = line.split('\t');
                if (p.length < 6 || !p[0]) return;
                results.push({ name: p[0], version: p[1] || '', publisher: p[2] || '', date: p[3] || '', arch: p[4] || '', location: p[5] || 'system' });
            });
        }
        ret._res(results);
    } catch (e) {
        ret._rej(e);
    }
    return (ret);
}

if (process.platform == 'darwin') {
    module.exports = { apps: apps };
} else {
    var not_supported = function () { throw (process.platform + ' not supported'); };
    module.exports = { apps: not_supported };
}
