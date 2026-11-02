-- Grants for products and deal_products, matching supabase/schemas/06_grants.sql

grant all on table public.products to anon;
grant all on table public.products to authenticated;
grant all on table public.products to service_role;

grant all on table public.deal_products to anon;
grant all on table public.deal_products to authenticated;
grant all on table public.deal_products to service_role;

grant all on sequence public.products_id_seq to anon;
grant all on sequence public.products_id_seq to authenticated;
grant all on sequence public.products_id_seq to service_role;

grant all on sequence public.deal_products_id_seq to anon;
grant all on sequence public.deal_products_id_seq to authenticated;
grant all on sequence public.deal_products_id_seq to service_role;
