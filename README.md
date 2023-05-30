# Engineering Data Distributor
Server to distribute incoming data from Solar Car 1 to instances of the
[Solar Car 1 Engineering Dashboard](https://github.com/badgerloop-software/chase-car-dashboard).

## Supported Environments
This server is meant to be run within a Linux shell (bash). Windows command-line shells are not supported. If running
this server in a Windows command-line shell, [using Docker](#docker-usage) is recommended.

## Command Line Usage
Start script usage: `npm start [OPTIONS]`
- Available options:

  `dev`: Run the server in "dev" configuration, which means that the server will use `localhost` for the TCP
         server address.

## Docker Usage
Building the image: `docker build </path/to/project>`

Running the image: `docker run -p 4001:4001 -i -a stdin -a stdout -a stderr <IMAGE> [RUN_ARGS]`, where `RUN_ARGS` are the same as the options in
[Command Line Usage](#command-line-usage).
- The `-i -a stdin -a stdout -a stderr` options are passed to enable interaction with the server via the command line.
