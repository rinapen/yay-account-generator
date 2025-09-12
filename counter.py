import json

with open("new_accounts.json", "r", encoding="utf-8") as f:
    data = json.load(f)

count = len(data)

print(f"データの個数: {count}")
