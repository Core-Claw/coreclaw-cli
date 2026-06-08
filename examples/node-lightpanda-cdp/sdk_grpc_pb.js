// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var sdk_pb = require('./sdk_pb.js');
var google_protobuf_empty_pb = require('google-protobuf/google/protobuf/empty_pb.js');
var google_protobuf_descriptor_pb = require('google-protobuf/google/protobuf/descriptor_pb.js');

function serialize_coresdk_Data(arg) {
  if (!(arg instanceof sdk_pb.Data)) {
    throw new Error('Expected argument of type coresdk.Data');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_coresdk_Data(buffer_arg) {
  return sdk_pb.Data.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_coresdk_InputJSONStringResponse(arg) {
  if (!(arg instanceof sdk_pb.InputJSONStringResponse)) {
    throw new Error('Expected argument of type coresdk.InputJSONStringResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_coresdk_InputJSONStringResponse(buffer_arg) {
  return sdk_pb.InputJSONStringResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_coresdk_LogBody(arg) {
  if (!(arg instanceof sdk_pb.LogBody)) {
    throw new Error('Expected argument of type coresdk.LogBody');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_coresdk_LogBody(buffer_arg) {
  return sdk_pb.LogBody.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_coresdk_Response(arg) {
  if (!(arg instanceof sdk_pb.Response)) {
    throw new Error('Expected argument of type coresdk.Response');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_coresdk_Response(buffer_arg) {
  return sdk_pb.Response.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_coresdk_TableHeader(arg) {
  if (!(arg instanceof sdk_pb.TableHeader)) {
    throw new Error('Expected argument of type coresdk.TableHeader');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_coresdk_TableHeader(buffer_arg) {
  return sdk_pb.TableHeader.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_protobuf_Empty(arg) {
  if (!(arg instanceof google_protobuf_empty_pb.Empty)) {
    throw new Error('Expected argument of type google.protobuf.Empty');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_protobuf_Empty(buffer_arg) {
  return google_protobuf_empty_pb.Empty.deserializeBinary(new Uint8Array(buffer_arg));
}


var ParameterService = exports.ParameterService = {
  getInputJSONString: {
    path: '/coresdk.Parameter/GetInputJSONString',
    requestStream: false,
    responseStream: false,
    requestType: google_protobuf_empty_pb.Empty,
    responseType: sdk_pb.InputJSONStringResponse,
    requestSerialize: serialize_google_protobuf_Empty,
    requestDeserialize: deserialize_google_protobuf_Empty,
    responseSerialize: serialize_coresdk_InputJSONStringResponse,
    responseDeserialize: deserialize_coresdk_InputJSONStringResponse,
  },
};

exports.ParameterClient = grpc.makeGenericClientConstructor(ParameterService, 'Parameter');
var ResultService = exports.ResultService = {
  setTableHeader: {
    path: '/coresdk.Result/SetTableHeader',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.TableHeader,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_TableHeader,
    requestDeserialize: deserialize_coresdk_TableHeader,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
  pushData: {
    path: '/coresdk.Result/PushData',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.Data,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_Data,
    requestDeserialize: deserialize_coresdk_Data,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
};

exports.ResultClient = grpc.makeGenericClientConstructor(ResultService, 'Result');
var LogService = exports.LogService = {
  debug: {
    path: '/coresdk.Log/Debug',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.LogBody,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_LogBody,
    requestDeserialize: deserialize_coresdk_LogBody,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
  info: {
    path: '/coresdk.Log/Info',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.LogBody,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_LogBody,
    requestDeserialize: deserialize_coresdk_LogBody,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
  warn: {
    path: '/coresdk.Log/Warn',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.LogBody,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_LogBody,
    requestDeserialize: deserialize_coresdk_LogBody,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
  error: {
    path: '/coresdk.Log/Error',
    requestStream: false,
    responseStream: false,
    requestType: sdk_pb.LogBody,
    responseType: sdk_pb.Response,
    requestSerialize: serialize_coresdk_LogBody,
    requestDeserialize: deserialize_coresdk_LogBody,
    responseSerialize: serialize_coresdk_Response,
    responseDeserialize: deserialize_coresdk_Response,
  },
};

exports.LogClient = grpc.makeGenericClientConstructor(LogService, 'Log');
