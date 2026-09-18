-- Structural data only. The five unnamed colleges are explicitly placeholders.
insert into colleges(code,name) values
 ('PIP','Parul Institute of Pharmacy'),
 ('PENDING-2','College 2 · name pending'),('PENDING-3','College 3 · name pending'),
 ('PENDING-4','College 4 · name pending'),('PENDING-5','College 5 · name pending'),('PENDING-6','College 6 · name pending')
on conflict(code) do nothing;
insert into courses(college_id,name,term_unit,total_terms)
select c.id,v.name,v.unit,v.n from colleges c cross join(values('BPHARM','semester',8),('MPHARM','semester',4),('PHARMD','year',5))v(name,unit,n)
on conflict(college_id,name) do nothing;
insert into academic_terms(course_id,term_number,academic_year)
select c.id,n,'2026-27' from courses c join colleges col on col.id=c.college_id cross join lateral generate_series(1,c.total_terms)n where col.code='PIP'
on conflict(course_id,term_number,academic_year) do nothing;
insert into groups(term_id,name,group_type)
select t.id,v.name,'division' from academic_terms t join courses c on c.id=t.course_id cross join(values('Division A'),('Division B'))v(name)
where c.name='BPHARM' and not exists(select 1 from groups g where g.term_id=t.id and g.name=v.name);
-- Replace specialization labels with department-approved names when supplied.
insert into groups(term_id,name,group_type)
select t.id,'Specialization '||n,'specialization' from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,9)n
where c.name='MPHARM' and not exists(select 1 from groups g where g.term_id=t.id and g.name='Specialization '||n);
insert into groups(term_id,name,group_type)
select t.id,'Year '||t.term_number,'year_group' from academic_terms t join courses c on c.id=t.course_id
where c.name='PHARMD' and not exists(select 1 from groups g where g.term_id=t.id);
insert into batches(group_id,name)
select g.id,'Batch '||case when g.name='Division A' then chr(64+n) else chr(66+n) end from groups g cross join generate_series(1,2)n
where g.group_type='division' and not exists(select 1 from batches b where b.group_id=g.id and b.name='Batch '||case when g.name='Division A' then chr(64+n) else chr(66+n) end);
insert into term_pairs(term_a_id,term_b_id)
select a.id,b.id from academic_terms a join academic_terms b on b.course_id=a.course_id and b.academic_year=a.academic_year join courses c on c.id=a.course_id
where c.name='BPHARM' and (a.term_number,b.term_number) in ((1,3),(5,7),(2,4),(6,8)) on conflict do nothing;
insert into pooled_batches(term_id,kind,name)
select t.id,'practice_school','PS Batch '||n from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,6)n
where c.name='BPHARM' and t.term_number in (7,8) and not exists(select 1 from pooled_batches p where p.term_id=t.id and p.name='PS Batch '||n);
insert into pooled_batches(term_id,kind,name)
select t.id,'elective','Elective pool '||n from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,2)n
where c.name='BPHARM' and t.term_number in (7,8) and not exists(select 1 from pooled_batches p where p.term_id=t.id and p.name='Elective pool '||n);
insert into time_slots values
 (1,1,'9:30–10:30','09:30','10:30',false),(2,2,'10:30–11:30','10:30','11:30',false),(3,3,'11:30–12:30','11:30','12:30',false),
 (4,4,'Lunch','12:30','13:30',true),(5,5,'1:30–2:30','13:30','14:30',false),(6,6,'2:30–3:30','14:30','15:30',false),(7,7,'3:30–4:25','15:30','16:25',false)
on conflict(id) do nothing;
