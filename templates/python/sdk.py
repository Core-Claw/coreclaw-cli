import grpc
import json
import sdk_pb2
import sdk_pb2_grpc

from google.protobuf import empty_pb2
from typing import TypedDict, List


class CoreSDK:
    _channel = grpc.insecure_channel("127.0.0.1:20086")

    class _ParameterService:
        def __init__(self, channel):
            self.stub = sdk_pb2_grpc.ParameterStub(channel)

        def get_input_json_str(self):
            resp = self.stub.GetInputJSONString(empty_pb2.Empty())
            return resp.jsonString

        def get_input_json_dict(self):
            json_str = self.get_input_json_str()
            return json.loads(json_str) if json_str else {}

    class _ResultService:
        def __init__(self, channel):
            self.stub = sdk_pb2_grpc.ResultStub(channel)

        class TableHeader(TypedDict):
            label: str
            key: str
            format: str

        def set_table_header(self, headers: List[TableHeader]):
            headers = sdk_pb2.TableHeader(headers=headers)
            return self.stub.SetTableHeader(headers)

        def push_data(self, dict_obj):
            json_str = json.dumps(dict_obj, ensure_ascii=False)
            data = sdk_pb2.Data(jsonString=json_str)
            return self.stub.PushData(data)

        def upsert_data(self, dict_obj, unique_key: str):
            if not unique_key:
                raise ValueError("unique_key is required")
            if unique_key not in dict_obj:
                raise ValueError(f"unique_key [{unique_key}] not found in data")

            upsert_obj = dict(dict_obj)
            upsert_obj["__coreclaw_upsert_key__"] = unique_key
            upsert_obj["__coreclaw_upsert_value__"] = str(dict_obj[unique_key])
            return self.push_data(upsert_obj)

    class _LogService:
        def __init__(self, channel):
            self.stub = sdk_pb2_grpc.LogStub(channel)

        def debug(self, log: str):
            return self.stub.Debug(sdk_pb2.LogBody(log=log))

        def info(self, log: str):
            return self.stub.Info(sdk_pb2.LogBody(log=log))

        def warn(self, log: str):
            return self.stub.Warn(sdk_pb2.LogBody(log=log))

        def error(self, log: str):
            return self.stub.Error(sdk_pb2.LogBody(log=log))

    Parameter = _ParameterService(_channel)
    Result = _ResultService(_channel)
    Log = _LogService(_channel)


if __name__ == "__main__":
    input_json_str = CoreSDK.Parameter.get_input_json_str()
    print("get_input_json_str res:", input_json_str)

    input_dict = CoreSDK.Parameter.get_input_json_dict()
    print("get_input_json_dict res:", input_dict)

    res = CoreSDK.Result.push_data({"py-data-key": "py-data-value"})
    print("push_data resp:", res.code, res.message)

    res = CoreSDK.Log.debug("py-debug...")
    print("Log.debug resp:", res.code, res.message)

    res = CoreSDK.Log.debug(f"input_dict={input_dict}")
    print("Log.debug resp:", res.code, res.message)

    res = CoreSDK.Log.info("py-info...")
    print("Log.info resp:", res.code, res.message)

    res = CoreSDK.Log.warn("py-warn...")
    print("Log.info resp:", res.code, res.message)

    res = CoreSDK.Log.error("py-error...")
    print("Log.info resp:", res.code, res.message)
