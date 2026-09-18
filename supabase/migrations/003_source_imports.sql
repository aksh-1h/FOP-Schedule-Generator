-- Preserve source evidence separately from approved solver inputs.
create table source_import_batches(
 id uuid primary key default gen_random_uuid(),
 college_id uuid not null references colleges(id),
 fingerprint text not null unique,
 imported_at timestamptz not null default now(),
 status text not null default 'needs_review' check(status in ('needs_review','approved')),
 source_files jsonb not null,
 summary jsonb not null
);
create table source_import_records(
 id uuid primary key default gen_random_uuid(),
 import_id uuid not null references source_import_batches(id),
 record_kind text not null check(record_kind in ('catalog','faculty','assignment','issue','raw_workbook')),
 source_key text not null,
 payload jsonb not null,
 unique(import_id,record_kind,source_key)
);
alter table subjects add column source_key text;
create unique index subjects_source_key on subjects(college_id,source_key) where source_key is not null;
alter table source_import_batches enable row level security;
alter table source_import_records enable row level security;
create policy import_batch_read on source_import_batches for select to authenticated using(can_access_college(college_id));
create policy import_record_read on source_import_records for select to authenticated using(exists(select 1 from source_import_batches b where b.id=import_id));
grant select on source_import_batches,source_import_records to authenticated;
grant all on source_import_batches,source_import_records to service_role;

create function import_reviewed_catalog(target uuid, input jsonb, raw_sources jsonb, input_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare run uuid; item jsonb; kind text; idx int; subject_count int:=0; room_count int:=0; existing_room rooms%rowtype; existing_subject subjects%rowtype; sp text; pos int;
begin
 if not exists(select 1 from colleges where id=target and code='PIP') then raise exception 'Source files are for PIP only'; end if;
 select id into run from source_import_batches where fingerprint=input_hash;
 if run is not null then return jsonb_build_object('id',run,'already_imported',true); end if;
 insert into source_import_batches(college_id,fingerprint,source_files,summary)
 values(target,input_hash,(select jsonb_agg(jsonb_build_object('file',x->>'file','sha256',x->>'sha256')) from jsonb_array_elements(raw_sources)x),jsonb_build_object('catalog_components',jsonb_array_length(input->'catalog'),'faculty_blocks',jsonb_array_length(input->'faculty'),'assignments',jsonb_array_length(input->'assignments'),'issues',jsonb_array_length(input->'issues'),'workloads_imported',0)) returning id into run;
 foreach kind in array array['catalog','faculty','assignment','issue','raw_workbook'] loop
  idx:=0;
  for item in select * from jsonb_array_elements(case kind when 'assignment' then input->'assignments' when 'issue' then input->'issues' when 'raw_workbook' then raw_sources else input->kind end) loop
   idx:=idx+1;
   insert into source_import_records(import_id,record_kind,source_key,payload) values(run,kind,coalesce(item->>'key',idx::text),item);
  end loop;
 end loop;
 for item in select * from jsonb_array_elements(input->'rooms') loop
  select * into existing_room from rooms where college_id=target and room_no=item->>'room_no';
  if found and existing_room.room_type<>item->>'room_type' then raise exception 'Room type conflict for %, existing data was not changed',item->>'room_no'; end if;
  if not found then insert into rooms(college_id,room_no,room_type) values(target,item->>'room_no',item->>'room_type'); room_count:=room_count+1; end if;
 end loop;
 for item in select * from jsonb_array_elements(input->'catalog') where value->>'course'<>'PHARMD_PB' loop
  select * into existing_subject from subjects where college_id=target and source_key=item->>'key';
  if found and (existing_subject.code<>item->>'code' or existing_subject.name<>item->>'name' or existing_subject.session_type<>item->>'session_type') then raise exception 'Subject conflict for %, existing data was not changed',item->>'key'; end if;
  if not found then
   insert into subjects(college_id,code,name,session_type,source_key) values(target,item->>'code',item->>'name',item->>'session_type',item->>'key');subject_count:=subject_count+1;
  end if;
 end loop;
 -- The nine specializations come from the M.Pharm source, not guessed names.
 pos:=0;
 for sp in select distinct value->>'specialization' from jsonb_array_elements(input->'catalog') where value->>'course'='MPHARM' order by 1 loop
  pos:=pos+1;
  update groups g set name=sp from academic_terms t join courses c on c.id=t.course_id where g.term_id=t.id and c.college_id=target and c.name='MPHARM' and g.name='Specialization '||pos;
 end loop;
 -- Only M.Pharm semester 2 is supplied as active teaching data.
 update academic_terms t set is_active=(t.term_number=2) from courses c where t.course_id=c.id and c.college_id=target and c.name='MPHARM';
 return jsonb_build_object('id',run,'already_imported',false,'subjects_inserted',subject_count,'rooms_inserted',room_count,'workloads_inserted',0,'status','needs_review');
end $$;
revoke all on function import_reviewed_catalog(uuid,jsonb,jsonb,text) from public;
grant execute on function import_reviewed_catalog(uuid,jsonb,jsonb,text) to service_role;
