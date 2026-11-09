-- Apply in Supabase SQL editor. Independent of the optional organization schema.
-- A scope is the SHA-256 of this deployment's private device capability.
-- Only server service-role calls can read personal details or operate this queue.
begin;
create table if not exists public.smarttrack_contacts (
  id uuid primary key,
  scope text not null check (scope ~ '^[a-f0-9]{64}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 80),
  email text not null check (length(email) between 3 and 254),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  preferences jsonb not null,
  mode text not null check (mode in ('general','journey')),
  enabled boolean not null,
  minutes integer not null check (minutes in (20,30,60,180,300,600,1440)),
  next_due timestamptz,
  revision integer not null default 1,
  client_revision bigint not null default 0,
  connected boolean not null default false,
  source text not null check (source in ('none','relay','usb')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists smarttrack_contacts_due on public.smarttrack_contacts(scope,next_due) where enabled;
create table if not exists public.smarttrack_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.smarttrack_contacts(id) on delete cascade,
  revision integer not null,
  mode text not null check (mode in ('general','journey')),
  channel text not null check (channel in ('email','sms')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed','uncertain','cancelled')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_id text,
  unique (contact_id, revision, due_at, channel)
);
create index if not exists smarttrack_jobs_pending on public.smarttrack_notification_jobs(status,created_at);
alter table public.smarttrack_contacts enable row level security;
alter table public.smarttrack_notification_jobs enable row level security;
revoke all on public.smarttrack_contacts, public.smarttrack_notification_jobs from public, anon, authenticated;
grant all on public.smarttrack_contacts, public.smarttrack_notification_jobs to service_role;

create or replace function public.smarttrack_save_contact(p_scope text, p_id uuid, p_token_hash text, p_profile jsonb, p_preferences jsonb, p_mode text, p_connected boolean, p_source text, p_client_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c smarttrack_contacts; chosen jsonb; changed boolean; result jsonb;
begin
  if p_mode not in ('general','journey') or p_preferences is null then raise exception 'Invalid preferences' using errcode='22023'; end if;
  foreach chosen in array array[p_preferences->'general', p_preferences->'journey'] loop
    if chosen is null or jsonb_typeof(chosen->'enabled') is distinct from 'boolean' or jsonb_typeof(chosen->'minutes') is distinct from 'number'
      or (chosen->>'minutes')::numeric not in (20,30,60,180,300,600,1440) then raise exception 'Invalid preferences' using errcode='22023'; end if;
  end loop;
  chosen := p_preferences->p_mode;
  -- Also serialize first registration; a caller can never replace another token.
  perform pg_advisory_xact_lock(hashtextextended(p_scope, 0));
  select * into c from smarttrack_contacts where id=p_id for update;
  if found and (c.scope<>p_scope or c.token_hash<>p_token_hash) then raise insufficient_privilege using message='Contact ownership required'; end if;
  if c.id is not null and p_client_revision<c.client_revision then raise sqlstate 'PT409' using message='A newer preference was already saved'; end if;
  if c.id is null then
    if (select count(*) from smarttrack_contacts where scope=p_scope)>=100 then raise exception 'Device contact limit reached' using errcode='54000'; end if;
    insert into smarttrack_contacts(id,scope,token_hash,name,email,phone,preferences,mode,enabled,minutes,next_due,connected,source,client_revision)
    values(p_id,p_scope,p_token_hash,p_profile->>'name',p_profile->>'email',p_profile->>'phone',p_preferences,p_mode,(chosen->>'enabled')::boolean,(chosen->>'minutes')::integer,
      case when (chosen->>'enabled')::boolean then now()+make_interval(mins=>(chosen->>'minutes')::integer) end,p_connected,p_source,p_client_revision)
    returning * into c;
  else
    changed := c.mode<>p_mode or c.enabled<>(chosen->>'enabled')::boolean or c.minutes<>(chosen->>'minutes')::integer
      or c.name<>p_profile->>'name' or c.email<>p_profile->>'email' or c.phone<>p_profile->>'phone';
    update smarttrack_contacts set name=p_profile->>'name', email=p_profile->>'email', phone=p_profile->>'phone', preferences=p_preferences,
      mode=p_mode, enabled=(chosen->>'enabled')::boolean, minutes=(chosen->>'minutes')::integer,
      next_due=case when not (chosen->>'enabled')::boolean then null when changed then now()+make_interval(mins=>(chosen->>'minutes')::integer) else next_due end,
      revision=revision+case when changed then 1 else 0 end, connected=p_connected, source=p_source, last_seen_at=now(), client_revision=p_client_revision
    where id=p_id returning * into c;
    if changed then update smarttrack_notification_jobs set status='cancelled' where contact_id=p_id and status='pending'; end if;
  end if;
  select jsonb_build_object('next_due',c.next_due,'mode',c.mode,
    'contacts',coalesce((select jsonb_agg(row_to_json(x)) from (select id,name,source,connected,last_seen_at from smarttrack_contacts where scope=p_scope order by last_seen_at desc limit 100) x),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(row_to_json(x)) from (select channel,status,created_at from smarttrack_notification_jobs where contact_id=p_id order by created_at desc limit 10) x),'[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.smarttrack_claim_notifications(p_scope text)
returns table(id uuid,channel text,mode text,name text,email text,phone text,due_at timestamptz,last_seen_at timestamptz,connected boolean,source text)
language plpgsql security definer set search_path=public as $$
declare due_contact smarttrack_contacts;
begin
  -- Interrupted external requests must never be automatically sent a second time.
  update smarttrack_notification_jobs j set status='uncertain' from smarttrack_contacts c
    where j.contact_id=c.id and c.scope=p_scope and j.status='processing' and j.claimed_at<now()-interval '5 minutes';
  for due_contact in select * from smarttrack_contacts where scope=p_scope and enabled and next_due<=now() order by next_due limit 5 for update skip locked loop
    insert into smarttrack_notification_jobs(contact_id,revision,mode,channel,due_at)
      values(due_contact.id,due_contact.revision,due_contact.mode,'email',due_contact.next_due),(due_contact.id,due_contact.revision,due_contact.mode,'sms',due_contact.next_due) on conflict do nothing;
    -- Preserve cadence and skip missed intervals instead of sending catch-up floods.
    update smarttrack_contacts set next_due=due_contact.next_due+make_interval(secs=>((floor(extract(epoch from (now()-due_contact.next_due))/(due_contact.minutes*60))+1)*due_contact.minutes*60)::double precision) where smarttrack_contacts.id=due_contact.id;
  end loop;
  return query with picked as (
    select j.id from smarttrack_notification_jobs j join smarttrack_contacts c on c.id=j.contact_id
    where c.scope=p_scope and c.enabled and j.revision=c.revision and j.status='pending'
    order by j.created_at limit 10 for update of j skip locked
  ), claimed as (
    update smarttrack_notification_jobs j set status='processing',claimed_at=now() from picked where j.id=picked.id returning j.*
  ) select j.id,j.channel,j.mode,c.name,c.email,c.phone,j.due_at,c.last_seen_at,c.connected,c.source from claimed j join smarttrack_contacts c on c.id=j.contact_id;
end $$;

create or replace function public.smarttrack_notification_current(p_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from smarttrack_notification_jobs j join smarttrack_contacts c on c.id=j.contact_id where j.id=p_id and j.status='processing' and c.enabled and j.revision=c.revision) then return true; end if;
  update smarttrack_notification_jobs set status='cancelled' where id=p_id and status='processing';
  return false;
end $$;
create or replace function public.smarttrack_finish_notification(p_id uuid,p_status text,p_provider_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('accepted','failed','uncertain') then raise exception 'Invalid delivery result'; end if;
  update smarttrack_notification_jobs set status=p_status,provider_id=p_provider_id where id=p_id and status='processing';
end $$;
revoke all on function public.smarttrack_save_contact(text,uuid,text,jsonb,jsonb,text,boolean,text,bigint) from public,anon,authenticated;
revoke all on function public.smarttrack_claim_notifications(text) from public,anon,authenticated;
revoke all on function public.smarttrack_notification_current(uuid) from public,anon,authenticated;
revoke all on function public.smarttrack_finish_notification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.smarttrack_save_contact(text,uuid,text,jsonb,jsonb,text,boolean,text,bigint) to service_role;
grant execute on function public.smarttrack_claim_notifications(text) to service_role;
grant execute on function public.smarttrack_notification_current(uuid) to service_role;
grant execute on function public.smarttrack_finish_notification(uuid,text,text) to service_role;
commit;
