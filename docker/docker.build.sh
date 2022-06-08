#!/bin/bash

MSG="";
PRUNE="false";

function appendOutput()
{
    if [ -z "${MSG}" ]; then echo -e "\n" > /dev/tty; fi

    ARGS=$@;
    LINE="${ARGS}\n"
    echo -e "${LINE}" > /dev/tty;

    MSG="${MSG}${LINE}";
}

function runDockerBuild()
{
    if [ "${PRUNE}" == "true" ]; then docker system prune -a -f; fi

	STARTTS=$(date +%s);
    ARGS=$@;

    BUILD_CMD="docker build -f docker/Dockerfile --force-rm --no-cache ${ARGS} -t meshcentral .";
    appendOutput "Current build: ${BUILD_CMD}";

    ${BUILD_CMD};
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
    expr $IMG_SIZE + 0;
    appendOutput "\tImage size: ${IMG_SIZE} ($((${IMG_SIZE}/1024/1024))M)";

    appendOutput "\n";

	return 0;
}


parent_path=$(dirname -- $(dirname -- "$( readlink -f -- "$0"; )"));
if [ "${parent_path}" != "$(pwd -P)" ]; then
    echo -e "change working directory to: ${parent_path}" > /dev/tty;
    cd "${parent_path}";
fi

if ! [ -z $1 ] && [ "${1}" == "prune" ]; then PRUNE="true"; fi

runDockerBuild;
#runDockerBuild --build-arg DISABLE_MINIFY=yes;
#runDockerBuild --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes;

#runDockerBuild --build-arg INCLUDE_MONGOTOOLS=yes;
#runDockerBuild --build-arg INCLUDE_MONGOTOOLS=yes --build-arg DISABLE_MINIFY=yes;
#runDockerBuild --build-arg INCLUDE_MONGOTOOLS=yes --build-arg DISABLE_TRANSLATE=yes;
#runDockerBuild --build-arg INCLUDE_MONGOTOOLS=yes --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes;

echo "";
echo -e $MSG;

exit 0;
