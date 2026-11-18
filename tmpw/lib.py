import json
F=json.load(open('/tmp/gaforum-build/data/facts/index.json'))
def T(slug,tagline,best_for,summary,verdict,weak,wrong,srcidx,pricing=None,features=None,pm=None,fp=None,platforms=None,country=None):
    r=F[slug]
    return {"slug":slug,"name":r['name'],"site":r['site'],"company":r.get('company',''),"country":country if country is not None else r.get('country',''),
     "tagline":tagline,"best_for":best_for,
     "pricing":pricing or r['pricing'],"pricing_model":pm if pm is not None else r.get('pricing_model',''),
     "free_plan":fp or r.get('free_plan') or 'Unknown',"platforms":platforms if platforms is not None else r.get('platforms',''),
     "features":features or r['key_features'][:6],"summary":summary,"verdict":verdict,"weaknesses":weak,"wrong_for":wrong,
     "sources":[r['facts'][i] for i in srcidx]}
def write(slug,d):
    json.dump(d,open(f'/tmp/gaforum-build/data/categories/{slug}.json','w'),ensure_ascii=False,indent=2)
