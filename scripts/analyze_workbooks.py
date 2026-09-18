import json, hashlib
from pathlib import Path
import openpyxl

out = Path('data/import-review')
out.mkdir(parents=True, exist_ok=True)
books=[]
for name in ['bpharm data time table.xlsx','mpharm data time table.xlsx','pharm D data time table.xlsx','FINAL WORK LOAD Even - 2026-27 7.5 (1).xlsx']:
    path=Path('C:/Users/Aksh/Downloads')/name
    wb=openpyxl.load_workbook(path,data_only=False)
    cached=openpyxl.load_workbook(path,data_only=True)
    book={'file':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sheets':[]}
    for ws in wb:
        if name.startswith('FINAL') and ws != wb.worksheets[1]:
            continue
        rows=[]
        for row in ws:
            cells=[{'cell':c.coordinate,'value':c.value,'cached':cached[ws.title][c.coordinate].value if c.data_type=='f' else None} for c in row if c.value is not None]
            if cells: rows.append({'row':row[0].row,'cells':cells})
        book['sheets'].append({'name':ws.title,'dimensions':ws.calculate_dimension(),'merged_ranges':[str(r) for r in ws.merged_cells.ranges],'rows':rows})
    books.append(book)
(out/'source-extraction.json').write_text(json.dumps(books,ensure_ascii=False,indent=2,default=str),encoding='utf8')
for book in books:
    print('\nFILE:',book['file'])
    for s in book['sheets']:
        print('SHEET:',s['name'],'DIM:',s['dimensions'],'MERGES:',s['merged_ranges'])
        for r in s['rows']:
            print(' | '.join(str(c['cell'])+'='+str(c['value']) for c in r['cells']))
