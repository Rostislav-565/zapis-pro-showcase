ALTER TABLE blocks ADD COLUMN deletedAt INTEGER;
DROP INDEX blocks_scope;
CREATE UNIQUE INDEX blocks_scope ON blocks(date, coalesce(masterId,'')) WHERE deletedAt IS NULL;
