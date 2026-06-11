import requests

try:
    r = requests.get('http://localhost:8001/spatial-forecast?room_id=1')
    d = r.json()
    print('Nodes:', len(d.get('nodes', [])))
    heatmaps = d.get('heatmaps', [])
    print('Heatmaps:', len(heatmaps))
    if heatmaps:
        for i, hm in enumerate(heatmaps[:16]):
            temp_sum = sum(sum(row) for row in hm['temperature'])
            print(f"Slice {i} (horizon {hm['horizon_minute']}): temp sum={temp_sum}")
except Exception as e:
    print('Error:', e)
