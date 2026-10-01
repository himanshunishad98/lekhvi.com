-- LEKHVI SUPABASE PRODUCTION SETUP
-- Run in Supabase SQL Editor after the base tables have been created.
-- This file is safe to re-run.

alter table public.products add column if not exists purpose text;
alter table public.products add column if not exists title_status text;
alter table public.products add column if not exists source_basis text;
alter table public.products add column if not exists sample_price boolean default true;
alter table public.products add column if not exists sample_rating boolean default true;
alter table public.products add column if not exists currency text default 'INR';

-- Browser-side admin authorization helper.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles
    where id = auth.uid() and is_admin = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Data API permissions. RLS below still controls which rows can be accessed.
grant select on public.products to anon, authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, update on public.admin_profiles to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert, update on public.order_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Product visibility: public visitors can read published products.
drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products"
on public.products for select
to anon, authenticated
using (published = true);

-- Admins can fully manage products.
drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Admin profile: an authenticated user can read only their own profile.
drop policy if exists "Users can read own admin profile" on public.admin_profiles;
create policy "Users can read own admin profile"
on public.admin_profiles for select
to authenticated
using (id = auth.uid());

-- Admin-only access to operational tables.
drop policy if exists "Admins can manage customers" on public.customers;
create policy "Admins can manage customers"
on public.customers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage orders" on public.orders;
create policy "Admins can manage orders"
on public.orders for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage order items" on public.order_items;
create policy "Admins can manage order items"
on public.order_items for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Storage bucket for product/sample images.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can view Lekhvi product images" on storage.objects;
create policy "Public can view Lekhvi product images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Admins can upload Lekhvi product images" on storage.objects;
create policy "Admins can upload Lekhvi product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can update Lekhvi product images" on storage.objects;
create policy "Admins can update Lekhvi product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_admin())
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can delete Lekhvi product images" on storage.objects;
create policy "Admins can delete Lekhvi product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_admin());

-- Secure order creation for anonymous customers.
-- The function re-reads product prices/stock from the database, so the browser cannot set an arbitrary price.
create or replace function public.create_order(p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id bigint;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_shipping numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_has_physical boolean := false;
  item jsonb;
  v_product public.products%rowtype;
  v_variant_price numeric(10,2);
  v_unit_price numeric(10,2);
  v_qty integer;
begin
  if coalesce(trim(p_customer->>'name'), '') = '' then
    raise exception 'Customer name is required';
  end if;
  if coalesce(trim(p_customer->>'mobile'), '') = '' then
    raise exception 'Customer mobile is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one product is required';
  end if;

  insert into public.customers(name, mobile, email, address)
  values (
    trim(p_customer->>'name'),
    trim(p_customer->>'mobile'),
    nullif(trim(p_customer->>'email'), ''),
    trim(p_customer->>'address')
  )
  returning id into v_customer_id;

  v_order_number := 'LK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders(order_number, customer_id, payment_method, payment_status, order_status, customer_snapshot)
  values (
    v_order_number,
    v_customer_id,
    nullif(trim(p_customer->>'payment_method'), ''),
    'PENDING',
    'PENDING_PAYMENT',
    p_customer
  )
  returning id into v_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(coalesce((item->>'quantity')::integer, 0), 0);
    if v_qty < 1 then raise exception 'Invalid quantity'; end if;

    select * into v_product
    from public.products
    where id = (item->>'product_id')::bigint
      and published = true
    for update;

    if not found then
      raise exception 'Product % is unavailable', item->>'product_id';
    end if;

    if v_product.stock < v_qty then
      raise exception 'Not enough stock for %', v_product.name;
    end if;

    v_variant_price := null;
    if jsonb_typeof(v_product.variants) = 'array' then
      select nullif(v->>'price', '')::numeric(10,2)
      into v_variant_price
      from jsonb_array_elements(v_product.variants) v
      where lower(coalesce(v->>'name','')) = lower(coalesce(item->>'variant_name',''))
      limit 1;
    end if;

    v_unit_price := coalesce(v_variant_price, v_product.price);
    v_subtotal := v_subtotal + (v_unit_price * v_qty);

    if lower(coalesce(item->>'variant_name','')) not like '%pdf%'
       and lower(coalesce(item->>'variant_name','')) not like '%digital%' then
      v_has_physical := true;
    end if;

    insert into public.order_items(order_id, product_id, product_name, variant_name, quantity, unit_price, total_price)
    values (v_order_id, v_product.id, v_product.name, item->>'variant_name', v_qty, v_unit_price, v_unit_price * v_qty);

    update public.products
    set stock = stock - v_qty, updated_at = now()
    where id = v_product.id;
  end loop;

  if v_has_physical and v_subtotal < 499 then
    v_shipping := 50;
  else
    v_shipping := 0;
  end if;

  v_total := v_subtotal + v_shipping;

  update public.orders
  set subtotal = v_subtotal,
      shipping_amount = v_shipping,
      total_amount = v_total,
      updated_at = now()
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'shipping_amount', v_shipping,
    'total_amount', v_total
  );
end;
$$;

revoke all on function public.create_order(jsonb, jsonb) from public;
grant execute on function public.create_order(jsonb, jsonb) to anon, authenticated;
