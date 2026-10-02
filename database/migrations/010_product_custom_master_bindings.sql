-- Product bindings for arbitrary custom master lists
CREATE TABLE IF NOT EXISTS product_master_values (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES master_data_types(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES master_data_items(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(product_id,type_id)
);
CREATE INDEX IF NOT EXISTS idx_product_master_values_item ON product_master_values(item_id);
