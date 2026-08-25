"""How far can it count? One failure at N=7 is an anecdote; the curve is a finding."""
import base64, json, statistics, sys, time, urllib.request
FIX, MODELS = sys.argv[1], sys.argv[2].split(",")
cases = json.load(open(f"{FIX}/count_cases.json"))
def ask(model, prompt, path, keep="5m"):
    b64 = base64.b64encode(open(path,"rb").read()).decode()
    body = json.dumps({"model":model,"prompt":prompt,"images":[b64],"stream":False,
                       "keep_alive":keep,"options":{"temperature":0,"seed":7,"num_predict":24}}).encode()
    r = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=body,
                               headers={"content-type":"application/json"})
    with urllib.request.urlopen(r, timeout=300) as resp: return json.load(resp).get("response","").strip()
out={}
for m in MODELS:
    print(f"\n# {m}"); rows=[]
    for c in sorted(cases, key=lambda c: int(c["expected"])):
        answers=[ask(m, c["prompt"], f"{FIX}/{c['image']}") for _ in range(3)]
        got=[a.strip().strip('.') for a in answers]
        ok=sum(1 for g in got if c["expected"] in g)
        rows.append({"n":int(c["expected"]),"answers":got,"correct_runs":ok})
        print(f"  n={c['expected']:>2}  {'ok  ' if ok==3 else 'MISS'}  answers={got}")
    out[m]=rows
    try: ask(m,"hi",f"{FIX}/count_n3.png",keep="0s")
    except Exception: pass
    time.sleep(2)
json.dump(out, open(f"{FIX}/count_probe.json","w"), indent=1)
