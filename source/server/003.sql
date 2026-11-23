ALTER TABLE settings ADD COLUMN businessType TEXT NOT NULL DEFAULT 'barber'
  CHECK (businessType IN ('barber', 'auto', 'tutor', 'other'));
UPDATE settings SET businessType='other' WHERE name <> 'Барбершоп Бритва';
ALTER TABLE services ADD COLUMN description TEXT NOT NULL DEFAULT '';
