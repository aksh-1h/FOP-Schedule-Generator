-- OPTIONAL SYNTHETIC FIXTURE. Not real PIP faculty, subjects, rooms or workload.
-- Apply only to a development database after seed.sql.
do $$
declare col uuid; t record; g record; b record; f uuid; r uuid; s uuid; n int:=0; p record;
begin
 select id into col from colleges where code='PIP';
 if exists(select 1 from subject_workload w join academic_terms at on at.id=w.term_id join courses c on c.id=at.course_id where c.college_id=col) then raise exception 'Demo import requires PIP to have no existing workload'; end if;
 for t in select a.*,c.name as course_name from academic_terms a join courses c on c.id=a.course_id where c.college_id=col loop
  for g in select * from groups where term_id=t.id loop
   n:=n+1;
   insert into faculty(college_id,name,initials,max_workload_slots_per_week) values(col,'Sample faculty '||n,'S'||n,30) returning id into f;
   insert into rooms(college_id,room_no,room_type) values(col,'DEMO-T'||n,'lecture') returning id into r;
   insert into subjects(college_id,code,name,session_type) values(col,'DEMO-TH'||n,'Sample pharmaceutical theory '||n,'theory') returning id into s;
   insert into subject_workload(subject_id,term_id,scope_type,group_id,faculty_id,room_id,slots_per_week) values(s,t.id,'group',g.id,f,r,3);
   if t.course_name='BPHARM' then
    for b in select * from batches where group_id=g.id loop
     n:=n+1;
     insert into faculty(college_id,name,initials,max_workload_slots_per_week) values(col,'Sample faculty '||n,'S'||n,30) returning id into f;
     insert into rooms(college_id,room_no,room_type) values(col,'DEMO-L'||n,'lab') returning id into r;
     insert into subjects(college_id,code,name,session_type) values(col,'DEMO-LB'||n,'Sample laboratory '||n,'lab') returning id into s;
     insert into subject_workload(subject_id,term_id,scope_type,group_id,batch_id,faculty_id,room_id,slots_per_week) values(s,t.id,'batch',g.id,b.id,f,r,3);
    end loop;
   else
    n:=n+1;
    insert into rooms(college_id,room_no,room_type) values(col,'DEMO-L'||n,'lab') returning id into r;
    insert into subjects(college_id,code,name,session_type) values(col,'DEMO-LB'||n,'Sample laboratory '||n,'lab') returning id into s;
    insert into subject_workload(subject_id,term_id,scope_type,group_id,faculty_id,room_id,slots_per_week) values(s,t.id,'group',g.id,f,r,3);
   end if;
  end loop;
 end loop;
 for p in select pb.* from pooled_batches pb join academic_terms at on at.id=pb.term_id join courses c on c.id=at.course_id where c.college_id=col loop
  n:=n+1;
  insert into faculty(college_id,name,initials,max_workload_slots_per_week) values(col,'Sample faculty '||n,'S'||n,30) returning id into f;
  insert into rooms(college_id,room_no,room_type) values(col,'DEMO-P'||n,case when p.kind='elective' then 'lecture' else 'lab' end) returning id into r;
  insert into subjects(college_id,code,name,session_type) values(col,'DEMO-P'||n,'Sample '||p.name,p.kind) returning id into s;
  insert into subject_workload(subject_id,term_id,scope_type,pooled_batch_id,faculty_id,room_id,slots_per_week) values(s,p.term_id,'pooled',p.id,f,r,case when p.kind='elective' then 1 else 3 end);
 end loop;
end $$;
