-- StockDone first-run seed
-- Set DEFAULT_BUSINESS_ID and DEFAULT_BRANCH_ID in backend/.env to these UUIDs.
-- Generate a bcrypt hash for the owner password before replacing OWNER_PASSWORD_HASH.

INSERT INTO businesses (id,name,phone,address)
VALUES ('00000000-0000-4000-8000-000000000001','StockDone','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id,business_id,name,code)
VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Main Store','MAIN')
ON CONFLICT (id) DO NOTHING;

-- Example only: create the owner after supplying a real bcrypt hash.
-- INSERT INTO users (id,business_id,username,name,role,password_hash)
-- VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','admin','Owner','owner','OWNER_PASSWORD_HASH')
-- ON CONFLICT (business_id,username) DO NOTHING;
