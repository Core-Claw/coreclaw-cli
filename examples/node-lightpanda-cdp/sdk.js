const grpc = require('@grpc/grpc-js');
const messages = require('./sdk_pb');
const services = require('./sdk_grpc_pb');
const { Empty } = require('google-protobuf/google/protobuf/empty_pb.js');

const address = "127.0.0.1:20086";

const _parameterClient = new services.ParameterClient(
    address,
    grpc.credentials.createInsecure()
);
const _resultClient = new services.ResultClient(
    address,
    grpc.credentials.createInsecure()
);
const _logClient = new services.LogClient(
    address,
    grpc.credentials.createInsecure()
);

// Shared gRPC response handler.
function handleGrpcResponse(err, response, resolve, reject) {
  if (err) {
    console.error('gRPC call failed:', err);
    reject(err);
    return;
  }
  const result = {
    code: response.getCode(),
    message: response.getMessage()
  };
  if (result.code !== 0) {
    console.error('gRPC call failed with code:', result.code);
    reject(new Error(result.message));
    return;
  }
  resolve(result);
}

exports.parameter = {
  getInputJSONString: function () {
    return new Promise((resolve, reject) => {
      _parameterClient.getInputJSONString(new Empty(), (err, response) => {
        if (err) {
          console.error('call getInputJSONString failed:', err);
          reject(err);
          return;
        }
        const result = {
          code: response.getCode(),
          jsonString: response.getJsonstring()
        }
        if (result.code !== 0) {
          console.error('getInputJSONString code:', result.code);
          reject(new Error(`Code: ${result.code}`));
          return;
        }
        resolve(result.jsonString);
      });
    });
  },

  getInputJSONObject: async function () {
    try {
      const jsonString = await this.getInputJSONString();
      return jsonString ? JSON.parse(jsonString) : {};
    } catch (err) {
      throw err;
    }
  }
};

exports.result = {
  setTableHeader: function (headers) {
    return new Promise((resolve, reject) => {
      // Create the TableHeader message.
      const tableHeaders = new messages.TableHeader();

      const headersList = headers.map(header => {
        // Create a TableHeaderItem for each displayed column.
        const headerMessage = new messages.TableHeaderItem();
        headerMessage.setLabel(header.label);
        headerMessage.setKey(header.key);
        headerMessage.setFormat(header.format);
        return headerMessage;
      });

      tableHeaders.setHeadersList(headersList);

      _resultClient.setTableHeader(tableHeaders, (err, response) => {
        handleGrpcResponse(err, response, resolve, reject);
      });
    });
  },

  pushData: function (obj) {
    return new Promise((resolve, reject) => {
      let jsonString = "";
      try {
        jsonString = JSON.stringify(obj);
      } catch (err) {
        console.error("pushData JSON.stringify failed, obj:", obj);
        reject(err);
        return;
      }

      const data = new messages.Data();
      data.setJsonstring(jsonString);
      _resultClient.pushData(data, (err, response) => {
        handleGrpcResponse(err, response, resolve, reject);
      });
    });
  }
};

exports.log = {
  logMessage: function (level, logString) {
    return new Promise((resolve, reject) => {
      const logBody = new messages.LogBody();
      logBody.setLog(logString);
      _logClient[level](logBody, (err, response) => {
        if (err) {
          console.error(`call log.${level} failed:`, err);
          reject(err);
          return;
        }
        const result = {
          code: response.getCode(),
          message: response.getMessage()
        };
        if (result.code !== 0) {
          console.error(`log.${level} code:`, result.code);
          reject(new Error(result.message));
          return;
        }
        resolve(result);
      });
    });
  },

  debug: function (logString) {
    return this.logMessage('debug', logString);
  },

  info: function (logString) {
    return this.logMessage('info', logString);
  },

  warn: function (logString) {
    return this.logMessage('warn', logString);
  },

  error: function (logString) {
    return this.logMessage('error', logString);
  }
};
