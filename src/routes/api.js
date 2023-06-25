import { Router } from "express";
import DATA_FORMAT from "../../sc1-data-format/format.json";
import CONSTANTS from "../../constants.json";
import net from "net";
import fetch from 'node-fetch';


function usageError() {
  throw new Error('Invalid command. Correct usages:\n' +
      '\t`npm start`: Use to connect the distribution server to the pi\n' +
      '\t`npm start -- -d`: Use to connect the distribution server to a local instance of the sc1-driver-io app\n' +
      '\t`npm start -- -i`: Use to run the distribution server on this computer alongside the engineering dashboard\n');
}


const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.setPrompt('Enter \'r\' to refresh the table that\'s being queried: ');

const ROUTER = Router();

const NUM_BYTES_IDX = 0;

let bytesPerPacket = 0;
for (const property in DATA_FORMAT) {
  bytesPerPacket += DATA_FORMAT[property][NUM_BYTES_IDX];
}


let DISTRIBUTION_PORT; // Port for TCP connection with engineering dashboard instance(s)
let DISTRIBUTION_HOST; // TCP server's address for connection with engineering dashboard instance(s)
let INCOMING_DATA_ADDRESS; // IP address of the TCP server that will be sending data to the distribution server

// Set IP addresses and ports according to the command used to start the server
if (process.argv.length === 3) {
  switch(process.argv.at(2)) {
    case "individual":
      // `npm start -- -i` was used
      DISTRIBUTION_HOST = CONSTANTS.LOCAL_HOST;
      DISTRIBUTION_PORT = CONSTANTS.CAR_PORT;
      INCOMING_DATA_ADDRESS = CONSTANTS.PI_ADDRESS;
      break;
    case "dev":
      // `npm start -- -d` was used
      DISTRIBUTION_HOST = CONSTANTS.LOCAL_HOST;
      DISTRIBUTION_PORT = CONSTANTS.TEST_PORT;
      INCOMING_DATA_ADDRESS = CONSTANTS.LOCAL_HOST;
      break;
    default:
      // An invalid option was given. Throw an error describing the usage
      usageError();
  }
} else if (process.argv.length === 2) {
  // `npm start` was used
  DISTRIBUTION_HOST = CONSTANTS.LAN_HOST;
  DISTRIBUTION_PORT = CONSTANTS.CAR_PORT;
  INCOMING_DATA_ADDRESS = CONSTANTS.PI_ADDRESS;
} else {
  // An invalid command was used. Throw an error describing the usage
  usageError();
}

const clients = [];

const server = net.createServer((socket) => {
  readline.pause();
  console.log('\nClient connected');
  readline.prompt(true);

  clients.push(socket);

  function exit() {
    const index = clients.indexOf(socket);

    if (index > -1) {
      clients.splice(index, 1);
      console.log("Client removed from list");
    } else {
      console.log("Client has already been removed");
    }

    if(!socket.destroyed) {
      socket.destroy();
      console.log("Socket successfully destroyed");
    } else {
      console.log("Socket has already been destroyed");
    }
  }

  // Error, connection closed, and connection ended listeners
  socket.on("error", (error) => {
    readline.pause();
    console.warn("\nSocket errored", error);
    exit();
    readline.prompt(true);
  });

  socket.on("close", (close) => {
    readline.pause();
    console.warn("\nSocket closed", close);
    exit();
    readline.prompt(true);
  });

  socket.on("end", () => {
    readline.pause();
    console.warn("\nClient disconnected (socket ended)");
    exit();
    readline.prompt(true);
  });
});

server.on('error', (err) => {
  console.error(`Server error: ${err}`);
});

// Start listening for incoming connections from engineering dashboard instances
server.listen(DISTRIBUTION_PORT, DISTRIBUTION_HOST, () => {
  console.log(`Server listening on ${DISTRIBUTION_HOST}:${DISTRIBUTION_PORT}`);
});

function broadcastData(data) {
  clients.forEach((client) => {
    if (!client.destroyed) {
      client.write(data);
    }
  });
}



//----------------------------------------------------- LTE ----------------------------------------------------------
let interval;
let tableName;
let latestTimestamp;
// Counts for the total number of fetches and successes
let fetchCount = 0;
let successCount = 0;

const MILLIS_PER_MIN = 60000;


async function getLatestTable() {
  console.log("Retrieving the most recent table...");
  // Get most recently created table that has a timestamp for a name
  await fetch(`http://150.136.104.125:3000/newest-timestamp-table`, {
    method: 'GET',
    headers: {
      "Content-type": "application/json"
    }
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      tableName = data.response;
      console.log(`Got table name: ${tableName}`);
    });
}


function promptRefresh() {
  readline.question(readline.getPrompt(), (input) => {
    if(input === 'r') {
      getLatestTable().then(() => {
        promptRefresh();
      });
    } else {
      promptRefresh();
    }
  });
}


async function setupVPSInterface() {
  await getLatestTable();
  promptRefresh();

  // Get the first timestamp from the table and subtract 1 so that it is included
  // in the first group of retrieved entries
  await fetch(`http://150.136.104.125:3000/get-first-timestamp/${tableName}`, {
    method: 'GET',
    headers: {
      "Content-type": "application/json"
    }
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      // Get the first timestamp in the table (minus 1)
      latestTimestamp = data.response - 1;
      // Get millisecond timestamp from ten minutes ago
      const tenMinutesEarlier = Date.now() - 10 * MILLIS_PER_MIN;

      // Set latestTimestamp to whichever is later: ten minutes ago or the first timestamp in the table (minus 1)
      latestTimestamp = (latestTimestamp >= tenMinutesEarlier) ? latestTimestamp : tenMinutesEarlier;
    });

  // Fetch the newest rows at regular intervals
  interval = setInterval(() => {
    // Increment the total number of fetches
    fetchCount ++;

    if(fetchCount === (successCount + 1)) {
      fetch(`http://150.136.104.125:3000/get-new-rows/${tableName}/${latestTimestamp}`, {
        method: 'GET',
        headers: {
          "Content-type": "application/json"
        }
      })
        .then(function(response) {
          return response.json();
        })
        .then(function(data) {
          // Get the rows of timestamps and data from the response
          let rows = data.response;

          // Make sure there was at least 1 row returned
          if(data.response.length > 0) {
            // Iterate through the rows and print the timestamps and payloads and unpack the payloads
            let i;
            for(i in rows) {
              broadcastData(Buffer.from(rows[i].payload.data));
            }

            // Update the latest timestamp
            latestTimestamp = rows[i].timestamp;
          }

          // Increment total number of successes
          successCount ++;
          // Reset fetchCount to match successCount so that on the next iteration, the get-new-rows will be fetched
          fetchCount = successCount;
        })
        .catch(function(error) {
          console.warn('Request failed', error);
          fetchCount = successCount;
        });
    }
  }, 250);
}

setupVPSInterface();



//----------------------------------------------------- TCP ----------------------------------------------------------
/**
 * Creates a connection with the TCP server at port CONSTANTS.CAR_PORT and address INCOMING_DATA_ADDRESS. Then, sets
 * listeners for connect, data, close, and error events. In the event of an error, the client will attempt to re-open
 * the socket at regular intervals.
 */
function openSocket() {
  readline.pause();
  // Establish connection with server
  var client = net.connect(CONSTANTS.CAR_PORT, INCOMING_DATA_ADDRESS); // TODO Add third parameter (timeout in ms) if we want to timeout due to inactivity
  client.setKeepAlive(true);
  readline.prompt(true);

  // Connection established listener
  client.on("connect", () => {
    readline.pause();
    console.log(`\nConnected to car server: ${client.remoteAddress}:${CONSTANTS.CAR_PORT}`);
    readline.prompt(true);
  });

  // Data received listener
  client.on("data", (data) => {
    if(data.length === bytesPerPacket) {
      broadcastData(data);
    } else {
      readline.pause();
      console.warn("\nERROR: Bad packet length ------------------------------------");
      readline.prompt(true);
    }
  });

  // Socket closed listener
  client.on("close", function () {
    // TODO Set solar_car_connection to false for engineering dashboards if cellular connection is also gone

    readline.pause();
    console.log(`\nConnection to car server (${INCOMING_DATA_ADDRESS}:${CONSTANTS.CAR_PORT}) is closed`);
    readline.prompt(true);
  });

  // Socket error listener
  client.on("error", (err) => {
    readline.pause();
    // Log error
    console.log("\nClient errored out:", err);

    // Kill socket
    client.destroy();
    client.unref();

    // TODO Set solar_car_connection for engineering dashboards if cellular connection is also gone

    // Attempt to re-open socket
    setTimeout(openSocket, 1000);
  });
}

// Create new socket
openSocket();

export default ROUTER;
