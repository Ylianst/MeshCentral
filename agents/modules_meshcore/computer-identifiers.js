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
        if (require('fs').existsSync('/sys/firmware/devicetree/base/model')) {
            if (require('fs').readFileSync('/sys/firmware/devicetree/base/model').toString().trim().startsWith('Raspberry')) {
                identifiers['board_vendor'] = 'Raspberry Pi';
                identifiers['board_name'] = require('fs').readFileSync('/sys/firmware/devicetree/base/model').toString().trim();
                identifiers['board_serial'] = require('fs').readFileSync('/sys/firmware/devicetree/base/serial-number').toString().trim();
                const memorySlots = [];
                var child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stdout.str = ''; child.stdout.on('data', dataHandler);
                child.stdin.write('vcgencmd get_mem arm && vcgencmd get_mem gpu\nexit\n');
                child.waitExit();
                try { 
                    const lines = child.stdout.str.trim().split('\n');
                    if (lines.length == 2) {
                        memorySlots.push({ Locator: "ARM Memory", Size: lines[0].split('=')[1].trim() })
                        memorySlots.push({ Locator: "GPU Memory", Size: lines[1].split('=')[1].trim() })
                        ret.memory = { Memory_Device: memorySlots };
                    }
                } catch (xx) { }
            } else {
                throw('Unknown board');
            }
        } else {
            throw ('this platform does not have DMI statistics');
        }
    } else {
        var entries = require('fs').readdirSync('/sys/class/dmi/id');
        for (var i in entries) {
            if (require('fs').statSync('/sys/class/dmi/id/' + entries[i]).isFile()) {
                try {
                    ret[entries[i]] = require('fs').readFileSync('/sys/class/dmi/id/' + entries[i]).toString().trim();
                } catch(z) { }
                if (ret[entries[i]] == 'None') { delete ret[entries[i]]; }
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
    child.stdin.write("lshw -class disk -disable network | tr '\\n' '`' | awk '" + '{ len=split($0,lines,"*"); printf "["; for(i=2;i<=len;++i) { model=""; caption=""; size=""; clen=split(lines[i],item,"`"); for(j=2;j<clen;++j) { split(item[j],tokens,":"); split(tokens[1],key," "); if(key[1]=="description") { caption=substr(tokens[2],2); } if(key[1]=="product") { model=substr(tokens[2],2); } if(key[1]=="size") { size=substr(tokens[2],2);  } } if(model=="") { model=caption; } if(caption!="" || model!="") { printf "%s{\\"Caption\\":\\"%s\\",\\"Model\\":\\"%s\\",\\"Size\\":\\"%s\\"}",(i==2?"":","),caption,model,size; }  } printf "]"; }\'\nexit\n');
    child.waitExit();
    try { identifiers['storage_devices'] = JSON.parse(child.stdout.str.trim()); } catch (xx) { }
    child = null;

    // Fetch storage volumes using df
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', dataHandler);
    child.stdin.write('df -T | awk \'NR==1 || $1 ~ ".+"{print $3, $4, $5, $7, $2}\' | awk \'NR>1 {printf "{\\"size\\":\\"%s\\",\\"used\\":\\"%s\\",\\"available\\":\\"%s\\",\\"mount_point\\":\\"%s\\",\\"type\\":\\"%s\\"},", $1, $2, $3, $4, $5}\' | sed \'$ s/,$//\' | awk \'BEGIN {printf "["} {printf "%s", $0} END {printf "]"}\'\nexit\n');
    child.waitExit();
    try { ret.volumes = JSON.parse(child.stdout.str.trim()); } catch (xx) { }
    child = null;

    values.identifiers = identifiers;
    values.linux = ret;
    trimIdentifiers(values.identifiers);

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

    // Linux Last Boot Up Time
    try {
        child = require('child_process').execFile('/usr/bin/uptime', ['', '-s']); // must include blank value at begining for some reason?
        child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
        child.stderr.on('data', function () { });
        child.waitExit();
        var regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        if (regex.test(child.stdout.str.trim())) {
            values.linux.LastBootUpTime = child.stdout.str.trim();
        } else {
            child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
            child.stdin.write('date -d "@$(( $(date +%s) - $(awk \'{print int($1)}\' /proc/uptime) ))" "+%Y-%m-%d %H:%M:%S"\nexit\n');
            child.waitExit();
            if (regex.test(child.stdout.str.trim())) {
                values.linux.LastBootUpTime = child.stdout.str.trim();
            }
        }
        child = null;
    } catch (ex) { }

    // Linux TPM
    try {
        if (require('fs').statSync('/sys/class/tpm/tpm0').isDirectory()){
            values.tpm = {
                SpecVersion: require('fs').readFileSync('/sys/class/tpm/tpm0/tpm_version_major').toString().trim()
            }
        }
    } catch (ex) { }

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

    // Windows TPM
    IntToStr = function (v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); };
    try {
        values = require('win-wmi').query('ROOT\\CIMV2\\Security\\MicrosoftTpm', "SELECT * FROM Win32_Tpm", ['IsActivated_InitialValue','IsEnabled_InitialValue','IsOwned_InitialValue','ManufacturerId','ManufacturerVersion','SpecVersion']);
        if(values[0]) {
            ret.tpm = {
                SpecVersion: values[0].SpecVersion.split(",")[0],
                ManufacturerId: IntToStr(values[0].ManufacturerId).replace(/[^\x00-\x7F]/g, ""),
                ManufacturerVersion: values[0].ManufacturerVersion,
                IsActivated: values[0].IsActivated_InitialValue,
                IsEnabled: values[0].IsEnabled_InitialValue,
                IsOwned: values[0].IsOwned_InitialValue,
            }
        }
    } catch (ex) { }

    return (ret);
}
function macos_identifiers()
{
    var ret = { identifiers: {}, darwin: {} };
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

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('system_profiler SPMemoryDataType\nexit\n');
    child.waitExit();
    var lines = child.stdout.str.trim().split('\n');
    if(lines.length > 0) {
        const memorySlots = [];
        if(lines[2].trim().includes('Memory Slots:')) { // OLD MACS WITH SLOTS
            var memorySlots1 = child.stdout.str.split(/\n{2,}/).slice(3);
            memorySlots1.forEach(function(slot,index) {
                var lines = slot.split('\n');
                if(lines.length == 1){ // start here
                    if(lines[0].trim()!=''){
                        var slotObj = { DeviceLocator: lines[0].trim().replace(/:$/, '') }; // Initialize name as an empty string
                        var nextline = memorySlots1[index+1].split('\n');
                        nextline.forEach(function(line) {
                            if (line.trim() !== '') {
                                var parts = line.split(':');
                                var key = parts[0].trim();
                                var value = parts[1].trim();
                                value = (key == 'Part Number' || key == 'Manufacturer') ? hexToAscii(parts[1].trim()) : parts[1].trim();
                                slotObj[key.replace(' ','')] = value; // Store attribute in the slot object
                            }
                        });
                        memorySlots.push(slotObj);
                    }
                }
            });
        } else { // NEW MACS WITHOUT SLOTS
            memorySlots.push({ DeviceLocator: "Onboard Memory", Size: lines[2].split(":")[1].trim(), PartNumber: lines[3].split(":")[1].trim(), Manufacturer: lines[4].split(":")[1].trim() })
        }
        ret.darwin.memory = memorySlots;
    }

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('diskutil info -all\nexit\n');
    child.waitExit();
    var sections = child.stdout.str.split('**********\n');
    if(sections.length > 0){
        var devices = [];
        for (var i = 0; i < sections.length; i++) {
            var lines = sections[i].split('\n');
            var deviceInfo = {};
            var wholeYes = false;
            var physicalYes = false;
            var oldmac = false;
            for (var j = 0; j < lines.length; j++) {
                var keyValue = lines[j].split(':');
                var key = keyValue[0].trim();
                var value = keyValue[1] ? keyValue[1].trim() : '';
                if (key === 'Virtual') oldmac = true;
                if (key === 'Whole' && value === 'Yes') wholeYes = true;
                if (key === 'Virtual' && value === 'No') physicalYes = true;
                if(value && key === 'Device / Media Name'){
                    deviceInfo['Caption'] = value;
                }
                if(value && key === 'Disk Size'){
                    deviceInfo['Size'] = value.split(' ')[0] + ' ' + value.split(' ')[1];
                }
            }
            if (wholeYes) {
                if (oldmac) {
                    if (physicalYes) devices.push(deviceInfo);
                } else {
                    devices.push(deviceInfo);
                }
            }
        }
        ret.identifiers.storage_devices = devices;
    }

    // Fetch storage volumes using df
    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', dataHandler);
    child.stdin.write('df -aHY | awk \'NR>1 {printf "{\\"size\\":\\"%s\\",\\"used\\":\\"%s\\",\\"available\\":\\"%s\\",\\"mount_point\\":\\"%s\\",\\"type\\":\\"%s\\"},", $3, $4, $5, $10, $2}\' | sed \'$ s/,$//\' | awk \'BEGIN {printf "["} {printf "%s", $0} END {printf "]"}\'\nexit\n');
    child.waitExit();
    try {
        ret.darwin.volumes = JSON.parse(child.stdout.str.trim());
        for (var index = 0; index < ret.darwin.volumes.length; index++) {
            if (ret.darwin.volumes[index].type == 'auto_home'){
                ret.darwin.volumes.splice(index,1);
            }
        }
        if (ret.darwin.volumes.length == 0) { // not sonima OS so dont show type for now
            child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = ''; child.stdout.on('data', dataHandler);
            child.stdin.write('df -aH | awk \'NR>1 {printf "{\\"size\\":\\"%s\\",\\"used\\":\\"%s\\",\\"available\\":\\"%s\\",\\"mount_point\\":\\"%s\\"},", $2, $3, $4, $9}\' | sed \'$ s/,$//\' | awk \'BEGIN {printf "["} {printf "%s", $0} END {printf "]"}\'\nexit\n');
            child.waitExit();
            try {
                ret.darwin.volumes = JSON.parse(child.stdout.str.trim());
                for (var index = 0; index < ret.darwin.volumes.length; index++) {
                    if (ret.darwin.volumes[index].size == 'auto_home'){
                        ret.darwin.volumes.splice(index,1);
                    }
                }
            } catch (xx) { }
        }
    } catch (xx) { }
    child = null;

    // MacOS Last Boot Up Time
    try {
        child = require('child_process').execFile('/usr/sbin/sysctl', ['', 'kern.boottime']); // must include blank value at begining for some reason?
        child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
        child.stderr.on('data', function () { });
        child.waitExit();
        const timestampMatch = /\{ sec = (\d+), usec = \d+ \}/.exec(child.stdout.str.trim());
        if (!ret.darwin) {
            ret.darwin = { LastBootUpTime: parseInt(timestampMatch[1]) };
        } else {
            ret.darwin.LastBootUpTime = parseInt(timestampMatch[1]);
        }
        child = null;
    } catch (ex) { }

    trimIdentifiers(ret.identifiers);

    child = null;
    return (ret);
}

function hexToAscii(hexString) {
    if(!hexString.startsWith('0x')) return hexString.trim();
    hexString = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
    var str = '';
    for (var i = 0; i < hexString.length; i += 2) {
        var hexPair = hexString.substr(i, 2);
        str += String.fromCharCode(parseInt(hexPair, 16));
    }
    str = str.replace(/[\u007F-\uFFFF]/g, ''); // Remove characters from 0x0080 to 0xFFFF
    return str.trim();
}

function win_chassisType()
{
    // needs to be replaced with win-wmi but due to bug in win-wmi it doesnt handle arrays correctly
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['powershell', '-noprofile', '-nologo', '-command', '-'], {});
    if (child == null) { return ([]); }
    child.descriptorMetadata = 'process-manager';
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.str = ''; child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('Get-WmiObject Win32_SystemEnclosure | Select-Object -ExpandProperty ChassisTypes\r\n');
    child.stdin.write('exit\r\n');
    child.waitExit();
    try {
        return (parseInt(child.stdout.str));
    } catch (e) {
        return (2); // unknown
    }
}

function win_systemType()
{
    try {
        var tokens = require('win-wmi').query('ROOT\\CIMV2', 'SELECT PCSystemType FROM Win32_ComputerSystem', ['PCSystemType']);
        if (tokens[0]) {
            return (parseInt(tokens[0]['PCSystemType']));
        } else {
            return (parseInt(1)); // default is desktop
        }
    } catch (ex) {
        return (parseInt(1)); // default is desktop
    }

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
            case 'EFI Development Kit II / OVMF':
            case 'Proxmox distribution of EDK II':
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

// bios_date = BIOS->ReleaseDate
// bios_vendor = BIOS->Manufacturer
// bios_version = BIOS->SMBIOSBIOSVersion
// board_name = BASEBOARD->Product = ioreg/board-id
// board_serial = BASEBOARD->SerialNumber = ioreg/serial-number | ioreg/IOPlatformSerialNumber
// board_vendor = BASEBOARD->Manufacturer = ioreg/manufacturer
// board_version = BASEBOARD->Version
