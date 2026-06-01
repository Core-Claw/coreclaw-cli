import grpc from '@grpc/grpc-js';
import { createRequire } from 'node:module';
import { CliError } from '../utils/errors.js';

const require = createRequire(import.meta.url);
const sdkMessages = require('../../templates/node/sdk_pb.js');
const sdkServices = require('../../templates/node/sdk_grpc_pb.js');

export async function startRuntimeGrpcServer({ host = '127.0.0.1', port = 20086, input, store }) {
  const server = new grpc.Server();
  const inputString = JSON.stringify(input ?? {});

  server.addService(sdkServices.ParameterService, {
    getInputJSONString(_call, callback) {
      const response = new sdkMessages.InputJSONStringResponse();
      response.setCode(0);
      response.setJsonstring(inputString);
      callback(null, response);
    },
  });

  server.addService(sdkServices.ResultService, {
    setTableHeader(call, callback) {
      const headers = call.request.getHeadersList().map((header) => ({
        label: header.getLabel(),
        key: header.getKey(),
        format: header.getFormat(),
      }));
      callback(null, responseMessage(store.recordTableHeaders(headers)));
    },
    pushData(call, callback) {
      callback(null, responseMessage(store.recordResult(call.request.getJsonstring() ?? '')));
    },
  });

  const logHandler = (level) => (call, callback) => {
    const row = store.recordLog(level, call.request.getLog() ?? '');
    printSdkLog(row);
    callback(null, responseMessage({ code: 0, message: 'ok' }));
  };

  server.addService(sdkServices.LogService, {
    debug: logHandler('DEBUG'),
    info: logHandler('INFO'),
    warn: logHandler('WARN'),
    error: logHandler('ERROR'),
  });

  const address = `${host}:${port}`;
  await new Promise((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
      if (error) {
        if (String(error.message ?? error).includes('EADDRINUSE')) {
          reject(new CliError(`CoreClaw local runtime port ${address} is already in use. Run workers serially because official SDK files connect to a fixed 127.0.0.1:20086 endpoint.`));
          return;
        }
        reject(error);
        return;
      }
      resolve();
    });
  });

  return {
    address,
    async stop() {
      await new Promise((resolve) => server.tryShutdown(resolve));
    },
  };
}

function responseMessage({ code = 0, message = 'ok' } = {}) {
  const response = new sdkMessages.Response();
  response.setCode(code);
  response.setMessage(message);
  return response;
}

function printSdkLog(row) {
  const prefix = `[${row.level}]`;
  if (row.level === 'ERROR') {
    console.error(`${prefix} ${row.message}`);
  } else if (row.level === 'WARN') {
    console.warn(`${prefix} ${row.message}`);
  } else {
    console.log(`${prefix} ${row.message}`);
  }
}
