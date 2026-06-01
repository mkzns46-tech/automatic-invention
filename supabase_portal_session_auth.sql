create or replace function public.consume_portal_session(session_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_token text;
begin
  delete from public.portal_sessions
  where token = session_token
    and expires_at > now()
  returning token into matched_token;

  return matched_token is not null;
end;
$$;

revoke all on function public.consume_portal_session(text) from public;
grant execute on function public.consume_portal_session(text) to anon, authenticated;
