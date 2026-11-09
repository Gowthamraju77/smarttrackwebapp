-- SmartTrack durable storage for Supabase/Postgres.
-- Apply this file to a new project with the Supabase SQL editor or migrations.
-- The web application never stores a service key in a request or in this schema.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'responder', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships(user_id, organization_id);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 128),
  name text not null check (length(name) between 1 and 160),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

create index if not exists devices_org_idx on public.devices(organization_id, created_at desc, id desc);

create table if not exists public.telemetry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  record_id text not null check (length(record_id) between 1 and 128),
  recorded_at timestamptz,
  received_at timestamptz not null default now(),
  boot_id text not null check (length(boot_id) between 1 and 128),
  sequence bigint not null check (sequence >= 0),
  uptime_ms bigint not null check (uptime_ms >= 0),
  gps_fix boolean not null,
  latitude double precision,
  longitude double precision,
  speed_mps double precision,
  hdop double precision,
  gps_age_ms bigint,
  imu_accel_mps2 double precision,
  imu_gyro_dps double precision,
  payload jsonb not null,
  unique (device_id, record_id),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (speed_mps is null or speed_mps >= 0),
  check (hdop is null or hdop >= 0),
  check (gps_age_ms is null or gps_age_ms >= 0),
  check (not gps_fix or (latitude is not null and longitude is not null)),
  check (gps_fix or (latitude is null and longitude is null and speed_mps is null))
);

create index if not exists telemetry_org_time_idx on public.telemetry(organization_id, coalesce(recorded_at, received_at) desc, id desc);
create index if not exists telemetry_device_time_idx on public.telemetry(device_id, received_at desc, id desc);

create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  start_latitude double precision,
  start_longitude double precision,
  end_latitude double precision,
  end_longitude double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (start_latitude is null or start_latitude between -90 and 90),
  check (start_longitude is null or start_longitude between -180 and 180),
  check (end_latitude is null or end_latitude between -90 and 90),
  check (end_longitude is null or end_longitude between -180 and 180)
);

create index if not exists journeys_org_time_idx on public.journeys(organization_id, started_at desc, id desc);

create table if not exists public.sos_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  record_id text not null check (length(record_id) between 1 and 128),
  recorded_at timestamptz,
  received_at timestamptz not null default now(),
  boot_id text not null check (length(boot_id) between 1 and 128),
  sequence bigint not null check (sequence >= 0),
  uptime_ms bigint not null check (uptime_ms >= 0),
  gps_fix boolean not null,
  latitude double precision,
  longitude double precision,
  state text not null default 'pending' check (state in ('pending', 'acknowledged', 'resolved')),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  payload jsonb not null,
  unique (device_id, record_id),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (not gps_fix or (latitude is not null and longitude is not null)),
  check (state <> 'acknowledged' or (acknowledged_at is not null and acknowledged_by is not null)),
  check (state <> 'resolved' or (resolved_at is not null and resolved_by is not null and acknowledged_at is not null))
);

create index if not exists sos_org_state_idx on public.sos_events(organization_id, state, received_at desc, id desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid references public.devices(id) on delete restrict,
  sos_event_id uuid references public.sos_events(id) on delete cascade,
  kind text not null check (kind in ('sos', 'offline', 'telemetry', 'system')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  state text not null default 'open' check (state in ('open', 'acknowledged', 'resolved')),
  title text not null check (length(title) between 1 and 200),
  message text not null check (length(message) between 1 and 2000),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  unique (sos_event_id),
  check (sos_event_id is not null or device_id is not null)
);

create index if not exists alerts_org_time_idx on public.alerts(organization_id, created_at desc, id desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  entity_type text not null check (entity_type in ('device', 'journey', 'alert', 'sos')),
  entity_id uuid not null,
  action text not null check (action in ('acknowledge', 'resolve', 'create', 'update', 'retire')),
  previous_state text,
  new_state text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_org_entity_idx on public.audit_events(organization_id, entity_type, entity_id, created_at desc);

create table if not exists public.rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.member_of(target_org uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and (allowed_roles is null or m.role = any(allowed_roles))
  );
$$;

revoke all on function public.member_of(uuid, text[]) from public;
grant execute on function public.member_of(uuid, text[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.devices enable row level security;
alter table public.telemetry enable row level security;
alter table public.journeys enable row level security;
alter table public.sos_events enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations for select using (public.member_of(id));
drop policy if exists memberships_self_select on public.memberships;
create policy memberships_self_select on public.memberships for select using (user_id = auth.uid());

drop policy if exists devices_member_select on public.devices;
create policy devices_member_select on public.devices for select using (public.member_of(organization_id));
drop policy if exists telemetry_member_select on public.telemetry;
create policy telemetry_member_select on public.telemetry for select using (public.member_of(organization_id));
drop policy if exists journeys_member_select on public.journeys;
create policy journeys_member_select on public.journeys for select using (public.member_of(organization_id));
drop policy if exists sos_events_member_select on public.sos_events;
create policy sos_events_member_select on public.sos_events for select using (public.member_of(organization_id));
drop policy if exists alerts_member_select on public.alerts;
create policy alerts_member_select on public.alerts for select using (public.member_of(organization_id));
drop policy if exists audit_events_member_select on public.audit_events;
create policy audit_events_member_select on public.audit_events for select using (public.member_of(organization_id));

drop policy if exists rate_limits_no_client_access on public.rate_limits;
create policy rate_limits_no_client_access on public.rate_limits for all using (false) with check (false);

-- Device ingestion is the only write path for telemetry/SOS. It validates the
-- hashed device secret, locks the device row, and makes duplicate retries safe.
create or replace function public.ingest_device_record(
  p_token_hash text,
  p_payload jsonb,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.devices%rowtype;
  v_record_id text;
  duplicate boolean := false;
  event_id uuid;
  gps jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_payload is null then
    raise exception using errcode = '22023', message = 'invalid ingest arguments';
  end if;
  if p_kind not in ('telemetry', 'sos') then
    raise exception using errcode = '22023', message = 'invalid ingest kind';
  end if;
  v_record_id := p_payload->>'record_id';
  if v_record_id is null or length(v_record_id) = 0 or length(v_record_id) > 128 then
    raise exception using errcode = '22023', message = 'invalid record id';
  end if;

  select * into d from public.devices where token_hash = lower(p_token_hash) for update;
  if not found or d.status <> 'active' or d.external_id <> p_payload->>'device_id' then
    raise exception using errcode = 'PT401', message = 'device credentials rejected';
  end if;

  if p_kind = 'telemetry' then
    select exists(select 1 from public.telemetry t where t.device_id = d.id and t.record_id = v_record_id) into duplicate;
    if not duplicate then
      gps := coalesce(p_payload->'gps', '{}'::jsonb);
      insert into public.telemetry (
        organization_id, device_id, record_id, recorded_at, boot_id, sequence,
        uptime_ms, gps_fix, latitude, longitude, speed_mps, hdop, gps_age_ms,
        imu_accel_mps2, imu_gyro_dps, payload
      ) values (
        d.organization_id, d.id, v_record_id,
        nullif(p_payload->>'recorded_at', '')::timestamptz,
        p_payload->>'boot_id', (p_payload->>'sequence')::bigint,
        (p_payload->>'uptime_ms')::bigint, coalesce((gps->>'fix')::boolean, false),
        (gps->>'lat')::double precision, (gps->>'lon')::double precision,
        (gps->>'speed_mps')::double precision, (gps->>'hdop')::double precision,
        (gps->>'age_ms')::bigint,
        (p_payload->'imu'->>'accel_mps2')::double precision,
        (p_payload->'imu'->>'gyro_dps')::double precision, p_payload
      );
    end if;
  else
    select exists(select 1 from public.sos_events s where s.device_id = d.id and s.record_id = v_record_id) into duplicate;
    if not duplicate then
      gps := coalesce(p_payload->'gps', '{}'::jsonb);
      insert into public.sos_events (
        organization_id, device_id, record_id, recorded_at, boot_id, sequence,
        uptime_ms, gps_fix, latitude, longitude, payload
      ) values (
        d.organization_id, d.id, v_record_id,
        nullif(p_payload->>'recorded_at', '')::timestamptz,
        p_payload->>'boot_id', (p_payload->>'sequence')::bigint,
        (p_payload->>'uptime_ms')::bigint, coalesce((gps->>'fix')::boolean, false),
        (gps->>'lat')::double precision, (gps->>'lon')::double precision, p_payload
      ) returning id into event_id;
      insert into public.alerts (organization_id, device_id, sos_event_id, kind, severity, state, title, message)
        values (d.organization_id, d.id, event_id, 'sos', 'critical', 'open', 'SOS received', 'A device has raised an SOS event.');
    end if;
  end if;
  update public.devices set last_seen_at = now(), updated_at = now() where id = d.id;
  return jsonb_build_object('accepted', true, 'record_id', v_record_id, 'duplicate', duplicate);
exception when unique_violation then
  return jsonb_build_object('accepted', true, 'record_id', v_record_id, 'duplicate', true);
end;
$$;

revoke all on function public.ingest_device_record(text, jsonb, text) from public, authenticated, anon;
grant execute on function public.ingest_device_record(text, jsonb, text) to service_role;

-- A single locked transition makes acknowledge and resolve monotonic and records
-- the audit row in the same transaction. User-mode REST calls retain RLS identity.
create or replace function public.transition_sos(p_sos_id uuid, p_action text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event public.sos_events%rowtype;
  next_state text;
  now_at timestamptz := now();
begin
  if auth.uid() is null or p_actor is null or auth.uid() <> p_actor then
    raise exception using errcode = '42501', message = 'actor is not authenticated';
  end if;
  if p_action not in ('acknowledge', 'resolve') then
    raise exception using errcode = '22023', message = 'unsupported transition';
  end if;
  select * into event from public.sos_events where id = p_sos_id for update;
  if not found or not public.member_of(event.organization_id, array['owner', 'admin', 'responder']) then
    raise exception using errcode = '42501', message = 'access denied';
  end if;
  if p_action = 'acknowledge' then
    if event.state <> 'pending' then
      return jsonb_build_object('id', event.id, 'state', event.state, 'duplicate', true);
    end if;
    next_state := 'acknowledged';
    update public.sos_events set state = next_state, acknowledged_at = now_at, acknowledged_by = p_actor where id = event.id;
  else
    if event.state = 'resolved' then
      return jsonb_build_object('id', event.id, 'state', event.state, 'duplicate', true);
    end if;
    if event.state <> 'acknowledged' then
      raise exception using errcode = '22023', message = 'SOS must be acknowledged before resolution';
    end if;
    next_state := 'resolved';
    update public.sos_events set state = next_state, resolved_at = now_at, resolved_by = p_actor where id = event.id;
  end if;
  insert into public.audit_events (organization_id, actor_user_id, entity_type, entity_id, action, previous_state, new_state, metadata)
    values (event.organization_id, p_actor, 'sos', event.id, p_action, event.state, next_state, jsonb_build_object('source', 'api'));
  update public.alerts set state = case when next_state = 'resolved' then 'resolved' else 'acknowledged' end,
    acknowledged_at = case when next_state in ('acknowledged', 'resolved') then coalesce(acknowledged_at, now_at) else acknowledged_at end,
    resolved_at = case when next_state = 'resolved' then now_at else resolved_at end
    where sos_event_id = event.id;
  return jsonb_build_object('id', event.id, 'state', next_state, 'duplicate', false);
end;
$$;

revoke all on function public.transition_sos(uuid, text, uuid) from public, anon;
grant execute on function public.transition_sos(uuid, text, uuid) to authenticated;
