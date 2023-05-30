#!/bin/bash

while [[ "$1" =~ ^- && ! "$1" == "--" ]]; do case $1 in
  -s | --submodule-commit )
    # Check that a commit was provided
    if [[ -z $2 ]]; then
      echo -e "\n\033[1;31m[ERROR] No commit provided for $1\033[0m\n" >&2
      exit 1
    fi
    shift; commit=$1
    ;;
  -d | --dev )
    # Use the 'dev' configuration
    config='dev'
    ;;
  * )
    echo -e "\n\033[1;31m[ERROR] Invalid option: $1\033[0m\n" >&2
    exit 1
    ;;
esac; shift; done
if [[ "$1" == '--' ]]; then shift; fi

# If a submodule commit was specified, checkout that commit within the sc1-data-format submodule
if [[ -n "$commit" ]]; then
  cd Data/sc1-data-format

  # Check if the commit hash provided is valid. If it is, checkout that commit
  if [[ $(git cat-file -t $commit 2>/dev/null) == "commit" ]]; then
    git checkout $commit
  elif [[ $(git fetch origin main &>/dev/null; git cat-file -t $commit 2>/dev/null) == "commit" ]]; then
    git checkout $commit
  else
    echo -e "\nCould not find submodule commit $commit\n" 1>&2
  fi

  cd ../..
fi

# Run the application with the specified configuration, if applicable
npm run build && node ./dist/server.js $config
