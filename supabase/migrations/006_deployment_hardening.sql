-- Run after 005_ticket_voting.sql. Safe to rerun.
-- Keep multipart uploads below the Vercel Function request-body ceiling.
begin;
update storage.buckets
set file_size_limit=4194304
where id in ('ticket-receipts','ticket-banners');
commit;
