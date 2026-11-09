-- =====================================================================
-- Easy Apply: one-file database setup
--
-- How to use: Supabase dashboard > SQL Editor > New query > paste this whole
-- file > Run. It creates every table, index, access rule and function, and
-- loads the 193 companies. It is safe to run again: nothing is deleted and
-- existing data is kept.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- 1. Companies we track
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  careers_url     text not null,
  segment         text not null,
  ats             text check (ats in ('greenhouse','lever','ashby','smartrecruiters','workable','workday')),
  ats_token       text,
  baseline_done   boolean not null default false,
  active          boolean not null default true,
  last_fetched_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Jobs found on company job boards
-- ---------------------------------------------------------------------
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  external_id   text not null,
  title         text not null,
  location      text not null default '',
  department    text,
  is_remote     boolean not null default false,
  apply_url     text not null,
  posted_at     timestamptz,
  first_seen_at timestamptz not null default now(),
  active        boolean not null default true,
  -- true for jobs that already existed the first time a company was fetched.
  -- They are shown on the site but never trigger alerts.
  is_baseline   boolean not null default false,
  unique (company_id, external_id)
);

create index if not exists jobs_active_seen_idx on public.jobs (active, first_seen_at desc);
create index if not exists jobs_company_idx on public.jobs (company_id);
create index if not exists jobs_title_trgm_idx on public.jobs using gin (title gin_trgm_ops);
create index if not exists jobs_location_trgm_idx on public.jobs using gin (location gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 3. Users. A profile row is created automatically when someone signs up.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  telegram_chat_id   bigint,
  telegram_link_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  whatsapp_number    text,
  whatsapp_link_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at         timestamptz not null default now()
);

-- Adds the WhatsApp columns if you ran an earlier version of this setup.
alter table public.profiles add column if not exists whatsapp_number text;
alter table public.profiles add column if not exists whatsapp_link_code text
  not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists profiles_whatsapp_link_code_key
  on public.profiles (whatsapp_link_code);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- People who signed up before this file was run still get a profile.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 4. Keyword alerts
-- ---------------------------------------------------------------------
create table if not exists public.alerts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  name             text not null default '',
  keywords         text[] not null,
  exclude_keywords text[] not null default '{}',
  locations        text[] not null default '{}',
  segments         text[] not null default '{}',
  remote_only      boolean not null default false,
  channels         text[] not null default '{email}',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check (cardinality(keywords) between 1 and 20)
);

alter table public.alerts drop constraint if exists alerts_channels_check;
alter table public.alerts add constraint alerts_channels_check
  check (cardinality(channels) >= 1 and channels <@ array['email','telegram','whatsapp']::text[]);

create index if not exists alerts_user_idx on public.alerts (user_id);

-- At most 20 alerts per user.
create or replace function public.limit_alerts()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.alerts where user_id = new.user_id) >= 20 then
    raise exception 'You can have up to 20 alerts. Delete one first.';
  end if;
  return new;
end;
$$;

drop trigger if exists alerts_limit on public.alerts;
create trigger alerts_limit
  before insert on public.alerts
  for each row execute function public.limit_alerts();

-- ---------------------------------------------------------------------
-- 5. Log of alerts already sent, so nobody gets the same job twice
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id       uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  job_id   uuid not null references public.jobs(id) on delete cascade,
  channel  text not null,
  sent_at  timestamptz not null default now(),
  unique (alert_id, job_id, channel)
);

alter table public.notifications drop constraint if exists notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check
  check (channel in ('email','telegram','whatsapp'));

create index if not exists notifications_user_idx on public.notifications (user_id);

-- ---------------------------------------------------------------------
-- 6. Companies with their open job counts (used by the Companies page)
-- ---------------------------------------------------------------------
create or replace view public.companies_with_counts
with (security_invoker = true) as
select c.*, coalesce(n.open_jobs, 0)::int as open_jobs
from public.companies c
left join (
  select company_id, count(*) as open_jobs
  from public.jobs
  where active
  group by company_id
) n on n.company_id = c.id;

-- ---------------------------------------------------------------------
-- 7. Functions the website calls directly (a Vite site has no server)
-- ---------------------------------------------------------------------
-- Users cannot edit their profile row directly, so nobody can point alerts
-- at a Telegram chat or WhatsApp number they do not own. These two functions
-- are the only way a signed-in user can disconnect their own.
create or replace function public.disconnect_telegram()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set telegram_chat_id = null where id = auth.uid();
$$;

create or replace function public.disconnect_whatsapp()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set whatsapp_number = null where id = auth.uid();
$$;

revoke all on function public.disconnect_telegram() from public, anon;
revoke all on function public.disconnect_whatsapp() from public, anon;
grant execute on function public.disconnect_telegram() to authenticated;
grant execute on function public.disconnect_whatsapp() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Access rules (row level security)
-- The fetcher and the chat webhooks use the service role key, which
-- bypasses these rules.
-- ---------------------------------------------------------------------
alter table public.companies     enable row level security;
alter table public.jobs          enable row level security;
alter table public.profiles      enable row level security;
alter table public.alerts        enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "companies are public" on public.companies;
create policy "companies are public" on public.companies
  for select using (true);

drop policy if exists "jobs are public" on public.jobs;
create policy "jobs are public" on public.jobs
  for select using (true);

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "manage own alerts" on public.alerts;
create policy "manage own alerts" on public.alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 9. The 193 companies. Re-running keeps any hiring-platform settings
-- that the fetcher already found.
-- ---------------------------------------------------------------------
insert into public.companies (name, slug, careers_url, segment) values
  ('Google', 'google', 'https://google.com/about/careers', 'Global'),
  ('Microsoft', 'microsoft', 'https://careers.microsoft.com', 'Global'),
  ('Amazon', 'amazon', 'https://amazon.jobs', 'Global'),
  ('Apple', 'apple', 'https://jobs.apple.com', 'Global'),
  ('Meta', 'meta', 'https://metacareers.com', 'Global'),
  ('Adobe', 'adobe', 'https://careers.adobe.com', 'Global'),
  ('Oracle', 'oracle', 'https://oracle.com/careers', 'Global'),
  ('SAP', 'sap', 'https://jobs.sap.com', 'Global'),
  ('Salesforce', 'salesforce', 'https://salesforce.com/company/careers', 'Global'),
  ('Intel', 'intel', 'https://jobs.intel.com', 'Global'),
  ('Cisco', 'cisco', 'https://jobs.cisco.com', 'Global'),
  ('IBM', 'ibm', 'https://ibm.com/careers', 'Global'),
  ('NVIDIA', 'nvidia', 'https://nvidia.com/en-us/about-nvidia/careers', 'Global'),
  ('Qualcomm', 'qualcomm', 'https://qualcomm.com/company/careers', 'Global'),
  ('Atlassian', 'atlassian', 'https://atlassian.com/company/careers', 'Global'),
  ('Uber', 'uber', 'https://uber.com/careers', 'Global'),
  ('Walmart Global Tech', 'walmart-global-tech', 'https://careers.walmart.com', 'Global'),
  ('PayPal', 'paypal', 'https://paypal.com/careers', 'Global'),
  ('Dell', 'dell', 'https://jobs.dell.com', 'Global'),
  ('HP', 'hp', 'https://jobs.hp.com', 'Global'),
  ('Broadcom (VMware)', 'broadcom-vmware', 'https://broadcom.com/company/careers', 'Global'),
  ('Siemens', 'siemens', 'https://jobs.siemens.com', 'Global'),
  ('Goldman Sachs', 'goldman-sachs', 'https://goldmansachs.com/careers', 'Global'),
  ('JPMorgan Chase', 'jpmorgan-chase', 'https://careers.jpmorgan.com', 'Global'),
  ('Morgan Stanley', 'morgan-stanley', 'https://morganstanley.com/careers', 'Global'),
  ('Accenture', 'accenture', 'https://accenture.com/in-en/careers', 'Global'),
  ('Deloitte', 'deloitte', 'https://deloitte.com/in/en/careers', 'Global'),
  ('Intuit', 'intuit', 'https://intuit.com/careers', 'Global'),
  ('ServiceNow', 'servicenow', 'https://servicenow.com/careers', 'Global'),
  ('Workday', 'workday', 'https://workday.com/en-us/company/careers', 'Global'),
  ('AMD', 'amd', 'https://careers.amd.com', 'Global'),
  ('Texas Instruments', 'texas-instruments', 'https://ti.com/careers', 'Global'),
  ('Micron', 'micron', 'https://micron.com/careers', 'Global'),
  ('Synopsys', 'synopsys', 'https://careers.synopsys.com', 'Global'),
  ('Visa', 'visa', 'https://corporate.visa.com/en/jobs', 'Global'),
  ('Mastercard', 'mastercard', 'https://careers.mastercard.com', 'Global'),
  ('American Express', 'american-express', 'https://americanexpress.com/en-in/careers', 'Global'),
  ('Citi', 'citi', 'https://jobs.citi.com', 'Global'),
  ('Wells Fargo', 'wells-fargo', 'https://wellsfargojobs.com', 'Global'),
  ('Barclays', 'barclays', 'https://search.jobs.barclays', 'Global'),
  ('HSBC', 'hsbc', 'https://hsbc.com/careers', 'Global'),
  ('Standard Chartered', 'standard-chartered', 'https://sc.com/en/careers', 'Global'),
  ('Bosch', 'bosch', 'https://bosch.in/careers', 'Global'),
  ('Honeywell', 'honeywell', 'https://careers.honeywell.com', 'Global'),
  ('GE', 'ge', 'https://ge.com/careers', 'Global'),
  ('Capgemini', 'capgemini', 'https://capgemini.com/in-en/careers', 'Global'),
  ('EY', 'ey', 'https://ey.com/en_in/careers', 'Global'),
  ('PwC India', 'pwc-india', 'https://pwc.in/careers', 'Global'),
  ('McKinsey', 'mckinsey', 'https://mckinsey.com/careers', 'Global'),
  ('Thoughtworks', 'thoughtworks', 'https://thoughtworks.com/careers', 'Global'),
  ('EPAM', 'epam', 'https://careers.epam.com', 'Global'),
  ('Nagarro', 'nagarro', 'https://nagarro.com/en/careers', 'Global'),
  ('Publicis Sapient', 'publicis-sapient', 'https://publicissapient.com/careers', 'Global'),
  ('Autodesk', 'autodesk', 'https://autodesk.com/careers', 'Global'),
  ('Twilio', 'twilio', 'https://twilio.com/en-us/company/jobs', 'Global'),
  ('Okta', 'okta', 'https://okta.com/company/careers', 'Global'),
  ('Splunk', 'splunk', 'https://splunk.com/en_us/careers', 'Global'),
  ('Zscaler', 'zscaler', 'https://zscaler.com/careers', 'Global'),
  ('Palo Alto Networks', 'palo-alto-networks', 'https://jobs.paloaltonetworks.com', 'Global'),
  ('NetApp', 'netapp', 'https://netapp.com/company/careers', 'Global'),
  ('Nutanix', 'nutanix', 'https://nutanix.com/company/careers', 'Global'),
  ('Red Hat', 'red-hat', 'https://redhat.com/en/jobs', 'Global'),
  ('Arista Networks', 'arista-networks', 'https://arista.com/en/careers', 'Global'),
  ('Applied Materials', 'applied-materials', 'https://appliedmaterials.com/careers', 'Global'),
  ('Western Digital', 'western-digital', 'https://careers.westerndigital.com', 'Global'),
  ('Schneider Electric', 'schneider-electric', 'https://se.com/in/en/about-us/careers', 'Global'),
  ('ABB', 'abb', 'https://careers.abb', 'Global'),
  ('Cummins', 'cummins', 'https://cummins.com/company/careers', 'Global'),
  ('Caterpillar', 'caterpillar', 'https://careers.caterpillar.com', 'Global'),
  ('Booking.com', 'booking-com', 'https://careers.booking.com', 'Global'),
  ('Expedia Group', 'expedia-group', 'https://careers.expediagroup.com', 'Global'),
  ('Target', 'target', 'https://corporate.target.com/careers', 'Global'),
  ('Optum (UnitedHealth Group)', 'optum-unitedhealth-group', 'https://careers.unitedhealthgroup.com', 'Global'),
  ('Fidelity', 'fidelity', 'https://careers.fidelity.com', 'Global'),
  ('BlackRock', 'blackrock', 'https://careers.blackrock.com', 'Global'),
  ('Deutsche Bank', 'deutsche-bank', 'https://careers.db.com', 'Global'),
  ('UBS', 'ubs', 'https://ubs.com/global/en/careers', 'Global'),
  ('Bain & Company', 'bain-company', 'https://bain.com/careers', 'Global'),
  ('BCG', 'bcg', 'https://careers.bcg.com', 'Global'),
  ('TCS', 'tcs', 'https://ibegin.tcs.com', 'IT Services'),
  ('Infosys', 'infosys', 'https://career.infosys.com', 'IT Services'),
  ('Wipro', 'wipro', 'https://careers.wipro.com', 'IT Services'),
  ('HCLTech', 'hcltech', 'https://hcltech.com/careers', 'IT Services'),
  ('Tech Mahindra', 'tech-mahindra', 'https://careers.techmahindra.com', 'IT Services'),
  ('LTIMindtree', 'ltimindtree', 'https://ltimindtree.com/careers', 'IT Services'),
  ('Cognizant', 'cognizant', 'https://careers.cognizant.com', 'IT Services'),
  ('Mphasis', 'mphasis', 'https://mphasis.com/home/careers', 'IT Services'),
  ('Persistent Systems', 'persistent-systems', 'https://persistent.com/careers', 'IT Services'),
  ('Coforge', 'coforge', 'https://coforge.com/careers', 'IT Services'),
  ('Hexaware', 'hexaware', 'https://hexaware.com/careers', 'IT Services'),
  ('Zensar', 'zensar', 'https://zensar.com/careers', 'IT Services'),
  ('Birlasoft', 'birlasoft', 'https://birlasoft.com/careers', 'IT Services'),
  ('Cyient', 'cyient', 'https://cyient.com/careers', 'IT Services'),
  ('Sonata Software', 'sonata-software', 'https://sonata-software.com/careers', 'IT Services'),
  ('Happiest Minds', 'happiest-minds', 'https://happiestminds.com/careers', 'IT Services'),
  ('Mastek', 'mastek', 'https://mastek.com/careers', 'IT Services'),
  ('Newgen Software', 'newgen-software', 'https://newgensoft.com/careers', 'IT Services'),
  ('KPIT', 'kpit', 'https://kpit.com/careers', 'IT Services'),
  ('Tata Elxsi', 'tata-elxsi', 'https://tataelxsi.com/careers', 'IT Services'),
  ('L&T Technology Services', 'l-t-technology-services', 'https://ltts.com/careers', 'IT Services'),
  ('Airtel', 'airtel', 'https://airtel.in/careers', 'Indian Enterprise'),
  ('HDFC Bank', 'hdfc-bank', 'https://hdfcbank.com/personal/about-us/careers', 'Indian Enterprise'),
  ('ICICI Bank', 'icici-bank', 'https://icicicareers.com', 'Indian Enterprise'),
  ('Axis Bank', 'axis-bank', 'https://axisbank.com/careers', 'Indian Enterprise'),
  ('Larsen & Toubro', 'larsen-toubro', 'https://larsentoubro.com/corporate/careers', 'Indian Enterprise'),
  ('Tata Motors', 'tata-motors', 'https://tatamotors.com/careers', 'Indian Enterprise'),
  ('Mahindra', 'mahindra', 'https://mahindra.com/careers', 'Indian Enterprise'),
  ('Flipkart', 'flipkart', 'https://careers.flipkart.com', 'Unicorn'),
  ('Myntra', 'myntra', 'https://careers.myntra.com', 'Unicorn'),
  ('Swiggy', 'swiggy', 'https://careers.swiggy.com', 'Unicorn'),
  ('Zomato', 'zomato', 'https://zomato.com/careers', 'Unicorn'),
  ('Razorpay', 'razorpay', 'https://razorpay.com/jobs', 'Unicorn'),
  ('PhonePe', 'phonepe', 'https://phonepe.com/careers', 'Unicorn'),
  ('Paytm', 'paytm', 'https://paytm.com/careers', 'Unicorn'),
  ('CRED', 'cred', 'https://careers.cred.club', 'Unicorn'),
  ('Zerodha', 'zerodha', 'https://zerodha.com/careers', 'Unicorn'),
  ('Groww', 'groww', 'https://groww.in/careers', 'Unicorn'),
  ('Meesho', 'meesho', 'https://meesho.io/jobs', 'Unicorn'),
  ('Ola', 'ola', 'https://olacabs.com/careers', 'Unicorn'),
  ('Zoho', 'zoho', 'https://zoho.com/careers', 'Unicorn'),
  ('Freshworks', 'freshworks', 'https://freshworks.com/company/careers', 'Unicorn'),
  ('Postman', 'postman', 'https://postman.com/careers', 'Unicorn'),
  ('BrowserStack', 'browserstack', 'https://browserstack.com/careers', 'Unicorn'),
  ('Dream11', 'dream11', 'https://dreamsports.group/careers', 'Unicorn'),
  ('Lenskart', 'lenskart', 'https://careers.lenskart.com', 'Unicorn'),
  ('Urban Company', 'urban-company', 'https://urbancompany.com/careers', 'Unicorn'),
  ('Udaan', 'udaan', 'https://udaan.com/careers', 'Unicorn'),
  ('Unacademy', 'unacademy', 'https://unacademy.com/careers', 'Unicorn'),
  ('Zepto', 'zepto', 'https://zeptonow.com/careers', 'Unicorn'),
  ('InMobi', 'inmobi', 'https://inmobi.com/careers', 'Unicorn'),
  ('Sprinklr', 'sprinklr', 'https://sprinklr.com/careers', 'Unicorn'),
  ('Chargebee', 'chargebee', 'https://chargebee.com/company/careers', 'Mid-size Startup'),
  ('CleverTap', 'clevertap', 'https://clevertap.com/careers', 'Mid-size Startup'),
  ('Darwinbox', 'darwinbox', 'https://darwinbox.com/careers', 'Mid-size Startup'),
  ('Innovaccer', 'innovaccer', 'https://innovaccer.com/careers', 'Mid-size Startup'),
  ('Mindtickle', 'mindtickle', 'https://mindtickle.com/careers', 'Mid-size Startup'),
  ('LeadSquared', 'leadsquared', 'https://leadsquared.com/careers', 'Mid-size Startup'),
  ('Whatfix', 'whatfix', 'https://whatfix.com/careers', 'Mid-size Startup'),
  ('Juspay', 'juspay', 'https://juspay.in/careers', 'Mid-size Startup'),
  ('Pine Labs', 'pine-labs', 'https://pinelabs.com/careers', 'Mid-size Startup'),
  ('Cashfree', 'cashfree', 'https://cashfree.com/careers', 'Mid-size Startup'),
  ('Jupiter', 'jupiter', 'https://jupiter.money/careers', 'Mid-size Startup'),
  ('Hasura', 'hasura', 'https://hasura.io/careers', 'Mid-size Startup'),
  ('Atlan', 'atlan', 'https://atlan.com/careers', 'Mid-size Startup'),
  ('Hevo Data', 'hevo-data', 'https://hevodata.com/careers', 'Mid-size Startup'),
  ('Setu', 'setu', 'https://setu.co/careers', 'Mid-size Startup'),
  ('Rapido', 'rapido', 'https://rapido.bike/careers', 'Startup / Scale-up'),
  ('Ather Energy', 'ather-energy', 'https://atherenergy.com/careers', 'Startup / Scale-up'),
  ('Ola Electric', 'ola-electric', 'https://olaelectric.com/careers', 'Startup / Scale-up'),
  ('Delhivery', 'delhivery', 'https://delhivery.com/careers', 'Startup / Scale-up'),
  ('Nykaa', 'nykaa', 'https://nykaa.com/careers', 'Startup / Scale-up'),
  ('BharatPe', 'bharatpe', 'https://bharatpe.com/careers', 'Startup / Scale-up'),
  ('Slice', 'slice', 'https://sliceit.com/careers', 'Startup / Scale-up'),
  ('Licious', 'licious', 'https://licious.in/careers', 'Startup / Scale-up'),
  ('PharmEasy', 'pharmeasy', 'https://pharmeasy.in/careers', 'Startup / Scale-up'),
  ('Cars24', 'cars24', 'https://cars24.com/careers', 'Startup / Scale-up'),
  ('Spinny', 'spinny', 'https://spinny.com/careers', 'Startup / Scale-up'),
  ('upGrad', 'upgrad', 'https://upgrad.com/careers', 'Startup / Scale-up'),
  ('PhysicsWallah', 'physicswallah', 'https://pw.live/careers', 'Startup / Scale-up'),
  ('ShareChat', 'sharechat', 'https://sharechat.com/careers', 'Startup / Scale-up'),
  ('Gupshup', 'gupshup', 'https://gupshup.io/careers', 'Startup / Scale-up'),
  ('Yellow.ai', 'yellow-ai', 'https://yellow.ai/careers', 'Startup / Scale-up'),
  ('Open', 'open', 'https://open.money/careers', 'Startup / Scale-up'),
  ('Zeta', 'zeta', 'https://zeta.tech/careers', 'Startup / Scale-up'),
  ('Amagi', 'amagi', 'https://amagi.com/careers', 'Startup / Scale-up'),
  ('Druva', 'druva', 'https://druva.com/company/careers', 'Startup / Scale-up'),
  ('Icertis', 'icertis', 'https://icertis.com/company/careers', 'Startup / Scale-up'),
  ('Uniphore', 'uniphore', 'https://uniphore.com/careers', 'Startup / Scale-up'),
  ('Sarvam AI', 'sarvam-ai', 'https://sarvam.ai/careers', 'Startup / Scale-up'),
  ('Khatabook', 'khatabook', 'https://khatabook.com/careers', 'Startup / Scale-up'),
  ('Country Delight', 'country-delight', 'https://countrydelight.in/careers', 'Startup / Scale-up'),
  ('Info Edge (Naukri)', 'info-edge-naukri', 'https://infoedge.in/careers', 'Startup / Scale-up'),
  ('MPL', 'mpl', 'https://mpl.live/careers', 'Startup / Scale-up'),
  ('Games24x7', 'games24x7', 'https://games24x7.com/careers', 'Startup / Scale-up'),
  ('Practo', 'practo', 'https://practo.com/company/careers', 'Startup / Scale-up'),
  ('Cult.fit', 'cult-fit', 'https://cult.fit/careers', 'Startup / Scale-up'),
  ('Zetwerk', 'zetwerk', 'https://zetwerk.com/careers', 'Startup / Scale-up'),
  ('OfBusiness', 'ofbusiness', 'https://ofbusiness.in/careers', 'Startup / Scale-up'),
  ('Pocket FM', 'pocket-fm', 'https://pocketfm.com/careers', 'Startup / Scale-up'),
  ('Observe.AI', 'observe-ai', 'https://observe.ai/careers', 'Startup / Scale-up'),
  ('Capillary Technologies', 'capillary-technologies', 'https://capillarytech.com/careers', 'Startup / Scale-up'),
  ('Exotel', 'exotel', 'https://exotel.com/careers', 'Startup / Scale-up'),
  ('MoEngage', 'moengage', 'https://moengage.com/careers', 'Startup / Scale-up'),
  ('WebEngage', 'webengage', 'https://webengage.com/careers', 'Startup / Scale-up'),
  ('Kissflow', 'kissflow', 'https://kissflow.com/careers', 'Startup / Scale-up'),
  ('Perfios', 'perfios', 'https://perfios.com/careers', 'Startup / Scale-up'),
  ('Krutrim', 'krutrim', 'https://krutrim.com/careers', 'Startup / Scale-up'),
  ('Fractal', 'fractal', 'https://fractal.ai/careers', 'Data & AI'),
  ('Tiger Analytics', 'tiger-analytics', 'https://tigeranalytics.com/careers', 'Data & AI'),
  ('Mu Sigma', 'mu-sigma', 'https://mu-sigma.com/careers', 'Data & AI'),
  ('LatentView', 'latentview', 'https://latentview.com/careers', 'Data & AI'),
  ('Tredence', 'tredence', 'https://tredence.com/careers', 'Data & AI'),
  ('Sigmoid', 'sigmoid', 'https://sigmoid.com/careers', 'Data & AI')
on conflict (slug) do nothing;

-- Done. Next: run `npm run detect` on your computer to find which hiring platform
-- each company uses, then `npm run fetch`.
