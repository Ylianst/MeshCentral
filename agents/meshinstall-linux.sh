#!/bin/bash

CheckStartupType() {
  # echo "Checking process autostart system..."
  starttype=`ps -p 1 | awk '/1/ {print $4}'`
  if [[ $starttype == 'systemd' ]]; then return 1; # systemd;
  elif [[ $starttype == 'init' ]]; then return 3; # sysv-init;
  elif [[ `/sbin/init --version` =~ upstart ]]; then return 2; # upstart;
  fi
  return 0;
}

CheckStartupTypeOld() {
  # echo "Checking process autostart system..."
  if [[ `systemctl` =~ -\.mount ]]; then return 1; # systemd;
  elif [[ `/sbin/init --version` =~ upstart ]]; then return 2; # upstart;
  elif [[ -f /etc/init.d/cron && ! -h /etc/init.d/cron ]]; then return 3; # sysv-init;
  fi
  return 0;
}

# Add "StartupType=(type)" to .msh file
UpdateMshFile() {
  # Remove all lines that start with "StartupType="
  sed '/^StartupType=/ d' < /usr/local/mesh/meshagent.msh >> /usr/local/mesh/meshagent2.msh
  # Add the startup type to the file
  echo "StartupType=$starttype" >> /usr/local/mesh/meshagent2.msh
  mv /usr/local/mesh/meshagent2.msh /usr/local/mesh/meshagent.msh
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
    url=$1
    meshid=$2
    meshidlen=${#meshid}
    if [ $meshidlen -eq 64 ]
    then
      machineid=0
      machinetype=$( uname -m )

      # If we have 3 arguments...
      if [ $# -ge 3 ]
      then
        # echo "Computer type is specified..."
	    machineid=$3
	  else
        # echo "Detecting computer type..."
        if [ $machinetype == 'x86_64' ] || [ $machinetype == 'amd64' ]
        then
          # Linux x86, 64 bit
          machineid=6
        fi
        if [ $machinetype == 'x86' ] || [ $machinetype == 'i686' ]
        then
          # Linux x86, 32 bit
          machineid=5
        fi
        if [ $machinetype == 'armv6l' ] || [ $machinetype == 'armv7l' ]
        then
          # RaspberryPi 1 (armv6l) or RaspberryPi 2/3 (armv7l)
          machineid=25
        fi
        # Add more machine types, detect KVM support... here.
	  fi

	  if [ $machineid -eq 0 ]
      then
        echo "Unsupported machine type: $machinetype."
      else
        DownloadAgent $url $meshid $machineid
      fi

    else
      echo "MeshID is not correct, must be 64 characters long."
    fi
  else
    echo "URI and/or MeshID have not been specified, must be passed in as arguments."
    return 0;
  fi
}

DownloadAgent() {
  url=$1
  meshid=$2
  machineid=$3
  # Create folder
  mkdir -p /usr/local/mesh
  cd /usr/local/mesh
  echo "Downloading Mesh agent #$machineid..."
  wget $url/meshagents?id=$machineid -q --no-check-certificate -O /usr/local/mesh/meshagent

  # If it did not work, try again using http
  if [ $? != 0 ]
  then
    url=${url/"https://"/"http://"}
    wget $url/meshagents?id=$machineid -q -O /usr/local/mesh/meshagent
  fi

  if [ $? -eq 0 ]
  then
    echo "Mesh agent downloaded."
    # TODO: We could check the meshagent sha256 hash, but best to authenticate the server.
    chmod 755 /usr/local/mesh/meshagent
    wget $url/meshsettings?id=$meshid -q --no-check-certificate -O /usr/local/mesh/meshagent.msh

    # If it did not work, try again using http
    if [ $? -ne 0 ]
    then
      wget $url/meshsettings?id=$meshid -q -O /usr/local/mesh/meshagent.msh
    fi

    if [ $? -eq 0 ]
    then
	  UpdateMshFile
      if [ $starttype -eq 1 ]
      then
	    # systemd
        echo -e "[Unit]\nDescription=MeshCentral Agent\n[Service]\nExecStart=/usr/local/mesh/meshagent\nStandardOutput=null\nRestart=always\nRestartSec=3\n[Install]\nWantedBy=multi-user.target\nAlias=meshagent.service\n" > /lib/systemd/system/meshagent.service
        systemctl enable meshagent
        systemctl start meshagent
      else
        if [ $starttype -eq 3 ]
        then
		  # initd
	      wget $url/meshagents?script=2 -q --no-check-certificate -O /etc/init.d/meshagent
		  chmod +x /etc/init.d/meshagent
		  update-rc.d meshagent defaults # creates symlinks for rc.d
		  service meshagent start
        else
		  # upstart / others (???)
          ./meshagent start
          ln -s /usr/local/mesh/meshagent /sbin/meshcmd
          ln -s /usr/local/mesh/meshagent /etc/rc2.d/S20mesh
          ln -s /usr/local/mesh/meshagent /etc/rc3.d/S20mesh
          ln -s /usr/local/mesh/meshagent /etc/rc5.d/S20mesh
		fi
      fi
	  echo "Mesh agent started."
    else
      echo "Unable to download mesh settings at: $url/meshsettings?id=$meshid."
    fi
  else
    echo "Unable to download mesh agent at: $url/meshagents?id=$machineid."
  fi
}

UninstallAgent() {
# Uninstall agent
  if [ -e "/usr/local" ]
  then
    installpath="/usr/local/mesh"
  else
    installpath="/usr/mesh"
  fi

  if [ $starttype -eq 1 ]
  then
    # systemd
    rm -f /sbin/meshcmd /lib/systemd/system/meshagent.service
    systemctl disable meshagent
    systemctl stop meshagent
  else
    if [ $starttype -eq 3 ]
	then
		# initd
		service meshagent forceuninstall
		rm -f /sbin/meshcmd /etc/init.d/meshagent
	else
		# upstart / others (???)
		rm -f /sbin/meshcmd /etc/rc2.d/S20mesh /etc/rc3.d/S20mesh /etc/rc5.d/S20mesh
	fi
  fi

  if [ -e $installpath ]
  then
    cd $installpath
    if [ -e "$installpath/meshagent" ]
    then
      ./meshagent stop
    fi
    rm -rf $installpath/*
    rmdir $installpath
  fi
  echo "Agent uninstalled."
}


CheckStartupType
starttype=$?
#echo "Type: $starttype"

currentuser=$( whoami )
if [ $currentuser == 'root' ]
then
  if [ $# -eq 0 ]
  then
    echo -e "This script will install or uninstall a mesh agent, usage:\n  $0 [serverurl] [meshid] (machineid)\n  $0 uninstall"
  else
    if [ $# -eq 1 ]
    then
      if [ $1 == 'uninstall' ] || [ $1 == 'UNINSTALL' ]
      then
        UninstallAgent
      fi
    else
      CheckInstallAgent $1 $2 $3
    fi
  fi
else
  echo "Must be root to install or uninstall mesh agent."
fi
