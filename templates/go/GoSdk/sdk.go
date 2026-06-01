package coresdk

import (
	"context"
	"log"

	grpc "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	address = "127.0.0.1:20086"
)

type _Parameter struct{}
type _Result struct{}
type _Log struct{}

var Parameter _Parameter
var Result _Result
var Log _Log

var _parameterClient ParameterClient
var _resultClient ResultClient
var _logClient LogClient

var grpcConn *grpc.ClientConn

func init() {
	var err error
	grpcConn, err = grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("init grpc client failed: %v", err)
	}

	_parameterClient = NewParameterClient(grpcConn)
	_resultClient = NewResultClient(grpcConn)
	_logClient = NewLogClient(grpcConn)
}

func (_Parameter) GetInputJSONString(ctx context.Context) (string, error) {
	res, err := _parameterClient.GetInputJSONString(ctx, &emptypb.Empty{})
	if err != nil {
		return "", err
	}
	return res.JsonString, nil
}

func (_Result) SetTableHeader(ctx context.Context, headers []*TableHeaderItem) (*Response, error) {
	return _resultClient.SetTableHeader(ctx, &TableHeader{Headers: headers})
}

func (_Result) PushData(ctx context.Context, jsonString string) (*Response, error) {
	return _resultClient.PushData(ctx, &Data{JsonString: jsonString})
}

func (_Log) Debug(ctx context.Context, text string) (*Response, error) {
	return _logClient.Debug(ctx, &LogBody{Log: text})
}

func (_Log) Info(ctx context.Context, text string) (*Response, error) {
	return _logClient.Info(ctx, &LogBody{Log: text})
}

func (_Log) Warn(ctx context.Context, text string) (*Response, error) {
	return _logClient.Warn(ctx, &LogBody{Log: text})
}

func (_Log) Error(ctx context.Context, text string) (*Response, error) {
	return _logClient.Error(ctx, &LogBody{Log: text})
}
