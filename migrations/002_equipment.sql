-- Nullable during backfill so an intentionally empty loadout stays empty on restart.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS equipment jsonb;
UPDATE accounts SET equipment = CASE
  WHEN cosmetic IN ('violet-mage','mint-scout','sunset-knight') THEN jsonb_build_object('skin',cosmetic)
  WHEN cosmetic='star-crown' THEN jsonb_build_object('hat',cosmetic)
  WHEN cosmetic='pocket-dragon' THEN jsonb_build_object('pet',cosmetic)
  ELSE '{}'::jsonb END WHERE equipment IS NULL;
ALTER TABLE accounts ALTER COLUMN equipment SET DEFAULT '{}'::jsonb;
ALTER TABLE accounts ALTER COLUMN equipment SET NOT NULL;
