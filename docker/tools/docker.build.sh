#!/bin/bash

MSG="";
PRUNE="false";
OVERRIDE_TAGS="false";
ENABLE_LOG="false";
LOG_FILE="$(dirname -- "$( readlink -f -- "$0"; )")/build.log";

function appendOutput()
{
    if [ -z "${MSG}" ]; then echo -e "\n" > /dev/tty; fi

    ARGS=$@;
    LINE="${ARGS}\n";
    if [ -z "${ENABLE_LOG}" ] || [ "${ENABLE_LOG}" != "true" ]; then echo -e "${LINE}" > /dev/tty; else echo -e "${LINE}" 2>&1 | tee -a ${LOG_FILE}; fi

    MSG="${MSG}${LINE}";
}

function runDockerBuild()
{
    if [ "${PRUNE}" == "true" ]; then
        if [ -z "${ENABLE_LOG}" ] || [ "${ENABLE_LOG}" != "true" ]; then docker system prune -a -f;
        else docker system prune -a -f | tee -a ${LOG_FILE}; fi
    fi

	STARTTS=$(date +%s);
    ARGS=$@;

    APP_VERSION=$(grep -o '"version":\s*"[^"]*"' ./package.json | cut -f4- -d\" | tr -d '"');
    BASE_TAGS="";
    if [ -z "${OVERRIDE_TAGS}" ] || [ "${OVERRIDE_TAGS}" != "true" ]; then
        BASE_TAGS="-t meshcentral:latest -t meshcentral:${APP_VERSION}";
    fi

    BUILD_CMD="docker build -f docker/Dockerfile --force-rm --no-cache ${ARGS} ${BASE_TAGS} .";
    appendOutput "Current build: ${BUILD_CMD}";

    if [ -z "${ENABLE_LOG}" ] || [ "${ENABLE_LOG}" != "true" ]; then ${BUILD_CMD}; else ${BUILD_CMD} | tee -a ${LOG_FILE}; fi
    if [ $? -ne 0 ]; then exit $?; fi

    IMAGEID=$(docker images --format "{{.ID}} {{.CreatedAt}}" | sort -rk 2 | awk 'NR==1{print $1}');
    appendOutput "\tImageId: ${IMAGEID}";
    
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

    IMG_SIZE=$(docker image inspect ${IMAGEID} | grep -o '"Size":\s*[^,]*' | cut -f2- -d ':' | tr -d ' ');
    expr $IMG_SIZE + 0 > /dev/null;
    appendOutput "\tImage size: ${IMG_SIZE} ($((${IMG_SIZE}/1024/1024))M)\n";

	return 0;
}

parent_path=$(dirname -- $(dirname -- "$( readlink -f -- "$0"; )"));
if [ "${parent_path}" != "$(pwd -P)" ]; then
    echo -e "change working directory to: ${parent_path}" > /dev/tty;
    cd "${parent_path}";
fi

if ! [ -z $1 ]; then
    for arg in "$@"
    do
        case "${arg}" in
            --prune)
                PRUNE="true";
                shift 1;
                ;;
            --log)
                ENABLE_LOG="true";
                shift 1;
                ;;
            --no-tags)
                OVERRIDE_TAGS="true";
                shift 1;
                ;;
            --help)
                __usage="\n
                    Usage: ./$(basename ${0}) [OPTIONS] [BUILD ARGUMENTS]\n
                    \n
                    Options:\n
                    \t--log           \t\twrite output to build.log file\n
                    \t--no-tags       \tdo not use default tags (meshcentral:latest and meshcentral:%VERSION%)\n
                    \t--prune         \tWARNING: This will remove:\n
                    \t\t\t              - all stopped docker containers\n
                    \t\t\t              - all docker networks not used by at least one container\n
                    \t\t\t              - all docker images without at least one container associated to them\n
                    \t\t\t              - all docker build cache\n
                    \n
                    Build arguments:                            \tAll build arguments are forwarded to the docker build command, so you can use any option accepted by 'docker build'\n
                                                                \t\t\t(https://docs.docker.com/engine/reference/commandline/build/#options)\n\n
                    \t--build-arg INCLUDE_MONGODBTOOLS=yes      \tIncludes mongodb-tools (mongodump, ...) in the image\n
                    \t--build-arg DISABLE_MINIFY=yes            \t\tDisables minification of files\n
                    \t--build-arg DISABLE_TRANSLATE=yes         \tDisables translation of files\n
                ";
                echo -e $__usage;
                exit 0;
                ;;
            *)
                break;
                ;;
        esac
    done
fi

MAINARGS=$@;

#runDockerBuild --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes ${MAINARGS};
#runDockerBuild --build-arg DISABLE_TRANSLATE=yes ${MAINARGS};
#runDockerBuild --build-arg DISABLE_MINIFY=yes ${MAINARGS};
runDockerBuild ${MAINARGS};

#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_MINIFY=yes --build-arg DISABLE_TRANSLATE=yes ${MAINARGS};
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_TRANSLATE=yes ${MAINARGS};
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes --build-arg DISABLE_MINIFY=yes ${MAINARGS};
#runDockerBuild --build-arg INCLUDE_MONGODBTOOLS=yes ${MAINARGS};

echo "";
if [ -z "${ENABLE_LOG}" ] || [ "${ENABLE_LOG}" != "true" ]; then echo -e "${MSG}"; else echo -e "${MSG}" 2>&1 | tee -a ${LOG_FILE}; fi

exit 0;
