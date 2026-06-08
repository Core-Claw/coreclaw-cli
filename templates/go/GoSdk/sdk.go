package coresdk

import (
	"context"
	"encoding/json"
	"fmt"
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

func (_Result) PushData(ctx context.Context, data map[string]any) (*Response, error) {
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return _resultClient.PushData(ctx, &Data{JsonString: string(jsonBytes)})
}

func (_Result) UpsertData(ctx context.Context, data map[string]any, uniqueKey string) (*Response, error) {
	if uniqueKey == "" {
		return nil, fmt.Errorf("uniqueKey is required")
	}
	uniqueValue, ok := data[uniqueKey]
	if !ok {
		return nil, fmt.Errorf("uniqueKey [%s] not found in data", uniqueKey)
	}

	upsertData := make(map[string]any, len(data)+2)
	for key, value := range data {
		upsertData[key] = value
	}
	upsertData["__coreclaw_upsert_key__"] = uniqueKey
	upsertData["__coreclaw_upsert_value__"] = fmt.Sprint(uniqueValue)
	return Result.PushData(ctx, upsertData)
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
