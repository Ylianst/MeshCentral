#!/usr/bin/env bash

CheckStartupType() {
  # 1 = Systemd
  # 2 = Upstart
  # 3 = init.d
  # 5 = BSD

  # echo "Checking if Linux or BSD Platform"
  plattype=`uname | awk '{ tst=tolower($0);a=split(tst, res, "bsd"); if(a==1) { print "LINUX"; } else { print "BSD"; }}'`
  if [[ $plattype == 'BSD' ]]
   then return 5;
  fi

  # echo "Checking process autostart system..."
  starttype1=`cat /proc/1/status | grep 'Name:' | awk '{ print $2; }'`
  starttype2=`ps -p 1 -o command= | awk '{a=split($0,res," "); b=split(res[a],tp,"/"); print tp[b]; }'`
 
  # Systemd
  if [[ $starttype1 == 'systemd' ]]
    then return 1;
  elif [[ $starttype1 == 'init'  ||  $starttype2 == 'init' ]]
    then
        if [ -d "/etc/init" ]
            then
                return 2;
            else
                return 3;
        fi
  fi
  return 0;
}


# Add "StartupType=(type)" to .msh file
UpdateMshFile() {
  # Remove all lines that start with "StartupType="
  sed '/^StartupType=/ d' < ./meshagent.msh >> ./meshagent2.msh
  # Add the startup type to the file
  echo "StartupType=$starttype" >> ./meshagent2.msh
  mv ./meshagent2.msh ./meshagent.msh
}

CheckInstallAgent() {
  # echo "Checking mesh identifier..."
  if [ -e "/usr/local" ]
  then
    installpath="/usr/local/mesh"
  else
    installpath="/usr/mesh"
  fi
  if [ $# -ge 2 ]
  then
    uninstall=$1
    url=$2
    meshid=$3
    if [[ $4 =~ ^--WebProxy= ]];
    then
       webproxy=$4
    fi



    meshidlen=${#meshid}
    if [ $meshidlen -gt 63 ]
    then
      machineid=0
      machinetype=$( uname -m )

      # If we have 3 arguments...
      if [ $# -ge 4 ] &&  [ -z "$webproxy" ]
      then
        # echo "Computer type is specified..."
        machineid=$4
      else
        # echo "Detecting computer type..."
        if [ $machinetype == 'x86_64' ] || [ $machinetype == 'amd64' ]
        then
          if [ $starttype -eq 5 ]
          then
            # FreeBSD x86, 64 bit
            machineid=30
          else
            # Linux x86, 64 bit
            bitlen=$( getconf LONG_BIT )
            if [ $bitlen == '32' ] 
            then
                # 32 bit OS
                machineid=5
            else
                # 64 bit OS
                machineid=6
            fi
          fi
        fi
        if [ $machinetype == 'x86' ] || [ $machinetype == 'i686' ] || [ $machinetype == 'i586' ]
        then
          if [ $starttype -eq 5 ]
          then
            # FreeBSD x86, 32 bit
            machineid=31
          else
            # Linux x86, 32 bit
            machineid=5
          fi
        fi
        if [ $machinetype == 'armv6l' ] || [ $machinetype == 'armv7l' ]
        then
          # RaspberryPi 1 (armv6l) or RaspberryPi 2/3 (armv7l)
          machineid=25
        fi
        if [ $machinetype == 'aarch64' ]
        then
          # RaspberryPi 3B+ running Ubuntu 64 (aarch64)
          machineid=26
        fi
        # Add more machine types, detect KVM support... here.
      fi

      if [ $machineid -eq 0 ]
      then
        echo "Unsupported machine type: $machinetype."
      else
        DownloadAgent $uninstall $url $meshid $machineid
      fi

    else
      echo "Device group identifier is not correct, must be at least 64 characters long."
    fi
  else
    echo "URI and/or device group identifier have not been specified, must be passed in as arguments."
    return 0;
  fi
}

DownloadAgent() {
  uninstall=$1
  url=$2
  meshid=$3
  machineid=$4
  echo "Downloading agent #$machineid..."
  wget $url/meshagents?id=$machineid {{{wgetoptionshttps}}}-O ./meshagent || curl {{{curloptionshttps}}}--output ./meshagent $url/meshagents?id=$machineid

  # If it did not work, try again using http
  if [ $? != 0 ]
  then
    url=${url/"https://"/"http://"}
    wget $url/meshagents?id=$machineid {{{wgetoptionshttp}}}-O ./meshagent || curl {{{curloptionshttp}}}--output ./meshagent $url/meshagents?id=$machineid
  fi

  if [ $? -eq 0 ]
  then
    echo "Agent downloaded."
    # TODO: We could check the meshagent sha256 hash, but best to authenticate the server.
    chmod 755 ./meshagent
    wget $url/meshsettings?id=$meshid {{{wgetoptionshttps}}}-O ./meshagent.msh || curl {{{curloptionshttps}}}--output ./meshagent.msh $url/meshsettings?id=$meshid

    # If it did not work, try again using http
    if [ $? -ne 0 ]
    then
      wget $url/meshsettings?id=$meshid {{{wgetoptionshttp}}}-O ./meshagent.msh || curl {{{curloptionshttp}}}--output ./meshagent.msh $url/meshsettings?id=$meshid
    fi

    if [ $? -eq 0 ]
    then
      # Update the .msh file and run the agent installer/uninstaller
      if [ $uninstall == 'uninstall' ] || [ $uninstall == 'UNINSTALL' ]
      then
        # Uninstall the agent
        ./meshagent -fulluninstall
      else
        # Install the agent
        UpdateMshFile
        ./meshagent -fullinstall --copy-msh=1 $webproxy
      fi
    else
      echo "Unable to download device group settings at: $url/meshsettings?id=$meshid."
    fi
  else
    echo "Unable to download agent at: $url/meshagents?id=$machineid."
  fi
}


CheckStartupType
starttype=$?
#echo "Type: $starttype"

currentuser=$( whoami )
if [ $currentuser == 'root' ]
then
  if [ $# -eq 0 ]
  then
    echo -e "This script will install or uninstall a agent, usage:\n  $0 [serverUrl] [deviceGroupId] (machineId)\n  $0 uninstall [serverUrl] [deviceGroupId] (machineId)"
  else
    if [ $1 == 'uninstall' ] || [ $1 == 'UNINSTALL' ]
    then
      CheckInstallAgent 'uninstall' $2 $3 $4
    else
      CheckInstallAgent 'install' $1 $2 $3
    fi
  fi
else
  echo "Must be root to install or uninstall the agent."
fi
