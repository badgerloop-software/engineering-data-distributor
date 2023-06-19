# Engineering Data Distributor
Server to distribute incoming data from Solar Car 1 to instances of the
[Solar Car 1 Engineering Dashboard](https://github.com/badgerloop-software/chase-car-dashboard).

## Supported Environments
This server is meant to be run within a Linux shell (bash). Windows command-line shells are not supported. If running
this server in a Windows command-line shell, [using Docker](#docker-usage) is recommended.

## Command Line Usage
Start script usage: `npm start [-- <OPTIONS>]`
- Available options:

  `-s | --submodule-commit <commit>`: Use a specific commit for the `sc1-data-format` submodule.
    - `commit`: SHA-1 of the desired `sc1-data-format` commit to use.

  `-d | --dev`: Run the server in "dev" configuration, which means that the server will run on the same computer as the
                TCP server from which it receives data and the engineering dashboard.

  `-i | --individual`: Run the server in "individual" configuration, which means that the server will receive data from
                       the Raspberry Pi and will run on the same computer as the engineering dashboard.

## Docker Usage
Building the image: `docker build </path/to/project>`

Running the image: `docker run -p 4002:4002 -i -a stdin -a stdout -a stderr <IMAGE> [-- <RUN_ARGS>]`, where `RUN_ARGS`
are the same as the options in [Command Line Usage](#command-line-usage).
- The `-i -a stdin -a stdout -a stderr` options are passed to enable interaction with the server via the command line.
