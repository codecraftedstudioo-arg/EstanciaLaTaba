-- Inventario Estancia La Taba
-- Ejecutar una vez en el SQL Editor de Supabase.
-- No borra objetos: no hay política de DELETE sobre public.objetos.
--
-- Modo Anfitrión no tiene usuario ni contraseña, así que el navegador
-- usa la anon key. Por eso la anon key puede leer y actualizar.
-- No puede borrar filas. No subas la service role al sitio ni a Vercel.

create table if not exists public.objetos (
  id text primary key,
  ambiente text not null default '',
  ambiente_slug text not null default '',
  categoria text not null default '',
  articulo text not null default '',
  descripcion text not null default '',
  cantidad integer not null default 1,
  medidas text not null default '',
  detalle text not null default '',
  estado text not null default 'Disponible',
  precio_publicado numeric,
  publicado boolean not null default false,
  foto_principal text,
  fotos jsonb not null default '[]'::jsonb,
  observaciones text not null default '',
  precio_vendido numeric,
  fecha_venta date,
  observaciones_venta text not null default '',
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint objetos_cantidad_check check (cantidad >= 1),
  constraint objetos_estado_check check (estado in ('Disponible', 'Reservado', 'Vendido', 'Retirado', 'No vender')),
  constraint objetos_precio_check check (precio_publicado is null or precio_publicado >= 0),
  constraint objetos_precio_vendido_check check (precio_vendido is null or precio_vendido >= 0)
);

create table if not exists public.ambientes (
  slug text primary key,
  nombre text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.categorias (
  nombre text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.historial (
  id text primary key,
  ocurrido timestamptz not null default now(),
  objeto_id text,
  objeto_nombre text,
  accion text not null,
  valor_anterior text,
  valor_nuevo text,
  usuario text
);

create index if not exists objetos_publicacion_idx on public.objetos (publicado, estado);
create index if not exists objetos_ambiente_idx on public.objetos (ambiente);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists objetos_updated_at on public.objetos;
create trigger objetos_updated_at
before update on public.objetos
for each row execute function public.touch_updated_at();

alter table public.objetos enable row level security;
alter table public.ambientes enable row level security;
alter table public.categorias enable row level security;
alter table public.historial enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.objetos to anon, authenticated;
grant select, insert, update, delete on public.ambientes to anon, authenticated;
grant select, insert, update, delete on public.categorias to anon, authenticated;
grant select, insert on public.historial to anon, authenticated;

drop policy if exists objetos_lectura on public.objetos;
drop policy if exists objetos_alta on public.objetos;
drop policy if exists objetos_cambio on public.objetos;
create policy objetos_lectura on public.objetos for select to anon, authenticated using (true);
create policy objetos_alta on public.objetos for insert to anon, authenticated with check (true);
create policy objetos_cambio on public.objetos for update to anon, authenticated using (true) with check (true);

drop policy if exists ambientes_lectura on public.ambientes;
drop policy if exists ambientes_alta on public.ambientes;
drop policy if exists ambientes_cambio on public.ambientes;
drop policy if exists ambientes_baja on public.ambientes;
create policy ambientes_lectura on public.ambientes for select to anon, authenticated using (true);
create policy ambientes_alta on public.ambientes for insert to anon, authenticated with check (true);
create policy ambientes_cambio on public.ambientes for update to anon, authenticated using (true) with check (true);
create policy ambientes_baja on public.ambientes for delete to anon, authenticated using (true);

drop policy if exists categorias_lectura on public.categorias;
drop policy if exists categorias_alta on public.categorias;
drop policy if exists categorias_cambio on public.categorias;
drop policy if exists categorias_baja on public.categorias;
create policy categorias_lectura on public.categorias for select to anon, authenticated using (true);
create policy categorias_alta on public.categorias for insert to anon, authenticated with check (true);
create policy categorias_cambio on public.categorias for update to anon, authenticated using (true) with check (true);
create policy categorias_baja on public.categorias for delete to anon, authenticated using (true);

drop policy if exists historial_lectura on public.historial;
drop policy if exists historial_alta on public.historial;
create policy historial_lectura on public.historial for select to anon, authenticated using (true);
create policy historial_alta on public.historial for insert to anon, authenticated with check (true);

-- Catálogo público: publicado y fuera de Vendido, Retirado y No vender.
create or replace view public.catalogo_publico as
select
  id,
  ambiente,
  ambiente_slug,
  categoria,
  articulo,
  descripcion,
  cantidad,
  medidas,
  detalle,
  estado,
  precio_publicado,
  foto_principal,
  fotos,
  orden,
  true as publicado
from public.objetos
where publicado = true
  and estado not in ('Vendido', 'Retirado', 'No vender');

grant select on public.catalogo_publico to anon, authenticated;

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('fotos', 'fotos', true)
  on conflict (id) do nothing;
exception
  when others then
    raise notice 'No se pudo crear el bucket fotos: %', sqlerrm;
end $$;

do $$
begin
  execute 'drop policy if exists fotos_lectura on storage.objects';
  execute 'create policy fotos_lectura on storage.objects for select to anon, authenticated using (bucket_id = ''fotos'')';
  execute 'drop policy if exists fotos_subida on storage.objects';
  execute 'create policy fotos_subida on storage.objects for insert to anon, authenticated with check (bucket_id = ''fotos'')';
exception
  when others then
    raise notice 'No se pudo preparar Supabase Storage: %', sqlerrm;
end $$;

alter table public.objetos replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.objetos;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
