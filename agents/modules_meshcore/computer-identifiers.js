/*
Copyright 2019-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

function trimIdentifiers(val)
{
    for(var v in val)
    {
        if (!val[v] || val[v] == 'None' || val[v] == '') { delete val[v]; }
    }
}
function trimResults(val)
{
    var i, x;
    for (i = 0; i < val.length; ++i)
    {
        for (x in val[i])
        {
            if (x.startsWith('_'))
            {
                delete val[i][x];
            }
            else
            {
                if (val[i][x] == null || val[i][x] == 0)
                {
                    delete val[i][x];
                }
            }
        }
    }
}
function brief(headers, obj)
{
    var i, x;
    for (x = 0; x < obj.length; ++x)
    {
        for (i in obj[x])
        {
            if (!headers.includes(i))
            {
                delete obj[x][i];
            }
        }
    }
    return (obj);
}

function dataHandler(c)
{
    this.str += c.toString();
}

function linux_identifiers()
{
    var identifiers = {};
    var ret = {};
    var values = {};

    if (!require('fs').existsSync('/sys/class/dmi/id')) {         
        if(require('fs').existsSync('/sys/firmware/devicetree/base/model')){
            if(require('fs').readFileSync('/sys/firmware/devicetree/base/model').toString().trim().startsWith('Raspberry')){
                identifiers['board_vendor'] = 'Raspberry Pi';
                identifiers['board_name'] = require('fs').readFileSync('/sys/firmware/devicetree/base/model').toString().trim();
                identifiers['board_serial'] = require('fs').readFileSync('/sys/firmware/devicetree/base/serial-number').toString().trim();
            }else{
                throw('Unknown board');
            }
        }else {
            throw ('this platform does not have DMI statistics');
        }
    } else {
        var entries = require('fs').readdirSync('/sys/class/dmi/id');
        for(var i in entries)
        {
            if (require('fs').statSync('/sys/class/dmi/id/' + entries[i]).isFile())
            {
                try
                {
                    ret[entries[i]] = require('fs').readFileSync('/sys/class/dmi/id/' + entries[i]).toString().trim();
                }
                catch(z)
                {
                }
                if (ret[entries[i]] == 'None') { delete ret[entries[i]];}
            }
        }
        entries = null;

        identifiers['bios_date'] = ret['bios_date'];
        identifiers['bios_vendor'] = ret['bios_vendor'];
        identifiers['bios_version'] = ret['bios_version'];
        identifiers['bios_serial'] = ret['product_serial'];
        identifiers['board_name'] = ret['board_name'];
        identifiers['board_serial'] = ret['board_serial'];
        identifiers['board_vendor'] = ret['board_vendor'];
        identifiers['board_version'] = ret['board_version'];
        identifiers['product_uuid'] = ret['product_uuid'];
        identifiers['product_name'] = ret['product_name'];
    }

    try {
        identifiers['bios_mode'] = (require('fs').statSync('/sys/firmware/efi').isDirectory() ? 'UEFI': 'Legacy');
    } catch (ex) { identifiers['bios_mode'] = 'Legacy'; }

    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', dataHandler);
    child.stdin.write('cat /proc/cpuinfo | grep -i "model name" | ' + "tr '\\n' ':' | awk -F: '{ print $2 }'\nexit\n");
    child.waitExit();
    identifiers['cpu_name'] = child.stdout.str.trim();
    if (identifiers['cpu_name'] == "") { // CPU BLANK, check lscpu instead
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stdin.write('lscpu | grep -i "model name" | ' + "tr '\\n' ':' | awk -F: '{ print $2 }'\nexit\n");
        child.waitExit();
        identifiers['cpu_name'] = child.stdout.str.trim();
    }
    child = null;


    // Fetch GPU info
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', dataHandler);
    child.stdin.write("lspci | grep ' VGA ' | tr '\\n' '`' | awk '{ a=split($0,lines" + ',"`"); printf "["; for(i=1;i<a;++i) { split(lines[i],gpu,"r: "); printf "%s\\"%s\\"", (i==1?"":","),gpu[2]; } printf "]"; }\'\nexit\n');
    child.waitExit();
    try { identifiers['gpu_name'] = JSON.parse(child.stdout.str.trim()); } catch (xx) { }
    child = null;

    // Fetch Storage Info
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', dataHandler);
    child.stdin.write("lshw -class disk | tr '\\n' '`' | awk '" + '{ len=split($0,lines,"*"); printf "["; for(i=2;i<=len;++i) { model=""; caption=""; size=""; clen=split(lines[i],item,"`"); for(j=2;j<clen;++j) { split(item[j],tokens,":"); split(tokens[1],key," "); if(key[1]=="description") { caption=substr(tokens[2],2); } if(key[1]=="product") { model=substr(tokens[2],2); } if(key[1]=="size") { size=substr(tokens[2],2);  } } if(model=="") { model=caption; } if(caption!="" || model!="") { printf "%s{\\"Caption\\":\\"%s\\",\\"Model\\":\\"%s\\",\\"Size\\":\\"%s\\"}",(i==2?"":","),caption,model,size; }  } printf "]"; }\'\nexit\n');
    child.waitExit();
    try { identifiers['storage_devices'] = JSON.parse(child.stdout.str.trim()); } catch (xx) { }

    values.identifiers = identifiers;
    values.linux = ret;
    trimIdentifiers(values.identifiers);
    child = null;

    var dmidecode = require('lib-finder').findBinary('dmidecode');
    if (dmidecode != null)
    {
        child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stderr.str = ''; child.stderr.on('data', dataHandler);
        child.stdin.write(dmidecode + " -t memory | tr '\\n' '`' | ");
        child.stdin.write(" awk '{ ");
        child.stdin.write('   printf("[");');
        child.stdin.write('   comma="";');
        child.stdin.write('   c=split($0, lines, "``");');
        child.stdin.write('   for(i=1;i<=c;++i)');
        child.stdin.write('   {');
        child.stdin.write('      d=split(lines[i], val, "`");');
        child.stdin.write('      split(val[1], tokens, ",");');
        child.stdin.write('      split(tokens[2], dmitype, " ");');
        child.stdin.write('      dmi = dmitype[3]+0; ');
        child.stdin.write('      if(dmi == 5 || dmi == 6 || dmi == 16 || dmi == 17)');
        child.stdin.write('      {');
        child.stdin.write('          ccx="";');
        child.stdin.write('          printf("%s{\\"%s\\": {", comma, val[2]);');
        child.stdin.write('          for(j=3;j<d;++j)');
        child.stdin.write('          {');
        child.stdin.write('             sub(/^[ \\t]*/,"",val[j]);');
        child.stdin.write('             if(split(val[j],tmp,":")>1)');
        child.stdin.write('             {');
        child.stdin.write('                sub(/^[ \\t]*/,"",tmp[2]);');
        child.stdin.write('                gsub(/ /,"",tmp[1]);');
        child.stdin.write('                printf("%s\\"%s\\": \\"%s\\"", ccx, tmp[1], tmp[2]);');
        child.stdin.write('                ccx=",";');
        child.stdin.write('             }');
        child.stdin.write('          }');
        child.stdin.write('          printf("}}");');
        child.stdin.write('          comma=",";');
        child.stdin.write('      }');
        child.stdin.write('   }');
        child.stdin.write('   printf("]");');
        child.stdin.write("}'\nexit\n");
        child.waitExit();

        try
        {
            var j = JSON.parse(child.stdout.str);
            var i, key, key2;
            for (i = 0; i < j.length; ++i)
            {
                for (key in j[i])
                {
                    delete j[i][key]['ArrayHandle'];
                    delete j[i][key]['ErrorInformationHandle'];
                    for (key2 in j[i][key])
                    {
                        if (j[i][key][key2] == 'Unknown' || j[i][key][key2] == 'Not Specified' || j[i][key][key2] == '')
                        {
                            delete j[i][key][key2];
                        }
                    }
                }
            }

            if(j.length > 0){
                var mem = {};
                for (i = 0; i < j.length; ++i)
                {
                    for (key in j[i])
                    {
                        if (mem[key] == null) { mem[key] = []; }
                        mem[key].push(j[i][key]);
                    }
                }
                values.linux.memory = mem;
            }
        }
        catch (e)
        { }
        child = null;
    }

    var usbdevices = require('lib-finder').findBinary('usb-devices');
    if (usbdevices != null)
    {
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stderr.str = ''; child.stderr.on('data', dataHandler);
        child.stdin.write(usbdevices + " | tr '\\n' '`' | ");
        child.stdin.write(" awk '");
        child.stdin.write('{');
        child.stdin.write('   comma="";');
        child.stdin.write('   printf("[");');
        child.stdin.write('   len=split($0, group, "``");');
        child.stdin.write('   for(i=1;i<=len;++i)');
        child.stdin.write('   {');
        child.stdin.write('      comma2="";');
        child.stdin.write('      xlen=split(group[i], line, "`");');
        child.stdin.write('      scount=0;');
        child.stdin.write('      for(x=1;x<xlen;++x)');
        child.stdin.write('      {');
        child.stdin.write('         if(line[x] ~ "^S:")');
        child.stdin.write('         {');
        child.stdin.write('            ++scount;');
        child.stdin.write('         }');
        child.stdin.write('      }');
        child.stdin.write('      if(scount>0)');
        child.stdin.write('      {');
        child.stdin.write('         printf("%s{", comma); comma=",";');
        child.stdin.write('         for(x=1;x<xlen;++x)');
        child.stdin.write('         {');
        child.stdin.write('            if(line[x] ~ "^T:")');
        child.stdin.write('            {');
        child.stdin.write('               comma3="";');
        child.stdin.write('               printf("%s\\"hardware\\": {", comma2); comma2=",";');
        child.stdin.write('               sub(/^T:[ \\t]*/, "", line[x]);');
        child.stdin.write('               gsub(/= */, "=", line[x]);');
        child.stdin.write('               blen=split(line[x], tokens, " ");');
        child.stdin.write('               for(y=1;y<blen;++y)');
        child.stdin.write('               {');
        child.stdin.write('                  match(tokens[y],/=/);');
        child.stdin.write('                  h=substr(tokens[y],1,RSTART-1);');
        child.stdin.write('                  v=substr(tokens[y],RSTART+1);');
        child.stdin.write('                  sub(/#/, "", h);');
        child.stdin.write('                  printf("%s\\"%s\\": \\"%s\\"", comma3, h, v); comma3=",";');
        child.stdin.write('               }');
        child.stdin.write('               printf("}");');
        child.stdin.write('            }');
        child.stdin.write('            if(line[x] ~ "^S:")');
        child.stdin.write('            {');
        child.stdin.write('               sub(/^S:[ \\t]*/, "", line[x]);');
        child.stdin.write('               match(line[x], /=/);');
        child.stdin.write('               h=substr(line[x],1,RSTART-1);');
        child.stdin.write('               v=substr(line[x],RSTART+1);');
        child.stdin.write('               printf("%s\\"%s\\": \\"%s\\"", comma2, h,v); comma2=",";');
        child.stdin.write('            }');
        child.stdin.write('         }');
        child.stdin.write('         printf("}");');
        child.stdin.write('      }');
        child.stdin.write('   }');
        child.stdin.write('   printf("]");');
        child.stdin.write("}'\nexit\n");
        child.waitExit();

        try
        {
            values.linux.usb = JSON.parse(child.stdout.str);
        }
        catch(x)
        { }
        child = null;
    }

    var pcidevices = require('lib-finder').findBinary('lspci');
    if (pcidevices != null)
    {
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = ''; child.stdout.on('data', dataHandler);
        child.stderr.str = ''; child.stderr.on('data', dataHandler);
        child.stdin.write(pcidevices + " -m | tr '\\n' '`' | ");
        child.stdin.write(" awk '");
        child.stdin.write('{');
        child.stdin.write('   printf("[");');
        child.stdin.write('   comma="";');
        child.stdin.write('   alen=split($0, lines, "`");');
        child.stdin.write('   for(a=1;a<alen;++a)');
        child.stdin.write('   {');
        child.stdin.write('      match(lines[a], / /);');
        child.stdin.write('      blen=split(lines[a], meta, "\\"");');
        child.stdin.write('      bus=substr(lines[a], 1, RSTART);');
        child.stdin.write('      gsub(/ /, "", bus);');
        child.stdin.write('      printf("%s{\\"bus\\": \\"%s\\"", comma, bus); comma=",";');
        child.stdin.write('      printf(", \\"device\\": \\"%s\\"", meta[2]);');
        child.stdin.write('      printf(", \\"manufacturer\\": \\"%s\\"", meta[4]);');
        child.stdin.write('      printf(", \\"description\\": \\"%s\\"", meta[6]);');
        child.stdin.write('      if(meta[8] != "")');
        child.stdin.write('      {');
        child.stdin.write('         printf(", \\"subsystem\\": {");');
        child.stdin.write('         printf("\\"manufacturer\\": \\"%s\\"", meta[8]);');
        child.stdin.write('         printf(", \\"description\\": \\"%s\\"", meta[10]);');
        child.stdin.write('         printf("}");');
        child.stdin.write('      }');
        child.stdin.write('      printf("}");');
        child.stdin.write('   }');
        child.stdin.write('   printf("]");');
        child.stdin.write("}'\nexit\n");
        child.waitExit();

        try
        {
            values.linux.pci = JSON.parse(child.stdout.str);
        }
        catch (x)
        { }
        child = null;
    }

    return (values);
}

function windows_wmic_results(str)
{
    var lines = str.trim().split('\r\n');
    var keys = lines[0].split(',');
    var i, key, keyval;
    var tokens;
    var result = [];

    console.log('Lines: ' + lines.length, 'Keys: ' + keys.length);

    for (i = 1; i < lines.length; ++i)
    {
        var obj = {};
        console.log('i: ' + i);
        tokens = lines[i].split(',');
        for (key = 0; key < keys.length; ++key)
        {
            var tmp = Buffer.from(tokens[key], 'binary').toString();
            console.log(tokens[key], tmp);
            tokens[key] = tmp == null ? '' : tmp;
            if (tokens[key].trim())
            {
                obj[keys[key].trim()] = tokens[key].trim();
            }
        }
        delete obj.Node;
        result.push(obj);
    }
    return (result);
}

function windows_volumes()
{
    var promise = require('promise');
    var p1 = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var p2 = new promise(function (res, rej) { this._res = res; this._rej = rej; });

    p1._p2 = p2;
    p2._p1 = p1;

    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['powershell', '-noprofile', '-nologo', '-command', '-']);
    p1.child = child;
    child.promise = p1;
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('Get-Volume | Select-Object -Property DriveLetter,FileSystemLabel,FileSystemType,Size,DriveType | ConvertTo-Csv -NoTypeInformation\nexit\n');
    child.on('exit', function (c)
    {
        var a, i, tokens, key;
        var ret = {};

        a = this.stdout.str.trim().split('\r\n');
        for (i = 1; i < a.length; ++i)
        {
            tokens = a[i].split(',');
            if (tokens[0] != '' && tokens[1] != undefined)
            {
                ret[tokens[0].split('"')[1]] =
                    {
                        name: tokens[1].split('"')[1],
                        type: tokens[2].split('"')[1],
                        size: tokens[3].split('"')[1],
                        removable: tokens[4].split('"')[1] == 'Removable'
                    };
            }
        }
        this.promise._res({ r: ret, t: tokens });
    });

    p1.then(function (j)
    {
        var ret = j.r;
        var tokens = j.t;

        var child = require('child_process').execFile(process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['powershell', '-noprofile', '-nologo', '-command', '-']);
        p2.child = child;
        child.promise = p2;
        child.tokens = tokens;
        child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
        child.stdin.write('Get-BitLockerVolume | Select-Object -Property MountPoint,VolumeStatus,ProtectionStatus | ConvertTo-Csv -NoTypeInformation\nexit\n');
        child.on('exit', function ()
        {
            var i;
            var a = this.stdout.str.trim().split('\r\n');
            for (i = 1; i < a.length; ++i)
            {
                tokens = a[i].split(',');
                key = tokens[0].split(':').shift().split('"').pop();
                if (ret[key] != null)
                {
                    ret[key].volumeStatus = tokens[1].split('"')[1];
                    ret[key].protectionStatus = tokens[2].split('"')[1];
                    try {
                        var str = '';
                        var foundMarkedLine = false;
                        var password = '';
                        var child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'manage-bde -protectors -get ', tokens[0].split('"')[1], ' -Type recoverypassword'], {});
                        child.stdout.on('data', function (chunk) { str += chunk.toString(); });
                        child.stderr.on('data', function (chunk) { str += chunk.toString(); });
                        child.waitExit();
                        var lines = str.split(/\r?\n/);
                        for (var i = 0; i < lines.length; i++) {
                            if (lines[i].trim() !== '' && lines[i].includes('Password:') && !lines[i].includes('Numerical Password:')) {
                                if (i + 1 < lines.length && lines[i + 1].trim() !== '') {
                                    password = lines[i + 1].trim();
                                    foundMarkedLine = true;
                                }
                                if (foundMarkedLine) break;
                            }
                        }
                        ret[key].recoveryPassword = (foundMarkedLine ? password : '');
                    } catch(ex) { }
                }
            }
            this.promise._res(ret);
        });
    });
    return (p2);
}

function windows_identifiers()
{
    var ret = { windows: {} };
    var items, item, i;

    ret['identifiers'] = {};

    var values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_Bios", ['ReleaseDate', 'Manufacturer', 'SMBIOSBIOSVersion', 'SerialNumber']);
    if(values[0]){
        ret['identifiers']['bios_date'] = values[0]['ReleaseDate'];
        ret['identifiers']['bios_vendor'] = values[0]['Manufacturer'];
        ret['identifiers']['bios_version'] = values[0]['SMBIOSBIOSVersion'];
        ret['identifiers']['bios_serial'] = values[0]['SerialNumber'];
    }
    ret['identifiers']['bios_mode'] = 'Legacy';

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_BaseBoard", ['Product', 'SerialNumber', 'Manufacturer', 'Version']);
    if(values[0]){
        ret['identifiers']['board_name'] = values[0]['Product'];
        ret['identifiers']['board_serial'] = values[0]['SerialNumber'];
        ret['identifiers']['board_vendor'] = values[0]['Manufacturer'];
        ret['identifiers']['board_version'] = values[0]['Version'];
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_ComputerSystemProduct", ['UUID', 'Name']);
    if(values[0]){
        ret['identifiers']['product_uuid'] = values[0]['UUID'];
        ret['identifiers']['product_name'] = values[0]['Name'];
        trimIdentifiers(ret.identifiers);
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_PhysicalMemory");
    if(values[0]){
        trimResults(values);
        ret.windows.memory = values;
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_OperatingSystem");
    if(values[0]){
        trimResults(values);
        ret.windows.osinfo = values[0];
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_DiskPartition");
    if(values[0]){
        trimResults(values);
        ret.windows.partitions = values;
        for (var i in values) {
            if (values[i].Description=='GPT: System') {
                ret['identifiers']['bios_mode'] = 'UEFI';
            }
        }
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_Processor", ['Caption', 'DeviceID', 'Manufacturer', 'MaxClockSpeed', 'Name', 'SocketDesignation']);
    if(values[0]){
        ret.windows.cpu = values;
    }
    
    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_VideoController", ['Name', 'CurrentHorizontalResolution', 'CurrentVerticalResolution']);
    if(values[0]){
        ret.windows.gpu = values;
    }

    values = require('win-wmi').query('ROOT\\CIMV2', "SELECT * FROM Win32_DiskDrive", ['Caption', 'DeviceID', 'Model', 'Partitions', 'Size', 'Status']);
    if(values[0]){
        ret.windows.drives = values;
    }
    
    // Insert GPU names
    ret.identifiers.gpu_name = [];
    for (var gpuinfo in ret.windows.gpu)
    {
        if (ret.windows.gpu[gpuinfo].Name) { ret.identifiers.gpu_name.push(ret.windows.gpu[gpuinfo].Name); }
    }

    // Insert Storage Devices
    ret.identifiers.storage_devices = [];
    for (var dv in ret.windows.drives)
    {
        ret.identifiers.storage_devices.push({ Caption: ret.windows.drives[dv].Caption, Model: ret.windows.drives[dv].Model, Size: ret.windows.drives[dv].Size });
    }

    try { ret.identifiers.cpu_name = ret.windows.cpu[0].Name; } catch (x) { }
    return (ret);
}
function macos_identifiers()
{
    var ret = { identifiers: {} };
    var child;

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep board-id | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_name = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_serial = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep manufacturer | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_vendor = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep version | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_version = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.product_uuid = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('sysctl -n machdep.cpu.brand_string\nexit\n');
    child.waitExit();
    ret.identifiers.cpu_name = child.stdout.str.trim();


    trimIdentifiers(ret.identifiers);


    child = null;
    return (ret);
}

function win_chassisType()
{
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'SystemEnclosure', 'get', 'ChassisTypes']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    try
    {
        var tok = child.stdout.str.split('{')[1].split('}')[0];
        var val = tok.split(',')[0];
        return (parseInt(val));
    }
    catch (e)
    {
        return (2); // unknown
    }
}

function win_systemType()
{
    var CSV = '/FORMAT:"' + require('util-language').wmicXslPath + 'csv"';
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'ComputerSystem', 'get', 'PCSystemType', CSV]);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    return (parseInt(child.stdout.str.trim().split(',').pop()));
}

function win_formFactor(chassistype)
{
    var ret = 'DESKTOP';
    switch (chassistype)
    {
        case 11:    // Handheld
        case 30:    // Tablet
        case 31:    // Convertible
        case 32:    // Detachable
            ret = 'TABLET';
            break;
        case 9:     // Laptop
        case 10:    // Notebook
        case 14:    // Sub Notebook
            ret = 'LAPTOP';
            break;
        default:
            ret = win_systemType() == 2 ? 'MOBILE' : 'DESKTOP';
            break;
    }

    return (ret);
}

switch(process.platform)
{
    case 'linux':
        module.exports = { _ObjectID: 'identifiers', get: linux_identifiers };
        break;
    case 'win32':
        module.exports = { _ObjectID: 'identifiers', get: windows_identifiers, chassisType: win_chassisType, formFactor: win_formFactor, systemType: win_systemType };
        break;
    case 'darwin':
        module.exports = { _ObjectID: 'identifiers', get: macos_identifiers };
        break;
    default:
        module.exports = { get: function () { throw ('Unsupported Platform'); } };
        break;
}
module.exports.isDocker = function isDocker()
{
    if (process.platform != 'linux') { return (false); }

    var child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write("cat /proc/self/cgroup | tr '\n' '`' | awk -F'`' '{ split($1, res, " + '"/"); if(res[2]=="docker"){print "1";} }\'\nexit\n');
    child.waitExit();
    return (child.stdout.str != '');
};
module.exports.isBatteryPowered = function isBatteryOperated()
{
    var ret = false;
    switch(process.platform)
    {
        default:
            break;
        case 'linux':
            var devices = require('fs').readdirSync('/sys/class/power_supply');
            for (var i in devices)
            {
                if (require('fs').readFileSync('/sys/class/power_supply/' + devices[i] + '/type').toString().trim() == 'Battery')
                {
                    ret = true;
                    break;
                }
            }
            break;
        case 'win32':
            var GM = require('_GenericMarshal');
            var stats = GM.CreateVariable(12);
            var kernel32 = GM.CreateNativeProxy('Kernel32.dll');
            kernel32.CreateMethod('GetSystemPowerStatus');
            if (kernel32.GetSystemPowerStatus(stats).Val != 0)
            {
                if(stats.toBuffer()[1] != 128 && stats.toBuffer()[1] != 255)
                {
                    ret = true;
                }
                else
                {
                    // No Battery detected, so lets check if there is supposed to be one
                    var formFactor = win_formFactor(win_chassisType());
                    return (formFactor == 'LAPTOP' || formFactor == 'TABLET' || formFactor == 'MOBILE');
                }
            }
            break;
        case 'darwin':
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = ''; child.stdout.on('data', function(c){ this.str += c.toString(); });
            child.stderr.str = ''; child.stderr.on('data', function(c){ this.str += c.toString(); });
            child.stdin.write("pmset -g batt | tr '\\n' '`' | awk -F'`' '{ if(NF>2) { print \"true\"; }}'\nexit\n");
            child.waitExit();
            if(child.stdout.str.trim() != '') { ret = true; }
            break;
    }
    return (ret);
};
module.exports.isVM = function isVM()
{
    var ret = false;
    var id = this.get();
    if (id.linux && id.linux.sys_vendor)
    {
        switch (id.linux.sys_vendor)
        {
            case 'VMware, Inc.':
            case 'QEMU':
            case 'Xen':
                ret = true;
                break;
            default:
                break;
        }
    }
    if (id.identifiers.bios_vendor)
    {
        switch(id.identifiers.bios_vendor)
        {
            case 'VMware, Inc.':
            case 'Xen':
            case 'SeaBIOS':
                ret = true;
                break;
            default:
                break;
        }
    }
    if (id.identifiers.board_vendor && id.identifiers.board_vendor == 'VMware, Inc.') { ret = true; }
    if (id.identifiers.board_name)
    {
        switch (id.identifiers.board_name)
        {
            case 'VirtualBox':
            case 'Virtual Machine':
                ret = true;
                break;
            default:
                break;
        }
    }

    if (process.platform == 'win32' && !ret)
    {
        for(var i in id.identifiers.gpu_name)
        {
            if(id.identifiers.gpu_name[i].startsWith('VMware '))
            {
                ret = true;
                break;
            }
        }
    }


    if (!ret) { ret = this.isDocker(); }
    return (ret);
};

if (process.platform == 'win32')
{
    module.exports.volumes_promise = windows_volumes;
}

// bios_date = BIOS->ReleaseDate
// bios_vendor = BIOS->Manufacturer
// bios_version = BIOS->SMBIOSBIOSVersion
// board_name = BASEBOARD->Product = ioreg/board-id
// board_serial = BASEBOARD->SerialNumber = ioreg/serial-number | ioreg/IOPlatformSerialNumber
// board_vendor = BASEBOARD->Manufacturer = ioreg/manufacturer
// board_version = BASEBOARD->Version