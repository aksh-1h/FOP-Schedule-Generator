"""Lossless source staging and conservative, reviewable catalog matching.
No fuzzy match becomes a live workload assignment.
"""
import json,re,hashlib,uuid
from pathlib import Path
from collections import defaultdict,Counter
from difflib import SequenceMatcher
import openpyxl

BASE=Path('C:/Users/Aksh/Downloads')
OUT=Path('data/import-review'); OUT.mkdir(parents=True,exist_ok=True)
issues=[]; catalog=[]; faculty=[]; assignments=[]; room_uses=defaultdict(set)
def norm(v):
    return re.sub(r'[^a-z0-9]','',str(v or '').lower().replace('&','and'))
def clean(v): return re.sub(r'\s+',' ',str(v or '')).strip()
def room(v):
    s=clean(v).split(' (')[0].upper()
    # Identical physical alphanumeric labels, explicitly recorded in the report.
    return re.sub(r'^(\d{3})([AB])$',r'\1-\2',s)
def source(file,sheet,row): return {'file':file,'sheet':sheet,'row':row}
def merged_value(ws,row,col):
    value=ws.cell(row,col).value
    if value is not None:return value
    for rg in ws.merged_cells.ranges:
        if rg.min_row<=row<=rg.max_row and rg.min_col<=col<=rg.max_col:return ws.cell(rg.min_row,rg.min_col).value
    return None
def add(course,term,spec,code,name,kind,hours,rooms,scope,src,**extra):
    record={'key':f'{course}:{term}:{spec}:{code}:{norm(name)}:{kind}','course':course,'term_number':term,'specialization':spec,'code':clean(code),'name':clean(name),'session_type':kind,'slots_per_population':hours,'rooms':rooms,'scope':scope,'sources':[src],**extra}
    catalog.append(record)
    for r in rooms:
        if r:room_uses[r].add('lab' if kind=='lab' else 'lecture')
    return record

file='bpharm data time table.xlsx'; b=openpyxl.load_workbook(BASE/file,data_only=True)
for row in range(4,32):
    ws=b['THEORY']; term,name,code,hours= [ws.cell(row,c).value for c in range(1,5)]
    elective='ELECTIVE' in str(hours) or 'ELECTIVE' in str(ws.cell(row,5).value)
    hours=int(re.match(r'\d+',str(hours))[0]); rs=[room(ws.cell(row,c).value) for c in ([5] if elective else [5,6])]
    add('BPHARM',term,'',code,name,'elective' if elective else 'theory',hours,rs,'pooled' if elective else 'group',source(file,ws.title,row),preferred_window=clean(ws.cell(row,7).value),remarks=clean(merged_value(ws,row,8)),populations=1 if elective else 2)
for row in range(3,15):
    ws=b['PRACTICAL']; term,name,code,hours,batches,lab=[ws.cell(row,c).value for c in range(1,7)]
    add('BPHARM',term,'',code,name,'lab',hours,[room(lab)],'batch',source(file,ws.title,row),populations=batches,preferred_window=clean(ws.cell(row,7).value),remarks=clean(ws.cell(row,8).value),reported_total=ws.cell(row,9).value)

file='mpharm data time table.xlsx'; m=openpyxl.load_workbook(BASE/file,data_only=True)
# Deduplicate only after proving the duplicated BPHARM source cells are identical.
for original,copy in [('THEORY','B PHARM THEORY'),('PRACTICAL','B PHARM PRACTICAL')]:
    a,bcopy=b[original],m[copy]; differences=[]
    for row in range(1,max(a.max_row,bcopy.max_row)+1):
        for col in range(1,max(a.max_column,bcopy.max_column)+1):
            if a.cell(row,col).value!=bcopy.cell(row,col).value:differences.append(a.cell(row,col).coordinate)
    if differences:issues.append({'type':'duplicate_mismatch','sheet':copy,'cells':differences})
    else:
        for item in catalog:
            if item['sources'][0]['sheet']==original:item['sources'].append(source(file,copy,item['sources'][0]['row']))
ws=m['M. PHARM']
for row in range(3,48):
    term,code,name,lab,hours=[ws.cell(row,c).value for c in [1,3,4,5,8]]
    spec=clean(merged_value(ws,row,2));kind='lab' if 'Practical' in name else 'theory'
    add('MPHARM',term,spec,code,name,kind,hours,[room(lab)],'group',source(file,ws.title,row),populations=1)
    if kind=='lab' and clean(code).endswith('T'):issues.append({'type':'code_type_mismatch','source':source(file,ws.title,row),'detail':f'{code} ends in T, but the name says Practical and hours={hours}; source code preserved.'})

file='pharm D data time table.xlsx'; p=openpyxl.load_workbook(BASE/file,data_only=True);ws=p['Sheet1'];year=None
for row in list(range(5,34))+list(range(35,46)):
    if ws.cell(row,1).value is not None:year=ws.cell(row,1).value
    code,name=ws.cell(row,2).value,ws.cell(row,3).value
    course='PHARMD_PB' if row>=35 else 'PHARMD'
    theory=ws.cell(row,4).value; practical=ws.cell(row,6).value; total=ws.cell(row,8).value
    ht=theory if isinstance(theory,(int,float)) else 0
    hp=practical if isinstance(practical,(int,float)) else 0
    if total!=ht+hp:issues.append({'type':'source_total_mismatch','source':source(file,ws.title,row),'reported':total,'calculated':ht+hp})
    for kind,hours,col in [('theory',ht,5),('lab',hp,7)]:
        if not hours:continue
        source_kind=kind
        if clean(name).lower()=='clerkship':kind='theory'
        record=add(course,year,'',code,name,kind,hours,[room(ws.cell(row,col).value)],'group',source(file,ws.title,row),populations=1,remarks=clean(merged_value(ws,row,9)))
        if source_kind!=kind:record['approved_override']={'original_session_type':source_kind,'session_type':kind,'reason':'User confirmed Clerkship uses one-hour sessions; preserve 10 slots/week.'}
        if not record['rooms'][0]:issues.append({'type':'missing_room','key':record['key'],'source':record['sources'][0]})
        if kind=='lab' and hours%3:issues.append({'type':'non_three_slot_lab','key':record['key'],'hours':hours,'source':record['sources'][0]})
        if course=='PHARMD_PB':record['requires_spec_extension']=True
        if row in [10,11]:record['requires_spec_extension']=True

file='FINAL WORK LOAD Even - 2026-27 7.5 (1).xlsx';fbook=openpyxl.load_workbook(BASE/file,data_only=False);cached=openpyxl.load_workbook(BASE/file,data_only=True);ws=fbook.worksheets[1]
current=None
for row in range(5,141):
    name=ws.cell(row,2).value
    if name:
        key=f'faculty-sheet2-row-{row}'
        current={'key':key,'name':clean(name),'specialization':clean(merged_value(ws,row,3)),'experience_years':merged_value(ws,row,4),'source':source(file,ws.title,row),'reported_total':cached[ws.title].cell(row,10).value,'total_formula':ws.cell(row,10).value if ws.cell(row,10).data_type=='f' else None,'max_workload_slots_per_week':None,'is_placeholder':clean(name).lower().startswith('new faculty')}
        faculty.append(current)
    program=clean(ws.cell(row,5).value); subject=clean(ws.cell(row,7).value);semester=ws.cell(row,6).value
    theory=ws.cell(row,8).value or 0;practical=ws.cell(row,9).value or 0
    if not program or not subject:continue
    assignment={'faculty_key':current['key'],'faculty_name':current['name'],'program_raw':program,'term_raw':semester,'subject_raw':subject,'theory_slots':theory,'practical_slots':practical,'source':source(file,ws.title,row),'matches':[]}
    np=norm(program)
    course='BPHARM' if np=='bpharm' else 'MPHARM' if np.startswith('mpharm') or np.startswith('mpharm') else 'PHARMD_PB' if np in ['pb','pharmdpb'] else 'PHARMD' if np in ['pharmd','pd','pharmdandpb'] else None
    if course is None and 'mpharm' in np:course='MPHARM'
    assignment['course']=course
    term=int(str(semester).split('&')[0].strip()) if str(semester).split('&')[0].strip().isdigit() else None
    assignment['term_number']=term
    for kind,hours in [('theory',theory),('lab',practical)]:
        if not hours:continue
        candidates=[c for c in catalog if c['course']==course and c['term_number']==term and (c['session_type']==kind or kind=='theory' and c['session_type']=='elective')]
        # Exact subject code is safe for identity only, not for disputed hours or populations.
        codes=[c for c in candidates if norm(c['code']) in norm(subject)]
        exact=[c for c in candidates if norm(c['name'])==norm(subject)]
        matched=codes or exact
        ranked=sorted(candidates,key=lambda c:SequenceMatcher(None,norm(c['name']),norm(subject)).ratio(),reverse=True)
        assignment['matches'].append({'kind':kind,'hours':hours,'identity_match':matched[0]['key'] if len(matched)==1 else None,'method':'exact code' if codes else 'exact name' if exact else 'unresolved','suggestions':[{'key':c['key'],'name':c['name'],'similarity':round(SequenceMatcher(None,norm(c['name']),norm(subject)).ratio(),3)} for c in ranked[:3]]})
        if kind=='lab' and hours%3:issues.append({'type':'faculty_practical_not_divisible_by_three','source':assignment['source'],'faculty':current['name'],'subject':subject,'hours':hours})
    assignments.append(assignment)
for f in faculty:
    f['computed_assigned_total']=sum(a['theory_slots']+a['practical_slots'] for a in assignments if a['faculty_key']==f['key'])
    if f['reported_total']!=f['computed_assigned_total']:issues.append({'type':'faculty_total_mismatch','faculty':f['name'],'source':f['source'],'reported':f['reported_total'],'calculated':f['computed_assigned_total']})
    if f['is_placeholder']:issues.append({'type':'unfilled_faculty_position','source':f['source'],'name':f['name'],'specialization':f['specialization']})

rooms=[{'room_no':r,'uses':sorted(uses),'room_type':'lecture' if 'lecture' in uses else 'lab'} for r,uses in sorted(room_uses.items())]
room_demand=defaultdict(int)
for c in catalog:
    if c['course']=='PHARMD_PB':continue
    if c['scope']=='group' and c['populations']==2:
        for r in c['rooms']:room_demand[r]+=c['slots_per_population']
    elif c['scope']=='batch':
        # B.Pharm BP209-P explicitly moves one of the four batches to 201-B.
        if c['code']=='BP209-P' and '201-B' in c.get('remarks',''):
            room_demand[c['rooms'][0]]+=c['slots_per_population']*(c['populations']-1)
            room_demand['201-B']+=c['slots_per_population']
        else:room_demand[c['rooms'][0]]+=c['slots_per_population']*c['populations']
    else:
        for r in c['rooms']:
            if r:room_demand[r]+=c['slots_per_population']
for r,hours in sorted(room_demand.items()):
    if hours>36:issues.append({'type':'room_overload','room':r,'required_slots':hours,'available_slots':36,'detail':'No faculty mapping or lab-window relaxation can resolve a fixed room requiring more than 36 weekly slots.'})
for r in rooms:
    if len(r['uses'])>1:issues.append({'type':'mixed_use_room','room':r['room_no'],'detail':'Keep one physical room ID for both theory and practical use, never duplicate it by room type.'})
for c in catalog:
    matched=[(a,match) for a in assignments for match in a['matches'] if match['identity_match']==c['key']]
    if matched:
        requested=c['slots_per_population']*c['populations']; assigned=sum(match['hours'] for a,match in matched)
        if assigned!=requested:issues.append({'type':'exact_identity_hours_mismatch','subject':c['key'],'catalog_total':requested,'exact_matched_faculty_total':assigned,'faculty_rows':[a['source']['row'] for a,match in matched]})

payload={'decisions':{'weekly_hours_authority':'Course-wise subject workload sheets, confirmed by user','bpharm_population_workloads':'Equal across divisions/batches, confirmed by user','clerkship':'10 one-hour sessions; no 3-slot practical classification'},'room_demand':dict(room_demand),'catalog':catalog,'rooms':rooms,'faculty':faculty,'assignments':assignments,'issues':issues}
(OUT/'normalized-staging.json').write_text(json.dumps(payload,indent=2,ensure_ascii=False),encoding='utf8')
counts=Counter(i['type'] for i in issues)
lines=['# Source reconciliation report','', 'No fabricated faculty, maximum limits, hours, divisions or batches have been introduced. Workload candidates remain staged until the unresolved mappings are supplied.','', '## Source totals','',f'- {len(catalog)} subject components, including {sum(c["course"]=="PHARMD_PB" for c in catalog)} P.B. components outside v1.',f'- {len(rooms)} distinct physical room labels after explicit aliases 201B → 201-B and 401A → 401-A.',f'- {len(faculty)} faculty blocks; {sum(f["is_placeholder"] for f in faculty)} are unfilled positions, not identified people.',f'- {len(assignments)} faculty allocation rows; {sum(a["theory_slots"]+a["practical_slots"] for a in assignments)} aggregate faculty slots.','- M.Pharm workbook B.Pharm sheets were compared cell-by-cell and are exact duplicates; they are not imported twice.','- M.Pharm subject-code and subject-name column headers are reversed; values were identified by their contents.','- Merged cells were expanded only within their actual merged ranges. Pharm.D A13 inherits Year 2 from the surrounding year block.','- Source names and codes are preserved, including replacement characters and apparent code/name errors.','- Faculty Total Workload is an assigned total, not a maximum-workload limit. No maximum was inferred.','', '## Issues requiring decisions','']
for kind,count in counts.items():lines.append(f'- {kind}: {count}')
lines.extend(['','## Detailed discrepancies',''])
lines.append('- User-approved override: Clerkship retains 10 weekly slots but uses one-hour theory-format sessions. Duplicate source code 8207503 is preserved; subject identity also includes its name so Clerkship cannot overwrite Clinical Pharmacokinetics.')
lines.append('- Course-wise subject workload hours are authoritative. Faculty hours are retained as source allocation evidence, not allowed to overwrite course requirements. B.Pharm population workload is equal across divisions and across batches.')
for issue in issues:lines.append('- '+json.dumps(issue,ensure_ascii=False))
lines.extend(['','## Faculty reconciliation','','| Faculty | Reported total | Computed total | Source row |','|---|---:|---:|---:|'])
for f in faculty:lines.append(f'| {f["name"]} | {f["reported_total"]} | {f["computed_assigned_total"]} | {f["source"]["row"]} |')
lines.extend(['','## Fixed-room weekly demand','','P.B. duplication is excluded. BP209-P uses 201-B for one batch as explicitly stated in its source remark.','','| Room | Required slots | Available slots |','|---|---:|---:|'])
for r,hours in sorted(room_demand.items()):lines.append(f'| {r or "MISSING"} | {hours} | 36 |')
(OUT/'reconciliation-report.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'catalog_by_course':dict(Counter(c['course'] for c in catalog)),'rooms':len(rooms),'faculty_blocks':len(faculty),'named_faculty':sum(not f['is_placeholder'] for f in faculty),'assignment_rows':len(assignments),'faculty_total_slots':sum(a['theory_slots']+a['practical_slots'] for a in assignments),'issues':dict(counts)},indent=2))
print('FACULTY TOTAL DIFFERENCES:',json.dumps([i for i in issues if i['type']=='faculty_total_mismatch']))
