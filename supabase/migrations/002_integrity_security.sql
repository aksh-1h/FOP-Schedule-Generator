-- Additions to the supplied schema: safe history, soft deletes and tenant isolation.
alter table faculty add column is_active boolean not null default true;
alter table subjects add column college_id uuid not null references colleges(id);
alter table subjects add column is_active boolean not null default true;
alter table subjects add column created_at timestamptz not null default now();
alter table subjects add column updated_at timestamptz not null default now();
alter table academic_terms add column is_active boolean not null default true;
alter table timetable_generations add column input_fingerprint text not null default '';
alter table timetable_generations add column input_snapshot jsonb;
alter table timetable_generations add column adjustments jsonb not null default '[]';
alter table timetable_generations add column requested_by uuid references auth.users(id);
alter table timetable_entries add column snapshot jsonb;
alter table faculty add check (max_workload_slots_per_week between 1 and 36);
alter table subject_workload add check (slots_per_week between 1 and 36);
alter table timetable_entries add check (start_slot between 1 and 6 and end_slot between start_slot and 6 and not (start_slot<=3 and end_slot>=4));
alter table term_pairs add check (term_a_id <> term_b_id);
alter table courses add check ((name='BPHARM' and total_terms=8 and term_unit='semester') or (name='MPHARM' and total_terms=4 and term_unit='semester') or (name='PHARMD' and total_terms=5 and term_unit='year'));
create unique index one_running_generation on timetable_generations(college_id) where status='running';
create index generations_college_time on timetable_generations(college_id,started_at desc);
create index entries_generation on timetable_entries(generation_id);
create index entries_faculty on timetable_entries(generation_id,faculty_id);
create index entries_room on timetable_entries(generation_id,room_id);
create index workload_term on subject_workload(term_id);

create function touch_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger faculty_touch before update on faculty for each row execute function touch_updated_at();
create trigger subject_touch before update on subjects for each row execute function touch_updated_at();
create trigger workload_touch before update on subject_workload for each row execute function touch_updated_at();
create function require_soft_delete() returns trigger language plpgsql as $$ begin raise exception 'Use is_active=false; historical records must be preserved.'; end $$;
create trigger faculty_no_delete before delete on faculty for each row execute function require_soft_delete();
create trigger subject_no_delete before delete on subjects for each row execute function require_soft_delete();

create function validate_workload() returns trigger language plpgsql set search_path=public as $$
declare col uuid; course_name text; sn text; tn int;
begin
 select c.college_id,c.name,t.term_number into col,course_name,tn from academic_terms t join courses c on c.id=t.course_id where t.id=new.term_id;
 select session_type into sn from subjects where id=new.subject_id and college_id=col;
 if sn is null or not exists(select 1 from faculty where id=new.faculty_id and college_id=col) or not exists(select 1 from rooms where id=new.room_id and college_id=col) then raise exception 'Workload resources must belong to the same college'; end if;
 if new.group_id is not null and not exists(select 1 from groups where id=new.group_id and term_id=new.term_id) then raise exception 'Group must belong to workload term'; end if;
 if new.batch_id is not null and (course_name<>'BPHARM' or not exists(select 1 from batches where id=new.batch_id and group_id=new.group_id)) then raise exception 'Invalid BPHARM batch'; end if;
 if new.pooled_batch_id is not null and not exists(select 1 from pooled_batches where id=new.pooled_batch_id and term_id=new.term_id and kind=sn) then raise exception 'Invalid pooled batch kind or term'; end if;
 if sn in ('lab','practice_school') and new.slots_per_week%3<>0 then raise exception 'Long sessions require a multiple of three slots'; end if;
 if sn in ('practice_school','elective') and new.scope_type<>'pooled' then raise exception 'Practice School and electives require pooled scope'; end if;
 if sn='practice_school' and (course_name<>'BPHARM' or tn not in (7,8)) then raise exception 'Practice School requires BPHARM semester 7 or 8'; end if;
 if sn='lab' and course_name='BPHARM' and new.scope_type<>'batch' then raise exception 'BPHARM labs require batch scope'; end if;
 return new;
end $$;
create trigger workload_integrity before insert or update on subject_workload for each row execute function validate_workload();

-- Missing profiles grant no access. Only explicitly provisioned NULL-college profiles are Deans.
create function can_access_college(target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from admin_profiles where user_id=auth.uid() and (college_id is null or college_id=target));
$$;
revoke all on function can_access_college(uuid) from public;
grant execute on function can_access_college(uuid) to authenticated;
alter table admin_profiles enable row level security;
create policy own_profile on admin_profiles for select to authenticated using(user_id=auth.uid());
alter table colleges enable row level security;
create policy college_read on colleges for select to authenticated using(can_access_college(id));
do $$ declare tab text; begin
 foreach tab in array array['courses','faculty','rooms','subjects','timetable_generations'] loop
  execute format('alter table %I enable row level security',tab);
  execute format('create policy tenant_read on %I for select to authenticated using(can_access_college(college_id))',tab);
 end loop;
end $$;
alter table academic_terms enable row level security;
create policy term_read on academic_terms for select to authenticated using(exists(select 1 from courses c where c.id=course_id and can_access_college(c.college_id)));
alter table groups enable row level security;
create policy group_read on groups for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table batches enable row level security;
create policy batch_read on batches for select to authenticated using(exists(select 1 from groups g where g.id=group_id));
alter table pooled_batches enable row level security;
create policy pool_read on pooled_batches for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table term_pairs enable row level security;
create policy pair_read on term_pairs for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_a_id));
alter table subject_workload enable row level security;
create policy workload_read on subject_workload for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table time_slots enable row level security;
create policy slots_read on time_slots for select to authenticated using(exists(select 1 from admin_profiles p where p.user_id=auth.uid()));
alter table timetable_entries enable row level security;
create policy entries_read on timetable_entries for select to authenticated using(exists(select 1 from timetable_generations g where g.id=generation_id));
alter table generation_term_modes enable row level security;
create policy modes_read on generation_term_modes for select to authenticated using(exists(select 1 from timetable_generations g where g.id=generation_id));
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- One statement gives every generation a consistent input snapshot.
create function college_dataset(target uuid) returns jsonb language sql stable security invoker set search_path=public as $$
with cs as (select * from courses where college_id=target), ts as(select * from academic_terms where course_id in(select id from cs)), gs as(select * from groups where term_id in(select id from ts))
select jsonb_build_object(
 'colleges',coalesce((select jsonb_agg(x) from (select * from colleges where id=target)x),'[]'),
 'courses',coalesce((select jsonb_agg(cs) from cs),'[]'),
 'academic_terms',coalesce((select jsonb_agg(ts) from ts),'[]'),
 'groups',coalesce((select jsonb_agg(gs) from gs),'[]'),
 'batches',coalesce((select jsonb_agg(x) from (select * from batches where group_id in(select id from gs))x),'[]'),
 'pooled_batches',coalesce((select jsonb_agg(x) from (select * from pooled_batches where term_id in(select id from ts))x),'[]'),
 'term_pairs',coalesce((select jsonb_agg(x) from (select * from term_pairs where term_a_id in(select id from ts))x),'[]'),
 'faculty',coalesce((select jsonb_agg(x) from (select * from faculty where college_id=target)x),'[]'),
 'rooms',coalesce((select jsonb_agg(x) from (select * from rooms where college_id=target)x),'[]'),
 'subjects',coalesce((select jsonb_agg(x) from (select * from subjects where college_id=target)x),'[]'),
 'subject_workload',coalesce((select jsonb_agg(x) from (select * from subject_workload where term_id in(select id from ts))x),'[]'));
$$;
revoke all on function college_dataset(uuid) from public;
grant execute on function college_dataset(uuid) to authenticated,service_role;

-- Entire output is committed atomically; ordinary clients cannot write solver output.
create function finish_generation(run_id uuid, result jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare e jsonb; m jsonb;
begin
 perform 1 from timetable_generations where id=run_id and status='running' for update;
 if not found then raise exception 'Run is missing or no longer running'; end if;
 if result->>'status'='success' then
  for e in select * from jsonb_array_elements(result->'entries') loop
   insert into timetable_entries(generation_id,entry_type,subject_workload_id,faculty_id,room_id,term_id,group_id,batch_id,pooled_batch_id,idle_label,idle_reason,day_of_week,start_slot,end_slot,snapshot)
   values(run_id,e->>'entry_type',(e->>'subject_workload_id')::uuid,(e->>'faculty_id')::uuid,(e->>'room_id')::uuid,(e->>'term_id')::uuid,(e->>'group_id')::uuid,(e->>'batch_id')::uuid,(e->>'pooled_batch_id')::uuid,e->>'idle_label',e->>'idle_reason',e->>'day_of_week',(e->>'start_slot')::int,(e->>'end_slot')::int,e->'snapshot');
  end loop;
  for m in select * from jsonb_array_elements(result->'modes') loop
   insert into generation_term_modes(generation_id,term_id,lab_window) values(run_id,(m->>'term_id')::uuid,m->>'lab_window');
  end loop;
 end if;
 update timetable_generations set status=result->>'status',completed_at=clock_timestamp(),conflict_report=result->'conflicts',adjustments=result->'adjustments' where id=run_id;
end $$;
revoke all on function finish_generation(uuid,jsonb) from public;
grant execute on function finish_generation(uuid,jsonb) to service_role;
