#!/bin/bash

MSG="";
PRUNE="false";

LOG_FILE=""
#LOG_FILE="$(dirname -- "$( readlink -f -- "$0"; )")/build.log";

function appendOutput()
{
    if [ -z "${MSG}" ]; then echo -e "\n" > /dev/tty; fi

    ARGS=$@;
    LINE="${ARGS}\n";
    if [ -z "${LOG_FILE}" ]; then echo -e "${LINE}" > /dev/tty; else echo -e "${LINE}" &>> "${LOG_FILE}"; fi

    MSG="${MSG}${LINE}";
}

function runDockerBuild()
{
    if [ "${PRUNE}" == "true" ]; then docker system prune -a -f; fi

	STARTTS=$(date +%s);
    ARGS=$@;

    APP_VERSION=$(grep -o '"version":\s*"[^"]*"' ./package.json | cut -f4- -d\" | tr -d '"')
    BUILD_CMD="docker build -f docker/Dockerfile --force-rm --no-cache ${ARGS} -t meshcentral:latest -t meshcentral:${APP_VERSION} .";
    appendOutput "Current build: ${BUILD_CMD}";

    if [ -z "${LOG_FILE}" ]; then ${BUILD_CMD}; else ${BUILD_CMD} &>> "${LOG_FILE}"; fi
    if [ $? -ne 0 ]; then exit $?; fi
    
    ENDTS=$(date +%s);
    DIFSEC=$((${ENDTS}-${STARTTS}));
    if [ ${DIFSEC} -ge 60 ]; then
        TMPMIN=$((${DIFSEC}/60));
        TMPSEC=$((${DIFSEC}%60));

        if [ ${TMPMIN} -ge 60 ]; then
            TMPHOUR=$((${TMPMIN}/60));
            TMPMIN=$((${TMPMIN}%60));

            appendOutput "\tBuild time: ${TMPHOUR} hr ${TMPMIN} min ${TMPSEC} sec";
        else appendOutput "\tBuild time: ${TMPMIN} min ${TMPSEC} sec"; fi
    else appendOutput "\tBuild time: ${DIFSEC} sec"; fi

    IMG_SIZE=$(docker image inspect meshcentral | grep -e "\"Size\"" | tr -d '",' |  sed -E "s/\s*Size:\s*//");
    expr $IMG_SIZE + 0 > /dev/null;
    appendOutput "\tImage size: ${IMG_SIZE} ($((${IMG_SIZE}/1024/1024))M)\n";

	return 0;
}

parent_path=$(dirname -- $(dirname -- "$( readlink -f -- "$0"; )"));
if [ "${parent_path}" != "$(pwd -P)" ]; then
    echo -e "change working directory to: ${parent_path}" > /dev/tty;
    cd "${parent_path}";
fi

if ! [ -z $1 ] && [ "${1}" == "prune" ]; then PRUNE="true"; fi

#runDockerBuild --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg DISABLE_MINIFY=yes;
runDockerBuild;

#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_MINIFY=yes;
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes;

echo "";
echo -e "${MSG}";

exit 0;
