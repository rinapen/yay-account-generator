import json

with open("kegeguchi.json", "r", encoding="utf-8") as f:
    data = json.load(f)

count = len(data)

print(f"データの個数: {count}")
