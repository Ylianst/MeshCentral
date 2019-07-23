#!/bin/sh
### BEGIN INIT INFO
# Provides:          <NAME>
# Required-Start:    $local_fs $network $named $time $syslog
# Required-Stop:     $local_fs $network $named $time $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Description:       <DESCRIPTION>
### END INIT INFO

SCRIPT=/usr/local/mesh/meshagent
RUNAS=root

PIDFILE=/var/run/meshagent.pid
LOGFILE=/var/log/meshagent.log

start() {
  if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
    echo 'Service already running' >&2
    return 1
  fi
  echo 'Starting service…' >&2
  local CMD="$SCRIPT -exec \"var child; process.on('SIGTERM', function () { child.removeAllListeners('exit'); child.kill(); process.exit(); }); function start() { child = require('child_process').execFile(process.execPath, [process.argv0, \"\"]); child.stdout.on('data', function (c) { }); child.stderr.on('data', function (c) { }); child.on('exit', function (status) { start(); }); } start();\" &> \"$LOGFILE\" & echo \$!"

  cd /usr/local/mesh
  su -c "$CMD" $RUNAS > "$PIDFILE"
  echo 'Service started' >&2
}

stop() {
  if [ ! -f "$PIDFILE" ]; then
    echo 'Service not running' >&2
    return 1
  else
    pid=$( cat "$PIDFILE" )
    if kill -0 $pid 2>/dev/null; then
          echo 'Stopping service…' >&2
          kill -15 $pid
          echo 'Service stopped' >&2
    else
      echo 'Service not running'
    fi
    rm -f $"PIDFILE"
  fi
}
restart(){
    stop
    start
}
status(){
    if [ -f "$PIDFILE" ]
    then
        pid=$( cat "$PIDFILE" )
        if kill -0 $pid 2>/dev/null; then
            echo "meshagent start/running, process $pid"
        else
            echo 'meshagent stop/waiting'
        fi
    else
        echo 'meshagent stop/waiting'
    fi

}


case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        start
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: service meshagent {start|stop|restart|status}"
        ;;
esac
exit 0
