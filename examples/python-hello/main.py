#!/usr/bin/env python3
import asyncio
from sdk import CoreSDK


async def run():
    input_json = CoreSDK.Parameter.get_input_json_dict()
    url = input_json.get("url") or (input_json.get("startUrls", [{}])[0].get("url") if input_json.get("startUrls") else "")

    CoreSDK.Result.set_table_header([
        {"label": "URL", "key": "url", "format": "text"},
        {"label": "Status", "key": "status", "format": "text"},
        {"label": "Title", "key": "title", "format": "text"},
    ])
    CoreSDK.Log.info(f"Processing {url}")
    CoreSDK.Result.push_data({"url": url, "status": "success", "title": "Example Domain"})


if __name__ == "__main__":
    asyncio.run(run())
