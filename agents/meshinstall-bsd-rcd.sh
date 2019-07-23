#!/bin/sh
# PROVIDE: meshagent
# REQUIRE: FILESYSTEMS NETWORKING
# KEYWORD: shutdown
. /etc/rc.subr

name="meshagent"
desc="MeshCentral Agent"
rcvar=${name}_enable
pidfile="/var/run/meshagent.pid"
command="/usr/sbin/daemon"
command_args="-P ${pidfile} -r -f /usr/local/mesh/meshagent "
command_chdir="/usr/local/mesh"

load_rc_config $name
: ${meshagent_enable="YES"}
run_rc_command "$1"