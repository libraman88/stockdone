-- Permit optional SKUs and reuse an SKU once its product is archived.
ALTER TABLE products ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_business_id_sku_key;
DROP INDEX IF EXISTS idx_products_sku;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_active_sku
  ON products(business_id, sku)
  WHERE active = true AND sku IS NOT NULL AND btrim(sku) <> '';
